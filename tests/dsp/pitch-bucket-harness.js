// pitch-bucket-harness.js — Frame-level per-pitch-bucket per-corpus
// accuracy report for production pitch detection. The durable measurement
// infrastructure that future fix work measures against.
//
// Usage: node tests/dsp/pitch-bucket-harness.js
//
// What it does
//
//   For each integrated corpus (Hillenbrand, PTDB-TUG, vocadito, FDA),
//   runs the production-config worker (Stage 2 L=4) frame-by-frame at
//   25 ms hops × 50 ms windows. For every voiced ground-truth frame,
//   the frame's TRUTH F0 chooses a pitch bucket; the worker's reported
//   F0 (or null) determines the error contribution.
//
//   Output: a frame-level per-bucket-per-corpus table with mean F0
//   error, max F0 error, octave-error rate, and frame count per cell.
//   Plus a per-track outlier list for spotting hard tracks that
//   aggregate stats hide.
//
// Methodology notes
//
//   - Frame-level bucketing (not track-level): a track with refMedian
//     135 Hz and refP10 88 Hz contributes frames to multiple buckets
//     based on each frame's individual ref F0. Preserves within-track
//     variation that track-level binning would lose.
//   - Reference hop varies per corpus (Hillenbrand 5 ms, PTDB-TUG 10 ms,
//     vocadito 5.8 ms, FDA 5 ms via interpolation); shared loaders in
//     tests/dsp/data/corpora.js normalize each to a regular-hop f0
//     array with 0 indicating unvoiced.
//   - Octave-error definition: |worker_hz / truth_hz| within 5% of an
//     integer multiple ≥ 2 (super-octave: 2×, 3×, 4×, 5×, ...) OR the
//     reciprocal (sub-octave: 1/2, 1/3, ...). Common harmonic-confusion
//     failure mode in low-pitch regimes.
//   - Per-corpus stage selection: only Stage 2 L=4 (production ship);
//     Stage 0 baseline available via the per-corpus tests, not repeated
//     here to keep the harness focused on the production-baseline
//     measurement question.

import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import vm from "vm";
import { loadAllCorpora } from "./data/corpora.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "../..");
const WORKER_PATH = join(ROOT, "src/dsp/dsp-worker.js");

// Pitch buckets in Hz. Boundaries chosen per the user's Stage 4 spec:
// <90 (sub-male / vocal fry / trans-masc on T), 90-120 (low-male),
// 120-150 (mid-male), 150-180 (upper-male / low-female), 180-220
// (mid-female), 220-280 (upper-female), 280-350 (high-female /
// pre-pubescent / trans-fem), >350 (very high).
const BUCKETS = [
  { label: "<90",     min: 0,    max: 90 },
  { label: "90-120",  min: 90,   max: 120 },
  { label: "120-150", min: 120,  max: 150 },
  { label: "150-180", min: 150,  max: 180 },
  { label: "180-220", min: 180,  max: 220 },
  { label: "220-280", min: 220,  max: 280 },
  { label: "280-350", min: 280,  max: 350 },
  { label: ">350",    min: 350,  max: Infinity },
];

function bucketIndex(hz) {
  for (let i = 0; i < BUCKETS.length; i++) {
    if (hz >= BUCKETS[i].min && hz < BUCKETS[i].max) return i;
  }
  return -1;
}

// Octave-error detector: worker / truth close to an integer multiple ≥ 2
// (super-octave) OR its reciprocal (sub-octave). Tolerance 5 % of the
// integer (so 3.0 ± 0.15, 4.0 ± 0.20, ...). Excludes 1.0 (correct).
function isOctaveError(workerHz, truthHz) {
  if (!(workerHz > 0) || !(truthHz > 0)) return false;
  const r = workerHz / truthHz;
  const cand = r > 1 ? r : 1 / r;
  if (cand < 1.5) return false;
  const nearest = Math.round(cand);
  return nearest >= 2 && Math.abs(cand - nearest) / nearest < 0.05;
}

// ---------------------------------------------------------------------------
//  Worker context per sample rate (corpora span 16/20/44.1/48 kHz)
// ---------------------------------------------------------------------------

const ctxBySampleRate = new Map();
function getWorkerCtx(sampleRate) {
  let ctx = ctxBySampleRate.get(sampleRate);
  if (ctx) return ctx;
  const src = readFileSync(WORKER_PATH, "utf8");
  ctx = {
    self: { postMessage() {}, onmessage: null },
    performance: { now: () => 0, timeOrigin: 0 },
    console,
    __PYIN_STAGE: 2,
    __PYIN_LOOKBACK: 4,
  };
  vm.createContext(ctx);
  vm.runInContext(src, ctx, { filename: "dsp-worker.js" });
  ctx.self.onmessage({ data: { type: "init", sampleRate } });
  ctxBySampleRate.set(sampleRate, ctx);
  return ctx;
}

