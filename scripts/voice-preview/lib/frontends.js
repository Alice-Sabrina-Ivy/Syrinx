// frontends.js — mapping F0 front ends onto WORLD's 5 ms frames and PSOLA's
// 10 ms grid (voice-preview spike, measurements/voice-preview-spike-2026-10-12.md §P4).
//
// The rule is the scratch prototype's grid_to_frames (world_render.py), written
// so that it computes the same IEEE doubles as its numpy form:
//   frame i sits at t = i * fp / 1000 s; p = (t - origin) / step;
//   both neighbours j0 = floor(p), j0 + 1 voiced -> log-linear interpolation;
//   otherwise the nearest track value (numpy.round = round half to even) if
//   |p - jn| <= 0.75, else unvoiced (0).
// F-L: the lab's production pitch replica (lab-engine.js gridTrack), 10 ms grid,
//      t_j = 0.005 + 0.01 j  -> origin 0.005, step 0.01 (the prototype's front end)
// F-S: the real pitch worker's posted values, one per 25 ms hop; hop k describes the
//      window centred at (k + 1) * 0.025 - 0.040 s -> origin -0.015, step 0.025
//      (the prototype's rule scaled to a 25 ms hop; nearest within 18.75 ms)

/** numpy.round / rint for doubles: round half to even. */
export function roundHalfEven(x) {
  const f = Math.floor(x);
  const d = x - f;
  if (d < 0.5) return f;
  if (d > 0.5) return f + 1;
  return f % 2 === 0 ? f : f + 1;
}

/** The prototype's WORLD frame count: int(len(x) / sr * 1000 / fp) + 1. */
export const framesFor = (n, sr, fp = 5) => Math.trunc(n / sr * 1000 / fp) + 1;

/** Frame times, as numpy computes np.arange(n) * fp / 1000.0. */
export function frameTimes(nFrames, fp = 5) {
  const t = new Float64Array(nFrames);
  for (let i = 0; i < nFrames; i++) t[i] = i * fp / 1000;
  return t;
}

/**
 * Map a track (values at origin + j * step, 0 = unvoiced) onto times t.
 * For origin 0.005 / step 0.01 this is world_render.py grid_to_frames exactly.
 */
export function mapTrack(track, t, origin, step) {
  const n = track.length;
  const g = (j) => (j >= 0 && j < n ? Number(track[j]) : 0);
  const out = new Float64Array(t.length);
  for (let i = 0; i < t.length; i++) {
    const p = (t[i] - origin) / step;
    const j0 = Math.floor(p);
    const g0 = g(j0), g1 = g(j0 + 1);
    if (g0 > 0 && g1 > 0) {
      const w = p - j0;
      out[i] = Math.exp((1 - w) * Math.log(g0) + w * Math.log(g1));
      continue;
    }
    const jn = roundHalfEven(p);
    out[i] = Math.abs(p - jn) <= 0.75 ? g(jn) : 0;
  }
  return out;
}

/** F-L: 10 ms grid -> WORLD frames ({ f0, t }) for a clip of n samples at sr. */
export function gridToFrames(grid, n, sr, fp = 5) {
  const t = frameTimes(framesFor(n, sr, fp), fp);
  return { f0: mapTrack(grid, t, 0.005, 0.01), t };
}

/** F-S: posted pitch per 25 ms hop -> WORLD frames ({ f0, t }). */
export function postedToFrames(post, n, sr, fp = 5) {
  const t = frameTimes(framesFor(n, sr, fp), fp);
  return { f0: mapTrack(post, t, -0.015, 0.025), t };
}

/** Any front end -> PSOLA's 10 ms grid (t_j = 0.005 + 0.01 j) for a clip of n samples at sr. */
export function toPsolaGrid(kind, track, n, sr) {
  const nGrid = Math.max(1, Math.floor((n / sr - 0.005) / 0.01) + 1);
  if (kind === "L") return Float64Array.from(track); // the replica's own grid, as the prototype used it
  const tg = new Float64Array(nGrid);
  for (let j = 0; j < nGrid; j++) tg[j] = 0.005 + 0.01 * j;
  if (kind === "S") return mapTrack(track, tg, -0.015, 0.025);
  // "H" / "D": WORLD frames at i * 5 ms; grid point j is frame 2j + 1 (raw tracker output)
  const out = new Float64Array(nGrid);
  for (let j = 0; j < nGrid; j++) out[j] = 2 * j + 1 < track.length ? track[2 * j + 1] : 0;
  return out;
}
