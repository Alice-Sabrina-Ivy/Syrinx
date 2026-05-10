// vocal-weight-aggregator.js — Time-windowed CPP aggregation buffer.
//
// CPP arrives per-DSP-frame at ~6.7 Hz (every 150 ms). The displayed
// vocal-weight gauge needs ≥1 s of voiced-frame aggregation to wash
// out vowel-modulated variance — see
// measurements/vocal-weight-cpps-audit-2026-05-09.md §3.
//
// This module owns the buffer state, voicing gate logic, and emit
// cadence. It is deliberately decoupled from the audio pipeline so
// it can be unit-tested without booting workers — the same pattern
// gender-worker uses with audio-utils.js.
//
// Hybrid time-window + hard-reset behavior (audit §3.3):
//   - 1 s rolling window of per-frame entries, voiced-only frames
//     contribute to the aggregate mean.
//   - Aggregate emits every 250 ms (75 % overlap with previous emit).
//   - Hard reset when the most recent unvoiced gap exceeds 2 s — the
//     buffer drops, the next aggregate is null, and the consumer
//     should display "warming up" until a fresh ≥1 s of voiced
//     speech accumulates.
//
// The voicing flag passed in is whatever the caller has already
// debounced (in production, useAudioPipeline.js's
// dspGateRef.current.voiced). This module does NOT re-implement the
// SwiftF0 confidence threshold or the silence debouncer — single
// source of truth for "is this frame voiced" stays in the pipeline.

export const AGGREGATE_WINDOW_MS = 1000;
export const EMIT_INTERVAL_MS = 250;
export const HARD_RESET_UNVOICED_MS = 2000;
// MIN_VOICED_FRAMES is the minimum count of voiced+valid-CPP frames
// in the 1-s window required for the aggregator to emit. Original
// audit value was 6 (~900 ms of voiced phonation per aggregate);
// WS1 corpus measurement (2026-05-10) showed conversational speech
// at 60-80 % voiced fraction under-emitted at 6, pushing combined
// median calibration to 64.78 s (vs audit's 30 s spec). Reduced to
// 4 (~600 ms voiced per aggregate, ~67 % voiced content) which
// brings median calibration to 39.4 s on the same corpus.
// See measurements/calibration-timing-corpus-2026-05-10.json for
// the pre/post-tune distributions.
export const MIN_VOICED_FRAMES = 4;

export class VocalWeightAggregator {
  constructor({
    windowMs = AGGREGATE_WINDOW_MS,
    emitIntervalMs = EMIT_INTERVAL_MS,
    hardResetUnvoicedMs = HARD_RESET_UNVOICED_MS,
    minVoicedFrames = MIN_VOICED_FRAMES,
  } = {}) {
    this.windowMs = windowMs;
    this.emitIntervalMs = emitIntervalMs;
    this.hardResetUnvoicedMs = hardResetUnvoicedMs;
    this.minVoicedFrames = minVoicedFrames;

    // Frame ring: { time, cpp, voiced }. Plain array; entries are
    // dropped from the head when older than windowMs. Per-frame cost
    // is small (~7 entries at 1 s × 6.7 Hz cadence) so a plain array
    // is fine — no GC concern.
    this._frames = [];

    // Time of last emit (used to throttle to emitIntervalMs cadence).
    this._lastEmitMs = -Infinity;

    // Time of the most recent voiced frame seen. Used for the hard-
    // reset rule; null until the first voiced frame.
    this._lastVoicedMs = null;

    // Latest emitted aggregate; cached so consumers can re-read on
    // re-render without waiting for the next emit.
    this._latest = null;
  }

  // Push a per-frame measurement. Returns the latest aggregate value
  // (possibly stale, possibly fresh). Callers should compare the
  // returned object's `time` against their previously-known value
  // to detect new emits.
  //
  // Frame shape: { time: ms (any monotonic clock), cpp: number|null,
  //                voiced: boolean }.
  // - cpp may be null when the worker couldn't compute a value
  //   (e.g., spectrum was flat or the frame failed quietly). Null
  //   CPP is excluded from the mean regardless of voicing flag.
  // - voiced is the debounced voicing verdict; the caller is
  //   responsible for the gate threshold.
  push(frame) {
    const { time, cpp, voiced } = frame;

    // Hard reset on long unvoiced gap. We check this BEFORE pushing
    // the new frame: if the new frame is voiced but ≥ hardResetUnvoicedMs
    // has passed since the last voiced frame, the buffer's old voiced
    // entries reflect a different speech context and shouldn't carry
    // forward. Drop everything; the new frame becomes the seed.
    if (
      voiced &&
      this._lastVoicedMs !== null &&
      time - this._lastVoicedMs >= this.hardResetUnvoicedMs
    ) {
      this._frames.length = 0;
      this._latest = null;
      // _lastEmitMs intentionally NOT reset: emit cadence is wall-
      // clock-driven, not utterance-driven.
    }

    // Append the new frame.
    this._frames.push({ time, cpp, voiced });

    // Track most recent voiced frame for the hard-reset rule.
    if (voiced) this._lastVoicedMs = time;

    // Trim the head: drop entries older than windowMs from the latest
    // frame's timestamp. Walking from the front is O(n) per push; n
    // is ~7 in steady state, fine.
    const cutoff = time - this.windowMs;
    let dropIdx = 0;
    while (dropIdx < this._frames.length && this._frames[dropIdx].time < cutoff) {
      dropIdx++;
    }
    if (dropIdx > 0) this._frames.splice(0, dropIdx);

    // Emit-cadence throttle: only compute a fresh aggregate every
    // emitIntervalMs of wall-clock time. Between emits, the cached
    // _latest is returned unchanged.
    if (time - this._lastEmitMs < this.emitIntervalMs) {
      return this._latest;
    }

    // Compute aggregate from voiced frames with valid (non-null) CPP.
    let sum = 0;
    let count = 0;
    for (let i = 0; i < this._frames.length; i++) {
      const f = this._frames[i];
      if (f.voiced && typeof f.cpp === "number") {
        sum += f.cpp;
        count++;
      }
    }

    if (count < this.minVoicedFrames) {
      // Not enough voiced material to anchor an aggregate. Don't
      // update _latest; previous value (or null) persists. Don't
      // advance _lastEmitMs either — the next push that crosses the
      // cadence boundary should re-attempt rather than wait an extra
      // 250 ms.
      return this._latest;
    }

    this._latest = {
      time,
      cpp: sum / count,
      voicedFrames: count,
    };
    this._lastEmitMs = time;
    return this._latest;
  }

  // Force-clear (e.g., session start, mic restart).
  reset() {
    this._frames.length = 0;
    this._lastEmitMs = -Infinity;
    this._lastVoicedMs = null;
    this._latest = null;
  }

  // Diagnostic accessor; returns a snapshot of internal state. Used
  // by tests and the diag overlay. Never used in the hot path.
  state() {
    return {
      frameCount: this._frames.length,
      voicedFrameCount: this._frames.reduce(
        (n, f) => n + (f.voiced && typeof f.cpp === "number" ? 1 : 0),
        0,
      ),
      lastVoicedMs: this._lastVoicedMs,
      lastEmitMs: Number.isFinite(this._lastEmitMs) ? this._lastEmitMs : null,
      latest: this._latest,
    };
  }
}
