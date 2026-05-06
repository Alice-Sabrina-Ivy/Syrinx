// rl022-diagnostic.js — Probe pYIN per-frame to determine whether the true
// F0 on the user-reported reproducer (FDA rl022) is in pYIN's top-3
// per-frame candidates. Answers Stage 1's diagnostic question:
//
//   Q: "Is the true F0 in pYIN's top-3 candidates per frame?"
//
//   - YES → HMM is mis-ranking among reasonable candidates; failure is
//     HMM-side. SwiftF0 candidate-generation replacement is wrong direction.
//   - NO  → pYIN's per-frame candidate generation isn't even ranking the
//     true F0 in top-3. Candidate-generation replacement (SwiftF0) is the
//     correct fix surface.
//
// Probes two distinct levels:
//   (a) pitch_obs[] — per-frame candidate mass BEFORE HMM smoothing.
//       This is what pYIN's CMND-scan + Beta-CDF integration produces
//       for each pitch state. Top-3 of pitch_obs[] tells us which pitches
//       the per-frame candidate-generation step ranks highest.
//   (b) HMM log-α[] — forward variables AFTER HMM smoothing. Top-3 of α[]
//       tells us which pitches the HMM (combining obs + transition prior)
//       considers most likely given history.
//
// If true F0 is in top-3 of (a) but not (b), HMM is mis-ranking (a-priori
// pYIN candidates are fine; tuning is wrong). If not in either, candidate
// generation has missed the true F0 entirely (SwiftF0 case applies).
//
// Usage: node tests/dsp/rl022-diagnostic.js
//
// Reads tests/dsp/data/fda/rl/rl022.{sig,fx}. SKIPs if FDA not fetched.

import vm from "node:vm";
import { readFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "../..");
const WORKER_PATH = join(ROOT, "src/dsp/dsp-worker.js");
const SIG_PATH = join(ROOT, "tests/dsp/data/fda/rl/rl022.sig");
const FX_PATH = join(ROOT, "tests/dsp/data/fda/rl/rl022.fx");

if (!existsSync(SIG_PATH) || !existsSync(FX_PATH)) {
  console.log("SKIP: FDA rl022 not fetched. Run bash scripts/fetch-fda-subset.sh.");
  process.exit(0);
}

// ---------------------------------------------------------------------------
//  Format readers
// ---------------------------------------------------------------------------

// FDA .sig — raw 20 kHz 16-bit big-endian mono, headerless.
function readSig(path) {
  const buf = readFileSync(path);
  const n = buf.length / 2;
  const s = new Float32Array(n);
  for (let i = 0; i < n; i++) s[i] = buf.readInt16BE(i * 2) / 32768;
  return { samples: s, sampleRate: 20000 };
}

// FDA .fx — ASCII header to 0x0c, then `time_ms F0_Hz` pitchmark pairs
// separated by `=` voicing-break lines. Resample irregular pitchmarks
// onto a 5 ms regular grid via linear interpolation within voiced segments.
const FDA_REF_HOP_MS = 5;
function readFx(path) {
  const buf = readFileSync(path);
  const hdrEnd = buf.indexOf(0x0c);
  const data = buf.toString("utf8", hdrEnd + 1).trim();
  const lines = data.split("\n");
  const segments = [];
  let cur = [];
  for (const line of lines) {
    const t = line.trim();
    if (t === "") continue;
    if (t === "=") { if (cur.length > 0) segments.push(cur); cur = []; continue; }
    const parts = t.split(/\s+/);
    if (parts.length !== 2) continue;
    const tMs = parseFloat(parts[0]);
    const f0 = parseFloat(parts[1]);
    if (Number.isFinite(tMs) && Number.isFinite(f0)) cur.push({ tMs, f0 });
  }
  if (cur.length > 0) segments.push(cur);
  const lastTimeMs = segments.length > 0 && segments[segments.length - 1].length > 0
    ? segments[segments.length - 1][segments[segments.length - 1].length - 1].tMs : 0;
  const nBins = Math.ceil(lastTimeMs / FDA_REF_HOP_MS) + 1;
  const f0 = new Float32Array(nBins);
  for (const seg of segments) {
    if (seg.length === 0) continue;
    const startBin = Math.ceil(seg[0].tMs / FDA_REF_HOP_MS);
    const endBin = Math.floor(seg[seg.length - 1].tMs / FDA_REF_HOP_MS);
    for (let bin = startBin; bin <= endBin; bin++) {
      const queryMs = bin * FDA_REF_HOP_MS;
      let lo = 0, hi = seg.length - 1;
      while (lo < hi - 1) {
        const mid = (lo + hi) >>> 1;
        if (seg[mid].tMs <= queryMs) lo = mid; else hi = mid;
      }
      const a = seg[lo], b = seg[hi];
      const span = b.tMs - a.tMs;
      f0[bin] = span > 0 ? a.f0 + (b.f0 - a.f0) * (queryMs - a.tMs) / span : a.f0;
    }
  }
  return { f0, hopMs: FDA_REF_HOP_MS };
}

