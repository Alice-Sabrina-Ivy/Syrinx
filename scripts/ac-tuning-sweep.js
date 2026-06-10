// ac-tuning-sweep.js — Fast AC-only parameter sweep for the Praat-style
// detector ([tests/dsp/boersma-ac.js]). No ONNX: each full-corpus cell is
// ~15 s, so a grid is cheap. Scores frame-local and path-tracked configs
// against the four ground-truth corpora and the user's 2026-05-26 session
// (Praat reference), reporting the metrics that decide tuning:
// per-corpus correct / octave-error / null, session 80-110 Hz band, and
// session octave-flip rate.
//
// Audio is pre-resampled to 16 kHz once per track; each config re-buffers
// from that with its own frameLength. Attribution time accounts for the
// window center (frameLength/2) so truth alignment stays honest across
// window lengths.
//
// Usage:
//   node scripts/ac-tuning-sweep.js <stageName> [out.json]
// Stages defined in STAGES below.

import { readFileSync, writeFileSync } from "node:fs";
import { loadAllCorpora } from "../tests/dsp/data/corpora.js";
import { resampleLinear } from "../tests/dsp/swift-f0-adapter.js";
import { createBoersmaAC, createPathTracker } from "../src/dsp/boersma-ac.js";

const SR = 16000;
const HOP = Math.round(SR * 0.025); // 400 samples = 25 ms
const RATIO_TOL = 0.05;
const OCTAVE_REL_TOL = 0.10;
const FLIP_TOL = 0.2;
const SESSION_WAV = "C:/Coding Projects/Calliope/sessions/2026-05-26/session.wav";
const PRAAT_CONTOURS = "build/pitch-compare/praat-contours.json";

function readWav(filePath) {
  const buf = readFileSync(filePath);
  let offset = 12, sampleRate = 0, bits = 0, dataStart = 0, dataSize = 0;
  while (offset < buf.length - 8) {
    const id = buf.toString("ascii", offset, offset + 4);
    const size = buf.readUInt32LE(offset + 4);
    if (id === "fmt ") { sampleRate = buf.readUInt32LE(offset + 12); bits = buf.readUInt16LE(offset + 22); }
    else if (id === "data") { dataStart = offset + 8; dataSize = size; break; }
    offset += 8 + size;
  }
  const n = Math.floor(dataSize / 2);
  const s = new Float32Array(n);
  for (let i = 0; i < n; i++) s[i] = buf.readInt16LE(dataStart + i * 2) / 32768;
  return { samples: s, sampleRate };
}

function classify(reported, truth) {
  if (!(truth > 0)) return "n/a";
  if (!(reported > 0)) return "null";
  const r = reported / truth;
  if (Math.abs(r - 1) < RATIO_TOL) return "correct";
  const big = r > 1 ? r : 1 / r;
  const nearest = Math.round(big);
  if (nearest >= 2 && Math.abs(big - nearest) / nearest < OCTAVE_REL_TOL) {
    return r > 1 ? "octave-up" : "octave-down";
  }
  return "other";
}

// Run a config over a pre-resampled 16 kHz signal, returning the reported
// pitch per hop aligned to attribution time (window-center).
function runConfig(sig16k, cfg) {
  const L = cfg.frameLength;
  const ac = createBoersmaAC(SR, L, cfg.ac);
  const tracker = cfg.path ? createPathTracker(cfg.path) : null;
  const buf = new Float32Array(L);
  let fill = 0;
  const reported = []; // { tMs, pitch }
  // Attribution: AC's response is centered at the Hann window center
  // (L/2 back from the latest sample). AC_ATTR_OFF_MS overrides for
  // attribution-convention probes.
  const centerOffMs = process.env.AC_ATTR_OFF_MS
    ? +process.env.AC_ATTR_OFF_MS
    : (L / 2) / SR * 1000;
  let hopIdx = 0;
  for (let i = 0; i + HOP <= sig16k.length; i += HOP, hopIdx++) {
    buf.copyWithin(0, HOP, L);
    buf.set(sig16k.subarray(i, i + HOP), L - HOP);
    fill = Math.min(L, fill + HOP);
    const latestMs = (hopIdx + 1) * (HOP / SR) * 1000;
    const tMs = latestMs - centerOffMs;
    if (fill < L) { if (tracker) tracker.emit({ voiced: [], unvoicedStrength: cfg.ac?.voicingThreshold ?? 0.45 }); continue; }
    let pitch;
    if (tracker) pitch = tracker.emit(ac.candidates(buf)); // delayed by lookback
    else { const d = ac.detect(buf); pitch = d.pitch; }
    reported.push({ tMs, pitch: pitch ?? 0 });
  }
  if (tracker) {
    // Path tracker is delayed; reported[k].pitch currently holds the
    // value for hop k-lookback. Re-align: shift reported pitches forward
    // by lookback so each tMs carries its own decoded pitch, then append
    // the flushed tail.
    const L2 = cfg.path.lookback ?? 4;
    const tail = tracker.flush();
    const pitches = reported.map((r) => r.pitch).slice(L2).concat(tail);
    for (let k = 0; k < reported.length; k++) reported[k].pitch = pitches[k] ?? 0;
  }
  return reported;
}

