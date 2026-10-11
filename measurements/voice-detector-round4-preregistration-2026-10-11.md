# Custom voice-vs-machine detector — round 4 pre-registration (2026-10-11)

Branch `voice-detector`. This file is committed and pushed **before any
round-4 data is downloaded, before the sealed set is changed, and before any
round-4 model is trained**. It fixes the blind changes to the sealed
confirmatory set (the exclusion repair and more real trills), the round-4
design space aimed at steady machine noise, the selection rule, the go rule,
the bar and the one look.

- Started on the user's decisions of 2026-10-11: run round 4 aimed at steady
  hum / fan / fridge noise; keep the sealed set sealed for it; find more real
  trills first, blind, before any look.
- Round 3:
  [voice-detector-round3-preregistration-2026-10-07.md](voice-detector-round3-preregistration-2026-10-07.md)
  (incl. Addenda R3-A to R3-D) and
  [voice-detector-round3-selection-2026-10-11.md](voice-detector-round3-selection-2026-10-11.md).
  Rounds 1–2:
  [voice-detector-custom-preregistration-2026-10-06.md](voice-detector-custom-preregistration-2026-10-06.md),
  [voice-detector-custom-training-2026-10-06.md](voice-detector-custom-training-2026-10-06.md),
  [voice-detector-custom-2026-10-06.md](voice-detector-custom-2026-10-06.md).
- Code: [scripts/voice-detector/r4/](../scripts/voice-detector/r4/README.md),
  [scripts/voice-detector/r3/](../scripts/voice-detector/r3/README.md),
  [scripts/voice-detector/train/](../scripts/voice-detector/train/README.md).
- **Measurement only.** `src/` is not touched, nothing is integrated, and no
  PR is opened. No audio and no weights are committed.
- **The detector's job.** The app now gates the Perceived Voice panel with
  Silero VAD. This detector's remaining job is the **pitch display**: the
  stray pitch line painted during noise-only audio, about 24 % of noise-only
  time.
- **Private recordings.** The private session recordings are **never** used
  for training, selection or tuning. They are used once, for V5 (§6), and
  only after a look. The results stay in the private measurements folder
  used in rounds 1–3. This repository gets at most one aggregate sentence.

## 0. Why round 4, and what it targets

**Round 3 result (validation data only).**

- Frozen candidate: `custom-vd-r3` = `r9-sess-b` EMA step 8,000. It is a
  single model with state carried and never reset, at agg `mean`, p ≥ 0.30,
  hangover 600 ms.
- Voice-safe:
  - worst clean group 0.47 %;
  - worst mix cell 1.09 %;
  - one-room carried sessions: 0.04 % clean, 1.26 % at 0 dB.
- Cost: 0.73 ms (Node) / 0.85 ms (headless Chrome) per 25 ms.
- Removal: about 75 % on the validation negatives and on the one-room
  validation sessions.
- **O = 51.9 %**, set by the 194-clip tuning split, below the 60 % go bar.
  Result: **no-go**. The sealed set was not looked at and stays sealed.

**Where the false paint is.** The tuning-194 split by census label, from the
current app's dumps only (selection data; no model output involved):

| census label | clips | falsely painted hops | share |
|---|---|---|---|
| stationary-tonal | 69 | 38,760 | 48.9 % |
| mixed | 94 | 32,490 | 41.0 % |
| broadband | 22 | 6,068 | 7.7 % |
| intermittent-tonal | 9 | 1,905 | 2.4 % |
| **all** | **194** | **79,223** | |

- The largest machine classes are mains hum (10.0 %), electric fans (8.8 %),
  exhaust fans (5.8 %), microwave (5.6 %), MS-SNSD air conditioner (5.4 %),
  refrigerator (5.3 %) and HVAC (4.9 %).
- The round-3 review found that the frozen candidate's misses on this split
  are dominated by **steady** machine noise: steady hums, fans and fridges.
- Round 4 therefore changes what the network is trained on and what it is
  told about long-term steadiness. It keeps the validation data, the
  selection rule, the go rule and the bar.

**Round-3 review findings that round 4 repairs first.**

1. A sealed clip, `c_fsv__716881` (Freesound uploader *QuartzGate*), breaks
   the uploader exclusion.
   - Cause: `fs_conf.py` (search rule, line 166) and `train_side.py`
     compared uploader names case-sensitively.
   - The exclusion list holds the FSD50K spelling *quartzgate*.
   - The 7 FSD50K clips by that uploader are CC BY-NC and were dropped
     before any training. There was **no leak**, but the rule was broken.
   - Repair: §1 and §2.1.
2. The real lip / tongue trills row has **321** correctly painted hops; it
   needs 400. Repair: §2.2.

## 1. The exclusion repair (done; commit 3553241)

### 1.1 What changed

