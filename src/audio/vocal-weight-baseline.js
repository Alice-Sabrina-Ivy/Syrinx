// vocal-weight-baseline.js — Per-user CPPS baseline tracker.
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
//   - During the first BASELINE_VOICED_MS of voiced speech in the
//     session, accumulate CPP-aggregate samples.
//   - Once the baseline window has filled, compute mean μ and
//     stdev σ. These freeze for the remainder of the session.
//   - Subsequent CPP-aggregate values are mapped to gauge position
//     by their distance from μ in σ-units. ±BASELINE_SIGMA σ maps
//     to the full gauge.
//
// "Voiced speech" here = voiced AGGREGATE samples emitted by
// VocalWeightAggregator (the aggregator already filters for ≥6
// voiced frames in a 1 s window). Baseline elapsed-voiced-time is
// computed from sample timestamps, not wall clock — a session that
// starts with a long quiet period accumulates baseline only once
// speech begins.
//
// Baseline freezes after BASELINE_VOICED_MS of voiced material so
// it doesn't drift across the session as the user trains: a user
// who modulates from heavier to lighter voice over several minutes
// won't see the baseline track upward and erase the gauge signal.
// The "Reset baseline" affordance (UI in Step 4) lets users
// re-anchor mid-session if their first 30 s wasn't representative.

export const BASELINE_VOICED_MS = 30000;   // 30 s of voiced speech
export const BASELINE_SIGMA = 2;           // gauge spans ±2σ from μ
export const BASELINE_MIN_SAMPLES = 8;     // floor for σ to be meaningful

export class VocalWeightBaseline {
  constructor({
    baselineVoicedMs = BASELINE_VOICED_MS,
    gaugeSigma = BASELINE_SIGMA,
    minSamples = BASELINE_MIN_SAMPLES,
  } = {}) {
    this.baselineVoicedMs = baselineVoicedMs;
    this.gaugeSigma = gaugeSigma;
    this.minSamples = minSamples;

    // Sample list during accumulation. Cleared after baseline locks
    // — once μ and σ are computed we don't need the samples
    // themselves.
    this._samples = [];
    this._earliestTime = null;
    this._latestTime = null;

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
    if (this._earliestTime === null || time < this._earliestTime) this._earliestTime = time;
    if (this._latestTime === null || time > this._latestTime) this._latestTime = time;

    // Lock baseline once enough voiced time has accumulated AND
    // we have at least minSamples. Both gates matter:
    // - voiced-time gate ensures we observe enough of the user's
    //   speech to characterize their typical voice.
    // - sample-count gate prevents σ from being computed on a tiny
    //   sample (e.g., 2-3 quick utterances over 30 s wall-clock).
    const voicedElapsed = this._latestTime - this._earliestTime;
    if (
      voicedElapsed >= this.baselineVoicedMs &&
      this._samples.length >= this.minSamples
    ) {
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
  // render a "calibrating: X / 30 s" indicator during the first
  // 30 seconds of voiced speech. Returns 1 once locked.
  progress() {
    if (this._locked) return 1;
    if (this._earliestTime === null || this._latestTime === null) return 0;
    const voicedElapsed = this._latestTime - this._earliestTime;
    return Math.max(0, Math.min(1, voicedElapsed / this.baselineVoicedMs));
  }

  // Force-clear (Reset baseline UI affordance, mic restart).
  reset() {
    this._samples.length = 0;
    this._earliestTime = null;
    this._latestTime = null;
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
      earliestTime: this._earliestTime,
      latestTime: this._latestTime,
      progress: this.progress(),
    };
  }
}
