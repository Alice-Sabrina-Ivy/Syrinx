// real-speech-test.js — Real-speech evaluation of the pitch detector against
// the Hillenbrand et al. (1995) vowel corpus (12 vowels × 50 men × 50 women,
// plus children). Loads detectPitch directly from src/dsp/dsp-worker.js via
// Node's vm module so this test always exercises the deployed code.
//
// Usage:
//   node tests/dsp/real-speech-test.js
//
// Required fixtures (downloaded once, gitignored):
//   tests/dsp/data/vowdata.dat
//   tests/dsp/data/men/*.wav
//   tests/dsp/data/women/*.wav
//
// Source: https://github.com/santiagobarreda/hillenbrand_et_al_1995
//   $ git clone --depth 1 https://github.com/santiagobarreda/hillenbrand_et_al_1995 /tmp/h95
//   $ unzip /tmp/h95/h95-alldata.zip -d /tmp/h95-extract
//   $ unzip /tmp/h95-extract/men.zip -d /tmp/h95-extract/men
//   $ unzip /tmp/h95-extract/women.zip -d /tmp/h95-extract/women
//   $ cp -r /tmp/h95-extract/{men,women,vowdata.dat} tests/dsp/data/
//
// Coverage
//   1. Single-window accuracy on every available men/women file (raw worker)
//   2. Layered defence: emulate the production pipeline by running the
//      smoothing helper (pushAndMedianPitch) across overlapping 50 ms
//      windows extracted from the steady-state portion of each file.
//   3. Per-vowel breakdown so vowels prone to sub-harmonic lock surface.
//   4. Explicit sub-harmonic-lock census — quantifies the gap the synthetic
//      tests flagged in pitch-detection-comprehensive.js.

