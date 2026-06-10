// pitch-spike-measure.js — Quantify user-visible pitch spikes for the
// L=2 vs L=4 path-tracker decision (live report 2026-06-10: "sometimes
// when talking the pitch detection will spike way up or way down").
//
// Runs the production AC pipeline (tuned config) over the 2026-05-26
// session at both lookback values, applies the production display
// smoothing (5-frame rolling median, pitchSmoothing.js), and counts
// SPIKE EVENTS: contiguous runs of displayed pitch deviating >= 6
// semitones from the 1-second local median, lasting <= 12 frames
// (300 ms) — i.e. transient excursions a user sees as a spike, not
// genuine register moves. Praat's contour is scored identically as the
// reference floor.
//
// Usage: node scripts/pitch-spike-measure.js

import { readFileSync } from "node:fs";
import { createBoersmaAC, createPathTracker, BOERSMA_FRAME_LENGTH_16K } from "../src/dsp/boersma-ac.js";
import { pushAndMedianPitch, PITCH_SMOOTH_LEN } from "../src/audio/pitchSmoothing.js";

const SR = 16000, HOP = 400, N = BOERSMA_FRAME_LENGTH_16K;
const SESSION = "C:/Coding Projects/Calliope/sessions/2026-05-26/session.wav";
const PRAAT = "build/pitch-compare/praat-contours.json";

function readWav(p) {
  const buf = readFileSync(p);
  let off = 12, dataStart = 0, dataSize = 0;
  while (off < buf.length - 8) {
    const id = buf.toString("ascii", off, off + 4);
    const size = buf.readUInt32LE(off + 4);
    if (id === "data") { dataStart = off + 8; dataSize = size; break; }
    off += 8 + size;
  }
  const n = Math.floor(dataSize / 2);
  const s = new Float32Array(n);
  for (let i = 0; i < n; i++) s[i] = buf.readInt16LE(dataStart + i * 2) / 32768;
  return s;
}

// Spike events on a displayed-pitch series (hop-indexed, 0 = no pitch).
function spikeEvents(series, hopMs) {
  const winFrames = Math.round(1000 / hopMs); // 1 s local median window
  const events = [];
  let run = 0;
  for (let i = 0; i < series.length; i++) {
    if (!(series[i] > 0)) { if (run > 0 && run <= 12) events.push(run); run = 0; continue; }
    const lo = Math.max(0, i - winFrames), hi = Math.min(series.length, i + winFrames);
    const local = [];
    for (let j = lo; j < hi; j++) if (series[j] > 0) local.push(series[j]);
    local.sort((a, b) => a - b);
    const med = local[Math.floor(local.length / 2)];
    const dev = Math.abs(12 * Math.log2(series[i] / med));
    if (dev >= 6) run++;
    else { if (run > 0 && run <= 12) events.push(run); run = 0; }
  }
  const voicedMin = series.filter((v) => v > 0).length * hopMs / 60000;
  return { events: events.length, perMin: +(events.length / voicedMin).toFixed(2) };
}

const samples = readWav(SESSION);
const hopMs = HOP / SR * 1000;

for (const L of [2, 4, 6]) {
  const ac = createBoersmaAC(SR, N);
  const pt = createPathTracker({ lookback: L });
  const buf = new Float32Array(N);
  const decoded = [];
  for (let i = 0; i + HOP <= samples.length; i += HOP) {
    buf.copyWithin(0, HOP, N);
    buf.set(samples.subarray(i, i + HOP), N - HOP);
    const v = pt.emit(ac.candidates(buf));
    if (v !== undefined) decoded.push(v ?? 0);
  }
  decoded.push(...pt.flush().map((v) => v ?? 0));
  // Production display smoothing: median-5, buffer reset on gaps > hold.
  const smoothBuf = [];
  const displayed = decoded.map((p) => {
    if (!(p > 0)) { smoothBuf.length = 0; return 0; }
    return pushAndMedianPitch(smoothBuf, p, PITCH_SMOOTH_LEN);
  });
  const s = spikeEvents(displayed, hopMs);
  console.log(`L=${L}: ${s.events} spike events (${s.perMin}/voiced-min)`);
}

// Praat reference floor on the same audio (10 ms grid → ~25 ms equiv).
const pf = JSON.parse(readFileSync(PRAAT, "utf8")).files.find((f) => f.path === SESSION);
const praat = [];
for (let i = 0; i < pf.f0.length; i += Math.round(25 / (pf.dt * 1000))) praat.push(pf.f0[i] || 0);
const ps = spikeEvents(praat, 25);
console.log(`Praat reference: ${ps.events} spike events (${ps.perMin}/voiced-min)`);