// PTDB-TUG's .f0 reference timestamps sit ~20 ms later than the loader's
// i*hopMs convention (empirically located via the attribution probe: AC
// accuracy on PTDB peaks when scored 20 ms later than its true window
// center, while FDA/vocadito/session peak exactly at center — consistent
// with the REF files timestamping the START of RAPT's 32 ms analysis
// window rather than its center). Correct it at lookup; the other corpora
// need none.
const REF_OFFSET_MS = { "ptdb-tug": 20 };

function scoreCorpus(reported, ref, refHopMs, refOffsetMs = 0) {
  const c = { correct: 0, "octave-up": 0, "octave-down": 0, other: 0, null: 0 };
  let voiced = 0;
  for (const { tMs, pitch } of reported) {
    const idx = Math.round((tMs - refOffsetMs) / refHopMs);
    if (idx < 0 || idx >= ref.length) continue;
    const truth = ref[idx];
    if (!(truth > 0)) continue;
    voiced++;
    c[classify(pitch, truth)]++;
  }
  return { ...c, voiced };
}

function pct(c, k) { return c.voiced ? +(100 * c[k] / c.voiced).toFixed(1) : 0; }

function flipPct(reported) {
  const vals = reported.map((r) => r.pitch).filter((p) => p > 0);
  if (vals.length < 2) return null;
  let flips = 0, pairs = 0;
  for (let i = 1; i < vals.length; i++) {
    const r = vals[i] > vals[i - 1] ? vals[i] / vals[i - 1] : vals[i - 1] / vals[i];
    pairs++;
    if (Math.abs(r - 2) < FLIP_TOL) flips++;
  }
  return +(100 * flips / pairs).toFixed(2);
}

// ---- config stages ----
const base = { frameLength: 1024, ac: {}, path: null };
function gridStageA() {
  const out = [];
  for (const vt of [0.30, 0.40, 0.45, 0.55]) {
    for (const oc of [0.01, 0.05, 0.10, 0.20]) {
      out.push({ name: `vt${vt}_oc${oc}`, frameLength: 1024, ac: { voicingThreshold: vt, octaveCost: oc }, path: null });
    }
  }
  return out;
}
function gridStageB(best) {
  // window-length sweep at the best stage-A ac config
  return [1024, 1536, 2048].map((fl) => ({ name: `fl${fl}`, frameLength: fl, ac: best, path: null }));
}
function gridStageC(bestAc, bestFl) {
  // path-tracker sweep on top of best frame-local config
  const out = [{ name: "frame-local", frameLength: bestFl, ac: bestAc, path: null }];
  for (const ojc of [0.15, 0.30, 0.50]) {
    for (const L of [2, 4, 6]) {
      out.push({ name: `path_ojc${ojc}_L${L}`, frameLength: bestFl, ac: bestAc, path: { octaveJumpCost: ojc, lookback: L } });
    }
  }
  return out;
}

const STAGES = {
  // Range constraint check (2026-06-10): production tuned config at the
  // legacy 50-600 Hz search range vs the 60-400 Hz speech-scoped range.
  R: () => [
    { name: "range50-600", frameLength: 1536, ac: { minPitchHz: 50, maxPitchHz: 600 }, path: { lookback: 2 } },
    { name: "range60-400", frameLength: 1536, ac: { minPitchHz: 60, maxPitchHz: 400 }, path: { lookback: 2 } },
  ],
  P: () => [{ name: `probe_attr${process.env.AC_ATTR_OFF_MS || "center"}`, frameLength: 1024, ac: { voicingThreshold: 0.40, octaveCost: 0.01 }, path: null }],
  A: () => gridStageA(),
  B: () => gridStageB(JSON.parse(process.env.AC_BEST || '{"voicingThreshold":0.40,"octaveCost":0.05}')),
  C: () => gridStageC(
    JSON.parse(process.env.AC_BEST || '{"voicingThreshold":0.40,"octaveCost":0.05}'),
    +(process.env.AC_FL || 1024),
  ),
};

const stageName = process.argv[2];
const outPath = process.argv[3];
const configs = STAGES[stageName]();
if (!configs) throw new Error(`unknown stage ${stageName}; choose A|B|C`);