function resetHmm(ctx) {
  ctx.self.onmessage({ data: { type: "reset-pitch-hmm" } });
}

// ---------------------------------------------------------------------------
//  Per-track evaluation. For each worker hop, attribute pitch to L-back
//  reference time, look up ref F0, accumulate into bucket cell.
// ---------------------------------------------------------------------------

function evalTrack(ctx, track, lookback, perCellAcc, perTrackAcc) {
  resetHmm(ctx);
  const { samples, sampleRate, ref } = track;
  const winN = Math.floor(sampleRate * 50 / 1000);
  const hopN = Math.floor(sampleRate * 25 / 1000);
  const winCenterMsAtHop0 = 0.5 * winN * 1000 / sampleRate;
  const hopMs = hopN * 1000 / sampleRate;
  let n = 0;
  let trackErrSum = 0, trackErrCount = 0, trackOctaveCount = 0, trackNullCount = 0;
  for (let i = 0; i + winN <= samples.length; i += hopN, n++) {
    const got = ctx.detectPitch(samples.subarray(i, i + winN), sampleRate);
    const attrHop = n - lookback;
    if (attrHop < 0) continue;
    const attrMs = attrHop * hopMs + winCenterMsAtHop0;
    const refIdx = Math.round(attrMs / ref.hopMs);
    if (refIdx < 0 || refIdx >= ref.f0.length) continue;
    const truthHz = ref.f0[refIdx];
    if (truthHz === 0) continue;  // unvoiced ref
    const bucket = bucketIndex(truthHz);
    if (bucket < 0) continue;
    const cellKey = `${track.corpus}|${BUCKETS[bucket].label}`;
    let cell = perCellAcc.get(cellKey);
    if (!cell) {
      cell = { errs: [], errMax: 0, octaveCount: 0, nullCount: 0 };
      perCellAcc.set(cellKey, cell);
    }
    if (got === null) {
      cell.nullCount++;
      trackNullCount++;
      continue;
    }
    const err = Math.abs(got - truthHz);
    cell.errs.push(err);
    if (err > cell.errMax) cell.errMax = err;
    if (isOctaveError(got, truthHz)) cell.octaveCount++;
    trackErrSum += err;
    trackErrCount++;
    if (isOctaveError(got, truthHz)) trackOctaveCount++;
  }
  perTrackAcc.push({
    corpus: track.corpus, trackId: track.trackId, gender: track.gender,
    meanErr: trackErrCount > 0 ? trackErrSum / trackErrCount : NaN,
    n: trackErrCount, octaveCount: trackOctaveCount, nullCount: trackNullCount,
  });
}

// ---------------------------------------------------------------------------
//  Main
// ---------------------------------------------------------------------------

console.log("Loading all corpora …");
const corpora = loadAllCorpora();
const counts = {};
for (const t of corpora) counts[t.corpus] = (counts[t.corpus] || 0) + 1;
console.log("  corpus track counts:", counts);
if (corpora.length === 0) {
  console.log("SKIP: no corpora available. Populate via:");
  console.log("  bash scripts/fetch-ptdb-tug-subset.sh");
  console.log("  bash scripts/fetch-fda-subset.sh");
  console.log("  (Hillenbrand and Vocadito are committed in-repo.)");
  process.exit(0);
}

const perCellAcc = new Map();      // "corpus|bucket" -> cell stats
const perTrackAcc = [];

const t0 = Date.now();
let processed = 0;
for (const track of corpora) {
  const ctx = getWorkerCtx(track.sampleRate);
  evalTrack(ctx, track, 4, perCellAcc, perTrackAcc);
  processed++;
  if (processed % 100 === 0) console.log(`  ${processed}/${corpora.length} tracks`);
}
console.log(`Done in ${((Date.now() - t0) / 1000).toFixed(1)} s\n`);

// ---------------------------------------------------------------------------
//  Per-bucket × per-corpus tables
// ---------------------------------------------------------------------------

const corpusOrder = ["hillenbrand", "ptdb-tug", "vocadito", "fda"];
const corpusLabels = {
  "hillenbrand": "Hillenbrand",
  "ptdb-tug": "PTDB-TUG",
  "vocadito": "vocadito",
  "fda": "FDA",
};

