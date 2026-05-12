// cpp-adaptive-window-probe.js — Empirical probe for R2 of the
// 2026-05-12 vocal-weight course correction.
//
// Question: after a 30-s baseline period, how does CPP-aggregate
// behave on a longer running stream of voiced speech? Specifically:
//
//   - Pattern A (continuous sliding window): would σ collapse on
//     consistent voice, producing gauge hypersensitivity?
//   - Pattern B (lock + recompute on shift): how often would a
//     "voice characteristics shifted significantly" trigger fire on
//     a normally-varying speaker?
//
// Approach: stitch PTDB-TUG tracks from one speaker into a longer
// stream (~90 s of running speech), compute per-frame CPP through
// the production aggregator, then sweep both patterns over the
// stream:
//
//   Pattern A: rolling 30-s window of aggregator emits; recompute
//   μ/σ each step.
//   Pattern B: lock at 30 s, recompute when |new-window μ - locked
//   μ| > LOCK_MU_SHIFT_THRESHOLD × locked σ.
//
// Output: per-pattern trajectory of (time, μ, σ, gaugePosition),
// plus summary stats (σ min/max/median, Pattern B trigger count).
//
// Usage: node tests/dsp/cpp-adaptive-window-probe.js
// Output: measurements/cpp-adaptive-window-probe-2026-05-12.json

import { writeFileSync, mkdirSync } from "node:fs";
import { computeCPP, resetCppState } from "../../src/dsp/cpp.js";
import { VocalWeightAggregator } from "../../src/audio/vocal-weight-aggregator.js";
import { loadPtdbTug } from "./data/corpora.js";

const CHUNK_MS = 25;
const WINDOW_MS = 50;
const BASELINE_VOICED_MS = 30000;
const AGGREGATE_INTERVAL_MS = 250;
const WINDOW_SAMPLES_PATTERN_A = Math.ceil(BASELINE_VOICED_MS / AGGREGATE_INTERVAL_MS); // 120
const LOCK_MU_SHIFT_THRESHOLD_PATTERN_B = 1.0; // ±1σ shift triggers relock
const PATTERN_B_RECHECK_EVERY_N = Math.ceil(BASELINE_VOICED_MS / AGGREGATE_INTERVAL_MS); // every 30 s

function mean(arr) {
  return arr.reduce((a, b) => a + b, 0) / arr.length;
}

function stdev(arr, mu = null) {
  const m = mu ?? mean(arr);
  const v = arr.reduce((s, x) => s + (x - m) ** 2, 0) / Math.max(1, arr.length - 1);
  return Math.sqrt(v);
}

function describe(arr) {
  if (arr.length === 0) return null;
  const s = [...arr].sort((a, b) => a - b);
  return {
    n: s.length,
    min: s[0],
    p25: s[Math.floor(s.length * 0.25)],
    median: s[Math.floor(s.length * 0.5)],
    p75: s[Math.floor(s.length * 0.75)],
    max: s[s.length - 1],
    mean: mean(s),
    stdev: stdev(s),
  };
}

// Build a long stitched stream from PTDB tracks (one speaker). PTDB
// tracks are ~7 s each; concatenating ~15 produces a 90+ s "session".
// Filter to a single speaker to avoid speaker-mean discontinuities
// that would inflate σ artificially.
console.log("CPP adaptive-window probe");
console.log("=========================\n");

const ptdb = loadPtdbTug();
// Pick speaker F01 (gender female speaker 01) and concatenate their tracks
const speaker = "F01";
const tracks = ptdb.filter((t) => t.trackId.includes(speaker)).slice(0, 30);
if (tracks.length < 10) {
  console.error(`Not enough tracks for speaker ${speaker} (found ${tracks.length})`);
  process.exit(1);
}
console.log(`Stitching ${tracks.length} PTDB-TUG tracks from speaker ${speaker}...`);
const sampleRate = tracks[0].sampleRate;
let totalSamples = 0;
for (const t of tracks) totalSamples += t.samples.length;
const stitched = new Float32Array(totalSamples);
let writePos = 0;
for (const t of tracks) {
  stitched.set(t.samples, writePos);
  writePos += t.samples.length;
}
const totalSec = totalSamples / sampleRate;
console.log(`Stitched stream: ${totalSec.toFixed(1)} s at ${sampleRate} Hz\n`);