- **One comparison key.** `common.fold_user(u)` is NFKC normalisation, then
  `casefold()`, then strip. It is now the key of every uploader exclusion,
  ban, cap and split lookup:
  - `r3/fs_conf.py`: the search rule, the ≤ 2-per-uploader cap and the
    fingerprint ban;
  - `r3/train_side.py`: `touches()`, `filter_records()` and `check`;
  - the rounds 1–2 rules in `custom/fetch_fstrain.py` (benchmark uploader;
    the FSD50K-side split lookup), `custom/fetch_r2.py`, `custom/prepare.py`
    and `custom/dedup.py` (the fingerprint-match uploader ban).
- **Names that differ only by case count as one uploader.** This can only
  exclude more, never less.
- **Split hashes are unchanged.** Hashes that define a split
  (`fnv1a(uploader)`) still hash the raw name, as the rule was written.
- **`train_side.py check`** now lists every record that touches the sealed
  set, kept or dropped. It fails only on a kept one, because dropped records
  are never packed for training or validation (`pack.py` reads kept records
  only).
- **Unit check.** `python scripts/voice-detector/r4/audit_exclusions.py
  --selftest` checks:
  - `fold_user`: case, spaces, NFKC, casefold;
  - `touches` and `filter_records` on mixed-case uploader, group, id,
    speaker and participant records, including two near-miss records that
    must not be excluded;
  - a static guard: no exclusion script still compares a raw uploader name
    with `in`, `==` or `!=`.

  Result: PASS. **Mutation check:** reverting the `fs_conf.py` search rule
  to the raw comparison makes it FAIL at that line.

### 1.2 The audit (`audit_exclusions.py`; output `build/vad-train/r4/audit-exclusions.json`)

What was read:

- **The sealed set:** its manifest **metadata only** (ids, groups,
  uploaders, licences), as `train_side.py build` did in round 3. No audio,
  reference, stream spec, dump or count was read.
- **The training side:** the rounds 1–2 manifests. These are round 3's
  training and validation records, kept and dropped (88,460 records).

| check | result |
|---|---|
| **A** sealed set (11,860 records, 7,935 kept) vs `r3/exclude.json` (Freesound ids, uploaders, groups, LibriSpeech speakers, SingBAP participants) | **1 violation**: `c_fsv__716881`, kept, `c_fsv` speech subset (query "reading aloud"), session group `c_fsv:QuartzGate`. *QuartzGate* is in the list only as *quartzgate* |
| A, the ≤ 2 clips per uploader cap (case-insensitive) | holds |
| A, Freesound search candidates / selection with an excluded uploader | only 716881 (selected, kept) |
| **B** rounds 1–2 records touching the sealed set (`train_side.touches`) | **7**: `fsd50k__176159`, `178112`, `178115`, `178118`, `207411`, `207414`, `211548` (uploader *quartzgate*, train split, **CC BY-NC 3.0, dropped for the licence**, never packed). **0 kept** |
| **C** Freesound uploaders with kept records on **both** the train and the val side | **11**; **1 from letter case**: *Antwash* (1 `fstrain` clip, train) vs *antwash* (2 FSD50K-eval clips, val). Round 1 §2.2 says an uploader of FSD50K eval is val. The other **10** follow round 2's rules as written: `fsvoice` has its own FNV split, independent of FSD50K, so one person's voice clips and noise clips can sit on different sides (*dobroide*, *totalcult*, *pauliperez1999*, *LS*, *Heigh-hoo*, *morgantj*, *Moonlight Dancer*, *macdaddyno1*, *jasonlee3071*, *deleted_user_2104797*). The 11 uploaders have **203 training records** |
| **D** kept rounds 1–2 records whose uploader matches a name an old uploader rule excluded **only by letter case** | **0**. Reference: 239 names (benchmark-uploader drops and skips, review-probe skips, and every `exclude.json` uploader that no rounds 1–2 record carries). The 326 exact-name matches are FSD50K / `fstrain` **negatives** by round-2 review-probe uploaders; that rule covered voice positives only. This is as written |

Consequences:

- **For the sealed set:** §2.1.
- **For round-4 training:** §3.2, D1. Validation is not changed.

## 2. Sealed-set changes, made blind

**Blind** means:

- no model of any round runs on a confirmatory stream before the look;
- nobody listens to, plots or scores a confirmatory clip;
- the only figures read are round 3 §1.6's aggregate current-app counts
  (CORRECT hops per subset × gender × band, FALSE hops per group). They are
  used only for the minimum-size and stop rules below.

The construction metadata needed to find derived streams (which mix program
and which session holds a given source clip) is read; it carries no
outcome. Round 3's guards stay: training, validation and selection code
refuse every path under `build/vad-train/r3/conf/`, and only the look sets
`VAD_R3_LOOK=1`.

### 2.1 Clips that violate the exclusion rules

1. **Drop.** Every kept confirmatory record that the case-insensitive audit
   (§1.2 A) flags is dropped from the sealed set. Its manifest record gets
   the reason. Today this is exactly `c_fsv__716881`.
   - The audit is re-run after every later data step of §2.
   - Any new violation is dropped the same way and listed in Addendum R4-A.
   - No model output exists for any dropped clip.
