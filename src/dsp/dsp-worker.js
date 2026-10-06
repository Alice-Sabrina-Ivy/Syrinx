// dsp-worker.js — Web Worker that performs DSP analysis off the main thread
// Formant extraction (Burg LPC, src/dsp/formants.js), spectral tilt, HNR
// (window-corrected AC, src/dsp/hnr.js), intensity, CPP. Pitch detection
// lives in pitch-worker.js (Boersma-AC); the main thread relays the latest
// pitch back via "pitch-hint" messages so this worker can use it for
// pitch-adaptive formant analysis (Praat-style male-vs-female analysis rate
// + formant ceiling selection).

import { computeCPP, resetCppState } from "./cpp.js";
import { configureFormants, extractFormants } from "./formants.js";
import { computeHNR } from "./hnr.js";

const WINDOW_MS = 50;
let sampleRate = 48000;
let windowSize = Math.floor(sampleRate * WINDOW_MS / 1000);
// HNR uses a longer frame than the 50 ms analysis window: 70 ms = 5.25
// periods of the 75 Hz floor, which moves the window-corrected ACF's
// main ~4.8-period resonance below the search range (residual ~80 Hz
// scatter at very high HNR remains — see hnr.js). Taken from
// the ring buffer (capacity 2 x WINDOW_MS = 100 ms, steady-state fill
// 100 ms with 25 ms chunks).
const HNR_WINDOW_MS = 70;
let hnrSize = Math.floor(sampleRate * HNR_WINDOW_MS / 1000);
// Voice evidence for the pitch-hold bridge (src/audio/bridgeEvidence.js):
// a second CPP on a 64 ms window (cpp.js CPP_INPUT_LEN, its preferred
// length), ending at the chunk end like the 50 ms one. On the 50 ms window
// CPP depends on F0 — a deep voice fits fewer periods: a synthetic vowel at
// 76-82 Hz reads 35-48 % lower than at 140-200 Hz — so a fixed evidence
// threshold was a stricter bar for low voices. 64 ms flattens 90-250 Hz
// (measurements/pitch-hold-bridge-rework-2026-10-06.md §4.1). Kept apart
// from `cpp`, which feeds the vocal-weight gauge unchanged.
const BRIDGE_CPP_WINDOW_MS = 64;
let bridgeCppSize = Math.floor(sampleRate * BRIDGE_CPP_WINDOW_MS / 1000);

// Pre-allocated ring buffer to avoid GC pressure from repeated allocations.
// Uses a fixed-size buffer with a write position; oldest data is overwritten.
let ringCapacity = windowSize * 2;
let ringBuffer = new Float32Array(ringCapacity);
let ringLen = 0; // how many valid samples are in the buffer
let analysisCount = 0;

// Diagnostic: track pending chunks for queue depth monitoring
let pendingChunks = 0;
let lastContextTime = 0; // AudioContext time when latest chunk was captured

// Diagnostic-mode toggle, set via the `init` message from the main thread
// when the URL has ?diag=1. When off, the additional timing/voicedness
// fields are NOT computed or sent — only the existing production fields.
// When on, processChunk emits extra fields the overlay uses.
let _diag = false;

// Most-recent pitch from pitch-worker, relayed by the main thread via the
// "pitch-hint" message. Used by extractFormants for the male-vs-female
// analysis-rate + formant-ceiling selection. null means "no pitch known yet" —
// extractFormants treats null as the female default (see fallback in that
// function). One-frame lag (a hint arriving at chunk N is used by the
// formant extraction at chunk N+1) is acceptable since formants change
// slowly compared to chunk cadence.
let _lastKnownPitch = null;

// Spectral tilt: 2048-point FFT (fixed size, independent of sample rate)
const _tiltRe = new Float64Array(2048);
const _tiltIm = new Float64Array(2048);

