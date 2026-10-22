# FireRedVAD confirmation on fresh data (2026-10-21)

> Copied on 2026-10-21 from branch `voice-detector` (commit 852485e) into
> `cue-strip`, where the voice gate it led to was merged. Unchanged below this
> box except that references to scripts and notes that stay on
> `voice-detector` (everything under `scripts/voice-detector/`, the
> `voice-detector-*-2026-10-06.md` notes) say "on branch `voice-detector`".
> The `build/vad*/` data paths are local, gitignored data of that branch's
> worktree. Public data only; the sealed set and the private session
> recordings were not read.
> Per-set results and checks: the folder
> [firered-confirmation-2026-10-21/](firered-confirmation-2026-10-21/), copied with it.
> **Note 2026-10-21:** branch `voice-detector` was deleted on 2026-10-21 by the owner's
> decision; its scripts, notes and `build/` data were not kept, so what is cited "on branch
> `voice-detector`" below no longer exists.

Branch `voice-detector`. User decision 2026-10-20: blanking some held notes
and sustained vowels is acceptable for now; build a PC try-out **and** run a
proper confirmation of FireRedVAD at the relaxed "R1 h" point. This note is
that confirmation's plan. It is committed and pushed **before any FireRedVAD
score on new data exists**. The data lists and their sha256 follow in a later
commit, also before any score.

- Where the candidate and its point come from:
  [offtheshelf-screen-2026-10-20.md](offtheshelf-screen-2026-10-20.md),
  "Addendum: relaxed rules" (tuning data only, best of a grid).
- Harness and bar this plan borrows from:
  `voice-detector-benchmark-2026-10-06.md` (on branch `voice-detector`),
  `voice-detector-harness-2026-10-06.md` (on branch `voice-detector`).
- `src/` is not changed. Public data only. The sealed set
  (`build/vad-train/r3/conf`) and the private session recordings are not
  read.

## Plan (pre-registered, 2026-10-21)

### 1. The candidate and its point (fixed; nothing is selected)

**One candidate, one point.** FireRedVAD Stream-VAD at the "R1 h" point of
the screen's addendum. No other point, smoothing, threshold, hangover or
candidate is scored on the fresh data.

| item | fixed value |
|---|---|
| model | official `fireredvad_stream_vad_with_cache.onnx` (2,306,042 B, sha256 `b3c97836130dc34fc32d56fab551e88cf9454511de2b3c250a5e6578dee74b93`) + `cmvn.ark` (sha256 `c87f6f13edf0f0ec7535ddfc9cc3387d9268cb234b70182d566c5e2edf3ca473`), github.com/FireRedTeam/FireRedVAD @ `c30ec49e8cc69642b0ee65362eba11b9d11c6e54`, Apache-2.0 |
| runner | `scripts/voice-detector/offtheshelf/firered/firered.py` (on branch `voice-detector`) (git blob `e6ce9bf`), unchanged: 16 kHz via `lib/streams.py` `load_audio_16k`, Kaldi 80-band fbank 25 ms / 10 ms, CMVN, cache carried, fresh state per stream; raw probability per 10 ms frame |
| frame timing | `cand/candidate.json` (sha256 `a6eb3107ed0dabd98ad9294c3e2878a4c44a4dd3a29d6e75da1aaede39fc7424`): hop 10 ms, first frame available at 26 ms, look-ahead 0 |
| smoothing **w5** | trailing mean of the last 5 native frame probabilities (fewer at the stream start), float32: `offtheshelf/common.py` `smooth` as `adapt.py` / `relaxed.py` apply it |
| per-hop value | for each 25 ms hop, the latest smoothed frame available by the hop's time (`score.py` `hop_probs`, `agg` "last"; 0 before the first frame) |
| threshold **p ≥ 0.55**, hangover **2000 ms** | `score.py` `voice_flags`: a hop is voice if its value is ≥ 0.55, or if any hop within the last 2.000 s (hop times) was ≥ 0.55 |
| veto | a painted hop that is not voice is vetoed (blanked) |

- **Code at this plan's commit** (parent `defde07`): `score.py` `b1eac61`,
  `offtheshelf/common.py` `126bdde`, `adapt.py` `87fa139`, `relaxed.py`
  `06a9adb`, `screen.py` `d3884ce`, `lib/streams.py` `ffafcd5`, `dump.mjs`
  `d2f0a80` (git blob ids). New code (set loaders, the scorer
  `confirm.py`, the browser module) may only call these definitions, never
  re-implement them.
- **Base chain:** the branch's `src` (identical to dd92037, main + V19g),
  the same tree as every screen dump. The current app's per-hop labels
  (CORRECT, FALSE, WRONG, EDGE) come from `dump.mjs`'s rules.

### 2. Fresh data

**Fresh** = never read by the screen, its addendum or any selection step for
this candidate. A set built from parts that were read before says so
(column "caveat"). vocadito, FDA, PTDB-TUG, Hillenbrand, the round-4 / 5 / 6
validation sets and the 279 noise clips are selection or read-once data, so
none of them is a fresh set. In particular **vocadito is not fresh** (it was a
selection row), so the non-VocalSet singing checks use RAVDESS songs and the
vocal-mode dataset below.

**A. Rebuilt sets** (the 2026-10-06 harness sets whose audio was lost with the
removed notch worktree; their base dumps still exist under `build/vad/dumps`)

| set | content | source (official host), licence | sex | rate | caveat |
|---|---|---|---|---|---|
| `noiseho` (N1, held-out B) | 119 noise-only clips, first 90 s: `dcaseeval` 18 (DCASE 2020 T2 additional training, ids 01/03/05, zenodo 3727685) + `fsheld` 101 (Freesound previews fetched **by id** from the dump ids) | zenodo.org; freesound.org; CC BY-NC-SA 4.0 / per clip | — | 16 kHz | read once on 2026-10-06 for other detectors; never for this one |
| `vocalset` (C1) | 399 VocalSet long tones (held notes) | zenodo 1193957 (range reads), CC BY 4.0 | f / m | 16 kHz | — |
| `pvqd` + `voiced` (C2) | 296 PVQD (sustained vowels + CAPE-V sentences) + 208 VOICED sustained /a/ | Mendeley 9dz247gnyb; PhysioNet `voiced/1.0.0`; per source | unknown (PVQD), f / m (VOICED) | 16 kHz | — |
| `vin20` / `vin0` (M1) | the 784 voice-in-noise mixes, +10 / 0 dB, 20 s noise lead and lead 0 | rebuilt from the notch corpora | f / m / unknown | 16 kHz | their voices are FDA / PTDB-TUG / vocadito / VocalSet / PVQD / VOICED clips and their noise layers are tuning-194 and held-out A clips: fresh streams, familiar parts |

