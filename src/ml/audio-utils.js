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

// RMS of a window. Used for tracking signal level. NOT the primary VAD
// signal anymore — RMS is an average, so a window that's half speech
// and half silence reports a much lower number than continuous speech,
// which would falsely gate. See `windowPeak` below.
export function windowRMS(samples) {
  if (!samples || samples.length === 0) return 0;
  let sum = 0;
  for (let i = 0; i < samples.length; i++) sum += samples[i] * samples[i];
  return Math.sqrt(sum / samples.length);
}

// Peak absolute amplitude over a window. Used as the VAD signal because
// speech peaks are reliably ≥ 0.05 in any window long enough to span a
// phrase plus a pause (e.g., saying "testing 1 2 3" with brief gaps).
// RMS over the same window can dip below the silence threshold even
// when there's clearly-voiced content in part of it.
export function windowPeak(samples) {
  if (!samples || samples.length === 0) return 0;
  let peak = 0;
  for (let i = 0; i < samples.length; i++) {
    const a = samples[i] >= 0 ? samples[i] : -samples[i];
    if (a > peak) peak = a;
  }
  return peak;
}

// Peak threshold below which we consider a window non-speech. Calibrated
// to admit normal indoor speech (peaks 0.1-0.5) while rejecting quiet
// rooms and breath sounds (peaks ≤ 0.02).
export const VAD_PEAK_THRESHOLD = 0.05;

// Legacy RMS threshold — kept exported because tests reference it, but
// the worker now gates on `windowPeak` against `VAD_PEAK_THRESHOLD`.
export const VAD_RMS_THRESHOLD = 0.01;

// Exponential moving average for score smoothing across inferences.
// Returns the new EMA value. `prev` may be null (first sample → curr).
export function ema(prev, curr, alpha = 0.4) {
  if (prev == null) return curr;
  return prev * (1 - alpha) + curr * alpha;
}

// Number of consecutive silent (VAD-gated) inferences before we treat the
// EMA-smoothed score as stale and reset it. At ~6.7 Hz inference rate, 14
// inferences = ~2.1 seconds of silence — long enough to mean the user
// paused rather than just took a breath.
export const RESET_AFTER_SILENT_INFERENCES = 14;

// Counts consecutive silent (VAD-gated) inferences and reports when the
// smoothed score should be considered stale. Used by gender-worker.js to
// avoid carrying yesterday's score into today's utterance.
export class SilenceTracker {
  constructor(threshold = RESET_AFTER_SILENT_INFERENCES) {
    this._count = 0;
    this.threshold = threshold;
  }

  // Record a silent inference. Returns true the moment the run of silence
  // crosses the reset threshold (caller should clear smoothed state).
  noteSilent() {
    this._count++;
    return this._count === this.threshold;
  }

  // Record a non-silent inference; resets the run.
  noteActive() {
    this._count = 0;
  }

  get silentCount() { return this._count; }
}

// Parse a Transformers.js audio-classification result into a 0-1 femininity
// score. Handles label-casing variation across community models. Returns
// null if no recognizable female/male label is found — different gender
// models disagree on positional ordering (the current model is
// {0:female, 1:male}, the previous one was the opposite), so guessing
// from index would silently invert the meter on a model swap.
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
  if (female == null) return null;
  return Math.max(0, Math.min(1, female));
}
