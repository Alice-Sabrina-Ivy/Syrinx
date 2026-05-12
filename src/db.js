// db.js — Dexie IndexedDB setup for Syrinx
// Schema: settings, sessions, frames, exerciseResults
// v2 adds: vocalWeightCalibration (persisted CPP baseline + target).

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

// v2: add vocalWeightCalibration. Persisted CPP baseline (and
// optional target) so calibration is one-time per device instead of
// per-session. Algorithm is sample-rate-invariant since the
// 2026-05-12 canonical-rate merge, so baselineSampleRate is
// diagnostic-only — not used to correct the baseline μ/σ. Single
// row keyed on id="default" mirroring the settings table pattern.
//
// Row shape: {
//   id: "default",
//   schemaVersion: 1,
//   baselineMu, baselineSigma, baselineCapturedAt,
//   baselineSampleRate, baselineSampleCount,
//   targetMu, targetSigma, targetCapturedAt,
//   targetSampleRate, targetSampleCount,
//   lastUsedAt,
// }
// All target* fields are null when no target has been captured.
// All baseline* fields are null on the first session (triggers
// calibration UI).
db.version(2).stores({
  vocalWeightCalibration: "id",
});

export default db;
