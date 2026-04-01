// accuracy-test.js — Comprehensive pitch and formant accuracy test against
// the Hillenbrand et al. (1995) vowel dataset with real WAV recordings.
//
// Usage: node tests/dsp/accuracy-test.js
//
// Requires: tests/dsp/data/vowdata.dat, tests/dsp/data/men/*.wav, tests/dsp/data/women/*.wav
// (16 kHz, 16-bit PCM mono WAV files from the Hillenbrand dataset)
//
// Tests:
//   1. Synthetic pitch accuracy (pure tones + complex tones)
//   2. Real voice pitch accuracy (F0 vs Hillenbrand ground truth)
//   3. Real voice formant accuracy (F1/F2/F3 vs Hillenbrand ground truth)
//
// Reports per-sample errors and aggregate stats broken out by gender and vowel.

import { readFileSync, readdirSync, existsSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = join(__dirname, "data");

// ============================================================
//  DSP FUNCTIONS — exact copies from src/dsp/dsp-worker.js
// ============================================================

function fft(re, im) {
  const n = re.length;
  if (n === 0 || (n & (n - 1)) !== 0) {
    throw new Error(`FFT length must be a power of 2, got ${n}`);
  }
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      let tmp = re[i]; re[i] = re[j]; re[j] = tmp;
      tmp = im[i]; im[i] = im[j]; im[j] = tmp;
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const half = len >> 1;
    const angle = -2 * Math.PI / len;
    const wRe = Math.cos(angle);
    const wIm = Math.sin(angle);
    for (let i = 0; i < n; i += len) {
      let curRe = 1, curIm = 0;
      for (let j = 0; j < half; j++) {
        const a = i + j;
        const b = a + half;
        const tRe = curRe * re[b] - curIm * im[b];
        const tIm = curRe * im[b] + curIm * re[b];
        re[b] = re[a] - tRe;
        im[b] = im[a] - tIm;
        re[a] += tRe;
        im[a] += tIm;
        const nextRe = curRe * wRe - curIm * wIm;
        curIm = curRe * wIm + curIm * wRe;
        curRe = nextRe;
      }
    }
  }
}

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

function detectPitch(buffer, sr) {
  const threshold = 0.20;
  const minF0 = 75;
  const maxF0 = 600;
  const minLag = Math.floor(sr / maxF0);
  const maxLag = Math.floor(sr / minF0);
  const halfLen = Math.floor(buffer.length / 2);
  const searchLen = Math.min(maxLag + 2, halfLen);

  if (maxLag >= halfLen) return null;

  const N = buffer.length;
  let fftLen = 1;
  while (fftLen < N * 2) fftLen <<= 1;
  const re = new Float64Array(fftLen);
  const im = new Float64Array(fftLen);

  for (let i = 0; i < N; i++) re[i] = buffer[i];

  fft(re, im);
  for (let i = 0; i < fftLen; i++) {
    re[i] = re[i] * re[i] + im[i] * im[i];
    im[i] = 0;
  }
  fft(re, im);

  const diff = new Float32Array(searchLen);
  const cumSq = new Float64Array(N + 1);
  cumSq[0] = 0;
  for (let i = 0; i < N; i++) {
    cumSq[i + 1] = cumSq[i] + buffer[i] * buffer[i];
  }

  diff[0] = 0;
  for (let tau = 1; tau < searchLen; tau++) {
    const autocorr = re[tau] / fftLen;
    diff[tau] = cumSq[N - tau] + (cumSq[N] - cumSq[tau]) - 2 * autocorr;
  }

  const cmnd = new Float32Array(searchLen);
  cmnd[0] = 1;
  let runningSum = 0;
  for (let tau = 1; tau < searchLen; tau++) {
    runningSum += diff[tau];
    cmnd[tau] = diff[tau] / (runningSum / tau);
  }

  let bestTau = -1;
  for (let tau = minLag; tau < Math.min(maxLag, searchLen); tau++) {
    if (cmnd[tau] < threshold) {
      while (tau + 1 < searchLen && cmnd[tau + 1] < cmnd[tau]) tau++;
      bestTau = tau;
      break;
    }
  }

  if (bestTau === -1) return null;

  // Octave/harmonic error check
  const baseTau = bestTau;
  const bestFreq = sr / baseTau;
  const maxMult = (bestFreq > 300 && cmnd[baseTau] > 0.05) ? 4 : 2;
  for (let mult = 2; mult <= maxMult; mult++) {
    const multiTau = baseTau * mult;
    if (multiTau + 1 >= searchLen || multiTau >= maxLag) break;
    const searchStart = Math.max(minLag, Math.floor(multiTau * 0.9));
    const searchEnd = Math.min(Math.ceil(multiTau * 1.1), searchLen - 1, maxLag);
    let minCmndVal = cmnd[baseTau];
    let minTau = -1;
    for (let tau = searchStart; tau <= searchEnd; tau++) {
      if (cmnd[tau] < minCmndVal) {
        minCmndVal = cmnd[tau];
        minTau = tau;
      }
    }
    const relThresh = mult === 2 ? 0.65 : 0.4;
    const absOk = mult === 2 || minCmndVal < threshold * 0.5;
    if (minTau !== -1 && minCmndVal < cmnd[baseTau] * relThresh && absOk) {
      bestTau = minTau;
    }
  }

  const s0 = bestTau > 0 ? cmnd[bestTau - 1] : cmnd[bestTau];
  const s1 = cmnd[bestTau];
  const s2 = bestTau + 1 < searchLen ? cmnd[bestTau + 1] : cmnd[bestTau];
  const denom = 2 * (s0 - 2 * s1 + s2);
  let refinedTau = denom !== 0 ? bestTau + (s0 - s2) / denom : bestTau;

  const minTauVal = sr / maxF0;
  const maxTauVal = sr / minF0;
  refinedTau = Math.max(minTauVal, Math.min(maxTauVal, refinedTau));

  return sr / refinedTau;
}