2. **Replace only by the round-3 selection procedure** with the corrected
   comparisons:
   - `fs_conf.py search` re-applies its cheap rules to the **cached** round-3
     search pages. No new search page is fetched for this step.
   - `fs_conf.py select` then runs as in round 3: global FNV-1a order of the
     id, the query cap (10 for "reading aloud"), ≤ 2 clips per uploader, the
     sound-page licence and keyword rules, the YAMNet voice screen,
     Praat-voiced ≥ 1.0 s, and the fingerprint check.
   - The freed slot of query "reading aloud" goes to the next eligible
     candidate in that order.
   - Any other selection change the corrected comparisons cause (none
     expected: no case collision among the round-3 candidates) is applied
     the same way and listed.
   - If no eligible candidate remains, nothing replaces the clip. The
     speech row has 134,795 CORRECT hops, so it does not need one.
3. **Derived streams: slot-preserving replacement.** A full rebuild would
   reshuffle every program and session, because the seeded shuffles depend
   on the list contents. So:
   - **Mixes** (`cmix20`, `cmix0`):
     - Each mix whose program contains a dropped clip keeps its noise
       stream, SNR, lead, tail, seed and gain rule.
     - Its program is replaced by the program that `build_conf.programs()`
       builds from the replacement's group and subset.
     - With no replacement, it takes the next program of the same subset in
       round 3's shuffled order that no mix used; when every program of the
       subset was used, it takes the first.
   - **One-room sessions** (`csess`):
     - A session whose voice group is a dropped group keeps its session
       seed, kind (clean / noisy), bed and SNR.
     - Its voice group becomes the replacement's group. With no
       replacement, it becomes the next `c_fsv` group in round 3's FNV
       order that has no session.
     - Failing both, the session is dropped and the count is reported.
   - **Spliced confirmatory sessions** are built at the look from the fresh
     confirmatory streams (round 3 R3-A.5 item 11), so they follow
     automatically.
4. **Dumps.** The current-app dumps of every new or changed stream are
   computed with round 3's chain (`train/valdump.mjs`, src dd92037), with at
   most two processes.

### 2.2 More real lip and tongue trills (before any look)

**Goal.** The V1 clean row "lip and tongue trills" (round 3 §1.3) has
321 CORRECT hops; it needs **≥ 400**. Round 4 adds real trills from sources
never used anywhere. The **fill target is 800 CORRECT hops** (twice the
minimum), so that later drops cannot push the row back under 400.

**Eligibility of every new clip.** All checks are case-insensitive
(`fold_user` for names):

- **New people.**
  - The uploader, contributor, speaker or participant is not in
    `r3/exclude.json` (rounds 1–2, benchmark, probes).
  - It is not in `r3/train_exclude.json` (round 3's sealed set, including
    every Freesound result its search read, kept or not).
  - It is not one of the 10 round-3 Commons IPA files or their
    contributors.
  - Round-4 training negatives come later (§7) and exclude every trill
    source, not the other way round.
- **Licences.**
  - Accepted: CC0, public domain, CC BY, CC BY-SA, CC BY-NC and
    CC BY-NC-SA. Every licence except CC0, public domain and CC BY makes
    the file **evaluation only**.
  - Skipped: ND, Sampling+, and anything with no stated licence.
  - The licence is read at the source and recorded per file. No file is
    ever used for training or selection, and no audio is committed.
- **Availability.** A source that needs the user's own account is dropped
  (round 3 §1.1).
- **Duplicates.** Each clip is fingerprinted (round 3 matcher: ≥ 3 s
  aligned overlap at BER ≤ 0.35) against:
  - all earlier audio (`r3/fp`);
  - the sealed set;
  - the clips this step has already kept (the earlier one in FNV order
    stays).

  A match drops the clip and bans its group from this step.

**Labelling (no listening).** A clip enters the trills row only if all of
these hold:

1. **Trill metadata.** The title, description, tags, file name or dataset
   metadata match the trill pattern
   `(?i)\b(lip[- ]?(trill|roll|bubble|buzz)s?|bubble lips|horse lips|motor ?boat (lips|sound)|tongue[- ]?(trill|roll)s?|trill(ed)? r|roll(ed|ing) r|(bilabial|alveolar|uvular) trill|trill consonant|b+r{2,}|r{3,})\b`,
   and none of them matches `(?i)voiceless`.
2. **Voice and music exclusion.** Round 2's `fsvoice` keyword-exclusion
   rule (instruments, effects, non-human) on the same metadata. This keeps
   out brass "lip trills" and similar.
