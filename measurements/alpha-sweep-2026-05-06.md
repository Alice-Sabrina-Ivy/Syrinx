# pYIN α mixture-prior sweep (2026-05-06)

**Date:** 2026-05-06
**Branch:** `pitch-test-corpus-expansion`
**Sweep harness:** [tests/dsp/pitch-bucket-alpha-sweep.js](../tests/dsp/pitch-bucket-alpha-sweep.js)
**Hypothesis tested:** the production α=0.0001 admits more spurious cross-octave transitions than needed; reducing α might lower the sub-90-Hz octave-error rate (the failure mode the user observed against Voice Tools) without regressing the recovery-time gains the PR #69 investigation established.
**Outcome:** **STOP / no clean winner.** α tuning is a per-corpus trade-off, not a single-value fix. Surfaced for user decision before any code change.

## Sweep configuration

α values: **0.0001** (production baseline), **0.00001**, **0.000001**, **0**.

Other config unchanged: σ = 50 cents, L = 4, Stage 2.B, all 4 corpora
(Hillenbrand 1116 / PTDB-TUG 180 / vocadito 40 / FDA 100 = 1436 tracks).

## Headline metric: <90 Hz octave-error rate

The targeted failure mode. Aggregated across speech corpora (vocadito at
0% across all α; not load-bearing for this metric):

| α | PTDB-TUG <90 | FDA <90 | Total <90 octave errors (PTDB+FDA, n=1133) |
|---|---|---|---|
| 0.0001 (baseline) | 2.3% (22/950) | 2.7% (5/183) | **27** |
| 0.00001 | 2.7% (26/950) | 2.7% (5/183) | 31 |
| 0.000001 | 2.7% (26/950) | 2.7% (5/183) | 31 |
| 0 | 2.9% (28/950) | 1.1% (2/183) | **30** |

**No α value cleanly improves the targeted <90 Hz octave-error rate.**
α=0 reduces FDA's <90 octave errors substantially (5 → 2) but increases
PTDB-TUG's (22 → 28). Net total goes from 27 to 30 — slight regression.

α=0.00001 and α=0.000001 produce identical PTDB and FDA <90 numbers
(31 total) — slight regression vs baseline.

## Per-track improvements vs baseline (α=0)

α=0 dramatically improves several tracks that were performing badly under
the production baseline. Top 10 improvements (≥30 frames, Δ ≤ −2 Hz):

| Track | Baseline meanErr | α=0 meanErr | Δ | n |
|---|---|---|---|---|
| ptdb-tug mic_M02_sx71 (M) | 41.88 | 3.85 | **−38.03** | 49 |
| ptdb-tug mic_F01_sx21 (F) | 39.91 | 11.84 | **−28.07** | 37 |
| fda rl022 (M) | 27.12 | 2.87 | **−24.25** | 32 |
| ptdb-tug mic_M01_sx31 (M) | 29.16 | 6.92 | −22.25 | 55 |
| fda sb030 (F) | 28.55 | 11.09 | −17.46 | 69 |
| fda rl033 (M) | 23.77 | 6.79 | −16.98 | 42 |
| ptdb-tug mic_M01_sx35 (M) | 24.21 | 7.86 | −16.35 | 39 |
| ptdb-tug mic_M01_sx40 (M) | 21.09 | 6.81 | −14.28 | 52 |
| ptdb-tug mic_M02_sx53 (M) | 19.04 | 5.73 | −13.31 | 53 |
| fda rl032 (M) | 19.31 | 6.46 | −12.85 | 43 |

**`fda rl022` is the user's primary reproducer of the 80 Hz failure mode
against Voice Tools.** Under α=0 it goes from 27.12 Hz mean F0 error
to 2.87 Hz — a 90 % reduction. The other top improvements are similarly
the worst-case tracks under α=0.0001.

## Per-track regressions vs baseline (α=0)

But α=0 also regresses substantially on a different set of tracks. Top 10
regressions (≥30 frames, Δ ≥ +5 Hz):

| Track | Baseline meanErr | α=0 meanErr | Δ | n |
|---|---|---|---|---|
| ptdb-tug mic_F02_sx86 (F) | 6.81 | 26.74 | **+19.93** | 34 |
| ptdb-tug mic_F01_sx47 (F) | 11.50 | 25.79 | +14.29 | 50 |
| ptdb-tug mic_M02_sx68 (M) | 12.12 | 26.33 | +14.21 | 40 |
| fda sb041 (F) | 7.03 | 18.77 | +11.73 | 64 |
| ptdb-tug mic_F02_sx68 (F) | 10.78 | 21.29 | +10.51 | 43 |
| ptdb-tug mic_F02_sx83 (F) | 5.00 | 14.13 | +9.13 | 52 |
| ptdb-tug mic_F02_sx54 (F) | 5.08 | 13.93 | +8.85 | 56 |
| ptdb-tug mic_F01_sx20 (F) | 7.96 | 16.23 | +8.27 | 65 |
| fda sb004 (F) | 16.77 | 24.00 | +7.23 | 43 |
| **vocadito vocadito_34** | 11.59 | 18.57 | **+6.98** | 729 |

