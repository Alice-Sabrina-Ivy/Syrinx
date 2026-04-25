// gender-worker.js — On-device perceived-gender classifier.
//
// Hosts a Wav2Vec2 audio-classification pipeline (Transformers.js) and
// produces a 0-100 "femininity" score from a rolling 4-second window of
// microphone audio. Inference runs at 2 Hz (every 500 ms), gated by a
// VAD threshold to skip silent windows and EMA-smoothed across inferences.
// After a sustained run of silent inferences the EMA resets so a new
// utterance doesn't blend with a stale pre-pause value. Replaces the
// older hand-crafted vowel-normalized resonance score.
//
// Protocol:
//   main → worker: { type: "init", inputSampleRate, modelId? }
//                  { type: "audioPort", port }       MessagePort from AudioWorklet
//                  { type: "stop" }
//   worker → main: { type: "status", status, message? }     "loading"|"ready"|"error"
//                  { type: "progress", loaded, total, file }
//                  { type: "score", score, confidence, ts }

import { pipeline, env } from "@huggingface/transformers";
import {
  resampleLinear,
  RingWindow,
  SilenceTracker,
  femaleScoreFromResult,
  windowPeak,
  ema,
  VAD_PEAK_THRESHOLD,
  TARGET_SAMPLE_RATE,
} from "./audio-utils.js";

// We don't ship the model in the bundle — fetch from the Hub at runtime.
env.allowRemoteModels = true;
env.allowLocalModels = false;

// 4-sec window: empirically the model is markedly more stable on >=4 sec
// of speech than on 2 sec. Combined with a 500 ms hop (overlapping
// windows) we get 2 Hz score updates with high per-frame stability.
const WINDOW_SECONDS = 4;
const WINDOW_SAMPLES = TARGET_SAMPLE_RATE * WINDOW_SECONDS;
const INFERENCE_INTERVAL_MS = 500;        // 2 Hz emit rate
const EMA_ALPHA = 0.4;                     // score smoothing
const DEFAULT_MODEL_ID = "Xenova/wav2vec2-large-xlsr-53-gender-recognition-librispeech";

let inputSampleRate = 48000;
let classifier = null;
let modelStatus = "idle";               // idle | loading | ready | error

const ring = new RingWindow(WINDOW_SAMPLES);

let inferenceInProgress = false;
let lastInferenceMs = 0;
let smoothedFemale = null;              // EMA over recent inferences
const silenceTracker = new SilenceTracker();

function status(s, message) {
  modelStatus = s;
  self.postMessage({ type: "status", status: s, ...(message ? { message } : {}) });
}

async function maybeInfer() {
  if (modelStatus !== "ready") return;
  if (inferenceInProgress) return;
  if (!ring.isFull()) return;
  const now = performance.now();
  if (now - lastInferenceMs < INFERENCE_INTERVAL_MS) return;

  const windowCopy = ring.snapshot();

  // Voice-activity gate: skip inference when the window contains no
  // speech-level peaks. Peak (not RMS) is used because at this window
  // size (4 sec) a speaker between phrases produces a low average even
  // though the speech portion is clearly voiced — RMS would falsely
  // gate. After a sustained run of silent windows, drop the EMA so a
  // resumed utterance doesn't blend with a stale pre-pause score.
  const peak = windowPeak(windowCopy);
  if (peak < VAD_PEAK_THRESHOLD) {
    if (silenceTracker.noteSilent()) smoothedFemale = null;
    lastInferenceMs = now;
    return;
  }
  silenceTracker.noteActive();

  inferenceInProgress = true;
  try {
    const result = await classifier(windowCopy, { sampling_rate: TARGET_SAMPLE_RATE });
    const female = femaleScoreFromResult(result);
    if (female == null) throw new Error("classifier returned no usable label");
    smoothedFemale = ema(smoothedFemale, female, EMA_ALPHA);
    const score = Math.max(0, Math.min(100, smoothedFemale * 100));
    const confidence = Math.abs(smoothedFemale - 0.5) * 2; // 0 at 50/50, 1 at extremes
    self.postMessage({
      type: "score",
      score,
      confidence,
      ts: performance.timeOrigin + performance.now(),
    });
  } catch (err) {
    self.postMessage({ type: "status", status: "error", message: String(err?.message || err) });
    modelStatus = "error";
  } finally {
    inferenceInProgress = false;
    lastInferenceMs = performance.now();
  }
}

async function loadModel(modelId) {
  if (modelStatus === "loading" || modelStatus === "ready") return;
  status("loading");
  try {
    classifier = await pipeline("audio-classification", modelId, {
      progress_callback: (info) => {
        if (info?.status === "progress") {
          self.postMessage({
            type: "progress",
            loaded: info.loaded ?? 0,
            total: info.total ?? 0,
            file: info.file ?? "",
          });
        }
      },
      // Prefer WebGPU when available; the runtime will fall back automatically.
      device: "webgpu",
      dtype: "q8",
    });
    status("ready");
  } catch {
    // Retry without WebGPU if that's the failure mode.
    try {
      classifier = await pipeline("audio-classification", modelId, {
        progress_callback: (info) => {
          if (info?.status === "progress") {
            self.postMessage({
              type: "progress",
              loaded: info.loaded ?? 0,
              total: info.total ?? 0,
              file: info.file ?? "",
            });
          }
        },
        dtype: "q8",
      });
      status("ready");
    } catch (err2) {
      status("error", String(err2?.message || err2));
    }
  }
}

function attachAudioPort(port) {
  port.onmessage = (e) => {
    const { buffer } = e.data;
    if (!buffer) return;
    const incoming = new Float32Array(buffer);
    const resampled = resampleLinear(incoming, inputSampleRate, TARGET_SAMPLE_RATE);
    ring.append(resampled);
    maybeInfer();
  };
}

self.onmessage = (e) => {
  const msg = e.data;
  if (!msg || !msg.type) return;
  switch (msg.type) {
    case "init":
      if (typeof msg.inputSampleRate === "number") inputSampleRate = msg.inputSampleRate;
      loadModel(msg.modelId || DEFAULT_MODEL_ID);
      break;
    case "audioPort":
      attachAudioPort(msg.port);
      break;
    case "stop":
      ring.reset();
      inferenceInProgress = false;
      smoothedFemale = null;
      silenceTracker.noteActive();   // resets the silent-run counter
      break;
  }
};
