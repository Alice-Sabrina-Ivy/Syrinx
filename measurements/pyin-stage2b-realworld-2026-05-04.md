# pYIN Stage 2.B — corpus expansion (2026-05-04)

> **Status: ship decision is NO-SHIP at current settings.**
> Stage 2.B holds or widens its lead on Hillenbrand (clean and noisy)
> but **regresses significantly on PTDB-TUG real-world recordings**,
> with a +15.9 Hz F0 mean error increase even under the fair
> production-equivalent co-detected comparison. Per your stated rule
> ("no-ship if Stage 2.B regresses anywhere significant"), this triggers
> the no-ship branch. The data points to a specific cause and a clear
> follow-up — see "Recommendation" below.

## TL;DR

| Corpus | Stage 0 F mean | Stage 2 L=2 F mean | Stage 2 L=5 F mean | Verdict |
|---|---:|---:|---:|---|
| Hillenbrand clean | 30.65 | 16.36 | 11.97 | Stage 2 wins big |
| Hillenbrand + pink_10dB SNR | 50.24 | 16.70 | 12.28 | Stage 2 wins bigger |
| Hillenbrand + reverb_med | 36.18 | 18.49 | 14.99 | Stage 2 wins |
| Hillenbrand + soft_clip | 34.71 | 21.00 | 16.79 | Stage 2 wins |
| **PTDB-TUG (co-detected)** | **6.64** | **22.52** | **15.15** | **Stage 2 LOSES** |

The Hillenbrand-style results are cohesive: sustained vowels with various
distortions, Stage 2.B's HMM smoothing dominates. PTDB-TUG breaks the
pattern — connected speech with rapid prosodic pitch changes is a
fundamentally different regime, and the HMM's transition prior (σ=20 cents,
paper default) is too strict at our 25 ms hop to keep up.

## Methodology divergences vs prior measurements

This file does NOT use the historical accuracy-test.js single-window
methodology. All results are from multi-frame stepping (25 ms hops over
central 70 % for Hillenbrand; full-file frame-by-frame contour matching
for PTDB-TUG) with apples-to-apples Stage 0 baselines computed in the
same harness. Reading guide:

- "Stage 0 = 30.65 Hz on clean Hillenbrand" looks worse than the prior
  baselines (15.0 in accuracy-test, 14.2 in real-speech-test Pass 1).
  Those used a single-window-from-the-middle methodology that throws
  away most of the recording. Multi-frame stepping is what production
  actually does and is the more honest comparison.
- All Stage 2.B numbers in this file are MULTI-FRAME numbers comparable
  apples-to-apples to the Stage 0 column right next to them.
- PTDB-TUG's "co-detected" subset restricts both stages to frames where
  Stage 0 returned non-null. Production downstream has an intensity-based
  silence gate that would mask Stage 0's null frames anyway, so charging
  Stage 2 for errors on those frames over-penalizes vs what the user
  would actually see.

## Corpus 1: Hillenbrand + synthetic degradations

Variants generated in-memory at test time (no on-disk WAVs). Deterministic
seeds keyed off variant + file index. IRs synthesized in code (no external
freesound dependencies). Source:
[tests/dsp/degraded-test.js](tests/dsp/degraded-test.js).

### F mean by stage (Hz)

| variant | Stage 0 | Stage 2 L=2 | Stage 2 L=5 | Δ L=2 | Δ L=5 |
|---|---:|---:|---:|---:|---:|
| clean         | 30.65 | 16.36 | 11.97 | -14.29 | -18.69 |
| pink_40 dB    | 30.60 | 16.35 | 11.97 | -14.24 | -18.63 |
| pink_20 dB    | 43.35 | 15.64 | 11.24 | **-27.71** | **-32.11** |
| pink_10 dB    | 50.24 | 16.70 | 12.28 | **-33.53** | **-37.96** |
| reverb_short  | 28.54 | 16.87 | 12.57 | -11.67 | -15.98 |
| reverb_med    | 36.18 | 18.49 | 14.99 | -17.69 | -21.19 |
| agc           | 29.72 | 16.60 | 12.25 | -13.12 | -17.47 |
| soft_clip     | 34.71 | 21.00 | 16.79 | -13.72 | -17.92 |

