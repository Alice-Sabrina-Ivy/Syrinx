# Custom voice-vs-machine detector — round 3 pre-registration (2026-10-07)

Branch `voice-detector`. This file is committed and pushed **before any
round-3 data is downloaded and before any round-3 model is trained**. It fixes
the confirmatory evaluation set and its seal, the realistic carried-state
sessions, the design space, the selection rule, the bar and the one look.

- Started on the user's decision of 2026-10-07 ("Start round 3 now").
- Rounds 1 and 2:
  [voice-detector-custom-preregistration-2026-10-06.md](voice-detector-custom-preregistration-2026-10-06.md)
  (incl. Addenda A–H),
  [voice-detector-custom-training-2026-10-06.md](voice-detector-custom-training-2026-10-06.md),
  [voice-detector-custom-2026-10-06.md](voice-detector-custom-2026-10-06.md).
  The bar and the harness:
  [voice-detector-benchmark-2026-10-06.md](voice-detector-benchmark-2026-10-06.md),
  [scripts/voice-detector/](../scripts/voice-detector/README.md).
- Measurement only: `src/` is not touched, nothing is integrated, no PR is
  opened. No audio and no weights are committed.
- The private session recordings are **never** used for training, selection
  or tuning. They are used once, for V5 (§6), after the look; the results stay
  in the private measurements folder used in rounds 1–2, and this repository
  gets at most one aggregate sentence.

## 0. Why round 3, and what it must answer

Round 1 (frozen r5-bighard, agg `mean`, p ≥ 0.30, hangover 3 s) removed
80 / 74 / 75 % of the false painted pitch on real noise but vetoed male held
notes and dysphonic vowels in stationary machine noise (worst cell 6.88 %, bar
3 %), clean VocalSet lip trills (19 %, female 33 %), and 2–4× more with its
state carried through a session. Round 2 fixed voice safety (worst clean
0.17 %, worst mix 0.51 %, lip trills 0.00 %, carried V1 worst 0.85 %) but
removed only 28 / 28 / 32 % (bar 60 / 50 / 50 %).

Round 2 left four open questions; round 3 is built around them:

1. **Carried-state validation was a worst case.** It spliced unrelated
   recordings, so the room, microphone and level changed about every 20 s, and
   requiring feasibility there forced the threshold down to p ≥ 0.03. Round 3
   gates on **one-room-per-session** carried sessions (§2) and keeps the
   spliced sessions as a reported stress row.
2. **The staggered reset's MAX combination cost most of the removal** (46.5 →
   28.0 % at the frozen threshold). Mean and longer-history combinations, and
   memory bounded by design, were not tried. Round 3 selects among them on
   validation only (§3). Post hoc, the round-2 network without the reset,
   fresh state, reached 67 / 64 / 64 % on the old sets; that figure was seen
   on evaluation data and is not used for anything here.
3. **Every evaluation set has been looked at twice**, plus the reviews.
   Round 3 is judged on a **new, sealed confirmatory set** (§1) of voices and
   noises that no earlier step has read, including **real** lip and tongue
   trills.
4. **Cost.** Two model copies cost 1.57–1.71 ms per 25 ms on a loaded desktop,
   likely over 2 ms on phones. Round 3 prefers a single model (§3.4) and
   reports a phone estimate (§4, V4).

## 1. Confirmatory evaluation set (sealed)

### 1.1 Rules for every confirmatory source

- **Never used before.** No speaker, singer, participant, Freesound uploader or
  Freesound id that appears in any of: rounds 1–2 training and validation
  (`build/vad-train/data/manifest*.jsonl`, kept *and* dropped records), the
  benchmark's voice and noise sets (FDA, PTDB-TUG, vocadito, VocalSet,
  PVQD, VOICED, Hillenbrand; MS-SNSD, DEMAND, ESC-50 incl. every `src_file`
  id, DCASE 2020 T2 dev / additional / `dcaseeval`, the `freesound` and
  `fsheld` previews), the notch work's held-out voice sets (Coswara dates
  20200417, 20200814, 20200820), and the reviews' probes of rounds 1–2 (the
  66 ids and 52 uploaders of `splits.json` `round2.fsvoice.excluded_*`, plus
  every Freesound id in the review scratch indexes, collected before any
  confirmatory search). The collected exclusion list is written to
  `build/vad-train/r3/exclude.json` and its sha256 goes into the seal (§1.6).
