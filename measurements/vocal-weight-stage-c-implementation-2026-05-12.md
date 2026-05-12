# Vocal Weight Stage C — implementation summary, 2026-05-12

Final implementation of the vocal-weight gauge replacement project,
combining the algorithmic sample-rate fix (C-investigate-2 prototype
merge) and the calibration UX changes (persisted baseline + optional
target voice).

## What this PR ships

1. **CPP is now sample-rate-invariant.** `computeCPP` resamples input
   to a canonical 16 kHz rate before the cepstrum pipeline runs.
   Same audio at any sample rate produces the same CPP within 0.01–
   0.03 dB (vs 0.1–0.3 dB spread before).
2. **Baseline persists across sessions.** μ/σ are saved to IndexedDB
   on first calibration. Subsequent sessions load the saved baseline
   immediately — no 30 s recalibration delay every time the user
   opens the app.
3. **Optional target voice.** Users can capture their goal voice
   (~30 s) after baseline. With target attached, the gauge spans
   baseline → target with polarity derived from
   `sign(targetμ − baselineμ)`, so users training lighter and users
   training heavier both see "progress" as leftward → rightward fill.
4. **Re-baseline + re-target affordances.** Confirm-then-act buttons
   for users whose baseline wasn't representative or whose goal
   shifts.

## Files changed

### Algorithm (C1–C3)
- [src/dsp/cpp.js](../src/dsp/cpp.js) — added internal `resampleToCanonical`
  (Blackman-windowed sinc FIR + linear-interp), removed
  sample-rate-adaptive logic. `CPP_INPUT_LEN` semantics shifted from
  "native cap" to "canonical 16 kHz cap" (1024 samples, was 2048).
- [tests/dsp/cpp-test.js](../tests/dsp/cpp-test.js) — added
  `NATIVE_BUFFER_LEN` for sizing 48 kHz synthetic stimuli.
- [tests/dsp/cpp-cost-microbench.js](../tests/dsp/cpp-cost-microbench.js)
  — same sizing fix.
- [tests/audio/vocal-weight-pipeline-trace.js](../tests/audio/vocal-weight-pipeline-trace.js)
  — logging shows native→canonical mapping.
- [tests/dsp/cpp-sample-rate-sensitivity.js](../tests/dsp/cpp-sample-rate-sensitivity.js)
  — verdict criterion now is real-audio spread (synthetic spread
  documents stimulus-construction variance, not algorithm sensitivity).
- DELETED: `src/dsp/cpp-resampled-prototype.js`,
  `tests/dsp/cpp-resampled-prototype-test.js`,
  `tests/dsp/cpp-resampled-prototype-validation.js` (prototype merged
  into production).

### Persistence (C4)
- [src/db.js](../src/db.js) — bumped to v2, added
  `vocalWeightCalibration` store (single row, id="default").
- [src/audio/vocal-weight-persistence.js](../src/audio/vocal-weight-persistence.js)
  — new module, wraps Dexie operations: `loadCalibration`,
  `saveBaseline`, `saveTarget`, `clearBaseline`, `clearTarget`,
  `touchLastUsed`.

### Baseline + target data layer (C5–C7)
- [src/audio/vocal-weight-baseline.js](../src/audio/vocal-weight-baseline.js)
  — added `loadFromPersisted`, `setTarget`, `clearTarget`,
  `hasTarget`, `polarity`, `targetMu`, `targetSigma`,
  `sigmaDeltaFromBaseline`, `source`. Gauge math now switches to
  baseline→target span when target is attached.
- [src/audio/useAudioPipeline.js](../src/audio/useAudioPipeline.js)
  — on start: load persisted calibration, pre-seed baseline. On
  baseline lock: persist (gated by `baselineSavedRef`). Added
  separate `cppTargetCaptureRef` for in-progress target accumulation.
  New callbacks: `startTargetCapture`, `cancelTargetCapture`,
  `clearVocalWeightTarget`. `resetVocalWeightBaseline` now also
  clears persistence.

### UI (C8)
- [src/components/VocalWeightGauge.jsx](../src/components/VocalWeightGauge.jsx)
  — new modes:
    - No target: labels "Lighter / Heavier" (preserved), σ-distance
      from baseline, target band highlight on lighter end.
    - With target: labels "Starting voice / Target voice", progress
      fill from baseline (left) to target (right), σ-distance from
      target with secondary "Δ from start" subscript.
    - Target capture: amber progress overlay with cancel.
    - Subtitle: "Your gauge tracks acoustic similarity to your
      target. Use it alongside your ear, not instead of it." with
      target; softer single-baseline framing without.
    - Controls row: re-baseline / set-or-re-record-target /
      remove-target. All destructive actions confirm-then-act.
