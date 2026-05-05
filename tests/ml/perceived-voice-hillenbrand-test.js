// perceived-voice-hillenbrand-test.js — Run the production gender-detection
// pipeline on the Hillenbrand vowel corpus, concatenated per-speaker into
// realistic continuous-speech recordings (each speaker has 12 vowels ≈ 7 s
// of audio), and report:
//   - Accuracy: predicted gender vs ground truth label, per gender.
//   - Within-recording jumpiness: per-recording std of consecutive raw
//     and smoothed score deltas. Steady voice should produce a low std;
//     high std = "jumpy" UI.
//   - Aggregate raw score distribution per gender.
//
// Per-speaker concatenation rationale: individual Hillenbrand vowels are
// 0.5–0.7 s, shorter than the production 0.75 s window — the rolling-
// window pipeline never fills on a single vowel. Concatenating gives a
// realistic ~7 s same-speaker recording that exercises the rolling window
// + EMA smoothing as production does.
//
// Usage: node tests/ml/perceived-voice-hillenbrand-test.js [--alpha=N] [--window=SEC]
//
// First run downloads the model (~80 MB cached afterward).

import { pipeline, env } from "@huggingface/transformers";
import { readFileSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import {
  resampleLinear,
  RingWindow,
  femaleScoreFromResult,
  windowPeak,
  ema,
  VAD_PEAK_THRESHOLD,
  TARGET_SAMPLE_RATE,
} from "../../src/ml/audio-utils.js";

env.allowRemoteModels = true;
env.allowLocalModels = false;

const __dirname = dirname(fileURLToPath(import.meta.url));
const HILL_DIR = join(__dirname, "../dsp/data");
const MODEL_ID = "prithivMLmods/Common-Voice-Gender-Detection-ONNX";

const args = process.argv.slice(2);
const argFloat = (name, def) => {
  const a = args.find((a) => a.startsWith(`--${name}=`));
  return a ? parseFloat(a.split("=")[1]) : def;
};
const ALPHA = argFloat("alpha", 0.55);
const WINDOW_SEC = argFloat("window", 0.75);
const HOP_MS = 150;
const WINDOW_SAMPLES = Math.floor(TARGET_SAMPLE_RATE * WINDOW_SEC);

// ----- minimal WAV decoder (Hillenbrand is mono 16-bit PCM) -----
function decodeWav(buffer) {
  const view = new DataView(buffer);
  const sr = view.getUint32(24, true);
  const channels = view.getUint16(22, true);
  let pos = 12;
  while (pos < buffer.byteLength - 8) {
    const id = String.fromCharCode(view.getUint8(pos), view.getUint8(pos+1), view.getUint8(pos+2), view.getUint8(pos+3));
    const size = view.getUint32(pos + 4, true);
    if (id === "data") {
      const aligned = new ArrayBuffer(size);
      new Uint8Array(aligned).set(new Uint8Array(buffer, pos + 8, size));
      const pcm = new Int16Array(aligned);
      const out = new Float32Array(pcm.length / channels);
      for (let i = 0; i < out.length; i++) {
        let s = 0;
        for (let c = 0; c < channels; c++) s += pcm[i * channels + c];
        out[i] = (s / channels) / 32768;
      }
      return { samples: out, sampleRate: sr };
    }
    pos += 8 + size + (size & 1);
  }
  throw new Error("no data chunk");
}

function loadAudio(path) {
  const data = readFileSync(path);
  const buffer = data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength);
  const { samples, sampleRate } = decodeWav(buffer);
  return resampleLinear(samples, sampleRate, TARGET_SAMPLE_RATE);
}

// Group Hillenbrand files by speaker. Filename format: m01ae.wav, w14iy.wav,
// etc. — first 3 chars are the speaker id.
function groupBySpeaker(dir, gender) {
  const files = readdirSync(dir).filter((f) => f.endsWith(".wav")).sort();
  const speakers = new Map();
  for (const f of files) {
    const id = f.slice(0, 3);
    if (!speakers.has(id)) speakers.set(id, []);
    speakers.get(id).push(join(dir, f));
  }
  return [...speakers.entries()].map(([id, paths]) => ({ id, gender, paths }));
}

