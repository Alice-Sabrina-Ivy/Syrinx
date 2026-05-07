// pitch-bucket-voicedness-transform-sweep.js — Sweep the pYIN observation-
// model voicedness transform across v^p values to find a transform that
// fixes the user-reported low-pitch failure mode without regressing
// singing.
//
// Configs (vp(p) = power transform, voicedShare = voicedness ^ p):
//   - vp 1.0   identity (current production baseline; no-op)
//   - vp 0.7   mild lift on low voicedness
//   - vp 0.5   sqrt — moderate lift
//   - vp 0.3   stronger lift
//   - vp 0.1   near-constant; voicedShare ≈ 1 even for tiny voicedness
//
// Background. Per the audit at Stage A and prior findings:
//
//   - α-sweep (measurements/alpha-sweep-2026-05-06.md): symmetric α tuning
//     can't fix the sub-90 Hz speech failure without per-corpus regressions.
//   - Asymmetric α (measurements/alpha-sweep-2026-05-06.md "Open
//     implications" + Stage C/D validation): max-contrast α_up=0 fixes
//     speech but breaks singing; intermediate α_up values don't tunably
//     intermediate (binary phase transition).
//   - Discarded Stage 2 voicedFlag investigation
//     (measurements/stage2-voicedflag-investigation-2026-05-06.md)
//     identified the structural cause: pYIN's obs[V] = voicedness · p_state
//     gives voiced states 50–200× less mass than unvoiced at the same pitch
//     when voicedness is structurally small (real speech ~0.005–0.018).
//
// All three independent arcs converge on the same fix surface — reweight
// the obs[V] : obs[UV] ratio at low voicedness. The voicedness transform
// f(v) replaces voicedness in the per-state obs distribution. With f(v)=v
// (identity, vp 1.0) the change is a no-op. Smaller p values lift voicedShare
// on low-voicedness frames.
//
// Validation criteria (per Stage B.3):
//
// Required:
//   - Sub-90 Hz speech (PTDB-TUG + FDA): octave-error count ≤ 24/1133.
//     Match the asym 0/1e-4 win we proved was achievable.
//   - rl022 mean error < 5 Hz. The user-reported reproducer must stay fixed.
//   - PTDB-TUG female prosodic tracks: regression ≤ 2 Hz vs sym 1e-4
//     baseline (don't reintroduce the symmetric α=0 problem).
//
// Acceptable trade-off (Direction 1 should preserve singing better than
// Direction 2 — acoustic-context-agnostic application):
//   - vocadito_34: meanErr within 5 Hz of sym baseline (< 17 Hz; baseline
//     is 11.59).
//   - Vocadito 180-220 Hz bucket: octave-error count ≤ 1.5× baseline (~110;
//     baseline is 73).
//   - Other Vocadito buckets within 1.5× baseline.
//
// Usage: node tests/dsp/pitch-bucket-voicedness-transform-sweep.js
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
  { label: "vp 1.0", exponent: 1.0 },  // identity baseline (production no-op)
  { label: "vp 0.7", exponent: 0.7 },
  { label: "vp 0.5", exponent: 0.5 },  // sqrt
  { label: "vp 0.3", exponent: 0.3 },
  { label: "vp 0.1", exponent: 0.1 },
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

