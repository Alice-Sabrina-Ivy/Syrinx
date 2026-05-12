# PR description draft — Stage C (adaptive σ window)

(Pending explicit "open the PR" approval per CLAUDE.md.)

---

## Title

`feat(vocal-weight): sample-rate invariant CPP + adaptive σ window calibration`

## Summary

Final Stage C of the vocal-weight gauge replacement. Two coupled
changes:

- **Sample-rate-invariant CPP.** `computeCPP` resamples input to a
  canonical 16 kHz rate (Blackman-windowed sinc FIR + linear-interp)
  before the cepstrum pipeline runs. Same audio at any sample rate
  produces CPP within 0.01–0.03 dB (vs 0.1–0.3 dB spread before).
  Real-audio invariance verdict on PTDB-TUG + FDA.

- **Adaptive σ window for zero-interaction calibration.** A sliding
  ring buffer holds the last ~30 s of voiced CPP-aggregate emits.
  Until the buffer fills, the gauge shows "Calibrating: N%". After
  it fills, μ and σ are recomputed on each new emit — the oldest
  emit drops out. The gauge always reflects the user's recent voice.

No buttons. No target capture. No cross-session persistence. The
gauge calibrates itself, automatically, every session.

## What this fixes

- Same-audio different-sample-rate now produces the same CPP
  (real-audio spread 0.009–0.025 dB across [16, 20, 22, 32, 44, 48]
  kHz, well under the 0.05 dB invariance threshold). Previously,
  mobile silent-downsample to 16 kHz versus desktop 48 kHz produced
  0.1–0.3 dB systematic differences large enough to bias the gauge.
- Gauge no longer requires the user to know what's happening or
  what to do. First ~30 s of voiced speech = calibration. After
  that, the gauge just works.
- Each session calibrates from scratch — mic, room, time-of-day,
  and voice state may all differ between sessions, and the cost of
  a 30-s re-calibration is small vs the UX complexity of persistence
  with re-baseline affordances.

## What this does NOT fix (honest acknowledgement)

- **CPP is a correlate, not a direct measurement of perceived
  vocal weight.** Aaen 2025 + literature review support the
  proxy; the absolute mapping isn't established. Gauge surfaces
  *short-term position relative to your own recent voice*, not a
  population-normed score or progress against a goal voice.
- **Mic / room / environment differences between devices.** The
  sample-rate fix addresses one device-difference axis; mic and
  room acoustics aren't compensated. The session-local calibration
  partially absorbs this — each session re-calibrates for its own
  acoustic context.
- **No goal-setting UX.** An earlier iteration (this same branch,
  2026-05-12 morning) implemented hybrid self+target with persisted
  baselines and target-voice capture. The interaction cost (set
  target button, re-baseline button, confirm-then-act flows) wasn't
  worth the goal-tracking benefit for Syrinx's user model. Reverted
  to zero-interaction calibration on the same day. Future work
  could revisit goal tracking via different UX (e.g., session-end
  summary, progress-over-time sparkline) — those would be additions
  alongside the gauge, not replacements.
- **Within-corpus Praat correlations on Hillenbrand (r=0.35) and
  Vocadito (r=0.27) are lower than running-speech corpora**
  (PTDB-TUG r=0.64, FDA r=0.71). Per methodology investigation,
  corpus-specific characteristics (very short Hillenbrand clips,
  singing in Vocadito) don't map cleanly onto Praat's
  running-speech CPPS regime. Running-speech corpora are the
  production-relevant comparisons.

## Behavior in one sentence

The gauge shows the user's current voice's CPP position relative
to the σ of their recent ~30 s of voice, calibrated automatically.
No baselines, no targets, no persistence, no interaction.

## Test plan (for user-side testing on the dev server)

- [ ] First time starting the app: "Calibrating: listening for
      voice…" appears immediately. After speaking for a few
      seconds, it becomes "Calibrating: N%" with the percentage
      climbing as voiced material accumulates.
- [ ] Around 30 s of voiced speech: gauge becomes functional. The
      marker appears, the σ-distance readout shows numeric values.
      Long pauses extend the calibration period in voiced-content
      time (correct — calibration is voiced-content-based, not
      wall-clock).
- [ ] Once calibrated, modulate voice lighter/heavier briefly:
      marker moves toward the corresponding gauge end and the σ
      readout reflects direction.
- [ ] Sustained modulation: as the user maintains a new voice for
      more than ~30 s of voiced content, the sliding window fills
      with the new voice and the gauge re-centers. Marker drifts
      back toward the middle. This is the intended adaptive
      behavior — the gauge represents "your current voice relative
      to your recent voice."
