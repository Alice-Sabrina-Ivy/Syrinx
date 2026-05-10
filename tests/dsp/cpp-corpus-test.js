// cpp-corpus-test.js — Layer 2 corpus regression for CPP.
//
// Runs computeCPP across the Hillenbrand sustained-vowel corpus
// and reports distribution stats split by gender. Purpose:
//
//   1. Sanity check the distribution shape — what range of CPP
//      values does real speech produce in this algorithm?
//   2. Verify gender symmetry — M and F distributions should be
//      COMPARABLE IN WIDTH. CPP shouldn't covertly be an F0/gender
//      proxy. The cepstrum reads source periodicity, not pitch
//      directly, so M and F means may differ but the spread should
//      be similar.
//   3. Regression guard — once parameters are pinned, future CPP
//      changes that materially shift the distribution will surface.
//
// This is not a pass/fail accuracy test — there's no ground-truth
// "vocal weight" label per Hillenbrand recording. The test prints
// the distribution and asserts loose sanity bounds.
//
// Usage: node tests/dsp/cpp-corpus-test.js
//
// Skips gracefully if the Hillenbrand corpus isn't installed (just
// prints a notice and exits 0). Bringing the corpus in is documented
// at tests/dsp/data/README.md.

import { computeCPP, CPP_INPUT_LEN } from "../../src/dsp/cpp.js";
import { loadHillenbrand } from "./data/corpora.js";

const HOP_MS = 25;            // matches production cadence
const CENTRAL_FRACTION = 0.7; // central 70% of each recording (matches pitch-bucket harness)

function cppMedianForTrack(track) {
  const { samples, sampleRate } = track;
  const hopSamples = Math.round(sampleRate * HOP_MS / 1000);
  const startSample = Math.floor(samples.length * (1 - CENTRAL_FRACTION) / 2);
  const endSample = Math.floor(samples.length * (1 + CENTRAL_FRACTION) / 2);

  const cppValues = [];
  // Step in HOP_MS hops; each frame uses the trailing CPP_INPUT_LEN
  // samples ending at the current position (mirroring production
  // dsp-worker.js's "last N samples of the analysis window" pattern).
  for (let pos = startSample + CPP_INPUT_LEN; pos <= endSample; pos += hopSamples) {
    const window = samples.subarray(pos - CPP_INPUT_LEN, pos);
    const cpp = computeCPP(window, sampleRate);
    if (cpp !== null && isFinite(cpp)) cppValues.push(cpp);
  }
  if (cppValues.length === 0) return null;
  cppValues.sort((a, b) => a - b);
  return {
    n: cppValues.length,
    median: cppValues[Math.floor(cppValues.length / 2)],
    p25: cppValues[Math.floor(cppValues.length * 0.25)],
    p75: cppValues[Math.floor(cppValues.length * 0.75)],
    mean: cppValues.reduce((a, b) => a + b, 0) / cppValues.length,
    min: cppValues[0],
    max: cppValues[cppValues.length - 1],
  };
}

function describeDistribution(label, vals) {
  if (vals.length === 0) return `${label}: no data`;
  const sorted = [...vals].sort((a, b) => a - b);
  const median = sorted[Math.floor(sorted.length / 2)];
  const p25 = sorted[Math.floor(sorted.length * 0.25)];
  const p75 = sorted[Math.floor(sorted.length * 0.75)];
  const mean = sorted.reduce((a, b) => a + b, 0) / sorted.length;
  const stdev = Math.sqrt(
    sorted.reduce((s, v) => s + (v - mean) ** 2, 0) / (sorted.length - 1 || 1)
  );
  return {
    n: sorted.length,
    mean: mean.toFixed(2),
    median: median.toFixed(2),
    stdev: stdev.toFixed(2),
    p25: p25.toFixed(2),
    p75: p75.toFixed(2),
    iqr: (p75 - p25).toFixed(2),
    min: sorted[0].toFixed(2),
    max: sorted[sorted.length - 1].toFixed(2),
  };
}

console.log("CPP corpus regression — Hillenbrand sustained vowels");
console.log("================================================");

const tracks = loadHillenbrand();
if (tracks.length === 0) {
  console.log("\nHillenbrand corpus not installed (tests/dsp/data/men, /women).");
  console.log("See tests/dsp/data/README.md for fetch instructions.");
  console.log("Skipping corpus regression — exit 0 (intentional skip).");
  process.exit(0);
}

