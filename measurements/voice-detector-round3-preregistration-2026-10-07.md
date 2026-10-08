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

## Addendum R3-A — data step and seal (2026-10-08, before any round-3 model is trained)

This file was committed and pushed as cb5ee91 before any round-3 data was
downloaded. This addendum records what the data step produced and where it
departs from §1–§2. **No round-3 model has been trained, and no model of any
round has been run on a confirmatory stream.** Nobody listened to, plotted or
scored a confirmatory clip. The only figures read from the confirmatory set
are the current app's aggregate counts that §1.6 allows (A.4). The private
session recordings were not read.

- Code: [scripts/voice-detector/r3/](../scripts/voice-detector/r3/README.md),
  committed as f03d39b before the seal was computed (`seal.json`
  `code_commit`). Afterwards, `seal.py`'s export of `conf-manifest.jsonl` was
  trimmed: licences of whole datasets now sit in `seal.json` `sources`. This
  changes no hash and is committed with the seal.
- Data: under `build/vad-train/r3/` (gitignored); no audio is committed.
- Seal: `scripts/voice-detector/r3/seal-confirmatory.sha256` (59,969 files,
  15.2 GB; sha256 `e1aef115…98bc5`), `seal.json` (counts, sources, licences)
  and `conf-manifest.jsonl` (every confirmatory record, kept and dropped, with
  its licence; sha256 `2e525eea…dbcaf6`). `seal.py verify` re-hashed
  everything with 0 mismatches.
- Guard: `train/tcommon.read_wav` and `lib/streams.py` now refuse any path
  in the sealed set unless `VAD_R3_LOOK=1`, which only the look sets.

### A.1 Exclusion list and duplicate check (§1.1)

**Exclusion list.** `build/vad-train/r3/exclude.json` (sha256
`1b51f6b4…cd09`) was written before the first confirmatory search. It holds
54,531 Freesound ids, 7,761 uploaders and 12,139 speaker, singer,
participant and uploader groups, collected from:

- every record of the rounds 1–2 manifests, kept and dropped (88,460,
  including all 51,197 FSD50K clips and their uploaders);
- every id in the rounds 1–2 Freesound download indexes, kept and skipped;
- the benchmark's public voice and noise manifests, plus all 1,524 ESC-50
  source ids;
- the Coswara held-out dates;
- the 66 ids and 52 uploaders of the round-1 review probes;
- every Freesound id found in the review scratch directories (21,412 files
  scanned: 1,340 ids, 75 uploaders).

**Fingerprints of all earlier audio.** 56,305 clips, 172.2 h:

- rounds 1–2 training and validation files, kept and dropped;
- benchmark voice and noise;
- the review probes' audio.

The matcher is round 1's, with round 3's rule that a match needs ≥ 3 s of
aligned overlap at BER ≤ 0.35. Self-test on the rounds 1–2 known duplicates
of ≥ 3 s:

- 30 of 31 matched earlier audio: 19 the expected benchmark clip, 11 a
  near-identical clip from the same bell series. The one miss is a clock-tick
  clip (round 1: BER 0.206).
- 20 of 214 random earlier clips matched another earlier clip. Every one was
  the same recording (the same take on another microphone, a review-probe
  variant, an FSD50K duplicate). No unrelated pair matched.

**Matches in the confirmatory set.**

- Freesound clips were checked before they were kept. 1 match, the
  original of an MS-SNSD photocopier clip: the clip was dropped and its
  uploader banned.
- The other 8,077 clips were checked after preparation (`screen_conf.py`).
  1 match: a GTSinger French tenor vibrato segment against a VocalSet female
  *messa di voce* /u/ (BER 0.343, 8.3 s overlap). It is probably two similar
  sustained vowels, not a copy. The rule is applied as written: the clip
  **and the whole singer** (379 files) are dropped.

**Disjointness.** `train_side.py check`: none of the 88,460 rounds 1–2
records shares a group, Freesound id, uploader, LibriSpeech speaker or
SingBAP participant with the confirmatory set. `r3/train_exclude.json` holds
517 groups; 576 Freesound ids (every search result the confirmatory step
read, kept or not); 428 uploaders; 48 LibriSpeech speakers; 5 SingBAP
participants.

### A.2 What was built

**Voice** (kept records after every rule; "fresh" = clean streams at the
native rate, `cvoice`):