3. **YAMNet screen.** In **≥ 20 %** of its 0.96 s patches, YAMNet's top
   class is human-vocal (`events/yamnet_lib.py` VOCAL).
   - This is relaxed from round 3's 50 %. YAMNet has no trill class, and
     round 3's screen dropped 4 of the 13 trill candidates.
   - Rules 1, 2 and 5 identify the trill; this screen only guards against
     non-human sources.
4. **Praat-voiced.** ≥ 1.0 s within the first 120 s (≥ 0.5 s for
   Wikimedia Commons files, whose IPA-style samples are short). The
   reference settings are round 3 §1.6.
5. **Trill-modulation screen.** On the Praat-voiced frames:
   - the 50–4000 Hz band envelope (Hilbert, 1 kHz rate) in 0.5 s windows,
     hop 0.25 s, each window ≥ 80 % voiced;
   - a window is *trilled* when the envelope's modulation spectrum (Hann,
     mean removed) peaks in **15–45 Hz** at least **θ dB** above its median
     over 2–100 Hz;
   - the clip passes with ≥ 1.0 s of trilled windows (≥ 0.5 s for Commons).

   **θ is calibrated before any search**, on VocalSet `lip_trill` files only.
   VocalSet is an old-harness voice set: neither confirmatory nor training,
   and no model is involved.
   - θ = the 10th percentile of the per-file maximum prominence, clipped to
     [6, 15] dB.
   - The pass rate on VocalSet `straight` files is reported.
   - **If more than 20 % of the straight files pass, the screen is
     dropped** before any search, and rules 1–4 decide alone.
   - θ, the pass rates and that decision go into Addendum R4-A before the
     first trill search.

Other details:

- **Other SOVT exercises.** Clips that match
  `(?i)\b(sovt|semi[- ]?occluded|straw (phonation|singing|exercise)|tube phonation|resonance tube|cup phonation|lax ?vox)\b`
  but not the trill rules form a reported row, **"other SOVT"**. It is not
  gating, because the bar has no such clause.
- **Gender** comes from the source metadata when stated; otherwise it is
  unknown.
- **Group** = uploader, contributor or participant.
- **Clean streams.** New clips enter the fresh clean streams (`cvoice`)
  only, at their native rate. The mixes and sessions keep round 3's trill
  programs (the 10 Commons clips), so their seeded construction is not
  disturbed.

**Sources, in this order; within each source, items in ascending FNV-1a of
`"r4:" + <item id>`:**

