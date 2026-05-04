# Harmonic-gate sweep analysis — 2026-05-04

> **Status (2026-05-04):** the recommended single-constant change
> (`HARMONIC_IMPROVEMENT_MIN: 0.003 → 0.010`) shipped on 2026-05-04. Post-change
> measurements in `measurements/pitch-after-impMin-tighten-2026-05-04.txt`
> match the predicted Pareto cell exactly: real-speech female F0 mean
> 15.4 → 14.2 Hz, male unchanged at 9.8 Hz, sub-harmonic-lock count
> 36 → 30, no test regressions. The < 10 Hz target remains unmet and
> requires the algorithmic upgrade discussed below.


Sweep ran by `scripts/tune-harmonic-gates.js`; raw data in
`measurements/harmonic-gate-sweep-2026-05-04.csv`. The harness loads
`src/dsp/dsp-worker.js` via `vm.runInContext` and overrides three constants
inside `detectPitch` (`HARMONIC_RELATIVE_K2`, `HARMONIC_IMPROVEMENT_MIN`,
the `absOk` threshold) per cell without touching the worker on disk.

Workload per cell: full Hillenbrand corpus at 16 kHz (540 men + 576 women,
single steady-state 50 ms window per file), plus the 5 second-harmonic-
dominant + 4 third-harmonic-dominant synthetic stimuli at 48 kHz that
match the comprehensive suite's `[11]` block.

Grid: `relativeK2 ∈ {0.20, 0.25, 0.30, 0.35, 0.40, 0.45, 0.50}`,
`improvementMin ∈ {0.001, 0.003, 0.010, 0.030}`, `absOk ∈ {0.05, 0.10, 0.15}`
— 84 cells. Sweep wall time: 10.5 s.

Harness validation: the cell at the deployed defaults
(`relK2=0.50, impMin=0.003, absOk=0.15`) returns
`femaleMean=15.38, maleMean=9.84, subLocks=36`, which matches the
`real-speech-test.js` baseline (`15.4 / 9.8 / 36`) byte-for-byte after
rounding. The sweep is exercising the deployed code.

## Bottom line

**No cell in the grid gets the female F0 mean below ~14 Hz; the
target is `< 10 Hz`. Best cell beats baseline by 1.23 Hz. Synthetic
2nd/3rd-harmonic stress passes 5/5 and 4/4 in every single cell — those
tests are not the binding constraint and never were.**

