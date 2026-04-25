// gender-worker.js — On-device perceived-gender classifier.
//
// Hosts a Wav2Vec2 audio-classification pipeline (Transformers.js) and
// produces a 0-100 "femininity" score from a rolling 1.5-second window
// of microphone audio. Inference runs at 5 Hz (every 200 ms), gated by
// a peak-amplitude VAD to skip silent windows and EMA-smoothed across
// inferences. After a sustained run of silent inferences the EMA resets
// so a new utterance doesn't blend with a stale pre-pause value.
// Replaces the older hand-crafted vowel-normalized resonance score.
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

// 1.5-sec window at 5 Hz cadence. Inference cost on Wav2Vec2 scales
// roughly linearly with input length, so a 1.5-sec window runs ~25%
// faster than the 2-sec config it replaces — that headroom is what
// lets us bump the hop from 250 ms (4 Hz) to 200 ms (5 Hz) and still
// stay under budget on a Pixel-8-class mobile CPU. The shorter window
// also halves the worst-case time between a vocal change and the
// model "seeing" the new content. EMA smoothing absorbs the per-window
// noise that a shorter window introduces. If a device can't sustain
// 5 Hz the maybeInfer() loop drops on `inferenceInProgress` so we
// degrade gracefully to whatever rate the hardware supports.
const WINDOW_SECONDS = 1.5;
const WINDOW_SAMPLES = Math.floor(TARGET_SAMPLE_RATE * WINDOW_SECONDS);
const INFERENCE_INTERVAL_MS = 200;        // 5 Hz emit rate
const EMA_ALPHA = 0.55;                    // score smoothing
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
  // speech-level peaks. Peak (not RMS) is used because in any window
  // that mixes speech with brief pauses a speaker between phrases
  // produces a low average even though the speech portion is clearly
  // voiced — RMS would falsely gate. After a sustained run of silent
  // windows, drop the EMA so a resumed utterance doesn't blend with a
  // stale pre-pause score.
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