| key | files (fresh) | hours (fresh) | groups | gender (files) | subsets | licence |
|---|---|---|---|---|---|---|
| `c_ls` LibriSpeech train-clean-100 | 2,287 (480) | 8.06 (1.71) | 48 speakers (24 F, 24 M) | f 1,054 / m 1,233 | speech | CC BY 4.0 |
| `c_sbi` SingBAP intermediate | 4,064 | 4.41 | 5 participants (10 participant × mic) | unknown | held 1,634, breathy 2,036, humming 394 | CC BY 4.0 |
| `c_gts` GTSinger EN + FR | 1,069 | 2.96 | 4 singers | f 787 / m 282 | held 772, breathy 156, sirens 141 | CC BY-NC-SA 4.0 (evaluation only) |
| `c_jj` Jingju part 2 | 38 | 2.33 | 7 singers | f 19 / m 19 | held | CC BY 4.0 |
| `c_qbh` MTG-QBH | 118 | 0.88 | 118 (A.5) | unknown | held | record CC BY 4.0, README internal non-commercial use (evaluation only) |
| `c_aa` vowel phonations | 27 | 0.02 | 27 participants | f 15 / m 11 / unknown 1 | breathy | CC BY 4.0 |
| `c_fry` PLOS ONE vocal fry | 28 | 0.02 | 14 speakers | f 14 / m 14 | breathy 14 (fry), speech 14 (modal) | CC BY 4.0 |
| `c_ipa` Commons IPA trills | 10 | 0.01 | 10 | unknown | trills | CC BY-SA 3.0 / 4.0 (9, evaluation only), CC BY 4.0 (1) |
| `c_fsv` Freesound | 103 | 1.35 | 94 uploaders | unknown | held 33, children 25, speech 24, breathy 16, humming 4, sirens 1, trills 0 | CC0 62, CC BY 20, CC BY-NC 21 (evaluation only) |

Fresh clean streams: 5,937 streams, 13.67 h. Native rates (as distributed;
Freesound previews at their rate): 48 kHz 3,146; 44.1 kHz 2,293; 16 kHz 481;
8 kHz 6; 96 kHz 4; 22.05 kHz 3; 32 kHz 2; 24 kHz 1; 192 kHz 1.

**Noise** (`cneg`, first 90 s, ≥ 20 s, 16 kHz):

| group | streams | hours | from | licence |
|---|---|---|---|---|
| NA (Freesound) | 134 | 2.40 | 35 of the 44 queries yielded a kept clip; 125 uploaders | CC0 79, CC BY 30, CC BY-NC 25 (evaluation only) |
| NB | 57 | 1.12 | DCASE 2023 T2 additional (7 types: 21 streams), DCASE 2024 T2 additional (9 types: 17 streams), AVQ drones (7), AID (4 classes: blender, drill, hairdryer, vacuum; 12) | CC BY 4.0, except DCASE 2024 CC BY-NC-SA 4.0 (evaluation only) |

**Freesound selection** (`fs_conf.py`):

- Search: 412 pages read (plus the 51 pages of the trill fallback), giving
  576 candidates. 1,693 results were rejected
  by the cheap rules: 773 uploader used before, 486 id used before, 91 title
  keyword, 6 Sampling+.
- Selection: 494 candidates checked in FNV order of the id, 237 kept
  (103 voice, 134 NA). Reasons for the 257 drops:
  - 201 keyword rule on the description or tags;
  - 51 YAMNet voice screen;
  - 3 Silero speech screen;
  - 1 fingerprint;
  - 1 under 1 s Praat-voiced.

**Mixes** (`cmix20`, `cmix0`):

- 191 noise streams × 2 programs × {+10, 0} dB = 764 mixes per lead
  variant: 10.42 h with the 20 s lead, 6.18 h at lead 0.
- Programs rotate in the seeded order humming, speech, sirens, breathy,
  held, trills. Each subset gets 126–128 mixes; NA 536, NB 228.
- Program gender: f 202, m 122, unknown 440.

**One-room sessions** (`csess`):

- 160 sessions of 300 s (13.3 h) from 54 source groups: 54 clean, 106 noisy
  (bed NA 75, NB 31).
- Voice fraction 35.3–64.3 % (median 50.6 %). Longest noise-only stretch
  after the lead ≥ 41.3 s in every session. No timeline needed the forced
  fallback.

### A.3 Licences of the kept confirmatory files (7,935)

| licence | files |
|---|---|
| CC BY 4.0 | 6,523 |
| CC BY-NC-SA 4.0 (GTSinger, DCASE 2024; evaluation only) | 1,086 |
| CC0 1.0 | 141 |
| MTG-QBH (record CC BY 4.0, README internal non-commercial use; evaluation only) | 118 |
| CC BY-NC 3.0 / 4.0 (evaluation only) | 46 |
| CC BY 3.0 | 12 |
| CC BY-SA 3.0 / 4.0 (evaluation only) | 9 |

