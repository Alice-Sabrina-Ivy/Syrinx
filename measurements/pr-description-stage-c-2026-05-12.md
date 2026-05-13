# PR description — Stage C (adaptive σ window)

## Title

`feat(vocal-weight): CPP-based adaptive vocal weight gauge`

## Summary

Replaces the previous alpha-ratio vocal-weight metric with a
CPP-based adaptive σ window gauge. Two coupled changes:

- **Sample-rate-invariant CPP.** `computeCPP` resamples input to a
  canonical 16 kHz rate via a Blackman-windowed sinc FIR
  anti-aliaser + linear-interp downsampler before the cepstrum
  pipeline runs. Same audio at any sample rate produces CPP within
  0.01–0.03 dB across [16, 20, 22, 32, 44, 48] kHz (vs 0.1–0.3 dB
  spread before).

- **Adaptive σ window for zero-interaction calibration.** A sliding
  ring buffer (120 voiced CPP-aggregate emits ≈ 30 s of voiced
  content at the 250 ms emit cadence) feeds the gauge. Until the
  buffer fills, the UI shows "Calibrating: N %". After it fills, μ
  and σ are recomputed on each new emit — oldest emit drops out
  FIFO. The gauge always reflects the user's recent voice.

No buttons. No target capture. No cross-session persistence.

## What this fixes

- Same-audio different-sample-rate now produces the same CPP
  (real-audio spread 0.009 dB on PTDB-TUG / 0.025 dB on FDA across
  the 16–48 kHz range, well under the 0.05 dB invariance
  threshold). Previously, mobile silent-downsample to 16 kHz versus
  desktop 48 kHz produced systematic CPP differences that biased
  the gauge.

- Gauge no longer requires user-facing controls. First ~30 s of
  voiced speech = calibration. After that, the gauge tracks recent
  voice automatically.

- Each session calibrates from scratch — mic, room, time-of-day,
  and voice state may all differ between sessions, and the cost of
  a 30-s re-calibration is small.

## Behavior in one sentence

The gauge shows the user's current voice's CPP position relative
to the σ of their recent ~30 s of voice, calibrated automatically.

## What this does NOT fix (honest acknowledgement)

- **CPP is a correlate, not a direct measurement of perceived
  vocal weight.** Aaen et al. 2025 + the literature review support
  CPP as a meaningful proxy; the absolute mapping isn't
  established. The gauge surfaces *short-term position relative to
  the user's own recent voice*, not a population-normed score.
  Subtitle text reflects this: "Your gauge tracks how your current
  voice compares to your usual."

- **Mic / room / environment differences between devices.** The
  sample-rate fix addresses one device-difference axis; mic and
  room acoustics aren't compensated. Session-local calibration
  absorbs this partially — each session re-calibrates for its own
  acoustic context.

- **Praat correlation within-corpus is uneven across corpora.**
  Production-relevant comparisons (running speech) are
  PTDB-TUG r=0.635 and FDA r=0.711. Hillenbrand r=0.351 (very
  short sustained-vowel clips — ~700 ms each — limit aggregation
  statistics) and Vocadito r=0.273 (singing material in a regime
  Praat's CPPS wasn't tuned for, plus n=40 small sample). Both
  also reflect a methodology gap: Syrinx CPP runs at the
  production 25 ms hop cadence; Praat's CPPS uses a 2 ms time-step
  internally. Running-speech corpora are the production-relevant
  comparisons.

- **No goal-setting UX.** An earlier iteration on this branch
  (cycle 5a, 2026-05-12 morning) implemented hybrid self+target
  with persisted baselines and target-voice capture. Same-day
  course correction (cycle 5b) reverted that approach — the
  interaction cost (set-target button, re-baseline button,
  confirm-then-act flows, two display modes) wasn't worth the
  goal-tracking benefit. Settled on zero-interaction adaptive σ
  window. Future work could revisit goal tracking via different
  UX (e.g., session-end summary, progress-over-time sparkline) as
  additions alongside the gauge, not replacements.

## Related work (separate PR)

While preparing Step 7 user-side testing, an unrelated SwiftF0
pitch-detection vulnerability was surfaced and investigated:
SwiftF0 can lock on the 2× harmonic of a low-F0 voice when a
harmonic-rich tonal source (refrigerator, HVAC, mains harmonics)
is present in the recording environment. Two algorithmic fix
directions were investigated and ruled out empirically (preserved
on separate unmerged branches as scaffolding). The shipped
mitigation — documentation + user-side ambient-noise diagnostic
probe — lands in a separate "pitch-detection-followups" PR.

**This vocal-weight gauge is unaffected by that pitch
vulnerability.** CPP is computed independently of SwiftF0's pitch
interpretation, and the silence gate uses SwiftF0's *confidence*
(which stays high on voiced speech regardless of pitch
correctness). Users hitting the pitch issue can still use this
gauge; only the pitch trace and pitch-derived UI elements are
visibly affected.

## Test plan (for user-side testing on dev server)

- [ ] First time starting the app: "Calibrating: listening for
      voice…" appears immediately. After speaking for a few
      seconds, "Calibrating: N %" climbs as voiced material
      accumulates.
