# Custom voice-vs-machine detector — training and selection (2026-10-06)

Branch `voice-detector`. This is step 2 of the custom detector, the training
step. It follows the pre-registration
([voice-detector-custom-preregistration-2026-10-06.md](voice-detector-custom-preregistration-2026-10-06.md)),
which was committed as 978ef5f before any data or model existed. The data step
is 4c93913.

- Code: [scripts/voice-detector/train/](../scripts/voice-detector/train/README.md).
- Audio, packed data, checkpoints and ONNX files stay under `build/vad-train/`
  (gitignored). No weights are committed.
- The private session recordings were not read.
- No PR was opened.

## Status

**Round 2 (2026-10-07): a second model was trained, frozen and evaluated — it passes V1, V3 and V4 and fails V2 (27.99 / 27.82 / 31.67 % removed); see "Round 2" at the end and the evaluation note.** **Evaluated 2026-10-07: the frozen model does not pass the pre-registered bar** (V1 fails in three voice-in-noise cells, worst male 0 dB lead 0 at 6.88 %; V2, V3 and V4 pass, 79.58 / 74.48 / 75.38 % removed). Verdict, full table and post-hoc trade-off: [voice-detector-custom-2026-10-06.md](voice-detector-custom-2026-10-06.md). The status text below is as written at the freeze.

**Historical (superseded 2026-10-07):** A model is frozen, and the evaluation look has not been taken yet.

The frozen model is run `r5-bighard`, step 10,000, EMA weights:

- 89,257 parameters;
- streaming ONNX file of 1,485,034 B, sha256 `4230d27a8dc336dccc7b30afb53941998471f8b1fb5a444b66bc96869ca8c23d`;
- operating point: **agg `mean`, p ≥ 0.30, hangover 3,000 ms**;
- frozen `candidate.json`:
  [scripts/voice-detector/train/frozen/candidate.json](../scripts/voice-detector/train/frozen/candidate.json).

The pre-registered rule chose it among 30 checkpoints of 7 training runs,
using only the selection data: the val split plus the 194-clip tuning split.

