# Custom voice-vs-machine detector — pre-registration (2026-10-06)

Branch `voice-detector`. This file is committed and pushed **before any model
is trained**. It fixes the training data, the splits, how the model and its
operating point are chosen, and the bar the result is judged on.

- Why a custom model: the off-the-shelf benchmark
  ([voice-detector-benchmark-2026-10-06.md](voice-detector-benchmark-2026-10-06.md))
  found that WebRTC, Silero, TEN and YAMNet all keep voice but remove only
  10–17 % of the false painted pitch on real noise. The bar asks for 60 %.
  Speech detectors read held notes and sustained vowels as non-speech, and
  harmonic machines as voice-like. The fix proposed there (§7, option 3): a
  small model trained for exactly this distinction, with noise training data
  disjoint from every benchmark noise set.
- Harness: [scripts/voice-detector/](../scripts/voice-detector/README.md),
  unchanged. Data definitions:
  [scripts/voice-detector/custom/splits.json](../scripts/voice-detector/custom/splits.json)
  (rules plus the exact lists the rules produce). Downloads:
  [scripts/voice-detector/custom/fetch_archives.py](../scripts/voice-detector/custom/fetch_archives.py).
- Audio, downloads and weights live under `build/vad-train/` (gitignored).
  Nothing of that is committed.
- The private session recordings are **never** used for training or for any
  selection. They are used once, for the private report V5 (§4).

**What this file leaves open.** The architecture, input features, training
recipe and augmentation parameters are free. They may be chosen using only the
selection data of §3. Everything else below is fixed.

## 1. Training data (a)

Every training file must carry one of these licences: CC0 1.0, CC BY 3.0 / 4.0,
ODC-By 1.0, Apache-2.0, MIT or BSD. No NC, no ND, no ShareAlike. The licence of
each source was read at its source (column "licence, where read"). The
manifest (§5) records source, URL, licence and attribution per file.

### 1.1 Voice positives

| source | URL | licence, where read | what is used | covers |
|---|---|---|---|---|
| LibriSpeech dev-clean, dev-other, test-clean, test-other | openslr.org/12 (mirror openslr.elda.org) | CC BY 4.0 (OpenSLR resource page; `LICENSE.TXT` in the tarballs re-read at extraction) | every utterance of the four subsets (146 speakers, about 21 h) | read speech, female and male |
| VCTK 0.92 | doi 10.7488/ds/2645 (datashare.ed.ac.uk) | CC BY 4.0 (`license_text.txt` of the item: the CC BY 4.0 legal code) | 1 utterance in 10 per speaker (FNV-1a rule), one microphone per utterance, all 110 speakers | read speech, 110 speakers (63 F, 47 M), many accents, two microphones |
| Coswara | github.com/iiscleap/Coswara-Data | CC BY 4.0 (`LICENSE.md`: the CC BY 4.0 licence text; README badge) | sustained vowels /a/ /e/ /o/ and counting (normal, fast) of 40 date folders; audio-quality label ≥ 1; returning users dropped | **sustained vowels** from 2,392 people (1,625 M, 765 F) on their own phones and laptops; includes people with COVID-19, cold and sore throat, i.e. **breathy and hoarse voices**; speech |
| MDVR-KCL | zenodo 2867216 | CC BY 4.0 (Zenodo record licence) | read text + spontaneous dialogue, 38 subjects | speech on a smartphone microphone; **Parkinson's speech** (hypophonic, breathy) next to healthy controls |
| Dagstuhl ChoirSet | zenodo 3897182 | CC BY 4.0 (Zenodo record licence) | close dynamic (DYN) and headset (HSM) tracks of single singers; takes with piano excluded | **held choral notes**, scales, tuning exercises; amateur SATB singers incl. basses (**low male**) and sopranos (**high female**) |
| ESMUC Choir Dataset | zenodo 5848990 | CC BY 4.0 (Zenodo record licence) | individual close-microphone tracks (S1–S5, A1–A3, T1–T3, B1–B2); room microphones excluded | **held notes**, warm-ups, three choral pieces; trained singers |
| Choral Singing Dataset | zenodo 1286570 | CC BY 4.0 (Zenodo record licence) | "Individual voices" tracks (16 singers × 3 pieces) | **held notes** in unison choir singing, 87–783 Hz |
| Cantoría Dataset | zenodo 5878677 | CC BY 4.0 (Zenodo record licence) | single-singer tracks S, A, T, B (no mixes) | professional quartet, **validation only** (§2.2) |

