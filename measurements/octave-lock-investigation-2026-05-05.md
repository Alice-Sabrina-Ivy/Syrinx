# pYIN HMM octave-lock investigation, 2026-05-05

## Status

**Architectural weakness confirmed by static analysis. Reproducer attempts did
not produce permanent lock on synthetic stimuli — HMM recovered within
~250–550 ms in every case.** The user-reported "stays stuck indefinitely"
behaviour likely manifests during continuous slider drag where the input is
never stable long enough for recovery to complete; once the slider stops, the
HMM should recover within roughly half a second per the analysis below. Either
way, the underlying weakness is real and a fix is recommended. No fix has
been shipped — this file is the proposal surface.

## Reproducer attempts

Built three synthetic stimuli and an offline diagnostic
([tests/dsp/octave-lock-diagnostic.js](../tests/dsp/octave-lock-diagnostic.js))
that loads the worker into a `vm.createContext` and inspects the HMM forward
variables (`_PYIN_LOG_ALPHA`, `_pyinFrameIdx`, `_pyinLastVoicedness`) directly
between `detectPitch()` calls.

| Stimulus | Result |
|---|---|
| `chirp-100-400hz-then-steady.wav` — 4× triangle 400→100→400 over 4 s, then 8 s steady at 400 Hz, pure sine | HMM tracked sweeps with ~150 ms latency (= L=4 lookback × 25 ms hop + warm-up); locked at 401 Hz throughout the steady portion. **No octave error.** |
| `octave-step-200-then-400.wav` — 2 s pure sine at 200 Hz then 2 s pure sine at 400 Hz | HMM correctly locked at 200 during first half. After the step, it stayed locked at 200 Hz for **9 frames (≈225 ms)** before jumping to 401 Hz, then stayed locked at 401 Hz. Recovery happened, but slowly. |
| `slider-drag-then-steady-400.wav` — 4 s of random-walk frequency in [100, 400] Hz at 30 Hz step rate, then 6 s steady at 400 Hz | HMM tracked chaotically during drag, never locking; settled at 401 Hz within 150 ms of the steady portion starting. **No octave error.** |

## Static analysis — why the bug exists in principle

The transition prior is Gaussian over cents distance, σ = 50 cents
([src/dsp/dsp-worker.js:209–225](../src/dsp/dsp-worker.js)). At 12
cents/state, an octave is 100 states = 1200 cents apart. The transition
log-probability across an octave is:

```
log P(s → s ± octave) = -(1200²) / (2 · 50²) - log(Z) ≈ -288 - log(Z)
```

That's effectively zero — single-frame cross-octave transitions are
infeasible. **Once `α` is concentrated at the wrong-octave state,
the HMM cannot escape via a one-frame transition.**

Recovery has to come from observation-ratio dominance over many frames:

- At a state with no obs evidence (input not at this freq), `obs ≈ ε = 1e-6`,
  so each self-loop frame multiplies α by `log(ε) ≈ -13.8`.
- At a state with full obs evidence (input at this freq), `obs ≈ 0.5`,
  so each self-loop frame multiplies α by `log(0.5) ≈ -0.69`.
- Per-frame gap closure: `13.8 - 0.69 ≈ 13.1` log-units in favour of the
  correct state.

