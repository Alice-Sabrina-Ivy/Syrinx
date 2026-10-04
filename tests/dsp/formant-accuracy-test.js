// formant-accuracy-test.js — Formant accuracy regression against the
// Hillenbrand et al. (1995) vowel dataset with real WAV recordings.
//
// Usage: node tests/dsp/formant-accuracy-test.js
//
// Requires: tests/dsp/data/vowdata.dat, tests/dsp/data/men/*.wav,
// tests/dsp/data/women/*.wav (16 kHz, 16-bit PCM mono WAV files from the
// Hillenbrand dataset).
//
// Runs the PRODUCTION formant extractor (src/dsp/formants.js — the module
// dsp-worker.js calls), not a copy. Until 2026-10-03 this file carried an
// inline copy of the worker's formant code that only ever ran at the
// corpus's native 16 kHz, so the male-branch LPC-order defect at the
// production capture rates (44.1/48 kHz) went unseen
// (measurements/formant-lpc-order-2026-10-03.md).
//
// Cases:
//   1. Native 16 kHz (8 kHz male / 16 kHz female analysis rate).
//   2. The same recordings band-limited-upsampled to 48 kHz and 44.1 kHz —
//      the rates production actually captures at (12 kHz / 11.025 kHz
//      analysis rate). The upsampled signal has no energy above 8 kHz,
//      which the formant path's own anti-alias filter removes anyway.
//   3. 48 kHz women with an octave-down (f0/2) pitch hint — the hint a
//      half-pitch detector error produces on a ~220 Hz voice; it selects
//      the male branch, which must not degrade women's formants.
//
// Pitch-adaptive LPC config: production feeds the formant extractor the
// pitch worker's output via the "pitch-hint" relay. Cases 1–2 use the
// vowdata.dat ground-truth F0 instead, isolating formant accuracy from
// pitch-detection accuracy.
//
// Exit code 0 = all gender-aggregate targets met, 1 = regression.

import { readFileSync, existsSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { configureFormants, extractFormants } from "../../src/dsp/formants.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = join(__dirname, "data");

// Production analysis window (dsp-worker.js WINDOW_MS).
const WINDOW_MS = 50;

// ============================================================
//  WAV FILE READER (16-bit PCM mono)
// ============================================================

function readWav(filePath) {
  const buf = readFileSync(filePath);
  if (buf.toString("ascii", 0, 4) !== "RIFF") throw new Error("Not a RIFF file");
  if (buf.toString("ascii", 8, 12) !== "WAVE") throw new Error("Not a WAVE file");

  let offset = 12;
  let sampleRate = 0;
  let bitsPerSample = 0;
  let dataStart = 0;
  let dataSize = 0;

  while (offset < buf.length - 8) {
    const chunkId = buf.toString("ascii", offset, offset + 4);
    const chunkSize = buf.readUInt32LE(offset + 4);
    if (chunkId === "fmt ") {
      sampleRate = buf.readUInt32LE(offset + 12);
      bitsPerSample = buf.readUInt16LE(offset + 22);
    } else if (chunkId === "data") {
      dataStart = offset + 8;
      dataSize = chunkSize;
      break;
    }
    offset += 8 + chunkSize;
  }

  if (dataStart === 0) throw new Error("No data chunk found");

  const numSamples = dataSize / (bitsPerSample / 8);
  const samples = new Float64Array(numSamples);
  for (let i = 0; i < numSamples; i++) {
    samples[i] = buf.readInt16LE(dataStart + i * 2) / 32768;
  }

  return { samples, sampleRate };
}

// ============================================================
//  HILLENBRAND DATA PARSER
// ============================================================

function parseVowdata(filePath) {
  const text = readFileSync(filePath, "utf8");
  const entries = [];
  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    // Data lines start with m/w/b/g followed by digits
    if (!/^[mwbg]\d/.test(trimmed)) continue;
    const parts = trimmed.split(/\s+/);
    if (parts.length < 7) continue;
    const filename = parts[0];
    entries.push({
      filename,
      gender: filename[0], // m, w, b, g
      vowel: filename.slice(3), // ae, ah, aw, etc.
      duration: parseFloat(parts[1]),
      f0: parseFloat(parts[2]),
      f1: parseFloat(parts[3]),
      f2: parseFloat(parts[4]),
      f3: parseFloat(parts[5]),
      f4: parseFloat(parts[6]),
    });
  }
  return entries;
}

