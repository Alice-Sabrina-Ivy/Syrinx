// pitch-bucket-asymmetric-sweep.js — Validate the asymmetric α hypothesis
// and sweep intermediate α_up values to tune the asymmetric prior.
//
// Configs:
//   - sym 1e-4         (α_up = α_down = 0.0001)              current production
//                                                             baseline reference.
//   - asym 0/1e-4      (α_up = 0,    α_down = 0.0001)        Stage C maximum-
//                                                             contrast hypothesis
//                                                             (sub-90 speech win,
//                                                             singing regression).
//   - asym 1e-7/1e-4   (α_up = 1e-7, α_down = 0.0001)        Stage D intermediate.
//   - asym 1e-6/1e-4   (α_up = 1e-6, α_down = 0.0001)        Stage D intermediate.
//   - asym 1e-5/1e-4   (α_up = 1e-5, α_down = 0.0001)        Stage D intermediate.
//
// Background (per measurements/alpha-sweep-2026-05-06.md and Stage C
// validation): sub-90 Hz speech harmonic confusion captures the HMM into
// upward wrong-octave states (3×, 4×, 5× harmonics). Tightening α_up
// alone prevents the spurious upward jumps; keeping α_down loose preserves
// PR #69's recovery improvement and downward prosody. Stage C confirmed
// the directional hypothesis — but α_up=0 (max contrast) suppresses
// legitimate large upward leaps in singing (Vocadito), causing dramatic
// regression on track 34 and the 180-220 Hz bucket. Stage D sweeps
// intermediate α_up values to find the sweet spot that prevents harmonic
// capture without blocking legitimate motion.
//
// Validation criteria for "shippable" intermediate value (per user's
// Stage D plan):
//
//   Required:
//     - Sub-90 Hz speech (PTDB-TUG + FDA combined): octave errors ≤ 24
//       (Stage C's asym 0/1e-4 result; don't lose the speech win).
//     - rl022: meanErr < 5 Hz (the user-reported failure must stay fixed).
//     - PTDB-TUG female prosodic tracks: regression ≤ 1-2 Hz vs sym 1e-4
//       baseline (don't reintroduce the symmetric α=0 problem).
//
//   Acceptable trade-off:
//     - vocadito_34: meanErr within 5 Hz of sym 1e-4 baseline (< 17 Hz;
//       Stage C max-contrast was 39.56 Hz).
//     - Vocadito 180-220 bucket: octave-error count ≤ 1.5× sym 1e-4
//       baseline (< ~110; Stage C max-contrast was 169).
//     - Other Vocadito buckets: within 1.5× of sym 1e-4 baseline.
//
// Usage: node tests/dsp/pitch-bucket-asymmetric-sweep.js
// Wall time: ~9 minutes (1436 tracks × 5 configs).

import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import vm from "vm";
import { loadAllCorpora } from "./data/corpora.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "../..");
const WORKER_PATH = join(ROOT, "src/dsp/dsp-worker.js");

const CONFIGS = [
  { label: "sym 1e-4",       alpha: 0.0001 },                       // baseline
  { label: "asym 0/1e-4",    alpha: { up: 0,    down: 0.0001 } },   // max contrast (Stage C)
  { label: "asym 1e-7/1e-4", alpha: { up: 1e-7, down: 0.0001 } },   // Stage D
  { label: "asym 1e-6/1e-4", alpha: { up: 1e-6, down: 0.0001 } },   // Stage D
  { label: "asym 1e-5/1e-4", alpha: { up: 1e-5, down: 0.0001 } },   // Stage D
];

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