None of these files is used for training or selection, and no audio is
committed. Licence and source page are recorded per file in
`conf-manifest.jsonl`; for whole datasets they are in `seal.json` `sources`.

### A.4 Minimum sizes (§1.3, §1.4), from the current app's dumps only

**Clean fresh streams, CORRECT hops** (f / m / unknown):

| row | f | m | unknown | gating |
|---|---|---|---|---|
| speech | 57,242 | 55,619 | 21,934 | every group |
| held notes and sung phrases | 153,827 | 110,833 | 297,990 | every group |
| — 75–130 Hz | 36 | 128 | 19,900 | unknown alone; f and m are pooled into the all-gender row (20,064) |
| — 130–300 Hz | 71,850 | 57,060 | 206,627 | every group |
| — 300–400 Hz | 78,418 | 51,361 | 69,867 | every group |
| breathy and dysphonic | 27,042 | 10,331 | 243,582 | every group |
| **lip and tongue trills** | — | — | **321** | **below 400: cannot be evaluated** |
| humming | — | — | 70,133 | unknown |
| sirens and glides | 29,222 | 9,091 | 87 | f, m; unknown pooled (all-gender 38,400) |
| children (reported) | — | — | 10,131 | — |

**Noise-only streams, FALSE hops.** NA 64,677 and NB 51,354. Both are above
5,000, so the noise size fallback was not applied.

**Mix cells, CORRECT hops (f / m / unknown).** Every cell exceeds 400 in
every group:

| cell | f | m | unknown |
|---|---|---|---|
| +10 dB, 20 s lead | 48,663 | 31,064 | 88,153 |
| 0 dB, 20 s lead | 31,151 | 19,964 | 52,033 |
| +10 dB, lead 0 | 48,059 | 30,381 | 87,703 |
| 0 dB, lead 0 | 30,722 | 19,571 | 50,938 |

**One-room sessions.**

- Clean, CORRECT hops per subset: every subset and gender group is ≥ 400.
  The smallest groups are sirens f 533 and humming 3,869. Trills reach 15,421,
  but only because the 10 Commons trill clips repeat through their sessions
  (A.5).
- Noisy, CORRECT hops per cell: +10 dB f 29,375 / m 47,110 / unknown 72,311;
  0 dB f 19,417 / m 32,693 / unknown 43,340.
- FALSE hops in noise-only stretches ≥ 10 s: NA 78,749, NB 48,847. Shorter
  pauses: NA 53,504, NB 32,739.

**The trills row (§7, Q2).** It stands at 321 CORRECT hops and cannot be
evaluated.

- Its one fallback was applied: pages 6–8 of all 17 trill queries. Every page
  returned 0 results; pages 3–5 of the round-2 trill queries were already
  empty except for "rolled r".
- The Freesound search found 13 trill candidates; none survived the
  automatic rules (9 keyword rule, 4 YAMNet voice screen).
- The row is therefore the 10 Wikimedia Commons IPA samples (≈ 35 s in all),
  only 2 of them bilabial (lip) trills.
- **Real lip trills under open licences are not available in sufficient
  number.** The user decides whether round 3 proceeds without the trills
  clause.
- The trill programs in the mixes (126) and the trill sessions (18) repeat
  these same 10 clips.

### A.5 Departures and readings (each decided before any model touched the data)

1. **MTG-QBH has no per-file labels.** Its README gives no subject, gender or
   hummed / sung label; subjects sang "with or without lyrics". So:
   - every recording is a sung-phrase take of an unknown singer;
   - each recording is its own group;
   - QBH contributes nothing to the humming row.

   The README also says "may not modify". The files are mixed only
   internally for evaluation and are never redistributed.
2. **Vocal-fry gender.** The Commons file descriptions give 7 female and
   7 male speakers. Gender is taken from those descriptions, not the "all
   women" of §1.3.
3. **SingBAP.** A breathy *mm* glissando counts as breathy, not humming;
   humming = the non-breathy glissandi. The ≤ 30 min cap per participant × microphone dropped 992 takes; the MacBook
   microphone dropped 2,520.
4. **Jingju.**
   - The 13 files in the `accompaniment/` folders are instrumental tracks
     and were dropped.
   - Gender comes from the metadata role type: `nv…` → f, `nan…` → m,
     dan → f, laosheng / jing → m.
   - Singers come from the metadata. Two date folders belong to the same
     singers, which gives 7 singers. They appear only as hashed keys.
   - The 20-min cap per singer used the real durations and dropped 16
     recordings.