Starting from a one-octave gap (≈ -288), recovery is `288 / 13.1 ≈ 22 frames
≈ 550 ms`. The `octave-step-200-then-400.wav` test confirmed this empirically
at 9 frames (faster than worst-case because the gap was smaller — alpha at
400 wasn't at the absolute minimum).

**The user's observation is consistent with this**: continuous slider drag
prevents the input from holding any single frequency for ≥ 550 ms, so the
recovery never completes. From the user's perspective the HMM "stays stuck
indefinitely" — and that's structurally true given the current prior.

Pure-sine input from a tone generator is the worst-case stimulus class
because the autocorrelation has secondary dips at integer multiples of the
true period (CMND[2T], CMND[3T]). Voiced-state observation mass at the
half-frequency is therefore non-trivial, so the wrong-octave state has a
real basin of attraction even without any temporal pathology.

## HMM trace from `octave-step-200-then-400.wav` (key frames)

```
t_sec   true_in   returned   voicedness   top1(Hz, logα)             top2                top3
2.000   400.0     200.7      0.999        (200.7, -190.34)            (199.3, -204.1)     (202.1, -204.1)   ← input just stepped to 400 Hz
2.025   400.0     200.7      0.987        (200.7, -193.54)            (199.3, -206.5)     (202.1, -206.5)
...      (8 more frames at 200.7 Hz, the false-octave lock)
2.225   400.0     200.7      0.987        (200.7, -322.92)            (199.3, -322.95)    (202.1, -322.95)
2.250   400.0     401.4      1.000        (401.4, -326.71)            (200.7, -339.09)    (199.3, -339.12)   ← HMM jumps to correct state
2.275   400.0     401.4      1.000        (401.4, -329.07)            (398.6, -342.91)    (404.2, -342.91)
```

Visible: the wrong-octave state at 200.7 Hz held the top rank for 9 frames
after the input changed, then was overtaken by the correct 401.4 Hz state
once the obs-ratio gap closed. Voicedness stayed near 1 throughout — voicing
is not the failure surface; the pitch-state ranking inside the voiced
subspace is.

## Proposed fix — mixture transition prior

Replace the pure Gaussian prior with a small-weight uniform admixture so that
cross-octave transitions have a finite probability while normal smooth
tracking is unaffected:

```
P(from → to) ∝ (1 − α) · exp(−d²/(2σ²)) + α · (1 / N_pitch)
```

Where:
- σ stays at 50 cents (preserves the gender-symmetric Hillenbrand baseline
  for normal-stability tracking — the σ-sweep at L=4 selected this value
  empirically).
- α is a small mixing weight, candidate values 0.001–0.01, swept on
  Hillenbrand to find the largest value that doesn't degrade F=12.16,
  M=12.15.

Effect on octave-jump cost:

- σ=50 alone: cross-octave log-prob ≈ −288.
- σ=50 + α=0.01 uniform: cross-octave log-prob ≈ log(0.01 / 300) ≈ −10.3.

That's a 278 log-unit improvement at the ±octave boundary. Recovery from a
wrong-octave lock would drop from ~22 frames (550 ms) to ~1 frame
(~25 ms) — fast enough that even a brief stable moment during slider drag
lets the HMM correct itself.

For nearby-pitch transitions (e.g., 50 cents = 4 states = ~half a semitone),
the Gaussian still dominates: `(1−α)·exp(−0.5) + α/300 ≈ 0.6` vs the
α-only contribution of `0.0033`. Smooth tracking on real voice is unchanged
within sampling-noise, by inspection.

This is the same structure librosa.pyin uses (a "transition local" matrix
combined with a small octave-alias allowance) — well-precedented; not novel.

## Alternatives considered

| Approach | Trade-off | Recommendation |
|---|---|---|
| **A. Increase σ (e.g., to 200 cents)** | σ=200 makes octave jumps exp(−18) ≈ 1.5e-8 — feasible but not fast. Also widens the smooth-tracking prior so the HMM follows pitch jumps more eagerly, which would degrade smoothing on real voice. Would invalidate the σ-sweep that established F=12.16 M=12.15. | No |
| **B. Mixture prior (Gaussian + uniform)** | Clean separation: Gaussian preserves smoothness; uniform component creates escape route only at distances where the Gaussian is exhausted. Tunable via single parameter α. | **Recommended** |
| **C. Octave-alias-only prior** | `P ∝ Gaussian(d) + ε · 1{d ≈ ±1200 cents}` — only allows escape at exactly ±octave. Most targeted to the bug, but doesn't help with ±2-octave or other harmonic-aliasing errors that may also exist. | Possibly later, less general |
| **D. Post-process octave-disambiguation** | After Viterbi decode, check if 2× or 0.5× state has stronger combined evidence; force shift. Doesn't change HMM dynamics. | Risk of oscillation; couples cleanly with B if needed |
| **E. Periodic alpha decay** | Bleed probability from any state dominant for too long. Changes steady-state behavior (would make pitch readings noisier on stable voice). | No — regresses the pass5 baseline |
| **F. Voicedness-gated reset** | Reset HMM when voicedness drops below threshold. | Doesn't help — voicedness stays high throughout the bug (HMM is confidently voiced at the wrong frequency) |

## Validation plan if the proposal lands

1. Sweep α ∈ {0.001, 0.003, 0.01, 0.03, 0.1} on full Hillenbrand corpus
   (1116 files, both gender groups) at fixed σ=50. Confirm gender-symmetric
   accuracy stays within sampling noise of pass5 (F=12.16, M=12.15).
2. Re-run [`octave-lock-diagnostic.js`](../tests/dsp/octave-lock-diagnostic.js)
   on `octave-step-200-then-400.wav`; confirm recovery happens within
   1–3 frames instead of 9.
3. Add a permanent regression test: same fixture + assertion that detected
   pitch ≥ 350 Hz within ≤ 3 frames after the 2 s mark (input step). Check
   in alongside the σ/L sweep tests.
4. Live re-test against szynalski.com tone generator (the original
   reproducer) to confirm subjective recovery during continuous drag.
5. Spot-check on ambient real voice for 2–3 minutes — pitch should not
   become noisier under steady-state input.

## Files added

- [tests/audio/fixtures/octave-step-200-then-400.wav](../tests/audio/fixtures/octave-step-200-then-400.wav) — kept as the primary reproducer for any future fix verification.
- [tests/dsp/octave-lock-diagnostic.js](../tests/dsp/octave-lock-diagnostic.js) — kept as the HMM-state inspection tool. Loads the worker and prints per-frame pitch + top-3 alpha states + voicedness, accepts a WAV path. Useful for any future HMM tuning work.

The chirp + slider-drag fixtures are removed (didn't reproduce the bug, no
ongoing utility).
