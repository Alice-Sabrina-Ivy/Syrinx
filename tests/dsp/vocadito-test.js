// vocadito-test.js — Stage 0 vs Stage 2 pYIN against the vocadito corpus
// (Bittner et al. 2021, Spotify + IRCAM). Frame-by-frame F0 contour matching
// against expert-labeled ground truth on 40 short solo singing excerpts.
//
// Usage: node tests/dsp/vocadito-test.js
//
// Why this corpus
//
//   Hillenbrand has zero F0 coverage below 90 Hz; vocadito has 14 of 40
//   tracks with frames in 69-90 Hz and 11 tracks with p95 above 348 Hz.
//   Adding vocadito to the regression suite is the smallest change that
//   exposes how production behaves at the pitch extremes Hillenbrand can't
//   characterize. License is CC-BY 4.0 — see tests/dsp/data/vocadito/LICENSE.md.
//
// Methodology — mirrors tests/dsp/ptdb-tug-test.js
//
//   - Worker steps audio (44.1 kHz native, no resampling) at 25 ms hops,
//     50 ms windows. Same hop/window cadence production uses.
//   - F0 CSVs give ground-truth F0 every 5.8 ms (256 samples @ 44.1 kHz).
//     Two columns: time_sec, f0_Hz. f0=0 means unvoiced. Skip unvoiced
//     ref frames in the error computation.
//   - For each worker call at hop n, attribute the returned pitch to its
//     L-back center time (Stage 2 reports the L-frames-back state's pitch).
//     Map that time to the closest ref index.
//   - Aggregate per-track and corpus-wide F0 absolute errors per stage.
//   - Co-detected fair comparison: Stage 2 errors restricted to frames
//     where Stage 0 also returned non-null (mirrors the production-
//     equivalent comparison in ptdb-tug-test.js).
//
// Per-track sort by ground-truth median F0 makes the pitch-range failure
// mode visible: low-F0 tracks (median < 100 Hz) are where production is
// expected to struggle, since pYIN's state space is [75, 600] Hz with
// dense harmonic destinations available at sub-100-Hz fundamentals.
//
// Stages: PYIN_STAGE=0 (vanilla YIN baseline), PYIN_STAGE=2 with L=2 and
// L=4 (production ship). Mirrors ptdb-tug-test.js stage selection.

import { readFileSync, readdirSync, existsSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import vm from "vm";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "../..");
const WORKER_PATH = join(ROOT, "src/dsp/dsp-worker.js");
const VOCADITO_DIR = join(ROOT, "tests/dsp/data/vocadito");

if (!existsSync(VOCADITO_DIR)) {
  console.log("SKIP: tests/dsp/data/vocadito not found.");
  process.exit(0);
}

// ---------------------------------------------------------------------------
//  WAV reader (16-bit PCM mono — vocadito files are 44.1 kHz)
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
//  F0 CSV parser. Format (from tests/dsp/data/vocadito/Annotations/README.txt):
//    col 1: evenly-spaced timestamp (seconds)
//    col 2: F0 (Hz). 0.0 = unvoiced.
//  Returns { f0, hopMs, voicedF0 } where voicedF0 is the non-zero subset
//  used for per-track ref-median statistics.
// ---------------------------------------------------------------------------

function readF0(path) {
  const text = readFileSync(path, "utf8");
  const lines = text.split("\n").filter((l) => l.trim().length > 0);
  const t = new Float32Array(lines.length);
  const f0 = new Float32Array(lines.length);
  for (let i = 0; i < lines.length; i++) {
    const parts = lines[i].split(",");
    t[i] = parseFloat(parts[0]);
    f0[i] = parseFloat(parts[1]);
  }
  // Hop is determined empirically — vocadito uses 256 / 44100 ≈ 5.8049886 ms,
  // but reading from the file rather than hard-coding leaves room for any
  // future per-track variation.
  const hopMs = t.length >= 2 ? (t[1] - t[0]) * 1000 : 5.8049886;
  const voicedF0 = [];
  for (let i = 0; i < f0.length; i++) if (f0[i] > 0) voicedF0.push(f0[i]);
  return { f0, hopMs, voicedF0 };
}

// ---------------------------------------------------------------------------
//  Metadata CSV — track_id, singer_id, average_pitch (MIDI), language.
// ---------------------------------------------------------------------------

function readMetadata() {
  const path = join(VOCADITO_DIR, "vocadito_metadata.csv");
  const text = readFileSync(path, "utf8");
  const lines = text.split("\n").filter((l) => l.trim().length > 0).slice(1);
  const map = new Map();
  for (const line of lines) {
    const [trackId, singerId, , language] = line.split(",");
    map.set(parseInt(trackId, 10), { singerId, language });
  }
  return map;
}

