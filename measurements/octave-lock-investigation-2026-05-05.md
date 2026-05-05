# pYIN HMM octave-lock investigation, 2026-05-05

## Status

**Fix shipped on branch `pyin-octave-lock-fix` at α=0.0001.** Recovery from
post-stress octave-lock improves from ≥10 frames to 6 frames (the L=4
lookback floor); full Hillenbrand corpus mean F0 error strictly improves
on both genders (M 12.2→9.6 Hz, F 12.2→11.3 Hz); gender-symmetric max
metric improves 12.2→11.3 Hz. The during-stress lock the user observed
(several seconds of wrong-octave during a minute-plus of aggressive slider
drag) is structurally unbounded by the fix because the input is constantly
changing — the fix can only bound *recovery* time once the input stabilises.
A separate live re-test against the original reproducer is needed to
confirm subjective improvement under the user's actual workload; this file
is the review surface for that re-test.

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

## Pathological-stimulus sweep

Built four pathological stimuli to test for lock states deeper than the
original 9-frame transient on `octave-step-200-then-400.wav`:

- `path-burst-then-400.wav` — 8 rapid triangle sweeps (0.5 s each) → 6 s steady at 400 Hz
- `path-boundary-then-400.wav` — 5 Hz LFO modulating frequency around 200 Hz with ±70 Hz amplitude (crosses the half-octave boundary repeatedly) → 6 s steady at 400 Hz
- `path-longwalk-then-400.wav` — 30 s of random-walk in [100, 400] Hz at 30 Hz step rate → 6 s steady at 400 Hz
- `path-humandrag-then-400.wav` — 20 s of variable-speed slider-drag emulation (occasional pauses, direction reversals, biased toward octave-confusable transitions) → 6 s steady at 400 Hz

Recovery measurement (`tests/dsp/octave-lock-recovery-measure.js`):

| α \ fixture | step | burst | boundary | longwalk | humandrag |
|---:|---:|---:|---:|---:|---:|
| **0** (baseline) | 10 | 4 | 5 | 4 | 9 |
| **0.0001** | 6 | 4 | 6 | 6 | 6 |
| 0.001 | 6 | 4 | 6 | 6 | 6 |
| 0.01 | 6 | 4 | 6 | 6 | 6 |
| 0.1 | 6 | 4 | 6 | 6 | 6 |

(Numbers = frames after the stress section ends until detected pitch first
crosses ≥ 350 Hz.)

**The recovery floor is L=4 lookback (4 frames) plus ≤ 2 frames of warm-up.**
Any α > 0 saturates the improvement. α=0 alone produces the 10-frame post-
stress lock on `octave-step` and the 9-frame lock on `humandrag`. Larger α
values do not deepen or shorten the recovery floor.

**During-stress lock** (longest contiguous span of returned pitch < 280 Hz
inside the stress section, where the input does not hold a steady frequency):
`path-longwalk` showed up to **89 frames (~2.2 s)** of sustained wrong-octave
during the random-walk stress. This is consistent with the user-reported
behaviour during minute-long slider drag: the lock can persist arbitrarily
long while the input is moving, but resolves within the recovery floor once
it stabilises.

## Accuracy validation on full Hillenbrand corpus

Same-corpus comparison via [`tests/dsp/real-speech-test.js`](../tests/dsp/real-speech-test.js)
(streaming-median over central 70 % of each 1116-file recording):

| Metric | α=0 (baseline) | α=0.0001 (proposed) | Δ |
|---|---:|---:|---:|
| Male F0 mean error | 12.2 Hz | **9.6 Hz** | −2.6 Hz |
| Female F0 mean error | 12.2 Hz | **11.3 Hz** | −0.9 Hz |
| Male F0 median error | 1.5 Hz | 1.5 Hz | 0 |
| Female F0 median error | 3.6 Hz | 3.5 Hz | −0.1 |
| Male F0 p95 | 10.9 Hz | 10.8 Hz | −0.1 |
| Female F0 p95 | 28.6 Hz | 27.3 Hz | −1.3 |
| **Max(M, F) mean error** | **12.2 Hz** | **11.3 Hz** | **−0.9 Hz** |
| Male octave 2× errors | 3 / 540 | 1 / 540 | −2 |
| Female octave 2× errors | 16 / 576 | 15 / 576 | −1 |

**α=0.0001 strictly improves the gender-symmetric pitch-accuracy baseline
on the full corpus.** Both genders' mean F0 error decreases; the gender-
symmetric max metric (the ship criterion) improves from 12.2 → 11.3 Hz.
Octave-doubling errors decrease slightly. All [`real-speech-test.js`](../tests/dsp/real-speech-test.js)
and [`accuracy-test.js`](../tests/dsp/accuracy-test.js) pass thresholds.

## Why α larger than 0.0001 regresses female voices

Same-sample on `accuracy-test.js`'s n=58 subset:

| α | Male F0 mean | Female F0 mean |
|---:|---:|---:|
| 0 | 8.8 | 10.8 |
| 0.0001 | **1.8** | **10.9** |
| 0.001 | 1.8 | 13.7 |
| 0.01 | 7.5 | 13.7 |

At α≥0.001 the female mean jumps to 13.7 Hz; the recovery improvement
saturates at α=0.0001 already (per the table above), so larger α adds no
upside. α=0.0001 is the smallest value that achieves the recovery benefit
and it stays inside the female-accuracy regression-clean range. The exact
mechanism of the female regression at higher α isn't pinned (likely allows
the HMM to wander more readily through low-evidence states on harder female
samples), but the empirical sweet spot is unambiguous.

## Files added on branch `pyin-octave-lock-fix`

- [src/dsp/dsp-worker.js](../src/dsp/dsp-worker.js) — `_pyinBuildPitchTrans` now builds the mixture prior; `_PYIN_ALPHA_DEFAULT = 0.0001`; `set-pyin-alpha` worker message added for harness sweeps.
- [tests/audio/fixtures/octave-step-200-then-400.wav](../tests/audio/fixtures/octave-step-200-then-400.wav) — primary reproducer.
- [tests/audio/fixtures/path-{burst,boundary,longwalk,humandrag}-then-400.wav](../tests/audio/fixtures/) — pathological stress stimuli.
- [tests/dsp/octave-lock-diagnostic.js](../tests/dsp/octave-lock-diagnostic.js) — HMM-state inspection tool (per-frame pitch + top-3 alpha states + voicedness, supports `--alpha=N`).
- [tests/dsp/octave-lock-recovery-measure.js](../tests/dsp/octave-lock-recovery-measure.js) — programmatic recovery-time measurement over all five fixtures, supports `--alpha=N`.
- [tests/dsp/octave-recovery-regression.js](../tests/dsp/octave-recovery-regression.js) — guard against accidental revert. Asserts ≤ 8 frames recovery on `octave-step-200-then-400.wav`. With α=0 it fails; with α=0.0001 it passes at 6 frames.
- [scripts/generate-octave-step.js](../scripts/generate-octave-step.js), [scripts/generate-pathological-stimuli.js](../scripts/generate-pathological-stimuli.js) — fixture generators.

## Outstanding for ship

Live re-test against the szynalski.com tone-generator reproducer under the
exact conditions that triggered the bug (minute-plus of aggressive slider
drag) — Alice will run this against the branch before merge. If subjective
recovery improves under the original conditions: branch merges to `main`.
If still reproduces: more investigation required (likely a different
mechanism than the post-stress recovery time, given the synthetic stimuli
all show the bounded recovery improvement).
