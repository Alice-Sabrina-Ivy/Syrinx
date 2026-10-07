// trainingDirection.js — what the user is trying to sound like, and the
// target ranges that follow from it. Pure (no React, no Dexie import) so
// it runs in Node tests; persistence helpers take the settings table as
// an argument.
//
// No direction is ever assumed: the app asks on every load (preselecting
// the last answer), and until something is chosen — or when the answer
// is "Just exploring" — there are no target bands and every readout uses
// the neutral style. Feminine, masculine and androgynous targets all use
// the same look; only the ranges differ.
//
// Sources and derivations: measurements/training-direction-targets-2026-10-07.md
//   Pitch (speaking F0)
//     feminine     165-255 Hz  typical adult women's speaking F0
//     masculine     85-155 Hz  typical adult men's speaking F0
//                               (Baken & Orlikoff 2000, from Fitch & Holbrook 1970)
//     androgynous  145-175 Hz  the zone where listeners' gender judgements
//                               are ambiguous and resonance decides (Gelfer &
//                               Bennett 2013: formants decide at 145-165 Hz;
//                               Wolfe et al. 1990: lowest mean F0 heard as
//                               female 155 Hz). The 175 Hz upper bound is an
//                               extrapolation above the highest ambiguous
//                               value tested (165 Hz).
//   These are ranges of speakers' AVERAGE speaking pitch, so the app judges
//   the running pitch LEVEL (utils/pitchLevel.js: median of the last 1.5 s
//   of voiced pitch), never a single frame — per-frame judgement mostly
//   measured intonation. Beyond the band in the direction of travel (above
//   255 Hz for feminine, below 85 Hz for masculine) is "beyond": shown
//   neutrally, not as off target — a lower voice is not less masculine.
//   No resonance (F2) target: per-frame F2 is dominated by the vowel (the
//   bands held near-chance shares of men's and women's vowels), so it is a
//   neutral readout in every direction (2026-10-07 review); the F2 readout
//   left the Dashboard with the cue strip. The cue strip's resonance cue
//   (spectral warp) shows the direction as an outline only — never judged,
//   since its absolute position shifts with the microphone and room
//   (resonanceTargetFor below).
//   Vocal weight (relative to the user's own calibration baseline, so it
//   has no population "in between"): feminine = the lighter side
//   (σ ≥ +0.5), masculine = the heavier side (σ ≤ −0.5), androgynous /
//   exploring = no zone. The CPP reading also moves with pitch — a raised
//   voice reads lighter, a lowered one heavier — so the zone rewards a
//   pitch change too; it was removed in the 2026-10-07 review and restored
//   by user decision the same day with a visible note on the gauge
//   whenever a zone is shown (WEIGHT_PITCH_NOTE).

import { BASELINE_SIGMA } from "../audio/vocal-weight-baseline.js";

export const TRAINING_DIRECTIONS = Object.freeze([
  Object.freeze({ id: "feminine", label: "More feminine" }),
  Object.freeze({ id: "masculine", label: "More masculine" }),
  Object.freeze({ id: "androgynous", label: "Androgynous or in between" }),
  Object.freeze({ id: "exploring", label: "Just exploring" }),
]);

const IDS = new Set(TRAINING_DIRECTIONS.map((d) => d.id));

// toward: the direction of travel ("up" / "down"), or null for a zone.
export const PITCH_TARGETS = Object.freeze({
  feminine: Object.freeze({ low: 165, high: 255, toward: "up" }),
  masculine: Object.freeze({ low: 85, high: 155, toward: "down" }),
  androgynous: Object.freeze({ low: 145, high: 175, toward: null }),
});

export function isTrainingDirection(value) {
  return typeof value === "string" && IDS.has(value);
}

export function directionLabel(direction) {
  return TRAINING_DIRECTIONS.find((d) => d.id === direction)?.label ?? null;
}

export function pitchTargetFor(direction) {
  return PITCH_TARGETS[direction] ?? null;
}

