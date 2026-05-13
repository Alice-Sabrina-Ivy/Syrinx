// db.js — Dexie IndexedDB setup for Syrinx
// Schema: settings, sessions, frames, exerciseResults
//
// v2 had a vocalWeightCalibration table for persisted CPP baselines,
// added during the 2026-05-12 Stage C iteration and then removed in
// the same-day course correction (zero-interaction adaptive σ window
// makes cross-session persistence unnecessary). The v2 migration is
// retained as a no-op-then-drop so dev users who tested the Stage C
// branch get the v2 table cleanly removed on next session start
// rather than getting a Dexie version-conflict error.

import Dexie from "dexie";

const db = new Dexie("syrinx");

db.version(1).stores({
  // User settings (single row for now; multi-profile in future)
  // Row shape: { id: "default", displayName, goalPreset,
  //   targetF0Low, targetF0High, targetF2Low, targetF2High,
  //   targetSpectralTiltMax, recordAudio, createdAt, updatedAt }
  settings: "id",

  // Sessions — practice sessions with summary stats
  // Row shape: { id (auto), startedAt, endedAt, durationSeconds,
  //   sessionType, audioBlob (optional),
  //   avgF0, avgF1, avgF2, avgF3, medianF0, medianF2,
  //   avgSpectralTilt, avgHnr,
  //   pctTimeInPitchTarget, pctTimeInResonanceTarget,
  //   pitchRangeLow, pitchRangeHigh, pitchStdev,
  //   voicedDurationSeconds, notes }
  sessions: "++id, startedAt, sessionType",

  // Per-frame metrics (raw time series linked to sessions)
  // Row shape: { id (auto), sessionId, timestampMs,
  //   voiced, f0, f1, f2, f3, intensity, spectralTilt, hnr }
  frames: "++id, sessionId, timestampMs",

  // Exercise results (for later)
  // Row shape: { id (auto), sessionId, exerciseId,
  //   startedAt, completedAt, score, metrics, notes }
  exerciseResults: "++id, sessionId, exerciseId, startedAt",
});

// v2: drops the short-lived vocalWeightCalibration table introduced
// then removed within the 2026-05-12 Stage C iteration. Dexie requires
// monotonic version numbers; bumping to v2 with `null` for that table
// removes it cleanly on databases that have it. Databases still on v1
// (the typical case — Stage C wasn't released to main) simply skip
// past this migration since the table never existed there.
db.version(2).stores({
  vocalWeightCalibration: null,
});

export default db;
