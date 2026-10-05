// pnml.js — pnml_head_scalesex_none0 finalist: windowing, voicing gate,
// linear head and gated EMA (the model inference itself is injected).
//
// Port of scripts/resonance-lab/candidates/pitch-neutral-ml/pnml.py
// (_PNMLHead, engine "none") + pnml_core.window_embs / ema_gated:
//   * a causal 0.75 s window (12 000 samples @ 16 kHz, zero-filled before
//     the stream start) ending every 150 ms;
//   * a window is scored only if a voiced 10 ms pitch frame lies in the
//     trailing 500 ms (the production gender worker's recency gate);
//   * score = w . e + b on the deployed ECAPA q8-v2 model's 192-d fc6
//     embedding e (relu_33) — a 192 -> 1 ridge head trained on LibriSpeech
//     dev-clean with WORLD formant-scale + pitch augmentation, target
//     ln(formant scale) + 0.07 * (+1 women / -1 men). The 0.07 term is a
//     sex/identity component: this readout is "resonance-weighted
//     perceived voice", not a pure resonance measure (critic, 2026-10-04);
//   * EMA (alpha 0.2) over scored windows; 14 consecutive gated windows
//     reset it. Readout pooling in the harness: MEDIAN of EMA values.
// The same inference also yields the deployed meter's original fc7 logits
// (critic: one graph, two readouts — no second 16 MB session).

export const PNML_HOP_S = 0.15;
export const PNML_WIN = 12000;
const SR = 16000;
const RECENCY_S = 0.5;
const ALPHA = 0.2;
const RESET_AFTER = 14;

/** head = { w: number[192] (already divided by sd), b: number } */
export function createPnml(head, onBin) {
  const w = Float64Array.from(head.w);
  const b = head.b;
  let ema = null;
  let silent = 0;
  let nextK = 1; // next window index to schedule (te = k * 0.15 s)
  return {
    get nextK() { return nextK; },
    windowEndSample: (k) => Math.round(k * PNML_HOP_S * SR),
    windowEndTime: (k) => k * PNML_HOP_S,
    /** Fill dst (length 12000) with the window ending at window k from the 16 kHz ring. */
    fillWindow(ring, k, dst) {
      const end = Math.round(k * PNML_HOP_S * SR);
      const start = end - PNML_WIN;
      for (let i = 0; i < PNML_WIN; i++) dst[i] = ring.at(start + i);
    },
    /** True when a voiced frame time lies in (te - 0.5, te]. voicedTimes: ascending array-like. */
    gate(te, lastVoicedT) {
      return lastVoicedT !== null && lastVoicedT > te - RECENCY_S && lastVoicedT <= te;
    },
    markScheduled(k) { nextK = k + 1; },
    /** Head score from the patched model's 194-wide output (logits[0..1], embedding[2..193]). */
    headScore(out194) {
      let s = b;
      for (let i = 0; i < 192; i++) s += w[i] * out194[2 + i];
      return s;
    },
    /**
     * Deliver window k's result IN ORDER: raw head score, or null when the
     * window was gated (counts toward the EMA reset). Dropped windows (worker
     * busy) are simply never delivered.
     */
    result(k, raw) {
      const te = k * PNML_HOP_S;
      if (raw === null || !Number.isFinite(raw)) {
        silent++;
        if (silent >= RESET_AFTER) ema = null;
        onBin(te, null, null);
        return;
      }
      silent = 0;
      ema = ema === null ? raw : ema + ALPHA * (raw - ema);
      onBin(te, ema, raw);
    },
    reset() { ema = null; silent = 0; nextK = 1; },
  };
}
