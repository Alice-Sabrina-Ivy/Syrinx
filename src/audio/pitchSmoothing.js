// pitchSmoothing.js — Pure helpers for pitch smoothing on the main thread.
// Extracted from useAudioPipeline.js so they can be unit-tested in plain
// Node without spinning up React + AudioContext.
//
// The key behaviour beyond a simple rolling median is `reconcileHarmonic`:
// when the new pitch is approximately k·current or current/k (k ∈ {2, 3}),
// divide/multiply it back to the fundamental. This catches the brief
// octave-doubling and octave-tripling spikes that YIN can produce when a
// formant coincidentally amplifies a higher harmonic — e.g. a male
// speaker's /u/ in "two" putting F1 right on the 3rd harmonic.

// Number of recent pitch samples kept for the rolling median.
// 5 frames at ~50 ms each = ~250 ms — long enough to outvote a 2-3 frame
// harmonic spike, short enough not to lag genuine pitch changes much.
export const PITCH_SMOOTH_LEN = 5;

// Tolerance window (relative) for declaring a value to be a harmonic of
// the current estimate. ±15% comfortably covers measurement noise on
// single-frame YIN estimates while still rejecting non-harmonic jumps.
export const PITCH_HARMONIC_TOLERANCE = 0.15;

// Harmonic factors we'll attempt to reconcile against. Octave-doubling
// (k=2) is the most common YIN failure; tripling (k=3) appears in real
// audio when a strong formant lines up with the 3rd harmonic.
export const PITCH_HARMONIC_KS = [2, 3];

// Voice-fundamental range. Reconciliation will only produce values
// inside this band — a "halve to recover the real fundamental" answer
// outside the band is itself probably the artefact.
export const PITCH_VALID_MIN_HZ = 75;
export const PITCH_VALID_MAX_HZ = 600;

// If `value` is k·current or current/k for some k in PITCH_HARMONIC_KS
// (within PITCH_HARMONIC_TOLERANCE), return the corrected value.
// Otherwise return `value` unchanged.
export function reconcileHarmonic(value, current) {
  if (value == null || current == null) return value;
  if (current <= 0) return value;
  for (const k of PITCH_HARMONIC_KS) {
    // Harmonic-up error: detected ≈ k·real → divide back
    const expectedUp = k * current;
    if (Math.abs(value - expectedUp) <= PITCH_HARMONIC_TOLERANCE * expectedUp) {
      const corrected = value / k;
      if (corrected >= PITCH_VALID_MIN_HZ) return corrected;
    }
    // Sub-harmonic error: detected ≈ real/k → multiply back
    const expectedDown = current / k;
    if (Math.abs(value - expectedDown) <= PITCH_HARMONIC_TOLERANCE * expectedDown) {
      const corrected = value * k;
      if (corrected <= PITCH_VALID_MAX_HZ) return corrected;
    }
  }
  return value;
}

// Median of an array. Returns null for empty input.
export function median(arr) {
  if (arr.length === 0) return null;
  const sorted = [...arr].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

// Push a new pitch sample into the rolling history (after harmonic
// reconciliation against the current median), drop the oldest if we're
// over capacity, and return the new median. Mutates `historyArr`.
export function pushAndMedianPitch(historyArr, value, maxLen = PITCH_SMOOTH_LEN) {
  const current = median(historyArr);
  const reconciled = reconcileHarmonic(value, current);
  historyArr.push(reconciled);
  if (historyArr.length > maxLen) historyArr.shift();
  return median(historyArr);
}
