// paint-gate-glide-validate.js — Before/after validation for windowing
// the paint gate's off-level candidate run (2026-07-19). The unwindowed
// offRun accumulated every value since going off-level, so a fast glide
// (≥ EXCURSION_SEMI spanned mid-run) permanently inflated the min–max
// spread and the sustained-new-level accept could never fire until the
// next unvoiced gap — the trace went blank mid-siren and stayed blank
// while holding the target note.
//
// Measures the CURRENT src/audio/pitchPaintGate.js module (run once
// before the fix for baseline, once after; diff the outputs):
//
// 1. Real-session excursion metrics (2026-05-26, production display
//    chain: detector + tracker + median-PITCH_SMOOTH_LEN + real paint
//    gate): painted frames, connected pairs ≥ 9 st (visible vertical
//    lines), octave-class pairs ≥ 12 st, and 80–110 Hz band correct%
//    at best alignment. These are the metrics the excursion break was
//    tuned on (pitch-excursion-break-2026-06-10.md) — they must not
//    regress.
// 2. Synthetic gate-level scenarios (sequences fed straight to
//    createPaintGate, i.e. post-median values):
//    - fast glides (octave in 4/8/12 frames) then a held target note:
//      recovery latency + suppressed-hold-frame count (the bug).
//    - harmonic-lock bursts (median run 4, p90 11 frames per the 06-10
//      data): octave-class painted frames must stay 0.
//    - instant genuine register jump: accept latency must stay
//      EXCURSION_SUSTAIN.
//
// Usage: node scripts/paint-gate-glide-validate.js [--skip-session]

import { readFileSync } from "node:fs";
import { createBoersmaAC, createPathTracker, BOERSMA_FRAME_LENGTH_16K as N } from "../src/dsp/boersma-ac.js";
import { pushAndMedianPitch, PITCH_SMOOTH_LEN } from "../src/audio/pitchSmoothing.js";
import { createPaintGate, EXCURSION_SEMI, EXCURSION_SUSTAIN } from "../src/audio/pitchPaintGate.js";

const SR = 16000, HOP = 400;
const SESSION = "C:/Coding Projects/Calliope/sessions/2026-05-26/session.wav";
const PRAAT = "build/pitch-compare/praat-contours.json";
const stt = (a, b) => 12 * Math.log2(a / b);

// ---------------------------------------------------------------- synthetic

function runGate(seq) {
  const g = createPaintGate();
  return seq.map((hz) => (hz > 0 ? g.push(hz) : (g.resetSegment(), false)));
}

console.log("=== synthetic gate-level scenarios ===");
console.log(`(EXCURSION_SEMI ${EXCURSION_SEMI}, EXCURSION_SUSTAIN ${EXCURSION_SUSTAIN})\n`);

// Fast glide → held target. Establish 110, glide up SPAN semitones in G
// frames, hold the target for 80 frames (~2 s).
//
// Span matters: for a 12-st glide the off-level values (≥ EXCURSION_SEMI
// from the stale level) span only 12 − 9.5 = 2.5 st, so even the
// unwindowed offRun stays internally consistent and accepts. The
// permanent-suppression bug needs the off-level portion itself to span
// ≥ EXCURSION_SEMI — i.e. glides ≥ ~19 st (1.6 octaves; a full siren).
for (const [SPAN, G] of [[12, 4], [12, 8], [19, 8], [19, 16], [24, 16], [24, 24]]) {
  const target = 110 * 2 ** (SPAN / 12);
  const seq = [];
  for (let i = 0; i < 30; i++) seq.push(110);
  for (let i = 1; i <= G; i++) seq.push(110 * 2 ** (SPAN * i / G / 12));
  const holdStart = seq.length;
  for (let i = 0; i < 80; i++) seq.push(target);
  const out = runGate(seq);
  let firstPaint = -1, suppressed = 0;
  for (let i = holdStart; i < seq.length; i++) {
    if (out[i] && firstPaint === -1) firstPaint = i - holdStart;
    if (!out[i]) suppressed++;
  }
  console.log(
    `glide +${SPAN} st in ${G} frames (${G * 25} ms), hold 2 s: ` +
    (firstPaint === -1
      ? `NEVER RECOVERS (all ${suppressed} hold frames suppressed)`
      : `recovers ${firstPaint} frames (${firstPaint * 25} ms) into hold, ${suppressed} hold frames suppressed`),
  );
}