- **Licences.** Evaluation-only data may carry other licences than training
  data (CC BY-NC, CC BY-NC-SA, CC BY-SA, research-use terms). Each licence is
  read at the source in the data step and recorded per file. No confirmatory
  file is ever used for training or selection, and no audio is committed.
- **Selection before listening.** Every clip is chosen by the fixed rules
  below (query lists, page ranges, caps, FNV-1a orders, automatic screens).
  Nobody listens to a confirmatory clip, plots it, or runs a candidate
  detector on it before the look. Automatic screens (YAMNet voice screen,
  Silero speech screen) are data rules, applied as in rounds 1–2; their
  outputs are used only for keep / drop.
- **FNV-1a** = the 32-bit hash of `scripts/realnoise-fv/lib/sets.mjs`, over
  UTF-8 bytes; "FNV order" = ascending FNV-1a of the stated key.
- **Duplicate check.** Every confirmatory clip is fingerprinted (the round-1
  matcher) against every training, validation, benchmark and probe clip, voice
  and noise. A match (BER ≤ 0.35 over **≥ 3 s** of aligned overlap; Addendum
  D.1) drops the clip and its uploader / speaker from the confirmatory set.
- **Availability.** A source that cannot be downloaded without the user's own
  account, or whose licence read at the source forbids research evaluation,
  is dropped. Drops are recorded in the data addendum. No replacement is
  chosen beyond the fallbacks written here.

### 1.2 Voice sources

| key | source | licence (Zenodo / host metadata, re-read in the data step) | what is used | subsets |
|---|---|---|---|---|
| `c_ls` | LibriSpeech **train-clean-100** (openslr 12) | CC BY 4.0 | speakers in FNV order of `"r3:" + speaker`: the first 24 F and 24 M (none of the 146 dev / test speakers rounds 1–2 used, by corpus design); per speaker the first chapter in FNV order; up to 10 utterances (FNV order) as fresh streams; the whole chapter for the carried sessions | speech |
| `c_sbi` | SingBAP **intermediate** participants (zenodo 20744738, the archive not downloaded in round 2) | CC BY 4.0 | every intermediate participant; Behringer C-3 and iPhone 14 Pro tracks (MacBook not used, its fan); ≤ 30 min per participant and microphone, takes in FNV order of the file id | held notes, humming (hummed *mm* glissandi), breathy (breathy-phonation takes), sirens / glides |
| `c_gts` | GTSinger (Hugging Face `GTSinger/GTSinger`) | CC BY-NC-SA 4.0 — **evaluation only** | English and French singers; per singer and technique group (control, falsetto, breathy, mixed voice, pharyngeal, vibrato, glissando) up to 4 songs in FNV order; the paired-speech group is not used | held notes and sung phrases (falsetto / head voice → high register), breathy, sirens / glides (glissando) |
| `c_jj` | Jingju a cappella singing dataset part 2 (zenodo 1421692) | CC BY 4.0 (record metadata) | up to 20 min per singer (recordings in FNV order); role types give the register (dan → high, laosheng → low / mid) | held notes and sung phrases |
| `c_qbh` | MTG-QBH (zenodo 1290712) | record CC BY 4.0, README "internal non-commercial use only" — conflicting, therefore **evaluation only** (internal research use) | all 118 recordings, 17 amateurs (9 F, 8 M) | humming (hummed takes), held notes and sung phrases (sung takes) |
| `c_aa` | Acoustics Australia article dataset, vowel phonations (zenodo 7098345; profiles 7098349) | CC BY 4.0 | every `*_VWL*.wav` (29 participants, microphone and phone versions); gender from the profile sheet | sustained vowels / breathy-dysphonic (community adults, incl. smokers) |
| `c_fry` | PLOS ONE 9(5): e0097506 supplementary audio (Wikimedia Commons, `Vocal-Fry-May-Undermine…pone.0097506.s0NN`) | CC BY 4.0 (journal) — re-read on the file pages | every supplementary audio file (young women, modal and vocal-fry speech) | breathy / dysphonic (fry takes), speech (modal takes) |
| `c_ipa` | Wikimedia Commons IPA samples whose title matches `(bilabial\|alveolar\|uvular) trill` and not `voiceless` | per file (PD / CC BY / CC BY-SA) — evaluation only | every matching audio file | lip and tongue trills |
| `c_fsv` | Freesound HQ previews, uploaders never used (§1.1) | per sound: CC0, CC BY 3.0 / 4.0, CC BY-NC 3.0 / 4.0 (NC evaluation only); Sampling+ skipped | the queries of §1.2.1 | per query (§1.2.1) |