// Run streaming CPP through the aggregator, collecting per-emit values.
resetCppState();
const chunkSize = Math.floor(sampleRate * CHUNK_MS / 1000);
const windowSize = Math.floor(sampleRate * WINDOW_MS / 1000);
const ringCapacity = windowSize * 2;
const ring = new Float32Array(ringCapacity);
let ringLen = 0;
const aggregator = new VocalWeightAggregator();
const aggregateStream = []; // { time, cpp }
let lastAggTime = -1;

for (let chunkIdx = 0; ; chunkIdx++) {
  const chunkStart = chunkIdx * chunkSize;
  if (chunkStart + chunkSize > stitched.length) break;
  const chunk = stitched.subarray(chunkStart, chunkStart + chunkSize);

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

  const cpp = computeCPP(window, sampleRate);
  const emit = aggregator.push({ time, cpp, voiced: true });
  if (emit && emit.time !== lastAggTime) {
    aggregateStream.push({ time: emit.time, cpp: emit.cpp });
    lastAggTime = emit.time;
  }
}

console.log(`Aggregator emits: ${aggregateStream.length} (~${(aggregateStream.length * AGGREGATE_INTERVAL_MS / 1000).toFixed(1)} s of voiced content)\n`);

if (aggregateStream.length < WINDOW_SAMPLES_PATTERN_A + 30) {
  console.error("Stream too short for the experiment — need >= 30s of post-baseline content");
  process.exit(1);
}

// ============================================================
// Pattern A: continuous sliding window
// ============================================================
console.log("Pattern A — continuous sliding window (W = 30 s = 120 samples)");
console.log("-----");

const patternA = []; // { time, mu, sigma, gaugePosition }
for (let i = WINDOW_SAMPLES_PATTERN_A - 1; i < aggregateStream.length; i++) {
  const window = aggregateStream.slice(i - WINDOW_SAMPLES_PATTERN_A + 1, i + 1).map((e) => e.cpp);
  const mu = mean(window);
  const sigma = stdev(window, mu);
  const cpp = aggregateStream[i].cpp;
  const sigmaDelta = sigma > 0 ? (cpp - mu) / sigma : 0;
  const pos = Math.max(0, Math.min(1, (sigmaDelta + 2) / 4));
  patternA.push({
    time: aggregateStream[i].time,
    mu,
    sigma,
    sigmaDelta,
    pos,
    cpp,
  });
}

const sigmasA = patternA.map((p) => p.sigma);
const musA = patternA.map((p) => p.mu);
console.log(`  σ:     ${JSON.stringify(describe(sigmasA))}`);
console.log(`  μ:     ${JSON.stringify(describe(musA))}`);
console.log(`  σ min: ${Math.min(...sigmasA).toFixed(4)} dB`);
console.log(`  μ range across stream: ${(Math.max(...musA) - Math.min(...musA)).toFixed(3)} dB`);

// Check how often gauge would clip (|sigmaDelta| > 2)
const sigmaDeltasA = patternA.map((p) => p.sigmaDelta);
const clipFracA = sigmaDeltasA.filter((s) => Math.abs(s) > 2).length / sigmaDeltasA.length;
console.log(`  Frames with |sigmaDelta| > 2 (gauge clamps): ${(clipFracA * 100).toFixed(1)} %`);

// ============================================================
// Pattern B: lock + recompute on shift
// ============================================================
console.log("\nPattern B — lock + recompute on shift");
console.log("  shift threshold: |μ_new - μ_locked| > 1.0 σ_locked");
console.log("  recheck cadence: every 30 s (120 samples)");
console.log("-----");

// Initial lock at sample 120 (same as Pattern A's first valid window)
let lockedMu = mean(aggregateStream.slice(0, WINDOW_SAMPLES_PATTERN_A).map((e) => e.cpp));
let lockedSigma = stdev(aggregateStream.slice(0, WINDOW_SAMPLES_PATTERN_A).map((e) => e.cpp), lockedMu);
const lockedSigmaFloor = Math.max(lockedSigma, 0.05); // avoid /0 if first window degenerate
const patternB = [];
const relockEvents = [];

