# Custom voice-vs-machine detector — evaluation and verdict (2026-10-06)

Branch `voice-detector`. This is step 3 of the custom detector, the evaluation
look. It is measurement only: `src/` is unchanged and nothing is integrated.

- Pre-registration, committed as 978ef5f before any data or model existed:
  [voice-detector-custom-preregistration-2026-10-06.md](voice-detector-custom-preregistration-2026-10-06.md).
  Addendum A covers the data step; Addendum B covers the freeze.
- Training and selection:
  [voice-detector-custom-training-2026-10-06.md](voice-detector-custom-training-2026-10-06.md).
  The model was frozen as 40d151a.
- Bar, harness and the off-the-shelf results:
  [voice-detector-benchmark-2026-10-06.md](voice-detector-benchmark-2026-10-06.md).
  Tools: [scripts/voice-detector/](../scripts/voice-detector/README.md).

All numbers below come from public data. The private session recordings were
used only for V5, which is reported outside this repository (§7). No PR was
opened, and no audio or weights are committed.

## Decision

**The frozen detector does not pass the pre-registered bar.** It fails V1
(voice kept) and passes V2, V3 and V4. Phase 2 does not start on this look.

The verdict is the one pre-registered look: the unchanged `score.py` over all
4,305 harness streams, at the frozen operating point (agg `mean`, p ≥ 0.30,
hangover 3 s).

| criterion | result | bar | verdict |
|---|---|---|---|
| V1, clean voice sets (worse gender) | worst: PVQD + VOICED f 0.84 %; every other set ≤ 0.03 % | ≤ 1 % per set | pass |
| V1, voice in noise (worse gender) | +10 dB lead 20 s m 2.33 %; **0 dB lead 20 s m 3.47 %**; **+10 dB lead 0 m 3.52 %**; **0 dB lead 0 m 6.88 %** | ≤ 3 % per cell | **FAIL** (3 of 4 cells) |
| V2, false painted line removed: all 279 / held-out A / held-out B | **79.58 / 74.48 / 75.38 %** | ≥ 60 / 50 / 50 % | pass |
| V3, frame + lookahead; median onset delay (worse gender) | 82 ms; 0 ms | ≤ 100 ms; ≤ 100 ms | pass |
| V4: licence, size, runtime, desktop WASM CPU per 25 ms | MIT; 1,485,034 B; onnxruntime-web WASM; 0.50 ms in Node, 0.39 ms in headless Chrome (re-measured) | permissive; ≤ 5 MB; browser; ≤ 2 ms | pass |

- **What it achieves.** On real noise-only audio it removes 75–80 % of the false
  pitch line on every set. The best off-the-shelf detector, WebRTC, removed
  13.14 / 16.50 / 12.58 %. Clip-mean painted time on the 279 clips falls from
  23.93 % to 4.90 %. On the clean voice sets it keeps voice as well as the
  off-the-shelf detectors did: held notes, sustained vowels, speech and
  singing are vetoed at 0.00–0.84 %.
- **Where it fails.** Male held notes and dysphonic sustained vowels inside
  stationary machine noise: refrigerators, electric motors, air conditioners,
  electronics whine. In these mixes the detector reads voice plus machine as
  machine.
  - The male group fails three cells, and the PVQD unknown-gender group exceeds
    3 % in both 0 dB cells (3.13 and 4.61 %).
  - The female group stays within the bar (worst cell 2.54 %).
  - In the +10 dB cells, 10 streams out of 392 carry 94–98 % of the vetoes. At
    0 dB the loss is broader: 32–38 streams have more than 10 % of their correct
    hops vetoed (§3).
- **Why selection did not catch it.** The selection rule held the val mix cells
  to ≤ 1.5 %, half the bar, as a margin. The frozen point's worst val cell was
  1.27 %; on the evaluation mixes it is 6.88 %. The val voice programs were
  Coswara vowels, LibriSpeech / VCTK / MDVR-KCL speech and Cantoría singing.
  None of them is a long, trained-singer male held note or a dysphonic vowel,
  and these are exactly the voice types that fail in machine noise. That
  absence was by design: VocalSet, PVQD and VOICED are evaluation sets and were
  kept out of training and selection. The half-limit margin did not cover the
  step from the val programs to these.
