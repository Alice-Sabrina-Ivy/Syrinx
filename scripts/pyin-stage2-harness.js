// pyin-stage2-harness.js — Sweep PYIN_STAGE ∈ {0, 1, 2} and (for Stage 2)
// lookback L ∈ {2, 5, 10} on the full Hillenbrand corpus + the synthetic
// 2nd/3rd-harmonic stress block. Reports the accuracy/latency Pareto curve
// as the ship-decision artifact for Stage 2.
//
// Usage: node scripts/pyin-stage2-harness.js
// Output: stdout summary + JSON dump for the measurement file.
//
// Per-file flow (multi-frame: pYIN's HMM needs temporal context):
// 1. Reset HMM via {type: "reset-pitch-hmm"} message.
// 2. Step the file's central 70 % with 25 ms hops over 50 ms windows.
// 3. Call detectPitch on each window. The last non-null return is the
//    steady-state estimate (the file is a sustained vowel).
//
// Synthetic stimuli (all 48 kHz, 800 ms long so multi-frame stepping has
// room): feed 25 ms hops over the synthesized signal — the HMM converges
// on a stable answer well within 800 ms even for L=10 (warm-up = 250 ms).

import { readFileSync, existsSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import vm from "vm";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const WORKER_PATH = join(ROOT, "src/dsp/dsp-worker.js");
const DATA_DIR = join(ROOT, "tests/dsp/data");
const VOWDATA = join(DATA_DIR, "vowdata.dat");

// ---------------------------------------------------------------------------
//  vm context — fresh per sample rate (state is reset between files via msg)
// ---------------------------------------------------------------------------

function makeWorkerCtx(sampleRate) {
  const src = readFileSync(WORKER_PATH, "utf8");
  const ctx = {
    self: { postMessage() {}, onmessage: null },
    performance: { now: () => 0, timeOrigin: 0 },
    console,
    __PYIN_STAGE: 0,
    __PYIN_LOOKBACK: 5,
  };
  vm.createContext(ctx);
  vm.runInContext(src, ctx, { filename: "dsp-worker.js" });
  ctx.self.onmessage({ data: { type: "init", sampleRate } });
  return ctx;
}

function resetHmm(ctx) {
  ctx.self.onmessage({ data: { type: "reset-pitch-hmm" } });
}

// ---------------------------------------------------------------------------
//  WAV reader (16-bit PCM mono)
// ---------------------------------------------------------------------------

function readWav(path) {
  const buf = readFileSync(path);
  if (buf.toString("ascii", 0, 4) !== "RIFF") throw new Error("not RIFF");
  if (buf.toString("ascii", 8, 12) !== "WAVE") throw new Error("not WAVE");
  let offset = 12, sampleRate = 0, bps = 0, dataStart = 0, dataSize = 0;
  while (offset < buf.length - 8) {
    const id = buf.toString("ascii", offset, offset + 4);
    const size = buf.readUInt32LE(offset + 4);
    if (id === "fmt ") {
      sampleRate = buf.readUInt32LE(offset + 12);
      bps = buf.readUInt16LE(offset + 22);
    } else if (id === "data") {
      dataStart = offset + 8;
      dataSize = size;
      break;
    }
    offset += 8 + size;
  }
  const numSamples = dataSize / (bps / 8);
  const samples = new Float32Array(numSamples);
  for (let i = 0; i < numSamples; i++) {
    samples[i] = buf.readInt16LE(dataStart + i * 2) / 32768;
  }
  return { samples, sampleRate };
}

function parseVowdata(path) {
  const text = readFileSync(path, "utf8");
  const out = [];
  for (const raw of text.split("\n")) {
    const t = raw.trim();
    if (!/^[mwbg]\d/.test(t)) continue;
    const p = t.split(/\s+/);
    if (p.length < 7) continue;
    out.push({ filename: p[0], gender: p[0][0], vowel: p[0].slice(3), f0: +p[2] });
  }
  return out;
}

// Load full samples (not just middle window) — we need to step through
// for the HMM. Returns array of {gender, truthF0, samples}.
function loadCorpus() {
  if (!existsSync(VOWDATA)) throw new Error(`missing ${VOWDATA}`);
  const meta = parseVowdata(VOWDATA);
  const corpus = [];
  for (const e of meta) {
    if (e.gender !== "m" && e.gender !== "w") continue;
    if (e.f0 === 0) continue;
    const wavPath = join(DATA_DIR, e.gender === "m" ? "men" : "women", `${e.filename}.wav`);
    if (!existsSync(wavPath)) continue;
    const { samples, sampleRate } = readWav(wavPath);
    if (sampleRate !== 16000) continue;
    corpus.push({
      filename: e.filename,
      gender: e.gender,
      truthF0: e.f0,
      samples,
    });
  }
  return corpus;
}

// ---------------------------------------------------------------------------
//  Synthetic stress stimuli — comprehensive [11] block, 800 ms long
// ---------------------------------------------------------------------------

function harmonic(f0, sr, n, harmonicAmps) {
  const buf = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    let v = 0;
    for (let h = 1; h < harmonicAmps.length; h++) {
      const a = harmonicAmps[h];
      if (a) v += a * Math.sin(2 * Math.PI * h * f0 * i / sr);
    }
    buf[i] = v;
  }
  let peak = 0;
  for (let i = 0; i < n; i++) if (Math.abs(buf[i]) > peak) peak = Math.abs(buf[i]);
  if (peak > 0) {
    const scale = 0.7 / peak;
    for (let i = 0; i < n; i++) buf[i] *= scale;
  }
  return buf;
}

