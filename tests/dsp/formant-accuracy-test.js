// formant-accuracy-test.js — Formant accuracy regression against the
// Hillenbrand et al. (1995) vowel dataset with real WAV recordings.
//
// Usage: node tests/dsp/formant-accuracy-test.js
//
// Requires: tests/dsp/data/vowdata.dat, tests/dsp/data/men/*.wav,
// tests/dsp/data/women/*.wav (16 kHz, 16-bit PCM mono WAV files from the
// Hillenbrand dataset).
//
// Ported from the formant half of the retired accuracy-test.js
// (2026-06-09). That file's pitch tests drove pYIN's detectPitch via a
// vm-loaded dsp-worker.js; pitch detection moved to SwiftF0 in
// pitch-worker.js at the Stage 4 cutover (2026-05-06), so the pitch
// half was dead and the SwiftF0 harnesses (pitch-bucket-harness-swift.js,
// swift-f0-streaming-verify.js) supersede it. The formant-accuracy test
// below was the file's remaining unique coverage: real-recording
// validation against professional formant measurements (formant-debug.js
// covers synthetic vowels only).
//
// The formant DSP functions are an inline copy of the dsp-worker.js
// pipeline (pre-emphasis → Hamming → decimate → Burg LPC → root
// finding), as they were in the original file — keep them in sync with
// src/dsp/dsp-worker.js when the formant pipeline changes.
//
// Pitch-adaptive LPC config: production feeds the formant extractor
// SwiftF0's detected pitch via the "pitch-hint" relay. Here we use the
// vowdata.dat ground-truth F0 instead, isolating formant accuracy from
// pitch-detection accuracy (a pitch error would otherwise shift the
// male/female LPC-order selection and confound the regression signal).
//
// Exit code 0 = all gender-aggregate targets met, 1 = regression.

import { readFileSync, existsSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = join(__dirname, "data");

// ============================================================
//  DSP FUNCTIONS — must match src/dsp/dsp-worker.js
// ============================================================

function designLowPassFIR(cutoffNormalized, numTaps) {
  const coeffs = new Float64Array(numTaps);
  const mid = (numTaps - 1) / 2;
  for (let i = 0; i < numTaps; i++) {
    const x = i - mid;
    let sinc;
    if (Math.abs(x) < 1e-10) {
      sinc = 2 * cutoffNormalized;
    } else {
      sinc = Math.sin(2 * Math.PI * cutoffNormalized * x) / (Math.PI * x);
    }
    const win = 0.42 - 0.5 * Math.cos((2 * Math.PI * i) / (numTaps - 1))
                     + 0.08 * Math.cos((4 * Math.PI * i) / (numTaps - 1));
    coeffs[i] = sinc * win;
  }
  let sum = 0;
  for (let i = 0; i < numTaps; i++) sum += coeffs[i];
  for (let i = 0; i < numTaps; i++) coeffs[i] /= sum;
  return coeffs;
}

const MAX_FORMANT_SR = 12000;
const LPC_ORDER_MALE = 10;
const LPC_ORDER_FEMALE = 12;

function extractFormants(buffer, sampleRate, detectedPitch) {
  // Pitch-adaptive decimation, LPC order, and formant ceiling (Praat-style)
  const baseDecFactor = Math.max(1, Math.ceil(sampleRate / MAX_FORMANT_SR));
  const isMale = detectedPitch !== null && detectedPitch !== undefined && detectedPitch < 140;

  let effectiveDecFactor, effectiveTargetSR, lpcOrder, maxFormant;

  if (isMale) {
    effectiveDecFactor = baseDecFactor;
    effectiveTargetSR = sampleRate / effectiveDecFactor;
    lpcOrder = LPC_ORDER_MALE;
    maxFormant = 5000;
  } else {
    // Female: need higher targetSR (≥11 kHz) for formants up to 5500 Hz
    effectiveDecFactor = baseDecFactor;
    effectiveTargetSR = sampleRate / effectiveDecFactor;
    const minTargetSR = 11000;
    while (effectiveDecFactor > 1 && sampleRate / effectiveDecFactor < minTargetSR) {
      effectiveDecFactor--;
    }
    effectiveTargetSR = sampleRate / effectiveDecFactor;
    // Scale LPC order to match the effective bandwidth
    lpcOrder = Math.min(16, Math.max(LPC_ORDER_FEMALE, Math.ceil(5 * effectiveTargetSR / 11000) * 2));
    maxFormant = 5500;
  }

  const antiAliasFilter = designLowPassFIR(0.45 / effectiveDecFactor, effectiveDecFactor * 16 + 1);
  const n = buffer.length;

  // Pre-emphasis
  const preEmph = new Float64Array(n);
  preEmph[0] = buffer[0];
  for (let i = 1; i < n; i++) {
    preEmph[i] = buffer[i] - 0.97 * buffer[i - 1];
  }

  // Hamming window
  const windowed = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    windowed[i] = preEmph[i] * (0.54 - 0.46 * Math.cos((2 * Math.PI * i) / (n - 1)));
  }

  // Decimate
  const decimated = decimateWithFilter(windowed, effectiveDecFactor, antiAliasFilter);

  // Burg LPC
  const coefficients = burgLPC(decimated, lpcOrder);

  // Root finding
  const roots = findPolynomialRoots(coefficients);

  // Convert roots to formants
  const formants = [];
  for (let i = 0; i < roots.length; i++) {
    if (roots[i].imag <= 0) continue;
    const freq = (Math.atan2(roots[i].imag, roots[i].real) * effectiveTargetSR) / (2 * Math.PI);
    const mag = Math.sqrt(roots[i].real * roots[i].real + roots[i].imag * roots[i].imag);
    const bw = mag > 0 ? (-Math.log(mag) * effectiveTargetSR) / Math.PI : Infinity;
    if (freq > 90 && freq < maxFormant && bw > 0 && bw < 600) {
      formants.push({ freq, bw });
    }
  }
  formants.sort((a, b) => a.freq - b.freq);

  return {
    f1: formants[0]?.freq || null,
    f2: formants[1]?.freq || null,
    f3: formants[2]?.freq || null,
  };
}

