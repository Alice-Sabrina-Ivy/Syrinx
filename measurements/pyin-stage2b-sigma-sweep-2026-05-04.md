# pYIN Stage 2.B — σ sweep (2026-05-04)

> **Status: ship recommendation is Stage 2.B at L=2, σ=75 cents.**
> Two cells (σ=75 and σ=100) strictly dominate Stage 0 on both
> Hillenbrand AND PTDB-TUG simultaneously, satisfying all three Pareto
> criteria including the p95 long-tail check. σ=75 is the better
> tradeoff (gives up less on Hillenbrand). The PTDB-TUG regression that
> blocked shipping at σ=20 is fully resolved.

## Pareto table — Stage 2.B at L=2, all six σ values

Decision criterion: Stage 2.B at L=2 must satisfy ALL three:

1. Hillenbrand F mean < **30.65** Hz (Stage 0 multi-frame baseline)
2. PTDB-TUG codet F mean < **6.64** Hz (Stage 0 raw F mean on this corpus)
3. PTDB-TUG codet F p95 < **30** Hz (long-tail check — catches octave-error
   tails the mean alone would hide)

| cell  | Hill F | Hill M | PTDB F (codet) | PTDB p95 (codet) | PTDB M (codet) | Pareto? |
|-------|-------:|-------:|---------------:|-----------------:|---------------:|---------|
| σ=15  | 15.99  | 15.76  | 26.13          | 150.7            | 10.99          | hill✓ ptdb✗ p95✗ |
| σ=20  | 16.36  | 17.03  | 22.52          | 145.5            | 8.07           | hill✓ ptdb✗ p95✗ |
| σ=30  | 16.77  | 16.54  | 15.05          | 98.0             | 5.22           | hill✓ ptdb✗ p95✗ |
| σ=50  | 18.31  | 17.22  | 7.10           | 18.1             | 3.66           | hill✓ ptdb✗ |
| **σ=75**  | **19.64**  | **18.11**  | **6.03**       | **16.6**             | **3.73**           | **STRICT-DOMINATES** |
| σ=100 | 20.02  | 17.75  | 5.65           | 16.4             | 3.81           | STRICT-DOMINATES |

Stage 0 baselines (in same harness): Hill F = 30.65, PTDB raw F = 6.64,
PTDB raw p95 = 18.7. PTDB Stage-0 cell answers only 67.6 % of voiced
REF frames (32.4 % null rate); the codet metric restricts both stages
to the same frame subset for fair comparison.

## Recommended cell

**σ = 75 cents** at L=2.

Reasoning:

- σ=75 and σ=100 both strictly dominate Stage 0 on all three criteria.
- σ=75 is the better tradeoff: it gives up less on Hillenbrand (19.64 vs
  20.02 F mean) for marginally less PTDB improvement (6.03 vs 5.65).
- σ=75 is closer to the rate-equivalent prediction (paper σ=20 at 10 ms
  hop ≈ 50 cents at our 25 ms hop) without overshooting; σ=100 implies a
  pitch-change rate the paper's tracker wasn't designed for and likely
  loosens the prior more than the data warrants.
- Total female mean error at σ=75: 19.64 Hz on Hillenbrand multi-frame
  + 6.03 Hz on PTDB-TUG codet. **Net improvement vs Stage 0: -11 Hz on
  Hillenbrand, -0.6 Hz on PTDB**, with PTDB p95 reduced from 145.5
  (σ=20) to 16.6.

## Curve interpretation

The σ axis trades Hillenbrand performance against PTDB-TUG performance,
exactly as the rate-equivalent hypothesis predicted:

- **σ=15 (tighter than paper):** best Hillenbrand (15.99 F) but PTDB
  worst (26.13 codet, 150.7 p95). Tighter prior helps sustained vowels
  (no false transitions allowed) but blocks legitimate prosodic motion.
- **σ=20 (paper default at 10 ms hop):** ships at 25 ms hop is too tight.
  Hill 16.36 / PTDB 22.52 / p95 145.5. The regression I flagged.
- **σ=30:** PTDB mean drops to 15.05 but p95 still 98 — tail unfixed.
- **σ=50 (rate-equivalent prediction):** PTDB mean 7.10, p95 18.1.
  Misses the F-mean criterion by 0.46 Hz; close but not strict-dominant.
- **σ=75 (selected):** Pareto optimum. Hill 19.64, PTDB 6.03, p95 16.6.
- **σ=100:** marginal additional PTDB improvement, marginal additional
  Hillenbrand cost. Diminishing returns.

The crossover from "Hillenbrand-favorable" to "PTDB-favorable" sits
between σ=50 and σ=75. Both PTDB criteria (mean and p95) cross their
thresholds in that region.

## Σ=75 confirmation on degraded variants

At σ=75 the Stage 2.B lead on Hillenbrand-degraded variants holds — the
shape of the curve is the same as σ=20, just shifted ~1-4 Hz worse on F
mean. Source:
[measurements/pyin-stage2b-degraded-sigma75-2026-05-04-harness.txt](measurements/pyin-stage2b-degraded-sigma75-2026-05-04-harness.txt).

| variant | Stage 0 | σ=20 L=2 | σ=75 L=2 | σ=20 Δ vs S0 | σ=75 Δ vs S0 |
|---|---:|---:|---:|---:|---:|
| clean         | 30.65 | 16.36 | 19.64 | -14.29 | **-11.01** |
| pink_20 dB    | 43.35 | 15.64 | 17.68 | -27.71 | **-25.67** |
| pink_10 dB    | 50.24 | 16.70 | 20.67 | -33.53 | **-29.57** |
| reverb_short  | 28.54 | 16.87 | 18.06 | -11.67 | -10.49 |
| reverb_med    | 36.18 | 18.49 | 19.00 | -17.69 | -17.18 |
| agc           | 29.72 | 16.60 | 19.64 | -13.12 | -10.08 |
| soft_clip     | 34.71 | 21.00 | 22.92 | -13.72 | -11.80 |