**Pattern:** α=0 regressions cluster on female-voice tracks. The α=0
improvements cluster on male-voice tracks. The trade-off is structural —
α=0 makes the algorithm "stickier" to its current octave choice, which
helps when it's been confused into the wrong octave on low-pitch male
voice (the recovery floor goes from 6 frames at α=0.0001 back to ~22
frames at α=0 per the PR #69 investigation, but the algorithm enters
wrong-octave states LESS often), but hurts when female voices have
genuine prosodic pitch movements that the larger α=0.0001 mixture
helps the HMM follow.

vocadito_34 (the canary track) regresses from 11.59 → 18.57 Hz mean error
under α=0 — a 60 % regression on that specific track.

## α=0.00001 and α=0.000001 — middling values

These produce results almost identical to the α=0.0001 baseline:
- Sub-90 octave-error rates: PTDB 2.7% (vs baseline 2.3% — slight
  regression on PTDB; matched on FDA).
- Per-track regressions vs baseline: mostly clean, a few small
  regressions (mic_M02_sx77 at +8.20, fda rl025 at +5.84).
- Per-track improvements vs baseline: few; the dramatic α=0 improvements
  don't appear here.

These intermediate values don't behave intermediate — the algorithm
either has enough mixture (α≥0.0001) to follow prosodic motion fluidly,
or has none (α=0) and parks more tightly. The middle values inherit α≥0
flexibility without enough mixture to actually help recovery, producing
slightly-worse behavior on both axes.

## Median F0 error per bucket × (corpus, α)

(Selected populated cells; full table in the harness output.)

|  bucket   | Hillen 0.0001 | Hillen 0 | PTDB 0.0001 | PTDB 0 | FDA 0.0001 | FDA 0 |
|---:|---:|---:|---:|---:|---:|---:|
|  < 90     |   —   |   —   |  3.0  |  3.3  |  1.4  |  1.4  |
|  90–120   |  2.6  |  2.5  |  3.2  |  3.2  |  1.3  |  1.3  |
|  120–150  |  3.5  |  3.7  |  4.1  |  4.0  |  1.6  |  1.6  |
|  220–280  |  6.4  |  6.4  |  4.7  |  4.8  |  3.1  |  3.1  |
|  280–350  | 30.9  | **15.7** | 5.6 | 5.6 |  3.6  |  3.6  |

**Median errors are stable across α** in well-populated buckets — the
α-tuning trade-off shows up in mean (which is octave-error sensitive),
not median. The Hillenbrand 280-350 bucket sees a clean improvement
under α=0 (30.9 → 15.7) but only 32 frames — small-sample.

## Why this isn't a fix

The user's instruction was explicit: *"If during alpha tuning you find
that no alpha value meaningfully improves sub-90 Hz octave errors
(i.e., the sweep reveals alpha isn't the right knob for this failure
mode), STOP and surface. That changes the fix direction and we don't
ship a fake fix."*

α=0 is the candidate that comes closest to a fix, and it doesn't qualify:
1. It does not improve total <90 Hz octave errors aggregated across
   speech corpora (PTDB-TUG actually regresses).
2. It improves the user's specific reproducer (rl022) dramatically and
   several similar male-voice tracks, but at the cost of dramatic
   regressions on female-voice prosodic tracks.
3. The trade-off is structural (male-voice low-pitch wins vs
   female-voice prosodic loses), not a tuning issue that a smaller
   refinement could resolve.

**α tuning is not the right knob for this failure mode.** The data
points to a different intervention than the α-only fix the user proposed:
the underlying issue appears to be how the HMM balances per-frame
observation evidence against its accumulated state, not the
cross-octave transition cost specifically.

## Open implications for fix direction

The improvements/regressions split by gender suggests the algorithm
makes different mistakes on male vs female voice that share a single
parameter (α). Three plausible directions surfaced by the sweep but
not investigated here:

1. **Per-pitch-range α** — wider mixture at low pitch (where harmonic
   confusion dominates) and tighter mixture at higher pitch (where
   prosodic following dominates). Adds complexity to the transition
   matrix; would need a sweep across the (low-α, high-α, transition-
   pitch) tuple.

2. **Asymmetric transition prior** — different α for super-octave
   vs sub-octave transitions, since male-voice low-pitch failures
   are super-octave (3×, 4×, 5×) and female-voice prosodic failures
   are within-octave continuous motion. This is a structural
   algorithm change, not a single-knob tweak.

3. **Observation-model adjustment** — the user's deferred hypothesis
   #3 from the baseline measurement. The Stage 2 voicedFlag investigation
   already surfaced that pYIN's `obs[V] = voicedness × pitch_obs_n`
   weighting structurally favors unvoiced state on real speech with
   low per-frame voicedness. Reweighting that ratio might address the
   underlying confusion without adjusting α at all.

These are speculative; none ran. **The user's stated framing is "I'll
decide which alpha to ship based on the values question of which
failure mode matters more."** That decision is the next gate.

## Reproducibility

```bash
node tests/dsp/pitch-bucket-alpha-sweep.js
# ~6 minutes wall time; full output to stdout, JSON block at the end.
```

The harness is committed to this branch. Future investigations of
transition-prior alternatives (per-pitch α, asymmetric prior, etc.)
can use the same scaffolding by extending the ALPHAS array or
parameterizing additional axes.
