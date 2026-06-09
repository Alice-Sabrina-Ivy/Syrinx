// swift-f0-null-gap-distribution.js — Distribution of interior null-gap
// runs in SwiftF0 streaming output on real recordings.
//
// Motivation (2026-06-09 pitch-gate investigation): useAudioPipeline.js
// holds the last smoothed pitch across frames where SwiftF0 reports no
// pitch (confidence < 0.5) while audio stays above the intensity gate.
// On main this hold is UNBOUNDED — sustained pitchless-but-loud audio
// (breath, fricatives, broadband noise) paints a stale flat pitch line
// indefinitely. Bounding the hold needs a number: how long do genuine
// intra-speech null runs last in production streaming mode?
//
// This harness mirrors swift-f0-streaming-verify.js's per-25 ms-hop
// streaming simulation, records the voiced/null sequence per track, and
// measures maximal runs of consecutive null frames that have voiced
// frames on BOTH sides ("interior runs" — leading/trailing silence is
// excluded since the production silence gate owns that regime).
// Reports per-corpus run-length percentiles and the fraction of runs
// bridged at candidate hold bounds.
//
// Interpretation caveat: corpus recordings include inter-sentence
// pauses, which in production are mostly intensity-quiet and handled by
// the silence gate, not the hold. The interior-run distribution
// therefore OVERESTIMATES what the hold must bridge — a bound that
// covers the consonant-scale mode of the distribution is sufficient.
//
// Usage: node tests/dsp/swift-f0-null-gap-distribution.js

import { writeFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import { loadAllCorpora } from "./data/corpora.js";
import {
  createSwiftF0Session,
  resampleLinear,
  SWIFT_F0_SAMPLE_RATE,
  SWIFT_F0_FRAME_LENGTH,
} from "./swift-f0-adapter.js";
import * as ort from "onnxruntime-node";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "../..");

// Match production CONFIDENCE_THRESHOLD (= 0.5, see useAudioPipeline.js).
const CONFIDENCE_THRESHOLD = 0.5;

// Candidate hold bounds to evaluate (ms).
const CANDIDATE_BOUNDS_MS = [100, 200, 300, 500, 1000];

// Streaming simulation — same as swift-f0-streaming-verify.js.
class StreamingPitch {
  constructor(session) {
    this.session = session;
    this.inputName = session.inputNames[0];
    this.buffer = new Float32Array(SWIFT_F0_FRAME_LENGTH);
    this.fill = 0;
  }
  reset() {
    this.buffer.fill(0);
    this.fill = 0;
  }
  appendToBuffer(incoming) {
    const k = incoming.length;
    if (k === 0) return;
    if (k >= SWIFT_F0_FRAME_LENGTH) {
      this.buffer.set(incoming.subarray(k - SWIFT_F0_FRAME_LENGTH));
      this.fill = SWIFT_F0_FRAME_LENGTH;
      return;
    }
    this.buffer.copyWithin(0, k, SWIFT_F0_FRAME_LENGTH);
    this.buffer.set(incoming, SWIFT_F0_FRAME_LENGTH - k);
    this.fill = Math.min(SWIFT_F0_FRAME_LENGTH, this.fill + k);
  }
  async inferIfReady() {
    if (this.fill < SWIFT_F0_FRAME_LENGTH) return null;
    const tensor = new ort.Tensor("float32", this.buffer, [1, SWIFT_F0_FRAME_LENGTH]);
    const outputs = await this.session.run({ [this.inputName]: tensor });
    const conf = outputs[this.session.outputNames[1]].data[0];
    return { voiced: conf >= CONFIDENCE_THRESHOLD };
  }
}

// Collect interior null runs (frames) from one track's voiced sequence.
function interiorNullRuns(voicedSeq) {
  const runs = [];
  let firstVoiced = voicedSeq.indexOf(true);
  let lastVoiced = voicedSeq.lastIndexOf(true);
  if (firstVoiced < 0 || lastVoiced <= firstVoiced) return runs;
  let runLen = 0;
  for (let i = firstVoiced; i <= lastVoiced; i++) {
    if (voicedSeq[i]) {
      if (runLen > 0) runs.push(runLen);
      runLen = 0;
    } else {
      runLen++;
    }
  }
  return runs;
}

function percentile(sortedArr, p) {
  if (sortedArr.length === 0) return null;
  const idx = Math.min(
    sortedArr.length - 1,
    Math.ceil((p / 100) * sortedArr.length) - 1,
  );
  return sortedArr[Math.max(0, idx)];
}

