// formants.js — Burg-LPC formant extraction (F1–F3), shared by
// dsp-worker.js (production) and tests/dsp/formant-accuracy-test.js
// (so the test measures the production code, not an inline copy).
//
// Pipeline: pre-emphasis (0.97) → Hamming → FIR anti-alias + integer
// decimation → Burg LPC → Durand-Kerner roots → poles with 90 Hz < f <
// ceiling and bandwidth < 600 Hz, sorted ascending.
//
// Zero-GC hot path: all scratch buffers are module-level and (re)allocated
// by configureFormants(); extractFormants() allocates only its small result
// object.

// Maximum effective sample rate for formant analysis. Decimation factor is
// chosen so that targetSR = sampleRate / factor ≤ MAX_FORMANT_SR: factor 4
// at 44.1/48 kHz (11025 / 12000 Hz), factor 2 at 16 kHz (8000 Hz).
const MAX_FORMANT_SR = 12000;
// Upper bound on the LPC order (array sizing + the order rule's cap).
const MAX_LPC_ORDER = 16;

// LPC order for a given analysis rate: two poles per expected formant, five
// formants per 11 kHz of analysis bandwidth (Praat's "To Formant (burg)":
// 5 formants below 5500 Hz at 11 kHz), capped at MAX_LPC_ORDER:
// 8 kHz → 8, 11.025/12 kHz → 12, 16 kHz → 16. The SAME rule serves both the
// male (pitch hint < MALE_PITCH_HZ) and female/unknown branches — the order
// tracks the analysis bandwidth, not the speaker. Before 2026-10-03 the male
// branch used a fixed order 10, close to right only at 8 kHz analysis
// (16 kHz capture; the rule now gives 8 there, measured slightly better)
// and under-fitted at the 12 kHz analysis rate of 48 kHz capture:
// Hillenbrand men F2 mean error 265 → 107 Hz, gross (>20 %) 17.6 → 7.4 %
// (measurements/formant-lpc-order-2026-10-03.md). With one rule, an
// octave-down pitch hint on a high voice changes only the 5000/5500 Hz
// pole-selection ceiling at 44.1/48 kHz (at 16/32 kHz capture the hint
// still selects the analysis rate, and so the order).
export function lpcOrderForRate(analysisSR) {
  return Math.min(MAX_LPC_ORDER, Math.ceil(5 * analysisSR / 11000) * 2);
}

// Pitch below this selects the male branch (base decimation, 5000 Hz
// ceiling); at/above it, or no pitch known, the female branch (decimation
// lowered until the analysis rate is ≥ 11 kHz, 5500 Hz ceiling).
export const MALE_PITCH_HZ = 140;

let sampleRate = 48000;
let decimationFactor = 4;
let targetSR = 12000;
let antiAliasFilter = null;
// Cache for adaptive-decimation FIR designs (keyed by effective factor).
// At 16/32 kHz input the female branch lowers the factor on EVERY formant
// frame; caching avoids re-running designLowPassFIR in the hot path.
// Cleared by configureFormants (sample-rate change invalidates designs).
const _firCache = new Map();

let _preEmph = new Float64Array(0);
let _windowed = new Float64Array(0);
// Sized for factor=1 (no decimation) to support pitch-adaptive decimation
let _decimated = new Float64Array(0);
let _burgEf = new Float64Array(0);
let _burgEb = new Float64Array(0);
let _burgEfTmp = new Float64Array(0);
let _burgEbTmp = new Float64Array(0);
const _burgA = new Float64Array(MAX_LPC_ORDER + 1);
const _burgANew = new Float64Array(MAX_LPC_ORDER + 1);
// Root finding: flat typed arrays instead of object arrays
const _rootsRe = new Float64Array(MAX_LPC_ORDER);
const _rootsIm = new Float64Array(MAX_LPC_ORDER);
// Formant selection scratch arrays
const _formantFreqs = new Float64Array(MAX_LPC_ORDER);
const _formantBws = new Float64Array(MAX_LPC_ORDER);