Coverage, as the brief asks:

- **speech**: LibriSpeech, VCTK, MDVR-KCL, Coswara counting;
- **singing and long held notes**: the four choir sets;
- **sustained vowels**, including breathy and dysphonic-like voices: Coswara
  vowels, plus MDVR-KCL Parkinson's speech. No clinical sustained-vowel corpus
  is used for training (§1.3: PVQD and VOICED stay evaluation sets);
- **low male and high female registers**: choir basses and sopranos, and the
  male and female speakers of every speech set.

**Labels.** A frame of a voice recording is a positive target when the
reference tracker marks it voiced: Praat AC, 60–1100 Hz, the settings of the
notchvd voice clips (`heldseg.py` `praat_f0`), run on the clean recording. It
must also lie within 30 dB of the recording's 95th-percentile voiced level, so
a quiet background line in a phone recording is not labelled voice. All other
frames of a clean voice recording are masked from the loss. They are not
negatives, because the background is unknown. In a training mix, the frames
outside the voice layer's positive frames are negative targets. The recipe may
also mask a margin around voicing boundaries.

### 1.2 Non-voice negatives (machine and room noise emphasised)

| source | URL | licence, where read | what is used |
|---|---|---|---|
| FSD50K | zenodo 4060432 | dataset CC BY 4.0 (`FSD50K.doc/LICENSE-DATASET`), per clip as `{dev,eval}_clips_info_FSD50K.json` states; only **CC0 1.0, CC BY 3.0, CC BY 4.0** clips (CC BY-NC and Sampling+ excluded) | clips with no human-voice, human-vocal-sound, music or animal label (33 classes listed in `splits.json`) and no voice / music keyword in title, description or tags. 17,681 clips before the audio checks below. **10,261** of them carry a machine / room / appliance class (fans, engines, idling, mechanisms, microwave, printer, power tools, hiss, buzz, domestic sounds, alarms, ringtones, traffic, …) |
| `fstrain`: Freesound HQ previews | freesound.org search pages | per sound, read from the search result and sound page; **CC0 or CC BY only** | machine and room recordings for the benchmark's 38 query topics of the 279-clip set (fridge, mains hum, transformer, fans, HVAC, heat pump, pumps, microwave, washer, dryer, generator, idling engine, …) plus 8 more; up to 20 per query, first 120 s. **None** of the 34 query topics of held-out set B, so held-out B stays a set of machine types never trained on |
| synthetic interferers | generated in process (port of `scripts/noise-synth.js` and the `scripts/notch-adversarial` families) | this project's own code | single and harmonic hums 40–460 Hz; 50 / 60 Hz mains complexes; fan hum over rumble; **voice-like machines** (a harmonic stack whose speed wobbles at 0.5–8 Hz, 3–10 c, shared by every partial); beating pairs; AM; drift, step and spin-up; intermittent switching; resonant, white, pink and brown noise; crickets and cicadas; codec birdies |
| room impulse responses | generated in process (shoebox image method) | this project's own code | reverberation of positives and negatives |

Machine and room material (the FSD50K machine / room classes, `fstrain`, the
synthetic interferers) makes up at least half of the negative draws in
training.

**Augmentation families allowed** (parameters free, chosen on the selection
data):

- gain;
- synthetic reverberation;
- mixing voice with training negatives at any SNR, including the bar's 0 and
  +10 dB;
- noise-only lead-ins and tails;
- band-limiting and resampling, including 8 kHz-origin audio and the app's
  rates 16 / 44.1 / 48 kHz through the app's resampler;
- pitch and formant shift;
- breathiness and roughness resynthesis (aperiodicity, jitter, shimmer) of
  training voices.

Hard-negative mining is allowed, for example running the production chain on
training negatives to find the hops it paints falsely. It must use training
data only.