function setAlphaConfig(alpha) {
  for (const ctx of ctxBySampleRate.values()) {
    ctx.self.onmessage({ data: { type: "set-pyin-alpha", alpha } });
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
for (const cfg of CONFIGS) {
  console.log(`\n=== ${cfg.label} ===`);
  setAlphaConfig(cfg.alpha);
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
  sweepResults.push({ ...cfg, perCellAcc, perTrackAcc });
}

// ---------------------------------------------------------------------------
//  Headline: octave-error rate per bucket × (corpus, config)
// ---------------------------------------------------------------------------

const colWidth = 13;
const labels = CONFIGS.map((c) => c.label);
const subHeader = labels.map((l) => l.padStart(colWidth)).join("");

console.log("\n========== Octave-error rate per bucket × (corpus, config) ==========");
let h1 = "  bucket".padEnd(11);
for (const corpus of corpusOrder) h1 += corpusLabels[corpus].padStart(colWidth * CONFIGS.length / 2 + 1) + "".padEnd(colWidth * CONFIGS.length / 2);
console.log(h1);
let h2 = "  ".padEnd(11) + corpusOrder.map(() => subHeader).join("");
console.log(h2);
for (const b of BUCKETS) {
  let row = "  " + b.label.padEnd(9);
  for (const corpus of corpusOrder) {
    for (const sr of sweepResults) {
      const s = cellStats(sr.perCellAcc.get(`${corpus}|${b.label}`));
      row += s === null ? "—".padStart(colWidth) : `${(100 * s.octaveRate).toFixed(1)}% (${s.octaveCount})`.padStart(colWidth);
    }
  }
  console.log(row);
}

console.log("\n========== Median F0 error (Hz) per bucket × (corpus, config) ==========");
console.log(h1);
console.log(h2);
for (const b of BUCKETS) {
  let row = "  " + b.label.padEnd(9);
  for (const corpus of corpusOrder) {
    for (const sr of sweepResults) {
      const s = cellStats(sr.perCellAcc.get(`${corpus}|${b.label}`));
      row += s === null ? "—".padStart(colWidth) : `${s.median.toFixed(1)}`.padStart(colWidth);
    }
  }
  console.log(row);
}

console.log("\n========== Mean F0 error (Hz) per bucket × (corpus, config) ==========");
console.log(h1);
console.log(h2);
for (const b of BUCKETS) {
  let row = "  " + b.label.padEnd(9);
  for (const corpus of corpusOrder) {
    for (const sr of sweepResults) {
      const s = cellStats(sr.perCellAcc.get(`${corpus}|${b.label}`));
      row += s === null ? "—".padStart(colWidth) : `${s.mean.toFixed(1)}`.padStart(colWidth);
    }
  }
  console.log(row);
}

// ---------------------------------------------------------------------------
//  Per-track: side-by-side comparison of all three configs.
//  Show every track that had a meaningful change in any pair of configs
//  (Δ ≥ 5 Hz between any two of the three columns).
// ---------------------------------------------------------------------------

console.log("\n========== Per-track Δ across configs (≥30 frames, max-min Δ ≥ 5 Hz) ==========");
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
const interesting = [];
for (const t of byTrack.values()) {
  const vs = labels.map((l) => t.errs[l]).filter((x) => Number.isFinite(x));
  if (vs.length < CONFIGS.length) continue;
  const range = Math.max(...vs) - Math.min(...vs);
  if (range >= 5) interesting.push({ ...t, range });
}
interesting.sort((a, b) => b.range - a.range);
console.log(`  ${"corpus".padEnd(11)} ${"trackId".padEnd(28)} ${"g".padStart(1)} ${"n".padStart(5)} ${labels.map((l) => l.padStart(colWidth)).join("")} ${"oct counts (sym1e4 / sym0 / asym)".padStart(34)}`);
for (const t of interesting.slice(0, 40)) {
  const errCells = labels.map((l) => (t.errs[l] ?? NaN).toFixed(2).padStart(colWidth)).join("");
  const octCells = labels.map((l) => String(t.octs[l] ?? 0)).join(" / ").padStart(34);
  console.log(`  ${t.corpus.padEnd(11)} ${String(t.trackId).padEnd(28)} ${String(t.gender).padStart(1)} ${String(t.n).padStart(5)} ${errCells} ${octCells}`);
}

// ---------------------------------------------------------------------------
//  Stage D verdict: per-config evaluation of the validation criteria.
// ---------------------------------------------------------------------------

console.log("\n========== Stage D verdict — per-config criteria evaluation ==========");

function aggregate(srLabel, corpus, bucket) {
  const sr = sweepResults.find((s) => s.label === srLabel);
  return sr ? cellStats(sr.perCellAcc.get(`${corpus}|${bucket}`)) : null;
}

// Required criterion 1: sub-90 Hz speech (PTDB-TUG + FDA combined).
//   Target: octave errors ≤ 24 (Stage C's asym 0/1e-4 result).
function sumSubNinety(srLabel) {
  let oct = 0, n = 0;
  for (const corpus of ["ptdb-tug", "fda"]) {
    const s = aggregate(srLabel, corpus, "<90");
    if (s) { oct += s.octaveCount; n += s.n; }
  }
  return { oct, n, rate: n > 0 ? oct / n : 0 };
}

console.log(`\n  REQ 1: Sub-90 Hz speech (PTDB-TUG + FDA combined). Target: ≤ 24 octave errors.`);
for (const cfg of CONFIGS) {
  const s = sumSubNinety(cfg.label);
  const pass = s.oct <= 24;
  console.log(`    ${cfg.label.padEnd(18)} ${s.oct} / ${s.n} = ${(100 * s.rate).toFixed(2)}%  ${pass ? "✓" : "✗"}`);
}

// Required criterion 2: rl022 mean error < 5 Hz (the user-reported reproducer).
console.log(`\n  REQ 2: rl022 (user's primary 80 Hz reproducer). Target: meanErr < 5 Hz.`);
const rl022 = byTrack.get("fda|rl022");
if (rl022) {
  for (const cfg of CONFIGS) {
    const e = rl022.errs[cfg.label];
    const pass = Number.isFinite(e) && e < 5;
    console.log(`    ${cfg.label.padEnd(18)} meanErr ${(e ?? NaN).toFixed(2).padStart(6)} Hz, ${rl022.octs[cfg.label] ?? 0} octave errors / ${rl022.n} frames  ${pass ? "✓" : "✗"}`);
  }
}

// Required criterion 3: PTDB-TUG female prosodic tracks regression ≤ 1-2 Hz vs sym 1e-4.
console.log(`\n  REQ 3: PTDB-TUG female prosodic tracks. Target: regression ≤ 2 Hz vs sym 1e-4.`);
const femalePoints = ["mic_F02_sx86", "mic_F01_sx47", "mic_F02_sx68", "mic_F02_sx83", "mic_F02_sx54", "mic_F01_sx20"];
console.log(`    ${"track".padEnd(18)} ${CONFIGS.map((c) => c.label.padStart(13)).join("")}  worst Δ vs baseline`);
for (const trk of femalePoints) {
  const t = byTrack.get(`ptdb-tug|${trk}`);
  if (!t) continue;
  const baseline = t.errs["sym 1e-4"];
  const cells = CONFIGS.map((c) => (t.errs[c.label] ?? NaN).toFixed(2).padStart(13)).join("");
  let worstDelta = -Infinity;
  for (const c of CONFIGS) {
    if (c.label === "sym 1e-4") continue;
    const e = t.errs[c.label];
    if (Number.isFinite(e) && Number.isFinite(baseline)) worstDelta = Math.max(worstDelta, e - baseline);
  }
  console.log(`    ${trk.padEnd(18)} ${cells}    +${worstDelta.toFixed(2)} Hz`);
}

// Acceptable trade-off 1: vocadito_34 within 5 Hz of sym 1e-4 (< 17 Hz).
console.log(`\n  TRADE-OFF 1: vocadito_34 canary. Target: meanErr < 17 Hz (within 5 Hz of sym 1e-4 baseline 11.59).`);
const v34 = byTrack.get("vocadito|vocadito_34");
if (v34) {
  for (const cfg of CONFIGS) {
    const e = v34.errs[cfg.label];
    const pass = Number.isFinite(e) && e < 17;
    console.log(`    ${cfg.label.padEnd(18)} meanErr ${(e ?? NaN).toFixed(2).padStart(6)} Hz, ${v34.octs[cfg.label] ?? 0} octave errors / ${v34.n} frames  ${pass ? "✓" : "✗"}`);
  }
}

// Acceptable trade-off 2: vocadito 180-220 octave-error count ≤ 1.5× sym 1e-4 (~110).
console.log(`\n  TRADE-OFF 2: vocadito 180-220 Hz bucket. Target: octave errors ≤ 110 (1.5× sym 1e-4 baseline 73).`);
for (const cfg of CONFIGS) {
  const s = aggregate(cfg.label, "vocadito", "180-220");
  const pass = s !== null && s.octaveCount <= 110;
  console.log(`    ${cfg.label.padEnd(18)} ${s ? s.octaveCount : "—"} octave errors / ${s ? s.n : 0} frames  ${pass ? "✓" : "✗"}`);
}

// Acceptable trade-off 3: other Vocadito buckets within 1.5× of sym 1e-4.
console.log(`\n  TRADE-OFF 3: other Vocadito buckets within 1.5× of sym 1e-4 octave-error count.`);
const vocadioBuckets = ["<90", "90-120", "120-150", "150-180", "220-280", "280-350", ">350"];
const baselineCounts = {};
for (const b of vocadioBuckets) {
  const s = aggregate("sym 1e-4", "vocadito", b);
  baselineCounts[b] = s ? s.octaveCount : 0;
}
console.log(`    ${"bucket".padEnd(11)} ${"baseline".padStart(10)} ${CONFIGS.filter((c) => c.label !== "sym 1e-4").map((c) => c.label.padStart(15)).join("")}`);
for (const b of vocadioBuckets) {
  let row = "    " + b.padEnd(9) + " " + String(baselineCounts[b]).padStart(10);
  for (const cfg of CONFIGS) {
    if (cfg.label === "sym 1e-4") continue;
    const s = aggregate(cfg.label, "vocadito", b);
    const cnt = s ? s.octaveCount : 0;
    const ratio = baselineCounts[b] > 0 ? cnt / baselineCounts[b] : (cnt > 0 ? Infinity : 1);
    const pass = ratio <= 1.5;
    row += `${cnt}(${ratio.toFixed(1)}x${pass ? "✓" : "✗"})`.padStart(15);
  }
  console.log(row);
}

// JSON
const jsonOut = {
  generatedAt: new Date().toISOString(),
  workerStage: 2, lookback: 4, corpora: counts,
  configs: CONFIGS,
  perConfig: sweepResults.map((sr) => ({
    label: sr.label, alpha: sr.alpha,
    perCell: Array.from(sr.perCellAcc.entries()).map(([key, cell]) => {
      const [corpus, bucket] = key.split("|");
      return { corpus, bucket, ...cellStats(cell) };
    }),
  })),
};

console.log("\n--- BEGIN-JSON ---");
console.log(JSON.stringify(jsonOut, null, 2));
console.log("--- END-JSON ---");
