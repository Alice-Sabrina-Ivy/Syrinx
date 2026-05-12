// cpp-corpus-distribution-analysis.js — Stage A analysis of the CPP
// value distribution across running-speech and supplementary corpora.
//
// Reads measurements/syrinx-cpp-corpus-2026-05-10.json (per-track
// CPP aggregate + per-frame medians at production aggregation
// settings — divisor=1, MIN_VOICED_FRAMES=4, 3-bin quefrency
// smoothing) and computes:
//   - Distribution stats per corpus (min, p5, p10, p25, p50, p75,
//     p90, p95, max, mean, stdev)
//   - Per-gender breakdown where corpus permits
//   - Cross-corpus comparison
//   - Distribution shape diagnostic (skew + simple peak count)
//   - Recommended gauge axis bounds capturing the central 90 % +
//     headroom
//
// Output: measurements/cpp-corpus-distribution-analysis-2026-05-11.json
// + text summary printed.
//
// Usage: node tests/dsp/cpp-corpus-distribution-analysis.js

import { readFileSync, writeFileSync, mkdirSync } from "node:fs";

const SRC = "measurements/syrinx-cpp-corpus-2026-05-10.json";
const OUT = "measurements/cpp-corpus-distribution-analysis-2026-05-11.json";

const doc = JSON.parse(readFileSync(SRC, "utf8"));

// Pick the right per-track value:
// - For tracks with aggregator emits (production-equivalent), use
//   cpp_aggregate_median_db.
// - For tracks too short to emit (Hillenbrand sustained vowels at
//   ~700 ms), fall back to cpp_per_frame_median_db. The per-frame
//   median IS what production would produce for a 1-s window
//   if the buffer ever filled, so it's the closest analog.
function trackValue(t) {
  if (typeof t.cpp_aggregate_median_db === "number") return t.cpp_aggregate_median_db;
  if (typeof t.cpp_per_frame_median_db === "number") return t.cpp_per_frame_median_db;
  return null;
}

function pct(sorted, p) {
  if (sorted.length === 0) return null;
  const idx = Math.floor(sorted.length * p);
  return sorted[Math.min(idx, sorted.length - 1)];
}

function describe(values) {
  if (values.length === 0) return { n: 0 };
  const s = [...values].sort((a, b) => a - b);
  const n = s.length;
  const sum = s.reduce((a, b) => a + b, 0);
  const mean = sum / n;
  const variance = s.reduce((a, b) => a + (b - mean) ** 2, 0) / Math.max(1, n - 1);
  const stdev = Math.sqrt(variance);
  // Simple skew (Pearson's second skewness coefficient)
  const median = pct(s, 0.5);
  const skew = stdev > 0 ? (3 * (mean - median)) / stdev : 0;
  return {
    n,
    min: Number(s[0].toFixed(3)),
    p5: Number(pct(s, 0.05).toFixed(3)),
    p10: Number(pct(s, 0.10).toFixed(3)),
    p25: Number(pct(s, 0.25).toFixed(3)),
    p50: Number(median.toFixed(3)),
    p75: Number(pct(s, 0.75).toFixed(3)),
    p90: Number(pct(s, 0.90).toFixed(3)),
    p95: Number(pct(s, 0.95).toFixed(3)),
    max: Number(s[s.length - 1].toFixed(3)),
    mean: Number(mean.toFixed(3)),
    stdev: Number(stdev.toFixed(3)),
    iqr: Number((pct(s, 0.75) - pct(s, 0.25)).toFixed(3)),
    skew: Number(skew.toFixed(3)),
  };
}

// Histogram-like bucketing for shape diagnostic.
function buckets(values, lo, hi, nBuckets = 20) {
  if (values.length === 0) return [];
  const width = (hi - lo) / nBuckets;
  const counts = new Array(nBuckets).fill(0);
  for (const v of values) {
    let idx = Math.floor((v - lo) / width);
    if (idx < 0) idx = 0;
    if (idx >= nBuckets) idx = nBuckets - 1;
    counts[idx]++;
  }
  return counts.map((c, i) => ({
    lo: Number((lo + i * width).toFixed(2)),
    hi: Number((lo + (i + 1) * width).toFixed(2)),
    count: c,
  }));
}

// Group tracks by corpus, drop nulls.
const byCorpus = {};
for (const t of doc.results) {
  const v = trackValue(t);
  if (v === null) continue;
  byCorpus[t.corpus] = byCorpus[t.corpus] || [];
  byCorpus[t.corpus].push({ value: v, gender: t.gender });
}

// Per-corpus + per-gender distributions
const analysis = {};
for (const [corpus, rows] of Object.entries(byCorpus)) {
  const all = rows.map((r) => r.value);
  const byGender = {};
  for (const r of rows) {
    byGender[r.gender] = byGender[r.gender] || [];
    byGender[r.gender].push(r.value);
  }
  const desc = describe(all);
  // Histogram bounds for visualization: use min/max from data
  analysis[corpus] = {
    overall: desc,
    perGender: Object.fromEntries(
      Object.entries(byGender).map(([g, vals]) => [g, describe(vals)]),
    ),
  };
}