#### 1.2.1 Freesound voice queries (`c_fsv`)

Search pages scraped as in `fetch_fstrain.py` / `fetch_r2.py` (no API key);
duration 3–300 s, first 120 s used; the instrument / effects / non-human
keyword rule of `splits.json` `round2.fsvoice.keyword_exclude`; the YAMNet
voice screen of round 2 (keep a clip only if YAMNet's top class is
human-vocal in ≥ 50 % of 0.96 s patches); Praat-voiced ≥ 1.0 s; **≤ 2 clips
per uploader** over the whole confirmatory set (FNV order of the id decides);
eligible results of each query taken in FNV order of the id.

- **The round-2 `fsvoice` queries, pages 3–5** (round 2 read pages 1–2 only):
  every query of `splits.json` `round2.fsvoice.queries`, up to 8 per query,
  subset by the query's topic (as below).
- **New queries, pages 1–3, up to 10 per query:**

  | subset | queries |
  |---|---|
  | lip and tongue trills | "lip trills", "lip trill exercise", "lip roll warm up", "bubble lips", "motorboat lips", "trilled r", "tongue roll", "rolling r sound", "sovt exercise", "straw phonation" |
  | humming | "humming exercise", "hum warm up", "nasal hum", "humming song", "hummed melody" |
  | sirens and glides | "siren exercise", "vocal glide", "pitch glide voice", "octave slide voice", "vocal sweep" |
  | held notes, low | "monk chant", "om chant", "low drone voice", "basso profundo", "low voice singing", "throat singing" |
  | held notes, high | "soprano high note", "high note singing", "whistle register", "head voice exercise", "countertenor", "yodel" |
  | held notes, other | "holding a note", "long tone voice", "sustained ah", "drone singing", "lullaby singing", "nursery rhyme singing" |
  | breathy / dysphonic | "hoarse voice", "raspy voice", "breathy voice", "creaky voice", "voice crack", "laryngitis voice", "elderly voice", "old man speaking", "old woman speaking" |
  | speech | "reading aloud", "poem reading", "storytelling voice", "monologue", "speech recording room" |

### 1.3 Voice subsets (V1 rows)

| subset | made of |
|---|---|
| **speech** | `c_ls`, `c_fry` modal takes, `c_fsv` speech queries |
| **held notes and sung phrases** | `c_gts` (control, falsetto, mixed, pharyngeal, vibrato), `c_jj`, `c_qbh` sung takes, `c_sbi` non-breathy non-hummed takes, `c_fsv` held-note queries |
| **sustained vowels, breathy and dysphonic** | `c_aa`, `c_gts` breathy, `c_sbi` breathy takes, `c_fry` fry takes, `c_fsv` breathy / dysphonic queries |
| **lip and tongue trills** | `c_fsv` trill queries (new and round-2 trill queries, pages 3–5), `c_ipa` |
| **humming** | `c_qbh` hummed takes, `c_sbi` hummed glissandi, `c_fsv` humming queries |
| **sirens and glides** | `c_gts` glissando, `c_fsv` siren / glide queries |
| children (reported) | `c_fsv` children queries of the round-2 list, pages 3–5 |

- **Registers.** The held-notes subset is also scored per reference-F0 band
  of each CORRECT hop: **75–130 Hz (low)**, 130–300 Hz, **300–400 Hz (high)**.
  Each band row is a V1 row.
