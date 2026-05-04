// ptdb-tug-test.js — Stage 2.B vs Stage 0 on real-world PTDB-TUG recordings
// (Pirker et al. 2011, Graz Univ. of Technology). Frame-by-frame F0 contour
// matching against the laryngograph-derived ground truth, on a subset of
// 4 speakers (2 F + 2 M) × 45 SX sentences = ~180 files.
//
// Usage: node tests/dsp/ptdb-tug-test.js
//
// Methodology:
//   - Worker steps MIC audio (48 kHz) at 25 ms hops, 50 ms windows.
//   - REF .f0 files give ground-truth F0 every 10 ms (col 1 = f0 Hz,
//     col 2 = voiced flag).
//   - For each worker call at hop n: align to REF time accounting for
//     Stage 2's L-frame lookback. Skip warm-up frames. Skip frames
//     where REF says unvoiced.
//   - Aggregate per-frame absolute F0 errors per gender per cell.
//
// Apples-to-apples baseline: Stage 0 in this harness, NOT historical
// single-window numbers. Stage 0's per-frame errors here include the
// noisy and transitional regions of real-world recordings — that's the
// realistic regime for production.
//
// Stages: PYIN_STAGE=0 (legacy baseline, no longer shipped),
// PYIN_STAGE=2 with L=2 (50 ms latency) and L=4 (100 ms latency, the
// production ship value selected by the L-axis sweep at
// measurements/pyin-L-sweep-2026-05-04.md). L=10 skipped — warm-up
// failure mode on short files; would need graceful warm-up first.

import { readFileSync, readdirSync, existsSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import vm from "vm";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "../..");
const WORKER_PATH = join(ROOT, "src/dsp/dsp-worker.js");
const PTDB_DIR = join(ROOT, "tests/dsp/data/ptdb-tug");

if (!existsSync(PTDB_DIR)) {
  console.log("SKIP: tests/dsp/data/ptdb-tug not found.");
  console.log("To populate, run: bash scripts/fetch-ptdb-tug-subset.sh");
  process.exit(0);
}

// ---------------------------------------------------------------------------
//  WAV reader (16-bit PCM mono — PTDB-TUG MIC files are 48 kHz)
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
//  REF .f0 parser. Format: 4 cols per line, 10 ms hop.
//    col 1: smoothed f0 (Hz) — primary ground truth, 0 when unvoiced
//    col 2: voicing flag (0 / 1)
//    col 3: alternative pitch estimate (we ignore — col 1 is the reference)
//    col 4: confidence/probability (we ignore)
//  Returns: { f0: Float32Array, voiced: Uint8Array, hopMs: 10 }
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

// ---------------------------------------------------------------------------
//  Corpus loader — walks tests/dsp/data/ptdb-tug/{FEMALE,MALE}/MIC/{F,M}NN
//  Returns array of { gender: 'm'|'w', speaker, samples, ref }.
// ---------------------------------------------------------------------------

function loadCorpus() {
  const corpus = [];
  for (const [gender, gDir] of [["w", "FEMALE"], ["m", "MALE"]]) {
    const micRoot = join(PTDB_DIR, gDir, "MIC");
    if (!existsSync(micRoot)) continue;
    for (const speaker of readdirSync(micRoot)) {
      const speakerMicDir = join(micRoot, speaker);
      const speakerRefDir = join(PTDB_DIR, gDir, "REF", speaker);
      if (!existsSync(speakerRefDir)) continue;
      for (const wavFile of readdirSync(speakerMicDir).filter((f) => f.endsWith(".wav"))) {
        const refFile = wavFile.replace(/^mic_/, "ref_").replace(/\.wav$/, ".f0");
        const refPath = join(speakerRefDir, refFile);
        if (!existsSync(refPath)) continue;
        const { samples, sampleRate } = readWav(join(speakerMicDir, wavFile));
        if (sampleRate !== 48000) continue;
        const ref = readRef(refPath);
        corpus.push({ gender, speaker, filename: wavFile, samples, ref });
      }
    }
  }
  return corpus;
}

// ---------------------------------------------------------------------------
//  Worker context
// ---------------------------------------------------------------------------

function makeWorkerCtx(sampleRate) {
  const src = readFileSync(WORKER_PATH, "utf8");
  const ctx = {
    self: { postMessage() {}, onmessage: null },
    performance: { now: () => 0, timeOrigin: 0 },
    console,
    __PYIN_STAGE: 0,
    __PYIN_LOOKBACK: 4,
  };
  vm.createContext(ctx);
  vm.runInContext(src, ctx, { filename: "dsp-worker.js" });
  ctx.self.onmessage({ data: { type: "init", sampleRate } });
  return ctx;
}

function resetHmm(ctx) {
  ctx.self.onmessage({ data: { type: "reset-pitch-hmm" } });
}

// ---------------------------------------------------------------------------
//  Per-file frame-by-frame matching
//
//  For each worker hop n: pitch is reported at the L-back frame's center
//  time. Window center for hop n = (n*25ms + 25ms) [start + winSize/2].
//  Stage 0/1: pitch attribution time = (n+1)*25 ms.
//  Stage 2 L: pitch attribution time = (n+1-L)*25 ms.
//  REF index: round(attribution_time / 10 ms).
// ---------------------------------------------------------------------------

