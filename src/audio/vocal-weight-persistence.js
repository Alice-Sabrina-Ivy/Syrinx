// vocal-weight-persistence.js — Dexie wrappers for the per-user CPP
// baseline (and optional target). Persisted across sessions so users
// calibrate once per device.
//
// Schema lives in src/db.js (vocalWeightCalibration table, single
// row keyed on id="default"). See that file for the row shape.
//
// Algorithm is sample-rate-invariant since the 2026-05-12 canonical-
// rate merge, so the persisted μ/σ are valid regardless of which
// sample rate they were captured at — baselineSampleRate /
// targetSampleRate are diagnostic only.

import db from "../db.js";

const ROW_ID = "default";
const SCHEMA_VERSION = 1;

// Load the current calibration row. Returns null if no row exists
// (first-ever session — caller should trigger calibration UI).
export async function loadCalibration() {
  const row = await db.vocalWeightCalibration.get(ROW_ID);
  return row ?? null;
}

// Returns true if a baseline has been captured and is loadable.
// Distinguished from "row exists but baselineMu is null" — that
// state is also "no baseline" but indicates the user explicitly
// cleared one rather than never having captured one.
export async function hasBaseline() {
  const row = await loadCalibration();
  return row != null && typeof row.baselineMu === "number";
}

// Returns true if a target has been captured.
export async function hasTarget() {
  const row = await loadCalibration();
  return row != null && typeof row.targetMu === "number";
}

// Save (or replace) the baseline. mu, sigma in dB; sampleRate is
// diagnostic only (algorithm is rate-invariant); sampleCount is the
// number of aggregator emits used to compute μ/σ.
export async function saveBaseline({ mu, sigma, sampleRate, sampleCount }) {
  const now = new Date().toISOString();
  const existing = await loadCalibration();
  await db.vocalWeightCalibration.put({
    id: ROW_ID,
    schemaVersion: SCHEMA_VERSION,
    baselineMu: mu,
    baselineSigma: sigma,
    baselineCapturedAt: now,
    baselineSampleRate: sampleRate ?? null,
    baselineSampleCount: sampleCount ?? null,
    // Preserve target if present
    targetMu: existing?.targetMu ?? null,
    targetSigma: existing?.targetSigma ?? null,
    targetCapturedAt: existing?.targetCapturedAt ?? null,
    targetSampleRate: existing?.targetSampleRate ?? null,
    targetSampleCount: existing?.targetSampleCount ?? null,
    lastUsedAt: now,
  });
}

// Save (or replace) the target. Requires a baseline to already
// exist (target without baseline is meaningless — polarity logic
// needs both). Throws if no baseline is present.
export async function saveTarget({ mu, sigma, sampleRate, sampleCount }) {
  const existing = await loadCalibration();
  if (existing == null || typeof existing.baselineMu !== "number") {
    throw new Error("Cannot save target without a baseline");
  }
  const now = new Date().toISOString();
  await db.vocalWeightCalibration.put({
    ...existing,
    targetMu: mu,
    targetSigma: sigma,
    targetCapturedAt: now,
    targetSampleRate: sampleRate ?? null,
    targetSampleCount: sampleCount ?? null,
    lastUsedAt: now,
  });
}

// Clear the baseline. Also clears the target since a target without
// a baseline is meaningless (polarity logic needs both). After this,
// the next session triggers the calibration UI again.
export async function clearBaseline() {
  await db.vocalWeightCalibration.delete(ROW_ID);
}

// Clear only the target, keep the baseline. Gauge falls back to
// single-baseline ±2σ mode.
export async function clearTarget() {
  const existing = await loadCalibration();
  if (existing == null) return;
  await db.vocalWeightCalibration.put({
    ...existing,
    targetMu: null,
    targetSigma: null,
    targetCapturedAt: null,
    targetSampleRate: null,
    targetSampleCount: null,
    lastUsedAt: new Date().toISOString(),
  });
}

// Update lastUsedAt without changing μ/σ — called on session start
// when an existing calibration is loaded. Useful for future "stale
// calibration" detection (not currently wired up, but the field is
// kept fresh so the data is there when needed).
export async function touchLastUsed() {
  const existing = await loadCalibration();
  if (existing == null) return;
  await db.vocalWeightCalibration.put({
    ...existing,
    lastUsedAt: new Date().toISOString(),
  });
}
