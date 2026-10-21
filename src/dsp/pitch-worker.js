// pitch-worker.js — On-device pitch detection via Boersma-style
// autocorrelation (Praat AC method) with a bounded-Viterbi path tracker.
//
// Replaces SwiftF0 (ONNX CNN), cut over 2026-06-09. SwiftF0 confidently
// reported 2×F0 on weak-fundamental phonation (H2 louder than H1 —
// routine in voice training) in the 80–110 Hz low register on real
// session audio, far more often than the tuned AC detector (private
// measurement), at corpus parity or better on two of four
// ground-truth corpora and ~25–50× less compute (0.21 ms/frame pure JS
// vs 5–11 ms browser-WASM inference). Decision data:
// measurements/boersma-ac-tuning-2026-06-09.md (the 2026-06-09 session
// comparison and detector shootout are private measurements, kept outside
// this repo).
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
//   main → worker: { type: "init", inputSampleRate, diag?, vad? }
//                  { type: "audioPort", port }       MessagePort from captureSource
//   worker → main: { type: "status", status, message? }     "ready"|"error"
//                  { type: "pitch", pitch, confidence, voiced, ts, contextTime, inferMs?, vad?, vadMs? }
//                  { type: "vad-status", status, message? } (try-out detector, below)
//
// TRY-OUT voice detector (branch noise-detector-tryout, 2026-10-20;
// src/dsp/firered-vad.js, measurements/noise-detector-tryout-2026-10-20.md).
// Only when init carries `vad: { modelBase }` (the app does; the Node
// harnesses that drive this worker do not, and then nothing below runs and
// the worker is exactly as before). FireRedVAD runs on this worker's own
// 16 kHz stream (the resampler's output, before the notch), hop by hop, so
// the decision for the pitch message of chunk k is computed from the audio up
// to the end of chunk k — the alignment the 2026-10-20 screen scored. Each
// pitch message then carries `vad: { p, voice }` (p = smoothed score at the
// hop; voice = the R1 h decision). The main thread hides the pitch display
// when voice is false and the user's setting is on; every other consumer
// (DSP / ML / resonance hints, heard-as, pitch-only warning) gets the
// posted pitch unchanged. While the model loads, or if it is missing,
// messages carry no `vad` (not gated). The model runs through
// onnxruntime-web (asynchronous), so once it is ready chunks are processed
// through a promise chain that keeps them in order; if that chain falls
// VAD_MAX_QUEUE chunks behind, the detector switches itself off ("slow")
// rather than delay the pitch display.
//
// (The main thread tears workers down via Worker.terminate(). The
// SwiftF0-era inference timeout machinery is gone — the detector is a
// synchronous pure function; there is nothing to hang.)
//
// `pitch`     — Hz, or null when the decoded frame is unvoiced OR decodes
//               above PITCH_DISPLAY_RANGE.high (see processChunk)
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
  createHarmonicVoicingGuard,
  BOERSMA_FRAME_LENGTH_16K,
} from "./boersma-ac.js";
import { createNoiseNotch, isNearNotch } from "./noise-notch.js";
import { createStreamingResampler } from "../ml/audio-utils.js";
import { PITCH_DISPLAY_RANGE } from "../utils/constants.js";
import { FIRERED_MODEL, createVoiceDetector, createFireRedRunner, parseKaldiCmvn, loadVerified } from "./firered-vad.js";

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
// Harmonic-structure voicing guard (SWIPE-flavored; see
// createHarmonicVoicingGuard in boersma-ac.js). Vetoes sustained
// voicing whose spectrum lacks >=2 harmonics of the decoded F0 — the
// noise class that survives the notch (broadband shaped through the
// pitch band, e.g. "white noise" videos through speaker/room
// resonances). Debounced so transient weak speech frames pass.
let harmonicGuard = null;
// Delay line of analysis-buffer copies so the guard evaluates the
// DECODED frame's audio (the tracker delays decoding by L hops).
let bufferDelayLine = [];

// Rolling 16 kHz analysis buffer. Newest samples at the tail; zeros at
// the front until warm.
const buffer16k = new Float32Array(FRAME_LENGTH);
let buffer16kFill = 0;

// Per-frame metadata ring, carried through the tracker's decode delay so
// each decoded pitch is posted with ITS OWN frame's contextTime and
// strength data (not the just-arrived chunk's). Length lookback+1.
let frameMeta = [];

// Try-out voice detector state (see the header). vadDetector exists from init
// (its front end runs from the first sample) until the model is found to be
// missing / broken / too slow; vadQueue is the in-order chain used once the
// model is ready.
let vadDetector = null;
let vadQueue = null;
let vadQueued = 0;
let vadGen = 0;
let streamSamplesIn = 0;      // input samples since init: hop time = samplesIn / inputSampleRate
const VAD_MAX_QUEUE = 20;     // 0.5 s of chunks waiting