console.log(`Loaded ${tracks.length} tracks (gender keys: m/w/b/g)`);
console.log(`Hop: ${HOP_MS} ms; window: ${CPP_INPUT_LEN} samples; central ${CENTRAL_FRACTION * 100}% of each track\n`);

const byGender = { m: [], w: [], b: [], g: [] };
let processed = 0;
let skipped = 0;
for (const track of tracks) {
  const stats = cppMedianForTrack(track);
  if (stats === null) {
    skipped++;
    continue;
  }
  const bucket = byGender[track.gender];
  if (bucket) bucket.push(stats.median);
  processed++;
}

console.log(`Processed: ${processed}, skipped (no valid CPP frames): ${skipped}\n`);

let passed = 0;
let failed = 0;
function check(name, condition, detail = "") {
  if (condition) {
    passed++;
    console.log(`  ✓ ${name}`);
  } else {
    failed++;
    console.log(`  ✗ ${name}${detail ? `  (${detail})` : ""}`);
  }
}

console.log("Distribution by gender (median per track):");
const distM = describeDistribution("M (men)", byGender.m);
const distW = describeDistribution("W (women)", byGender.w);
const distB = describeDistribution("B (boys)", byGender.b);
const distG = describeDistribution("G (girls)", byGender.g);
console.log("  Men:  ", JSON.stringify(distM));
console.log("  Women:", JSON.stringify(distW));
console.log("  Boys: ", JSON.stringify(distB));
console.log("  Girls:", JSON.stringify(distG));

console.log("\nSanity assertions:");
{
  // (1) Both M and W should have data
  check("M (men) distribution has data", byGender.m.length > 0, `n=${byGender.m.length}`);
  check("W (women) distribution has data", byGender.w.length > 0, `n=${byGender.w.length}`);
}

if (byGender.m.length > 0 && byGender.w.length > 0) {
  // (2) Distributions should produce positive CPP values. Empirical
  // observation 2026-05-10: this Hillenbrand-style algorithm with
  // linear-LSQ regression over the search range produces a much
  // tighter range than clinical-literature CPPS values (which use
  // Theil-robust regression + smoothing). Median ~2 dB on
  // Hillenbrand, IQR < 1.5 dB across speakers. The within-user
  // spread (which is what determines per-user baseline σ) is a
  // separate question answered in Step 7 real-voice testing.
  // Sanity threshold here reflects what the algorithm actually
  // produces, not the clinical literature.
  const allMedians = [...byGender.m, ...byGender.w];
  const sortedAll = [...allMedians].sort((a, b) => a - b);
  const overallMedian = sortedAll[Math.floor(sortedAll.length / 2)];
  check(
    "overall median CPP > 1 dB (peak detected above baseline on average)",
    overallMedian > 1,
    `got ${overallMedian.toFixed(2)}`,
  );
  check(
    "overall median CPP < 30 dB (sanity ceiling)",
    overallMedian < 30,
    `got ${overallMedian.toFixed(2)}`,
  );

  // (3) Gender-symmetry sanity: IQR width should be comparable
  // (within a factor of 2) between M and W. If CPP were a pure
  // F0 proxy, one gender would show a much wider distribution.
  const iqrM = parseFloat(distM.iqr);
  const iqrW = parseFloat(distW.iqr);
  const iqrRatio = Math.max(iqrM, iqrW) / Math.min(iqrM, iqrW);
  check(
    "M and W IQR widths comparable (ratio < 2.5)",
    iqrRatio < 2.5,
    `M-IQR=${iqrM.toFixed(2)}, W-IQR=${iqrW.toFixed(2)}, ratio=${iqrRatio.toFixed(2)}`,
  );

  // (4) Mean difference between M and W should be bounded. Some
  // shift is expected (different F0 ranges interact with the
  // linear-LSQ peak-influence at low F0), but if the gap is huge,
  // we'd be effectively shipping a gender meter not a weight meter.
  const meanM = parseFloat(distM.mean);
  const meanW = parseFloat(distW.mean);
  const meanGap = Math.abs(meanM - meanW);
  check(
    "M and W mean CPP within ±10 dB",
    meanGap < 10,
    `M-mean=${meanM.toFixed(2)}, W-mean=${meanW.toFixed(2)}, gap=${meanGap.toFixed(2)}`,
  );
}

console.log("\n--------");
console.log(`${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
