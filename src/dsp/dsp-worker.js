// dsp-worker.js — Web Worker that performs all DSP analysis off the main thread
// Pitch detection (YIN), formant extraction (Burg LPC), spectral tilt, HNR, intensity

const WINDOW_MS = 50;
let sampleRate = 48000;
let windowSize = Math.floor(sampleRate * WINDOW_MS / 1000);

// Formant extraction parameters — computed on init
let decimationFactor = 4;
let targetSR = 12000;
// LPC order 10 models up to 5 formants (2 poles per formant) — sufficient for
// F1-F4 extraction from speech downsampled to ~12 kHz.
const LPC_ORDER = 10;
// Pre-computed FIR anti-alias filter for decimation (re-computed on 'init' message).
// Initialize with default decimation factor so the worker is ready before 'init'.
let antiAliasFilter = null; // populated below after designLowPassFIR is defined

// Pre-allocated ring buffer to avoid GC pressure from repeated allocations.
// Uses a fixed-size buffer with a write position; oldest data is overwritten.
let ringCapacity = windowSize * 2;
let ringBuffer = new Float32Array(ringCapacity);
let ringLen = 0; // how many valid samples are in the buffer
let analysisCount = 0;

// Diagnostic: track pending chunks for queue depth monitoring
let pendingChunks = 0;
let lastContextTime = 0; // AudioContext time when latest chunk was captured

// --- Pre-allocated buffers for zero-GC-pressure hot path ---
// These are sized for the default 48 kHz sample rate and re-allocated on 'init'.
let _preEmph = new Float64Array(windowSize);
let _windowed = new Float64Array(windowSize);
let _decimated = new Float64Array(Math.floor(windowSize / decimationFactor));

// YIN pitch: FFT-based autocorrelation buffers.
// FFT size must be >= 2*windowSize and a power of 2.
let _yinFftLen = 1;
{ let _n = windowSize; while (_yinFftLen < _n * 2) _yinFftLen <<= 1; }
let _yinRe = new Float64Array(_yinFftLen);
let _yinIm = new Float64Array(_yinFftLen);
let _yinDiff = new Float32Array(windowSize);
let _yinCmnd = new Float32Array(windowSize);

// Spectral tilt: 2048-point FFT (fixed size, independent of sample rate)
const _tiltRe = new Float64Array(2048);
const _tiltIm = new Float64Array(2048);

// HNR: 4096-point FFT (fixed, accommodates 2048 samples zero-padded)
const _hnrRe = new Float64Array(4096);
const _hnrIm = new Float64Array(4096);

// Burg LPC: pre-allocated prediction error buffers (sized for decimated length)
let _burgEf = new Float64Array(Math.floor(windowSize / decimationFactor));
let _burgEb = new Float64Array(Math.floor(windowSize / decimationFactor));
let _burgEfTmp = new Float64Array(Math.floor(windowSize / decimationFactor));
let _burgA = new Float64Array(LPC_ORDER + 1);
let _burgANew = new Float64Array(LPC_ORDER + 1);

// Root finding: flat typed arrays instead of object arrays (2 doubles per root)
let _rootsRe = new Float64Array(LPC_ORDER);
let _rootsIm = new Float64Array(LPC_ORDER);

// Formant selection scratch arrays (max LPC_ORDER/2 = 5 formants)
const _formantFreqs = new Float64Array(LPC_ORDER);
const _formantBws = new Float64Array(LPC_ORDER);

