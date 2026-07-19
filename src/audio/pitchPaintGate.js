// pitchPaintGate.js — Decides whether a smoothed pitch value should be
// PAINTED on the trace, suppressing transient octave/harmonic excursions
// that the detector + display median still let through. Extracted from
// useAudioPipeline.js for unit-testing, same pattern as pitchGate.js /
// pitchSmoothing.js.
//
// Why this replaced the PR #84 consecutive-delta jump break: that broke
// continuity only when two ADJACENT painted values differed by ≥ 12 st.
// But the display median (5-frame then, 3-frame since 2026-07-19; the
// mechanism holds for any length > 1) ramps an instant octave jump
// (100 → 380 Hz) through intermediate values whose step-to-step deltas
// are each < 12 st, so the jump break never fired and the ramp painted
// as a connected near-vertical line. Measured on the 2026-05-26 session:
// of 1078 connected painted pairs ≥ 9 st apart, ZERO were ≥ 12 st steps —
// every spike slipped through as a ramp. (scripts/pitch-excursion-
// measure.js)
//
// Mechanism — break against the established LEVEL, not the previous
// frame. Track a robust median of recent painted pitches ("established
// level"). A new value is:
//   - ON-LEVEL  (< EXCURSION_SEMI from the level): normal prosody. Paints
//     after the usual ONSET_CONFIRM_FRAMES continuity streak. (Session:
//     real speech deviates from its established level p99 = 8.3 st,
//     max 9.0 — never an octave.)
//   - OFF-LEVEL (≥ EXCURSION_SEMI): an octave-class jump. NOT painted
//     (rendered as a gap) unless it sustains a consistent new level for
//     EXCURSION_SUSTAIN frames — then accepted as a genuine register
//     change and the level is reseeded there. Harmonic locks (median run
//     ~4 frames) never reach the sustain count, so they never paint;
//     genuine sustained octave changes do, after a confirmation delay.
//   The painted VALUE is always the real detected pitch — this only
//   gates WHEN to paint, never alters the number (unlike the octave-
//   locking reconcileHarmonic removed 2026-05-09).
//
// Sweep behind the constants: scripts/pitch-excursion-fix-sweep.js /
// measurements/pitch-excursion-break-2026-06-10.md. SEMI 9.5 sits in the
// gap between prosody max (9.0) and the octave (12); SUSTAIN 16 (~400 ms)
// outlasts the harmonic-lock tail while keeping genuine-register-change
// latency acceptable for speech (the reported failure mode — you don't
// jump octaves between words). Smooth pitch glides are unaffected: each
// step stays within SEMI of the moving level, so they never trip the
// off-level branch.

export const ONSET_CONFIRM_FRAMES = 3;   // continuity frames before painting
export const EXCURSION_SEMI = 9.5;       // semitones from level = "off-level"
export const EXCURSION_SUSTAIN = 16;     // off-level frames to accept a new level
export const LEVEL_RING_LEN = 15;        // painted-value window for the level median
const MIN_RING_FOR_LEVEL = 5;            // need this many before the gate engages

function median(arr) {
  if (arr.length === 0) return null;
  const s = [...arr].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)];
}

const semitones = (a, b) => 12 * Math.log2(a / b);

export function createPaintGate({
  onsetConfirm = ONSET_CONFIRM_FRAMES,
  excursionSemi = EXCURSION_SEMI,
  excursionSustain = EXCURSION_SUSTAIN,
  levelRingLen = LEVEL_RING_LEN,
} = {}) {
  let ring = [];        // recent painted pitches; median = established level
  let onStreak = 0;     // consecutive on-level frames (onset/continuity)
  let offRun = [];       // consecutive off-level candidate values

  // push(pitch): pitch is a finite number (a fresh or held smoothed
  // pitch). Returns true if this value should be painted as voiced.
  function push(pitch) {
    const est = ring.length >= MIN_RING_FOR_LEVEL ? median(ring) : null;
    const onLevel = est === null || Math.abs(semitones(pitch, est)) < excursionSemi;

    if (onLevel) {
      onStreak++;
      offRun = [];
      if (onStreak >= onsetConfirm) {
        ring.push(pitch);
        if (ring.length > levelRingLen) ring.shift();
        return true;
      }
      return false;
    }

    // Off-level: an octave-class departure from the established level.
    offRun.push(pitch);
    const spread = offRun.length > 1
      ? Math.abs(semitones(Math.max(...offRun), Math.min(...offRun)))
      : 0;
    if (offRun.length >= excursionSustain && spread < excursionSemi) {
      // Sustained, internally-consistent new level — accept it.
      ring = offRun.slice(-levelRingLen);
      onStreak = offRun.length;
      offRun = [];
      return true;
    }
    // Transient excursion (harmonic lock) — suppress.
    onStreak = 0;
    return false;
  }

  // Call when the trace breaks (no pitch this frame). The established
  // level PERSISTS across brief gaps — speech has unvoiced micro-gaps
  // between words/phonemes every few hundred ms, and resetting the level
  // there would disable the gate for the onsets right after them. Only
  // the continuity/excursion counters reset.
  function resetSegment() {
    onStreak = 0;
    offRun = [];
  }

  // Call on prolonged silence / mic stop — the established level is no
  // longer relevant; start fresh.
  function reset() {
    ring = [];
    onStreak = 0;
    offRun = [];
  }

  return {
    push,
    resetSegment,
    reset,
    // Test/diagnostic accessor.
    level: () => (ring.length >= MIN_RING_FOR_LEVEL ? median(ring) : null),
  };
}
