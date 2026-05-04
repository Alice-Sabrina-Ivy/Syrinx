// pyin-sigma-at-bestL-harness.js — Re-verify σ at the best-L cells from the
// L-sweep. The σ=75 selection (measurements/pyin-stage2b-sigma-sweep-2026-
// 05-04.md) was run at L=2 only. The L-sweep showed L=4 (100 ms, in-budget)
// and L=5 (125 ms) as the strongest candidates on full-corpus Hillenbrand;
// at higher L the smoother trace-back may favor a tighter σ.
//
// This harness sweeps σ ∈ {50, 75, 100} at L=4 and L=5, same methodology
// as pyin-L-sweep-harness.js (streamingMedianDetect on Hillenbrand,
// frame-by-frame codet on PTDB-TUG).
//
// Usage: node scripts/pyin-sigma-at-bestL-harness.js

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

const SIGMAS = [50, 75, 100];
const LOOKBACKS_TO_CHECK = [4, 5];

// ---------- WAV / corpus / context helpers (copied from pyin-L-sweep) ----------

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

function parseVowdata(path) {
  const text = readFileSync(path, "utf8");
  const out = [];
  for (const raw of text.split("\n")) {
    const t = raw.trim();
    if (!/^[mwbg]\d/.test(t)) continue;
    const p = t.split(/\s+/);
    if (p.length < 7) continue;
    out.push({ filename: p[0], gender: p[0][0], vowel: p[0].slice(3), f0: +p[2] });
  }
  return out;
}

function loadHillenbrand() {
  const meta = parseVowdata(VOWDATA);
  const corpus = [];
  for (const e of meta) {
    if (e.gender !== "m" && e.gender !== "w") continue;
    if (e.f0 === 0) continue;
    const wp = join(HILLENBRAND_DIR, e.gender === "m" ? "men" : "women", `${e.filename}.wav`);
    if (!existsSync(wp)) continue;
    const { samples, sampleRate } = readWav(wp);
    if (sampleRate !== 16000) continue;
    corpus.push({ filename: e.filename, gender: e.gender, vowel: e.vowel, truthF0: e.f0, samples });
  }
  return corpus;
}

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

function evalHill(ctx, corpus) {
  const errs = { m: [], w: [] };
  for (const e of corpus) {
    const med = streamingMedian(ctx, e.samples, 16000);
    if (med === null) continue;
    errs[e.gender].push(Math.abs(med - e.truthF0));
  }
  return { f: stats(errs.w), m: stats(errs.m) };
}

function evalPtdbFile(ctx, e, lookback, stage0Mask) {
  reset(ctx);
  const sr = 48000, winN = 2400, hopN = 1200;
  const errs = [], errsCodet = [];
  let n = 0, refVoicedFrames = 0;
  for (let i = 0; i + winN <= e.samples.length; i += hopN, n++) {
    const got = ctx.detectPitch(e.samples.subarray(i, i + winN), sr);
    const attrHop = lookback != null ? n - lookback : n;
    if (attrHop < 0) continue;
    const refIdx = Math.round((attrHop * 25 + 25) / e.ref.hopMs);
    if (refIdx < 0 || refIdx >= e.ref.f0.length) continue;
    if (e.ref.voiced[refIdx] !== 1) continue;
    refVoicedFrames++;
    if (got === null) continue;
    const err = Math.abs(got - e.ref.f0[refIdx]);
    errs.push(err);
    if (stage0Mask && stage0Mask[refVoicedFrames - 1] === 1) errsCodet.push(err);
  }
  return { errs, errsCodet, refVoicedFrames };
}

function evalPtdbWithMasks(ctx, corpus, lookback) {
  // Builds Stage 0 detection masks (caller sets ctx.__PYIN_STAGE=0 first).
  const errs = { m: [], w: [] };
  const masks = new Map();
  for (const e of corpus) {
    reset(ctx);
    const sr = 48000, winN = 2400, hopN = 1200;
    const detectedMask = [];
    let refVoicedFrames = 0;
    let n = 0;
    for (let i = 0; i + winN <= e.samples.length; i += hopN, n++) {
      const got = ctx.detectPitch(e.samples.subarray(i, i + winN), sr);
      const attrHop = lookback != null ? n - lookback : n;
      if (attrHop < 0) continue;
      const refIdx = Math.round((attrHop * 25 + 25) / e.ref.hopMs);
      if (refIdx < 0 || refIdx >= e.ref.f0.length) continue;
      if (e.ref.voiced[refIdx] !== 1) continue;
      refVoicedFrames++;
      detectedMask.push(got !== null ? 1 : 0);
      if (got === null) continue;
      errs[e.gender].push(Math.abs(got - e.ref.f0[refIdx]));
    }
    masks.set(e.filename, Uint8Array.from(detectedMask));
  }
  return { masks };
}

