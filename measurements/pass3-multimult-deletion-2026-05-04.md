# Pass 3: multi-mult dead-code deletion (2026-05-04)

> **Status: pass 3 complete.** The multi-mult harmonic correction block
> and its `HARMONIC_*` constants have been deleted from
> `src/dsp/dsp-worker.js`. Pass-2 vs pass-3 diff confirms the change was
> a strict dead-code removal under PYIN_STAGE=2 default — every test
> suite produces byte-identical output to pass 2 except for one
> microsecond-level wall-clock measurement in the perf test (which is
> normal run-to-run variation, well below the assertion threshold).

## Pass 2 → pass 3 diff

| Suite | Diff |
|---|---|
| `tests/dsp/yin-harmonic-test.js` | identical |
| `tests/audio/pitch-smoothing-test.js` | identical |
| `tests/dsp/pitch-detection-comprehensive.js` | one line: `[14]` perf test wall-time (0.832 → 0.991 ms; assertion `< 5 ms` still passes) |
| `tests/dsp/accuracy-test.js` | identical |
| `tests/dsp/real-speech-test.js` | identical |

This is the verification we wanted: PYIN_STAGE=2 default does not enter
the multi-mult block at all, so removing the block changes no measured
output. If anything had drifted, that would have meant the multi-mult
was firing under PYIN_STAGE=2 (it isn't), or PYIN_STAGE=0 was somehow
being entered (it isn't).

## What's gone

[src/dsp/dsp-worker.js](src/dsp/dsp-worker.js):
- Multi-mult correction block (~75 lines): the `for (let mult = 2; mult <= maxMult; mult++)` loop with its candidate-search-and-acceptance
  logic
- `HARMONIC_IMPROVEMENT_MIN = 0.010` constant
- `HARMONIC_RELATIVE_K2 = 0.5` constant
- The 35-line block of comment explaining the multi-mult acceptance
  criteria, replaced with a 6-line block noting the deletion and what
  PYIN_STAGE=0 means now

Updated stage-gate comments at the top of the file and at the dispatch
site to reflect the new stage definitions:
- 0 = vanilla YIN (first-below-threshold + parabolic interpolation, no
  octave correction)
- 1 = pYIN step 1 (Beta-threshold integration + naive argmax)
- 2 = pYIN Stage 2.B (production: HMM + bounded-history Viterbi, σ=75)

## What's NOT gone (intentionally)

The PYIN_STAGE=0 dispatch path is preserved — it now falls through to
vanilla YIN (first-below-threshold + parabolic interp). That's still a
useful baseline reference for any future algorithm comparison. The
historical "legacy YIN + multi-mult" Stage 0 is no longer reproducible
without reverting this commit, which is the right tradeoff: keeping a
useful baseline costs nothing, and the legacy multi-mult heuristic was
itself a workaround for what the HMM now does properly.

## What this breaks (acknowledged but unaddressed)

`scripts/tune-harmonic-gates.js` (the original σ-sweep harness from
before the σ-rate-scaling investigation) text-substitutes the deleted
constants. If run, it will throw a clear error from its sanity-check
("failed to find HARMONIC_IMPROVEMENT_MIN in worker source"). This
script was the artifact that produced the 0.003 → 0.010 sweep result
months ago; it's obsolete now. **Not deleted in this pass** — that's
script-cleanup territory beyond the dsp-worker dead-code-removal scope.
A future cleanup pass can delete the script if it's confirmed unused.

`scripts/pyin-stage1-harness.js` and `scripts/pyin-stage2-harness.js`
have label strings like "Stage 0 (legacy YIN + multi-mult)". After
deletion the label is technically inaccurate. These scripts still RUN
correctly (they just label the Stage 0 cell with stale prose). Cosmetic
only; not addressed in this pass.

## Per-suite output files

- [measurements/pass3/yin-harmonic.txt](measurements/pass3/yin-harmonic.txt) — 12/0
- [measurements/pass3/smoothing.txt](measurements/pass3/smoothing.txt) — 32/0
- [measurements/pass3/comprehensive.txt](measurements/pass3/comprehensive.txt) — 77/8
- [measurements/pass3/accuracy.txt](measurements/pass3/accuracy.txt) — F=7.0/9.5
- [measurements/pass3/real-speech.txt](measurements/pass3/real-speech.txt) — 5/0

## Pass-3 status

✓ HARMONIC_* references confirmed absent from production code outside
  dsp-worker.js (grep over `src/`, `tests/`, `scripts/`)
✓ Multi-mult block deleted (~75 lines), HARMONIC_* constants deleted
✓ All 5 suites produce byte-identical output to pass 2 (except wall-time
  perf measurement)
✓ Multi-mult confirmed dead code under PYIN_STAGE=2 default

**Proceeding directly to pass 4** (test target re-justification) per
prior auto-greenlight on pass-3-success.
