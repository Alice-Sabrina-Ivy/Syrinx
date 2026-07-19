// gender-worker.js — On-device perceived-gender classifier.
//
// Hosts a Wav2Vec2 audio-classification pipeline (Transformers.js) and
// produces a 0-100 "femininity" score from a rolling 0.75-second window
// of microphone audio. Inference runs at ~6.7 Hz (every 150 ms), gated
// by a peak-amplitude VAD to skip silent windows and EMA-smoothed across
// inferences. After a sustained run of silent inferences the EMA resets
// so a new utterance doesn't blend with a stale pre-pause value.
// Replaces the older hand-crafted vowel-normalized resonance score.
//
// Protocol:
//   main → worker: { type: "init", inputSampleRate, modelId?, diag? }
//                  { type: "audioPort", port }       MessagePort from AudioWorklet
//   worker → main: { type: "status", status, message?, modelId?, device? }
//                                                "loading"|"ready"|"error";
//                                                modelId + device populated on
//                                                "ready" so the main thread
//                                                can record which model + ORT
//                                                backend (webgpu vs wasm) won
//                  { type: "progress", loaded, total, file }
//                  { type: "score", score, confidence, ts, inferMs? }
//                  { type: "inference-event", event: "timeout", durationMs, ts }
//
// (The main thread tears workers down via Worker.terminate(); there is
// no graceful "stop" message — calls were never wired up.)
//
// `inferMs` is the wall-clock duration of the classifier(...) call only
// (no VAD gate, no EMA, no postMessage). Always populated when the
// caller passes diag:true, included in the snapshot via diag.js's
// mlInferences ring; mobile-diag-capture surfaces median/p95/p99
// for the 150 ms hop-budget check.

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

// 0.75-sec window at ~6.7 Hz design cadence. ECAPA-TDNN q8 inference
// at this window length runs ~52 ms median on desktop browser WASM
// (2026-07-19; the earlier "~190 ms desktop / ~460 ms mobile" figures
// were the retired WebGPU path). Desktop now fits the 150 ms hop
// budget (~6.2 Hz measured cadence); mobile WASM is unmeasured — the
// `inferenceInProgress` guard still drops overruns gracefully wherever
// inference exceeds the hop. Window length was re-swept 2026-07-19:
// 0.5 s is gender-asymmetric on Hillenbrand (female 89.6 %), and
// shorter windows don't reduce WASM latency anyway — keep 0.75 s.
// measurements/gender-model-latency-2026-07-19.md
const WINDOW_SECONDS = 0.75;
const WINDOW_SAMPLES = Math.floor(TARGET_SAMPLE_RATE * WINDOW_SECONDS);
const INFERENCE_INTERVAL_MS = 150;        // ~6.7 Hz emit rate
// EMA α=0.2. The previous model (prithivMLmods wav2vec2-base) had
// female-voice raw_std median 0.32, which the original α=0.55 (~270 ms
// time-constant) was too short to average out — caught and fixed in
// PR #71 with α=0.2 (~750 ms time-constant). JaesungHuh ECAPA-TDNN
// has lower per-window noise (raw_std median 0.196 female / 0.216
// male — measured on the Hillenbrand corpus 2026-05-06) so in
// principle α could be higher, but α=0.2 was empirically the best
// of {0.2, 0.4, 0.55} on the same corpus (95.6 / 95.8 vs 95.6 / 91.7
// at α≥0.4 — smoothing artifacts on borderline samples surface at
// shorter time-constants). Keep α=0.2.
const EMA_ALPHA = 0.2;                     // score smoothing
// Inference-call timeout. classifier() is normally <500 ms (desktop WebGPU
// median ~190 ms; mobile WebGPU ~460 ms). 2500 ms gives ~2× headroom over
// likely mobile p99 — well above any plausible thermal-throttled outlier,
// so timeout never fires on healthy inference. Defensive measure: when
// the underlying inference hangs (observed intermittently after the
// 3-worker concurrent boot from PR #75 — symptoms: stuck "warming up" or
// stuck on stale score), Promise.race converts the hang into a thrown
// error so the finally block releases inferenceInProgress and the next
// maybeInfer call proceeds normally. No effect when classifier() resolves
// before the timer fires.
const INFERENCE_TIMEOUT_MS = 2500;
// JaesungHuh's voice-gender-classifier (ECAPA-TDNN), q8-quantized
// ONNX export hosted under the project's HF account. ~15.4 M params
// (5-6× smaller than the previous wav2vec2-base prithivMLmods),
// gender-symmetric Hillenbrand accuracy 95.6 % (male) / 95.8 %
// (female) — vs prithivMLmods's 100 % / 81.3 %, fixing the female-
// accuracy gap that motivated the 2026-05-05 model-swap arc. Labels
// are id2label {0:male, 1:female} — opposite ordering from
// prithivMLmods's {0:female, 1:male}; femaleScoreFromResult parses
// by label name not index, so this swap is correct without other
// code changes. Mobile (Pixel 8 Pro / Chrome 147 / WebGPU): ~460 ms
// per inference, vs prithivMLmods ~2100 ms on the same device — the
// new model is ALSO faster on mobile, contrary to the platform-
// split intuition. See measurements/jaesunghuh-q8-results-
// 2026-05-06.md (investigation outcome) and CLAUDE.md "Perceived-
// voice gender model — investigation arc 2026-05-05/06" for the
// full reasoning.
const DEFAULT_MODEL_ID = "Alice-Sabrina-Ivy/voice-gender-classifier-onnx-q8";

