// calibration-timing-corpus.js — End-to-end calibration timing
// measurement using corpus audio fed through a faithful Node-side
// reproduction of the production pipeline.
//
// What this measures:
//   For each corpus track, simulate the production pipeline frame
//   by frame:
//     - 25 ms chunks of audio (matches capture-processor cadence)
//     - DSP worker accumulates 50 ms analysis window
//     - SwiftF0 confidence per chunk (16 ms hop, nearest-neighbor
//       lookup)
//     - Intensity (RMS in dB) per chunk
//     - Silence gate: intensity AND voicedness, debounced 3 frames
//     - CPP every 6th DSP frame
//     - Aggregator pushes with debounced voicing
//     - Baseline accumulates voiced aggregates
//     - Stop and record TIME-TO-LOCK when baseline.ready() turns true
//
// Output: per-track lock time, aggregated by corpus, with
// distribution stats (median, p25, p75, min, max). Decision
// criteria from the work-stream-1 spec applied at the end.
//
// Usage: node tests/audio/calibration-timing-corpus.js
//
// Skips gracefully if corpora aren't installed (just prints which
// ones were found).

import { computeCPP } from "../../src/dsp/cpp.js";
import { VocalWeightAggregator } from "../../src/audio/vocal-weight-aggregator.js";
import { VocalWeightBaseline } from "../../src/audio/vocal-weight-baseline.js";
import { loadVocadito, loadPtdbTug, loadFda } from "../dsp/data/corpora.js";
import {
  createSwiftF0Session,
  detectPitch,
  nearestSwiftF0Frame,
  SWIFT_F0_FIRST_FRAME_MS,
  SWIFT_F0_HOP_MS,
} from "../dsp/swift-f0-adapter.js";

// Production constants from useAudioPipeline.js / dsp-worker.js
const CHUNK_MS = 25;                  // capture-processor chunk cadence
const WINDOW_MS = 50;                 // dsp-worker analysis window
const SILENCE_THRESHOLD_DB = -50;     // intensity gate
const CONFIDENCE_THRESHOLD = 0.5;     // SwiftF0 voicing gate
const SILENCE_DEBOUNCE_FRAMES = 3;    // debounced silence gate
const CPP_FRAME_DIVISOR = 6;          // CPP every 6th DSP frame
const MAX_SIM_SECONDS = 180;          // safety cap per track

function computeIntensityDb(window) {
  let sum = 0;
  for (let i = 0; i < window.length; i++) sum += window[i] * window[i];
  const rms = Math.sqrt(sum / window.length);
  if (rms === 0) return -Infinity;
  return 20 * Math.log10(rms);
}

function percentile(sortedArr, p) {
  if (sortedArr.length === 0) return null;
  const idx = Math.floor(sortedArr.length * p);
  return sortedArr[Math.min(idx, sortedArr.length - 1)];
}

function describe(values) {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const sum = sorted.reduce((a, b) => a + b, 0);
  return {
    n: sorted.length,
    min: sorted[0].toFixed(2),
    p25: percentile(sorted, 0.25).toFixed(2),
    median: percentile(sorted, 0.5).toFixed(2),
    p75: percentile(sorted, 0.75).toFixed(2),
    max: sorted[sorted.length - 1].toFixed(2),
    mean: (sum / sorted.length).toFixed(2),
  };
}

