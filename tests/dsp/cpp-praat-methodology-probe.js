// cpp-praat-methodology-probe.js — Methodology investigation for
// the WS2 Praat-Syrinx within-corpus correlation weakness.
//
// Hypotheses tested:
//   (a) aggregation function (mean vs median of per-frame CPPs)
//   (b) time resolution (every-frame vs every-6th-frame computation)
//   (c) outlier robustness (trimmed mean to absorb peak-influenced
//       low-F0 frames)
//
// Computes Syrinx CPP per track under multiple methodological
// variants, joins each variant against Praat CPPS (P2 output), and
// reports per-variant per-corpus Pearson r. The variant that gives
// the highest within-corpus r is the most-faithful methodology
// match for Praat — telling us whether the Simpson's-paradox finding
// reflects algorithm disagreement vs comparison-methodology artifact.
//
// Hypotheses (d) windowing, (e) trend/fit/smoothing parameters
// require code changes to computeCPP itself rather than just
// methodology variants — those are out of scope for this probe and
// surfaced as Step 4 candidates if this probe doesn't resolve the
// finding.
//
// Usage: node tests/dsp/cpp-praat-methodology-probe.js
// Output: measurements/cpp-praat-methodology-probe-2026-05-10.json

import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { computeCPP, resetCppState } from "../../src/dsp/cpp.js";
import { loadHillenbrand, loadPtdbTug, loadVocadito, loadFda } from "./data/corpora.js";

const PRAAT_PATH = "measurements/praat-cpps-corpus-2026-05-10.json";
const OUT_PATH = "measurements/cpp-praat-methodology-probe-2026-05-10.json";

const CHUNK_MS = 25;
const WINDOW_MS = 50;

