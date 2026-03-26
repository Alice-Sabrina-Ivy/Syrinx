// latency-benchmark.js — Per-stage latency benchmark for the Syrinx DSP pipeline.
// Generates synthetic speech (voiced + silence segments), chunks it into 50ms frames,
// and measures each analysis stage independently using process.hrtime.bigint().
//
// Usage: node tests/dsp/latency-benchmark.js
//
// Reports a per-stage breakdown table and total pipeline stats (mean, median, p95, max).

// ============================================================
//  DSP FUNCTIONS — copied from src/dsp/dsp-worker.js (optimized)
// ============================================================

const SAMPLE_RATE = 48000;
const WINDOW_MS = 50;
const WINDOW_SIZE = Math.floor(SAMPLE_RATE * WINDOW_MS / 1000); // 2400
const LPC_ORDER = 10;
const DECIMATION_FACTOR = Math.max(1, Math.round(SAMPLE_RATE / 11000)); // 4
const TARGET_SR = SAMPLE_RATE / DECIMATION_FACTOR; // 12000

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

const ANTI_ALIAS_TAPS = designLowPassFIR(0.4 / DECIMATION_FACTOR, DECIMATION_FACTOR * 16 + 1);

// --- Pre-allocated buffers (mirrors optimized dsp-worker.js) ---
let ringCapacity = WINDOW_SIZE * 2;
let ringBuffer = new Float32Array(ringCapacity);
let ringLen = 0;

// Formant pipeline pre-allocated buffers
const _preEmph = new Float64Array(WINDOW_SIZE);
const _windowed = new Float64Array(WINDOW_SIZE);
const _decimated = new Float64Array(Math.floor(WINDOW_SIZE / DECIMATION_FACTOR));

// YIN FFT buffers
let _yinFftLen = 1;
while (_yinFftLen < WINDOW_SIZE * 2) _yinFftLen <<= 1;
const _yinRe = new Float64Array(_yinFftLen);
const _yinIm = new Float64Array(_yinFftLen);
const _yinDiff = new Float32Array(WINDOW_SIZE);
const _yinCmnd = new Float32Array(WINDOW_SIZE);
const _yinCumSq = new Float64Array(WINDOW_SIZE + 1);

// Spectral tilt FFT buffers
const _tiltRe = new Float64Array(2048);
const _tiltIm = new Float64Array(2048);

// HNR FFT buffers
const _hnrRe = new Float64Array(4096);
const _hnrIm = new Float64Array(4096);

// Burg LPC buffers
const decLen = Math.floor(WINDOW_SIZE / DECIMATION_FACTOR);
const _burgEf = new Float64Array(decLen);
const _burgEb = new Float64Array(decLen);
const _burgEfTmp = new Float64Array(decLen);
const _burgEbTmp = new Float64Array(decLen);
const _burgA = new Float64Array(LPC_ORDER + 1);
const _burgANew = new Float64Array(LPC_ORDER + 1);

// Root finding flat arrays
const _rootsRe = new Float64Array(LPC_ORDER);
const _rootsIm = new Float64Array(LPC_ORDER);

// Formant scratch
const _formantFreqs = new Float64Array(LPC_ORDER);
const _formantBws = new Float64Array(LPC_ORDER);

function appendToRingBuffer(chunk) {
  if (ringLen + chunk.length <= ringCapacity) {
    ringBuffer.set(chunk, ringLen);
    ringLen += chunk.length;
  } else {
    const keepLen = Math.min(ringLen, ringCapacity - chunk.length);
    ringBuffer.copyWithin(0, ringLen - keepLen, ringLen);
    ringBuffer.set(chunk, keepLen);
    ringLen = keepLen + chunk.length;
  }
}

function resetRingBuffer() {
  ringBuffer = new Float32Array(ringCapacity);
  ringLen = 0;
}

// --- Intensity ---
function computeIntensity(buffer) {
  let sum = 0;
  for (let i = 0; i < buffer.length; i++) sum += buffer[i] * buffer[i];
  const rms = Math.sqrt(sum / buffer.length);
  if (rms === 0) return -Infinity;
  return 20 * Math.log10(rms);
}

// --- FFT (Radix-2 Cooley-Tukey, in-place) ---
function fft(re, im) {
  const n = re.length;
  if (n === 0 || (n & (n - 1)) !== 0) {
    throw new Error(`FFT length must be a power of 2, got ${n}`);
  }
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      let tmp = re[i]; re[i] = re[j]; re[j] = tmp;
      tmp = im[i]; im[i] = im[j]; im[j] = tmp;
    }
  }
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

