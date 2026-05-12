// cpp-resampled-prototype.js — PROTOTYPE for sample-rate-invariant CPP.
//
// NOT WIRED INTO PRODUCTION. This is the C-investigate-2 prototype
// for Option (b) — resample input audio to a canonical sample rate
// before computing CPP. If the prototype demonstrably eliminates
// sample-rate sensitivity without breaking other validation, the
// approach is promoted into cpp.js as part of Stage C.
//
// Approach: linear-interpolation resample the input to
// CANONICAL_SR (16 kHz, the lowest common denominator across all
// production sample rates), then run the SAME computeCPP logic as
// the existing implementation. Linear interpolation is fast (~1
// μs/sample) and audio quality at the cepstrum scale is unaffected
// — the same simplification gender-worker.js makes for ML inference.
//
// CANONICAL_SR=16 kHz choice rationale:
//   - Works for any production rate by downsampling (16, 22.05,
//     32, 44.1, 48 kHz all downsample cleanly; we never upsample,
//     which avoids interpolation artifacts in the high band).
//   - Matches the Hillenbrand 1994 regime (1024 samples at 22 kHz
//     ~= 800 samples at 16 kHz, ~46 ms window in both cases).
//   - Mobile silent-downsample to 16 kHz means no-op resampling
//     for mobile users (no extra cost where the budget is
//     tightest).
//   - At 16 kHz, a 50 ms analysis window has 800 samples, well
//     above CPP_MIN_INPUT_LEN (512), so the floor doesn't fire.
//
// All CPP computation parameters match the production cpp.js
// EXCEPT the input is always at 16 kHz. The function then uses
// CPP_INPUT_LEN_PROTO = 1024 samples (= 64 ms, matches Hillenbrand
// at 16 kHz) for the input window, zero-padded to CPP_FFT_SIZE.

import { computeCPP } from "./cpp.js";

export const CANONICAL_SR = 16000;
export const CPP_INPUT_LEN_PROTO = 1024;   // ~64 ms at canonical rate

// Anti-aliasing low-pass FIR design (Blackman-windowed sinc). Same
// shape as dsp-worker.js's designLowPassFIR. Cutoff normalized to
// half the canonical rate's Nyquist (i.e., relative to fromRate),
// with a Blackman window to control passband ripple.
function designLowPassFIR(cutoffNormalized, numTaps) {
  const coeffs = new Float64Array(numTaps);
  const mid = (numTaps - 1) / 2;
  for (let i = 0; i < numTaps; i++) {
    const x = i - mid;
    let sinc;
    if (Math.abs(x) < 1e-10) {
      sinc = 2 * cutoffNormalized;
    } else {
      sinc = Math.sin(2 * Math.PI * cutoffNormalized * x) / (Math.PI * x);
    }
    const win = 0.42 - 0.5 * Math.cos((2 * Math.PI * i) / (numTaps - 1))
                     + 0.08 * Math.cos((4 * Math.PI * i) / (numTaps - 1));
    coeffs[i] = sinc * win;
  }
  let sum = 0;
  for (let i = 0; i < numTaps; i++) sum += coeffs[i];
  for (let i = 0; i < numTaps; i++) coeffs[i] /= sum;
  return coeffs;
}

// FIR filter + linear-interp downsampler. Anti-aliases the input
// before linear-interp resampling to avoid synthetic-impulse aliasing
// artifacts observed in C-investigate-2 iteration 1 (pure pulse trains
// at 48 kHz downsampled to 16 kHz lost most of their energy when
// pulses landed between integer-ratio output samples).
//
// Real-speech audio is already band-limited by the browser audio
// pipeline, so the FIR is mostly a no-op there; this exists to make
// the synthetic-test regression pass without changing real-speech
// behavior.

// Cache per fromRate to avoid recomputing the FIR each call.
const _firCache = new Map();
function getAntiAliasFIR(fromRate) {
  if (_firCache.has(fromRate)) return _firCache.get(fromRate);
  if (fromRate <= CANONICAL_SR) {
    _firCache.set(fromRate, null);   // no filter needed when not downsampling
    return null;
  }
  // Cutoff at 0.45/decimationFactor (90 % of canonical Nyquist).
  // Same coefficient as dsp-worker.js.
  const decimation = fromRate / CANONICAL_SR;
  const numTaps = Math.max(33, Math.ceil(decimation) * 16 + 1);
  const fir = designLowPassFIR(0.45 / decimation, numTaps);
  _firCache.set(fromRate, fir);
  return fir;
}

function resampleLinearToCanonical(buffer, fromRate) {
  if (fromRate === CANONICAL_SR) {
    // No-op fast path
    return buffer;
  }
  // Anti-alias filter (downsampling only — upsampling would skip).
  let filtered = buffer;
  const fir = getAntiAliasFIR(fromRate);
  if (fir !== null) {
    const filteredArr = new Float32Array(buffer.length);
    const halfTaps = fir.length >> 1;
    for (let i = 0; i < buffer.length; i++) {
      let acc = 0;
      for (let k = 0; k < fir.length; k++) {
        const idx = i + k - halfTaps;
        if (idx >= 0 && idx < buffer.length) acc += buffer[idx] * fir[k];
      }
      filteredArr[i] = acc;
    }
    filtered = filteredArr;
  }
  // Linear-interp downsample on the anti-aliased signal.
  const ratio = fromRate / CANONICAL_SR;
  const outLen = Math.floor(filtered.length / ratio);
  const out = new Float32Array(outLen);
  for (let i = 0; i < outLen; i++) {
    const srcF = i / (CANONICAL_SR / fromRate);
    const i0 = Math.floor(srcF);
    const i1 = Math.min(i0 + 1, filtered.length - 1);
    const t = srcF - i0;
    out[i] = filtered[i0] * (1 - t) + filtered[i1] * t;
  }
  return out;
}

// Public API mirrors computeCPP. Accepts buffer + actual sample
// rate, internally resamples, calls the existing computeCPP at the
// canonical rate.
export function computeCPPResampled(buffer, sr, opts = {}) {
  const resampled = resampleLinearToCanonical(buffer, sr);
  // Note: we pass CANONICAL_SR as the sample rate to computeCPP so
  // its quefrency search range maps correctly. The buffer is now
  // at canonical rate so the algorithm operates in a consistent
  // regime regardless of input rate.
  return computeCPP(resampled, CANONICAL_SR, opts);
}

// Re-export resetCppState so prototype callers get the same fresh-
// state semantics as production.
export { resetCppState } from "./cpp.js";
