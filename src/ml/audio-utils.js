// audio-utils.js — Pure helpers used by gender-worker.js. Extracted into
// their own module so they can be unit-tested in plain Node without spinning
// up the worker (which depends on Transformers.js + browser-only APIs).

export const TARGET_SAMPLE_RATE = 16000;

// Linear-interpolation resampling. Speech energy above 8 kHz is minimal
// and the browser already applies an anti-alias filter on mic input, so
// further filtering is omitted in favor of simplicity.
export function resampleLinear(input, fromRate, toRate) {
  if (fromRate === toRate) return input;
  const ratio = fromRate / toRate;
  const outLen = Math.floor(input.length / ratio);
  const out = new Float32Array(outLen);
  for (let i = 0; i < outLen; i++) {
    const srcIdx = i * ratio;
    const i0 = Math.floor(srcIdx);
    const i1 = Math.min(i0 + 1, input.length - 1);
    const frac = srcIdx - i0;
    out[i] = input[i0] * (1 - frac) + input[i1] * frac;
  }
  return out;
}

// Fixed-capacity ring window of audio samples. Newest samples overwrite
// oldest. Pre-allocated buffer to keep the worker's hot path GC-free.
export class RingWindow {
  constructor(capacity) {
    this.capacity = capacity;
    this.buffer = new Float32Array(capacity);
    this.filled = 0;
  }

  append(samples) {
    const n = samples.length;
    if (n >= this.capacity) {
      this.buffer.set(samples.subarray(n - this.capacity));
      this.filled = this.capacity;
      return;
    }
    if (this.filled + n > this.capacity) {
      const keep = this.capacity - n;
      this.buffer.copyWithin(0, this.filled - keep, this.filled);
      this.filled = keep;
    }
    this.buffer.set(samples, this.filled);
    this.filled += n;
  }

  isFull() {
    return this.filled >= this.capacity;
  }

  // Returns a fresh copy of the current window contents (may be shorter
  // than capacity if not yet full).
  snapshot() {
    return new Float32Array(this.buffer.subarray(0, this.filled));
  }

  reset() {
    this.filled = 0;
  }
}

// RMS of a window. Used to gate inference: silent / very-quiet windows
// produce unstable predictions, so we skip them.
export function windowRMS(samples) {
  if (!samples || samples.length === 0) return 0;
  let sum = 0;
  for (let i = 0; i < samples.length; i++) sum += samples[i] * samples[i];
  return Math.sqrt(sum / samples.length);
}

// RMS threshold below which we consider a window non-speech. Tuned to
// admit normal indoor speech amplitude while rejecting quiet rooms.
export const VAD_RMS_THRESHOLD = 0.01;

// Exponential moving average for score smoothing across inferences.
// Returns the new EMA value. `prev` may be null (first sample → curr).
export function ema(prev, curr, alpha = 0.4) {
  if (prev == null) return curr;
  return prev * (1 - alpha) + curr * alpha;
}

// Parse a Transformers.js audio-classification result into a 0-1 femininity
// score. Handles label-casing variation across community models, falls
// back to index 1 = female if labels are unrecognizable.
export function femaleScoreFromResult(result) {
  if (!Array.isArray(result) || result.length === 0) return null;
  let female = null, male = null;
  for (const r of result) {
    if (r == null || typeof r.score !== "number") continue;
    const label = String(r.label ?? "").toLowerCase();
    if (label.includes("female") || label === "f") female = r.score;
    else if (label.includes("male") || label === "m") male = r.score;
  }
  if (female == null && male != null) female = 1 - male;
  if (female == null) female = result[1]?.score ?? 0.5;
  return Math.max(0, Math.min(1, female));
}
