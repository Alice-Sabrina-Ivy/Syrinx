# Gender worker: per-chunk vs streaming resampler — 2026-10-03

## Motivation

`gender-worker.js` resampled each 25 ms capture chunk independently with
`resampleLinear`, restarting the fractional read phase at 0 every chunk.
At integer ratios (48 / 32 / 96 kHz → 16 kHz) that is harmless, but at
44.1 kHz a 1102-sample chunk yields 399 outputs that consume only
399 × 2.75625 = 1099.74 input samples: **~2.26 input samples are spliced
out at every chunk boundary** (0.18 % time compression plus a waveform
discontinuity 40×/s). `pitch-worker.js` already moved to
`createStreamingResampler` (audio-utils, 2026-07-20) for the same defect,
where it was a measured +0.094 % pitch bias. `gender-worker.js` is
measurement-gated (CLAUDE.md hard rule 3), so this file records the
numbers behind switching it over too.

## Method

Paired comparison at identical inference instants, one model, three
input paths:

- **A** — production before: 44.1 kHz signal chunked at 1102 samples,
  per-chunk `resampleLinear` → 16 kHz.
- **B** — fix: same chunks through `createStreamingResampler(44100, 16000)`
  (sample-identical to resampling the whole stream at once).
- **R** — reference: the original 16 kHz signal (what the Hillenbrand
  oracle feeds the model).

Signals: the 93 Hillenbrand speakers (per-speaker vowel concatenation
with 50 ms gaps, as `tests/ml/perceived-voice-hillenbrand-test.js`) plus
60 × 3 s raised-voice segments of Alice from the held-out 2026-06-09
session (frames with reference F0 ≥ 160 Hz). Each was upsampled
16 → 44.1 kHz with scipy `resample_poly(441, 160)` (band-limited, so R is
a fair reference). 0.75 s rolling window, 150 ms audio-time hop, a
peak >= 0.05 gate (VAD_PEAK_THRESHOLD) evaluated on R so all three paths
score the same windows; model `voice-gender-classifier-onnx-q8-v2` (q8, Node ORT).
Scores are the 0–1 female probability; EMA is the production α = 0.2.

Run by a verifier on 2026-10-03 (3803 windows) and **re-run for this
file** group by group (Hillenbrand, Alice raised) from the same harness
and data: every per-group number reproduced exactly at the printed
precision; the overall rows below are the verifier's combined run,
consistent with the two re-run groups. Harness + data are scratch
(`build/`, gitignored): `compare.mjs`, `make44k.py`, 44.1 kHz/16 kHz f32
signal pairs.

## Numbers (3803 windows: Hillenbrand 3439 + Alice raised 364)

| metric | A (per-chunk) | B (streaming) |
|---|---|---|
| raw \|score − R\| mean | 0.0094 | **0.0037** |
| raw \|score − R\| p95 | 0.0365 | **0.0134** |
| raw \|score − R\| max | 0.556 | 0.228 |
| windows on the other side of 0.5 vs R | 11 | **1** |
| EMA \|score − R\| mean | 0.0059 | **0.0021** |
| Hillenbrand per-speaker final-EMA accuracy | 93/93 | 93/93 (R 93/93) |

- **No bias.** Signed mean(A − B) = −0.0023 overall (Hillenbrand −0.0026,
  Alice raised +0.0005); Alice raised-segment mean raw score A 0.1300 /
  B 0.1294 / R 0.1304. The per-chunk splice adds *jitter*, not a shift.
- The jitter is concentrated in harder material: on the Alice segments
  raw |A − B| mean 0.025, p95 0.113, max 0.571 (per-segment mean
  difference up to 0.068) vs 0.008 / 0.030 / 0.442 on Hillenbrand.
- Timeline: A emits 399 samples per chunk (139 650 for an 8.75 s
  signal) vs ideal 399.73 (B: 139 937 vs ideal 139 936.5).
- Equivalence check (synthetic 217 + 1311 Hz tone, 5 s): A and B are
  **bit-identical at 48, 32 and 96 kHz** (max |diff| 0); they differ only
  at non-integer ratios (44.1 kHz, 22.05 kHz).

## Decision

Switch `gender-worker.js` to `createStreamingResampler`, instantiated in
`init` once `inputSampleRate` is known — exactly the pitch-worker
pattern. No behavior change on 48 kHz capture (the common case); on
44.1 kHz devices the classifier input becomes the continuous signal,
cutting per-window deviation from the clean 16 kHz reference ~2.5× and
threshold flips 11 → 1 with no shift in the mean score or in Hillenbrand
accuracy. No retuning of EMA α / VAD thresholds is implied (they were
validated on the R path, which B now tracks more closely than A did).
