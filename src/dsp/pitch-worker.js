// pitch-worker.js — On-device pitch detection via Boersma-style
// autocorrelation (Praat AC method) with a bounded-Viterbi path tracker.
//
// Replaces SwiftF0 (ONNX CNN), cut over 2026-06-09. SwiftF0 confidently
// reported 2×F0 on weak-fundamental phonation (H2 louder than H1 —
// routine in voice training): 25.6 % octave-up / 19.1 % null in the
// user's 80–110 Hz register on real session audio, vs 4.1 % / 0.4 % for
// the tuned AC detector, at corpus parity or better on two of four
// ground-truth corpora and ~25–50× less compute (0.21 ms/frame pure JS
// vs 5–11 ms browser-WASM inference). Decision data:
// measurements/swift-f0-vs-praat-sessions-2026-06-09.md,
// measurements/pitch-detector-shootout-2026-06-09.md,
// measurements/boersma-ac-tuning-2026-06-09.md.
//
// Streaming protocol (cadence unchanged from the SwiftF0 era):
//   Each capture chunk arrives at ~25 ms cadence with `contextTime`
//   (AudioContext seconds). We resample to 16 kHz via linear
//   interpolation, maintain a rolling 1280-sample (80 ms) buffer, and
//   evaluate candidates on every chunk once the buffer is full. The
//   path tracker (octave-jump + voiced/unvoiced transition costs, the
//   retired pYIN's bounded-Viterbi pattern) decodes the frame that is
//   `lookback` hops old — so each posted pitch describes audio centered
//   40 ms before the latest sample of a chunk L hops in the past
//   (~90 ms total display latency at the deployed L=2 vs SwiftF0's
//   ~56 ms; the trade for octave-flip rates at Praat parity).
//
// Protocol:
//   main → worker: { type: "init", inputSampleRate, diag? }
//                  { type: "audioPort", port }       MessagePort from captureSource
//   worker → main: { type: "status", status, message? }     "ready"|"error"
//                  { type: "pitch", pitch, confidence, voiced, ts, contextTime, inferMs? }
//
// (The main thread tears workers down via Worker.terminate(). The
// SwiftF0-era inference timeout machinery is gone — the detector is a
// synchronous pure function; there is nothing to hang.)
//
// `pitch`     — Hz, or null when the decoded frame is unvoiced
// `confidence`— [0, 1]; preserves the SwiftF0-era invariant that
//               pitch !== null ⟺ confidence ≥ 0.5, so the silence
//               gate's voicedness arm (pitchGate.js, threshold 0.5)
//               works unchanged. Derived from the decoded frame's
//               best-candidate strength vs its unvoiced strength.
// `voiced`    — pitch !== null
// `ts`        — wall-clock epoch ms when the frame was decoded
// `contextTime`— AudioContext seconds of the LATEST sample of the
//               decoded frame's chunk (i.e. the chunk L hops back —
//               the ring below carries it through the decode delay).
// `inferMs`   — candidates+decode duration, only when init.diag === true.

import {
  createBoersmaAC,
  createPathTracker,
  BOERSMA_FRAME_LENGTH_16K,
} from "./boersma-ac.js";
import { createNoiseNotch, isNearNotch } from "./noise-notch.js";

const TARGET_SAMPLE_RATE = 16000;
const FRAME_LENGTH = BOERSMA_FRAME_LENGTH_16K; // 1280 = 80 ms

let inputSampleRate = 48000;
let _diag = false;
let ready = false;

let detector = null;
let tracker = null;
// Persistent-peak tonal-interferer notch (fan hum, mains harmonics) —
// applied to the resampled stream BEFORE the analysis buffer. Tonal
// noise is the one measured pitch catastrophe (octave capture + false
// voicing); the tracker only notches narrow peaks that stay
// frequency-stable for >=5 s at ~90 % duty, which measured speech
// never does. measurements/noise-robustness-oracle-2026-07-19.md +
// noise-notch-validation section.
let noiseNotch = null;

// Rolling 16 kHz analysis buffer. Newest samples at the tail; zeros at
// the front until warm.
const buffer16k = new Float32Array(FRAME_LENGTH);
let buffer16kFill = 0;

// Per-frame metadata ring, carried through the tracker's decode delay so
// each decoded pitch is posted with ITS OWN frame's contextTime and
// strength data (not the just-arrived chunk's). Length lookback+1.
let frameMeta = [];

function status(s, message, extra) {
  self.postMessage({
    type: "status",
    status: s,
    ...(message ? { message } : {}),
    ...(extra ?? {}),
  });
}

// Linear-interpolation resampler (same as the SwiftF0-era worker and
// gender-worker; speech energy above 8 kHz is minimal and the mic chain
// already low-passes).
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

