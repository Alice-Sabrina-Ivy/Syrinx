// dsp-worker.js — Web Worker that performs all DSP analysis off the main thread
// Session 1: YIN pitch detection + intensity (silence gating)
// Session 3 will add: formant extraction, spectral tilt, HNR

const WINDOW_MS = 200; // Analysis window size in ms
let sampleRate = 48000;
let windowSize = Math.floor(sampleRate * WINDOW_MS / 1000);

// Ring buffer to accumulate ~200ms of recent audio
let ringBuffer = new Float32Array(0);

self.onmessage = (e) => {
  const { type } = e.data;

  if (type === "init") {
    sampleRate = e.data.sampleRate;
    windowSize = Math.floor(sampleRate * WINDOW_MS / 1000);
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

    self.postMessage({
      type: "analysis",
      data: {
        pitch,
        intensity,
        timestamp: performance.now(),
      },
    });
  }
};

function appendToRingBuffer(chunk) {
  // Keep at most 2x windowSize to avoid unbounded growth
  const maxLen = windowSize * 2;
  const newLen = ringBuffer.length + chunk.length;

  if (newLen <= maxLen) {
    const newBuf = new Float32Array(newLen);
    newBuf.set(ringBuffer);
    newBuf.set(chunk, ringBuffer.length);
    ringBuffer = newBuf;
  } else {
    // Shift out old data, keep most recent samples + new chunk
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
  for (let i = 0; i < buffer.length; i++) {
    sum += buffer[i] * buffer[i];
  }
  const rms = Math.sqrt(sum / buffer.length);
  if (rms === 0) return -Infinity;
  // Convert to dB relative to full-scale (1.0)
  return 20 * Math.log10(rms);
}

// --- YIN Pitch Detection ---
// Based on "YIN, a fundamental frequency estimator for speech and music"
// by de Cheveigné & Kawahara (2002)

function detectPitch(buffer, sr) {
  const threshold = 0.15; // Aperiodicity threshold
  const minF0 = 75;       // Hz — low enough for baritone
  const maxF0 = 600;      // Hz — high enough for head voice

  const minLag = Math.floor(sr / maxF0);
  const maxLag = Math.floor(sr / minF0);
  const halfLen = Math.floor(buffer.length / 2);

  if (maxLag >= halfLen) return null;

  // Step 1: Difference function d(tau)
  const diff = new Float32Array(halfLen);
  for (let tau = 1; tau < halfLen; tau++) {
    let sum = 0;
    for (let i = 0; i < halfLen; i++) {
      const d = buffer[i] - buffer[i + tau];
      sum += d * d;
    }
    diff[tau] = sum;
  }

  // Step 2: Cumulative mean normalized difference (CMND)
  const cmnd = new Float32Array(halfLen);
  cmnd[0] = 1;
  let runningSum = 0;
  for (let tau = 1; tau < halfLen; tau++) {
    runningSum += diff[tau];
    cmnd[tau] = diff[tau] / (runningSum / tau);
  }

  // Step 3: Absolute threshold — find first dip below threshold
  let bestTau = -1;
  for (let tau = minLag; tau < Math.min(maxLag, halfLen); tau++) {
    if (cmnd[tau] < threshold) {
      // Walk forward to find the local minimum
      while (tau + 1 < halfLen && cmnd[tau + 1] < cmnd[tau]) {
        tau++;
      }
      bestTau = tau;
      break;
    }
  }

  if (bestTau === -1) return null; // Unvoiced / no pitch detected

  // Step 4: Parabolic interpolation for sub-sample accuracy
  const s0 = bestTau > 0 ? cmnd[bestTau - 1] : cmnd[bestTau];
  const s1 = cmnd[bestTau];
  const s2 = bestTau + 1 < halfLen ? cmnd[bestTau + 1] : cmnd[bestTau];
  const denom = 2 * (s0 - 2 * s1 + s2);
  const refinedTau = denom !== 0
    ? bestTau + (s0 - s2) / denom
    : bestTau;

  const pitch = sr / refinedTau;

  // Sanity check the result
  if (pitch < minF0 || pitch > maxF0) return null;

  return pitch;
}