### M mean by stage (Hz)

| variant | Stage 0 | Stage 2 L=2 | Stage 2 L=5 | Δ L=2 | Δ L=5 |
|---|---:|---:|---:|---:|---:|
| clean         | 26.16 | 17.03 | 13.28 |  -9.13 | -12.87 |
| pink_40 dB    | 26.15 | 17.00 | 13.28 |  -9.15 | -12.87 |
| pink_20 dB    | 32.18 | 16.88 | 13.14 | -15.30 | -19.04 |
| pink_10 dB    | 30.15 | 19.11 | 15.61 | -11.05 | -14.54 |
| reverb_short  | 41.53 | 24.31 | 20.84 | -17.21 | -20.69 |
| reverb_med    | 32.57 | 19.28 | 16.49 | -13.28 | -16.08 |
| agc           | 26.18 | 16.28 | 12.50 |  -9.90 | -13.68 |
| soft_clip     | 29.83 | 26.00 | 22.78 |  -3.83 |  -7.05 |

### Reading the degradation results

- **Pink noise widens Stage 2.B's lead.** At 10 dB SNR the lead grows to
  −33.5 Hz — Stage 0 degrades to 50.24, Stage 2 stays near 16.7. The HMM
  averages away the per-frame noise the legacy YIN can't. This is the
  designed-for outcome.
- **Reverb hurts both stages.** Stage 2.B still leads by 12-22 Hz.
- **Soft clipping** is Stage 2.B's relative weak point on M side
  (-3.83 Hz lead at L=2). Hard nonlinearity introduces harmonics that
  confuse the candidate distribution.
- **AGC modulation is essentially neutral** vs clean — slow gain changes
  don't disturb per-frame CMND.
- **Zero null rate across all 24 cells.** Recall is preserved.

This corpus alone supports shipping Stage 2.B at L=2.

## Corpus 2: PTDB-TUG real-world recordings

`tests/dsp/ptdb-tug-test.js` runs **frame-by-frame contour matching**
on a 4-speaker × 45-SX-sentence subset (180 files, ~117 MB) of the
PTDB-TUG corpus. REF .f0 files give ground-truth F0 every 10 ms (col 1
= Hz, col 2 = voicing flag). Per worker call: align attribution time
accounting for Stage 2's L-frame lookback, look up REF, skip unvoiced
frames, accumulate |worker − ref|. Source:
[tests/dsp/ptdb-tug-test.js](tests/dsp/ptdb-tug-test.js); fetch script
in [scripts/fetch-ptdb-tug-subset.sh](scripts/fetch-ptdb-tug-subset.sh).

### Per-frame results (raw, all stages cover all REF-voiced frames)

| Cell | F mean | F median | F p95 | M mean | M median | M p95 | null rate |
|---|---:|---:|---:|---:|---:|---:|---:|
| Stage 0 | 6.64 | 3.53 | 18.71 | 3.84 | 2.39 | 11.26 | **32.4 %** |
| Stage 2 L=2 | 27.52 | 4.71 | 157.16 | 11.86 | 3.46 | 46.65 | 0 % |
| Stage 2 L=5 | 19.28 | 4.34 | 118.81 | 9.48 | 3.27 | 36.50 | 0 % |

The raw comparison is apples-to-oranges — Stage 0 is excluded on 32.4 %
of voiced REF frames (the hard ones), while Stage 2 covers all of them.

### Per-frame results (co-detected: only frames where Stage 0 also returned)

This is the production-equivalent comparison. Stage 0's null frames
would be silence-gated downstream, so charging Stage 2 for errors on
those frames isn't fair. Restricted to frames where both stages produced
a reading:

