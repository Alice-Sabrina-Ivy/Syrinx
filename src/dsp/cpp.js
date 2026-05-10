// cpp.js — Cepstral Peak Prominence with Maryn-style processing.
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
// Maryn-style processing (post-2026-05-10 Option-A iteration):
// - Sampled Theil-robust regression (replacing linear LSQ): more
//   robust to peak influence than LSQ. Sampled with N=500 random
//   pairs (corresponds to Praat's "Robust" option, faster than
//   "Robust slow" full Theil at >1000× speedup with ≤2-3 % loss
//   in slope precision).
// - Exponential trend type (replacing linear): cepstrum baseline
//   shape is naturally exponential-decaying, log-domain Theil
//   produces a closer-fitting baseline than linear-domain Theil.
// - Time smoothing across 3 frames of cepstra (rolling buffer):
//   reduces per-frame cepstrum noise. Module-level state.
// - Quefrency smoothing with 3-bin moving average: reduces
//   per-bin noise. Cheap.
//
// See measurements/maryn-cpps-design-2026-05-10.md for the
// implementation-choice rationale per component, including which
// Praat parameters this matches and which deviate.
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

// Default option values. Originally set to full Maryn-style processing
// (Theil + exponential + 3+3 smoothing) per the Option-A direction
// (2026-05-10 morning); empirical isolation surfaced that time
// smoothing across DSP frames substantially regresses Praat-comparison
// correlation, while the other Maryn components (Theil, exponential
// trend) produced near-baseline results — the audit-predicted
// improvement from Theil-robust did NOT manifest empirically.
//
// Reverted defaults to pre-Maryn (linear LSQ + linear trend + no
// smoothing) on 2026-05-10 evening. Keeps the new algorithmic paths
// (Theil, exponential, smoothing) as opt-in for measurement and
// future investigation. See
// measurements/cpp-maryn-component-isolation-2026-05-10.json for the
// component-by-component data.
export const CPP_DEFAULT_REGRESSION = "linear";
export const CPP_DEFAULT_TREND = "linear";
export const CPP_DEFAULT_TIME_SMOOTH_FRAMES = 1;
export const CPP_DEFAULT_QUEFRENCY_SMOOTH_BINS = 1;
export const CPP_THEIL_PAIRS = 500;          // sampled Theil pair count

// Pre-allocated buffers to keep the hot path GC-free. Module-scoped
// so the worker reuses the same buffers across frames; the cost of a
// 2 × 2048 Float64Array allocation per cycle (~32 KB) would otherwise
// be visible in long sessions.
const _re = new Float64Array(CPP_FFT_SIZE);
const _im = new Float64Array(CPP_FFT_SIZE);
// Smoothed-cepstrum scratch (after time + quefrency smoothing) used
// for peak detection and trend-baseline fit. Same size as _re.
const _smoothed = new Float64Array(CPP_FFT_SIZE);
// Time-smoothing rolling buffer of cepstrum vectors. Allocated lazily
// on first computeCPP call (deduces size from CPP_FFT_SIZE +
// timeSmoothFrames). Module-level state; resetCppState() clears it.
let _cepstrumBuffer = null;
let _cepstrumBufferSize = 0;   // configured frame count
let _cepstrumBufferFilled = 0; // 0..size

// Sampled-Theil pair index buffers. Allocated lazily for the
// configured search range. Pre-shuffled deterministic indices so the
// same pairs are evaluated each frame (avoids per-frame RNG cost
// while preserving sampling-Theil's statistical properties).
let _theilPairsI = null;
let _theilPairsJ = null;
let _theilPairsRange = -1;     // qMax - qMin + 1 the buffers were sized for
const _theilSlopes = new Float64Array(CPP_THEIL_PAIRS);
const _theilIntercepts = new Float64Array(CPP_THEIL_PAIRS);

export function resetCppState() {
  _cepstrumBuffer = null;
  _cepstrumBufferSize = 0;
  _cepstrumBufferFilled = 0;
  _theilPairsI = null;
  _theilPairsJ = null;
  _theilPairsRange = -1;
}

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