function processChunk(buffer, contextTime) {
  const chunkReceiveTime = performance.now();
  // Wall-clock receipt time, used by the main thread (diag mode) to compute
  // chunkArrivalMs against the audio-context epoch. Captured even when diag
  // is off — it's one timestamp call, negligible.
  const chunkReceiveEpochMs = performance.timeOrigin + performance.now();
  pendingChunks--;
  if (contextTime !== null && contextTime !== undefined) lastContextTime = contextTime;

  const chunk = new Float32Array(buffer);
  appendToRingBuffer(chunk);

  if (ringLen < windowSize) return;

  // Extract analysis window (last windowSize samples) without allocating
  const windowStart = ringLen - windowSize;
  const window = ringBuffer.subarray(windowStart, ringLen);
  const intensity = computeIntensity(window);

  // Formants, spectral tilt, HNR are heavier — run every 6th analysis frame.
  // At ~30 fps DSP rate, this fires every ~200ms, saving significant CPU
  // (LPC + root finding + FFT) while still being responsive enough for training.
  // Pitch is provided by pitch-worker via the "pitch-hint" message; the most
  // recent value is held in _lastKnownPitch. extractFormants accepts null
  // and falls back to the female-default LPC configuration.
  let formants = null, spectralTilt = null, hnr = null, cpp = null;
  if (analysisCount % 6 === 0) {
    formants = extractFormants(window, _lastKnownPitch);
    spectralTilt = computeSpectralTilt(window, sampleRate);
    hnr = ringLen >= hnrSize
      ? computeHNR(ringBuffer.subarray(ringLen - hnrSize, ringLen), sampleRate)
      : null;
  }
  // CPP runs every frame (not throttled like the others). Original
  // 6th-frame cadence dropped during the WS2 methodology investigation
  // (2026-05-10): per-frame CPP gave Praat-comparison correlation
  // r=0.62 on PTDB-TUG / r=0.62 on FDA vs r=0.46/0.48 at 6th-frame
  // cadence. Each aggregator emit now averages ~40 CPP samples per 1-s
  // window instead of ~7 — quieter emits, better baseline σ. Cost:
  // ~80 ms/s CPU on desktop vs ~13 ms/s previously, both well within
  // budget. See measurements/cpp-praat-methodology-probe-2026-05-10.json.
  // Maryn-style processing (Theil + exponential trend + smoothing)
  // adds ~0.17 ms/frame over legacy LSQ. Well within budget.
  const cppT0 = _diag ? performance.now() : 0;
  cpp = computeCPP(window, sampleRate);
  const cppMs = _diag ? performance.now() - cppT0 : null;
  // cpp.js keeps no state across calls at its production defaults (no time
  // smoothing), so this second call leaves `cpp` above unchanged.
  const bridgeCpp = computeCPP(ringBuffer.subarray(ringLen - Math.min(ringLen, bridgeCppSize), ringLen), sampleRate);
  analysisCount++;

  const analysisEndTime = performance.now();

  // Diagnostic-only fields. inputRms is computed cheaply from the window
  // we already have. When diag is off, none of this is computed or sent.
  // chunkArrivalMs is NOT computed here — the AudioWorklet can't supply
  // a comparable wall-clock timestamp (no `performance` in
  // AudioWorkletGlobalScope). The main thread reconciles
  // chunkReceiveEpochMs against ctxCreatedAtEpochMs + contextTime.
  let diagFields = null;
  if (_diag) {
    let sumSq = 0;
    for (let i = 0; i < window.length; i++) sumSq += window[i] * window[i];
    const inputRms = Math.sqrt(sumSq / window.length);
    diagFields = {
      inputRms,
      // Wall-clock epoch-ms at chunk receipt and at postMessage. Main
      // thread combines these with ctxCreatedAtEpochMs + contextTime to
      // derive chunkArrivalMs (capture → worker arrival) and
      // handoffToMainMs (DSP postMessage → main onmessage entry).
      chunkReceiveEpochMs,
      postedAtEpochMs: performance.timeOrigin + performance.now(),
      // Per-frame computeCPP duration (Maryn-style). Surfaces in
      // diag snapshots so users can verify the per-frame cost
      // measurement (Step 2a) holds in real browser execution.
      cppMs,
    };
  }

  self.postMessage({
    type: "analysis",
    data: {
      // Pitch is no longer produced by this worker (SwiftF0 in pitch-worker.js
      // produces it). The field is kept on the message for backward
      // compatibility with consumers that destructure it; it's always null.
      // useAudioPipeline.js merges the pitch-worker's most-recent pitch into
      // each analysis frame.
      pitch: null,
      intensity, formants, spectralTilt, hnr, cpp, bridgeCpp,
      // Absolute timestamp comparable across threads
      absoluteTime: performance.timeOrigin + performance.now(),
      // Diagnostic fields (always present so the main-thread shape doesn't
      // change; the heavy ones nest under `diag` when diag is on, null otherwise)
      workerProcessingMs: analysisEndTime - chunkReceiveTime,
      pendingChunks,
      contextTime: lastContextTime, // AudioContext time when audio was captured
      diag: diagFields,
    },
  });
}

