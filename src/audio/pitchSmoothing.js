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

// Restart the median after a gap (2026-10-04, measurements/pitch-display-
// reacquire-2026-10-04.md). The hook used to keep the median buffer across
// short gaps (it was dropped only when the 400 ms pitch hold expired), so
// the first frames of a new word were medianed against the previous
// word's values: after a register switch the first new-register frame
// painted the OLD register (or was suppressed) and the paint gate saw the
// new register one frame late. Same gap notion as the paint gate's
// REACQUIRE_GAP_FRAMES (a single dropped frame inside a word does not
// count). The onset protection the old median provided is kept by the
// paint gate's raw-agreement accept check (pitchPaintGate.js).
//
// Review fix (2026-10-04, same file §10). The first version cleared the
// buffer after EVERY gap. That painted unsmoothed single frames and, on
// the 2nd fresh frame, the MEAN of two detections (median() averages the
// middle pair of an even-length buffer): held frames do not reset the
// paint gate's onset streak, so after a 2-frame held gap a 1-frame flip
// painted a value no detector frame posted (110 then 220 -> 165). Now:
//   - restart only when the gap is followed by a fresh value an octave-
//     class jump (>= SMOOTH_RESTART_SEMI, the paint gate's EXCURSION_SEMI)
//     from the buffer median — the register-switch case that motivated
//     the restart. Any other post-gap value is medianed against the
//     previous word as before, so a 1-frame on-level outlier still never
//     paints;
//   - a restarted (or empty) buffer is SEEDED with the value: [x1] -> the
//     next medians are x1 and median(x1, x1, x2) = x1. The buffer never
//     holds two distinct values, so the median is always a real detection.
export const SMOOTH_RESET_GAP_FRAMES = 2;
export const SMOOTH_RESTART_SEMI = 9.5; // = pitchPaintGate EXCURSION_SEMI (test-asserted)

export function createSmoothingGapTracker(gapFrames = SMOOTH_RESET_GAP_FRAMES) {
  let run = 0; // consecutive frames without a fresh detection
  return {
    // Call once per display frame, before smoothing; hasFresh = this frame
    // carries a fresh detection. Returns true when this fresh frame follows
    // >= gapFrames frames without one (pass it to smoothingBufferFor).
    frame(hasFresh) {
      const afterGap = hasFresh && run >= gapFrames;
      run = hasFresh ? 0 : run + 1;
      return afterGap;
    },
    reset() { run = 0; },
  };
}

// The buffer a fresh detection `value` should be pushed into: a new buffer
// seeded with the value when the current one is empty, or when the value
// follows a gap (afterGap, from the tracker) and departs >= restartSemi
// semitones from the buffer median; otherwise the current buffer.
export function smoothingBufferFor(historyArr, value, afterGap, restartSemi = SMOOTH_RESTART_SEMI) {
  const m = median(historyArr);
  if (m === null) return [value];
  if (afterGap && Math.abs(12 * Math.log2(value / m)) >= restartSemi) return [value];
  return historyArr;
}
