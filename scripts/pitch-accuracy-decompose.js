// pitch-accuracy-decompose.js — What is the "19% not-correct" in the
// session 80-110 Hz band actually made of, and is the 81% display
// metric real or a measurement artifact? (2026-06-10, before deciding
// whether detector accuracy has real headroom worth tuning.)
//
// Reconstructs the production display series (AC + tracker + median-5 +
// pitchPaintGate) over the 2026-05-26 session, then:
//   1. Sweeps the attribution offset to find best Praat alignment — the
//      5-frame median adds lag the excursion sweep's fixed offset didn't
//      account for; if accuracy peaks at a larger offset, the 81% was an
//      alignment artifact, not detector error.
//   2. At best alignment, decomposes non-correct frames into octave-up,
//      octave-down, near-miss (5-12%), gross-other, and reports correct
//      at both 5% and 10% tolerance.
// Also scores the RAW decoded pitch (pre-median, pre-gate) the same way,
// to separate detector error from display-smoothing error.
//
// Usage: node scripts/pitch-accuracy-decompose.js

import { readFileSync } from "node:fs";
import { createBoersmaAC, createPathTracker, createHarmonicVoicingGuard, BOERSMA_FRAME_LENGTH_16K as N } from "../src/dsp/boersma-ac.js";
import { createNoiseNotch, isNearNotch } from "../src/dsp/noise-notch.js";
import { pushAndMedianPitch, PITCH_SMOOTH_LEN } from "../src/audio/pitchSmoothing.js";
import { createPaintGate } from "../src/audio/pitchPaintGate.js";

const SR = 16000, HOP = 400;
const SESSION = "C:/Coding Projects/Calliope/sessions/2026-05-26/session.wav";
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

// displayed series (median-5 + paint gate)
const sm = []; const gate = createPaintGate(); const displayed = [];
for (const p of decoded) {
  if (!(p > 0)) { sm.length = 0; gate.resetSegment(); displayed.push(0); continue; }
  const m = pushAndMedianPitch(sm, p, PITCH_SMOOTH_LEN);
  displayed.push(gate.push(m) ? m : 0);
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

console.log("=== attribution-offset sweep, displayed series, 80-110 band, 5% tol ===");
let best = { off: 0, acc: 0 };
for (let off = 0; off <= 200; off += 12.5) {
  const a = scoreAt(displayed, off, 0.05, [80, 110]);
  if (a > best.acc) best = { off, acc: a };
  console.log(`  offset ${off.toFixed(0).padStart(3)} ms: ${a.toFixed(1)}%`);
}
console.log(`  best alignment: offset ${best.off} ms -> ${best.acc.toFixed(1)}%\n`);

const OFF = best.off;
console.log("=== at best alignment, 80-110 band ===");
console.log(`displayed  correct@5%  ${scoreAt(displayed, OFF, 0.05, [80, 110]).toFixed(1)}   correct@10%  ${scoreAt(displayed, OFF, 0.10, [80, 110]).toFixed(1)}`);
console.log(`raw decoded correct@5% ${scoreAt(decoded, OFF, 0.05, [80, 110]).toFixed(1)}   correct@10%  ${scoreAt(decoded, OFF, 0.10, [80, 110]).toFixed(1)}`);

// decomposition of non-correct (displayed, best offset, 80-110)
let cor = 0, up = 0, down = 0, near = 0, gross = 0, tot = 0;
for (let i = 0; i < displayed.length; i++) {
  if (!(displayed[i] > 0)) continue;
  const idx = Math.round(((i + 1) * hopMs - OFF) / 1000 / pf.dt - pf.t0 / pf.dt);
  if (idx < 0 || idx >= pf.f0.length) continue;
  const t = pf.f0[idx];
  if (!(t >= 80 && t < 110)) continue;
  tot++;
  const r = displayed[i] / t;
  if (Math.abs(r - 1) < 0.05) cor++;
  else if (Math.abs(r - 1) < 0.12) near++;
  else if (r >= 1.5) { const nr = Math.round(r); (nr >= 2 && Math.abs(r - nr) / nr < 0.1) ? up++ : gross++; }
  else if (r <= 1 / 1.5) { const nr = Math.round(1 / r); (nr >= 2 && Math.abs(1 / r - nr) / nr < 0.1) ? down++ : gross++; }
  else gross++;
}
const p = (x) => `${(100 * x / tot).toFixed(1)}%`;
console.log(`\nnon-correct decomposition (n=${tot}):`);
console.log(`  correct(5%)   ${p(cor)}`);
console.log(`  near-miss(5-12%) ${p(near)}  <- small errors, not gross`);
console.log(`  octave-up     ${p(up)}`);
console.log(`  octave-down   ${p(down)}`);
console.log(`  gross-other   ${p(gross)}`);
