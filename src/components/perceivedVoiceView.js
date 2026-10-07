// perceivedVoiceView.js — what the Perceived Voice meter shows right now.
// Pure (no React, no canvas) so the rules are unit-tested and replayed by
// the measurement harness exactly as the meter runs them
// (measurements/perceived-voice-gate-2026-10-07.md).
//
// Inputs, all read live by the meter's rAF loop:
//   now          epoch ms (same clock as the worker's score / state ts)
//   modelStatus  "loading" | "ready" | "error" | ...
//   dspGate      { voiced, holding } — the DSP voicedness gate
//   newest       newest score entry { time, score, confidence } or null
//   voiceState   newest worker voice-state { state, ts } or null
//                (state: listening | updating | scoring | pause | sustained)
//   freshMs      optional override of SCORE_FRESH_MS (measurement sweeps)
//
// Output { score, dim, status }:
//   score   number to show, or null (no number on screen)
//   dim     the score is from a moment ago, not the current window
//   status  "loading" | "error" | "listening" | "updating" | "sustained" | "scoring"
//
// A score is shown only while it is FRESH (<= SCORE_FRESH_MS old). The
// worker only scores recent, voiced running speech, so a fresh score is
// always from the current stretch of speech; older ones are never held on
// screen (the previous meter kept them up to 6 s whenever the DSP gate
// was open — e.g. under noise above -50 dB).

// Scores land every ~150 ms during speech (slower where inference
// overruns the hop). 1.2 s bridges a breath or a long consonant cluster
// inside an utterance; beyond it the reading would describe speech the
// user is no longer producing. (1.0 / 1.2 / 1.5 s measured: 1.2 s closes
// most of the running-speech coverage gap between low and high voices
// for +1.4 pp of noise-only time with a number.)
export const SCORE_FRESH_MS = 1200;

export function perceivedVoiceView({ now, modelStatus, dspGate, newest, voiceState, freshMs = SCORE_FRESH_MS }) {
  if (modelStatus === "loading") return { score: null, dim: false, status: "loading" };
  if (modelStatus === "error") return { score: null, dim: false, status: "error" };
  const idle = !dspGate?.voiced && !dspGate?.holding;
  if (idle) return { score: null, dim: false, status: "listening" };
  const state = voiceState?.state ?? "listening";
  if (state === "sustained") return { score: null, dim: false, status: "sustained" };
  const fresh = newest != null && now - newest.time <= freshMs;
  if (fresh) return { score: newest.score, dim: state !== "scoring", status: "scoring" };
  // No fresh score. "updating" while a voice onset is being collected or
  // a score is due; nothing while the worker hears no voice (or an
  // utterance paused before it ever produced a score — usually a brief
  // noise blip the pitch detector called voiced).
  if (state === "updating" || state === "scoring") return { score: null, dim: false, status: "updating" };
  return { score: null, dim: false, status: "listening" };
}
