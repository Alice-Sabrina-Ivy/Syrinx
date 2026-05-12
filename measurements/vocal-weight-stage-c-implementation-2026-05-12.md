# Vocal Weight Stage C — implementation summary, 2026-05-12

Final implementation of the vocal-weight gauge replacement project.
Two coupled changes:

1. **Sample-rate-invariant CPP** (the C-investigate-2 prototype
   merged into production cpp.js).
2. **Adaptive σ window for zero-interaction calibration** (Pattern A
   sliding ring buffer of last ~30 s of voiced emits).

This document captures the final state. The journey to get here
included a hybrid self+target with persistence approach that was
implemented and then reverted on the same day — see "Investigation
arc" below.

## Behavior in one sentence

The gauge shows the user's current voice's CPP position relative
to the σ of their recent ~30 s of voice, calibrated automatically.
No baselines, no targets, no persistence, no interaction.

## Files in the final state

### Algorithm
- [src/dsp/cpp.js](../src/dsp/cpp.js) — `computeCPP` resamples
  input to canonical 16 kHz (Blackman-windowed sinc FIR +
  linear-interp) before the cepstrum pipeline. Quefrency bounds
  computed from the canonical rate, not the input rate.
  `CPP_INPUT_LEN` = 1024 (canonical-rate cap).

### Calibration data layer
- [src/audio/vocal-weight-baseline.js](../src/audio/vocal-weight-baseline.js)
  — adaptive σ window. Ring buffer of size
  `Math.ceil(BASELINE_VOICED_MS / AGGREGATE_INTERVAL_MS) = 120`.
  `accumulate()` writes into the buffer; once full, every push
  recomputes μ/σ from the entire window via O(N) loop. `ready()`
  returns true once the buffer fills. External API unchanged from
  pre-iteration: `mu()`, `sigma()`, `gaugePosition()`,
  `sigmaDelta()`, `progress()`, `reset()`, `state()`.
- [src/audio/vocal-weight-aggregator.js](../src/audio/vocal-weight-aggregator.js)
  — unchanged. 1 s window, 250 ms emit cadence,
  MIN_VOICED_FRAMES=4, hard-reset > 2 s unvoiced.
- [src/audio/useAudioPipeline.js](../src/audio/useAudioPipeline.js)
  — `cppBaselineRef` constructed fresh on each start; `accumulate`
  fed each voiced aggregate emit. No persistence, no target
  capture, no callbacks beyond start/stop.

### UI
- [src/components/VocalWeightGauge.jsx](../src/components/VocalWeightGauge.jsx)
  — Lighter ← → Heavier labels (fixed), σ-distance readout, target
  band highlight on the lighter side, "Calibrating: N%" progress
  during accumulation. No buttons. No subtitle. No interaction.
- [src/components/CombinedDashboard.jsx](../src/components/CombinedDashboard.jsx),
  [src/App.jsx](../src/App.jsx) — minimal gauge prop threading
  (`vocalWeight`, `voiced`, `holding`).

### Persistence
- [src/db.js](../src/db.js) — v2 schema migration drops the
  short-lived `vocalWeightCalibration` table that was added then
  removed during the same-day course correction. Dexie monotonic
  version requires a v2 entry; using `null` for the table value
  cleanly removes it for dev users who tested the persistence
  branch. v1 users skip past unaffected.

### Tests
- [tests/audio/vocal-weight-baseline-test.js](../tests/audio/vocal-weight-baseline-test.js)
  — 56/56 pass. Coverage: pre-fill state, lock at sample target,
  sample-count-not-wall-clock semantics, gauge math (μ, ±2σ
  endpoints, beyond clamps), reset, sliding-window μ tracking,
  σ tracking, FIFO ageout, aggregator-hard-reset interaction,
  degenerate σ=0, invalid-input filtering, custom configuration.
- [tests/audio/vocal-weight-aggregator-test.js](../tests/audio/vocal-weight-aggregator-test.js)
  — unchanged, all green.
- [tests/dsp/cpp-test.js](../tests/dsp/cpp-test.js) — 28 directional
  invariants, all green. `NATIVE_BUFFER_LEN` sizes 48 kHz
  synthetic stimuli to produce CPP_INPUT_LEN canonical samples
  after resampling.
