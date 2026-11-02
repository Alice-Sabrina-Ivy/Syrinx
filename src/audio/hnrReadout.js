// hnrReadout.js — the live HNR readout under the cue strip (2026-11-02).
//
// The DSP worker computes HNR every 6th analysis frame (~150 ms) on the
// last 70 ms of audio, voiced or not, and until 2026-11-02 the readout
// showed the newest value. Running speech puts many of those windows on
// consonants, voicing edges and gaps, so the readout jumped ~3.5-4 times a
// second across a ~20 dB range, and 27 / 37 % of the readings while
// speaking were negative (public read speech, women / men —
// measurements/hnr-readout-2026-11-02.md).
//
// The readout now uses the session statistics' rule (sessionStats.js: HNR
// of voiced frames only): the median of the fresh HNR values computed on
// voiced frames in the last WINDOW_MS. With none in the window it returns
// null and the hook keeps the last value it showed. Measured in the built
// app: 4 / 23 % negative, ~2-2.6 changes a second; 3 s chosen over 1.5 s
// (10 / 30 %). The level is unchanged by this (median 7 / 2 dB vs Praat's
// voiced-frame mean 9.9 / 5.2 dB on the same audio). Display only:
// recorded frames keep the measured value. Pure module (no React).

export const HNR_READOUT_WINDOW_MS = 3000;

export function createHnrReadout(windowMs = HNR_READOUT_WINDOW_MS) {
  const ring = []; // { t, v } in time order
  const prune = (t) => { while (ring.length && ring[0].t < t - windowMs) ring.shift(); };
  return {
    // hnr: a freshly computed value (null on frames without one); voiced:
    // the frame counts as voice (posted pitch, not hidden by the voice gate).
    push(t, hnr, voiced) {
      if (voiced && hnr !== null && hnr !== undefined && Number.isFinite(hnr)) ring.push({ t, v: hnr });
      prune(t);
    },
    value(t) {
      prune(t);
      if (!ring.length) return null;
      const s = ring.map((x) => x.v).sort((a, b) => a - b);
      const m = s.length >> 1;
      return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
    },
    reset() { ring.length = 0; },
  };
}