function appendToBuffer(incoming) {
  const k = incoming.length;
  if (k === 0) return;
  if (k >= FRAME_LENGTH) {
    buffer16k.set(incoming.subarray(k - FRAME_LENGTH));
    buffer16kFill = FRAME_LENGTH;
    return;
  }
  buffer16k.copyWithin(0, k, FRAME_LENGTH);
  buffer16k.set(incoming, FRAME_LENGTH - k);
  buffer16kFill = Math.min(FRAME_LENGTH, buffer16kFill + k);
}

// Map a decoded frame to the confidence value posted to the main thread.
// Preserves the SwiftF0-era invariant pitch!==null ⟺ confidence ≥ 0.5
// that the silence gate's voicedness arm depends on; the magnitude
// reflects how decisively the frame's best voiced candidate beat (or
// lost to) its unvoiced option.
function frameConfidence(voiced, meta) {
  const delta = meta ? meta.bestStrength - meta.unvoicedStrength : 0;
  const c = 0.5 + delta;
  return voiced ? Math.min(1, Math.max(0.5, c)) : Math.max(0, Math.min(0.499, c));
}

function processChunk(msg) {
  if (!ready || !msg || !msg.buffer) return;
  const incoming = new Float32Array(msg.buffer);
  if (incoming.length === 0) return;
  const t0 = _diag ? performance.now() : 0;
  appendToBuffer(noiseNotch.process(resampleLinear(incoming, inputSampleRate, TARGET_SAMPLE_RATE)));
  if (buffer16kFill < FRAME_LENGTH) return;

  const frameCandidates = detector.candidates(buffer16k);
  frameMeta.push({
    contextTime: typeof msg.contextTime === "number" ? msg.contextTime : null,
    bestStrength: frameCandidates.voiced.length > 0 ? frameCandidates.voiced[0].strength : 0,
    unvoicedStrength: frameCandidates.unvoicedStrength,
  });
  const decoded = tracker.emit(frameCandidates);
  const inferMs = _diag ? performance.now() - t0 : null;

  // Tracker warm-up: no decode for the first `lookback` frames.
  if (frameMeta.length <= tracker.config.lookback) return;
  const meta = frameMeta.shift();

  // Ghost-voicing veto: never report a pitch AT an actively-notched
  // interferer frequency (or its octave relatives) — see isNearNotch in
  // noise-notch.js. The notch removes the interferer from the analysis
  // stream, but its ringing against broadband rumble can leave weak
  // periodicity there that the Viterbi bridges into sustained voicing.
  let vetoed = decoded;
  if (vetoed > 0 && isNearNotch(vetoed, noiseNotch.activeFreqs())) vetoed = null;
  const voiced = vetoed !== null && vetoed !== undefined && vetoed > 0;
  self.postMessage({
    type: "pitch",
    pitch: voiced ? vetoed : null,
    confidence: frameConfidence(voiced, meta),
    voiced,
    ts: performance.timeOrigin + performance.now(),
    contextTime: meta.contextTime,
    ...(_diag && inferMs !== null ? { inferMs } : {}),
    // Active notch frequencies (empty ⇒ omitted, the overwhelmingly
    // common case). Not diag-gated: the main thread relays these with
    // the ML pitch-hint so the gender worker's sub-floor voicing probe
    // can exclude actively-notched interferers (audio-utils
    // subFloorVoiced). Also the notch's field-observability surface.
    ...(noiseNotch.activeFreqs().length > 0
      ? { notchedFreqs: noiseNotch.activeFreqs() }
      : {}),
  });
}

function attachAudioPort(port) {
  port.onmessage = (e) => {
    try {
      processChunk(e.data);
    } catch (err) {
      status("error", String(err?.message || err));
    }
  };
}

self.onmessage = (e) => {
  const msg = e.data;
  if (!msg || !msg.type) return;
  switch (msg.type) {
    case "init":
      if (typeof msg.inputSampleRate === "number") inputSampleRate = msg.inputSampleRate;
      _diag = msg.diag === true;
      detector = createBoersmaAC(TARGET_SAMPLE_RATE, FRAME_LENGTH);
      tracker = createPathTracker();
      noiseNotch = createNoiseNotch(TARGET_SAMPLE_RATE);
      buffer16k.fill(0);
      buffer16kFill = 0;
      frameMeta = [];
      ready = true;
      // Same "ready" shape the SwiftF0 worker posted so diag snapshots
      // keep recording which pitch backend loaded; modelUrl is null and
      // device is "js" on this pure-JS path.
      status("ready", null, {
        modelUrl: null,
        device: "js",
        detector: "boersma-ac",
        threshold: detector.config.voicingThreshold,
      });
      break;
    case "audioPort":
      attachAudioPort(msg.port);
      break;
  }
};
