// gender-model-accuracy-test.js — End-to-end accuracy check for the
// production gender classifier. Simulates the worker's pipeline (rolling
// 4-sec window, 500 ms hop / 2 Hz, VAD gating, EMA smoothing) on real
// speech samples and reports per-file predictions + aggregate accuracy
// where ground truth is known.
//
// Usage: node tests/ml/gender-model-accuracy-test.js
//
// First run downloads ~80 MB of model weights (cached afterward).

import { pipeline, env } from "@huggingface/transformers";
import { readFileSync, readdirSync, mkdirSync, writeFileSync, existsSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import {
  resampleLinear,
  RingWindow,
  femaleScoreFromResult,
  windowRMS,
  ema,
  VAD_RMS_THRESHOLD,
  TARGET_SAMPLE_RATE,
} from "../../src/ml/audio-utils.js";

env.allowRemoteModels = true;
env.allowLocalModels = false;

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = join(__dirname, "data");
const MODEL_ID = "Xenova/wav2vec2-large-xlsr-53-gender-recognition-librispeech";

// These match src/ml/gender-worker.js. If the worker constants change,
// update here too.
const WINDOW_SECONDS = 4;
const WINDOW_SAMPLES = TARGET_SAMPLE_RATE * WINDOW_SECONDS;
const HOP_MS = 500;
const HOP_SAMPLES = Math.floor(TARGET_SAMPLE_RATE * HOP_MS / 1000);
const EMA_ALPHA = 0.4;

// Ground truth. Files marked "unknown" still get classified — their
// results print for inspection but don't count toward labeled accuracy.
const GROUND_TRUTH = {
  "jfk.wav":                              { gender: "male",    speaker: "John F. Kennedy" },
  "mlk.wav":                              { gender: "male",    speaker: "Martin Luther King Jr." },
  "hopper.wav":                           { gender: "female",  speaker: "Grace Hopper" },
  "librispeech_asr_demo_validation_0.wav":{ gender: "unknown", speaker: "LibriSpeech sample" },
  "sv_speaker-1_1.wav":                   { gender: "unknown", speaker: "SV speaker 1" },
  "sv_speaker-2_1.wav":                   { gender: "unknown", speaker: "SV speaker 2" },
  "cohere_asr-en.wav":                    { gender: "unknown", speaker: "Cohere ASR demo" },
  "courtroom.wav":                        { gender: "unknown", speaker: "courtroom (multi-speaker)" },
  "dialogue.wav":                         { gender: "unknown", speaker: "dialogue (multi-speaker)" },
  "interview.wav":                        { gender: "unknown", speaker: "interview (multi-speaker)" },
};

// ----- minimal WAV decoder (16-bit PCM and IEEE Float; mono or stereo) -----
function decodeWav(buffer) {
  const view = new DataView(buffer);
  if (
    String.fromCharCode(view.getUint8(0), view.getUint8(1), view.getUint8(2), view.getUint8(3)) !== "RIFF" ||
    String.fromCharCode(view.getUint8(8), view.getUint8(9), view.getUint8(10), view.getUint8(11)) !== "WAVE"
  ) throw new Error("not a RIFF/WAVE file");

  let pos = 12;
  let format = 0, channels = 0, sampleRate = 0, bitsPerSample = 0;
  let dataOffset = 0, dataLength = 0;
  while (pos < buffer.byteLength - 8) {
    const id = String.fromCharCode(
      view.getUint8(pos), view.getUint8(pos + 1),
      view.getUint8(pos + 2), view.getUint8(pos + 3),
    );
    const size = view.getUint32(pos + 4, true);
    if (id === "fmt ") {
      format = view.getUint16(pos + 8, true);
      channels = view.getUint16(pos + 10, true);
      sampleRate = view.getUint32(pos + 12, true);
      bitsPerSample = view.getUint16(pos + 22, true);
    } else if (id === "data") {
      dataOffset = pos + 8;
      dataLength = size;
      break;
    }
    pos += 8 + size + (size & 1);
  }
  if (!dataOffset) throw new Error("no data chunk");

  let frames;
  if (format === 1 && bitsPerSample === 16) {
    const aligned = new ArrayBuffer(dataLength);
    new Uint8Array(aligned).set(new Uint8Array(buffer, dataOffset, dataLength));
    const pcm = new Int16Array(aligned);
    frames = new Float32Array(pcm.length / channels);
    for (let i = 0; i < frames.length; i++) {
      let s = 0;
      for (let c = 0; c < channels; c++) s += pcm[i * channels + c];
      frames[i] = (s / channels) / 32768;
    }
  } else if (format === 3 && bitsPerSample === 32) {
    const aligned = new ArrayBuffer(dataLength);
    new Uint8Array(aligned).set(new Uint8Array(buffer, dataOffset, dataLength));
    const pcm = new Float32Array(aligned);
    frames = new Float32Array(pcm.length / channels);
    for (let i = 0; i < frames.length; i++) {
      let s = 0;
      for (let c = 0; c < channels; c++) s += pcm[i * channels + c];
      frames[i] = s / channels;
    }
  } else {
    throw new Error(`unsupported WAV format=${format} bits=${bitsPerSample}`);
  }
  return { samples: frames, sampleRate };
}

function loadAudio(path) {
  const data = readFileSync(path);
  const buffer = data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength);
  const { samples, sampleRate } = decodeWav(buffer);
  return resampleLinear(samples, sampleRate, TARGET_SAMPLE_RATE);
}