- **Gender** from corpus metadata (`c_ls`, `c_gts`, `c_jj` role, `c_qbh`,
  `c_aa`, `c_fry` → f); otherwise unknown. A row's result is its worst gender
  group, as in `score.py`.
- **Minimum size.** A gender group with ≥ 400 CORRECT hops (10 s of painted
  correct pitch) is gating on its own; smaller groups are pooled into the
  row's all-gender figure, which gates if it has ≥ 400. A row below 400 in
  total cannot be evaluated: the data addendum says so **before training**,
  and the user decides whether round 3 proceeds without that clause (§7, Q2).
  For the trills there is one fallback, applied once and before the seal:
  pages 6–8 of the trill queries.

### 1.4 Noise sources (two confirmatory groups)

Every noise clip passes the rounds-1–2 screens: the voice / music keyword rule
of `splits.json` `negatives.fsd50k` (Freesound titles, descriptions, tags),
and the Silero speech screen (drop if p ≥ 0.9 on ≥ 1.0 s). Streams are the
first 90 s, ≥ 20 s long (the benchmark's 279-clip convention, with the 20 s
mix lead).

**Group NA — Freesound, new uploaders, new topics.** Licences CC0, CC BY,
CC BY-NC (NC evaluation only). Queries never used by `fetch_noise.py`
`FS_QUERIES`, `fetch_heldout.py` `FS_HELD`, `fstrain` or `fsvoice`, and not
near-synonyms of them; pages 1–2; duration 20–900 s; ≤ 6 per query in FNV
order of the id; ≤ 2 per uploader:

> "ice maker", "water cooler hum", "vending machine hum", "espresso machine",
> "coffee maker running", "rice cooker", "air fryer", "induction hob",
> "electric kettle", "food processor", "stand mixer", "juicer", "sewing
> machine", "paper shredder", "photocopier", "laminator", "oxygen
> concentrator", "cpap machine", "nebulizer", "ups hum", "inverter whine",
> "led buzz", "dimmer buzz", "electric fence", "power line hum", "street
> light buzz", "lathe", "drill press", "table saw", "bench grinder", "welding
> machine", "lawn mower", "leaf blower", "pressure washer", "electric car
> interior", "tram interior", "ship engine room", "evaporative cooler",
> "garage door opener", "car wash", "room tone", "apartment room tone",
> "office room tone", "hospital room ambience"

**Group NB — recorded machine datasets never used.** Each machine type gives
up to 3 streams (distinct sections or machine ids, FNV order); a stream is the
section's normal clips in file order joined with 20 ms cross-fades to 90 s
(DCASE clips are 6–18 s).

| source | licence | machine types |
|---|---|---|
| DCASE 2023 T2 additional training dataset (zenodo 7830345) | CC BY 4.0 | Vacuum, ToyTank, ToyNscale, ToyDrone, bandsaw, grinder, shaker |
| DCASE 2024 T2 additional training dataset (zenodo 11259435) | CC BY-NC-SA 4.0 — evaluation only | 3DPrinter, AirCompressor, BrushlessMotor, HairDryer, HoveringDrone, RoboticArm, Scanner, ToothBrush, ToyCircuit |
| AVQ drone noises (zenodo 4553667) | CC BY 4.0 | drones, one stream per recording (joined as above when < 20 s) |
| AID anechoic interferer dataset (zenodo 6974033) | CC BY 4.0 | the motorised / electric device classes only (class name matches `drill\|blender\|dryer\|vacuum\|fan\|mixer\|shaver\|toothbrush\|printer\|machine\|motor\|pump\|kettle\|microwave\|fridge\|dishwasher\|washing`) |

- **Fallback for size**, applied once, before the seal: if a group has fewer
  than 5,000 FALSE hops of the current app, NA takes pages 3–4 of its queries
  and NB takes up to 6 streams per type.