// ---------------------------------------------------------------------------
//  Worker context with HMM-internal probe.
// ---------------------------------------------------------------------------

function loadWorker(sampleRate) {
  // Worker uses const/let at top level which don't bind to globalThis in vm
  // contexts. Append a probe that has lexical access to the HMM internals.
  const src = readFileSync(WORKER_PATH, "utf8") +
    `\nglobalThis.__probeHMM = function() {
       return {
         logAlpha: _PYIN_LOG_ALPHA,        // post-HMM forward-α (smoothed)
         pitchObs: _PYIN_OBS_LOG,          // post-distribution log obs
         frameIdx: _pyinFrameIdx,
         voicedness: _pyinLastVoicedness,
         voicednessObs: _pyinLastVoicednessObs,
         N_PITCH: _PYIN_N_PITCH,
         N_STATES: _PYIN_N_STATES,
         UNVOICED_OFFSET: _PYIN_UNVOICED_OFFSET,
       };
     };\n`;
  const ctx = {
    self: { postMessage() {}, onmessage: null },
    performance: { now: () => 0, timeOrigin: 0 },
    console,
    __PYIN_STAGE: 2,
    __PYIN_LOOKBACK: 4,
  };
  vm.createContext(ctx);
  vm.runInContext(src, ctx, { filename: "dsp-worker.js" });
  ctx.self.onmessage({ data: { type: "init", sampleRate } });
  return ctx;
}

function stateToHz(s) {
  return 75 * Math.pow(2, s / 100);
}

function isOctaveError(workerHz, truthHz) {
  if (!(workerHz > 0) || !(truthHz > 0)) return false;
  const r = workerHz / truthHz;
  const cand = r > 1 ? r : 1 / r;
  if (cand < 1.5) return false;
  const nearest = Math.round(cand);
  return nearest >= 2 && Math.abs(cand - nearest) / nearest < 0.05;
}

// Find which pitch state the truth F0 corresponds to.
function truthHzToState(hz) {
  if (!(hz >= 75 && hz <= 600)) return -1;
  const s = Math.round(100 * Math.log2(hz / 75));
  return Math.max(0, Math.min(299, s));
}

// ---------------------------------------------------------------------------
//  Diagnostic main
// ---------------------------------------------------------------------------

const { samples, sampleRate } = readSig(SIG_PATH);
const ref = readFx(FX_PATH);
console.log(`# rl022.sig: ${samples.length} samples @ ${sampleRate} Hz, ${(samples.length / sampleRate).toFixed(2)} s`);
console.log(`# ground truth: ${ref.f0.length} bins at ${ref.hopMs} ms hop`);

const ctx = loadWorker(sampleRate);
ctx.self.onmessage({ data: { type: "reset-pitch-hmm" } });

const winN = Math.floor(sampleRate * 50 / 1000);
const hopN = Math.floor(sampleRate * 25 / 1000);
const winCenterMsAtHop0 = 0.5 * winN * 1000 / sampleRate;
const hopMs = hopN * 1000 / sampleRate;
const lookback = 4;