// Harmonic-lock bursts: 100 Hz established, lock at 380 Hz for K frames,
// return to 100. No octave-class value may paint.
console.log("");
for (const K of [4, 8, 11, 15]) {
  const seq = [];
  for (let i = 0; i < 30; i++) seq.push(100);
  for (let i = 0; i < K; i++) seq.push(380);
  for (let i = 0; i < 30; i++) seq.push(100);
  const out = runGate(seq);
  let octPainted = 0;
  seq.forEach((hz, i) => { if (out[i] && Math.abs(stt(hz, 100)) >= EXCURSION_SEMI) octPainted++; });
  console.log(`harmonic lock ${K} frames @380 Hz: octave-class painted ${octPainted} ${octPainted === 0 ? "(ok)" : "(REGRESSION)"}`);
}

// Instant genuine register change: 110 established, jump to 220, hold.
{
  const seq = [];
  for (let i = 0; i < 30; i++) seq.push(110);
  const jumpAt = seq.length;
  for (let i = 0; i < 40; i++) seq.push(220);
  const out = runGate(seq);
  let firstPaint = -1;
  for (let i = jumpAt; i < seq.length; i++) if (out[i]) { firstPaint = i - jumpAt; break; }
  console.log(`\ninstant 110→220 jump: accepted after ${firstPaint + 1} frames (expect ${EXCURSION_SUSTAIN})`);
}

// ---------------------------------------------------------------- session

if (process.argv.includes("--skip-session")) process.exit(0);

console.log("\n=== 2026-05-26 session, production display chain ===");
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

const ac = createBoersmaAC(SR, N), pt = createPathTracker();
const buf = new Float32Array(N);
const decoded = [];
for (let i = 0; i + HOP <= samples.length; i += HOP) {
  buf.copyWithin(0, HOP, N); buf.set(samples.subarray(i, i + HOP), N - HOP);
  const v = pt.emit(ac.candidates(buf));
  if (v !== undefined) decoded.push(v ?? 0);
}
decoded.push(...pt.flush().map((v) => v ?? 0));

const sm = [], gate = createPaintGate(), displayed = [];
for (const p of decoded) {
  if (!(p > 0)) { sm.length = 0; gate.resetSegment(); displayed.push(0); continue; }
  const m = pushAndMedianPitch(sm, p, PITCH_SMOOTH_LEN);
  displayed.push(gate.push(m) ? m : 0);
}

let painted = 0, conn9 = 0, oct12 = 0, prev = null;
for (const d of displayed) {
  if (d > 0) {
    painted++;
    if (prev !== null && prev > 0) {
      const st = Math.abs(stt(d, prev));
      if (st >= 9) conn9++;
      if (st >= 12) oct12++;
    }
  }
  prev = d;
}

const hopMs = HOP / SR * 1000;
function bandAt(offMs) {
  let cor = 0, tot = 0;
  for (let i = 0; i < displayed.length; i++) {
    if (!(displayed[i] > 0)) continue;
    const idx = Math.round(((i + 1) * hopMs - offMs) / 1000 / pf.dt - pf.t0 / pf.dt);
    if (idx < 0 || idx >= pf.f0.length) continue;
    const t = pf.f0[idx];
    if (!(t >= 80 && t < 110)) continue;
    tot++;
    if (Math.abs(displayed[i] / t - 1) < 0.05) cor++;
  }
  return tot ? 100 * cor / tot : 0;
}
let best = { off: 0, acc: 0 };
for (let off = 0; off <= 250; off += 12.5) {
  const a = bandAt(off);
  if (a > best.acc) best = { off, acc: a };
}

console.log(`painted ${painted}  connPairs>=9st ${conn9}  octaveClassPairs>=12st ${oct12}`);
console.log(`band 80-110 correct ${best.acc.toFixed(1)}% @ best offset ${best.off} ms`);
