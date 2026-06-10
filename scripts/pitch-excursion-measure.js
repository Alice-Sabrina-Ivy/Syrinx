// pitch-excursion-measure.js — Why do octave excursions still paint as
// connected near-vertical lines after the PR #84 jump break? (Live
// report 2026-06-10: "hello testing 1 2 3" @ 90-120 Hz spiking to
// ~380 Hz.) Reconstructs the EXACT production display pipeline (AC +
// path tracker + median-5 + onset-confirm + consecutive-delta jump
// break) over the 2026-05-26 session and instruments the excursions.
//
// Hypotheses:
//   H1 (ramp): median-5 turns an instant octave jump into a multi-frame
//      ramp whose consecutive steps are each < JUMP_BREAK_SEMI (12 st),
//      so the consecutive-delta break never fires and the ramp paints
//      connected. → fix: break against the established LEVEL, not the
//      previous frame.
//   Also characterizes normal-speech deviation-from-established-level
//      vs excursion deviation, to pick an EXCURSION_SEMI threshold that
//      separates prosody from harmonic locks.
//
// Usage: node scripts/pitch-excursion-measure.js

import { readFileSync } from "node:fs";
import { createBoersmaAC, createPathTracker, BOERSMA_FRAME_LENGTH_16K } from "../src/dsp/boersma-ac.js";
import { pushAndMedianPitch, PITCH_SMOOTH_LEN } from "../src/audio/pitchSmoothing.js";

const SR = 16000, HOP = 400, N = BOERSMA_FRAME_LENGTH_16K;
const ONSET_CONFIRM = 3, JUMP_BREAK_SEMI = 12;
const SESSION = "C:/Coding Projects/Calliope/sessions/2026-05-26/session.wav";

function readWav(p) {
  const b = readFileSync(p);
  let o = 12, ds = 0, dz = 0;
  while (o < b.length - 8) {
    const id = b.toString("ascii", o, o + 4), sz = b.readUInt32LE(o + 4);
    if (id === "data") { ds = o + 8; dz = sz; break; }
    o += 8 + sz;
  }
  const s = new Float32Array(Math.floor(dz / 2));
  for (let i = 0; i < s.length; i++) s[i] = b.readInt16LE(ds + i * 2) / 32768;
  return s;
}
const st = (a, b) => 12 * Math.log2(a / b);
function median(a) { const s = [...a].sort((x, y) => x - y); return s[Math.floor(s.length / 2)]; }

const samples = readWav(SESSION);
const ac = createBoersmaAC(SR, N), pt = createPathTracker();
const buf = new Float32Array(N);
const decoded = [];
for (let i = 0; i + HOP <= samples.length; i += HOP) {
  buf.copyWithin(0, HOP, N);
  buf.set(samples.subarray(i, i + HOP), N - HOP);
  const v = pt.emit(ac.candidates(buf));
  if (v !== undefined) decoded.push(v ?? 0);
}
decoded.push(...pt.flush().map((v) => v ?? 0));

// Reconstruct the production display series (current logic).
const sm = [];
let streak = 0, lastShown = null;
const displayed = []; // painted pitch or 0
for (const p of decoded) {
  if (!(p > 0)) { sm.length = 0; streak = 0; displayed.push(0); continue; }
  const m = pushAndMedianPitch(sm, p, PITCH_SMOOTH_LEN);
  if (lastShown !== null && Math.abs(st(m, lastShown)) >= JUMP_BREAK_SEMI) { streak = 1; lastShown = null; }
  else streak++;
  const paint = streak >= ONSET_CONFIRM;
  if (paint) { lastShown = m; displayed.push(m); } else displayed.push(0);
}

// Count CONNECTED excursions: consecutive painted pairs whose delta is
// >= 9 st (a connecting near-vertical line on the canvas), and classify
// the transition as instant (one step >=12 st) vs ramped (climb to an
// octave-class peak via steps each < 12 st).
let connectedPairs = 0, instantPairs = 0;
let prevP = null;
for (const d of displayed) {
  if (d > 0 && prevP !== null && prevP > 0) {
    const j = Math.abs(st(d, prevP));
    if (j >= 9) { connectedPairs++; if (j >= JUMP_BREAK_SEMI) instantPairs++; }
  }
  prevP = d;
}
console.log(`painted frames: ${displayed.filter((d) => d > 0).length}`);
console.log(`connected painted pairs >=9 st apart: ${connectedPairs}  (of which >=12 st / would-trip-break: ${instantPairs})`);
console.log(`=> ${connectedPairs - instantPairs} connecting steps are <12 st — RAMP frames the consecutive-delta break can't catch\n`);

// Deviation of each painted frame from the established level (median of
// last 15 painted values). Separate normal frames from octave-class.
const ring = [];
const devNormal = [], devExcursion = [];
for (const d of displayed) {
  if (!(d > 0)) continue;
  if (ring.length >= 5) {
    const est = median(ring);
    const dev = Math.abs(st(d, est));
    (dev >= 9 ? devExcursion : devNormal).push(dev);
  }
  ring.push(d);
  if (ring.length > 15) ring.shift();
}
function pct(a, p) { const s = [...a].sort((x, y) => x - y); return s[Math.floor(p * s.length)] ?? NaN; }
console.log(`deviation-from-established (st), NORMAL (<9): p50=${pct(devNormal, 0.5).toFixed(1)} p95=${pct(devNormal, 0.95).toFixed(1)} p99=${pct(devNormal, 0.99).toFixed(1)} max=${Math.max(...devNormal).toFixed(1)} (n=${devNormal.length})`);
console.log(`deviation-from-established (st), EXCURSION (>=9): n=${devExcursion.length} p50=${pct(devExcursion, 0.5).toFixed(1)} — these are the harmonic locks`);
console.log(`\nGap between prosody p99 (${pct(devNormal, 0.99).toFixed(1)} st) and excursion floor (9 st) sets the EXCURSION_SEMI threshold.`);
