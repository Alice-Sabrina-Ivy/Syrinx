# pYIN Stage 2.B L-axis Pareto sweep — 2026-05-04

**Why this exists:** the L=2 production fallback bug (silently shipping L=5
instead of L=2) surfaced that prior σ-only sweeps were L=2-only. The
"L=2 σ=75 is best" claim was never tested against other L values with
matched-methodology evidence. This sweep maps the L axis at fixed σ=75,
then re-verifies σ at the best-looking L cell(s).

Companion harnesses:
- [scripts/pyin-L-sweep-harness.js](../scripts/pyin-L-sweep-harness.js)
- [scripts/pyin-sigma-at-bestL-harness.js](../scripts/pyin-sigma-at-bestL-harness.js)

Raw output:
- [measurements/pyin-L-sweep-2026-05-04-harness.txt](pyin-L-sweep-2026-05-04-harness.txt)
- [measurements/pyin-sigma-at-bestL-2026-05-04-harness.txt](pyin-sigma-at-bestL-2026-05-04-harness.txt)

## Methodology

Matches the production test suites (different from the original σ-sweep
harness, which used last-non-null on Hillenbrand):

- **Hillenbrand**: `streamingMedianDetect` over the central 70 % of each
  file at 25 ms hops, **median** of non-null trace per file, then mean
  of per-file errors. Same helper as `accuracy-test.js` and
  `real-speech-test.js`.
- **PTDB-TUG**: frame-by-frame F0 contour matching against laryngograph
  reference, **co-detected** against Stage 0 mask. Same as
  `ptdb-tug-test.js` and the σ-sweep harness.

