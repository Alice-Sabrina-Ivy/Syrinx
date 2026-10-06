# Notch voice-vs-machine discrimination — real-data corpora (DATA phase, 2026-10-05)

Branch `notch-voice-discrimination` (notch module = bc42ad0's). No tuning
change in this phase — this file records the corpora the next phase measures
on, a census of the real noise, and one end-to-end observation the census
surfaced (§4). Code: [scripts/notch-adversarial/realdata/](../scripts/notch-adversarial/realdata/README.md).
Audio, manifests and indexes live in `build/notchvd/` (gitignored, ~5 GB data
+ 1.7 GB download cache); everything is rebuildable with the README commands.
The counts below are the public sources only. Results on the private session
recordings are kept outside this repository.

## Why

Every notch decision so far (2026-07-19 → round 2, 2026-10-04) ran on
SYNTHETIC noise (`scripts/noise-synth.js`), and every timing rule trades
held-note protection against some interferer class: bc42ad0 blanks repeated
same-pitch holds / mid-hold glides / speech-into-hold; R8 fixes repeated holds
but never notches a tonal source that cuts out 0.15–1 s every 5–8 s. The
hypothesis for the next phase: a voice line is distinguishable from a machine
line by its own micro-structure (jitter, shimmer, fast F0 micro-fluctuation,
co-varying formant envelope) rather than by timing. Testing that needs real
machine lines and real held voices.

## 1. Corpus A — real noise (880 clips, 413.6 min after dedupe)

| source | clips (dups) | min | stationary / intermittent / mixed / broadband (of which < 15 s) | license |
|---|---|---|---|---|
| MS-SNSD noise_train/test — AirConditioner, CopyMachine, VacuumCleaner, WasherDryer | 47 (1) | 50.3 | 19 / 3 / 13 / 12 (0) | CC0 (Freesound via MS-SNSD) |
| DEMAND ch01, all 17 environments (16 kHz) | 17 | 85.0 | 1 / 0 / 13 / 3 (0) | CC BY 4.0 |
| ESC-50: vacuum, washing machine, engine, airplane, train, helicopter, chainsaw, hand saw, clock tick/alarm, siren, church bells, car horn, insects, crickets (40 × 5 s each) | 600 | 50.0 | 148 / 31 / 202 / 219 (600) | CC BY-NC 3.0 (ESC-10 CC BY) |
| DCASE 2020 T2 dev (MIMII fan/pump/slider/valve, ToyADMOS car/conveyor): per machine id 4 consecutive normal 10 s segments (40 s) + 2 anomaly clips | 69 | 23.4 | 14 / 2 / 51 / 2 (46) | CC BY-NC-SA 4.0 |
| Freesound HQ previews, 38 queries (fridge, transformer / mains hum, ballast, computer / desk / ceiling / exhaust fans, HVAC, heat pump, dehumidifier, pumps, motors, microwave, dishwasher, washer / dryer, coil whine, projector, generator, engine idle …) | 146 | 204.0 | 68 / 5 / 56 / 17 (8) | per clip: CC0 / CC BY / CC BY-NC / Sampling+ |

Labels come from the census (§3). The MS-SNSD duplicate is CopyMachine_8 =
CopyMachine_10 (1-2 LSB apart; near-duplicate detection in build_index.py).
DEMAND SCAFE has no 16 kHz zip (skipped). All clips: 16 kHz mono float32 at
the recording's original level (first channel; stereo pairs are not averaged —
it can comb-filter a hum).

## 2. Corpus B — real voice (2 339 clips, 259.7 min real + 77.4 min synthetic)

Held segment = voiced run whose 0.3 s median-smoothed pitch stays within ±50 c
of its running median for ≥ 0.5 s (heldseg.py; basis = the corpus F0
reference where one exists, else Praat AC 60–1100 Hz).