console.log("Loading SwiftF0 model …");
const { session } = await createSwiftF0Session();
const stream = new StreamingPitch(session);

console.log("Loading all corpora …");
const corpora = loadAllCorpora();
const counts = {};
for (const t of corpora) counts[t.corpus] = (counts[t.corpus] || 0) + 1;
console.log("  corpus track counts:", counts);
if (corpora.length === 0) { console.log("SKIP: no corpora available."); process.exit(0); }

// corpus → { runsFrames: number[], hopMsSum, trackCount }
const perCorpus = new Map();

const t0 = Date.now();
let processed = 0;
for (const track of corpora) {
  stream.reset();
  const { samples, sampleRate } = track;
  const hopN = Math.floor(sampleRate * 25 / 1000);
  const hopMs = hopN * 1000 / sampleRate;
  const voicedSeq = [];
  for (let i = 0; i + hopN <= samples.length; i += hopN) {
    const chunk = samples.subarray(i, i + hopN);
    const resampled = resampleLinear(chunk, sampleRate, SWIFT_F0_SAMPLE_RATE);
    stream.appendToBuffer(resampled);
    const out = await stream.inferIfReady();
    if (!out) continue;
    voicedSeq.push(out.voiced);
  }
  let acc = perCorpus.get(track.corpus);
  if (!acc) {
    acc = { runsFrames: [], hopMsSum: 0, trackCount: 0 };
    perCorpus.set(track.corpus, acc);
  }
  acc.runsFrames.push(...interiorNullRuns(voicedSeq));
  acc.hopMsSum += hopMs;
  acc.trackCount++;
  processed++;
  if (processed % 200 === 0) console.log(`  ${processed}/${corpora.length} tracks (${((Date.now() - t0)/1000).toFixed(1)} s)`);
}
console.log(`Done in ${((Date.now() - t0) / 1000).toFixed(1)} s\n`);

console.log("========== Interior null-run distribution (production streaming, conf<0.5) ==========");
console.log("  Runs with voiced frames on both sides; lengths in frames (1 frame ≈ 25 ms).\n");

const jsonPerCorpus = {};
for (const [corpus, acc] of perCorpus.entries()) {
  const hopMs = acc.hopMsSum / acc.trackCount;
  const sorted = [...acc.runsFrames].sort((a, b) => a - b);
  const n = sorted.length;
  const toMs = (frames) => frames === null ? null : frames * hopMs;
  const pcts = {};
  for (const p of [50, 75, 90, 95, 99]) pcts[`p${p}`] = percentile(sorted, p);
  const bounds = {};
  for (const b of CANDIDATE_BOUNDS_MS) {
    const bridged = sorted.filter((f) => f * hopMs <= b).length;
    bounds[`${b}ms`] = n > 0 ? bridged / n : null;
  }
  console.log(`  ${corpus} — ${n} interior runs across ${acc.trackCount} tracks`);
  if (n > 0) {
    console.log(
      `    frames: p50=${pcts.p50} p75=${pcts.p75} p90=${pcts.p90} p95=${pcts.p95} p99=${pcts.p99} max=${sorted[n - 1]}`,
    );
    console.log(
      `    ms:     p50=${toMs(pcts.p50).toFixed(0)} p75=${toMs(pcts.p75).toFixed(0)} p90=${toMs(pcts.p90).toFixed(0)} p95=${toMs(pcts.p95).toFixed(0)} p99=${toMs(pcts.p99).toFixed(0)} max=${toMs(sorted[n - 1]).toFixed(0)}`,
    );
    const fmt = CANDIDATE_BOUNDS_MS
      .map((b) => `≤${b}ms: ${(bounds[`${b}ms`] * 100).toFixed(1)}%`)
      .join("  ");
    console.log(`    bridged at bound — ${fmt}`);
  }
  console.log("");
  jsonPerCorpus[corpus] = {
    interiorRunCount: n,
    trackCount: acc.trackCount,
    hopMs,
    percentilesFrames: pcts,
    maxFrames: n > 0 ? sorted[n - 1] : null,
    bridgedFractionAtBound: bounds,
  };
}

const jsonOut = {
  generatedAt: new Date().toISOString(),
  confidenceThreshold: CONFIDENCE_THRESHOLD,
  candidateBoundsMs: CANDIDATE_BOUNDS_MS,
  corpora: counts,
  perCorpus: jsonPerCorpus,
};
const jsonPath = join(ROOT, "measurements", "swift-f0-null-gap-distribution-2026-06-09.json");
writeFileSync(jsonPath, JSON.stringify(jsonOut, null, 2));
console.log(`JSON saved to: ${jsonPath}`);
