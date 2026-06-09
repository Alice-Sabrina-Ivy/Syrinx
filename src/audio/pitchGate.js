// pitchGate.js — Frame-level silence-gate, pitch-staleness, and pitch-hold
// decision logic for the audio pipeline. Extracted from useAudioPipeline.js
// (same pattern as pitchSmoothing.js) so the gate can be unit-tested in
// plain Node without React + AudioContext. Investigation + corpus data:
// measurements/pitch-gate-hold-investigation-2026-06-09.md.
//
// Each DSP analysis frame is evaluated against the most recent
// pitch-worker (SwiftF0) output. Three concerns live here:
//
// 1. Staleness. The pitch-worker posts {pitch, confidence, ts} per ~25 ms
//    chunk; the main thread merges via a "latest value" ref. If the
//    worker stalls or dies (model load failure, ORT hang, port failure),
//    that ref freezes at its last value — and a frozen confidence ≥ 0.5
//    would permanently disable the silence gate's voicedness arm. A
//    pitch sample older than PITCH_STALE_MS is therefore treated as
//    absent (pitch → null, confidence → null), which collapses the gate
//    to intensity-only — the same designed fallback as the pre-warmup
//    window before SwiftF0's first inference.
//
// 2. Silence gate. A frame is "quiet" only when intensity is below
//    SILENCE_THRESHOLD_DB AND confidence is below CONFIDENCE_THRESHOLD,
//    for SILENCE_DEBOUNCE_FRAMES consecutive frames. AND-logic (not OR)
//    is intentional — both signals must agree on "noise" before a frame
//    is suppressed. Either arm alone over-suppresses real speech: real
//    desktop mic speech median intensity is ~-38 dB but routinely
//    crosses -50 between articulations, and a confidence-only gate
//    would suppress borderline-voiced frames where pitch is real but
//    uncertain. (PR #74 inverted the original OR to AND; the SwiftF0
//    cutover carried the semantics forward.)
//
// 3. Bounded pitch hold. When audio is above the silence gate but
//    SwiftF0 reports no pitch (confidence < 0.5 — unvoiced consonants,
//    breath, broadband noise), the pipeline may bridge the gap by
//    holding the last smoothed pitch so the trace doesn't fragment
//    mid-word. The hold is BOUNDED by PITCH_HOLD_MAX_MS: corpus
//    measurement (measurements/swift-f0-null-gap-distribution-2026-06-09
//    .json) shows intra-speech null runs on running-speech corpora are
//    p95 ≈ 250–275 ms and ~p99 ≤ 400 ms; runs longer than that are
//    inter-sentence pauses or genuine non-speech. Unbounded holding
//    (the pre-2026-06 behavior) painted a stale flat pitch line through
//    any sustained loud-but-pitchless audio — phantom pitch during
//    breath/fan/typing noise — and recorded those frames as voiced at a
//    stale F0, polluting session statistics.

// Intensity gate threshold (dB RMS) — frames quieter than this are
// candidate silence.
export const SILENCE_THRESHOLD_DB = -50;

// Consecutive quiet frames required before the gate engages (~75 ms at
// the 25 ms chunk cadence).
export const SILENCE_DEBOUNCE_FRAMES = 3;

// SwiftF0 confidence threshold for the gate's voicedness arm. Matches
// the pitch-reporting threshold inside pitch-worker.js by design —
// producing a non-null pitch and being "voiced enough for the gate to
// trust" are the same condition; there is no ambiguous middle band.
// Validated in Stage 3.4 (measurements/swift-f0-stage3-4-3-5-validation-
// 2026-05-06.md).
export const CONFIDENCE_THRESHOLD = 0.5;

// Pitch samples older than this are treated as absent. Healthy cadence
// is one pitch message per ~25 ms chunk (mobile p95 inference 17 ms),
// so 250 ms = ten consecutive missed hops — far outside healthy jitter,
// well inside the 1500 ms worker-side inference timeout, and large
// enough that cross-worker epoch skew (~0 ms measured) is irrelevant.
export const PITCH_STALE_MS = 250;

// Maximum age of the last accepted pitch for which the display may hold
// the previous smoothed value across a SwiftF0 null gap. 400 ms covers
// ~p99 of intra-speech null runs on the running-speech corpora
// (PTDB-TUG p99 = 400 ms, FDA p99 = 350 ms at the production 25 ms hop)
// while capping how long a phantom value can outlive the voice that
// produced it.
export const PITCH_HOLD_MAX_MS = 400;

// Mutable per-session gate state. Recreate on each pipeline start/stop.
export function createGateState() {
  return {
    quietFrames: 0,       // consecutive frames below both gate arms
    lastFreshPitchAt: null, // frame time (ms) of the last accepted pitch
  };
}

// Evaluate one DSP analysis frame.
//
//   state — from createGateState(); mutated in place.
//   frame — {
//     now:        frame time, ms epoch (DSP worker absoluteTime)
//     intensity:  RMS dB from the DSP worker
//     pitch:      latest pitch-worker pitch (Hz or null)
//     confidence: latest pitch-worker confidence ([0,1] or null)
//     pitchTs:    ms-epoch timestamp of that pitch sample (0 = none yet)
//   }
//
// Returns {
//   pitch, confidence — the latest sample, or nulls if stale/absent
//   hasPitch    — a fresh, non-null pitch is available this frame
//   isQuiet     — silence gate engaged (debounced)
//   holdAllowed — no fresh pitch, but the last accepted pitch is recent
//                 enough (≤ PITCH_HOLD_MAX_MS) to bridge the gap
//   pitchStale  — the staleness fallback kicked in this frame
// }
export function evaluateFrameGate(state, { now, intensity, pitch, confidence, pitchTs }) {
  const pitchStale =
    typeof pitchTs !== "number" || pitchTs <= 0 || now - pitchTs > PITCH_STALE_MS;
  const effPitch = pitchStale ? null : pitch;
  const effConfidence = pitchStale ? null : confidence;

  const intensityQuiet = intensity < SILENCE_THRESHOLD_DB;
  // Pre-warmup and stale frames (confidence null) fall back to
  // intensity-only gating via the typeof check.
  const voicednessQuiet =
    typeof effConfidence !== "number" || effConfidence < CONFIDENCE_THRESHOLD;
  const frameQuiet = intensityQuiet && voicednessQuiet;
  state.quietFrames = frameQuiet ? state.quietFrames + 1 : 0;
  const isQuiet = state.quietFrames >= SILENCE_DEBOUNCE_FRAMES;

  const hasPitch = typeof effPitch === "number";
  if (hasPitch) state.lastFreshPitchAt = now;
  const holdAllowed =
    !hasPitch &&
    state.lastFreshPitchAt !== null &&
    now - state.lastFreshPitchAt <= PITCH_HOLD_MAX_MS;

  return {
    pitch: hasPitch ? effPitch : null,
    confidence: effConfidence,
    hasPitch,
    isQuiet,
    holdAllowed,
    pitchStale,
  };
}