// Per-frame matching. If stage0DetectedMask is provided, also produce a
// co-detected error list filtered to frames where Stage 0 returned
// non-null (the production-equivalent comparison: Stage 0's null
// frames would be silence-gated downstream anyway, so charging Stage 2
// for errors on those frames isn't fair).
function evalFile(ctx, samples, sampleRate, ref, lookback, stage0DetectedMask) {
  resetHmm(ctx);
  const winN = Math.floor(sampleRate * 50 / 1000); // 2400 @ 48 kHz
  const hopN = Math.floor(sampleRate * 25 / 1000); // 1200 @ 48 kHz
  const hopMs = 25;
  const winCenterMsAtHop0 = 25;

  const errs = [];
  const errsCodet = [];
  const detectedMask = []; // per-attr-frame: 1 if got non-null, 0 if null
  let workerNullCount = 0;
  let refVoicedFrames = 0;

  let n = 0;
  for (let i = 0; i + winN <= samples.length; i += hopN, n++) {
    const got = ctx.detectPitch(samples.subarray(i, i + winN), sampleRate);
    const attrHop = lookback != null ? n - lookback : n;
    if (attrHop < 0) continue;
    const attrMs = attrHop * hopMs + winCenterMsAtHop0;
    const refIdx = Math.round(attrMs / ref.hopMs);
    if (refIdx < 0 || refIdx >= ref.f0.length) continue;
    if (ref.voiced[refIdx] !== 1) continue;
    refVoicedFrames++;
    detectedMask.push(got !== null ? 1 : 0);
    if (got === null) { workerNullCount++; continue; }
    const err = Math.abs(got - ref.f0[refIdx]);
    errs.push(err);
    if (stage0DetectedMask && stage0DetectedMask[refVoicedFrames - 1] === 1) {
      errsCodet.push(err);
    }
  }
  return { errs, errsCodet, detectedMask, workerNullCount, refVoicedFrames, frames: n };
}

// ---------------------------------------------------------------------------
//  Stats helpers
// ---------------------------------------------------------------------------

function stats(arr) {
  if (!arr.length) return { mean: NaN, median: NaN, p95: NaN, n: 0 };
  const s = [...arr].sort((a, b) => a - b);
  const mean = arr.reduce((a, b) => a + b, 0) / arr.length;
  return { mean, median: s[Math.floor(s.length / 2)], p95: s[Math.floor(s.length * 0.95)], n: arr.length };
}

const fmt = (s) => `mean=${s.mean.toFixed(2)} median=${s.median.toFixed(2)} p95=${s.p95.toFixed(2)} (n=${s.n})`;

// ---------------------------------------------------------------------------
//  Main
// ---------------------------------------------------------------------------

console.log("Loading PTDB-TUG corpus subset…");
const corpus = loadCorpus();
const fCount = corpus.filter((c) => c.gender === "w").length;
const mCount = corpus.filter((c) => c.gender === "m").length;
console.log(`  ${corpus.length} files (${mCount} M, ${fCount} F)`);
if (corpus.length === 0) {
  console.log("SKIP: PTDB-TUG corpus is empty.");
  process.exit(0);
}

const ctx = makeWorkerCtx(48000);

const stageCells = [
  { label: "Stage 0",     stage: 0, lookback: null },
  { label: "Stage 2 L=2", stage: 2, lookback: 2 },
  { label: "Stage 2 L=4", stage: 2, lookback: 4 },
];

const results = [];
// Pass 1: run Stage 0 first, store per-file detected masks for the
// co-detected fair-comparison metric.
const stage0Masks = new Map(); // filename -> Uint8Array (1=detected, 0=null)
console.log("\nRunning sweep (Stage 0 first to build co-detect masks)…");
for (const c of stageCells) {
  ctx.__PYIN_STAGE = c.stage;
  if (c.lookback != null) ctx.__PYIN_LOOKBACK = c.lookback;

  const errs = { m: [], w: [] };
  const errsCodet = { m: [], w: [] };
  const stats_per_file = { m: [], w: [] };
  const stats_per_file_codet = { m: [], w: [] };
  let totalRefVoiced = 0;
  let totalWorkerNull = 0;

  const t0 = Date.now();
  for (const e of corpus) {
    const stage0Mask = c.stage === 0 ? null : stage0Masks.get(e.filename);
    const r = evalFile(ctx, e.samples, 48000, e.ref, c.lookback, stage0Mask);
    errs[e.gender].push(...r.errs);
    if (r.errs.length > 0) {
      stats_per_file[e.gender].push(r.errs.reduce((a, b) => a + b, 0) / r.errs.length);
    }
    if (r.errsCodet.length > 0) {
      errsCodet[e.gender].push(...r.errsCodet);
      stats_per_file_codet[e.gender].push(r.errsCodet.reduce((a, b) => a + b, 0) / r.errsCodet.length);
    }
    if (c.stage === 0) stage0Masks.set(e.filename, Uint8Array.from(r.detectedMask));
    totalRefVoiced += r.refVoicedFrames;
    totalWorkerNull += r.workerNullCount;
  }
  const dt = ((Date.now() - t0) / 1000).toFixed(1);
  results.push({
    label: c.label, stage: c.stage, lookback: c.lookback,
    fPerFrame: stats(errs.w), mPerFrame: stats(errs.m),
    fPerFile: stats(stats_per_file.w), mPerFile: stats(stats_per_file.m),
    fPerFrameCodet: stats(errsCodet.w), mPerFrameCodet: stats(errsCodet.m),
    fPerFileCodet: stats(stats_per_file_codet.w), mPerFileCodet: stats(stats_per_file_codet.m),
    workerNullRate: totalRefVoiced > 0 ? totalWorkerNull / totalRefVoiced : 0,
    totalRefVoiced, totalWorkerNull,
    elapsed: dt,
  });
  console.log(
    `  [${dt}s] ${c.label.padEnd(13)} ` +
    `F per-frame: ${fmt(stats(errs.w))}    ` +
    `M per-frame: ${fmt(stats(errs.m))}    ` +
    `null=${totalWorkerNull}/${totalRefVoiced} (${(100 * totalWorkerNull / Math.max(1, totalRefVoiced)).toFixed(1)}%)`,
  );
}