- **Topic overlap is reported, not hidden** (Addendum D.1's lesson). Some NB
  types share a class with training or benchmark topics (vacuum, hair dryer,
  toothbrush, drone-like fans). V2 is reported for the shared and the new
  types separately; the gate uses each group as a whole.
- **Classes** for the V2 class rows come from `census.py` (stationary-tonal /
  intermittent / mixed / broadband), run in the data step.

**Considered and not used.** MUSAN noise: its Freesound part carries no ids or
uploaders, so the uploader exclusion cannot be applied; its SoundBible part is
short effects. TAU Urban Acoustic Scenes (12–26 GB per release), QUT-NOISE,
WHAM! noise, DAPS: size, or mostly speech / street rather than machines.
IDMT-ISA electric engine: CC BY-NC-ND (fine for evaluation, but the larger
DCASE sets cover motors). Clinical dysphonia corpora not used before (AVFAD,
the Italian Parkinson's voice and speech set): download needs a registration
in the user's name (§7, Q3). Coswara's remaining dates: all were used by
rounds 1–2 or the notch work.

### 1.5 Confirmatory streams

- **Clean voice (fresh):** every kept recording at its native rate (16 /
  44.1 / 48 kHz as distributed; Freesound previews at their rate), one fresh
  session per stream, through `dump.mjs`'s production chain with the Praat AC
  reference.
- **Noise-only (fresh):** every kept NA and NB stream.
- **Voice in noise:** each noise stream gets **2 voice programs**, rotating
  over the subsets speech, held notes, breathy, trills, humming, sirens in a
  seeded order (seed 20261012); a program is one recording, or one source
  group's recordings joined with 0.5 s gaps to ≥ 20 s. Built as the
  benchmark's mixes (`build_mixes.py` conventions, SNR as defined there):
  **+10 and 0 dB**, a **20 s noise lead** with a 5 s tail, and the same mixes
  cropped to **lead 0**. Four cells.
- **Carried sessions (confirmatory side):** §2.

### 1.6 Labels and the seal

- **Voiced reference**: Praat AC, 60–1100 Hz, the notchvd voice-clip settings
  (`heldseg.py` `praat_f0`), on the clean recording, within 30 dB of its
  95th-percentile voiced level — the method of rounds 1–2. In mixes and
  sessions the reference is the voice layer's track on the mix timeline.
- **Hop labels**: `dump.mjs` CORRECT / FALSE / WRONG / EDGE, unchanged.
- **The seal.** After the confirmatory data step and before any round-3
  training: a manifest of every confirmatory file (audio as prepared, mix and
  session specs, references, the current-app dumps, `exclude.json`) with its
  sha256, written to
  `scripts/voice-detector/r3/seal-confirmatory.sha256` (to be created) with
  `seal.json` (counts per subset, gender and group; the code commit that
  built it), and **committed and pushed** in the data addendum. The look
  re-hashes everything; any mismatch is reported in the verdict.
- **What may be read before the look**: the build logs and the aggregate
  counts in `seal.json` (streams, hours, CORRECT hops per subset × gender ×
  band, FALSE hops per group). These counts come from the current app only and
  decide only the minimum-size rules above. Nothing else of the confirmatory
  data is read, printed or plotted. Training, validation and selection scripts
  refuse paths under `build/vad-train/r3/conf/`.

## 2. Realistic carried-state sessions

One room and one microphone per session; the model's state is carried from
the session's first sample to its end (zero state at the start).

**Construction** (both sides, seeded):

- **Length** 300 s.
- **One voice source** per session: one speaker / singer / participant on
  one microphone (a LibriSpeech chapter; one participant × microphone; one
  singer; one Freesound uploader's clips).
- **One noise bed** per noisy session: one noise stream (one recording, or
  one NB section), looped with 1 s cross-fades for the whole session. **Fixed
  SNR** per session, +10 or 0 dB (alternating in session order), computed on
  the voice's active level as in `build_mixes.py`. **Clean sessions** have no
  bed; pauses hold a −70 dBFS seeded white floor.
- **Timeline**: a 30 s noise-only lead; then voice episodes (one recording,
  or consecutive utterances / takes of the source with their own pauses)
  separated by pauses drawn from {1, 3, 8, 20, 60 s} with probabilities
  {0.30, 0.30, 0.20, 0.15, 0.05}; at least one noise-only stretch ≥ 40 s; voice
  fraction 35–65 % (episodes are drawn until the session is full).
- **Voice level**: active level −26 dBFS ± 6 dB (one draw per session).
- Each session wav runs through the production chain (`dump.mjs`, one fresh
  app session per session wav) and the candidate's runner, state carried.

**Sides.**

| side | voice | noise | seeds | count |
|---|---|---|---|---|
| validation (selection) | rounds 1–2 val split: LibriSpeech test chapters, VCTK val speakers, Coswara val participants (all their recordings), MDVR-KCL val, SVD val speakers (`iau` takes), SingBAP val participant × microphone, `kids` val children, Cantoría singers, `fsvoice` val uploaders | val negatives: FSD50K eval machine / room clips ≥ 30 s, `fstrain` val, synthetic val (seeds [10⁹, 10⁹ + 2000)) | 20261010 | 1 clean + 2 noisy sessions per source group, capped at 240 sessions (20 h) in FNV order of the group |
| confirmatory (the look) | §1.2 sources | NA and NB streams | 20261011 | 1 clean + 2 noisy sessions per source group, capped at 160 sessions (13.3 h) in FNV order of the group |

**Readings** (both sides):

- **V1 carried**: CORRECT hops vetoed, worse gender. Clean sessions: one row
  per voice subset (§1.3; on the validation side per val group). Noisy
  sessions: one cell per SNR.
- **V2 carried**: FALSE hops vetoed inside noise-only stretches ≥ 10 s of the
  noisy sessions, counted from the stretch's start (the hangover after the
  last voice therefore counts against it), pooled over hops; also reported
  per noise group. FALSE hops in shorter pauses: reported, not gating.
- **Spliced sessions** (the round-2 construction, unrelated recordings
  joined in seeded random order into 20-min sessions): built on both sides,
  **reported, not gating**.

## 3. Design space and selection (validation only)

### 3.1 Families

The network is the round-2 one unless stated: log-mel front end, three causal
convolutions, GRU 96, 89,257 parameters, 12.5 ms hop, `frame_ms` 82. The
round-2 data, augmentation (roughness 0.2, breathiness 0.15) and source weights
are kept. At most **four** new training runs (16,000 steps each, seeds 31–34),
EMA checkpoints at steps 8,000 / 10,000 / 12,000 / 14,000 / 16,000.

| id | family | memory | runs per 25 ms | training |
|---|---|---|---|---|
| A0 | round-2 network (r8a, its 5 EMA checkpoints) and round-1 r5-bighard step 10,000, as is | unbounded | 1 | none |
| A-mean-T | the A0 networks, two copies, GRU state reset every 2T, offset T; **p = mean(p_A, p_B)**; T ∈ {5, 10} s | ≤ 2T | 2 | none |
| A-old-T | as A-mean-T, but **p = the copy whose time since reset is ≥ T** (exactly one at any time) | between T and 2T | 2 | none |
| B-leak | GRU with **state decay**: h ← λ·h before each step, λ = exp(−12.5 ms / τ), τ = 3 s, in training and in streaming | decays with τ (bounded in practice, not strictly) | 1 | 1 run (seed 31) |
| B-sess | plain GRU trained on **one-room sessions**: half the batch is 64–128 s training sessions built as §2 from training sources (one voice group, one negative bed, a session SNR drawn from the round-2 mix distribution or clean with p 0.2), truncated back-propagation over 8 s chunks with the state carried within the session, zero state at session start; the other half the round-2 crops; no state bank | unbounded | 1 | 2 runs (seeds 32, 33) |
| B-sess-leak | B-sess with the B-leak decay, τ = 3 s | as B-leak | 1 | 1 run (seed 34) |

- Each B checkpoint is also scored as A-old-10 (two copies, longer-history
  copy).
- **Excluded by construction: finite-receptive-field convolutional context
  over 1–4 s.** Round 1 §5 counts a causal convolution's receptive field over
  time in `frame_ms`, and the bar's V3 caps `frame_ms` + lookahead at 100 ms;
  a 1–4 s convolutional context therefore fails V3 by declaration. Memory is
  carried only as recurrent state, as in rounds 1–2. (Whether that reading
  should change is a question for the user, §7, Q1; it is not changed here.)
- The streaming ONNX export and its parity check (`export.py`) apply to every
  family; B-leak and B-sess-leak export the decay inside the graph.

### 3.2 Operating-point grid

24 thresholds (round 1's) × 16 hangovers (0–3 s) × agg {`last`, `mean`,
`max`}, per candidate (checkpoint × deployment rule).

### 3.3 Feasibility (all on validation data)

A point is feasible only if all of these hold:

1. **Fresh**: every clean val group of round 2 (speech, vowels, singing,
   clinical, exercises, children), worse gender, vetoes ≤ **0.5 %**; every
   val mix cell (+10 / 0 dB × 20 s lead / lead 0; round-1 and round-2 val
   mixes pooled per cell) ≤ **1.5 %**.
2. **One-room carried (§2, validation side)**: every clean group ≤ **0.5 %**,
   each SNR cell ≤ **1.5 %**.
3. **V3**: `frame_ms` + lookahead ≤ 100 ms; median onset delay ≤ 100 ms, fresh
   and carried.
4. **V4 cost**: desktop onnxruntime-web WASM (Node, 1 thread) ≤ 2 ms per
   25 ms for the deployment rule's runs.

The spliced validation sessions are scored and reported for every candidate
and are not part of feasibility.

### 3.4 Objective and choice

- **Objective O** = min of three V2 shares (pooled over FALSE hops): the
  194-clip tuning split (fresh), the val negatives (fresh), and the one-room
  carried val sessions (§2 V2 reading).
- Within a candidate: the feasible point with the largest O; within 0.5 pp the
  shorter hangover.
- Between candidates: the largest O; **within 1 pp a single-copy candidate
  wins over a two-copy one**, then the lower measured WASM cost, then the
  larger val-negatives V2.
- If no candidate has a feasible point: no freeze and **no look**; the
  selection table goes to the user (the confirmatory set stays sealed).

### 3.5 Freeze and the go / no-go before the look

- The chosen candidate is frozen as in rounds 1–2: checkpoint, state dict and
  ONNX sha256, deployment rule, operating point, `candidate-r3.json`,
  committed and pushed before its runner touches any confirmatory or harness
  stream.
- **Go / no-go**: the look is taken only if the frozen point is feasible
  (§3.3) **and O ≥ 60 %**. Otherwise round 3 stops before the look, the seal
  stays unbroken, and the user decides (§7).

## 4. The bar (round 3)

The V1–V4 wording of the pre-registered bar (benchmark §1) is unchanged; round
3 applies it to the confirmatory set, and adds the carried sessions as gates.
Readings are those of `score.py` (worse gender, pooled hops, onset delay
median), applied by a round-3 scorer that calls `score.py`'s own functions.

| | criterion | limit |
|---|---|---|
| **V1 clean** | CORRECT hops vetoed, per confirmatory subset (§1.3: speech; held notes and sung phrases, and its 75–130 / 130–300 / 300–400 Hz band rows; breathy and dysphonic; **real lip and tongue trills**; **humming**; **sirens and glides**), worse gender | ≤ 1 % each |
| **V1 noise** | CORRECT hops vetoed, confirmatory voice in confirmatory noise, each cell (+10 / 0 dB × 20 s lead / lead 0), worse gender | ≤ 3 % each |
| **V2** | FALSE hops vetoed on confirmatory noise-only streams: NA ∪ NB pooled | ≥ 60 % |
| | … each group, NA and NB | ≥ 50 % each |
| **V3** | `frame_ms` + lookahead; median onset delay, worse gender | ≤ 100 ms; ≤ 100 ms |
| **V4** | licence of the result (MIT, weights are this project's own work, CC BY training data attributed); model file; browser runtime; desktop CPU in onnxruntime-web WASM, 1 thread, Node and headless Chrome (temporary `--user-data-dir`, closed by its own PID), for the deployment rule's runs | permissive; ≤ 5 MB; WASM; ≤ 2 ms per 25 ms. Phone: estimated from the desktop figure × 2.4–4.5 (the benchmark's ratios); measured on the attached phone only if the user has it connected |
| **V1 carried** | one-room confirmatory sessions (§2): clean, per subset; noisy, per SNR cell; worse gender | ≤ 1 % clean; ≤ 3 % noisy |
| **V2 carried** | one-room confirmatory noisy sessions, noise-only stretches ≥ 10 s | ≥ 50 % |

- The children row, per-source and per-class V2 rows (incl. NB shared vs new
  machine types and the worst machine rooms), the spliced carried sessions,
  FALSE hops in short pauses, and clip-bootstrap 95 % intervals (2,000
  resamples of streams) for every gating row are **reported, not gating**.
  The verdict uses the point estimates.
- **Secondary guard: the old harness sets** (seen twice, plus the reviews).
  The unchanged `score.py` over all 4,305 harness streams, fresh, plus the
  spliced carried run (seed 20261008), at the frozen point. Reported in full.
  Any old V1 row worse than its bar by more than 1 pp (clean > 2 %, a mix cell
  > 4 %) is **flagged**, and whether that blocks the result is the user's
  decision. Old V2 rows are reported only.
- **Verdict**: the bar is met when every gating row above passes. A row that
  could not be evaluated (§1.3 minimum size) is stated as such, with the
  user's decision of §7, Q2.

## 5. Exactly one look

- **The look** is one run of the round-3 scoring script over every
  confirmatory stream (fresh voice, noise, mixes, one-room and spliced
  sessions) and the old harness, at the frozen point, after the freeze commit
  and the go decision, with the seal re-hashed first.
- No re-selection after it: no other checkpoint, deployment rule, threshold,
  hangover or agg is chosen with confirmatory data. Any later point is
  reported as **post hoc** with the number of looks, and never counts as a
  pass.
- Judge checks after the look, as in rounds 1–2: re-score with an independent
  path, re-run in onnxruntime-web WASM through the app's resampler (both copies
  if the rule has two), truncation causality, WASM CPU re-measured, licence
  and attribution re-read, freeze order (commit times vs probability-file
  times).

## 6. V5 (private, reported, not a gate)

After the look, once, at the frozen point: the frozen candidate over the
private session recordings through the same chain dumps and scorer as rounds
1–2 (correctly painted hops vetoed per labelled voice; painted hops vetoed
outside every labelled voice; per session and pooled). Results are appended to
the private measurements folder used in rounds 1–2 and not committed there.
This repository gets at most: "Results on the private session recordings are
kept outside this repository."

## 7. Open questions for the user (none blocks the data step)

1. **V3 reading for convolutional context.** A causal 1–4 s convolutional
   context is excluded (§3.1) because round 1 counts its receptive field in
   `frame_ms`. Changing that reading would be a bar decision, not a round-3
   decision.
2. **Rows too small to evaluate.** Real lip and tongue trills are scarce under
   the exclusions; if the trill (or any other) row ends below 400 CORRECT hops
   after its fallback, the data addendum says so before training, and the user
   decides whether to continue without that clause.
3. **Registration-gated clinical corpora** (AVFAD, the Italian Parkinson's
   voice and speech set) would add real dysphonic voices that no round has
   seen; they need a registration in the user's name and are not used unless
   the user provides them before the seal.

## 8. Order of work

1. This file: committed and pushed (now).
2. Data step: exclusion list, confirmatory sources (§1), validation-side
   one-room sessions (§2), current-app dumps; **data addendum + seal committed
   and pushed**, before any training. No confirmatory content is read beyond
   §1.6.
3. Training (§3.1, ≤ 4 runs) and selection on validation only (§3.3–3.4);
   **freeze committed and pushed**; go / no-go (§3.5).
4. If go: the one look (§5), judge checks, the evaluation note; V5 (§6).

Process limits: at most two heavy processes at a time (shared machine); every
spawned browser killed by its own PID; downloads and caches under
`build/vad-train/` (gitignored); no audio, weights or private results
committed; no PR opened.