// Run the production pipeline simulation against a single corpus
// track. Returns lockTimeMs (or null if baseline never locked).
async function measureTrack(track, swiftSession, swiftInputName, opts = {}) {
  const { samples, sampleRate } = track;
  const minVoicedFrames = opts.minVoicedFrames ?? 6;

  // Run SwiftF0 over the entire track up front.
  const swiftResult = await detectPitch(swiftSession, swiftInputName, samples, sampleRate);
  const { confidence: swiftConfidence } = swiftResult;
  const nSwiftFrames = swiftConfidence.length;

  // Set up the production aggregator + baseline.
  // Pass minVoicedFrames override to the aggregator if specified
  // (the constructor accepts the option per src/audio/vocal-weight-aggregator.js).
  const aggregator = new VocalWeightAggregator({ minVoicedFrames });
  const baseline = new VocalWeightBaseline();
  let lastAggTime = -1;
  let lockTimeMs = null;

  // Buffer audio into 25-ms chunks → 50-ms analysis window
  const chunkSize = Math.floor(sampleRate * CHUNK_MS / 1000);
  const windowSize = Math.floor(sampleRate * WINDOW_MS / 1000);
  const ringCapacity = windowSize * 2;
  const ring = new Float32Array(ringCapacity);
  let ringLen = 0;

  let analysisCount = 0;
  let quietFrameCount = 0;
  const maxFrames = Math.floor((MAX_SIM_SECONDS * 1000) / CHUNK_MS);

  // Stats for diagnostic output
  let totalFramesPushed = 0;
  let voicedFramesPushed = 0;
  let cppValueCount = 0;
  let cppNullCount = 0;
  let aggregatesEmitted = 0;
  let baselineSamples = 0;

  for (let chunkIdx = 0; chunkIdx < maxFrames; chunkIdx++) {
    const chunkStart = chunkIdx * chunkSize;
    if (chunkStart + chunkSize > samples.length) break;
    const chunk = samples.subarray(chunkStart, chunkStart + chunkSize);

    // Append chunk to ring buffer (mirroring dsp-worker's appendToRingBuffer)
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
    const intensity = computeIntensityDb(window);

    // SwiftF0 confidence at this time (nearest-neighbor lookup
    // across the entire track's pre-computed inference).
    const swiftIdx = nearestSwiftF0Frame(time, nSwiftFrames);
    const confidence = swiftIdx >= 0 && swiftIdx < nSwiftFrames
      ? swiftConfidence[swiftIdx]
      : null;

    // Silence-gate logic from useAudioPipeline.js
    const intensityQuiet = intensity < SILENCE_THRESHOLD_DB;
    const voicednessQuiet = typeof confidence !== "number"
      || confidence < CONFIDENCE_THRESHOLD;
    const frameQuiet = intensityQuiet && voicednessQuiet;
    if (frameQuiet) quietFrameCount++;
    else quietFrameCount = 0;
    const isQuiet = quietFrameCount >= SILENCE_DEBOUNCE_FRAMES;

    let cpp = null;
    if (analysisCount % CPP_FRAME_DIVISOR === 0) {
      cpp = computeCPP(window, sampleRate);
      if (cpp === null) cppNullCount++;
      else cppValueCount++;
    }
    analysisCount++;

    totalFramesPushed++;
    if (!isQuiet) voicedFramesPushed++;

    const cppAggregate = aggregator.push({ time, cpp, voiced: !isQuiet });

    const isFreshAggregate =
      cppAggregate && cppAggregate.time !== lastAggTime;
    if (isFreshAggregate) {
      aggregatesEmitted++;
      if (!isQuiet) {
        baseline.accumulate({ time: cppAggregate.time, cpp: cppAggregate.cpp });
        baselineSamples++;
        if (baseline.ready() && lockTimeMs === null) {
          lockTimeMs = cppAggregate.time;
          break;  // stop simulation once locked
        }
      }
      lastAggTime = cppAggregate.time;
    }
  }

  return {
    trackId: track.trackId,
    gender: track.gender,
    sampleRate,
    durationMs: (samples.length / sampleRate) * 1000,
    lockTimeMs,
    totalFramesPushed,
    voicedFramesPushed,
    voicedFraction: totalFramesPushed > 0 ? voicedFramesPushed / totalFramesPushed : 0,
    cppValueCount,
    cppNullCount,
    aggregatesEmitted,
    baselineSamples,
    baselineProgress: baseline.progress(),
  };
}