### 1.3 Considered and not used

| candidate | why not |
|---|---|
| VocalSet, PVQD, VOICED, vocadito | benchmark V1 sets: kept out of training **entirely**, every speaker and every recording (§2.1). For VocalSet that includes the singers' other techniques |
| FDA, Hillenbrand | V1 sets; also research-use-only licences |
| PTDB-TUG | V1 set; ODbL 1.0 is not in the allowed list |
| MS-SNSD, DEMAND, ESC-50, DCASE 2020 T2 (dev + additional: MIMII, ToyADMOS), the benchmark's Freesound previews (`freesound`, `fsheld`) | benchmark noise sources (also NC licences for ESC-50 and DCASE) |
| DNS-Challenge noise | contains DEMAND (a benchmark source, CC BY-SA 3.0). Its AudioSet part is cut from YouTube videos: the CC BY 4.0 the repository cites covers AudioSet's annotations, not the uploaders' audio. Its Freesound part has no clip ids to de-duplicate against the benchmark |
| MUSAN noise | reachable only inside an 11 GB archive whose first 10 GB are music; its Freesound clips have no ids, so de-duplication would rest on fingerprints alone. FSD50K covers the same kind of material with per-clip ids and licences |
| FSD50K speech and singing clips | weak clip-level labels with unlabelled instruments and background: not clean voice positives. Excluded from the negatives too |
| NSynth vocal notes | sample-library voices replayed across extreme transpositions, and a "vocal" family that mixes in synthetic sounds: not natural phonation |
| Medley-solos-DB | released CC BY 4.0, but derived from MedleyDB, which is CC BY-NC-SA (provenance) |
| MIT IR Survey; the real RIRs of OpenSLR 28 | no licence stated / mixed provenance (RWCP, REVERB, AIR); RIRs are synthesised instead |
| LibriTTS, Hi-Fi TTS, MLS, AISHELL-3 | speech is already covered; same speakers as LibriSpeech (LibriTTS) or tens of GB for no new voice type |
| EARS, Expresso, GTSinger, M4Singer, Opencpop, Children's Song Dataset, RAVDESS, MedleyDB, WHAM!, TAU Urban | non-commercial licences |
| QUT-NOISE, MIMII DUE / DG, VocalSound | ShareAlike (not in the allowed list); MIMII is DCASE material |
| Coswara dates 20200417, 20200814, 20200820 | held-out voice sets of the notch work (`build/notchvd-heldout*`); kept clean |

## 2. Splits (b)

### 2.1 Evaluation sets: kept out of training entirely

None of the benchmark's V1 voice sets is used for training or selection:

- FDA, PTDB-TUG, vocadito, VocalSet, PVQD, VOICED and Hillenbrand;
- the voice programs of the voice-in-noise mixes, which come from those same
  sets.

None of the three noise evaluation sets is used for training:

- the 279 clips (tuning 194 + held-out A 85);
- held-out B (119 clips);
- the mixes' noise, which is a subset of the 279.

**V1 is therefore scored on every stream, by the unchanged `score.py`, with
the same denominators as the off-the-shelf benchmark. No stream list is
needed.** The V1 sample sizes are the harness counts: CORRECTLY painted hops
of the current app.

| V1 row | streams | f | m | unknown |
|---|---|---|---|---|
| FDA speech | 100 | 2,274 | 1,914 | — |
| PTDB-TUG speech | 180 | 4,304 | 3,785 | — |
| vocadito singing | 40 | — | — | 20,817 |
| VocalSet long tones | 399 | 17,130 | 70,979 | — |
| PVQD + VOICED | 296 + 208 | 21,503 (VOICED) | 11,923 (VOICED) | 134,870 (PVQD) |
| Hillenbrand | 1,116 | 5,692 | 4,283 | — |
| voice in noise +10 dB, lead 20 s | 392 | 35,918 | 104,525 | 45,233 |
| voice in noise 0 dB, lead 20 s | 392 | 21,906 | 67,220 | 31,515 |
| voice in noise +10 dB, lead 0 | 392 | 35,860 | 104,420 | 44,966 |
| voice in noise 0 dB, lead 0 | 392 | 22,597 | 66,077 | 30,320 |