| key | source | queries / scope | caps |
|---|---|---|---|
| `c_tr4_fs` | Freesound search pages (no API key, as `fs_conf.py`), duration 1–300 s, first 120 s | queries never used in rounds 1–3, pages 1–3: "lip buzz", "lip bubble", "lip bubbles exercise", "lip trill siren", "lip trill scale", "lip trills singing", "lip roll exercise", "brrr lips", "motorboat sound mouth", "tongue trill", "tongue trills exercise", "rolled r sound", "trilled r spanish", "spanish rr", "alveolar trill", "bilabial trill", "trill consonant", "vocal warm up lips", "singing warm up", "vocal warm up exercise", "voice warm up", "sovt", "straw singing", "straw phonation exercise" | ≤ 10 per query, ≤ 2 per uploader over the whole sealed set (round 3's rule) |
| `c_tr4_wc` | Wikimedia Commons, File namespace: full-text search (MediaWiki API `list=search`) for "lip trill", "lip roll", "bilabial trill", "alveolar trill", "uvular trill", "tongue trill", "rolled r", "trilled r", "vocal warm-up", "vocal exercise", plus the members of any category whose title matches `(?i)(bilabial\|alveolar\|uvular) trill` (depth 1) | audio files, and the audio track of video files | ≤ 5 files per contributor; contributors only as a hash in ids and manifests (`c3.anon`) |
| `c_tr4_ds` | Open research datasets: Zenodo (`/api/records`, type dataset, open access), Figshare (`/v2/articles/search`), OSF, Harvard Dataverse; queries "lip trill", "tongue trill", "semi-occluded vocal tract", "SOVT", "straw phonation", "tube phonation", "voiced bilabial trill", "lip vibration phonation" | records with audio files (wav / flac / mp3 / ogg / m4a), whole-record download ≤ 5 GB or per-file download; trill / SOVT labels from file names and record metadata; participants from the record's metadata or file-name scheme, written into the addendum before any audio of that record is decoded | ≤ 30 min per record, ≤ 5 min per participant |
| `c_tr4_ia` | Internet Archive advanced search, mediatype audio / movies, `licenseurl` Creative Commons or public domain; queries "lip trill", "lip trills", "tongue trill", "vocal warm up" | first 120 s per file | ≤ 2 items per uploader, ≤ 3 files per item |

**Stop rule.**

- After each source is finished, the current-app count of the trills row
  (CORRECT hops, `seal.py counts` form) is computed.
- The search stops after the first source at which the row reaches
  **≥ 800**. A source is never stopped part-way.

**If the row cannot be filled.** If the row is still under 400 after all
four sources:

- it is reported as **"cannot be evaluated (n CORRECT hops)"**, as in
  round 3 R3-A.4;
- its point estimate and bootstrap interval are reported, but it does not
  gate;
- the **user decides before the look** whether the look proceeds without
  the trills clause, and that decision is recorded with the go decision
  (§5).

If the row ends between 400 and 800, it gates under round 3 §1.3's size
rules (per gender group ≥ 400, else pooled).

### 2.3 Re-seal

After §2.1–2.2, and before any round-4 training:

- a new seal over every confirmatory file, `exclude.json` and the round-4
  trill files:
  - `scripts/voice-detector/r3/seal-confirmatory-r4.sha256`;
  - `seal-r4.json`: the round-3 §1.6 counts and the code commit;
  - the updated `conf-manifest.jsonl`: dropped records with their reasons,
    new records with licences;
- the list of paths **removed, added or changed** against round 3's seal;
- `train_exclude.json` rebuilt from the new set (`train_side.py build`).

All of this is committed and pushed as **Addendum R4-A**.

At the look:

- the round-4 seal is verified;
- round 3's seal is re-hashed minus the listed changes, to show that
  nothing else moved.

## 3. Round-4 design space (steady machine noise)

### 3.1 What stays fixed

- **Single model.** One network run per 25 ms, with its state carried from
  the stream start and **never reset**. This is round 3's deployment form
  (`plain`). No two-copy variants: round 3 found they no longer pay for the
  session-trained networks, and the single model keeps the cost low.
- **Network.**
  - It starts from round 3's winning recipe (`r9-sess-b`): log-mel front end
    (64 bands, 50–7800 Hz, 32 ms window, 12.5 ms hop), causal convolutions
    `[[24,3],[48,3],[48,1]]`, a plain GRU of 96, `frame_ms` 82;
  - the round-2 voice sources and weights, roughness 0.2, breathiness 0.15,
    `whard_ac` 3, EMA 0.999;
  - one-room training sessions on half of every batch (`p_sess` 0.5,
    TBPTT 8 s, state carried within a session, zero at its start, clean
    with p 0.2), the other half round-2 crops, and no state bank.
- **Memory.** Memory beyond the 82 ms feed-forward window is carried **only
  as recurrent state** (round 1 §5): the GRU state and the first-order
  recursive filters of F1 (§3.3). Nothing adds a feed-forward window or
  convolutional context, so round 3 §3.1's exclusion of 1–4 s convolutional
  context stands.
- **Budget.** At most **four** training runs (seeds 41–44), 16,000 steps
  each, with EMA checkpoints at steps **4,000, 6,000, 8,000, 10,000, 12,000,
  14,000 and 16,000**. Round 3's best checkpoint was its earliest scored one
  (8,000), so earlier ones are scored too.
- **Process limits.** At most two heavy processes at a time.

### 3.2 Training data: steady noise emphasised (training data only)

**D1. Corrected training side.**

- Every record list goes through the case-insensitive
  `train_side.filter_records()` against the round-4 seal (§2.3). Today
  0 kept records touch it.
- The **203 training records** of the 11 uploaders that also have
  validation records (§1.2 C) are **removed from training**.
- The validation sets are **not changed**: O must stay the same measurement
  as in round 3.
- The same rule applies to D3's new clips.

**D2. Stationarity label for training negatives.** Computed on training
audio only, before training:

- **Score.** On the model's own log-mel (dB), take 1 s block means. For each
  block, take the RMS over bands of its difference from the clip's median
  block spectrum. **S_stat** = the median of that over blocks.
- **The steady pool.** A training negative ≥ 3 s is **steady** when either:
  - its S_stat is in the lowest third of all training negatives (FSD50K
    train, `fstrain` train, D3 train); or
  - `census.py` labels it stationary-tonal. That is the shipped notch's
    peak finder, ported 1:1; it is run on training negatives ≥ 10 s.
- The steady clips form a new negative pool, `stat`.
- The validation negatives' S_stat is computed and **reported only**
  (V2 split by steady / not steady). It is not part of any rule.

**D3. New Freesound steady negatives, `fsr4`** (fetched like `fstrain`:
search pages, no API key):

- **Licence.** CC0 or CC BY only, read on the sound page; Sampling+ and NC
  are skipped.
- **Clips.** Duration 20–900 s, first 120 s; the voice / music keyword rule
  (`splits.json` `negatives.fsd50k`); the Silero speech screen (drop if
  p ≥ 0.9 on ≥ 1.0 s).
- **Fingerprints.** Each clip is checked against all earlier audio
  (`r3/fp`) and against the sealed set. The sealed-set fingerprints are
  computed and matched by a data-step script; the matcher's keep / drop is
  the only output that leaves `r3/conf/`.
- **Uploaders.** Excluded case-insensitively if they appear in
  `exclude.json`, `train_exclude.json` or the round-4 trill sources.
  A fingerprint match bans the uploader.
- **Caps.** ≤ 20 kept per query, ≤ 3 per uploader, in FNV order of the id.
- **Queries, part 1:** the 46 `fstrain` queries except "hair dryer",
  "vacuum cleaner", "tumble dryer", "dishwasher", "washing machine" and
  "microwave oven running". The first three are NB machine types of the
  sealed set; the last three are cyclic, not steady. Pages **4–8**
  (`fstrain` read pages 1–3).
- **Queries, part 2:** new steady queries, pages 1–5:

  > "fridge hum", "refrigerator running", "freezer compressor", "mini
  > fridge", "air conditioner hum", "ac unit", "central air conditioning",
  > "ventilation system", "air vent", "duct fan", "exhaust fan", "standing
  > fan", "pedestal fan", "tower fan", "floor fan", "electrical hum",
  > "60hz hum", "50hz hum", "transformer noise", "computer hum", "server
  > hum", "data center", "hard drive hum", "motor hum", "fan noise"

  None is one of the sealed NA queries or held-out B's `FS_HELD` topics,
  and none names an NB machine type. Near-synonyms of those lists ("light
  buzz", "pump hum", "charger whine") were left out on purpose.
- **Split.**
  - val if the uploader has FSD50K-eval clips (case-insensitive);
  - else val if FNV-1a(fold_user(uploader)) % 10 = 0;
  - else train.

  The val part is **reported only** (a diagnostic V2 row "fsr4 val"). It is
  not part of feasibility or O.

**D4. Synthetic steady interferers.**

- A new generator, `train/synth_r4.py`, with train seeds [2·10⁹, 3·10⁹).
  The round-1–3 `synth.py` and its validation streams are **not
  regenerated**: changing its family list would change what an old seed
  produces.
- Families:

  | family | what |
  |---|---|
  | steady hum | harmonic stack, 40–460 Hz, wobble ≤ 3 cents, no gating |
  | steady mains | 50 / 60 Hz complexes, odd- or even-heavy, level drift ≤ 1 dB |
  | broadband fan | broadband noise with a fixed random envelope of 2–6 resonances, optional blade-pass lines at 20–300 Hz with a 0.5–2 Hz wobble of 1–5 cents |
  | fridge | compressor stack (f0 30–200 Hz) plus hiss; at most one on/off switch per 60 s |
  | HVAC | rumble, broadband noise and 1–3 tonal lines |
  | steady combo | two of the above |

- Parameter ranges are fixed in code before training and are **not tuned
  on validation data**.

**D5. Negative draw weights** (crops and session beds):

| pool | weight |
|---|---|
| `stat` | 0.28 |
| synthetic (round-1 families 0.10, D4 families 0.18) | 0.28 |
| `fsd_machine` | 0.12 |
| `fstrain` | 0.12 |
| `fsr4` train | 0.10 |
| `fsd_other` | 0.10 |

- Steady material is more than half of all negative draws: `stat` 0.28 +
  D4 0.18 + `fsr4` 0.10 (steady topics by construction) = 0.56.
- Round 1 §1.2's rule (machine / room material ≥ half of the negative
  draws) still holds without counting `stat`: synthetic 0.28 +
  `fsd_machine` 0.12 + `fstrain` 0.12 + `fsr4` 0.10 = 0.62.
- Training sessions run **64–256 s** (round 3: 64–128 s), so that the
  carried state sees long steady noise-only stretches. The pause
  distribution and the 35–65 % voice fraction are round 3 R3-B.2's.

**D6. Paint-aware hard negatives (training data only; round 1 §1.2 allows
hard-negative mining on training data).**

- The current app's chain (`train/valdump.mjs`, src dd92037, as the
  harness dumps) runs over the `stat` ∪ `fsr4`-train clips as packed
  (16 kHz), capped at **40 h** in FNV order of the id, with ≤ 2 processes.
