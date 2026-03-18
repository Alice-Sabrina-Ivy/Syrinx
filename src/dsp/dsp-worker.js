// dsp-worker.js — Web Worker that performs all DSP analysis off the main thread
// Pitch detection (YIN), formant extraction (Burg LPC), and intensity

const WINDOW_MS = 200;
let sampleRate = 48000;
let windowSize = Math.floor(sampleRate * WINDOW_MS / 1000);

// Formant extraction parameters — computed on init
let decimationFactor = 4;
let targetSR = 12000;
const LPC_ORDER = 10;

let ringBuffer = new Float32Array(0);

self.onmessage = (e) => {
  const { type } = e.data;

  if (type === "init") {
    sampleRate = e.data.sampleRate;
    windowSize = Math.floor(sampleRate * WINDOW_MS / 1000);
    decimationFactor = Math.max(1, Math.round(sampleRate / 11000));
    targetSR = sampleRate / decimationFactor;
    ringBuffer = new Float32Array(0);
    return;
  }

  if (type === "chunk") {
    const chunk = new Float32Array(e.data.buffer);
    appendToRingBuffer(chunk);

    if (ringBuffer.length < windowSize) return;

    const window = ringBuffer.slice(-windowSize);
    const intensity = computeIntensity(window);
    const pitch = detectPitch(window, sampleRate);
    const formants = extractFormants(window);
    const spectralTilt = computeSpectralTilt(window, sampleRate);
    const hnr = computeHNR(window, sampleRate);

    self.postMessage({
      type: "analysis",
      data: { pitch, intensity, formants, spectralTilt, hnr, timestamp: performance.now() },
    });
  }
};

// --- Ring buffer ---