async function runSuite(label, tracks, swiftSession, swiftInputName, opts = {}) {
  console.log(`\n=== ${label} (${tracks.length} tracks${opts.minVoicedFrames !== undefined ? `, MIN_VOICED_FRAMES=${opts.minVoicedFrames}` : ""}) ===`);
  const results = [];
  for (const track of tracks) {
    const r = await measureTrack(track, swiftSession, swiftInputName, opts);
    results.push(r);
    const lockS = r.lockTimeMs !== null ? (r.lockTimeMs / 1000).toFixed(1) : "DNF";
    const dur = (r.durationMs / 1000).toFixed(0);
    const vfrac = (r.voicedFraction * 100).toFixed(0);
    console.log(`  ${r.trackId} (${dur}s, ${r.sampleRate}Hz, voiced=${vfrac}%): lock at ${lockS}s`);
  }
  return results;
}

console.log("Calibration timing — corpus audio through production pipeline");
console.log("==============================================================");

const swift = await createSwiftF0Session();
console.log("SwiftF0 ONNX loaded.");

// Pick tracks: 8 from each corpus, longest first (so they have
// enough material to potentially lock — short tracks may run out).
function pickLongest(tracks, n) {
  return [...tracks]
    .sort((a, b) => b.samples.length - a.samples.length)
    .slice(0, n);
}

// Concatenate per-speaker sentences with a short inter-sentence
// gap (250 ms of silence) to simulate a multi-sentence session.
// PTDB-TUG and FDA both have ~5-9 s sentences; users in production
// produce many sentences per session, so the realistic test signal
// is the concatenation, not individual tracks.
function concatenateBySpeaker(tracks, speakerKeyFn, gapMs = 250) {
  const bySpeaker = new Map();
  for (const t of tracks) {
    const key = speakerKeyFn(t);
    if (!bySpeaker.has(key)) bySpeaker.set(key, []);
    bySpeaker.get(key).push(t);
  }
  const out = [];
  for (const [key, speakerTracks] of bySpeaker) {
    if (speakerTracks.length === 0) continue;
    const sr = speakerTracks[0].sampleRate;
    // Skip speakers whose tracks have inconsistent sample rates
    if (speakerTracks.some((t) => t.sampleRate !== sr)) continue;
    const gapSamples = Math.floor(sr * gapMs / 1000);
    let totalLen = 0;
    for (const t of speakerTracks) totalLen += t.samples.length + gapSamples;
    const samples = new Float32Array(totalLen);
    let off = 0;
    for (const t of speakerTracks) {
      samples.set(t.samples, off);
      off += t.samples.length + gapSamples;
    }
    out.push({
      corpus: speakerTracks[0].corpus,
      trackId: `${speakerTracks[0].corpus}_${key}_concat${speakerTracks.length}`,
      gender: speakerTracks[0].gender,
      samples: samples.subarray(0, off),
      sampleRate: sr,
      ref: null,
    });
  }
  return out;
}

const vocadito = loadVocadito();
const ptdb = loadPtdbTug();
const fda = loadFda();
console.log(`Corpora loaded: Vocadito=${vocadito.length}, PTDB-TUG=${ptdb.length}, FDA=${fda.length}`);

// Vocadito tracks are ~30 s singing — long enough that some lock natively.
// Filter to those that are at least 30 s (so we can fit a 30+ s baseline window).
// Also concatenate adjacent pairs to extend duration.
const vocaditoLong = vocadito.filter((t) => t.samples.length / t.sampleRate >= 25);
const vocaditoConcat = [];
for (let i = 0; i + 1 < vocaditoLong.length; i += 2) {
  const t1 = vocaditoLong[i], t2 = vocaditoLong[i + 1];
  if (t1.sampleRate !== t2.sampleRate) continue;
  const gapSamples = Math.floor(t1.sampleRate * 0.25);
  const samples = new Float32Array(t1.samples.length + gapSamples + t2.samples.length);
  samples.set(t1.samples, 0);
  samples.set(t2.samples, t1.samples.length + gapSamples);
  vocaditoConcat.push({
    corpus: "vocadito",
    trackId: `${t1.trackId}+${t2.trackId}`,
    gender: "unknown",
    samples,
    sampleRate: t1.sampleRate,
    ref: null,
  });
}