This matches the user's "stop and report" branch: the three-constant
parameter tuning does not have the dynamic range to close the gap. The
remaining options are an algorithmic upgrade (pYIN / MPM / SWIPE') or
accepting the current performance.

## Pareto frontier

Exactly one cell is non-dominated AND strictly improves on the deployed
defaults across all four success axes (femaleMean ↓, maleMean ↓,
secondPass ↑, thirdPass ↑):

| relK2 | impMin | absOk | femaleMean | maleMean | 2nd | 3rd | subLocks |
|------:|-------:|------:|-----------:|---------:|-----|-----|---------:|
| **0.50** | **0.010** | **0.15** | **14.15** | 9.84 | 5/5 | 4/4 | 30 |
| 0.50 | 0.003 | 0.15 | 15.38 (baseline) | 9.84 | 5/5 | 4/4 | 36 |

A second cell, `(relK2=0.45, impMin=0.010, absOk=0.15)` → `F=14.71, M=9.84`,
also strictly dominates baseline but is itself dominated by the cell above.

## Top 10 by lowest femaleMean

| relK2 | impMin | absOk | femaleMean | maleMean | 2nd | 3rd | subLocks |
|------:|-------:|------:|-----------:|---------:|-----|-----|---------:|
| 0.50 | 0.010 | 0.15 | 14.15 | 9.84  | 5/5 | 4/4 | 30 |
| 0.50 | 0.010 | 0.10 | 14.31 | 13.15 | 5/5 | 4/4 | 29 |
| 0.50 | 0.010 | 0.05 | 14.43 | 24.21 | 5/5 | 4/4 | 28 |
| 0.45 | 0.010 | 0.15 | 14.71 | 9.84  | 5/5 | 4/4 | 29 |
| 0.45 | 0.010 | 0.10 | 14.88 | 13.15 | 5/5 | 4/4 | 28 |
| 0.40 | 0.010 | 0.15 | 14.96 | 9.99  | 5/5 | 4/4 | 29 |
| 0.45 | 0.010 | 0.05 | 14.99 | 24.21 | 5/5 | 4/4 | 27 |
| 0.40 | 0.010 | 0.10 | 15.13 | 13.42 | 5/5 | 4/4 | 27 |
| 0.40 | 0.010 | 0.05 | 15.24 | 24.21 | 5/5 | 4/4 | 26 |
| 0.50 | 0.001 | 0.15 | 15.38 | 9.84  | 5/5 | 4/4 | 36 |

Best in grid: **14.15 Hz**, gap to target: **4.15 Hz**.

## Recommended cell

If the user proceeds with the worker tweak:
**`HARMONIC_IMPROVEMENT_MIN: 0.003 → 0.010`** (other two constants unchanged).

- Female F0 mean: **15.38 → 14.15 Hz** (−1.23 Hz, −8.0%)
- Male F0 mean: **9.84 → 9.84 Hz** (unchanged)
- Sub-harmonic-lock count: **36 → 30** (−6 cases, −17%)
- Synthetic 2nd-harmonic: 5/5 (preserved)
- Synthetic 3rd-harmonic: 4/4 (preserved)

This is a defensible, narrowly-scoped change: a single literal swap inside
[src/dsp/dsp-worker.js:341](src/dsp/dsp-worker.js#L341). It's strictly
Pareto-better than the current setting, but **the user should know it
does NOT meet the < 10 Hz target.** It moves the needle marginally.

## Why the grid can't reach 10 Hz — three findings

### 1. The synthetic stress tests do not discriminate

All 84 cells, including the most aggressive ones (`relK2=0.20, absOk=0.05`),
pass 5/5 second-harmonic and 4/4 third-harmonic. The synthetic stimuli
have CMND dips at the true period that are extremely deep — `cmnd[trueTau]`
on a clean synthetic signal is well below 0.05, and the ratio
`cmnd[trueTau] / cmnd[wrongTau]` is well below 0.2. They pass any
plausible gate. They cannot tell us which gate setting is "safe" because
the entire grid is safe for them.

### 2. The relK2 axis behaves opposite to the user's hypothesis

The original prompt's diagnosis was that the gates fire too easily on
real female speech. The natural reading is "tighten relK2 (lower number),
fewer corrections, fewer false halvings." The data goes the other way:

| relK2 | femaleMean (at impMin=0.010, absOk=0.15) |
|------:|-----------------------------------------:|
| 0.20  | 16.79 (worse than baseline) |
| 0.30  | 16.00 |
| 0.40  | 14.96 |
| 0.50  | **14.15 (best)** |

`relK2=0.50` (loosest in grid, current default) gives the lowest female
mean. Tightening makes things worse. Reason: real female periodic speech
produces CMND ratios at `2·baseTau` that are statistically
indistinguishable from the synthetic 2nd-harmonic-stress case where the
correction MUST fire — the relK2 ratio carries no signal that separates
"true period at baseTau, second-harmonic dip at 2·baseTau" from "true
period at 2·baseTau, sub-harmonic raw lock at baseTau". Tightening drops
both classes proportionally; the loss of legitimate corrections costs
more than the gain from fewer spurious ones.

### 3. The absOk axis is a male/female tradeoff, not a free dial

Tightening `absOk` reduces female sub-locks slightly but breaks male
detection on real speech. At `absOk=0.05`, male mean rises from 9.84 to
24.68 — a +15 Hz regression. Real male voices have legitimate raw 2x/3x
locks (formant-amplified harmonic stress in actual speech, not just
synthetics) where `cmnd[trueTau] ∈ (0.05, 0.15)`. Tightening absOk to 0.05
prevents those legitimate corrections; the raw 2x detection survives and
shows up as massive (~+125 Hz) errors in the male mean.

## What this rules out

No combination of these three constants can:
- get female mean ≤ 10 Hz (best is 14.15)
- meaningfully reduce female mean without paying somewhere (the only
  strict-Pareto improvement is +8 % on the female mean, not the +35 %
  needed to hit target)

The constants were already at a reasonable local optimum. The 1.23 Hz
improvement available is real but small.

## Recommended path forward

**Two options, ordered:**

1. **Land the marginal Pareto improvement** as a low-risk single-constant
   change (`HARMONIC_IMPROVEMENT_MIN: 0.003 → 0.010`) and explicitly
   acknowledge the headline target was not met. Net effect: ~8 % better
   female mean, no regression. Worth doing because it costs nothing, but
   does not solve the user-perceived problem.

2. **Algorithmic upgrade** is the only path to `< 10 Hz`. The data
   supports the user's pre-investment hypothesis: pYIN
   (probabilistic-YIN with Viterbi smoothing over candidate periods),
   MPM (McLeod normalised square-difference with picking heuristic),
   or SWIPE' (multi-band spectral compression). These methods address the
   exact failure mode this sweep exposed: YIN's first-below-threshold
   decision combined with a CMND-only correction rule has insufficient
   information to discriminate true-fundamental from sub-harmonic in
   periodic speech. They use either statistical priors over candidate
   tracks or different similarity metrics that suppress sub-harmonic
   peaks more cleanly. Multi-day project, as the original spec
   anticipated.

## Files

- `measurements/harmonic-gate-sweep-2026-05-04.csv` — 84 rows, full grid
- `measurements/harmonic-gate-sweep-2026-05-04-summary.txt` — Pareto and
  top-N tables produced by `scripts/analyze-harmonic-sweep.js`
- `scripts/tune-harmonic-gates.js` — sweep harness (vm-context, no
  inline copies, no worker mutation on disk)
- `scripts/analyze-harmonic-sweep.js` — Pareto-frontier computation