function cellMean(cell) {
  if (!cell || cell.errs.length === 0) return null;
  return cell.errs.reduce((a, b) => a + b, 0) / cell.errs.length;
}
function cellMedian(cell) {
  if (!cell || cell.errs.length === 0) return null;
  const s = [...cell.errs].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)];
}
function fmtCellMean(cell) {
  if (!cell || cell.errs.length === 0) {
    if (cell && cell.nullCount > 0) return `(null=${cell.nullCount})`.padStart(10);
    return "—".padStart(10);
  }
  return `${cellMean(cell).toFixed(1)}`.padStart(10);
}
function fmtCellMedian(cell) {
  if (!cell || cell.errs.length === 0) return "—".padStart(10);
  return `${cellMedian(cell).toFixed(1)}`.padStart(10);
}
function fmtCellMax(cell) {
  if (!cell || cell.errs.length === 0) return "—".padStart(10);
  return `${cell.errMax.toFixed(1)}`.padStart(10);
}
function fmtCellOctave(cell) {
  if (!cell || cell.errs.length === 0) return "—".padStart(10);
  const rate = 100 * cell.octaveCount / Math.max(1, cell.errs.length);
  return `${rate.toFixed(1)}%`.padStart(10);
}
function fmtCellN(cell) {
  if (!cell) return "0".padStart(8);
  return `${cell.errs.length + cell.nullCount}`.padStart(8);
}

function printTable(title, fmtCellFn) {
  console.log(`\n========== ${title} ==========`);
  const header = "  bucket".padEnd(11) + corpusOrder.map((c) => corpusLabels[c].padStart(10)).join(" ");
  console.log(header);
  for (const b of BUCKETS) {
    const row = "  " + b.label.padEnd(9);
    const cells = corpusOrder.map((c) => fmtCellFn(perCellAcc.get(`${c}|${b.label}`)));
    console.log(row + cells.join(" "));
  }
}

printTable("Median F0 error (Hz) per bucket × corpus", fmtCellMedian);
printTable("Mean F0 error (Hz) per bucket × corpus", fmtCellMean);
printTable("Max F0 error (Hz) per bucket × corpus", fmtCellMax);
printTable("Octave-error rate per bucket × corpus", fmtCellOctave);
printTable("Frame count per bucket × corpus", fmtCellN);

// ---------------------------------------------------------------------------
//  Per-track outliers — top 20 tracks by mean F0 error within each corpus,
//  with at least 30 voiced frames (filters out short/empty tracks).
// ---------------------------------------------------------------------------

console.log("\n========== Per-track outliers (top 15 by mean F0 error, per corpus) ==========");
console.log("  Tracks with < 30 voiced frames excluded (statistical noise).");
for (const corpus of corpusOrder) {
  const tracks = perTrackAcc
    .filter((t) => t.corpus === corpus && t.n >= 30 && Number.isFinite(t.meanErr))
    .sort((a, b) => b.meanErr - a.meanErr)
    .slice(0, 15);
  if (tracks.length === 0) continue;
  console.log(`\n  ${corpusLabels[corpus]}:`);
  console.log(`    ${"trackId".padEnd(28)} ${"gender".padStart(6)} ${"meanErr".padStart(8)} ${"octErr".padStart(8)} ${"n".padStart(6)}`);
  for (const t of tracks) {
    console.log(
      `    ${String(t.trackId).padEnd(28)} ${String(t.gender).padStart(6)} ` +
      `${t.meanErr.toFixed(2).padStart(8)} ${t.octaveCount.toString().padStart(8)} ${String(t.n).padStart(6)}`,
    );
  }
}

// ---------------------------------------------------------------------------
//  JSON for downstream tooling
// ---------------------------------------------------------------------------

const jsonOut = {
  generatedAt: new Date().toISOString(),
  workerStage: 2,
  lookback: 4,
  corpora: counts,
  buckets: BUCKETS.map((b) => b.label),
  perCell: Array.from(perCellAcc.entries()).map(([key, cell]) => {
    const [corpus, bucket] = key.split("|");
    return {
      corpus, bucket,
      meanErr: cellMean(cell),
      medianErr: cellMedian(cell),
      maxErr: cell.errs.length > 0 ? cell.errMax : null,
      octaveErrorRate: cell.errs.length > 0 ? cell.octaveCount / cell.errs.length : null,
      n: cell.errs.length + cell.nullCount,
      nullCount: cell.nullCount,
    };
  }),
  perTrack: perTrackAcc,
};

console.log("\n--- BEGIN-JSON ---");
console.log(JSON.stringify(jsonOut, null, 2));
console.log("--- END-JSON ---");