function vadStatus(s, message) {
  self.postMessage({ type: "vad-status", status: s, ...(message ? { message } : {}) });
}

async function loadVad(cfg, gen) {
  vadStatus("loading");
  try {
    const base = String(cfg.modelBase);
    const [onnxSpec, cmvnSpec] = ["onnx", "cmvn"].map((k) => FIRERED_MODEL.files.find((f) => f.key === k));
    const [onnxBytes, cmvnBytes] = await Promise.all([loadVerified(base + onnxSpec.name, onnxSpec), loadVerified(base + cmvnSpec.name, cmvnSpec)]);
    const cmvn = parseKaldiCmvn(cmvnBytes);
    // onnxruntime-web's WASM build and the app's own copy of its plain
    // runtime file (shipped since 2026-10-07 for Safari; src/ml/
    // ort-runtime-files.js) — no new download source. Imported here so the
    // Node harnesses that load this worker never touch them.
    const [ort, files, paths] = await Promise.all([
      import("onnxruntime-web/wasm"),
      import("../ml/ort-runtime-files.js"),
      import("../ml/ort-wasm-paths.js"),
    ]);
    ort.env.wasm.numThreads = 1;
    ort.env.wasm.wasmPaths = paths.selfHostedWasmPaths({ wasm: paths.ORT_RUNTIME_VARIANTS.plain.wasm }, files.ORT_RUNTIME_URLS);
    const session = await ort.InferenceSession.create(onnxBytes, { executionProviders: ["wasm"] });
    if (gen !== vadGen || !vadDetector) return;
    vadDetector.setModel({ runner: createFireRedRunner(ort, session), cmvn });
    vadStatus("ready");
  } catch (err) {
    if (gen !== vadGen) return;
    vadDetector = null;
    vadStatus(err?.code === "missing" ? "missing" : "error", String(err?.message || err));
  }
}

function status(s, message, extra) {
  self.postMessage({
    type: "status",
    status: s,
    ...(message ? { message } : {}),
    ...(extra ?? {}),
  });
}

// Streaming linear resampler (audio-utils createStreamingResampler,
// 2026-07-20): carries fractional phase + the previous chunk's last
// sample across chunks. The old per-chunk resampleLinear restarted its
// phase every 25 ms, splicing ~0.8 source samples out of every chunk
// boundary at 44.1 kHz — a measured +0.094 % (~1.6 cent) pitch bias.
// Instantiated in init once inputSampleRate is known.
let resample = null;

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

// One capture chunk -> { out: the pitch message to post (or null), t: the
// hop's stream time (s), vadMs } ; null when the chunk is not a hop.
function processChunk(msg) {
  if (!ready || !msg || !msg.buffer) return null;
  const incoming = new Float32Array(msg.buffer);
  if (incoming.length === 0) return null;
  streamSamplesIn += incoming.length;
  const hop = { out: null, t: streamSamplesIn / inputSampleRate, vadMs: 0 };
  const t0 = _diag ? performance.now() : 0;
  const x16 = resample(incoming);
  if (vadDetector) {
    const v0 = _diag ? performance.now() : 0;
    vadDetector.pushAudio(x16); // copies the samples before the notch below runs
    if (_diag) hop.vadMs += performance.now() - v0;
  }
  appendToBuffer(noiseNotch.process(x16));
  if (buffer16kFill < FRAME_LENGTH) return hop;

  const frameCandidates = detector.candidates(buffer16k);
  frameMeta.push({
    contextTime: typeof msg.contextTime === "number" ? msg.contextTime : null,
    bestStrength: frameCandidates.voiced.length > 0 ? frameCandidates.voiced[0].strength : 0,
    unvoicedStrength: frameCandidates.unvoicedStrength,
  });
  bufferDelayLine.push(Float32Array.from(buffer16k));
  if (bufferDelayLine.length > tracker.config.lookback + 1) bufferDelayLine.shift();
  const decoded = tracker.emit(frameCandidates);
  // (the voice detector's front end above is timed separately, in vadMs)
  const inferMs = _diag ? performance.now() - t0 - hop.vadMs : null;

  // Tracker warm-up: no decode for the first `lookback` frames.
  if (frameMeta.length <= tracker.config.lookback) return hop;
  const meta = frameMeta.shift();

  // Ghost-voicing veto: never report a pitch AT an actively-notched
  // interferer line (or its octave) — see isNearNotch in noise-notch.js.
  // The notch rarely removes an interferer completely (unpromoted
  // harmonics, wobble outside the notch, rumble), and the residual is
  // still periodic at the line frequency. Narrow (+-2 %, widened only for
  // wobbling lines) since 2026-10-03: the old +-4 % window around f/2, f
  // and 2f blanked real voice across whole registers.
  let vetoed = decoded;
  if (vetoed > 0 && isNearNotch(vetoed, noiseNotch.activeLines())) vetoed = null;
  // Above the display range: post as UNVOICED. The detector searches to
  // 2x the display ceiling (boersma-ac.js maxPitchHz 800) precisely so
  // that phonation above 400 Hz decodes at its true F0 here instead of
  // aliasing to a confident half-pitch value inside the display range
  // (2026-10-03: with the old 400 Hz search ceiling a large share of such
  // frames on the private session recordings painted at half). Applied
  // BEFORE the harmonic guard so these frames never advance its fail
  // streak (posting them after the guard let spurious high decodes build
  // a streak that then vetoed correct low-voice frames: PTDB male
  // -0.8 pp). Unvoiced keeps the pitch !== null <=> confidence >= 0.5
  // invariant (frameConfidence below) and every consumer's range assumption (trace, readout,
  // session stats, formant/ML hints) unchanged.
  // measurements/pitch-ceiling-2026-10-03.md
  if (vetoed > PITCH_DISPLAY_RANGE.high) vetoed = null;
  // Harmonic-structure guard on the decoded frame's own audio (delay
  // line front = the frame L hops back).
  if (vetoed > 0 && !harmonicGuard.check(bufferDelayLine[0], vetoed, TARGET_SAMPLE_RATE)) {
    vetoed = null;
  }
  const voiced = vetoed !== null && vetoed !== undefined && vetoed > 0;
  hop.out = {
    type: "pitch",
    pitch: voiced ? vetoed : null,
    confidence: frameConfidence(voiced, meta),
    voiced,
    ts: performance.timeOrigin + performance.now(),
    contextTime: meta.contextTime,
    ...(_diag && inferMs !== null ? { inferMs } : {}),
    // Active notch frequencies (empty ⇒ omitted, the overwhelmingly
    // common case). Not diag-gated: a diagnostic / field-observability
    // field (diag snapshots, the session oracle). Not relayed to the ML
    // worker since 2026-10-07 — its utterance gate dropped the sub-floor
    // voicing probe that consumed them (audio-utils subFloorVoiced).
    ...(noiseNotch.activeFreqs().length > 0
      ? { notchedFreqs: noiseNotch.activeFreqs() }
      : {}),
  };
  return hop;
}