function evalPtdbCodet(ctx, corpus, lookback, stage0Masks) {
  const errs = { m: [], w: [] };
  const errsCodet = { m: [], w: [] };
  for (const e of corpus) {
    const m = stage0Masks.get(e.filename);
    const r = evalPtdbFile(ctx, e, lookback, m);
    errs[e.gender].push(...r.errs);
    errsCodet[e.gender].push(...r.errsCodet);
  }
  return { f: stats(errs.w), m: stats(errs.m), fCodet: stats(errsCodet.w), mCodet: stats(errsCodet.m) };
}

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
const hill = loadHillenbrand();
const ptdb = loadPtdb();
console.log(`  Hillenbrand: ${hill.length} files`);
console.log(`  PTDB-TUG: ${ptdb ? ptdb.length : 0} files`);
if (!ptdb || ptdb.length === 0) { console.log("ERROR: PTDB-TUG required."); process.exit(1); }

const ctx16 = makeCtx(16000);
const ctx48 = makeCtx(48000);

// Stage 0 PTDB masks (independent of L for codet purposes — co-detected
// by frame index, not lookback)
console.log("\nCapturing Stage 0 PTDB masks…");
ctx48.__PYIN_STAGE = 0;
const t0 = Date.now();
const { masks: stage0Masks } = evalPtdbWithMasks(ctx48, ptdb, null);
console.log(`  [${((Date.now() - t0) / 1000).toFixed(1)}s] masks captured`);

ctx16.__PYIN_STAGE = 2;
ctx48.__PYIN_STAGE = 2;

const results = [];
for (const L of LOOKBACKS_TO_CHECK) {
  ctx16.__PYIN_LOOKBACK = L;
  ctx48.__PYIN_LOOKBACK = L;
  console.log(`\n--- L=${L} (lat ${L * 25} ms) ---`);
  for (const sigma of SIGMAS) {
    setSigma(ctx16, sigma);
    setSigma(ctx48, sigma);
    const t = Date.now();
    const h = evalHill(ctx16, hill);
    const p = evalPtdbCodet(ctx48, ptdb, L, stage0Masks);
    const dt = ((Date.now() - t) / 1000).toFixed(1);
    results.push({ L, sigma, hill: h, ptdb: p });
    console.log(
      `  [${dt}s] σ=${String(sigma).padStart(3)}: ` +
      `Hill F=${fix(h.f.mean)} p95=${fix(h.f.p95, 1)}    M=${fix(h.m.mean)} p95=${fix(h.m.p95, 1)}    ` +
      `PTDB(codet) F=${fix(p.fCodet.mean)} p95=${fix(p.fCodet.p95, 1)}    M=${fix(p.mCodet.mean)}`,
    );
  }
}

console.log("\n========== σ recheck at L=4 and L=5 ==========\n");
console.log(" L  σ      Hill F  Hill F p95   Hill M   PTDB F   PTDB p95   PTDB M");
console.log("--- ---   ------- -----------  ------- -------- ---------- --------");
for (const r of results) {
  console.log(
    ` ${r.L}  ${String(r.sigma).padStart(3)}   ` +
    `${fix(r.hill.f.mean).padStart(7)} ${fix(r.hill.f.p95, 1).padStart(11)}  ` +
    `${fix(r.hill.m.mean).padStart(7)} ` +
    `${fix(r.ptdb.fCodet.mean).padStart(8)} ${fix(r.ptdb.fCodet.p95, 1).padStart(10)} ` +
    `${fix(r.ptdb.mCodet.mean).padStart(8)}`,
  );
}

console.log("\n--- BEGIN-JSON ---");
console.log(JSON.stringify(results, null, 2));
console.log("--- END-JSON ---");
