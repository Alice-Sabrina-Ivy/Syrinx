// vocal-weight-baseline.js — Per-user CPPS baseline + optional
// target tracker.
//
// CPP values vary by speaker, microphone, room, and algorithm
// configuration. There is no public reference for "consumer-mic
// running-speech CPP" that would let Syrinx ship a fixed gauge
// range — see measurements/vocal-weight-cpps-audit-2026-05-09.md
// §5 / measurements/vocal-weight-literature-2026-05-09.md §4.4
// for the calibration-honesty rationale.
//
// Per-user baseline approach:
//
//   - During the first BASELINE_VOICED_MS of CUMULATIVE voiced
//     content, accumulate CPP-aggregate samples.
//   - Once the target voiced-content-time has filled, compute mean
//     μ and stdev σ. These freeze.
//   - Baseline is persisted to IndexedDB after the first session
//     and loaded on subsequent sessions, so calibration is one-time
//     per device. The algorithm is sample-rate-invariant (canonical
//     16 kHz internal processing), so the persisted μ/σ are valid
//     across all native sample rates the device might use.
//
// Optional target:
//
//   - After a baseline exists, the user can capture a "target voice"
//     — a separate accumulation that records what their goal voice
//     sounds like. Same accumulation mechanism, stored separately.
//   - With both baseline and target, the gauge spans
//     baseline → target, with polarity derived from sign(targetMu −
//     baselineMu). The σ-distance readout is from the target.
//   - Without a target, the gauge falls back to baseline ± 2σ with
//     fixed Lighter/Heavier labels. σ-distance is from the baseline.
//
// **Voiced-content-time, NOT wall-clock-time.** Each aggregator
// emit represents ~250 ms of new voiced content (the aggregator's
// 250 ms emit interval with 75 % rolling overlap means each
// successive emit adds 250 ms of fresh material). Counting samples
// × emitIntervalMs gives cumulative voiced-content-time, which is
// what the audit specified ("first 30 s of voiced speech in the
// session") — wall-clock spread between first and last sample
// would inflate calibration time on speech with natural pauses
// (breath, thinking, inter-phrase silence) since pauses count
// toward wall-clock spread but are correctly excluded from sample
// count.

// Each aggregator sample represents this much voiced content (the
// aggregator's emit interval). Used to convert sample count → voiced
// content time. Constructor accepts override for tests + future
// tuning.
export const BASELINE_AGGREGATE_INTERVAL_MS = 250;
export const BASELINE_VOICED_MS = 30000;   // 30 s of cumulative voiced content
export const BASELINE_SIGMA = 2;           // gauge spans ±2σ from μ in no-target mode
export const BASELINE_MIN_SAMPLES = 8;     // floor for σ to be meaningful

// Margin (fraction of |target - baseline|) applied beyond the
// baseline/target endpoints so the gauge can still display
// off-by-a-bit values without instantly clamping. 0.25 = 25 %
// headroom on each side, so the visible axis spans 1.5 × the
// baseline→target distance centered on the midpoint.
const GAUGE_MARGIN = 0.25;

export class VocalWeightBaseline {
  constructor({
    baselineVoicedMs = BASELINE_VOICED_MS,
    aggregateIntervalMs = BASELINE_AGGREGATE_INTERVAL_MS,
    gaugeSigma = BASELINE_SIGMA,
    minSamples = BASELINE_MIN_SAMPLES,
  } = {}) {
    this.baselineVoicedMs = baselineVoicedMs;
    this.aggregateIntervalMs = aggregateIntervalMs;
    this.gaugeSigma = gaugeSigma;
    this.minSamples = minSamples;
    // Voiced-content-time threshold for lock = baselineVoicedMs.
    // Sample count needed = ceil(baselineVoicedMs / aggregateIntervalMs)
    // OR minSamples, whichever is larger.
    this._sampleTarget = Math.max(
      minSamples,
      Math.ceil(baselineVoicedMs / aggregateIntervalMs),
    );

    // Sample list during accumulation. Cleared after baseline locks
    // — once μ and σ are computed we don't need the samples
    // themselves.
    this._samples = [];

    // Frozen baseline parameters; null while accumulating.
    this._mu = null;
    this._sigma = null;
    this._locked = false;

    // Optional target parameters. Null when no target has been
    // captured. When non-null, gauge math switches to baseline → target
    // polarity-derived span.
    this._targetMu = null;
    this._targetSigma = null;

    // Tracks how the baseline was acquired — useful for callers that
    // need to know whether the lock triggers a save-to-persistence
    // ("captured") or already came from there ("loaded").
    this._source = null;  // "captured" | "loaded" | null
  }