let frameIdx = 0;
let voicedFrameCount = 0;

// Per-frame counters
let truthInTop1Obs = 0;       // truth state == top-1 of pitch_obs (pre-HMM)
let truthInTop3Obs = 0;       // truth state in top-3 of pitch_obs (pre-HMM)
let truthInTop1Alpha = 0;     // truth state == top-1 of HMM α (post-HMM)
let truthInTop3Alpha = 0;     // truth state in top-3 of HMM α (post-HMM)
let octaveErrorFrames = 0;    // worker output is an octave error vs truth

// Per-frame "tolerance buckets" — top-3 considered hit if any of the top-3
// states are within ±2 cents/state slots of the truth state. The state space
// quantization (12 cents/state) means the truth state index is approximate.
// Use ±3 states (~36 cents = ~1/3 semitone) as the "hit" tolerance.
const STATE_TOLERANCE = 3;

console.log("# t_sec  truth_Hz  truth_s   worker_Hz  truth_in_top3_obs  truth_in_top3_α  top1_obs(Hz)  top1_α(Hz)");

const sampleFrames = []; // for printing every Nth frame
let n = 0;
for (let i = 0; i + winN <= samples.length; i += hopN, n++) {
  const got = ctx.detectPitch(samples.subarray(i, i + winN), sampleRate);
  const probe = ctx.__probeHMM();
  const t = probe.frameIdx - 1;

  // Attribution: pitch reported is L-back state; we probe at current frame
  // for now — this gives us per-frame top-3 ranking which is what we want
  // for the diagnostic question.
  const attrHop = n - lookback;
  if (attrHop < 0) continue;
  const attrMs = attrHop * hopMs + winCenterMsAtHop0;
  const refIdx = Math.round(attrMs / ref.hopMs);
  if (refIdx < 0 || refIdx >= ref.f0.length) continue;
  const truthHz = ref.f0[refIdx];
  if (truthHz === 0) continue; // skip unvoiced ref frames
  voicedFrameCount++;
  const truthState = truthHzToState(truthHz);
  if (truthState < 0) continue;

  // Probe pitch_obs[] (post-distribution log obs, pre-HMM-forward).
  // Top-3 by raw log-obs value.
  // Note: at this point the obs has been logged (ln) and smoothed with eps,
  // so values are negative; lower magnitude = larger probability.
  const NP = probe.N_PITCH;
  const obs = probe.pitchObs;
  const obsRanking = [];
  for (let s = 0; s < NP; s++) {
    obsRanking.push({ s, v: obs[s] });
  }
  obsRanking.sort((a, b) => b.v - a.v);
  const top3Obs = [obsRanking[0], obsRanking[1], obsRanking[2]];

  // Probe HMM forward α[] at current frame.
  const curOff = (t & 1) * probe.N_STATES;
  const alpha = probe.logAlpha;
  const alphaRanking = [];
  for (let s = 0; s < NP; s++) {
    alphaRanking.push({ s, v: alpha[curOff + s] });
  }
  alphaRanking.sort((a, b) => b.v - a.v);
  const top3Alpha = [alphaRanking[0], alphaRanking[1], alphaRanking[2]];

  // Hit tests with state tolerance.
  const inTop1Obs = Math.abs(top3Obs[0].s - truthState) <= STATE_TOLERANCE;
  const inTop3Obs = top3Obs.some((x) => Math.abs(x.s - truthState) <= STATE_TOLERANCE);
  const inTop1Alpha = Math.abs(top3Alpha[0].s - truthState) <= STATE_TOLERANCE;
  const inTop3Alpha = top3Alpha.some((x) => Math.abs(x.s - truthState) <= STATE_TOLERANCE);

  if (inTop1Obs) truthInTop1Obs++;
  if (inTop3Obs) truthInTop3Obs++;
  if (inTop1Alpha) truthInTop1Alpha++;
  if (inTop3Alpha) truthInTop3Alpha++;

  if (got !== null && isOctaveError(got, truthHz)) octaveErrorFrames++;

  // Every 5th frame, log the row
  if (frameIdx % 1 === 0) {
    sampleFrames.push({
      tSec: (i + winN) / sampleRate,
      truthHz, truthState,
      gotHz: got,
      top1ObsHz: stateToHz(top3Obs[0].s),
      top1ObsRank: top3Obs[0].s,
      top1AlphaHz: stateToHz(top3Alpha[0].s),
      top1AlphaRank: top3Alpha[0].s,
      inTop3Obs, inTop3Alpha,
    });
  }
  frameIdx++;
}