| source | clips | min | held segs | held min | ≥ 2 s | ≥ 5 s | held F0 in 50–460 Hz | license |
|---|---|---|---|---|---|---|---|---|
| VocalSet long tones (straight / forte / pp / messa; 20 trained singers × 5 vowels; range-read 400 files from the 2.1 GB zip) | 399 | 72.8 | 1 474 | 49.2 | 734 | 7 | 1 020 | CC BY 4.0 |
| PVQD (sustained /a/ /i/ + CAPE-V sentences, clinical; CAPE-V severity per clip, 128 clips < 20) | 296 | 120.8 | 804 | 25.8 | 331 | 38 | 785 | CC BY 4.0 |
| VOICED (~5 s sustained /a/, 8 kHz; 57 healthy) | 208 | 16.5 | 303 | 14.4 | 177 | 0 | 298 | ODC-By 1.0 |
| vocadito (solo singing, F0 annotations) | 40 | 13.6 | 215 | 2.7 | 1 | 0 | 215 | CC BY 4.0 |
| Hillenbrand hVd vowels | 1 116 | 10.2 | 82 | 0.7 | 0 | 0 | 82 | research use |
| PTDB-TUG (read speech, laryngograph F0) | 180 | 20.3 | 7 | 0.1 | 0 | 0 | 7 | ODbL 1.0 |
| FDA (read speech, laryngograph F0) | 100 | 5.5 | 5 | 0.0 | 0 | 0 | 5 | research use |
| synthetic supplement (suite scenarios.mjs: steady / repeat / vowelchange / dynamics) | 208 | 77.4 | 400 | 68.3 | 400 | 400 | 400 | — |

Findings:

* **Real holds are short.** Of 2 890 real held segments only 45 last ≥ 5 s
  (PVQD 38, VocalSet 7), the longest 7.6 s (a PVQD /a/); the suite's 8–20 s holds have no
  open-data counterpart. VocalSet long tones are ~2–3.3 s notes (three per
  file, different pitches). Real material therefore tests the hypothesis on
  0.5–5 s holds, and the notch's
  ≥ 5 s / ≥ 20 s regime only through ARRANGED real material: the
  `held_series` mixes (§5) chain the same note sung by the same singer on
  other vowels / techniques into ≥ 30 s series.
* PTDB / FDA read speech has essentially no held stretches (12 segments in
  25.8 min) — they are speech references, not held-note material.
* PVQD / VOICED are clinical populations: restrict to `capev_severity < 20` /
  `diagnosis = healthy` when a typical-voice set is wanted (pathological
  voices carry more jitter, which would flatter the hypothesis).

## 3. Census of the real noise: how common is "cuts out briefly every few seconds"?

Method (census.py; full rules in the README): the shipped notch's own peak
finder (ported 1:1, every 100 ms) finds the lines; up to 3 strong lines are
demodulated along their tracked frequency (±8 Hz, 10 ms grid) to see cuts the
512 ms observation window cannot. A **cut** = every measured line ≥ 10 dB
down at once for ≥ 0.15 s (lines measured only at ≥ 13 dB SNR; a lone line
needs ≥ 0.3 s and a ≥ 3 dB band-level dip). Two looser per-line rules were
tried first and rejected by spectrogram inspection: they counted 20–180
"cuts"/min on visibly steady fridge / AC / exhaust-fan lines — a single line
dips 10 dB whenever it beats against a component a few Hz away (compressor
line next to a mains harmonic) or its FM leaves the demodulation band.

Clips ≥ 15 s (225 clips, 353 min, non-duplicate): **89 stationary-tonal, 7
intermittent-tonal, 97 mixed, 32 broadband.** Over the 197.6 min that had
measurable lines: 75 cuts of 0.15–1 s, 15 of 1–3 s, 6 of 3–10 s — and 39 of
the 75 short cuts are one fridge clip.

The 7 long intermittent clips:

| clip | what | cuts | R8 signature (≥ 3 cuts 0.15–1 s, median interval 2–15 s) |
|---|---|---|---|
| freesound mains_hum 438501 ("Electrical Buzz", 120/240/360 Hz) | buzz that drops for 0.2–1.2 s every ~3–5 s | 6 in 46 s | **yes** |
| MS-SNSD CopyMachine_10 (58 Hz motor) | copier cycling per page | 11 in 285 s (0.3–3.5 s) | **yes** (median interval 14.9 s) |
| freesound refrigerator 577647 (99 / 197 Hz) | compressor AM-pulsing, 0.2–0.3 s dips every ~0.6 s during a 30 s start-up stretch | 39 | no (interval < 2 s) |
| freesound mains_hum 69939 (250 / 350 Hz) | 2 cuts (0.4, 2.2 s) | 2 in 20 s | no |
| freesound pump 463476 (aquarium pump) | 0.7, 1.0 s | 2 in 32 s | no |
| MS-SNSD CopyMachine_1 | 0.5, 0.9 s | 2 in 50 s | no |
| MS-SNSD WasherDryer_7 (100 / 148 Hz drum motor) | agitation: motor on 8–14 s, **off 6–7 s** | 2 in 67 s | no (off too long) |

