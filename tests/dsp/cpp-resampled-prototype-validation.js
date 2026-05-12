// cpp-resampled-prototype-validation.js — Validate that the
// sample-rate-invariant prototype preserves Layer 1 (synthetic
// directional invariants) and Layer 4 (Praat correlation) properties.
//
// Approach:
//   - Layer 1 spot check: clean pulse train, noise, modal vs breathy
//     synthetic — verify directional invariants hold under prototype
//   - Layer 4 corpus aggregate: re-run per-track CPP across all
//     corpora using the prototype, write to a side-by-side JSON file
//     for correlation against Praat (uses existing
//     praat-syrinx-correlate.py)
//
// Usage: node tests/dsp/cpp-resampled-prototype-validation.js
// Output: measurements/syrinx-cpp-corpus-prototype-2026-05-12.json
//         (parallel to syrinx-cpp-corpus-2026-05-10.json so the
//          Praat correlation script can be pointed at it)

import { writeFileSync, mkdirSync } from "node:fs";
import { computeCPPResampled, resetCppState } from "../../src/dsp/cpp-resampled-prototype.js";
import { VocalWeightAggregator } from "../../src/audio/vocal-weight-aggregator.js";
import { loadHillenbrand, loadPtdbTug, loadVocadito, loadFda } from "./data/corpora.js";

const CHUNK_MS = 25;
const WINDOW_MS = 50;
const CPP_FRAME_DIVISOR = 1;

function median(arr) {
  if (arr.length === 0) return null;
  const s = [...arr].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

// Layer 1: synthetic directional invariants
function pulseTrain(f0Hz, sr, numSamples) {
  const out = new Float64Array(numSamples);
  const period = sr / f0Hz;
  for (let t = 0; t < numSamples; t += period) {
    const idx = Math.round(t);
    if (idx < numSamples) out[idx] = 1.0;
  }
  return out;
}

function whiteNoise(n) {
  const out = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const u1 = Math.max(1e-10, Math.random());
    const u2 = Math.random();
    out[i] = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2) * 0.1;
  }
  return out;
}

console.log("Layer 1 — synthetic directional invariants (prototype)");
console.log("=" .repeat(60));
let layer1Pass = 0, layer1Fail = 0;
function check(name, cond, detail = "") {
  if (cond) { console.log(`  ✓ ${name}`); layer1Pass++; }
  else { console.log(`  ✗ ${name}${detail ? `  (${detail})` : ""}`); layer1Fail++; }
}

{
  // Pulse train should give clearly positive CPP
  resetCppState();
  const sr = 48000;
  const sig = pulseTrain(120, sr, sr); // 1 second
  const wins = [];
  for (let pos = 2400; pos <= sig.length; pos += 600) {
    const cpp = computeCPPResampled(sig.subarray(pos - 2400, pos), sr);
    if (cpp !== null && isFinite(cpp)) wins.push(cpp);
  }
  const m = median(wins);
  check("Pulse train CPP > 0.2 dB", m !== null && m > 0.2, `got ${m?.toFixed(3)}`);
}

{
  // Pure noise should give near-zero or low CPP
  resetCppState();
  const sr = 48000;
  const noise = whiteNoise(sr); // 1 second of noise
  const wins = [];
  for (let pos = 2400; pos <= noise.length; pos += 600) {
    const cpp = computeCPPResampled(noise.subarray(pos - 2400, pos), sr);
    if (cpp !== null && isFinite(cpp)) wins.push(cpp);
  }
  const m = median(wins);
  check("Noise CPP < 1.5 dB", m === null || m < 1.5, `got ${m?.toFixed(3)}`);
}

{
  // Modal (clean pulse) vs breathy (jittered + noisy) directional
  resetCppState();
  const sr = 48000;
  const modal = pulseTrain(120, sr, sr);
  const breathy = pulseTrain(120, sr, sr);
  for (let i = 0; i < breathy.length; i++) breathy[i] += whiteNoise(1)[0] * 2;

  const modalWins = [];
  for (let pos = 2400; pos <= modal.length; pos += 600) {
    const cpp = computeCPPResampled(modal.subarray(pos - 2400, pos), sr);
    if (cpp !== null && isFinite(cpp)) modalWins.push(cpp);
  }
  resetCppState();
  const breathyWins = [];
  for (let pos = 2400; pos <= breathy.length; pos += 600) {
    const cpp = computeCPPResampled(breathy.subarray(pos - 2400, pos), sr);
    if (cpp !== null && isFinite(cpp)) breathyWins.push(cpp);
  }
  const mModal = median(modalWins);
  const mBreathy = median(breathyWins);
  check("modal > breathy CPP",
    mModal !== null && mBreathy !== null && mModal > mBreathy,
    `modal=${mModal?.toFixed(3)} breathy=${mBreathy?.toFixed(3)}`);
}

console.log(`\nLayer 1 result: ${layer1Pass} pass, ${layer1Fail} fail\n`);

// Layer 4: corpus aggregate for Praat correlation (writes a JSON
// in the same shape as syrinx-cpp-corpus-2026-05-10.json so the
// existing praat-syrinx-correlate.py can ingest it)
console.log("Layer 4 — corpus aggregate (prototype) for Praat correlation");
console.log("=".repeat(60));

function processTrack(track) {
  resetCppState();
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
      cpp = computeCPPResampled(window, sampleRate);
      if (typeof cpp === "number" && isFinite(cpp)) perFrameCpps.push(cpp);
    }
    analysisCount++;

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
    if (total % 200 === 0) console.log(`  [${total}] processed`);
  }
}

console.log(`\nTotal: ${results.length} tracks`);

const outPath = "measurements/syrinx-cpp-corpus-prototype-2026-05-12.json";
mkdirSync("measurements", { recursive: true });
writeFileSync(outPath, JSON.stringify({
  timestamp: new Date().toISOString(),
  config: {
    chunkMs: CHUNK_MS,
    windowMs: WINDOW_MS,
    cppFrameDivisor: CPP_FRAME_DIVISOR,
    prototype: true,
    note: "Computed via computeCPPResampled (canonical 16 kHz internal resampling)",
  },
  results,
}, null, 2));
console.log(`Wrote ${outPath}`);
console.log(`\nLayer 1 final: ${layer1Pass} pass, ${layer1Fail} fail`);