- **Post-hoc only, not a pass.** After the look, a 171-point threshold ×
  hangover grid was scored on the same files (§5). 16 of those points pass V1
  and V2 on the evaluation data. The best by tuning-194 V2 is p ≥ 0.07 with a
  1 s hangover: 69.14 / 65.66 / 63.51 % removed, with a worst V1 cell of 2.87 %.
  - These points were found with the evaluation data, so they are not a pass
    of the pre-registered bar.
  - Their V1 margins are thin. The worst cells are 1.66–2.96 % against the
    3 % limit, and the eight points with the most removal sit at 2.25–2.96 %.
  - Confirming one would need a new pre-registration and evaluation data that
    nobody has looked at. Every current evaluation set has now been seen.

## 1. What was evaluated

| | |
|---|---|
| model | run `r5-bighard`, step 10,000, EMA weights. 89,257 parameters. Log-mel front end, 3 causal convolutions, GRU. 12.5 ms hop |
| deployable file | `build/vad-train/model/custom-vd.onnx` (gitignored), streaming ONNX, opset 17, 1,485,034 B, sha256 `4230d27a8dc336dccc7b30afb53941998471f8b1fb5a444b66bc96869ca8c23d` (re-checked) |
| candidate | `build/vad/cand/custom-vd/candidate.json`, byte-identical to the committed [frozen candidate.json](../scripts/voice-detector/train/frozen/candidate.json): `hop_ms` 12.5, `first_avail_ms` 12.375, `frame_ms` 82, `lookahead_ms` 0, threshold 0.30, hangover 3,000 ms, agg `mean` |
| probability files | `infer.py --onnx`: onnxruntime CPU, 1 thread, state carried, each stream's own samples through the pitch worker's linear resampler. All 4,305 streams |
| freeze order | freeze commit 40d151a at 05:05:53. Probability files written 05:06:07–05:08:04, after the commit. `build/vad/scores/` held no `custom-vd` result before the look |

## 2. Results of the one evaluation look

Command: `python scripts/voice-detector/score.py build/vad/cand/custom-vd --json=build/vad/scores/custom-vd.json --worst=25`.
`score.py` is unchanged since harness commit 7cd4e86. The denominators are the
benchmark's, so the off-the-shelf numbers in brackets are directly comparable:
WebRTC is the best off-the-shelf candidate and Silero the second.

### V1: voice kept (% of CORRECTLY painted hops vetoed)

| row | correct hops f / m / unknown | vetoed % f | m | unknown | worse | bar | verdict |
|---|---|---|---|---|---|---|---|
| FDA speech | 2,274 / 1,914 / — | 0.00 | 0.00 | — | 0.00 | ≤ 1 | pass |
| PTDB-TUG speech | 4,304 / 3,785 / — | 0.00 | 0.03 (1 hop) | — | m 0.03 | ≤ 1 | pass |
| vocadito singing | — / — / 20,817 | — | — | 0.00 | 0.00 | ≤ 1 | pass |
| VocalSet long tones (held notes) | 17,130 / 70,979 / — | 0.00 | 0.00 (2 hops) | — | 0.00 | ≤ 1 | pass (WebRTC 0.998, Silero 0.00) |
| PVQD + VOICED sustained vowels | 21,503 / 11,923 / 134,870 | 0.84 | 0.00 | 0.28 | f 0.84 | ≤ 1 | pass |
| Hillenbrand vowels | 5,692 / 4,283 / — | 0.00 | 0.00 | — | 0.00 | ≤ 1 | pass |
| voice in noise +10 dB, lead 20 s | 35,918 / 104,525 / 45,233 | 0.67 | 2.33 | 0.97 | m 2.33 | ≤ 3 | pass |
| voice in noise 0 dB, lead 20 s | 21,906 / 67,220 / 31,515 | 1.15 | **3.47** | **3.13** | m 3.47 | ≤ 3 | **FAIL** |
| voice in noise +10 dB, lead 0 | 35,860 / 104,420 / 44,966 | 0.20 | **3.52** | 0.60 | m 3.52 | ≤ 3 | **FAIL** |
| voice in noise 0 dB, lead 0 | 22,597 / 66,077 / 30,320 | 2.54 | **6.88** | **4.61** | m 6.88 | ≤ 3 | **FAIL** |

- VocalSet hops inside held segments: 63,202, vetoed 0.00 %.
- The PVQD + VOICED female 0.84 % is a single recording: VOICED `voice119`,
  all 181 of its correct hops vetoed. It was not inspected by listening.

