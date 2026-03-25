// constants.js — Default target ranges, colors, and configuration

// Default target pitch range for voice feminization (Hz)
export const DEFAULT_PITCH_TARGET = { low: 165, high: 255 };

// Y-axis display range for pitch trace (Hz)
export const PITCH_DISPLAY_RANGE = { low: 75, high: 400 };

// F2 resonance target range for voice feminization (Hz)
export const DEFAULT_F2_TARGET = { low: 1800, high: 2500 };

// Y-axis display range for resonance trace (Hz)
export const F2_DISPLAY_RANGE = { low: 800, high: 3000 };

// Resonance brightness baseline/target for normalization (Hz)
// Male baseline and female target for each formant
export const RESONANCE_BASELINES = {
  f1: { male: 450, female: 580 },
  f2: { male: 1200, female: 2200 },
  f3: { male: 2500, female: 3100 },
};

// Time windows
export const PITCH_TRACE_SECONDS = 15;
export const RESONANCE_TRACE_SECONDS = 15;
export const SILENCE_HOLD_MS = 5000;

// Spectral tilt display range (dB) — lower = lighter voice, higher = heavier
export const SPECTRAL_TILT_RANGE = { min: -5, max: 25 };
// Default target zone for voice feminization (lighter voice)
export const SPECTRAL_TILT_TARGET = { low: -2, high: 8 };

// HNR display range (dB) — higher = cleaner voice
export const HNR_RANGE = { min: 0, max: 35 };

// Colors
export const COLORS = {
  // Pitch trace: green / red
  inTarget: "#4ade80",
  outOfTarget: "#f87171",
  targetBand: "rgba(74, 222, 128, 0.08)",
  targetBandBorder: "rgba(74, 222, 128, 0.25)",
  // Resonance trace: blue / orange
  resInTarget: "#60a5fa",
  resOutOfTarget: "#fb923c",
  resTargetBand: "rgba(96, 165, 250, 0.08)",
  resTargetBandBorder: "rgba(96, 165, 250, 0.25)",
  // Shared
  grid: "rgba(255, 255, 255, 0.06)",
  gridLabel: "rgba(255, 255, 255, 0.3)",
  silenceLine: "rgba(255, 255, 255, 0.05)",
};
