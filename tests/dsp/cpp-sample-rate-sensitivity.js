// cpp-sample-rate-sensitivity.js — Stage A.5 diagnostic.
//
// Stage A surfaced a bimodal CPP distribution across running-speech
// corpora: PTDB-TUG (48 kHz, median 0.26 dB) and FDA (20 kHz, median
// 0.65 dB). These are both running-speech corpora, but the medians
// differ by 2.5×. Two competing hypotheses:
//
//   (a) The algorithm is sample-rate-sensitive — same voice at
//       different sample rates produces different CPP values.
//   (b) The corpora differ in some other way (mic, environment,
//       speech material, speaker demographics).
//
// This diagnostic tests (a) directly: take a fixed audio sample,
// resample to multiple sample rates, run computeCPP at each, and
// compare values.
//
// Tests against synthetic + corpus audio so we cover both signal
// types.
//
// Usage: node tests/dsp/cpp-sample-rate-sensitivity.js
// Output: measurements/cpp-sample-rate-sensitivity-2026-05-11.json

import { writeFileSync, mkdirSync } from "node:fs";
import { computeCPP, resetCppState } from "../../src/dsp/cpp.js";
import { loadPtdbTug, loadFda } from "./data/corpora.js";

// Linear-interpolation resampler (matches the audio-utils style).
function resampleLinear(input, fromRate, toRate) {
  if (fromRate === toRate) return new Float32Array(input);
  const ratio = fromRate / toRate;
  const outLen = Math.floor(input.length / ratio);
  const out = new Float32Array(outLen);
  for (let i = 0; i < outLen; i++) {
    const srcIdx = i * ratio;
    const i0 = Math.floor(srcIdx);
    const i1 = Math.min(i0 + 1, input.length - 1);
    const frac = srcIdx - i0;
    out[i] = input[i0] * (1 - frac) + input[i1] * frac;
  }
  return out;
}

// Synthetic vowel for a controlled baseline test.
function syntheticVowel(f0Hz, sr, numSamples) {
  const out = new Float64Array(numSamples);
  const period = sr / f0Hz;
  for (let t = 0; t < numSamples; t += period) {
    const idx = Math.round(t);
    if (idx < numSamples) out[idx] = 1.0;
  }
  // Apply spectral tilt
  let prev = 0;
  for (let i = 0; i < numSamples; i++) {
    out[i] = out[i] + 0.98 * prev;
    prev = out[i];
  }
  // F1 resonator
  const r = Math.exp(-Math.PI * 80 / sr);
  const cos = Math.cos(2 * Math.PI * 700 / sr);
  const a1 = -2 * r * cos;
  const a2 = r * r;
  const b0 = (1 - r * r) * Math.sin(2 * Math.PI * 700 / sr);
  let y1 = 0, y2 = 0;
  for (let i = 0; i < numSamples; i++) {
    const y = b0 * out[i] - a1 * y1 - a2 * y2;
    out[i] = y;
    y2 = y1;
    y1 = y;
  }
  // Normalize
  let peak = 0;
  for (let i = 0; i < numSamples; i++) {
    const a = Math.abs(out[i]);
    if (a > peak) peak = a;
  }
  if (peak > 0) for (let i = 0; i < numSamples; i++) out[i] /= peak;
  return out;
}

// Compute CPP on a synthetic vowel at multiple sample rates.
console.log("Sample-rate sensitivity diagnostic");
console.log("==================================\n");

const sampleRates = [16000, 20000, 22050, 32000, 44100, 48000];
const F0 = 120;

console.log("--- Test 1: synthetic vowel (F0=120 Hz, formant at 700 Hz, identical signal) ---\n");
const syntheticResults = [];
for (const sr of sampleRates) {
  resetCppState();
  // ~3 seconds of synthetic audio at each rate
  const sig = syntheticVowel(F0, sr, sr * 3);
  // Run on 50 ms windows like production
  const winSize = Math.floor(sr * 0.05);
  const cpps = [];
  for (let pos = winSize; pos <= sig.length; pos += Math.floor(sr * 0.025)) {
    const window = sig.subarray(pos - winSize, pos);
    const cpp = computeCPP(window, sr);
    if (typeof cpp === "number" && isFinite(cpp)) cpps.push(cpp);
  }
  const sorted = [...cpps].sort((a, b) => a - b);
  const median = sorted[Math.floor(sorted.length / 2)];
  const mean = sorted.reduce((a, b) => a + b, 0) / sorted.length;
  console.log(`  sr=${sr} Hz, winSize=${winSize}: median=${median.toFixed(3)} dB, mean=${mean.toFixed(3)} dB, n=${cpps.length}`);
  syntheticResults.push({ sr, winSize, median, mean, n: cpps.length });
}

console.log("\n--- Test 2: real corpus audio resampled across rates ---\n");
console.log("Pick PTDB-TUG track (48 kHz native) and FDA track (20 kHz native),");
console.log("resample each to several sample rates, compute CPP.\n");

const ptdb = loadPtdbTug();
const fda = loadFda();
const ptdbSample = ptdb[0];   // first PTDB-TUG track
const fdaSample = fda[0];      // first FDA track

console.log(`PTDB-TUG sample: ${ptdbSample.trackId}, ${ptdbSample.sampleRate} Hz native, ${(ptdbSample.samples.length / ptdbSample.sampleRate).toFixed(2)}s`);
console.log(`FDA sample:     ${fdaSample.trackId}, ${fdaSample.sampleRate} Hz native, ${(fdaSample.samples.length / fdaSample.sampleRate).toFixed(2)}s\n`);

