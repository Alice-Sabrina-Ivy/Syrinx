// pitch-bucket-multi-mult-sweep.js — Stage C.3 sweep for the multi-mult
// harmonic correction. 5×3 grid over TRANSFER_FRACTION × FUND_DEPTH_RATIO,
// with transferFraction=0 cells as the no-op baseline-row.
//
// Hypothesis (per Stage B.3 structural finding + Stage C.1 audit):
// Multi-mult is the architecturally correct fix for the user-reported
// 80 Hz harmonic-capture failure. The mechanism redistributes pitch_obs[]
// mass from a captured harmonic state to the true fundamental at integer-
// multiple periods. Re-introduces the YIN-era harmonic correction logic
// deleted in commit 0568fe25, adapted for pYIN's candidate-mass distribution.
//
// Validation criteria:
//
// Required:
//   - Sub-90 Hz speech (PTDB-TUG + FDA combined): octave errors ≤ 24/1133.
//     Match the asym 0/1e-4 win (the speech-fix benchmark).
//   - rl022 mean error < 5 Hz. The user-reported reproducer must be fixed.
//   - PTDB-TUG female prosodic tracks: regression ≤ 2 Hz vs baseline.
//
// Required-specific-to-multi-mult:
//   - Hillenbrand female vowels: octave-error rate increase ≤ 2% absolute
//     vs baseline. The original 10 % spurious-halving rate (per the
//     deleted-code commentary) is the historical regression risk; cells
//     approaching that fail.
//
// Acceptable trade-off:
//   - vocadito_34 within 5 Hz of baseline.
//   - Vocadito 180-220 within 1.5× baseline octave errors.
//   - Other Vocadito buckets within 1.5× baseline.
//
// Usage: node tests/dsp/pitch-bucket-multi-mult-sweep.js
// Wall time: ~22 minutes (1436 tracks × 15 configs).

import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import vm from "vm";
import { loadAllCorpora } from "./data/corpora.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "../..");
const WORKER_PATH = join(ROOT, "src/dsp/dsp-worker.js");

const TRANSFER_FRACTIONS = [0, 0.25, 0.5, 0.75, 1.0];
const FUND_DEPTH_RATIOS = [1.5, 2.0, 3.0];

const CONFIGS = [];
for (const tf of TRANSFER_FRACTIONS) {
  for (const fdr of FUND_DEPTH_RATIOS) {
    CONFIGS.push({
      label: `tf=${tf}/fdr=${fdr}`,
      transferFraction: tf,
      fundDepthRatio: fdr,
    });
  }
}

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

function setMultiMult(transferFraction, fundDepthRatio) {
  for (const ctx of ctxBySampleRate.values()) {
    ctx.self.onmessage({
      data: { type: "set-pyin-multi-mult", config: { transferFraction, fundDepthRatio } },
    });
  }
}

function resetHmm(ctx) {
  ctx.self.onmessage({ data: { type: "reset-pitch-hmm" } });
}

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

function cellStats(cell) {
  if (!cell || cell.errs.length === 0) return null;
  const sorted = [...cell.errs].sort((a, b) => a - b);
  const mean = cell.errs.reduce((a, b) => a + b, 0) / cell.errs.length;
  const median = sorted[Math.floor(sorted.length / 2)];
  const octaveRate = cell.octaveCount / cell.errs.length;
  return { mean, median, octaveRate, n: cell.errs.length, nullCount: cell.nullCount, octaveCount: cell.octaveCount };
}

console.log("Loading all corpora …");
const corpora = loadAllCorpora();
const counts = {};
for (const t of corpora) counts[t.corpus] = (counts[t.corpus] || 0) + 1;
console.log("  corpus track counts:", counts);
if (corpora.length === 0) {
  console.log("SKIP: no corpora available.");
  process.exit(0);
}

const sampleRates = [...new Set(corpora.map((t) => t.sampleRate))];
for (const sr of sampleRates) getWorkerCtx(sr);