- [ ] Stop and restart the audio: calibration starts over from
      scratch. No persisted state.
- [ ] Sample rate change (e.g., different USB device): gauge
      values don't shift discontinuously — algorithm is rate-
      invariant.
- [ ] Layer 1 (synthetic directional invariants): `node tests/dsp/cpp-test.js` → 28/28 pass.
- [ ] Layer 4 (Praat correlation): within-corpus r matches prototype (Hill 0.35, PTDB 0.64, Voca 0.27, FDA 0.71, overall 0.82).
- [ ] Baseline sliding-window unit tests: `node tests/audio/vocal-weight-baseline-test.js` → 56/56 pass.
- [ ] Pipeline timing trace: continuous speech locks at ~30 s,
      conversational with breath gaps locks at ~38 s, heavy
      fricatives ~48 s. (voiced-content-based, expected stretching.)
- [ ] Build: `npm run build` → succeeds. dsp-worker 10.5 kB.

## Methodology / investigation arc

This implementation went through five research cycles before
settling on the adaptive σ window. Preserved here so future
iterations don't re-derive the same conclusions:

1. **Cycle 1 (2026-05-09)**: Audit found the previous alpha-ratio
   metric was uncalibrated and unsmoothed. Replaced with
   Hillenbrand-style CPP + per-user baseline + 1-s aggregator
   ([measurements/vocal-weight-cpps-audit-2026-05-09.md](vocal-weight-cpps-audit-2026-05-09.md)).

2. **Cycle 2 (2026-05-10)**: Calibration timing showed the
   original lock used wall-clock-spread instead of voiced-content
   count, inflating calibration time on speech with natural
   pauses. Fixed to count-based at 120 samples.

3. **Cycle 3 (2026-05-10)**: Full Maryn CPPS implementation
   (Theil regression + exponential trend + time smoothing +
   quefrency smoothing) regressed Praat correlation. Component
   isolation showed time smoothing was the culprit (Praat 2 ms
   time-step vs Syrinx 25 ms hop methodology mismatch). Reverted
   to linear+linear+no-time-smoothing+3-bin-quefrency-smoothing.

4. **Cycle 4 (2026-05-11)**: Scale display investigation surfaced
   sample-rate sensitivity as a measurement-integrity blocker.
   Same audio at different sample rates produced 0.1–0.3 dB CPP
   spread ([measurements/cpp-scale-display-stage-ab-2026-05-11.md](cpp-scale-display-stage-ab-2026-05-11.md)).

5. **Cycle 5a (2026-05-12 AM)**: Algorithmic invariance fix
   (resample to canonical 16 kHz with anti-alias FIR) collapsed
   spread to < 0.03 dB. Combined with persisted baseline +
   optional target capture for what was thought to be the
   calibration UX overhaul.

6. **Cycle 5b (2026-05-12 PM)**: Course correction. Hybrid
   self+target with persistence introduced interaction cost
   (multiple buttons, confirm-then-act flows, two display modes)
   that wasn't worth the goal-tracking benefit. Reverted on the
   same day. Settled on adaptive σ window — empirical probe
   showed Pattern A (continuous sliding window) gives clean σ
   behavior (0.26-0.56 dB across 198 s of single-speaker
   running speech, no σ-collapse) and matches stated intent
   ([measurements/cpp-adaptive-window-probe-2026-05-12.json](cpp-adaptive-window-probe-2026-05-12.json)).

**Key cumulative learnings** (transferable to future iterations):

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
  tested, built, lint-clean. The cost wasn't algorithmic; it
  was UX surface area. Cycles 5a/5b show that "the algorithm
  validates" isn't the same as "this is the right product
  surface." The same-day revert was cheap because the work was
  bounded to one branch and one PR scope.
- **Empirical probe before committing to a calibration pattern.**
  The Pattern A vs Pattern B choice ran on 198 s of real PTDB-TUG
  speech before being implemented. Probe took ~10 minutes to
  write + run; it ruled out the σ-collapse risk and showed
  Pattern B's shift trigger doesn't actually fire on normal
  speech. The probe surface stays in `tests/dsp/cpp-adaptive-window-probe.js` for future calibration experiments.

## Files changed

### Algorithm
- [src/dsp/cpp.js](../src/dsp/cpp.js) — sample-rate-invariant
  internal resampling to 16 kHz canonical. `CPP_INPUT_LEN`
  semantics shifted to canonical-rate cap.

