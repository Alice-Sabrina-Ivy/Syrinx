// gender-worker.js — On-device perceived-gender classifier.
//
// Hosts an audio-classification pipeline (Transformers.js) and produces a
// 0-100 "femininity" score from a rolling 0.75-second window of
// microphone audio. Inference runs at ~6.7 Hz (every 150 ms) on windows
// the utterance gate (utterance-gate.js) clears: recent AND voiced
// running speech, at most half pre-onset audio, never held phonation.
// Scores are EMA-smoothed within an utterance; the EMA restarts at each
// utterance onset so a new utterance never blends with the previous one
// or with the noise before it.
//
// Protocol:
//   main → worker: { type: "init", inputSampleRate, modelId?, diag? }
//                  { type: "audioPort", port }       MessagePort from AudioWorklet
//                  { type: "pitch-hint", voiced, pitch, contextTime }  relayed
//                                                per pitch frame; contextTime =
//                                                capture seconds of the frame
//   worker → main: { type: "status", status, message?, modelId?, device? }
//                                                "loading"|"ready"|"error";
//                                                modelId + device populated on
//                                                "ready" so the main thread
//                                                can record which model + ORT
//                                                backend (webgpu vs wasm) won
//                  { type: "progress", loaded, total, file }
//                  { type: "score", score, confidence, ts, inferMs? }
//                  { type: "voice-state", state, ts }  on change — what the
//                                                meter should say: "listening"
//                                                | "updating" | "scoring" |
//                                                "pause" | "sustained"
//                  { type: "inference-event", event: "timeout", durationMs, ts }
//                  { type: "speech-detector", status: "ready"|"error", message? }
//                                                the utterance gate's speech
//                                                detector (speech-detector.js);
//                                                on "error" the gate keeps
//                                                running on pitch voicing
//
// (The main thread tears workers down via Worker.terminate(); there is
// no graceful "stop" message — calls were never wired up.)
//
// `inferMs` is the wall-clock duration of the classifier(...) call only
// (no VAD gate, no EMA, no postMessage). Always populated when the
// caller passes diag:true, included in the snapshot via diag.js's
// mlInferences ring; mobile-diag-capture surfaces median/p95/p99
// for the 150 ms hop-budget check. With diag on, score messages also
// carry `vadMs`: the speech detector's run time since the previous
// posted score (the added work that shares the 150 ms hop). It is 0 while
// the detector is not live, and it accumulates over ticks that post no
// score, so the first score and the first after a pause carry more than
// one hop's worth; per-hop summaries keep back-to-back scores only.

import { pipeline, env } from "@huggingface/transformers";
// The same onnxruntime-web module instance Transformers.js runs on (it
// imports "onnxruntime-web/webgpu"), so the speech detector shares its
// WASM runtime and env (wasmPaths) instead of loading a second one.
import * as ort from "onnxruntime-web/webgpu";
import {
  createStreamingResampler,
  RingWindow,
  SilenceTracker,
  femaleScoreFromResult,
  windowPeak,
  ema,
  VAD_PEAK_THRESHOLD,
  VAD_SILENCE_FLOOR,
  TARGET_SAMPLE_RATE,
} from "./audio-utils.js";
import { createUtteranceGate, meterStateForVerdict } from "./utterance-gate.js";
import { SPEECH_DETECTOR, createSpeechFramer, createSileroRunner, loadVerifiedModel } from "./speech-detector.js";
import { pointOrtAtAppRuntime } from "./ort-runtime-files.js";

// We don't ship the model in the bundle — fetch from the Hub at runtime.
env.allowRemoteModels = true;
env.allowLocalModels = false;
// The ONNX Runtime WebAssembly runtime ships with the app (2026-10-07);
// Transformers.js points it at jsDelivr on import, so re-point it here,
// before either session is created. One env for both the voice model and
// the speech detector (same onnxruntime-web instance, see above).
// measurements/self-hosted-ort-2026-10-07.md
pointOrtAtAppRuntime(env.backends.onnx.wasm);

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
// (5-6× smaller than the previous wav2vec2-base prithivMLmods).
// "-v2" (2026-07-19): identical weights/recipe except the attentive-
// pooling matmul is EXCLUDED from quantization — a per-node
// sensitivity sweep showed that one activation×activation product
// carried ~10× the quantization error of any other node, and it was
// the whole accuracy ceiling: Hillenbrand 95.6/95.8 (v1) → 100/100
// (v2) at fp32-level per-window noise (raw_std ~0.20 → ~0.02) and
// ~46 ms browser-WASM inference. The prior "m45 is an architecture-
// independent noise floor" belief is retracted — it was quantization
// damage. Labels are id2label {0:male, 1:female} — opposite ordering
// from prithivMLmods's {0:female, 1:male}; femaleScoreFromResult
// parses by label name not index, so model swaps can't silently
// invert the meter. Decision data: measurements/
// gender-model-latency-2026-07-19.md; v1 remains published for
// reproducibility of results measured against it.
const DEFAULT_MODEL_ID = "Alice-Sabrina-Ivy/voice-gender-classifier-onnx-q8-v2";

