// pyin-stage2b-sigma-sweep-harness.js — Sweep the pYIN HMM transition prior σ
// over {15, 20, 30, 50, 75, 100} cents at Stage 2.B + L=2 only, on both
// the Hillenbrand clean corpus AND the PTDB-TUG SX subset. Justified by
// the regression PTDB-TUG showed at σ=20 in
// measurements/pyin-stage2b-realworld-2026-05-04.md.
//
// Decision criterion: Pareto across both corpora simultaneously. Look for
// any σ where Stage 2.B at L=2 strictly dominates Stage 0 on BOTH:
//   - Hillenbrand clean: F mean < Stage 0 (Stage 0 baseline ≈ 30.65)
//   - PTDB-TUG (co-detected): F mean < 6.64 AND F p95 < 30
// The p95 floor is the key — Stage 2 σ=20 had F mean=22.52 codet but
// p95=145.50, which is the long octave-error tail that hides under the
// mean.
//
// L=2 only — values that ship at L≥5 aren't ship-eligible regardless
// of accuracy. Don't waste compute on cells we won't ship.
//
// Usage: node scripts/pyin-stage2b-sigma-sweep-harness.js
// Output: measurements/pyin-stage2b-sigma-sweep-2026-05-04-harness.txt

import { readFileSync, readdirSync, existsSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import vm from "vm";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const WORKER_PATH = join(ROOT, "src/dsp/dsp-worker.js");
const HILLENBRAND_DIR = join(ROOT, "tests/dsp/data");
const VOWDATA = join(HILLENBRAND_DIR, "vowdata.dat");
const PTDB_DIR = join(ROOT, "tests/dsp/data/ptdb-tug");

const SIGMAS = [15, 20, 30, 50, 75, 100];

// ---------------------------------------------------------------------------
//  WAV reader (16-bit PCM mono)
// ---------------------------------------------------------------------------

function readWav(path) {
  const buf = readFileSync(path);
  let off = 12, sr = 0, bps = 0, ds = 0, dz = 0;
  while (off < buf.length - 8) {
    const id = buf.toString("ascii", off, off + 4);
    const sz = buf.readUInt32LE(off + 4);
    if (id === "fmt ") { sr = buf.readUInt32LE(off + 12); bps = buf.readUInt16LE(off + 22); }
    else if (id === "data") { ds = off + 8; dz = sz; break; }
    off += 8 + sz;
  }
  const n = dz / (bps / 8);
  const s = new Float32Array(n);
  for (let i = 0; i < n; i++) s[i] = buf.readInt16LE(ds + i * 2) / 32768;
  return { samples: s, sampleRate: sr };
}

// ---------------------------------------------------------------------------
//  Hillenbrand corpus loader (16 kHz, single steady-state file)
// ---------------------------------------------------------------------------

function parseVowdata(path) {
  const text = readFileSync(path, "utf8");
  const out = [];
  for (const raw of text.split("\n")) {
    const t = raw.trim(); if (!/^[mwbg]\d/.test(t)) continue;
    const p = t.split(/\s+/); if (p.length < 7) continue;
    out.push({ filename: p[0], gender: p[0][0], f0: +p[2] });
  }
  return out;
}

function loadHillenbrand() {
  if (!existsSync(VOWDATA)) throw new Error("vowdata.dat missing");
  const meta = parseVowdata(VOWDATA);
  const corpus = [];
  for (const e of meta) {
    if (e.gender !== "m" && e.gender !== "w") continue;
    if (e.f0 === 0) continue;
    const wp = join(HILLENBRAND_DIR, e.gender === "m" ? "men" : "women", `${e.filename}.wav`);
    if (!existsSync(wp)) continue;
    const { samples, sampleRate } = readWav(wp);
    if (sampleRate !== 16000) continue;
    corpus.push({ filename: e.filename, gender: e.gender, truthF0: e.f0, samples });
  }
  return corpus;
}

// ---------------------------------------------------------------------------
//  PTDB-TUG corpus loader (48 kHz, frame-by-frame contour matching)
// ---------------------------------------------------------------------------

function readRef(path) {
  const text = readFileSync(path, "utf8");
  const lines = text.split("\n").filter((l) => l.trim().length > 0);
  const f0 = new Float32Array(lines.length);
  const voiced = new Uint8Array(lines.length);
  for (let i = 0; i < lines.length; i++) {
    const parts = lines[i].trim().split(/\s+/);
    f0[i] = parseFloat(parts[0]);
    voiced[i] = parts[1] === "1.0" || parts[1] === "1" ? 1 : 0;
  }
  return { f0, voiced, hopMs: 10 };
}

function loadPtdb() {
  if (!existsSync(PTDB_DIR)) return null;
  const corpus = [];
  for (const [gender, gDir] of [["w", "FEMALE"], ["m", "MALE"]]) {
    const micRoot = join(PTDB_DIR, gDir, "MIC");
    if (!existsSync(micRoot)) continue;
    for (const speaker of readdirSync(micRoot)) {
      const mDir = join(micRoot, speaker);
      const rDir = join(PTDB_DIR, gDir, "REF", speaker);
      if (!existsSync(rDir)) continue;
      for (const wf of readdirSync(mDir).filter((f) => f.endsWith(".wav"))) {
        const rf = wf.replace(/^mic_/, "ref_").replace(/\.wav$/, ".f0");
        const rp = join(rDir, rf);
        if (!existsSync(rp)) continue;
        const { samples, sampleRate } = readWav(join(mDir, wf));
        if (sampleRate !== 48000) continue;
        corpus.push({ gender, speaker, filename: wf, samples, ref: readRef(rp) });
      }
    }
  }
  return corpus;
}

// ---------------------------------------------------------------------------
//  vm worker context
// ---------------------------------------------------------------------------

function makeCtx(sampleRate) {
  const src = readFileSync(WORKER_PATH, "utf8");
  const ctx = {
    self: { postMessage() {}, onmessage: null },
    performance: { now: () => 0, timeOrigin: 0 },
    console,
    __PYIN_STAGE: 0,
    __PYIN_LOOKBACK: 2,
  };
  vm.createContext(ctx);
  vm.runInContext(src, ctx, { filename: "dsp-worker.js" });
  ctx.self.onmessage({ data: { type: "init", sampleRate } });
  return ctx;
}

const reset = (ctx) => ctx.self.onmessage({ data: { type: "reset-pitch-hmm" } });
const setSigma = (ctx, sigma) => ctx.self.onmessage({ data: { type: "set-pyin-sigma", sigma } });

// ---------------------------------------------------------------------------
//  Hillenbrand: multi-frame stepping, last non-null per file
// ---------------------------------------------------------------------------

function evalHillenbrand(ctx, corpus) {
  const errs = { m: [], w: [] };
  let mNull = 0, wNull = 0;
  const winN = 800, hopN = 400;
  for (const e of corpus) {
    reset(ctx);
    const startN = Math.floor(e.samples.length * 0.15);
    const endN = Math.floor(e.samples.length * 0.85);
    let last = null;
    for (let i = startN; i + winN <= endN; i += hopN) {
      const r = ctx.detectPitch(e.samples.subarray(i, i + winN), 16000);
      if (r !== null) last = r;
    }
    if (last === null) { if (e.gender === "m") mNull++; else wNull++; continue; }
    errs[e.gender].push(Math.abs(last - e.truthF0));
  }
  return { fStats: stats(errs.w), mStats: stats(errs.m), wNull, mNull };
}

// ---------------------------------------------------------------------------
//  PTDB-TUG: frame-by-frame contour matching, with optional Stage-0 mask
//  for co-detected fair comparison
// ---------------------------------------------------------------------------

function evalPtdbFile(ctx, e, lookback, stage0Mask) {
  reset(ctx);
  const sr = 48000;
  const winN = 2400, hopN = 1200;
  const errs = [];
  const errsCodet = [];
  const detectedMask = [];
  let n = 0, refVoicedFrames = 0;
  for (let i = 0; i + winN <= e.samples.length; i += hopN, n++) {
    const got = ctx.detectPitch(e.samples.subarray(i, i + winN), sr);
    const attrHop = lookback != null ? n - lookback : n;
    if (attrHop < 0) continue;
    const attrMs = attrHop * 25 + 25;
    const refIdx = Math.round(attrMs / e.ref.hopMs);
    if (refIdx < 0 || refIdx >= e.ref.f0.length) continue;
    if (e.ref.voiced[refIdx] !== 1) continue;
    refVoicedFrames++;
    detectedMask.push(got !== null ? 1 : 0);
    if (got === null) continue;
    const err = Math.abs(got - e.ref.f0[refIdx]);
    errs.push(err);
    if (stage0Mask && stage0Mask[refVoicedFrames - 1] === 1) errsCodet.push(err);
  }
  return { errs, errsCodet, detectedMask, refVoicedFrames };
}

function evalPtdb(ctx, corpus, lookback, stage0Masks = null) {
  const errs = { m: [], w: [] };
  const errsCodet = { m: [], w: [] };
  const masks = new Map();
  let totalRefVoiced = 0, totalNull = 0;
  for (const e of corpus) {
    const m = stage0Masks ? stage0Masks.get(e.filename) : null;
    const r = evalPtdbFile(ctx, e, lookback, m);
    errs[e.gender].push(...r.errs);
    if (m) errsCodet[e.gender].push(...r.errsCodet);
    if (!stage0Masks) masks.set(e.filename, Uint8Array.from(r.detectedMask));
    totalRefVoiced += r.refVoicedFrames;
    totalNull += r.refVoicedFrames - r.errs.length;
  }
  return {
    f: stats(errs.w), m: stats(errs.m),
    fCodet: stats(errsCodet.w), mCodet: stats(errsCodet.m),
    masks, totalRefVoiced, totalNull,
  };
}

// ---------------------------------------------------------------------------
//  Stats helper
// ---------------------------------------------------------------------------

function stats(arr) {
  if (!arr.length) return { mean: NaN, median: NaN, p95: NaN, n: 0 };
  const s = [...arr].sort((a, b) => a - b);
  return {
    mean: arr.reduce((a, b) => a + b, 0) / arr.length,
    median: s[Math.floor(s.length / 2)],
    p95: s[Math.floor(s.length * 0.95)],
    n: arr.length,
  };
}

// ---------------------------------------------------------------------------
//  Main
// ---------------------------------------------------------------------------

console.log("Loading corpora…");
const hillenbrand = loadHillenbrand();
const ptdb = loadPtdb();
console.log(
  `  Hillenbrand: ${hillenbrand.length} files (${hillenbrand.filter((c) => c.gender === "m").length} M, ${hillenbrand.filter((c) => c.gender === "w").length} F)`,
);
console.log(`  PTDB-TUG: ${ptdb ? ptdb.length : 0} files`);
if (!ptdb || ptdb.length === 0) {
  console.log("ERROR: PTDB-TUG corpus required for sweep. Run scripts/fetch-ptdb-tug-subset.sh first.");
  process.exit(1);
}

const ctx16 = makeCtx(16000);
const ctx48 = makeCtx(48000);

const results = []; // each cell: { sigma | "stage0", corpus, ... metrics }

// Stage 0 baselines (no σ dependency)
console.log("\nStage 0 baselines…");
{
  ctx16.__PYIN_STAGE = 0;
  ctx48.__PYIN_STAGE = 0;
  const t0 = Date.now();
  const h = evalHillenbrand(ctx16, hillenbrand);
  const p = evalPtdb(ctx48, ptdb, null, null);
  const dt = ((Date.now() - t0) / 1000).toFixed(1);
  results.push({
    label: "Stage 0", sigma: null, lookback: null,
    hillF: h.fStats, hillM: h.mStats, hillFNull: h.wNull, hillMNull: h.mNull,
    ptdbF: p.f, ptdbM: p.m, ptdbFCodet: p.fCodet, ptdbMCodet: p.mCodet,
    ptdbMasks: p.masks,
    ptdbNullRate: p.totalRefVoiced > 0 ? p.totalNull / p.totalRefVoiced : 0,
  });
  console.log(
    `  [${dt}s] Hill F=${h.fStats.mean.toFixed(2)} M=${h.mStats.mean.toFixed(2)} | ` +
    `PTDB F=${p.f.mean.toFixed(2)} (p95 ${p.f.p95.toFixed(1)}) M=${p.m.mean.toFixed(2)} | ` +
    `null=${(100 * p.totalNull / p.totalRefVoiced).toFixed(1)}%`,
  );
}
const stage0Masks = results[0].ptdbMasks;

// Stage 2 L=2 across σ values
console.log("\nStage 2 L=2 across σ ∈ {15, 20, 30, 50, 75, 100}…");
ctx16.__PYIN_STAGE = 2; ctx16.__PYIN_LOOKBACK = 2;
ctx48.__PYIN_STAGE = 2; ctx48.__PYIN_LOOKBACK = 2;
for (const sigma of SIGMAS) {
  setSigma(ctx16, sigma);
  setSigma(ctx48, sigma);
  const t0 = Date.now();
  const h = evalHillenbrand(ctx16, hillenbrand);
  const p = evalPtdb(ctx48, ptdb, 2, stage0Masks);
  const dt = ((Date.now() - t0) / 1000).toFixed(1);
  results.push({
    label: `σ=${sigma}`, sigma, lookback: 2,
    hillF: h.fStats, hillM: h.mStats, hillFNull: h.wNull, hillMNull: h.mNull,
    ptdbF: p.f, ptdbM: p.m, ptdbFCodet: p.fCodet, ptdbMCodet: p.mCodet,
    ptdbNullRate: p.totalRefVoiced > 0 ? p.totalNull / p.totalRefVoiced : 0,
  });
  console.log(
    `  [${dt}s] σ=${String(sigma).padStart(3)}: Hill F=${h.fStats.mean.toFixed(2)} M=${h.mStats.mean.toFixed(2)} | ` +
    `PTDB(codet) F=${p.fCodet.mean.toFixed(2)} p95=${p.fCodet.p95.toFixed(1)} M=${p.mCodet.mean.toFixed(2)} | ` +
    `PTDB(raw) F=${p.f.mean.toFixed(2)} p95=${p.f.p95.toFixed(1)}`,
  );
}

// ---------------------------------------------------------------------------
//  Pareto table
// ---------------------------------------------------------------------------

const s0 = results[0];
const HILL_S0_F = s0.hillF.mean;
const PTDB_S0_F_RAW = s0.ptdbF.mean;
const PTDB_S0_P95 = s0.ptdbF.p95;

console.log("\n========== Pareto table — both corpora at Stage 2 L=2 ==========");
console.log(`  Stage 0 baselines: Hill F=${HILL_S0_F.toFixed(2)}    PTDB(raw) F=${PTDB_S0_F_RAW.toFixed(2)} p95=${PTDB_S0_P95.toFixed(1)}`);
console.log("");
console.log(`  ${"cell".padEnd(7)}    ${"Hill F".padStart(7)} ${"Hill M".padStart(7)}   ${"PTDB F(c)".padStart(9)} ${"PTDB p95(c)".padStart(11)} ${"PTDB M(c)".padStart(9)}    ${"Pareto?".padStart(8)}`);
const ptdbThresholdF = 6.64;
const ptdbThresholdP95 = 30;
for (const r of results.slice(1)) {
  const hillBetter = r.hillF.mean < HILL_S0_F;
  const ptdbBetter = r.ptdbFCodet.mean < ptdbThresholdF;
  const p95OK = r.ptdbFCodet.p95 < ptdbThresholdP95;
  const dominates = hillBetter && ptdbBetter && p95OK;
  console.log(
    `  ${r.label.padEnd(7)}    ${r.hillF.mean.toFixed(2).padStart(7)} ${r.hillM.mean.toFixed(2).padStart(7)}   ` +
    `${r.ptdbFCodet.mean.toFixed(2).padStart(9)} ${r.ptdbFCodet.p95.toFixed(1).padStart(11)} ${r.ptdbMCodet.mean.toFixed(2).padStart(9)}    ` +
    `${(dominates ? "STRICT-DOM" : (hillBetter ? "hill✓ " : "hill✗ ") + (ptdbBetter ? "ptdb✓" : "ptdb✗") + (p95OK ? "" : " p95✗")).padStart(8)}`,
  );
}

console.log("");
console.log(`  Pareto criterion: Stage 2 L=2 must satisfy ALL of:`);
console.log(`    1. Hillenbrand F mean < ${HILL_S0_F.toFixed(2)} (Stage 0 baseline)`);
console.log(`    2. PTDB-TUG codet F mean < ${ptdbThresholdF.toFixed(2)} (Stage 0 raw F mean)`);
console.log(`    3. PTDB-TUG codet F p95 < ${ptdbThresholdP95} Hz (long-tail check)`);

console.log("\n--- BEGIN-JSON ---");
const out = results.map((r) => ({ ...r, ptdbMasks: undefined }));
console.log(JSON.stringify(out, null, 2));
console.log("--- END-JSON ---");