import { readFileSync, readdirSync, existsSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import vm from "vm";

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = join(__dirname, "data");
const WORKER_PATH = join(__dirname, "../../src/dsp/dsp-worker.js");

// ---------------------------------------------------------------------------
//  Worker loader (mirrors pitch-detection-comprehensive.js)
// ---------------------------------------------------------------------------

function loadWorker(sampleRate) {
  const src = readFileSync(WORKER_PATH, "utf8");
  const ctx = {
    self: { postMessage() {}, onmessage: null },
    performance: { now: () => 0, timeOrigin: 0 },
    console,
  };
  vm.createContext(ctx);
  vm.runInContext(src, ctx, { filename: "dsp-worker.js" });
  ctx.self.onmessage({ data: { type: "init", sampleRate } });
  return {
    detectPitch: ctx.detectPitch,
    sampleRate,
    windowSize: Math.floor((sampleRate * 50) / 1000),
  };
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

// ---------------------------------------------------------------------------
//  Hillenbrand metadata parser
// ---------------------------------------------------------------------------

function parseVowdata(path) {
  const text = readFileSync(path, "utf8");
  const out = [];
  for (const raw of text.split("\n")) {
    const t = raw.trim();
    if (!/^[mwbg]\d/.test(t)) continue;
    const p = t.split(/\s+/);
    if (p.length < 7) continue;
    const filename = p[0];
    out.push({
      filename,
      gender: filename[0],
      vowel: filename.slice(3),
      duration: +p[1],
      f0: +p[2],
      f1: +p[3],
      f2: +p[4],
      f3: +p[5],
    });
  }
  return out;
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
  `mean=${s.mean.toFixed(1)} median=${s.median.toFixed(1)} p95=${s.p95.toFixed(1)} max=${s.max.toFixed(1)} (n=${s.n})`;

// Classify error against the ground truth f0 in octave-relation buckets.
function octaveBucket(detected, truth) {
  if (detected === null || detected === undefined) return "miss";
  for (const [k, label] of [
    [1, "exact"],
    [2, "2x"],
    [3, "3x"],
    [4, "4x"],
    [0.5, "halved"],
    [1 / 3, "thirded"],
    [0.25, "quartered"],
  ]) {
    if (Math.abs(detected - truth * k) <= Math.max(8, truth * k * 0.06)) return label;
  }
  return "wild";
}

// ---------------------------------------------------------------------------
//  Main
// ---------------------------------------------------------------------------

const vowdataPath = join(DATA_DIR, "vowdata.dat");
if (!existsSync(vowdataPath)) {
  console.log("SKIP: tests/dsp/data/vowdata.dat not found.");
  console.log("To run: see header comment for download instructions.");
  process.exit(0);
}

const entries = parseVowdata(vowdataPath);
console.log(`Loaded ${entries.length} ground-truth entries.\n`);

let passed = 0, failed = 0;
function check(name, ok, detail = "") {
  if (ok) {
    passed++;
    console.log(`  ✓ ${name}`);
  } else {
    failed++;
    console.log(`  ✗ ${name}${detail ? `  (${detail})` : ""}`);
  }
}

const w16 = loadWorker(16000); // Hillenbrand WAVs are all 16 kHz

const { pushAndMedianPitch } = await import("../../src/audio/pitchSmoothing.js");

// ---------------------------------------------------------------------------
//  Pass 1 — single-window raw detector accuracy on every available file
// ---------------------------------------------------------------------------

console.log("[1] Single-window raw detector vs. Hillenbrand ground truth\n");

const errsByGender = { m: [], w: [] };
const errsByVowel = {};
const bucketsByGender = { m: {}, w: {} };
const f0OffsetsByGender = { m: [], w: [] };
const subHarmonicCases = [];
let total = 0, missing = 0;

for (const e of entries) {
  if (e.gender !== "m" && e.gender !== "w") continue; // skip kids
  if (e.f0 === 0) continue;

  const wavPath = join(DATA_DIR, e.gender === "m" ? "men" : "women", `${e.filename}.wav`);
  if (!existsSync(wavPath)) continue;
  total++;

  const { samples, sampleRate } = readWav(wavPath);
  if (sampleRate !== 16000) continue;

  // Steady-state 50 ms window from the middle of the recording
  const winN = w16.windowSize;
  const start = Math.max(0, Math.floor((samples.length - winN) / 2));
  const window = samples.subarray(start, start + winN);

  const got = w16.detectPitch(window, 16000);
  const bucket = octaveBucket(got, e.f0);
  bucketsByGender[e.gender][bucket] = (bucketsByGender[e.gender][bucket] || 0) + 1;

  if (got === null) {
    missing++;
    continue;
  }

  const err = Math.abs(got - e.f0);
  errsByGender[e.gender].push(err);
  f0OffsetsByGender[e.gender].push(got - e.f0);
  if (!errsByVowel[e.vowel]) errsByVowel[e.vowel] = [];
  errsByVowel[e.vowel].push(err);

  if (bucket === "halved" || bucket === "thirded" || bucket === "quartered") {
    subHarmonicCases.push({
      filename: e.filename,
      gender: e.gender,
      vowel: e.vowel,
      truthF0: e.f0,
      detected: got,
      bucket,
    });
  }
}

console.log(`  Tested ${total} files (${missing} returned null)`);
console.log(`  Male F0 error:    ${fmt(stats(errsByGender.m))}`);
console.log(`  Female F0 error:  ${fmt(stats(errsByGender.w))}`);

console.log(`\n  Octave-bucket census (raw detector):`);
const buckets = ["exact", "halved", "thirded", "quartered", "2x", "3x", "4x", "miss", "wild"];
for (const g of ["m", "w"]) {
  const total = Object.values(bucketsByGender[g]).reduce((a, b) => a + b, 0);
  const parts = buckets
    .map((b) => `${b}=${bucketsByGender[g][b] || 0}`)
    .join(" ");
  console.log(`    ${g === "m" ? "MALE  " : "FEMALE"} (n=${total}): ${parts}`);
}

console.log(`\n  Sub-harmonic-lock cases (${subHarmonicCases.length}):`);
for (const c of subHarmonicCases) {
  console.log(
    `    ${c.filename} /${c.vowel}/ truth=${c.truthF0.toFixed(0)} → ${c.detected.toFixed(0)} (${c.bucket})`,
  );
}

console.log(`\n  Per-vowel raw F0 error stats:`);
for (const [v, errs] of Object.entries(errsByVowel).sort()) {
  console.log(`    /${v}/  ${fmt(stats(errs))}`);
}

// Hard accuracy targets — these reflect the published characteristics
// (median error is the robust statistic; mean is dragged by the few
// sub-harmonic locks the smoothing layer is meant to mop up).
check(
  `male F0 median error < 5 Hz`,
  stats(errsByGender.m).median < 5,
  `got ${stats(errsByGender.m).median.toFixed(2)}`,
);
check(
  `female F0 median error < 10 Hz`,
  stats(errsByGender.w).median < 10,
  `got ${stats(errsByGender.w).median.toFixed(2)}`,
);
check(
  `male F0 p95 error < 20 Hz`,
  stats(errsByGender.m).p95 < 20,
  `got ${stats(errsByGender.m).p95.toFixed(2)}`,
);
// Sub-harmonic locks ARE the failure mode — bound their share, don't
// pretend they don't happen.
const subRate = subHarmonicCases.length / total;
check(
  `sub-harmonic lock rate < 8 % across the corpus`,
  subRate < 0.08,
  `got ${(subRate * 100).toFixed(2)} %`,
);

// ---------------------------------------------------------------------------
//  Pass 2 — smoothing layer end-to-end on the cases that raw-locked
// ---------------------------------------------------------------------------
//
// Production runs YIN on overlapping 50 ms windows ~30 times per second and
// passes each estimate through pushAndMedianPitch. Replicate that here on
// every file that single-window-locked sub-harmonically and see how often
// the layered defence recovers.

console.log(`\n[2] Smoothing layer recovery on sub-harmonic-lock files\n`);

const recoveryRows = [];
for (const c of subHarmonicCases) {
  const wavPath = join(DATA_DIR, c.gender === "m" ? "men" : "women", `${c.filename}.wav`);
  const { samples } = readWav(wavPath);
  // Step through overlapping 50-ms windows over the central ~70 % of the file.
  const winN = w16.windowSize;
  const hop = Math.floor(winN / 2); // 25 ms hop ≈ production cadence
  const startN = Math.floor(samples.length * 0.15);
  const endN = Math.floor(samples.length * 0.85);
  const buf = [];
  let final = null;
  let rawSeq = [];
  for (let i = startN; i + winN < endN; i += hop) {
    const win = samples.subarray(i, i + winN);
    const raw = w16.detectPitch(win, 16000);
    if (raw !== null) {
      rawSeq.push(Math.round(raw));
      final = pushAndMedianPitch(buf, raw);
    }
  }
  recoveryRows.push({
    file: c.filename,
    truth: c.truthF0,
    raw1: c.detected,
    bucket: c.bucket,
    final,
    rawSeq: rawSeq.slice(0, 12),
  });
}

let recovered = 0, stillStuck = 0;
console.log(
  `  ${"file".padEnd(7)} ${"truth".padStart(5)} ${"single".padStart(7)} ${"smoothed".padStart(8)} ${"bucket".padEnd(10)}  raw-sequence`,
);
for (const r of recoveryRows) {
  const ok = r.final !== null && Math.abs(r.final - r.truth) < Math.max(15, r.truth * 0.07);
  if (ok) recovered++;
  else stillStuck++;
  console.log(
    `  ${r.file.padEnd(7)} ${String(Math.round(r.truth)).padStart(5)} ${String(Math.round(r.raw1)).padStart(7)} ${String(r.final !== null ? Math.round(r.final) : "null").padStart(8)} ${r.bucket.padEnd(10)}  [${r.rawSeq.join(", ")}]  ${ok ? "✓" : "✗"}`,
  );
}

console.log(
  `\n  Recovered ${recovered}/${recoveryRows.length} sub-harmonic-lock cases via smoothing.`,
);

check(
  `smoothing recovers ≥ 50 % of single-window sub-harmonic locks`,
  recoveryRows.length === 0 || recovered / recoveryRows.length >= 0.5,
  `${recovered}/${recoveryRows.length}`,
);

// ---------------------------------------------------------------------------
//  Summary
// ---------------------------------------------------------------------------

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
