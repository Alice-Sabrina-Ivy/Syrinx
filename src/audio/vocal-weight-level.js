// vocal-weight-level.js — the cue strip's vocal-weight LEVEL: the median of
// the last WEIGHT_LEVEL_EMITS voiced CPP-aggregate emits (one per 250 ms of
// voiced content, so 20 = the last ~5 s of voiced speech, the same horizon
// as the resonance cue's readout). The level is read against the session's
// frozen baseline (vocal-weight-baseline.js), so it is in the same σ units
// as the per-emit sigmaDelta and the direction zones keep their meaning;
// sigmaDelta is linear in CPP, so sigmaDelta(median CPP) = median sigmaDelta.
//
// Why (2026-10-07 cue-strip review): a single emit is one 1-s aggregate and
// scatters about ±1.1 σ around the voice's own level (same-voice q10–q90
// spread 2.3 σ on 12 resynthesised LibriSpeech runs), so the dot and its
// trail mostly showed frame noise and drifted in and out of a ±0.5 σ zone
// by chance. The 5 s median cuts that spread to 0.67 σ.
// measurements/cue-strip-review-fixes-2026-10-07.md §1.
//
// Pure; fed from useAudioPipeline on each fresh, pitched aggregate emit
// (during calibration too, so the level is ready the moment the baseline
// freezes). Frozen during silence (no emits), like the baseline.

export const WEIGHT_LEVEL_EMITS = 20;

export function createWeightLevel(n = WEIGHT_LEVEL_EMITS) {
  let ring = [];
  return {
    /** One fresh voiced aggregate CPP (dB). Non-finite values are ignored. */
    push(cpp) {
      if (typeof cpp !== "number" || !Number.isFinite(cpp)) return;
      ring.push(cpp);
      if (ring.length > n) ring = ring.slice(ring.length - n);
    },
    /** Median CPP of the ring, or null when empty. */
    cpp() {
      if (!ring.length) return null;
      const s = [...ring].sort((a, b) => a - b);
      const h = s.length >> 1;
      return s.length % 2 ? s[h] : (s[h - 1] + s[h]) / 2;
    },
    size: () => ring.length,
    clear() { ring = []; },
  };
}
