# Pitch-detector benchmark: Syrinx vs Praat, pYIN, PENN, CREPE, SwiftF0 — 2026-10-04

**Question (user, 2026-10-04):** "Did the improvements match or exceed the
accuracy of other systems people have made for detecting pitch?"

## Verdict

**Against classic DSP trackers, yes. Against modern neural trackers run
offline, no on clean lab speech. Syrinx gets there causally, at about 90 ms
latency, using 2 % of one CPU core, in a browser.**

All numbers are worker-posted pitch, ±5 % correct, best time offset per
detector.

**What "Syrinx-new" is.** The branch src at 39bd0ff (the five 2026-10-03
workstreams, = the session oracle's `disp` runs). Two later commits on the
branch are not in it: the notch held-note follow-up (6f8be18: committed
oracles unchanged, vocadito +0.0–0.2 pp;
[noise-notch-held-note-robustness-2026-10-04.md](noise-notch-held-note-robustness-2026-10-04.md))
and the paint-gate post-accept fix (36985d4: worker output identical, display
≤ 0.2 pp; [pitch-display-gate-redesign-2026-10-03.md](pitch-display-gate-redesign-2026-10-03.md)
§2026-10-04). Neither moves any conclusion here. Scripts:
[scripts/pitch-benchmark/](../scripts/pitch-benchmark/README.md).

- **Clean lab speech, ground truth (FDA / PTDB-TUG).**
  - Syrinx-new scores 87.1 / 89.4.
  - Praat AC (the tool most voice work uses) scores 88.3 / 88.0, Praat CC
    89.1 / 87.6, and pYIN 81.6 / 83.2. Syrinx is at parity with Praat and
    clearly ahead of pYIN.
  - The best neural trackers are ahead: SwiftF0 offline 90.4 / 95.9, PENN
    87.0 / 96.8 (PTDB is PENN's own training set), CREPE full 88.4 / 88.1.
  - On the gender-symmetric worst-gender error, Syrinx-new is 14.1 / 15.5,
    against Praat AC 11.9 / 18.4, CREPE full 13.6 / 19.8, SwiftF0 offline
    10.0 / 5.7 and PENN 14.5 / 5.2.
  - At 50-cent precision (RPA) Syrinx trails Praat and the neural trackers
    on FDA by 1–5 pp (79.1 vs 80.4–84.0). Its voicing error is about twice
    Praat's (VDE 11.7 / 5.5 vs 5.8 / 3.4).
- **Singing (vocadito, hand-annotated).**
  - The improvements moved Syrinx from 95.3 to **97.2**, past Praat AC
    (94.9) and PENN (94.4).
  - It is still behind CREPE full (99.3), SwiftF0 offline (99.2) and pYIN
    (98.7).
  - Above 400 Hz Syrinx-new posts nothing, by design: 96.6 % of the 900
    vocadito frames ≥ 400 Hz are null (the 3.1 % scored correct are refs just
    above 400 Hz posted within 5 % below it).
- **The private session recordings (no ground truth; references are other
  trackers).** Scored under non-circular reference conventions (§4); the
  session results, including the displayed trace, are kept outside this
  repository.
- **Cost.** Single thread on this desktop:
  - Syrinx: 23 ms of CPU per second of audio, causal, about 90 ms latency,
    deployed in the browser.
  - CREPE full: 3 800 ms (163×). PENN: 853 ms (37×). pYIN: 283 ms. CREPE tiny:
    198 ms. All of these are offline as run.
  - SwiftF0: 17 ms offline, 62.5 ms in its streaming deployment (5–11 ms per
    inference in browser WASM, measured 2026-05).
  - Praat AC: 4 ms (native code, offline only).
  - Run the way the app has to run it (streaming), SwiftF0's corpus advantage
    disappears. The retired production stream scores 88.1 / 89.4 on FDA /
    PTDB, within 1 pp of Syrinx-new.
- **Syrinx-new@600 vs @800:** no material difference.
  - ±5 % correct agrees within 0.8 pp in every corpus cell with ≥ 300
    frames.
  - Both post > 400 Hz as unvoiced; the settings differ only on frames
    above the display range.
  - This benchmark gives no accuracy reason to prefer either ceiling.

So the 2026-10-03 improvements made Syrinx **match or beat classic tools**
(Praat, pYIN) on speech and singing. It is **not yet at the level of the
best offline neural trackers**: on clean low-register (75–160 Hz) speech it
is 5–8 pp behind SwiftF0 / PENN. No offline neural tracker is deployable at
Syrinx's latency and cost today. SwiftF0 was deployed, and lost its
advantage in streaming.

## 1. Motivation

After the 2026-10-03 target-voice pass
([target-voice-combined-validation-2026-10-03.md](target-voice-combined-validation-2026-10-03.md)),
the user asked: *"Did the improvements match or exceed the accuracy of other
systems people have made for detecting pitch?"* Every earlier Syrinx pitch
number compares Syrinx with itself (before / after a change) or with Praat used
as a reference. This file is a head-to-head against the trackers people
actually use, on the same audio, scored the same way: classic DSP (Praat AC and
CC, pYIN) and neural (PENN, CREPE, SwiftF0 — the project's own former
detector).

Two questions are kept apart throughout:

1. **Ground-truth corpora** (laryngograph or hand-annotated F0, independent of
   every detector): how accurate is each tracker on clean lab speech and
   singing?
2. **The private session recordings** (no ground truth): how accurate is
   each tracker on the voice and room the app is actually used in?
   References there are other trackers, so the conventions below are built
   to stop any tracker from being scored against itself. Results on the private session recordings are kept outside this repository.

## 2. Detectors

| row | what runs | config | version |
|---|---|---|---|
| **Syrinx-main** | origin/main production chain (`4000952`; the measured tree was verified file-by-file against `git archive 4000952 src`) through the REAL `pitch-worker.js` + `dsp-worker.js` + `useAudioPipeline.js handleAnalysisResult` ([scripts/session-oracle/](../scripts/session-oracle/README.md) `lib/chain.mjs`) | Boersma AC 75–400 search, fl 1280, L=2 tracker, notch, harmonic guard | origin/main |
| **Syrinx-new** | branch `target-voice-pitch-fix` (`2ee7ab5`; src = 39bd0ff), same chain | + octave arbitration, 800 Hz search with > 400 Hz posted unvoiced, notch voice safety, gated globalPeak, display-gate redesign | branch HEAD |
| **Syrinx-new@600** | Syrinx-new with `BOERSMA_DEFAULTS.maxPitchHz` 800 → 600 (one-line change in an extracted tree, `$PITCH_BENCH_DIR/trees/new600`) | sensitivity row for the pending ceiling decision | — |
| Praat AC default | parselmouth `to_pitch_ac` | floor 75, ceiling 600, 15 candidates, silence .03, voicing .45, octave .01, octave-jump .35, v/uv .14, 10 ms step; full-utterance Viterbi | Praat 6.1.38 (parselmouth 0.4.7) |
| Praat AC 100-500 | same, floor 100 / ceiling 500 | the session-label pitch convention | same |
| Praat CC default | `to_pitch_cc` | floor 75, ceiling 600, Praat defaults | same |
| pYIN | `librosa.pyin` | fmin 65, fmax 800, input resampled to 16 kHz (scipy polyphase), hop 160 (10 ms), frame 1024 (64 ms), centred; `voiced_flag` is the voicing decision | librosa 0.11.0 |
| PENN | `penn.from_audio`, FCNF0++ pretrained checkpoint | the 2026-10-03 session-reference setup (hop 10 ms, fmin 50, fmax 600, `center='half-hop'`, Viterbi); voiced iff periodicity ≥ 0.10 (see §4) | penn 1.0.0, torch 2.11 CPU |
| CREPE full / tiny | `torchcrepe.predict` | 16 kHz, hop 10 ms, fmin 50, fmax 800, Viterbi decoder, periodicity median-3, voiced iff periodicity ≥ 0.21 (torchcrepe README) | torchcrepe 0.0.24, in a venv with system site-packages + torchcrepe only (global Python untouched) |
| SwiftF0 offline | the project's model file `tests/dsp/data/swift-f0/model.onnx`, onnxruntime CPU, 1 thread, whole file in one inference, same linear resampler as `tests/dsp/swift-f0-adapter.js` | **production gate: confidence ≥ 0.5**; also shown at the upstream default 0.9 | onnxruntime 1.25.1 |
| SwiftF0 retired production stream | exact emulation of the retired worker (`git show eded104^:src/dsp/pitch-worker.js`): per 25 ms chunk, per-chunk linear resample, rolling 1024-sample buffer, infer, report output frame 0 | gate 0.5 | same |

Not run: CREPE **full** on the session recordings (3.8 s of CPU per second
of audio single-threaded); CREPE tiny stands in for it there. Everything
else ran on every corpus.

## 3. Data

**Ground-truth corpora** (`tests/dsp/data/corpora.js` loaders; dumped once by
`export_corpora.mjs` so every detector reads bit-identical audio and
references):

| corpus | tracks | audio | reference | note |
|---|---|---|---|---|
| FDA | 50 m + 50 f | 5.5 min, 20 kHz | laryngograph pitchmarks → 5 ms grid | |
| PTDB-TUG (subset) | 90 m + 90 f | 20.3 min, 48 kHz | laryngograph-derived, 10 ms; timestamps +20 ms (binding rule) | **PENN was trained on PTDB-TUG** (its partition covers all 4 718 files, 70 % train) — PENN's PTDB numbers are in-domain |
| vocadito | 40 | 13.6 min, 44.1 kHz | manual singing annotation, 5.8 ms | 900 frames ≥ 400 Hz |
| Hillenbrand | 540 m + 576 w | 10.2 min, 16 kHz | one steady F0 per vowel over the central 70 % | **synthetic reference** — the ±5 % class is dominated by the steady-F0 artifact (~31 % "other" for every tracker); comparative use only |

**Sessions:** the private session recordings (`$SYRINX_SESSIONS_DIR`, not in this repository).

## 4. Scoring conventions

**Metrics** (mir_eval definitions, implemented in `score_corpora.py`).
`mireval_check.py` cross-checks them against `mir_eval` 0.8.2 on the same
data. Pooled RPA / VDE agree within 0.5 pp:

- Praat AC on PTDB: 83.21 / 3.32 in mir_eval vs 83.10 / 3.37 here.
- CREPE tiny on FDA: 80.38 / 11.14 vs 80.38 / 11.28.
- Syrinx-new on FDA: 78.68 / 12.04 vs 79.15 / 11.70.

mir_eval resamples the reference to its own 10 ms grid, which accounts for
the small differences.

- **RPA** — reference-voiced frames where the detector is voiced and within 50 cents.
- **RCA** — the same, octave-insensitive.
- **±5 %** (C5) — the project's "correct": voiced and |est/ref − 1| < 0.05.
- **GPE** — among frames voiced in both, |est/ref − 1| > 0.2.
- **FPE** — std of the cents error over frames voiced in both and within 20 %.
- **VDE** — voicing disagreement over all reference frames.
- **oct-down / oct-up** — the project's classes: ×½ (|q − ½| ≤ .05) or ×⅓,
  and ×2 (|q − 2| ≤ .2) or ×3 / ×4.
- **null** — detector unvoiced on a reference-voiced frame.
- **RPA pitch-only** — the detector's raw pitch even where it says unvoiced
  (the convention most published CREPE / PENN numbers use). It equals RPA for
  Praat and Syrinx, which emit no pitch on unvoiced frames.

RPA, C5, octave rates and null all count against the same denominator, so a
detector that refuses to guess loses RPA. Syrinx-new **posts > 400 Hz as
unvoiced by design** (display range 75–400). Its ≥ 400 Hz frames therefore
count as nulls; see the band tables.

**Resampling to the reference grid** is mir_eval-style: log-linear
interpolation between two voiced detector frames, otherwise the nearest frame.
A detector frame counts as unvoiced beyond one detector hop. Without this, the
25 ms-hop Syrinx loses about 2 pp RPA just from holding values between hops
(the nearest-neighbour first pass: FDA RPA 77.0 vs 79.2 interpolated).

**Alignment — every detector at its own response centre.** Each detector's
frames carry its documented centre time:

- Syrinx posted: window centre, chunk end − 40 ms.
- Syrinx displayed: a further − L·hop − 30 ms.
- Praat: `xs()`.
- pYIN / CREPE: i·10 ms.
- PENN: (i + ½)·10 ms.
- SwiftF0: (256 i + 127.5)/16 kHz; the stream row uses chunk end − 56 ms.

A residual offset is swept from −100 to +100 ms in 5 ms steps, per detector ×
dataset, pooled. The best-RPA offset is used and reported. Syrinx's residual is
0 to −5 ms, so its window-centre convention is right. The causal latency is
reported separately in the cost table.

**PENN voicing threshold.** PENN's README uses `interp_unvoiced_at=.065`. In
penn 1.0.0 the entropy periodicity never drops below ~0.071, even on digital
silence, so .065 marks every frame voiced. I picked **0.10** as the
VDE-minimising threshold on FDA + vocadito, which PENN was not trained on:

- FDA: 8.5 % VDE at 0.10, 9.7 % at 0.15.
- vocadito: 9.6 % at 0.10, 9.3 % at 0.15.

This choice favours PENN. The pitch-only columns and rows remove the voicing
decision altogether.

**Sessions — reference conventions.** Unanimous frames (Praat AC, Praat
SHS and PENN pairwise within 5 %), leave-one-family-out (AC-family
detectors scored where SHS and PENN agree, neural detectors where AC and
SHS agree), and a cross view of every detector against both two-voter
references with circular cells flagged. Session VDE is not reported:
reference-unvoiced is undefined where the voters disagree. Results on the private session recordings are kept outside this repository.

## 5. Results

Cells are percentages unless marked. Rows labelled "posted" are the Syrinx worker output (the fair comparison with offline trackers); "displayed" is the live trace. Hillenbrand* is the synthetic steady-F0 reference (comparative only).

### Corpora, all reference-voiced frames (best offset per detector x corpus)

#### FDA

| detector | offset ms | RPA | RCA | ±5 % (C5) | GPE | FPE (cents) | VDE | oct-down | oct-up | null | RPA pitch-only |
|---|---|---|---|---|---|---|---|---|---|---|---|
| Syrinx-main (posted) | +0 | 79.1 | 79.5 | 87.0 | 1.97 | 54.2 | 11.9 | 0.44 | 0.19 | 3.0 | 79.1 |
| Syrinx-new (posted) | +0 | 79.1 | 79.4 | 87.1 | 1.60 | 53.4 | 11.7 | 0.33 | 0.18 | 3.5 | 79.1 |
| Syrinx-new@600 (posted) | +0 | 79.2 | 79.4 | 87.1 | 1.69 | 53.6 | 11.8 | 0.33 | 0.19 | 3.3 | 79.2 |
| Syrinx-main (displayed) | +0 | 75.0 | 75.1 | 83.9 | 2.18 | 61.3 | 34.1 | 0.02 | 0.23 | 3.8 | 75.0 |
| Syrinx-new (displayed) | +0 | 76.0 | 76.2 | 84.9 | 2.13 | 61.1 | 32.4 | 0.12 | 0.18 | 2.7 | 76.0 |
| Syrinx-new@600 (displayed) | +0 | 76.0 | 76.2 | 85.0 | 2.15 | 61.0 | 32.4 | 0.12 | 0.19 | 2.7 | 76.0 |
| Praat AC default (75-600) | +0 | 83.1 | 83.4 | 88.3 | 0.94 | 39.3 | 5.8 | 0.33 | 0.16 | 6.8 | 83.1 |
| Praat AC 100-500 | +0 | 75.3 | 75.4 | 79.9 | 0.84 | 38.3 | 9.6 | 0.21 | 0.10 | 16.0 | 75.3 |
| Praat CC default | -5 | 84.0 | 84.4 | 89.1 | 1.31 | 41.2 | 5.7 | 0.62 | 0.11 | 5.3 | 84.0 |
| pYIN (librosa) | -5 | 71.6 | 71.7 | 81.6 | 1.06 | 59.3 | 17.0 | 0.04 | 0.10 | 7.2 | 72.4 |
| PENN FCNF0++ | -15 | 80.9 | 80.9 | 87.0 | 0.71 | 46.5 | 7.2 | 0.03 | 0.04 | 7.0 | 83.7 |
| CREPE full (torchcrepe) | +0 | 81.1 | 81.2 | 88.4 | 0.90 | 50.9 | 10.6 | 0.00 | 0.06 | 3.8 | 81.8 |
| CREPE tiny (torchcrepe) | +0 | 80.4 | 80.4 | 88.6 | 0.77 | 50.6 | 11.3 | 0.00 | 0.06 | 4.2 | 80.8 |
| SwiftF0 offline, gate 0.5 | -15 | 83.3 | 83.4 | 90.4 | 0.98 | 50.5 | 15.0 | 0.02 | 0.09 | 1.8 | 83.6 |
| SwiftF0 retired production stream, gate 0.5 | +0 | 80.6 | 80.6 | 88.1 | 0.54 | 48.8 | 8.2 | 0.00 | 0.05 | 5.4 | 80.1 |
| SwiftF0 offline, gate 0.9 (upstream) | -15 | 79.8 | 79.8 | 85.4 | 0.24 | 43.2 | 8.9 | 0.00 | 0.02 | 9.9 | 83.6 |

#### PTDB-TUG

| detector | offset ms | RPA | RCA | ±5 % (C5) | GPE | FPE (cents) | VDE | oct-down | oct-up | null | RPA pitch-only |
|---|---|---|---|---|---|---|---|---|---|---|---|
| Syrinx-main (posted) | -5 | 83.4 | 83.9 | 89.4 | 1.28 | 38.1 | 5.9 | 0.45 | 0.16 | 5.7 | 83.4 |
| Syrinx-new (posted) | -5 | 83.5 | 83.9 | 89.4 | 1.21 | 38.0 | 5.5 | 0.39 | 0.17 | 5.7 | 83.5 |
| Syrinx-new@600 (posted) | -5 | 83.5 | 83.9 | 89.4 | 1.23 | 38.2 | 5.6 | 0.39 | 0.18 | 5.6 | 83.5 |
| Syrinx-main (displayed) | +0 | 76.9 | 77.0 | 84.2 | 1.39 | 54.6 | 14.2 | 0.06 | 0.19 | 6.6 | 76.9 |
| Syrinx-new (displayed) | +0 | 78.9 | 79.1 | 86.5 | 1.30 | 53.6 | 12.9 | 0.09 | 0.18 | 4.3 | 78.9 |
| Syrinx-new@600 (displayed) | +0 | 78.9 | 79.1 | 86.4 | 1.31 | 53.5 | 12.9 | 0.09 | 0.18 | 4.3 | 78.9 |
| Praat AC default (75-600) | +0 | 83.1 | 83.8 | 88.0 | 0.95 | 31.1 | 3.4 | 0.70 | 0.06 | 8.9 | 83.1 |
| Praat AC 100-500 | +0 | 70.5 | 71.0 | 74.4 | 1.05 | 31.7 | 5.8 | 0.06 | 0.51 | 22.8 | 70.5 |
| Praat CC default | +0 | 81.6 | 82.4 | 87.6 | 1.46 | 37.8 | 3.6 | 0.93 | 0.05 | 7.6 | 81.6 |
| pYIN (librosa) | -5 | 75.1 | 75.3 | 83.2 | 0.45 | 44.8 | 14.3 | 0.12 | 0.08 | 10.6 | 75.8 |
| PENN FCNF0++ | -15 | 93.9 | 94.1 | 96.8 | 0.23 | 23.5 | 2.8 | 0.00 | 0.21 | 1.9 | 94.4 |
| CREPE full (torchcrepe) | +0 | 83.6 | 83.9 | 88.1 | 0.36 | 31.8 | 6.2 | 0.00 | 0.30 | 9.5 | 85.9 |
| CREPE tiny (torchcrepe) | +0 | 83.6 | 84.1 | 88.4 | 0.60 | 31.2 | 10.0 | 0.00 | 0.51 | 9.1 | 85.1 |
| SwiftF0 offline, gate 0.5 | -15 | 91.1 | 91.3 | 95.9 | 0.52 | 31.7 | 41.2 | 0.05 | 0.13 | 1.0 | 91.3 |
| SwiftF0 retired production stream, gate 0.5 | +0 | 82.6 | 82.8 | 89.4 | 0.51 | 37.0 | 4.3 | 0.00 | 0.27 | 6.9 | 81.3 |
| SwiftF0 offline, gate 0.9 (upstream) | -15 | 86.9 | 86.9 | 90.5 | 0.04 | 25.7 | 4.6 | 0.00 | 0.03 | 8.2 | 91.3 |

#### vocadito

| detector | offset ms | RPA | RCA | ±5 % (C5) | GPE | FPE (cents) | VDE | oct-down | oct-up | null | RPA pitch-only |
|---|---|---|---|---|---|---|---|---|---|---|---|
| Syrinx-main (posted) | +0 | 94.7 | 97.4 | 95.3 | 3.22 | 15.2 | 11.6 | 2.86 | 0.00 | 1.3 | 94.7 |
| Syrinx-new (posted) | +0 | 96.6 | 97.3 | 97.2 | 1.00 | 13.8 | 11.5 | 0.79 | 0.01 | 1.6 | 96.6 |
| Syrinx-new@600 (posted) | +0 | 96.6 | 97.3 | 97.2 | 1.02 | 13.9 | 11.6 | 0.80 | 0.01 | 1.6 | 96.6 |
| Syrinx-main (displayed) | +0 | 91.6 | 93.1 | 92.9 | 1.81 | 18.2 | 21.9 | 1.63 | 0.00 | 4.7 | 91.6 |
| Syrinx-new (displayed) | +0 | 95.1 | 95.4 | 96.3 | 0.48 | 20.4 | 19.1 | 0.42 | 0.00 | 2.2 | 95.1 |
| Syrinx-new@600 (displayed) | +0 | 95.0 | 95.4 | 96.3 | 0.49 | 20.5 | 19.1 | 0.42 | 0.00 | 2.2 | 95.0 |
| Praat AC default (75-600) | -5 | 94.6 | 96.6 | 94.9 | 2.26 | 9.4 | 6.9 | 2.16 | 0.00 | 2.8 | 94.6 |
| Praat AC 100-500 | -5 | 93.9 | 94.9 | 94.5 | 1.11 | 11.8 | 6.9 | 0.95 | 0.03 | 4.2 | 93.9 |
| Praat CC default | -5 | 93.5 | 96.2 | 94.0 | 3.05 | 12.5 | 7.3 | 2.89 | 0.00 | 2.6 | 93.5 |
| pYIN (librosa) | -5 | 96.8 | 97.0 | 98.7 | 0.16 | 17.2 | 13.4 | 0.16 | 0.00 | 0.5 | 97.0 |
| PENN FCNF0++ | -10 | 92.5 | 94.6 | 94.4 | 2.77 | 20.6 | 8.7 | 2.24 | 0.33 | 2.1 | 93.5 |
| CREPE full (torchcrepe) | +0 | 98.5 | 98.6 | 99.3 | 0.04 | 14.4 | 12.0 | 0.00 | 0.04 | 0.5 | 98.8 |
| CREPE tiny (torchcrepe) | +0 | 98.0 | 98.1 | 98.9 | 0.08 | 15.3 | 13.0 | 0.00 | 0.08 | 0.8 | 98.6 |
| SwiftF0 offline, gate 0.5 | -10 | 97.6 | 97.8 | 99.2 | 0.29 | 16.8 | 16.0 | 0.16 | 0.06 | 0.2 | 97.7 |
| SwiftF0 retired production stream, gate 0.5 | +0 | 95.6 | 95.9 | 97.6 | 0.58 | 18.8 | 9.4 | 0.06 | 0.33 | 1.2 | 95.5 |
| SwiftF0 offline, gate 0.9 (upstream) | -10 | 95.8 | 95.8 | 97.1 | 0.05 | 15.6 | 8.2 | 0.04 | 0.01 | 2.6 | 97.7 |

#### Hillenbrand*

| detector | offset ms | RPA | RCA | ±5 % (C5) | GPE | FPE (cents) | VDE | oct-down | oct-up | null | RPA pitch-only |
|---|---|---|---|---|---|---|---|---|---|---|---|
| Syrinx-main (posted) | +5 | 46.9 | 47.2 | 61.4 | 5.60 | 100.6 | 8.0 | 0.40 | 0.29 | 7.9 | 46.9 |
| Syrinx-new (posted) | +5 | 46.7 | 46.9 | 61.0 | 4.71 | 99.9 | 8.5 | 0.24 | 0.17 | 9.5 | 46.7 |
| Syrinx-new@600 (posted) | +5 | 46.8 | 47.0 | 61.2 | 4.92 | 100.0 | 8.4 | 0.24 | 0.21 | 9.1 | 46.8 |
| Syrinx-main (displayed) | +10 | 45.6 | 45.7 | 58.9 | 4.41 | 97.3 | 11.2 | 0.11 | 0.28 | 15.1 | 45.6 |
| Syrinx-new (displayed) | +5 | 45.8 | 45.9 | 59.1 | 3.26 | 97.0 | 11.7 | 0.04 | 0.07 | 16.1 | 45.8 |
| Syrinx-new@600 (displayed) | +5 | 45.9 | 46.0 | 59.2 | 3.50 | 97.0 | 11.5 | 0.04 | 0.11 | 15.6 | 45.9 |
| Praat AC default (75-600) | -15 | 45.0 | 45.3 | 58.9 | 5.05 | 102.3 | 11.6 | 0.46 | 0.23 | 11.5 | 45.0 |
| Praat AC 100-500 | -15 | 43.4 | 43.7 | 56.8 | 5.61 | 104.6 | 12.3 | 0.21 | 0.47 | 13.0 | 43.4 |
| Praat CC default | -20 | 44.9 | 45.2 | 58.7 | 5.85 | 103.3 | 11.0 | 0.63 | 0.29 | 10.3 | 44.9 |
| pYIN (librosa) | -5 | 47.6 | 48.1 | 61.6 | 5.21 | 99.3 | 15.6 | 0.03 | 1.30 | 8.9 | 50.1 |
| PENN FCNF0++ | -20 | 44.0 | 45.7 | 58.6 | 7.33 | 106.6 | 12.5 | 0.12 | 2.28 | 7.4 | 45.3 |
| CREPE full (torchcrepe) | -5 | 47.8 | 47.8 | 62.6 | 3.69 | 102.2 | 12.9 | 0.05 | 0.00 | 6.9 | 49.7 |
| CREPE tiny (torchcrepe) | -5 | 46.8 | 46.9 | 61.2 | 4.07 | 100.5 | 14.4 | 0.06 | 0.56 | 9.8 | 49.8 |
| SwiftF0 offline, gate 0.5 | -10 | 49.5 | 49.5 | 64.9 | 3.60 | 100.5 | 14.4 | 0.18 | 0.01 | 4.2 | 49.7 |
| SwiftF0 retired production stream, gate 0.5 | -5 | 47.2 | 47.3 | 62.5 | 3.87 | 102.4 | 9.9 | 0.09 | 0.02 | 6.8 | 47.4 |
| SwiftF0 offline, gate 0.9 (upstream) | -15 | 47.9 | 48.0 | 62.4 | 3.18 | 98.6 | 12.2 | 0.07 | 0.00 | 9.7 | 49.7 |

### Corpora by gender: RPA / ±5 % correct, and the gender-symmetric max(F_err, M_err) on ±5 %

| detector | FDA f | FDA m | PTDB f | PTDB m | Hil f* | Hil m* | vocadito | max err FDA | max err PTDB |
|---|---|---|---|---|---|---|---|---|---|
| Syrinx-main (posted) | 80.4 / 88.1 | 77.7 / 85.7 | 89.7 / 94.3 | 77.2 / 84.4 | 47.0 / 61.6 | 46.8 / 61.0 | 94.7 / 95.3 | 14.3 | 15.6 |
| Syrinx-new (posted) | 80.4 / 88.1 | 77.8 / 85.9 | 89.7 / 94.4 | 77.3 / 84.5 | 47.1 / 61.6 | 46.3 / 60.3 | 96.6 / 97.2 | 14.1 | 15.5 |
| Syrinx-new@600 (posted) | 80.4 / 88.2 | 77.8 / 85.9 | 89.7 / 94.4 | 77.3 / 84.5 | 47.1 / 61.6 | 46.5 / 60.6 | 96.6 / 97.2 | 14.1 | 15.5 |
| Syrinx-main (displayed) | 77.5 / 86.3 | 72.1 / 81.2 | 85.7 / 91.3 | 68.0 / 77.0 | 46.8 / 60.6 | 44.1 / 56.8 | 91.6 / 92.9 | 18.8 | 23.0 |
| Syrinx-new (displayed) | 77.9 / 86.7 | 73.8 / 82.9 | 86.5 / 92.2 | 71.4 / 80.7 | 47.0 / 60.6 | 44.3 / 57.2 | 95.1 / 96.3 | 17.1 | 19.3 |
| Syrinx-new@600 (displayed) | 78.0 / 86.8 | 73.8 / 83.0 | 86.6 / 92.2 | 71.3 / 80.6 | 47.1 / 60.6 | 44.5 / 57.4 | 95.0 / 96.3 | 17.0 | 19.4 |
| Praat AC default (75-600) | 82.4 / 88.1 | 83.9 / 88.5 | 90.9 / 94.4 | 75.3 / 81.6 | 45.6 / 59.7 | 44.2 / 57.9 | 94.6 / 94.9 | 11.9 | 18.4 |
| Praat AC 100-500 | 83.1 / 88.6 | 66.4 / 70.1 | 89.9 / 93.4 | 51.2 / 55.4 | 45.5 / 59.6 | 40.8 / 53.2 | 93.9 / 94.5 | 29.9 | 44.6 |
| Praat CC default | 82.9 / 88.3 | 85.2 / 90.1 | 88.3 / 92.9 | 74.8 / 82.3 | 45.4 / 59.3 | 44.2 / 58.0 | 93.5 / 94.0 | 11.7 | 17.7 |
| pYIN (librosa) | 75.5 / 85.5 | 67.2 / 77.2 | 84.7 / 92.1 | 65.6 / 74.3 | 48.3 / 62.9 | 46.6 / 60.1 | 96.8 / 98.7 | 22.8 | 25.7 |
| PENN FCNF0++ | 81.5 / 88.4 | 80.3 / 85.5 | 96.9 / 98.7 | 90.9 / 94.8 | 44.3 / 59.0 | 43.6 / 58.0 | 92.5 / 94.4 | 14.5 | 5.2 |
| CREPE full (torchcrepe) | 82.1 / 90.2 | 80.0 / 86.4 | 92.5 / 95.9 | 74.8 / 80.2 | 47.5 / 62.4 | 48.1 / 62.8 | 98.5 / 99.3 | 13.6 | 19.8 |
| CREPE tiny (torchcrepe) | 81.0 / 89.9 | 79.7 / 87.2 | 92.0 / 96.0 | 75.2 / 80.8 | 47.3 / 62.2 | 46.0 / 59.9 | 98.0 / 98.9 | 12.8 | 19.2 |
| SwiftF0 offline, gate 0.5 | 82.2 / 90.0 | 84.6 / 90.9 | 93.4 / 97.5 | 88.9 / 94.3 | 49.0 / 64.8 | 50.1 / 65.0 | 97.6 / 99.2 | 10.0 | 5.7 |
| SwiftF0 retired production stream, gate 0.5 | 80.3 / 88.1 | 80.8 / 88.1 | 88.9 / 94.4 | 76.3 / 84.4 | 47.9 / 63.7 | 46.4 / 60.9 | 95.6 / 97.6 | 11.9 | 15.6 |
| SwiftF0 offline, gate 0.9 (upstream) | 76.2 / 81.8 | 83.7 / 89.4 | 88.9 / 91.7 | 85.0 / 89.2 | 47.3 / 61.9 | 48.8 / 63.0 | 95.8 / 97.1 | 18.2 | 10.8 |

### Corpora by F0 band, speech (FDA + PTDB pooled, frame-weighted): RPA / ±5 % / oct-down / oct-up / null

| detector | <75 | 75-160 | 160-300 | 300-400 | >=400 |
|---|---|---|---|---|---|
| Syrinx-main (posted) | 0.7 / 2.1 / 0.0 / 4.1 / 83.1 (n 290) | 77.9 / 85.4 / 0.1 / 0.3 / 6.8 (n 22593) | 85.2 / 91.6 / 0.7 / 0.0 / 1.1 (n 23955) | 84.9 / 92.6 / 0.2 / 0.0 / 0.8 (n 1185) | - |
| Syrinx-new (posted) | 0.7 / 2.1 / 0.0 / 4.5 / 83.4 (n 290) | 77.9 / 85.5 / 0.1 / 0.3 / 6.9 (n 22593) | 85.2 / 91.6 / 0.6 / 0.0 / 1.6 (n 23955) | 84.9 / 92.4 / 0.2 / 0.0 / 0.8 (n 1185) | - |
| Syrinx-new@600 (posted) | 0.7 / 2.1 / 0.0 / 4.5 / 83.4 (n 290) | 77.9 / 85.5 / 0.1 / 0.3 / 6.9 (n 22593) | 85.2 / 91.6 / 0.6 / 0.0 / 1.4 (n 23955) | 85.0 / 92.5 / 0.2 / 0.0 / 0.7 (n 1185) | - |
| Syrinx-main (displayed) | 0.0 / 1.0 / 0.0 / 6.9 / 51.7 (n 290) | 70.3 / 79.3 / 0.0 / 0.3 / 7.5 (n 22593) | 81.9 / 89.3 / 0.1 / 0.0 / 2.5 (n 23955) | 79.4 / 88.0 / 0.0 / 0.0 / 4.1 (n 1185) | - |
| Syrinx-new (displayed) | 0.0 / 1.0 / 0.0 / 8.3 / 54.8 (n 290) | 72.8 / 82.0 / 0.0 / 0.3 / 4.8 (n 22593) | 82.6 / 90.0 / 0.2 / 0.0 / 1.6 (n 23955) | 81.4 / 90.0 / 0.0 / 0.0 / 1.9 (n 1185) | - |
| Syrinx-new@600 (displayed) | 0.0 / 1.0 / 0.0 / 8.3 / 54.8 (n 290) | 72.8 / 82.0 / 0.0 / 0.3 / 4.9 (n 22593) | 82.6 / 90.0 / 0.2 / 0.0 / 1.6 (n 23955) | 81.5 / 90.2 / 0.0 / 0.0 / 1.9 (n 1185) | - |
| Praat AC default (75-600) | 1.7 / 2.4 / 0.0 / 0.7 / 94.8 (n 290) | 79.9 / 85.4 / 0.2 / 0.1 / 10.8 (n 22593) | 86.9 / 91.6 / 0.8 / 0.1 / 4.2 (n 23955) | 86.8 / 92.2 / 0.1 / 0.0 / 2.7 (n 1185) | - |
| Praat AC 100-500 | 0.0 / 0.0 / 0.0 / 2.1 / 93.8 (n 290) | 58.1 / 62.0 / 0.0 / 0.6 / 34.7 (n 22593) | 87.2 / 91.8 / 0.3 / 0.0 / 4.7 (n 23955) | 86.2 / 92.5 / 0.0 / 0.0 / 2.3 (n 1185) | - |
| Praat CC default | 2.1 / 3.1 / 0.0 / 2.1 / 87.9 (n 290) | 80.5 / 86.7 / 0.2 / 0.1 / 8.0 (n 22593) | 85.7 / 90.8 / 1.3 / 0.0 / 4.1 (n 23955) | 86.1 / 91.6 / 0.2 / 0.0 / 2.4 (n 1185) | - |
| pYIN (librosa) | 16.6 / 22.1 / 0.0 / 2.1 / 60.3 (n 290) | 66.8 / 76.0 / 0.1 / 0.2 / 14.9 (n 22593) | 79.8 / 88.7 / 0.1 / 0.0 / 2.9 (n 23955) | 81.2 / 90.5 / 0.0 / 0.0 / 1.0 (n 1185) | - |
| PENN FCNF0++ | 34.5 / 38.3 / 0.0 / 3.1 / 55.9 (n 290) | 85.9 / 90.3 / 0.0 / 0.2 / 6.5 (n 22593) | 89.2 / 93.7 / 0.0 / 0.0 / 2.1 (n 23955) | 85.0 / 91.4 / 0.0 / 0.0 / 3.3 (n 1185) | - |
| CREPE full (torchcrepe) | 11.0 / 12.1 / 0.0 / 2.1 / 84.5 (n 290) | 77.4 / 83.2 / 0.0 / 0.4 / 11.8 (n 22593) | 87.7 / 93.7 / 0.0 / 0.0 / 1.0 (n 23955) | 85.1 / 92.7 / 0.0 / 0.0 / 0.3 (n 1185) | - |
| CREPE tiny (torchcrepe) | 6.9 / 8.3 / 0.0 / 8.3 / 81.0 (n 290) | 77.7 / 84.1 / 0.0 / 0.5 / 11.0 (n 22593) | 86.8 / 93.5 / 0.0 / 0.0 / 1.8 (n 23955) | 82.9 / 92.4 / 0.0 / 0.0 / 0.5 (n 1185) | - |
| SwiftF0 offline, gate 0.5 | 20.0 / 29.0 / 0.0 / 5.5 / 32.8 (n 290) | 87.3 / 93.0 / 0.0 / 0.2 / 0.9 (n 22593) | 88.0 / 94.0 / 0.1 / 0.0 / 1.5 (n 23955) | 83.8 / 91.2 / 0.0 / 0.0 / 1.9 (n 1185) | - |
| SwiftF0 retired production stream, gate 0.5 | 6.9 / 9.0 / 0.0 / 4.1 / 82.4 (n 290) | 78.6 / 86.3 / 0.0 / 0.3 / 8.1 (n 22593) | 85.2 / 91.9 / 0.0 / 0.0 / 3.5 (n 23955) | 81.7 / 89.4 / 0.0 / 0.0 / 3.7 (n 1185) | - |
| SwiftF0 offline, gate 0.9 (upstream) | 15.9 / 22.1 / 0.0 / 0.7 / 72.4 (n 290) | 84.7 / 89.6 / 0.0 / 0.1 / 6.5 (n 22593) | 83.1 / 87.4 / 0.0 / 0.0 / 10.5 (n 23955) | 75.9 / 81.4 / 0.0 / 0.0 / 13.9 (n 1185) | - |

### vocadito (singing) by band: RPA / ±5 % / oct-down / null

| detector | 75-160 | 160-300 | 300-400 | >=400 |
|---|---|---|---|---|
| Syrinx-main (posted) | 98.2 / 99.2 / 0.1 / 0.6 (n 23837) | 94.2 / 94.8 / 3.0 / 1.6 (n 54667) | 96.7 / 97.0 / 1.4 / 1.1 (n 13521) | 0.1 / 0.1 / 93.0 / 1.3 (n 900) |
| Syrinx-new (posted) | 98.3 / 99.2 / 0.1 / 0.5 (n 23837) | 96.8 / 97.3 / 1.3 / 0.8 (n 54667) | 99.1 / 99.4 / 0.1 / 0.5 (n 13521) | 2.8 / 3.1 / 0.1 / 96.6 (n 900) |
| Syrinx-new@600 (posted) | 98.3 / 99.2 / 0.1 / 0.5 (n 23837) | 96.8 / 97.3 / 1.3 / 0.7 (n 54667) | 99.2 / 99.5 / 0.1 / 0.4 (n 13521) | 2.8 / 3.1 / 0.1 / 96.6 (n 900) |
| Syrinx-main (displayed) | 96.3 / 98.1 / 0.0 / 1.2 (n 23837) | 90.8 / 92.1 / 1.7 / 5.4 (n 54667) | 92.6 / 93.6 / 0.8 / 5.2 (n 13521) | 0.1 / 0.4 / 52.3 / 45.1 (n 900) |
| Syrinx-new (displayed) | 96.7 / 98.4 / 0.0 / 0.9 (n 23837) | 95.1 / 96.2 / 0.7 / 2.5 (n 54667) | 97.9 / 98.7 / 0.0 / 1.0 (n 13521) | 11.9 / 17.3 / 0.1 / 35.6 (n 900) |
| Syrinx-new@600 (displayed) | 96.7 / 98.4 / 0.0 / 0.9 (n 23837) | 95.0 / 96.2 / 0.7 / 2.5 (n 54667) | 98.0 / 98.8 / 0.0 / 1.0 (n 13521) | 11.9 / 17.3 / 0.1 / 35.6 (n 900) |
| Praat AC default (75-600) | 98.2 / 98.6 / 0.1 / 1.1 (n 23837) | 92.6 / 92.9 / 3.6 / 3.4 (n 54667) | 96.6 / 96.8 / 0.1 / 3.0 (n 13521) | 91.7 / 92.1 / 0.0 / 7.9 (n 900) |
| Praat AC 100-500 | 92.4 / 93.2 / 0.0 / 6.1 (n 23837) | 94.1 / 94.6 / 1.6 / 3.6 (n 54667) | 96.4 / 96.8 / 0.2 / 3.0 (n 13521) | 91.4 / 91.8 / 0.0 / 7.9 (n 900) |
| Praat CC default | 97.8 / 98.5 / 0.1 / 1.0 (n 23837) | 91.1 / 91.6 / 4.7 / 3.2 (n 54667) | 96.0 / 96.4 / 0.5 / 2.9 (n 13521) | 91.7 / 92.3 / 0.0 / 7.4 (n 900) |
| pYIN (librosa) | 96.1 / 98.6 / 0.0 / 0.7 (n 23837) | 96.7 / 98.5 / 0.3 / 0.5 (n 54667) | 98.6 / 99.6 / 0.0 / 0.1 (n 13521) | 99.3 / 100.0 / 0.0 / 0.0 (n 900) |
| PENN FCNF0++ | 93.4 / 95.8 / 0.6 / 1.6 (n 23837) | 92.3 / 94.0 / 3.5 / 1.6 (n 54667) | 91.6 / 93.5 / 0.1 / 5.4 (n 13521) | 94.2 / 96.7 / 0.0 / 1.2 (n 900) |
| CREPE full (torchcrepe) | 97.7 / 98.6 / 0.0 / 1.0 (n 23837) | 98.9 / 99.6 / 0.0 / 0.3 (n 54667) | 99.0 / 99.7 / 0.0 / 0.1 (n 13521) | 95.0 / 95.3 / 0.0 / 4.6 (n 900) |
| CREPE tiny (torchcrepe) | 96.9 / 97.8 / 0.0 / 1.7 (n 23837) | 98.7 / 99.5 / 0.0 / 0.3 (n 54667) | 98.0 / 98.9 / 0.0 / 0.8 (n 13521) | 90.4 / 91.2 / 0.0 / 8.7 (n 900) |
| SwiftF0 offline, gate 0.5 | 97.5 / 99.5 / 0.1 / 0.1 (n 23837) | 97.7 / 99.1 / 0.2 / 0.2 (n 54667) | 97.6 / 99.0 / 0.0 / 0.2 (n 13521) | 96.9 / 97.3 / 0.0 / 1.3 (n 900) |
| SwiftF0 retired production stream, gate 0.5 | 94.0 / 97.0 / 0.0 / 1.6 (n 23837) | 96.6 / 98.4 / 0.1 / 0.9 (n 54667) | 95.7 / 96.8 / 0.0 / 1.4 (n 13521) | 78.3 / 78.8 / 0.0 / 4.4 (n 900) |
| SwiftF0 offline, gate 0.9 (upstream) | 96.6 / 98.5 / 0.0 / 1.2 (n 23837) | 95.6 / 96.8 / 0.1 / 3.0 (n 54667) | 95.5 / 96.5 / 0.0 / 3.1 (n 13521) | 88.2 / 88.4 / 0.0 / 11.4 (n 900) |

### Sessions

The unanimous, leave-one-family-out and cross-view session tables were
scored on the private session recordings. Results on the private session recordings are kept outside this repository.

### Cost and deployability (this machine, single thread, 60 s of speech audio)

CPU = process CPU time over the clip, median of 3 after a warm-up call; torch / onnxruntime pinned to 1 thread. Praat parallelises internally (process CPU 1.6–7.6 ms/s but wall 0.4–0.8 ms/s). Syrinx = the real pitch worker's chunk handler (Node, one JS thread, observation tap off).

| detector | causal / streaming? | latency | CPU ms per s of audio | model / download | runs in a browser today? |
|---|---|---|---|---|---|
| Syrinx-main / -new / -new@600 | yes (streaming, per 25 ms chunk) | ~90 ms posted (40 ms window centre + 50 ms L=2 decode); ~112 ms displayed | 23 (main 23) | none (≈60 KB JS source) | yes — deployed (pure JS worker) |
| Praat AC (default / 100-500) | no — full-utterance Viterbi | offline (window 3/floor = 40 ms; path uses whole file) | 4 (100-500: 2) | none (Praat 6.1.38 via parselmouth) | no (desktop app; no maintained web build) |
| Praat CC | no — full-utterance Viterbi | offline | 8 | none | no |
| pYIN (librosa) | no — full-file HMM Viterbi | offline (64 ms window) | 283 | none | not librosa; a WASM pYIN exists in essentia.js (untested) |
| PENN FCNF0++ | no — full-file Viterbi decode (frame net is local, 128 ms window) | offline | 853 | 8.9 M params, 107 MB checkpoint (HF hub) | only via export; ruled out 2026-05-13 (6–7× slower than SwiftF0 in browser WASM, needs COI headers) |
| CREPE full (torchcrepe) | no as run (Viterbi); argmax/local decode would be causal + 32 ms | offline as run | 3803 | 22.2 M params, 89 MB | TF.js ports exist (ml5.js); heavy |
| CREPE tiny (torchcrepe) | same | offline as run | 198 | 0.49 M params, 2.0 MB | TF.js ports exist; plausible |
| SwiftF0 offline | frame-local net, no decoder (streamable) | offline as run (64 ms STFT frames, centred) | 17 | 398 KB ONNX | yes — was deployed 2026-05-06..06-09 (onnxruntime-web WASM, 5–11 ms per inference) |
| SwiftF0 retired production stream | yes | ~56 ms (frame 0 of the rolling 1024-sample buffer) | 62 | 398 KB ONNX | yes (was production) |

## 6. Sanity checks (all passed before any number above was trusted)

1. **Baseline tree is origin/main.** The extracted main tree (and the
   session oracle's `base` tree, used for the cached session runs) equals
   `git archive 4000952 src` file for file. The new tree equals the branch
   `src`. new600 differs from it in exactly one line (`diff -r`).
2. **Syrinx corpus dumps reproduce the committed numbers exactly**
   ([target-voice-combined-validation-2026-10-03.md](target-voice-combined-validation-2026-10-03.md)
   §6). `sanity_baseline.py` re-scores the dumped series with the
   `corpus.mjs` convention: one sample per 25 ms hop and the JS
   `Math.round` reference index. The first attempt used numpy's
   round-half-even and was off by ~0.1 pp on PTDB only. With the JS rounding
   every number matches.

   | group | main posted | new posted | main painted | new painted |
   |---|---|---|---|---|
   | PTDB m / f | 84.19 / 94.92 | 84.29 / 95.02 | 77.29 / 91.44 | 80.91 / 92.34 |
   | FDA m / f | 85.68 / 87.69 | 85.73 / 87.61 | 81.55 / 86.00 | 83.20 / 86.77 |
   | Hillenbrand m / f | 61.21 / 61.58 | 60.44 / 61.55 | 63.33 / 64.35 | 63.57 / 64.41 |
   | vocadito < 400 | 96.48 | 98.31 | 93.95 | 97.28 |

   Every cell equals the committed table. The
   [pitch-octave-arbitration-2026-10-03.md](pitch-octave-arbitration-2026-10-03.md)
   "production post" column used that workstream's own harness. It agrees
   exactly on PTDB f, FDA f and Hillenbrand, and within 0.08 pp on FDA m /
   PTDB m. The combined file notes that its absolute numbers differ across
   harnesses.
3. **Metrics vs mir_eval 0.8.2** agree within 0.5 pp (§4).
4. **Alignment.** Each detector's best residual offset is between −20 and
   +10 ms from its own documented centre time; none sits near the ±100 ms
   sweep edge. Syrinx posted:
   0 / −5 / 0 / +5 ms on FDA / PTDB / vocadito / Hillenbrand. PTDB uses the
   +20 ms reference shift.
5. **Session runs** reproduce the committed session oracle, and the
   session reference voters reproduce their cached versions (private
   session recordings; results kept outside this repository).

## 7. Findings

**7.1 Corpora — where Syrinx stands.**

- **Classic DSP.** Syrinx-new is at parity with Praat on ±5 % correct:
  - FDA: −1.2 pp vs Praat AC, −2.0 vs CC.
  - PTDB: +1.4 vs AC, +1.8 vs CC.
  - vocadito: +2.3 vs AC, +3.2 vs CC.

  Praat is better on fine precision (RPA FDA 83.1 vs 79.1, FPE 31–39 vs
  38–53 cents) and on voicing (VDE about half). Syrinx is ahead of pYIN on
  speech by 5–6 pp.
- **Neural, offline.** SwiftF0 and PENN are clearly better on clean speech,
  and most of the gap is in the **75–160 Hz register** (mostly male voices),
  FDA + PTDB pooled:

  | detector | ±5 % correct | null |
  |---|---|---|
  | Syrinx-new | 85.5 | 6.9 % |
  | Praat AC | 85.4 | 10.8 % |
  | CREPE full | 83.2 | 11.8 % |
  | PENN | 90.3 | 6.5 % |
  | SwiftF0 offline | 93.0 | 0.9 % |

  At 160–300 Hz they are within 0–2.4 pp of each other (Syrinx 91.6,
  CREPE full 93.7, PENN 93.7, SwiftF0 94.0, Praat 91.6).
  - SwiftF0's voicing at the 0.5 gate is poor: it voices 51 % of PTDB's
    reference-unvoiced frames (VDE 41 %; 81 % of PTDB reference frames are
    unvoiced). At the upstream 0.9 gate it voices 3.7 %, Syrinx-new 5.4 %. At the upstream 0.9 gate its advantage over
    Syrinx-new shrinks to +1.0 pp on PTDB and turns into −1.7 pp on FDA.
  - CREPE full is at parity with Syrinx on speech (FDA +1.3, PTDB −1.3) and
    better on singing (99.3 vs 97.2).
- **Gender symmetry** (worst-gender ±5 % error, FDA / PTDB):

  | detector | worst-gender error |
  |---|---|
  | Syrinx-new | 14.1 / 15.5 |
  | Syrinx-main | 14.3 / 15.6 |
  | Praat AC | 11.9 / 18.4 |
  | Praat CC | 11.7 / 17.7 |
  | pYIN | 22.8 / 25.7 |
  | CREPE full | 13.6 / 19.8 |
  | CREPE tiny | 12.8 / 19.2 |
  | PENN | 14.5 / 5.2 |
  | SwiftF0 offline | 10.0 / 5.7 |
  | SwiftF0 stream | 11.9 / 15.6 |

  The DSP trackers and CREPE are all limited by PTDB's male speakers.
- **The improvements on the corpora (main → new)** are small except on
  singing: vocadito 95.3 → 97.2, octave-down 2.86 → 0.79 %. Speech is
  unchanged within 0.2 pp, and Hillenbrand men drop −0.7 (the known 800 Hz
  ceiling cost). This was expected: the 2026-10-03 work targeted the
  target voice on the private session recordings and the display.

**7.2 Sessions.** The target-voice, low-register, second-voice,
displayed-trace and PENN-voicing findings were measured on the private
session recordings. Results on the private session recordings are kept outside this repository.

**7.3 Cost** — see the cost table. Syrinx costs 23 ms of CPU per second of
audio (0.58 ms per 25 ms chunk, single JS thread), with no model download,
causal, and is already deployed. Every neural row except SwiftF0 is 8.5–163×
more CPU, offline, and has not been demonstrated in the browser at this
latency. SwiftF0 was deployed. Its streaming form costs 62.5 ms per second
natively, and in browser WASM 5–11 ms per inference, i.e. 200–440 ms per
second. Its corpus accuracy in that form equals Syrinx's.

## 8. The pending ceiling decision (maxPitchHz 800 vs 600)

The benchmark cannot separate the two settings:

- Corpus ±5 %, RPA and VDE are identical to within 0.3 pp everywhere except
  Hillenbrand men. There, under the committed convention, 600 is 60.66 and
  800 is 60.44 (main 61.21).
- Both settings post > 400 Hz as unvoiced, so vocadito ≥ 400 behaves
  identically at the worker; they differ only on frames above the display
  range.

The trade-off documented in
[pitch-ceiling-2026-10-03.md](pitch-ceiling-2026-10-03.md) is that 600 re-opens
600–800 Hz aliasing into 300–400 Hz. On Hillenbrand men it costs −0.55 pp
instead of −0.77 pp here (committed convention; the combined-validation file
measured −0.60 for 600 with its fallback (i) also applied,
[target-voice-combined-validation-2026-10-03.md](target-voice-combined-validation-2026-10-03.md) §11). Neither effect is visible at this benchmark's
resolution, because the corpora have almost no 600–800 Hz
phonation. The decision should rest on that file's targeted tests, not on
this benchmark.

## 9. Caveats

- **Offline vs causal is not a level playing field.** Every non-Syrinx row
  except the SwiftF0 stream row sees the whole file. Praat, pYIN, PENN and
  CREPE (as run) decode a global Viterbi path, so they get unlimited
  lookahead. Syrinx decides with 50 ms of lookahead (L = 2) and posts within
  ~90 ms. The SwiftF0 rows show the size of this effect: the same network
  loses 2–9 pp RPA on the speech corpora when run the way the app ran it
  (streaming) instead of offline.
- **Reference circularity on the sessions.** Praat AC and PENN are both
  reference voters and also detectors, and the references themselves
  disagree on the session recordings, so no session table is ground truth;
  the sessions are best read as agreement with independent method
  families.
- **Training-set overlap.** PENN FCNF0++ was trained on PTDB-TUG (70 % of all
  files) and MDB-stem-synth, so its PTDB row is in-domain. On FDA, which it
  was not trained on, PENN equals Syrinx-new on ±5 % (87.0 vs 87.1). CREPE's
  published training data does not include these corpora. SwiftF0's training
  data was not checked; it may include PTDB-TUG.
- **Voicing thresholds.**
  - SwiftF0 is reported at its Syrinx production gate (0.5), which voices
    51 % of PTDB's reference-unvoiced frames (VDE 41 %). At the upstream 0.9
    gate VDE is 4.6 %, but RPA drops 4 pp.
  - PENN's threshold was tuned on FDA + vocadito VDE, which favours PENN.
  - CREPE uses torchcrepe's README threshold.
  - The pitch-only columns remove the voicing decision altogether.
- **Hillenbrand** scores are dominated by the steady-F0 reference artifact
  (~31 % "other" for every tracker). Read only the differences between
  detectors, never the absolute values.
- **Metric differences vs published papers.**
  - Papers usually report pitch-only RPA (voicing removed), at 10 ms
    resolution, on their own test splits. CREPE and PENN numbers on
    MDB-stem-synth / PTDB in the 90s are consistent with the pitch-only
    columns here (PENN PTDB 94.4).
  - The project's ±5 % class is coarser than 50 cents (±84 cents), which is
    why C5 > RPA everywhere.
  - Syrinx is scored on its 25 ms hops interpolated to the reference grid.
    Its FPE (fine pitch error, 38–53 cents on speech) is partly that hop
    plus a 40 ms window on gliding speech.
- **pYIN parameters.** The 64 ms frame is not librosa's 2048-sample default;
  at 16 kHz that default is 128 ms and would smear speech glides further.
  pYIN's weak speech numbers (C5 81.6 FDA / 83.2 PTDB, VDE 14–17 %) may partly
  reflect this choice. Its vocadito numbers are among the best.
- **CPU numbers** are single-thread on this desktop. Absolute browser numbers
  differ (Node ORT is ~18× faster than browser ORT-WASM per CLAUDE.md, mobile
  slower again). The *ratios* between the pure-JS detector and the neural
  ones are the useful part.
- The Syrinx corpus numbers in §5 use mir_eval-style interpolation and all
  reference frames. The committed project convention (one sample per 25 ms
  hop, nearest reference frame) gives slightly different absolute values;
  §6 shows both conventions reproduce.

## 10. Reproduction

The scripts are committed in [scripts/pitch-benchmark/](../scripts/pitch-benchmark/README.md)
(the measured scratch scripts with only paths parametrised; no data). Outputs
go to `$PITCH_BENCH_DIR` (default `build/pitch-benchmark/`, gitignored). The
README has the full command sequence: corpus dump → Syrinx rows (real worker +
hook) → offline trackers → sanity checks → scoring → tables. The session
steps (`sess_detect.py`, `score_sessions.py`, `sanity_sessions.py`, and the
session-oracle references and runs from
[scripts/session-oracle/](../scripts/session-oracle/README.md)) need the
private session recordings, which are not in this repository.

Verified at commit (2026-10-04): the committed `export_corpora.mjs`,
`syrinx_corpus.mjs`, `detectors.py praat_ac` and `swift.py offline` reproduce
the measured outputs byte-for-byte on the parts re-run (corpus dump; FDA
shard 0/2 Syrinx-main; FDA Praat AC and SwiftF0 offline), and
`score_corpora.py` → `score_sessions.py` → `make_tables.py` regenerate every
§5 table from the stored detector outputs.

| file | role |
|---|---|
| `export_corpora.mjs` | corpus dump via the project loaders |
| `syrinx_corpus.mjs`, `run_syrinx_corpora.sh` | real Syrinx chain over the corpora (posted, painted, decoded, confidence per hop) |
| `detectors.py`, `run_py_corpora.sh` | Praat AC / CC, pYIN, PENN, CREPE wrappers |
| `swift.py` | SwiftF0 offline and retired-production streaming |
| `sess_detect.py` | offline trackers on session spans |
| `score_corpora.py`, `score_sessions.py` | metrics, offset sweep, reference conventions |
| `sanity_baseline.py`, `sanity_sessions.py`, `mireval_check.py` | reproduction and cross-checks |
| `timing.py`, `timing_syrinx.py` | CPU per second of audio |
| `make_tables.py` | the §5 tables |
