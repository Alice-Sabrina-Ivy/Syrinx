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
// models disagree on positional ordering (the current JaesungHuh model is
// {0:male, 1:female}, the previous prithivMLmods was the opposite), so
// guessing from index would silently invert the meter on a model swap.
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

// ---------------------------------------------------------------------------
// Voiced-recency gate for the ML VAD (2026-07-19).
//
// The peak-amplitude VAD alone cannot tell steady noise from speech —
// every synthetic noise type passed it in 100 % of noise-only windows,
// so in a noisy room each speech pause fed masculine-leaning classifier
// scores into the EMA (measurements/noise-robustness-oracle-2026-07-19.md
// §4; amplitude statistics fundamentally can't separate a stationary
// noise floor from a stationary vowel, so a noise-floor-margin VAD was
// rejected too). Instead, gate on the PITCH worker's voicing decision,
// relayed by the main thread (same pattern as the DSP pitch-hint): with
// the tonal notch in front, pitch voicedness is a noise-robust speech
// detector — hum, broadband, and insect noise all decode unvoiced,
// while any actually-spoken window is voiced within a couple of hops.
//
// Fail-open on staleness: if no pitch message has arrived for staleMs
// (pitch worker dead or not yet warm), the gate reports "stale" and the
// caller falls back to peak-VAD-only — a broken pitch worker must
// degrade the noise robustness, never silence the meter.
export const VOICED_RECENCY_MS = 500;
export const PITCH_HINT_STALE_MS = 2000;

export function createVoicedRecencyGate({
  recencyMs = VOICED_RECENCY_MS,
  staleMs = PITCH_HINT_STALE_MS,
} = {}) {
  let lastHintTs = null;   // ts of the most recent pitch message (any)
  let lastVoicedTs = null; // ts of the most recent VOICED pitch message

  return {
    // notePitchHint({ voiced, ts }) — call for every relayed pitch message.
    notePitchHint(hint) {
      if (!hint || typeof hint.ts !== "number") return;
      lastHintTs = hint.ts;
      if (hint.voiced) lastVoicedTs = hint.ts;
    },
    // shouldScore(nowTs) — "stale" (no live pitch feed: fail open),
    // "voiced" (speech within recencyMs: score), or "unvoiced" (live
    // feed says no speech: skip, counts toward the silence reset).
    shouldScore(nowTs) {
      if (lastHintTs === null || nowTs - lastHintTs > staleMs) return "stale";
      if (lastVoicedTs !== null && nowTs - lastVoicedTs <= recencyMs) return "voiced";
      return "unvoiced";
    },
  };
}

// ---------------------------------------------------------------------------
// Sub-floor voicing probe (2026-07-19, Codex review on PR #90).
//
// The voiced-recency gate keys on the pitch worker, whose detector is
// bounded to 75-400 Hz — so a speaker sustaining phonation BELOW the
// floor (vocal fry, very low voices; real sessions carry 60-75 Hz
// frames) would read "unvoiced" and the gender meter would stop
// scoring them: a regression vs the peak-only VAD. Before skipping an
// "unvoiced" window, the worker runs this probe: normalized
// autocorrelation over lags covering SUBFLOOR_LO..SUBFLOOR_HI Hz on the
// ML window itself. Genuine sub-floor phonation is strongly periodic
// there; broadband noise is not. Stationary sub-floor HUM would also
// pass — so lags near any actively-notched interferer frequency
// (relayed with the pitch-hint) are excluded, keeping the noise win
// the notch just bought.
export const SUBFLOOR_LO_HZ = 40;
export const SUBFLOOR_HI_HZ = 75;
export const SUBFLOOR_CORR_THRESHOLD = 0.5;

export function subFloorVoiced(window, sampleRate, notchedFreqs = []) {
  const n = Math.min(window.length, Math.floor(sampleRate * 0.25)); // 0.25 s is >=10 periods at 40 Hz
  const minLag = Math.floor(sampleRate / SUBFLOOR_HI_HZ);
  const maxLag = Math.ceil(sampleRate / SUBFLOOR_LO_HZ);
  if (n < 2 * maxLag) return false;
  // Remove actively-notched interferers from the probe segment FIRST —
  // lag exclusion cannot work (a tone's autocorrelation is a cosine,
  // high at many lags, and any hum harmonic aliases into sub-floor lags
  // via the subharmonic ambiguity). Wider, low-Q notches are fine here:
  // we're deciding "is there NON-interferer periodicity", not preserving
  // signal fidelity.
  let seg = window.subarray(0, n);
  if (notchedFreqs.length > 0) {
    const x = Float32Array.from(seg);
    let ePre = 0;
    for (let i = 0; i < x.length; i++) ePre += x[i] * x[i];
    for (const f0 of notchedFreqs) {
      const w0 = (2 * Math.PI * f0) / sampleRate;
      const alpha = Math.sin(w0) / (2 * 8); // Q=8 — wide, short ringing
      const a0 = 1 + alpha, b1 = -2 * Math.cos(w0);
      let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
      for (let i = 0; i < x.length; i++) {
        const xi = x[i];
        const yi = (xi + b1 * x1 + x2 - b1 * y1 - (1 - alpha) * y2) / a0;
        x2 = x1; x1 = xi; y2 = y1; y1 = yi;
        x[i] = yi;
      }
    }
    // Normalized correlation is amplitude-blind — residual notch leakage
    // still correlates with itself. If notching stripped ~all the energy,
    // the window WAS the interferer: not sub-floor speech.
    let ePost = 0;
    for (let i = 0; i < x.length; i++) ePost += x[i] * x[i];
    if (ePost < 0.1 * ePre) return false;
    seg = x;
  }
  let e0 = 0;
  for (let i = 0; i < n - maxLag; i++) e0 += seg[i] * seg[i];
  if (e0 <= 0) return false;
  const r = (lag) => {
    let num = 0, e1 = 0;
    for (let i = 0; i + lag < n; i++) {
      num += seg[i] * seg[i + lag];
      e1 += seg[i + lag] * seg[i + lag];
    }
    const denom = Math.sqrt(e0 * e1);
    return denom > 0 ? num / denom : 0;
  };
  for (let lag = minLag; lag <= maxLag; lag++) {
    const rl = r(lag);
    if (rl < SUBFLOOR_CORR_THRESHOLD) continue;
    // PEAKEDNESS: genuine periodicity has a LOCALIZED correlation peak —
    // the half-period correlation is low (between glottal pulses).
    // LF rumble correlates highly at these lags too, but MONOTONICALLY:
    // its half-lag correlation is even HIGHER (smooth 1/f^2 signals
    // decorrelate slowly). Requiring r(lag) to beat r(lag/2) by a margin
    // separates fry from brown/pink/sleep noise, which amplitude and
    // threshold alone cannot (measured: rumble passed a bare
    // correlation test in 50-96 % of noise-only windows).
    if (rl > r(Math.max(1, Math.round(lag / 2))) + 0.1) return true;
  }
  return false;
}