- [src/components/CombinedDashboard.jsx](../src/components/CombinedDashboard.jsx)
  — thread new callbacks.
- [src/App.jsx](../src/App.jsx) — thread new callbacks.

### Tests (C10)
- [tests/audio/vocal-weight-baseline-test.js](../tests/audio/vocal-weight-baseline-test.js)
  — added 56 new tests covering `loadFromPersisted` (incl. invalid
  inputs), `source()`, `setTarget`/`clearTarget`/`hasTarget`/
  `polarity`, gauge math with target attached (both polarities),
  degenerate cases (target==baseline, σ=0), `sigmaDeltaFromBaseline`,
  reset semantics, and `state()` shape. Total: 98 passing, 0 failing.

## Verification

| Layer | Test | Result |
|---|---|---|
| Layer 1 directional invariants | `cpp-test.js` | 28/28 pass — clean > noise, modal > breathy, F0-independence within ±9 dB |
| Layer 2 Hillenbrand distribution | `cpp-corpus-test.js` | 6/6 sanity assertions pass. Men median 1.74 dB, Women 2.14 dB, IQRs comparable |
| Layer 4 Praat correlation (production) | `praat-syrinx-correlate.py` | r matches prototype: Hill 0.351, PTDB 0.635, Voca 0.273, FDA 0.711, overall 0.815 (all Δ < 0.001) |
| Sample-rate invariance (real audio) | `cpp-sample-rate-sensitivity.js` | PTDB spread 0.009 dB, FDA spread 0.025 dB, both << 0.05 dB threshold |
| Per-frame cost | `cpp-cost-microbench.js` | Production-default median 0.439 ms, p99 0.785 ms (well under 5 ms desktop / 1 ms reassessment threshold) |
| Baseline + target unit tests | `vocal-weight-baseline-test.js` | 98/98 pass |
| Pipeline trace (5 sample rates) | `vocal-weight-pipeline-trace.js` | 5/5 rates produce 34 successful CPP/sim each |
| Build | `npm run build` | Clean. dsp-worker 10.49 kB, index bundle 364.84 kB (+5.7 kB for persistence + UI changes) |

## Design decisions (made autonomously where the spec allowed)

- **Button labels**: "re-baseline", "set target voice" / "re-record target", "remove target". Lowercase, terse, matching the existing "reset baseline" affordance style.
- **Confirm-then-act**: both re-baseline and remove-target use the inline "yes / no" pattern, not a modal. Matches the existing pattern from PR #69.
- **Gauge polarity orientation**: with target attached, the visual fill ALWAYS goes baseline→target (left to right), independent of CPP polarity. Reasoning: users training lighter and users training heavier should both see the same "moving toward target" visual semantic. The internal CPP-polarity sign is captured in math (`polarity()`) but not surfaced as a visual flip — that'd be confusing for users who don't know "lighter = high CPP" off the top of their head.
- **σ-distance anchor in target mode**: primary readout is from target ("+0.4σ from target"); secondary subscript shows distance from baseline ("Δ +2.0σ from start"). The primary readout answers "how close to my goal am I right now"; the secondary answers "how much have I moved overall."
- **GAUGE_MARGIN = 0.25**: extends the visible axis 25 % beyond baseline and target so users see "you're past your target" or "you're below your baseline" as legible offsets, not just an immediate clamp.
- **Target capture progress UI**: separate amber-bordered card BELOW the main gauge while capturing, so users can still see their current position during capture. Felt better than hijacking the entire gauge area.
- **Subtitle wording**: matches spec verbatim with-target ("Your gauge tracks acoustic similarity to your target. Use it alongside your ear, not instead of it."). Without target: "Your gauge tracks how your current voice compares to your usual."
- **Persistence row schema**: flat field layout (`baselineMu`, `baselineSigma`, etc.) rather than nested objects. Matches the existing `settings` table convention in db.js.
- **Schema migration**: v1 → v2 just ADDS the `vocalWeightCalibration` table; no migration of existing data. Existing v1 users will see the calibration UI on their first session after upgrading (their old calibration was per-session anyway, so this is a strict upgrade).
- **Resamper anti-alias cache**: keyed by `fromRate`. Most users have a stable session sample rate, so the FIR coefficients are computed once on first call.

## What this PR does NOT fix (acknowledged)

