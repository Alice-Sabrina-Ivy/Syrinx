// pitch-bucket-alpha-sweep.js — Sweep the pYIN HMM mixture-prior weight α
// across {0.0001 (production baseline), 0.00001, 0.000001, 0} and compare
// per-pitch-bucket per-corpus accuracy.
//
// Hypothesis (per measurements/pitch-bucket-baseline-2026-05-06.md "Tuning
// hypotheses for future fix work"): the production α=0.0001 mixture prior
// admits more spurious cross-octave transitions than needed. Reducing α
// might lower the sub-90-Hz octave-error rate (the failure mode the user
// observed against Voice Tools) AND the mid-range octave-error rates,
// without regressing the recovery-time gains the PR #69 investigation
// established at α=0.0001.
//
// Risk: lower α slows recovery from wrong-octave lock states (per the
// octave-lock investigation, α=0 puts cross-octave transitions at
// exp(-288), trapping the HMM for ≥10 frames). Watch for regressions
// in: (a) any per-track outlier worse than baseline, (b) mid-range
// median F0 error increases.
//
// Usage: node tests/dsp/pitch-bucket-alpha-sweep.js
//
// Wall time: ~5-6 minutes (1436 tracks × 4 alpha values).

import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import vm from "vm";
import { loadAllCorpora } from "./data/corpora.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "../..");
const WORKER_PATH = join(ROOT, "src/dsp/dsp-worker.js");

const ALPHAS = [0.0001, 0.00001, 0.000001, 0];
const ALPHA_LABEL = (a) => a === 0 ? "0" : a.toExponential().replace("e-0", "e-").replace("e-", "e-");

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
  for (let i = 0; i < BUCKETS.length; i++) if (hz >= BUCKETS[i].min && hz < BUCKETS[i].max) return i;
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

const corpusOrder = ["hillenbrand", "ptdb-tug", "vocadito", "fda"];
const corpusLabels = { "hillenbrand": "Hillen", "ptdb-tug": "PTDB", "vocadito": "vocad", "fda": "FDA" };

// ---------------------------------------------------------------------------
//  Worker context per sample rate. set-pyin-alpha rebuilds transition
//  matrix in place; reset-pitch-hmm clears HMM forward variables.
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

function setAlpha(alpha) {
  for (const ctx of ctxBySampleRate.values()) {
    ctx.self.onmessage({ data: { type: "set-pyin-alpha", alpha } });
  }
}

function resetHmm(ctx) {
  ctx.self.onmessage({ data: { type: "reset-pitch-hmm" } });
}

// ---------------------------------------------------------------------------
//  Per-track evaluation. Returns per-cell accumulator deltas.
// ---------------------------------------------------------------------------

function evalTrack(ctx, track, perCellAcc, perTrackAcc) {
  resetHmm(ctx);
  const { samples, sampleRate, ref } = track;
  const winN = Math.floor(sampleRate * 50 / 1000);
  const hopN = Math.floor(sampleRate * 25 / 1000);
  const winCenterMsAtHop0 = 0.5 * winN * 1000 / sampleRate;
  const hopMs = hopN * 1000 / sampleRate;
  const lookback = 4;
  let trackErrs = [], trackOctave = 0, trackNull = 0;
  let n = 0;
  for (let i = 0; i + winN <= samples.length; i += hopN, n++) {
    const got = ctx.detectPitch(samples.subarray(i, i + winN), sampleRate);
    const attrHop = n - lookback;
    if (attrHop < 0) continue;
    const attrMs = attrHop * hopMs + winCenterMsAtHop0;
    const refIdx = Math.round(attrMs / ref.hopMs);
    if (refIdx < 0 || refIdx >= ref.f0.length) continue;
    const truthHz = ref.f0[refIdx];
    if (truthHz === 0) continue;
    const bucket = bucketIndex(truthHz);
    if (bucket < 0) continue;
    const cellKey = `${track.corpus}|${BUCKETS[bucket].label}`;
    let cell = perCellAcc.get(cellKey);
    if (!cell) {
      cell = { errs: [], octaveCount: 0, nullCount: 0 };
      perCellAcc.set(cellKey, cell);
    }
    if (got === null) { cell.nullCount++; trackNull++; continue; }
    const err = Math.abs(got - truthHz);
    cell.errs.push(err);
    if (isOctaveError(got, truthHz)) { cell.octaveCount++; trackOctave++; }
    trackErrs.push(err);
  }
  perTrackAcc.push({
    corpus: track.corpus, trackId: track.trackId, gender: track.gender,
    meanErr: trackErrs.length > 0 ? trackErrs.reduce((a, b) => a + b, 0) / trackErrs.length : NaN,
    n: trackErrs.length, octaveCount: trackOctave, nullCount: trackNull,
  });
}