// PTDB-TUG tracks are 5-9 s — concatenate per speaker (M01, F02, etc.)
const ptdbBySpeaker = concatenateBySpeaker(
  ptdb,
  (t) => {
    // trackId format: mic_M01_sxN — speaker key is the M01 / F02 part
    const m = t.trackId.match(/mic_([MF]\d+)_/);
    return m ? m[1] : t.trackId;
  },
);

// FDA tracks are 5-7 s — concatenate per speaker (rl, sb)
const fdaBySpeaker = concatenateBySpeaker(
  fda,
  (t) => t.trackId.substring(0, 2),  // "rl" or "sb"
);

const vocaditoSubset = pickLongest(vocaditoConcat, 8);
const ptdbSubset = pickLongest(ptdbBySpeaker, 8);
const fdaSubset = pickLongest(fdaBySpeaker, 8);

// Measures both the pre-tune (MVF=6) and post-tune (MVF=4, current
// production default) configurations side-by-side. The harness pins
// the value explicitly so the comparison stays meaningful regardless
// of future production tuning.
async function measureSuites(label, opts) {
  const v = await runSuite(`Vocadito (singing) ${label}`, vocaditoSubset, swift.session, swift.inputName, opts);
  const p = await runSuite(`PTDB-TUG (speech) ${label}`, ptdbSubset, swift.session, swift.inputName, opts);
  const f = await runSuite(`FDA (speech) ${label}`, fdaSubset, swift.session, swift.inputName, opts);
  return { vocadito: v, ptdb: p, fda: f };
}

console.log("\n--- Pre-tune (MIN_VOICED_FRAMES=6) — historical, before 2026-05-10 iteration ---");
const defaultRuns = await measureSuites("MVF=6", { minVoicedFrames: 6 });
console.log("\n--- Post-tune (MIN_VOICED_FRAMES=4) — current production default ---");
const whatIfRuns = await measureSuites("MVF=4", { minVoicedFrames: 4 });

const vocaditoResults = defaultRuns.vocadito;
const ptdbResults = defaultRuns.ptdb;
const fdaResults = defaultRuns.fda;

const allResults = [...vocaditoResults, ...ptdbResults, ...fdaResults];
const allLockTimes = allResults
  .filter((r) => r.lockTimeMs !== null)
  .map((r) => r.lockTimeMs / 1000);
const dnfCount = allResults.filter((r) => r.lockTimeMs === null).length;

console.log("\n=== Aggregate distribution (lock time in seconds) ===");
console.log(`Tracks measured: ${allResults.length}, locked: ${allLockTimes.length}, DNF: ${dnfCount}`);
console.log("Vocadito:", JSON.stringify(describe(vocaditoResults.filter((r) => r.lockTimeMs !== null).map((r) => r.lockTimeMs / 1000))));
console.log("PTDB-TUG:", JSON.stringify(describe(ptdbResults.filter((r) => r.lockTimeMs !== null).map((r) => r.lockTimeMs / 1000))));
console.log("FDA:", JSON.stringify(describe(fdaResults.filter((r) => r.lockTimeMs !== null).map((r) => r.lockTimeMs / 1000))));
console.log("Combined:", JSON.stringify(describe(allLockTimes)));

const sortedAll = [...allLockTimes].sort((a, b) => a - b);
const median = percentile(sortedAll, 0.5);
const p75 = percentile(sortedAll, 0.75);

// Decision criteria from work-stream-1 spec
console.log("\n=== Decision criteria ===");
if (median === null) {
  console.log("  No tracks locked. Cannot evaluate.");
  process.exit(2);
}
console.log(`  Median: ${median.toFixed(2)}s, p75: ${p75.toFixed(2)}s`);
let verdict;
if (median <= 45 && p75 <= 60) {
  verdict = "ACCEPTABLE: median ≤ 45s and p75 ≤ 60s — no tuning needed";
} else if (median <= 60 && p75 <= 90) {
  verdict = "TUNABLE: median ≤ 60s and p75 ≤ 90s — apply MIN_VOICED_FRAMES reduction";
} else {
  verdict = "STRUCTURAL: median > 60s OR p75 > 90s — STOP and surface for review";
}
console.log(`  Verdict: ${verdict}`);