function postHop(hop, vad) {
  if (!hop || !hop.out) return;
  if (vad) {
    hop.out.vad = { p: vad.p, voice: vad.voice };
    if (_diag) hop.out.vadMs = hop.vadMs;
  }
  self.postMessage(hop.out);
}

// Synchronous path (no detector, or its model not ready yet): exactly the
// pre-try-out worker, plus the detector's front end and hop bookkeeping.
function handleChunkSync(data) {
  const hop = processChunk(data);
  if (hop && vadDetector) vadDetector.noteHop(hop.t);
  postHop(hop, null);
}

// Asynchronous path (model ready): the pitch part runs at once, the post
// waits for the detector's decision on the same hop.
async function handleChunkAsync(data) {
  const hop = processChunk(data);
  if (!hop) return;
  let vad = null;
  if (vadDetector?.ready) {
    const v0 = _diag ? performance.now() : 0;
    try {
      vad = await vadDetector.hop(hop.t);
    } catch (err) {
      vadDetector = null;
      vad = null;
      vadStatus("error", String(err?.message || err));
    }
    if (_diag) hop.vadMs += performance.now() - v0;
  } else if (vadDetector) {
    vadDetector.noteHop(hop.t);
  }
  postHop(hop, vad);
}

function attachAudioPort(port) {
  port.onmessage = (e) => {
    if (!vadQueue && !vadDetector?.ready) {
      try {
        handleChunkSync(e.data);
      } catch (err) {
        status("error", String(err?.message || err));
      }
      return;
    }
    vadQueued++;
    if (vadQueued > VAD_MAX_QUEUE && vadDetector) {
      // Falling behind real time: the pitch display must not wait for the
      // detector. Chunks already queued still post in order, ungated.
      vadDetector = null;
      vadStatus("slow", `the voice detector fell ${VAD_MAX_QUEUE} chunks behind; switched off for this session`);
    }
    const data = e.data;
    vadQueue = (vadQueue ?? Promise.resolve())
      .then(() => handleChunkAsync(data))
      .catch((err) => status("error", String(err?.message || err)))
      .finally(() => {
        vadQueued--;
        if (vadQueued === 0) vadQueue = null;
      });
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
      harmonicGuard = createHarmonicVoicingGuard();
      bufferDelayLine = [];
      resample = createStreamingResampler(inputSampleRate, TARGET_SAMPLE_RATE);
      buffer16k.fill(0);
      buffer16kFill = 0;
      frameMeta = [];
      streamSamplesIn = 0;
      vadGen++;
      vadQueue = null;
      vadQueued = 0;
      vadDetector = null;
      if (msg.vad && typeof msg.vad.modelBase === "string") {
        vadDetector = createVoiceDetector(); // fresh state per start
        loadVad(msg.vad, vadGen);
      }
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