V2 denominators (falsely painted hops):

| set | false hops |
|---|---|
| all 279 | 122,436 |
| tuning 194 (selection only) | 79,223 |
| held-out A, 85 | 43,213 |
| held-out B, 119 | 46,033 |

### 2.2 Training and validation (speaker-, singer- and source-disjoint)

The validation ("val") split is used only for model selection. Every rule is
deterministic; FNV-1a is the 32-bit hash of `scripts/realnoise-fv/lib/sets.mjs`.

| source | train | val | disjoint by |
|---|---|---|---|
| LibriSpeech | dev-clean, dev-other (73 speakers) | test-clean, test-other (73 speakers) | speaker (by corpus design) |
| VCTK | 97 speakers | 13 speakers: FNV-1a(speaker) % 10 = 0 → p229 p234 p252 p258 p261 p278 p285 p294 p306 p313 p340 p351 p360 (8 F, 5 M) | speaker |
| Coswara | 35 date folders: 2,112 participants (1,420 M, 690 F, 2 other); 5,616 vowels, 3,824 countings | 5 date folders, FNV-1a(date) % 8 = 0 → 20200418 20200502 20200911 20200919 20210914: 280 participants (205 M, 75 F); 782 vowels, 523 countings | participant and recording date |
| MDVR-KCL | 30 subjects | 8 subjects: FNV-1a(id) % 5 = 0 → ID02 ID07 ID12 ID15 ID18 ID25 ID33 ID36 | subject |
| choir | Dagstuhl ChoirSet, ESMUC, Choral Singing Dataset | **Cantoría** (the whole dataset: 4 singers, 14 song parts) | dataset, so also choir, room and microphone |
| FSD50K | dev split (13,929 clips before the audio checks) | eval split (3,752) | Freesound uploader (the two splits share none: 4,947 vs 2,297 uploaders) |
| `fstrain` | rest | uploader in FSD50K eval, or FNV-1a(uploader) % 10 = 0 (an uploader in FSD50K dev is train) | Freesound uploader, consistent with FSD50K |
| synthetic, RIRs | seeds [0, 10⁹) | seeds [10⁹, 10⁹ + 2000) | generator seed |

### 2.3 De-duplication against the benchmark (negatives)

1. **By Freesound id.** Drop every id in the benchmark noise manifests
   (`noise.freesound` 146 + `noise.fsheld` 101) and every ESC-50 source id
   (`esc50.csv` `src_file`, 1,524 ids covering all 2,000 clips). Of the
   20,812 FSD50K clips that pass the licence and label rules, this drops 259
   (6 benchmark previews, 253 ESC-50 sources).
2. **By Freesound uploader.** Drop every clip uploaded by one of the 179
   uploaders of a benchmark Freesound preview: the same people, devices,
   rooms and machines. This drops 1,183 more FSD50K clips. The same rule
   applies to `fstrain`. The keyword rule then drops 1,689, leaving 17,681.
3. **By audio fingerprint.** Every remaining negative is fingerprinted
   against every clip of the benchmark noise manifests (freesound, fsheld,
   MS-SNSD, DEMAND, ESC-50, DCASE, dcaseeval). It is dropped if it matches at
   a bit error rate ≤ 0.35 over an aligned 3 s block, or over the whole
   shorter clip. This catches MS-SNSD's Freesound clips, which carry no ids,
   and re-uploads.
4. **Speech screen.** A negative is dropped if Silero VAD v6.2.3 gives
   p ≥ 0.9 on ≥ 1.0 s of its frames. This catches voices that the labels and
   keywords missed. Drops are reported per class: a machine class losing more
   than 5 % of its clips would be reported as a sign the screen removes hard
   negatives.

Every exclusion is listed in the manifest with its reason.

## 3. Model and operating-point selection

**Selection data.** Only these may be used:

- (i) the val split of §2.2;
- (ii) the **194-clip tuning split** of the 279 noise clips, exactly as in the
  benchmark.

Neither the V1 voice sets, nor the mixes, nor held-out A, nor held-out B is
read before the final model is frozen. Selection tools read only `noise`
dumps with `split == "tune"`.

