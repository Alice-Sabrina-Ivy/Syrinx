// results.js — what a lesson measures and saves (pure; tests/exercises/results-test.js).
// docs/guided-exercises-design.md §8.
//
// "Count on your target" (P6): the frames the hook hands the exercise frame tap
// (exercises/bridge.js — the same frame a session recording stores) while a measuring
// card is on screen, stamped with the time they arrived. The result uses the session
// statistics' own rule (utils/sessionStats.js computeSummaryStats): the pitch LEVEL
// (running 1.5 s median of the voiced pitch, utils/pitchLevel.js) is judged against the
// band, and only the band counts as on target. Reported: the median level, the share of
// voiced frames whose level is in the band (null with no band), and the voiced time
// (25 ms per voiced frame, as the session statistics count it). Under MIN_VOICED_S
// nothing is reported.
//
// Saved rows (Dexie `exerciseResults`, one per lesson run that reached its result card):
//   { exerciseId, startedAt, endedAt, direction, sessionId (the session recording at the
//     time, or null), feel ("easy" | "effort" | "strained" | null), results ({} or numbers) }
// No audio is ever saved.

import { computeSummaryStats } from "../utils/sessionStats.js";
import { pitchLevels } from "../utils/pitchLevel.js";
import { pitchTargetFor, isTrainingDirection } from "../utils/trainingDirection.js";

export const MIN_VOICED_S = 3;
const FRAME_S = 0.025;

export const FEELS = Object.freeze(["easy", "effort", "strained"]);

/** Collects frames ({ voiced, f0 }) with their arrival time; compact (three parallel arrays). */
export function createFrameLog() {
  let t = [], voiced = [], f0 = [];
  return {
    push(frame, atMs) {
      t.push(atMs);
      const v = !!frame?.voiced && frame.f0 != null && frame.f0 > 0;
      voiced.push(v);
      f0.push(v ? frame.f0 : null);
    },
    clear() { t = []; voiced = []; f0 = []; },
    get length() { return t.length; },
    voicedSeconds() { let n = 0; for (const v of voiced) if (v) n++; return n * FRAME_S; },
    /** Frames in the session-statistics shape ({ timestampMs, voiced, f0 }). */
    frames() { return t.map((ms, i) => ({ timestampMs: ms, voiced: voiced[i], f0: f0[i] })); },
  };
}

function median(values) {
  if (!values.length) return null;
  const s = [...values].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

/**
 * The "Count on your target" result from frames ({ timestampMs, voiced, f0 }) of every
 * measuring card, in time order. null when there is less than MIN_VOICED_S of voice.
 * { levelHz, inBandPct (null with no band), voicedS }.
 */
export function countResult(frames, direction) {
  const voicedFrames = frames.filter((f) => f.voiced && f.f0 != null && f.f0 > 0);
  const voicedS = voicedFrames.length * FRAME_S;
  if (voicedS < MIN_VOICED_S) return null;
  const ordered = [...voicedFrames].sort((a, b) => a.timestampMs - b.timestampMs);
  const levels = pitchLevels(ordered, (f) => f.timestampMs, (f) => f.f0).filter((v) => v != null);
  const levelHz = median(levels);
  const hasBand = isTrainingDirection(direction) && pitchTargetFor(direction) != null;
  const stats = hasBand ? computeSummaryStats(frames, { directionLog: [{ atMs: 0, direction }] }) : null;
  return {
    levelHz: levelHz == null ? null : Math.round(levelHz * 10) / 10,
    inBandPct: hasBand ? stats.pctTimeInPitchTarget : null,
    voicedS: Math.round(voicedS * 10) / 10,
  };
}

/** A row for the `exerciseResults` table. */
export function resultRow({ exerciseId, startedAt, endedAt, direction = null, sessionId = null, feel = null, results = {} }) {
  return {
    exerciseId,
    startedAt,
    endedAt,
    direction: isTrainingDirection(direction) ? direction : null,
    sessionId: Number.isFinite(sessionId) ? sessionId : null,
    feel: FEELS.includes(feel) ? feel : null,
    results: results ?? {},
  };
}

/** Is this a row the import may add? (a string exerciseId and a numeric startedAt) */
export function isImportableResult(row) {
  return !!row && typeof row === "object" && typeof row.exerciseId === "string" && row.exerciseId.length > 0
    && Number.isFinite(row.startedAt);
}

/** The identity of a result across devices and backups (an import skips rows already here). */
export const resultKey = (row) => `${row.exerciseId}@${row.startedAt}`;
