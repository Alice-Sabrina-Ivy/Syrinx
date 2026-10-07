// sessionStats.js — Summary statistics for a recorded session's frames.
// Shared by the dashboard's finalize path and the start-up repair of
// sessions that never got finalized (tab close / crash / mobile discard),
// so both write identical stat definitions. Pure — runnable in Node.

import { directionAt, pitchTargetFor, f2TargetFor, inTarget } from "./trainingDirection.js";

// Linear-interpolated percentile of an ascending-sorted numeric array.
function percentileSorted(sorted, p) {
  if (!sorted.length) return null;
  const idx = (sorted.length - 1) * p;
  const lo = Math.floor(idx);
  const hi = Math.min(lo + 1, sorted.length - 1);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (idx - lo);
}

// Pitch Range percentiles. A raw min/max over every recorded voiced
// frame reads ~75–400 Hz (the detector's search limits) on almost any
// session, because a handful of stray octave excursions always land in
// the recorded f0. p5..p95 is the range the voice actually spent its
// time in.
export const PITCH_RANGE_LOW_PCT = 0.05;
export const PITCH_RANGE_HIGH_PCT = 0.95;

// Compute summary statistics from recorded frames.
//
// Time-in-target is measured against the training direction in effect at
// each frame (`directionLog`: [{ atMs, direction }] on the frames'
// timestampMs clock — see utils/trainingDirection.js). Frames recorded
// while "Just exploring" have no target and don't count either way; with
// no direction log at all (sessions recorded before directions existed)
// the in-target figures are null rather than assumed.
export function computeSummaryStats(frames, { directionLog = null } = {}) {
  const voicedFrames = frames.filter((f) => f.voiced && f.f0 !== null);
  const f0Values = voicedFrames.map((f) => f.f0);
  const f2Values = voicedFrames.filter((f) => f.f2 !== null).map((f) => f.f2);
  const f1Values = voicedFrames.filter((f) => f.f1 !== null).map((f) => f.f1);
  const f3Values = voicedFrames.filter((f) => f.f3 !== null).map((f) => f.f3);
  const tiltValues = voicedFrames.filter((f) => f.spectralTilt !== null).map((f) => f.spectralTilt);
  const hnrValues = voicedFrames.filter((f) => f.hnr !== null).map((f) => f.hnr);

  const avg = (arr) => arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : null;
  const med = (arr) => {
    if (!arr.length) return null;
    const sorted = [...arr].sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
  };
  const stdev = (arr) => {
    if (arr.length < 2) return null;
    const mean = avg(arr);
    const variance = arr.reduce((sum, v) => sum + (v - mean) ** 2, 0) / (arr.length - 1);
    return Math.sqrt(variance);
  };

  // Time in target (per frame, against that frame's direction).
  let pitchWithTarget = 0, pitchInTarget = 0, f2WithTarget = 0, f2InTarget = 0;
  if (Array.isArray(directionLog) && directionLog.length > 0) {
    for (const f of voicedFrames) {
      const dir = directionAt(directionLog, f.timestampMs ?? 0);
      const p = inTarget(f.f0, pitchTargetFor(dir));
      if (p !== null) { pitchWithTarget++; if (p) pitchInTarget++; }
      const r = inTarget(f.f2, f2TargetFor(dir));
      if (r !== null) { f2WithTarget++; if (r) f2InTarget++; }
    }
  }

  // Estimate voiced duration. DSP analysis runs once per chunk arrival
  // (default chunkMs = 25), not once per WINDOW_MS — so frames are ~25 ms
  // apart in steady state. The earlier 50 ms constant double-counted.
  const frameDurationMs = 25;
  const voicedDurationSeconds = Math.round((voicedFrames.length * frameDurationMs) / 1000);

  // Typed-array sort is numeric and avoids Math.min(...arr)-style spread
  // (engine arg-count limits on long sessions: 60+ minutes of voiced
  // frames at ~40 fps = >100K values).
  const f0Sorted = Float64Array.from(f0Values).sort();

  return {
    avgF0: avg(f0Values),
    medianF0: med(f0Values),
    avgF1: avg(f1Values),
    avgF2: avg(f2Values),
    medianF2: med(f2Values),
    avgF3: avg(f3Values),
    avgSpectralTilt: avg(tiltValues),
    avgHnr: avg(hnrValues),
    pitchRangeLow: percentileSorted(f0Sorted, PITCH_RANGE_LOW_PCT),
    pitchRangeHigh: percentileSorted(f0Sorted, PITCH_RANGE_HIGH_PCT),
    pitchStdev: stdev(f0Values),
    pctTimeInPitchTarget: pitchWithTarget
      ? Math.round((pitchInTarget / pitchWithTarget) * 100)
      : null,
    pctTimeInResonanceTarget: f2WithTarget
      ? Math.round((f2InTarget / f2WithTarget) * 100)
      : null,
    voicedDurationSeconds,
  };
}