function decimateWithFilter(buffer, factor, taps) {
  if (factor <= 1) return Float64Array.from(buffer);
  const numTaps = taps.length;
  const halfTaps = numTaps >> 1;
  const bufLen = buffer.length;
  const newLen = Math.floor(bufLen / factor);
  const result = new Float64Array(newLen);
  for (let i = 0; i < newLen; i++) {
    let sum = 0;
    const center = i * factor;
    const jStart = Math.max(0, halfTaps - center);
    const jEnd = Math.min(numTaps, bufLen - center + halfTaps);
    for (let j = jStart; j < jEnd; j++) {
      sum += buffer[center - halfTaps + j] * taps[j];
    }
    result[i] = sum;
  }
  return result;
}

function burgLPC(samples, order) {
  const n = samples.length;
  const a = new Float64Array(order + 1);
  a[0] = 1;
  let ef = Float64Array.from(samples);
  let eb = Float64Array.from(samples);
  for (let m = 1; m <= order; m++) {
    let num = 0, den = 0;
    for (let i = m; i < n; i++) {
      num += ef[i] * eb[i - 1];
      den += ef[i] * ef[i] + eb[i - 1] * eb[i - 1];
    }
    if (den === 0) break;
    const k = (-2 * num) / den;
    const aNew = new Float64Array(order + 1);
    aNew[0] = 1;
    for (let i = 1; i < m; i++) aNew[i] = a[i] + k * a[m - i];
    aNew[m] = k;
    const efNew = new Float64Array(n);
    const ebNew = new Float64Array(n);
    for (let i = m; i < n; i++) {
      efNew[i] = ef[i] + k * eb[i - 1];
      ebNew[i] = eb[i - 1] + k * ef[i];
    }
    ef = efNew;
    eb = ebNew;
    a.set(aNew);
  }
  return a;
}

function findPolynomialRoots(coefficients) {
  const n = coefficients.length - 1;
  if (n <= 0) return [];
  const roots = [];
  for (let i = 0; i < n; i++) {
    const angle = (2 * Math.PI * i) / n + 0.4;
    roots.push({ real: 0.9 * Math.cos(angle), imag: 0.9 * Math.sin(angle) });
  }
  for (let iter = 0; iter < 50; iter++) {
    let maxDelta = 0;
    for (let i = 0; i < n; i++) {
      let pr = coefficients[0], pi = 0;
      for (let j = 1; j <= n; j++) {
        const newR = pr * roots[i].real - pi * roots[i].imag + coefficients[j];
        const newI = pr * roots[i].imag + pi * roots[i].real;
        pr = newR;
        pi = newI;
      }
      let qr = 1, qi = 0;
      for (let j = 0; j < n; j++) {
        if (j === i) continue;
        const dr = roots[i].real - roots[j].real;
        const di = roots[i].imag - roots[j].imag;
        const newR = qr * dr - qi * di;
        const newI = qr * di + qi * dr;
        qr = newR;
        qi = newI;
      }
      const denom = qr * qr + qi * qi;
      if (denom < 1e-30) continue;
      const deltaR = (pr * qr + pi * qi) / denom;
      const deltaI = (pi * qr - pr * qi) / denom;
      roots[i].real -= deltaR;
      roots[i].imag -= deltaI;
      const mag = Math.sqrt(deltaR * deltaR + deltaI * deltaI);
      if (mag > maxDelta) maxDelta = mag;
    }
    if (maxDelta < 1e-10) break;
  }
  return roots;
}