  // Push a CPP-aggregate sample. Shape: { time, cpp }. Both must be
  // numbers. Caller is responsible for filtering: only voiced
  // aggregates should be accumulated. No-op if already locked.
  accumulate(sample) {
    if (this._locked) return;
    const { time, cpp } = sample;
    if (typeof cpp !== "number" || !isFinite(cpp)) return;
    this._samples.push({ time, cpp });

    if (this._samples.length >= this._sampleTarget) {
      this._lockBaseline();
      this._source = "captured";
    }
  }

  _lockBaseline() {
    const cppValues = this._samples.map((s) => s.cpp);
    const mean = cppValues.reduce((a, b) => a + b, 0) / cppValues.length;
    const variance =
      cppValues.reduce((s, v) => s + (v - mean) ** 2, 0) /
      Math.max(1, cppValues.length - 1);
    this._mu = mean;
    this._sigma = Math.sqrt(variance);
    this._locked = true;
    this._samples.length = 0;
  }

  // Initialize directly from persisted parameters — skips
  // accumulation entirely. Used on session start when a baseline
  // already exists in IndexedDB. Marks the baseline as locked from
  // persistence so the caller can distinguish from fresh capture
  // (no save-back to DB).
  loadFromPersisted({ mu, sigma }) {
    if (typeof mu !== "number" || !isFinite(mu)) return;
    if (typeof sigma !== "number" || !isFinite(sigma) || sigma < 0) return;
    this._mu = mu;
    this._sigma = sigma;
    this._locked = true;
    this._samples.length = 0;
    this._source = "loaded";
  }

  // Attach an optional target. Switches gauge math to baseline →
  // target polarity span. Pass null / undefined to clear the target.
  setTarget({ mu, sigma } = {}) {
    if (typeof mu !== "number" || !isFinite(mu)) {
      this._targetMu = null;
      this._targetSigma = null;
      return;
    }
    this._targetMu = mu;
    this._targetSigma = (typeof sigma === "number" && isFinite(sigma) && sigma >= 0)
      ? sigma
      : null;
  }

  clearTarget() {
    this._targetMu = null;
    this._targetSigma = null;
  }

  // True when baseline parameters are locked and ready for use.
  ready() {
    return this._locked;
  }

  // "captured" if the lock came from accumulate() in this session,
  // "loaded" if from loadFromPersisted, null otherwise.
  source() {
    return this._source;
  }

  // Locked baseline mean. Null while accumulating.
  mu() {
    return this._locked ? this._mu : null;
  }

  // Locked baseline stdev. Null while accumulating.
  sigma() {
    return this._locked ? this._sigma : null;
  }

  // Target mean if a target has been attached, else null.
  targetMu() {
    return this._targetMu;
  }

  // Target stdev if a target has been attached, else null.
  targetSigma() {
    return this._targetSigma;
  }

  // True if both baseline and target exist (gauge runs in
  // baseline → target span mode).
  hasTarget() {
    return this._locked && typeof this._targetMu === "number";
  }

  // Polarity = sign of (targetMu - baselineMu). Returns +1 if going
  // "up" the CPP scale, -1 if going "down", 0 if no target or
  // baseline == target.
  polarity() {
    if (!this.hasTarget()) return 0;
    const delta = this._targetMu - this._mu;
    if (delta > 0) return 1;
    if (delta < 0) return -1;
    return 0;
  }