### Calibration data layer
- [src/audio/vocal-weight-baseline.js](../src/audio/vocal-weight-baseline.js)
  — adaptive σ window via ring buffer of last 120 emits. Recomputes
  μ/σ on each push after the buffer fills. External API unchanged
  (`ready()`, `mu()`, `sigma()`, `gaugePosition()`, `sigmaDelta()`,
  `progress()`, `reset()`, `state()`) — just the internal model
  changed from lock-and-freeze to sliding window.
- [src/audio/useAudioPipeline.js](../src/audio/useAudioPipeline.js)
  — feeds aggregator emits to the baseline. No persistence, no
  target capture, no callbacks beyond start/stop.

### UI
- [src/components/VocalWeightGauge.jsx](../src/components/VocalWeightGauge.jsx)
  — Lighter ← → Heavier labels, σ-distance readout, target band
  highlight, "Calibrating: N%" UI. No buttons. No subtitle.
- [src/components/CombinedDashboard.jsx](../src/components/CombinedDashboard.jsx),
  [src/App.jsx](../src/App.jsx) — gauge prop threading simplified
  (no callbacks beyond start/stop).

### Persistence (cleanup)
- [src/db.js](../src/db.js) — v2 schema migration drops the
  short-lived `vocalWeightCalibration` table that was added then
  removed during the same-day course correction. Dev users who
  tested the persistence branch get a clean drop; v1 users skip
  past the migration.

### Tests
- [tests/audio/vocal-weight-baseline-test.js](../tests/audio/vocal-weight-baseline-test.js)
  — 56/56 pass. Original 42 directional tests preserved; the
  "locked baseline does not drift" test replaced with positive
  sliding-window coverage (μ tracks recent window, σ tracks recent
  window, old emits age out FIFO, aggregator hard-reset interaction).
- [tests/dsp/cpp-adaptive-window-probe.js](../tests/dsp/cpp-adaptive-window-probe.js)
  — Pattern A vs B empirical probe on 198 s of PTDB-TUG speech.
  Surface for future calibration experiments.
- [tests/dsp/cpp-test.js](../tests/dsp/cpp-test.js),
  [tests/dsp/cpp-cost-microbench.js](../tests/dsp/cpp-cost-microbench.js)
  — `NATIVE_BUFFER_LEN` sizing for 48 kHz synthetic stimuli after
  the canonical-rate merge.
- [tests/dsp/cpp-sample-rate-sensitivity.js](../tests/dsp/cpp-sample-rate-sensitivity.js)
  — verdict criterion is now real-audio spread vs 0.05 dB
  threshold; synthetic spread documents stimulus-construction
  variance, not algorithm sensitivity.
- [tests/audio/vocal-weight-pipeline-trace.js](../tests/audio/vocal-weight-pipeline-trace.js)
  — logging shows native→canonical sample mapping.
- DELETED: `src/dsp/cpp-resampled-prototype.js`,
  `tests/dsp/cpp-resampled-prototype-test.js`,
  `tests/dsp/cpp-resampled-prototype-validation.js` (prototype
  merged into production).

## Verification matrix

| Layer | Test | Result |
|---|---|---|
| Layer 1 directional | `cpp-test.js` | 28/28 pass |
| Layer 2 Hillenbrand distribution | `cpp-corpus-test.js` | 6/6 sanity assertions pass |
| Layer 4 Praat correlation | `praat-syrinx-correlate.py` | Within-corpus r matches prototype: Hill 0.35, PTDB 0.64, Voca 0.27, FDA 0.71, overall 0.82 (Δ < 0.001) |
| Sample-rate invariance | `cpp-sample-rate-sensitivity.js` | PTDB spread 0.009 dB, FDA spread 0.025 dB — invariance verdict |
| Per-frame cost | `cpp-cost-microbench.js` | Production-default median 0.439 ms, p99 0.785 ms (under 1 ms reassessment threshold) |
| Baseline sliding-window | `vocal-weight-baseline-test.js` | 56/56 pass |
| Aggregator regression | `vocal-weight-aggregator-test.js` | All green |
| Pipeline trace (5 sample rates) | `vocal-weight-pipeline-trace.js` | 5/5 rates produce identical CPP throughput |
| Calibration timing | `vocal-weight-baseline-timing-trace.js` | Continuous 30 s, conversational 38 s, heavy-fricative 48 s (voiced-content stretching, expected) |
| Adaptive Pattern A/B probe | `cpp-adaptive-window-probe.js` | σ min 0.26 dB, σ-collapse risk 0%, μ drift 0.25 dB over 198 s |
| Build | `npm run build` | Clean. dsp-worker bundle 10.5 kB |
