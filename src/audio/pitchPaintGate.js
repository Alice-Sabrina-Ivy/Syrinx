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
//     (rendered as a gap) unless it sustains a consistent new level —
//     then accepted as a genuine register change and the level is
//     reseeded there. Harmonic locks (median run ~4 frames) mostly never
//     reach the sustain count; genuine register changes do.
//   The painted VALUE is always the real detected pitch — this only
//   gates WHEN to paint, never alters the number (unlike the octave-
//   locking reconcileHarmonic removed 2026-05-09).
//
// Register re-acquisition (2026-10-03, measurements/pitch-display-gate-
// redesign-2026-10-03.md). The 06-10 gate kept its level across every
// gap and needed 16 off-level frames (400 ms) to accept a new one, and
// it let HELD values (the pitch-hold bridge over detector null gaps)
// into the level as if fresh. For a speaker who alternates registers
// between words (a transfeminine trainee switching ~110 Hz safety voice
// ↔ ~225 Hz target voice) the level stayed anchored on the previous
// word's register: target-voice words showed blank (or, via the readout
// fallback, the stale low value an octave down) for most of their
// length — target-voice displayed-correct 60 % vs 85 % with no gate on
// her sessions. Three changes, each measured against the consensus and
// strict references on all four of her sessions + the PTDB/FDA/
// Hillenbrand/vocadito guard corpora:
//   1. Held values do not feed the gate. push(pitch, { fresh: false })
//      may paint (on-level, continuity confirmed) to bridge consonants,
//      but never enters the level ring / counters, and counts as a gap
//      frame.
//   2. Post-gap re-acquisition. After ≥ REACQUIRE_GAP_FRAMES consecutive
//      frames without a fresh pitch (word boundary, consonant), an
//      off-level run needs only REACQUIRE_SUSTAIN consistent frames to
//      be accepted, for the first REACQUIRE_WINDOW painted frames of the
//      new segment. The level is KEPT (not cleared): a 2–3-frame onset
//      harmonic lock after a gap is still suppressed — clearing the
//      level instead (tested) painted those onset locks and cost +0.3–
//      0.5 pp low-voice octave-up.
//   3. EXCURSION_SUSTAIN 16 → 8 (200 ms) mid-segment: halves the blank
//      on an in-word register change / fast glide-and-hold, with no
//      measurable octave-up or spike cost on the sessions or corpora.

export const ONSET_CONFIRM_FRAMES = 3;   // continuity frames before painting
export const EXCURSION_SEMI = 9.5;       // semitones from level = "off-level"
export const EXCURSION_SUSTAIN = 8;      // off-level frames to accept a new level (mid-segment)
export const LEVEL_RING_LEN = 15;        // painted-value window for the level median
export const REACQUIRE_GAP_FRAMES = 2;   // frames without a fresh pitch that arm re-acquisition
export const REACQUIRE_SUSTAIN = 4;      // off-level frames to accept a new level right after a gap
export const REACQUIRE_WINDOW = 8;       // painted frames after the gap during which REACQUIRE_SUSTAIN applies
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
  reacquireGapFrames = REACQUIRE_GAP_FRAMES,
  reacquireSustain = REACQUIRE_SUSTAIN,
  reacquireWindow = REACQUIRE_WINDOW,
} = {}) {
  let ring = [];        // recent painted pitches; median = established level
  let onStreak = 0;     // consecutive on-level frames (onset/continuity)
  let offRun = [];      // consecutive off-level candidate values (sliding window)
  let gapFrames = 0;    // consecutive frames without a fresh pitch
  let reacquire = false;     // post-gap re-acquisition armed
  let paintedSinceGap = 0;   // painted frames since re-acquisition was armed
  let lastReason = null;     // why the last push did/didn't paint (readout policy)

  const level = () => (ring.length >= MIN_RING_FOR_LEVEL ? median(ring) : null);

  function painted() {
    if (reacquire && ++paintedSinceGap >= reacquireWindow) reacquire = false;
    lastReason = "paint";
    return true;
  }

  // push(pitch, { fresh }): pitch is a finite smoothed pitch. fresh=false
  // marks a HELD value (detector null, pitch-hold window open). Returns
  // true if this value should be painted as voiced.
  function push(pitch, { fresh = true } = {}) {
    const est = level();
    const onLevel = est === null || Math.abs(semitones(pitch, est)) < excursionSemi;

    if (!fresh) {
      // Held value: may bridge the trace across a consonant if it sits on
      // the level and continuity is confirmed, but never touches gate
      // state — a stale value must not anchor the level or count toward
      // a register change — and it counts as a gap frame.
      gapFrames++;
      const ok = onLevel && onStreak >= onsetConfirm;
      lastReason = ok ? "paint" : "hold";
      return ok;
    }

    if (gapFrames >= reacquireGapFrames) { reacquire = true; paintedSinceGap = 0; }
    gapFrames = 0;

    if (onLevel) {
      onStreak++;
      offRun = [];
      if (onStreak >= onsetConfirm) {
        ring.push(pitch);
        if (ring.length > levelRingLen) ring.shift();
        return painted();
      }
      lastReason = "onset";
      return false;
    }

    // Off-level: an octave-class departure from the established level.
    // offRun is a SLIDING window of the last excursionSustain off-level
    // values (2026-07-19; was unbounded — a fast wide glide left
    // mid-glide values in the run forever and the held target note never
    // passed the consistency check). The accept asks "were the last
    // `need` frames internally consistent" — `need` is reacquireSustain
    // right after a gap, excursionSustain mid-segment.
    offRun.push(pitch);
    if (offRun.length > excursionSustain) offRun.shift();
    const need = reacquire ? reacquireSustain : excursionSustain;
    const win = offRun.length > need ? offRun.slice(-need) : offRun;
    const spread = win.length > 1
      ? Math.abs(semitones(Math.max(...win), Math.min(...win)))
      : 0;
    if (win.length >= need && spread < excursionSemi) {
      // Sustained, internally-consistent new level — accept it.
      ring = win.slice(-levelRingLen);
      onStreak = win.length;
      offRun = [];
      return painted();
    }
    // Transient excursion (harmonic lock) — suppress.
    onStreak = 0;
    lastReason = "offlevel";
    return false;
  }

  // Call when the trace breaks (no pitch this frame). The established
  // level PERSISTS across gaps (re-acquisition makes a register change
  // after the gap cheap instead); the continuity/excursion counters
  // reset and the frame counts toward arming re-acquisition.
  function resetSegment() {
    onStreak = 0;
    offRun = [];
    gapFrames++;
    lastReason = null;
  }

  // Call on prolonged silence / mic stop — the established level is no
  // longer relevant; start fresh.
  function reset() {
    ring = [];
    onStreak = 0;
    offRun = [];
    gapFrames = 0;
    reacquire = false;
    paintedSinceGap = 0;
    lastReason = null;
  }

  return {
    push,
    resetSegment,
    reset,
    // "paint" | "onset" | "offlevel" | "hold" | null — the readout uses
    // "offlevel" to avoid showing a stale held value from the other
    // register while a fresh off-level pitch is being confirmed.
    lastReason: () => lastReason,
    // Test/diagnostic accessor.
    level,
  };
}