// Where a pitch level sits relative to a target:
//   "in"      inside the band (on target)
//   "beyond"  past the band in the direction of travel (on target, shown
//             neutrally: past the typical range, not short of it)
//   "out"     short of the band, or outside a zone (off target)
//   null      no target or no level — rendered neutrally
export function pitchStatus(level, target) {
  if (target == null || level == null || !Number.isFinite(level)) return null;
  if (level >= target.low && level <= target.high) return "in";
  if (target.toward === "up" && level > target.high) return "beyond";
  if (target.toward === "down" && level < target.low) return "beyond";
  return "out";
}

// Counts toward a session's "on target" time.
export function isOnTarget(status) {
  return status === "in" || status === "beyond";
}

// The band to draw for a target on an axis spanning displayRange
// ({ low, high }), clipped to the axis. null = draw nothing.
export function bandForDisplay(target, displayRange) {
  if (target == null) return null;
  const low = Math.max(target.low, displayRange.low);
  const high = Math.min(target.high, displayRange.high);
  return high > low ? { low, high } : null;
}

// ---------------------------------------------------------------------------
// Vocal weight: which side of the session's calibration baseline is the
// target, and from how far (σ = the gauge's σ-distance from the frozen
// first-30-s mean, positive = lighter). Feminine and masculine mirror each
// other; androgynous and exploring have none.
export const WEIGHT_TARGET_SIGMA = 0.5;
export const WEIGHT_TARGETS = Object.freeze({
  feminine: Object.freeze({ side: "lighter", sigma: WEIGHT_TARGET_SIGMA }),
  masculine: Object.freeze({ side: "heavier", sigma: WEIGHT_TARGET_SIGMA }),
});

// Shown next to the gauge whenever a weight zone is: the reading's pitch
// confound (CPP rises with pitch), worded the same for both sides.
export const WEIGHT_PITCH_NOTE = "Vocal weight: raising your pitch also reads lighter, lowering it reads heavier.";

export function weightTargetFor(direction) {
  return WEIGHT_TARGETS[direction] ?? null;
}

// "in" (at least target.sigma toward the target side), "out", or null (no
// target / no reading — rendered neutrally). Short of the zone is shown
// neutrally too (no red): the reading carries the pitch confound.
export function weightStatus(sigmaDelta, target) {
  if (target == null || sigmaDelta == null || !Number.isFinite(sigmaDelta)) return null;
  const toward = target.side === "lighter" ? sigmaDelta : -sigmaDelta;
  return toward >= target.sigma ? "in" : "out";
}

// The zone on the gauge track as { left, width } in percent of the track,
// measured from its LEFT end — the gauge draws Lighter on the left, i.e.
// σ = +span at 0 % and σ = −span at 100 % (the baseline's gaugePosition
// mirrored). null = draw nothing.
export function weightZoneForDisplay(target, span = BASELINE_SIGMA) {
  if (target == null || !(span > target.sigma)) return null;
  const width = ((span - target.sigma) / (2 * span)) * 100;
  return target.side === "lighter" ? { left: 0, width } : { left: 100 - width, width };
}

// The weight zone as a σ range on the cue strip's −span…+span axis
// (heavier on the left, lighter on the right): { low, high } or null.
export function weightRangeFor(direction, span = BASELINE_SIGMA) {
  const t = weightTargetFor(direction);
  if (t == null || !(span > t.sigma)) return null;
  return t.side === "lighter" ? { low: t.sigma, high: span } : { low: -span, high: -t.sigma };
}

