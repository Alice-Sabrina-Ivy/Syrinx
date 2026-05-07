// fda-test.js — Stage 0 vs Stage 2 pYIN against the CSTR FDA evaluation
// database (Bagshaw 1994, Edinburgh). Frame-by-frame F0 contour matching
// against laryngograph-derived ground truth on connected English speech.
//
// Usage: node tests/dsp/fda-test.js
//
// Why this corpus
//
//   FDA's male speaker (RL) extends to sub-90-Hz F0 on connected speech
//   (min 60 Hz, p1 68 Hz, p5 88 Hz) with gold-standard laryngograph
//   ground truth — the single strongest oracle for the low-pitch regime
//   that Hillenbrand and Vocadito don't fully cover. Female speaker (SB)
//   provides high-pitch tail (p99 339 Hz, max 400 Hz). License situation
//   is "freely distributed by CSTR for pitch-detector evaluation since
//   1994" with no explicit redistribution grant; Syrinx integrates
//   fetch-on-demand from the original CSTR URL via
//   `bash scripts/fetch-fda-subset.sh`. See tests/dsp/data/fda/README.md.
//
// Methodology — mirrors tests/dsp/vocadito-test.js + tests/dsp/ptdb-tug-test.js
//
//   - .sig audio: raw 20 kHz 16-bit big-endian (SUN byte order), no header.
//   - .fx F0 contour: ASCII header to form-feed (0x0c), then sparse
//     `time_ms F0_Hz` pitchmarks separated by `=` voicing-break lines.
//     Pitchmarks are at glottal-pulse boundaries — spacing is 1/F0
//     within voiced segments (~5-15 ms typical), so we resample onto a
//     regular 5 ms grid via linear interpolation within voiced segments,
//     0 (unvoiced) outside.
//   - Worker steps audio at 25 ms hops, 50 ms windows. Reference F0 at
//     each worker hop's L-back attribution time = nearest 5 ms ref bin.
//   - Aggregate per-speaker and corpus-wide. Co-detected fair comparison
//     restricts Stage 2 to frames where Stage 0 also returned non-null.
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
const FDA_DIR = join(ROOT, "tests/dsp/data/fda");

if (!existsSync(FDA_DIR) || !existsSync(join(FDA_DIR, "rl")) || readdirSync(join(FDA_DIR, "rl")).length === 0) {
  console.log("SKIP: tests/dsp/data/fda is empty.");
  console.log("To populate, run: bash scripts/fetch-fda-subset.sh");
  process.exit(0);
}

// ---------------------------------------------------------------------------
//  .sig reader — raw 20 kHz 16-bit big-endian mono, no header.
// ---------------------------------------------------------------------------

function readSig(path) {
  const buf = readFileSync(path);
  const n = buf.length / 2;
  const s = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    s[i] = buf.readInt16BE(i * 2) / 32768;
  }
  return { samples: s, sampleRate: 20000 };
}

// ---------------------------------------------------------------------------
//  .fx parser. XMG format:
//    - ASCII header (KEY\tVALUE lines + #comments) terminated by 0x0c
//    - Then space-separated `time_ms F0_Hz` pairs, one per line
//    - Lines containing only "=" mark voicing breaks
//
//  Returns a regular-hop F0 array. We resample the irregular pitchmarks
//  onto a 5 ms grid via linear interpolation within voiced segments;
//  unvoiced gaps (between segments) get F0=0. 5 ms matches the typical
//  intra-segment pitchmark spacing so interpolation overhead is minimal.
// ---------------------------------------------------------------------------

const FDA_REF_HOP_MS = 5;