self.onmessage = (e) => {
 try {
  const { type } = e.data;

  if (type === "init") {
    sampleRate = e.data.sampleRate;
    if (e.data.diag) _diag = true;
    windowSize = Math.floor(sampleRate * WINDOW_MS / 1000);
    hnrSize = Math.floor(sampleRate * HNR_WINDOW_MS / 1000);
    bridgeCppSize = Math.floor(sampleRate * BRIDGE_CPP_WINDOW_MS / 1000);
    // Formant extractor (src/dsp/formants.js): decimation, anti-alias FIR
    // and zero-GC scratch buffers for this sample rate / window length.
    configureFormants(sampleRate, windowSize);
    ringCapacity = windowSize * 2;
    ringBuffer = new Float32Array(ringCapacity);
    ringLen = 0;
    analysisCount = 0;

    // Reset cpp.js module state (cepstrum-time-smoothing buffer +
    // sampled-Theil pair indices) so a worker re-init starts fresh.
    resetCppState();

    // Init-ack so the main thread can confirm the worker received the
    // diag flag and set up its buffers. Always sent regardless of diag.
    self.postMessage({ type: "worker-init-ack", diag: _diag, sampleRate, windowSize });
    return;
  }

  // Direct MessagePort from AudioWorklet (bypasses main thread)
  if (type === "port") {
    const port = e.data.port;
    port.onmessage = (ev) => {
      pendingChunks++;
      const msg = ev.data;
      if (msg && msg.buffer) {
        processChunk(msg.buffer, msg.contextTime);
      } else {
        // Fallback: raw ArrayBuffer (shouldn't happen with updated worklet)
        processChunk(msg);
      }
    };
    return;
  }

  if (type === "chunk") {
    pendingChunks++;
    processChunk(e.data.buffer);
  }

  // Pitch hint from the main thread (relayed from pitch-worker). Used by
  // extractFormants for male-vs-female LPC order + formant ceiling. One-
  // frame lag is acceptable since formants change slowly relative to
  // chunk cadence.
  if (type === "pitch-hint") {
    const p = e.data.pitch;
    _lastKnownPitch = (typeof p === "number" && p > 0) ? p : null;
    return;
  }
 } catch (err) {
   // Surface init / message-handler errors so an empty pipeline doesn't
   // look like "no audio". Production code paths shouldn't hit this; if
   // they do, the diag overlay's "Pipeline status" panel will show why.
   self.postMessage({
     type: "worker-error",
     where: "onmessage",
     message: err && err.message ? err.message : String(err),
     stack: err && err.stack ? err.stack : null,
   });
 }
};

// --- Ring buffer ---

function appendToRingBuffer(chunk) {
  if (ringLen + chunk.length <= ringCapacity) {
    // Room to append directly
    ringBuffer.set(chunk, ringLen);
    ringLen += chunk.length;
  } else {
    // Shift old data left to make room, keeping at most (ringCapacity - chunk.length)
    const keepLen = Math.min(ringLen, ringCapacity - chunk.length);
    ringBuffer.copyWithin(0, ringLen - keepLen, ringLen);
    ringBuffer.set(chunk, keepLen);
    ringLen = keepLen + chunk.length;
  }
}

// --- Intensity (RMS in dB) ---

function computeIntensity(buffer) {
  let sum = 0;
  for (let i = 0; i < buffer.length; i++) sum += buffer[i] * buffer[i];
  const rms = Math.sqrt(sum / buffer.length);
  if (rms === 0) return -Infinity;
  return 20 * Math.log10(rms);
}


// --- Radix-2 Cooley-Tukey FFT (in-place) ---

function fft(re, im) {
  const n = re.length;
  // Radix-2 FFT requires n to be a power of 2. Callers are expected to
  // provide correctly sized buffers, but guard against silent corruption.
  if (n === 0 || (n & (n - 1)) !== 0) {
    throw new Error(`FFT length must be a power of 2, got ${n}`);
  }
  // Bit-reversal permutation
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      let tmp = re[i]; re[i] = re[j]; re[j] = tmp;
      tmp = im[i]; im[i] = im[j]; im[j] = tmp;
    }
  }
  // FFT butterfly
  for (let len = 2; len <= n; len <<= 1) {
    const half = len >> 1;
    const angle = -2 * Math.PI / len;
    const wRe = Math.cos(angle);
    const wIm = Math.sin(angle);
    for (let i = 0; i < n; i += len) {
      let curRe = 1, curIm = 0;
      for (let j = 0; j < half; j++) {
        const a = i + j;
        const b = a + half;
        const tRe = curRe * re[b] - curIm * im[b];
        const tIm = curRe * im[b] + curIm * re[b];
        re[b] = re[a] - tRe;
        im[b] = im[a] - tIm;
        re[a] += tRe;
        im[a] += tIm;
        const nextRe = curRe * wRe - curIm * wIm;
        curIm = curRe * wIm + curIm * wRe;
        curRe = nextRe;
      }
    }
  }
}

// --- Spectral Tilt: FFT Band Energy Ratio ---

function computeSpectralTilt(buffer, sr) {
  const fftSize = 2048;
  const n = Math.min(buffer.length, fftSize);
  const re = _tiltRe;
  const im = _tiltIm;

  // Zero-fill and apply Hann window
  re.fill(0);
  im.fill(0);
  const offset = buffer.length - n;
  for (let i = 0; i < n; i++) {
    re[i] = buffer[offset + i] * (0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (n - 1)));
  }

  fft(re, im);

  // Precompute bin boundaries to avoid per-bin multiply
  const binHz = sr / fftSize;
  const lowBinEnd = Math.min(Math.floor(1000 / binHz), fftSize / 2);
  const highBinEnd = Math.min(Math.floor(4000 / binHz), fftSize / 2);
  let lowEnergy = 0, highEnergy = 0;

  for (let k = 1; k < lowBinEnd; k++) {
    lowEnergy += re[k] * re[k] + im[k] * im[k];
  }
  for (let k = lowBinEnd; k < highBinEnd; k++) {
    highEnergy += re[k] * re[k] + im[k] * im[k];
  }

  if (highEnergy === 0) return null;
  return 10 * Math.log10(lowEnergy / highEnergy);
}

// HNR lives in hnr.js (window-corrected autocorrelation, 2026-10-03).