function processChunk(buffer, contextTime) {
  const chunkReceiveTime = performance.now();
  pendingChunks--;
  if (contextTime !== null && contextTime !== undefined) lastContextTime = contextTime;

  const chunk = new Float32Array(buffer);
  appendToRingBuffer(chunk);

  if (ringLen < windowSize) return;

  // Extract analysis window (last windowSize samples) without allocating
  const windowStart = ringLen - windowSize;
  const window = ringBuffer.subarray(windowStart, ringLen);
  const intensity = computeIntensity(window);
  const pitch = detectPitch(window, sampleRate);

  // Formants, spectral tilt, HNR are heavier — run every 6th analysis frame.
  // At ~30 fps DSP rate, this fires every ~200ms, saving significant CPU
  // (LPC + root finding + FFT) while still being responsive enough for training.
  let formants = null, spectralTilt = null, hnr = null;
  if (analysisCount % 6 === 0) {
    formants = extractFormants(window);
    spectralTilt = computeSpectralTilt(window, sampleRate);
    hnr = computeHNR(window, sampleRate);
  }
  analysisCount++;

  const analysisEndTime = performance.now();

  self.postMessage({
    type: "analysis",
    data: {
      pitch, intensity, formants, spectralTilt, hnr,
      // Absolute timestamp comparable across threads
      absoluteTime: performance.timeOrigin + performance.now(),
      // Diagnostic fields
      workerProcessingMs: analysisEndTime - chunkReceiveTime,
      pendingChunks,
      contextTime: lastContextTime, // AudioContext time when audio was captured
    },
  });
}