const MAX_FORMANT_SR = 12000;
const LPC_ORDER_MALE = 10;
const LPC_ORDER_FEMALE = 12;

function extractFormants(buffer, sampleRate, detectedPitch) {
  // Pitch-adaptive decimation, LPC order, and formant ceiling (Praat-style)
  const baseDecFactor = Math.max(1, Math.ceil(sampleRate / MAX_FORMANT_SR));
  const isMale = detectedPitch !== null && detectedPitch !== undefined && detectedPitch < 140;
  const isFemale = detectedPitch === null || detectedPitch === undefined || detectedPitch >= 160;

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
//  SYNTHETIC TONE GENERATORS
// ============================================================

function generatePureTone(freq, sampleRate, durationMs) {
  const n = Math.floor(sampleRate * durationMs / 1000);
  const signal = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    signal[i] = 0.8 * Math.sin(2 * Math.PI * freq * i / sampleRate);
  }
  return signal;
}

function generateComplexTone(freq, sampleRate, durationMs) {
  const n = Math.floor(sampleRate * durationMs / 1000);
  const signal = new Float64Array(n);
  const numHarmonics = Math.floor((sampleRate / 2) / freq);
  for (let i = 0; i < n; i++) {
    let val = 0;
    for (let h = 1; h <= Math.min(numHarmonics, 15); h++) {
      // Natural spectral rolloff: -12 dB/octave
      const amp = 1.0 / (h * h);
      val += amp * Math.sin(2 * Math.PI * freq * h * i / sampleRate);
    }
    signal[i] = val;
  }
  // Normalize
  let maxAbs = 0;
  for (let i = 0; i < n; i++) if (Math.abs(signal[i]) > maxAbs) maxAbs = Math.abs(signal[i]);
  if (maxAbs > 0) for (let i = 0; i < n; i++) signal[i] *= 0.8 / maxAbs;
  return signal;
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
//  EXTRACT STABLE MIDDLE PORTION OF WAV
// ============================================================

function extractMiddleWindow(samples, sampleRate, windowMs) {
  // Use middle portion of the vowel for steady-state analysis
  const windowSamples = Math.floor(sampleRate * windowMs / 1000);
  const start = Math.max(0, Math.floor((samples.length - windowSamples) / 2));
  const end = Math.min(samples.length, start + windowSamples);
  return samples.subarray(start, end);
}

// ============================================================
//  TEST 1: SYNTHETIC PITCH ACCURACY
// ============================================================

function testSyntheticPitch() {
  console.log("================================================================");
  console.log("  TEST 1: Synthetic Pitch Accuracy");
  console.log("================================================================\n");

  const sampleRate = 48000;
  const windowMs = 50;
  const frequencies = [100, 120, 150, 180, 200, 220, 250, 300, 350, 400];

  console.log("--- Pure Tones (target: < 3 Hz error) ---");
  const pureErrors = [];
  for (const freq of frequencies) {
    const signal = generatePureTone(freq, sampleRate, windowMs);
    const detected = detectPitch(signal, sampleRate);
    const error = detected ? Math.abs(detected - freq) : Infinity;
    pureErrors.push(error);
    const pass = error < 3;
    console.log(
      `  ${pass ? "PASS" : "FAIL"}  ${String(freq).padStart(3)} Hz -> ` +
      `detected ${detected ? detected.toFixed(1) : "null"} Hz, error ${error.toFixed(2)} Hz`
    );
  }

  console.log("\n--- Complex Tones (fundamental + harmonics, target: < 5 Hz error) ---");
  const complexErrors = [];
  for (const freq of frequencies) {
    const signal = generateComplexTone(freq, sampleRate, windowMs);
    const detected = detectPitch(signal, sampleRate);
    const error = detected ? Math.abs(detected - freq) : Infinity;
    complexErrors.push(error);
    const pass = error < 5;
    console.log(
      `  ${pass ? "PASS" : "FAIL"}  ${String(freq).padStart(3)} Hz -> ` +
      `detected ${detected ? detected.toFixed(1) : "null"} Hz, error ${error.toFixed(2)} Hz`
    );
  }

  // Also test at 16 kHz (Hillenbrand sample rate)
  console.log("\n--- Complex Tones at 16 kHz sample rate ---");
  const complexErrors16k = [];
  for (const freq of frequencies) {
    const signal = generateComplexTone(freq, 16000, windowMs);
    const detected = detectPitch(signal, 16000);
    const error = detected ? Math.abs(detected - freq) : Infinity;
    complexErrors16k.push(error);
    const pass = error < 5;
    console.log(
      `  ${pass ? "PASS" : "FAIL"}  ${String(freq).padStart(3)} Hz -> ` +
      `detected ${detected ? detected.toFixed(1) : "null"} Hz, error ${error.toFixed(2)} Hz`
    );
  }

  const pureStats = stats(pureErrors.filter(e => isFinite(e)));
  const complexStats = stats(complexErrors.filter(e => isFinite(e)));
  const complex16kStats = stats(complexErrors16k.filter(e => isFinite(e)));

  console.log(`\nPure tone errors:      ${fmtStat(pureStats)}`);
  console.log(`Complex tone errors:   ${fmtStat(complexStats)}`);
  console.log(`Complex 16kHz errors:  ${fmtStat(complex16kStats)}`);

  return { pureErrors, complexErrors, complexErrors16k, pureStats, complexStats, complex16kStats };
}

// ============================================================
//  TEST 2: REAL VOICE ACCURACY (Hillenbrand dataset)
// ============================================================

function testRealVoices() {
  console.log("\n================================================================");
  console.log("  TEST 2: Real Voice Accuracy (Hillenbrand 1995)");
  console.log("================================================================\n");

  const vowdataPath = join(DATA_DIR, "vowdata.dat");
  if (!existsSync(vowdataPath)) {
    console.log("  SKIP: vowdata.dat not found");
    return null;
  }

  const entries = parseVowdata(vowdataPath);
  console.log(`Loaded ${entries.length} ground truth entries from vowdata.dat`);

  // Filter to men and women only (skip boys/girls)
  const maleEntries = entries.filter(e => e.gender === "m");
  const femaleEntries = entries.filter(e => e.gender === "w");
  console.log(`Males: ${maleEntries.length}, Females: ${femaleEntries.length}\n`);

  // Select a representative subset: up to 10 samples per gender per vowel
  // to keep runtime reasonable while covering all vowels
  const vowels = [...new Set(entries.map(e => e.vowel))];
  const selected = [];
  for (const gender of ["m", "w"]) {
    for (const vowel of vowels) {
      const matching = entries.filter(e => e.gender === gender && e.vowel === vowel);
      // Take first 5 per vowel-gender combo
      selected.push(...matching.slice(0, 5));
    }
  }
  console.log(`Selected ${selected.length} samples for testing (5 per vowel × gender)\n`);

  const results = { male: {}, female: {} };
  const allErrors = {
    male: { f0: [], f1: [], f2: [], f3: [] },
    female: { f0: [], f1: [], f2: [], f3: [] },
  };
  const vowelErrors = {};

  let tested = 0, skipped = 0;

  for (const entry of selected) {
    const dir = entry.gender === "m" ? "men" : "women";
    const wavPath = join(DATA_DIR, dir, entry.filename + ".wav");
    if (!existsSync(wavPath)) {
      skipped++;
      continue;
    }

    // Skip entries with zero (unmeasurable) formants
    if (entry.f0 === 0 || entry.f1 === 0 || entry.f2 === 0 || entry.f3 === 0) {
      skipped++;
      continue;
    }

    const { samples, sampleRate } = readWav(wavPath);

    // Use a 50ms window from the middle of the vowel (steady state)
    const window = extractMiddleWindow(samples, sampleRate, 50);

    // Detect pitch
    const detectedF0 = detectPitch(window, sampleRate);

    // Detect formants (pass pitch for adaptive LPC order)
    const formants = extractFormants(window, sampleRate, detectedF0);

    const genderKey = entry.gender === "m" ? "male" : "female";
    const f0err = detectedF0 ? Math.abs(detectedF0 - entry.f0) : null;
    const f1err = formants.f1 ? Math.abs(formants.f1 - entry.f1) : null;
    const f2err = formants.f2 ? Math.abs(formants.f2 - entry.f2) : null;
    const f3err = formants.f3 ? Math.abs(formants.f3 - entry.f3) : null;

    if (f0err !== null) allErrors[genderKey].f0.push(f0err);
    if (f1err !== null) allErrors[genderKey].f1.push(f1err);
    if (f2err !== null) allErrors[genderKey].f2.push(f2err);
    if (f3err !== null) allErrors[genderKey].f3.push(f3err);

    // Track per-vowel errors
    if (!vowelErrors[entry.vowel]) vowelErrors[entry.vowel] = { f0: [], f1: [], f2: [], f3: [] };
    if (f0err !== null) vowelErrors[entry.vowel].f0.push(f0err);
    if (f1err !== null) vowelErrors[entry.vowel].f1.push(f1err);
    if (f2err !== null) vowelErrors[entry.vowel].f2.push(f2err);
    if (f3err !== null) vowelErrors[entry.vowel].f3.push(f3err);

    // Detect systematic shifts (signed error for bias detection)
    const f0bias = detectedF0 ? detectedF0 - entry.f0 : null;
    const f1bias = formants.f1 ? formants.f1 - entry.f1 : null;
    const f2bias = formants.f2 ? formants.f2 - entry.f2 : null;
    const f3bias = formants.f3 ? formants.f3 - entry.f3 : null;

    if (!results[genderKey][entry.vowel]) results[genderKey][entry.vowel] = [];
    results[genderKey][entry.vowel].push({
      filename: entry.filename,
      expected: { f0: entry.f0, f1: entry.f1, f2: entry.f2, f3: entry.f3 },
      detected: {
        f0: detectedF0 ? Math.round(detectedF0) : null,
        f1: formants.f1 ? Math.round(formants.f1) : null,
        f2: formants.f2 ? Math.round(formants.f2) : null,
        f3: formants.f3 ? Math.round(formants.f3) : null,
      },
      errors: { f0: f0err, f1: f1err, f2: f2err, f3: f3err },
      bias: { f0: f0bias, f1: f1bias, f2: f2bias, f3: f3bias },
    });
    tested++;
  }

  console.log(`Tested: ${tested}, Skipped: ${skipped}\n`);

  // Print per-sample detail for a subset
  console.log("--- Sample Detail (first 3 per vowel-gender) ---");
  for (const genderKey of ["male", "female"]) {
    console.log(`\n  ${genderKey.toUpperCase()}:`);
    for (const vowel of vowels) {
      const samples = results[genderKey][vowel] || [];
      for (const s of samples.slice(0, 3)) {
        const e = s.errors;
        const d = s.detected;
        const x = s.expected;
        console.log(
          `    ${s.filename}  ` +
          `F0: ${x.f0}->${d.f0 ?? "---"} (${e.f0 !== null ? e.f0.toFixed(0) : "MISS"})  ` +
          `F1: ${x.f1}->${d.f1 ?? "---"} (${e.f1 !== null ? e.f1.toFixed(0) : "MISS"})  ` +
          `F2: ${x.f2}->${d.f2 ?? "---"} (${e.f2 !== null ? e.f2.toFixed(0) : "MISS"})  ` +
          `F3: ${x.f3}->${d.f3 ?? "---"} (${e.f3 !== null ? e.f3.toFixed(0) : "MISS"})`
        );
      }
    }
  }

  // Aggregate stats by gender
  console.log("\n--- Aggregate Error Stats by Gender ---");
  for (const genderKey of ["male", "female"]) {
    console.log(`\n  ${genderKey.toUpperCase()}:`);
    for (const metric of ["f0", "f1", "f2", "f3"]) {
      const errs = allErrors[genderKey][metric];
      if (errs.length > 0) {
        console.log(`    ${metric.toUpperCase()}: ${fmtStat(stats(errs))}`);
      } else {
        console.log(`    ${metric.toUpperCase()}: no data`);
      }
    }
  }

  // Aggregate stats by vowel
  console.log("\n--- Aggregate Error Stats by Vowel ---");
  for (const vowel of vowels) {
    const ve = vowelErrors[vowel];
    if (!ve || ve.f1.length === 0) continue;
    const f1s = stats(ve.f1);
    const f2s = stats(ve.f2);
    console.log(
      `  /${vowel.padEnd(2)}/  F1: mean=${f1s.mean.toFixed(0)} median=${f1s.median.toFixed(0)}  ` +
      `F2: mean=${f2s.mean.toFixed(0)} median=${f2s.median.toFixed(0)}  (n=${f1s.count})`
    );
  }

  // Signed bias analysis
  console.log("\n--- Signed Bias Analysis (positive = detected too high) ---");
  for (const genderKey of ["male", "female"]) {
    console.log(`\n  ${genderKey.toUpperCase()}:`);
    for (const metric of ["f0", "f1", "f2", "f3"]) {
      const biases = [];
      for (const vowel of vowels) {
        const samples = results[genderKey][vowel] || [];
        for (const s of samples) {
          if (s.bias[metric] !== null) biases.push(s.bias[metric]);
        }
      }
      if (biases.length > 0) {
        const s = stats(biases);
        const biasDir = s.mean > 0 ? "TOO HIGH" : "TOO LOW";
        console.log(`    ${metric.toUpperCase()}: mean bias=${s.mean.toFixed(1)} Hz (${biasDir}), std=${s.std.toFixed(1)}`);
      }
    }
  }

  return { allErrors, vowelErrors, results };
}

// ============================================================
//  MAIN
// ============================================================

console.log("Syrinx DSP Accuracy Test Suite");
console.log("Data source: Hillenbrand et al. (1995) vowel dataset");
console.log("WAV files: 16 kHz, 16-bit PCM mono");
console.log("Ground truth: Professional formant measurements (vowdata.dat)\n");

const pitchResults = testSyntheticPitch();
const voiceResults = testRealVoices();

// Final summary
console.log("\n================================================================");
console.log("  ACCURACY SUMMARY");
console.log("================================================================\n");

// Pitch targets
const pureFail = pitchResults.pureErrors.filter(e => e >= 3).length;
const complexFail = pitchResults.complexErrors.filter(e => e >= 5).length;
console.log(`Synthetic pitch (pure):    ${pureFail === 0 ? "PASS" : "FAIL"} (${pureFail}/${pitchResults.pureErrors.length} over 3 Hz)`);
console.log(`Synthetic pitch (complex): ${complexFail === 0 ? "PASS" : "FAIL"} (${complexFail}/${pitchResults.complexErrors.length} over 5 Hz)`);

if (voiceResults) {
  const { allErrors } = voiceResults;
  for (const gender of ["male", "female"]) {
    const f0s = stats(allErrors[gender].f0);
    const f1s = stats(allErrors[gender].f1);
    const f2s = stats(allErrors[gender].f2);
    const f3s = stats(allErrors[gender].f3);
    console.log(`\n${gender.toUpperCase()} voices:`);
    console.log(`  F0: mean=${f0s.mean.toFixed(1)} Hz  (target: < 10 Hz)  ${f0s.mean < 10 ? "PASS" : "FAIL"}`);
    console.log(`  F1: mean=${f1s.mean.toFixed(1)} Hz  (target: < 80 Hz)  ${f1s.mean < 80 ? "PASS" : "FAIL"}`);
    console.log(`  F2: mean=${f2s.mean.toFixed(1)} Hz  (target: < 120 Hz) ${f2s.mean < 120 ? "PASS" : "FAIL"}`);
    console.log(`  F3: mean=${f3s.mean.toFixed(1)} Hz  (n/a)`);
  }
}