// ---------------------------------------------------------------------------
//  Corpus loader.
// ---------------------------------------------------------------------------

function loadCorpus() {
  const audioDir = join(VOCADITO_DIR, "Audio");
  const f0Dir = join(VOCADITO_DIR, "Annotations", "F0");
  if (!existsSync(audioDir) || !existsSync(f0Dir)) return [];
  const meta = readMetadata();
  const corpus = [];
  const wavFiles = readdirSync(audioDir)
    .filter((f) => f.endsWith(".wav"))
    .sort((a, b) => parseInt(a.match(/(\d+)/)[1], 10) - parseInt(b.match(/(\d+)/)[1], 10));
  for (const wavFile of wavFiles) {
    const trackId = parseInt(wavFile.match(/vocadito_(\d+)\.wav/)[1], 10);
    const f0Path = join(f0Dir, `vocadito_${trackId}_f0.csv`);
    if (!existsSync(f0Path)) continue;
    const { samples, sampleRate } = readWav(join(audioDir, wavFile));
    if (sampleRate !== 44100) {
      console.warn(`  skip ${wavFile}: sample rate ${sampleRate} ≠ 44100`);
      continue;
    }
    const ref = readF0(f0Path);
    const m = meta.get(trackId) || {};
    // Pre-compute ref median so per-track output can sort by it.
    const sortedV = [...ref.voicedF0].sort((a, b) => a - b);
    const refMedian = sortedV.length > 0 ? sortedV[Math.floor(sortedV.length / 2)] : NaN;
    const refP10 = sortedV.length > 0 ? sortedV[Math.floor(sortedV.length * 0.10)] : NaN;
    corpus.push({ trackId, singerId: m.singerId, language: m.language, samples, ref, refMedian, refP10 });
  }
  return corpus;
}

// ---------------------------------------------------------------------------
//  Worker context — mirrors ptdb-tug-test.js. PTDB initializes at 48 kHz;
//  vocadito at 44.1 kHz native (no resampling).
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
//  Per-track frame-by-frame matching (mirror of ptdb-tug-test.js evalFile).
// ---------------------------------------------------------------------------