- Frames the app paints falsely get loss weight **3** wherever that noise
  appears unmixed: noise-only crops, and the noise-only stretches of
  sessions. They are aligned on the dump's hop grid with `opselect_r3.py`'s
  td rule.
- Mixed frames keep round 3's weights.

### 3.3 Features for long-term steadiness

**F1. Recursive stationarity statistics** (inside the ONNX graph, state
carried like the GRU's).

- **Per band.** On the log-mel x_t (before batch normalisation), for each
  of the 64 bands and τ ∈ {1 s, 6 s}, with α = 1 − exp(−12.5 ms / τ):
  - μ ← μ + α (x − μ);
  - v ← v + α ((x − μ)² − v).
- **Inputs to the first convolution.** x, x − μ₁, x − μ₆, log(v₁ + ε) and
  log(v₆ + ε): 5 channels instead of 1.
- **Recursive spectral flux.** f_t = mean over bands of |x_t − x_{t−1}|.
  Its two EMAs (τ 1 s and 6 s) join the GRU input.
- **Initial state.** At the stream start, μ = x₀ and v = a constant fixed
  in code before training.
- **Training.** TBPTT carries F1's state (detached) like the GRU state.
  Crops start fresh.
- **Streaming and timing.**
  - The streaming export adds F1's state as ONNX state inputs and outputs.
  - The parity check is `export.py`'s (streaming vs batch).
  - F1 is first-order recursive state with no feed-forward window, so
    `frame_ms` stays 82 (round 1 §5).

**F3. Notch-line input** (conditional; at most one run).

- **What it is.** A per-hop input from the pitch worker's posted
  `notchedFreqs`: the number of active notch lines and the time since the
  first one became active.
- **Why it is conditional.**
  - Round 1 §5 says the model's input is "each stream's own samples". A
    model that reads the pitch worker's output is a reading of the bar
    that the user must accept (§8, Q1).
  - Training would need a Python port of `src/dsp/noise-notch.js`'s
    promotion logic, run over the training mixtures.
- **When it is used.** Run 4 uses F3 only if both of these hold before
  training starts:
  1. the user accepts that reading;
  2. the port gives the same active-line set as the JS module on ≥ 99.9 %
     of 25 ms chunks over 50 training and validation streams.

  Otherwise run 4 is F1 with seed 44. Either way, the outcome is recorded
  in Addendum R4-B before run 4 starts.
- **Considered and not used.** A long-window or narrow-band front end
  (e.g. the notch's 512 ms / 16,384-point peak finder inside the model). Its
  feed-forward window would exceed 100 ms, so it fails V3 under round 1's
  reading, like YAMNet's 975 ms patch.

### 3.4 Runs

All four runs use D1–D6 and differ only as stated:

| run | seed | features | purpose |
|---|---|---|---|
| `r10-data` | 41 | none (log-mel as round 3) | steady data alone |
| `r10-stat-a` | 42 | F1 | data + recursive steadiness features |
| `r10-stat-b` | 43 | F1 | second seed (round 3's two seeds differed by 3 pp) |
| `r10-notch` | 44 | F1 + F3 if §3.3's conditions hold, else F1 | notch-line input |

### 3.5 Implementation details left to Addendum R4-B

- Code details that this file does not fix: F1's ε and initial v, D4's
  parameter ranges, and D6's alignment code.
- Addendum R4-B fixes them **before any round-4 model is scored on
  validation data**, together with D1–D3's counts and licences and the F3
  decision.
- None of them is chosen by looking at validation scores.

## 4. Selection (validation data only)

**Selection data, unchanged from round 3** (same files, checked by sha256
against round 3's selection inputs):

- the 194-clip tuning split (fresh);
- the round-1–2 validation streams: clean groups, val mixes and val
  negatives;
- the 240 one-room validation sessions (`r3/vsess`, each one stream, state
  carried);
- round 2's spliced sessions (seed 20261007), reported only.

**Candidates.**

- The 28 EMA checkpoints of §3.4, each as `plain`.
- `custom-vd-r3` (the round-3 freeze), as a reference row. It is eligible,
  but its O is 51.93 %.

**Grid** (round 3 §3.2): 24 thresholds × 16 hangovers (0–3 s) × agg
{`last`, `mean`, `max`}.

**Feasibility** (round 3 §3.3, unchanged):

| reading | limit |
|---|---|
| fresh: every clean val group (speech, vowels, singing, clinical, exercises, children), worse gender | ≤ 0.5 % |
| fresh: every val mix cell | ≤ 1.5 % |
| one-room carried: every clean group | ≤ 0.5 % |
| one-room carried: each SNR cell | ≤ 1.5 % |
| V3: `frame_ms` + lookahead; median onset delay, fresh and carried | ≤ 100 ms; ≤ 100 ms |
| V4: desktop onnxruntime-web WASM (Node, 1 thread) | ≤ 2 ms per 25 ms |

**Objective and choice** (round 3 §3.4, unchanged):

- **O** = min(tuning-194 V2, val-negatives V2, one-room val sessions V2),
  pooled over FALSE hops.
- Within a candidate: the feasible point with the largest O; within 0.5 pp,
  the shorter hangover.
- Between candidates: the largest O; within 1 pp, the lower measured WASM
  cost (per architecture: log-mel only vs F1 vs F1 + F3), then the larger
  val-negatives V2.
- If no candidate has a feasible point: no freeze and no look.

**Reported, not used in the rule:**

- the spliced sessions;
- V2 on the `fsr4` val clips;
- V2 on the validation negatives split by D2's steady / not-steady label;
- tuning-194 V2 per census label.

**Implementation.**

- The selection files come from `infer_r3.py`'s method: GPU torch with
  TF32 off, state carried, with an F1-aware streaming form. The scorer is
  `opselect_r3.py` with its self-test.
- **Deployable re-check and freeze**, as round 3 R3-B.4 and §3.5:
  - the chosen checkpoint is exported to streaming ONNX;
  - its selection files are re-made with onnxruntime CPU, 1 thread, chunk
    by chunk;
  - the rule is re-run on them; the frozen point is that pick;
  - the freeze is written to `scripts/voice-detector/train/frozen/candidate-r4.json`
    (checkpoint, state dict and ONNX sha256, operating point, V4 facts), and
    **committed and pushed before its runner touches any harness or
    confirmatory stream**.

**A caution recorded in advance.** Round 4 is designed around the noise
types that limit O on the tuning split. That is allowed: the tuning split
is selection data, and no tuning clip, id or uploader enters training
(§1.2 D). But it makes O on that split an optimistic estimate. The sealed
confirmatory set, whose noise topics round 4's training does not add
(§3.2 D3), is the check on that optimism.

## 5. Go rule (unchanged)

**The look is taken only if the frozen point is feasible (§4) and O ≥ 60 %**,
both on the deployable re-check. Otherwise round 4 stops before the look,
the seal stays unbroken, and the user decides.

- **No change to the go rule is proposed.** Option 3 of the round-3
  selection note's §5 (a bar decision on O) is the user's to take, not this
  file's.
- A recorded go must state:
  - O and every feasibility reading;
  - the trills-row status after §2.2: gating, or "cannot be evaluated" with
    the user's decision;
  - the seal check.

## 6. Confirmatory bar and the one look (unchanged from round 3)

- **The bar.** Round 3 §4 applies **unchanged** to the re-sealed
  confirmatory set (§2.3):
  - V1 clean per subset ≤ 1 % (speech; held notes and sung phrases and their
    75–130 / 130–300 / 300–400 Hz rows; breathy and dysphonic; **real lip
    and tongue trills**; humming; sirens and glides), worse gender;
  - V1 noise ≤ 3 % per cell;
  - V2 ≥ 60 % on NA ∪ NB pooled, ≥ 50 % on each group;
  - V3 ≤ 100 ms;
  - V4 permissive, ≤ 5 MB, WASM, ≤ 2 ms per 25 ms (phone estimated × 2.4–4.5);
  - V1 carried ≤ 1 % clean / ≤ 3 % noisy;
  - V2 carried ≥ 50 %.
- **Reported, not gating:** as round 3. Added to the reported rows:
  "other SOVT" (§2.2), and the trills row split by source (round 3's
  Commons IPA clips vs each round-4 source).
- **The old harness** is the secondary guard (round 3 §4): all 4,305
  streams plus the spliced run. Old V1 rows worse than their bar by more
  than 1 pp are flagged for the user.
- **Exactly one look** (round 3 §5): one run of the round-3 scorer over
  every confirmatory stream and the old harness, at the frozen point, after
  the freeze commit and a **recorded go**, with the seal verified first.
  - No re-selection after it. Any later point is post hoc, with the number
    of looks.
  - Judge checks as round 3 §5.
- **V5 (private, reported, not a gate):** as round 3 §6, after the look
  only. Results go to the private measurements folder; this repository gets
  at most: "Results on the private session recordings are kept outside this
  repository."

## 7. Order of work

1. The exclusion fix and audit (commit 3553241) and this file: committed and
   pushed (now).
2. **Data step A (blind; the sealed side):**
   - the θ calibration on VocalSet;
   - §2.1 drop and replacement;
   - §2.2 trills, sources in order, with the stop rule;
   - the dumps of new and changed streams;
   - the re-seal (§2.3).

   **Addendum R4-A** is committed and pushed.
3. **Data step B (the training side):**
   - D1 filtering;
   - D3 download (excluding every sealed source);
   - D2 labels, D4 generator, D6 dumps;
   - the F3 decision.

   **Addendum R4-B** is committed and pushed before training starts.
4. **Training and selection:** training (≤ 4 runs, ≤ 2 heavy processes);
   selection on validation only (§4); deployable re-check; **freeze
   committed and pushed**; go / no-go (§5).
5. **If go:** the one look, judge checks, the evaluation note, then V5
   (private).

Process limits:

- Every spawned browser runs with a temporary `--user-data-dir` and is
  killed by its own PID.
- Downloads and caches stay under `build/vad-train/` (gitignored).
- No audio, weights or private results are committed.
- No PR is opened.

## 8. Open questions for the user

1. **F3 (notch-line input).** May the detector read the pitch worker's
   posted `notchedFreqs` as an input, besides the stream's own samples?
   That would extend round 1 §5's "Input" line; the detector's own analysis
   window would stay 82 ms. **Default:** without a yes before data step B
   ends, F3 is not used and run 4 is an F1 seed.
2. **Trills.** If §2.2 cannot fill the row to 400, may the look proceed
   without the trills clause? The user is asked only if that happens, and
   always before the look.
3. **Carried over from round 3.** The V3 reading for convolutional context
   (round 3 §7 Q1) is unchanged and not used. Registration-gated clinical
   corpora (round 3 §7 Q3) are not used.