function readFx(path) {
  const buf = readFileSync(path);
  const hdrEnd = buf.indexOf(0x0c);
  if (hdrEnd === -1) throw new Error(`No 0x0c header terminator in ${path}`);
  const data = buf.toString("utf8", hdrEnd + 1).trim();
  const lines = data.split("\n");

  // Group consecutive numeric pitchmarks into voiced segments, separated
  // by '=' lines.
  const segments = [];
  let cur = [];
  for (const line of lines) {
    const t = line.trim();
    if (t === "" ) continue;
    if (t === "=") {
      if (cur.length > 0) segments.push(cur);
      cur = [];
      continue;
    }
    const parts = t.split(/\s+/);
    if (parts.length !== 2) continue;
    const tMs = parseFloat(parts[0]);
    const f0  = parseFloat(parts[1]);
    if (!Number.isFinite(tMs) || !Number.isFinite(f0)) continue;
    cur.push({ tMs, f0 });
  }
  if (cur.length > 0) segments.push(cur);

  // Resample to 5 ms hop. Length = ceil(maxTime / hop) + 1, where maxTime
  // is the last pitchmark across all segments.
  const lastTimeMs = segments.length > 0 && segments[segments.length - 1].length > 0
    ? segments[segments.length - 1][segments[segments.length - 1].length - 1].tMs
    : 0;
  const nBins = Math.ceil(lastTimeMs / FDA_REF_HOP_MS) + 1;
  const f0 = new Float32Array(nBins); // 0 = unvoiced (default)

  for (const seg of segments) {
    if (seg.length === 0) continue;
    const startBin = Math.ceil(seg[0].tMs / FDA_REF_HOP_MS);
    const endBin = Math.floor(seg[seg.length - 1].tMs / FDA_REF_HOP_MS);
    for (let bin = startBin; bin <= endBin; bin++) {
      const queryMs = bin * FDA_REF_HOP_MS;
      // Find consecutive pitchmarks bracketing queryMs.
      let lo = 0, hi = seg.length - 1;
      while (lo < hi - 1) {
        const mid = (lo + hi) >>> 1;
        if (seg[mid].tMs <= queryMs) lo = mid; else hi = mid;
      }
      const a = seg[lo], b = seg[hi];
      // Linear interpolation in F0.
      const span = b.tMs - a.tMs;
      const interp = span > 0 ? a.f0 + (b.f0 - a.f0) * (queryMs - a.tMs) / span : a.f0;
      f0[bin] = interp;
    }
  }

  return { f0, hopMs: FDA_REF_HOP_MS };
}

// ---------------------------------------------------------------------------
//  Corpus loader.
// ---------------------------------------------------------------------------

function loadCorpus() {
  const corpus = [];
  for (const [gender, dir] of [["m", "rl"], ["f", "sb"]]) {
    const speakerDir = join(FDA_DIR, dir);
    if (!existsSync(speakerDir)) continue;
    const sigFiles = readdirSync(speakerDir)
      .filter((f) => f.endsWith(".sig"))
      .sort();
    for (const sigFile of sigFiles) {
      const fxFile = sigFile.replace(/\.sig$/, ".fx");
      const fxPath = join(speakerDir, fxFile);
      if (!existsSync(fxPath)) continue;
      const { samples, sampleRate } = readSig(join(speakerDir, sigFile));
      const ref = readFx(fxPath);
      // Per-track ref median for the per-track sort (low-pitch tracks
      // surface at the top).
      const voiced = [];
      for (let i = 0; i < ref.f0.length; i++) if (ref.f0[i] > 0) voiced.push(ref.f0[i]);
      voiced.sort((a, b) => a - b);
      const refMedian = voiced.length > 0 ? voiced[Math.floor(voiced.length / 2)] : NaN;
      const refP10 = voiced.length > 0 ? voiced[Math.floor(voiced.length * 0.10)] : NaN;
      corpus.push({
        speaker: dir, gender, filename: sigFile,
        samples, sampleRate, ref, refMedian, refP10,
      });
    }
  }
  return corpus;
}

// ---------------------------------------------------------------------------
//  Worker context — FDA is 20 kHz native (no resampling).
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
//  Per-track frame-by-frame matching.
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

console.log("Loading FDA corpus…");
const corpus = loadCorpus();
const fCount = corpus.filter((c) => c.gender === "f").length;
const mCount = corpus.filter((c) => c.gender === "m").length;
console.log(`  ${corpus.length} sentences (${mCount} M / ${fCount} F)`);
if (corpus.length === 0) {
  console.log("SKIP: FDA corpus is empty.");
  process.exit(0);
}

const ctx = makeWorkerCtx(20000);

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

  const errs = { m: [], f: [] };
  const errsCodet = { m: [], f: [] };
  const perTrack = [];
  let totalRefVoiced = 0;
  let totalWorkerNull = 0;

  const t0 = Date.now();
  for (const trk of corpus) {
    const stage0Mask = cell.stage === 0 ? null : stage0Masks.get(trk.filename);
    const r = evalTrack(ctx, trk.samples, trk.sampleRate, trk.ref, cell.lookback, stage0Mask);
    errs[trk.gender].push(...r.errs);
    errsCodet[trk.gender].push(...r.errsCodet);
    if (cell.stage === 0) stage0Masks.set(trk.filename, Uint8Array.from(r.detectedMask));
    totalRefVoiced += r.refVoicedFrames;
    totalWorkerNull += r.workerNullCount;
    perTrack.push({
      filename: trk.filename, speaker: trk.speaker,
      refMedian: trk.refMedian, refP10: trk.refP10,
      meanErr: r.errs.length > 0 ? r.errs.reduce((a, b) => a + b, 0) / r.errs.length : NaN,
      n: r.errs.length,
    });
  }
  const dt = ((Date.now() - t0) / 1000).toFixed(1);
  results.push({
    label: cell.label, stage: cell.stage, lookback: cell.lookback,
    fPerFrame: stats(errs.f), mPerFrame: stats(errs.m),
    fPerFrameCodet: stats(errsCodet.f), mPerFrameCodet: stats(errsCodet.m),
    perTrack,
    workerNullRate: totalRefVoiced > 0 ? totalWorkerNull / totalRefVoiced : 0,
    totalRefVoiced, totalWorkerNull,
    elapsed: dt,
  });
  console.log(
    `  [${dt}s] ${cell.label.padEnd(13)} ` +
    `M per-frame: ${fmt(stats(errs.m))}    ` +
    `F per-frame: ${fmt(stats(errs.f))}    ` +
    `null=${totalWorkerNull}/${totalRefVoiced} (${(100 * totalWorkerNull / Math.max(1, totalRefVoiced)).toFixed(1)}%)`,
  );
}