// ---------------------------------------------------------------------------
// Resonance (the Dashboard's spectral-warp cue, 2026-10-07): the cue strip's
// soft highlight, in the cue's u units (0 = the typical LibriSpeech man,
// 1 = the typical woman; reference.json "vtln" per-speaker medians).
// feminine = the women's band, masculine = the men's band — the bands the
// strip draws (cueStripModel cueResonanceRef: the 10th–90th percentile of
// individual 5 s readouts, cue-bands.json); androgynous = the gap between
// typical men's and women's readings (men's q90 → women's q10 of the
// per-speaker bands, ref.speakerBands — the readout bands nearly touch);
// exploring / none = no highlight. An outline only — the cue's absolute
// position across microphones is approximate, so it never judges on / off
// target. ref: reference.json's "vtln" entry, or cueResonanceRef(...).
export function resonanceU(ref, value) {
  return (value - ref.menMedian) / (ref.womenMedian - ref.menMedian);
}
export function resonanceTargetFor(direction, ref) {
  if (ref == null) return null;
  const u = (v) => resonanceU(ref, v);
  const sp = ref.speakerBands ?? ref;
  if (direction === "feminine") return { low: u(ref.women.q10), high: u(ref.women.q90) };
  if (direction === "masculine") return { low: u(ref.men.q10), high: u(ref.men.q90) };
  if (direction === "androgynous") return { low: u(sp.men.q90), high: u(sp.women.q10) };
  return null;
}

// The drawn band, e.g. "165–255 Hz".
export function formatTarget(target) {
  if (target == null) return null;
  return `${target.low}–${target.high} Hz`;
}

// What counts as on target, e.g. "≥ 165 Hz" (feminine), "≤ 155 Hz"
// (masculine), "145–175 Hz" (androgynous).
export function formatOnTarget(target) {
  if (target == null) return null;
  if (target.toward === "up") return `≥ ${target.low} Hz`;
  if (target.toward === "down") return `≤ ${target.high} Hz`;
  return formatTarget(target);
}

// ---------------------------------------------------------------------------
// Direction log for a recorded session: [{ atMs, direction }] in order,
// atMs relative to the recording start (the frames' timestampMs clock).
// The direction in effect for a frame is the last entry at or before it.

export function directionAt(log, atMs) {
  if (!Array.isArray(log) || log.length === 0) return null;
  let dir = log[0].direction;
  for (const e of log) {
    if (e.atMs <= atMs) dir = e.direction;
    else break;
  }
  return isTrainingDirection(dir) ? dir : null;
}

// Appends a change (ignores a repeat of the current direction).
export function appendDirection(log, atMs, direction) {
  const list = Array.isArray(log) ? log : [];
  if (!isTrainingDirection(direction)) return list;
  const last = list[list.length - 1];
  if (last && last.direction === direction) return list;
  return [...list, { atMs: Math.max(0, Math.round(atMs)), direction }];
}

// The directions a session went through, in order (a return to an earlier
// direction is listed again; consecutive repeats are never logged).
export function directionSequence(log) {
  if (!Array.isArray(log)) return [];
  const out = [];
  for (const e of log) {
    if (isTrainingDirection(e.direction) && out[out.length - 1] !== e.direction) out.push(e.direction);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Persistence: the Dexie `settings` table, row id "default", field
// `trainingDirection`. Pass db.settings (or any { get, update, put } with
// Dexie semantics). Failures (site data blocked) resolve to null / false:
// the app then just asks without a preselection.

export const SETTINGS_ROW_ID = "default";

export async function loadTrainingDirection(settingsTable) {
  try {
    const row = await settingsTable.get(SETTINGS_ROW_ID);
    return isTrainingDirection(row?.trainingDirection) ? row.trainingDirection : null;
  } catch {
    return null;
  }
}

export async function saveTrainingDirection(settingsTable, direction) {
  if (!isTrainingDirection(direction)) return false;
  try {
    const now = Date.now();
    const updated = await settingsTable.update(SETTINGS_ROW_ID, { trainingDirection: direction, updatedAt: now });
    if (!updated) {
      await settingsTable.put({ id: SETTINGS_ROW_ID, trainingDirection: direction, createdAt: now, updatedAt: now });
    }
    return true;
  } catch {
    return false;
  }
}