const sweepResults = [];
const startedAt = Date.now();
for (const cfg of CONFIGS) {
  console.log(`\n=== ${cfg.label} ===`);
  setMultiMult(cfg.transferFraction, cfg.fundDepthRatio);
  const perCellAcc = new Map();
  const perTrackAcc = [];
  const t0 = Date.now();
  let processed = 0;
  for (const track of corpora) {
    const ctx = getWorkerCtx(track.sampleRate);
    evalTrack(ctx, track, perCellAcc, perTrackAcc);
    processed++;
    if (processed % 400 === 0) console.log(`  ${processed}/${corpora.length} tracks`);
  }
  const dt = ((Date.now() - t0) / 1000).toFixed(1);
  console.log(`  done in ${dt}s  (cumulative: ${((Date.now() - startedAt) / 60000).toFixed(1)} min)`);
  sweepResults.push({ ...cfg, perCellAcc, perTrackAcc });
}

// Build per-track index
const byTrack = new Map();
for (const sr of sweepResults) {
  for (const t of sr.perTrackAcc) {
    if (t.n < 30) continue;
    const k = `${t.corpus}|${t.trackId}`;
    if (!byTrack.has(k)) byTrack.set(k, { corpus: t.corpus, trackId: t.trackId, gender: t.gender, n: t.n, errs: {}, octs: {} });
    byTrack.get(k).errs[sr.label] = t.meanErr;
    byTrack.get(k).octs[sr.label] = t.octaveCount;
  }
}

function aggregate(srLabel, corpus, bucket) {
  const sr = sweepResults.find((s) => s.label === srLabel);
  return sr ? cellStats(sr.perCellAcc.get(`${corpus}|${bucket}`)) : null;
}

// ---------------------------------------------------------------------------
//  Headline: 2D heat-table per criterion. Rows = transferFraction,
//  cols = fundDepthRatio. The baseline row (tf=0) should produce identical
//  numbers across all 3 fdr columns (no-op verification).
// ---------------------------------------------------------------------------

function headlineTable(title, valueFn, fmtFn) {
  console.log(`\n========== ${title} ==========`);
  let header = "  tf↓ / fdr→".padEnd(14);
  for (const fdr of FUND_DEPTH_RATIOS) header += `fdr=${fdr}`.padStart(14);
  console.log(header);
  for (const tf of TRANSFER_FRACTIONS) {
    let row = `  tf=${tf}`.padEnd(14);
    for (const fdr of FUND_DEPTH_RATIOS) {
      const cfg = CONFIGS.find((c) => c.transferFraction === tf && c.fundDepthRatio === fdr);
      const v = valueFn(cfg.label);
      row += fmtFn(v).padStart(14);
    }
    console.log(row);
  }
}

// Sub-90 octave errors aggregated across PTDB-TUG + FDA
headlineTable(
  "REQ 1: Sub-90 Hz speech octave errors (PTDB-TUG + FDA combined; target ≤ 24)",
  (label) => {
    let oct = 0, n = 0;
    for (const corpus of ["ptdb-tug", "fda"]) {
      const s = aggregate(label, corpus, "<90");
      if (s) { oct += s.octaveCount; n += s.n; }
    }
    return { oct, n };
  },
  ({ oct, n }) => `${oct}/${n} (${(100 * oct / Math.max(1, n)).toFixed(1)}%)${oct <= 24 ? "✓" : "✗"}`,
);

// rl022 mean error
headlineTable(
  "REQ 2: rl022 mean F0 error (target < 5 Hz)",
  (label) => byTrack.get("fda|rl022")?.errs[label],
  (e) => Number.isFinite(e) ? `${e.toFixed(2)} Hz${e < 5 ? "✓" : "✗"}` : "—",
);