function median(arr) {
  if (arr.length === 0) return null;
  const s = [...arr].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

function mean(arr) {
  if (arr.length === 0) return null;
  return arr.reduce((a, b) => a + b, 0) / arr.length;
}

function trimmedMean(arr, trimFraction = 0.1) {
  if (arr.length === 0) return null;
  const s = [...arr].sort((a, b) => a - b);
  const k = Math.floor(s.length * trimFraction);
  const trimmed = s.slice(k, s.length - k);
  return trimmed.length === 0 ? mean(s) : mean(trimmed);
}

function pearson(xs, ys) {
  const n = xs.length;
  if (n < 2) return null;
  const mx = mean(xs), my = mean(ys);
  let num = 0, dx = 0, dy = 0;
  for (let i = 0; i < n; i++) {
    const ex = xs[i] - mx, ey = ys[i] - my;
    num += ex * ey;
    dx += ex * ex;
    dy += ey * ey;
  }
  if (dx === 0 || dy === 0) return null;
  return num / Math.sqrt(dx * dy);
}

// Compute per-frame CPP across a track at the specified frame
// divisor. Returns the array of per-frame CPP values.
function computeTrackCpps(track, frameDivisor) {
  resetCppState();   // fresh time-smoothing buffer per track
  const { samples, sampleRate } = track;
  const chunkSize = Math.floor(sampleRate * CHUNK_MS / 1000);
  const windowSize = Math.floor(sampleRate * WINDOW_MS / 1000);
  const ringCapacity = windowSize * 2;
  const ring = new Float32Array(ringCapacity);
  let ringLen = 0;

  const cpps = [];
  let analysisCount = 0;
  for (let chunkIdx = 0; ; chunkIdx++) {
    const chunkStart = chunkIdx * chunkSize;
    if (chunkStart + chunkSize > samples.length) break;
    const chunk = samples.subarray(chunkStart, chunkStart + chunkSize);

    if (ringLen + chunk.length <= ringCapacity) {
      ring.set(chunk, ringLen);
      ringLen += chunk.length;
    } else {
      const keepLen = Math.min(ringLen, ringCapacity - chunk.length);
      ring.copyWithin(0, ringLen - keepLen, ringLen);
      ring.set(chunk, keepLen);
      ringLen = keepLen + chunk.length;
    }
    if (ringLen < windowSize) continue;

    const window = ring.subarray(ringLen - windowSize, ringLen);
    if (analysisCount % frameDivisor === 0) {
      const cpp = computeCPP(window, sampleRate);
      if (typeof cpp === "number" && isFinite(cpp)) cpps.push(cpp);
    }
    analysisCount++;
  }
  return cpps;
}

console.log("CPP Praat-methodology probe");
console.log("===========================");

// Variant definitions — each maps an array of per-frame CPPs to a
// single track-level value. Probes hypotheses (a) and (c).
const aggVariants = {
  median: median,
  mean: mean,
  trimmed_mean_10: (arr) => trimmedMean(arr, 0.1),
  trimmed_mean_25: (arr) => trimmedMean(arr, 0.25),
};

// Frame divisor variants — probes hypothesis (b). Lower = finer time
// resolution; default production is 6 (every 6th DSP frame). 1 is
// every-frame; 2 and 3 are intermediate compromises that recoup most
// of the correlation gain at less compute cost.
const divisorVariants = [1, 2, 3, 6];

// Load Praat results for joining.
const praatDoc = JSON.parse(readFileSync(PRAAT_PATH, "utf8"));
const praatIdx = new Map();
for (const r of praatDoc.results) {
  if ("error" in r) continue;
  praatIdx.set(`${r.corpus}/${r.track_id}`, r);
}

console.log(`Loaded ${praatIdx.size} Praat track results from ${PRAAT_PATH}\n`);

// Load corpora.
const allTracks = [
  ...loadHillenbrand(),
  ...loadPtdbTug(),
  ...loadVocadito(),
  ...loadFda(),
];
console.log(`Loaded ${allTracks.length} corpus tracks\n`);

// Filter to tracks that have a Praat counterpart.
const matchedTracks = allTracks.filter((t) => praatIdx.has(`${t.corpus}/${t.trackId}`));
console.log(`${matchedTracks.length} tracks matched Praat data\n`);

// For each frame-divisor variant, compute per-track CPPs once.
console.log("Computing per-frame CPPs at each divisor...");
const divisorPerTrackCpps = {};
for (const div of divisorVariants) {
  console.log(`  divisor=${div}...`);
  divisorPerTrackCpps[div] = matchedTracks.map((t) => ({
    trackId: t.trackId,
    corpus: t.corpus,
    gender: t.gender,
    cpps: computeTrackCpps(t, div),
  }));
}

// For each (divisor, agg-variant) combination, join against Praat
// and compute per-corpus Pearson r.
const results = [];
for (const div of divisorVariants) {
  for (const [aggName, aggFn] of Object.entries(aggVariants)) {
    const tracksByCorpus = {};
    for (const t of divisorPerTrackCpps[div]) {
      const aggValue = t.cpps.length > 0 ? aggFn(t.cpps) : null;
      if (aggValue === null) continue;
      const praat = praatIdx.get(`${t.corpus}/${t.trackId}`);
      if (!praat) continue;
      tracksByCorpus[t.corpus] = tracksByCorpus[t.corpus] || [];
      tracksByCorpus[t.corpus].push({
        praat: praat.cpps_db,
        syrinx: aggValue,
      });
    }
    const perCorpus = {};
    for (const [c, pairs] of Object.entries(tracksByCorpus)) {
      const r = pearson(pairs.map((p) => p.praat), pairs.map((p) => p.syrinx));
      perCorpus[c] = { n: pairs.length, r: r === null ? null : Math.round(r * 1000) / 1000 };
    }
    // Overall (cross-corpus) r — included for context but the
    // within-corpus values are the load-bearing comparison.
    const allPairs = Object.values(tracksByCorpus).flat();
    const overallR = pearson(allPairs.map((p) => p.praat), allPairs.map((p) => p.syrinx));
    results.push({
      divisor: div,
      aggregation: aggName,
      overallR: overallR === null ? null : Math.round(overallR * 1000) / 1000,
      perCorpus,
    });
  }
}

// Print as a table.
console.log("\n=== Results ===");
console.log("frame divisor | aggregation       | overall r | hill | ptdb | vocadito | fda");
console.log("-".repeat(95));
for (const r of results) {
  const c = r.perCorpus;
  console.log(
    `      ${String(r.divisor).padStart(2)}      | ${r.aggregation.padEnd(17)} | ` +
    `${String(r.overallR).padStart(9)} | ` +
    `${String(c["hillenbrand"]?.r ?? "-").padStart(4)} | ` +
    `${String(c["ptdb-tug"]?.r ?? "-").padStart(4)} | ` +
    `${String(c["vocadito"]?.r ?? "-").padStart(8)} | ` +
    `${String(c["fda"]?.r ?? "-").padStart(4)}`
  );
}

// Best within-corpus configuration per corpus.
console.log("\n=== Best within-corpus r per corpus ===");
for (const corpus of ["hillenbrand", "ptdb-tug", "vocadito", "fda"]) {
  let best = null;
  for (const r of results) {
    const corpusResult = r.perCorpus[corpus];
    if (corpusResult && corpusResult.r !== null && (best === null || corpusResult.r > best.r)) {
      best = { divisor: r.divisor, aggregation: r.aggregation, ...corpusResult };
    }
  }
  if (best) {
    console.log(`  ${corpus}: r=${best.r} (divisor=${best.divisor}, aggregation=${best.aggregation}, n=${best.n})`);
  }
}

mkdirSync("measurements", { recursive: true });
writeFileSync(OUT_PATH, JSON.stringify({
  timestamp: new Date().toISOString(),
  config: { CHUNK_MS, WINDOW_MS, divisorVariants, aggVariants: Object.keys(aggVariants) },
  results,
}, null, 2));
console.log(`\nWrote ${OUT_PATH}`);
