// constants.js — Display ranges, colors, and configuration.
// Target ranges depend on the user's training direction and live in
// utils/trainingDirection.js (no direction is assumed).

// Y-axis display range for pitch trace (Hz) — also the REPORTED pitch
// range: the floor matches the detector's search floor (boersma-ac.js
// minPitchHz 75; a detector floor below this paints valid low detections
// under the chart — 2026-06-10 report), and the pitch worker posts any
// decode above `high` as unvoiced. The detector itself searches to 2x
// `high` (maxPitchHz 800) so above-range phonation is recognized as such
// instead of aliasing to a half-pitch value inside the plot
// (measurements/pitch-ceiling-2026-10-03.md). Raising `high` means
// raising maxPitchHz to keep the 2x relationship.
export const PITCH_DISPLAY_RANGE = { low: 75, high: 400 };

// Y-axis display range for resonance trace (Hz)
export const F2_DISPLAY_RANGE = { low: 800, high: 3500 };

// Time windows
export const PITCH_TRACE_SECONDS = 15;
export const RESONANCE_TRACE_SECONDS = 15;
export const SILENCE_HOLD_MS = 5000;

// Dashboard cue strip axes (components/cueStripModel.js). Every axis puts
// the typically-men end on the LEFT. Pitch: log Hz; resonance: the spectral
// warp cue's u units (0 = typical LibriSpeech man, 1 = typical woman; the
// resonance lab's U_MIN / U_MAX); weight: σ from the session's own baseline
// (negative = heavier, on the left; BASELINE_SIGMA = 3).
export const CUE_AXES = Object.freeze({
  pitch: Object.freeze({ min: 75, max: 320, log: true, ticks: Object.freeze([100, 150, 200, 250, 300]) }),
  resonance: Object.freeze({ min: -1.0, max: 2.2 }),
  weight: Object.freeze({ min: -3, max: 3, ticks: Object.freeze([0]) }),
});

// HNR display range (dB) — higher = cleaner voice
export const HNR_RANGE = { min: 0, max: 35 };

// Colors. Target colouring is the same for every training direction and
// judges the pitch LEVEL (utils/pitchLevel.js): green on target, red off
// target, neutral past the band in the direction of travel ("beyond") and
// with no target ("Just exploring", or sessions recorded before
// directions existed — no band drawn then either).
export const COLORS = {
  inTarget: "#4ade80",
  outOfTarget: "#f87171",
  targetBand: "rgba(74, 222, 128, 0.08)",
  targetBandBorder: "rgba(74, 222, 128, 0.25)",
  // Neutral trace / cue-strip dot colour (no colour implies a gender).
  neutralTrace: "#c4b5fd",
  // Shared
  grid: "rgba(255, 255, 255, 0.06)",
  gridLabel: "rgba(255, 255, 255, 0.3)",
  silenceLine: "rgba(255, 255, 255, 0.05)",
};

// Trace colour / readout class for a pitchStatus() result
// (utils/trainingDirection.js): "in" | "beyond" | "out" | null.
export function statusColor(status) {
  return status === "in" ? COLORS.inTarget : status === "out" ? COLORS.outOfTarget : COLORS.neutralTrace;
}
export function statusTextClass(status) {
  return status === "in" ? "text-green-400" : status === "out" ? "text-red-400" : "text-neutral-200";
}