// --- YIN Pitch Detection (FFT-accelerated) ---
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
  const fftLenVal = _yinFftLen;
  const re = _yinRe;
  const im = _yinIm;

  re.fill(0);
  im.fill(0);
  for (let i = 0; i < N; i++) re[i] = buffer[i];

  fft(re, im);
  for (let i = 0; i < fftLenVal; i++) {
    re[i] = re[i] * re[i] + im[i] * im[i];
    im[i] = 0;
  }
  fft(re, im);

  const diff = _yinDiff;

  // Prefix sum of x[i]^2 — matches FFT autocorrelation's summation range
  const cumSq = _yinCumSq;
  cumSq[0] = 0;
  for (let i = 0; i < N; i++) {
    cumSq[i + 1] = cumSq[i] + buffer[i] * buffer[i];
  }

  diff[0] = 0;
  for (let tau = 1; tau < searchLen; tau++) {
    const autocorr = re[tau] / fftLenVal;
    diff[tau] = cumSq[N - tau] + (cumSq[N] - cumSq[tau]) - 2 * autocorr;
  }

  const cmnd = _yinCmnd;
  cmnd[0] = 1;
  let runningSum = 0;
  for (let tau = 1; tau < searchLen; tau++) {
    runningSum += diff[tau];
    cmnd[tau] = diff[tau] / (runningSum / tau);
  }

  let bestTau = -1;
  for (let tau = minLag; tau < Math.min(maxLag, searchLen); tau++) {
    if (cmnd[tau] < threshold) {
      while (tau + 1 < searchLen && cmnd[tau + 1] < cmnd[tau]) tau++;
      bestTau = tau;
      break;
    }
  }
  if (bestTau === -1) return null;

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

// --- Formant sub-stages (pre-allocated) ---

function preEmphasize(buffer) {
  _preEmph[0] = buffer[0];
  for (let i = 1; i < buffer.length; i++) {
    _preEmph[i] = buffer[i] - 0.97 * buffer[i - 1];
  }
  return _preEmph;
}

function hammingWindow(preEmph, n) {
  for (let i = 0; i < n; i++) {
    _windowed[i] = preEmph[i] * (0.54 - 0.46 * Math.cos((2 * Math.PI * i) / (n - 1)));
  }
  return _windowed;
}

function decimateWithFilter(buffer, factor) {
  if (factor <= 1) {
    for (let i = 0; i < buffer.length; i++) _decimated[i] = buffer[i];
    return buffer.length;
  }
  const taps = ANTI_ALIAS_TAPS;
  const numTaps = taps.length;
  const halfTaps = numTaps >> 1;
  const bufLen = buffer.length;
  const newLen = Math.floor(bufLen / factor);
  for (let i = 0; i < newLen; i++) {
    let sum = 0;
    const center = i * factor;
    const jStart = Math.max(0, halfTaps - center);
    const jEnd = Math.min(numTaps, bufLen - center + halfTaps);
    for (let j = jStart; j < jEnd; j++) {
      sum += buffer[center - halfTaps + j] * taps[j];
    }
    _decimated[i] = sum;
  }
  return newLen;
}

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

    aNew[0] = 1;
    for (let i = 1; i < m; i++) {
      aNew[i] = a[i] + k * a[m - i];
    }
    aNew[m] = k;
    for (let i = 0; i <= m; i++) a[i] = aNew[i];

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