function appendToRingBuffer(chunk) {
  const maxLen = windowSize * 2;
  const newLen = ringBuffer.length + chunk.length;
  if (newLen <= maxLen) {
    const newBuf = new Float32Array(newLen);
    newBuf.set(ringBuffer);
    newBuf.set(chunk, ringBuffer.length);
    ringBuffer = newBuf;
  } else {
    const keepLen = Math.min(ringBuffer.length, maxLen - chunk.length);
    const newBuf = new Float32Array(keepLen + chunk.length);
    newBuf.set(ringBuffer.subarray(ringBuffer.length - keepLen));
    newBuf.set(chunk, keepLen);
    ringBuffer = newBuf;
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

// --- YIN Pitch Detection ---

function detectPitch(buffer, sr) {
  const threshold = 0.15;
  const minF0 = 75;
  const maxF0 = 600;
  const minLag = Math.floor(sr / maxF0);
  const maxLag = Math.floor(sr / minF0);
  const halfLen = Math.floor(buffer.length / 2);

  if (maxLag >= halfLen) return null;

  // Step 1: Difference function
  const diff = new Float32Array(halfLen);
  for (let tau = 1; tau < halfLen; tau++) {
    let sum = 0;
    for (let i = 0; i < halfLen; i++) {
      const d = buffer[i] - buffer[i + tau];
      sum += d * d;
    }
    diff[tau] = sum;
  }

  // Step 2: Cumulative mean normalized difference
  const cmnd = new Float32Array(halfLen);
  cmnd[0] = 1;
  let runningSum = 0;
  for (let tau = 1; tau < halfLen; tau++) {
    runningSum += diff[tau];
    cmnd[tau] = diff[tau] / (runningSum / tau);
  }

  // Step 3: Absolute threshold
  let bestTau = -1;
  for (let tau = minLag; tau < Math.min(maxLag, halfLen); tau++) {
    if (cmnd[tau] < threshold) {
      while (tau + 1 < halfLen && cmnd[tau + 1] < cmnd[tau]) tau++;
      bestTau = tau;
      break;
    }
  }

  if (bestTau === -1) return null;

  // Step 4: Parabolic interpolation
  const s0 = bestTau > 0 ? cmnd[bestTau - 1] : cmnd[bestTau];
  const s1 = cmnd[bestTau];
  const s2 = bestTau + 1 < halfLen ? cmnd[bestTau + 1] : cmnd[bestTau];
  const denom = 2 * (s0 - 2 * s1 + s2);
  const refinedTau = denom !== 0 ? bestTau + (s0 - s2) / denom : bestTau;

  const pitch = sr / refinedTau;
  if (pitch < minF0 || pitch > maxF0) return null;
  return pitch;
}

// --- Formant Extraction (Burg LPC) ---

function extractFormants(buffer) {
  // Pre-emphasis: boost high frequencies
  const preEmph = new Float64Array(buffer.length);
  preEmph[0] = buffer[0];
  for (let i = 1; i < buffer.length; i++) {
    preEmph[i] = buffer[i] - 0.97 * buffer[i - 1];
  }

  // Hamming window
  const n = preEmph.length;
  const windowed = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    windowed[i] = preEmph[i] * (0.54 - 0.46 * Math.cos((2 * Math.PI * i) / (n - 1)));
  }

  // Downsample
  const downsampled = decimateWithAvg(windowed, decimationFactor);

  // Burg LPC
  const { coefficients } = burgLPC(downsampled, LPC_ORDER);

  // Find polynomial roots
  const roots = findPolynomialRoots(coefficients);

  // Convert roots to formant frequencies + bandwidths
  const formants = [];
  for (const root of roots) {
    if (root.imag <= 0) continue; // Only positive frequencies

    const freq = (Math.atan2(root.imag, root.real) * targetSR) / (2 * Math.PI);
    const mag = Math.sqrt(root.real * root.real + root.imag * root.imag);
    const bw = mag > 0 ? (-Math.log(mag) * targetSR) / Math.PI : Infinity;

    // Valid formants: 90-5500 Hz with bandwidth < 600 Hz
    if (freq > 90 && freq < 5500 && bw > 0 && bw < 600) {
      formants.push({ freq, bw });
    }
  }

  formants.sort((a, b) => a.freq - b.freq);

  return {
    f1: formants[0]?.freq || null,
    f2: formants[1]?.freq || null,
    f3: formants[2]?.freq || null,
  };
}

// Downsample by averaging groups of `factor` samples
function decimateWithAvg(buffer, factor) {
  if (factor <= 1) return buffer;
  const newLen = Math.floor(buffer.length / factor);
  const result = new Float64Array(newLen);
  for (let i = 0; i < newLen; i++) {
    let sum = 0;
    const base = i * factor;
    for (let j = 0; j < factor; j++) sum += buffer[base + j];
    result[i] = sum / factor;
  }
  return result;
}

// Burg LPC algorithm
function burgLPC(samples, order) {
  const n = samples.length;
  const a = new Float64Array(order + 1);
  a[0] = 1;

  let ef = Float64Array.from(samples);
  let eb = Float64Array.from(samples);
  let errorPower = 0;
  for (let i = 0; i < n; i++) errorPower += samples[i] * samples[i];
  errorPower /= n;

  for (let m = 1; m <= order; m++) {
    let num = 0,
      den = 0;
    for (let i = m; i < n; i++) {
      num += ef[i] * eb[i - 1];
      den += ef[i] * ef[i] + eb[i - 1] * eb[i - 1];
    }
    if (den === 0) break;
    const k = (-2 * num) / den;

    // Update LPC coefficients
    const aNew = new Float64Array(order + 1);
    aNew[0] = 1;
    for (let i = 1; i < m; i++) {
      aNew[i] = a[i] + k * a[m - i];
    }
    aNew[m] = k;

    // Update prediction errors
    const efNew = new Float64Array(n);
    const ebNew = new Float64Array(n);
    for (let i = m; i < n; i++) {
      efNew[i] = ef[i] + k * eb[i - 1];
      ebNew[i] = eb[i - 1] + k * ef[i];
    }
    ef = efNew;
    eb = ebNew;
    a.set(aNew);
    errorPower *= 1 - k * k;
  }

  return { coefficients: a, error: errorPower };
}

// Durand-Kerner method for finding all roots of a polynomial
// coefficients[0..n] where poly = c[0]*z^n + c[1]*z^(n-1) + ... + c[n]
function findPolynomialRoots(coefficients) {
  const n = coefficients.length - 1; // Polynomial degree
  if (n <= 0) return [];

  // Initial guesses: spread on a circle with slight offset
  const roots = [];
  for (let i = 0; i < n; i++) {
    const angle = (2 * Math.PI * i) / n + 0.4;
    const r = 0.9;
    roots.push({ real: r * Math.cos(angle), imag: r * Math.sin(angle) });
  }

  // Iterate
  for (let iter = 0; iter < 80; iter++) {
    let maxDelta = 0;

    for (let i = 0; i < n; i++) {
      // Evaluate polynomial at roots[i] using Horner's method
      let pr = coefficients[0],
        pi = 0;
      for (let j = 1; j <= n; j++) {
        const newR = pr * roots[i].real - pi * roots[i].imag + coefficients[j];
        const newI = pr * roots[i].imag + pi * roots[i].real;
        pr = newR;
        pi = newI;
      }

      // Compute product of (roots[i] - roots[j]) for j != i
      let qr = 1,
        qi = 0;
      for (let j = 0; j < n; j++) {
        if (j === i) continue;
        const dr = roots[i].real - roots[j].real;
        const di = roots[i].imag - roots[j].imag;
        const newR = qr * dr - qi * di;
        const newI = qr * di + qi * dr;
        qr = newR;
        qi = newI;
      }

      // delta = p(z_i) / product
      const denom = qr * qr + qi * qi;
      if (denom < 1e-30) continue;
      const deltaR = (pr * qr + pi * qi) / denom;
      const deltaI = (pi * qr - pr * qi) / denom;

      roots[i].real -= deltaR;
      roots[i].imag -= deltaI;

      const mag = Math.sqrt(deltaR * deltaR + deltaI * deltaI);
      if (mag > maxDelta) maxDelta = mag;
    }

    if (maxDelta < 1e-10) break;
  }

  return roots;
}

// --- Radix-2 Cooley-Tukey FFT (in-place) ---

function fft(re, im) {
  const n = re.length;
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

  // Apply Hann window and zero-pad to fftSize
  const re = new Float64Array(fftSize);
  const im = new Float64Array(fftSize);
  for (let i = 0; i < n; i++) {
    re[i] = buffer[buffer.length - n + i] * (0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (n - 1)));
  }

  fft(re, im);

  const binHz = sr / fftSize;
  let lowEnergy = 0;
  let highEnergy = 0;

  for (let k = 1; k < fftSize / 2; k++) {
    const energy = re[k] * re[k] + im[k] * im[k];
    const freq = k * binHz;

    if (freq < 1000) lowEnergy += energy;
    else if (freq < 4000) highEnergy += energy;
  }

  if (highEnergy === 0) return null;
  return 10 * Math.log10(lowEnergy / highEnergy);
}