function evalTrack(ctx, samples, sampleRate, ref, lookback, stage0DetectedMask) {
  resetHmm(ctx);
  const winN = Math.floor(sampleRate * 50 / 1000);
  const hopN = Math.floor(sampleRate * 25 / 1000);
  const winCenterMsAtHop0 = 0.5 * winN * 1000 / sampleRate;
  const hopMs = hopN * 1000 / sampleRate;

  const errs = [];
  const errsCodet = [];
  const detectedMask = [];
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
    if (ref.f0[refIdx] === 0) continue;
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

console.log("Loading vocadito corpus…");
const corpus = loadCorpus();
console.log(`  ${corpus.length} tracks loaded.`);
if (corpus.length === 0) {
  console.log("SKIP: vocadito corpus is empty.");
  process.exit(0);
}

const ctx = makeWorkerCtx(44100);

const stageCells = [
  { label: "Stage 0",     stage: 0, lookback: null },
  { label: "Stage 2 L=2", stage: 2, lookback: 2 },
  { label: "Stage 2 L=4", stage: 2, lookback: 4 },
];

const results = [];
const stage0Masks = new Map();

console.log("\nRunning sweep (Stage 0 first to build co-detect masks)…");
for (const cell of stageCells) {
  ctx.__PYIN_STAGE = cell.stage;
  if (cell.lookback != null) ctx.__PYIN_LOOKBACK = cell.lookback;

  const allErrs = [];
  const allErrsCodet = [];
  const perTrack = [];
  let totalRefVoiced = 0;
  let totalWorkerNull = 0;

  const t0 = Date.now();
  for (const trk of corpus) {
    const stage0Mask = cell.stage === 0 ? null : stage0Masks.get(trk.trackId);
    const r = evalTrack(ctx, trk.samples, 44100, trk.ref, cell.lookback, stage0Mask);
    allErrs.push(...r.errs);
    allErrsCodet.push(...r.errsCodet);
    if (cell.stage === 0) stage0Masks.set(trk.trackId, Uint8Array.from(r.detectedMask));
    totalRefVoiced += r.refVoicedFrames;
    totalWorkerNull += r.workerNullCount;
    perTrack.push({
      trackId: trk.trackId,
      singerId: trk.singerId,
      refMedian: trk.refMedian,
      refP10: trk.refP10,
      meanErr: r.errs.length > 0 ? r.errs.reduce((a, b) => a + b, 0) / r.errs.length : NaN,
      n: r.errs.length,
    });
  }
  const dt = ((Date.now() - t0) / 1000).toFixed(1);
  results.push({
    label: cell.label, stage: cell.stage, lookback: cell.lookback,
    perFrame: stats(allErrs),
    perFrameCodet: stats(allErrsCodet),
    perTrack,
    workerNullRate: totalRefVoiced > 0 ? totalWorkerNull / totalRefVoiced : 0,
    totalRefVoiced, totalWorkerNull,
    elapsed: dt,
  });
  console.log(
    `  [${dt}s] ${cell.label.padEnd(13)} ` +
    `per-frame: ${fmt(stats(allErrs))}    ` +
    `null=${totalWorkerNull}/${totalRefVoiced} (${(100 * totalWorkerNull / Math.max(1, totalRefVoiced)).toFixed(1)}%)`,
  );
}

// ---------------------------------------------------------------------------
//  Aggregate report
// ---------------------------------------------------------------------------

console.log("\n========== Per-frame F0 error mean by stage ==========");
console.log(`  ${"cell".padEnd(13)}  ${"mean".padStart(8)} ${"median".padStart(8)} ${"p95".padStart(8)}    null rate`);
for (const r of results) {
  console.log(
    `  ${r.label.padEnd(13)}  ${r.perFrame.mean.toFixed(2).padStart(8)} ${r.perFrame.median.toFixed(2).padStart(8)} ${r.perFrame.p95.toFixed(2).padStart(8)}    ${(100 * r.workerNullRate).toFixed(1)}%`,
  );
}

console.log("\n========== Δ vs Stage 0 (negative = improvement) ==========");
const s0 = results.find((r) => r.stage === 0);
for (const r of results) {
  if (r.stage === 0) continue;
  console.log(
    `  ${r.label.padEnd(13)}  per-frame Δmean: ${(r.perFrame.mean - s0.perFrame.mean).toFixed(2).padStart(7)} Hz`,
  );
}

console.log("\n========== Co-detected fair comparison (frames where Stage 0 also detected) ==========");
console.log(`  ${"cell".padEnd(13)}  ${"mean".padStart(8)} ${"median".padStart(8)} ${"p95".padStart(8)}`);
for (const r of results) {
  const s = r.stage === 0 ? r.perFrame : r.perFrameCodet;
  console.log(
    `  ${r.label.padEnd(13)}  ${s.mean.toFixed(2).padStart(8)} ${s.median.toFixed(2).padStart(8)} ${s.p95.toFixed(2).padStart(8)}`,
  );
}

// ---------------------------------------------------------------------------
//  Per-track results, sorted by ground-truth median F0. Surfaces low-pitch
//  failures: tracks with refMedian below ~100 Hz are where the algorithm's
//  state space ([75, 600] Hz) leaves room for harmonic-destination errors,
//  per measurements/voicing-decision-literature-review-2026-05-06.md.
// ---------------------------------------------------------------------------

console.log("\n========== Per-track F0 error, sorted by ground-truth median ==========");
console.log(`  ${"trk".padStart(3)} ${"singer".padStart(6)} ${"refMed".padStart(7)} ${"refP10".padStart(7)} ${"S0 mean".padStart(8)} ${"S2L2 mean".padStart(10)} ${"S2L4 mean".padStart(10)} ${"n".padStart(5)}`);
const byTrack = new Map();
for (const r of results) {
  for (const t of r.perTrack) {
    if (!byTrack.has(t.trackId)) {
      byTrack.set(t.trackId, { trackId: t.trackId, singerId: t.singerId, refMedian: t.refMedian, refP10: t.refP10, errs: {} });
    }
    byTrack.get(t.trackId).errs[r.label] = { meanErr: t.meanErr, n: t.n };
  }
}
const sorted = [...byTrack.values()].sort((a, b) => a.refMedian - b.refMedian);
for (const t of sorted) {
  const s0Err = t.errs["Stage 0"]?.meanErr ?? NaN;
  const l2Err = t.errs["Stage 2 L=2"]?.meanErr ?? NaN;
  const l4Err = t.errs["Stage 2 L=4"]?.meanErr ?? NaN;
  const n = t.errs["Stage 2 L=4"]?.n ?? 0;
  console.log(
    `  ${String(t.trackId).padStart(3)} ${String(t.singerId).padStart(6)} ` +
    `${t.refMedian.toFixed(1).padStart(7)} ${t.refP10.toFixed(1).padStart(7)} ` +
    `${s0Err.toFixed(2).padStart(8)} ${l2Err.toFixed(2).padStart(10)} ${l4Err.toFixed(2).padStart(10)} ${String(n).padStart(5)}`,
  );
}

console.log("\n--- BEGIN-JSON ---");
console.log(JSON.stringify(results, null, 2));
console.log("--- END-JSON ---");