for (let i = WINDOW_SAMPLES_PATTERN_A - 1; i < aggregateStream.length; i++) {
  const cpp = aggregateStream[i].cpp;
  const sigmaDelta = (cpp - lockedMu) / (lockedSigma > 0 ? lockedSigma : lockedSigmaFloor);
  const pos = Math.max(0, Math.min(1, (sigmaDelta + 2) / 4));
  patternB.push({
    time: aggregateStream[i].time,
    mu: lockedMu,
    sigma: lockedSigma,
    sigmaDelta,
    pos,
    cpp,
  });
  // Check for shift every PATTERN_B_RECHECK_EVERY_N samples
  if (i >= WINDOW_SAMPLES_PATTERN_A * 2 - 1
      && (i - WINDOW_SAMPLES_PATTERN_A + 1) % PATTERN_B_RECHECK_EVERY_N === 0) {
    const recent = aggregateStream.slice(i - WINDOW_SAMPLES_PATTERN_A + 1, i + 1).map((e) => e.cpp);
    const muNew = mean(recent);
    const sigmaNew = stdev(recent, muNew);
    const shift = Math.abs(muNew - lockedMu) / (lockedSigma > 0 ? lockedSigma : lockedSigmaFloor);
    if (shift > LOCK_MU_SHIFT_THRESHOLD_PATTERN_B) {
      relockEvents.push({
        atTimeMs: aggregateStream[i].time,
        atSampleIdx: i,
        oldMu: lockedMu,
        newMu: muNew,
        oldSigma: lockedSigma,
        newSigma: sigmaNew,
        shiftSigmas: shift,
      });
      lockedMu = muNew;
      lockedSigma = sigmaNew;
    }
  }
}

console.log(`  Relock events: ${relockEvents.length} over ${(aggregateStream.length * AGGREGATE_INTERVAL_MS / 1000).toFixed(0)} s`);
for (const evt of relockEvents) {
  console.log(`    @${(evt.atTimeMs / 1000).toFixed(1)}s: μ ${evt.oldMu.toFixed(3)} → ${evt.newMu.toFixed(3)} (shift ${evt.shiftSigmas.toFixed(2)}σ)`);
}
const sigmaDeltasB = patternB.map((p) => p.sigmaDelta);
const clipFracB = sigmaDeltasB.filter((s) => Math.abs(s) > 2).length / sigmaDeltasB.length;
console.log(`  Frames with |sigmaDelta| > 2 (gauge clamps): ${(clipFracB * 100).toFixed(1)} %`);

// ============================================================
// Sigma-collapse risk: what fraction of Pattern A samples have σ < 0.1 dB?
// ============================================================
const sigmaCollapseFracA = sigmasA.filter((s) => s < 0.1).length / sigmasA.length;
console.log(`\nσ-collapse risk: Pattern A frames with σ < 0.1 dB: ${(sigmaCollapseFracA * 100).toFixed(1)} %`);

// ============================================================
// Save
// ============================================================
mkdirSync("measurements", { recursive: true });
writeFileSync("measurements/cpp-adaptive-window-probe-2026-05-12.json", JSON.stringify({
  timestamp: new Date().toISOString(),
  config: {
    speaker,
    numTracks: tracks.length,
    sampleRate,
    chunkMs: CHUNK_MS,
    windowMs: WINDOW_MS,
    aggregateIntervalMs: AGGREGATE_INTERVAL_MS,
    patternAWindowSamples: WINDOW_SAMPLES_PATTERN_A,
    patternBShiftThreshold: LOCK_MU_SHIFT_THRESHOLD_PATTERN_B,
    patternBRecheckEveryN: PATTERN_B_RECHECK_EVERY_N,
  },
  patternA: {
    sigmaStats: describe(sigmasA),
    muStats: describe(musA),
    sigmaCollapseFrac: sigmaCollapseFracA,
    gaugeClampFrac: clipFracA,
  },
  patternB: {
    relockEvents,
    relockCount: relockEvents.length,
    gaugeClampFrac: clipFracB,
  },
  // Truncate trajectories to first 200 samples for inspection
  patternATrajectorySample: patternA.slice(0, 200),
  patternBTrajectorySample: patternB.slice(0, 200),
}, null, 2));
console.log("\nWrote measurements/cpp-adaptive-window-probe-2026-05-12.json");