5. **NB "machine ids".**
   - DCASE 2023/24 additional data has one section per type. A machine id is
     therefore the first attribute pair of the file name (model, id or
     operating condition).
   - Four DCASE 2024 types have no attributes and give one stream each.
   - An id with less than 20 s of normal clips is skipped, and the next id in
     FNV order takes its place.
   - AID: one microphone file per recording (FNV order). Recordings shorter
     than 20 s are looped with 20 ms cross-fades to 20 s; AVQ the same.
6. **Freesound.**
   - The ≤ 2 clips per uploader cap counts voice and NA together ("over the
     whole confirmatory set").
   - An id found by several queries belongs to the first query in plan order.
   - "Children queries" = the round-2 queries naming a child, kid, girl, boy,
     toddler or baby.
   - Two Freesound outages during selection were retried, never recorded as
     drops.
   - The IPA regex is applied literally, so *postalveolar*, *palatalized* and
     *labialized alveolar* trills are included.
7. **Contributor names.** Wikimedia Commons contributors appear in stream
   ids and the committed manifest only as a hash of their key
   (`c3.anon`). The renamed specs, dumps and audio were checked equal
   to the originals apart from the ids.
8. **Session construction details** (§2 does not fix them; fixed in
   `sessions.py` before any session was built):
   - Episodes last U(10, 30) s. They read the source's recordings with a
     cursor, joined with 0.5 s gaps, so a long song or chapter is sung or
     read in parts.
   - A draw is accepted only if it meets the §2 voice-fraction and ≥ 40 s
     stretch constraints; up to 400 seeded sub-draws are tried.
   - Sessions take source groups in turn, FNV order within each source, so
     that every source contributes. A purely global FNV order would leave the
     small validation sources (Cantoría, SingBAP, children) without sessions.
   - 88 of the 160 confirmatory sessions draw on a single recording. Some of
     these sessions repeat a short clip throughout (c_aa vowels,
     c_ipa trills, c_qbh queries, single Freesound clips).
9. **Mix programs.** A recording of ≥ 20 s is a program on its own (its
   first 30 s). Shorter recordings of one group are joined, cycling the
   group's recordings when they are too few: 162 of the 764 mixes use a
   cycled program.
10. **Reference.** The §1.6 level rule (frames within 30 dB of the
    recording's 95th-percentile voiced level) is applied to every
    confirmatory reference and to the validation sessions' references.
11. **Spliced sessions (reported, not gating).** The confirmatory spliced
    construction is fixed in `seal.json`:
    - streams: every fresh confirmatory stream (`cvoice`, `cneg`, `cmix20`,
      `cmix0`) through `infer_carried.py`;
    - seed 20261011;
    - 20-min sessions.

### A.6 Validation side (§2) and the training side

**Validation one-room sessions** (`build/vad-train/r3/vsess`, from the
rounds 1–2 validation split only): 240 sessions, 20.0 h, from 80 groups, with
the current-app dumps complete.

- Sessions per source:

  | source | sessions |
  |---|---|
  | LibriSpeech test | 36 |
  | Coswara | 36 |
  | `fsvoice` | 36 |
  | SVD | 33 |
  | VCTK | 33 |
  | MDVR-KCL | 24 |
  | SingBAP | 18 |
  | Cantoría | 12 |
  | children | 12 |

- Noise beds:
  - the 6 FSD50K eval machine / room clips of ≥ 30 s (FSD50K clips
    rarely reach 30 s);
  - all 115 `fstrain` val clips;
  - 40 synthetic val interferers (seeds 10⁹ + 1000 … + 1039).
- Voice fraction 35.3–64.0 %, every session with a ≥ 41.6 s noise-only
  stretch.
- Current-app counts: every clean val row has ≥ 494 CORRECT hops in each
  gender group present. FALSE hops in noise-only stretches ≥ 10 s: 151,930.

**Training side.** Round-3 training, validation and selection read nothing
under `build/vad-train/r3/conf` (the guard at the top of this addendum). Any record touching the
confirmatory set is removed by `train_side.filter_records()`. The rounds 1–2
manifests contain none (A.1).

### A.7 What the user is asked before training

- **Q2 (trills).** The trills row has 321 CORRECT hops and its fallback added
  nothing. Should round 3 proceed without the trills clause of V1 clean?
  Lip-trill safety would then rest on the reported (non-gating) rows: the
  10 Commons trills, which repeat through 18 one-room sessions and 126 mixes.
- **The GTSinger match (A.1).** Following the rule removed a likely-spurious
  match together with a whole male singer. The set stays as sealed;
  reported for transparency.
