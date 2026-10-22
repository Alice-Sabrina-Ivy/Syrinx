// frontend.js — F0 front end F-S for Voice Shaper: Syrinx's own posted
// pitch track (one value per 25 ms capture chunk, 0 = unvoiced) mapped onto
// WORLD's 5 ms frames, then refined by StoneMask (engine/world.js).
//
// Carried over from the Phase 0 spike (scripts/voice-preview/lib/frontends.js
// at 3f7603f; the F-S functions only). The arithmetic is unchanged: the parity
// test (tests/voice-preview/parity-test.js) requires every render to be
// bit-identical to the spike's. Rule (the scratch prototype's grid_to_frames,
// written to compute the same IEEE doubles as its numpy form):
//   frame i sits at t = i * fp / 1000 s; p = (t - origin) / step;
//   both neighbours j0 = floor(p), j0 + 1 voiced -> log-linear interpolation;
//   otherwise the nearest track value (numpy.round = round half to even) if
//   |p - jn| <= 0.75, else unvoiced (0).
// F-S: hop k describes the 80 ms window centred at (k + 1) * 0.025 - 0.040 s
//      from the recording's first sample -> origin -0.015, step 0.025.
// measurements/voice-preview-phase1-2026-10-19.md §3, §5.

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

/** Map a track (values at origin + j * step, 0 = unvoiced) onto times t. */
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

/** F-S: posted pitch per 25 ms hop -> WORLD frames ({ f0, t }) for a clip of n samples at sr. */
export function postedToFrames(post, n, sr, fp = 5) {
  const t = frameTimes(framesFor(n, sr, fp), fp);
  return { f0: mapTrack(post, t, -0.015, 0.025), t };
}
