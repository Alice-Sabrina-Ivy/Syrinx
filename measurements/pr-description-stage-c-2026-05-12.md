# PR description draft — Stage C

(Pending explicit "open the PR" approval per CLAUDE.md.)

---

## Title

`feat: vocal weight gauge — sample-rate-invariant CPP + persisted baseline + optional target`

## Summary

Final Stage C of the vocal-weight gauge replacement. Combines:

- **Algorithmic fix**: CPP is now sample-rate-invariant. Same audio
  at any sample rate produces the same CPP within 0.01–0.03 dB (vs
  0.1–0.3 dB spread before). Achieved by resampling input to a
  canonical 16 kHz rate (Blackman-windowed sinc FIR anti-aliasing +
  linear interpolation) before the cepstrum pipeline runs.
- **Persisted per-user baseline**: μ/σ are saved to IndexedDB on
  first calibration and reloaded on subsequent sessions. Users
  calibrate once per device, not once per session.
- **Optional target voice**: users can capture their goal voice
  (~30 s, same accumulation rule as baseline). With target attached,
  the gauge spans baseline → target with polarity derived from
  `sign(targetμ − baselineμ)`. Users training in either direction
  see "progress" as left-to-right fill.

## What this fixes

- Same-audio different-sample-rate now produces the same CPP
  (real-audio spread 0.009–0.025 dB, well under the 0.05 dB
  invariance threshold). Previously, mobile silent-downsample to
  16 kHz versus desktop 48 kHz produced 0.1–0.3 dB systematic
  differences in baseline μ, large enough to bias the gauge.
- Baseline no longer requires 30 s of re-calibration every session.
  Persists in IndexedDB; loads in <1 ms on session start.
- Gauge can now represent goal-directed practice — users training
  lighter vs heavier vs no specific direction all get the same
  semantic ("am I closer to my target?").

## What this does NOT fix (honest acknowledgement)

- **CPP is a correlate, not a direct measurement of perceived
  vocal weight.** Aaen 2025 + literature review support the
  proxy; the absolute mapping isn't established. Gauge surfaces
  *change relative to a user-specific baseline*, not a population-
  normed score. Subtitle: "Use it alongside your ear, not instead
  of it."
- **Mic / room / environment differences between devices.** The
  sample-rate fix addresses one device-difference axis; mic and
  room acoustics aren't compensated. Workaround: re-baseline button.
- **Within-corpus Praat correlations on Hillenbrand (r=0.35) and
  Vocadito (r=0.27) are lower than the running-speech corpora**
  (PTDB-TUG 0.64, FDA 0.71). Per methodology investigation, that's
  due to corpus-specific characteristics (very short Hillenbrand
  clips, singing in Vocadito) mapping less cleanly onto Praat's
  running-speech CPPS regime. The running-speech corpora are the
  production-relevant comparisons.

## Test plan

- [ ] First-time-ever session: app prompts calibration, captures
      30 s of speech, gauge becomes functional, baseline persists.
- [ ] Second session (any time later): baseline loads from
      IndexedDB, gauge is functional from the first voiced frame.
- [ ] Re-baseline button: confirm-then-act, captures new baseline,
      persists, replaces old.
- [ ] Set target voice: 30 s capture flow runs, gauge switches to
      baseline → target span on completion, target persists.
- [ ] Re-record target: replaces previous target without affecting
      baseline.
- [ ] Remove target: gauge reverts to baseline ± 2σ display, target
      cleared from persistence.
- [ ] Polarity correctness — both directions:
      - Train lighter (target μ > baseline μ): position increases
        toward target as user lightens voice.
      - Train heavier (target μ < baseline μ): position increases
        toward target as user gets heavier.
- [ ] σ-distance readout shows distance from target with secondary
      "Δ from start" when target attached; from baseline when no
      target.
- [ ] Gauge subtitle shows "...alongside your ear..." with target,
      softer single-baseline framing without.
- [ ] Sample rate change (e.g., USB device with different default
      rate) doesn't shift the gauge — algorithm is rate-invariant.
- [ ] Persistence durability: refresh / reopen browser, baseline
      and target survive.
- [ ] Layer 1 (Hillenbrand directional invariants): `node tests/dsp/cpp-test.js` → 28/28 pass.
- [ ] Layer 4 (Praat correlation): `python scripts/praat-syrinx-correlate.py` → within-corpus r matches prototype (Hill 0.35, PTDB 0.64, Voca 0.27, FDA 0.71, overall 0.82).
- [ ] Baseline + target unit tests: `node tests/audio/vocal-weight-baseline-test.js` → 98/98 pass.
- [ ] Per-frame cost: median < 1 ms (production default measures 0.44 ms).
- [ ] Build: `npm run build` → succeeds; dsp-worker bundle 10.5 kB.

## Methodology / investigation arc

This implementation went through five research cycles, each
surfacing a real issue. Investigation arc preserved for future
iterations in [measurements/vocal-weight-stage-c-implementation-2026-05-12.md](measurements/vocal-weight-stage-c-implementation-2026-05-12.md).

Key cumulative learnings:

- **Measurement before tuning**: every CPP/gauge change in this
  project has measurement data backing it. The Praat comparison
  harness, sample-rate sensitivity test, corpus distribution
  analysis, and per-corpus correlation breakdown are all durable
  infrastructure for future work.
- **Field-benchmark first when algorithm-class is at fault**: same
  lesson learned from the SwiftF0 pitch cutover. The sample-rate
  sensitivity took longer to surface than it should have because
  initial tuning iterations stayed within the algorithm rather
  than probing for stimulus-equivalence issues.
- **Within-corpus correlation > overall correlation** for
  algorithmic comparison across heterogeneous data. Overall r is
  inflated by corpus-mean differences (Simpson's paradox).

## Files changed

See [measurements/vocal-weight-stage-c-implementation-2026-05-12.md](measurements/vocal-weight-stage-c-implementation-2026-05-12.md) for the per-file breakdown and design rationale.