| Cell | F mean | F median | F p95 | M mean | M median | M p95 | Δ F vs S0 |
|---|---:|---:|---:|---:|---:|---:|---:|
| Stage 0 | 6.64 | 3.53 | 18.71 | 3.84 | 2.39 | 11.26 | — |
| Stage 2 L=2 | **22.52** | 4.10 | **145.50** | 8.07 | 2.51 | 37.69 | **+15.89** |
| Stage 2 L=5 | **15.15** | 3.83 | 92.37 | 6.34 | 2.48 | 25.82 | **+8.51** |

### Reading the PTDB-TUG result

The headline (mean) numbers say Stage 2 loses badly. The medians say
they're roughly equivalent on typical frames. The p95 values say
**Stage 2 has a long tail of large errors that Stage 0 doesn't**:

- Stage 0 F p95 = 18.71 Hz (5 % of frames have errors ≤ 19 Hz)
- Stage 2 L=2 F p95 = 145.50 Hz (5 % of frames have errors ≥ 145 Hz)

That's a factor of 8 on the upper-tail. Those large errors are most
likely octave errors during fast pitch transitions — moments where the
HMM's σ=20 cents transition prior under-predicts the actual pitch
movement and the Viterbi path locks on a wrong octave for several frames
before the obs likelihood pulls it back.

### Why PTDB-TUG breaks the pattern Hillenbrand established

Hillenbrand recordings are sustained vowels — pitch is essentially
constant within a recording. The HMM's strict σ=20 cents transition
prior matches that data perfectly: pitch should change slowly, and
Hillenbrand pitch barely changes at all.

PTDB-TUG SX sentences are connected speech — pitch moves continuously
through prosodic intonation, syllable boundaries, voiced-consonant
transitions. The natural rate of pitch change in conversational speech
is several octaves per second at peaks. Even average rates of ~50–100
cents per 25 ms hop are common during transitions.

σ=20 cents allows ~40 cents per frame within 95 % confidence. **The HMM
literally cannot keep up** with natural prosodic pitch movement at
σ=20. When pitch jumps faster than σ allows, the Viterbi path takes the
"least bad" available transition, which can land on a sub-harmonic or
2× harmonic that's closer in cents distance — producing the octave-
error tail visible in the p95.

This is exactly what I flagged at Stage 2 design time:

> "σ=20 cents in the paper assumes ~10 ms frame interval; we run at
> 25 ms (matches production). So 20 cents at 25 ms is *tighter* than the
> paper's 20 cents at 10 ms — fewer cents per ms allowed change. Strict
> reading of your instruction: keep σ=20, see what happens, report. I
> will not silently scale."

The data is now speaking. σ=20 at 25 ms hop is too strict for connected
speech.

### Quantitative argument for σ adjustment

Paper's σ=20 cents at 10 ms hop = 2 cents/ms allowed pitch change rate.
At 25 ms hop, the equivalent rate would be σ=50 cents (still 2 cents/ms).

A σ sweep over {30, 50, 75, 100} cents on PTDB-TUG would directly test
this hypothesis. Doing it now is "tuning" — explicitly off-limits per
your standing instruction. **The data justifies it as a follow-up**.

## Non-regression — five existing suites at PYIN_STAGE=0 default

| Suite | Result |
|---|---|
| `tests/dsp/accuracy-test.js` | F=15.0, M=3.1 (unchanged from post-tune baseline) |
| `tests/dsp/yin-harmonic-test.js` | 12 / 0 |
| `tests/dsp/real-speech-test.js` | 5 / 0 (F=14.2, M=9.8, recovery 28/30) |
| `tests/audio/pitch-smoothing-test.js` | 32 / 0 |
| `tests/dsp/pitch-detection-comprehensive.js` | 88 / 0 |

PYIN_STAGE=0 path is byte-clean. Nothing in production behavior changes
until the flag is flipped, which it isn't.

## Recommendation