console.log("\n========== Per-frame F0 error mean by stage ==========");
console.log(`  ${"cell".padEnd(13)}  ${"M mean".padStart(8)} ${"F mean".padStart(8)} ${"M med".padStart(8)} ${"F med".padStart(8)}    null rate`);
for (const r of results) {
  console.log(
    `  ${r.label.padEnd(13)}  ${r.mPerFrame.mean.toFixed(2).padStart(8)} ${r.fPerFrame.mean.toFixed(2).padStart(8)} ` +
    `${r.mPerFrame.median.toFixed(2).padStart(8)} ${r.fPerFrame.median.toFixed(2).padStart(8)}    ${(100 * r.workerNullRate).toFixed(1)}%`,
  );
}

console.log("\n========== Δ vs Stage 0 (negative = improvement) ==========");
const s0 = results.find((r) => r.stage === 0);
for (const r of results) {
  if (r.stage === 0) continue;
  console.log(
    `  ${r.label.padEnd(13)}  ` +
    `M Δmean: ${(r.mPerFrame.mean - s0.mPerFrame.mean).toFixed(2).padStart(7)} Hz    ` +
    `F Δmean: ${(r.fPerFrame.mean - s0.fPerFrame.mean).toFixed(2).padStart(7)} Hz`,
  );
}

console.log("\n========== Co-detected fair comparison (frames where Stage 0 also detected) ==========");
console.log(`  ${"cell".padEnd(13)}  ${"M mean".padStart(8)} ${"F mean".padStart(8)} ${"M med".padStart(8)} ${"F med".padStart(8)}`);
for (const r of results) {
  const mS = r.stage === 0 ? r.mPerFrame : r.mPerFrameCodet;
  const fS = r.stage === 0 ? r.fPerFrame : r.fPerFrameCodet;
  console.log(
    `  ${r.label.padEnd(13)}  ${mS.mean.toFixed(2).padStart(8)} ${fS.mean.toFixed(2).padStart(8)} ` +
    `${mS.median.toFixed(2).padStart(8)} ${fS.median.toFixed(2).padStart(8)}`,
  );
}

// Per-track summary, sorted by ref median F0 — exposes low-pitch failures
// (RL sub-90 Hz frames) cleanly.
console.log("\n========== Per-track F0 error, sorted by ground-truth median ==========");
console.log(`  ${"file".padEnd(8)} ${"spk".padStart(3)} ${"refMed".padStart(7)} ${"refP10".padStart(7)} ${"S0 mean".padStart(8)} ${"S2L2 mean".padStart(10)} ${"S2L4 mean".padStart(10)} ${"n".padStart(5)}`);
const byTrack = new Map();
for (const r of results) {
  for (const t of r.perTrack) {
    if (!byTrack.has(t.filename)) {
      byTrack.set(t.filename, { filename: t.filename, speaker: t.speaker, refMedian: t.refMedian, refP10: t.refP10, errs: {} });
    }
    byTrack.get(t.filename).errs[r.label] = { meanErr: t.meanErr, n: t.n };
  }
}
const sorted = [...byTrack.values()].sort((a, b) => a.refMedian - b.refMedian);
for (const t of sorted) {
  const s0Err = t.errs["Stage 0"]?.meanErr ?? NaN;
  const l2Err = t.errs["Stage 2 L=2"]?.meanErr ?? NaN;
  const l4Err = t.errs["Stage 2 L=4"]?.meanErr ?? NaN;
  const n = t.errs["Stage 2 L=4"]?.n ?? 0;
  const file = t.filename.replace(/\.sig$/, "");
  console.log(
    `  ${file.padEnd(8)} ${String(t.speaker).padStart(3)} ` +
    `${t.refMedian.toFixed(1).padStart(7)} ${t.refP10.toFixed(1).padStart(7)} ` +
    `${s0Err.toFixed(2).padStart(8)} ${l2Err.toFixed(2).padStart(10)} ${l4Err.toFixed(2).padStart(10)} ${String(n).padStart(5)}`,
  );
}

console.log("\n--- BEGIN-JSON ---");
console.log(JSON.stringify(results, null, 2));
console.log("--- END-JSON ---");