// ============================================================
//  WAV FILE READER (16-bit PCM mono)
// ============================================================

function readWav(filePath) {
  const buf = readFileSync(filePath);
  // Parse RIFF header
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
    const sample = buf.readInt16LE(dataStart + i * 2);
    samples[i] = sample / 32768;
  }

  return { samples, sampleRate };
}

// ============================================================
//  HILLENBRAND DATA PARSER
// ============================================================

function parseVowdata(filePath) {
  const text = readFileSync(filePath, "utf8");
  const lines = text.split("\n");
  const entries = [];
  for (const line of lines) {
    const trimmed = line.trim();
    // Data lines start with m/w/b/g followed by digits
    if (!/^[mwbg]\d/.test(trimmed)) continue;
    const parts = trimmed.split(/\s+/);
    if (parts.length < 7) continue;
    const filename = parts[0];
    const gender = filename[0]; // m, w, b, g
    const vowel = filename.slice(3); // ae, ah, aw, etc.
    entries.push({
      filename,
      gender,
      vowel,
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

function extractMiddleWindow(samples, sampleRate, windowMs) {
  // Use middle portion of the vowel for steady-state analysis
  const windowSamples = Math.floor(sampleRate * windowMs / 1000);
  const start = Math.max(0, Math.floor((samples.length - windowSamples) / 2));
  const end = Math.min(samples.length, start + windowSamples);
  return samples.subarray(start, end);
}

// ============================================================
//  MAIN
// ============================================================

console.log("Syrinx formant accuracy test");
console.log("Data source: Hillenbrand et al. (1995) vowel dataset");
console.log("Ground truth: professional formant measurements (vowdata.dat)");
console.log("LPC config pitch: ground-truth F0 (isolates formants from pitch detection)\n");

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
console.log(`Selected ${selected.length} samples (5 per vowel × gender)\n`);

const allErrors = {
  male: { f1: [], f2: [], f3: [] },
  female: { f1: [], f2: [], f3: [] },
};
const vowelErrors = {};
let tested = 0, skipped = 0;

for (const entry of selected) {
  const dir = entry.gender === "m" ? "men" : "women";
  const wavPath = join(DATA_DIR, dir, entry.filename + ".wav");
  if (!existsSync(wavPath)) { skipped++; continue; }
  // Skip entries with zero (unmeasurable) formants
  if (entry.f0 === 0 || entry.f1 === 0 || entry.f2 === 0 || entry.f3 === 0) {
    skipped++;
    continue;
  }

  const { samples, sampleRate } = readWav(wavPath);
  const window = extractMiddleWindow(samples, sampleRate, 50);
  const formants = extractFormants(window, sampleRate, entry.f0);

  const genderKey = entry.gender === "m" ? "male" : "female";
  if (!vowelErrors[entry.vowel]) vowelErrors[entry.vowel] = { f1: [], f2: [] };
  for (const metric of ["f1", "f2", "f3"]) {
    if (formants[metric]) {
      const err = Math.abs(formants[metric] - entry[metric]);
      allErrors[genderKey][metric].push(err);
      if (metric !== "f3") vowelErrors[entry.vowel][metric].push(err);
    }
  }
  tested++;
}

console.log(`Tested: ${tested}, Skipped: ${skipped}\n`);

console.log("--- Aggregate error stats by gender ---");
for (const genderKey of ["male", "female"]) {
  console.log(`\n  ${genderKey.toUpperCase()}:`);
  for (const metric of ["f1", "f2", "f3"]) {
    const errs = allErrors[genderKey][metric];
    console.log(`    ${metric.toUpperCase()}: ${errs.length > 0 ? fmtStat(stats(errs)) : "no data"}`);
  }
}

console.log("\n--- Aggregate error stats by vowel ---");
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

// Pass/fail — same gender-aggregate mean targets the retired
// accuracy-test.js printed (F1 < 80 Hz, F2 < 120 Hz), now enforced via
// exit code per the repo's test-script convention.
console.log("\n--- Summary ---");
let failed = 0;
for (const genderKey of ["male", "female"]) {
  const f1s = stats(allErrors[genderKey].f1);
  const f2s = stats(allErrors[genderKey].f2);
  const f1Pass = f1s.mean < 80;
  const f2Pass = f2s.mean < 120;
  if (!f1Pass || !f2Pass) failed++;
  console.log(`${genderKey.toUpperCase()}: F1 mean=${f1s.mean.toFixed(1)} Hz (target < 80) ${f1Pass ? "PASS" : "FAIL"}  ` +
    `F2 mean=${f2s.mean.toFixed(1)} Hz (target < 120) ${f2Pass ? "PASS" : "FAIL"}`);
}
process.exit(failed === 0 ? 0 : 1);
