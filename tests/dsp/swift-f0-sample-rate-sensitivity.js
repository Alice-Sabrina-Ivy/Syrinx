// swift-f0-sample-rate-sensitivity.js — Q2 of the prod-vs-dev pitch
// discrepancy investigation.
//
// Question: does the source sample rate (before pitch-worker's
// resample-to-16-kHz pass) affect SwiftF0's response to the
// harmonic-stack-175Hz reproducer? Specifically: does linear-interp
// downsampling from 44.1 kHz (non-integer ratio 2.756) produce
// audibly different behavior than from 32 kHz (clean integer 2.0) or
// 48 kHz (clean integer 3.0)?
//
// Approach: take a clean low-F0 corpus track + harmonic-stack interferer
// at a fixed SNR. Resample to several "source rates" using linear
// interpolation (matching what the browser-side resampler would do
// for non-native rates), then resample BACK to 16 kHz via the same
// linear-interp the pitch-worker uses. Run SwiftF0 on the result.
// Compare octave-up rates across source rates.
//
// If results differ materially across source rates, the prod-vs-dev
// discrepancy is plausibly explained by different sample rates between
// the two tabs.
//
// If results are essentially identical, the discrepancy is more
// likely environmental (intermittent interferer level) rather than
// configuration-driven.
//
// Usage:  node tests/dsp/swift-f0-sample-rate-sensitivity.js
// Output: measurements/swift-f0-sample-rate-sensitivity-2026-05-12.json

import { writeFileSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { loadPtdbTug } from "./data/corpora.js";
import {
  createSwiftF0Session,
  detectPitch,
  resampleLinear,
} from "./swift-f0-adapter.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "../..");

const CONFIDENCE_THRESHOLD = 0.5;
const TARGET_SR = 16000;
const INTERFERER_HZ = 175;
const TEST_SNRS_DB = [20, 10, 0, -10];
// Source rates to test. Includes:
//   - 16 kHz: no resampling (baseline)
//   - 22.05 kHz: non-integer ratio 1.378
//   - 32 kHz: integer ratio 2.0 (matches user's dev observation)
//   - 44.1 kHz: non-integer ratio 2.756 (common browser default)
//   - 48 kHz: integer ratio 3.0 (Chrome default on many systems)
const SOURCE_RATES = [16000, 22050, 32000, 44100, 48000];

function classifyError(reportedHz, truthHz) {
  if (!(reportedHz > 0) || !(truthHz > 0)) return "null";
  const tolHz = truthHz * 0.05;
  if (Math.abs(reportedHz - truthHz) < tolHz) return "correct";
  const r = reportedHz / truthHz;
  if (r >= 1.5) {
    const nearest = Math.round(r);
    if (nearest >= 2 && Math.abs(r - nearest) / nearest < 0.05) return "octave-up";
  }
  const d = 1 / r;
  if (d >= 1.5) {
    const nearest = Math.round(d);
    if (nearest >= 2 && Math.abs(d - nearest) / nearest < 0.05) return "octave-down";
  }
  return "other-error";
}

function summarize(pitchHz, confidence, truthHz) {
  const counts = { null: 0, correct: 0, "octave-up": 0,
                   "octave-down": 0, "other-error": 0 };
  let total = 0;
  const reported = [];
  for (let i = 8; i < pitchHz.length; i++) {
    const conf = confidence[i];
    const r = conf >= CONFIDENCE_THRESHOLD ? pitchHz[i] : 0;
    const label = r === 0 ? "null" : classifyError(r, truthHz);
    counts[label]++;
    total++;
    if (r > 0) reported.push(r);
  }
  return {
    total,
    counts,
    correctRate: total > 0 ? counts.correct / total : 0,
    octaveUpRate: total > 0 ? counts["octave-up"] / total : 0,
    nullRate: total > 0 ? counts.null / total : 0,
    meanReportedHz: reported.length > 0
      ? reported.reduce((a, b) => a + b, 0) / reported.length
      : 0,
  };
}

console.log("SwiftF0 sample-rate sensitivity (Q2)");
console.log("=====================================");
console.log(`  Source rates: ${SOURCE_RATES.join(", ")} Hz`);
console.log(`  Interferer: harmonic stack rooted at ${INTERFERER_HZ} Hz`);
console.log(`  SNRs: ${TEST_SNRS_DB.join(", ")} dB`);
console.log("");

console.log("Loading model + corpus...");
const { session, inputName } = await createSwiftF0Session();
const corpus = loadPtdbTug();
const baseTrack = corpus.find((t) => t.trackId === "mic_M02_sx83");
if (!baseTrack) {
  console.error("base track mic_M02_sx83 not in corpus");
  process.exit(1);
}

// Start with the corpus track at its native rate (48 kHz)
let baseNative = baseTrack.samples;
const baseNativeRate = baseTrack.sampleRate;
console.log(`base track: ${baseTrack.trackId}, native ${baseNativeRate} Hz, ${(baseNative.length / baseNativeRate).toFixed(1)} s`);
const truthHz = 83.7;

const harmonicAmps = [1.0, 0.5, 0.25, 0.125, 0.0625];
let stackEnergy = 0;
for (const a of harmonicAmps) stackEnergy += a * a / 2;

const allResults = [];

console.log("");
console.log(`  source rate | SNR dB | correct% | oct-up% | null% | mean reported Hz`);
console.log(`  ------------|--------|----------|---------|-------|------------------`);
for (const sourceRate of SOURCE_RATES) {
  // Step 1: resample the clean base track to the source rate.
  // (If sourceRate == 16000, this is a downsample. If 48000, no change.)
  const baseAtSource = sourceRate === baseNativeRate
    ? baseNative
    : resampleLinear(baseNative, baseNativeRate, sourceRate);

  for (const snrDb of TEST_SNRS_DB) {
    // Compute RMS at source rate, build interferer at source rate, mix.
    let sigSumSq = 0;
    for (let i = 0; i < baseAtSource.length; i++) sigSumSq += baseAtSource[i] * baseAtSource[i];
    const sigRms = Math.sqrt(sigSumSq / baseAtSource.length);
    const noiseRms = sigRms / Math.pow(10, snrDb / 20);
    const stackNorm = noiseRms / Math.sqrt(stackEnergy);
    const mixed = new Float32Array(baseAtSource.length);
    for (let i = 0; i < baseAtSource.length; i++) {
      let noise = 0;
      for (let k = 0; k < harmonicAmps.length; k++) {
        noise += harmonicAmps[k] * Math.sin(
          2 * Math.PI * (k + 1) * INTERFERER_HZ * i / sourceRate,
        );
      }
      mixed[i] = baseAtSource[i] + stackNorm * noise;
    }

    // Step 2: pitch-worker would resample sourceRate → 16 kHz here.
    // detectPitch handles this internally — pass sourceRate.
    const { pitchHz, confidence } = await detectPitch(session, inputName, mixed, sourceRate);
    const stats = summarize(pitchHz, confidence, truthHz);
    allResults.push({ sourceRate, snrDb, stats });
    console.log(
      `  ${String(sourceRate).padStart(11)} | ${String(snrDb).padStart(6)} | ` +
      `${(100 * stats.correctRate).toFixed(1).padStart(7)}% | ` +
      `${(100 * stats.octaveUpRate).toFixed(1).padStart(6)}% | ` +
      `${(100 * stats.nullRate).toFixed(1).padStart(4)}% | ` +
      `${stats.meanReportedHz.toFixed(1).padStart(16)}`,
    );
  }
}

// Compare same-SNR results across source rates to see if rate matters
console.log("");
console.log("Variation in octave-up % across source rates, per SNR:");
console.log(`  SNR    | min     | max     | spread  | matters?`);
console.log(`  -------|---------|---------|---------|----------`);
const snrSpreads = {};
for (const snrDb of TEST_SNRS_DB) {
  const ratesAtSnr = allResults.filter((r) => r.snrDb === snrDb);
  const upRates = ratesAtSnr.map((r) => r.stats.octaveUpRate);
  const minRate = Math.min(...upRates);
  const maxRate = Math.max(...upRates);
  const spread = maxRate - minRate;
  snrSpreads[snrDb] = { minRate, maxRate, spread };
  const matters = spread > 0.20 ? "YES — large" : spread > 0.05 ? "modest" : "no — small";
  console.log(
    `  ${String(snrDb).padStart(5)}  | ${(100 * minRate).toFixed(1).padStart(6)}% | ` +
    `${(100 * maxRate).toFixed(1).padStart(6)}% | ${(100 * spread).toFixed(1).padStart(6)}% | ${matters}`,
  );
}

console.log("");
console.log("Verdict:");
const anyLargeSpread = Object.values(snrSpreads).some((s) => s.spread > 0.20);
const anyModestSpread = Object.values(snrSpreads).some((s) => s.spread > 0.05);
if (anyLargeSpread) {
  console.log(">>> Sample rate DOES affect SwiftF0's response to the reproducer.");
  console.log("    The dev-vs-prod F0 discrepancy is plausibly explained by");
  console.log("    different source sample rates between the two tabs.");
} else if (anyModestSpread) {
  console.log(">>> Sample rate has MODEST effect on SwiftF0's response.");
  console.log("    Could partially explain a transient discrepancy, but doesn't");
  console.log("    fully account for sustained prod-vs-dev differences.");
} else {
  console.log(">>> Sample rate does NOT meaningfully affect SwiftF0's response.");
  console.log("    The dev-vs-prod F0 discrepancy is MOST LIKELY environmental");
  console.log("    (intermittent interferer level) rather than configuration-driven.");
  console.log("    Both versions are equally vulnerable to the same failure mode;");
  console.log("    one happened to capture during a quieter-interferer moment.");
}

mkdirSync(join(ROOT, "measurements"), { recursive: true });
const outPath = join(ROOT, "measurements", "swift-f0-sample-rate-sensitivity-2026-05-12.json");
writeFileSync(outPath, JSON.stringify({
  generatedAt: new Date().toISOString(),
  config: {
    targetSampleRate: TARGET_SR,
    interfererHz: INTERFERER_HZ,
    testSnrs: TEST_SNRS_DB,
    sourceRates: SOURCE_RATES,
    truthHz,
  },
  results: allResults,
  snrSpreads,
}, null, 2));
console.log(`\nJSON: ${outPath}`);
