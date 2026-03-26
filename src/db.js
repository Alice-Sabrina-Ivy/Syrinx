// db.js — Dexie IndexedDB setup for Syrinx
// Schema: settings, sessions, frames, exerciseResults
// (baselines and exercises tables added in later sessions)

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

export default db;