// Set the capture sample rate and the maximum analysis-window length (in
// samples at that rate). Must be called before extractFormants.
export function configureFormants(sr, maxWindowSamples) {
  sampleRate = sr;
  // Use ceil to ensure targetSR ≤ MAX_FORMANT_SR.  At 16 kHz input,
  // ceil(16000/12000)=2 → targetSR=8000; at 48 kHz, ceil(48000/12000)=4 → 12000.
  decimationFactor = Math.max(1, Math.ceil(sampleRate / MAX_FORMANT_SR));
  targetSR = sampleRate / decimationFactor;
  // Anti-alias cutoff: 0.45/factor gives 90% of target Nyquist.
  antiAliasFilter = designLowPassFIR(0.45 / decimationFactor, decimationFactor * 16 + 1);
  _firCache.clear();
  _preEmph = new Float64Array(maxWindowSamples);
  _windowed = new Float64Array(maxWindowSamples);
  _decimated = new Float64Array(maxWindowSamples);
  _burgEf = new Float64Array(maxWindowSamples);
  _burgEb = new Float64Array(maxWindowSamples);
  _burgEfTmp = new Float64Array(maxWindowSamples);
  _burgEbTmp = new Float64Array(maxWindowSamples);
}

// --- Formant Extraction (Burg LPC) ---
// detectedPitch (Hz or null) selects the analysis rate and pole-selection
// ceiling (Praat-style: maxFormant 5000 Hz male / 5500 Hz female); the LPC
// order follows the analysis rate via lpcOrderForRate.
export function extractFormants(buffer, detectedPitch) {
  const n = buffer.length;
  let maxFormant, effectiveDecFactor, effectiveTargetSR, effectiveFilter;

  // Pitches in [140, 160) Hz fall through to the female-default branch —
  // the male branch is only chosen on a confident male pitch detection.
  const isMale = detectedPitch !== null && detectedPitch < MALE_PITCH_HZ;

  if (isMale) {
    // Male: formant ceiling 5000 Hz, base decimation (≤ 12 kHz analysis)
    maxFormant = 5000;
    effectiveDecFactor = decimationFactor;
    effectiveTargetSR = targetSR;
    effectiveFilter = antiAliasFilter;
  } else {
    // Female (or unknown): formant ceiling 5500 Hz, analysis rate ≥ 11 kHz.
    // If the default decimation gives targetSR < 11000, reduce the factor.
    maxFormant = 5500;
    const minTargetSR = 11000;
    effectiveDecFactor = decimationFactor;
    effectiveTargetSR = targetSR;
    effectiveFilter = antiAliasFilter;
    while (effectiveDecFactor > 1 && sampleRate / effectiveDecFactor < minTargetSR) {
      effectiveDecFactor--;
    }
    if (effectiveDecFactor !== decimationFactor) {
      effectiveTargetSR = sampleRate / effectiveDecFactor;
      let cached = _firCache.get(effectiveDecFactor);
      if (!cached) {
        cached = designLowPassFIR(0.45 / effectiveDecFactor, effectiveDecFactor * 16 + 1);
        _firCache.set(effectiveDecFactor, cached);
      }
      effectiveFilter = cached;
    }
  }
  const lpcOrder = lpcOrderForRate(effectiveTargetSR);

  // Pre-emphasis into pre-allocated buffer
  _preEmph[0] = buffer[0];
  for (let i = 1; i < n; i++) {
    _preEmph[i] = buffer[i] - 0.97 * buffer[i - 1];
  }

  // Hamming window into pre-allocated buffer
  for (let i = 0; i < n; i++) {
    _windowed[i] = _preEmph[i] * (0.54 - 0.46 * Math.cos((2 * Math.PI * i) / (n - 1)));
  }

  // Downsample with anti-alias FIR filter (writes into _decimated)
  const decLen = decimateWithFilter(_windowed, n, effectiveDecFactor, effectiveFilter);

  // Burg LPC (uses pre-allocated buffers internally)
  const coefficients = burgLPC(_decimated.subarray(0, decLen), lpcOrder);

  // Find polynomial roots (uses pre-allocated flat arrays)
  const rootCount = findPolynomialRoots(coefficients, lpcOrder);

  // Convert roots to formant frequencies + bandwidths
  let fCount = 0;
  const fFreqs = _formantFreqs;
  const fBws = _formantBws;
  for (let i = 0; i < rootCount; i++) {
    if (_rootsIm[i] <= 0) continue;

    const freq = (Math.atan2(_rootsIm[i], _rootsRe[i]) * effectiveTargetSR) / (2 * Math.PI);
    const mag = Math.sqrt(_rootsRe[i] * _rootsRe[i] + _rootsIm[i] * _rootsIm[i]);
    const bw = mag > 0 ? (-Math.log(mag) * effectiveTargetSR) / Math.PI : Infinity;

    if (freq > 90 && freq < maxFormant && bw > 0 && bw < 600) {
      fFreqs[fCount] = freq;
      fBws[fCount] = bw;
      fCount++;
    }
  }

  // Sort by frequency (insertion sort — at most ~8 elements)
  for (let i = 1; i < fCount; i++) {
    const kf = fFreqs[i], kb = fBws[i];
    let j = i - 1;
    while (j >= 0 && fFreqs[j] > kf) {
      fFreqs[j + 1] = fFreqs[j];
      fBws[j + 1] = fBws[j];
      j--;
    }
    fFreqs[j + 1] = kf;
    fBws[j + 1] = kb;
  }

  return {
    f1: fCount > 0 ? fFreqs[0] : null,
    f2: fCount > 1 ? fFreqs[1] : null,
    f3: fCount > 2 ? fFreqs[2] : null,
  };
}

