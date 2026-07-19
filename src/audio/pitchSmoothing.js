// pitchSmoothing.js — Rolling-median smoother for pitch values produced
// by the pitch worker. Extracted from useAudioPipeline.js so it can be
// unit-tested in plain Node without spinning up React + AudioContext.
//
// The smoother maintains a length-PITCH_SMOOTH_LEN ring of recent values
// and returns the median on each push. Single-frame outliers cannot
// flip it; sustained shifts track within (LEN+1)/2 frames.
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
// 3 frames × ~25 ms hop = ~75 ms of memory. Reduced 5 → 3 on 2026-07-19:
// the length-5 window was sized for pYIN/SwiftF0-era raw detector output,
// but since the Boersma-AC cutover the L=2 bounded-Viterbi path tracker
// already suppresses single-frame octave flips upstream, and the long
// median was measurably COSTING displayed accuracy — reconstructing the
// production display chain against Praat references showed K=5 losing
// 1.4–2.2 pp of 80–110 Hz band accuracy and 25 ms of display lag vs K=3
// on the tuning session AND both held-out recordings, with K=3 painting
// no more spikes than K=5 (measurements/pitch-l2-retune-2026-07-19.md).
// A 2-frame outlier now reaches the output by design — 1-frame flips are
// the tracker's job, octave-class excursions are the paint gate's.
export const PITCH_SMOOTH_LEN = 3;

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