| | frozen model | limit used for selection | bar (evaluation, not yet run) |
|---|---|---|---|
| tuning-194 V2: false painted hops removed (objective) | **82.36 %** | maximise | ≥ 60 % on all 279, ≥ 50 % on each held-out set |
| val, clean groups (worse gender): speech / vowels / singing | 0.48 (MDVR-KCL, gender unknown) / 0.17 / 0.03 % | ≤ 0.5 % | ≤ 1 % per V1 set |
| val mixes (worse gender): +10 dB 20 s lead / 0 dB 20 s lead / +10 dB lead 0 / 0 dB lead 0 | 0.07 / 1.22 / 0.12 / 1.27 % | ≤ 1.5 % | ≤ 3 % per cell |
| V3: frame + lookahead; median onset delay (worse gender, val) | 82 ms; 0 ms | ≤ 100 ms | ≤ 100 ms |
| V2 on the val negatives (secondary tie-break) | 92.48 % | — | — |
| V4: licence | MIT (this project's work; attribution file for the CC BY training data) | — | MIT / BSD / Apache-2.0 |
| V4: model size | 1,485,034 B | — | ≤ 5 MB |
| V4: desktop WASM CPU, 1 thread, per 25 ms | 0.62 ms (Node 24) / 0.51 ms (headless Chrome 154) | — | ≤ 2 ms |

These are selection numbers on the validation data. They are not the
verdict. The verdict is the one evaluation look, which the pre-registration
(§3) fixes:

```bash
python scripts/voice-detector/score.py build/vad/cand/custom-vd --json=build/vad/scores/custom-vd.json
```

**Harness candidate written after the freeze.** The freeze (this note and the
frozen `candidate.json`) was committed and pushed as 40d151a. Only after that
did `infer.py --onnx` write the per-stream probability files to
`build/vad/cand/custom-vd/`:

- every harness set: 4,305 streams, 26.8 h;
- the streaming ONNX model with onnxruntime CPU, 1 thread, state carried;
- each stream's own samples, read by `lib/streams.py`, through the pitch
  worker's linear resampler;
- 3 shards of about 2 minutes each.

A metadata-only check (no labels, no scoring) found that every stream's file
covers every frame its last hop needs. `score.py` has not been run on it. That
run is the one evaluation look.

## 1. What was built

### 1.1 Validation streams (pre-registration §3)

The validation streams were built only from the val split of §2.2
(`valsets.py`). They were run through the app's production chain
(`valdump.mjs`): the real pitch worker, DSP worker and `handleAnalysisResult`,
one fresh session per stream. The columns, hop times, reference alignment and
CORRECT / FALSE labels are those of `dump.mjs`.

- **Clean val voice** (`vvoice`, 3,363 streams, 10.7 h). Each recording is
  used whole, at its native rate (16 / 44.1 / 48 kHz), with the Praat AC
  reference of the data step.
  - Speech:
    - LibriSpeech test-clean and test-other, 20 utterances per speaker (the 20
      lowest FNV-1a(id));
    - VCTK val, 13 speakers;
    - MDVR-KCL val, 8 subjects, gender unknown;
    - Coswara val countings.
  - Sustained vowels: Coswara val vowels, 268 participants.
  - Held singing: Cantoría, 4 singers, 14 song parts.
- **Val mixes** (`vmix20` and `vmix0`, 300 streams each). Val voice programs
  are mixed into val negatives, built like the benchmark's mixes
  (`build_mixes.py`):
  - a 20 s noise lead, the program, then a 5 s tail;
  - SNR = voice active RMS (2 %-of-peak rule) / noise RMS over the stream,
    with voice active RMS 0.1;
  - +10 and 0 dB;
  - `vmix0` is the same mix read from the voice start (lead 0);
  - one program per noise clip, kinds rotating:
    - held: one Coswara participant's vowels, gaps 0.15–1 s;
    - speech: one LibriSpeech or VCTK speaker's utterances with 0.3–1.5 s
      pauses, at least 20 s; or a 25 s MDVR-KCL excerpt;
    - singing: a 25 s Cantoría excerpt, at least 50 % voiced;
  - 16 kHz.
- **Val negatives** (`vneg`, 150 clips, first 90 s). The mixes use the same
  clips.
  - 60 FSD50K eval machine / room clips of at least 20 s (lowest FNV-1a(id),
    at most 2 per uploader);
  - 60 `fstrain` val clips of at least 20 s, chosen the same way;
  - 30 synthetic interferers, val seeds 1e9 .. 1e9 + 29, 60 s each.

What the current app paints on the validation streams (`valtable.py`). These
are the selection rule's denominators.

| set | streams | hours | hops | painted | CORRECT | FALSE | WRONG | EDGE | CORRECT f / m / unknown |
|---|---|---|---|---|---|---|---|---|---|
| clean singing | 56 | 2.42 | 348,136 | 218,980 | 186,393 | 892 | 8,343 | 23,352 | 78,421 / 107,972 / 0 |
| clean speech | 2,528 | 5.81 | 836,947 | 556,310 | 331,154 | 24,655 | 35,598 | 164,903 | 144,104 / 158,150 / 28,900 |
| clean vowels | 779 | 2.41 | 347,635 | 220,374 | 188,348 | 11,764 | 9,128 | 11,134 | 45,489 / 142,859 / 0 |
| mixes 0 dB, 20 s lead | 150 | 2.23 | 321,081 | 133,509 | 51,677 | 46,267 | 22,085 | 13,480 | 18,157 / 30,981 / 2,539 |
| mixes +10 dB, 20 s lead | 150 | 2.23 | 321,081 | 148,945 | 73,643 | 47,383 | 11,651 | 16,268 | 25,881 / 44,398 / 3,364 |
| mixes 0 dB, lead 0 | 150 | 1.40 | 201,081 | 108,349 | 50,029 | 20,217 | 24,354 | 13,749 | 17,475 / 30,030 / 2,524 |
| mixes +10 dB, lead 0 | 150 | 1.40 | 201,081 | 124,881 | 73,331 | 23,159 | 12,165 | 16,226 | 25,813 / 44,158 / 3,360 |
| val negatives | 150 | 1.97 | 284,004 | 49,933 | 0 | 49,933 | 0 | 0 | — |

On the val negatives the app paints a false line on 17.6 % of hops. On the
benchmark's 279 clips the clip-mean figure is 23.9 %.

### 1.2 Training (`train.py`)

- **Data**: the train split only (`pack.py`: 58.2 h of voice, 36.6 h of
  non-voice). Added to it:
  - 4,000 synthetic interferer clips (15.5 h, seeds 0–3,999, 13 families,
    `synth.py`);
  - 3,000 shoebox room impulse responses (seeds 0–2,999).
- **Examples**: crops of 4 / 8 / 16 / 32 s, with 768 s of audio per batch.
  - 50 % mixes:
    - a voice segment between 1.5 s and the crop length, inside a looped
      negative;
    - 30 % of them start with the crop (lead 0);
    - SNR (the benchmark's definition) is drawn half from −6..12 dB and half
      from 5..30 dB;
    - 25 % add a second negative.
  - 15 % clean voice crops.
  - 35 % negatives only.
- **Negatives**, as shares of the draws:
  - FSD50K machine / room 25 %;
  - FSD50K other 20 %;
  - `fstrain` 22 %;
  - synthetic 33 %.

  Machine and room material is therefore 80 % of the draws (§1.2 asks for at
  least half).
- **Voice**, as shares of the draws:
  - Coswara vowels 26 %;
  - choir sets 37 % (Dagstuhl ChoirSet, ESMUC, Choral Singing Dataset);
  - LibriSpeech 16 %;
  - VCTK 8 %;
  - Coswara countings 8 %;
  - MDVR-KCL 5 %.

  Within a source, files are drawn in proportion to their voiced time.
- **Augmentation**, on the GPU:
  - speed perturbation of ±6 % on 30 % of examples (pitch and formants move
    together; the labels follow);
  - reverberation on 35 % of voices and 20 % of negatives;
  - random EQ on 60 % of examples:
    - tilt ±3 dB/oct;
    - two peaks of ±9 dB;
    - high-pass 60–300 Hz on 30 %;
    - low-pass 3.4–7.4 kHz on 30 %, half of them near-brickwall, as for
      audio of 8 kHz origin;
  - mixture level −55..−12 dBFS;
  - a noise floor of −85..−60 dBFS.
- **Labels** (§1.1):
  - Positive: the frame centre lies on a Praat-voiced frame of the voice layer
    that is within 30 dB of the recording's 95th-percentile voiced level.
  - A margin of 2 Praat frames (20 ms) on either side of each boundary is
    masked.
  - In a mix, every other frame is negative.
  - In a clean voice crop, only the positives count.
  - Negatives-only crops are all negative.
- **Loss**: BCE with positives weighted 3×, because missing voice costs more.
  - Recipe option `whard_ac`: a negative frame whose 40 ms normalised
    autocorrelation peak over the 75–400 Hz lags exceeds 0.45 gets weight 3×.
    These are frames the pitch detector would likely call voiced. The weight
    is computed on the training mixture itself, so it uses training data only.
  - Optimiser: AdamW, lr 2e-3 with a cosine decay to 1e-4 and a 500-step
    warm-up.
  - Optional weight EMA, decay 0.999.
- **Model** (`model.py`):
  - Input: the 16 kHz stream from the pitch worker's streaming linear
    resampler.
  - Front end: power spectrum of a 32 ms periodic Hann window (40 ms in r7),
    computed as a fixed strided convolution; then a log-mel filterbank, 64
    bands from 50 to 7,800 Hz (80 bands in r7).
  - Three causal 2-D convolutions with batch norm. Their time kernels are 3,
    3 and 1, so the receptive field is 5 frames; each has frequency stride 2.
  - A linear layer, a GRU, and a linear head.
  - Output: one probability per 12.5 ms frame.
  - Frame i covers the 512 resampled samples that end at (i + 1) · 200 − 4.
    It is declared available at 12.375 + 12.5 i ms of stream time, at least
    0.09 ms after its last input sample at any rate of 16 kHz or more.
  - `frame_ms` = 32 + 4 · 12.5 = **82 ms**, within the V3 limit of 100 ms
    (r7: 90 ms). Longer memory is carried only as GRU state (§5).
- **Checks**:
  - The resampler port matches `createStreamingResampler` to 1 ulp at 20,
    22.05, 44.1 and 48 kHz.
  - The streaming ONNX model matches the batch model to ≤ 2e-5 whatever the
    chunk size (1, 2 or 8 frames).
  - onnxruntime-web WASM matches the ONNX CPU reference to 6.3e-6.

## 2. Training runs

All runs use the same data, augmentation and labels. They differ as shown
below. Curves are frame metrics on 12 fixed validation batches (8 s crops from
the val split with val banks and val seeds), every 1,000 steps. The full
curves are in the appendix.

| run | params | config | steps done / planned | AUC at 2k / 6k / 10k / last | TNR at TPR 99 %, at 2k / 6k / 10k / last | EMA TNR at TPR 99 %, at 6k / 10k / last |
|---|---|---|---|---|---|---|
| r1-base | 49,585 | convs [16, 32, 32], GRU 64, 64 mels, 32 ms | 12,000 / 12,000 | 0.9844 / 0.9895 / 0.9926 / 0.9922 | 0.8145 / 0.8368 / 0.8817 / 0.8676 | — |
| r2-big | 89,257 | convs [24, 48, 48], GRU 96, 64 mels, 32 ms | 12,000 / 12,000 | 0.9853 / 0.9908 / 0.9919 / 0.9927 | 0.8005 / 0.8512 / 0.8735 / 0.8831 | — |
| r3-hard | 49,585 | as r1, `whard_ac` 3 | 12,000 / 12,000 | 0.9789 / 0.9892 / 0.9917 / 0.9920 | 0.7023 / 0.8234 / 0.8530 / 0.8574 | — |
| r4-xl | 138,913 | convs [32, 64, 64], GRU 128, EMA | 13,000 / 16,000 † | 0.9835 / 0.9907 / 0.9929 / 0.9936 | 0.7647 / 0.8462 / 0.8840 / 0.8906 | 0.8583 / 0.8886 / 0.8941 |
| **r5-bighard** | 89,257 | as r2, `whard_ac` 3, EMA | 14,000 / 16,000 † | 0.9861 / 0.9890 / 0.9914 / 0.9928 | 0.7767 / 0.8142 / 0.8499 / 0.8698 | 0.8579 / **0.8675** / 0.8739 |
| r6-xlhard | 138,913 | as r4, `whard_ac` 3 | 16,000 / 16,000 | 0.9862 / 0.9906 / 0.9921 / 0.9931 | 0.7913 / 0.8484 / 0.8620 / 0.8833 | 0.8536 / 0.8663 / 0.8832 |
| r7-w640 | 95,433 | as r5 with a 40 ms window and 80 mels (`frame_ms` 90) | 14,000 / 14,000 | 0.9839 / 0.9897 / 0.9915 / 0.9916 | 0.7393 / 0.8330 / 0.8389 / 0.8528 | 0.8556 / 0.8595 / 0.8583 |

† r4 and r5 ran in parallel. Both died at 03:23 in a GPU driver reset
(`nvlddmkm` event 153; the GPU is shared with another project's jobs). Their
saved checkpoints were evaluated as they stood, and neither run was resumed.
Crash resume (`--resume`, with optimiser state) was added afterwards and used
by r6 and r7.

The frame metrics rank the runs differently from the selection objective.
The objective is driven by a few hard val streams that hold the operating
threshold down (§3), not by average frame accuracy.

## 3. Selection (pre-registration §3)

`infer.py` writes each model's probability files on the selection data,
through the app's resampler. `opselect.py` then scores them with score.py's
own alignment, threshold, hangover and onset logic, over a grid fixed before
any model was scored: 24 thresholds × 16 hangovers (0–3 s) × agg (`last`,
`max`, `mean`).

- **Feasible**, all of:
  - every clean val group vetoes ≤ 0.5 % of CORRECTLY painted hops, worse
    gender;
  - every val mix cell vetoes ≤ 1.5 %, worse gender;
  - frame + lookahead ≤ 100 ms;
  - median onset delay ≤ 100 ms.
- **Pick**: the feasible point with the best tuning-194 V2. Ties within 0.5 pp
  go to the shorter hangover.
- **Between models**: the best objective wins. Within 1 pp, the lower WASM
  cost wins, then the higher V2 on the val negatives.

| model (run, step; e = EMA weights) | pick: agg / thr / hangover | tune-194 V2 % (objective) | clean speech / vowels / singing % | mix +10 dB 20 s / 0 dB 20 s / +10 dB lead 0 / 0 dB lead 0 % | onset median ms | val negatives V2 % |
|---|---|---|---|---|---|---|
| r1-s6000 | mean / 0.05 / 400 ms | 63.76 | 0.11 / 0.02 / 0.01 | 0.15 / 1.49 / 0.19 / 1.49 | 0 | 79.44 |
| r1-s9000 | max / 0.13 / 1000 ms | 71.24 | 0.47 / 0.06 / 0.48 | 0.06 / 0.92 / 0.13 / 1.43 | 0 | 84.64 |
| r1-s12000 | max / 0.1 / 250 ms | 70.18 | 0.49 / 0.03 / 0.02 | 0.07 / 0.58 / 0.13 / 0.85 | 0 | 86.51 |
| r2-s6000 | mean / 0.45 / 3000 ms | 77.36 | 0.38 / 0.17 / 0.00 | 0.22 / 1.40 / 0.30 / 1.34 | 0 | 88.30 |
| r2-s9000 | max / 0.16 / 250 ms | 80.90 | 0.50 / 0.15 / 0.03 | 0.19 / 1.45 / 0.23 / 1.19 | 0 | 91.06 |
| r2-s12000 | mean / 0.2 / 200 ms | 80.27 | 0.49 / 0.12 / 0.00 | 0.24 / 0.90 / 0.31 / 0.89 | 0 | 92.78 |
| r3-s6000 | mean / 0.07 / 200 ms | 66.06 | 0.26 / 0.06 / 0.12 | 0.27 / 1.48 / 0.12 / 1.06 | 0 | 82.05 |
| r3-s9000 | mean / 0.1 / 3000 ms | 72.26 | 0.12 / 0.02 / 0.34 | 0.12 / 1.50 / 0.05 / 1.31 | 0 | 78.70 |
| r3-s12000 | mean / 0.07 / 150 ms | 75.70 | 0.49 / 0.06 / 0.29 | 0.36 / 1.14 / 0.21 / 1.07 | 0 | 90.09 |
| r4e-s6000 | mean / 0.5 / 3000 ms | 81.07 | 0.30 / 0.09 / 0.01 | 0.45 / 1.30 / 0.51 / 1.41 | 0 | 93.00 |
| r4e-s10000 | max / 0.25 / 500 ms | 79.70 | 0.49 / 0.07 / 0.09 | 0.09 / 0.75 / 0.09 / 0.67 | 0 | 89.73 |
| r4e-s12000 | last / 0.1 / 200 ms | 76.71 | 0.46 / 0.07 / 0.00 | 0.06 / 0.67 / 0.07 / 0.37 | 0 | 88.43 |
| r4e-s13000 | last / 0.07 / 150 ms | 75.76 | 0.48 / 0.06 / 0.01 | 0.06 / 0.59 / 0.09 / 0.38 | 0 | 86.38 |
| r4-s13000 | max / 0.1 / 200 ms | 75.58 | 0.48 / 0.04 / 0.02 | 0.06 / 0.59 / 0.06 / 0.41 | 0 | 86.15 |
| r5e-s6000 | last / 0.35 / 3000 ms | 78.33 | 0.20 / 0.09 / 0.07 | 0.26 / 1.06 / 0.22 / 1.18 | 0 | 91.21 |
| **r5e-s10000** | **mean / 0.3 / 3000 ms** | **82.36** | 0.48 / 0.17 / 0.03 | 0.07 / 1.22 / 0.12 / 1.27 | 0 | 92.48 |
| r5e-s12000 | max / 0.05 / 250 ms | 75.66 | 0.48 / 0.05 / 0.03 | 0.09 / 0.47 / 0.06 / 0.40 | 0 | 89.62 |
| r5e-s14000 | max / 0.2 / 3000 ms | 76.90 | 0.46 / 0.05 / 0.01 | 0.09 / 0.75 / 0.06 / 0.67 | 0 | 85.16 |
| r5-s14000 | mean / 0.05 / 100 ms | 78.40 | 0.49 / 0.07 / 0.05 | 0.18 / 0.95 / 0.24 / 1.19 | 0 | 91.99 |
| r6e-s6000 | mean / 0.07 / 3000 ms | 61.55 | 0.48 / 0.04 / 0.08 | 0.11 / 0.73 / 0.10 / 0.97 | 0 | 72.62 |
| r6e-s10000 | last / 0.07 / 3000 ms | 60.39 | 0.45 / 0.03 / 0.00 | 0.03 / 0.20 / 0.04 / 0.04 | 0 | 71.60 |
| r6e-s12000 | mean / 0.1 / 3000 ms | 68.41 | 0.45 / 0.03 / 0.00 | 0.04 / 0.50 / 0.04 / 0.45 | 0 | 77.46 |
| r6e-s14000 | mean / 0.07 / 3000 ms | 64.72 | 0.47 / 0.02 / 0.00 | 0.12 / 0.20 / 0.04 / 0.26 | 0 | 72.80 |
| r6e-s16000 | max / 0.07 / 3000 ms | 63.30 | 0.49 / 0.02 / 0.00 | 0.03 / 0.20 / 0.04 / 0.30 | 0 | 72.49 |
| r6-s16000 | last / 0.13 / 3000 ms | 71.14 | 0.45 / 0.03 / 0.00 | 0.05 / 0.45 / 0.05 / 0.69 | 0 | 81.52 |
| r7e-s6000 | mean / 0.1 / 100 ms | 80.28 | 0.44 / 0.12 / 0.01 | 0.27 / 0.87 / 0.42 / 1.47 | 0 | 92.25 |
| r7e-s10000 | max / 0.05 / 200 ms | 69.71 | 0.48 / 0.05 / 0.03 | 0.12 / 0.32 / 0.12 / 0.40 | 0 | 85.59 |
| r7e-s12000 | max / 0.05 / 150 ms | 75.14 | 0.48 / 0.06 / 0.12 | 0.09 / 0.67 / 0.12 / 0.48 | 0 | 88.30 |
| r7e-s14000 | mean / 0.03 / 150 ms | 71.47 | 0.48 / 0.05 / 0.20 | 0.09 / 0.55 / 0.06 / 0.36 | 0 | 86.61 |
| r7-s14000 | last / 0.02 / 200 ms | 66.36 | 0.49 / 0.04 / 0.17 | 0.01 / 0.16 / 0.06 / 0.12 | 0 | 82.66 |

Every model has a feasible point. **The rule picks r5e-s10000** (82.36 %).

- The runner-up, r4e-s6000, scores 81.07 %. It is 1.29 pp lower, outside the
  1 pp window, so the WASM tie-break does not apply.
- Before this table, partial previews were run on incomplete val data:
  r1-s4000 (82 %) and the r4e / r5e step-6000 checkpoints. They were never
  selection candidates.
- **What binds**: at almost every pick the limiting row is the clean speech
  group of unknown gender. That group is MDVR-KCL, 8 subjects and 28,900
  CORRECT hops, at 0.45–0.50 %. Together with a few hard streams it holds the
  threshold low. Without it the objective would be higher, but the rule is as
  pre-registered.
- **Variance across checkpoints is large**: up to 10 pp within a run. The
  objective at the half-limits is set by a handful of val streams. A model
  that grows more confident in rejecting them is forced down to a lower
  threshold. Two examples:
  - a Coswara counting whose Praat-voiced frames are a steady 250 Hz tone
    (F0 p05–p95 244–253 Hz);
  - an MDVR spontaneous dialogue with a distant second voice.

**Frozen point on the validation data** (`valpoint.py`; ONNX streaming
outputs):

| val group / cell | CORRECT hops f / m / unknown | vetoed % f | m | unknown |
|---|---|---|---|---|
| clean singing | 78,421 / 107,972 / 0 | 0.03 | 0.00 | — |
| clean speech | 144,104 / 158,150 / 28,900 | 0.00 | 0.06 | 0.48 |
| clean vowels | 45,489 / 142,859 / 0 | 0.02 | 0.17 | — |
| mixes +10 dB, 20 s lead | 25,881 / 44,398 / 3,364 | 0.00 | 0.07 | 0.00 |
| mixes 0 dB, 20 s lead | 18,157 / 30,981 / 2,539 | 0.07 | 0.18 | 1.22 |
| mixes +10 dB, lead 0 | 25,813 / 44,158 / 3,360 | 0.00 | 0.10 | 0.12 |
| mixes 0 dB, lead 0 | 17,475 / 30,030 / 2,524 | 0.34 | 0.76 | 1.27 |

| val negatives (falsely painted hops vetoed) | false hops | vetoed % |
|---|---|---|
| all 150 | 49,933 | 92.48 |
| FSD50K eval machine / room (60) | 9,553 | 82.27 |
| `fstrain` val (60) | 28,450 | 94.36 |
| synthetic, val seeds (30) | 11,930 | 96.17 |

## 4. The frozen model

- **Checkpoint**: `build/vad-train/train/runs/r5-bighard/ckpt_ema_010000.pt`,
  sha256 `222df07735c291c001134aae29b022a1d2fa8a9f42488b244f6d5ad21027c387`.
  The state dict's sha256 is `e17d09f7b6ad10464cdbe1232e13c9575455a809f64182c44fd52f674ddaf26d`;
  it is also stored in the ONNX metadata.
- **Deployable model**: `build/vad-train/model/custom-vd.onnx`, opset 17,
  1,485,034 B, sha256 `4230d27a8dc336dccc7b30afb53941998471f8b1fb5a444b66bc96869ca8c23d`.
  - Streaming inputs: `chunk` [1, N·200], `ctx` [1, 312], `s0` [1, 1, 2, 64],
    `s1` [1, 24, 2, 32], `s2` [1, 48, 1, 16], `h` [1, 1, 96].
  - Outputs: `p` [1, N] plus the carried state.
- **The operating point was re-checked on the deployable artifact.** The
  selection used GPU torch outputs. Long streams differ from the CPU ONNX
  outputs by up to 1e-3 (GPU float arithmetic accumulating in the GRU state). The rule was therefore re-run on
  the streaming-ONNX outputs, and gives the same pick with the same numbers
  (`r5e-s10000-onnx` in the table).
- **Candidate interface**:

  | field | value |
  |---|---|
  | `hop_ms` | 12.5 |
  | `first_avail_ms` | 12.375 |
  | `frame_ms` | 82 |
  | `lookahead_ms` | 0 |
  | `threshold` | 0.3 |
  | `hangover_ms` | 3000 |
  | `agg` | `mean` |

- **V4**:
  - Licence: MIT. This is the project's own work. The licence text and an
    attribution file built from the manifest are written next to the weights
    (`attribution.py`: `build/vad-train/model/LICENSE` and `ATTRIBUTION.md`).
    - Training data: 33,299 files, CC BY 4.0, CC BY 3.0 and CC0.
    - 1,070 Freesound uploaders are credited per clip.
  - Desktop WASM CPU (`wasm_bench.mjs`): onnxruntime-web 1.30.0, WASM EP,
    1 thread. One `session.run` per 25 ms of audio (400 samples, 2 frames),
    with state carried, over 6 × 60 s of 16 kHz validation streams, on an
    i9-11900K under load.
    - Node 24: 0.623 ms per 25 ms, 0.628 ms wall.
    - Headless Chrome 154: 0.509 ms per 25 ms, 0.520 ms wall. Chrome ran with
      a temporary `--user-data-dir` and was closed by its own PID.
  - WASM probabilities match the ONNX CPU reference files to 6.3e-6.
  - Mobile: not measured. With the benchmark's desktop-to-mobile ratios,
    about 1.5–3 ms per 25 ms (estimated; V4 does not require it).

## 5. Departures and notes

1. **Val mixes: one program per noise clip** (300 per lead variant). The first
   build had two programs per clip (600 per lead variant). It was cut to one
   to halve the production-chain cost. The machine is shared, and a resource
   governor kept suspending the dump jobs. The cut was made after a partial
   preview on clean val voice only. No mix had been dumped or scored, so no
   mix result informed it. The pre-registration did not fix the number of
   mixes.
2. **Hard-negative mining.** Running the production chain over the 36.6 h of
   training negatives was not done, for the same cost reason. Instead,
   `whard_ac` weights negative frames by a periodicity proxy computed on the
   training mixture. This uses training data only, as §1.2 requires. Runs r3
   and r5–r7 use it.
3. **What the selection read of the 279 clips.** The selection tools read the
   metadata JSON of every `noise` dump to keep only `split == "tune"`. No
   held-out clip's per-hop dump, audio or model output was read. Held-out B,
   the evaluation voice sets and the evaluation mixes were not read at all.
4. **Label noise in the validation data** is counted as the rule says. One
   Coswara counting is Praat-voiced only on a steady 250 Hz tone, and the
   model rejects it (85.5 % of its 76 CORRECT hops).
5. **The selection grid** (24 thresholds, 16 hangovers of 0–3 s, 3 aggs) was
   fixed when `opselect.py` was written, before any model was scored. The
   frozen point's 3 s hangover is the largest hangover in the grid.
6. **Shared machine.** A resource governor suspended training and dump jobs
   whenever total CPU passed 90 %. This cost time but not correctness: every
   job is resumable or was re-run.

## 6. Reproduction (repo root)

```bash
VENV=build/vad-train/venv/Scripts/python.exe   # CUDA PyTorch 2.11 (cu128) + onnx / onnxruntime
python scripts/voice-detector/train/pack.py && python scripts/voice-detector/train/valsets.py
MAXJ=2 bash scripts/voice-detector/train/run-valdumps.sh
python scripts/voice-detector/train/valtable.py
(cd scripts/voice-detector/train && $VENV train.py --name=r5-bighard --steps=16000 --ema=0.999 --whard_ac=3 --seed=5 \
   --cfg='{"convs":[[24,3],[48,3],[48,1]],"gru":96}')                       # the other runs: §2 configs
$VENV scripts/voice-detector/train/infer.py --ckpt=build/vad-train/train/runs/r5-bighard/ckpt_ema_010000.pt --out=build/vad-train/cand/r5e-s10000 --root=build/vad --sets=noise --split=tune
$VENV scripts/voice-detector/train/infer.py --ckpt=build/vad-train/train/runs/r5-bighard/ckpt_ema_010000.pt --out=build/vad-train/cand/r5e-s10000
python scripts/voice-detector/train/opselect.py build/vad-train/cand/r5e-s10000 --json=...
$VENV scripts/voice-detector/train/export.py --ckpt=build/vad-train/train/runs/r5-bighard/ckpt_ema_010000.pt --out=build/vad-train/model/custom-vd.onnx
node scripts/voice-detector/train/wasm_bench.mjs --ort=<dir with onnxruntime-web 1.30> --model=build/vad-train/model/custom-vd.onnx --ref=<onnx val files> --shapes='<json>' [--mode=chrome]
python scripts/voice-detector/train/attribution.py --out=build/vad-train/model
# after the freeze commit: the harness candidate, every set
$VENV scripts/voice-detector/train/infer.py --onnx=build/vad-train/model/custom-vd.onnx --out=build/vad/cand/custom-vd --root=build/vad \
   --sets=noise,noiseho,vin20,vin0,fda,ptdb,voc,hil,vocalset,pvqd,voiced
```

## Appendix: training curves

**r1-base** (49,585 parameters; cfg {"n_mels": 64, "convs": [[16, 3], [32, 3], [32, 1]], "gru": 64, "gru_layers": 1, "fc": 64, "fmin": 50.0, "fmax": 7800.0}; args {"steps": "12000"})

| step | loss | AUC | TPR@FPR10 | TNR@TPR99 | noise p mean | EMA AUC | EMA TNR@TPR99 |
|---|---|---|---|---|---|---|---|
| 0 | 0.0000 | 0.6691 | 0.2469 | 0.0364 | 0.5058 | — | — |
| 1000 | 0.2951 | 0.9743 | 0.9393 | 0.7313 | 0.0707 | — | — |
| 2000 | 0.1685 | 0.9844 | 0.9659 | 0.8145 | 0.0882 | — | — |
| 3000 | 0.1487 | 0.9874 | 0.9726 | 0.7934 | 0.0543 | — | — |
| 4000 | 0.1383 | 0.9870 | 0.9715 | 0.8154 | 0.0634 | — | — |
| 5000 | 0.1307 | 0.9889 | 0.9790 | 0.8302 | 0.0382 | — | — |
| 6000 | 0.1243 | 0.9895 | 0.9780 | 0.8368 | 0.0466 | — | — |
| 7000 | 0.1205 | 0.9916 | 0.9869 | 0.8838 | 0.0565 | — | — |
| 8000 | 0.1141 | 0.9912 | 0.9830 | 0.8563 | 0.0421 | — | — |
| 9000 | 0.1105 | 0.9917 | 0.9831 | 0.8452 | 0.0279 | — | — |
| 10000 | 0.1088 | 0.9926 | 0.9869 | 0.8817 | 0.0477 | — | — |
| 11000 | 0.1055 | 0.9924 | 0.9866 | 0.8824 | 0.0439 | — | — |
| 12000 | 0.1050 | 0.9922 | 0.9852 | 0.8676 | 0.0403 | — | — |

**r2-big** (89,257 parameters; cfg {"n_mels": 64, "convs": [[24, 3], [48, 3], [48, 1]], "gru": 96, "gru_layers": 1, "fc": 64, "fmin": 50.0, "fmax": 7800.0}; args {"steps": "12000", "cfg": "{\"convs\":[[24,3],[48,3],[48,1]],\"gru\":96}"})

| step | loss | AUC | TPR@FPR10 | TNR@TPR99 | noise p mean | EMA AUC | EMA TNR@TPR99 |
|---|---|---|---|---|---|---|---|
| 0 | 0.0000 | 0.5249 | 0.1010 | 0.0403 | 0.4865 | — | — |
| 1000 | 0.2835 | 0.9782 | 0.9471 | 0.7304 | 0.0708 | — | — |
| 2000 | 0.1613 | 0.9853 | 0.9682 | 0.8005 | 0.0933 | — | — |
| 3000 | 0.1442 | 0.9872 | 0.9721 | 0.8177 | 0.0676 | — | — |
| 4000 | 0.1327 | 0.9879 | 0.9770 | 0.8289 | 0.0593 | — | — |
| 5000 | 0.1266 | 0.9889 | 0.9769 | 0.8329 | 0.0521 | — | — |
| 6000 | 0.1190 | 0.9908 | 0.9827 | 0.8512 | 0.0505 | — | — |
| 7000 | 0.1151 | 0.9913 | 0.9841 | 0.8732 | 0.0387 | — | — |
| 8000 | 0.1101 | 0.9917 | 0.9862 | 0.8756 | 0.0430 | — | — |
| 9000 | 0.1069 | 0.9921 | 0.9869 | 0.8773 | 0.0394 | — | — |
| 10000 | 0.1032 | 0.9919 | 0.9859 | 0.8735 | 0.0422 | — | — |
| 11000 | 0.1017 | 0.9924 | 0.9875 | 0.8819 | 0.0478 | — | — |
| 12000 | 0.1001 | 0.9927 | 0.9880 | 0.8831 | 0.0454 | — | — |

**r3-hard** (49,585 parameters; cfg {"n_mels": 64, "convs": [[16, 3], [32, 3], [32, 1]], "gru": 64, "gru_layers": 1, "fc": 64, "fmin": 50.0, "fmax": 7800.0}; args {"steps": "12000", "whard_ac": "3"})

| step | loss | AUC | TPR@FPR10 | TNR@TPR99 | noise p mean | EMA AUC | EMA TNR@TPR99 |
|---|---|---|---|---|---|---|---|
| 0 | 0.0000 | 0.6691 | 0.2469 | 0.0364 | 0.5058 | — | — |
| 1000 | 0.3027 | 0.9804 | 0.9535 | 0.7530 | 0.0511 | — | — |
| 2000 | 0.1800 | 0.9789 | 0.9451 | 0.7023 | 0.0520 | — | — |
| 3000 | 0.1590 | 0.9866 | 0.9677 | 0.7858 | 0.0374 | — | — |
| 4000 | 0.1473 | 0.9876 | 0.9714 | 0.7904 | 0.0403 | — | — |
| 5000 | 0.1415 | 0.9886 | 0.9747 | 0.8023 | 0.0398 | — | — |
| 6000 | 0.1333 | 0.9892 | 0.9756 | 0.8234 | 0.0514 | — | — |
| 7000 | 0.1294 | 0.9916 | 0.9845 | 0.8684 | 0.0351 | — | — |
| 8000 | 0.1238 | 0.9908 | 0.9807 | 0.8496 | 0.0373 | — | — |
| 9000 | 0.1204 | 0.9903 | 0.9821 | 0.8428 | 0.0277 | — | — |
| 10000 | 0.1175 | 0.9917 | 0.9829 | 0.8530 | 0.0334 | — | — |
| 11000 | 0.1157 | 0.9918 | 0.9829 | 0.8540 | 0.0321 | — | — |
| 12000 | 0.1140 | 0.9920 | 0.9835 | 0.8574 | 0.0308 | — | — |

**r4-xl** (138,913 parameters; cfg {"n_mels": 64, "convs": [[32, 3], [64, 3], [64, 1]], "gru": 128, "gru_layers": 1, "fc": 64, "fmin": 50.0, "fmax": 7800.0}; args {"steps": "16000", "ema": "0.999", "cfg": "{\"convs\":[[32,3],[64,3],[64,1]],\"gru\":128}"})

| step | loss | AUC | TPR@FPR10 | TNR@TPR99 | noise p mean | EMA AUC | EMA TNR@TPR99 |
|---|---|---|---|---|---|---|---|
| 0 | 0.0000 | 0.5150 | 0.0831 | 0.0023 | 0.4905 | 0.5150 | 0.0023 |
| 1000 | 0.2700 | 0.9801 | 0.9581 | 0.7672 | 0.1051 | 0.9817 | 0.7478 |
| 2000 | 0.1604 | 0.9835 | 0.9642 | 0.7647 | 0.0818 | 0.9886 | 0.8271 |
| 3000 | 0.1433 | 0.9889 | 0.9735 | 0.8160 | 0.0510 | 0.9900 | 0.8347 |
| 4000 | 0.1325 | 0.9884 | 0.9745 | 0.8115 | 0.0721 | 0.9908 | 0.8428 |
| 5000 | 0.1265 | 0.9887 | 0.9743 | 0.7974 | 0.0671 | 0.9911 | 0.8524 |
| 6000 | 0.1216 | 0.9907 | 0.9805 | 0.8462 | 0.0474 | 0.9917 | 0.8583 |
| 7000 | 0.1154 | 0.9921 | 0.9849 | 0.8748 | 0.0362 | 0.9921 | 0.8652 |
| 8000 | 0.1115 | 0.9924 | 0.9861 | 0.8701 | 0.0562 | 0.9928 | 0.8804 |
| 9000 | 0.1076 | 0.9927 | 0.9872 | 0.8810 | 0.0338 | 0.9930 | 0.8813 |
| 10000 | 0.1040 | 0.9929 | 0.9873 | 0.8840 | 0.0469 | 0.9935 | 0.8886 |
| 11000 | 0.1016 | 0.9928 | 0.9867 | 0.8802 | 0.0524 | 0.9937 | 0.8923 |
| 12000 | 0.0983 | 0.9933 | 0.9887 | 0.8922 | 0.0352 | 0.9935 | 0.8922 |
| 13000 | 0.0962 | 0.9936 | 0.9888 | 0.8906 | 0.0394 | 0.9935 | 0.8941 |

**r5-bighard** (89,257 parameters; cfg {"n_mels": 64, "convs": [[24, 3], [48, 3], [48, 1]], "gru": 96, "gru_layers": 1, "fc": 64, "fmin": 50.0, "fmax": 7800.0}; args {"steps": "16000", "ema": "0.999", "whard_ac": "3", "seed": "5", "cfg": "{\"convs\":[[24,3],[48,3],[48,1]],\"gru\":96}"})

| step | loss | AUC | TPR@FPR10 | TNR@TPR99 | noise p mean | EMA AUC | EMA TNR@TPR99 |
|---|---|---|---|---|---|---|---|
| 0 | 0.0000 | 0.3336 | 0.0102 | 0.0014 | 0.5269 | 0.3336 | 0.0014 |
| 1000 | 0.2885 | 0.9809 | 0.9515 | 0.7262 | 0.0553 | 0.9837 | 0.7803 |
| 2000 | 0.1727 | 0.9861 | 0.9687 | 0.7767 | 0.0568 | 0.9873 | 0.8147 |
| 3000 | 0.1555 | 0.9882 | 0.9738 | 0.8074 | 0.0364 | 0.9894 | 0.8413 |
| 4000 | 0.1408 | 0.9882 | 0.9725 | 0.8163 | 0.0296 | 0.9903 | 0.8397 |
| 5000 | 0.1350 | 0.9897 | 0.9824 | 0.8471 | 0.0389 | 0.9906 | 0.8422 |
| 6000 | 0.1313 | 0.9890 | 0.9738 | 0.8142 | 0.0199 | 0.9913 | 0.8579 |
| 7000 | 0.1258 | 0.9913 | 0.9849 | 0.8509 | 0.0304 | 0.9921 | 0.8648 |
| 8000 | 0.1206 | 0.9922 | 0.9861 | 0.8721 | 0.0296 | 0.9922 | 0.8584 |
| 9000 | 0.1164 | 0.9921 | 0.9858 | 0.8618 | 0.0312 | 0.9926 | 0.8662 |
| 10000 | 0.1139 | 0.9914 | 0.9831 | 0.8499 | 0.0283 | 0.9923 | 0.8675 |
| 11000 | 0.1105 | 0.9928 | 0.9871 | 0.8783 | 0.0325 | 0.9930 | 0.8758 |
| 12000 | 0.1071 | 0.9923 | 0.9867 | 0.8657 | 0.0287 | 0.9927 | 0.8678 |
| 13000 | 0.1067 | 0.9931 | 0.9874 | 0.8822 | 0.0269 | 0.9929 | 0.8722 |
| 14000 | 0.1034 | 0.9928 | 0.9870 | 0.8698 | 0.0253 | 0.9929 | 0.8739 |

**r6-xlhard** (138,913 parameters; cfg {"n_mels": 64, "convs": [[32, 3], [64, 3], [64, 1]], "gru": 128, "gru_layers": 1, "fc": 64, "fmin": 50.0, "fmax": 7800.0}; args {"steps": "16000", "ema": "0.999", "whard_ac": "3", "seed": "6", "resume": "1", "cfg": "{\"convs\":[[32,3],[64,3],[64,1]],\"gru\":128}"})

| step | loss | AUC | TPR@FPR10 | TNR@TPR99 | noise p mean | EMA AUC | EMA TNR@TPR99 |
|---|---|---|---|---|---|---|---|
| 0 | 0.0000 | 0.3658 | 0.0115 | 0.0029 | 0.4865 | 0.3658 | 0.0029 |
| 1000 | 0.2858 | 0.9787 | 0.9478 | 0.6817 | 0.0447 | 0.9832 | 0.7733 |
| 2000 | 0.1721 | 0.9862 | 0.9731 | 0.7913 | 0.0402 | 0.9886 | 0.8294 |
| 3000 | 0.1504 | 0.9882 | 0.9735 | 0.7831 | 0.0316 | 0.9897 | 0.8427 |
| 4000 | 0.1384 | 0.9882 | 0.9756 | 0.7910 | 0.0406 | 0.9901 | 0.8294 |
| 5000 | 0.1344 | 0.9894 | 0.9787 | 0.8150 | 0.0410 | 0.9910 | 0.8600 |
| 6000 | 0.1265 | 0.9906 | 0.9805 | 0.8484 | 0.0429 | 0.9916 | 0.8536 |
| 7000 | 0.1219 | 0.9921 | 0.9842 | 0.8617 | 0.0332 | 0.9925 | 0.8704 |
| 8000 | 0.1156 | 0.9919 | 0.9850 | 0.8572 | 0.0266 | 0.9921 | 0.8615 |
| 9000 | 0.1124 | 0.9924 | 0.9867 | 0.8731 | 0.0325 | 0.9923 | 0.8659 |
| 10000 | 0.1100 | 0.9921 | 0.9863 | 0.8620 | 0.0274 | 0.9926 | 0.8663 |
| 11000 | 0.1061 | 0.9933 | 0.9878 | 0.8864 | 0.0309 | 0.9927 | 0.8775 |
| 12000 | 0.1025 | 0.9929 | 0.9881 | 0.8832 | 0.0274 | 0.9930 | 0.8771 |
| 13000 | 0.1015 | 0.9926 | 0.9876 | 0.8789 | 0.0284 | 0.9930 | 0.8802 |
| 14000 | 0.1019 | 0.9930 | 0.9881 | 0.8855 | 0.0212 | 0.9929 | 0.8829 |
| 15000 | 0.0982 | 0.9927 | 0.9875 | 0.8772 | 0.0265 | 0.9930 | 0.8812 |
| 16000 | 0.0978 | 0.9931 | 0.9880 | 0.8833 | 0.0283 | — | — |

**r7-w640** (95,433 parameters; cfg {"n_mels": 80, "convs": [[24, 3], [48, 3], [48, 1]], "gru": 96, "gru_layers": 1, "fc": 64, "fmin": 50.0, "fmax": 7800.0, "win": 640}; args {"steps": "14000", "ema": "0.999", "whard_ac": "3", "seed": "7", "resume": "1", "cfg": "{\"convs\":[[24,3],[48,3],[48,1]],\"gru\":96,\"n_mels\":80,\"win\":640}"})

| step | loss | AUC | TPR@FPR10 | TNR@TPR99 | noise p mean | EMA AUC | EMA TNR@TPR99 |
|---|---|---|---|---|---|---|---|
| 0 | 0.0000 | 0.4766 | 0.0628 | 0.0135 | 0.4612 | 0.4766 | 0.0135 |
| 1000 | 0.2861 | 0.9791 | 0.9493 | 0.7194 | 0.0826 | 0.9814 | 0.7262 |
| 2000 | 0.1733 | 0.9839 | 0.9677 | 0.7393 | 0.0343 | 0.9876 | 0.8128 |
| 3000 | 0.1555 | 0.9877 | 0.9738 | 0.8027 | 0.0240 | 0.9885 | 0.8193 |
| 4000 | 0.1454 | 0.9879 | 0.9756 | 0.7970 | 0.0357 | 0.9902 | 0.8515 |
| 5000 | 0.1357 | 0.9888 | 0.9762 | 0.8078 | 0.0288 | 0.9907 | 0.8528 |
| 6000 | 0.1299 | 0.9897 | 0.9776 | 0.8330 | 0.0394 | 0.9908 | 0.8556 |
| 7000 | 0.1244 | 0.9909 | 0.9847 | 0.8641 | 0.0317 | 0.9912 | 0.8492 |
| 8000 | 0.1204 | 0.9910 | 0.9833 | 0.8636 | 0.0333 | 0.9912 | 0.8602 |
| 9000 | 0.1160 | 0.9914 | 0.9828 | 0.8499 | 0.0268 | 0.9920 | 0.8705 |
| 10000 | 0.1124 | 0.9915 | 0.9834 | 0.8389 | 0.0290 | 0.9918 | 0.8595 |
| 11000 | 0.1084 | 0.9915 | 0.9843 | 0.8510 | 0.0226 | 0.9918 | 0.8623 |
| 12000 | 0.1039 | 0.9918 | 0.9837 | 0.8490 | 0.0257 | 0.9920 | 0.8600 |
| 13000 | 0.1047 | 0.9915 | 0.9858 | 0.8659 | 0.0252 | 0.9918 | 0.8630 |
| 14000 | 0.1034 | 0.9916 | 0.9830 | 0.8528 | 0.0238 | — | — |


(The last EMA evaluation of r6 and r7 is missing from `log.jsonl` because the line was not flushed before exit; this is fixed in `train.py`. The values are in the console logs: r6 step 16,000 AUC 0.9930, TNR 0.8832; r7 step 14,000 AUC 0.9918, TNR 0.8583.)

## Round 2 (2026-10-07): training and selection

Pre-registration Addenda D (round-2 plan, 0ee0827), E (data step, 93b5414)
and F (staggered state reset, b1e67cf), each committed and pushed before the
step it governs. Selection used only the validation streams and the tuning
194; no round-2 model read an evaluation stream before the freeze.

### What was trained

One recipe, two seeds (`train.py`, 16,000 steps each, 73 and 82 minutes on the
shared RTX 3090):

```bash
VS='{"librispeech":0.12,"vctk":0.06,"coswara_counting":0.06,"coswara_vowel":0.18,"mdvr":0.04,"dcs":0.09,"esmuc":0.09,"csd":0.08,"svd":0.14,"singbap":0.07,"imitations":0.02,"kids":0.02,"fsvoice":0.03}'
(cd scripts/voice-detector/train && $VENV train.py --name=r8a --seed=11 --steps=16000 --ema=0.999 --whard_ac=3 --vtag=r2 \
   --p_rough=0.2 --p_breath=0.15 --p_state=0.75 --bank=8192 --cfg='{"convs":[[24,3],[48,3],[48,1]],"gru":96}' --vsrc="$VS")   # r8b: --seed=12
```

It is the round-1 `r5-bighard` recipe (89,257 parameters, `frame_ms` 82) plus
the round-2 positives (78.06 h of training voice instead of 58.2 h), the
roughness / breathiness resynthesis of the voice layer and the GRU state bank.

### Validation data the rule now reads

What the current app paints on the selection streams (`valtable.py`; the
round-1 rows are unchanged):

| set | streams | hours | CORRECT hops f / m / unknown |
|---|---|---|---|
| clean speech / vowels / singing (round 1) | 2,528 / 779 / 56 | 5.81 / 2.41 / 2.42 | as round 1 |
| clean clinical (SVD) | 249 | 2.35 | 93,832 / 90,130 / 0 |
| clean exercises (SingBAP, Freesound) | 895 | 1.33 | 0 / 0 / 140,421 |
| clean children | 112 | 0.28 | 5,729 / 2,969 / 0 |
| mixes, each SNR × lead variant (round 1 + round 2) | 300 | 3.53–5.20 | 37,749–56,773 / 48,614–69,915 / 20,535–31,114 |
| val negatives | 150 | 1.97 | — (49,933 FALSE hops) |

Carried-state files: every selection stream (6,163) resampled to 16 kHz and
concatenated in a seeded order (seed 20261007) into 207 sessions of at least
10 minutes, 36.5 h (`infer_carried.py`).

### Selection (D.4 with the reset of Addendum F)

`opselect.py --carried` on the fresh and carried files of every candidate
(`run-r2-select.sh`; GPU torch outputs; the long carried sessions run in
20,000-frame chunks through the streaming form, within 4e-5 of the batch form).
Each row is the rule's pick if a feasible point exists, else its fallback (the
point with the smallest worst vetoes / limit ratio over fresh and carried):

| model | rule pick (agg / p / hangover) | tune-194 V2 % | fresh worst clean / mix % | carried: speech / vowels / singing / clinical / exercises / children | carried mix vmix20 +10 / vmix20 +0 / vmix0 +10 / vmix0 +0 | vneg V2 % |
|---|---|---|---|---|---|---|
| r8ae-s10000 | fallback: last / 0.01 / 3 s | 21.71 | 0.23 / 0.36 | 0.13 / 0.20 / 0.00 / 1.04 / 0.35 / 0.40 | 0.09 / 1.79 / 0.18 / 0.51 | 43.20 |
| r8ae-s10000-st10 | PICK: max / 0.02 / 1 s | 24.50 | 0.12 / 0.64 | 0.07 / 0.29 / 0.00 / 0.26 / 0.46 / 0.28 | 0.03 / 0.68 / 0.04 / 0.79 | 45.90 |
| r8ae-s12000 | fallback: max / 0.01 / 3 s | 21.28 | 0.11 / 0.33 | 0.11 / 0.24 / 0.00 / 1.08 / 0.59 / 0.24 | 0.03 / 1.92 / 0.15 / 0.73 | 42.10 |
| r8ae-s12000-st10 | PICK: mean / 0.02 / 1.5 s | 23.37 | 0.08 / 0.61 | 0.07 / 0.27 / 0.00 / 0.22 / 0.43 / 0.38 | 0.04 / 1.13 / 0.04 / 0.45 | 42.04 |
| r8ae-s14000 | fallback: max / 0.01 / 3 s | 22.11 | 0.11 / 0.33 | 0.17 / 0.35 / 0.00 / 1.03 / 0.82 / 0.21 | 0.04 / 2.43 / 0.15 / 0.66 | 43.43 |
| r8ae-s14000-st10 | PICK: max / 0.02 / 1.5 s | 21.99 | 0.14 / 0.60 | 0.07 / 0.31 / 0.00 / 0.36 / 0.49 / 0.17 | 0.03 / 0.99 / 0.03 / 0.79 | 40.18 |
| r8ae-s16000 | fallback: max / 0.01 / 3 s | 21.96 | 0.31 / 0.38 | 0.17 / 0.39 / 0.00 / 1.16 / 0.74 / 0.21 | 0.04 / 2.81 / 0.15 / 0.98 | 42.58 |
| r8ae-s16000-st10 | PICK: max / 0.02 / 1.25 s | 24.16 | 0.19 / 0.37 | 0.08 / 0.36 / 0.00 / 0.37 / 0.47 / 0.12 | 0.04 / 1.16 / 0.03 / 0.71 | 44.11 |
| r8ae-s8000 | fallback: last / 0.01 / 3 s | 19.45 | 0.12 / 0.28 | 0.06 / 0.64 / 0.00 / 1.04 / 0.31 / 0.42 | 0.08 / 0.79 / 0.03 / 0.53 | 39.13 |
| r8ae-s8000-st10 | PICK: last / 0.03 / 1.25 s | 28.09 | 0.32 / 0.60 | 0.07 / 0.40 / 0.00 / 0.44 / 0.48 / 0.45 | 0.04 / 0.95 / 0.05 / 0.45 | 47.94 |
| r8be-s10000 | fallback: max / 0.01 / 3 s | 20.30 | 0.35 / 0.36 | 0.09 / 0.11 / 0.00 / 0.59 / 2.32 / 0.33 | 0.08 / 0.31 / 0.23 / 0.73 | 34.37 |
| r8be-s10000-st10 | PICK: mean / 0.02 / 2 s | 9.66 | 0.03 / 0.00 | 0.04 / 0.07 / 0.00 / 0.06 / 0.49 / 0.47 | 0.00 / 0.07 / 0.03 / 0.03 | 23.56 |
| r8be-s12000 | fallback: max / 0.01 / 3 s | 20.05 | 0.22 / 0.25 | 0.09 / 0.10 / 0.00 / 0.57 / 2.06 / 0.40 | 0.07 / 0.31 / 0.20 / 0.56 | 32.65 |
| r8be-s12000-st10 | PICK: mean / 0.02 / 2 s | 9.33 | 0.00 / 0.07 | 0.05 / 0.06 / 0.00 / 0.00 / 0.46 / 0.45 | 0.00 / 0.01 / 0.00 / 0.05 | 24.66 |
| r8be-s14000 | fallback: max / 0.01 / 3 s | 25.31 | 0.35 / 0.34 | 0.11 / 0.28 / 0.00 / 1.04 / 3.68 / 0.72 | 0.16 / 1.60 / 0.46 / 1.11 | 35.84 |
| r8be-s14000-st10 | PICK: mean / 0.02 / 3 s | 7.80 | 0.09 / 0.21 | 0.06 / 0.04 / 0.00 / 0.12 / 0.46 / 0.47 | 0.00 / 0.01 / 0.01 / 0.03 | 18.94 |
| r8be-s16000 | fallback: max / 0.01 / 3 s | 28.72 | 0.35 / 0.27 | 0.16 / 0.92 / 0.00 / 1.08 / 3.95 / 0.47 | 0.14 / 1.51 / 0.32 / 1.60 | 39.94 |
| r8be-s16000-st10 | PICK: max / 0.01 / 1.25 s | 6.93 | 0.04 / 0.02 | 0.06 / 0.13 / 0.00 / 0.05 / 0.49 / 0.37 | 0.00 / 0.00 / 0.00 / 0.03 | 20.03 |
| r8be-s8000 | fallback: max / 0.01 / 3 s | 18.42 | 0.34 / 0.42 | 0.12 / 0.18 / 0.00 / 0.96 / 2.03 / 0.40 | 0.20 / 0.47 / 0.33 / 0.62 | 34.75 |
| r8be-s8000-st10 | PICK: max / 0.02 / 1.5 s | 9.16 | 0.09 / 0.13 | 0.05 / 0.07 / 0.00 / 0.07 / 0.47 / 0.44 | 0.03 / 0.15 / 0.01 / 0.02 | 26.14 |

- **Without the reset no candidate is feasible.** With fresh state each one
  meets the limits at a low threshold, but on the carried sessions even the
  most permissive grid point leaves `clinical` at 0.57–1.16 %, `exercises` up
  to 3.95 % and, for r8a after step 8,000, vmix20 0 dB at 1.79–2.81 %. The
  carried vetoes do not shrink with training; for r8b they grow. The state
  bank did not teach the model to recover from a scene change within the
  hangover.
- **With the reset every candidate is feasible**, but only at thresholds of
  0.01–0.03 with hangovers of 1–3 s, where little noise is vetoed: 6.9–28.1 %
  of the tuning-194 false line. What binds is the carried `exercises`,
  `children`, `clinical` and `vowels` groups (0.40–0.49 % at the pick); the
  fresh files alone would allow more (a fresh-only rule run for information
  on five of the checkpoints without the reset gives 32–47 %, `clinical`
  binding).
- **The rule picks r8a, step 8,000, EMA weights, with the reset (T = 10 s),
  at agg `last`, p ≥ 0.03, hangover 1,250 ms**: tuning-194 V2 28.09 %. The
  runner-up, r8a step 10,000 with the reset, scores 24.50 %, outside the 1 pp
  window. The round-1 frozen model scored on the same selection data has no
  feasible point (fallback ratio 2.25).

### The frozen round-2 candidate

- **Checkpoint**: `build/vad-train/train/runs/r8a/ckpt_ema_008000.pt`, sha256
  `60fb603152b899f66aa36b851af7c1e5f266fca457a602b2a081efabe83d09bc`; state
  dict sha256 `2098116f6bb40fee28bf31ee5b5aae27a191add91ed08f5a2fe9882c888f888f`
  (in the ONNX metadata).
- **Deployable model**: `build/vad-train/model-r2/custom-vd-r2.onnx`, the same
  streaming interface as round 1, 1,485,026 B, sha256
  `4f3f3f989bc191b9688d64e7b5a0b5e5711b15adf6d10efe51804a96931249fe`; batch
  torch vs streaming ONNX ≤ 6.8e-6.
- **Gate as deployed**: the staggered state reset (T = 10 s: two copies, GRU
  state reset every 20 s, offset 10 s, p = max), agg `last`, **p ≥ 0.03,
  hangover 1,250 ms**.
- **Re-checked on the deployable file**: the selection data re-run with the
  streaming ONNX model (onnxruntime CPU, both copies; fresh and carried) gives
  the same pick, tuning-194 V2 28.08 % (torch 28.09 %), worst fresh clean /
  mix 0.32 / 0.60 %, worst carried clean / mix 0.48 / 0.95 %. ONNX vs GPU
  torch: max |Δp| 2.8e-3 (fresh) and 2.2e-3 (carried); 228 of 9.78 M and 147
  of 5.59 M frames change side of p = 0.03.
- **V4**: MIT (`build/vad-train/model-r2/LICENSE`, `ATTRIBUTION.md` with
  per-clip titles and licence URLs; 36,939 training files, 1,091 CC BY
  uploaders); 1,485,026 B; onnxruntime-web WASM, 1 thread, **two runs per
  25 ms**: 1.57 ms (Node 24, wall 1.58) and 1.67 ms (headless Chrome 154,
  wall 1.71) per 25 ms, measured with the shared machine at 73–96 % CPU from
  other jobs. Bar 2 ms.
- **Frozen candidate file**:
  [scripts/voice-detector/train/frozen/candidate-r2.json](../scripts/voice-detector/train/frozen/candidate-r2.json),
  committed before any evaluation stream was read.

At the frozen point the selection data already predict a V2 failure: 28 % of
the tuning-194 false line removed, against the bar's 60 % on the 279. The
look is taken anyway, as Addendum D.5 fixes.