- **CPP-to-perceived-weight mapping is a correlate, not a direct measurement.** Aaen 2025 and the literature review support CPP as a meaningful proxy for vocal weight; the absolute mapping ("X dB CPP = Y points of heaviness") is not established. The gauge surfaces *change relative to a user-specific baseline*, not a population-normed score. The "use it alongside your ear, not instead of it" subtitle is load-bearing — this is acoustic feedback, not perceptual scoring.
- **Mic / room / environment differences between devices**: a user who calibrates on a USB condenser and then trains on a laptop array mic will see a baseline that doesn't reflect their current device acoustics. Workaround: re-baseline button. The "diagnostic only" `baselineSampleRate` field exists in the schema so a future "calibration is stale, suggest re-baseline" prompt could be added when device characteristics change — not implemented in this PR.
- **The within-corpus Praat correlations (Hill 0.35, Voca 0.27)** are lower than ideal. Per the methodology investigation, those two corpora have characteristics (very short Hillenbrand clips, singing in Vocadito) that don't map cleanly onto Praat's running-speech CPPS regime. The running-speech corpora (PTDB-TUG 0.64, FDA 0.71) are the most production-relevant comparisons and are stronger. Validation framing in the per-corpus breakdown above.
- **Within-corpus vs overall correlation**: overall r=0.82 is misleading vs the within-corpus values because of corpus-mean differences (Simpson's paradox). The within-corpus values are the production-relevant signal.

## Investigation arc preserved for future sessions

This implementation went through five research cycles, each
surfacing a real issue. Preserved here so future iterations don't
re-derive the same conclusions:

1. **Cycle 1**: Audit found the previous alpha-ratio metric was
   uncalibrated and unsmoothed. Replaced with Hillenbrand-style CPP
   + per-user baseline + 1-s aggregator + UI. Surfaced in
   [vocal-weight-cpps-audit-2026-05-09.md](vocal-weight-cpps-audit-2026-05-09.md).

2. **Cycle 2**: Calibration timing investigation found the original
   lock used wall-clock-spread instead of voiced-content count,
   inflating calibration time on speech with natural pauses. Fixed
   to count-based at 120 samples.

3. **Cycle 3**: Full Maryn CPPS implementation (Theil regression +
   exponential trend + time smoothing + quefrency smoothing)
   regressed Praat correlation. Component isolation showed time
   smoothing is the culprit (Praat 2 ms time-step vs Syrinx 25 ms
   hop methodology mismatch). Reverted to linear+linear+no-time-
   smoothing+3-bin-quefrency-smoothing.

4. **Cycle 4**: Scale display investigation surfaced sample-rate
   sensitivity as a measurement-integrity blocker. Same audio at
   different sample rates produced 0.1–0.3 dB CPP spread. Surfaced
   in [cpp-scale-display-stage-ab-2026-05-11.md](cpp-scale-display-stage-ab-2026-05-11.md).

5. **Cycle 5 (this PR)**: Algorithmic invariance fix (resample to
   canonical 16 kHz with anti-alias FIR) collapsed spread to
   < 0.03 dB. Combined with persisted baseline + optional target
   for the calibration UX overhaul. Investigation in
   [cpp-sample-rate-invariance-investigation-2026-05-12.md](cpp-sample-rate-invariance-investigation-2026-05-12.md).

The cumulative investigation depth was unusual but defensible —
vocal weight is partially first-in-class for trans voice training
tools, and the calibration foundation matters more than fast
iteration. Future improvements have durable infrastructure to build
on: the Praat comparison harness, sample-rate sensitivity test,
corpus distribution analysis, per-corpus correlation breakdown,
and the post-merge unit-test coverage.

## Honest research gaps

These were surfaced in the supplemental research (see
[vocal-weight-calibration-research-2026-05-11.md](vocal-weight-calibration-research-2026-05-11.md) §8) and remain unresolved:

- **No public ground-truth for "perceived vocal weight" labels** on a CPP corpus. Praat CPPS is used as a reference here, but Praat itself is an acoustic measurement, not a perceptual rating. A future investigation would need recorded voices + clinician perceptual ratings to establish the CPP-to-perceived-weight mapping empirically.
- **TruVox precedent** (the closest community-known calibration pattern) uses a baseline-and-target approach similar to this PR's, but the academic validation for that pattern specifically is thin. The McAllister 2025 / Weese 2025 evidence supports the GENERAL approach (baseline-relative real-time biofeedback) without specifically validating the baseline-plus-target gauge geometry.
- **Cross-device baseline portability** isn't fully solved. The sample-rate invariance fix addresses one device-difference axis. Mic-and-room differences are not addressed by the algorithm; the re-baseline button is the workaround.