- [tests/dsp/cpp-corpus-test.js](../tests/dsp/cpp-corpus-test.js)
  — Layer 2 Hillenbrand distribution, 6/6 sanity assertions.
- [tests/dsp/cpp-sample-rate-sensitivity.js](../tests/dsp/cpp-sample-rate-sensitivity.js)
  — verdict criterion is real-audio spread < 0.05 dB threshold;
  synthetic spread documents stimulus-construction variance, not
  algorithm sensitivity. Production passes (PTDB 0.009, FDA 0.025).
- [tests/dsp/cpp-cost-microbench.js](../tests/dsp/cpp-cost-microbench.js)
  — production-default median 0.439 ms, p99 0.785 ms.
- [tests/dsp/cpp-adaptive-window-probe.js](../tests/dsp/cpp-adaptive-window-probe.js)
  — Pattern A vs Pattern B empirical probe on 198 s of PTDB-TUG
  running speech. Settled the calibration approach choice. Stays
  in the codebase as durable infrastructure for future calibration
  experiments.

### Deleted
- `src/dsp/cpp-resampled-prototype.js` — merged into production.
- `tests/dsp/cpp-resampled-prototype-test.js` — superseded by
  `cpp-sample-rate-sensitivity.js`.
- `tests/dsp/cpp-resampled-prototype-validation.js` — superseded by
  the production test suite.
- `src/audio/vocal-weight-persistence.js` — removed in the
  same-day revert.

## Verification matrix (final)

| Layer | Test | Result |
|---|---|---|
| Layer 1 directional | `cpp-test.js` | 28/28 pass |
| Layer 2 Hillenbrand distribution | `cpp-corpus-test.js` | 6/6 pass |
| Layer 4 Praat correlation | Within-corpus r matches prototype (Hill 0.35, PTDB 0.64, Voca 0.27, FDA 0.71, overall 0.82) | within ±0.001 |
| Sample-rate invariance | `cpp-sample-rate-sensitivity.js` | PTDB 0.009 dB / FDA 0.025 dB real-audio spread |
| Per-frame cost | `cpp-cost-microbench.js` | 0.439 ms median, 0.785 ms p99 |
| Baseline sliding-window | `vocal-weight-baseline-test.js` | 56/56 pass |
| Aggregator regression | `vocal-weight-aggregator-test.js` | All green |
| Pipeline trace (5 sample rates) | `vocal-weight-pipeline-trace.js` | 5/5 rates identical throughput |
| Calibration timing | `vocal-weight-baseline-timing-trace.js` | Continuous 30 s, conversational 38 s, heavy-fricative 48 s (voiced-content-time, expected) |
| Adaptive window probe | `cpp-adaptive-window-probe.js` | σ 0.26-0.56 dB across 198 s, 0% σ-collapse |
| Build | `npm run build` | Clean. dsp-worker 10.5 kB |
| Lint | `npm run lint` (scoped to changed files) | No errors in changed files |

## Investigation arc

This implementation went through six iterations before landing.
Preserved here so future sessions don't re-derive these
conclusions:

1. **Cycle 1 (2026-05-09)**: Audit found the previous alpha-ratio
   metric was uncalibrated and unsmoothed. Replaced with
   Hillenbrand-style CPP + per-user baseline + 1-s aggregator.

2. **Cycle 2 (2026-05-10)**: Calibration timing showed the
   original lock used wall-clock-spread instead of voiced-content
   count. Fixed to count-based at 120 samples.

3. **Cycle 3 (2026-05-10)**: Full Maryn CPPS implementation
   regressed Praat correlation. Component isolation showed time
   smoothing was the culprit (Praat 2 ms time-step vs Syrinx 25 ms
   hop methodology mismatch). Reverted to linear+linear+no-time-
   smoothing+3-bin-quefrency-smoothing.

4. **Cycle 4 (2026-05-11)**: Scale display investigation surfaced
   sample-rate sensitivity as a measurement-integrity blocker.
   Same audio at different sample rates produced 0.1–0.3 dB CPP
   spread.