// ---------------------------------------------------------------------------
//  Per-cell statistics
// ---------------------------------------------------------------------------

function cellStats(cell) {
  if (!cell || cell.errs.length === 0) return null;
  const sorted = [...cell.errs].sort((a, b) => a - b);
  const mean = cell.errs.reduce((a, b) => a + b, 0) / cell.errs.length;
  const median = sorted[Math.floor(sorted.length / 2)];
  const octaveRate = cell.octaveCount / cell.errs.length;
  return { mean, median, octaveRate, n: cell.errs.length, nullCount: cell.nullCount };
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
  console.log("SKIP: no corpora available.");
  process.exit(0);
}

// Pre-build worker contexts per sample rate so set-pyin-alpha can broadcast.
const sampleRates = [...new Set(corpora.map((t) => t.sampleRate))];
console.log("  sample rates:", sampleRates);
for (const sr of sampleRates) getWorkerCtx(sr);

const sweepResults = []; // [{ alpha, perCell: Map, perTrack: Array }]

for (const alpha of ALPHAS) {
  console.log(`\n=== α = ${alpha} ===`);
  setAlpha(alpha);
  const perCellAcc = new Map();
  const perTrackAcc = [];
  const t0 = Date.now();
  let processed = 0;
  for (const track of corpora) {
    const ctx = getWorkerCtx(track.sampleRate);
    evalTrack(ctx, track, perCellAcc, perTrackAcc);
    processed++;
    if (processed % 200 === 0) console.log(`  ${processed}/${corpora.length} tracks`);
  }
  console.log(`  done in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
  sweepResults.push({ alpha, perCellAcc, perTrackAcc });
}

// ---------------------------------------------------------------------------
//  Headline table: octave-error rate per bucket × (corpus, α). Sub-90 row
//  is the targeted failure mode; mid-range rows are the regression watch.
// ---------------------------------------------------------------------------

console.log("\n========== Octave-error rate per bucket × (corpus, α) ==========");

// Header row 1: corpus labels spanning 4 alpha cols each
const colWidth = 7;
let h1 = "  bucket".padEnd(11);
for (const corpus of corpusOrder) {
  h1 += corpusLabels[corpus].padStart(colWidth * ALPHAS.length / 2 + 1) + "".padEnd(colWidth * ALPHAS.length / 2);
}
console.log(h1);
let h2 = "  ".padEnd(11);
for (const corpus of corpusOrder) {
  for (const alpha of ALPHAS) {
    h2 += String(alpha === 0 ? "0" : alpha).padStart(colWidth);
  }
}
console.log(h2);

for (const b of BUCKETS) {
  let row = "  " + b.label.padEnd(9);
  for (const corpus of corpusOrder) {
    for (const sr of sweepResults) {
      const cell = sr.perCellAcc.get(`${corpus}|${b.label}`);
      const s = cellStats(cell);
      if (s === null) { row += "—".padStart(colWidth); continue; }
      row += `${(100 * s.octaveRate).toFixed(1)}%`.padStart(colWidth);
    }
  }
  console.log(row);
}

// ---------------------------------------------------------------------------
//  Median F0 error per bucket × (corpus, α). Regression watch for
//  median-error increases under tighter α.
// ---------------------------------------------------------------------------

console.log("\n========== Median F0 error (Hz) per bucket × (corpus, α) ==========");
console.log(h1);
console.log(h2);
for (const b of BUCKETS) {
  let row = "  " + b.label.padEnd(9);
  for (const corpus of corpusOrder) {
    for (const sr of sweepResults) {
      const cell = sr.perCellAcc.get(`${corpus}|${b.label}`);
      const s = cellStats(cell);
      if (s === null) { row += "—".padStart(colWidth); continue; }
      row += `${s.median.toFixed(1)}`.padStart(colWidth);
    }
  }
  console.log(row);
}

// ---------------------------------------------------------------------------
//  Mean F0 error per bucket × (corpus, α). Includes octave-error
//  contribution; useful for spotting per-cell failure-mode shifts.
// ---------------------------------------------------------------------------

console.log("\n========== Mean F0 error (Hz) per bucket × (corpus, α) ==========");
console.log(h1);
console.log(h2);
for (const b of BUCKETS) {
  let row = "  " + b.label.padEnd(9);
  for (const corpus of corpusOrder) {
    for (const sr of sweepResults) {
      const cell = sr.perCellAcc.get(`${corpus}|${b.label}`);
      const s = cellStats(cell);
      if (s === null) { row += "—".padStart(colWidth); continue; }
      row += `${s.mean.toFixed(1)}`.padStart(colWidth);
    }
  }
  console.log(row);
}

// ---------------------------------------------------------------------------
//  Per-track regressions vs production baseline (α=0.0001). Tracks where
//  meanErr increases meaningfully under a different α. Surfaces
//  recovery-time-related regressions that aggregate stats might hide.
// ---------------------------------------------------------------------------

console.log("\n========== Per-track regressions vs α=0.0001 baseline ==========");
console.log("  Tracks ≥30 frames where ANY swept α has meanErr ≥ baseline + 5 Hz.");

const baseline = sweepResults[0]; // α=0.0001
const baselineByTrack = new Map();
for (const t of baseline.perTrackAcc) baselineByTrack.set(`${t.corpus}|${t.trackId}`, t);

const regressions = [];
for (const sr of sweepResults.slice(1)) {
  for (const t of sr.perTrackAcc) {
    if (t.n < 30 || !Number.isFinite(t.meanErr)) continue;
    const base = baselineByTrack.get(`${t.corpus}|${t.trackId}`);
    if (!base || !Number.isFinite(base.meanErr)) continue;
    const delta = t.meanErr - base.meanErr;
    if (delta >= 5) {
      regressions.push({ alpha: sr.alpha, ...t, baselineMeanErr: base.meanErr, delta });
    }
  }
}
regressions.sort((a, b) => b.delta - a.delta);
if (regressions.length === 0) {
  console.log("  (none)");
} else {
  console.log(`  ${"α".padStart(8)} ${"corpus".padEnd(11)} ${"trackId".padEnd(28)} ${"base meanErr".padStart(12)} ${"new meanErr".padStart(11)} ${"Δ".padStart(8)} ${"n".padStart(5)}`);
  for (const r of regressions.slice(0, 30)) {
    console.log(
      `  ${String(r.alpha).padStart(8)} ${r.corpus.padEnd(11)} ${String(r.trackId).padEnd(28)} ` +
      `${r.baselineMeanErr.toFixed(2).padStart(12)} ${r.meanErr.toFixed(2).padStart(11)} ` +
      `${("+" + r.delta.toFixed(2)).padStart(8)} ${String(r.n).padStart(5)}`,
    );
  }
}

// ---------------------------------------------------------------------------
//  Per-track improvements vs baseline.  Where lower α actually wins.
// ---------------------------------------------------------------------------

console.log("\n========== Per-track improvements vs α=0.0001 baseline ==========");
console.log("  Tracks ≥30 frames where a swept α has meanErr ≤ baseline − 2 Hz.");

const improvements = [];
for (const sr of sweepResults.slice(1)) {
  for (const t of sr.perTrackAcc) {
    if (t.n < 30 || !Number.isFinite(t.meanErr)) continue;
    const base = baselineByTrack.get(`${t.corpus}|${t.trackId}`);
    if (!base || !Number.isFinite(base.meanErr)) continue;
    const delta = t.meanErr - base.meanErr;
    if (delta <= -2) {
      improvements.push({ alpha: sr.alpha, ...t, baselineMeanErr: base.meanErr, delta });
    }
  }
}
improvements.sort((a, b) => a.delta - b.delta);
if (improvements.length === 0) {
  console.log("  (none)");
} else {
  console.log(`  ${"α".padStart(8)} ${"corpus".padEnd(11)} ${"trackId".padEnd(28)} ${"base meanErr".padStart(12)} ${"new meanErr".padStart(11)} ${"Δ".padStart(8)} ${"n".padStart(5)}`);
  for (const r of improvements.slice(0, 30)) {
    console.log(
      `  ${String(r.alpha).padStart(8)} ${r.corpus.padEnd(11)} ${String(r.trackId).padEnd(28)} ` +
      `${r.baselineMeanErr.toFixed(2).padStart(12)} ${r.meanErr.toFixed(2).padStart(11)} ` +
      `${r.delta.toFixed(2).padStart(8)} ${String(r.n).padStart(5)}`,
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
  alphas: ALPHAS,
  buckets: BUCKETS.map((b) => b.label),
  perAlpha: sweepResults.map((sr) => ({
    alpha: sr.alpha,
    perCell: Array.from(sr.perCellAcc.entries()).map(([key, cell]) => {
      const [corpus, bucket] = key.split("|");
      const s = cellStats(cell);
      return { corpus, bucket, ...s, octaveCount: cell.octaveCount };
    }),
  })),
};

console.log("\n--- BEGIN-JSON ---");
console.log(JSON.stringify(jsonOut, null, 2));
console.log("--- END-JSON ---");