// Hillenbrand female-vowel octave-error rate (the spurious-halving regression risk)
// Hillenbrand has only female and male; we approximate "female vowels" as
// the women/ subdir (gender 'w'). Aggregate across all buckets for total
// octave-error rate increase vs baseline.
function hillenbrandFemaleOctaveRate(label) {
  let oct = 0, n = 0;
  for (const b of BUCKETS) {
    // Filter to Hillenbrand. Per-track gender filtering would be cleaner
    // but the corpora.js loader sets gender per-track ('m' / 'w' / 'b' / 'g').
    // We approximate via per-track aggregation.
  }
  // Use per-track index instead.
  let totalErrs = 0, totalOcts = 0, totalFrames = 0;
  for (const t of byTrack.values()) {
    if (t.corpus !== "hillenbrand" || t.gender !== "w") continue;
    if (Number.isFinite(t.errs[label])) {
      totalFrames += t.n;
      totalOcts += (t.octs[label] ?? 0);
    }
  }
  return totalFrames > 0 ? totalOcts / totalFrames : 0;
}
const hillenbrandFemaleBaselineRate = hillenbrandFemaleOctaveRate("tf=0/fdr=1.5");
headlineTable(
  `REQ 4 (multi-mult): Hillenbrand female-vowel octave-error rate increase (target ≤ +2pp vs baseline ${(100 * hillenbrandFemaleBaselineRate).toFixed(1)}%)`,
  (label) => hillenbrandFemaleOctaveRate(label) - hillenbrandFemaleBaselineRate,
  (delta) => `${delta >= 0 ? "+" : ""}${(100 * delta).toFixed(2)}pp${delta <= 0.02 ? "✓" : "✗"}`,
);

// Vocadito 180-220 octave errors (acceptable trade-off check)
const v180_220Baseline = aggregate("tf=0/fdr=1.5", "vocadito", "180-220")?.octaveCount ?? 73;
const v180_220Cap = Math.ceil(v180_220Baseline * 1.5);
headlineTable(
  `TRADE-OFF: Vocadito 180-220 Hz octave errors (target ≤ ${v180_220Cap} = 1.5× baseline ${v180_220Baseline})`,
  (label) => aggregate(label, "vocadito", "180-220")?.octaveCount ?? 0,
  (cnt) => `${cnt}${cnt <= v180_220Cap ? "✓" : "✗"}`,
);

// vocadito_34 mean error
const v34Baseline = byTrack.get("vocadito|vocadito_34")?.errs["tf=0/fdr=1.5"] ?? 11.59;
const v34Cap = v34Baseline + 5;
headlineTable(
  `TRADE-OFF: vocadito_34 mean F0 error (target < ${v34Cap.toFixed(1)} Hz = baseline + 5)`,
  (label) => byTrack.get("vocadito|vocadito_34")?.errs[label],
  (e) => Number.isFinite(e) ? `${e.toFixed(2)}${e < v34Cap ? "✓" : "✗"}` : "—",
);

// PTDB female prosodic tracks worst regression
const femalePoints = ["mic_F02_sx86", "mic_F01_sx47", "mic_F02_sx68", "mic_F02_sx83", "mic_F02_sx54", "mic_F01_sx20"];
headlineTable(
  "REQ 3: PTDB female prosodic tracks worst regression (target ≤ +2 Hz vs baseline)",
  (label) => {
    let worst = 0;
    for (const trk of femalePoints) {
      const t = byTrack.get(`ptdb-tug|${trk}`);
      if (!t) continue;
      const baseline = t.errs["tf=0/fdr=1.5"];
      const cur = t.errs[label];
      if (!Number.isFinite(baseline) || !Number.isFinite(cur)) continue;
      const delta = cur - baseline;
      if (delta > worst) worst = delta;
    }
    return worst;
  },
  (worst) => `${worst >= 0 ? "+" : ""}${worst.toFixed(2)} Hz${worst <= 2 ? "✓" : "✗"}`,
);

// ---------------------------------------------------------------------------
//  Per-track movement table (tracks where any cell differs by ≥ 5 Hz)
// ---------------------------------------------------------------------------