let inputSampleRate = 48000;
let classifier = null;
let modelStatus = "idle";               // idle | loading | ready | error
let _diag = false;                      // populated by init.diag, gates inferMs reporting

const ring = new RingWindow(WINDOW_SAMPLES);

let inferenceInProgress = false;
let lastInferenceMs = 0;
let smoothedFemale = null;              // EMA over recent inferences
const silenceTracker = new SilenceTracker();

// Sentinel error class so the catch branch can distinguish a hang-induced
// timeout from a real inference error. Only timeouts get the recover-and-
// continue treatment; real errors still trip modelStatus = "error".
class InferenceTimeoutError extends Error {
  constructor(ms) {
    super(`classifier hang > ${ms}ms`);
  }
}

async function classifyWithTimeout(windowCopy) {
  let timeoutHandle;
  const timeoutPromise = new Promise((_, reject) => {
    timeoutHandle = setTimeout(
      () => reject(new InferenceTimeoutError(INFERENCE_TIMEOUT_MS)),
      INFERENCE_TIMEOUT_MS,
    );
  });
  try {
    return await Promise.race([
      classifier(windowCopy, { sampling_rate: TARGET_SAMPLE_RATE }),
      timeoutPromise,
    ]);
  } finally {
    clearTimeout(timeoutHandle);
  }
}

function status(s, message, extra) {
  modelStatus = s;
  self.postMessage({
    type: "status",
    status: s,
    ...(message ? { message } : {}),
    ...(extra ?? {}),
  });
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
  // Hop is timed START-to-start (2026-07-19; was set in the finally
  // block, i.e. end-to-start): with the hop measured from inference
  // end, the real emit period was INFERENCE_INTERVAL_MS + inferMs —
  // ~4.6 Hz at the 53 ms WASM inference instead of the design 6.7 Hz
  // that the α=0.2 EMA tuning assumed (the Hillenbrand oracle steps
  // exactly 150 ms per inference). Start-to-start restores the
  // validated cadence whenever inference fits inside the hop;
  // `inferenceInProgress` still prevents overlap when it doesn't.
  lastInferenceMs = now;
  try {
    const inferStart = _diag ? performance.now() : 0;
    const result = await classifyWithTimeout(windowCopy);
    const inferMs = _diag ? performance.now() - inferStart : null;
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
      ...(_diag ? { inferMs } : {}),
    });
  } catch (err) {
    if (err instanceof InferenceTimeoutError) {
      // Classifier hung past INFERENCE_TIMEOUT_MS. Don't trip modelStatus —
      // the worker is still functional; the next chunk will trigger a fresh
      // maybeInfer that may succeed. Surface the event to diag.errors via
      // a dedicated message type so snapshots capture hang frequency for
      // confirming H1 (WebGPU init race) from real-user data.
      self.postMessage({
        type: "inference-event",
        event: "timeout",
        durationMs: INFERENCE_TIMEOUT_MS,
        ts: performance.timeOrigin + performance.now(),
      });
    } else {
      self.postMessage({ type: "status", status: "error", message: String(err?.message || err) });
      modelStatus = "error";
    }
  } finally {
    // lastInferenceMs is NOT reset here — it was stamped at inference
    // start (hop is start-to-start; see comment above).
    inferenceInProgress = false;
  }
}

async function loadModel(modelId) {
  if (modelStatus === "loading" || modelStatus === "ready") return;
  status("loading");
  const progressCallback = (info) => {
    if (info?.status === "progress") {
      self.postMessage({
        type: "progress",
        loaded: info.loaded ?? 0,
        total: info.total ?? 0,
        file: info.file ?? "",
      });
    }
  };
  try {
    // WASM deliberately, NOT WebGPU (2026-07-19). The old webgpu-first
    // preference was measured 4-5× SLOWER than WASM for this q8 model:
    // WebGPU session creation "succeeds" but the graph throws WebGPU
    // validation errors (Invalid BindGroupLayout / Concat) and limps —
    // exactly the failure mode a try/catch fallback can't catch. Same
    // ORT version, same machine, production path: WebGPU median 249 ms
    // per inference (2.4 Hz effective meter cadence) vs WASM median
    // ~50 ms — back inside the 150 ms hop budget at the design 6.7 Hz.
    // Quantized int8 ops are a poor fit for the WebGPU EP generally;
    // revisit only with a measured win on BOTH desktop and mobile.
    // measurements/gender-model-latency-2026-07-19.md
    classifier = await pipeline("audio-classification", modelId, {
      progress_callback: progressCallback,
      dtype: "q8",
    });
    status("ready", null, { modelId, device: "wasm" });
  } catch (err) {
    status("error", String(err?.message || err));
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
      _diag = msg.diag === true;
      loadModel(msg.modelId || DEFAULT_MODEL_ID);
      break;
    case "audioPort":
      attachAudioPort(msg.port);
      break;
  }
};