// ============================================================
//  WINDOWING + BAND-LIMITED UPSAMPLING (test infrastructure)
// ============================================================

// Middle 50 ms of the vowel at the given rate (steady-state portion).
function middleWindowSpan(numSamples, sampleRate) {
  const len = Math.floor(sampleRate * WINDOW_MS / 1000);
  const start = Math.max(0, Math.floor((numSamples - len) / 2));
  return { start, len };
}

// Rational resampler: Hann-windowed sinc, half-width 32 input samples,
// cutoff 0.47 × input rate. Computes only output samples [start, start+len)
// so just the analysis window is synthesized. Matches scipy
// resample_poly to within ~1 Hz of formant error on this corpus.
function resampleSpan(x, srIn, srOut, start, len) {
  const y = new Float32Array(len);
  const half = 32;
  const fc = 0.94; // cutoff as a fraction of the input Nyquist
  for (let n = 0; n < len; n++) {
    const t = (start + n) * srIn / srOut;
    const c = Math.floor(t);
    let acc = 0;
    for (let k = c - half + 1; k <= c + half; k++) {
      if (k < 0 || k >= x.length) continue;
      const d = t - k;
      const s = d === 0 ? fc : Math.sin(Math.PI * fc * d) / (Math.PI * d);
      acc += x[k] * s * (0.5 + 0.5 * Math.cos(Math.PI * d / half));
    }
    y[n] = acc;
  }
  return y;
}

function analysisWindow(samples, srIn, srOut) {
  if (srOut === srIn) {
    const { start, len } = middleWindowSpan(samples.length, srIn);
    return Float32Array.from(samples.subarray(start, start + len));
  }
  const outLen = Math.floor(samples.length * srOut / srIn);
  const { start, len } = middleWindowSpan(outLen, srOut);
  return resampleSpan(samples, srIn, srOut, start, len);
}

// ============================================================
//  STATISTICS HELPERS
// ============================================================

function stats(arr) {
  if (arr.length === 0) return { mean: NaN, median: NaN, max: NaN, std: NaN, count: 0 };
  const sorted = [...arr].sort((a, b) => a - b);
  const mean = arr.reduce((s, v) => s + v, 0) / arr.length;
  const median = sorted[Math.floor(sorted.length / 2)];
  const max = sorted[sorted.length - 1];
  const variance = arr.reduce((s, v) => s + (v - mean) ** 2, 0) / arr.length;
  return { mean, median, max, std: Math.sqrt(variance), count: arr.length };
}

function fmtStat(s) {
  return `mean=${s.mean.toFixed(1)} median=${s.median.toFixed(1)} max=${s.max.toFixed(1)} std=${s.std.toFixed(1)} (n=${s.count})`;
}

// ============================================================
//  MAIN
// ============================================================

console.log("Syrinx formant accuracy test");
console.log("Data source: Hillenbrand et al. (1995) vowel dataset");
console.log("Ground truth: professional formant measurements (vowdata.dat)");
console.log("Extractor: src/dsp/formants.js (production)\n");

const vowdataPath = join(DATA_DIR, "vowdata.dat");
if (!existsSync(vowdataPath)) {
  console.log("SKIP: vowdata.dat not found");
  process.exit(0);
}

const entries = parseVowdata(vowdataPath);

// Men and women only (skip boys/girls); representative subset of 5
// samples per gender × vowel — same selection as the retired
// accuracy-test.js so historical numbers stay comparable.
const vowels = [...new Set(entries.map((e) => e.vowel))];
const selected = [];
for (const gender of ["m", "w"]) {
  for (const vowel of vowels) {
    const matching = entries.filter((e) => e.gender === gender && e.vowel === vowel);
    selected.push(...matching.slice(0, 5));
  }
}
const usable = selected.filter((e) => {
  const wavPath = join(DATA_DIR, e.gender === "m" ? "men" : "women", e.filename + ".wav");
  // Skip missing files and entries with zero (unmeasurable) formants
  return existsSync(wavPath) && e.f0 !== 0 && e.f1 !== 0 && e.f2 !== 0 && e.f3 !== 0;
});
console.log(`Selected ${selected.length} samples (5 per vowel × gender), usable ${usable.length}\n`);
const audio = new Map(usable.map((e) => [
  e.filename,
  readWav(join(DATA_DIR, e.gender === "m" ? "men" : "women", e.filename + ".wav")),
]));