function setVpExponent(exponent) {
  for (const ctx of ctxBySampleRate.values()) {
    ctx.self.onmessage({
      data: { type: "set-pyin-voicedness-transform", transform: { type: "vp", exponent } },
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
for (const cfg of CONFIGS) {
  console.log(`\n=== ${cfg.label} (exponent=${cfg.exponent}) ===`);
  setVpExponent(cfg.exponent);
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

// Per-track view: tracks where any pair of configs differs by ≥ 5 Hz mean
// error, sorted by max range. Surfaces both improvements and regressions.
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
console.log("\n========== Per-track Δ across configs (≥30 frames, max-min Δ ≥ 5 Hz) ==========");
const interesting = [];
for (const t of byTrack.values()) {
  const vs = labels.map((l) => t.errs[l]).filter((x) => Number.isFinite(x));
  if (vs.length < CONFIGS.length) continue;
  const range = Math.max(...vs) - Math.min(...vs);
  if (range >= 5) interesting.push({ ...t, range });
}
interesting.sort((a, b) => b.range - a.range);
console.log(`  ${"corpus".padEnd(11)} ${"trackId".padEnd(28)} ${"g".padStart(1)} ${"n".padStart(5)} ${labels.map((l) => l.padStart(colWidth)).join("")}`);
for (const t of interesting.slice(0, 40)) {
  const errCells = labels.map((l) => (t.errs[l] ?? NaN).toFixed(2).padStart(colWidth)).join("");
  console.log(`  ${t.corpus.padEnd(11)} ${String(t.trackId).padEnd(28)} ${String(t.gender).padStart(1)} ${String(t.n).padStart(5)} ${errCells}`);
}

// ---------------------------------------------------------------------------
//  Verdict — per-config evaluation of validation criteria
// ---------------------------------------------------------------------------

console.log("\n========== Verdict — per-config criteria evaluation ==========");

function aggregate(srLabel, corpus, bucket) {
  const sr = sweepResults.find((s) => s.label === srLabel);
  return sr ? cellStats(sr.perCellAcc.get(`${corpus}|${bucket}`)) : null;
}

console.log(`\n  REQ 1: Sub-90 Hz speech (PTDB-TUG + FDA combined). Target: ≤ 24 octave errors.`);
for (const cfg of CONFIGS) {
  let oct = 0, n = 0;
  for (const corpus of ["ptdb-tug", "fda"]) {
    const s = aggregate(cfg.label, corpus, "<90");
    if (s) { oct += s.octaveCount; n += s.n; }
  }
  const pass = oct <= 24;
  console.log(`    ${cfg.label.padEnd(10)} ${oct} / ${n} = ${(100 * oct / Math.max(1, n)).toFixed(2)}%  ${pass ? "✓" : "✗"}`);
}

console.log(`\n  REQ 2: rl022 (user's primary 80 Hz reproducer). Target: meanErr < 5 Hz.`);
const rl022 = byTrack.get("fda|rl022");
if (rl022) {
  for (const cfg of CONFIGS) {
    const e = rl022.errs[cfg.label];
    const pass = Number.isFinite(e) && e < 5;
    console.log(`    ${cfg.label.padEnd(10)} meanErr ${(e ?? NaN).toFixed(2).padStart(6)} Hz, ${rl022.octs[cfg.label] ?? 0} octave errors / ${rl022.n} frames  ${pass ? "✓" : "✗"}`);
  }
}

console.log(`\n  REQ 3: PTDB-TUG female prosodic tracks. Target: regression ≤ 2 Hz vs vp 1.0.`);
const femalePoints = ["mic_F02_sx86", "mic_F01_sx47", "mic_F02_sx68", "mic_F02_sx83", "mic_F02_sx54", "mic_F01_sx20"];
console.log(`    ${"track".padEnd(18)} ${labels.map((l) => l.padStart(colWidth)).join("")}    worst Δ vs vp 1.0`);
for (const trk of femalePoints) {
  const t = byTrack.get(`ptdb-tug|${trk}`);
  if (!t) continue;
  const baseline = t.errs["vp 1.0"];
  const cells = labels.map((l) => (t.errs[l] ?? NaN).toFixed(2).padStart(colWidth)).join("");
  let worstDelta = -Infinity;
  for (const c of CONFIGS) {
    if (c.label === "vp 1.0") continue;
    const e = t.errs[c.label];
    if (Number.isFinite(e) && Number.isFinite(baseline)) worstDelta = Math.max(worstDelta, e - baseline);
  }
  console.log(`    ${trk.padEnd(18)} ${cells}    ${worstDelta > 0 ? "+" : ""}${worstDelta.toFixed(2)} Hz`);
}

console.log(`\n  TRADE-OFF 1: vocadito_34 canary. Target: meanErr < 17 Hz (within 5 Hz of vp 1.0 baseline 11.59).`);
const v34 = byTrack.get("vocadito|vocadito_34");
if (v34) {
  for (const cfg of CONFIGS) {
    const e = v34.errs[cfg.label];
    const pass = Number.isFinite(e) && e < 17;
    console.log(`    ${cfg.label.padEnd(10)} meanErr ${(e ?? NaN).toFixed(2).padStart(6)} Hz, ${v34.octs[cfg.label] ?? 0} octave errors / ${v34.n} frames  ${pass ? "✓" : "✗"}`);
  }
}

console.log(`\n  TRADE-OFF 2: vocadito 180-220 Hz bucket. Target: octave errors ≤ 110 (1.5× vp 1.0 baseline).`);
for (const cfg of CONFIGS) {
  const s = aggregate(cfg.label, "vocadito", "180-220");
  const pass = s !== null && s.octaveCount <= 110;
  console.log(`    ${cfg.label.padEnd(10)} ${s ? s.octaveCount : "—"} octave errors / ${s ? s.n : 0} frames  ${pass ? "✓" : "✗"}`);
}

console.log(`\n  TRADE-OFF 3: other Vocadito buckets within 1.5× of vp 1.0 octave-error count.`);
const vocadioBuckets = ["<90", "90-120", "120-150", "150-180", "220-280", "280-350", ">350"];
const baselineCounts = {};
for (const b of vocadioBuckets) {
  const s = aggregate("vp 1.0", "vocadito", b);
  baselineCounts[b] = s ? s.octaveCount : 0;
}
console.log(`    ${"bucket".padEnd(11)} ${"baseline".padStart(10)} ${CONFIGS.filter((c) => c.label !== "vp 1.0").map((c) => c.label.padStart(15)).join("")}`);
for (const b of vocadioBuckets) {
  let row = "    " + b.padEnd(9) + " " + String(baselineCounts[b]).padStart(10);
  for (const cfg of CONFIGS) {
    if (cfg.label === "vp 1.0") continue;
    const s = aggregate(cfg.label, "vocadito", b);
    const cnt = s ? s.octaveCount : 0;
    const ratio = baselineCounts[b] > 0 ? cnt / baselineCounts[b] : (cnt > 0 ? Infinity : 1);
    const pass = ratio <= 1.5;
    row += `${cnt}(${ratio.toFixed(1)}x${pass ? "✓" : "✗"})`.padStart(15);
  }
  console.log(row);
}

const jsonOut = {
  generatedAt: new Date().toISOString(),
  workerStage: 2, lookback: 4, corpora: counts,
  configs: CONFIGS,
  perConfig: sweepResults.map((sr) => ({
    label: sr.label, exponent: sr.exponent,
    perCell: Array.from(sr.perCellAcc.entries()).map(([key, cell]) => {
      const [corpus, bucket] = key.split("|");
      return { corpus, bucket, ...cellStats(cell) };
    }),
  })),
};

console.log("\n--- BEGIN-JSON ---");
console.log(JSON.stringify(jsonOut, null, 2));
console.log("--- END-JSON ---");
