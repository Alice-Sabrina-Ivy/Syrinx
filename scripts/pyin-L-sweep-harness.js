// pyin-L-sweep-harness.js — Sweep the pYIN bounded-history Viterbi lookback L
// over {2, 3, 4, 5, 7, 10} at Stage 2.B + σ=75, on Hillenbrand (subset +
// full corpus) AND PTDB-TUG simultaneously. Used to map the L-axis Pareto
// frontier after the L=2 fallback fix surfaced that prior σ-only-sweep
// numbers were measured at L=2 and didn't bracket the accuracy/latency
// tradeoff.
//
// Methodology — chosen to match what the production test suites measure:
//   - Hillenbrand: streamingMedianDetect (50 ms windows at 25 ms hops over
//     central 70 % of file, MEDIAN of non-null trace). Matches both
//     accuracy-test.js and real-speech-test.js — different from the σ-sweep
//     harness which used last-non-null.
//   - PTDB-TUG: frame-by-frame F0 contour matching against the laryngograph
//     ref, co-detected against the Stage 0 mask (matches ptdb-tug-test.js
//     and the σ-sweep harness).
//   - Accuracy subset = first 5 entries per (gender × vowel) per the
//     accuracy-test.js sample selection; reported alongside full-corpus
//     numbers for direct correspondence with the existing test outputs.
//
// PTDB-TUG fixtures live in c:/Coding Projects/Syrinx (the zip-extracted
// tree); this clone gitignores them. Override path via PTDB_DIR env var if
// running elsewhere.
//
// Usage: node scripts/pyin-L-sweep-harness.js
// Output: stdout — captured to measurements/pyin-L-sweep-2026-05-04-harness.txt

