// vocal-weight-baseline.js — Per-user CPPS adaptive σ window.
//
// CPP values vary by speaker, microphone, room, and algorithm
// configuration. There is no public reference for "consumer-mic
// running-speech CPP" that would let Syrinx ship a fixed gauge
// range — see measurements/vocal-weight-cpps-audit-2026-05-09.md
// §5 / measurements/vocal-weight-literature-2026-05-09.md §4.4
// for the calibration-honesty rationale.
//
// Adaptive σ window — zero user interaction:
//
//   - Ring buffer holds the last N voiced CPP-aggregate emits
//     (N = baselineVoicedMs / aggregateIntervalMs = 120 by default
//     = ~30 s of voiced content at the production 250 ms emit
//     cadence).
//   - Until the buffer fills, the gauge is "Calibrating: X %" and
//     no μ/σ is exposed — ready() is false.
//   - Once full, μ and σ are FROZEN for the rest of the session
//     (changed 2026-06-10 from a continuously-sliding window). The
//     gauge then reads the user's current voice against a fixed
//     reference, so sustained changes stay visible.
//   - No persistence between sessions, no buttons, no target voice.
//     Each session calibrates from scratch.
//
// Why freeze (2026-06-10 accuracy pass): the sliding window
// mean-reverted — a sustained lighter passage pulled μ up to meet it,
// so the gauge drifted back toward center as if the change hadn't
// happened. Measured on the 2026-05-26 session: over a 24 s sustained-
// lighter run the sliding gauge moved 0.38→0.20 (toward heavier!),
// while the frozen gauge held 0.74→0.64 (correctly lighter). Freezing
// also fixes sensitivity drift — a continuously-recomputed σ deadened
// the gauge whenever recent speech was varied. Gauge-vs-CPP fidelity
// (fraction of needle motion explained by the current voice rather
// than baseline drift) rose 0.795→0.956. Trade-off: the first 30 s
// must be reasonably representative — an unusual warm-up (throat-clear,
// deliberately heavy start) miscalibrates the whole session with no
// recovery until restart. The "Calibrating…" UI implicitly asks for
// normal speech; accepted as the zero-interaction cost.
// measurements/vocal-weight-accuracy-pass-2026-06-10.md.
//
// Why this design (course correction 2026-05-12 from the earlier
// Stage C hybrid self+target with persistence): the hybrid approach
// had interaction cost (set-target button, re-baseline button,
// confirm-then-act flows) that wasn't worth the goal-tracking
// benefit. Adaptive sliding window gives zero-interaction
// calibration that always reflects "recent voice." Empirical probe
// against 198 s of PTDB-TUG running speech showed σ stays
// 0.26-0.56 dB throughout — no σ→0 hypersensitivity, no need for a
// MIN_SIGMA floor. Probe data in measurements/cpp-adaptive-window-
// probe-2026-05-12.json.
//
// **Voiced-content-time, NOT wall-clock-time.** Each aggregator
// emit represents ~250 ms of new voiced content. Counting samples
// gives cumulative voiced-content-time. A user with long pauses
// reaches the full window after the same number of voiced emits as
// a continuously-speaking user — the buffer doesn't age out during
// silence (the aggregator just stops producing emits, which the
// baseline never sees).