5. **Cycle 5a (2026-05-12 AM)**: Algorithmic invariance fix
   (canonical-rate resampling). Combined with persisted baseline +
   optional target capture for what was thought to be the
   calibration UX overhaul. Implemented end-to-end with tests,
   build, lint clean — see git history commit `3024f61`
   ("feat(vocal-weight): sample-rate invariant CPP + persisted
   baseline + optional target (Stage C)") and the same-day revert
   `24efd48`.

6. **Cycle 5b (2026-05-12 PM)**: Course correction. Hybrid
   self+target introduced interaction cost that wasn't worth the
   goal-tracking benefit. Reverted on the same day. Empirical probe
   compared Pattern A (continuous sliding window) vs Pattern B
   (lock + recompute on shift); Pattern A confirmed by both data
   and stated intent. Implementation simplified to ~half the code
   of cycle 5a.

## Key methodology lessons (transferable to future work)

- **Field-benchmark first when algorithm-class is at fault.** Same
  lesson from the SwiftF0 pitch cutover. The sample-rate
  sensitivity took longer to surface than it should have because
  initial tuning iterations stayed within the algorithm rather
  than probing for stimulus-equivalence issues.

- **Within-corpus correlation > overall correlation** for
  algorithmic comparison across heterogeneous data. Overall r is
  inflated by corpus-mean differences (Simpson's paradox).

- **Implementation cost is part of the comparison.** Hybrid
  self+target with persistence WORKED — measurement-validated,
  tested, built, lint-clean. The cost wasn't algorithmic; it was
  UX surface area. The same-day revert was cheap because the work
  was bounded to one branch and one PR scope. The cleaner final
  product wasn't visible from inside the implementation work —
  it required stepping back to evaluate "is this the right
  product surface."

- **Empirical probe before committing to a calibration pattern.**
  Pattern A vs Pattern B took ~10 minutes to write + run as a
  probe; it ruled out the σ-collapse risk and showed Pattern B's
  shift trigger doesn't fire on normal speech. Probe lives in
  `cpp-adaptive-window-probe.js` for future calibration
  experiments.

## What this PR doesn't fix (acknowledged)

- **CPP-to-perceived-weight mapping is a correlate, not a direct
  measurement.** Aaen 2025 and the literature review support CPP
  as a meaningful proxy for vocal weight; the absolute mapping
  isn't established. The gauge surfaces *change relative to a
  user-specific adaptive window*, not a population-normed score.

- **Mic / room / environment differences between devices**. The
  sample-rate fix addresses one device-difference axis. Mic and
  room acoustics aren't compensated, but session-local
  calibration partially absorbs this — each session re-calibrates
  for its own acoustic context.

- **No explicit goal-tracking UX**. By design (zero interaction).
  Cycle 5a explored this and found the interaction cost wasn't
  worth the benefit. Future work could revisit goal-setting via
  different UX (e.g., session-end summary, progress-over-time
  sparkline) — those would be additions alongside the gauge, not
  replacements, and they wouldn't change the core gauge behavior.

- **Within-corpus Praat correlations on Hillenbrand (r=0.35) and
  Vocadito (r=0.27)** are lower than running-speech corpora
  (PTDB-TUG r=0.64, FDA r=0.71). Corpus characteristics (short
  Hillenbrand clips, singing in Vocadito) don't map cleanly onto
  Praat's running-speech CPPS regime. The running-speech corpora
  are the production-relevant comparisons.

## Honest research gaps

- **No public ground-truth for "perceived vocal weight" labels**
  on a CPP corpus. Praat CPPS serves as a reference; Praat itself
  is an acoustic measurement, not a perceptual rating. A future
  investigation would need recorded voices + clinician
  perceptual ratings to establish the CPP-to-perceived-weight
  mapping empirically.

- **Adaptive σ window's "current voice" framing is unvalidated
  with users.** It's the simpler approach with sound algorithmic
  properties, but whether it gives the user a useful signal
  during practice is an open question. The 4.9 % gauge-clamp
  rate measured on speaker F01 (PTDB-TUG) over 198 s reads as
  "informative edge-pegging when voice diverges from recent
  baseline" rather than "gauge is broken" — but user testing
  may reveal it pegs too often or too rarely. The single-
  parameter fallback (widening the window to 60 s or 90 s) is
  available without architectural changes.
