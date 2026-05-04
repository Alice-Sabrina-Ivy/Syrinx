// pyin-stage1-harness.js — Compare legacy YIN (PYIN_STAGE=0) against the
// pYIN step-1 threshold-integration path (PYIN_STAGE=1) on the full
// Hillenbrand corpus + the comprehensive [11] block of synthetic
// 2nd/3rd-harmonic stress stimuli.
//
// Usage: node scripts/pyin-stage1-harness.js
// Output: stdout summary, plus measurements written by the caller.
//
// Architecture:
// - Loads dsp-worker.js via vm.runInContext, identical to
//   pitch-detection-comprehensive.js / tune-harmonic-gates.js.
// - Sets ctx.__PYIN_STAGE between runs to flip the gate without
//   re-instantiating the worker context.
// - Pre-loads the corpus into memory once; both stages reuse it.

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
//  vm context — fresh per sample rate
// ---------------------------------------------------------------------------

function makeWorkerCtx(sampleRate) {
  const src = readFileSync(WORKER_PATH, "utf8");
  const ctx = {
    self: { postMessage() {}, onmessage: null },
    performance: { now: () => 0, timeOrigin: 0 },
    console,
    __PYIN_STAGE: 0,
  };
  vm.createContext(ctx);
  vm.runInContext(src, ctx, { filename: "dsp-worker.js" });
  ctx.self.onmessage({ data: { type: "init", sampleRate } });
  return ctx;
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

function loadCorpus() {
  if (!existsSync(VOWDATA)) throw new Error(`missing ${VOWDATA}`);
  const meta = parseVowdata(VOWDATA);
  const winN = Math.floor(16000 * 50 / 1000);
  const corpus = [];
  for (const e of meta) {
    if (e.gender !== "m" && e.gender !== "w") continue;
    if (e.f0 === 0) continue;
    const wavPath = join(DATA_DIR, e.gender === "m" ? "men" : "women", `${e.filename}.wav`);
    if (!existsSync(wavPath)) continue;
    const { samples, sampleRate } = readWav(wavPath);
    if (sampleRate !== 16000) continue;
    const start = Math.max(0, Math.floor((samples.length - winN) / 2));
    corpus.push({
      filename: e.filename,
      gender: e.gender,
      truthF0: e.f0,
      window: samples.subarray(start, start + winN),
    });
  }
  return corpus;
}

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
  const winN = Math.floor(sr * 50 / 1000);
  const second = [];
  for (const f0 of [85, 100, 130, 175, 220]) {
    second.push({ f0, label: `2nd-dom f0=${f0}`, window: harmonic(f0, sr, winN, [0, 0.2, 1.0, 0.5, 0.25]) });
  }
  const third = [];
  for (const f0 of [110, 128, 140, 160]) {
    third.push({ f0, label: `3rd-dom f0=${f0}`, window: harmonic(f0, sr, winN, [0, 0.15, 0.3, 1.0, 0.6, 0.4, 0.2]) });
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
//  Per-stage evaluation
// ---------------------------------------------------------------------------

function evalStage(ctx16, ctx48, corpus, syn, stage) {
  ctx16.__PYIN_STAGE = stage;
  ctx48.__PYIN_STAGE = stage;

  const errs = { m: [], w: [] };
  const buckets = { m: {}, w: {} };
  let subLocks = 0;
  let nullCount = 0;
  for (const e of corpus) {
    const got = ctx16.detectPitch(e.window, 16000);
    const bucket = octaveBucket(got, e.truthF0);
    buckets[e.gender][bucket] = (buckets[e.gender][bucket] || 0) + 1;
    if (got === null) { nullCount++; continue; }
    errs[e.gender].push(Math.abs(got - e.truthF0));
    if (isSubHarmonicLock(got, e.truthF0)) subLocks++;
  }

  const within = (a, b, eps) =>
    a !== null && a !== undefined && Math.abs(a - b) <= eps;
  const secondResults = syn.second.map((s) => {
    const got = ctx48.detectPitch(s.window, syn.sr);
    return { ...s, detected: got, pass: within(got, s.f0, 2) };
  });
  const thirdResults = syn.third.map((s) => {
    const got = ctx48.detectPitch(s.window, syn.sr);
    return { ...s, detected: got, pass: within(got, s.f0, 2) };
  });

  return {
    stage,
    f: stats(errs.w),
    m: stats(errs.m),
    subLocks,
    buckets,
    nullCount,
    second: secondResults,
    third: thirdResults,
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
console.log(`  synthetic: ${syn.second.length} 2nd-dom, ${syn.third.length} 3rd-dom`);

const ctx16 = makeWorkerCtx(16000);
const ctx48 = makeWorkerCtx(48000);

console.log("\nEvaluating PYIN_STAGE=0 (legacy YIN + multi-mult)…");
const r0 = evalStage(ctx16, ctx48, corpus, syn, 0);
console.log(`  Female F0 error: ${fmt(r0.f)}`);
console.log(`  Male F0 error:   ${fmt(r0.m)}`);
console.log(`  Sub-harmonic-lock count: ${r0.subLocks}`);
console.log(`  Female buckets: ${JSON.stringify(r0.buckets.w)}`);
console.log(`  Male   buckets: ${JSON.stringify(r0.buckets.m)}`);
console.log(`  Synthetic 2nd-dom: ${r0.second.filter((x) => x.pass).length}/${r0.second.length}`);
for (const x of r0.second) {
  console.log(`    [${x.pass ? " " : "!"}] ${x.label} → ${x.detected !== null ? x.detected.toFixed(1) : "null"}`);
}
console.log(`  Synthetic 3rd-dom: ${r0.third.filter((x) => x.pass).length}/${r0.third.length}`);
for (const x of r0.third) {
  console.log(`    [${x.pass ? " " : "!"}] ${x.label} → ${x.detected !== null ? x.detected.toFixed(1) : "null"}`);
}

console.log("\nEvaluating PYIN_STAGE=1 (Beta(2,18) threshold integration, naive argmax)…");
const r1 = evalStage(ctx16, ctx48, corpus, syn, 1);
console.log(`  Female F0 error: ${fmt(r1.f)}`);
console.log(`  Male F0 error:   ${fmt(r1.m)}`);
console.log(`  Sub-harmonic-lock count: ${r1.subLocks}`);
console.log(`  Female buckets: ${JSON.stringify(r1.buckets.w)}`);
console.log(`  Male   buckets: ${JSON.stringify(r1.buckets.m)}`);
console.log(`  Synthetic 2nd-dom: ${r1.second.filter((x) => x.pass).length}/${r1.second.length}`);
for (const x of r1.second) {
  console.log(`    [${x.pass ? " " : "!"}] ${x.label} → ${x.detected !== null ? x.detected.toFixed(1) : "null"}`);
}
console.log(`  Synthetic 3rd-dom: ${r1.third.filter((x) => x.pass).length}/${r1.third.length}`);
for (const x of r1.third) {
  console.log(`    [${x.pass ? " " : "!"}] ${x.label} → ${x.detected !== null ? x.detected.toFixed(1) : "null"}`);
}

console.log("\nDelta (Stage 1 − Stage 0):");
console.log(`  Female mean: ${(r1.f.mean - r0.f.mean).toFixed(2)} Hz`);
console.log(`  Male mean:   ${(r1.m.mean - r0.m.mean).toFixed(2)} Hz`);
console.log(`  Sub-locks:   ${r1.subLocks - r0.subLocks}`);
console.log(`  2nd-dom:     ${r1.second.filter((x) => x.pass).length - r0.second.filter((x) => x.pass).length}`);
console.log(`  3rd-dom:     ${r1.third.filter((x) => x.pass).length - r0.third.filter((x) => x.pass).length}`);

// JSON dump for the measurement file to consume.
console.log("\n--- BEGIN-JSON ---");
console.log(JSON.stringify({ stage0: r0, stage1: r1 }, (k, v) => {
  if (v instanceof Float32Array || v instanceof Float64Array || v instanceof Int32Array) {
    return undefined; // skip raw audio buffers
  }
  return v;
}, 2));
console.log("--- END-JSON ---");
