// vocal-weight-gate-scale-validate.js — Validation for the 2026-06-10
// vocal-weight accuracy pass (steps 1+2 of the ranked plan).
//
// On the 2026-05-26 user session (real voice + real noise), simulates
// the production CPP pipeline per 25 ms hop and compares:
//
//   Gate (step 1): OLD aggregator voicing = silence-gate approximation
//   (!isQuiet ≈ RMS ≥ -50 dB OR decoded pitch present, AND-gate
//   inverted) vs NEW = confirmed decoded pitch present. Metric:
//   contamination — % of gate-passing frames where the Praat reference
//   says unvoiced (i.e., breath/noise/fricative material feeding the
//   gauge).
//
//   Scale (step 2): OLD sliding-window z-score (30 s FIFO, recomputed
//   per emit) vs NEW locked-baseline + fixed dB span. Metric:
//   mean-reversion — correlation between gauge position and the raw
//   aggregate CPP over the session. A faithful gauge tracks CPP
//   (|r| → 1); a mean-reverting one decorrelates as the window
//   absorbs sustained changes. Also reports the aggregate-CPP
//   p5/p50/p95 spread (anchors the fixed-span choice).
//
// Usage: node scripts/vocal-weight-gate-scale-validate.js

import { readFileSync } from "node:fs";
import { createBoersmaAC, createPathTracker, BOERSMA_FRAME_LENGTH_16K } from "../src/dsp/boersma-ac.js";
import { computeCPP, resetCppState } from "../src/dsp/cpp.js";
import { VocalWeightAggregator } from "../src/audio/vocal-weight-aggregator.js";

const SR = 16000, HOP = 400, WINDOW = 800; // 25 ms hop, 50 ms CPP window
const SESSION = "C:/Coding Projects/Calliope/sessions/2026-05-26/session.wav";
const PRAAT = "build/pitch-compare/praat-contours.json";

function readWav(p) {
  const b = readFileSync(p);
  let o = 12, ds = 0, dz = 0;
  while (o < b.length - 8) {
    const id = b.toString("ascii", o, o + 4);
    const sz = b.readUInt32LE(o + 4);
    if (id === "data") { ds = o + 8; dz = sz; break; }
    o += 8 + sz;
  }
  const s = new Float32Array(Math.floor(dz / 2));
  for (let i = 0; i < s.length; i++) s[i] = b.readInt16LE(ds + i * 2) / 32768;
  return s;
}

const samples = readWav(SESSION);
const pf = JSON.parse(readFileSync(PRAAT, "utf8")).files.find((f) => f.path === SESSION);
const praatVoicedAt = (tMs) => {
  const idx = Math.round((tMs / 1000 - pf.t0) / pf.dt);
  return idx >= 0 && idx < pf.f0.length && pf.f0[idx] > 0;
};

console.log("Simulating production pipeline over the session …");
resetCppState();
const ac = createBoersmaAC(SR, BOERSMA_FRAME_LENGTH_16K);
const pt = createPathTracker();
const acBuf = new Float32Array(BOERSMA_FRAME_LENGTH_16K);
const frames = []; // { tMs, rmsDb, pitch, cpp, praatVoiced }
const pend = [];
const hopMs = HOP / SR * 1000;
for (let i = 0, n = 0; i + HOP <= samples.length; i += HOP, n++) {
  const chunk = samples.subarray(i, i + HOP);
  acBuf.copyWithin(0, HOP, BOERSMA_FRAME_LENGTH_16K);
  acBuf.set(chunk, BOERSMA_FRAME_LENGTH_16K - HOP);
  const decoded = pt.emit(ac.candidates(acBuf));
  let sum = 0;
  for (let k = 0; k < HOP; k++) sum += chunk[k] * chunk[k];
  const rmsDb = 10 * Math.log10(sum / HOP + 1e-12);
  const wStart = Math.max(0, i + HOP - WINDOW);
  const cpp = i + HOP >= WINDOW ? computeCPP(samples.subarray(wStart, i + HOP), SR) : null;
  pend.push({ tMs: (n + 1) * hopMs, rmsDb, cpp });
  if (decoded !== undefined && pend.length > pt.config.lookback) {
    const f = pend.shift();
    f.pitch = decoded ?? 0;
    f.praatVoiced = praatVoicedAt(f.tMs - (BOERSMA_FRAME_LENGTH_16K / 2) / SR * 1000);
    frames.push(f);
  }
}
console.log(`${frames.length} frames`);

// ---- Step 1: gate contamination ----
for (const [name, gateFn] of [
  ["old gate (!isQuiet: rms>=-50dB OR pitch)", (f) => f.rmsDb >= -50 || f.pitch > 0],
  ["new gate (confirmed pitch)", (f) => f.pitch > 0],
]) {
  const passing = frames.filter(gateFn);
  const contaminated = passing.filter((f) => !f.praatVoiced).length;
  console.log(
    `${name}: ${passing.length} frames pass, ` +
    `${(100 * contaminated / passing.length).toFixed(1)}% Praat-unvoiced (contamination)`,
  );
}