let inputSampleRate = 48000;
// Streaming linear resampler (audio-utils createStreamingResampler —
// the same one pitch-worker.js uses since 2026-07-20): carries the
// fractional read phase + the previous chunk's last sample across
// chunks. The per-chunk resampleLinear it replaces restarted its phase
// every chunk, splicing ~2.26 input samples out of every 25 ms boundary
// at 44.1 kHz (0.18 % time compression + a waveform discontinuity per
// chunk); integer-ratio rates (48/32/96 kHz) are bit-identical either
// way. No score bias was measured, only splice jitter:
// measurements/gender-resampler-continuity-2026-10-03.md.
// Instantiated in init once inputSampleRate is known.
let resample = null;
let classifier = null;
let modelStatus = "idle";               // idle | loading | ready | error
let _diag = false;                      // populated by init.diag, gates inferMs reporting

const ring = new RingWindow(WINDOW_SAMPLES);

let inferenceInProgress = false;
let lastInferenceMs = 0;
let smoothedFemale = null;              // EMA over recent inferences
// EMA reset for the amplitude-only fallback below (pitch feed dead):
// after a sustained run of gated windows the score is treated as stale.
const silenceTracker = new SilenceTracker();
// Utterance gate (utterance-gate.js, 2026-10-07): decides from the
// relayed pitch-voicing stream which windows are scoreable, when an
// utterance starts (EMA reset), and when the voice is held phonation the
// classifier can't read. Replaces the 2026-07-19 voiced-recency gate +
// sub-75 Hz periodicity probe, which together scored 41 % of real-noise
// windows and the mostly-pre-onset first windows of every utterance:
// measurements/perceived-voice-gate-2026-10-07.md.
// The gate runs on the AUDIO clock: hints carry their frame's capture
// contextTime and "now" is the contextTime of the newest chunk in the
// window, so its timing rules can't be upset by how the hints are
// delivered (capture emits chunks in bursts, one burst per hardware
// audio frame; on wall-clock decode times, frames >= 64 ms apart kept the
// meter blank). No audio time yet = "stale" (amplitude fallback).
const gate = createUtteranceGate({ windowMs: WINDOW_SECONDS * 1000 });
let audioNowMs = null;                  // contextTime (ms) of the newest chunk
// Speech detector (speech-detector.js, low-voice-noise candidate
// "voice-detector-gate", measurements/low-voice-noise-2026-10-07.md):
// Silero VAD on the same 16 kHz stream, one probability per 32 ms frame,
// fed to the gate as noteSpeech hints on the audio clock. While it is
// live the gate asks IT whether someone is speaking; pitch voicing then
// only shapes the held-note test. Until it is loaded (or if it fails)
// the gate runs on pitch voicing alone, as before.
let speechRunner = null;
const speechFramer = createSpeechFramer();
let vadMsSinceInfer = 0;                // diag: detector time since the last inference
// Capture chunks are processed strictly in order (the detector is
// async): resample, window, detector frames -> gate, then maybeInfer, so
// every decision sees the detector frames of all audio up to "now".
let chunkChain = Promise.resolve();
let lastVoiceState = null;
let lastGateMode = null;                // "gated" | "fallback"

