// degraded-test.js — Stage 2.B robustness vs synthetic degradations on the
// Hillenbrand corpus. All variants are generated in-memory at test time;
// no degraded WAVs are written to disk. Deterministic noise seeds and
// IR coefficients keep the run reproducible across machines.
//
// Usage: node tests/dsp/degraded-test.js
//
// What's tested (per the spec):
//   1. clean baseline (no degradation)
//   2. + pink noise at SNR ∈ {40, 20, 10} dB
//   3. + simulated reverb (synthesized IRs: 40 ms short, 100 ms medium)
//   4. + AGC-style amplitude modulation (slow gain envelope)
//   5. + soft clipping at -3 dBFS (after amplitude boost)
//
// Stages tested: PYIN_STAGE=0 (legacy YIN + multi-mult, current production)
// vs. PYIN_STAGE=2 with L=2 and L=4 (production ship at L=4).
//
// Methodology mirrors scripts/pyin-stage2-harness.js: 25 ms hop over the
// central 70 % of each file, last non-null detectPitch return per file,
// HMM reset between files. Apples-to-apples Stage 0 baseline IS the
// matching multi-frame methodology in this harness — NOT the historical
// single-window numbers from accuracy-test.js.
//
// Note: synthetic stress passes 5/5 + 4/4 across all 84 cells in the
// 2026-05-04 harmonic-gate sweep, so it's not run here — yin-harmonic-test.js
// covers the regression-guard role.

import { readFileSync, readdirSync, existsSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import vm from "vm";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "../..");
const WORKER_PATH = join(ROOT, "src/dsp/dsp-worker.js");
const DATA_DIR = join(ROOT, "tests/dsp/data");
const VOWDATA = join(DATA_DIR, "vowdata.dat");

if (!existsSync(VOWDATA)) {
  console.log("SKIP: tests/dsp/data/vowdata.dat not found.");
  console.log("To run, follow tests/dsp/real-speech-test.js's header.");
  process.exit(0);
}

// ---------------------------------------------------------------------------
//  Deterministic PRNG (mulberry32 — small, well-distributed)
// ---------------------------------------------------------------------------

function mulberry32(seed) {
  let s = seed >>> 0;
  return function () {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return (((t ^ (t >>> 14)) >>> 0) / 0x100000000);
  };
}

// ---------------------------------------------------------------------------
//  WAV reader (16-bit PCM mono)
// ---------------------------------------------------------------------------

function readWav(path) {
  const buf = readFileSync(path);
  let off = 12, sr = 0, bps = 0, ds = 0, dz = 0;
  while (off < buf.length - 8) {
    const id = buf.toString("ascii", off, off + 4);
    const sz = buf.readUInt32LE(off + 4);
    if (id === "fmt ") { sr = buf.readUInt32LE(off + 12); bps = buf.readUInt16LE(off + 22); }
    else if (id === "data") { ds = off + 8; dz = sz; break; }
    off += 8 + sz;
  }
  const n = dz / (bps / 8);
  const s = new Float32Array(n);
  for (let i = 0; i < n; i++) s[i] = buf.readInt16LE(ds + i * 2) / 32768;
  return { samples: s, sampleRate: sr };
}

function parseVowdata(path) {
  const text = readFileSync(path, "utf8");
  const out = [];
  for (const raw of text.split("\n")) {
    const t = raw.trim(); if (!/^[mwbg]\d/.test(t)) continue;
    const p = t.split(/\s+/); if (p.length < 7) continue;
    out.push({ filename: p[0], gender: p[0][0], f0: +p[2] });
  }
  return out;
}

function loadCorpus() {
  const meta = parseVowdata(VOWDATA);
  const corpus = [];
  for (const e of meta) {
    if (e.gender !== "m" && e.gender !== "w") continue;
    if (e.f0 === 0) continue;
    const wp = join(DATA_DIR, e.gender === "m" ? "men" : "women", `${e.filename}.wav`);
    if (!existsSync(wp)) continue;
    const { samples, sampleRate } = readWav(wp);
    if (sampleRate !== 16000) continue;
    corpus.push({ filename: e.filename, gender: e.gender, truthF0: e.f0, samples });
  }
  return corpus;
}

// ---------------------------------------------------------------------------
//  Degradation primitives
// ---------------------------------------------------------------------------

