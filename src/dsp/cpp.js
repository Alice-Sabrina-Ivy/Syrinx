// cpp.js — Cepstral Peak Prominence (Hillenbrand 1994).
//
// Real cepstrum c[n] = (1/N) · IFFT(log|FFT(x)|). For real-valued
// input the log-magnitude spectrum is real and even in frequency,
// so the IFFT result is real and even in quefrency — and the IFFT
// reduces to (1/N) · forward FFT of the same symmetric input. The
// implementation reuses one radix-2 FFT for both the spectrum step
// and the quefrency step.
//
// Quefrency range: peak search is bounded to F0 ∈ [75, 625] Hz
// (quefrency ∈ [1.6, 13.3] ms). Covers all plausible speaking voice
// F0s including low-male (~80 Hz monotone) and high-female
// (~500 Hz singing).
//
// Regression baseline: linear least-squares over the same quefrency
// range. Praat's default is Theil's robust slow (median-of-pairwise-
// slopes), which is more peak-resistant; the
// measurements/vocal-weight-cpps-audit-2026-05-09.md selected linear
// LSQ for first ship as the simpler reference, with a switch to
// Theil-robust available if Step 7 testing surfaces peak-influence
// problems. CPP per frame = peak_dB − baseline_at_peak_quefrency_dB.
//
// Numeric range: dB units (10·log10 power). Healthy sustained vowels
// typically produce CPP ~20-30 dB; breathy phonation produces lower
// values. Absolute values are algorithm-specific and won't transfer
// cleanly from clinical literature — the gauge is calibrated per-
// user (first 30 s baseline) rather than against a population
// reference.
//
// This module is imported by dsp-worker.js (production hot path)
// and by tests/dsp/cpp-test.js (Layer 1 synthetic regression).

// CPP_INPUT_LEN is the PREFERRED input length (cap), not a hard
// requirement. The function uses min(buffer.length, CPP_INPUT_LEN);
// shorter buffers are zero-padded out to CPP_FFT_SIZE.
//
// At 48 kHz the analysis window is 2400 samples → uses full 2048.
// Hillenbrand 1994 originally used 1024 samples at 22.05 kHz (~46 ms);
// 2048 at 48 kHz is the same ~43 ms time window with similar period
// count. At lower sample rates (mobile silent downsample to 16 kHz,
// some Linux audio configs at 22.05 or 32 kHz), the AudioContext's
// 50 ms analysis window is shorter than 2048 samples — the function
// uses what's available with appropriate Hann windowing and lets the
// FFT zero-pad out to CPP_FFT_SIZE. Quefrency bins still map via
// n/sr so the F0 search range is sample-rate-correct.
//
// CPP_MIN_INPUT_LEN floors out 512 samples = ~32 ms at 16 kHz, ~2.5
// periods at F0=80 Hz. Below that, the cepstral peak isn't reliably
// resolved and we return null rather than emit noise.
export const CPP_INPUT_LEN = 2048;
export const CPP_MIN_INPUT_LEN = 512;
export const CPP_FFT_SIZE = 2048;
export const CPP_PREEMPH_ALPHA = 0.97;     // first-order HPF coefficient
export const CPP_F0_MIN_HZ = 75;            // sets quefrency upper bound
export const CPP_F0_MAX_HZ = 625;           // sets quefrency lower bound

// Pre-allocated buffers to keep the hot path GC-free. Module-scoped
// so the worker reuses the same buffers across frames; the cost of a
// 2 × 2048 Float64Array allocation per cycle (~32 KB) would otherwise
// be visible in long sessions.
const _re = new Float64Array(CPP_FFT_SIZE);
const _im = new Float64Array(CPP_FFT_SIZE);