function postVoiceState(state) {
  if (state === lastVoiceState) return;
  lastVoiceState = state;
  self.postMessage({ type: "voice-state", state, ts: performance.timeOrigin + performance.now() });
}

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

  // Which windows get scored. Normally the utterance gate decides from
  // the relayed pitch voicing (noise-robust: the pitch worker's tonal
  // notch + harmonic voicing guard sit in front of it). The absolute
  // silence floor always applies. If the pitch feed is dead ("stale" —
  // never in normal operation; the pitch worker is pure JS and ready at
  // once) fall back to the legacy peak-amplitude VAD with its silent-run
  // EMA reset, so a broken pitch worker degrades the meter instead of
  // silencing it. Peak, not RMS: a speech-with-pauses window has a low
  // average but clearly speech-level peaks.
  const peak = windowPeak(windowCopy);
  const decision = audioNowMs === null ? { verdict: "stale", resetEma: false } : gate.decide(audioNowMs);
  const mode = decision.verdict === "stale" ? "fallback" : "gated";
  if (mode !== lastGateMode) {
    // Never carry a score across a switch between the two paths.
    smoothedFemale = null;
    lastGateMode = mode;
  }
  let score;
  if (mode === "fallback") {
    score = peak >= VAD_PEAK_THRESHOLD;
    if (score) silenceTracker.noteActive();
    else if (silenceTracker.noteSilent()) smoothedFemale = null;
    postVoiceState(score ? "scoring" : "listening");
  } else {
    score = decision.verdict === "score" && peak >= VAD_SILENCE_FLOOR;
    // Utterance onset (or the end of a held note): start a fresh EMA.
    if (decision.resetEma) smoothedFemale = null;
    postVoiceState(decision.verdict === "score" && !score ? "pause" : meterStateForVerdict(decision.verdict));
  }
  if (!score) {
    lastInferenceMs = now;
    return;
  }

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
      ...(_diag ? { inferMs, vadMs: vadMsSinceInfer } : {}),
    });
    vadMsSinceInfer = 0;
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

async function loadSpeechDetector() {
  try {
    // Cache Storage first (HF's resolve redirect is no-store and this
    // worker is recreated on every start), sha256-checked either way.
    const { bytes, source } = await loadVerifiedModel({ url: SPEECH_DETECTOR.modelUrl, sha256: SPEECH_DETECTOR.modelSha256 });
    const session = await ort.InferenceSession.create(new Uint8Array(bytes), { executionProviders: ["wasm"] });
    speechFramer.reset();
    speechRunner = createSileroRunner(ort, session);
    self.postMessage({ type: "speech-detector", status: "ready", source });
  } catch (err) {
    speechRunner = null;
    self.postMessage({ type: "speech-detector", status: "error", message: String(err?.message || err) });
  }
}

async function handleChunk(buffer, contextTime) {
  const hasTime = typeof contextTime === "number" && Number.isFinite(contextTime);
  if (hasTime) audioNowMs = contextTime * 1000;
  const x16 = resample(new Float32Array(buffer));
  ring.append(x16);
  if (speechRunner && hasTime) {
    try {
      const t0 = _diag ? performance.now() : 0;
      for (const f of speechFramer.push(x16, contextTime * 1000)) {
        gate.noteSpeech({ ts: f.ts, p: await speechRunner.run(f.input) });
      }
      if (_diag) vadMsSinceInfer += performance.now() - t0;
    } catch (err) {
      // Detector broken: stop feeding it; the gate returns to pitch
      // voicing once its speech hints are stale.
      speechRunner = null;
      self.postMessage({ type: "speech-detector", status: "error", message: String(err?.message || err) });
    }
  }
  maybeInfer();
}

function attachAudioPort(port) {
  port.onmessage = (e) => {
    const { buffer, contextTime } = e.data;
    if (!buffer || !resample) return;
    chunkChain = chunkChain.then(() => handleChunk(buffer, contextTime)).catch(() => {});
  };
}

self.onmessage = (e) => {
  const msg = e.data;
  if (!msg || !msg.type) return;
  switch (msg.type) {
    case "init":
      if (typeof msg.inputSampleRate === "number") inputSampleRate = msg.inputSampleRate;
      _diag = msg.diag === true;
      resample = createStreamingResampler(inputSampleRate, TARGET_SAMPLE_RATE);
      loadModel(msg.modelId || DEFAULT_MODEL_ID);
      loadSpeechDetector();
      break;
    case "audioPort":
      attachAudioPort(msg.port);
      break;
    case "pitch-hint":
      // Audio clock: the frame's capture time. A hint without one can't be
      // placed on the window's clock and is dropped (never in practice —
      // both capture paths stamp every chunk).
      if (typeof msg.contextTime === "number" && Number.isFinite(msg.contextTime)) {
        gate.notePitchHint({ voiced: msg.voiced, pitch: msg.pitch, ts: msg.contextTime * 1000 });
      }
      break;
  }
};
