# Pitch detection per-bucket baseline (production, 2026-05-06)

**Date:** 2026-05-06
**Branch:** `pitch-test-corpus-expansion`
**Production config:** Stage 2.B pYIN, σ=50 cents, L=4 lookback, α=0.0001 mixture prior — current main.
**Harness:** [tests/dsp/pitch-bucket-harness.js](../tests/dsp/pitch-bucket-harness.js).
**Output:** durable cross-corpus measurement infrastructure baseline. Future fix work measures against this table.

## Corpus coverage

Frame counts per pitch bucket × corpus (voiced ground-truth frames matched
to worker output at 25 ms hops):

|  bucket   | Hillenbrand | PTDB-TUG | vocadito |  FDA |
|---:|---:|---:|---:|---:|
|  < 90     |    0 |    950 |    133 |    183 |
|  90–120   | 2218 |  2479  |  1717  |  1112  |
|  120–150  | 3060 |  1033  |  2790  |   728  |
|  150–180  | 1608 |  1224  |  2403  |   287  |
|  180–220  | 4180 |  2034  |  3868  |   453  |
|  220–280  | 4269 |  1401  |  5722  |  1647  |
|  280–350  |   32 |   210  |  3420  |   501  |
|  > 350    |    0 |     0  |  1530  |     5  |

Hillenbrand has zero coverage of the < 90 Hz and > 350 Hz buckets (steady-
state F0 only, 90 ≤ F0 ≤ 330 Hz across all 1116 men+women samples).
PTDB-TUG provides 950 frames in the < 90 Hz bucket (M01/M02 male speakers);
FDA adds another 183 (RL male). Vocadito covers > 350 with 1530 frames.

## Median F0 error per bucket × corpus (Hz)

|  bucket   | Hillenbrand | PTDB-TUG | vocadito |  FDA |
|---:|---:|---:|---:|---:|
|  < 90     |   —  |  **3.0** |  0.5  |  1.4  |
|  90–120   |  2.6 |  3.2  |  0.4  |  1.3  |
|  120–150  |  3.5 |  4.1  |  0.4  |  1.6  |
|  150–180  |  6.0 |  3.6  |  0.5  |  2.0  |
|  180–220  |  6.6 |  3.9  |  0.6  |  2.8  |
|  220–280  |  6.4 |  4.7  |  0.7  |  3.1  |
|  280–350  | 30.9 |  5.6  |  0.8  |  3.6  |
|  > 350    |   —  |   —   |  1.0  |  7.2  |

**Median is the headline accuracy metric** — it captures the typical-frame
error and is robust to occasional octave-error outliers that drag the
mean. Median errors are reasonable across all corpora and buckets EXCEPT:

- Hillenbrand 280–350 bucket (30.9 Hz median over 32 frames). Small
  sample, dominated by a few high-F0 women's vowels where the algorithm
  systematically picks the wrong octave. Statistical noise plus a
  genuine high-pitch failure mode.
- FDA > 350 bucket (7.2 Hz median over 5 frames). Tiny sample.

Vocadito median errors are remarkably low (0.4–1.0 Hz) across all
buckets — singing tracks have stable harmonic structure that pYIN
follows well. Speech corpora (Hillenbrand, PTDB-TUG, FDA) sit at
2–7 Hz median in the well-covered buckets — production-acceptable.

## Mean F0 error per bucket × corpus (Hz)

|  bucket   | Hillenbrand | PTDB-TUG | vocadito |  FDA |
|---:|---:|---:|---:|---:|
|  < 90     |   —  | **12.9** |  1.5  | **11.6** |
|  90–120   | 24.7 |  6.9  |  0.8  |  6.1  |
|  120–150  | 30.2 |  8.9  |  0.9  |  7.9  |
|  150–180  | 24.9 |  7.9  |  1.6  | 11.1  |
|  180–220  | 22.9 |  7.3  |  2.9  | 10.5  |
|  220–280  | 23.5 |  7.6  |  1.7  |  7.7  |
|  280–350  | 68.4 |  8.2  |  1.3  |  6.0  |
|  > 350    |   —  |   —   |  1.5  | 17.9  |

Mean errors are 4–10× the medians on speech corpora (Hillenbrand,
PTDB-TUG, FDA). The gap is the octave-error contribution: a small
fraction of frames fail dramatically (octave shifts) and pull the mean
up. On vocadito the gap is 2–3× — much smaller, consistent with its
much lower octave-error rate.

## Octave-error rate per bucket × corpus

|  bucket   | Hillenbrand | PTDB-TUG | vocadito |  FDA |
|---:|---:|---:|---:|---:|
|  < 90     |   —   |  **2.3%**  |  0.0% |  **2.7%**  |
|  90–120   |  3.2% |  0.2%  |  0.1% |  0.6%  |
|  120–150  |  4.0% |  0.4%  |  0.1% |  0.4%  |
|  150–180  |  2.3% |  1.1%  |  0.6% |  0.7%  |
|  180–220  |  2.4% |  0.3%  |  1.9% |  0.2%  |
|  220–280  |  3.3% |  0.1%  |  0.3% |  0.7%  |
|  280–350  |  3.1% |  0.0%  |  0.1% |  0.2%  |
|  > 350    |   —   |   —    |  0.1% |  0.0%  |

(Octave error = worker / truth ratio within 5 % of an integer ≥ 2,
super-octave or sub-octave. Captures the harmonic-confusion failure
mode the user observed against Voice Tools at sustained 80 Hz monotone.)

