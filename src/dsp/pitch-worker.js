// pitch-worker.js — On-device pitch detection via SwiftF0.
//
// Hosts an ONNX Runtime Web inference session for the SwiftF0 model
// (lars76/swift-f0, MIT, ~388 KB ONNX, 95 K-param CNN that operates on
// 1024-sample (64 ms) windows of 16 kHz mono audio). Replaces pYIN, which
// previously lived in dsp-worker.js and produced both pitch and a HMM-
// smoothed voicedness posterior. This worker emits pitch + a confidence
// signal; consumers (useAudioPipeline.js) use confidence as the upstream
// "voicedness" signal in the silence gate, since pYIN's voicedness was
// purpose-built for the same question and SwiftF0's confidence is its
// direct semantic replacement.
//
// Stage 4 integration of the SwiftF0 investigation arc — see
// measurements/swift-f0-stage3-validation-2026-05-06.md and
// measurements/swift-f0-stage3-4-3-5-validation-2026-05-06.md for the
// validation that motivated the cutover.
//
// Streaming protocol:
//   Each capture chunk arrives at ~25 ms cadence with `contextTime`
//   (AudioContext seconds). We resample to 16 kHz via linear interpolation,
//   maintain a rolling 1024-sample buffer, and run inference on every
//   chunk once the buffer is full. SwiftF0's STFT-based architecture
//   handles a 1024-sample input as one frame whose center sits at sample
//   127.5 (~7.97 ms into the buffer). The reported pitch corresponds to
//   the audio centered at that sample position; with our rolling buffer,
//   that's roughly 56 ms before the latest captured sample.
//
// Inference cadence: per-hop. Each capture chunk → one inference → one
// pitch frame. Validated as fitting the 25 ms hop budget on Pixel 8 Pro
// Chrome 147 (5.0 ms median, 5.4 ms p95) in Stage 3.5.
//
// Confidence threshold 0.5: validated in Stage 3.4 as the operating point
// that balances null rate (~6.8 % worst-case) against octave-error rate
// (~1.7 % worst-case, still better than pYIN's 2.3 % baseline). pitch is
// reported as null when confidence < 0.5; consumers treat null pitch as
// "no usable pitch this frame."
//
// Protocol:
//   main → worker: { type: "init", inputSampleRate, modelUrl?, diag? }
//                  { type: "audioPort", port }       MessagePort from captureSource
//   worker → main: { type: "status", status, message? }     "loading"|"ready"|"error"
//                  { type: "pitch", pitch, confidence, voiced, ts, contextTime, inferMs? }
//                  { type: "inference-event", event: "timeout", durationMs, ts }
//
// (The main thread tears workers down via Worker.terminate(); there is
// no graceful "stop" message — calls were never wired up.)
//
// `pitch`     — Hz, or null when confidence < 0.5
// `confidence`— SwiftF0's raw output, [0, 1]
// `voiced`    — confidence >= CONFIDENCE_THRESHOLD (boolean)
// `ts`        — wall-clock epoch ms when inference completed
// `contextTime`— AudioContext.currentTime (seconds) at the moment the
//               *latest* sample in the inference buffer was captured.
//               Combined with audioOriginEpochMs in the main thread to
//               reconstruct the audio-clock timestamp for merging with
//               DSP analysis frames.
// `inferMs`   — wall-clock duration of the session.run() call, only when
//               init.diag === true. Surfaced in the diag overlay.

import * as ort from "onnxruntime-web";

// Confidence threshold — validated in Stage 3.4 (see measurements/
// swift-f0-stage3-4-3-5-validation-2026-05-06.md). The same value gates
// pitch reporting AND seeds the upstream "voiced" boolean for the silence
// gate, by design — keeping a single threshold value means producing a
// non-null pitch and being "voiced enough for the gate to trust" are the
// same condition, and there's no ambiguous middle band.
const CONFIDENCE_THRESHOLD = 0.5;

