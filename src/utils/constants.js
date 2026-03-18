// constants.js — Default target ranges, colors, and configuration

// Default target pitch range for voice feminization (Hz)
export const DEFAULT_PITCH_TARGET = { low: 165, high: 255 };

// Y-axis display range for pitch trace (Hz)
export const PITCH_DISPLAY_RANGE = { low: 75, high: 400 };

// Vowel target zones (F1, F2 in Hz) for typical cisgender female voices
export const VOWEL_TARGETS = [
  { label: "/i/", f1: [270, 400], f2: [2300, 2800], color: "rgba(168, 85, 247, 0.15)" },
  { label: "/e/", f1: [400, 600], f2: [2000, 2500], color: "rgba(59, 130, 246, 0.15)" },
  { label: "/a/", f1: [700, 1000], f2: [1200, 1600], color: "rgba(239, 68, 68, 0.15)" },
  { label: "/o/", f1: [400, 600], f2: [800, 1200], color: "rgba(245, 158, 11, 0.15)" },
  { label: "/u/", f1: [270, 400], f2: [700, 1100], color: "rgba(34, 197, 94, 0.15)" },
];

// Formant display ranges (Hz) for vowel space plot axes
export const F1_RANGE = { low: 200, high: 1100 };
export const F2_RANGE = { low: 500, high: 3000 };

// Time windows
export const PITCH_TRACE_SECONDS = 15;
export const FORMANT_TRAIL_SECONDS = 2;
export const SILENCE_HOLD_MS = 5000;

// Colors
export const COLORS = {
  inTarget: "#4ade80",
  outOfTarget: "#f87171",
  targetBand: "rgba(74, 222, 128, 0.08)",
  targetBandBorder: "rgba(74, 222, 128, 0.25)",
  grid: "rgba(255, 255, 255, 0.06)",
  gridLabel: "rgba(255, 255, 255, 0.3)",
  silenceLine: "rgba(255, 255, 255, 0.05)",
  trailDot: "#a78bfa",
  currentDot: "#c084fc",
  currentDotGlow: "rgba(192, 132, 252, 0.4)",
};