// Simulate the production pipeline on a single audio file: feed it in
// AudioWorklet-sized chunks (1200 samples at 48 kHz ≈ 400 at 16 kHz),
// run inference at HOP_MS cadence, gate by VAD, smooth with EMA.
async function simulatePipeline(classifier, samples) {
  const ring = new RingWindow(WINDOW_SAMPLES);
  const CHUNK = 400;                        // 25 ms @ 16 kHz
  let smoothed = null;
  let lastInferAt = -Infinity;
  const scores = [];

  for (let pos = 0; pos < samples.length; pos += CHUNK) {
    const end = Math.min(samples.length, pos + CHUNK);
    ring.append(samples.subarray(pos, end));
    if (!ring.isFull()) continue;

    // Decide if we should infer at this point. Use sample index as a
    // virtual clock at 16 kHz: each sample = 1/16000 sec.
    const tMs = (pos + (end - pos)) / TARGET_SAMPLE_RATE * 1000;
    if (tMs - lastInferAt < HOP_MS) continue;
    lastInferAt = tMs;

    const win = ring.snapshot();
    const rms = windowRMS(win);
    if (rms < VAD_RMS_THRESHOLD) continue;   // VAD: skip near-silence

    const result = await classifier(win, { sampling_rate: TARGET_SAMPLE_RATE });
    const female = femaleScoreFromResult(result);
    if (female == null) continue;
    smoothed = ema(smoothed, female, EMA_ALPHA);
    scores.push({ tMs, raw: female, smoothed });
  }
  return { smoothed, scores };
}

function fmt(n, d = 2) { return Number(n).toFixed(d); }

// Audio samples come from a public HF dataset. Auto-download on first
// run so the test is self-contained.
const DATA_BASE_URL = "https://huggingface.co/datasets/Xenova/transformers.js-docs/resolve/main/";

async function ensureTestData() {
  if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true });
  for (const name of Object.keys(GROUND_TRUTH)) {
    const path = join(DATA_DIR, name);
    if (existsSync(path)) continue;
    process.stdout.write(`Downloading ${name}…`);
    const res = await fetch(DATA_BASE_URL + name);
    if (!res.ok) throw new Error(`failed ${res.status} for ${name}`);
    const buf = Buffer.from(await res.arrayBuffer());
    writeFileSync(path, buf);
    console.log(` ${(buf.length / 1024).toFixed(0)} KB`);
  }
}

async function main() {
  await ensureTestData();
  const filesAvailable = readdirSync(DATA_DIR).filter((f) => f.endsWith(".wav"));
  const orderedFiles = Object.keys(GROUND_TRUTH).filter((f) => filesAvailable.includes(f));

  console.log(`Loading model: ${MODEL_ID}`);
  console.log("(first run will download ~80 MB; cached afterward)");
  const t0 = performance.now();
  const classifier = await pipeline("audio-classification", MODEL_ID, { dtype: "q8" });
  console.log(`Model loaded in ${fmt((performance.now() - t0) / 1000)}s\n`);

  console.log(`Pipeline: window=${WINDOW_SECONDS}s, hop=${HOP_MS}ms (${1000 / HOP_MS} Hz), EMA α=${EMA_ALPHA}, VAD rms<${VAD_RMS_THRESHOLD}\n`);

  const rows = [];
  for (const name of orderedFiles) {
    const truth = GROUND_TRUTH[name];
    const samples = loadAudio(join(DATA_DIR, name));
    const totalSec = samples.length / TARGET_SAMPLE_RATE;

    const { smoothed, scores } = await simulatePipeline(classifier, samples);
    const finalFemale = smoothed;
    const predicted = finalFemale != null ? (finalFemale >= 0.5 ? "female" : "male") : null;
    const correct = truth.gender === "unknown" ? null : (predicted === truth.gender);

    // Distribution of raw (unsmoothed) per-window scores
    const rawValues = scores.map((s) => s.raw);
    const meanRaw = rawValues.length ? rawValues.reduce((a, b) => a + b, 0) / rawValues.length : null;
    const minRaw = rawValues.length ? Math.min(...rawValues) : null;
    const maxRaw = rawValues.length ? Math.max(...rawValues) : null;

    rows.push({
      name, truth: truth.gender, speaker: truth.speaker, totalSec,
      windows: scores.length, finalFemale, predicted, correct,
      meanRaw, minRaw, maxRaw,
    });
  }

  console.log(
    "file".padEnd(42) +
    "speaker".padEnd(28) +
    "truth".padEnd(8) +
    "pred".padEnd(8) +
    "P_final  raw mean  raw range".padEnd(34) +
    "windows  ✓/✗",
  );
  console.log("-".repeat(140));
  for (const r of rows) {
    const range = r.minRaw != null
      ? `${fmt(r.minRaw)}-${fmt(r.maxRaw)}`
      : "-";
    const mark = r.correct === true ? "✓" : r.correct === false ? "✗" : "-";
    const stats = `${fmt(r.finalFemale ?? 0)}     ${fmt(r.meanRaw ?? 0)}      ${range}`.padEnd(34);
    console.log(
      r.name.padEnd(42) +
      r.speaker.padEnd(28) +
      r.truth.padEnd(8) +
      (r.predicted ?? "-").padEnd(8) +
      stats +
      String(r.windows).padEnd(9) +
      mark,
    );
  }

  const judged = rows.filter((r) => r.correct !== null);
  const correct = judged.filter((r) => r.correct).length;
  console.log("-".repeat(140));
  console.log(
    `\nLabeled accuracy: ${correct}/${judged.length}  ` +
    `(${fmt((correct / Math.max(1, judged.length)) * 100, 1)}%)`,
  );

  if (judged.length > 0 && correct < judged.length) {
    console.log(`\n${judged.length - correct} labeled file(s) misclassified.`);
    process.exit(1);
  }
  console.log("\nAll labeled files classified correctly.");
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
