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

// Spectral tilt display range (dB) — lower = lighter voice, higher = heavier
export const SPECTRAL_TILT_RANGE = { min: -5, max: 25 };
// Target zone of the (currently unmounted) SpectralTiltGauge — a
// lighter-voice zone from before training directions existed; direction-
// aware targets live in utils/trainingDirection.js.
export const SPECTRAL_TILT_TARGET = { low: -2, high: 8 };

// HNR display range (dB) — higher = cleaner voice
export const HNR_RANGE = { min: 0, max: 35 };

// Colors. Target colouring is the same for every training direction
// (green in target / red outside); with no target ("Just exploring", or
// sessions recorded before directions existed) traces use the neutral
// colour and no band is drawn.
export const COLORS = {
  inTarget: "#4ade80",
  outOfTarget: "#f87171",
  targetBand: "rgba(74, 222, 128, 0.08)",
  targetBandBorder: "rgba(74, 222, 128, 0.25)",
  neutralTrace: "#c4b5fd",
  // Perceived Voice meter: one neutral hue for every reading — the
  // meter's ends are descriptions, not goals.
  meterFill: "rgba(167, 139, 250, 0.45)",
  meterIndicator: "#c4b5fd",
  meterBand: "rgba(255, 255, 255, 0.035)",
  meterBandBorder: "rgba(255, 255, 255, 0.14)",
  // Shared
  grid: "rgba(255, 255, 255, 0.06)",
  gridLabel: "rgba(255, 255, 255, 0.3)",
  silenceLine: "rgba(255, 255, 255, 0.05)",
};