function makeSyntheticStimuli() {
  const sr = 48000;
  const dur = 0.8; // 800 ms — long enough for L=10 warm-up + ample read-out
  const n = Math.floor(sr * dur);
  const second = [];
  for (const f0 of [85, 100, 130, 175, 220]) {
    second.push({ f0, label: `2nd-dom f0=${f0}`, samples: harmonic(f0, sr, n, [0, 0.2, 1.0, 0.5, 0.25]) });
  }
  const third = [];
  for (const f0 of [110, 128, 140, 160]) {
    third.push({ f0, label: `3rd-dom f0=${f0}`, samples: harmonic(f0, sr, n, [0, 0.15, 0.3, 1.0, 0.6, 0.4, 0.2]) });
  }
  return { second, third, sr };
}

// ---------------------------------------------------------------------------
//  Stats helpers
// ---------------------------------------------------------------------------

function stats(arr) {
  if (!arr.length) return { mean: NaN, median: NaN, p95: NaN, max: NaN, n: 0 };
  const s = [...arr].sort((a, b) => a - b);
  const mean = arr.reduce((a, b) => a + b, 0) / arr.length;
  return {
    mean,
    median: s[Math.floor(s.length / 2)],
    p95: s[Math.floor(s.length * 0.95)],
    max: s[s.length - 1],
    n: arr.length,
  };
}

const fmt = (s) =>
  `mean=${s.mean.toFixed(2)} median=${s.median.toFixed(2)} p95=${s.p95.toFixed(2)} max=${s.max.toFixed(2)} (n=${s.n})`;

function isSubHarmonicLock(detected, truth) {
  if (detected === null || detected === undefined) return false;
  for (const k of [0.5, 1 / 3, 0.25]) {
    if (Math.abs(detected - truth * k) <= Math.max(8, truth * k * 0.06)) return true;
  }
  return false;
}

function octaveBucket(detected, truth) {
  if (detected === null || detected === undefined) return "miss";
  for (const [k, label] of [
    [1, "exact"], [2, "2x"], [3, "3x"], [4, "4x"],
    [0.5, "halved"], [1 / 3, "thirded"], [0.25, "quartered"],
  ]) {
    if (Math.abs(detected - truth * k) <= Math.max(8, truth * k * 0.06)) return label;
  }
  return "wild";
}

// ---------------------------------------------------------------------------
//  Per-file frame stepping — returns last non-null detectPitch return
// ---------------------------------------------------------------------------

function stepFile(ctx, samples, sr, hopMs = 25, windowMs = 50, centralFrac = 0.7) {
  resetHmm(ctx);
  const winN = Math.floor(sr * windowMs / 1000);
  const hopN = Math.floor(sr * hopMs / 1000);
  const margin = (1 - centralFrac) / 2;
  const startN = Math.floor(samples.length * margin);
  const endN = Math.floor(samples.length * (1 - margin));
  let last = null;
  for (let i = startN; i + winN <= endN; i += hopN) {
    const win = samples.subarray(i, i + winN);
    const r = ctx.detectPitch(win, sr);
    if (r !== null) last = r;
  }
  return last;
}

// ---------------------------------------------------------------------------
//  Per-cell evaluation
// ---------------------------------------------------------------------------