**Rebuild route** (the repo scout's Stage B route):
- `noiseho`, `vocalset`, `pvqd`, `voiced`: new stages of
  `r3/restore_bench.py` that call the notch scripts' own functions
  (`fetch_heldout.py`, `fetch_voice.py`, `heldseg.py`), Freesound by id, as
  the 2026-10-11 noise restore did.
- `vin20` / `vin0`: `fetch_voice.py` (vocalset, vocadito, hillenbrand, ptdb,
  fda, voiced, pvqd; FDA / PTDB-TUG / vocadito / Hillenbrand read read-only
  from the main checkout's gitignored `tests/dsp/data`), `export_refs.mjs`,
  `render_synth.mjs`, `census.py`, `probe.mjs`, `build_index.py`,
  `build_mixes.py --sets=voice_in_noise`.
- **Parity check:** every rebuilt stream is re-dumped with the unchanged
  chain and compared with its existing dump, byte for byte (the
  `r3/restore_check.py` method). Matching streams keep their existing dump.
- **If parity fails** for a set, its base is re-dumped on the rebuilt audio
  and the new dumps are used. This is recorded as a dated addendum before any
  score of that set.
- **If a set cannot be rebuilt** to at least 90 % of its streams (e.g.
  Freesound sounds deleted since), it is reported on what exists and does not
  gate. The verdict then names the missing gate. This is decided and
  committed before any score.

**B. New sets** (no part read before)

| set | content | source (official host), licence | sex | rate |
|---|---|---|---|---|
| `nfresh` (N2) | **(a)** Freesound HQ previews, 6 classes × 15 clips, first 90 s: fans, HVAC, fridge / freezer, computer (PC fan, coil whine), mains / electrical hum, traffic; **(b)** DCASE 2025 T2 evaluation set, 8 machine types (AutoTrash, BandSealer, CoffeeGrinder, HomeCamera, Polisher, ScrewFeeder, ToyPet, ToyRCCar) × 12 test clips | freesound.org (per-clip CC licence, no "Sampling+"); zenodo 15519362 (CC BY-NC-SA 4.0, range reads) | — | (a) 44.1 kHz as published (full band); (b) 16 kHz |
| `ravspeech` (C4) | RAVDESS speech, 24 actors, **normal intensity** (gating); strong intensity reported | zenodo 1188976 `Audio_Speech_Actors_01-24.zip` (range reads), CC BY-NC-SA 4.0 | odd actor = m, even = f | 48 kHz |
| `slr83` (C5) | OpenSLR 83, Midlands English, female + male read speech, all utterances | openslr.org resources/83 (its listed mirrors), CC BY-SA 4.0 | from the zip | 48 kHz |
| `ravsong` (C6) | RAVDESS song, 23 actors, normal intensity (gating); strong intensity reported | zenodo 1188976 `Audio_Song_Actors_01-24.zip`, CC BY-NC-SA 4.0 | as C4 | 48 kHz |
| `vmode` (C3) | vocal-mode dataset: sustained sung notes (CVT neutral / curbing / overdrive / edge), 4 singers; Behringer microphone, up to 300 notes per singer (gating); the same notes from the iPhone and Motorola One recordings reported; `ExcludedSamples` not used | zenodo 14276415 (2025-12-31, range reads), CC BY-NC 4.0 | s1, s4 f; s2, s3 m (dataset readme) | 44.1 kHz |
| `vinfresh` (M2) | fresh voice in fresh noise (below), +10 / 0 dB, 20 s lead and lead 0 | built here | f / m | 48 kHz |

**Build rules for the new sets** (fixed now; the lists are built without
reading any FireRedVAD output):
- **Orders and caps.** Wherever a subset is taken, items are ordered by
  sha256(`firered-confirm-2026-10-21|<id>`) and taken in that order up to the
  cap.
- **Freesound (`nfresh` a).** Search-page queries (no API key, as
  `fetch_heldout.py`), duration 30–900 s, results in the site's order:
  - fans: "standing fan", "oscillating fan", "tower fan", "floor fan",
    "window fan";
  - HVAC: "air handler", "furnace blower", "central air", "ductwork",
    "ac unit indoor";
  - fridge / freezer: "freezer hum", "refrigerator running", "mini fridge",
    "kitchen fridge", "fridge noise";
  - computer: "pc fan noise", "desktop computer hum", "gaming pc",
    "laptop cooling fan", "gpu coil whine";
  - mains / electrical hum: "electrical buzz", "60 hz hum", "50 hz hum",
    "electric hum", "ballast buzz", "transformer noise";
  - traffic: "distant traffic", "traffic outside window",
    "city traffic indoors", "road traffic", "highway distant",
    "street noise inside".
  - A clip is dropped if its title or tags contain voice, vocal, speech,
    speak, talk, sing, song, music, radio, tv, television, people, crowd,
    conversation, child, kid, baby, laugh or bird, or its licence is
    "Sampling+".
  - **Disjointness:** its sound id must not appear in any manifest or list
    on disk outside `r3/conf` (notch corpora, held-out B, the custom rounds'
    pools incl. FSD50K, fstrain, fsvoice, fsnew, the round-5 / 6 beds), and its
    uploader must not appear among the Freesound clips of tuning-194,
    held-out A, held-out B or the round-4 / 5 / 6 validation beds. Checked
    with `r6/disjoint_r6.py`'s method. At most 2 clips per uploader. The
    queries avoid the committed `r3/fs_conf.py` wording; overlap with the
    sealed set itself is not checked, to keep the seal untouched.
  - Classes are filled query by query until 15 clips; a class that cannot
    reach 15 stays smaller (reported).
- **DCASE 2025 T2 eval (`nfresh` b):** every test clip of the type is
  eligible; 12 per type by the seeded order.
- **Voice references:** Praat AC 60–1100 Hz, 10 ms (`heldseg.py`
  `praat_f0`), held segments by `heldseg.py` `held_segments` (±50 cents,
  ≥ 0.5 s), as for the notch corpora.
- **Storage:** mono (first channel), the source's own rate, PCM16 WAV
  (rebuilt sets: the notch scripts' own float32 16 kHz format, needed for
  parity).
- **`vinfresh` (M2)**, the `build_mixes.py` `voice_in_noise` recipe with fresh
  parts:
  - noise: every `nfresh` (a) clip, looped if shorter than the stream;
  - programs, rotating over the noise clips in the seeded order:
    - speech: RAVDESS normal-intensity utterances of one actor, 0.3–1.5 s
      pauses, ≥ 20 s;
    - song: RAVDESS normal-intensity songs of one actor, 0.3–1.5 s pauses,
      ≥ 20 s;
    - held: `vmode` Behringer notes of one singer, 0.15–1 s gaps, ≥ 30 s;
  - actors / singers alternate f, m in the seeded order;
  - 20 s noise lead, the program, a **10 s** noise tail (not 5 s, so the
    after-speech case can be read);
  - SNR +10 and 0 dB = voice active RMS (2 %-of-peak rule) / noise RMS over
    the stream, voice active RMS at −20 dBFS; rendered at 48 kHz (noise
    resampled from 44.1 kHz with scipy `resample_poly`);
  - "lead 0" streams = the same files cropped to the voice start, as `vin0`.
- **Licences.** Every licence is read at the source and saved next to the
  data. Non-commercial sources are used locally for this evaluation only and
  never redistributed. No audio is committed; the committed lists carry ids,
  URLs, licences, sizes and sha256.
- **Downloads:** each source in its own folder under
  `build/vad/confirm/dl/<source>/`, treated as untrusted, Python that reads
  them runs with `-I`, every downloaded file pinned by sha256 in the lists.

**Disk budget: ≤ 6 GB new.** Estimate 6.5–7.5 GB with every set above. If the
measured total after the downloads would exceed 6 GB, these cuts are applied
in order until it fits, **before the lists are committed**:
1. drop the `vmode` phone copies;
2. `vinfresh` uses 60 noise clips (10 per class, seeded order) instead of 90;
3. drop the RAVDESS strong-intensity files (reported rows only);
4. `nfresh` (a) uses 12 clips per class.

### 3. Readings and gates

All readings use `score.py`'s alignment, threshold, hangover and onset rules
at the point of §1, over each set's base-dump labels. Rows of correct hops are
read per sex group (f, m, unknown). **A group gates only with ≥ 400 CORRECT
hops; a row's result is its worst gating group.** Noise rows have no sex.

**Gating rows** (all must pass; the tuning-data value at the same point is
given for comparison only)

| # | row | sets | limit | tuning value at R1 h |
|---|---|---|---|---|
| G1 | false pitch line removed on the fresh noise set (pooled over its FALSE hops) | `nfresh` | **≥ 60 %** | 79.8 % (tuning-194) |
| G2 | false pitch line removed on held-out B | `noiseho` | **≥ 50 %** | — (not read before) |
| G3 | normal speech, clean: correct hops vetoed, per set | `ravspeech` normal intensity; `slr83` | **≤ 1 %** each | pooled 0.30 / 0.11 %; worst row 0.99 % (children's speech, women) |
| G4 | non-held voice in noise: correct hops vetoed, per cell (mix set × SNR), non-held voices pooled as in the R1 h reading (speech and singing; held kinds excluded) | `vinfresh` lead 20 s / lead 0; `vin20` / `vin0` (non-held = FDA / PTDB-TUG speech and vocadito) | **≤ 3 %** at +10 dB, **≤ 10 %** at 0 dB | worst cell 1.55 % (+10 dB, men), 2.10 % (0 dB, women) |
| G5 | singing (songs, not long-tone exercises): correct hops vetoed | `ravsong` normal intensity | **≤ 1 %** | ≤ 0.08 % pooled; worst row 0.48 % (singing exercises) |
| G6 | onset delay: median per sex group over the voice onsets of the gating voice streams (G3, G4, G5 streams) | as G3–G5 | **≤ 100 ms** | 0 ms |
| G7 | desktop browser CPU per 25 ms of audio, the whole detector (fbank + CMVN + ONNX + smoothing / threshold / hangover) | `r6/v4bench/v4bench.mjs` protocol: onnxruntime-web 1.30.0 WASM, 1 thread; Node and headless Chrome; gating value = max of the two medians | **≤ 2.0 ms** | 1.4–1.6 ms in our Python runtime, one call per 25 ms (not the browser) |
| G8 | **sanity guard on held voices** (the user accepted some blanking): clean held notes / sustained vowels blanked, per sex group | `vocalset`; `pvqd` + `voiced`; `vmode` Behringer | **≤ 10 %** each | pooled 2.8 / 6.4 %; worst rows 10.5 % (men's long holds), 9.9 % (Coswara vowels, men) |

- **G7 detail.** A new module (`det_firered.mjs`) runs on the app's 16 kHz
  chunks of 400 samples. Before the bench, its probabilities must match
  `firered.py` within 1e-4 on ≥ 6 selection streams (tuning data, not fresh
  data). Headless Chrome runs through puppeteer with a temporary profile and
  is killed by its own PID only (CLAUDE.md hard rule 2), as `v4bench.mjs`
  already does. Mobile CPU is estimated, not gating.
- **Verdict.** **CONFIRMED** only if G1–G8 all pass. Otherwise **NOT
  CONFIRMED**, with every failing row named. Nothing is re-selected on this
  data afterwards: any other point or candidate would need new fresh data.

**Reported, not gating** (with the tuning-data figure beside each where one
exists)

| reading | sets | tuning value at R1 h (women / men) |
|---|---|---|
| held voices in noise, per cell and sex | `vinfresh` held program; `vin20` / `vin0` held kinds (VocalSet held series, VOICED, PVQD) | +10 dB 9.3 / 20.2 %; 0 dB 23.6 / 32.7 % |
| long holds: correct hops blanked by time since the hold started (0–2, 2–5, 5–10, ≥ 10 s), inside held segments | `vocalset`, `pvqd` + `voiced`, `vmode`, held mixes | last 10 s of long clean holds 15.6 / 29.0 % |
| **right after speech:** FALSE hops removed in noise-only time within 10 s after a voice layer ends, split 0–2 s (inside the hangover, kept by construction) and 2–10 s | `vinfresh` (pauses + 10 s tail); `vin20` (5 s tail; inner pauses where the rebuilt specs give them) | round-4 mixes: gaps between phrases 15.9 %, tail after the voice 58–60 % |
| removal per noise class | `nfresh` per query class and DCASE type, and by part (Freesound / DCASE); `noiseho` per class; census labels where computed with the unchanged `census.py` | stationary-tonal 75.9, mixed 84.8, broadband 79.4, intermittent-tonal 74.5 % |
| false paint in the mixes' noise-only leads | `vinfresh`, `vin20` | round-4 mixes 84.0 % |
| per native rate (16 / 44.1 / 48 kHz) | all | — |
| RAVDESS strong intensity; PVQD vowels vs sentences; `vmode` phone copies; `vin20` / `vin0` by noise split (tuning / held-out A) and by voice kind | as named | — |
| FireRedVAD fed the app's own 16 kHz stream (`createStreamingResampler`, as `fdump.mjs --emit16`) instead of scipy's, on the full-band streams: change in vetoes and removal | `nfresh` (a), `vinfresh`, `ravspeech`, `ravsong`, `vmode` | — |

### 4. Order of work and the one-look rule

1. **Build the data** (§2), apply the disk cuts if needed, run the
   disjointness checks. **Commit and push the lists** (ids, URLs, licences,
   sizes, sha256 of every downloaded and converted file). No FireRedVAD
   inference before this commit.
2. **Checks that read no FireRedVAD result on fresh data:** rebuilt-set
   parity (§2 A); the runner's truncation test on ≥ 6 fresh streams (it
   compares the runner's own outputs, no reading); the browser module's
   parity on selection streams (G7).
3. **Base dumps** of the new sets and of any set whose parity failed;
   **FireRedVAD inference** over every fresh stream (score files only).
4. **Commit and push a frozen-inputs record**: sha256 of every dump and score
   file, the git revision and `candidate.json`'s sha256.
5. **Score each set once**, in this order, with `confirm.py`: `nfresh`,
   `noiseho`, `ravspeech`, `slr83`, `ravsong`, `vocalset`, `pvqd` + `voiced`,
   `vmode`, `vinfresh`, `vin20` / `vin0`. Each set's run writes its gating
   and reported readings together. `confirm.py` refuses to score a set a
   second time.
6. **CPU bench** (G7), at any point after step 2; it reads no fresh data.
7. **Write the results** and the verdict; commit and push.

**Bug fixes only.** A re-score is allowed only for a bug: the code did not do
what this plan says (wrong list, wrong alignment, a crash, a mislabelled
sex). The bug, its fix and the set are recorded in a dated addendum,
committed **before** the re-score. Both results are reported. A result that
merely looks wrong is not a bug.

**No tuning.** The point, the candidate, the lists, the rows and the limits
above do not change after the lists commit.

### 5. What the verdict means

- **CONFIRMED** means: on new public audio, FireRedVAD at R1 h removes the
  false pitch line at the stated rates while keeping speech and songs within
  the limits and held voices within the sanity guard, at an acceptable
  browser cost.
- It is **not a ship decision**. Shipping would still need the PC try-out in
  the user's own room, a mobile cost estimate, and the full CLAUDE.md pitch
  regression checklist on a `src` change.
- The held-voice costs (long holds, holds in noise) are reported, not judged:
  the user decides whether they are acceptable.

### 6. Budget, time and limits

- **Disk:** ≤ 6 GB new (§2).
- **Effort (estimate):** data build and lists 10–14 h of work (the
  rebuilt mixes are the riskiest part, 3–5 h); machine time about 3–5 h
  (parity re-dumps, new base dumps, inference over about 30 h of audio,
  about 1 h); `confirm.py`, the browser module and the bench 3–5 h (bench
  wall time up to 3 h waiting for a quiet machine); results 1–2 h. About
  15–25 h in all, over more than one session.
- **Time rule:** nothing may run past 14:30 CDT on 2026-10-21; the computer
  is the user's from 15:00 to 21:00 CDT that day. Work pauses and resumes
  around that window.
- **CPU:** at most 2 worker processes; only our own PIDs are stopped.
- **Limits:**
  - `vin20` / `vin0` reuse selection voices and noise (§2 A);
  - FireRedVAD's training data is undisclosed ("thousands of hours of
    human-annotated" speech / singing / music); it may include some public
    sets used here;
  - `vmode` notes are short (median about 1.4 s); long holds come only from
    VocalSet long tones and the held mixes;
  - the DCASE part and the rebuilt noise sets are 16 kHz; the Freesound part
    is lossy Vorbis at 44.1 kHz;
  - most fresh voice references are Praat AC, not laryngograph;
  - nothing here measures the user's own room or voice.

## Data build and lists (2026-10-21, before any FireRedVAD inference on fresh data)

The lists are committed in `scripts/voice-detector/confirm/lists/` (on branch `voice-detector`):
`streams.tsv` (every stream scored once: set, id, sex group, native rate,
seconds, sha256 of its audio file; sha256 `ef0d0ce6…`), `items.tsv` (every
downloaded or converted item: source URL or member, source sha256, licence,
sha256 of the stored audio; `07e75c67…`) and `record.json` (archive pins,
licences, parity, disk, the Freesound decisions). Code:
`scripts/voice-detector/confirm/` (on branch `voice-detector`) (README there). No FireRedVAD output on any
fresh stream exists at this commit; `run_firered.py` refuses to run until
`streams.tsv` is committed.

**Rebuilt sets (§2 A): all rebuilt, all byte-identical.** Each rebuilt stream
was re-run through the app (dump.mjs, the unchanged chain) and compared with
its existing dump (`r3/restore_check.py`):

| set | streams | identical |
|---|---|---|
| `vocalset` | 399 | 399 |
| `pvqd` | 296 | 296 |
| `voiced` | 208 | 208 |
| `noiseho` (dcaseeval 18 + fsheld 101) | 119 | 119 |
| `vin20` | 784 | 784 |
| `vin0` | 784 | 784 |

So every rebuilt set keeps its existing dumps; no parity addendum is needed.

**New sets (§2 B)**

| set | streams | hours | groups | rates |
|---|---|---|---|---|
| `nfresh` | 175 (Freesound 79 + DCASE 2025 96) | 1.76 | — | 16 kHz 96, 44.1 kHz 39, 48 kHz 30, 88.2 / 96 / 192 kHz 1 / 7 / 2 |
| `ravspeech` | 1,440 (normal 768, strong 672) | 1.48 | f 720, m 720 | 48 kHz |
| `slr83` | 696 | 1.20 | f 246, m 450 | 48 kHz |
| `ravsong` | 1,012 (normal 552, strong 460) | 1.31 | f 484, m 528 | 48 kHz |
| `vmode` | 1,200 Behringer notes (300 per singer) | 0.48 | f 600, m 600 | 44.1 kHz |
| `vinfresh20` / `vinfresh0` | 118 + 118 (59 noise clips x 2 SNR) | 1.79 / 1.13 | f 60, m 58 | 48 kHz |

**What differs from the plan (all decided before this commit)**

- **vin20 / vin0 rebuild route.** The mixes were rebuilt BY ID: for each of
  the 784 dumps, its noise id, voice-program name and SNR went through
  `build_mixes.py`'s own `programs()`, `voice_gain()`, `render()` and
  `rend_one()` (`restore_bench.py --stage=vin`). Re-running the whole
  census / probe / index / selection chain was not possible: the original
  build also held opt-in local-only programs (7 noise clips have 4 public
  mixes instead of 6), so its selection loop assigned programs in an order
  that cannot be reproduced without them. The program contents and the mix
  recipe do not depend on that order, and the byte-for-byte parity above
  shows the streams are the same.
- **Freesound previews are not all 44.1 kHz.** The HQ previews come at the
  upload's rate (44.1 to 192 kHz). They are stored at their own rate (the
  plan's storage rule). The app chain runs on them (checked on one 96 kHz and
  one 192 kHz clip; those probe dumps were deleted).
- **Freesound classes:** HVAC reached 9 clips and computer 10 (the others 15).
  Pages 1 to 3 of every query were used, in that order. 175 candidates were
  dropped for an id already on disk, 101 for a known uploader, 19 for tag
  words, 10 for title words. Licences: CC0 39, CC BY 24, CC BY-NC 16.
- **Uploader bug, fixed before this commit.** The restored noise manifests
  (2026-10-11 and today) carry an empty uploader: their sound-page parse read
  the visitor's `data-username`. A first Freesound selection therefore missed
  the tuning-194 / held-out A / held-out B uploaders. It was discarded; the
  uploaders were read from the cached sound pages (`/people/<uploader>/sounds/<id>/`,
  400 known uploaders) and the selection re-run. Nothing had been scored.
- **Disk.** Measured with the raw downloads: 8.44 GB. The raw downloads
  (zips, previews, VocalSet / PVQD / VOICED originals, the parity scratch
  dumps) were then removed; their sha256 stay in `items.tsv` /
  `record.json`. Even so, the full plan would need about 6.3 GB, so cuts 1
  (drop the `vmode` phone copies, 243 MB, never downloaded) and 2 (`vinfresh`
  from 10 noise clips per class; HVAC has 9, so 59 clips) were applied.
  Result: 5.72 GB new. Cuts 3 and 4 were not needed.
- **Downloads:** RAVDESS, OpenSLR 83 and DCASE 2025 were downloaded as whole
  zips (md5 checked against Zenodo where given) instead of range reads; the
  vocal-mode notes were range-read. RAVDESS has 5 stereo files: first channel.
- **Order:** the base dumps of the new sets (the current app only) ran before
  this commit. They read no FireRedVAD output and change nothing in the lists.

## Checks and frozen inputs (2026-10-21, before any set is scored)

- **Truncation (runner causality), 7 fresh streams at 16 / 44.1 / 48 kHz,
  3 cuts each:** every frame declared available before the cut is unchanged
  (max |delta| 0). It compares the runner's outputs with each other only.
- **Browser module parity (G7 detail), 8 selection streams (tuning data):**
  `det_firered.mjs` in onnxruntime-web 1.30.0 WASM, fed 400-sample chunks,
  gives the runner's frame probabilities within 3.9e-7 (limit 1e-4).
- **Scorer self-test (tuning data):** `confirm.py selftest` reproduces the
  screen's R1 h reading exactly (tuning-194 removal 79.758403 %, every row's
  counts equal).
- **Inference:** FireRedVAD (`firered.py`, unchanged; model and cmvn sha256
  as pinned) over all 7,349 listed streams (31.5 h). Reported variant: the
  same runner fed the app's own 16 kHz stream on the 3,967 full-band streams
  (`emit16.mjs` + `run_firered.py infer16`; no tail padding was needed).
- **Frozen-inputs record:** `scripts/voice-detector/confirm/lists/frozen.json` (on branch `voice-detector`)
  (sha256 `b14d56e1…`): sha256 of every dump (.f32 + .json) and score file of
  every listed stream, the git revision and candidate.json's sha256
  (`a6eb3107…`). `confirm.py` checks every file against it before scoring.
- Disk after dumps and scores: 5.86 GB new (<= 6 GB).

## Results (2026-10-21)

Each set was scored once, in the plan's order, by `confirm.py` after the
frozen-inputs record (b4d2d7f) was pushed; every dump and score file matched
that record. No set was re-scored and no bug addendum was needed. Per-set
results, the ledger (one line per set), the verdict and the checks are in
[firered-confirmation-2026-10-21/](firered-confirmation-2026-10-21/)
(`results/`, `checks/`; `results/tables.md` lists every reading).

**Verdict: CONFIRMED.** All gating rows G1-G8 pass (§3). Nothing is re-selected on this data.

This is not a ship decision (§5): the PC try-out in the user's room, a mobile
cost estimate and the CLAUDE.md pitch checks on a `src` change still follow.

### Gating rows (worst sex group with >= 400 CORRECT hops)

| # | row | result | limit | tuning value at R1 h | pass |
|---|---|---|---|---|---|
| G1 | fresh noise removed (`nfresh`, 175 clips) | **80.6 %** (35,636 / 44,192 false hops) | >= 60 % | 79.8 % (tuning-194) | pass |
| G2 | held-out B removed (`noiseho`, 119 clips) | **79.2 %** (36,437 / 46,033) | >= 50 % | not read before | pass |
| G3 | RAVDESS speech, normal intensity | **0.20 %** (men; women 0.15 %) | <= 1 % | pooled 0.30 / 0.11 %; worst row 0.99 % | pass |
| G3 | OpenSLR 83 Midlands speech | **0.04 %** (women; men 0.00 %) | <= 1 % | (same) | pass |
| G4 | fresh mixes, lead 20 s, +10 dB | **1.22 %** (men; women 0.00 %) | <= 3 % | worst cell 1.55 % (+10 dB, men) | pass |
| G4 | fresh mixes, lead 20 s, 0 dB | **1.38 %** (men; women 1.36 %) | <= 10 % | worst cell 2.10 % (0 dB, women) | pass |
| G4 | fresh mixes, lead 0, +10 dB | **0.76 %** (men; women 0.00 %) | <= 3 % | | pass |
| G4 | fresh mixes, lead 0, 0 dB | **1.15 %** (men; women 1.07 %) | <= 10 % | | pass |
| G4 | old mixes (`vin20`), +10 dB | **0.00 %** (all groups) | <= 3 % | | pass |
| G4 | old mixes (`vin20`), 0 dB | **0.94 %** (unknown = vocadito; men 0.93, women 0.09 %) | <= 10 % | | pass |
| G4 | old mixes (`vin0`), +10 dB | **0.03 %** (unknown; men / women 0.00 %) | <= 3 % | | pass |
| G4 | old mixes (`vin0`), 0 dB | **0.94 %** (unknown; men 0.85, women 0.07 %) | <= 10 % | | pass |
| G5 | RAVDESS songs, normal intensity | **0.00 %** (both sexes) | <= 1 % | <= 0.08 % pooled; worst row 0.48 % | pass |
| G6 | onset delay, median per sex group (5,214 onsets) | **0 ms** in every group (p90 0 ms) | <= 100 ms | 0 ms | pass |
| G7 | desktop browser CPU per 25 ms (max of Node / Chrome medians) | **0.85 ms** (Node median 0.847, Chrome median 0.812; 5 quiet runs each) | <= 2.0 ms | 1.4-1.6 ms (Python, one call per 25 ms; not the browser) | pass |
| G8 | VocalSet long tones, clean | **0.92 %** (men; women 0.63 %) | <= 10 % (sanity) | pooled 2.8 / 6.4 %; worst rows 10.5 / 9.9 % | pass |
| G8 | PVQD + VOICED sustained vowels | **1.01 %** (women; men 1.01, unknown 0.35 %) | <= 10 % | (same) | pass |
| G8 | vocal-mode sung notes (Behringer) | **1.92 %** (men; women 1.43 %) | <= 10 % | (same) | pass |

G7: `r6/v4bench/v4bench.mjs` protocol, the whole detector (`det_firered.mjs`:
numpy-equivalent Kaldi fbank in JS, CMVN, one onnxruntime-web 1.30.0 WASM call
per 25 ms chunk with caches carried, w5 smoothing, threshold, hangover), 1
thread, on an i9-11900K: Node runs 0.82-0.89 ms, Chrome 155 headless runs
0.77-0.82 ms per 25 ms; per-chunk p99 1.54 / 1.40 ms. The counted runs had
12.8-18.7 % load from other programs (quiet limit 20 %; corrected in
Addendum A, first written 13.8-18.7 %). Chrome ran with a
temporary profile and was closed by its own PID. Mobile CPU is not measured
here.

Every gating group has >= 400 CORRECT hops (smallest: 2,700, the fresh 0 dB
lead-0 mixes, men). Onsets: women 2,318, men 2,402, unknown 494; never shown
before their run ended: 2 / 8 / 2.

### Reported, not gating

**Held voices in noise** (CORRECT hops blanked; tuning values women / men:
+10 dB 9.3 / 20.2 %, 0 dB 23.6 / 32.7 %):

| cell | fresh held notes (vocal-mode, median 1.4 s notes) women / men | old mixes held kinds women / men / unknown (PVQD) |
|---|---|---|
| lead 20 s, +10 dB | 4.0 / 2.4 % | 1.3 / 3.6 / 3.7 % |
| lead 20 s, 0 dB | 5.7 / 8.3 % | 5.2 / 19.8 / 14.9 % |
| lead 0, +10 dB | 4.5 / 2.4 % | 1.2 / 3.3 / 3.9 % |
| lead 0, 0 dB | 4.5 / 6.2 % | 4.7 / 18.9 / 15.7 % |

In the old mixes the worst held kind is VOICED sustained /a/ (lead 20 s,
0 dB: women 21.1 %, men 44.3 %; +10 dB 11.2 / 2.3 %), then the men's VocalSet
held series at 0 dB (19.4 %).

**Long holds, by time into the hold** (CORRECT hops inside held segments;
tuning: last 10 s of long clean holds 15.6 / 29.0 %). The fresh holds are
short, so the late bins are nearly empty and not comparable with the tuning
figure:

| set | 0-2 s | 2-5 s | 5-10 s | >= 10 s |
|---|---|---|---|---|
| VocalSet, clean (women / men) | 0.5 / 0.4 % | 0.0 / 2.0 % | — / 0 % (24 hops) | no hops |
| PVQD + VOICED, clean (women / men / unknown) | 0.3 / 0.2 / 0.4 % | 1.7 / 1.7 / 0.7 % | — / — / 0 % (883 hops) | no hops |
| vocal-mode, clean (women / men) | 1.3 / 2.0 % | 0 / 0 % (151 hops) | no hops | no hops |
| old mixes, 0 dB lead 20 s (women / men / unknown) | 3.5 / 19.6 / 20.2 % | 10.6 / 21.9 / 40.1 % | — / — / 45.0 % (191 hops) | no hops |
| old mixes, +10 dB lead 20 s | 0.4 / 3.6 / 1.5 % | 3.9 / 3.9 / 16.4 % | — / 0 / 51.9 % (268 hops) | no hops |

**Right after the voice stops** (FALSE hops in noise-only time after a voice
layer ends, removed; tuning: gaps between phrases 15.9 %, tail after the
voice 58-60 %):

| set, cell | 0-2 s after (inside the 2 s hangover) | 2-10 s after |
|---|---|---|
| fresh mixes, lead 20 s, +10 / 0 dB | 16.2 / 26.8 % | 77.4 / 74.6 % |
| fresh mixes, lead 0, +10 / 0 dB | 14.3 / 27.7 % | 75.8 / 77.3 % |
| old mixes (`vin20`), +10 / 0 dB | 15.1 / 26.3 % | 82.6 / 70.8 % |
| old mixes (`vin0`), +10 / 0 dB | 16.7 / 27.5 % | 83.5 / 71.5 % |

The false line in the first 2 s after speech mostly stays (by construction:
the hangover keeps it). From 2 s on, about three quarters of it goes.

**False paint in the mixes' noise-only leads** (tuning, round-4 mixes:
84.0 %): fresh mixes +10 / 0 dB 85.9 / 79.3 %; old mixes 83.3 / 73.3 %.
Tails after the voice: fresh 71.9 / 70.7 %, old 65.1 / 59.4 %.

**Removal per noise class** (tuning per census label: stationary-tonal
75.9, mixed 84.8, broadband 79.4, intermittent-tonal 74.5 %; census labels
were not computed for the fresh clips, so the fresh classes are the query
classes and DCASE machine types):

| fresh Freesound query class (clips) | removed | DCASE 2025 type (12 clips each) | removed |
|---|---|---|---|
| fans (15) | **49.8 %** | AutoTrash | 100 % |
| HVAC (9) | **45.9 %** | BandSealer | 100 % |
| fridge / freezer (15) | 97.1 % | CoffeeGrinder | **39.9 %** |
| computer (10) | 77.0 % | HomeCamera | 91.6 % |
| mains / electrical hum (15) | 87.4 % | Polisher | 100 % |
| traffic (15) | 79.3 % | ScrewFeeder | 100 % |
| all Freesound (79) | 78.9 % | ToyPet | 96.0 % |
| | | ToyRCCar | 86.1 % |
| | | all DCASE 2025 (96) | 87.2 % |

Caveat (Addendum A, A2): these are search-query classes, not noise types.
Many clips do not match the class name (fans holds an interview and a
baseball ground recording, HVAC is mostly insects, stations and a street
rally, computer is mostly game sounds). Do not read the fans, HVAC or
coffee-grinder rows as noise-type weak spots without listening checks.

Held-out B by source: DCASE 2020 extra ids 91.4 %, Freesound 77.6 %; weakest
classes there: compressor 12.2 % (197 hops), engine idle 55.8 %, boiler
58.7 %, small motor 60.2 %, office 61.8 %.

**Per native rate.** Fresh noise: 16 kHz 87.2 %, 44.1 kHz 57.2 %, 48 kHz
96.1 %, 96 kHz 96.9 %, 88.2 / 192 kHz 100 % (65 / 243 hops). Rate and
upload are mixed up (each rate holds different clips of every class), so this
is not read as a rate effect. Voices: no rate effect visible (each voice set has one rate).

**Other splits.** RAVDESS strong intensity: speech women / men 0.12 / 0.19 %,
songs 0.00 / 0.06 %. PVQD hops inside held segments (sustained vowels)
0.50 %, outside (sentences, vowel edges) 0.27 %. Old mixes by noise split
(tuning / held-out A), +10 dB lead 20 s, men: 2.9 / 3.9 %; 0 dB: 15.8 /
24.3 % (all voice kinds). Old mixes per voice kind: speech <= 0.93 %,
vocadito <= 0.94 % in every cell. The `vmode` phone copies were not built
(disk cut 1), so that reading is missing.

**FireRedVAD fed the app's own 16 kHz stream instead of scipy's** (same
hops, same point):

| set | scipy-fed (the scored runner) | app-resampler-fed |
|---|---|---|
| fresh Freesound noise removed | 78.9 % | 78.8 % |
| RAVDESS speech normal (women / men) | 0.15 / 0.20 % | 0.17 / 0.22 % |
| RAVDESS songs normal | 0.00 / 0.00 % | 0.00 / 0.00 % |
| vocal-mode notes (women / men) | 1.43 / 1.92 % | 1.03 / 1.70 % |
| fresh mixes G4, worst cell | 1.38 % (lead 20 s, 0 dB, men) | 1.56 % (same cell) |
| fresh held notes in noise, worst cell | 8.3 % (lead 20 s, 0 dB, men) | 8.0 % (same cell) |

The resampler moves most cells by a few tenths of a point, up to 2 points on
one held-notes cell (women, +10 dB, lead 20 s: 4.0 -> 6.1 %); no gating row
moves across its limit.

### What differs from the plan (all recorded before scoring unless stated)

1. vin20 / vin0 rebuilt by id, not by re-running the selection (Data build
   section); byte-identical, so the existing dumps were used.
2. Freesound previews at their own rate (44.1-192 kHz), not all 44.1 kHz.
3. Freesound HVAC 9 and computer 10 clips (others 15); `vinfresh` therefore
   uses 59 noise clips under cut 2, not 60.
4. The uploader bug in the restored manifests, fixed and the Freesound
   selection re-run before the lists commit.
5. Disk: raw downloads removed after their sha256 pins; cuts 1 and 2
   applied (no `vmode` phone copies, 59-clip `vinfresh`).
6. Whole-zip downloads (RAVDESS, OpenSLR 83, DCASE 2025) instead of range
   reads; same files.
7. Base dumps of the new sets ran before the lists commit (no FireRedVAD
   output involved).
8. Points the plan left open, fixed in code before the lists: Freesound
   pages are taken page 1 of every query, then page 2, then 3; a title or
   tag word is "bad" when it starts with a listed word (or is "tv"); a
   `vinfresh` person used again continues through their items in the seeded
   order; mixes get `build_mixes.py`'s layer fades.
9. Census labels were not computed for the fresh noise (the per-class table
   uses query classes / DCASE types instead).
10. The "long holds by time" bins are almost empty past 5 s (the fresh holds
    are short), so they cannot be compared with the tuning "last 10 s"
    figure.
11. G6 includes the "unknown" sex group (vocadito in `vin20` / `vin0`).
12. The resampler comparison pairs all hops of each set (normal + strong for
    RAVDESS), not only the gating streams.

### Plain reading

On new public audio FireRedVAD at R1 h removed 81 % of the app's false pitch
line on fresh noise (87 % without one interview recording that slipped into
the noise set, Addendum A) and 79 % on held-out B, about the tuning figure
(80 %). It almost never blanked speech or songs (<= 0.2 %), blanked 1-2 % of
clean held notes and sustained vowels, and in mixes blanked <= 1.4 % of
non-held voice. One weak spot: held voices in loud noise (0 dB: up to 8 % on
the fresh notes, about 20 % for men's held series and up to 44 % for men's
VOICED /a/ in the old mixes). The low fans / HVAC / coffee-grinder rows
(40-50 % removed) are not read as a noise-type weak spot (Addendum A): the
fans figure is mostly the interview (speech, kept by design; fans without it
77.0 %) and a baseball ground recording, HVAC is mostly a street rally and
insect / station recordings, and none of these clips was listened to. One
held-out B compressor class removed only 12 % (197 hops). The false line
right after speech stays for the 2 s hangover.

**Historical (superseded 2026-10-21, Addendum A):** "Two weak spots: some
fan / HVAC noise and a coffee grinder (40-50 % removed; one held-out B
compressor class only 12 %), and held voices in loud noise (...)."

CONFIRMATION: PASS

## Addendum A (2026-10-21): review findings

A read-only review of the results above. Each item was checked against the
committed lists and results. Per-clip counts were recomputed read-only with
`confirm.py`'s own functions (`veto_of` over the frozen dump and score
files; no result file or ledger line written, nothing re-scored); the
Silero figure was re-run on the one clip with the unchanged
`offtheshelf/silero/run_silero_sel.py wav`. The plan text and every result
above stay as they were. In-place edits, each marked: the per-class table
label and caveat, one bench figure, and the plain reading. **The verdict
does not change.**

