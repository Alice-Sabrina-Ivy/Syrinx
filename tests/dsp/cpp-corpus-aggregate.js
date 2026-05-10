// cpp-corpus-aggregate.js — Per-track Syrinx CPP computation
// across the four test corpora. P3 of the WS2 Praat-comparison
// validation.
//
// Mirrors what production produces: per-track CPP-aggregate value
// derived from running computeCPP at the production's per-frame
// cadence and aggregating via the production aggregator (1 s
// window, 250 ms emit cadence, MIN_VOICED_FRAMES=6 default).
// SwiftF0 not used here — we treat all frames as voiced for the
// algorithmic-comparison purpose. The Praat side similarly
// computes CPPS over the entire track without a voicing gate, so
// matching that behavior keeps the comparison apples-to-apples.
//
// Per-track output: median of all aggregator emits (each emit is
// a 1-s rolling-window mean CPP). Median chosen to match the
// stat we care about for the comparison.
//
// Usage: node tests/dsp/cpp-corpus-aggregate.js
// Output: measurements/syrinx-cpp-corpus-2026-05-10.json

import { writeFileSync, mkdirSync } from "node:fs";
import { computeCPP } from "../../src/dsp/cpp.js";
import { VocalWeightAggregator } from "../../src/audio/vocal-weight-aggregator.js";
import { loadHillenbrand, loadPtdbTug, loadVocadito, loadFda } from "./data/corpora.js";

const CHUNK_MS = 25;
const WINDOW_MS = 50;
// Mirror production: CPP runs every frame (no per-6th-frame
// throttling) since the 2026-05-10 methodology iteration.
const CPP_FRAME_DIVISOR = 1;

function median(arr) {
  if (arr.length === 0) return null;
  const s = [...arr].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

function processTrack(track) {
  const { samples, sampleRate } = track;
  const chunkSize = Math.floor(sampleRate * CHUNK_MS / 1000);
  const windowSize = Math.floor(sampleRate * WINDOW_MS / 1000);
  const ringCapacity = windowSize * 2;
  const ring = new Float32Array(ringCapacity);
  let ringLen = 0;

  const aggregator = new VocalWeightAggregator();
  let lastAggTime = -1;
  const aggregateEmits = [];
  const perFrameCpps = [];

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
    const time = chunkIdx * CHUNK_MS;

    let cpp = null;
    if (analysisCount % CPP_FRAME_DIVISOR === 0) {
      cpp = computeCPP(window, sampleRate);
      if (typeof cpp === "number" && isFinite(cpp)) perFrameCpps.push(cpp);
    }
    analysisCount++;

    // Treat all frames as voiced for the algorithmic comparison
    // (matches Praat's no-voicing-gate behavior).
    const cppAggregate = aggregator.push({ time, cpp, voiced: true });
    if (cppAggregate && cppAggregate.time !== lastAggTime) {
      aggregateEmits.push(cppAggregate.cpp);
      lastAggTime = cppAggregate.time;
    }
  }

  return {
    aggregateMedian: median(aggregateEmits),
    aggregateCount: aggregateEmits.length,
    perFrameMedian: median(perFrameCpps),
    perFrameCount: perFrameCpps.length,
  };
}

console.log("Syrinx CPP — per-track aggregate values across corpora");
console.log("=====================================================");

const allCorpora = [
  ["hillenbrand", loadHillenbrand()],
  ["ptdb-tug", loadPtdbTug()],
  ["vocadito", loadVocadito()],
  ["fda", loadFda()],
];

const results = [];
let total = 0;
for (const [name, tracks] of allCorpora) {
  console.log(`\n${name}: ${tracks.length} tracks`);
  for (const track of tracks) {
    const stats = processTrack(track);
    results.push({
      corpus: track.corpus,
      track_id: track.trackId,
      gender: track.gender,
      duration_s: track.samples.length / track.sampleRate,
      sample_rate: track.sampleRate,
      cpp_aggregate_median_db: stats.aggregateMedian,
      aggregate_count: stats.aggregateCount,
      cpp_per_frame_median_db: stats.perFrameMedian,
      per_frame_count: stats.perFrameCount,
    });
    total++;
    if (total % 100 === 0) console.log(`  [${total}] processed`);
  }
}

console.log(`\nTotal: ${results.length} tracks`);

const outPath = "measurements/syrinx-cpp-corpus-2026-05-10.json";
mkdirSync("measurements", { recursive: true });
writeFileSync(outPath, JSON.stringify({
  timestamp: new Date().toISOString(),
  config: {
    chunkMs: CHUNK_MS,
    windowMs: WINDOW_MS,
    cppFrameDivisor: CPP_FRAME_DIVISOR,
    note: "voiced=true for all frames (matches Praat's no-voicing-gate behavior for algorithmic comparison)",
  },
  results,
}, null, 2));
console.log(`Wrote ${outPath}`);
