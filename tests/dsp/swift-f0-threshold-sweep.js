// swift-f0-threshold-sweep.js — Stage 3.4 threshold sweep against the
// four-corpus pitch-bucket harness. Sweeps confidence thresholds and
// measures both accuracy AND null rate at each.
//
// Why a sweep: SwiftF0's default 0.9 threshold drops 24 % of voiced
// PTDB-TUG <90 Hz frames in Stage 3 — manifests as flickering pitch
// trace in production. Lower thresholds keep more frames at the cost
// of admitting lower-confidence (potentially wrong) pitch estimates.
// Identify the operating point that minimises nulls without sacrificing
// accuracy.
//
// Methodology: SwiftF0 runs once per track and we cache its (pitch,
// confidence) array. For each threshold value, we replay the bucketing
// loop over the cached arrays. ~3-4× cheaper than re-running inference
// per threshold.
//
// Sweep values: {0.9 (default), 0.7, 0.5, 0.3, 0.1, 0.0 (no gate)}.
//
// Output: per-threshold per-bucket-per-corpus table for octave-error
// rate, mean F0 error, and null rate. Identifies dominant cells.

import { writeFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import { loadAllCorpora } from "./data/corpora.js";
import {
  createSwiftF0Session,
  detectPitch,
  nearestSwiftF0Frame,
} from "./swift-f0-adapter.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "../..");

const THRESHOLDS = [0.9, 0.7, 0.5, 0.3, 0.1, 0.0];

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

function isOctaveError(workerHz, truthHz) {
  if (!(workerHz > 0) || !(truthHz > 0)) return false;
  const r = workerHz / truthHz;
  const cand = r > 1 ? r : 1 / r;
  if (cand < 1.5) return false;
  const nearest = Math.round(cand);
  return nearest >= 2 && Math.abs(cand - nearest) / nearest < 0.05;
}

// ---------------------------------------------------------------------------
//  For each track, cache the (truthHz, swiftPitchHz, swiftConf) tuples for
//  every voiced ground-truth frame. Then per-threshold replay over the cache.
// ---------------------------------------------------------------------------

async function collectFrames(session, inputName, track, frameCache) {
  const { samples, sampleRate, ref } = track;
  const winN = Math.floor(sampleRate * 50 / 1000);
  const hopN = Math.floor(sampleRate * 25 / 1000);
  const winCenterMsAtHop0 = 0.5 * winN * 1000 / sampleRate;
  const hopMs = hopN * 1000 / sampleRate;
  const { pitchHz, confidence } = await detectPitch(session, inputName, samples, sampleRate);
  const nSwift = pitchHz.length;
  const corpusFrames = frameCache.get(track.corpus) || [];
  let n = 0;
  for (let i = 0; i + winN <= samples.length; i += hopN, n++) {
    const attrMs = n * hopMs + winCenterMsAtHop0;
    const refIdx = Math.round(attrMs / ref.hopMs);
    if (refIdx < 0 || refIdx >= ref.f0.length) continue;
    const truthHz = ref.f0[refIdx];
    if (truthHz === 0) continue;
    const bucket = bucketIndex(truthHz);
    if (bucket < 0) continue;
    const swiftIdx = nearestSwiftF0Frame(attrMs, nSwift);
    corpusFrames.push({
      bucket: BUCKETS[bucket].label,
      truthHz,
      swiftPitchHz: pitchHz[swiftIdx],
      swiftConf: confidence[swiftIdx],
    });
  }
  frameCache.set(track.corpus, corpusFrames);
}

// ---------------------------------------------------------------------------
//  Per-threshold bucketed evaluation against the cached frame set
// ---------------------------------------------------------------------------

function evaluateAtThreshold(frameCache, threshold) {
  const perCell = new Map();
  const ensureCell = (corpus, bucket) => {
    const key = `${corpus}|${bucket}`;
    let cell = perCell.get(key);
    if (!cell) {
      cell = { errs: [], errMax: 0, octaveCount: 0, nullCount: 0 };
      perCell.set(key, cell);
    }
    return cell;
  };
  for (const [corpus, frames] of frameCache.entries()) {
    for (const f of frames) {
      const cell = ensureCell(corpus, f.bucket);
      if (f.swiftConf < threshold) {
        cell.nullCount++;
        continue;
      }
      const got = f.swiftPitchHz;
      const err = Math.abs(got - f.truthHz);
      cell.errs.push(err);
      if (err > cell.errMax) cell.errMax = err;
      if (isOctaveError(got, f.truthHz)) cell.octaveCount++;
    }
  }
  return perCell;
}

// ---------------------------------------------------------------------------
//  Main
// ---------------------------------------------------------------------------

console.log("Loading SwiftF0 model …");
const { session, inputName } = await createSwiftF0Session();

console.log("Loading all corpora …");
const corpora = loadAllCorpora();
const counts = {};
for (const t of corpora) counts[t.corpus] = (counts[t.corpus] || 0) + 1;
console.log("  corpus track counts:", counts);
if (corpora.length === 0) { console.log("SKIP: no corpora available."); process.exit(0); }

const frameCache = new Map();
const t0 = Date.now();
let processed = 0;
for (const track of corpora) {
  await collectFrames(session, inputName, track, frameCache);
  processed++;
  if (processed % 200 === 0) console.log(`  ${processed}/${corpora.length} tracks (${((Date.now() - t0)/1000).toFixed(1)} s)`);
}
console.log(`Inference + cache done in ${((Date.now() - t0) / 1000).toFixed(1)} s\n`);

const totalCachedFrames = Array.from(frameCache.values()).reduce((a, v) => a + v.length, 0);
console.log(`Cached ${totalCachedFrames} voiced ground-truth frames across ${frameCache.size} corpora`);

// Per-threshold evaluation
const perThreshold = THRESHOLDS.map((th) => ({ threshold: th, perCell: evaluateAtThreshold(frameCache, th) }));

// ---------------------------------------------------------------------------
//  Tables — for each metric, threshold × cell
// ---------------------------------------------------------------------------

const corpusOrder = ["hillenbrand", "ptdb-tug", "vocadito", "fda"];
const corpusLabels = {
  "hillenbrand": "Hillenbrand",
  "ptdb-tug":    "PTDB-TUG",
  "vocadito":    "vocadito",
  "fda":         "FDA",
};

function cellMean(cell) { return cell && cell.errs.length > 0 ? cell.errs.reduce((a,b)=>a+b,0)/cell.errs.length : null; }
function cellMedian(cell) {
  if (!cell || cell.errs.length === 0) return null;
  const s = [...cell.errs].sort((a,b)=>a-b);
  return s[Math.floor(s.length/2)];
}
function cellOctaveRate(cell) {
  if (!cell || cell.errs.length === 0) return null;
  return 100 * cell.octaveCount / cell.errs.length;
}
function cellNullRate(cell) {
  if (!cell) return null;
  const tot = cell.errs.length + cell.nullCount;
  if (tot === 0) return null;
  return 100 * cell.nullCount / tot;
}

function fmtPct(v) { return v === null ? "—".padStart(8) : `${v.toFixed(1)}%`.padStart(8); }
function fmtHz(v) { return v === null ? "—".padStart(8) : `${v.toFixed(1)}`.padStart(8); }

function printAllForMetric(label, getter, fmt) {
  console.log(`\n========== ${label} (threshold sweep) ==========`);
  // For each bucket, show the metric across all 4 corpora at all 6 thresholds.
  // To make this readable: one block per bucket, rows = corpus, cols = threshold.
  for (const b of BUCKETS) {
    let anyData = false;
    for (const c of corpusOrder) {
      for (const { perCell } of perThreshold) {
        const cell = perCell.get(`${c}|${b.label}`);
        if (cell && (cell.errs.length > 0 || cell.nullCount > 0)) { anyData = true; break; }
      }
      if (anyData) break;
    }
    if (!anyData) continue;
    console.log(`\n  Bucket ${b.label}:`);
    console.log("    corpus".padEnd(16) + THRESHOLDS.map((t) => `th=${t}`.padStart(8)).join(" "));
    for (const c of corpusOrder) {
      const row = "    " + corpusLabels[c].padEnd(12);
      const cells = perThreshold.map(({ perCell }) => {
        const cell = perCell.get(`${c}|${b.label}`);
        return fmt(getter(cell));
      });
      console.log(row + cells.join(" "));
    }
  }
}

printAllForMetric("Octave-error rate %", cellOctaveRate, fmtPct);
printAllForMetric("Null rate %",         cellNullRate,   fmtPct);
printAllForMetric("Mean F0 error (Hz)",  cellMean,       fmtHz);
printAllForMetric("Median F0 error (Hz)",cellMedian,     fmtHz);

// ---------------------------------------------------------------------------
//  Compact aggregate table — total octave errors / total frames / null rate
//  per corpus per threshold. Quick scan for the "right" threshold per corpus.
// ---------------------------------------------------------------------------

console.log("\n========== Aggregate per-corpus per-threshold ==========");
console.log("  Format: octErrRate% / nullRate% / meanErrHz");
console.log("  " + "corpus".padEnd(14) + THRESHOLDS.map((t) => `th=${t}`.padStart(22)).join(""));
for (const c of corpusOrder) {
  const row = "  " + corpusLabels[c].padEnd(14);
  const cells = perThreshold.map(({ perCell }) => {
    let octs = 0, errs = 0, nuls = 0, sumErr = 0;
    for (const [key, cell] of perCell.entries()) {
      if (key.startsWith(`${c}|`)) {
        octs += cell.octaveCount;
        errs += cell.errs.length;
        nuls += cell.nullCount;
        sumErr += cell.errs.reduce((a,b)=>a+b,0);
      }
    }
    const tot = errs + nuls;
    const o = errs > 0 ? (100 * octs / errs).toFixed(2) : "0";
    const n = tot > 0 ? (100 * nuls / tot).toFixed(1) : "0";
    const m = errs > 0 ? (sumErr / errs).toFixed(2) : "0";
    return `${o}/${n}/${m}`.padStart(22);
  });
  console.log(row + cells.join(""));
}

// ---------------------------------------------------------------------------
//  Targeted: PTDB-TUG <90 Hz null/octave trade as a function of threshold
//  (the user-flagged worst case at default 0.9)
// ---------------------------------------------------------------------------

console.log("\n========== PTDB-TUG <90 Hz: null/octave trade by threshold ==========");
console.log("  threshold   nVoiced  nNull  nullRate%  octErr  octErrRate%  meanErrHz");
for (const { threshold, perCell } of perThreshold) {
  const cell = perCell.get("ptdb-tug|<90");
  if (!cell) continue;
  const tot = cell.errs.length + cell.nullCount;
  const m = cell.errs.length > 0 ? (cell.errs.reduce((a,b)=>a+b,0)/cell.errs.length).toFixed(2) : "—";
  console.log(
    `      ${threshold}  ` +
    `${String(cell.errs.length).padStart(8)} ` +
    `${String(cell.nullCount).padStart(6)} ` +
    `${(100 * cell.nullCount / Math.max(1, tot)).toFixed(1).padStart(9)}% ` +
    `${String(cell.octaveCount).padStart(7)} ` +
    `${(100 * cell.octaveCount / Math.max(1, cell.errs.length)).toFixed(2).padStart(11)}% ` +
    `${String(m).padStart(10)}`
  );
}

// ---------------------------------------------------------------------------
//  JSON output
// ---------------------------------------------------------------------------

const jsonOut = {
  generatedAt: new Date().toISOString(),
  thresholds: THRESHOLDS,
  totalCachedFrames,
  corpora: counts,
  perThreshold: perThreshold.map(({ threshold, perCell }) => ({
    threshold,
    perCell: Array.from(perCell.entries()).map(([key, cell]) => {
      const [corpus, bucket] = key.split("|");
      return {
        corpus, bucket,
        meanErr: cellMean(cell),
        medianErr: cellMedian(cell),
        maxErr: cell.errs.length > 0 ? cell.errMax : null,
        octaveCount: cell.octaveCount,
        octaveErrorRate: cellOctaveRate(cell) === null ? null : cellOctaveRate(cell) / 100,
        nullCount: cell.nullCount,
        nullRate: cellNullRate(cell) === null ? null : cellNullRate(cell) / 100,
        n: cell.errs.length + cell.nullCount,
      };
    }),
  })),
};

const jsonPath = join(ROOT, "measurements", "swift-f0-threshold-sweep-2026-05-06.json");
writeFileSync(jsonPath, JSON.stringify(jsonOut, null, 2));
console.log(`\nJSON saved to: ${jsonPath}`);