**No-ship at current σ=20 cents.** Per your stated decision rule,
"no-ship if Stage 2.B regresses anywhere significant" applies. The
PTDB-TUG regression is significant: +15.9 Hz F mean error in the
fair co-detected comparison, with p95 7-8x worse. Production users
producing prosodic speech (which voice-training users do, even on
sustained vowels — pitch micro-variations matter) will see this.

**Two real follow-up paths**, in order of effort:

1. **σ sweep on PTDB-TUG.** Test σ ∈ {30, 50, 75, 100} cents while
   keeping all other parameters fixed. Expected outcome: σ ≈ 50 cents
   (rate-equivalent to paper's σ=20 at 10 ms) restores Stage 2 lead on
   PTDB-TUG without disturbing Hillenbrand. ~2 hours to harness, sweep,
   and report. Justified directly by this measurement file.

2. **If σ sweep doesn't fix it:** the HMM's structural assumption
   (slow pitch change between frames) may not hold for our data. Could
   investigate per-frame-adaptive σ (looser when voicedness is high,
   tighter when low) or a different decoder (online median-based pitch
   tracker without HMM). Speculative; only justified if (1) fails.

If the σ sweep finds a setting that maintains Hillenbrand performance
and fixes PTDB-TUG without regression elsewhere, **ship Stage 2.B with
that σ at L=2**. If not, ship Stage 2.B with σ=20 anyway is **wrong**
— production users would see the PTDB-TUG-style errors.

The Hillenbrand sustained-vowel benefits are real (Stage 2.B's lead at
−14 Hz on clean and −33 Hz at 10 dB pink SNR) but only if connected-
speech regression can be addressed.

## Open follow-ups (not for this turn)

- σ sweep harness — see "Recommendation" above. Most natural next step.
- L=10 + graceful warm-up: skipped per ship-decision scoping. If a
  future use case wants ≥250 ms latency budget, the warm-up null-rate
  issue (18 % of male files at L=10) needs fixing first via per-frame
  current-argmax during warm-up.
- Inline-copy refactor: `accuracy-test.js` and `yin-harmonic-test.js`
  must convert to vm-context once PYIN_STAGE=2 becomes the default
  (pYIN's module-level state can't be replicated in inline copies).
  Known follow-up; ~2 hours.
- Multi-mult correction code (`HARMONIC_*` constants and lines 290–380)
  becomes dead code under PYIN_STAGE=2 default; cleanup pass after the
  flag is flipped (which is now blocked on σ sweep success).
- `voicedness` is on the postMessage protocol but unused. Consumer wiring
  is a separate UI/smoother task.
- PTDB-TUG corpus is downloaded (180 files, 117 MB) but gitignored. The
  fetch script handles re-population. The full 3.9 GB upstream archive
  is overkill — the 4-speaker subset gives ~9300 voiced REF frames per
  cell, well-powered for the comparisons here.

## Files

- [tests/dsp/degraded-test.js](tests/dsp/degraded-test.js) — synthetic
  degradation harness (in-memory variants, no on-disk WAVs)
- [tests/dsp/ptdb-tug-test.js](tests/dsp/ptdb-tug-test.js) — PTDB-TUG
  frame-by-frame contour matching with co-detected fair comparison
- [scripts/fetch-ptdb-tug-subset.sh](scripts/fetch-ptdb-tug-subset.sh) —
  downloads the SX subset with per-speaker SX index ranges
- [tests/dsp/data/ptdb-tug/README.md](tests/dsp/data/ptdb-tug/README.md)
  — corpus structure, REF format, license, citation
- [tests/dsp/data/ptdb-tug/.gitignore](tests/dsp/data/ptdb-tug/.gitignore)
  — audio + .f0 are gitignored
- [measurements/pyin-stage2b-degraded-2026-05-04-harness.txt](measurements/pyin-stage2b-degraded-2026-05-04-harness.txt) —
  raw degraded harness output
- [measurements/pyin-stage2b-ptdb-2026-05-04-harness.txt](measurements/pyin-stage2b-ptdb-2026-05-04-harness.txt) —
  raw PTDB-TUG harness output