// Run one case; returns { male, female } per-formant absolute errors.
function runCase(captureRate, { hintScale = 1, genders = ["m", "w"], perVowel = null } = {}) {
  configureFormants(captureRate, Math.floor(captureRate * WINDOW_MS / 1000));
  const errs = { male: { f1: [], f2: [], f3: [] }, female: { f1: [], f2: [], f3: [] } };
  for (const entry of usable) {
    if (!genders.includes(entry.gender)) continue;
    const { samples, sampleRate } = audio.get(entry.filename);
    const window = analysisWindow(samples, sampleRate, captureRate);
    const formants = extractFormants(window, entry.f0 * hintScale);
    const genderKey = entry.gender === "m" ? "male" : "female";
    if (perVowel && !perVowel[entry.vowel]) perVowel[entry.vowel] = { f1: [], f2: [] };
    for (const metric of ["f1", "f2", "f3"]) {
      if (formants[metric]) {
        const err = Math.abs(formants[metric] - entry[metric]);
        errs[genderKey][metric].push(err);
        if (perVowel && metric !== "f3") perVowel[entry.vowel][metric].push(err);
      }
    }
  }
  return errs;
}

let failed = 0;
// Gender-aggregate mean targets. F1 < 80 / F2 < 120 Hz at native 16 kHz
// (the retired accuracy-test.js targets). At 44.1/48 kHz F2 < 160 Hz:
// measured 2026-10-03 after the LPC-order fix — 48 kHz men 122.8 / women
// 107.1, 44.1 kHz men 88.7 / women 144.0 (women's 44.1 kHz F2 is limited by
// the 11.025 kHz analysis rate, a separate follow-up); before the fix 48 kHz
// men measured 554.5 and 44.1 kHz men 279.7, so the target catches it.
function check(label, errs, genders, f1Target, f2Target) {
  for (const genderKey of genders) {
    const f1s = stats(errs[genderKey].f1);
    const f2s = stats(errs[genderKey].f2);
    const f1Pass = f1s.mean < f1Target;
    const f2Pass = f2s.mean < f2Target;
    if (!f1Pass || !f2Pass) failed++;
    console.log(`${label} ${genderKey.toUpperCase().padEnd(6)}: F1 mean=${f1s.mean.toFixed(1)} Hz (target < ${f1Target}) ${f1Pass ? "PASS" : "FAIL"}  ` +
      `F2 mean=${f2s.mean.toFixed(1)} Hz (target < ${f2Target}) ${f2Pass ? "PASS" : "FAIL"}`);
  }
}

// --- Case 1: native 16 kHz, with full breakdown ---
const vowelErrors = {};
const native = runCase(16000, { perVowel: vowelErrors });
console.log("--- 16 kHz: aggregate error stats by gender ---");
for (const genderKey of ["male", "female"]) {
  console.log(`\n  ${genderKey.toUpperCase()}:`);
  for (const metric of ["f1", "f2", "f3"]) {
    const errs = native[genderKey][metric];
    console.log(`    ${metric.toUpperCase()}: ${errs.length > 0 ? fmtStat(stats(errs)) : "no data"}`);
  }
}
console.log("\n--- 16 kHz: aggregate error stats by vowel ---");
for (const vowel of vowels) {
  const ve = vowelErrors[vowel];
  if (!ve || ve.f1.length === 0) continue;
  const f1s = stats(ve.f1);
  const f2s = stats(ve.f2);
  console.log(
    `  /${vowel.padEnd(2)}/  F1: mean=${f1s.mean.toFixed(0)} median=${f1s.median.toFixed(0)}  ` +
    `F2: mean=${f2s.mean.toFixed(0)} median=${f2s.median.toFixed(0)}  (n=${f1s.count})`,
  );
}

console.log("\n--- Summary ---");
check("16 kHz       ", native, ["male", "female"], 80, 120);

// --- Case 2: production capture rates ---
check("48 kHz       ", runCase(48000), ["male", "female"], 80, 160);
check("44.1 kHz     ", runCase(44100), ["male", "female"], 80, 160);

// --- Case 3: octave-down pitch hint on women's vowels (selects the male branch) ---
check("48 kHz f0/2  ", runCase(48000, { hintScale: 0.5, genders: ["w"] }), ["female"], 80, 160);

process.exit(failed === 0 ? 0 : 1);
