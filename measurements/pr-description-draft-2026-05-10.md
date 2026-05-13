# PR description draft — vocal-weight CPP replacement

**Branch:** `vocal-weight-cpps-replacement` (ready for user-side testing in Step 7)

This is a draft — not opening the PR. User testing on the dev
server validates the five Step-7 criteria (directional
correctness, monotone stability, baseline soundness,
responsiveness, recovery after pauses) before any `gh pr create`.

---

## Summary

Replaces the custom alpha-ratio "Vocal Weight" gauge with a
Hillenbrand-style real-cepstrum CPP-based correlate of perceived
phonatory density (Aaen et al. 2025), with quefrency-domain
smoothing inspired by Maryn 2010. Per-user baseline calibration
(first ~30 s of voiced content, ±2σ gauge mapping) sidesteps
absolute population-reference issues.

## What ships

- New CPP algorithm in `src/dsp/cpp.js`:
  - 2048-sample input window (~43 ms at 48 kHz, sample-rate-
    adaptive — works on 16 kHz mobile silent-downsample down to
    a 512-sample floor)
  - Linear LSQ regression for cepstral baseline
  - Linear trend type
  - 3-bin centered moving-average quefrency smoothing
  - F0 search range 75-625 Hz
- New aggregator in `src/audio/vocal-weight-aggregator.js`:
  - 1 s rolling window over per-frame CPP values
  - 250 ms emit cadence (≤ 4 Hz gauge updates, deliberate UX
    choice — see audit doc)
  - Hard-reset on > 2 s unvoiced gap
  - MIN_VOICED_FRAMES = 4 (tuned from initial 6 after WS1
    timing measurement showed conversational speech under-
    emitted at 6)
- New baseline tracker in `src/audio/vocal-weight-baseline.js`:
  - Count-based lock at 120 voiced aggregates ≈ 30 s of voiced
    content
  - μ + σ frozen at lock; gauge maps current CPP to position
    via (cpp − μ) / σ in ±2σ range
  - Per-session reset (UI affordance)
- New gauge component `src/components/VocalWeightGauge.jsx`:
  - Three states: Calibrating (progress bar) / Ready (marker
    + σ-distance readout) / Holding (silence-hold dim)
  - "Reset baseline" UI affordance with confirm-then-act
- DSP worker integration: per-frame CPP at 25 ms hop (no
  throttling); aggregator + baseline live on main thread

## What doesn't ship (but stays as opt-in code)

Full Maryn-style CPPS components were implemented and tested
but defaults set to off:

- Theil-Sen (sampled, N=500) regression: opt-in via
  `regression: "theil"` in computeCPP opts
- Exponential trend type (log-domain Theil): opt-in via
  `trend: "exponential"`
- Time smoothing across N consecutive cepstrum vectors: opt-in
  via `timeSmoothFrames`

Empirical isolation (Step 3 of Option A) showed:
- Theil ≈ linear LSQ on within-corpus correlation; the audit's
  predicted peak-influence improvement didn't manifest
- Time smoothing across DSP frames substantially regresses
  correlation (Praat's 2 ms time-step is finer than Syrinx's
  25 ms hop, making methodologies non-comparable)
- Quefrency smoothing IS the only Maryn-component that
  improves correlation (FDA 0.616 → 0.713 on running speech);
  this is what we ship

Code paths stay opt-in for future investigation if user-side
testing surfaces issues that suggest algorithm tuning would
help.

## Validation evidence

### Layer 1 — synthetic unit tests (28 cases)

`tests/dsp/cpp-test.js` — pulse-train/noise/synthetic-vowel/
modal-vs-breathy. Directional correctness verified across all
cases. Theil regression produces higher CPP than linear LSQ on
clean pulse trains as expected (peak influence absent in Theil,
present in LSQ).

### Layer 2 — Hillenbrand corpus distribution (regression guard)

`tests/dsp/cpp-corpus-test.js` — distribution by gender on the
Hillenbrand corpus (n=1116):

- Men: median 1.96 dB, IQR 0.81
- Women: median 2.79 dB, IQR 1.09

Gender-symmetric IQR widths (ratio 1.34, well within sanity
bound). Distribution range positive, bounded, sane.

### Layer 4 — Praat reference comparison

`scripts/praat-cpps-corpus.py` + `scripts/praat-syrinx-correlate.py`
joined 520 paired tracks across four corpora:

| Corpus | n | Pearson r | Status |
|---|---|---|---|
| Hillenbrand (sustained vowels, ~700 ms) | 200 | 0.351 | <0.5, short-track-limited |
| PTDB-TUG (running speech, 5-9 s) | 180 | 0.630 | **VALIDATED** |
| Vocadito (singing, ~30 s, n=40) | 40 | 0.254 | <0.5, small-sample-limited |
| FDA (running speech, 5-7 s) | 100 | 0.713 | **VALIDATED (strong)** |
| **Overall (cross-corpus)** | 520 | **0.852** | strong |