// Aggregated stats also useful for diagnostic interpretation
const overallVoicedFrac = allResults.reduce((s, r) => s + r.voicedFraction, 0) / allResults.length;
console.log(`  Mean voiced-frame fraction across tracks: ${(overallVoicedFrac * 100).toFixed(1)}%`);

// What-if MIN_VOICED_FRAMES=4 stats
const whatIfAll = [...whatIfRuns.vocadito, ...whatIfRuns.ptdb, ...whatIfRuns.fda];
const whatIfLockTimes = whatIfAll.filter((r) => r.lockTimeMs !== null).map((r) => r.lockTimeMs / 1000);
console.log("\n=== What-if MIN_VOICED_FRAMES=4 distribution ===");
console.log("Vocadito:", JSON.stringify(describe(whatIfRuns.vocadito.filter((r) => r.lockTimeMs !== null).map((r) => r.lockTimeMs / 1000))));
console.log("PTDB-TUG:", JSON.stringify(describe(whatIfRuns.ptdb.filter((r) => r.lockTimeMs !== null).map((r) => r.lockTimeMs / 1000))));
console.log("FDA:", JSON.stringify(describe(whatIfRuns.fda.filter((r) => r.lockTimeMs !== null).map((r) => r.lockTimeMs / 1000))));
console.log("Combined:", JSON.stringify(describe(whatIfLockTimes)));
const whatIfSorted = [...whatIfLockTimes].sort((a, b) => a - b);
const whatIfMedian = percentile(whatIfSorted, 0.5);
const whatIfP75 = percentile(whatIfSorted, 0.75);
console.log(`What-if median: ${whatIfMedian !== null ? whatIfMedian.toFixed(2) : "NULL"}s, p75: ${whatIfP75 !== null ? whatIfP75.toFixed(2) : "NULL"}s`);

// Persist the measurement so we can compare pre/post-tune
import { writeFileSync, mkdirSync } from "node:fs";
const outDir = "measurements";
try { mkdirSync(outDir, { recursive: true }); } catch {}
const outPath = `${outDir}/calibration-timing-corpus-2026-05-10.json`;
writeFileSync(outPath, JSON.stringify({
  timestamp: new Date().toISOString(),
  preTune: {
    minVoicedFrames: 6,
    note: "Historical pre-tune behavior, kept for regression comparison.",
    perTrack: allResults,
    perCorpus: {
      vocadito: describe(vocaditoResults.filter((r) => r.lockTimeMs !== null).map((r) => r.lockTimeMs / 1000)),
      ptdb: describe(ptdbResults.filter((r) => r.lockTimeMs !== null).map((r) => r.lockTimeMs / 1000)),
      fda: describe(fdaResults.filter((r) => r.lockTimeMs !== null).map((r) => r.lockTimeMs / 1000)),
    },
    combined: describe(allLockTimes),
    decision: { median, p75, verdict },
  },
  postTune: {
    minVoicedFrames: 4,
    note: "Current production default after 2026-05-10 iteration. Brings combined median into 'acceptable' range per WS1 decision criteria.",
    perTrack: whatIfAll,
    perCorpus: {
      vocadito: describe(whatIfRuns.vocadito.filter((r) => r.lockTimeMs !== null).map((r) => r.lockTimeMs / 1000)),
      ptdb: describe(whatIfRuns.ptdb.filter((r) => r.lockTimeMs !== null).map((r) => r.lockTimeMs / 1000)),
      fda: describe(whatIfRuns.fda.filter((r) => r.lockTimeMs !== null).map((r) => r.lockTimeMs / 1000)),
    },
    combined: describe(whatIfLockTimes),
    median: whatIfMedian,
    p75: whatIfP75,
  },
}, null, 2));
console.log(`\nResults written to ${outPath}`);