- [ ] Around 30 s of voiced speech: gauge becomes functional.
      Long pauses extend the calibration period in voiced-content
      time (correct — calibration is voiced-content-based, not
      wall-clock).
- [ ] Once calibrated, brief voice modulation lighter/heavier:
      marker moves toward the corresponding gauge end and the σ
      readout reflects direction.
- [ ] Sustained modulation: as the user maintains a new voice for
      more than ~30 s of voiced content, the sliding window fills
      with the new voice and the gauge re-centers. Marker drifts
      back toward middle. This is the intended adaptive behavior.
- [ ] Stop and restart audio: calibration starts over from
      scratch. No persisted state.
- [ ] Sample rate change (e.g., different USB device): gauge
      values don't shift discontinuously.

## Automated verification

| Test suite | Result |
|---|---|
| `cpp-test.js` Layer 1 directional invariants | 28/28 pass |
| `vocal-weight-baseline-test.js` (sliding-window coverage) | 56/56 pass |
| `vocal-weight-aggregator-test.js` | 42/42 pass |
| `cpp-corpus-test.js` Layer 2 Hillenbrand distribution | 6/6 sanity assertions |
| `cpp-sample-rate-sensitivity.js` | PTDB spread 0.009 dB, FDA spread 0.025 dB (invariance verdict) |
| `cpp-cost-microbench.js` | Production-default median 0.439 ms, p99 0.785 ms (5–10× under desktop budget) |
| `vocal-weight-pipeline-trace.js` (5 sample rates) | 5/5 identical CPP throughput |
| `vocal-weight-baseline-timing-trace.js` | Continuous speech locks at 30 s, conversational 38 s, heavy-fricative 48 s (voiced-content-stretching, expected) |
| `cpp-adaptive-window-probe.js` | σ 0.26–0.56 dB across 198 s, 0 % σ-collapse risk |
| Praat correlation (within-corpus r) | Hill 0.351 / PTDB 0.635 / Voca 0.273 / FDA 0.711 (Δ < 0.001 from prototype) |
| `npm run build` | Clean. dsp-worker bundle 10.5 kB |
| `npm run lint` | No errors in changed files |

## Files changed

### Algorithm
- [src/dsp/cpp.js](../src/dsp/cpp.js) — internal canonical-rate
  resampling (Blackman-windowed sinc FIR + linear-interp). Public
  API unchanged.

### Calibration data layer
- [src/audio/vocal-weight-baseline.js](../src/audio/vocal-weight-baseline.js)
  — adaptive σ window via ring buffer of 120 emits. Recomputes
  μ/σ on each push after the buffer fills.
- [src/audio/useAudioPipeline.js](../src/audio/useAudioPipeline.js)
  — feeds aggregator emits to the baseline. No persistence, no
  target capture, no callbacks beyond start/stop.

### UI
- [src/components/VocalWeightGauge.jsx](../src/components/VocalWeightGauge.jsx)
  — Lighter ← → Heavier labels, σ-distance readout, target-band
  highlight, "Calibrating: N %" UI. No buttons.
- [src/components/CombinedDashboard.jsx](../src/components/CombinedDashboard.jsx),
  [src/App.jsx](../src/App.jsx) — minimal prop threading.

### Persistence (cleanup)
- [src/db.js](../src/db.js) — Dexie v2 migration cleanly drops
  the short-lived `vocalWeightCalibration` table from cycle 5a's
  same-day-reverted persistence implementation. Dev users who
  tested the persistence branch get a clean removal; v1 users skip
  past the migration unaffected.

### Tests + measurement infrastructure
- `tests/audio/vocal-weight-baseline-test.js` — sliding-window
  coverage added (FIFO ageout, aggregator-hard-reset interaction,
  custom configuration).
- `tests/dsp/cpp-test.js`, `tests/dsp/cpp-cost-microbench.js` —
  `NATIVE_BUFFER_LEN` sizing for 48 kHz synthetic stimuli after
  the canonical-rate merge.
- `tests/dsp/cpp-sample-rate-sensitivity.js` — verdict criterion
  is now real-audio spread < 0.05 dB threshold.
- `tests/dsp/cpp-adaptive-window-probe.js` — Pattern A vs Pattern
  B empirical probe on 198 s of PTDB-TUG speech.
- DELETED: `src/dsp/cpp-resampled-prototype.js`,
  `tests/dsp/cpp-resampled-prototype-test.js`,
  `tests/dsp/cpp-resampled-prototype-validation.js` (prototype
  merged into production).

## Design iteration note

This implementation went through a same-day course correction.
Initial Stage C explored hybrid self+target with persisted
baselines and target-voice capture (cycle 5a, commit `3024f61`,
reverted in `24efd48`). The interaction cost — set-target button,
re-baseline button, confirm-then-act flows, two display modes —
wasn't worth the goal-tracking benefit for Syrinx's user model.
Reverted to adaptive σ window for zero-interaction calibration.
The cleaner final product is what's shipping.

Full implementation summary + cycle-by-cycle history preserved in
[measurements/vocal-weight-stage-c-implementation-2026-05-12.md](../measurements/vocal-weight-stage-c-implementation-2026-05-12.md).