  // Map a CPP-aggregate value to a gauge position in [0, 1].
  //
  // Two regimes:
  //   - With target: 0 = baseline, 1 = target. Linear in (cpp - μ_b)
  //     / (μ_t - μ_b). Beyond ±GAUGE_MARGIN of the span, clamp to
  //     [0, 1] for display but the σ-distance readout still gives
  //     the true offset.
  //   - Without target: 0 = μ - gaugeSigma·σ, 1 = μ + gaugeSigma·σ.
  //     Polarity is fixed (higher CPP → lighter = position 1).
  //
  // Returns null if baseline isn't ready or cpp isn't valid.
  gaugePosition(cpp) {
    if (!this._locked) return null;
    if (typeof cpp !== "number" || !isFinite(cpp)) return null;

    if (this.hasTarget()) {
      const span = this._targetMu - this._mu;
      if (span === 0) {
        // Degenerate: target == baseline. No meaningful axis; pin to center.
        return 0.5;
      }
      const t = (cpp - this._mu) / span;
      // Accept slight overshoot via GAUGE_MARGIN, then clamp for display.
      const lo = -GAUGE_MARGIN;
      const hi = 1 + GAUGE_MARGIN;
      const mapped = (t - lo) / (hi - lo);
      return Math.max(0, Math.min(1, mapped));
    }

    if (this._sigma === 0) {
      // Pathological: all baseline samples were identical. Map to
      // gauge center; without σ we can't give meaningful position.
      return 0.5;
    }
    const sigmaDelta = (cpp - this._mu) / this._sigma;
    const norm = (sigmaDelta + this.gaugeSigma) / (2 * this.gaugeSigma);
    return Math.max(0, Math.min(1, norm));
  }

  // σ-distance from the anchoring point. With a target attached, the
  // distance is computed against the target (so "+0.0 σ from target"
  // = at target, the user's goal). Without a target, the distance is
  // against the baseline (so "+1.2 σ from baseline" = above baseline).
  // Returns null if baseline isn't ready.
  sigmaDelta(cpp) {
    if (!this._locked) return null;
    if (typeof cpp !== "number" || !isFinite(cpp)) return null;
    if (this.hasTarget()) {
      // Use the target's σ if available, else fall back to the
      // baseline's σ — σ-distance still has meaning as "how many
      // baseline-typical fluctuations does this differ from target."
      const denom = this._targetSigma && this._targetSigma > 0
        ? this._targetSigma
        : this._sigma;
      if (!denom || denom === 0) return 0;
      return (cpp - this._targetMu) / denom;
    }
    if (this._sigma === 0) return 0;
    return (cpp - this._mu) / this._sigma;
  }

  // σ-distance from the BASELINE specifically. Useful in target-mode
  // UI to show "where you are vs your starting voice" alongside the
  // primary "where you are vs your target" readout. Returns null
  // when baseline isn't ready.
  sigmaDeltaFromBaseline(cpp) {
    if (!this._locked) return null;
    if (typeof cpp !== "number" || !isFinite(cpp)) return null;
    if (this._sigma === 0) return 0;
    return (cpp - this._mu) / this._sigma;
  }

  // Progress toward baseline-ready, in [0, 1]. UI uses this to
  // render a "calibrating: X %" indicator. Computed from sample
  // count (= cumulative voiced-content-time / aggregateIntervalMs).
  // Returns 1 once locked.
  progress() {
    if (this._locked) return 1;
    return Math.max(0, Math.min(1, this._samples.length / this._sampleTarget));
  }

  // Sample target — exposed so callers can show "N / target" progress.
  sampleTarget() {
    return this._sampleTarget;
  }

  // Current sample count (only meaningful during accumulation).
  sampleCount() {
    return this._samples.length;
  }

  // Force-clear (Reset baseline UI affordance, mic restart). Clears
  // accumulation state, μ/σ, and target. Caller is responsible for
  // also clearing persistence — this object doesn't touch IndexedDB.
  reset() {
    this._samples.length = 0;
    this._mu = null;
    this._sigma = null;
    this._locked = false;
    this._targetMu = null;
    this._targetSigma = null;
    this._source = null;
  }

  // Diagnostic snapshot for tests and the diag overlay.
  state() {
    return {
      locked: this._locked,
      source: this._source,
      mu: this._mu,
      sigma: this._sigma,
      targetMu: this._targetMu,
      targetSigma: this._targetSigma,
      hasTarget: this.hasTarget(),
      polarity: this.polarity(),
      sampleCount: this._samples.length,
      sampleTarget: this._sampleTarget,
      progress: this.progress(),
    };
  }
}
