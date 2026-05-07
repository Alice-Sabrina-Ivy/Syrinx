// pitch-bucket-harness-swift.js — SwiftF0 mirror of pitch-bucket-harness.js.
// Same per-bucket-per-corpus accuracy report, same attribution methodology,
// but the per-frame pitch decision comes from SwiftF0 instead of pYIN.
//
// Stage 3.2 of the SwiftF0 + Syrinx investigation. Validation only — measures
// whether SwiftF0's published Nieradzik-benchmark numbers transfer to
// Syrinx's specific corpus mix at frame-level bucketing.
//
// Usage: node tests/dsp/pitch-bucket-harness-swift.js
//
// Methodology
//
//   For each track, run SwiftF0 over the entire audio at native 16 kHz / 16 ms
//   hops. Then iterate the harness at 25 ms hops with 50 ms windows (matching
//   the pYIN harness exactly), and for each ground-truth voiced frame, look
//   up the nearest SwiftF0 frame in time. SwiftF0's voicing decision
//   (confidence > 0.9) determines null vs pitch_hz.
//
//   Attribution differs from pYIN: SwiftF0 has no HMM lookback, so each
//   harness hop n attributes to truth time `winCenterMsAtHop0 + n * hopMs`
//   (no L-back delay).
//
// Direct comparison with measurements/pitch-bucket-baseline-2026-05-06.md
//   pYIN harness uses lookback=4 (100 ms delay). SwiftF0 attribution is
//   immediate (just frame-center timestamps). Both produce the same
//   per-bucket per-corpus tables — voiced ground-truth frames are the
//   shared denominator, the per-system-pitch-decision is the variable.

import { writeFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import { loadAllCorpora } from "./data/corpora.js";
import {
  createSwiftF0Session,
  detectPitch,
  nearestSwiftF0Frame,
  SWIFT_F0_DEFAULT_CONF_THRESHOLD,
} from "./swift-f0-adapter.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "../..");

const CONFIDENCE_THRESHOLD = SWIFT_F0_DEFAULT_CONF_THRESHOLD; // 0.9

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
//  Per-track evaluation. Run SwiftF0 once on the full track, then iterate
//  harness 25 ms hops and look up nearest SwiftF0 frame at attribution time.
// ---------------------------------------------------------------------------

async function evalTrack(session, inputName, track, perCellAcc, perTrackAcc) {
  const { samples, sampleRate, ref } = track;
  const winN = Math.floor(sampleRate * 50 / 1000);
  const hopN = Math.floor(sampleRate * 25 / 1000);
  const winCenterMsAtHop0 = 0.5 * winN * 1000 / sampleRate;
  const hopMs = hopN * 1000 / sampleRate;

  // Single SwiftF0 inference call covers the full track.
  const { pitchHz, confidence } = await detectPitch(session, inputName, samples, sampleRate);
  const nSwift = pitchHz.length;

  let n = 0;
  let trackErrSum = 0, trackErrCount = 0, trackOctaveCount = 0, trackNullCount = 0;
  for (let i = 0; i + winN <= samples.length; i += hopN, n++) {
    // Attribution time: SwiftF0 has no HMM lookback, so attribute to current hop.
    const attrMs = n * hopMs + winCenterMsAtHop0;
    const refIdx = Math.round(attrMs / ref.hopMs);
    if (refIdx < 0 || refIdx >= ref.f0.length) continue;
    const truthHz = ref.f0[refIdx];
    if (truthHz === 0) continue;  // unvoiced ref
    const bucket = bucketIndex(truthHz);
    if (bucket < 0) continue;
    const swiftIdx = nearestSwiftF0Frame(attrMs, nSwift);
    const conf = confidence[swiftIdx];
    const got = conf >= CONFIDENCE_THRESHOLD ? pitchHz[swiftIdx] : null;
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

console.log("Loading SwiftF0 model …");
const { session, inputName } = await createSwiftF0Session();
console.log(`  loaded. inputs=${JSON.stringify(session.inputNames)} outputs=${JSON.stringify(session.outputNames)}`);
console.log(`  confidence threshold: ${CONFIDENCE_THRESHOLD}`);

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

const perCellAcc = new Map();
const perTrackAcc = [];

const t0 = Date.now();
let processed = 0;
for (const track of corpora) {
  await evalTrack(session, inputName, track, perCellAcc, perTrackAcc);
  processed++;
  if (processed % 50 === 0) console.log(`  ${processed}/${corpora.length} tracks`);
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
function fmtCellNullRate(cell) {
  if (!cell) return "—".padStart(10);
  const total = cell.errs.length + cell.nullCount;
  if (total === 0) return "—".padStart(10);
  return `${(100 * cell.nullCount / total).toFixed(1)}%`.padStart(10);
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
printTable("Null rate (unvoiced ground truth not flagged) per bucket × corpus", fmtCellNullRate);
printTable("Frame count per bucket × corpus", fmtCellN);

// ---------------------------------------------------------------------------
//  Per-track outliers
// ---------------------------------------------------------------------------

console.log("\n========== Per-track outliers (top 15 by mean F0 error, per corpus) ==========");
console.log("  Tracks with < 30 voiced frames excluded.");
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
//  Specific user-flagged reproducers
// ---------------------------------------------------------------------------

console.log("\n========== Targeted reproducers ==========");
const targeted = ["rl022", "vocadito_34"];
for (const id of targeted) {
  const t = perTrackAcc.find((x) => x.trackId === id || x.trackId === `${id}`);
  if (t) {
    console.log(`  ${id.padEnd(28)} corpus=${t.corpus.padEnd(12)} gender=${t.gender} ` +
      `meanErr=${t.meanErr.toFixed(2)} octErr=${t.octaveCount} n=${t.n} null=${t.nullCount}`);
  } else {
    console.log(`  ${id.padEnd(28)} NOT FOUND in corpora`);
  }
}

// ---------------------------------------------------------------------------
//  JSON for downstream tooling
// ---------------------------------------------------------------------------

const jsonOut = {
  generatedAt: new Date().toISOString(),
  model: "SwiftF0",
  modelVersion: "lars76/swift-f0 main (commit unknown — fetched 2026-05-06)",
  confidenceThreshold: CONFIDENCE_THRESHOLD,
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

const jsonPath = join(ROOT, "measurements", "swift-f0-pitch-bucket-2026-05-06.json");
writeFileSync(jsonPath, JSON.stringify(jsonOut, null, 2));
console.log(`\nJSON saved to: ${jsonPath}`);