// Concatenate one speaker's vowel files into one Float32Array, with a small
// silence (50 ms) between vowels to mimic natural pauses between words.
function concatSpeaker(speaker) {
  const silenceN = Math.floor(TARGET_SAMPLE_RATE * 0.05);
  const silence = new Float32Array(silenceN);
  const buffers = [];
  let total = 0;
  for (const p of speaker.paths) {
    const s = loadAudio(p);
    buffers.push(s);
    total += s.length;
    buffers.push(silence);
    total += silenceN;
  }
  const out = new Float32Array(total);
  let off = 0;
  for (const b of buffers) { out.set(b, off); off += b.length; }
  return out;
}

async function simulatePipeline(classifier, samples) {
  const ring = new RingWindow(WINDOW_SAMPLES);
  let smoothed = null;
  let lastInferAt = -Infinity;
  const raw = [];
  const smooth = [];

  const CHUNK = 400;
  for (let pos = 0; pos < samples.length; pos += CHUNK) {
    const end = Math.min(samples.length, pos + CHUNK);
    ring.append(samples.subarray(pos, end));
    if (!ring.isFull()) continue;
    const tMs = end / TARGET_SAMPLE_RATE * 1000;
    if (tMs - lastInferAt < HOP_MS) continue;
    lastInferAt = tMs;
    const win = ring.snapshot();
    if (windowPeak(win) < VAD_PEAK_THRESHOLD) continue;
    const result = await classifier(win, { sampling_rate: TARGET_SAMPLE_RATE });
    const female = femaleScoreFromResult(result);
    if (female == null) continue;
    smoothed = ema(smoothed, female, ALPHA);
    raw.push(female);
    smooth.push(smoothed);
  }
  return { raw, smooth, finalSmoothed: smoothed };
}

function mean(a) { if (!a.length) return null; let s = 0; for (const v of a) s += v; return s / a.length; }
function std(a) {
  if (a.length < 2) return null;
  const m = mean(a);
  let s = 0;
  for (const v of a) s += (v - m) ** 2;
  return Math.sqrt(s / (a.length - 1));
}
function deltaStd(a) {
  if (a.length < 2) return null;
  const ds = [];
  for (let i = 1; i < a.length; i++) ds.push(a[i] - a[i-1]);
  return std(ds);
}
function median(a) { const s = [...a].sort((x,y)=>x-y); return s[Math.floor(s.length/2)]; }

