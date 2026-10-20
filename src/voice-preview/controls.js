// controls.js — the voice preview's slider maths (pure; no imports). Used by the
// worker (median, 5th percentile, limits, the formant scale) and by the card.
// measurements/voice-preview-phase1-2026-10-19.md §6.
//
// Pitch slider: integer semitones relative to the recording's median posted pitch.
//   max +12; min = the lowest st >= -12 that keeps the shifted 5th percentile at or
//   above 75 Hz (the detector floor), so at p5 = 75 Hz lowering is off.
// Resonance slider: integer percent, -21 .. +26, formant scale a = (100 + pct) / 100
//   (x0.79 .. x1.26; 3 % gives exactly the double 1.03, as the spike's literals).

export const ST_MAX = 12;
export const ST_FLOOR = -12;
export const LOW_HZ = 75;
export const PCT_MIN = -21;
export const PCT_MAX = 26;
/** Default steps (the "small step" presets). */
export const STEP_ST = 2;
export const STEP_PCT = 3;

/** Formant scale for a resonance setting in percent. */
export const formantScale = (pct) => (100 + pct) / 100;

/** The renderer's pitch factor (engine/world.js pitchFactor; same expression). */
const factor = (st) => 2 ** (st / 12);

/** numpy.percentile's default (linear) on an ascending array; q in 0..1. */
export function percentile(sorted, q) {
  const n = sorted.length;
  if (n === 0) return null;
  const h = (n - 1) * q;
  const lo = Math.floor(h), hi = Math.ceil(h);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (h - lo);
}

/** Median and 5th percentile of the voiced (> 0) values of a posted track. */
export function pitchStats(track) {
  const v = [];
  for (let i = 0; i < track.length; i++) if (track[i] > 0) v.push(Number(track[i]));
  v.sort((a, b) => a - b);
  return { medianHz: percentile(v, 0.5), p5Hz: percentile(v, 0.05), voicedHops: v.length };
}

/**
 * Slider limits for a recording. stMin: the lowest integer st in [-12, 0] with
 * p5 x 2^(st/12) >= 75 Hz, evaluated with the renderer's own factor (so the rule
 * binds exactly, whatever the rounding of 12 log2(75 / p5)).
 */
export function pitchLimits(p5Hz) {
  let stMin = 0;
  if (p5Hz > 0) {
    stMin = Math.max(ST_FLOOR, Math.min(0, Math.ceil(12 * Math.log2(LOW_HZ / p5Hz))));
    while (stMin - 1 >= ST_FLOOR && p5Hz * factor(stMin - 1) >= LOW_HZ) stMin--;
    while (stMin < 0 && p5Hz * factor(stMin) < LOW_HZ) stMin++;
  }
  return { stMin, stMax: ST_MAX, pctMin: PCT_MIN, pctMax: PCT_MAX };
}

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
export const clampSt = (st, limits) => clamp(Math.round(st), limits.stMin, limits.stMax);
export const clampPct = (pct, limits = { pctMin: PCT_MIN, pctMax: PCT_MAX }) => clamp(Math.round(pct), limits.pctMin, limits.pctMax);

/** The pitch label's Hz: the median times the ratio (not a re-measurement), rounded. */
export const shiftedHz = (medianHz, st) => Math.round(medianHz * factor(st));

/** Quick settings. current: { st, pct }; returns the new { st, pct }, clamped. */
export const PRESETS = Object.freeze(["higherBrighter", "lowerDarker", "pitchOnly", "resonanceOnly", "unchanged"]);
export function applyPreset(name, current, limits) {
  switch (name) {
    case "higherBrighter": return { st: clampSt(STEP_ST, limits), pct: clampPct(STEP_PCT, limits) };
    case "lowerDarker": return { st: clampSt(-STEP_ST, limits), pct: clampPct(-STEP_PCT, limits) };
    case "pitchOnly": return { st: clampSt(current.st, limits), pct: 0 };
    case "resonanceOnly": return { st: 0, pct: clampPct(current.pct, limits) };
    case "unchanged": return { st: 0, pct: 0 };
    default: throw new Error(`unknown preset ${name}`);
  }
}

/** Round half away from zero (symmetric for raising and lowering). */
const roundSym = (x) => Math.sign(x) * Math.round(Math.abs(x));

/**
 * "Toward my pitch target": st = clamp(round(12 log2(target / median)), min, +12).
 * Returns { st, hz (the label's Hz), clamped: "high" | "low" | null }.
 */
export function targetSetting(targetHz, medianHz, limits) {
  const raw = roundSym(12 * Math.log2(targetHz / medianHz));
  const st = clamp(raw, limits.stMin, limits.stMax);
  const clamped = raw > st ? "high" : raw < st ? "low" : null;
  return { st, hz: shiftedHz(medianHz, st), clamped };
}

/** The target field's prefill: the geometric centre of a pitch band ({ low, high }), or null. */
export const targetPrefillHz = (band) => (band && band.low > 0 && band.high > 0 ? Math.round(Math.sqrt(band.low * band.high)) : null);