// ---- Step 2: scale behavior on pitch-gated aggregates ----
function emits(gateFn) {
  const agg = new VocalWeightAggregator();
  const out = [];
  let lastT = -1;
  for (const f of frames) {
    const a = agg.push({ time: f.tMs, cpp: f.cpp, voiced: gateFn(f) });
    if (a && a.time !== lastT) { out.push(a); lastT = a.time; }
  }
  return out;
}
const ems = emits((f) => f.pitch > 0);
const cpps = ems.map((e) => e.cpp).sort((a, b) => a - b);
const q = (p) => cpps[Math.floor(p * cpps.length)];
console.log(`\n${ems.length} aggregate emits (pitch-gated). CPP p5=${q(0.05).toFixed(2)} p50=${q(0.5).toFixed(2)} p95=${q(0.95).toFixed(2)} dB  (p95-p5 span ${(q(0.95) - q(0.05)).toFixed(2)} dB)`);

function pearson(xs, ys) {
  const n = xs.length, mx = xs.reduce((a, b) => a + b) / n, my = ys.reduce((a, b) => a + b) / n;
  let num = 0, dx = 0, dy = 0;
  for (let i = 0; i < n; i++) { num += (xs[i] - mx) * (ys[i] - my); dx += (xs[i] - mx) ** 2; dy += (ys[i] - my) ** 2; }
  return num / Math.sqrt(dx * dy);
}

// OLD: sliding 120-emit window μ AND σ (current production). NEW: freeze
// μ and σ at the moment the baseline window first fills, hold both for
// the rest of the session. Gauge position = ((cpp-μ)/σ + 2)/4 (±2σ span)
// in both — the ONLY difference is whether μ,σ keep sliding.
//
// gauge-vs-CPP fidelity (r): a faithful gauge is monotone in the current
// CPP (frozen → r=1 by construction, a linear map). The OLD r < 1 is the
// fraction of gauge motion driven by baseline DRIFT rather than the
// user's current voice — the mean-reversion artifact, quantified.
const WIN = 120;
const oldPos = [], newPos = [], rawCpp = [];
const ring = [];
let frozenMu = null, frozenSd = null;
for (const e of ems) {
  ring.push(e.cpp);
  if (ring.length > WIN) ring.shift();
  if (ring.length === WIN) {
    const mu = ring.reduce((a, b) => a + b) / WIN;
    const sd = Math.sqrt(ring.reduce((a, b) => a + (b - mu) ** 2, 0) / (WIN - 1));
    if (frozenMu === null) { frozenMu = mu; frozenSd = sd; }
    oldPos.push(Math.max(0, Math.min(1, ((e.cpp - mu) / sd + 2) / 4)));
    newPos.push(Math.max(0, Math.min(1, ((e.cpp - frozenMu) / frozenSd + 2) / 4)));
    rawCpp.push(e.cpp);
  }
}
console.log(`gauge-vs-CPP fidelity (r): old sliding μ,σ ${pearson(oldPos, rawCpp).toFixed(3)}, new frozen μ,σ ${pearson(newPos, rawCpp).toFixed(3)}`);
console.log(`frozen baseline: μ=${frozenMu.toFixed(3)} σ=${frozenSd.toFixed(3)} dB (gauge span ±2σ = ±${(2 * frozenSd).toFixed(2)} dB)`);
const clamp = (a) => 100 * a.filter((p) => p === 0 || p === 1).length / a.length;
console.log(`clamp rate (±2σ): old ${clamp(oldPos).toFixed(1)}%  new ${clamp(newPos).toFixed(1)}%`);

// Span sweep on the frozen baseline: wider span → less clamping, lower
// sensitivity. Pick the knee that keeps clamp ≲ 10 % while the gauge
// still uses most of its range. Fidelity r rises with span (less
// clamp = closer to a pure linear map).
console.log("\nfrozen-baseline span sweep (gauge = ((cpp-μ)/σ + k)/(2k)):");
for (const k of [2, 2.5, 3, 3.5, 4]) {
  const pos = rawCpp.map((c) => Math.max(0, Math.min(1, ((c - frozenMu) / frozenSd + k) / (2 * k))));
  const used = Math.max(...pos) - Math.min(...pos);
  console.log(`  ±${k}σ (±${(k * frozenSd).toFixed(2)} dB): clamp ${clamp(pos).toFixed(1)}%  fidelity r ${pearson(pos, rawCpp).toFixed(3)}  range-used ${(used * 100).toFixed(0)}%`);
}
// Mean-reversion demonstration: how far does the OLD gauge drift back
// toward center during a sustained CPP shift? Take the longest run where
// raw CPP stays >0.5σ above frozen μ, measure old-gauge start vs end.
let bestRun = [], cur = [];
for (let i = 0; i < rawCpp.length; i++) {
  if (rawCpp[i] > frozenMu + 0.5 * frozenSd) cur.push(i);
  else { if (cur.length > bestRun.length) bestRun = cur; cur = []; }
}
if (cur.length > bestRun.length) bestRun = cur;
if (bestRun.length > 5) {
  const a = bestRun[0], z = bestRun[bestRun.length - 1];
  console.log(`longest sustained-lighter run (${bestRun.length} emits, ~${(bestRun.length * 0.25).toFixed(0)}s): ` +
    `old gauge ${oldPos[a].toFixed(2)}→${oldPos[z].toFixed(2)} (drifts toward 0.5), new ${newPos[a].toFixed(2)}→${newPos[z].toFixed(2)} (holds)`);
}