// Pink noise via Voss-McCartney algorithm. Output normalized to RMS ≈ 1.
function pinkNoise(n, seed) {
  const rng = mulberry32(seed);
  const out = new Float32Array(n);
  const NUM_SOURCES = 16;
  const sources = new Float64Array(NUM_SOURCES);
  for (let i = 0; i < NUM_SOURCES; i++) sources[i] = rng() * 2 - 1;
  for (let i = 0; i < n; i++) {
    // Update sources at staggered rates: source k flips every 2^k samples.
    // Pick the lowest-index source that's due; equivalent to LSB-of-counter.
    if (i > 0) {
      let k = 0;
      let mask = i;
      while ((mask & 1) === 0 && k < NUM_SOURCES - 1) { mask >>= 1; k++; }
      sources[k] = rng() * 2 - 1;
    }
    let v = 0;
    for (let k = 0; k < NUM_SOURCES; k++) v += sources[k];
    out[i] = v / NUM_SOURCES;
  }
  // Normalize to RMS = 1.
  let ms = 0;
  for (let i = 0; i < n; i++) ms += out[i] * out[i];
  const rms = Math.sqrt(ms / n);
  if (rms > 0) for (let i = 0; i < n; i++) out[i] /= rms;
  return out;
}

function rms(x) {
  let s = 0;
  for (let i = 0; i < x.length; i++) s += x[i] * x[i];
  return Math.sqrt(s / x.length);
}

function addPinkNoise(signal, snrDb, seed) {
  const sigRms = rms(signal);
  if (sigRms === 0) return signal.slice();
  const noiseRms = sigRms / Math.pow(10, snrDb / 20);
  const pink = pinkNoise(signal.length, seed);
  const out = new Float32Array(signal.length);
  for (let i = 0; i < signal.length; i++) out[i] = signal[i] + pink[i] * noiseRms;
  return out;
}

// Synthesized exponentially-decaying IR with random sign per sample.
// Length and RT60 control the reverb character. Normalized so total
// energy is 1 (matches a passive reverb's energy preservation roughly).
function synthesizeIR(lengthSec, sampleRate, rt60Sec, seed) {
  const n = Math.floor(lengthSec * sampleRate);
  const ir = new Float32Array(n);
  const rng = mulberry32(seed);
  // Decay: amp(t) = exp(-3 ln10 * t / rt60); -60 dB at t = rt60.
  const k = -3 * Math.LN10 / rt60Sec;
  for (let i = 0; i < n; i++) {
    const t = i / sampleRate;
    ir[i] = (rng() * 2 - 1) * Math.exp(k * t);
  }
  // Normalize to unit energy (RMS preservation).
  let energy = 0;
  for (let i = 0; i < n; i++) energy += ir[i] * ir[i];
  const norm = energy > 0 ? 1 / Math.sqrt(energy) : 1;
  for (let i = 0; i < n; i++) ir[i] *= norm;
  // Force a strong direct path so the reverb tail doesn't smear the dry
  // signal beyond recognition (matches typical room IR character).
  ir[0] += 1.0;
  return ir;
}

// Direct convolution truncated to signal length. O(N*M).
function convolve(signal, ir) {
  const N = signal.length, M = ir.length;
  const out = new Float32Array(N);
  for (let i = 0; i < N; i++) {
    let s = 0;
    const jMax = i < M ? i + 1 : M;
    for (let j = 0; j < jMax; j++) s += signal[i - j] * ir[j];
    out[i] = s;
  }
  return out;
}

// AGC-style slow gain modulation: 1 + depth * sin(2π·modFreq·t).
function applyAGC(signal, sampleRate, modFreq, depth) {
  const out = new Float32Array(signal.length);
  for (let i = 0; i < signal.length; i++) {
    out[i] = signal[i] * (1 + depth * Math.sin(2 * Math.PI * modFreq * i / sampleRate));
  }
  return out;
}