// Radix-2 Cooley-Tukey FFT (in-place). Duplicated from dsp-worker.js
// rather than imported because dsp-worker.js is a Worker entry module
// that uses self.onmessage at top level — not directly importable from
// Node-side tests. A separate fft.js module is reasonable future
// cleanup but not required for this PR.
function fft(re, im) {
  const n = re.length;
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

// Compute cepstral peak prominence for a buffer of audio samples.
// Returns CPP in dB, or null if the buffer is below CPP_MIN_INPUT_LEN
// samples or the computation is degenerate (e.g., flat spectrum).
//
// `buffer` may be Float32Array or Float64Array. The function uses up
// to CPP_INPUT_LEN samples from the END of the buffer; shorter
// buffers are zero-padded out to CPP_FFT_SIZE for the FFT. This makes
// the function sample-rate-tolerant — at 48 kHz the production 50 ms
// analysis window provides 2400 samples (uses 2048); at 16 kHz it
// provides 800 samples (uses 800, zero-pads to 2048).
//
// `sr` is the sample rate of `buffer`, in Hz.
export function computeCPP(buffer, sr) {
  const inputLen = Math.min(buffer.length, CPP_INPUT_LEN);
  if (inputLen < CPP_MIN_INPUT_LEN) return null;
  const offset = buffer.length - inputLen;

  _re.fill(0);
  _im.fill(0);

  // Pre-emphasis (y[n] = x[n] - α·x[n-1]) + Hann window over the
  // available inputLen samples. The remainder of _re (positions
  // inputLen..CPP_FFT_SIZE-1) stays at 0 from .fill(0) above —
  // natural zero-padding for the FFT.
  //
  // Pre-emphasis prev is computed against the sample BEFORE the
  // analysis offset (continuous with the prior frame's tail) when
  // available, otherwise against the first sample (no boost on
  // n=0). Hann window period is inputLen, NOT CPP_INPUT_LEN — the
  // window must span exactly the active samples so its zeros land
  // at the input boundary, not inside the active region.
  let prev = offset > 0 ? buffer[offset - 1] : buffer[offset];
  for (let i = 0; i < inputLen; i++) {
    const sample = buffer[offset + i];
    const preemph = sample - CPP_PREEMPH_ALPHA * prev;
    const w = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (inputLen - 1));
    _re[i] = preemph * w;
    prev = sample;
  }

  // Forward FFT → log-power spectrum (in dB).
  fft(_re, _im);
  for (let k = 0; k < CPP_FFT_SIZE; k++) {
    const mag2 = _re[k] * _re[k] + _im[k] * _im[k];
    // Floor mag² to avoid log(0) on silent bins; -240 dB is below
    // any plausible audio-pipeline noise floor.
    _re[k] = mag2 > 1e-24 ? 10 * Math.log10(mag2) : -240;
    _im[k] = 0;
  }

  // Cepstrum step: real cepstrum = (1/N) · IFFT(log|X|). Since the
  // input is real-symmetric (log magnitude of an FFT of a real
  // sequence is symmetric in k), the IFFT equals the forward FFT
  // divided by N — both yield the same real result up to scaling.
  fft(_re, _im);
  const invN = 1 / CPP_FFT_SIZE;
  for (let n = 0; n < CPP_FFT_SIZE; n++) _re[n] *= invN;

  // Search peak in the speech-F0 quefrency range. Quefrency in
  // samples = sr / F0; bin index n corresponds to quefrency n/sr.
  const qMin = Math.max(1, Math.floor(sr / CPP_F0_MAX_HZ));
  const qMax = Math.min(CPP_FFT_SIZE / 2 - 1, Math.floor(sr / CPP_F0_MIN_HZ));
  if (qMin >= qMax) return null;

  let peakIdx = qMin;
  let peakVal = _re[qMin];
  for (let i = qMin + 1; i <= qMax; i++) {
    if (_re[i] > peakVal) {
      peakVal = _re[i];
      peakIdx = i;
    }
  }

  // Linear least-squares regression of cepstrum bins over [qMin, qMax].
  // c[i] ≈ a + b·i; CPP = peakVal − (a + b·peakIdx).
  const n = qMax - qMin + 1;
  let sumX = 0, sumY = 0, sumXY = 0, sumX2 = 0;
  for (let i = qMin; i <= qMax; i++) {
    const y = _re[i];
    sumX += i;
    sumY += y;
    sumXY += i * y;
    sumX2 += i * i;
  }
  const denom = n * sumX2 - sumX * sumX;
  if (Math.abs(denom) < 1e-12) return null;
  const slope = (n * sumXY - sumX * sumY) / denom;
  const intercept = (sumY - slope * sumX) / n;

  return peakVal - (intercept + slope * peakIdx);
}
