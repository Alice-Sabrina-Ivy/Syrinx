# Maryn CPPS implementation choices — design surface

**Date:** 2026-05-10
**Scope:** Step 1 of Option A (full Maryn CPPS path).
**Reviewers:** Surface for user review before measurement (Step 2).

## What "full Maryn CPPS" means in this implementation

Praat's `PowerCepstrogram → Get CPPS` is the de-facto Maryn-style
reference (Maryn & Weenink 2015, *J. Voice*). The four components
the user listed correspond to specific Praat parameters:

| Component | Praat default | Syrinx pre-Option-A | Syrinx post-Option-A |
|---|---|---|---|
| Regression fit method | Robust slow (full Theil) | Linear LSQ | Sampled Theil (≈ Praat "Robust") |
| Trend type | Exponential decay | Linear | Exponential decay |
| Time-averaging window | (~1 ms in clinical literature) | none | Cepstrum-domain rolling mean (3-frame) |
| Quefrency-averaging window | (~50 µs in clinical literature) | none | 3-bin moving average on cepstrum |

The four implementation choices below are the deviations from
Praat-default that this PR makes; each has a documented reason.

## 1. Theil regression — sampled, not full

**Choice:** Sampled Theil with N=500 random pairs, deterministic
seeded RNG for reproducibility. This corresponds to Praat's
"Robust" option (incomplete Theil), not Praat's default "Robust
slow" (full Theil).

**Reason:** Full Theil over the cepstrum search range (≈ 565 bins
at 48 kHz) is O(n²) = 159,330 slope computations per frame. At
40 fps that's 6.4M slopes/sec — empirically ~30 ms per frame,
exceeding the 25 ms hop budget by itself even before the rest of
the pipeline. Sampled Theil with N=500 reduces this to
~500 slopes/frame ≈ 0.05 ms — negligible.

Statistical accuracy: the Theil-Sen estimator's variance scales
as O(σ²/N). N=500 gives ~22× lower precision than full N=159,330
(sqrt(159,330/500)) but in practice the cepstrum baseline is
piecewise-smooth with one strong outlier (the peak), and 500
random pairs reliably reject that single outlier. Praat's
"Robust" docs state "faster, less precise" — same trade.

**Deviation magnitude:** moderate. The slope estimate from N=500
will differ from full Theil by a few percent on noisy data;
should not meaningfully shift CPP values at the dB level the
gauge displays.

## 2. Time smoothing — 3-frame cepstrum-domain rolling mean

**Choice:** Maintain a rolling buffer of the most recent 3
cepstrum vectors (each 2048 floats). On each new computeCPP call,
average the buffer's vectors elementwise to produce a smoothed
cepstrum, then apply quefrency smoothing + peak detection +
trend fit on the smoothed result.

**Reason:** Praat's PowerCepstrogram time-step is 2 ms (default),
producing many cepstrum frames per "analysis frame" — Praat's
internal 1 ms time-averaging window is a smoother applied to
those fine-grained cepstra. Syrinx computes one cepstrum per
DSP frame at 25 ms hop (post-divisor-1 fix); the natural Syrinx
analog is to average across consecutive DSP frames' cepstra.

3-frame window = 75 ms of audio context (50 ms window per frame
+ 50 ms overlap from prior frames). Larger windows over-smooth;
single frame = no smoothing.

**Deviation magnitude:** moderate. Praat smooths within a
finer-grained time-step; Syrinx smooths at the DSP-frame
granularity. Both reduce per-frame cepstrum noise. Effective
result similar; absolute values may differ.

**State management:** module-level rolling buffer in cpp.js.
Reset on `resetCppState()` for tests / new sessions.

## 3. Quefrency smoothing — 3-bin moving average

**Choice:** Apply a 3-bin centered moving average to the cepstrum
within the search range [qMin, qMax]. Convolve with kernel
`[1/3, 1/3, 1/3]`. Keep raw values at boundaries (no edge
mirroring needed for the search range since qMin/qMax don't
include the cepstrum edges).

**Reason:** Praat's quefrency-averaging window of ~50 µs at
48 kHz = 2.4 samples ≈ 3 bins. 3-bin centered MA matches that
spatial scale.

**Deviation magnitude:** small. 3-bin smoothing is a standard
implementation of a tight Praat-style quefrency smoother.

## 4. Exponential trend — log-domain Theil

**Choice:** Implement exponential decay trend by:
1. Subtract the cepstrum minimum within search range from each
   bin to get strictly positive values.
2. Add small epsilon (1e-6) to avoid log(0).
3. Compute log of each shifted cepstrum bin.
4. Apply sampled Theil regression in log domain → slope `b`,
   intercept `a`.
5. Baseline at peak quefrency: `min + (exp(a + b * peakIdx) - eps)`.