// Inference-call timeout. session.run() typically takes ~5–11 ms on
// browser ORT-WASM (Stage 3.5 measurement). 1500 ms is ~150× p95 — well
// above any plausible thermal-throttled outlier on mobile, so the timeout
// never fires on healthy inference. Defensive measure mirroring the
// gender-worker fix: if ORT hangs (e.g. pathological model state, GPU
// driver lockup if WebGPU is ever enabled here), Promise.race converts
// the hang into a recoverable error so the next chunk's inference can
// proceed normally instead of freezing the silence gate's confidence
// signal at a stale value.
const INFERENCE_TIMEOUT_MS = 1500;

// Model parameters (constants, must match swift_f0/core.py).
const TARGET_SAMPLE_RATE = 16000;
const FRAME_LENGTH = 1024;
const HOP_LENGTH = 256;

let inputSampleRate = 48000;
let modelUrl = null;
let session = null;
let modelStatus = "idle";    // idle | loading | ready | error
let _diag = false;

// Rolling 16 kHz buffer (FRAME_LENGTH samples). We drop the oldest samples
// as new ones arrive — when the buffer is full, every chunk produces one
// inference call.
const buffer16k = new Float32Array(FRAME_LENGTH);
let buffer16kFill = 0;       // how many valid samples are in the buffer

// AudioContext-time of the LATEST sample currently sitting in the buffer.
// Combined with audioOriginEpochMs (in the main thread) to reconstruct
// when the analyzed audio was captured.
let lastSampleContextTimeSec = null;

// Inference state
let inferenceInProgress = false;

// Sentinel error class so the catch branch can distinguish a hang-induced
// timeout from a real inference error. Mirrors the gender-worker pattern.
class InferenceTimeoutError extends Error {
  constructor(ms) {
    super(`session.run hang > ${ms}ms`);
  }
}