console.log("\n========== Per-track Δ across configs (≥30 frames, max-min Δ ≥ 5 Hz, top 30) ==========");
const interesting = [];
for (const t of byTrack.values()) {
  const vs = CONFIGS.map((c) => t.errs[c.label]).filter((x) => Number.isFinite(x));
  if (vs.length < CONFIGS.length / 2) continue; // need most configs
  const range = Math.max(...vs) - Math.min(...vs);
  if (range >= 5) interesting.push({ ...t, range });
}
interesting.sort((a, b) => b.range - a.range);
console.log(`  ${"corpus".padEnd(11)} ${"trackId".padEnd(28)} ${"g".padStart(1)} ${"n".padStart(5)}   baseline   best-cell  worst-cell  range`);
for (const t of interesting.slice(0, 30)) {
  const baseline = t.errs["tf=0/fdr=1.5"] ?? NaN;
  let best = Infinity, worst = -Infinity, bestLabel = "", worstLabel = "";
  for (const c of CONFIGS) {
    const e = t.errs[c.label];
    if (!Number.isFinite(e)) continue;
    if (e < best) { best = e; bestLabel = c.label; }
    if (e > worst) { worst = e; worstLabel = c.label; }
  }
  console.log(
    `  ${t.corpus.padEnd(11)} ${String(t.trackId).padEnd(28)} ${String(t.gender).padStart(1)} ${String(t.n).padStart(5)}   ` +
    `${baseline.toFixed(2).padStart(8)}   ${best.toFixed(2).padStart(6)} (${bestLabel.padEnd(13)})  ${worst.toFixed(2).padStart(6)} (${worstLabel.padEnd(13)})  ${t.range.toFixed(2).padStart(6)}`,
  );
}

// ---------------------------------------------------------------------------
//  All-pass cell scan — which cells satisfy every Required criterion?
// ---------------------------------------------------------------------------

console.log("\n========== Cells passing ALL Required criteria ==========");
const passingCells = [];
for (const cfg of CONFIGS) {
  // REQ 1
  let oct = 0, n = 0;
  for (const corpus of ["ptdb-tug", "fda"]) {
    const s = aggregate(cfg.label, corpus, "<90");
    if (s) { oct += s.octaveCount; n += s.n; }
  }
  const req1 = oct <= 24;
  // REQ 2
  const rl022e = byTrack.get("fda|rl022")?.errs[cfg.label];
  const req2 = Number.isFinite(rl022e) && rl022e < 5;
  // REQ 3
  let worstRegression = 0;
  for (const trk of femalePoints) {
    const t = byTrack.get(`ptdb-tug|${trk}`);
    if (!t) continue;
    const baseline = t.errs["tf=0/fdr=1.5"];
    const cur = t.errs[cfg.label];
    if (Number.isFinite(baseline) && Number.isFinite(cur)) {
      worstRegression = Math.max(worstRegression, cur - baseline);
    }
  }
  const req3 = worstRegression <= 2;
  // REQ 4 (multi-mult-specific)
  const hillFemDelta = hillenbrandFemaleOctaveRate(cfg.label) - hillenbrandFemaleBaselineRate;
  const req4 = hillFemDelta <= 0.02;
  if (req1 && req2 && req3 && req4) {
    passingCells.push({
      label: cfg.label,
      transferFraction: cfg.transferFraction,
      fundDepthRatio: cfg.fundDepthRatio,
      sub90: oct,
      rl022: rl022e,
      femaleRegression: worstRegression,
      hillFemDelta,
    });
  }
}
if (passingCells.length === 0) {
  console.log("  (none)");
} else {
  console.log(`  ${passingCells.length} cell(s) pass all four Required criteria:`);
  for (const c of passingCells) {
    console.log(
      `    ${c.label.padEnd(18)} sub90=${c.sub90}  rl022=${c.rl022.toFixed(2)}  femaleRegression=+${c.femaleRegression.toFixed(2)}  hillFemDelta=${(100 * c.hillFemDelta).toFixed(2)}pp`,
    );
  }
}

const jsonOut = {
  generatedAt: new Date().toISOString(),
  workerStage: 2, lookback: 4, corpora: counts,
  configs: CONFIGS,
  perConfig: sweepResults.map((sr) => ({
    label: sr.label,
    transferFraction: sr.transferFraction,
    fundDepthRatio: sr.fundDepthRatio,
    perCell: Array.from(sr.perCellAcc.entries()).map(([key, cell]) => {
      const [corpus, bucket] = key.split("|");
      return { corpus, bucket, ...cellStats(cell) };
    }),
  })),
};

console.log("\n--- BEGIN-JSON ---");
console.log(JSON.stringify(jsonOut, null, 2));
console.log("--- END-JSON ---");