**Reason:** Praat's "Exponential decay" trend fits
`A * exp(-B * k) + C` (three-parameter nonlinear). Full nonlinear
fit requires iterative optimization — too expensive for the hot
path. Linear fit in log-domain is the standard reduction:
- exp(a + b*k) ≈ A * exp(B*k) where A = exp(a), B = b
- Negative b → decay; positive b → growth
- The +C offset is approximated by the cepstrum-minimum subtraction

This drops one degree of freedom (the asymptote), but for the
voice-speech cepstrum baseline shape (decaying with quefrency),
the approximation is close.

**Deviation magnitude:** moderate. Full Praat exponential is
better fit; log-Theil is a reasonable approximation.
Quantitative impact on CPP values surfaced in measurement.

## API / state changes summary

```diff
- export function computeCPP(buffer, sr)
+ export function computeCPP(buffer, sr, opts = {})
+ export function resetCppState()
```

`opts` shape (all optional, defaults match Maryn):
- `regression`: `"theil" | "linear"` (default `"theil"`)
- `trend`: `"exponential" | "linear"` (default `"exponential"`)
- `timeSmoothFrames`: integer ≥ 1 (default 3)
- `quefrencySmoothBins`: integer ≥ 1 (default 3)

Existing tests pin `regression: "linear"`, `trend: "linear"`,
`timeSmoothFrames: 1`, `quefrencySmoothBins: 1` to preserve
expected absolute values. New tests verify Maryn defaults
produce different (but bounded) values.

Module-level state added:
- `_cepstrumBuffer`: rolling buffer of last N cepstra (Float64Array
  arrays)

`resetCppState()` clears the buffer. dsp-worker.js calls it on
`init` / `port` messages so a worker re-init starts fresh.

## Cost estimate (pre-measurement)

| Component | Pre-Option-A | Post-Option-A | Delta |
|---|---|---|---|
| FFT + log-magnitude + IFFT | ~1.5 ms | ~1.5 ms | unchanged |
| Quefrency search + linear regression | ~0.2 ms | n/a (replaced) | — |
| Sampled Theil (N=500) on log domain | n/a | ~0.05 ms | +0.05 ms |
| Exponential evaluation at peak | n/a | <0.01 ms | +0.01 ms |
| Time smoothing (3-frame avg) | n/a | ~0.5 ms | +0.5 ms |
| Quefrency smoothing (3-bin MA) | n/a | ~0.05 ms | +0.05 ms |
| **Per-frame total** | **~1.7 ms** | **~2.1 ms** | **+0.4 ms** |

At 40 fps: 1.7 → 2.1 ms/frame = 68 → 84 ms/sec CPU. Both within
budget; cumulative pipeline measurement will validate.

## Reset / state lifecycle

`resetCppState()` is called:
- On dsp-worker `init` message (mirrors existing buffer
  re-allocation for sample rate change)
- Implicitly when a new aggregator is created in
  useAudioPipeline.js (start() flow)

The cepstrum buffer holds 3 vectors of 2048 Float64 each ≈ 48 KB.
Negligible memory.

## What this implementation does NOT do (deferred)

- **Full Theil (Praat "Robust slow"):** runtime-prohibitive. If
  measurement shows sampled Theil produces materially different
  CPP values from Praat reference, we'd need an O(n log n) Theil
  algorithm — separate scope.
- **Praat's exact 2-ms time-step PowerCepstrogram:** Syrinx
  produces one cepstrum per 25 ms DSP frame; matching Praat's
  finer time-step would require running the cepstrum FFT at a
  finer hop, ~6× the cost. The 3-frame DSP-rate smoothing is the
  pragmatic equivalent.
- **Pre-emphasis high-pass cutoff calibration:** Syrinx uses
  α=0.97 (matches typical 50 Hz Praat default approximately).
  Not changed.
- **Adaptive trend parameters:** Praat allows specifying
  `qstart` and `qend` for the trend fit. Syrinx uses the full
  search range (qMin to qMax) — same as before, deferring
  parameter expansion.

## Validation plan

After implementation:
1. All existing tests continue to pass with `regression: "linear",
   trend: "linear"` opts (pinned for compatibility).
2. New tests verify:
   - Theil-robust produces a slope (not null) for the same
     synthetic inputs that linear LSQ does.
   - Time-smoothed CPP is more stable across consecutive frames
     than unsmoothed.
   - Quefrency-smoothed cepstrum has lower per-bin variance.
   - Exponential trend produces a higher baseline at low quefrency
     (closer to peak) and lower baseline at high quefrency vs
     linear.
3. Methodology probe re-run with Maryn defaults — if Hillenbrand
   correlation crosses 0.5, Option A delivers the predicted
   improvement.