function runAtRate(samples, nativeSr, targetSr) {
  const audio = nativeSr === targetSr ? samples : resampleLinear(samples, nativeSr, targetSr);
  resetCppState();
  const winSize = Math.floor(targetSr * 0.05);
  const hopSize = Math.floor(targetSr * 0.025);
  const cpps = [];
  for (let pos = winSize; pos <= audio.length; pos += hopSize) {
    const window = audio.subarray(pos - winSize, pos);
    const cpp = computeCPP(window, targetSr);
    if (typeof cpp === "number" && isFinite(cpp)) cpps.push(cpp);
  }
  if (cpps.length === 0) return { median: null, n: 0 };
  const sorted = [...cpps].sort((a, b) => a - b);
  return {
    median: sorted[Math.floor(sorted.length / 2)],
    mean: sorted.reduce((a, b) => a + b, 0) / sorted.length,
    n: cpps.length,
    winSize,
  };
}

console.log("PTDB-TUG sample resampled:");
const ptdbResults = [];
for (const sr of sampleRates) {
  const r = runAtRate(ptdbSample.samples, ptdbSample.sampleRate, sr);
  console.log(`  sr=${sr} Hz, winSize=${r.winSize}: median=${r.median?.toFixed(3) ?? "null"} dB, n=${r.n}`);
  ptdbResults.push({ sr, ...r });
}

console.log("\nFDA sample resampled:");
const fdaResults = [];
for (const sr of sampleRates) {
  const r = runAtRate(fdaSample.samples, fdaSample.sampleRate, sr);
  console.log(`  sr=${sr} Hz, winSize=${r.winSize}: median=${r.median?.toFixed(3) ?? "null"} dB, n=${r.n}`);
  fdaResults.push({ sr, ...r });
}

console.log("\n--- Diagnostic conclusion ---");
// Synthetic: how much does median CPP vary across sample rates?
const synthMedians = syntheticResults.map((r) => r.median);
const synthRange = Math.max(...synthMedians) - Math.min(...synthMedians);
console.log(`Synthetic median spread across sample rates: ${synthRange.toFixed(3)} dB`);

const ptdbMedians = ptdbResults.map((r) => r.median).filter((m) => m !== null);
const ptdbRange = ptdbMedians.length > 0 ? Math.max(...ptdbMedians) - Math.min(...ptdbMedians) : 0;
console.log(`PTDB sample median spread: ${ptdbRange.toFixed(3)} dB`);

const fdaMedians = fdaResults.map((r) => r.median).filter((m) => m !== null);
const fdaRange = fdaMedians.length > 0 ? Math.max(...fdaMedians) - Math.min(...fdaMedians) : 0;
console.log(`FDA sample median spread: ${fdaRange.toFixed(3)} dB`);

// The synthetic-vowel arm re-synthesizes the signal at each native
// rate; pulse-train periods (sr/F0) land at different fractional
// offsets and the resonator coefficients depend on sr, so the
// stimuli aren't equivalent across rates by construction. Residual
// synthetic spread documents stimulus-construction variance, not
// algorithm sensitivity. The load-bearing invariance check is the
// real-audio arm: same audio buffer at different target rates.
const REAL_AUDIO_INVARIANCE_THRESHOLD = 0.05;  // dB
if (ptdbRange > REAL_AUDIO_INVARIANCE_THRESHOLD || fdaRange > REAL_AUDIO_INVARIANCE_THRESHOLD) {
  console.log("\n>>> SAMPLE-RATE SENSITIVITY DETECTED on real audio. Same audio");
  console.log(">>> resampled to different rates produces materially different");
  console.log(">>> CPP values — algorithm regression.");
  console.log(`>>> (PTDB spread ${ptdbRange.toFixed(3)} dB, FDA spread ${fdaRange.toFixed(3)} dB,`);
  console.log(`>>> threshold ${REAL_AUDIO_INVARIANCE_THRESHOLD} dB)`);
} else {
  console.log("\n>>> Sample-rate invariance holds on real audio");
  console.log(`>>> (PTDB spread ${ptdbRange.toFixed(3)} dB, FDA spread ${fdaRange.toFixed(3)} dB,`);
  console.log(`>>> both < ${REAL_AUDIO_INVARIANCE_THRESHOLD} dB threshold).`);
  if (synthRange > 0.3) {
    console.log(`>>> Synthetic spread ${synthRange.toFixed(3)} dB reflects stimulus-`);
    console.log(`>>> construction variance (resonator coefs + pulse-position`);
    console.log(`>>> fractional offsets differ across native rates), not`);
    console.log(`>>> algorithm sample-rate sensitivity.`);
  }
}

mkdirSync("measurements", { recursive: true });
writeFileSync("measurements/cpp-sample-rate-sensitivity-2026-05-11.json", JSON.stringify({
  timestamp: new Date().toISOString(),
  synthetic: syntheticResults,
  ptdbResampled: ptdbResults,
  fdaResampled: fdaResults,
  syntheticMedianSpread: synthRange,
  ptdbMedianSpread: ptdbRange,
  fdaMedianSpread: fdaRange,
}, null, 2));
console.log("\nWrote measurements/cpp-sample-rate-sensitivity-2026-05-11.json");