**A1. A speech recording in the fresh noise set (medium; accepted).**
`fs__fans__31556` (Freesound 31556, query "standing fan", title
"Heidi_Vox-HubbC_Denver.mp3", tags include "interview" and "vox-pop") is an
interview. The pre-registered title / tag filter did not list "interview" or
"vox", so it passed. Silero VAD marks 80.9 % of its frames speech
(p >= 0.5). FireRedVAD keeps 99.8 % of its pitch line (5 of 3,211 false hops
removed): right for a voice, but a miss in G1. It holds 3,211 of G1's 44,192
false hops and is the noise bed of two fresh mixes (`song_8`, +10 and 0 dB,
each with a lead 20 s and a lead 0 copy).

Information only (not a gate; G1 stays 80.6 % as scored):

| reading | as scored | without the interview clip |
|---|---|---|
| G1, fresh noise removed | 80.6 % (35,636 / 44,192) | 86.9 % (35,631 / 40,981) |
| fans query class | 49.8 % (4,519 / 9,070) | 77.0 % (4,514 / 5,859); without the baseball ground recording too (the clear fan clips): 93.5 % (4,443 / 4,752) |
| G4, fresh mixes, worst cell | 1.38 % (men, lead 20 s, 0 dB) | 1.40 % (women, lead 20 s, 0 dB; 39 / 2,784) |