// Generate deterministic pair indices for sampled Theil regression.
// Same pairs are reused across calls (frame-stable) — Theil-Sen's
// statistical guarantees hold for any uniform sample, and reusing
// avoids per-frame Math.random() cost.
function ensureTheilPairs(rangeSize) {
  if (_theilPairsI && _theilPairsRange === rangeSize) return;
  _theilPairsI = new Int32Array(CPP_THEIL_PAIRS);
  _theilPairsJ = new Int32Array(CPP_THEIL_PAIRS);
  // Linear congruential generator with fixed seed for reproducibility.
  // Don't use Math.random — non-deterministic across runs muddles
  // unit-test fixed-input expectations.
  let state = 0x9e3779b9;  // golden-ratio-derived seed
  function next() {
    state = (state * 1664525 + 1013904223) | 0;
    return (state >>> 0) / 0x100000000;
  }
  for (let p = 0; p < CPP_THEIL_PAIRS; p++) {
    let i = Math.floor(next() * rangeSize);
    let j = Math.floor(next() * rangeSize);
    while (i === j) j = Math.floor(next() * rangeSize);
    if (i > j) { const t = i; i = j; j = t; }
    _theilPairsI[p] = i;
    _theilPairsJ[p] = j;
  }
  _theilPairsRange = rangeSize;
}

// Sampled Theil-Sen slope estimator. Returns slope of best-fit line
// `y[k] ≈ slope · k + intercept` for k in [qMin, qMax]. Robust to
// outliers (peak in cepstrum) — uses median of pairwise slopes from
// CPP_THEIL_PAIRS sampled pairs.
function theilSlope(values, qMin, qMax) {
  const rangeSize = qMax - qMin + 1;
  ensureTheilPairs(rangeSize);
  let count = 0;
  for (let p = 0; p < CPP_THEIL_PAIRS; p++) {
    const ki = qMin + _theilPairsI[p];
    const kj = qMin + _theilPairsJ[p];
    const dk = kj - ki;
    if (dk === 0) continue;
    _theilSlopes[count++] = (values[kj] - values[ki]) / dk;
  }
  if (count === 0) return { slope: 0, intercept: 0 };

  // Median of slopes
  const slopesView = _theilSlopes.subarray(0, count);
  const sortedSlopes = Array.from(slopesView).sort((a, b) => a - b);
  const slopeMedian = sortedSlopes.length % 2
    ? sortedSlopes[(sortedSlopes.length - 1) >> 1]
    : 0.5 * (sortedSlopes[(sortedSlopes.length / 2) - 1] + sortedSlopes[sortedSlopes.length / 2]);

  // Theil-Sen intercept: median of (y_i - slope * i) across all i in range
  const interceptCount = rangeSize;
  const interceptArr = new Float64Array(interceptCount);
  for (let i = 0; i < interceptCount; i++) {
    interceptArr[i] = values[qMin + i] - slopeMedian * (qMin + i);
  }
  const sortedIntercepts = Array.from(interceptArr).sort((a, b) => a - b);
  const interceptMedian = sortedIntercepts.length % 2
    ? sortedIntercepts[(sortedIntercepts.length - 1) >> 1]
    : 0.5 * (sortedIntercepts[(sortedIntercepts.length / 2) - 1] + sortedIntercepts[sortedIntercepts.length / 2]);

  return { slope: slopeMedian, intercept: interceptMedian };
}

// Linear least-squares slope estimator — preserved as a non-default
// option for backwards compatibility with pre-Maryn tests. Returns
// {slope, intercept} or null on degenerate denominator.
function lsqSlope(values, qMin, qMax) {
  const n = qMax - qMin + 1;
  let sumX = 0, sumY = 0, sumXY = 0, sumX2 = 0;
  for (let i = qMin; i <= qMax; i++) {
    const y = values[i];
    sumX += i;
    sumY += y;
    sumXY += i * y;
    sumX2 += i * i;
  }
  const denom = n * sumX2 - sumX * sumX;
  if (Math.abs(denom) < 1e-12) return null;
  const slope = (n * sumXY - sumX * sumY) / denom;
  const intercept = (sumY - slope * sumX) / n;
  return { slope, intercept };
}