console.log("Loading corpora …");
const corpora = loadAllCorpora();
// Pre-resample every track to 16 kHz once.
const byCorpus = {};
for (const t of corpora) {
  const sig = t.sampleRate === SR ? t.samples : resampleLinear(t.samples, t.sampleRate, SR);
  (byCorpus[t.corpus] ||= []).push({ sig16k: sig, ref: t.ref.f0, refHopMs: t.ref.hopMs });
}
console.log("Loading session WAV + Praat reference …");
const sessRaw = readWav(SESSION_WAV);
const sessSig = sessRaw.sampleRate === SR ? sessRaw.samples : resampleLinear(sessRaw.samples, sessRaw.sampleRate, SR);
const praatDoc = JSON.parse(readFileSync(PRAAT_CONTOURS, "utf8"));
const pf = praatDoc.files.find((f) => f.path === SESSION_WAV);
const praatRef = { f0: pf.f0, t0: pf.t0, dt: pf.dt };

function scoreSession(reported) {
  const overall = { correct: 0, "octave-up": 0, "octave-down": 0, other: 0, null: 0, voiced: 0 };
  const band = { correct: 0, "octave-up": 0, other: 0, null: 0, voiced: 0 };
  for (const { tMs, pitch } of reported) {
    const idx = Math.round((tMs / 1000 - praatRef.t0) / praatRef.dt);
    if (idx < 0 || idx >= praatRef.f0.length) continue;
    const truth = praatRef.f0[idx];
    if (!(truth > 0)) continue;
    overall.voiced++; overall[classify(pitch, truth)]++;
    if (truth >= 80 && truth < 110) { band.voiced++; band[classify(pitch, truth)]++; }
  }
  return { overall, band, flip: flipPct(reported) };
}

const results = [];
const t0 = Date.now();
for (const cfg of configs) {
  const corpusScores = {};
  for (const [corpus, tracks] of Object.entries(byCorpus)) {
    const agg = { correct: 0, "octave-up": 0, "octave-down": 0, other: 0, null: 0, voiced: 0 };
    for (const tr of tracks) {
      const rep = runConfig(tr.sig16k, cfg);
      const s = scoreCorpus(rep, tr.ref, tr.refHopMs, REF_OFFSET_MS[corpus] ?? 0);
      for (const k of Object.keys(agg)) agg[k] += s[k];
    }
    corpusScores[corpus] = agg;
  }
  const sess = scoreSession(runConfig(sessSig, cfg));
  results.push({ cfg, corpusScores, sess });
  // ranking helpers
  const octErr = Math.max(...Object.values(corpusScores).map((c) => pct(c, "octave-up") + pct(c, "octave-down")));
  const minCorrect = Math.min(...Object.values(corpusScores).map((c) => pct(c, "correct")));
  console.log(
    `${cfg.name.padEnd(18)} | corpora minCorrect ${minCorrect.toFixed(1)} maxOctErr ${octErr.toFixed(2)} ` +
    `| FDA ${pct(corpusScores.fda, "correct")}/${(pct(corpusScores.fda,"octave-up")+pct(corpusScores.fda,"octave-down")).toFixed(1)} ` +
    `voc ${pct(corpusScores.vocadito, "correct")}/${(pct(corpusScores.vocadito,"octave-up")+pct(corpusScores.vocadito,"octave-down")).toFixed(1)} ` +
    `ptdb ${pct(corpusScores["ptdb-tug"], "correct")} ` +
    `| sess80-110 corr ${pct(sess.band, "correct")} up ${pct(sess.band, "octave-up")} null ${pct(sess.band, "null")} flip ${sess.flip} ` +
    `(${((Date.now() - t0) / 1000).toFixed(0)}s)`,
  );
}

if (outPath) {
  writeFileSync(outPath, JSON.stringify({
    stage: stageName,
    results: results.map((r) => ({
      name: r.cfg.name, cfg: r.cfg,
      corpora: Object.fromEntries(Object.entries(r.corpusScores).map(([c, s]) => [c, {
        correct: pct(s, "correct"), octaveUp: pct(s, "octave-up"), octaveDown: pct(s, "octave-down"),
        other: pct(s, "other"), null: pct(s, "null"), voiced: s.voiced,
      }])),
      session: {
        overall: Object.fromEntries(["correct", "octave-up", "octave-down", "other", "null"].map((k) => [k, pct(r.sess.overall, k)])),
        band80_110: Object.fromEntries(["correct", "octave-up", "other", "null"].map((k) => [k, pct(r.sess.band, k)])),
        flipPct: r.sess.flip,
      },
    })),
  }, null, 1));
  console.log(`\nsaved ${outPath}`);
}