The plain reading called fans a weak spot; that was mostly this clip. It is
corrected above.

**A2. Query classes are not noise types (low; accepted).** The fresh
Freesound classes are the search queries' classes, and by title and tags
many clips do not match the name:
- HVAC (9 clips): insects, crickets, two railway stations and a processed
  street-rally recording. The rally alone holds 351 of the class's 714
  false hops (17.4 % removed). The four heating / air-conditioning clips
  hold 126 false hops, all removed. (The review said 196; our per-clip
  recount gives 126. The point is the same.)
- computer (10 clips): mostly game sounds (5 clips), a keyboard, a mouse and
  two demolition / construction clips. The one plain computer-hum clip has
  no false hops.
- fans (15 clips): includes the interview (A1) and a baseball ground
  recording (1,107 false hops, 6.4 % removed).

The per-class table is now labelled as query classes, with this caveat. The
fans, HVAC and coffee-grinder rows (the last a DCASE machine type, also not
listened to) are not read as noise-type weak spots without listening checks.

**A3. Overlap with the training exclusion list (low; accepted, no effect).**
Fresh ids 262901 (`fs__traffic__262901`) and 857872 (`fs__mains__857872`)
appear in `build/vad-train/r3/train_exclude.json` (outside the sealed
folder; the sealed folder itself was not read), and 7 fresh uploaders
(8 clips) are on its uploader list. The plan did not check overlap with the
sealed set (§2). No effect on this verdict: the sealed set was not used, and
FireRedVAD's point was not selected on any of this data. If the sealed set
is ever used to judge FireRedVAD, drop these clips from that judgement:
FireRedVAD has now been scored on them here (as noise, and as the beds of
two fresh mixes each).

