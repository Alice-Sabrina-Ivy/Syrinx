// pitchLevel.js — the pitch LEVEL a target is judged on: the running
// median of the voiced pitch values in the last PITCH_LEVEL_WINDOW_MS.
// Pure (no React) — used by the live trace / readouts, session stats and
// the History traces, and by the band-coverage measurement
// (measurements/training-direction-targets-2026-10-07.md).
//
// Why a level and not the frame: the target ranges describe speakers'
// AVERAGE speaking pitch (population ranges of mean / modal F0), while a
// frame-by-frame judgement mostly measures intonation — with per-frame
// colouring a speaker whose average sat in the middle of the 3.3-semitone
// androgynous band read on target only ~40 % of the time, against ~80 %
// for the feminine and ~90 % for the masculine band. The running median
// follows a sustained change of level within about a second and ignores
// intonation peaks and dips.

export const PITCH_LEVEL_WINDOW_MS = 1500;

// Sorted-insert / remove helpers on a numeric ascending array.
function lowerBound(a, x) {
  let lo = 0, hi = a.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (a[mid] < x) lo = mid + 1; else hi = mid;
  }
  return lo;
}

function medianSorted(a) {
  const n = a.length;
  if (n === 0) return null;
  const m = n >>> 1;
  return n % 2 ? a[m] : (a[m - 1] + a[m]) / 2;
}

// Streaming level: push(timeMs, hz | null) in time order; returns the
// level at that frame (null on an unvoiced frame — nothing to judge).
export function createPitchLevel({ windowMs = PITCH_LEVEL_WINDOW_MS } = {}) {
  const queue = [];   // { t, hz } voiced entries, oldest first
  let head = 0;
  let sorted = [];
  return {
    push(t, hz) {
      while (head < queue.length && queue[head].t <= t - windowMs) {
        const old = queue[head++].hz;
        sorted.splice(lowerBound(sorted, old), 1);
      }
      if (head > 256 && head * 2 > queue.length) { queue.splice(0, head); head = 0; }
      if (hz == null || !(hz > 0)) return null;
      queue.push({ t, hz });
      sorted.splice(lowerBound(sorted, hz), 0, hz);
      return medianSorted(sorted);
    },
    reset() { queue.length = 0; head = 0; sorted = []; },
  };
}

// Levels for an array of points in time order (one per point, null where
// the point is unvoiced). getTime / getHz read a point's fields.
export function pitchLevels(points, getTime, getHz, windowMs = PITCH_LEVEL_WINDOW_MS) {
  const lv = createPitchLevel({ windowMs });
  return points.map((p) => lv.push(getTime(p), getHz(p)));
}

// The level at time t from a list of trace points ({ time, pitch }) in
// time order, using only points at or before t (scanning back from index
// `from`, default the last point). null when nothing voiced is in the window.
export function pitchLevelAt(points, t, windowMs = PITCH_LEVEL_WINDOW_MS, from = points.length - 1) {
  const vals = [];
  for (let i = from; i >= 0; i--) {
    const p = points[i];
    if (p.time > t) continue;
    if (p.time <= t - windowMs) break;
    if (p.pitch != null && p.pitch > 0) vals.push(p.pitch);
  }
  if (vals.length === 0) return null;
  vals.sort((a, b) => a - b);
  return medianSorted(vals);
}