console.log("\n========== Per-frame F0 error mean by stage ==========");
console.log(`  ${"cell".padEnd(13)}  ${"F mean".padStart(8)} ${"M mean".padStart(8)} ${"F med".padStart(8)} ${"M med".padStart(8)}    null rate`);
for (const r of results) {
  console.log(
    `  ${r.label.padEnd(13)}  ${r.fPerFrame.mean.toFixed(2).padStart(8)} ${r.mPerFrame.mean.toFixed(2).padStart(8)} ` +
    `${r.fPerFrame.median.toFixed(2).padStart(8)} ${r.mPerFrame.median.toFixed(2).padStart(8)}    ${(100 * r.workerNullRate).toFixed(1)}%`,
  );
}

console.log("\n========== Per-FILE mean F0 error (averaged within file, then across files) ==========");
console.log(`  ${"cell".padEnd(13)}  ${"F mean".padStart(8)} ${"M mean".padStart(8)} ${"F med".padStart(8)} ${"M med".padStart(8)}`);
for (const r of results) {
  console.log(
    `  ${r.label.padEnd(13)}  ${r.fPerFile.mean.toFixed(2).padStart(8)} ${r.mPerFile.mean.toFixed(2).padStart(8)} ` +
    `${r.fPerFile.median.toFixed(2).padStart(8)} ${r.mPerFile.median.toFixed(2).padStart(8)}`,
  );
}

console.log("\n========== Δ vs Stage 0 (negative = improvement) ==========");
const s0 = results.find((r) => r.stage === 0);
for (const r of results) {
  if (r.stage === 0) continue;
  console.log(
    `  ${r.label.padEnd(13)}  per-frame F: ${(r.fPerFrame.mean - s0.fPerFrame.mean).toFixed(2).padStart(7)} Hz    ` +
    `per-frame M: ${(r.mPerFrame.mean - s0.mPerFrame.mean).toFixed(2).padStart(7)} Hz    ` +
    `per-file F: ${(r.fPerFile.mean - s0.fPerFile.mean).toFixed(2).padStart(7)} Hz`,
  );
}

// Production-equivalent fair comparison: restrict Stage 2 to frames where
// Stage 0 ALSO returned non-null. Stage 0's null frames would be
// silence-gated downstream in production (intensity-based gate in
// useAudioPipeline.js), so charging Stage 2 for errors on those frames
// over-penalizes it relative to what the user actually sees.
console.log("\n========== Co-detected fair comparison (frames where Stage 0 also detected) ==========");
console.log(`  ${"cell".padEnd(13)}  ${"F mean".padStart(8)} ${"M mean".padStart(8)} ${"F med".padStart(8)} ${"M med".padStart(8)}    Δ vs S0`);
for (const r of results) {
  const fMean = r.stage === 0 ? r.fPerFrame.mean : r.fPerFrameCodet.mean;
  const mMean = r.stage === 0 ? r.mPerFrame.mean : r.mPerFrameCodet.mean;
  const fMed = r.stage === 0 ? r.fPerFrame.median : r.fPerFrameCodet.median;
  const mMed = r.stage === 0 ? r.mPerFrame.median : r.mPerFrameCodet.median;
  const dF = r.stage === 0 ? 0 : fMean - s0.fPerFrame.mean;
  console.log(
    `  ${r.label.padEnd(13)}  ${fMean.toFixed(2).padStart(8)} ${mMean.toFixed(2).padStart(8)} ` +
    `${fMed.toFixed(2).padStart(8)} ${mMed.toFixed(2).padStart(8)}    ${(dF >= 0 ? "+" : "") + dF.toFixed(2)}`,
  );
}

console.log("\n--- BEGIN-JSON ---");
console.log(JSON.stringify(results, null, 2));
console.log("--- END-JSON ---");