// Design a Blackman-windowed sinc low-pass FIR filter.
// cutoffNormalized: cutoff as fraction of sample rate (0.5 = Nyquist)
// numTaps: filter length (odd for symmetric, linear-phase)
function designLowPassFIR(cutoffNormalized, numTaps) {
  const coeffs = new Float64Array(numTaps);
  const mid = (numTaps - 1) / 2;
  for (let i = 0; i < numTaps; i++) {
    const x = i - mid;
    // Windowed sinc: sinc provides ideal low-pass, Blackman window gives
    // ~74 dB stopband attenuation (vs ~13 dB for box-car averaging).
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
  // Normalize to unity DC gain
  let sum = 0;
  for (let i = 0; i < numTaps; i++) sum += coeffs[i];
  for (let i = 0; i < numTaps; i++) coeffs[i] /= sum;
  return coeffs;
}

// Downsample with FIR anti-alias filtering to prevent aliasing artifacts.
// Reads the first bufLen samples of buffer; writes into the pre-allocated
// _decimated buffer. Returns the decimated length.
function decimateWithFilter(buffer, bufLen, factor, taps) {
  if (factor <= 1) {
    for (let i = 0; i < bufLen; i++) _decimated[i] = buffer[i];
    return bufLen;
  }
  const numTaps = taps.length;
  const halfTaps = numTaps >> 1;
  const newLen = Math.floor(bufLen / factor);
  for (let i = 0; i < newLen; i++) {
    let sum = 0;
    const center = i * factor;
    // Compute clamped bounds to avoid per-sample branch
    const jStart = Math.max(0, halfTaps - center);
    const jEnd = Math.min(numTaps, bufLen - center + halfTaps);
    for (let j = jStart; j < jEnd; j++) {
      sum += buffer[center - halfTaps + j] * taps[j];
    }
    _decimated[i] = sum;
  }
  return newLen;
}

// Burg LPC algorithm — uses pre-allocated buffers to avoid per-frame GC.
// Returns _burgA (the coefficient array) directly.
function burgLPC(samples, order) {
  const n = samples.length;
  const a = _burgA;
  const aNew = _burgANew;
  const ef = _burgEf;
  const eb = _burgEb;
  const efTmp = _burgEfTmp;
  const ebTmp = _burgEbTmp;

  a.fill(0);
  a[0] = 1;

  for (let i = 0; i < n; i++) {
    ef[i] = samples[i];
    eb[i] = samples[i];
  }

  for (let m = 1; m <= order; m++) {
    let num = 0, den = 0;
    for (let i = m; i < n; i++) {
      num += ef[i] * eb[i - 1];
      den += ef[i] * ef[i] + eb[i - 1] * eb[i - 1];
    }
    if (den === 0) break;
    const k = (-2 * num) / den;

    // Update LPC coefficients in-place via aNew scratch
    aNew[0] = 1;
    for (let i = 1; i < m; i++) {
      aNew[i] = a[i] + k * a[m - i];
    }
    aNew[m] = k;
    for (let i = 0; i <= m; i++) a[i] = aNew[i];

    // Update prediction errors into scratch buffers to avoid read-after-write
    // corruption (eb[i] must not be overwritten before eb[i-1] is read next iter)
    for (let i = m; i < n; i++) {
      efTmp[i] = ef[i] + k * eb[i - 1];
      ebTmp[i] = eb[i - 1] + k * ef[i];
    }
    for (let i = m; i < n; i++) {
      ef[i] = efTmp[i];
      eb[i] = ebTmp[i];
    }
  }

  return a;
}

// Durand-Kerner method for finding all roots of a polynomial.
// Uses pre-allocated flat arrays _rootsRe/_rootsIm. Returns the root count (n).
// coefficients[0..n] where poly = c[0]*z^n + c[1]*z^(n-1) + ... + c[n]
function findPolynomialRoots(coefficients, order) {
  const n = order;
  if (n <= 0) return 0;

  const rRe = _rootsRe;
  const rIm = _rootsIm;

  // Initial guesses on a circle of radius 0.9
  for (let i = 0; i < n; i++) {
    const angle = (2 * Math.PI * i) / n + 0.4;
    rRe[i] = 0.9 * Math.cos(angle);
    rIm[i] = 0.9 * Math.sin(angle);
  }

  for (let iter = 0; iter < 50; iter++) {
    let maxDelta = 0;

    for (let i = 0; i < n; i++) {
      // Evaluate polynomial at root[i] using Horner's method
      let pr = coefficients[0], pi = 0;
      const ri_re = rRe[i], ri_im = rIm[i];
      for (let j = 1; j <= n; j++) {
        const newR = pr * ri_re - pi * ri_im + coefficients[j];
        pi = pr * ri_im + pi * ri_re;
        pr = newR;
      }

      // Product of (root[i] - root[j]) for j != i
      let qr = 1, qi = 0;
      for (let j = 0; j < n; j++) {
        if (j === i) continue;
        const dr = ri_re - rRe[j];
        const di = ri_im - rIm[j];
        const newR = qr * dr - qi * di;
        qi = qr * di + qi * dr;
        qr = newR;
      }

      const denom = qr * qr + qi * qi;
      if (denom < 1e-30) continue;
      const deltaR = (pr * qr + pi * qi) / denom;
      const deltaI = (pi * qr - pr * qi) / denom;

      rRe[i] = ri_re - deltaR;
      rIm[i] = ri_im - deltaI;

      const mag = deltaR * deltaR + deltaI * deltaI;
      if (mag > maxDelta) maxDelta = mag;
    }

    // Compare squared magnitude against squared threshold (avoid sqrt)
    if (maxDelta < 1e-20) break;
  }

  return n;
}

// Default configuration (48 kHz, 50 ms window) so the extractor is usable
// before the worker's 'init' message, as the in-worker code was.
configureFormants(48000, Math.floor(48000 * 0.05));