// Cross-corpus statistics: pooled values from running-speech corpora
// (PTDB-TUG + FDA, both at p3-decision-validated correlation) vs.
// pooled supplementary (Hillenbrand + Vocadito).
const runningSpeechAll = [
  ...(byCorpus["ptdb-tug"] || []).map((r) => r.value),
  ...(byCorpus["fda"] || []).map((r) => r.value),
];
const supplementaryAll = [
  ...(byCorpus["hillenbrand"] || []).map((r) => r.value),
  ...(byCorpus["vocadito"] || []).map((r) => r.value),
];
const allCorpora = [...runningSpeechAll, ...supplementaryAll];

const crossCorpus = {
  runningSpeechPooled: describe(runningSpeechAll),
  supplementaryPooled: describe(supplementaryAll),
  allCorporaPooled: describe(allCorpora),
};

// Recommended axis bounds from running-speech pool (the production-
// relevant distribution). Several candidate bound-derivation
// strategies:
//   - bounds_p5_p95: capture central 90% of users; tight
//   - bounds_p2_p98: capture central 96% of users; moderate
//   - bounds_min_max: capture all observed users; widest
//   - bounds_mean_pm_3sd: mean ± 3 stdev; statistically standard
//   - bounds_mean_pm_2sd: mean ± 2 stdev; tighter
const runningPool = crossCorpus.runningSpeechPooled;
const sortedRunning = [...runningSpeechAll].sort((a, b) => a - b);
const bounds = {
  p5_p95: { low: pct(sortedRunning, 0.05), high: pct(sortedRunning, 0.95) },
  p2_p98: { low: pct(sortedRunning, 0.02), high: pct(sortedRunning, 0.98) },
  min_max: { low: pct(sortedRunning, 0), high: pct(sortedRunning, 1) },
  mean_pm_3sd: {
    low: runningPool.mean - 3 * runningPool.stdev,
    high: runningPool.mean + 3 * runningPool.stdev,
  },
  mean_pm_2sd: {
    low: runningPool.mean - 2 * runningPool.stdev,
    high: runningPool.mean + 2 * runningPool.stdev,
  },
};
for (const b of Object.values(bounds)) {
  b.low = Number(b.low.toFixed(3));
  b.high = Number(b.high.toFixed(3));
  b.span = Number((b.high - b.low).toFixed(3));
}

// Distribution-shape diagnostic — histogram of running-speech pool.
const runningBuckets = buckets(
  runningSpeechAll,
  Math.min(...runningSpeechAll),
  Math.max(...runningSpeechAll),
  20,
);

// Print summary
console.log("CPP corpus distribution analysis");
console.log("=================================");
console.log("Source:", SRC);
console.log("Production aggregation settings: divisor=1, MIN_VOICED_FRAMES=4, quefrency smoothing 3-bin\n");

console.log("--- Per-corpus distributions ---");
for (const [corpus, info] of Object.entries(analysis)) {
  console.log(`\n${corpus} (n=${info.overall.n}):`);
  console.log(`  overall: ${JSON.stringify(info.overall)}`);
  for (const [g, d] of Object.entries(info.perGender)) {
    if (d.n > 0) console.log(`    ${g} (n=${d.n}): p5=${d.p5}, p50=${d.p50}, p95=${d.p95}, mean=${d.mean}, stdev=${d.stdev}`);
  }
}

console.log("\n--- Cross-corpus pooled ---");
for (const [name, d] of Object.entries(crossCorpus)) {
  console.log(`${name}: ${JSON.stringify(d)}`);
}

console.log("\n--- Recommended axis bounds (running-speech pool basis) ---");
for (const [name, b] of Object.entries(bounds)) {
  console.log(`  ${name}: low=${b.low}, high=${b.high}, span=${b.span}`);
}

console.log("\n--- Distribution shape (running-speech pool, 20 buckets) ---");
const maxCount = Math.max(...runningBuckets.map((b) => b.count));
for (const b of runningBuckets) {
  const bar = "*".repeat(Math.round((b.count / maxCount) * 40));
  console.log(`  [${b.lo.toFixed(2)}, ${b.hi.toFixed(2)}): ${String(b.count).padStart(3)} ${bar}`);
}

mkdirSync("measurements", { recursive: true });
writeFileSync(OUT, JSON.stringify({
  timestamp: new Date().toISOString(),
  source: SRC,
  productionSettings: doc.config,
  perCorpus: analysis,
  crossCorpus,
  recommendedBounds: bounds,
  runningSpeechHistogram: runningBuckets,
}, null, 2));
console.log(`\nWrote ${OUT}`);