### V2: false painted line removed on noise-only audio (% of FALSELY painted hops vetoed)

| set | clips | false hops | vetoed % | clip-mean painted, before → after | bar | verdict | [WebRTC / Silero] |
|---|---|---|---|---|---|---|---|
| all 279 | 279 | 122,436 | **79.58** | 23.93 → 4.90 % | ≥ 60 | pass | [13.14 / 10.90] |
| … tuning split 194 (selection) | 194 | 79,223 | 82.36 | 24.11 → 4.52 % | — | — | [11.32 / 11.79] |
| held-out A, in-set split 85 | 85 | 43,213 | **74.48** | 23.52 → 5.76 % | ≥ 50 | pass | [16.50 / 9.26] |
| held-out B, second set 119 | 119 | 46,033 | **75.38** | 20.41 → 5.45 % | ≥ 50 | pass | [12.58 / 12.76] |
| … held-out B dcaseeval | 18 | 5,272 | 69.48 | 18.12 → 5.58 % | — | — | [52.81 / 0.00] |
| … held-out B fsheld | 101 | 40,761 | 76.15 | 20.81 → 5.43 % | — | — | [7.37 / 14.41] |
| stationary-tonal (279) | 102 | 53,683 | 82.97 | 27.11 → 4.09 % | | | [12.87 / 11.87] |
| intermittent-tonal (279) | 10 | 2,221 | 76.36 | 26.55 → 9.04 % | | | [15.22 / 1.35] |
| mixed (279) | 133 | 58,596 | 75.43 | 24.08 → 6.10 % | | | [11.97 / 11.31] |
| broadband (279) | 34 | 7,936 | 88.14 | 13.05 → 1.41 % | | | [23.12 / 3.91] |
| hvac (279 / held-out B) | 16 / 6 | 6,717 / 940 | 84.25 / 85.96 | | | | [4.09 / 26.28; 8.02 / 1.81] |
| mains hum (279 / held-out B) | 16 / 10 | 8,535 / 4,822 | 90.19 / 63.36 | | | | [0.04 / 3.44; 32.27 / 0.00] |
| microwave (279) | 4 | 4,417 | 71.61 | | | | [0.00 / 6.11] |
| refrigerator (279) | 14 | 7,909 | 87.28 | | | | [0.75 / 13.64] |
| generator (279) | 3 | 1,947 | 89.63 | | | | [0.00 / 3.90] |

### Information rows: false painting next to voice (% of falsely painted hops vetoed)

| where | false hops | vetoed % | [WebRTC] |
|---|---|---|---|
| mixes, 20 s noise-only lead (+10 / 0 dB) | 86,646 / 87,206 | 77.64 / 75.25 | — |
| mixes, gaps between phrases, 20 s lead (+10 / 0 dB) | 37,359 / 33,018 | 17.85 / 18.07 | [1.19 at +10 dB] |
| mixes, gaps between phrases, lead 0 (+10 / 0 dB) | 42,475 / 35,980 | 18.78 / 21.20 | — |
| mixes, tail after the voice, 20 s lead (+10 / 0 dB) | 18,570 / 18,152 | 47.78 / 40.05 | [— / 1.93] |
| mixes, tail after the voice, lead 0 (+10 / 0 dB) | 20,591 / 18,717 | 49.92 / 42.05 | [— / 1.88] |
| clean voice sets, painted outside every voiced reference span (±100 ms) | 10,886 | 6.91 | — |
| all sets, painted at a WRONG pitch on a voiced reference (not scored) | 200,676 | 2.92 | — |

The 3 s hangover keeps the gate open through most pauses in speech: only about
a fifth of the false painting between phrases is removed. This is the
benchmark's G3 caveat ("noise right after speech"), and it is unchanged by this
result.

### V3: timing

- Decision latency: frame 82 ms + lookahead 0 = 82 ms. Pass (≤ 100 ms).
- Onset delay, median over every voice onset: 0 ms in every group and every
  set. Pass.
- Onsets delayed by more than 100 ms / never shown:
  - f: 0.66 / 0.09 % of 2,116 onsets;
  - m: 3.33 / 2.11 % of 3,752;
  - unknown: 1.24 / 0.85 % of 4,686.
