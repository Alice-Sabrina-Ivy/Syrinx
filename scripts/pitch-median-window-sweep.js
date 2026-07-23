// pitch-median-window-sweep.js — Is the main-thread median-5 smoother
// (pitchSmoothing.js) still earning its lag now that the Boersma-AC path
// tracker smooths upstream? (2026-07-19. The median predates the tracker:
// it was sized for pYIN-era octave spikes; the L=2 Viterbi already
// suppresses single-frame flips before the main thread ever sees them.)
//
// Reconstructs the production display chain (AC + tracker L=2 + median-K +
// paint gate) over the 2026-05-26 session for K in {1, 3, 5}, and for each:
//   - attribution-offset sweep (12.5 ms grid) -> best offset = effective
//     display lag of the chain, best-aligned band accuracy = displayed
//     accuracy with alignment artifacts removed
//   - octave-flip rate of the displayed series (consecutive voiced pairs
//     within FLIP_TOL of ratio 2) — the artifact the median exists to kill
//   - spike count: displayed frames that jump >=40% from both neighbors
//     (what the excursion break would draw as an isolated dot/line)
//
// Usage: node scripts/pitch-median-window-sweep.js [--wav=PATH]
// Needs build/pitch-compare/praat-contours.json (see boersma-ac-tuning
// reproduction block).

import { readFileSync } from "node:fs";
import { createBoersmaAC, createPathTracker, createHarmonicVoicingGuard, BOERSMA_FRAME_LENGTH_16K as N } from "../src/dsp/boersma-ac.js";
import { createNoiseNotch, isNearNotch } from "../src/dsp/noise-notch.js";
import { pushAndMedianPitch } from "../src/audio/pitchSmoothing.js";
import { createPaintGate } from "../src/audio/pitchPaintGate.js";

const SR = 16000, HOP = 400;
const SESSION = (process.argv.find((a) => a.startsWith("--wav=")) || "").slice(6)
  || "C:/Coding Projects/Calliope/sessions/2026-05-26/session.wav";
const PRAAT = "build/pitch-compare/praat-contours.json";

function readWav(p) {
  const b = readFileSync(p);
  let o = 12, ds = 0, dz = 0;
  while (o < b.length - 8) { const id = b.toString("ascii", o, o + 4), sz = b.readUInt32LE(o + 4); if (id === "data") { ds = o + 8; dz = sz; break; } o += 8 + sz; }
  const s = new Float32Array(Math.floor(dz / 2));
  for (let i = 0; i < s.length; i++) s[i] = b.readInt16LE(ds + i * 2) / 32768;
  return s;
}
const samples = readWav(SESSION);
const pf = JSON.parse(readFileSync(PRAAT, "utf8")).files.find((f) => f.path === SESSION);

// Decode once (detector + tracker are median-independent).
// Full production chain since 2026-07-20: persistent-peak notch +
// ghost-voicing veto + harmonic voicing guard (harness parity pass —
// earlier displayed-accuracy numbers predate all three).
const ac = createBoersmaAC(SR, N), pt = createPathTracker();
const notch = createNoiseNotch(SR);
const guard = createHarmonicVoicingGuard();
const delayLine = [];
const buf = new Float32Array(N);
const decoded = [];
for (let i = 0; i + HOP <= samples.length; i += HOP) {
  const chunk = Float32Array.from(samples.subarray(i, i + HOP));
  notch.process(chunk);
  buf.copyWithin(0, HOP, N); buf.set(chunk, N - HOP);
  delayLine.push(Float32Array.from(buf));
  if (delayLine.length > pt.config.lookback + 1) delayLine.shift();
  let v = pt.emit(ac.candidates(buf));
  if (v > 0 && isNearNotch(v, notch.activeFreqs())) v = null;
  if (v > 0 && !guard.check(delayLine[0], v, SR)) v = null;
  if (v !== undefined) decoded.push(v ?? 0);
}
decoded.push(...pt.flush().map((v) => v ?? 0));

function displaySeries(K) {
  const sm = [], gate = createPaintGate(), out = [];
  for (const p of decoded) {
    if (!(p > 0)) { sm.length = 0; gate.resetSegment(); out.push(0); continue; }
    const m = pushAndMedianPitch(sm, p, K);
    out.push(gate.push(m) ? m : 0);
  }
  return out;
}

const hopMs = HOP / SR * 1000;
function scoreAt(series, offMs, tol, band) {
  let cor = 0, tot = 0;
  for (let i = 0; i < series.length; i++) {
    if (!(series[i] > 0)) continue;
    const idx = Math.round(((i + 1) * hopMs - offMs) / 1000 / pf.dt - pf.t0 / pf.dt);
    if (idx < 0 || idx >= pf.f0.length) continue;
    const t = pf.f0[idx];
    if (band && !(t >= band[0] && t < band[1])) continue;
    if (!(t > 0)) continue;
    tot++;
    if (Math.abs(series[i] / t - 1) < tol) cor++;
  }
  return tot ? 100 * cor / tot : 0;
}

const FLIP_TOL = 0.2;
function flipPct(series) {
  let flips = 0, pairs = 0;
  for (let i = 1; i < series.length; i++) {
    if (!(series[i] > 0) || !(series[i - 1] > 0)) continue;
    const r = series[i] > series[i - 1] ? series[i] / series[i - 1] : series[i - 1] / series[i];
    pairs++;
    if (Math.abs(r - 2) < FLIP_TOL) flips++;
  }
  return pairs ? +(100 * flips / pairs).toFixed(2) : null;
}

function spikeCount(series) {
  let n = 0;
  for (let i = 1; i < series.length - 1; i++) {
    const a = series[i - 1], b = series[i], c = series[i + 1];
    if (!(a > 0) || !(b > 0) || !(c > 0)) continue;
    const ra = b > a ? b / a : a / b, rc = b > c ? b / c : c / b;
    if (ra >= 1.4 && rc >= 1.4) n++;
  }
  return n;
}

console.log(`decoded hops: ${decoded.length} (${(decoded.length * hopMs / 1000).toFixed(0)} s)`);
console.log("K | bestOff(ms) | band80-110@5% | band@10% | overall@5% | flip% | spikes");
for (const K of [1, 3, 5]) {
  const s = displaySeries(K);
  let best = { off: 0, acc: 0 };
  for (let off = 0; off <= 250; off += 12.5) {
    const a = scoreAt(s, off, 0.05, [80, 110]);
    if (a > best.acc) best = { off, acc: a };
  }
  console.log(
    `${K} | ${String(best.off).padStart(6)} | ${best.acc.toFixed(1).padStart(8)} | ` +
    `${scoreAt(s, best.off, 0.10, [80, 110]).toFixed(1).padStart(6)} | ` +
    `${scoreAt(s, best.off, 0.05, null).toFixed(1).padStart(6)} | ` +
    `${String(flipPct(s)).padStart(5)} | ${spikeCount(s)}`,
  );
}