// --- HNR: Harmonics-to-Noise Ratio (FFT-based autocorrelation) ---

function computeHNR(buffer, sr) {
  // Use FFT to compute autocorrelation: IFFT(|FFT(x)|²)
  // Pad to next power of 2 × 2 to avoid circular correlation artifacts
  const n = buffer.length;
  let fftLen = 1;
  while (fftLen < n * 2) fftLen <<= 1;

  const re = new Float64Array(fftLen);
  const im = new Float64Array(fftLen);
  for (let i = 0; i < n; i++) re[i] = buffer[i];

  // Forward FFT
  fft(re, im);

  // Power spectrum → re, zero im
  for (let i = 0; i < fftLen; i++) {
    re[i] = re[i] * re[i] + im[i] * im[i];
    im[i] = 0;
  }

  // Inverse FFT (forward FFT + divide by N gives inverse)
  fft(re, im);
  const r0 = re[0] / fftLen; // autocorrelation at lag 0
  if (r0 === 0) return null;

  // Find max normalized autocorrelation in pitch range (75-600 Hz)
  const minLag = Math.floor(sr / 600);
  const maxLag = Math.min(Math.floor(sr / 75), Math.floor(n / 2));
  let maxVal = 0;

  for (let lag = minLag; lag < maxLag; lag++) {
    const normalized = (re[lag] / fftLen) / r0;
    if (normalized > maxVal) maxVal = normalized;
  }

  if (maxVal <= 0 || maxVal >= 1) return null;
  return 10 * Math.log10(maxVal / (1 - maxVal));
}
