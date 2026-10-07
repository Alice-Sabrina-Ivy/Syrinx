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
//                               (Baken 2000 p. 177, from Fitch & Holbrook 1970)
//     androgynous  145-175 Hz  the zone where listeners' gender judgements
//                               are ambiguous and resonance decides (Gelfer &
//                               Bennett 2013: formants decide at 145-165 Hz,
//                               men's voices misheard from 165 Hz; Wolfe et
//                               al. 1990: lowest mean F0 heard as female 155 Hz)
//   F2 (per-frame second formant; dominated by the vowel, so a weak cue —
//   thresholds are the pooled-vowel medians of Hillenbrand et al. 1995)
//     feminine     >= 1375 Hz  at/above the typical man's median F2
//     masculine    <= 1575 Hz  at/below the typical woman's median F2
//     androgynous  1375-1575 Hz between the two
//   Vocal weight (relative to the user's own recent voice, so it has no
//   population "in between"): feminine = lighter side, masculine =
//   heavier side, androgynous / exploring = no target.

export const TRAINING_DIRECTIONS = Object.freeze([
  Object.freeze({ id: "feminine", label: "More feminine" }),
  Object.freeze({ id: "masculine", label: "More masculine" }),
  Object.freeze({ id: "androgynous", label: "Androgynous or in between" }),
  Object.freeze({ id: "exploring", label: "Just exploring" }),
]);

const IDS = new Set(TRAINING_DIRECTIONS.map((d) => d.id));

export const PITCH_TARGETS = Object.freeze({
  feminine: Object.freeze({ low: 165, high: 255 }),
  masculine: Object.freeze({ low: 85, high: 155 }),
  androgynous: Object.freeze({ low: 145, high: 175 }),
});

// null bound = open-ended on that side.
export const F2_TARGETS = Object.freeze({
  feminine: Object.freeze({ low: 1375, high: null }),
  masculine: Object.freeze({ low: null, high: 1575 }),
  androgynous: Object.freeze({ low: 1375, high: 1575 }),
});

// Which side of the user's own baseline the vocal-weight gauge marks.
export const WEIGHT_TARGETS = Object.freeze({
  feminine: "lighter",
  masculine: "heavier",
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

export function f2TargetFor(direction) {
  return F2_TARGETS[direction] ?? null;
}

export function weightTargetFor(direction) {
  return WEIGHT_TARGETS[direction] ?? null;
}

// true / false against a { low, high } target (null bounds open); null
// when there is no target or no value — callers render that neutrally.
export function inTarget(value, target) {
  if (target == null || value == null || !Number.isFinite(value)) return null;
  if (target.low != null && value < target.low) return false;
  if (target.high != null && value > target.high) return false;
  return true;
}

// The band to draw for a target on an axis spanning displayRange
// ({ low, high }): open ends extend to the axis edge. null = draw nothing.
export function bandForDisplay(target, displayRange) {
  if (target == null) return null;
  const low = Math.max(target.low ?? displayRange.low, displayRange.low);
  const high = Math.min(target.high ?? displayRange.high, displayRange.high);
  return high > low ? { low, high } : null;
}

// Human-readable range, e.g. "165–255 Hz", "≥ 1375 Hz", "≤ 1575 Hz".
export function formatTarget(target) {
  if (target == null) return null;
  if (target.low != null && target.high != null) return `${target.low}–${target.high} Hz`;
  if (target.low != null) return `≥ ${target.low} Hz`;
  if (target.high != null) return `≤ ${target.high} Hz`;
  return null;
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

// The distinct directions a session used, in order of first use.
export function directionsUsed(log) {
  if (!Array.isArray(log)) return [];
  const out = [];
  for (const e of log) if (isTrainingDirection(e.direction) && !out.includes(e.direction)) out.push(e.direction);
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