- The late and never-shown onsets are mostly in the mixes, where
  2.7–3.2 % of onsets are delayed by more than 100 ms and 1.5–1.9 % are never
  shown. On the clean sets these are 0 %, except PVQD (0.91 / 0.76 %) and
  VOICED (0.46 / 0.46 %).

### V4: deployability (re-measured, §6)

- **Licence: MIT.** The weights are this project's own work. The judge re-read
  `build/vad-train/model/LICENSE`, which is standard MIT text, and
  `ATTRIBUTION.md`, which credits per dataset and per Freesound uploader.
  - The manifest's 33,299 kept training files carry only CC BY 4.0 (19,993),
    CC0 1.0 (7,188) and CC BY 3.0 (6,118) licences. Every one has an
    attribution.
  - No NC, ND or ShareAlike file is among them.
- **Size:** 1,485,034 B.
- **Runtime:** onnxruntime-web 1.30.0, WASM EP, 1 thread, one `session.run` per
  25 ms of audio (2 frames), state carried, desktop i9-11900K:

  | where | mean ms per 25 ms | median | p95 | p99 | wall per 25 ms | machine load at start |
  |---|---|---|---|---|---|---|
  | Node 24.14.1 (`ort.node.min.mjs`) | **0.50** | 0.44 | 0.73 | 0.89 | 0.50 | 23 % CPU (other projects' jobs) |
  | headless Chrome 154 (`ort.wasm.min.mjs`, temporary `--user-data-dir`, closed by its own PID) | **0.39** | 0.40 | 0.50 | 0.70 | 0.40 | run right after; not re-read |

  These figures were measured over 9,605 runs (240 s of audio), with WASM
  output matching the reference files to 6.3e-6. The training note declared
  0.62 / 0.51 ms, also measured with the machine under load. Mobile was not measured; with
  the benchmark's desktop-to-mobile WASM ratios of 2.4–4.5×, it would be about
  1–2.3 ms per 25 ms (an estimate, which V4 allows).

## 3. Where the voice vetoes are (frozen point)

**V1 mix cells by voice program and gender** (correct hops, % vetoed):

| voice program | gender | +10 dB lead 20 s | 0 dB lead 20 s | +10 dB lead 0 | 0 dB lead 0 |
|---|---|---|---|---|---|
| VocalSet held notes | m | 2.57 % of 93,513 | 3.32 % of 61,573 | 3.91 % of 93,282 | **7.11 %** of 60,530 |
| VocalSet held notes | f | 0.00 | 0.09 | 0.03 | 1.31 |
| PVQD sustained vowels | unknown | 1.45 | 4.65 | 0.89 | 7.26 |
| VOICED sustained vowels | m | 0.00 % of 1,264 | 21.19 % of 906 | 0.00 % of 1,252 | 25.75 % of 699 |
| VOICED sustained vowels | f | 9.05 % of 2,631 | 11.66 % of 1,381 | 2.61 % of 2,493 | 21.95 % of 1,531 |
| PTDB-TUG speech | m | 0.83 | 3.72 | 0.62 | 2.69 |
| PTDB-TUG speech | f | 0.07 | 1.71 | 0.04 | 0.53 |
| FDA speech | f / m | 0.00 / 0.00 | 0.76 / 0.33 | 0.00 / 0.00 | 0.77 / 0.00 |
| vocadito singing | unknown | 0.02 | 0.35 | 0.03 | 0.00 |

VocalSet's male held notes make up 89–92 % of the male mix hops, so they decide
the male cells. Clean, the same notes are vetoed at 0.00 %.

**By noise class** (mix cells pooled; the classes with the most vetoed hops):

| noise class | noise clips | correct hops | vetoed % |
|---|---|---|---|
| stationary-tonal, refrigerator | 6 | 25,988 | 13.12 |
| stationary-tonal, electric motor | 2 | 13,041 | 17.92 |
| broadband, air conditioner (MS-SNSD) | 3 | 9,611 | 18.69 |
| stationary-tonal, electronics whine | 3 | 13,575 | 11.22 |
| broadband, mains hum | 2 | 9,236 | 8.81 |
| broadband, hvac | 2 | 9,745 | 8.20 |
| mixed, hair dryer | 1 | 5,119 | 12.58 |
| stationary-tonal, projector | 1 | 4,472 | 12.19 |

- **By noise split.** The mixes reuse noise from the 279 clips. The failure is
  not confined to the noise the selection saw: male correct hops in noise from
  the held-out split are vetoed at 2.67–8.02 % per cell, and in noise from the
  tuning split at 2.16–6.37 %.
- **Concentration.**

  | cell | streams with any veto | top 10 streams' share of the vetoes | streams with > 10 % of their correct hops vetoed |
  |---|---|---|---|
  | +10 dB lead 20 s | 30 of 392 | 97.7 % | 9 |
  | +10 dB lead 0 | 32 | 94.3 % | 10 |
  | 0 dB lead 20 s | 83 | 67.2 % | 32 |
  | 0 dB lead 0 | 69 | 61.9 % | 38 |

- **Time since the voice started.**
  - With a 20 s noise lead, the first second of voice loses the most: 6.14 %
    in the first second, against 1.1–3.6 % later.
  - With lead 0, the loss is spread out: 2.6–4.3 % in every time bin.

**Worst voice streams** (share of CORRECT hops vetoed, ≥ 20 correct hops; mix
ids are `vin__<noise>__<voice>__snr`):

| stream | gender | vetoed |
|---|---|---|
| vin20 freesound light_ballast 871465 + VOICED voice206, +10 and 0 dB; vin0, 0 dB | f | 100 % (173, 62 and 117 hops) |
| vin20 freesound refrigerator 116866 + VocalSet male10 n-4, +10 and 0 dB | m | 100 % (933 and 639 hops) |
| vin20 / vin0 MS-SNSD train VacuumCleaner_9 + VOICED voice104, 0 dB | m | 100 % (183 and 178 hops) |
| vin20 freesound electric_fan 631405 + VOICED voice181, 0 dB | f | 100 % (32 hops) |
| vin0 freesound server_room 682619 + VOICED voice180, 0 dB | f | 100 % (129 hops) |
| VOICED voice119 (clean) | f | 100 % (181 hops) |
| vin0 freesound electric_motor 864396 + VocalSet male10 n-4, +10 / 0 dB | m | 89.9 / 77.6 % |
| vin0 freesound electronics_whine 124015 + VocalSet male3 n-4, 0 dB | m | 82.4 % |
| vin0 freesound refrigerator 116866 + VocalSet male10 n-4, +10 / 0 dB | m | 82.0 / 79.7 % |
| vin0 MS-SNSD train AirConditioner_2 + VocalSet male10 n-4, +10 dB | m | 77.8 % |
| vin0 freesound light_ballast 871465 + VocalSet male2 n-9, 0 dB | m | 74.5 % |
| PVQD PT084_ENSS (clean) | unknown | 72.1 % (31 of 43) |
| vin0 freesound hvac 667437 + PVQD LA9017_ENSS, 0 dB | unknown | 68.4 % |
| vin20 DCASE valve id06 + VocalSet male8 n-3, 0 dB | m | 66.7 % |

Clean PVQD has 382 vetoed hops out of 134,870. Most come from LA7012_ENSS
(114 of 1,209), NYU1022_ENSS (114 of 328) and PT084_ENSS (31 of 43).

## 4. What false painting is left (noise-only)

- **Least-removed classes:**
  - DEMAND NPARK: 0 % of 351 hops;
  - DEMAND OMEETING: 0.3 % of 2,142;
  - DCASE pump / slider anomaly: 22 / 33 %;
  - Freesound dryer: 24.9 %;
  - held-out B valve: 26.4 %;
  - DEMAND SPSQUARE, TMETRO, PCAFETER, TBUS: 31–48 %;
  - held-out B small motor: 42.4 %.

  The benchmark already noted that six DEMAND scenes contain real background
  talkers. A voice gate cannot remove those by design.
- **Machine clips left fully painted (0 % removed):**
  - DCASE pump id00, slider id00 anomaly and valve id00;
  - Freesound electronics_whine 124015, mains_hum 117635 and 478806, microwave
    210315;
  - MS-SNSD VacuumCleaner 5 and 6, WasherDryer 4;
  - held-out B: DCASE eval valve id01, Freesound small_motor 418461.
- **How many clips stay mostly painted.** Of the clips with ≥ 40 false hops,
  33 of 187 (279 set) and 18 of 86 (held-out B) keep more than half of their
  false line.
- **Where the remaining false hops are.**
  - On the 279, 25,003 false hops remain. The 10 worst clips hold 46 % of them:
    dryer 76690, OMEETING, electric_motor 721016, PCAFETER, electronics_whine
    482979, TMETRO, hvac 710658, hair_dryer 706149, microwave 94176, DLIVING.
  - On held-out B, 11,332 remain. The 10 worst clips hold 66 %: two office
    clips, transformer 331321, small_motor 418461, boiler 86610, four mains
    hum clips and a DCASE valve.

## 5. Operating-point trade-off (post-hoc)

**Number of looks.** One pre-registered look (§2), then this grid on the same
probability files. The grid used 19 thresholds × 9 hangovers, with agg `mean`
as frozen. It was scored by `judge/custom_tradeoff.py`, which reproduces the
look's `score.py` JSON exactly (0 mismatches). **None of these points is a
selection.**

Each cell reads: worst clean V1 row % / worst V1 mix cell % / V2 on all 279 %.
**Bold** cells meet every V1 and V2 limit on the evaluation data, including
held-out A and B. The frozen point is p ≥ 0.3 at 3 s.

| p ≥ | 0 s | 0.1 s | 0.5 s | 1 s | 2 s | 3 s | 5 s | 10 s |
|---|---|---|---|---|---|---|---|---|
| 0.02 | 8.58 / 3.04 / 67.5 | **0.46 / 2.41 / 64.4** | 0.20 / 1.76 / 58.2 | 0.14 / 1.34 / 53.7 | 0.07 / 0.92 / 47.8 | 0.03 / 0.67 / 43.4 | 0.00 / 0.39 / 36.5 | 0.00 / 0.15 / 26.0 |
| 0.03 | 12.53 / 3.84 / 71.6 | **0.51 / 2.96 / 68.9** | **0.24 / 2.20 / 63.4** | 0.15 / 1.67 / 59.6 | 0.09 / 1.11 / 54.0 | 0.04 / 0.90 / 49.7 | 0.00 / 0.61 / 42.7 | 0.00 / 0.31 / 30.5 |
| 0.05 | 17.72 / 5.32 / 76.1 | 0.64 / 4.08 / 73.8 | 0.49 / 3.09 / 69.0 | **0.33 / 2.31 / 65.7** | **0.15 / 1.72 / 60.5** | 0.09 / 1.58 / 56.3 | 0.00 / 1.40 / 49.3 | 0.00 / 0.89 / 37.4 |
| 0.07 | 20.58 / 6.52 / 78.8 | 0.66 / 4.99 / 76.5 | 0.51 / 3.80 / 72.2 | **0.34 / 2.87 / 69.1** | **0.19 / 1.87 / 64.3** | **0.11 / 1.66 / 60.8** | 0.03 / 1.48 / 54.5 | 0.00 / 1.06 / 42.7 |
| 0.1 | 24.10 / 8.16 / 81.6 | 0.70 / 6.13 / 79.5 | 0.62 / 4.93 / 75.4 | 0.53 / 3.95 / 72.7 | **0.34 / 2.76 / 68.4** | **0.15 / 2.25 / 64.9** | 0.04 / 1.74 / 58.9 | 0.01 / 1.24 / 47.1 |
| 0.13 | 26.87 / 9.95 / 83.5 | 0.77 / 6.88 / 81.6 | 0.62 / 5.76 / 78.0 | 0.53 / 4.85 / 75.3 | 0.34 / 3.62 / 71.6 | 0.16 / 3.01 / 68.5 | **0.05 / 2.15 / 63.2** | 0.01 / 1.30 / 52.6 |
| 0.2 | 30.08 / 13.33 / 86.6 | 0.96 / 9.00 / 84.9 | 0.71 / 7.66 / 82.1 | 0.60 / 6.74 / 80.2 | 0.41 / 5.62 / 77.1 | 0.23 / 4.85 / 74.5 | 0.05 / 3.77 / 70.1 | **0.01 / 2.20 / 61.8** |
| 0.3 | 33.20 / 16.56 / 89.0 | 1.20 / 11.34 / 87.5 | 0.98 / 9.71 / 85.2 | 0.89 / 8.74 / 83.6 | 0.84 / 7.51 / 81.4 | 0.84 / 6.88 / 79.6 | 0.84 / 5.91 / 76.2 | 0.84 / 3.73 / 69.4 |
| 0.5 | 37.51 / 23.38 / 92.3 | 2.12 / 18.05 / 91.0 | 1.58 / 15.63 / 89.3 | 1.29 / 14.08 / 88.2 | 0.98 / 12.13 / 86.9 | 0.85 / 11.00 / 85.8 | 0.85 / 9.43 / 83.6 | 0.85 / 7.05 / 79.6 |
| 0.9 | 48.24 / 52.25 / 96.4 | 7.38 / 44.41 / 95.3 | 5.45 / 40.36 / 94.2 | 4.84 / 37.88 / 93.8 | 3.55 / 34.20 / 93.3 | 2.59 / 31.30 / 93.1 | 1.53 / 27.85 / 92.6 | 0.86 / 24.02 / 91.9 |

The full grid has 171 points (thresholds 0.01–0.9; hangovers 0, 0.1, 0.2, 0.5,
1, 2, 3, 5 and 10 s). 16 points meet the bar on the evaluation data. With no
hangover, speech fails V1 at every threshold in the grid (FDA female
2.95–48 %): the model's probability dips between words.

**Best tuning-194 V2 per V1 allowance.** V1 relaxed to X means clean sets ≤ X %
and mix cells ≤ max(3, X) %. This is the benchmark's convention.

| V1 allowance | point | worst clean / worst mix | V2 tuning / 279 / A / B |
|---|---|---|---|
| bar (1 % / 3 %) | p ≥ 0.07, 1 s | PVQD + VOICED f 0.34 / 0 dB lead 0 m 2.87 | 71.04 / 69.14 / 65.66 / 63.51 |
| 5 % | p ≥ 0.07, 0.1 s | 0.66 / 4.99 | 79.00 / 76.53 / 72.00 / 71.62 |
| 10 % | p ≥ 0.25, 0.2 s | 1.00 / 9.66 | 88.47 / 85.49 / 80.03 / 80.55 |
| none | p ≥ 0.9, 0 s | FDA f 48.24 / 52.25 | 98.70 / 96.40 / 92.19 / 96.62 |

For comparison, the off-the-shelf detectors that met V3 removed at most
11.8 % of the tuning-194 false hops at the bar (the YAMNet frame and context
gates, which fail V3, 14.7 and 27.5 %), and WebRTC reached only 33.6 % on the
279 at a 10 % V1 allowance.

The other points that meet the bar on the evaluation data, ordered by V2 on all
279 (V2 279 / A / B; worst mix cell):

| point | V2 279 / A / B | worst mix |
|---|---|---|
| 0.03 / 0.1 s | 68.87 / 65.60 / 62.54 | 2.96 |
| 0.1 / 2 s | 68.37 / 64.45 / 63.74 | 2.76 |
| 0.03 / 0.2 s | 67.12 / 64.03 / 60.69 | 2.70 |
| 0.25 / 10 s | 66.24 / 62.34 / 64.16 | 2.69 |
| 0.05 / 1 s | 65.72 / 63.28 / 59.40 | 2.31 |
| 0.16 / 5 s | 65.55 / 62.34 / 62.93 | 2.60 |
| 0.1 / 3 s | 64.89 / 61.70 / 60.40 | 2.25 |

**What this says.** The model separates voice from machine noise far better
than any off-the-shelf detector. At about 65–69 % removal, its ranking leaves
room for a V1-passing point on these sets. The pre-registered rule did not land
there: it picked a threshold about four times higher, because the val mixes did not
contain the voices that fail. Whether a lower point holds on voices nobody has
measured is open.

## 6. Judge checks

| check | what | result |
|---|---|---|
| re-score | `judge/custom_fastscore.py` (score.py's own functions with a cache) against the look's JSON at the frozen point | 0 mismatches on every V1, V2 and V3 number |
| re-run the model in the browser runtime | `judge/custom_rerun.mjs`: onnxruntime-web 1.30.0 WASM in Node, 1 thread, on 22 seeded streams (2 per set) at 16 / 20 / 44.1 / 48 kHz. Fed through the app's own `createStreamingResampler` (`src/ml/audio-utils.js`) in 25 ms capture chunks | 39,619 frames: max \|Δp\| = 6.2e-5 against the harness files (onnxruntime CPU + the Python resampler port), and **0 decisions flip** at p ≥ 0.3 |
| live feeding | the same streams, each frame run as soon as its last sample arrived (1–3 frames per `session.run`), against the 8-frame offline chunks | max \|Δp\| = 4.4e-6, 0 flips |
| causality by truncation | zero the audio from a random sample (≥ 1 s in) and re-run. Every frame declared available by the cut (`first_avail_ms` + i · `hop_ms` ≤ cut) is compared with the full run | **14,106 frames bit-identical** (max \|Δp\| = 0). 25,512 of the 25,513 frames after the cut changed, so the cut is effective |
| WASM CPU | `train/wasm_bench.mjs`, Node and headless Chrome (§2 V4) | 0.50 / 0.39 ms per 25 ms |
| licence | LICENSE, ATTRIBUTION.md, and the manifest's licence of each kept training file | MIT; training files CC BY 4.0 / CC0 1.0 / CC BY 3.0 only, each attributed |
| freeze order | git commit times against probability-file times; score directory | files written after 40d151a; first score of `custom-vd` is this look |

Headless Chrome ran with a temporary `--user-data-dir` and was closed by its
own PID. Afterwards, no Chrome process with the benchmark profile and no
temporary profile directory remained.

## 7. V5: private session recordings (reported, not a gate)

The frozen model, at the frozen point, was run over the four private session
recordings through this branch's production chain (`scripts/session-oracle/run.mjs`).
The scorer was `judge/custom_v5_infer.py` + `judge/custom_v5_score.py`; it
reported correctly painted hops vetoed per labelled voice, and painted hops
vetoed outside every labelled voice, per session and pooled. The recordings
were never used for training, selection or tuning. Results on the private
session recordings are kept outside this repository.

## 8. Limits

- **The V2 numbers are the cold case.** They come from noise-only clips. In a
  live session, the 3 s hangover keeps the gate open in most pauses: only
  18–21 % of false painting between phrases is removed. Any integration would
  still face the benchmark's G3 clause.
- **Mobile CPU is estimated** (about 1–2.3 ms per 25 ms), not measured.
- **Unexplained failures.** The one clean VOICED recording that is fully
  vetoed, and the PVQD streams with the most vetoes, were not inspected by
  listening. A reference-label problem is not ruled out for them.
- **The trade-off in §5 is post-hoc** and uses the evaluation data. It shows
  what the model can do, not that a point is safe.

## 9. What would come next (none started)

1. **Stop here.** Keep the off-the-shelf verdict and the current display
   behaviour.
2. **A confirmatory round for a lower operating point**, for example p ≥ 0.07
   with a 1 s hangover. It needs a new pre-registration and evaluation voice
   data that has not been looked at. The data must include male held notes
   and dysphonic vowels in stationary machine noise, because §3 shows these are
   the binding case. Every set in this harness has now been seen.
3. **Retrain with the failing case in the training data.** That means openly
   licensed trained-singer and male held notes, and dysphonic sustained
   vowels, mixed into machine noise. The val mixes would also need such
   programs, so that selection can see the failure. VocalSet, PVQD and VOICED
   remain evaluation-only.

## 10. Reproduction (repo root)

The ONNX file, candidate files, dumps and venv come from the training note's
reproduction; all are gitignored.

```bash
python scripts/voice-detector/score.py build/vad/cand/custom-vd --json=build/vad/scores/custom-vd.json --worst=25   # the look
python scripts/voice-detector/judge/custom_tradeoff.py --out=build/vad/judge/custom-tradeoff.json                  # §3, §5 (post-hoc)
ORT=<dir with node_modules/onnxruntime-web 1.30.0>
node scripts/voice-detector/judge/custom_rerun.mjs --ort=$ORT --per=2 --json=build/vad/judge/custom-rerun.json       # §6
node scripts/voice-detector/train/wasm_bench.mjs --ort=$ORT --model=build/vad-train/model/custom-vd.onnx \
  --ref=build/vad-train/cand/r5e-s10000-onnx --n=10 --sec=60 [--mode=chrome \
  --shapes='{"ctx":[1,312],"s0":[1,1,2,64],"s1":[1,24,2,32],"s2":[1,48,1,16],"h":[1,1,96]}']                       # V4
# V5 (private; results outside this repository)
node --import ./scripts/session-oracle/lib/register.mjs scripts/session-oracle/run.mjs --src=src --tag=vd_dd92037 --out=build/vad/v5/runs
build/vad-train/venv/Scripts/python.exe scripts/voice-detector/judge/custom_v5_infer.py
python scripts/voice-detector/judge/custom_v5_score.py --refs=<session-oracle refs> --out=build/vad/v5/v5.json
```