function findPolynomialRoots(coefficients) {
  const n = coefficients.length - 1;
  if (n <= 0) return 0;

  const rRe = _rootsRe;
  const rIm = _rootsIm;

  for (let i = 0; i < n; i++) {
    const angle = (2 * Math.PI * i) / n + 0.4;
    rRe[i] = 0.9 * Math.cos(angle);
    rIm[i] = 0.9 * Math.sin(angle);
  }

  for (let iter = 0; iter < 50; iter++) {
    let maxDelta = 0;
    for (let i = 0; i < n; i++) {
      let pr = coefficients[0], pi = 0;
      const ri_re = rRe[i], ri_im = rIm[i];
      for (let j = 1; j <= n; j++) {
        const newR = pr * ri_re - pi * ri_im + coefficients[j];
        pi = pr * ri_im + pi * ri_re;
        pr = newR;
      }
      let qr = 1, qi = 0;
      for (let j = 0; j < n; j++) {
        if (j === i) continue;
        const dr = ri_re - rRe[j];
        const di = ri_im - rIm[j];
        const newR = qr * dr - qi * di;
        qi = qr * di + qi * dr;
        qr = newR;
      }
      const denomVal = qr * qr + qi * qi;
      if (denomVal < 1e-30) continue;
      const deltaR = (pr * qr + pi * qi) / denomVal;
      const deltaI = (pi * qr - pr * qi) / denomVal;
      rRe[i] = ri_re - deltaR;
      rIm[i] = ri_im - deltaI;
      const mag = deltaR * deltaR + deltaI * deltaI;
      if (mag > maxDelta) maxDelta = mag;
    }
    if (maxDelta < 1e-20) break;
  }
  return n;
}

function selectFormants(rootCount) {
  let fCount = 0;
  for (let i = 0; i < rootCount; i++) {
    if (_rootsIm[i] <= 0) continue;
    const freq = (Math.atan2(_rootsIm[i], _rootsRe[i]) * TARGET_SR) / (2 * Math.PI);
    const mag = Math.sqrt(_rootsRe[i] * _rootsRe[i] + _rootsIm[i] * _rootsIm[i]);
    const bw = mag > 0 ? (-Math.log(mag) * TARGET_SR) / Math.PI : Infinity;
    if (freq > 90 && freq < 5500 && bw > 0 && bw < 600) {
      _formantFreqs[fCount] = freq;
      _formantBws[fCount] = bw;
      fCount++;
    }
  }
  // Insertion sort
  for (let i = 1; i < fCount; i++) {
    const kf = _formantFreqs[i], kb = _formantBws[i];
    let j = i - 1;
    while (j >= 0 && _formantFreqs[j] > kf) {
      _formantFreqs[j + 1] = _formantFreqs[j];
      _formantBws[j + 1] = _formantBws[j];
      j--;
    }
    _formantFreqs[j + 1] = kf;
    _formantBws[j + 1] = kb;
  }
  return {
    f1: fCount > 0 ? _formantFreqs[0] : null,
    f2: fCount > 1 ? _formantFreqs[1] : null,
    f3: fCount > 2 ? _formantFreqs[2] : null,
  };
}

// --- Spectral Tilt ---
function computeSpectralTilt(buffer, sr) {
  const fftSize = 2048;
  const n = Math.min(buffer.length, fftSize);
  const re = _tiltRe;
  const im = _tiltIm;

  re.fill(0);
  im.fill(0);
  const offset = buffer.length - n;
  for (let i = 0; i < n; i++) {
    re[i] = buffer[offset + i] * (0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (n - 1)));
  }

  fft(re, im);

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

// --- HNR ---
function computeHNR(buffer, sr) {
  const maxN = 2048;
  const n = Math.min(buffer.length, maxN);
  const offset = buffer.length - n;
  const fftLenVal = 4096;
  const re = _hnrRe;
  const im = _hnrIm;

  re.fill(0);
  im.fill(0);
  for (let i = 0; i < n; i++) re[i] = buffer[offset + i];

  fft(re, im);
  for (let i = 0; i < fftLenVal; i++) {
    re[i] = re[i] * re[i] + im[i] * im[i];
    im[i] = 0;
  }
  fft(re, im);

  const r0 = re[0] / fftLenVal;
  if (r0 === 0) return null;

  const minLag = Math.floor(sr / 600);
  const maxLag = Math.min(Math.floor(sr / 75), Math.floor(n / 2));
  let maxVal = 0;
  for (let lag = minLag; lag < maxLag; lag++) {
    const normalized = (re[lag] / fftLenVal) / r0;
    if (normalized > maxVal) maxVal = normalized;
  }
  if (maxVal <= 0) return null;
  maxVal = Math.min(maxVal, 0.99);
  return 10 * Math.log10(maxVal / (1 - maxVal));
}