**Answer: rare in this data.** The R8 adversary's exact signature (a tonal
source going fully silent for 0.15–1 s every few seconds) appears in **2 of
96** long tonal clips (~2 %); any recurring cut-out of 0.15–10 s in 7 / 96
(~7 %). The common real intermittency is slower (washer agitation: off 3–10
s; copier per-page cycles; fridge / AC compressors cycle over minutes, which
5 s–5 min clips cannot show) or is amplitude pulsing rather than silence
(fridge start-up). Caveats: Freesound queries for "hum" favour steady
recordings and most field clips are short (median ~60 s), so this is a lower
bound on minute-scale cycling, not on second-scale cut-outs; the ESC-50 5 s
clips (45 short clips labelled intermittent) cannot show a recurrence and are
excluded from the answer. Short tonal-intermittent sources that do exist in
the data: clock alarms / beepers, car horns, church bells, appliance "done"
beeps (e.g. the end of freesound microwave 94176).

## 4. Observation: the shipped worker on REAL noise-only audio

probe.mjs ran the real `src/` pitch worker (bc42ad0 notch, 16 kHz, 25 ms
chunks) over every non-duplicate noise clip ≥ 10 s (first 90 s): 279 clips.
"painted" = median-3 + paint gate, i.e. the false voicing a user would see.

| census label | clips | notch promoted | median promotion | painted FV mean | p90 | max | painted FV after 20 s |
|---|---|---|---|---|---|---|---|
| stationary-tonal | 102 | 87 (85 %) | 5.4 s | 12.9 % | 41.1 % | 97.3 % | 9.8 % |
| intermittent-tonal | 10 | 7 (70 %) | 5.4 s | 10.9 % | 29.0 % | 34.5 % | 0.9 % |
| mixed | 133 | 42 (32 %) | 5.4 s | 9.3 % | 35.2 % | 62.1 % | 6.8 % |
| broadband | 34 | 0 | — | 4.5 % | 19.5 % | 28.1 % | 5.2 % |

Synthetic noise-only false voicing after the 2026-07-20 harmonic guard was
≤ 0.7 % per class; on real machine noise the mean painted false voicing is
4.5–12.9 %, and 10 % of stationary-tonal clips paint > 41 % of the time.
The worst cases are rich harmonic stacks the 4-notch cascade cannot cover
(freesound hvac 121285: never promoted, 97 % painted; microwave 94176:
promoted at 8.5 s, 86 %; mains_hum 733739: 77 %; electric_motor 721016:
76 %). Not investigated here (DATA phase) — it says the real-noise baseline
the hypothesis phase must beat is far from the synthetic one, and that the
per-clip probe columns in `index_noise.json` (`probe.*`) are the place to
start.

## 5. Mixes (end-to-end streams; PCM16, specs in the manifests)

| set | streams | min | construction |
|---|---|---|---|
| voice_in_noise | 784 | 645.6 | each of 133 noise clips ≥ 20 s (84 stationary + 7 intermittent tonal, the 30 strongest-line mixed, 12 broadband controls) × 3 real voice programs (held_series / speech FDA-PTDB / other: vocadito, PVQD severity < 20, VOICED healthy) × SNR +10 / 0 dB; 20 s noise lead, program, 5 s tail; voice active RMS −20 dBFS. Streams whose program came from the private session recordings are left out. |
| held_series | 192 | 106.0 | 48 (singer, note in 75–460 Hz) VocalSet series of real same-pitch holds × silent gaps 0.15 / 0.3 / 0.5 / 1.0 s, ≥ 30 s, −70 dBFS floor — the repeated-holds family on real voices |
| noise_gated | 504 | 420.0 | 84 real stationary-tonal clips (looped to 50 s, −35 dBFS) switched fully off 0.15 / 0.5 / 1.0 s every 5 / 8 s from t = 2 s over r2int's 3e-4 floor — the R8 adversary on real sources |

276 streams whose noise had clicks / fade-ins were scaled down as a whole to
peak 0.9 (`level_scale`, SNR unchanged); none clip. `realdata.mjs`
`renderMix(spec)` reproduces every checked WAV to half a PCM16 LSB
(`mix-parity.mjs`: 8 streams per set, max |diff| 1.53e-5).

## Commands

See the [realdata README](../scripts/notch-adversarial/realdata/README.md)
("Rebuild"). Loaders: `realdata.mjs` (`loadIndex(kind, filters)`,
`readClip`, `loadF0`, `resample` 16 → 48 kHz, `renderMix`); indexes
`build/notchvd/data/index_{noise,voice,mix}.json`; census
`build/notchvd/data/census/noise_census.json` + spectrogram PNGs.