**Validation streams through the production chain.**

- **Val voice.** Whole recordings of:
  - LibriSpeech test, up to 20 utterances per speaker;
  - VCTK val;
  - MDVR-KCL val;
  - Coswara val vowels and countings;
  - Cantoría.

  Each recording runs at its native rate (16 / 44.1 / 48 kHz) through
  `dump.mjs`'s chain with a Praat AC reference (the convention of the
  VocalSet / PVQD / VOICED sets). Val gender: corpus metadata; choir S / A →
  f, T / B → m.
- **Val mixes.** Val voice programs in val negatives (FSD50K eval machine /
  room clips ≥ 20 s, `fstrain` val, synthetic val), built like the
  benchmark's mixes: +10 and 0 dB, a 20 s noise lead with a 5 s tail, and
  lead 0.
- **Val negatives.** The same noise clips alone.

**Rule.** For each trained model, the operating point is chosen on a grid of
threshold × hangover (and the candidate interface's `agg`):

1. **Feasible** = all of these on the val streams:
   - on every clean val group, the worse gender vetoes ≤ **0.5 %** of
     CORRECTLY painted hops. The groups are speech, sustained vowels (Coswara
     vowels) and held singing (Cantoría);
   - on every val mix cell (+10 / 0 dB × lead 20 s / lead 0), the worse
     gender vetoes ≤ **1.5 %**;
   - frame + lookahead ≤ 100 ms, and the median onset delay is ≤ 100 ms.

   These limits are half the bar's 1 % / 3 %, as a margin for the step from
   the val corpora to the evaluation corpora.
2. **Objective**: the share of falsely painted hops vetoed on the tuning 194,
   pooled over hops. The feasible point that maximises it is chosen. Ties
   (within 0.5 pp) go to the shorter hangover.
3. **Between models** (architectures, recipes, checkpoints): the model with
   the best objective at its own chosen point wins. Within 1 pp, the one with
   the lower desktop WASM cost wins. The val-negatives V2 share is a
   secondary tie-break.

**Freeze, then one look.**

- The chosen model is committed with the sha256 of its weights and its
  `candidate.json`, operating point included, **before** its runner touches
  any evaluation stream.
- It is then scored **once** on the full harness: `score.py`, every set.
- That first look is the pre-registered verdict. Any later model or
  operating point is reported as post-hoc, with the number of evaluation
  looks so far.

## 4. Evaluation (c): the bar, verbatim, plus V5

The same bar as the off-the-shelf benchmark, fixed there before any candidate
ran and unchanged:

> PRE-REGISTERED VIABILITY BAR (fixed now; report every row; do not change after seeing numbers):
>  V1 voice kept: among the frames the CURRENT app (main = this branch's src) paints CORRECTLY on real voices, the detector (at one fixed operating point incl. its hangover/smoothing) vetoes <= 1 % on EACH voice set — FDA speech, PTDB-TUG speech, vocadito singing, VocalSet long tones (held notes), PVQD + VOICED sustained vowels (dysphonic/breathy), Hillenbrand vowels — computed per gender and reported as the worse gender; and <= 3 % on voice-in-noise mixes at +10 and 0 dB (incl. voice starting with the stream).
>  V2 noise removed: among the frames the current app paints FALSELY on real noise-only audio, the detector vetoes >= 60 % on the 279 tuning clips and >= 50 % on each held-out noise set; also report per noise class (stationary-tonal / intermittent / mixed / broadband; and the worst machine rooms: hvac, mains hum, microwave, fridge, generator).
>  V3 timing: the detector's decision for a frame must be available within 100 ms of that frame (lookahead + frame size) and voice onsets must not be vetoed for more than 100 ms (median) — the trace must not start later.
>  V4 deployability: permissive licence usable in a public app (MIT / BSD / Apache-2.0 without restrictive additions — read the actual licence text), model <= 5 MB, runs in the browser (onnxruntime-web WASM or pure JS/WASM), desktop CPU <= 2 ms per 25 ms of audio measured with the WASM backend (mobile estimated, not required).

**Readings.** The readings are those fixed in `score.py` (harness README,
"Viability bar"):

- gender groups f / m / unknown, scored on the worse group;
- four voice-in-noise cells, each ≤ 3 %;
- V2 pooled over hops; "each held-out noise set" = held-out A (85) and
  held-out B (119);
- V3 latency = `frame_ms` + `lookahead_ms`; the onset delay is the median over
  the voice sets and mixes, in the worse gender;
- V4 as declared in `candidate.json` and checked against the bar.

The verdict is the unchanged `score.py` over all 4,305 streams. The same
judge checks as the benchmark are run:

- re-run the model on seeded streams;
- truncation causality;
- re-read the licence;
- re-measure the WASM CPU, which the benchmark left as declared.

**V5 (reported, not a gate).**

- The frozen model, at its frozen operating point, is run through the same
  production chain (`scripts/session-oracle` conventions) over the private
  session recordings (`$SYRINX_SESSIONS_DIR`).
- Reported:
  - the share of CORRECTLY painted hops vetoed on the labelled voices;
  - the share of painted hops vetoed outside every labelled voice;
  - per session and pooled.
- The results go to the private measurements location outside this
  repository. This repository gets at most one aggregate sentence:
  "Results on the private session recordings are kept outside this
  repository."
- The recordings are never used for training, selection or tuning.

## 5. Model constraints (d) and deliverables

- **Causal.** Frame i uses only samples before its declared availability time
  (`first_avail_ms + i · hop_ms`). Checked by the judge's truncation test.
- **Decision ≤ 100 ms, lookahead included.** `frame_ms` (V3) is declared as
  the span of audio the network's feed-forward path sees for one decision:
  the analysis window plus any causal convolution's receptive field over
  time. Longer memory may only be carried as recurrent state, as Silero's
  LSTM is (declared 36 ms in the benchmark). A model whose feed-forward
  window exceeds 100 ms (as YAMNet's 975 ms patch did) fails V3.
- **Size ≤ 5 MB** (ONNX file bytes, or JS weights).
- **Runtime.** onnxruntime-web WASM, or pure JS / WASM. Desktop CPU ≤ 2 ms per
  25 ms of audio, single thread. Measured in headless Chrome launched with a
  temporary `--user-data-dir` and killed by its own PID (CLAUDE.md hard rule
  2), and in Node's V8. Mobile is estimated.
- **Input.** Each stream's own samples, resampled to the model rate by the
  same streaming resampler the pitch worker uses. The model then sees what a
  deployed gate would see. The benchmark noted that its runners' scipy
  resampling may flip a one-hop V1 margin.
- **Licence of the result.** The weights and the runner are this project's
  own work, to be released under MIT, with an attribution file for the CC BY
  and ODC-By training data built from the manifest. V4 is checked against
  that.
- **Data manifest.** `build/vad-train/data/manifest.jsonl`, one record per
  file: `id`, `kind` (voice / nonvoice), `source`, `split`, `group` (speaker,
  singer, participant or uploader), `path`, `sr`, `dur`, `url` (the exact
  file or archive member), `licence`, `attribution`, `gender` / `voice_part`
  where known, source metadata, and for dropped files the reason.
  Summary counts are added to this file as an addendum once the data step
  finishes, before any training.

## Process

- The private session recordings are not used in this step. Nothing derived
  from them is in this file.
- Downloads go to `build/vad-train/dl/` (gitignored), with at most three
  transfers at once. No audio and no weights are committed.
- No PR is opened.

## Addendum A — data step (2026-10-06, before any training)

The text above was committed and pushed as 978ef5f before any data was
prepared and before any model was trained. This addendum records what the data
step produced, and every place where it departs from that text. **No model has
been trained.** The private session recordings were not read.

**Where the data is.**

- Manifest: `build/vad-train/data/manifest*.jsonl`. There is one file per
  preparation run; the latest record per id wins (`common.py`
  `load_manifest`). Each record carries the source, URL or archive member,
  licence, where the licence was read, attribution, group, split and
  gender / voice part. Dropped files carry the reason.
- Audio: 16 kHz PCM16 under `build/vad-train/data/{voice,nonvoice}/<source>/`.
- Praat AC references: `<id>.f0.npz`.
- Native-rate copies of the val voice files: `data/valnative/`.
- Audio checks: `build/vad-train/meta/dedup_report.json`.
- Counts: `meta/summary.json`.
- Disk use: data 18 GB, downloads 73 GB (28 GB of that is the extracted
  FSD50K), all gitignored.

**What was built** (`summarize.py`):

| kind | source | split | files | hours | groups | f / m / unknown groups | voiced h | machine / room files |
|---|---|---|---|---|---|---|---|---|
| voice | LibriSpeech | train | 5,567 | 10.51 | 73 | 36 / 37 / 0 | 5.63 | — |
| voice | LibriSpeech | val | 5,559 | 10.75 | 73 | 37 / 36 / 0 | 5.60 | — |
| voice | VCTK | train | 3,878 | 3.65 | 97 | 55 / 42 / 0 | 1.40 | — |
| voice | VCTK | val | 533 | 0.48 | 13 | 8 / 5 / 0 | 0.17 | — |
| voice | Coswara | train | 9,412 | 27.65 | 1,999 | 650 / 1,349 / 0 | 14.27 | — |
| voice | Coswara | val | 1,299 | 4.02 | 268 | 72 / 196 / 0 | 2.11 | — |
| voice | MDVR-KCL | train | 58 | 2.23 | 30 | 0 / 0 / 30 | 0.72 | — |
| voice | MDVR-KCL | val | 15 | 0.64 | 8 | 0 / 0 / 8 | 0.23 | — |
| voice | Dagstuhl ChoirSet | train | 500 | 6.60 | 10 | 4 / 6 / 0 | 5.12 | — |
| voice | ESMUC | train | 399 | 5.65 | 13 | 8 / 5 / 0 | 3.77 | — |
| voice | Choral Singing Dataset | train | 48 | 1.93 | 16 | 8 / 8 / 0 | 1.39 | — |
| voice | Cantoría | val | 56 | 2.42 | 4 | 2 / 2 / 0 | 1.57 | — |
| non-voice | FSD50K | train | 12,923 | 29.28 | 2,688 | — | — | 7,195 |
| non-voice | FSD50K | val | 3,611 | 9.95 | 1,116 | — | — | 2,479 |
| non-voice | `fstrain` | train | 514 | 7.36 | 385 | — | — | 514 |
| non-voice | `fstrain` | val | 115 | 1.88 | 84 | — | — | 115 |

- **Totals.** Voice: 58.2 h train, 18.3 h val. Non-voice: 36.6 h train,
  11.8 h val. The synthetic interferers and room impulse responses are
  generated in process; they are not files.
- **Registers.** Median F0 of the files by group:

  | source | f | m |
  |---|---|---|
  | VCTK | 200 Hz | 111 Hz |
  | LibriSpeech | 205 Hz | 120 Hz |
  | Coswara | 209 Hz | 128 Hz |
  | choir sets | 297–425 Hz | 147–212 Hz |

  Basses and low speakers reach the bottom of the 75–400 Hz band.

**Checks.**

- **Split disjointness.** 6,746 groups (speakers, singers, participants,
  uploaders); none appears in both train and val. Freesound uploaders were
  checked jointly across FSD50K and `fstrain`.
- **Licences of the kept files.** CC BY 4.0: 27,486; CC0 1.0: 9,524;
  CC BY 3.0: 7,477. Nothing else. Every kept file has an attribution.
- **Fingerprint matcher.** FSD50K has 259 clips that were dropped by id
  (6 benchmark previews, 253 ESC-50 sources). As a self-test, they were run
  through the matcher:
  - all **112** whose benchmark copy is in the index were matched, at
    BER 0.011–0.344. All but two were ≤ 0.26;
  - none of the 147 whose ESC-50 excerpt is not a benchmark clip was matched.

  Over the whole negative set, the closest candidates that were not matched
  sit at BER 0.355–0.38. Most of them are clips shorter than 1 s, or
  repetitive clock ticks. The margin is therefore narrow: a copy that has
  been degraded more than the worst known one (0.344) could be missed. The
  id, uploader and matched-uploader rules are the backstop.
- **Fingerprint drops: 35** (27 FSD50K, 8 `fstrain`).
  - The Freesound originals of MS-SNSD's air-conditioner, copier and
    vacuum-cleaner clips. These turned up in FSD50K and among the `fstrain`
    search results.
  - ESC-50 sources under other Freesound ids (a church-bell series, alarms,
    engines).
  - One held-out B clip and one 279-set clip under other ids (BER 0.24 and
    0.29).
- **Speech screen: 69 drops** (65 FSD50K, 4 `fstrain`).
  - FSD50K machine / room classes lost 52 of 9,933 (0.5 %).
  - `fstrain` lost 4 of 648.
  - Both are under the 5 % flag.

**Departures from the text above.**

1. **Matched-uploader rule (stricter; added before training).** If any clip
   of an uploader fingerprint-matches benchmark audio, that uploader's other
   clips are dropped too, as for a benchmark uploader. The reason is rule 2's:
   the same people, devices, rooms and machines. This covers 25 uploaders and
   270 clips (263 FSD50K, 7 `fstrain`). A few matches at BER 0.2–0.34 may be
   similar recordings rather than copies. Dropping them only removes training
   data.
2. **Fingerprint candidate search.** Candidates come from exact 16-bit
   half-word hits, not exact 32-bit sub-fingerprints.
   - Why: a channel-0 copy of a stereo preview sits at about BER 0.2 from
     FSD50K's mono mix, and a 32-bit word rarely survives that. The first
     version recalled 104 of the 112 known duplicates.
   - The rule itself is unchanged: BER ≤ 0.35 over an aligned 3 s block.
   - All-zero (silent) words are left out of the BER.
   - The dedup ran again from scratch with this version.
3. **Keyword list.** It was widened slightly before the FSD50K pass, for
   example *spoken*, *sung* and *vocalise*. It dropped 1,700 clips. The §1.2
   and §2.2 figures (1,689 drops, 17,681 clips) were computed with the
   narrower draft.
4. **Counts differ from the metadata estimates in §1–2.**

   | source | estimate | built | why |
   |---|---|---|---|
   | FSD50K train / val | 13,929 / 3,752 | 12,923 / 3,611 | the wider keyword list, 781 clips under 0.5 s, the audio checks |
   | Coswara participants with ≥ 1 kept recording, train / val | 2,112 / 280 | 1,999 / 268 | every recording had quality label 0 or no voiced frame |
   | `fstrain` | — | 648 clips over 46 queries | median 17 per query, at least 3; 9.2 h after the 120 s cap |
5. **Gender.** MDVR-KCL's release gives no speaker gender, so its speakers
   are "unknown". The Dagstuhl ChoirSet uses 10 singer ids (S1–S2, A1–A2,
   T1–T2, B1–B4), and these are its groups.

**Not built yet.** These are the first work of the training step, built from
this manifest by §2.2 and §3:

- the synthetic interferers and room impulse responses (in process, with the
  §2.2 seeds);
- the production-chain dumps of the val voice;
- the val mixes and the val negatives.

## Addendum B — training step (2026-10-07, before the evaluation look)

Training, the validation streams and the selection are reported in
[voice-detector-custom-training-2026-10-06.md](voice-detector-custom-training-2026-10-06.md).
The rule of §3 chose run `r5-bighard`, step 10,000, EMA weights (89,257
parameters), at agg `mean`, p ≥ 0.30, hangover 3 s, among 30 checkpoints of 7
runs. Its tuning-194 V2 is 82.36 %; the worst val group is 0.48 % and the worst
val mix cell 1.27 %. The frozen `candidate.json`
([scripts/voice-detector/train/frozen/candidate.json](../scripts/voice-detector/train/frozen/candidate.json))
carries the operating point and the sha256 of the checkpoint
(`222df077…c387`), its state dict (`e17d09f7…f26d`) and the streaming ONNX file
(`4230d27a…c23d`, 1,485,034 B). It was committed before the runner touched any
evaluation stream. The departures of the training step are listed in §5 of
that note.

