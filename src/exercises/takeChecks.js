// takeChecks.js — what a lesson says about a take, and the pitch it shows for one (pure;
// tests/exercises/take-checks-test.js). docs/guided-exercises-design.md §2 rule 3.
//
// A take that is shorter than its card asks for (one sentence, or the sentence twice)
// gets "short" before anything else is shown about it — a design choice from the text.
//
// No "too little voice" note: the pre-registered measurement found no threshold that real
// spoken takes pass in every group (measurements/exercise-take-checks-2026-10-27.md — on
// very quiet speech the voice gate hears no voice at all), so by its rule none is built.
//
// A take's pitch ("about N Hz": R4's try and the recording it is compared with): while it
// records, the frames the hook hands the exercises frame tap (bridge.js — the frame a
// session recording stores) are counted here. Voice = frames with a pitch (`voiced` and
// f0 > 0) that the voice gate did not hide (`voiceGate !== "hidden"`; with no gate decision
// every voiced frame counts), 25 ms each. The pitch is their median f0, shown only with at
// least TRY_PITCH_MIN_S of voice (Voice Shaper's own minimum for its recordings). Known
// limitation (the note's §2.6): a steady hum the noise notch has not removed yet reads as voice.
// The window is the recorder's (tap installed at Record, removed at its end; ≤ 8 s). "Hear it
// first"'s recording is counted the same way over its "recording" phase (ExercisesView.jsx
// trackHearVoice); that use was not part of the measurement.

const FRAME_S = 0.025;

/** A take's pitch is shown with at least this much voice. */
export const TRY_PITCH_MIN_S = 1.0;
/** "Too short" when a card gives no minimum of its own. */
export const DEFAULT_MIN_S = 1.0;

/** Counts the voice in the frames of one take. */
export function createTakeVoiceLog() {
  let voiced = 0;
  let all = 0;
  const f0 = [];
  return {
    push(frame) {
      if (!frame) return;
      all++;
      if (!frame.voiced || !(frame.f0 > 0)) return;
      if (frame.voiceGate === "hidden") return;
      voiced++;
      f0.push(frame.f0);
    },
    /** { voicedS, medianHz (null under TRY_PITCH_MIN_S of voice), frames } */
    stats() {
      const voicedS = Math.round(voiced * FRAME_S * 100) / 100;
      return { voicedS, medianHz: voicedS >= TRY_PITCH_MIN_S ? median(f0) : null, frames: all };
    },
  };
}

function median(values) {
  if (!values.length) return null;
  const s = [...values].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

/** The note for a take ({ seconds }) recorded on a card's take spec ({ minS? }): "short" or null. */
export function takeNote(take, spec = {}) {
  if (!take) return null;
  return take.seconds < (spec.minS ?? DEFAULT_MIN_S) ? "short" : null;
}

/** The pitch to show for a take (whole Hz) or null. */
export function takePitchHz(take) {
  const hz = take?.voice?.medianHz;
  return hz > 0 ? Math.round(hz) : null;
}