// Each aggregator sample represents this much voiced content (the
// aggregator's emit interval). Used to convert sample count → voiced
// content time. Constructor accepts override for tests + future
// tuning.
export const BASELINE_AGGREGATE_INTERVAL_MS = 250;
export const BASELINE_VOICED_MS = 30000;   // 30 s of cumulative voiced content
// Gauge spans ±BASELINE_SIGMA·σ from μ. Widened 2→3 on 2026-06-10
// alongside the μ/σ freeze (below): a frozen σ measured over the calm
// first 30 s underestimates full-session CPP spread, so a ±2σ span
// clamped 17.7 % of later frames on the 2026-05-26 session. ±3σ brings
// clamp to 7.1 % (≈ the old sliding-window's 5.5 %) while still using
// 81 % of the gauge range. measurements/vocal-weight-accuracy-pass-
// 2026-06-10.md.
export const BASELINE_SIGMA = 3;
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
    // Window size in samples = baselineVoicedMs / aggregateIntervalMs,
    // floored at minSamples so σ has enough data points to be
    // meaningful when callers configure a very short window for
    // tests.
    this._windowSize = Math.max(
      minSamples,
      Math.ceil(baselineVoicedMs / aggregateIntervalMs),
    );

    // Ring buffer of recent CPP values. Pre-allocated; _writeIdx
    // wraps modulo _windowSize.
    this._buffer = new Float64Array(this._windowSize);
    this._writeIdx = 0;
    // Count of pushed-so-far samples (saturates at _windowSize once
    // the buffer wraps for the first time). Drives progress() and
    // ready() during the warm-up phase.
    this._count = 0;

    // Current μ/σ — null while warming up, recomputed on every push
    // once the buffer is full.
    this._mu = null;
    this._sigma = null;
  }

  // Push a CPP-aggregate sample. Shape: { time, cpp }. cpp must be a
  // finite number. Caller is responsible for filtering: only voiced
  // aggregates should be accumulated.
  accumulate(sample) {
    // Frozen after the baseline window first fills (see header). Once
    // μ/σ are set, further samples are ignored — the reference holds
    // for the rest of the session. reset() clears the freeze.
    if (this._mu !== null) return;
    const { cpp } = sample;
    if (typeof cpp !== "number" || !isFinite(cpp)) return;
    this._buffer[this._writeIdx] = cpp;
    this._writeIdx = (this._writeIdx + 1) % this._windowSize;
    if (this._count < this._windowSize) {
      this._count++;
      if (this._count < this._windowSize) {
        // Still calibrating; don't expose μ/σ yet.
        return;
      }
    }
    // Buffer just filled — compute μ/σ once from the full window and
    // freeze them. O(N), one time per session. N = 120 by default.
    let sum = 0;
    for (let i = 0; i < this._windowSize; i++) sum += this._buffer[i];
    const mu = sum / this._windowSize;
    let sumSqDev = 0;
    for (let i = 0; i < this._windowSize; i++) {
      const d = this._buffer[i] - mu;
      sumSqDev += d * d;
    }
    this._mu = mu;
    this._sigma = Math.sqrt(sumSqDev / Math.max(1, this._windowSize - 1));
  }

  // True once the buffer has filled (i.e., we have ~30 s of voiced
  // content). After this, every push updates μ/σ; the API doesn't
  // distinguish "first time full" from "still full" — the gauge is
  // ready as long as the user keeps producing voiced material.
  ready() {
    return this._count >= this._windowSize;
  }

  // Current adaptive mean. Null while warming up.
  mu() {
    return this.ready() ? this._mu : null;
  }

  // Current adaptive stdev. Null while warming up.
  sigma() {
    return this.ready() ? this._sigma : null;
  }

  // Map a CPP-aggregate value to a gauge position in [0, 1].
  // 0 = μ - gaugeSigma·σ; 1 = μ + gaugeSigma·σ. Values outside
  // ±gaugeSigma σ are clamped. Returns null if not ready or if cpp
  // isn't a valid number.
  //
  // Direction: per Aaen 2025 + literature review, higher CPP =
  // lighter voice. The gauge UI maps position 1.0 to the "Lighter"
  // end and position 0.0 to the "Heavier" end.
  gaugePosition(cpp) {
    if (!this.ready()) return null;
    if (typeof cpp !== "number" || !isFinite(cpp)) return null;
    if (this._sigma === 0) {
      // Pathological: all window samples identical. Map to gauge
      // center; without σ we can't give a meaningful position.
      return 0.5;
    }
    const sigmaDelta = (cpp - this._mu) / this._sigma;
    const norm = (sigmaDelta + this.gaugeSigma) / (2 * this.gaugeSigma);
    return Math.max(0, Math.min(1, norm));
  }

  // σ-distance from the adaptive mean. Used by UI for the numeric
  // readout below the gauge ("+1.2 σ", "-0.4 σ"). Returns null if
  // not ready.
  sigmaDelta(cpp) {
    if (!this.ready()) return null;
    if (typeof cpp !== "number" || !isFinite(cpp)) return null;
    if (this._sigma === 0) return 0;
    return (cpp - this._mu) / this._sigma;
  }

  // Progress toward ready, in [0, 1]. UI uses this to render the
  // "Calibrating: X %" indicator. Returns 1 once the buffer fills.
  progress() {
    if (this.ready()) return 1;
    return Math.max(0, Math.min(1, this._count / this._windowSize));
  }

  // Force-clear (mic restart). Called by useAudioPipeline on
  // stop()/start() so each session calibrates from scratch.
  reset() {
    this._writeIdx = 0;
    this._count = 0;
    this._mu = null;
    this._sigma = null;
    // Buffer contents don't need clearing — write pointer + count
    // determine which entries are valid. (Re-allocating would be
    // wasteful at the GC-free hot path.)
  }

  // Diagnostic snapshot for tests and the diag overlay. The
  // `locked` field is preserved for backward compatibility with
  // diag consumers; it now means "buffer is full and exposing μ/σ"
  // rather than "baseline parameters have frozen."
  state() {
    return {
      locked: this.ready(),
      mu: this._mu,
      sigma: this._sigma,
      sampleCount: this._count,
      sampleTarget: this._windowSize,
      progress: this.progress(),
    };
  }
}
