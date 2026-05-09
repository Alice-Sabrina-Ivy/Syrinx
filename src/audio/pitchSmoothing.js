// pitchSmoothing.js — Rolling-median smoother for pitch values produced
// by the SwiftF0 pitch worker. Extracted from useAudioPipeline.js so it
// can be unit-tested in plain Node without spinning up React + AudioContext.
//
// The smoother maintains a length-PITCH_SMOOTH_LEN ring of recent values
// and returns the median on each push. The median tolerates 1- and 2-
// frame outlier spikes naturally (a 5-window median cannot be flipped by
// fewer than 3 of 5 buffer slots) and tracks sustained pitch shifts in
// 2 frames once 3 of the 5 slots hold the new value.
//
// Earlier versions (pYIN era) wrapped the median in a `reconcileHarmonic`
// helper that detected k=2 / k=3 octave-relations between an incoming
// value and the running median, then divided/multiplied the value back
// to the supposed fundamental. That helper was load-bearing while pYIN
// was the active detector (~2.3 % octave-error rate across mid-range
// buckets) but became a liability after the Stage 4 cutover to SwiftF0
// (≤ 0.08 % octave-error rate across all measured corpora). Worse, the
// reconciler created a self-reinforcing octave lock — once the buffer
// settled at one pitch, any abrupt octave shift was misread as a
// transient harmonic spike and reconciled back to the old pitch
// indefinitely. The fix and the data behind it live in
// measurements/pitchsmoothing-octave-shift-2026-05-09.md.

// Number of recent pitch samples kept for the rolling median.
// 5 frames × ~25 ms hop = ~125 ms of memory — long enough to outvote a
// 1- or 2-frame outlier, short enough that a real pitch shift is fully
// reflected in the output within ~75 ms.
export const PITCH_SMOOTH_LEN = 5;

// Median of an array. Returns null for empty input.
export function median(arr) {
  if (arr.length === 0) return null;
  const sorted = [...arr].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

// Push a new pitch sample into the rolling history, drop the oldest if
// we're over capacity, and return the new median. Mutates `historyArr`.
export function pushAndMedianPitch(historyArr, value, maxLen = PITCH_SMOOTH_LEN) {
  historyArr.push(value);
  if (historyArr.length > maxLen) historyArr.shift();
  return median(historyArr);
}
