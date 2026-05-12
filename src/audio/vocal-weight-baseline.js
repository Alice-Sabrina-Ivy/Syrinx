// vocal-weight-baseline.js — Per-user CPPS baseline tracker.
//
// CPP values vary by speaker, microphone, room, and algorithm
// configuration. There is no public reference for "consumer-mic
// running-speech CPP" that would let Syrinx ship a fixed gauge
// range — see measurements/vocal-weight-cpps-audit-2026-05-09.md
// §5 / measurements/vocal-weight-literature-2026-05-09.md §4.4
// for the calibration-honesty rationale.
//
// Per-user baseline approach (session-local, zero user interaction):
//
//   - During the first BASELINE_VOICED_MS of CUMULATIVE voiced
//     content in the session, accumulate CPP-aggregate samples.
//   - Once the target voiced-content-time has filled, compute mean
//     μ and stdev σ. The gauge becomes functional.
//   - Calibration is session-local — no persistence between sessions.
//     A new session re-calibrates from scratch. This is intentional
//     (mic / room / time-of-day may differ; the cost of a 30-s
//     re-calibration is small vs the complexity + UX of cross-session
//     persistence).
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
//
// Future work (planned for R3 of the 2026-05-12 simplification):
// adaptive σ window after initial calibration so the gauge tracks
// recent voice rather than locking forever. Current implementation
// is the pre-adaptive lock-at-30s behavior.

// Each aggregator sample represents this much voiced content (the
// aggregator's emit interval). Used to convert sample count → voiced
// content time. Constructor accepts override for tests + future
// tuning.
export const BASELINE_AGGREGATE_INTERVAL_MS = 250;
export const BASELINE_VOICED_MS = 30000;   // 30 s of cumulative voiced content
export const BASELINE_SIGMA = 2;           // gauge spans ±2σ from μ
export const BASELINE_MIN_SAMPLES = 8;     // floor for σ to be meaningful

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
  }

  // Push a CPP-aggregate sample. Shape: { time, cpp }. Both must be
  // numbers. Caller is responsible for filtering: only voiced
  // aggregates should be accumulated.
  accumulate(sample) {
    if (this._locked) return;
    const { time, cpp } = sample;
    if (typeof cpp !== "number" || !isFinite(cpp)) return;
    this._samples.push({ time, cpp });

    // Lock baseline once we've accumulated enough voiced-content-
    // time. Each sample represents aggregateIntervalMs of new
    // voiced material (per the aggregator's 75%-overlap emit
    // cadence). _sampleTarget = baselineVoicedMs / aggregateIntervalMs,
    // floored at minSamples to ensure σ has enough data points to
    // be meaningful.
    if (this._samples.length >= this._sampleTarget) {
      this._lockBaseline();
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
    // Free the sample buffer; downstream callers only need μ/σ.
    this._samples.length = 0;
  }

  // True when baseline parameters are locked and ready for use.
  ready() {
    return this._locked;
  }

  // Locked baseline mean. Null while accumulating.
  mu() {
    return this._locked ? this._mu : null;
  }

  // Locked baseline stdev. Null while accumulating.
  sigma() {
    return this._locked ? this._sigma : null;
  }

  // Map a CPP-aggregate value to a gauge position in [0, 1].
  // 0 = μ - gaugeSigma·σ; 1 = μ + gaugeSigma·σ. Values outside
  // ±gaugeSigma σ are clamped. Returns null if baseline isn't
  // ready or if cpp isn't a valid number.
  //
  // Direction: per Aaen 2025 + literature review, higher CPP =
  // lighter voice. The gauge UI maps position 1.0 to the "Lighter"
  // end and position 0.0 to the "Heavier" end.
  gaugePosition(cpp) {
    if (!this._locked) return null;
    if (typeof cpp !== "number" || !isFinite(cpp)) return null;
    if (this._sigma === 0) {
      // Pathological: all baseline samples were identical. Map to
      // gauge center; without σ we can't give meaningful position.
      return 0.5;
    }
    const sigmaDelta = (cpp - this._mu) / this._sigma;
    const norm = (sigmaDelta + this.gaugeSigma) / (2 * this.gaugeSigma);
    return Math.max(0, Math.min(1, norm));
  }

  // σ-distance from baseline mean. Used by UI for the numeric
  // readout below the gauge ("+1.2 σ", "−0.4 σ"). Returns null if
  // baseline isn't ready.
  sigmaDelta(cpp) {
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

  // Force-clear (mic restart). Resets accumulation state and μ/σ.
  // Called by useAudioPipeline.stop()/start() to ensure each session
  // calibrates from scratch.
  reset() {
    this._samples.length = 0;
    this._mu = null;
    this._sigma = null;
    this._locked = false;
  }

  // Diagnostic snapshot for tests and the diag overlay.
  state() {
    return {
      locked: this._locked,
      mu: this._mu,
      sigma: this._sigma,
      sampleCount: this._samples.length,
      sampleTarget: this._sampleTarget,
      progress: this.progress(),
    };
  }
}