async function main() {
  console.log(`Config: window=${WINDOW_SEC}s, hop=${HOP_MS}ms, EMA α=${ALPHA}`);
  console.log(`Loading ${MODEL_ID} (q8)…`);
  const t0 = performance.now();
  const classifier = await pipeline("audio-classification", MODEL_ID, { dtype: "q8" });
  console.log(`Model loaded in ${((performance.now() - t0) / 1000).toFixed(1)}s\n`);

  const speakers = [
    ...groupBySpeaker(join(HILL_DIR, "men"), "male"),
    ...groupBySpeaker(join(HILL_DIR, "women"), "female"),
  ];
  console.log(`Hillenbrand speakers: ${speakers.filter(s=>s.gender==="male").length} men, ${speakers.filter(s=>s.gender==="female").length} women, ${speakers.length} total\n`);

  const perSpeaker = [];
  for (let i = 0; i < speakers.length; i++) {
    const sp = speakers[i];
    const samples = concatSpeaker(sp);
    const { raw, smooth, finalSmoothed } = await simulatePipeline(classifier, samples);
    const predicted = finalSmoothed != null ? (finalSmoothed >= 0.5 ? "female" : "male") : null;
    perSpeaker.push({
      id: sp.id,
      gender: sp.gender,
      durSec: samples.length / TARGET_SAMPLE_RATE,
      windows: raw.length,
      finalSmoothed,
      predicted,
      correct: predicted === sp.gender,
      rawMean: mean(raw),
      rawStd: std(raw),
      rawDeltaStd: deltaStd(raw),
      smoothStd: std(smooth),
      smoothDeltaStd: deltaStd(smooth),
    });
    if ((i + 1) % 20 === 0) process.stdout.write(`  ${i + 1}/${speakers.length}…\n`);
  }

  console.log("\n=== Accuracy (per-speaker concat ≈ 7 s each) ===\n");
  for (const g of ["male", "female"]) {
    const subset = perSpeaker.filter((r) => r.gender === g && r.predicted != null);
    const correct = subset.filter((r) => r.correct).length;
    const fScores = subset.map((r) => r.finalSmoothed);
    console.log(`${g.padEnd(7)} n=${subset.length}  acc=${correct}/${subset.length} (${(100*correct/subset.length).toFixed(1)}%)  ` +
      `final_score: mean=${mean(fScores).toFixed(3)} std=${std(fScores).toFixed(3)}`);
  }

  console.log("\n=== Jumpiness (per-speaker frame-to-frame Δ std, smaller = steadier) ===\n");
  const allRawDelta = perSpeaker.map((r) => r.rawDeltaStd).filter(Number.isFinite);
  const allSmoothDelta = perSpeaker.map((r) => r.smoothDeltaStd).filter(Number.isFinite);
  console.log(`raw    Δ std (per-speaker mean):  ${mean(allRawDelta).toFixed(4)}  median ${median(allRawDelta).toFixed(4)}`);
  console.log(`smooth Δ std (per-speaker mean):  ${mean(allSmoothDelta).toFixed(4)}  median ${median(allSmoothDelta).toFixed(4)}`);
  console.log(`smoothing reduction:              ${(100 * (1 - mean(allSmoothDelta) / mean(allRawDelta))).toFixed(1)}%`);

  console.log("\n=== Within-speaker raw-score std (lower = more confident classifier) ===\n");
  for (const g of ["male", "female"]) {
    const subset = perSpeaker.filter((r) => r.gender === g && Number.isFinite(r.rawStd));
    const stds = subset.map((r) => r.rawStd).sort((a, b) => a - b);
    console.log(`${g.padEnd(7)} median raw_std=${stds[Math.floor(stds.length/2)].toFixed(3)}  p95=${stds[Math.floor(stds.length*0.95)].toFixed(3)}`);
  }

  // Worst-case "jumpy" speakers: top 5 by smoothed delta std
  const sortedJumpy = [...perSpeaker]
    .filter((r) => Number.isFinite(r.smoothDeltaStd))
    .sort((a, b) => b.smoothDeltaStd - a.smoothDeltaStd);
  console.log("\n=== Top 5 jumpiest speakers (smoothed Δ std) ===");
  for (const r of sortedJumpy.slice(0, 5)) {
    console.log(`  ${r.id} (${r.gender}, n_windows=${r.windows}): smoothΔstd=${r.smoothDeltaStd.toFixed(4)} rawΔstd=${r.rawDeltaStd.toFixed(4)} final=${r.finalSmoothed.toFixed(3)} ${r.correct ? "✓" : "✗"}`);
  }

  // Misclassified speakers
  const wrong = perSpeaker.filter((r) => r.predicted != null && !r.correct);
  console.log(`\n=== Misclassified speakers (${wrong.length}) ===`);
  for (const r of wrong) {
    console.log(`  ${r.id} (truth=${r.gender}, pred=${r.predicted}): final=${r.finalSmoothed.toFixed(3)}, rawMean=${r.rawMean.toFixed(3)}, rawStd=${r.rawStd?.toFixed(3) ?? "—"}`);
  }

  // Uncertainty band
  const uncertain = perSpeaker.filter((r) => r.finalSmoothed != null && r.finalSmoothed >= 0.3 && r.finalSmoothed <= 0.7);
  console.log(`\nFinal scores in uncertain band [0.3, 0.7]: ${uncertain.length}/${perSpeaker.length} (${(100*uncertain.length/perSpeaker.length).toFixed(1)}%)`);
}

main().catch((err) => { console.error(err); process.exit(1); });