self.onmessage = (e) => {
  const { type } = e.data;

  if (type === "init") {
    sampleRate = e.data.sampleRate;
    windowSize = Math.floor(sampleRate * WINDOW_MS / 1000);
    decimationFactor = Math.max(1, Math.round(sampleRate / 11000));
    targetSR = sampleRate / decimationFactor;
    antiAliasFilter = designLowPassFIR(0.4 / decimationFactor, decimationFactor * 16 + 1);
    ringCapacity = windowSize * 2;
    ringBuffer = new Float32Array(ringCapacity);
    ringLen = 0;
    analysisCount = 0;

    // Re-allocate pre-sized buffers for new sample rate
    const decLen = Math.floor(windowSize / decimationFactor);
    _preEmph = new Float64Array(windowSize);
    _windowed = new Float64Array(windowSize);
    _decimated = new Float64Array(decLen);
    _burgEf = new Float64Array(decLen);
    _burgEb = new Float64Array(decLen);
    _burgEfTmp = new Float64Array(decLen);
    _burgA = new Float64Array(LPC_ORDER + 1);
    _burgANew = new Float64Array(LPC_ORDER + 1);
    _rootsRe = new Float64Array(LPC_ORDER);
    _rootsIm = new Float64Array(LPC_ORDER);

    // YIN FFT buffers
    _yinFftLen = 1;
    while (_yinFftLen < windowSize * 2) _yinFftLen <<= 1;
    _yinRe = new Float64Array(_yinFftLen);
    _yinIm = new Float64Array(_yinFftLen);
    _yinDiff = new Float32Array(windowSize);
    _yinCmnd = new Float32Array(windowSize);
    return;
  }

  // Direct MessagePort from AudioWorklet (bypasses main thread)
  if (type === "port") {
    const port = e.data.port;
    port.onmessage = (ev) => {
      pendingChunks++;
      // Worklet sends {buffer, contextTime} — extract both
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

// --- YIN Pitch Detection (FFT-accelerated) ---
// Uses FFT-based autocorrelation to compute the YIN difference function in
// O(n log n) instead of O(n²). The difference function d(tau) can be expressed as:
//   d(tau) = r(0) + r_shifted(0) - 2*r_cross(tau)
// where r_cross is the cross-correlation computed via FFT.

function detectPitch(buffer, sr) {
  const threshold = 0.20;
  const minF0 = 75;
  const maxF0 = 600;
  const minLag = Math.floor(sr / maxF0);
  const maxLag = Math.floor(sr / minF0);
  const halfLen = Math.floor(buffer.length / 2);
  const searchLen = Math.min(maxLag + 2, halfLen);

  if (maxLag >= halfLen) return null;

  const N = buffer.length;
  const fftLen = _yinFftLen;
  const re = _yinRe;
  const im = _yinIm;

  // Zero-fill and load buffer into FFT arrays
  re.fill(0);
  im.fill(0);
  for (let i = 0; i < N; i++) re[i] = buffer[i];

  // Autocorrelation via FFT: IFFT(|FFT(x)|²)
  fft(re, im);
  for (let i = 0; i < fftLen; i++) {
    re[i] = re[i] * re[i] + im[i] * im[i];
    im[i] = 0;
  }
  fft(re, im);
  // re[tau] / fftLen = autocorrelation at lag tau

  // Compute cumulative energy for the difference function:
  // d(tau) = cumEnergy[tau] + cumEnergy[tau] - 2 * autocorr(tau)
  // More precisely: d(tau) = sum_{i=0}^{halfLen-1} (x[i] - x[i+tau])^2
  //   = sum x[i]^2 (for i in [0,halfLen)) + sum x[i+tau]^2 (for i in [0,halfLen)) - 2*crosscorr(tau)
  // We precompute prefix sums for the squared signal to get these partial sums in O(1).

  const diff = _yinDiff;
  // Energy of first half: sum_{i=0}^{halfLen-1} x[i]^2
  let leftEnergy = 0;
  for (let i = 0; i < halfLen; i++) leftEnergy += buffer[i] * buffer[i];

  // For each tau, right energy = sum_{i=tau}^{tau+halfLen-1} x[i]^2
  // We can compute this incrementally
  let rightEnergy = leftEnergy; // tau=0: same as left
  diff[0] = 0;

  for (let tau = 1; tau < searchLen; tau++) {
    // Update right energy: remove x[tau-1]^2, add x[tau+halfLen-1]^2
    rightEnergy -= buffer[tau - 1] * buffer[tau - 1];
    if (tau + halfLen - 1 < N) {
      rightEnergy += buffer[tau + halfLen - 1] * buffer[tau + halfLen - 1];
    }
    const autocorr = re[tau] / fftLen;
    diff[tau] = leftEnergy + rightEnergy - 2 * autocorr;
  }

  // Step 2: Cumulative mean normalized difference
  const cmnd = _yinCmnd;
  cmnd[0] = 1;
  let runningSum = 0;
  for (let tau = 1; tau < searchLen; tau++) {
    runningSum += diff[tau];
    cmnd[tau] = diff[tau] / (runningSum / tau);
  }

  // Step 3: Absolute threshold
  let bestTau = -1;
  for (let tau = minLag; tau < Math.min(maxLag, searchLen); tau++) {
    if (cmnd[tau] < threshold) {
      while (tau + 1 < searchLen && cmnd[tau + 1] < cmnd[tau]) tau++;
      bestTau = tau;
      break;
    }
  }

  if (bestTau === -1) return null;

  // Step 4: Parabolic interpolation
  const s0 = bestTau > 0 ? cmnd[bestTau - 1] : cmnd[bestTau];
  const s1 = cmnd[bestTau];
  const s2 = bestTau + 1 < searchLen ? cmnd[bestTau + 1] : cmnd[bestTau];
  const denom = 2 * (s0 - 2 * s1 + s2);
  let refinedTau = denom !== 0 ? bestTau + (s0 - s2) / denom : bestTau;

  const minTauVal = sr / maxF0;
  const maxTauVal = sr / minF0;
  refinedTau = Math.max(minTauVal, Math.min(maxTauVal, refinedTau));

  return sr / refinedTau;
}

// --- Formant Extraction (Burg LPC) ---

function extractFormants(buffer) {
  const n = buffer.length;

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
  const decLen = decimateWithFilter(_windowed, decimationFactor);

  // Burg LPC (uses pre-allocated buffers internally)
  const coefficients = burgLPC(_decimated.subarray(0, decLen), LPC_ORDER);

  // Find polynomial roots (uses pre-allocated flat arrays)
  const rootCount = findPolynomialRoots(coefficients);

  // Convert roots to formant frequencies + bandwidths
  // Use a small fixed-size scratch array to avoid allocations
  let fCount = 0;
  const fFreqs = _formantFreqs;
  const fBws = _formantBws;
  for (let i = 0; i < rootCount; i++) {
    if (_rootsIm[i] <= 0) continue;

    const freq = (Math.atan2(_rootsIm[i], _rootsRe[i]) * targetSR) / (2 * Math.PI);
    const mag = Math.sqrt(_rootsRe[i] * _rootsRe[i] + _rootsIm[i] * _rootsIm[i]);
    const bw = mag > 0 ? (-Math.log(mag) * targetSR) / Math.PI : Infinity;

    if (freq > 90 && freq < 5500 && bw > 0 && bw < 600) {
      fFreqs[fCount] = freq;
      fBws[fCount] = bw;
      fCount++;
    }
  }

  // Sort by frequency (insertion sort — at most 5 elements)
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

// Initialize default anti-alias filter (matches default decimationFactor = 4)
antiAliasFilter = designLowPassFIR(0.4 / decimationFactor, decimationFactor * 16 + 1);

// Downsample with FIR anti-alias filtering to prevent aliasing artifacts.
// Writes result into pre-allocated _decimated buffer. Returns the decimated length.
function decimateWithFilter(buffer, factor) {
  if (factor <= 1) {
    // Copy into _decimated for consistency
    for (let i = 0; i < buffer.length; i++) _decimated[i] = buffer[i];
    return buffer.length;
  }
  const taps = antiAliasFilter;
  const numTaps = taps.length;
  const halfTaps = numTaps >> 1;
  const bufLen = buffer.length;
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
// Takes a buffer (the pre-allocated _decimated) and its valid length.
// Returns _burgA (the coefficient array) directly.
function burgLPC(samples, order) {
  const n = samples.length;
  const a = _burgA;
  const aNew = _burgANew;
  const ef = _burgEf;
  const eb = _burgEb;
  const efTmp = _burgEfTmp;

  a.fill(0);
  a[0] = 1;

  // Initialize ef and eb from samples
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

    // Update prediction errors in-place: use efTmp as scratch for ef
    for (let i = m; i < n; i++) {
      efTmp[i] = ef[i] + k * eb[i - 1];
      eb[i] = eb[i - 1] + k * ef[i];
    }
    // Copy efTmp back to ef
    for (let i = m; i < n; i++) ef[i] = efTmp[i];
  }

  return a;
}

// Durand-Kerner method for finding all roots of a polynomial.
// Uses pre-allocated flat arrays _rootsRe/_rootsIm. Returns the root count (n).
// coefficients[0..n] where poly = c[0]*z^n + c[1]*z^(n-1) + ... + c[n]
function findPolynomialRoots(coefficients) {
  const n = coefficients.length - 1;
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

// --- HNR: Harmonics-to-Noise Ratio (FFT-based autocorrelation) ---

function computeHNR(buffer, sr) {
  const maxN = 2048;
  const n = Math.min(buffer.length, maxN);
  const offset = buffer.length - n;
  const fftLen = 4096; // Fixed: 2048 samples zero-padded to 4096
  const re = _hnrRe;
  const im = _hnrIm;

  // Zero-fill and load signal
  re.fill(0);
  im.fill(0);
  for (let i = 0; i < n; i++) re[i] = buffer[offset + i];

  fft(re, im);

  // Power spectrum in-place
  for (let i = 0; i < fftLen; i++) {
    re[i] = re[i] * re[i] + im[i] * im[i];
    im[i] = 0;
  }

  fft(re, im);
  const r0 = re[0] / fftLen;
  if (r0 === 0) return null;

  const minLag = Math.floor(sr / 600);
  const maxLag = Math.min(Math.floor(sr / 75), Math.floor(n / 2));
  let maxVal = 0;

  for (let lag = minLag; lag < maxLag; lag++) {
    const normalized = (re[lag] / fftLen) / r0;
    if (normalized > maxVal) maxVal = normalized;
  }

  if (maxVal <= 0) return null;
  maxVal = Math.min(maxVal, 0.99);
  return 10 * Math.log10(maxVal / (1 - maxVal));
}