import { readFileSync, readdirSync, existsSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import vm from "vm";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const WORKER_PATH = join(ROOT, "src/dsp/dsp-worker.js");
const HILLENBRAND_DIR = join(ROOT, "tests/dsp/data");
const VOWDATA = join(HILLENBRAND_DIR, "vowdata.dat");
const PTDB_DIR = process.env.PTDB_DIR
  || (existsSync(join(ROOT, "tests/dsp/data/ptdb-tug/FEMALE/MIC"))
        ? join(ROOT, "tests/dsp/data/ptdb-tug")
        : "c:/Coding Projects/Syrinx/tests/dsp/data/ptdb-tug");

const SIGMA_DEFAULT = 75;
const LOOKBACKS = [2, 3, 4, 5, 7, 10];

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
//  Hillenbrand corpus loader
// ---------------------------------------------------------------------------

function parseVowdata(path) {
  const text = readFileSync(path, "utf8");
  const out = [];
  for (const raw of text.split("\n")) {
    const t = raw.trim();
    if (!/^[mwbg]\d/.test(t)) continue;
    const p = t.split(/\s+/);
    if (p.length < 7) continue;
    const filename = p[0];
    out.push({
      filename,
      gender: filename[0],
      vowel: filename.slice(3),
      f0: +p[2],
    });
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
    corpus.push({
      filename: e.filename, gender: e.gender, vowel: e.vowel,
      truthF0: e.f0, samples,
    });
  }
  return corpus;
}

// Mirrors accuracy-test.js: first 5 per (gender, vowel).
function selectAccuracySubset(corpus) {
  const vowels = [...new Set(corpus.map((c) => c.vowel))];
  const subset = [];
  for (const g of ["m", "w"]) {
    for (const v of vowels) {
      const matches = corpus.filter((c) => c.gender === g && c.vowel === v);
      subset.push(...matches.slice(0, 5));
    }
  }
  return new Set(subset.map((c) => c.filename));
}

// ---------------------------------------------------------------------------
//  PTDB-TUG corpus loader
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
//  Hillenbrand evaluator — streamingMedianDetect (matches production tests)
// ---------------------------------------------------------------------------

function streamingMedian(ctx, samples, sr) {
  reset(ctx);
  const winN = Math.floor(sr * 50 / 1000);
  const hopN = Math.floor(sr * 25 / 1000);
  const startN = Math.floor(samples.length * 0.15);
  const endN = Math.floor(samples.length * 0.85);
  const trace = [];
  for (let i = startN; i + winN <= endN; i += hopN) {
    const r = ctx.detectPitch(samples.subarray(i, i + winN), sr);
    if (r !== null) trace.push(r);
  }
  if (trace.length === 0) return null;
  const sorted = [...trace].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
}

function evalHillenbrand(ctx, corpus, accSubsetSet) {
  const errs = { m: [], w: [] };
  const errsAcc = { m: [], w: [] };
  let mNull = 0, wNull = 0;
  for (const e of corpus) {
    const med = streamingMedian(ctx, e.samples, 16000);
    if (med === null) {
      if (e.gender === "m") mNull++; else wNull++;
      continue;
    }
    const err = Math.abs(med - e.truthF0);
    errs[e.gender].push(err);
    if (accSubsetSet.has(e.filename)) errsAcc[e.gender].push(err);
  }
  return {
    full:   { f: stats(errs.w),    m: stats(errs.m) },
    acc:    { f: stats(errsAcc.w), m: stats(errsAcc.m) },
    nulls:  { m: mNull, w: wNull },
  };
}

// ---------------------------------------------------------------------------
//  PTDB-TUG evaluator — frame-by-frame, codet vs Stage 0 mask
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

const fix = (x, d = 2) => (Number.isFinite(x) ? x.toFixed(d) : "NaN");

// ---------------------------------------------------------------------------
//  Main
// ---------------------------------------------------------------------------

console.log("Loading corpora…");
const hillenbrand = loadHillenbrand();
const accSubset = selectAccuracySubset(hillenbrand);
const ptdb = loadPtdb();
const hM = hillenbrand.filter((c) => c.gender === "m").length;
const hF = hillenbrand.filter((c) => c.gender === "w").length;
console.log(`  Hillenbrand: ${hillenbrand.length} files (${hM} M, ${hF} F)`);
console.log(`  Hillenbrand acc-subset: ${accSubset.size} files`);
console.log(`  PTDB-TUG: ${ptdb ? ptdb.length : 0} files (path: ${PTDB_DIR})`);
if (!ptdb || ptdb.length === 0) {
  console.log("ERROR: PTDB-TUG corpus required for sweep.");
  process.exit(1);
}

const ctx16 = makeCtx(16000);
const ctx48 = makeCtx(48000);

// Both contexts use σ=75 throughout the L sweep
setSigma(ctx16, SIGMA_DEFAULT);
setSigma(ctx48, SIGMA_DEFAULT);

const results = [];

// ---------------------------------------------------------------------------
//  Stage 0 baseline (no L dependency)
// ---------------------------------------------------------------------------

console.log("\nStage 0 baseline (σ irrelevant)…");
{
  ctx16.__PYIN_STAGE = 0;
  ctx48.__PYIN_STAGE = 0;
  const t0 = Date.now();
  const h = evalHillenbrand(ctx16, hillenbrand, accSubset);
  const p = evalPtdb(ctx48, ptdb, null, null);
  const dt = ((Date.now() - t0) / 1000).toFixed(1);
  results.push({
    label: "Stage 0", stage: 0, lookback: null, sigma: null,
    hillFull: h.full, hillAcc: h.acc, hillNulls: h.nulls,
    ptdb: { f: p.f, m: p.m, fCodet: p.fCodet, mCodet: p.mCodet,
            nullRate: p.totalRefVoiced > 0 ? p.totalNull / p.totalRefVoiced : 0 },
  });
  console.log(
    `  [${dt}s] Stage 0: ` +
    `Hill(full) F=${fix(h.full.f.mean)} p95=${fix(h.full.f.p95, 1)} M=${fix(h.full.m.mean)} | ` +
    `PTDB(raw) F=${fix(p.f.mean)} p95=${fix(p.f.p95, 1)} M=${fix(p.m.mean)} null=${(100 * p.totalNull / Math.max(1, p.totalRefVoiced)).toFixed(1)}%`,
  );
}
const stage0Masks = results[0].ptdb._masks; // not stored; recompute from p.masks below

// Re-run Stage 0 once to capture masks (we discarded them above to keep results JSON compact)
console.log("(capturing Stage 0 PTDB co-detect masks for codet comparison…)");
const stage0MasksMap = (() => {
  ctx48.__PYIN_STAGE = 0;
  const p = evalPtdb(ctx48, ptdb, null, null);
  return p.masks;
})();

// ---------------------------------------------------------------------------
//  Stage 2 L-sweep at σ=75
// ---------------------------------------------------------------------------

console.log(`\nStage 2 L-sweep at σ=${SIGMA_DEFAULT} across L ∈ {${LOOKBACKS.join(", ")}}…`);
ctx16.__PYIN_STAGE = 2;
ctx48.__PYIN_STAGE = 2;

for (const L of LOOKBACKS) {
  ctx16.__PYIN_LOOKBACK = L;
  ctx48.__PYIN_LOOKBACK = L;
  const t0 = Date.now();
  const h = evalHillenbrand(ctx16, hillenbrand, accSubset);
  const p = evalPtdb(ctx48, ptdb, L, stage0MasksMap);
  const dt = ((Date.now() - t0) / 1000).toFixed(1);
  results.push({
    label: `L=${L}`, stage: 2, lookback: L, sigma: SIGMA_DEFAULT,
    hillFull: h.full, hillAcc: h.acc, hillNulls: h.nulls,
    ptdb: { f: p.f, m: p.m, fCodet: p.fCodet, mCodet: p.mCodet,
            nullRate: p.totalRefVoiced > 0 ? p.totalNull / p.totalRefVoiced : 0 },
  });
  console.log(
    `  [${dt}s] L=${String(L).padStart(2)} (lat ${L * 25} ms): ` +
    `Hill(full) F=${fix(h.full.f.mean)} p95=${fix(h.full.f.p95, 1)} M=${fix(h.full.m.mean)} | ` +
    `Hill(acc) F=${fix(h.acc.f.mean)} M=${fix(h.acc.m.mean)} | ` +
    `PTDB(codet) F=${fix(p.fCodet.mean)} p95=${fix(p.fCodet.p95, 1)} M=${fix(p.mCodet.mean)}`,
  );
}

// ---------------------------------------------------------------------------
//  Pareto table
// ---------------------------------------------------------------------------

const s0 = results[0];
const stage2 = results.filter((r) => r.stage === 2);

console.log("\n========== Stage 2.B L-sweep at σ=75 — Pareto table ==========\n");
console.log(`Stage 0 baselines:`);
console.log(`  Hillenbrand(full):  F mean=${fix(s0.hillFull.f.mean)} p95=${fix(s0.hillFull.f.p95, 1)}    M mean=${fix(s0.hillFull.m.mean)} p95=${fix(s0.hillFull.m.p95, 1)}`);
console.log(`  Hillenbrand(acc):   F mean=${fix(s0.hillAcc.f.mean)}    M mean=${fix(s0.hillAcc.m.mean)}`);
console.log(`  PTDB-TUG codet:     F mean=${fix(s0.ptdb.f.mean)} p95=${fix(s0.ptdb.f.p95, 1)}    M mean=${fix(s0.ptdb.m.mean)} p95=${fix(s0.ptdb.m.p95, 1)}    (Stage 0 codet == raw)`);
console.log("");

const headers = ["L", "lat", "Hill F", "Hill M", "Hill F p95", "PTDB F", "PTDB p95", "PTDB M", "acc F", "acc M"];
const widths  = [3,    5,     8,        8,       11,           7,        9,          8,        7,        7];
const fmtRow = (cells) => cells.map((c, i) => String(c).padStart(widths[i])).join(" ");
console.log(fmtRow(headers));
console.log(widths.map((w) => "-".repeat(w)).join(" "));
for (const r of stage2) {
  console.log(fmtRow([
    `L=${r.lookback}`, `${r.lookback * 25}ms`,
    fix(r.hillFull.f.mean), fix(r.hillFull.m.mean),
    fix(r.hillFull.f.p95, 1),
    fix(r.ptdb.fCodet.mean), fix(r.ptdb.fCodet.p95, 1),
    fix(r.ptdb.mCodet.mean),
    fix(r.hillAcc.f.mean), fix(r.hillAcc.m.mean),
  ]));
}
console.log("");

// ---------------------------------------------------------------------------
//  JSON dump for downstream analysis
// ---------------------------------------------------------------------------

console.log("--- BEGIN-JSON ---");
console.log(JSON.stringify(results, null, 2));
console.log("--- END-JSON ---");