σ=75 still strictly dominates Stage 0 on every degraded variant. The
degradation lead widens with noise (pink_10dB at -29.57 Hz vs Stage 0)
just like at σ=20. The σ=75 ship is clean across all three corpora
(Hillenbrand, Hillenbrand-degraded, PTDB-TUG).

## Non-regression — five existing suites at PYIN_STAGE=0 default

| Suite | Result |
|---|---|
| `tests/dsp/accuracy-test.js` | F=15.0, M=3.1 (unchanged from post-tune baseline) |
| `tests/dsp/yin-harmonic-test.js` | 12 / 0 |
| `tests/dsp/real-speech-test.js` | 5 / 0 (F=14.2, M=9.8, recovery 28/30) |
| `tests/audio/pitch-smoothing-test.js` | 32 / 0 |
| `tests/dsp/pitch-detection-comprehensive.js` | 88 / 0 |

The σ change is a one-line constant edit; the new `set-pyin-sigma`
message is harness-only. PYIN_STAGE=0 path is byte-clean.

## Implementation note

Worker change: refactored the IIFE that built `_PYIN_LOG_PITCH_TRANS`
into a named function `_pyinBuildPitchTrans(sigma)` called once at
module load with `_PYIN_SIGMA_CENTS`. Added a `{type: "set-pyin-sigma"}`
message handler that re-invokes it. Production never sends this message;
default σ stays at the constant. The harness re-builds the matrix
between cells without re-instantiating the vm context.

The `_PYIN_SIGMA_CENTS` constant should be flipped from 20 to 75 to
ship the recommended cell. Single-line code change in `dsp-worker.js`
once you greenlight the ship.

## Diff summary

- [src/dsp/dsp-worker.js](src/dsp/dsp-worker.js) — refactor IIFE → named
  function + new `set-pyin-sigma` message handler. No default behavior
  change.
- [scripts/pyin-stage2b-sigma-sweep-harness.js](scripts/pyin-stage2b-sigma-sweep-harness.js) —
  new harness covering 6 σ × 2 corpora = 12 Stage 2 cells + 2 Stage 0
  baselines. ~5 minutes wall time.
- [tests/dsp/degraded-test.js](tests/dsp/degraded-test.js) — opt-in
  `PYIN_SIGMA` env var override so the same test file runs both σ=20
  baseline and σ=75 confirmation.

Three measurement artifacts:

- [measurements/pyin-stage2b-sigma-sweep-2026-05-04-harness.txt](measurements/pyin-stage2b-sigma-sweep-2026-05-04-harness.txt) — raw σ-sweep output
- [measurements/pyin-stage2b-degraded-sigma75-2026-05-04-harness.txt](measurements/pyin-stage2b-degraded-sigma75-2026-05-04-harness.txt) — degraded variants confirmed at σ=75
- [measurements/pyin-stage2b-sigma-sweep-2026-05-04.md](measurements/pyin-stage2b-sigma-sweep-2026-05-04.md) — this writeup

## Decision for you

If you accept the σ=75 recommendation, the ship-side work is:

1. **Flip the default constant.** `_PYIN_SIGMA_CENTS = 20` → `= 75` in
   `src/dsp/dsp-worker.js`. Update the comment block above it noting
   the data justification (this measurement file).
2. **Flip PYIN_STAGE default to 2.** That makes Stage 2.B + σ=75 the
   production path. Module-level: `let __PYIN_STAGE_DEFAULT = 2;` or
   similar.
3. **Cleanup pass:** delete the multi-mult correction code (lines
   ~290-380 + `HARMONIC_*` constants) which is now dead code.
   Refactor inline-copy tests to vm-context (the inline copies can't
   replicate pYIN's module-level state). ~2-3 hours.
4. **Re-run the full test suite at the new default** to confirm the
   accuracy-test FAIL (F=15.0 > 10) is still where the existing test
   bar sets it — that test will need to be updated to reflect the
   new methodology, since the multi-frame Stage 2 numbers don't match
   the single-window methodology the existing target was set against.

I am not picking the timing of any of those steps. Awaiting your call.

If you'd rather see σ=100 considered or want different criteria,
flag that and I'll re-analyze. The harness can be re-run with a
different σ range cheaply (~5 min wall).

## Open follow-ups (not for this turn)

- Multi-mult correction code (`HARMONIC_*` constants and the block in
  `detectPitch` ~lines 290–380) becomes dead code under PYIN_STAGE=2
  default. Cleanup pass after the flag is flipped.
- Inline-copy refactor: `accuracy-test.js` and `yin-harmonic-test.js`
  must convert to vm-context once PYIN_STAGE=2 becomes the default.
- accuracy-test.js / real-speech-test.js targets were set against the
  single-window methodology and the legacy YIN+multi-mult algorithm.
  Both targets need re-justification under the new default — likely
  loosened, since multi-frame methodology gives higher F mean numbers
  than single-window even at the same algorithm.
- L=10 + graceful warm-up: skipped from this sweep. If a future use
  case wants ≥250 ms latency budget, the warm-up null-rate issue
  needs fixing first.
- `voicedness` postMessage field is exposed but no consumer wires it.