// Report aggregate stats
console.log("");
console.log("===== Aggregate stats over all voiced frames =====");
console.log(`  voiced frames matched: ${voicedFrameCount}`);
console.log(`  truth state hit tolerance: ±${STATE_TOLERANCE} states (${STATE_TOLERANCE * 12} cents)`);
console.log("");
console.log(`  truth in top-1 of pitch_obs[] (pre-HMM): ${truthInTop1Obs}/${voicedFrameCount} = ${(100 * truthInTop1Obs / voicedFrameCount).toFixed(1)}%`);
console.log(`  truth in top-3 of pitch_obs[] (pre-HMM): ${truthInTop3Obs}/${voicedFrameCount} = ${(100 * truthInTop3Obs / voicedFrameCount).toFixed(1)}%`);
console.log("");
console.log(`  truth in top-1 of HMM α (post-HMM):       ${truthInTop1Alpha}/${voicedFrameCount} = ${(100 * truthInTop1Alpha / voicedFrameCount).toFixed(1)}%`);
console.log(`  truth in top-3 of HMM α (post-HMM):       ${truthInTop3Alpha}/${voicedFrameCount} = ${(100 * truthInTop3Alpha / voicedFrameCount).toFixed(1)}%`);
console.log("");
console.log(`  octave-error frames in worker output:     ${octaveErrorFrames}/${voicedFrameCount} = ${(100 * octaveErrorFrames / voicedFrameCount).toFixed(1)}%`);

console.log("");
console.log("===== Per-frame trace (every voiced frame) =====");
console.log("# t_sec  truth_Hz  worker_Hz  top1_obs(Hz)  top1_α(Hz)  in_top3_obs  in_top3_α");
for (const f of sampleFrames) {
  const w = f.gotHz === null ? "null" : f.gotHz.toFixed(1);
  console.log(
    `  ${f.tSec.toFixed(3).padStart(6)}  ${f.truthHz.toFixed(1).padStart(6)}   ${w.padStart(7)}   ` +
    `${f.top1ObsHz.toFixed(1).padStart(8)}      ${f.top1AlphaHz.toFixed(1).padStart(8)}    ` +
    `${f.inTop3Obs ? "Y" : "."}             ${f.inTop3Alpha ? "Y" : "."}`,
  );
}

// Verdict
console.log("");
console.log("===== Verdict =====");
const obsRate = truthInTop3Obs / voicedFrameCount;
const alphaRate = truthInTop3Alpha / voicedFrameCount;
if (obsRate >= 0.7) {
  console.log("  Truth is in pYIN's top-3 candidates ≥70% of the time.");
  console.log("  → Per-frame candidate generation is OK; HMM is mis-ranking.");
  console.log("  → Direction: NOT candidate-generation replacement (SwiftF0).");
} else if (obsRate < 0.3) {
  console.log("  Truth is NOT in pYIN's top-3 candidates >70% of the time.");
  console.log("  → Per-frame candidate generation misses true F0 entirely.");
  console.log("  → Direction: candidate-generation replacement (SwiftF0) is correctly targeted.");
} else {
  console.log(`  Mixed: pre-HMM hit rate is ${(100 * obsRate).toFixed(1)}%.`);
  console.log("  → Failure has both candidate-generation and HMM-side components.");
  console.log("  → SwiftF0 may help but won't fully solve.");
}