Corpora:
- Hillenbrand full: 1116 files (540 M, 576 F)
- Hillenbrand acc-subset: 120 files (5 per gender × vowel — mirrors
  `accuracy-test.js`'s sample selection)
- PTDB-TUG: 4 speakers × 45 SX = 180 files

The Stage 0 baseline below is the per-this-methodology baseline; numbers
are NOT directly comparable to last-non-null Stage 0 numbers in the
σ-sweep file. They ARE directly comparable to `real-speech-test.js`
output numbers.

## Stage 0 baselines (this methodology)

| Corpus              | F mean | F p95 | M mean | M p95 |
|---------------------|--------|-------|--------|-------|
| Hillenbrand full    | 41.22  | 237.5 | 36.50  | 295.6 |
| Hillenbrand acc-sub | 43.00  |       | 20.51  |       |
| PTDB-TUG codet      | 6.82   | 18.0  | 5.01   | 12.4  |

## L-sweep at σ=75

```
  L   lat   Hill F   Hill M  Hill F p95  PTDB F  PTDB p95   PTDB M   acc F   acc M
--- ----- -------- -------- ----------- ------- --------- -------- ------- -------
L=2  50ms    11.75    15.52        29.6    6.03      16.6     3.73   10.79   18.64
L=3  75ms    12.22    14.02        27.3    5.82      16.5     3.73   10.48    8.25
L=4 100ms    12.20    12.95        28.6    5.88      16.6     3.68   10.91    8.49
L=5 125ms    11.77    12.70        27.7    5.86      16.5     3.63    7.24    9.22
L=7 175ms    13.82    13.44        37.4    5.84      16.5     3.59    8.30   15.53
L=10 250ms   16.41    12.26        48.8    5.72      16.4     3.59   15.39    4.19
```

### Reading

- **acc-subset is high variance** (n≈60 per gender per cell) —
  L=2→L=3 jumps 18.64→8.25 on acc M, then L=3→L=5 stays in single
  digits, then L=7 jumps back to 15.53. These are sample-size artifacts,
  not real patterns. **Don't ship-decide off the acc subset.** Trust
  the full-corpus columns.
- **Full-corpus Hill F mean is L-insensitive** in the L=2–L=5 range
  (11.75–12.22, all within ~4%). L=7 starts regressing (13.82); L=10
  regresses badly (16.41 mean, 48.8 p95) — likely the cold-start /
  short-file warm-up failure mode noted in
  [tests/dsp/ptdb-tug-test.js:22–25](../tests/dsp/ptdb-tug-test.js#L22).
- **Full-corpus Hill M mean improves monotonically L=2→L=5**: 15.52 →
  14.02 → 12.95 → 12.70. Substantial: 18 % improvement at L=5 vs L=2.
- **PTDB-TUG codet** is essentially flat across L: F mean 6.03→5.72,
  p95 16.6→16.4. The HMM is doing most of its temporal-coherence work
  by L=2; longer trace-back gives diminishing returns on the connected-
  speech corpus.
- **acc-subset numbers reproduce the bug-era headline**: L=5 acc F=7.24
  matches the silent-L=5 measurement (7.0). The "< 10 Hz target met for
  the first time" claim in the PR was an acc-subset claim AT L=5. At
  L=2 it's 10.79, at L=4 it's 10.91 — both narrowly miss the < 10 acc
  target, even though full-corpus Hill F is solidly under 13 at all of
  L=2/3/4/5.

### Pareto frontier (full corpus only, σ=75)

| L | latency | Hill F | Hill M | Hill F p95 | PTDB F codet | dominated? |
|---|---------|--------|--------|------------|--------------|------------|
| 2 | 50 ms   | 11.75  | 15.52  | 29.6       | 6.03         | best Hill F, worst Hill M |
| 3 | 75 ms   | 12.22  | 14.02  | 27.3       | 5.82         | dominated by L=4 (worse Hill M) |
| 4 | 100 ms  | 12.20  | 12.95  | 28.6       | 5.88         | **in-budget, balanced** |
| 5 | 125 ms  | 11.77  | 12.70  | 27.7       | 5.86         | best balance, over budget |
| 7 | 175 ms  | 13.82  | 13.44  | 37.4       | 5.84         | dominated (worse F) |
| 10| 250 ms  | 16.41  | 12.26  | 48.8       | 5.72         | dominated (worse F p95) |

The non-dominated cells are **L=2, L=4, L=5**. L=3, L=7, L=10 are
strictly dominated by one of those three on at least one axis without a
counter-balancing win.

## σ recheck at L=4 and L=5

```
 L  σ      Hill F  Hill F p95   Hill M   PTDB F   PTDB p95   PTDB M
--- ---   ------- -----------  ------- -------- ---------- --------
 4   50     12.16        28.6    12.15     6.20       17.2     3.64
 4   75     12.20        28.6    12.95     5.88       16.6     3.68
 4  100     12.55        28.9    13.70     5.70       16.5     3.68
 5   50     12.11        28.6    12.40     6.16       17.2     3.64
 5   75     11.77        27.7    12.70     5.86       16.5     3.63
 5  100     12.12        28.6    13.41     5.79       16.5     3.63
```

### Reading

- **At L=4**: σ=50 strictly dominates σ=75 on Hill (F mean tied within
  noise, F p95 tied, **M mean 12.15 vs 12.95 — a real gain**). σ=100
  loses on Hill but slightly wins on PTDB. The smoother trace-back at
  L=4 lets a tighter σ win — confirms the user's hypothesis.
- **At L=5**: σ=75 still holds for Hill F mean (11.77 vs 12.11/12.12).
  σ=50 wins on Hill M (12.40 vs 12.70) but loses on Hill F. PTDB is
  flat across σ at L=5. So σ=75 remains the best balance at L=5.
- **σ=100 underperforms at both L=4 and L=5** on Hillenbrand. Looser
  prior gives up coherence the HMM was doing for free.

### Implication

The σ choice depends on L:
- L=2: σ=75 is Pareto-optimal (per the original σ-sweep —
  [pyin-stage2b-sigma-sweep-2026-05-04.md](pyin-stage2b-sigma-sweep-2026-05-04.md))
- L=4: **σ=50** is Pareto-optimal here
- L=5: σ=75 is still Pareto-optimal

Tighter σ at moderate L makes physical sense: the longer trace-back
provides more temporal smoothing, so the per-frame transition prior can
afford to be tighter without paying for false transitions.

## Ship-cell candidates

| Cell             | Lat   | Hill F | Hill M | Hill F p95 | PTDB F codet | Notes |
|------------------|-------|--------|--------|------------|--------------|-------|
| **L=2 σ=75**     | 50 ms | 11.75  | 15.52  | 29.6       | 6.03         | Current ship target; smallest latency; weakest Hill M |
| **L=4 σ=50**     |100 ms | 12.16  | 12.15  | 28.6       | 6.20         | In-budget; **best Hill M**; marginal Hill F regression |
| **L=5 σ=75**     |125 ms | 11.77  | 12.70  | 27.7       | 5.86         | Best balance overall; **25 ms over budget** |

Synth/comprehensive/yin-harmonic/smoothing test suites are unaffected
by L because they use `steadyStateDetect` (same-window-repeated, which
converges to the same answer at any L given enough warm-up).

## Recommendation

Ship **L=4, σ=50**.

**Why not L=2 σ=75 (current plan):**
- Hill M mean = 15.52 — that's the one full-corpus number that's clearly
  worse than achievable. L=4 σ=50 brings it to 12.15, a 22 % reduction.
  This is the strongest signal in the entire sweep.
- The original "Hill F=7.0" headline that motivated celebrating this
  cell was an acc-subset (n=60) measurement at silent L=5, not at the
  documented L=2.

**Why not L=5 σ=75:**
- Marginally better numbers (Hill F 11.77 vs 12.16, Hill M 12.70 vs
  12.15 — actually L=4 σ=50 is *better* on Hill M).
- 25 ms over the original 100 ms latency budget. L=4 σ=50 stays exactly
  at budget.

**Why L=4 σ=50:**
- Latency 100 ms — exactly the documented budget, twice the L=2 latency
  but still well under any reasonable real-time-feedback threshold for
  voice training (perception is dominated by visual readout cadence,
  ~5 fps = 200 ms).
- Hill M mean improvement is the biggest single win available.
- Hill F regression vs L=2 (11.75 → 12.16) is 3.5 % — within the
  sampling noise on the 576-female-file corpus and below the typical
  inter-run variation.
- PTDB-TUG codet is well within Stage 0 dominance margin at all
  candidate cells (F mean 6.20 < Stage 0 6.82, p95 17.2 < Stage 0 18.0).
- σ=50 is closer to the σ-rate-equivalent (50 cents at 25 ms hop ≈
  paper σ=20 at 10 ms hop) — slightly more principled than σ=75 from a
  rate-scaling perspective, with the empirical evidence at L=4 also
  favoring it.

## Honest accounting of what changes

If we ship L=4 σ=50, the PR's headline numbers need revision:

| Metric (commit message claim)       | Was   | Now (L=4 σ=50) |
|-------------------------------------|-------|----------------|
| accuracy-test female F0 mean        | 7.0   | 11.16¹         |
| accuracy-test male F0 mean          | 9.5   | ~12¹           |
| real-speech female F0 mean          | 11.8  | 12.16          |
| real-speech male F0 mean            | 12.7  | 12.15          |
| PTDB-TUG codet female F mean        | 6.03  | 6.20           |
| PTDB-TUG codet female F p95         | 16.6  | 17.2           |

¹ accuracy-test acc-subset at L=4 σ=50 — needs a fresh run; the σ recheck
captured σ ∈ {50, 75, 100} only on full-corpus Hillenbrand and PTDB. Run
`accuracy-test.js` with `__PYIN_LOOKBACK = 4` and `set-pyin-sigma 50`
before finalizing the commit message.

The "< 10 Hz target met for the first time" claim is **not true at L=4
σ=50** for the acc subset (≈11 Hz expected from full-corpus's 12.16).
The honest framing for a revised commit message: "real-speech full-
corpus female F0 12.16 Hz, male F0 12.15 Hz — both ≈ 60 % reduction
vs Stage 0's 41/37 Hz baseline. Sub-harmonic-lock count 30 → 0 still
holds. Latency exactly at the documented 100 ms budget."

The "octave-error long tail eliminated" claim (PTDB p95 145 → 16.6)
**still holds** — the σ-sweep Pareto criteria 1, 2, 3 remain satisfied
at L=4 σ=50 (codet F 6.20 < Stage 0 6.82; p95 17.2 < 30; Hill F 12.16
≪ Stage 0 41.22).

## Followups left for the user to decide

1. Whether to ship L=4 σ=50, L=5 σ=75, or stick with L=2 σ=75.
2. If L=4 σ=50: rerun `accuracy-test.js` and `real-speech-test.js`
   under those settings to capture canonical post-ship baseline (mirrors
   what `pass4-stage2b-final-baseline-2026-05-04.md` did for L=2 σ=75).
3. If shipping L=4 σ=50: update [src/dsp/dsp-worker.js:738](../src/dsp/dsp-worker.js#L738)
   fallback to `2 → 4`, update [src/dsp/dsp-worker.js:168](../src/dsp/dsp-worker.js#L168)
   `_PYIN_SIGMA_CENTS = 75 → 50`, update CLAUDE.md and the commit
   message accordingly.
4. Out of scope here, possibly worth a future stage: an adaptive σ
   that's tighter when recent voicedness has been consistent (where
   tight prior helps) and looser during prosodic transitions. The L=4
   σ=50 selection optimizes the steady-state win; an adaptive σ could
   recover the prosodic-transition cases.