// --- Smoothing ---
function median(arr) {
  if (arr.length === 0) return 0;
  const s = arr.slice().sort((a, b) => a - b);
  const mid = s.length >> 1;
  return s.length & 1 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

const PITCH_SMOOTH_LEN = 2;
const FORMANT_SMOOTH_LEN = 7;

class ResultSmoother {
  constructor() {
    this.pitchBuf = [];
    this.f1Buf = [];
    this.f2Buf = [];
    this.f3Buf = [];
  }
  smooth(pitch, formants) {
    if (pitch != null) {
      this.pitchBuf.push(pitch);
      if (this.pitchBuf.length > PITCH_SMOOTH_LEN) this.pitchBuf.shift();
    }
    const smoothedPitch = this.pitchBuf.length > 0 ? median(this.pitchBuf) : null;
    let sf1 = null, sf2 = null, sf3 = null;
    if (formants) {
      if (formants.f1 != null) {
        this.f1Buf.push(formants.f1);
        if (this.f1Buf.length > FORMANT_SMOOTH_LEN) this.f1Buf.shift();
      }
      if (formants.f2 != null) {
        this.f2Buf.push(formants.f2);
        if (this.f2Buf.length > FORMANT_SMOOTH_LEN) this.f2Buf.shift();
      }
      if (formants.f3 != null) {
        this.f3Buf.push(formants.f3);
        if (this.f3Buf.length > FORMANT_SMOOTH_LEN) this.f3Buf.shift();
      }
      sf1 = this.f1Buf.length > 0 ? median(this.f1Buf) : null;
      sf2 = this.f2Buf.length > 0 ? median(this.f2Buf) : null;
      sf3 = this.f3Buf.length > 0 ? median(this.f3Buf) : null;
    }
    return { pitch: smoothedPitch, f1: sf1, f2: sf2, f3: sf3 };
  }
}

// ============================================================
//  SYNTHETIC SPEECH SIGNAL GENERATION
// ============================================================

function biquadResonator(signal, centerFreq, bandwidth, sampleRate) {
  const r = Math.exp(-Math.PI * bandwidth / sampleRate);
  const theta = 2 * Math.PI * centerFreq / sampleRate;
  const a1 = -2 * r * Math.cos(theta);
  const a2 = r * r;
  const output = new Float64Array(signal.length);
  let y1 = 0, y2 = 0;
  for (let i = 0; i < signal.length; i++) {
    const y = signal[i] - a1 * y1 - a2 * y2;
    output[i] = y;
    y2 = y1;
    y1 = y;
  }
  return output;
}

function generateSyntheticSpeech(durationSec, sampleRate) {
  const totalSamples = Math.floor(sampleRate * durationSec);
  const signal = new Float32Array(totalSamples);

  const vowels = [
    { f0: 150, formants: [700, 1200, 2600], bws: [80, 90, 120] },
    { f0: 180, formants: [300, 2200, 3000], bws: [60, 100, 120] },
    { f0: 200, formants: [350, 800, 2200], bws: [60, 80, 120] },
    { f0: 220, formants: [900, 1500, 2800], bws: [80, 100, 130] },
    { f0: 160, formants: [400, 2000, 2800], bws: [70, 90, 110] },
  ];

  const voicedMs = 500;
  const silenceMs = 200;
  const cycleMs = voicedMs + silenceMs;
  const cycleSamples = Math.floor(sampleRate * cycleMs / 1000);
  const voicedSamples = Math.floor(sampleRate * voicedMs / 1000);

  let pos = 0;
  let vowelIdx = 0;

  while (pos < totalSamples) {
    const cycleEnd = Math.min(pos + cycleSamples, totalSamples);
    const voicedEnd = Math.min(pos + voicedSamples, totalSamples);

    const v = vowels[vowelIdx % vowels.length];
    const segLen = voicedEnd - pos;
    if (segLen > 0) {
      const seg = new Float64Array(segLen);
      const period = Math.round(sampleRate / v.f0);
      for (let i = 0; i < segLen; i += period) seg[i] = 1.0;

      const tilted = new Float64Array(segLen);
      tilted[0] = seg[0];
      for (let i = 1; i < segLen; i++) tilted[i] = seg[i] + 0.98 * tilted[i - 1];

      let filtered = tilted;
      for (let f = 0; f < v.formants.length; f++) {
        filtered = biquadResonator(filtered, v.formants[f], v.bws[f], sampleRate);
      }

      let maxAbs = 0;
      for (let i = 0; i < segLen; i++) {
        filtered[i] += (Math.random() - 0.5) * 0.001;
        if (Math.abs(filtered[i]) > maxAbs) maxAbs = Math.abs(filtered[i]);
      }
      if (maxAbs > 0) {
        for (let i = 0; i < segLen; i++) signal[pos + i] = filtered[i] / maxAbs * 0.8;
      }
    }

    pos = cycleEnd;
    vowelIdx++;
  }

  return signal;
}

// ============================================================
//  TIMING UTILITIES
// ============================================================

function nsToMs(ns) {
  return Number(ns) / 1e6;
}

function stats(arr) {
  if (arr.length === 0) return { mean: 0, median: 0, p95: 0, max: 0 };
  const sorted = arr.slice().sort((a, b) => a - b);
  const sum = sorted.reduce((a, b) => a + b, 0);
  const mid = sorted.length >> 1;
  const med = sorted.length & 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
  const p95Idx = Math.min(Math.floor(sorted.length * 0.95), sorted.length - 1);
  return {
    mean: sum / sorted.length,
    median: med,
    p95: sorted[p95Idx],
    max: sorted[sorted.length - 1],
  };
}

// ============================================================
//  BENCHMARK RUNNER
// ============================================================

function runBenchmark(label) {
  console.log("================================================================");
  console.log(`       Syrinx DSP Pipeline Latency Benchmark — ${label}`);
  console.log("================================================================");
  console.log(`Sample rate: ${SAMPLE_RATE} Hz`);
  console.log(`Window: ${WINDOW_MS} ms (${WINDOW_SIZE} samples)`);
  console.log(`Chunk: ${WINDOW_MS} ms (${WINDOW_SIZE} samples)`);
  console.log(`LPC order: ${LPC_ORDER}, Decimation: x${DECIMATION_FACTOR}`);
  console.log(`FIR taps: ${ANTI_ALIAS_TAPS.length}`);
  console.log();

  console.log("Generating 10s synthetic speech signal...");
  const signal = generateSyntheticSpeech(10, SAMPLE_RATE);
  console.log(`  Signal length: ${signal.length} samples (${(signal.length / SAMPLE_RATE).toFixed(1)}s)`);

  const chunkSize = WINDOW_SIZE;
  const chunks = [];
  for (let i = 0; i + chunkSize <= signal.length; i += chunkSize) {
    chunks.push(signal.subarray(i, i + chunkSize));
  }
  console.log(`  Chunks: ${chunks.length} x ${chunkSize} samples\n`);

  const stageNames = [
    "A: Ring buffer append",
    "B: Pre-emphasis + window",
    "C: Downsampling",
    "D: Burg LPC",
    "E: Root finding (D-K)",
    "F: Formant selection",
    "G: Pitch detection (YIN)",
    "H: Spectral tilt (FFT)",
    "I: HNR (FFT autocorr)",
    "J: Smoothing",
  ];
  const stageTimes = stageNames.map(() => []);
  const totalTimes = [];

  // Warmup
  resetRingBuffer();
  for (let i = 0; i < Math.min(5, chunks.length); i++) {
    const chunk = chunks[i];
    appendToRingBuffer(chunk);
    if (ringLen >= WINDOW_SIZE) {
      const win = ringBuffer.subarray(ringLen - WINDOW_SIZE, ringLen);
      preEmphasize(win);
      hammingWindow(_preEmph, win.length);
      const dl = decimateWithFilter(_windowed, DECIMATION_FACTOR);
      const coeffs = burgLPC(_decimated.subarray(0, dl), LPC_ORDER);
      findPolynomialRoots(coeffs);
      detectPitch(win, SAMPLE_RATE);
      computeSpectralTilt(win, SAMPLE_RATE);
      computeHNR(win, SAMPLE_RATE);
    }
  }

  resetRingBuffer();
  const smoother = new ResultSmoother();

  console.log("Running benchmark...\n");

  let analysisCount = 0;

  for (let i = 0; i < chunks.length; i++) {
    const chunk = chunks[i];
    const totalStart = process.hrtime.bigint();

    // Stage A: Ring buffer
    let t0 = process.hrtime.bigint();
    appendToRingBuffer(chunk);
    let window = null;
    if (ringLen >= WINDOW_SIZE) {
      window = new Float32Array(ringBuffer.subarray(ringLen - WINDOW_SIZE, ringLen));
    }
    let t1 = process.hrtime.bigint();
    stageTimes[0].push(nsToMs(t1 - t0));

    if (!window) continue;

    // Stage G: Pitch detection (always runs)
    t0 = process.hrtime.bigint();
    const pitch = detectPitch(window, SAMPLE_RATE);
    t1 = process.hrtime.bigint();
    stageTimes[6].push(nsToMs(t1 - t0));

    let formants = null, spectralTilt = null, hnr = null;
    const isHeavyFrame = analysisCount % 6 === 0;

    if (isHeavyFrame) {
      // Stage B
      t0 = process.hrtime.bigint();
      preEmphasize(window);
      hammingWindow(_preEmph, window.length);
      t1 = process.hrtime.bigint();
      stageTimes[1].push(nsToMs(t1 - t0));

      // Stage C
      t0 = process.hrtime.bigint();
      const dl = decimateWithFilter(_windowed, DECIMATION_FACTOR);
      t1 = process.hrtime.bigint();
      stageTimes[2].push(nsToMs(t1 - t0));

      // Stage D
      t0 = process.hrtime.bigint();
      const coefficients = burgLPC(_decimated.subarray(0, dl), LPC_ORDER);
      t1 = process.hrtime.bigint();
      stageTimes[3].push(nsToMs(t1 - t0));

      // Stage E
      t0 = process.hrtime.bigint();
      const rootCount = findPolynomialRoots(coefficients);
      t1 = process.hrtime.bigint();
      stageTimes[4].push(nsToMs(t1 - t0));

      // Stage F
      t0 = process.hrtime.bigint();
      formants = selectFormants(rootCount);
      t1 = process.hrtime.bigint();
      stageTimes[5].push(nsToMs(t1 - t0));

      // Stage H
      t0 = process.hrtime.bigint();
      spectralTilt = computeSpectralTilt(window, SAMPLE_RATE);
      t1 = process.hrtime.bigint();
      stageTimes[7].push(nsToMs(t1 - t0));

      // Stage I
      t0 = process.hrtime.bigint();
      hnr = computeHNR(window, SAMPLE_RATE);
      t1 = process.hrtime.bigint();
      stageTimes[8].push(nsToMs(t1 - t0));
    }

    // Stage J
    t0 = process.hrtime.bigint();
    smoother.smooth(pitch, formants);
    t1 = process.hrtime.bigint();
    stageTimes[9].push(nsToMs(t1 - t0));

    const totalEnd = process.hrtime.bigint();
    totalTimes.push(nsToMs(totalEnd - totalStart));

    analysisCount++;
  }

  // Report
  const heavyFrameCount = stageTimes[1].length;

  console.log(`  Total frames: ${totalTimes.length} (${heavyFrameCount} heavy, ${totalTimes.length - heavyFrameCount} light)\n`);

  const totalMeanSum = stageNames.reduce((sum, _, idx) => {
    const s = stats(stageTimes[idx]);
    return sum + s.mean * stageTimes[idx].length / totalTimes.length;
  }, 0);

  console.log("  Stage                      |  Count |  Mean ms |  Med ms  |  Max ms  |  % total");
  console.log("  ---------------------------+--------+----------+----------+----------+---------");

  for (let idx = 0; idx < stageNames.length; idx++) {
    const s = stats(stageTimes[idx]);
    const count = stageTimes[idx].length;
    const pctContrib = totalMeanSum > 0 ? (s.mean * count / totalTimes.length) / totalMeanSum * 100 : 0;
    console.log(
      `  ${stageNames[idx].padEnd(27)} | ${String(count).padStart(6)} | ${s.mean.toFixed(4).padStart(8)} | ${s.median.toFixed(4).padStart(8)} | ${s.max.toFixed(4).padStart(8)} | ${pctContrib.toFixed(1).padStart(6)}%`
    );
  }

  console.log();

  const allStats = stats(totalTimes);
  console.log("  Total pipeline per frame:");
  console.log(`    Mean:   ${allStats.mean.toFixed(4)} ms`);
  console.log(`    Median: ${allStats.median.toFixed(4)} ms`);
  console.log(`    P95:    ${allStats.p95.toFixed(4)} ms`);
  console.log(`    Max:    ${allStats.max.toFixed(4)} ms`);
  console.log(`    Target: < 8.000 ms`);
  console.log(`    Status: ${allStats.p95 < 8.0 ? "PASS" : "NEEDS OPTIMIZATION"}`);
  console.log();

  return { stageTimes, totalTimes, stageNames, allStats };
}

const results = runBenchmark("OPTIMIZED");

if (typeof module !== 'undefined') {
  module.exports = { runBenchmark };
}