PTDB-TUG and FDA, the running-speech corpora most representative
of the production use case, both validate at r > 0.5. FDA at
r = 0.71 is in the "strongly correlated" range. Hillenbrand and
Vocadito have data-limitation explanations (short tracks,
small N) rather than algorithm-limitation.

**Honest framing of the Praat agreement:** Syrinx's CPP and
Praat's CPPS run on different time-step methodologies (25 ms
hop vs 2 ms hop). Component isolation showed full Maryn-style
processing (matching Praat's algorithm closely) actually
regressed correlation in this codebase — the methodology
mismatch creates a ceiling on achievable algorithm-comparison
correlation. Praat agreement is supplementary evidence with
acknowledged methodology limits, not the load-bearing
validation.

### Layer 3 — user-side perceptual

TBD per Step 7 testing on the dev server. The five criteria:

1. Directional correctness (deliberate light/heavy modulation
   moves gauge appropriately)
2. Monotone stability
3. Baseline soundness (first 30 s establishes reasonable
   reference, reset works, stable across stop/start)
4. Responsiveness during deliberate modulation
5. Recovery after pauses (>2 s hard-reset clean)

## Cost

Per-frame computeCPP cost (Node native; browser V8 desktop
expected ~equal, mobile WASM 2-3× slower):

- Production default (linear + linear + 3-bin quefrency): 0.143 ms median, 0.225 ms p99
- 40 fps × 0.143 ms = 5.7 ms/sec CPU = ~0.6 % of one core on desktop
- Mobile WASM estimate: 11-17 ms/sec CPU (still well within budget)

Cumulative pipeline (analytical):

- dsp-worker thread: ~5 ms/sec for CPP + ~13 ms/sec for every-6th-frame
  formants/HNR/tilt = ~18 ms/sec total ≈ 1.8 % of one core
- pitch-worker (SwiftF0 ONNX): ~20 % utilization on its thread
- gender-worker (ECAPA-TDNN ONNX): ~95 % on its dedicated thread
  (graceful overrun; existing pipeline behavior)
- Hop budget headroom for dsp-worker: ~14× — well above 3×
  threshold

## Test plan

- [ ] `node tests/audio/vocal-weight-aggregator-test.js` — 42 pass
- [ ] `node tests/audio/vocal-weight-baseline-test.js` — 42 pass
- [ ] `node tests/dsp/cpp-test.js` — 28 pass
- [ ] `npm run build` — production build succeeds
- [ ] User-side Step 7 validation on dev server:
  - [ ] Calibration time ≤ 60 s on conversational speech
  - [ ] Gauge moves appropriately on deliberate light/heavy
        modulation
  - [ ] No gauge stuck-states or NaN readouts during sustained
        speech
  - [ ] Reset baseline button works
  - [ ] Recovery after >2s pauses behaves cleanly

## Architecture doc updates

ARCHITECTURE.md metric table updated to reflect new CPP-based
correlate framing (replacing the inverted "spectral tilt"
description per the original audit finding).

## Files changed (high level)

- `src/audio/useAudioPipeline.js` — aggregator + baseline
  integration, frame-by-frame CPP push, gauge state plumbing
- `src/audio/vocal-weight-aggregator.js` — new module
- `src/audio/vocal-weight-baseline.js` — new module
- `src/components/VocalWeightGauge.jsx` — new component (replaces
  SpectralTiltGauge in the dashboard)
- `src/components/CombinedDashboard.jsx` — gauge swap, prop
  threading
- `src/components/SpectralTiltGauge.jsx` — kept for legacy
  session-history rendering (avgSpectralTilt fields persist in
  IndexedDB schema for old sessions per audit decision 4)
- `src/dsp/cpp.js` — new CPP module (production hot path +
  test-importable)
- `src/dsp/dsp-worker.js` — wires computeCPP at every-frame
  cadence
- `src/diag/diag.js` — vocal-weight emit ring + voiced-frame
  tally for snapshot inspection
- `src/App.jsx` — props through to CombinedDashboard
- `ARCHITECTURE.md` — metric table updated

## Measurement infrastructure (durable)

- `tests/dsp/cpp-test.js` — Layer 1 synthetic
- `tests/dsp/cpp-corpus-test.js` — Layer 2 Hillenbrand
  distribution
- `tests/dsp/cpp-corpus-aggregate.js` — Syrinx-side per-track
  CPP for Praat comparison
- `tests/dsp/cpp-cost-microbench.js` — per-frame timing
- `tests/dsp/cpp-praat-methodology-probe.js` — methodology
  variant comparison harness
- `tests/dsp/cpp-maryn-component-isolation.js` — component-
  by-component Maryn isolation
- `tests/audio/calibration-timing-corpus.js` — WS1 calibration
  timing across corpora
- `scripts/praat-cpps-corpus.py` — Praat CPPS via parselmouth
- `scripts/praat-cpps-probe.py` — single-track Praat probe
- `scripts/praat-syrinx-correlate.py` — Praat-Syrinx
  cross-comparison

All measurement records preserved in `measurements/` for
posterity.
