// pitch-excursion-fix-sweep.js — Design the established-level excursion
// break (replaces the defeated consecutive-delta jump break). Decodes
// the 2026-05-26 session once, then sweeps the new display rule's two
// knobs cheaply.
//
// Rule: track `established` = median of the last LEVEL_RING painted
// pitches. A framePitched value `m` is:
//   - ON-LEVEL  (|st(m, established)| < EXCURSION_SEMI): paints after the
//     normal ONSET_CONFIRM streak. Normal prosody (≤9 st from level).
//   - OFF-LEVEL (>= EXCURSION_SEMI): an octave-class jump. Suppressed
//     (rendered as a gap) UNLESS it sustains a consistent new level for
//     EXCURSION_SUSTAIN frames — then accepted (genuine register change)
//     and the level ring is reseeded there. Brief harmonic locks never
//     reach the sustain count, so they never paint → no connecting ramp.
//
// Metrics per cell:
//   connPairs  — painted consecutive pairs >= 9 st apart (the visible
//                vertical lines; target ~0)
//   painted    — painted-frame count (over-suppression guard; current
//                production paints 73523)
//   band80-110 — correct% vs Praat in the user's register (accuracy guard)
//
// Usage: node scripts/pitch-excursion-fix-sweep.js

import { readFileSync } from "node:fs";
import { createBoersmaAC, createPathTracker, BOERSMA_FRAME_LENGTH_16K } from "../src/dsp/boersma-ac.js";
import { pushAndMedianPitch, PITCH_SMOOTH_LEN } from "../src/audio/pitchSmoothing.js";

const SR = 16000, HOP = 400, N = BOERSMA_FRAME_LENGTH_16K, ONSET_CONFIRM = 3, LEVEL_RING = 15;
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
const stt = (a, b) => 12 * Math.log2(a / b);
const median = (a) => { const s = [...a].sort((x, y) => x - y); return s[Math.floor(s.length / 2)]; };

const samples = readWav(SESSION);
const pf = JSON.parse(readFileSync(PRAAT, "utf8")).files.find((f) => f.path === SESSION);

console.log("Decoding session once …");
const ac = createBoersmaAC(SR, N), pt = createPathTracker();
const buf = new Float32Array(N);
const decoded = [];
for (let i = 0; i + HOP <= samples.length; i += HOP) {
  buf.copyWithin(0, HOP, N); buf.set(samples.subarray(i, i + HOP), N - HOP);
  const v = pt.emit(ac.candidates(buf));
  if (v !== undefined) decoded.push(v ?? 0);
}
decoded.push(...pt.flush().map((v) => v ?? 0));
const hopMs = HOP / SR * 1000;
const attrOff = (N / 2) / SR * 1000 + 2 * hopMs; // window center + L=2 decode

function runDisplay(EXCURSION_SEMI, EXCURSION_SUSTAIN) {
  const sm = [];
  const ring = [];
  let onStreak = 0;
  let offRun = [];
  const displayed = [];
  for (const p of decoded) {
    if (!(p > 0)) { sm.length = 0; onStreak = 0; offRun = []; displayed.push(0); continue; }
    const m = pushAndMedianPitch(sm, p, PITCH_SMOOTH_LEN);
    const est = ring.length >= 5 ? median(ring) : null;
    const onLevel = est === null || Math.abs(stt(m, est)) < EXCURSION_SEMI;
    let paint = false;
    if (onLevel) {
      onStreak++; offRun = [];
      paint = onStreak >= ONSET_CONFIRM;
    } else {
      offRun.push(m);
      const spread = offRun.length > 1 ? Math.abs(stt(Math.max(...offRun), Math.min(...offRun))) : 0;
      if (offRun.length >= EXCURSION_SUSTAIN && spread < EXCURSION_SEMI) {
        ring.length = 0; for (const v of offRun.slice(-LEVEL_RING)) ring.push(v);
        onStreak = offRun.length; offRun = []; paint = true;
      } else { onStreak = 0; paint = false; }
    }
    if (paint) { ring.push(m); if (ring.length > LEVEL_RING) ring.shift(); displayed.push(m); }
    else displayed.push(0);
  }
  return displayed;
}

function metrics(displayed) {
  let conn = 0, painted = 0, prev = null;
  for (const d of displayed) {
    if (d > 0) painted++;
    if (d > 0 && prev !== null && prev > 0 && Math.abs(stt(d, prev)) >= 9) conn++;
    prev = d;
  }
  let cor = 0, tot = 0;
  for (let i = 0; i < displayed.length; i++) {
    if (!(displayed[i] > 0)) continue;
    const idx = Math.round(((i + 1) * hopMs - attrOff) / 1000 / pf.dt - pf.t0 / pf.dt);
    if (idx < 0 || idx >= pf.f0.length) continue;
    const t = pf.f0[idx];
    if (!(t >= 80 && t < 110)) continue;
    tot++;
    if (Math.abs(displayed[i] / t - 1) < 0.05) cor++;
  }
  return { conn, painted, band: tot ? (100 * cor / tot).toFixed(1) : "-" };
}

// Current production (consecutive-delta break) for reference.
{
  const sm = []; let streak = 0, lastShown = null;
  const cur = [];
  for (const p of decoded) {
    if (!(p > 0)) { sm.length = 0; streak = 0; cur.push(0); continue; }
    const m = pushAndMedianPitch(sm, p, PITCH_SMOOTH_LEN);
    if (lastShown !== null && Math.abs(stt(m, lastShown)) >= 12) { streak = 1; lastShown = null; }
    else streak++;
    if (streak >= ONSET_CONFIRM) { lastShown = m; cur.push(m); } else cur.push(0);
  }
  const x = metrics(cur);
  console.log(`current (consecutive-delta @12st): connPairs ${x.conn}  painted ${x.painted}  band80-110 ${x.band}%\n`);
}

console.log("established-level break sweep (EXCURSION_SEMI × EXCURSION_SUSTAIN):");
for (const semi of [9.5, 10, 11]) {
  for (const sustain of [8, 12, 16, 24]) {
    const x = metrics(runDisplay(semi, sustain));
    console.log(`  semi=${semi} sustain=${sustain} (${(sustain * hopMs).toFixed(0)}ms): connPairs ${String(x.conn).padStart(4)}  painted ${x.painted}  band80-110 ${x.band}%`);
  }
}