// Compute cepstral peak prominence for a buffer of audio samples.
// Returns CPP in dB, or null if the buffer is below CPP_MIN_INPUT_LEN
// samples or the computation is degenerate (e.g., flat spectrum).
//
// `buffer` may be Float32Array or Float64Array. The function uses up
// to CPP_INPUT_LEN samples from the END of the buffer; shorter
// buffers are zero-padded out to CPP_FFT_SIZE for the FFT.
//
// `sr` is the sample rate of `buffer`, in Hz.
//
// `opts` (all optional, defaults match Maryn-style processing):
// - `regression`: "theil" | "linear" (default "theil")
// - `trend`: "exponential" | "linear" (default "exponential")
// - `timeSmoothFrames`: integer ≥ 1 (default 3) — number of recent
//   cepstrum vectors to elementwise-average before peak detection
// - `quefrencySmoothBins`: integer ≥ 1 (default 3) — width of the
//   centered moving-average kernel applied to the cepstrum
export function computeCPP(buffer, sr, opts = {}) {
  const inputLen = Math.min(buffer.length, CPP_INPUT_LEN);
  if (inputLen < CPP_MIN_INPUT_LEN) return null;
  const offset = buffer.length - inputLen;
  const regression = opts.regression ?? CPP_DEFAULT_REGRESSION;
  const trend = opts.trend ?? CPP_DEFAULT_TREND;
  const timeSmoothFrames = opts.timeSmoothFrames ?? CPP_DEFAULT_TIME_SMOOTH_FRAMES;
  const quefrencySmoothBins = opts.quefrencySmoothBins ?? CPP_DEFAULT_QUEFRENCY_SMOOTH_BINS;

  _re.fill(0);
  _im.fill(0);

  // Pre-emphasis (y[n] = x[n] - α·x[n-1]) + Hann window over the
  // available inputLen samples. The remainder of _re (positions
  // inputLen..CPP_FFT_SIZE-1) stays at 0 from .fill(0) above —
  // natural zero-padding for the FFT.
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
    _re[k] = mag2 > 1e-24 ? 10 * Math.log10(mag2) : -240;
    _im[k] = 0;
  }

  // Cepstrum step: real cepstrum = (1/N) · IFFT(log|X|). Reuses
  // forward FFT (symmetric input → real result).
  fft(_re, _im);
  const invN = 1 / CPP_FFT_SIZE;
  for (let n = 0; n < CPP_FFT_SIZE; n++) _re[n] *= invN;

  // Time smoothing: rolling buffer of recent cepstra. Elementwise mean.
  // Frame n+1's cepstrum is _re; previous frames live in _cepstrumBuffer.
  // _smoothed = mean(_re, last (timeSmoothFrames-1) buffer entries).
  if (timeSmoothFrames > 1) {
    if (_cepstrumBuffer === null || _cepstrumBufferSize !== timeSmoothFrames - 1) {
      _cepstrumBufferSize = timeSmoothFrames - 1;
      _cepstrumBuffer = new Array(_cepstrumBufferSize);
      for (let i = 0; i < _cepstrumBufferSize; i++) {
        _cepstrumBuffer[i] = new Float64Array(CPP_FFT_SIZE);
      }
      _cepstrumBufferFilled = 0;
    }
    // Sum: current + buffered.
    const used = Math.min(_cepstrumBufferFilled, _cepstrumBufferSize);
    const denomFrames = used + 1;
    for (let k = 0; k < CPP_FFT_SIZE; k++) {
      let sum = _re[k];
      for (let f = 0; f < used; f++) sum += _cepstrumBuffer[f][k];
      _smoothed[k] = sum / denomFrames;
    }
    // Shift buffer: drop oldest, push current.
    if (_cepstrumBufferSize > 0) {
      // Reuse last slot's allocation as the new buffer entry — copy
      // _re into the buffer's "newest" slot at index 0.
      const oldest = _cepstrumBuffer[_cepstrumBufferSize - 1];
      for (let i = _cepstrumBufferSize - 1; i > 0; i--) {
        _cepstrumBuffer[i] = _cepstrumBuffer[i - 1];
      }
      _cepstrumBuffer[0] = oldest;
      for (let k = 0; k < CPP_FFT_SIZE; k++) _cepstrumBuffer[0][k] = _re[k];
      if (_cepstrumBufferFilled < _cepstrumBufferSize) _cepstrumBufferFilled++;
    }
  } else {
    // No time smoothing — copy current cepstrum into _smoothed.
    for (let k = 0; k < CPP_FFT_SIZE; k++) _smoothed[k] = _re[k];
  }

  // Quefrency smoothing: centered moving average over the search range.
  // Done in-place on _smoothed using a temp scratch (reuse _im which
  // is currently zeroed).
  if (quefrencySmoothBins > 1) {
    const half = quefrencySmoothBins >> 1;
    // Stash original into _im for read while we write to _smoothed
    for (let k = 0; k < CPP_FFT_SIZE; k++) _im[k] = _smoothed[k];
    for (let k = 0; k < CPP_FFT_SIZE; k++) {
      let sum = 0, count = 0;
      for (let dk = -half; dk <= half; dk++) {
        const idx = k + dk;
        if (idx < 0 || idx >= CPP_FFT_SIZE) continue;
        sum += _im[idx];
        count++;
      }
      _smoothed[k] = sum / count;
    }
    // Clear _im back to 0 so subsequent FFT calls (next frame) start clean
    for (let k = 0; k < CPP_FFT_SIZE; k++) _im[k] = 0;
  }

  // Search peak in the speech-F0 quefrency range.
  const qMin = Math.max(1, Math.floor(sr / CPP_F0_MAX_HZ));
  const qMax = Math.min(CPP_FFT_SIZE / 2 - 1, Math.floor(sr / CPP_F0_MIN_HZ));
  if (qMin >= qMax) return null;

  let peakIdx = qMin;
  let peakVal = _smoothed[qMin];
  for (let i = qMin + 1; i <= qMax; i++) {
    if (_smoothed[i] > peakVal) {
      peakVal = _smoothed[i];
      peakIdx = i;
    }
  }

  // Trend baseline. Either:
  // - linear: regression in (k, c[k]) space directly
  // - exponential: regression in (k, log(c[k] - min + eps)) space, then exp
  let baselineAtPeak;
  if (trend === "exponential") {
    // Find min in search range for the offset
    let minVal = _smoothed[qMin];
    for (let i = qMin + 1; i <= qMax; i++) {
      if (_smoothed[i] < minVal) minVal = _smoothed[i];
    }
    const eps = 1e-6;
    // Build log-domain values into a scratch (reuse a portion of _im
    // since we cleared it above and won't FFT until next call). Need
    // CPP_FFT_SIZE indexing parity.
    for (let i = qMin; i <= qMax; i++) {
      _im[i] = Math.log(_smoothed[i] - minVal + eps);
    }
    const fit = regression === "theil" ? theilSlope(_im, qMin, qMax) : lsqSlope(_im, qMin, qMax);
    if (fit === null) return null;
    // Restore _im to 0 for next-frame FFT cleanliness
    for (let i = qMin; i <= qMax; i++) _im[i] = 0;
    const logBase = fit.intercept + fit.slope * peakIdx;
    baselineAtPeak = Math.exp(logBase) - eps + minVal;
  } else {
    const fit = regression === "theil" ? theilSlope(_smoothed, qMin, qMax) : lsqSlope(_smoothed, qMin, qMax);
    if (fit === null) return null;
    baselineAtPeak = fit.intercept + fit.slope * peakIdx;
  }

  return peakVal - baselineAtPeak;
}