// Soft clip with tanh knee at threshold (interpreted as fraction of full scale).
// Boost the signal first so peaks reach the clip threshold — simulates an
// over-driven preamp on a quiet input, which is the realistic clip case.
function softClip(signal, thresholdAbs, boost) {
  const out = new Float32Array(signal.length);
  for (let i = 0; i < signal.length; i++) {
    const x = signal[i] * boost;
    if (x > thresholdAbs) {
      out[i] = thresholdAbs + (1 - thresholdAbs) * Math.tanh((x - thresholdAbs) / (1 - thresholdAbs));
    } else if (x < -thresholdAbs) {
      out[i] = -thresholdAbs + (-1 + thresholdAbs) * Math.tanh((x + thresholdAbs) / (1 - thresholdAbs));
    } else {
      out[i] = x;
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
//  Variant definitions — deterministic seeds keyed off the variant name
// ---------------------------------------------------------------------------

// IRs are computed once and reused across all files (same room, same noise).
// 16 kHz Hillenbrand sample rate. Short = 40 ms, medium = 100 ms.
const IR_SHORT = synthesizeIR(0.040, 16000, 0.080, 0xCAFEBABE);
const IR_MEDIUM = synthesizeIR(0.100, 16000, 0.250, 0xDEADBEEF);

const variants = [
  { id: "clean",        apply: (s) => s },
  { id: "pink_40dB",    apply: (s, fileIdx) => addPinkNoise(s, 40, 0x1000 + fileIdx) },
  { id: "pink_20dB",    apply: (s, fileIdx) => addPinkNoise(s, 20, 0x2000 + fileIdx) },
  { id: "pink_10dB",    apply: (s, fileIdx) => addPinkNoise(s, 10, 0x3000 + fileIdx) },
  { id: "reverb_short", apply: (s) => convolve(s, IR_SHORT) },
  { id: "reverb_med",   apply: (s) => convolve(s, IR_MEDIUM) },
  { id: "agc",          apply: (s) => applyAGC(s, 16000, 2.0, 0.3) },
  { id: "soft_clip",    apply: (s) => softClip(s, 0.708, 3.0) },
];

const stageCells = [
  { label: "Stage 0",       stage: 0, lookback: null },
  { label: "Stage 2 L=2",   stage: 2, lookback: 2 },
  { label: "Stage 2 L=4",   stage: 2, lookback: 4 },
];

// ---------------------------------------------------------------------------
//  Worker context
// ---------------------------------------------------------------------------

function makeWorkerCtx(sampleRate) {
  const src = readFileSync(WORKER_PATH, "utf8");
  const ctx = {
    self: { postMessage() {}, onmessage: null },
    performance: { now: () => 0, timeOrigin: 0 },
    console,
    __PYIN_STAGE: 0,
    __PYIN_LOOKBACK: 4,
  };
  vm.createContext(ctx);
  vm.runInContext(src, ctx, { filename: "dsp-worker.js" });
  ctx.self.onmessage({ data: { type: "init", sampleRate } });
  // Optional σ override — set via PYIN_SIGMA env var. Default is the
  // worker's built-in σ=50 cents (production ship value).
  const overrideSigma = parseFloat(process.env.PYIN_SIGMA);
  if (Number.isFinite(overrideSigma) && overrideSigma > 0) {
    ctx.self.onmessage({ data: { type: "set-pyin-sigma", sigma: overrideSigma } });
  }
  return ctx;
}

function resetHmm(ctx) {
  ctx.self.onmessage({ data: { type: "reset-pitch-hmm" } });
}

// Frame-stepping with multi-frame methodology: 25 ms hop over central
// 70 %, last non-null detectPitch return per file.
function stepFile(ctx, samples, sr) {
  resetHmm(ctx);
  const winN = Math.floor(sr * 50 / 1000);
  const hopN = Math.floor(sr * 25 / 1000);
  const startN = Math.floor(samples.length * 0.15);
  const endN = Math.floor(samples.length * 0.85);
  let last = null;
  for (let i = startN; i + winN <= endN; i += hopN) {
    const r = ctx.detectPitch(samples.subarray(i, i + winN), sr);
    if (r !== null) last = r;
  }
  return last;
}

// ---------------------------------------------------------------------------
//  Stats helpers
// ---------------------------------------------------------------------------

function stats(arr) {
  if (!arr.length) return { mean: NaN, median: NaN, p95: NaN, n: 0 };
  const s = [...arr].sort((a, b) => a - b);
  const mean = arr.reduce((a, b) => a + b, 0) / arr.length;
  return { mean, median: s[Math.floor(s.length / 2)], p95: s[Math.floor(s.length * 0.95)], n: arr.length };
}

const fmt = (s) => `mean=${s.mean.toFixed(2)} median=${s.median.toFixed(2)} p95=${s.p95.toFixed(2)} (n=${s.n})`;

// ---------------------------------------------------------------------------
//  Main
// ---------------------------------------------------------------------------

console.log("Loading Hillenbrand corpus…");
const corpus = loadCorpus();
console.log(
  `  corpus: ${corpus.length} files (${corpus.filter((c) => c.gender === "m").length} M, ${corpus.filter((c) => c.gender === "w").length} F)`,
);

const ctx16 = makeWorkerCtx(16000);

// Cache: for each variant, pre-compute the degraded version of each file.
// Saves redundant work when sweeping stages.
console.log("\nGenerating degraded variants in memory…");
const t0 = Date.now();
const degraded = new Map(); // key: variant.id -> array of {gender, truthF0, samples}
for (const v of variants) {
  const arr = [];
  for (let i = 0; i < corpus.length; i++) {
    const e = corpus[i];
    arr.push({ gender: e.gender, truthF0: e.truthF0, filename: e.filename, samples: v.apply(e.samples, i) });
  }
  degraded.set(v.id, arr);
  console.log(`  ${v.id.padEnd(14)} done (${((Date.now() - t0) / 1000).toFixed(1)}s)`);
}

// Sweep cells: for each (variant, stage), step through all files, collect
// pitch errors per gender + null counts. ~24 cells × ~9s/cell ≈ 4 min.
const results = []; // each: { variant, stage, lookback, fStats, mStats, fNullCount, mNullCount }
console.log("\nRunning sweep (variants × stages)…");
for (const v of variants) {
  for (const c of stageCells) {
    ctx16.__PYIN_STAGE = c.stage;
    if (c.lookback != null) ctx16.__PYIN_LOOKBACK = c.lookback;
    const errs = { m: [], w: [] };
    let mNull = 0, wNull = 0;
    const arr = degraded.get(v.id);
    const tCell0 = Date.now();
    for (const e of arr) {
      const got = stepFile(ctx16, e.samples, 16000);
      if (got === null) { if (e.gender === "m") mNull++; else wNull++; continue; }
      errs[e.gender].push(Math.abs(got - e.truthF0));
    }
    const dt = ((Date.now() - tCell0) / 1000).toFixed(1);
    const r = {
      variant: v.id, stage: c.stage, lookback: c.lookback, label: c.label,
      f: stats(errs.w), m: stats(errs.m), fNull: wNull, mNull: mNull,
    };
    results.push(r);
    console.log(
      `  [${dt}s] ${v.id.padEnd(14)} ${c.label.padEnd(13)} ` +
      `F: mean=${r.f.mean.toFixed(2)} (null=${wNull}/${arr.filter((e) => e.gender === "w").length})  ` +
      `M: mean=${r.m.mean.toFixed(2)} (null=${mNull}/${arr.filter((e) => e.gender === "m").length})`,
    );
  }
}

// ---------------------------------------------------------------------------
//  Report — table grouped by variant, columns by stage
// ---------------------------------------------------------------------------

console.log("\n========== Per-variant Pareto: F mean by stage ==========");
console.log(`  ${"variant".padEnd(14)}  ${"Stage 0".padStart(8)} ${"L=2".padStart(8)} ${"L=4".padStart(8)}    Δ vs Stage 0 (L=2 / L=4)`);
for (const v of variants) {
  const cells = results.filter((r) => r.variant === v.id);
  const s0 = cells.find((c) => c.stage === 0);
  const sL2 = cells.find((c) => c.stage === 2 && c.lookback === 2);
  const sL4 = cells.find((c) => c.stage === 2 && c.lookback === 4);
  const dL2 = sL2.f.mean - s0.f.mean;
  const dL4 = sL4.f.mean - s0.f.mean;
  console.log(
    `  ${v.id.padEnd(14)}  ${s0.f.mean.toFixed(2).padStart(8)} ${sL2.f.mean.toFixed(2).padStart(8)} ${sL4.f.mean.toFixed(2).padStart(8)}    ${dL2.toFixed(2).padStart(7)}  /  ${dL4.toFixed(2).padStart(7)}`,
  );
}

console.log("\n========== Per-variant: M mean by stage ==========");
console.log(`  ${"variant".padEnd(14)}  ${"Stage 0".padStart(8)} ${"L=2".padStart(8)} ${"L=4".padStart(8)}    Δ vs Stage 0 (L=2 / L=4)`);
for (const v of variants) {
  const cells = results.filter((r) => r.variant === v.id);
  const s0 = cells.find((c) => c.stage === 0);
  const sL2 = cells.find((c) => c.stage === 2 && c.lookback === 2);
  const sL4 = cells.find((c) => c.stage === 2 && c.lookback === 4);
  const dL2 = sL2.m.mean - s0.m.mean;
  const dL4 = sL4.m.mean - s0.m.mean;
  console.log(
    `  ${v.id.padEnd(14)}  ${s0.m.mean.toFixed(2).padStart(8)} ${sL2.m.mean.toFixed(2).padStart(8)} ${sL4.m.mean.toFixed(2).padStart(8)}    ${dL2.toFixed(2).padStart(7)}  /  ${dL4.toFixed(2).padStart(7)}`,
  );
}

console.log("\n========== Per-variant: F null rate (out of 576) ==========");
console.log(`  ${"variant".padEnd(14)}  ${"Stage 0".padStart(8)} ${"L=2".padStart(8)} ${"L=4".padStart(8)}`);
for (const v of variants) {
  const cells = results.filter((r) => r.variant === v.id);
  const s0 = cells.find((c) => c.stage === 0);
  const sL2 = cells.find((c) => c.stage === 2 && c.lookback === 2);
  const sL4 = cells.find((c) => c.stage === 2 && c.lookback === 4);
  console.log(
    `  ${v.id.padEnd(14)}  ${String(s0.fNull).padStart(8)} ${String(sL2.fNull).padStart(8)} ${String(sL4.fNull).padStart(8)}`,
  );
}

console.log("\n--- BEGIN-JSON ---");
console.log(JSON.stringify(results, null, 2));
console.log("--- END-JSON ---");