**The < 90 Hz bucket reproduces the user's reported failure regime in
both speech corpora.** PTDB-TUG: 22 octave errors / 950 frames (2.3%).
FDA: 5 octave errors / 183 frames (2.7%). Vocadito has 0% sub-90-Hz
octave errors over 133 frames — singing tracks the algorithm cleanly,
so the failure is **speech-specific** (rich harmonic structure of
glottal-pulse-driven voice, not present in cleaner singing tone).

Hillenbrand octave-error rates of 2.3–4.0% across mid-range buckets
(150–280 Hz) suggest a baseline-rate of ~3% octave confusion exists
even in the algorithm's "good range." This is consistent with the σ=50
transition prior plus α=0.0001 mixture giving cross-octave transitions
a non-zero probability that occasionally flips the Viterbi MAP into a
wrong-octave state.

## Max F0 error per bucket × corpus (Hz)

|  bucket   | Hillenbrand | PTDB-TUG | vocadito |  FDA |
|---:|---:|---:|---:|---:|
|  < 90     |   —  | 508.1 |  16.7 | 372.8 |
|  90–120   | 487.9| 488.5 | 119.4 | 497.1 |
|  120–150  | 471.7| 443.1 | 163.6 | 341.9 |
|  150–180  | 436.7| 398.9 | 316.9 | 394.8 |
|  180–220  | 409.7| 384.1 | 237.2 | 341.8 |
|  220–280  | 364.7| 315.4 | 345.3 | 301.1 |
|  280–350  | 306.7| 206.9 | 149.6 | 146.0 |
|  > 350    |   —  |   —   | 175.5 |  60.0 |

The max errors at 300–500 Hz across all speech corpora and most buckets
correspond to single frames where the worker reported pitch close to
the algorithm's high-end (~600 Hz fmax) when truth was ~100–200 Hz.
These are 3×–5× harmonic confusions, not 2×. Vocadito's max errors
are notably smaller (16.7 Hz in <90 bucket; 119–345 Hz across most
mid buckets) — singing tracks rarely produce these large excursions.

## Per-track outliers worth flagging

Tracks with mean F0 error ≥ 10 Hz on ≥ 30 voiced frames:

**vocadito**:
- `vocadito_34` (singer S27, refMedian 222 Hz): mean 11.59 Hz, **76 octave errors out of 729 frames (10.4%)**. Concretely hard track — flagged in Step 1; baseline confirms it.

**FDA**:
- `sb030` (F): mean 28.55 Hz on 69 frames
- `rl022` (M): mean 27.12 Hz on 32 frames (low-pitch, 2 octave errors)
- `sb024` (F): mean 24.82 Hz on 37 frames
- `rl033` (M): mean 23.77 Hz on 42 frames

**PTDB-TUG**:
- `mic_M02_sx71` (M): mean 41.88 Hz on 49 frames (3 octave errors)
- `mic_F01_sx21` (F): mean 39.91 Hz on 37 frames (2 octave errors)
- `mic_M01_sx31` (M): mean 29.16 Hz on 55 frames (0 octave errors — non-octave failure mode, possibly formant confusion or period-doubling)
- 12 more tracks with mean 14–24 Hz

The full per-track outlier list (top 15 per corpus) is in the harness's
JSON output and stdout.

## Implications for fix work

1. **Sub-90 Hz speech is a real concrete failure regime.** PTDB-TUG and
   FDA both reproduce the user's observed Voice-Tools-vs-Syrinx
   discrepancy. Any fix targeting low-pitch should drive the < 90 Hz
   octave-error rate from 2.3–2.7 % toward < 0.5 % without regressing
   median error in the well-covered mid buckets.

2. **The high-pitch end (> 280 Hz) has thinner coverage in speech
   corpora** but vocadito covers it well. If a fix touches state-space
   bounds, vocadito's > 280 Hz buckets are the regression check.

3. **Vocadito track 34 is the canary for "non-octave failure modes."**
   10.4 % octave-error rate on 729 frames means even the best-of-class
   corpus produces dramatic per-track failures. Worth investigating
   independently as a Step-3-of-future-fix-work concrete reproducer.

4. **Mid-range (120–280 Hz) octave-error rates of 2.3–4.0 % on
   Hillenbrand** are higher than expected. The α=0.0001 mixture prior
   was tuned to bound *recovery* time after wrong-octave lock; it may
   be admitting too many spurious cross-octave transitions in the
   process. Worth investigating whether tightening α (e.g., to
   0.00001) preserves recovery while reducing false-positive flips.

5. **Median errors are the right headline metric.** Mean errors mix
   typical-frame accuracy with outlier-frequency, which makes them
   ambiguous as a tuning target. For future fix work: optimize for
   per-bucket median ≤ 5 Hz across all populated buckets, with octave-
   error rate ≤ 1 % in the < 90 and > 280 buckets specifically.

## Reproducibility

```bash
bash scripts/fetch-ptdb-tug-subset.sh    # ~140 MB, fetch-on-demand
bash scripts/fetch-fda-subset.sh         # ~14 MB,  fetch-on-demand
node tests/dsp/pitch-bucket-harness.js   # ~85 s wall time, 1436 tracks
```

Hillenbrand and vocadito are committed in-repo; no fetch needed for
those. The harness exits 0 with a SKIP message if no corpus is
present.