async function runWithTimeout(feeds) {
  let timeoutHandle;
  const timeoutPromise = new Promise((_, reject) => {
    timeoutHandle = setTimeout(
      () => reject(new InferenceTimeoutError(INFERENCE_TIMEOUT_MS)),
      INFERENCE_TIMEOUT_MS,
    );
  });
  try {
    return await Promise.race([session.run(feeds), timeoutPromise]);
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

// Linear-interpolation resampler. Mirrors gender-worker / SwiftF0 adapter
// pattern. Speech energy above 8 kHz is minimal and the production mic
// chain already low-passes; a polyphase FIR is unnecessary here.
function resampleLinear(samples, srIn, srOut) {
  if (srIn === srOut) return samples;
  const ratio = srOut / srIn;
  const n = Math.floor(samples.length * ratio);
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const srcF = i / ratio;
    const i0 = Math.floor(srcF);
    const i1 = Math.min(i0 + 1, samples.length - 1);
    const t = srcF - i0;
    out[i] = samples[i0] * (1 - t) + samples[i1] * t;
  }
  return out;
}

// Append samples to the rolling buffer. After the call, the buffer holds
// the most recent FRAME_LENGTH samples (or fewer if not yet warmed up,
// in which case they sit at the END of the buffer with zeros at the
// front). This convention means inference always sees the most-recent
// audio at samples [FRAME_LENGTH - buffer16kFill, FRAME_LENGTH).
function appendToBuffer(incoming) {
  const k = incoming.length;
  if (k === 0) return;
  if (k >= FRAME_LENGTH) {
    // New chunk alone exceeds the window — keep only its tail.
    buffer16k.set(incoming.subarray(k - FRAME_LENGTH));
    buffer16kFill = FRAME_LENGTH;
    return;
  }
  // Shift existing samples left by k positions, dropping the oldest k
  // (or up to FRAME_LENGTH - k if we have fewer to begin with). Source
  // span: [k, FRAME_LENGTH); destination [0, FRAME_LENGTH - k).
  buffer16k.copyWithin(0, k, FRAME_LENGTH);
  // Place the new samples at the tail.
  buffer16k.set(incoming, FRAME_LENGTH - k);
  buffer16kFill = Math.min(FRAME_LENGTH, buffer16kFill + k);
}

async function maybeInfer() {
  if (modelStatus !== "ready") return;
  if (inferenceInProgress) return;
  if (buffer16kFill < FRAME_LENGTH) return;

  inferenceInProgress = true;
  try {
    const inferStart = _diag ? performance.now() : 0;
    // Construct tensor view onto the rolling buffer. ORT clones the data
    // into the tensor backing store, so we don't need a fresh array.
    const tensor = new ort.Tensor("float32", buffer16k, [1, FRAME_LENGTH]);
    const outputs = await runWithTimeout({ [session.inputNames[0]]: tensor });
    const inferMs = _diag ? performance.now() - inferStart : null;

    const pitchOut = outputs[session.outputNames[0]];
    const confOut = outputs[session.outputNames[1]];
    if (!pitchOut || !confOut) throw new Error("SwiftF0 returned unexpected outputs");

    // Single-frame inference: take the first (and only) frame.
    // Outputs come back as Float32Array with shape [1, n_frames].
    const pitchHz = pitchOut.data[0];
    const confidence = confOut.data[0];

    const voiced = confidence >= CONFIDENCE_THRESHOLD;
    const reportedPitch = voiced ? pitchHz : null;

    self.postMessage({
      type: "pitch",
      pitch: reportedPitch,
      confidence,
      voiced,
      ts: performance.timeOrigin + performance.now(),
      contextTime: lastSampleContextTimeSec,
      ...(_diag && inferMs !== null ? { inferMs } : {}),
    });
  } catch (err) {
    if (err instanceof InferenceTimeoutError) {
      // ORT hung past INFERENCE_TIMEOUT_MS. Don't trip modelStatus — the
      // worker is still functional; the next chunk will trigger a fresh
      // maybeInfer that may succeed. Emit a diagnostic event so snapshots
      // record hang frequency. The silence gate will see a stale
      // confidence value for ~1.5 s but recovers as soon as inference
      // completes again.
      self.postMessage({
        type: "inference-event",
        event: "timeout",
        durationMs: INFERENCE_TIMEOUT_MS,
        ts: performance.timeOrigin + performance.now(),
      });
    } else {
      self.postMessage({
        type: "status",
        status: "error",
        message: String(err?.message || err),
      });
      modelStatus = "error";
    }
  } finally {
    inferenceInProgress = false;
  }
}

async function loadModel(url) {
  if (modelStatus === "loading" || modelStatus === "ready") return;
  status("loading");
  try {
    // ORT WASM bundle imports its own WASM file from the npm package. Vite
    // bundles the loader; the WASM file itself is served alongside via the
    // bundle.min.mjs's relative-import mechanism. Single-threaded since
    // SwiftF0's 95 K params don't benefit from threading and the per-hop
    // inference sits well under budget already.
    ort.env.wasm.numThreads = 1;
    ort.env.wasm.simd = true;

    // Fetch model bytes from the in-repo location (public/swift-f0/model.onnx).
    const r = await fetch(url);
    if (!r.ok) throw new Error(`SwiftF0 model fetch failed: ${r.status}`);
    const modelBytes = await r.arrayBuffer();

    session = await ort.InferenceSession.create(modelBytes, {
      executionProviders: ["wasm"],
      graphOptimizationLevel: "all",
    });
    status("ready", null, {
      modelUrl: url,
      device: "wasm",
      threshold: CONFIDENCE_THRESHOLD,
    });
  } catch (err) {
    status("error", String(err?.message || err));
  }
}

function attachAudioPort(port) {
  port.onmessage = (e) => {
    const msg = e.data;
    if (!msg || !msg.buffer) return;
    const incoming = new Float32Array(msg.buffer);
    if (incoming.length === 0) return;
    const resampled = resampleLinear(incoming, inputSampleRate, TARGET_SAMPLE_RATE);
    appendToBuffer(resampled);
    // contextTime in the chunk message = AudioContext seconds at the
    // moment the LATEST sample in this chunk was captured (per
    // captureSource.js's chunk semantics). Track it so the inference
    // postMessage can stamp its own audio-clock timestamp.
    if (typeof msg.contextTime === "number") {
      lastSampleContextTimeSec = msg.contextTime;
    }
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
      modelUrl = msg.modelUrl || null;
      if (!modelUrl) {
        status("error", "modelUrl missing in init");
        return;
      }
      loadModel(modelUrl);
      break;
    case "audioPort":
      attachAudioPort(msg.port);
      break;
  }
};