**A4. One bench figure (low, doc; accepted).** Chrome's first counted run had
12.8 % load from other programs (`checks/bench.json`: Node 13.8-18.7 %,
Chrome 12.8-18.4 %). So the counted runs had 12.8-18.7 %, not 13.8-18.7 %.
Corrected above. All counted runs were under the 20 % quiet limit; G7 does
not change.

**A5. Information (checked).**
- Men's speech-only cell, +10 dB, lead 20 s: 2.54 % (39 / 1,537 correct hops
  vetoed). The plan gates on speech and songs pooled (1.22 %); the
  speech-only cell is also under the 3 % limit.
- One byte-identical RAVDESS pair in `ravspeech`: `rav__03-01-03-01-02-01-07`
  and `rav__03-01-03-01-02-02-07` (actor 7, repetitions 1 and 2; same sha256
  in `streams.tsv`). 40 correct hops each, none vetoed; G3 men 0.20 % either
  way.
- High-rate previews (deviation 2): the review said 11 clips; `streams.tsv`
  and the data-build table give **10** (88.2 / 96 / 192 kHz: 1 / 7 / 2).
  They ran at their own rate: 686 s of audio (about 0.6 % of all scored
  audio), 2,136 of G1's 44,192 false hops (4.8 %), 97.3 % removed. G1
  without them: 79.8 %.
- Clip-level bootstrap (review): G1 2.5th percentile 66.3 % (99.7 % of draws
  >= 60 %), G2 69.5 %. Our own draw (20,000 clip resamples): G1 66.2 %
  (99.67 % >= 60 %), G2 69.4 % (100 % >= 50 %).

**Rejected or corrected review figures:** HVAC heating / AC false hops 126,
not 196 (A2); high-rate clips 10, not 11 (A5). Neither changes a finding.

The verdict does not change: every gate passes as scored, and nothing here
was re-scored.

CONFIRMATION: PASS