function evalCell(ctx16, ctx48, corpus, syn, stage, lookback) {
  ctx16.__PYIN_STAGE = stage;
  ctx48.__PYIN_STAGE = stage;
  if (lookback != null) {
    ctx16.__PYIN_LOOKBACK = lookback;
    ctx48.__PYIN_LOOKBACK = lookback;
  }

  const errs = { m: [], w: [] };
  const buckets = { m: {}, w: {} };
  let subLocks = 0;
  let nullCount = 0;
  for (const e of corpus) {
    const got = stepFile(ctx16, e.samples, 16000);
    const bucket = octaveBucket(got, e.truthF0);
    buckets[e.gender][bucket] = (buckets[e.gender][bucket] || 0) + 1;
    if (got === null) { nullCount++; continue; }
    errs[e.gender].push(Math.abs(got - e.truthF0));
    if (isSubHarmonicLock(got, e.truthF0)) subLocks++;
  }

  const within = (a, b, eps) =>
    a !== null && a !== undefined && Math.abs(a - b) <= eps;
  const secondResults = syn.second.map((s) => {
    const got = stepFile(ctx48, s.samples, syn.sr);
    return { ...s, samples: undefined, detected: got, pass: within(got, s.f0, 4) };
  });
  const thirdResults = syn.third.map((s) => {
    const got = stepFile(ctx48, s.samples, syn.sr);
    return { ...s, samples: undefined, detected: got, pass: within(got, s.f0, 4) };
  });

  return {
    stage, lookback,
    f: stats(errs.w), m: stats(errs.m),
    subLocks, buckets, nullCount,
    second: secondResults, third: thirdResults,
  };
}

// ---------------------------------------------------------------------------
//  Main
// ---------------------------------------------------------------------------

console.log("Loading corpus + synthetic stimuli…");
const corpus = loadCorpus();
const syn = makeSyntheticStimuli();
console.log(
  `  corpus: ${corpus.length} files (${corpus.filter((c) => c.gender === "m").length} M, ${corpus.filter((c) => c.gender === "w").length} F)`,
);
console.log(`  synthetic: ${syn.second.length} 2nd-dom + ${syn.third.length} 3rd-dom @ ${syn.sr} Hz, 800 ms each`);

const ctx16 = makeWorkerCtx(16000);
const ctx48 = makeWorkerCtx(48000);

const cells = [
  { label: "Stage 0 (legacy YIN + multi-mult)",            stage: 0, lookback: null },
  { label: "Stage 1 (Beta(2,18) + naive argmax)",          stage: 1, lookback: null },
  { label: "Stage 2 + L=2  (50 ms latency)",               stage: 2, lookback: 2  },
  { label: "Stage 2 + L=5  (125 ms latency)",              stage: 2, lookback: 5  },
  { label: "Stage 2 + L=10 (250 ms latency)",              stage: 2, lookback: 10 },
];

const results = [];
for (const cell of cells) {
  console.log(`\n${cell.label}`);
  const t0 = Date.now();
  const r = evalCell(ctx16, ctx48, corpus, syn, cell.stage, cell.lookback);
  const dt = ((Date.now() - t0) / 1000).toFixed(1);
  results.push({ ...cell, ...r });
  console.log(`  Female F0 error: ${fmt(r.f)}   [${dt}s]`);
  console.log(`  Male F0 error:   ${fmt(r.m)}`);
  console.log(`  Sub-locks: ${r.subLocks}    Female buckets: ${JSON.stringify(r.buckets.w)}`);
  console.log(`  Synthetic 2nd-dom: ${r.second.filter((x) => x.pass).length}/${r.second.length}    3rd-dom: ${r.third.filter((x) => x.pass).length}/${r.third.length}`);
}

console.log("\n--- Pareto table (accuracy vs latency) ---");
console.log("  cell                                       F mean   M mean   2nd  3rd  subL  latency");
for (const r of results) {
  const lat = r.stage !== 2 ? "n/a" : `${r.lookback * 25} ms`;
  console.log(
    `  ${r.label.padEnd(42)} ${r.f.mean.toFixed(2).padStart(6)}   ${r.m.mean.toFixed(2).padStart(6)}   ` +
    `${r.second.filter((x) => x.pass).length}/${r.second.length}  ${r.third.filter((x) => x.pass).length}/${r.third.length}  ${String(r.subLocks).padStart(4)}  ${lat}`,
  );
}

console.log("\n--- BEGIN-JSON ---");
console.log(JSON.stringify(results, (k, v) => {
  if (v instanceof Float32Array || v instanceof Float64Array || v instanceof Int32Array) return undefined;
  return v;
}, 2));
console.log("--- END-JSON ---");
