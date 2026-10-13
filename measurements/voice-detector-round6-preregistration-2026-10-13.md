# Custom voice-vs-machine detector — round 6 pre-registration (2026-10-13)

Branch `voice-detector`. This file is committed and pushed **before any
round-6 data is built, before any round-6 model is trained and before any
round-6 scoring**. It fixes:

- the seal status and the one-look rule (§1);
- the shared validation ("practice") bar: round 5's bar unchanged, plus new
  rows for every HIGH and MEDIUM hazard of the round-5 voice-safety review
  (§2);
- the go rule, the V4 cost protocol and a runtime parity gate (§3);
- the two design spaces the user asked for: Track A, one frame-local model
  (§4), and Track B, a detector with room context (§5);
- selection inside each track, the freeze (§6), and the cross-track
  comparison (§7);
- the confirmatory bar for the one look (§8);
- the time budget per track and what is reported if a track cannot finish
  (§9).

Context:

- Started on the user's decision of 2026-10-13 (§0.3).
- Earlier rounds:
  [round 5](voice-detector-round5-preregistration-2026-10-12.md) (Addenda
  R5-A to R5-D) and its
  [selection note](voice-detector-round5-selection-2026-10-12.md);
  [round 4](voice-detector-round4-preregistration-2026-10-11.md) and its
  [selection note](voice-detector-round4-selection-2026-10-12.md);
  [round 3](voice-detector-round3-preregistration-2026-10-07.md) and its
  [selection note](voice-detector-round3-selection-2026-10-11.md).
- Code: [scripts/voice-detector/r5/](../scripts/voice-detector/r5/README.md),
  [scripts/voice-detector/train/](../scripts/voice-detector/train/README.md).
  Round-6 code goes to `scripts/voice-detector/r6/` (shared: validation rows,
  scorer, cost bench, parity tool), `r6a/` (Track A) and `r6b/` (Track B).
- **Measurement only.** Nothing under `src/` changes, nothing is integrated,
  and no PR is opened. No audio and no weights are committed. If a round-6
  detector is ever wired next to the pitch worker, hard rule 3 applies and
  this round's measurement files are its grounding.
- **The detector's job** is unchanged: remove the stray pitch line the app
  paints during noise-only audio (about 24 % of noise-only time), without
  hiding real voice.
- **Private recordings.** The private session recordings are never used for
  training, selection or tuning. They are used once, for V5 (§8.4), only
  after a look. Results stay in the private measurements folder; this
  repository gets at most one aggregate sentence.
- **Per sex.** Every voice-safety row is read for each sex separately. A
  limit holds for each sex. A claim about the detector uses the worse sex.
- **Hash log.** Every round-6 pre-registration, addendum, data manifest,
  freeze record and result file is hashed (sha256, with a timestamp) into the
  round-6 hash log `voice-detector-r6-hashes.log` when it is written. The log
  is append-only and kept outside the repository. **A hashed file is never
  edited.** So, unlike rounds 3–5, every round-6 addendum is a **separate
  file** (§9.1); a deviation goes into a new file, never into an old one.

## 0. Why round 6

### 0.1 Round 5 (validation data only)

- Frozen: `custom-vd-r5` = `r11-harm` step 10,000 (F1m + F5, seed 53), one
  model, state carried and never reset; agg `mean`, p ≥ 0.05, hangover
  200 ms.
- It passes every H1 and H2 row (low humming and held notes next to
  machines; long holds) for both sexes. Round 4's freeze fails 64 of those
  readings, round 3's 29.
- **O = 31.15 %** (bar 60 %). Round 4 had 69.30 %. Steady-noise removal on
  the tuning split's stationary-tonal clips fell from 76.7 % to 35.3 %.
- V4 read 2.02 ms (Node) / 1.87 ms (headless Chrome) per 25 ms at 40–47 %
  machine load (limit 2 ms).
- **NO-GO by the rule.** No look. The seal is unbroken: no model of any round
  has run on the sealed set.

### 0.2 The two round-5 reviews and what round 6 does with each finding

Both reviews are saved with the round-5 workflow result. Neither read the
sealed set or the private recordings.

**Voice-safety review** (fresh probes: a third voice synthesizer with an
LF-model source, six new synthetic machines, the round-4 review's 20 unseen
Freesound machine clips as beds, a second phone microphone with automatic
gain control (AGC), 90–120 s holds, repeated holds with breaths, synthetic
SOVT exercises, 60 fresh 10-minute VocalSet sessions):

| severity | finding (share of correctly painted hops vetoed) | round 6 |
|---|---|---|
| HIGH | Low men's held phonation at 0 dB next to mains-buzz machines. Through the pitch chain on the worst machines: **men 14.62 %** (microwave 39.2 %, air handler 18.8 %, fish tank 17.5 %), women 1.37 %. Whole holds vetoed from onset; the model's median p 0.03–0.05, at the threshold | gating rows H4 (§2.4) |
| HIGH | With phone / OS AGC, men's held notes over a 100 Hz harmonic buzz are vetoed, growing over the hold. Through the chain: **men 45.8 %** (AGC) / 36.0 % (300 Hz high-pass + AGC); women 0.74 / 0.00 %. One 85 Hz hold: 61.7 % vetoed, from about 35 s, near 100 % after 60 s | gating rows H5 (§2.5) |
| MEDIUM | 0 dB residuals: men's SOVT exercises (model-only 6.57 %, straw 18.4 %; through the chain men 1.35 %, women 1.23 %); six 18 s holds with breaths over an aquarium pump, men 10.28 % (women 1.38 %) | gating rows H6 (§2.6) |
| MEDIUM | Women's lip trills at 0 dB in the round-3 review's one-room sessions: 7.39 % (717 hops) | gating rows H7 (§2.7) |
| MEDIUM | Voice safety comes largely from leaving steady machines painted: fresh sessions at +10 dB, round 5 removes 13.6 / 15.8 % of the false hops (women / men), round 4 60.9 / 62.5 %; unseen real machines often near 0 % | reported row N6 next to every hazard row (§2.9); the go rule's O ≥ 60 % already binds |
| LOW | Round-4 HIGH failures do not reproduce on the round-4 review's probes; runtime parity held on 128 worst-case streams (max \|Δp\| 0.0004) | none needed |

**Process review** (no leak, no sealed-set access, no licence problem):

| severity | finding | round 6 |
|---|---|---|
| MEDIUM | V4: the chooser used costs measured after runs 1–3 were scored (1.57 ms), not the pre-scoring record (3.90 ms); the run-4 rule never said how V4 entered; the freeze reported repeat runs | a fixed V4 protocol: what is measured, when, under what load, how many runs, which statistic; which reading each rule uses (§3.2) |
| MEDIUM | The frozen threshold (0.05) was about the size of the runtime disagreement (torch vs ONNX 0.066, WASM vs ONNX 0.037), caused by near-ties in F5's cepstral-peak argmax; feasibility was never checked on WASM output | deterministic feature rules, a trained-network parity gate, and the voice-safety rows re-read on WASM output before any go (§3.3) |
| LOW | The Zenodo "non-200 is an error" fix only logged the error | the trill search is finished (§1.1). If any search is ever resumed, API errors are fatal and each query's HTTP status is recorded |
| LOW | Training data D7 was built before Addendum R5-B part 1 was pushed, against §7's order; not disclosed | the order of work is binding and checked by the hash log (§9.1); any deviation gets its own dated note |
| LOW | The real-bed topic regex was corrected (word boundaries) after registration | the corrected rule (R5-B.2) is registered here for reuse (§2.2) |
| LOW | H2 bins after 20 s rest on few painted hops (the app's notch removes held notes); men's < 100 Hz evidence in H1 is mostly synthetic | reported next to the readings (§2.9) |

### 0.3 The user's decision (2026-10-13)

Run round 6 with **both** approaches and see which does better:

- **Track A (same approach):** one frame-local model that gets round 4's
  noise removal **and** round 5's voice safety: more and better-targeted
  training data, including the review's hazard classes from **new**
  training-side generators; hard-example mining; a bigger model within the
  cost limit; multi-objective training.
- **Track B (new approach):** give the detector context. Learn the room's
  machine sounds automatically from moments marked as no speech (the Silero
  speech detector that ships on the cue-strip branch), and remove only sounds
  that match that room profile. Everything causal and computable in the app.

## 1. Seal status and the one-look rule

### 1.1 What the round-5 record shows

Checked in Addendum R5-A and confirmed by the process review:

- The Volta clip `c_tr4_wc__a488f3b5` was dropped blind; its contributor's
  group is banned.
- The trill search ran `c_tr4_ds` (research datasets: no record with audio)
  and then `c_tr4_ia` (Internet Archive: 0 kept). **No further source is
  pre-registered; the search is finished.** The process review re-queried
  Zenodo live and reproduced 0 dataset records.
- The trills row ends at **444 CORRECT hops** (current app, gender unknown,
  pooled). It **gates** under round 3 §1.3's size rules. The margin is small:
  a later drop of more than 44 hops' worth of trill clips would push it under
  400.
- **Re-seal done and verified:** `seal-confirmatory-r5.sha256` (60,008 lines,
  sha256 `6dcbbe5f…2f44`), `conf-manifest.jsonl` sha256 `663e381b…2438`,
  kept records 7,938; `verify --tag=r5`, `verify-r4 --tag=r5` and
  `verify-r3 --tag=r5` gave 0 mismatches. `train_exclude.json` is
  byte-identical to round 4's (sha256 `9dea5dcf…e670`).

The round-5 evaluation summary lists "the trill search and the blind
re-seal" as still required before a look. **That line is stale:** both were
done and pushed before any round-5 training (d83873a). Nothing of the user's
2026-10-12 decision (a) remains open.

### 1.2 What is still required before any look (Data step, blind, before any training data is built)

These are checks, not changes. They are run in the Data step, **before
either track builds any training data**, and recorded in Addendum R6-A:

1. **Seal checks:** `seal.py verify --tag=r5`; `verify-r4 --tag=r5`;
   `verify-r3 --tag=r5`. Any mismatch stops round 6 and goes to the user.
2. **Exclusion audit** (`r4/audit_exclusions.py`, self-test first): 0 kept
   violations expected.
3. **Training side:** `train_side.py build` must give a `train_exclude.json`
   byte-identical to `9dea5dcf…e670`; `train_side.py check` must find 0 kept
   training records touching the sealed set.
4. **No new training person.** Round 6 adds no real training recording:
   every new training item is generated, or comes from records already on the
   rounds 1–2 training side (`r4/d1.json` `train_ids`). If a track ever needed
   a new real training source, it would first get its own addendum and the
   round-4 D3 procedure (exclusion lists, fingerprints against the sealed set
   with only the matcher's keep / drop leaving `r3/conf/`), before any audio
   of it is used.
5. **New validation material is disjoint from the sealed set and from
   training** (§2.2): the round-4 review's unseen Freesound clips (`fsnew`)
   and every real source of the round-5 review's probe streams. Ids and
   uploaders are checked case-insensitively (`fold_user`) against
   `exclude.json`, `train_exclude.json` and `r4/d1.json`; fingerprints
   against all earlier audio (`r3/fp`) and against the sealed set (matcher
   keep / drop only). **A match removes the clip from validation; the sealed
   set is never changed by this step.**
6. **No search is resumed** (§1.1).

### 1.3 The one look

- **Exactly one look in round 6**, for **at most one** frozen point: the
  winning track's (§7). The runner-up is never run on the sealed set in
  round 6, whatever happens later in the round.
- The look happens only in the **Compare step**, only after a **recorded
  GO** (§7.3), and only once: one run of the round-3 scorer over every
  confirmatory stream and the old harness, at the frozen point, with the
  seals verified first (round-5 seal, then round-4 and round-3 seals minus
  the listed changes).
- No re-selection after it. Any later point is post hoc and reported with the
  number of looks.
- **Blind** keeps round 4 §2's meaning: before the look no model of any
  round runs on a confirmatory stream; nobody listens to, plots or scores a
  confirmatory clip; the only figures read are the current app's aggregate
  counts in the `seal.py counts` form. Training, validation and selection
  code refuse every path under `build/vad-train/r3/conf/`; only the look sets
  `VAD_R3_LOOK=1`. **No step before the look writes a probability file for
  a confirmatory or harness stream.**
- If neither track has a recorded GO, there is no look and the seal stays
  unbroken.

## 2. The shared validation bar

Both tracks are selected and judged on the same bar. Every limit holds for
each sex separately.

### 2.1 Unchanged from round 5

- Round 4's rows (round 5 §4): fresh clean val groups ≤ 0.5 %; fresh val mix
  cells ≤ 1.5 %; one-room carried sessions, clean groups ≤ 0.5 % and each SNR
  cell ≤ 1.5 %; V3; V4 (now by §3.2's protocol). Worse gender, i.e. each sex.
- **H1** (held phonation and hums next to steady machines; clean ≤ 0.5 %,
  each of 0 / +10 / +20 dB ≤ 1.5 %, per sex × voice kind) and **H2** (long
  holds: every 10-s bin ≤ 0.5 % clean / ≤ 1.5 % with a bed; last 10 s ≤
  first 10 s + 1 pp), exactly as round 5 §2.3–2.5 and Addendum R5-B built
  them, **checked by sha256** against `build/vad-train/r5/sel/inputs.sha256`
  (list sha256 `a5121c50…7157`).
- **H3** reported, unchanged.
- The selection data of round 4 (tuning-194, rounds 1–2 validation streams,
  240 one-room validation sessions, spliced sessions reported), checked by
  sha256 against `build/vad-train/r4/sel/inputs.sha256`.

### 2.2 What the new rows may be built from

**Allowed** (no audio any model has been trained on):

| role | source | status |
|---|---|---|
| real voice | Coswara **val** and SVD **val** sustained vowels: the H1 real pool (100 records per sex) and the H2 real series (men 60, women 36) | as round 5 |
| real voice, sex unknown | `fsvoice` **val** clips and SingBAP **val** exercises (rounds 1–2 val split) | reported rows only (no sex) |
| real voice | rounds 1–2 val-split speech and singing groups with a stated sex (LibriSpeech test, VCTK val, Coswara val, SVD val), built like `r3/vsess` | for H8 |
| real voice | **VocalSet lip-trill takes** (`scales/lip_trill`, `arpeggios/lip_trill`) inside the round-3 review's one-room sessions and the round-5 review's `sess5` sessions | for H7; see the masking rule below |
| synthetic voice | `r5/vsynth_val.py` (KLGLOTT88 source; round 5's validation synthesizer) | as round 5 |
| synthetic voice | the round-5 review's `lfsynth.py` (LF-model source, Peterson–Barney tracts, hum murmur, AM for trills), **ported unchanged** to `r6/lfsynth_val.py` | new; validation only |
| synthetic bed | `r5/vbeds.py` (round 5's validation beds) | as round 5 |
| synthetic bed | the round-5 review's `mach5.py` machines (two beating fans, aquarium pump, microwave, car idle, washer, lamp ballast), **ported unchanged** to `r6/mach5_val.py` | new; validation only |
| microphone | the round-5 review's microphone models (`phone_eq`, `phone2` 300 Hz high-pass, `agc_only`, `phone2` + AGC from `screen5.py` / `screen5_eq.py`), **ported unchanged** to `r6/micsim_val.py` | new; validation only |
| real bed | round 5's 109 val machine beds (FSD50K eval, `fstrain` val, `fsr4` val) | as round 5 |
| real bed | the round-4 review's unseen Freesound steady clips (`build/vad-train/review-r4/fsnew`, the clips its selection file keeps), after the §1.2 item 5 check | new; validation only |
| probe streams | **the round-5 voice-safety review's own probe streams** (§2.3): its screens S1, S1b, S2, S2b, S3, S4, its chain-confirmed subsets x1, x3, x4, and its `sess5` sessions; plus the round-3 review's one-room sessions that carry the lip-trill finding | re-rendered bit-exact by the ported generators (checked against the saved x1 / x3 / x4 / `sess5` WAVs); validation rows from now on |

- **Masking rule for VocalSet.** The old harness's `vocalset` set (399
  VocalSet long tones: forte, pp, straight, messa) is the secondary guard at
  the look. Some review sessions contain those takes (`sess5` has
  `long_tones/straight`). **Hops inside any take that belongs to the old
  harness's 399 files are never read by any round-6 row**, gating or
  reported. Only the listed lip-trill takes gate (H7). Other non-harness takes
  of those sessions are reported only.
- **Bed classes** as round 5 (air, fridge, mains, motor), plus a new class
  **buzz** (mains-related buzz and steady lines in the low male band):
  - synthetic: `vbeds` mains and 50 Hz transformer; `mach5_val` microwave,
    ballast, aquarium pump, two beating fans, washer;
  - real: round 5's mains-class val beds, and `fsnew` clips whose title,
    query or tags match
    `(?i)\b(hum|buzz|mains|transformer|ballast|pump|aquarium|fish ?tank|microwave|fluorescent|electric|air ?handler)`.
- **Topic rule for real beds,** as corrected in R5-B.2 and registered here
  for any reuse: FSD50K's `_` read as a space, and a word-start boundary on
  every term:
  `(?i)\b(fan|air.?cond|ac\b|hvac|ventil|blower|refrig|fridge|freezer|compressor|dehumid|hum|buzz|mains|transformer|generator|motor|idling|engine)`.
- **Validation-only, enforced.** A round-6 self-test (`r6/selftest_r6.py`)
  fails if any training or packing script imports `vsynth_val`, `vbeds`,
  `lfsynth_val`, `mach5_val` or `micsim_val`, or names a round-6 validation
  folder (`build/vad-train/r6/hval/`) or `r5/hval`. Training code refuses
  those folders as it refuses `r3/conf/`. The ported generators are pinned
  by digests taken from the review files.

**Not allowed:** the sealed set (any path under `r3/conf/`); the old harness
sets (FDA, PTDB-TUG, vocadito, VocalSet long tones as above, PVQD, VOICED,
Hillenbrand, the benchmark noises); any training-split record or training
generator (`synth.py` training seeds, `synth_r4.py`, `vsynth_r5.py` and
round 6's own training generators, §4.2); the private session recordings.

**Consequences recorded in advance.**

- **The review's probe streams become validation rows.** They can no longer
  serve as an independent check. **A fresh voice-safety review with new
  probes is required after freezing and before any go** (§8.2).
- The new rows are built with the generators that found the round-5
  failures. They are therefore good at those failures and somewhat
  optimistic for these generators' own quirks. Round 6's training uses
  different generators (§4.2), so no network can learn the validation ones.
  The real-voice cells, the fresh review and the sealed set check that
  optimism.
- The rows ask for more than any earlier round delivered (round 5's H1 / H2
  alone held O at 31 %). **A NO-GO for both tracks is a plausible outcome**;
  it would be reported row by row (§7.2).

### 2.3 Common construction of the new rows

As round 5 §2.2 and R5-B.4 unless stated:

- **Seeds and order.** Construction seed **20261013**; bed-class rotation
  seed **20261014**; the lead is 60 s when FNV-1a(`"r6lead:" + stream id`)
  mod 3 = 2, else 20 s; per-stream level and floor seeds from (20261013,
  FNV-1a of the id). Synthetic voice seeds: `vsynth_val` 5·10⁹ + 1,000,000 +
  k, `lfsynth_val` 5·10⁹ + 2,000,000 + k; synthetic bed seeds 6·10⁹ +
  1,000,000 + i (offsets per row fixed in R6-B before any rendering).
- **Timeline.** Bed-only lead, the voice program, a 5 s tail; the bed runs
  throughout, looped with 1 s cross-fades (except H8). Clean streams use a
  −70 dBFS seeded white floor.
- **Levels.** Voice active level −26 dBFS ± 6 dB (one draw per stream); SNR on
  the voice's active RMS, as `build_mixes.py`.
- **Rates and microphones.** Real voices at their native rate. Synthetic
  streams at 48 / 44.1 / 16 kHz in rotation. Microphone variants per row
  (below); "flat" means none.
- **Labels.** Every stream runs once through the current app's chain
  (`train/valdump.mjs`, src dd92037, as rounds 3–5). Hops are CORRECT / FALSE
  / WRONG / EDGE as `dump.mjs`. Reference F0: the synthesizer's truth for
  synthetic voices; Praat AC on the clean voice layer (round 3 §1.6) for real
  voices. Hop time td = (k + 1)·hop − 40 ms − L·hop − 30 ms.
- **Band filter** where a row says so: men 75–130 Hz, women 160–300 Hz of the
  hop's reference F0.
- **Scoring.** The candidate runs its full deployment rule from each stream's
  start (Track B: the speech detector, the room profile and the network, all
  carried, never reset). Veto share = CORRECT hops vetoed / CORRECT hops,
  pooled over the cell's streams, at the candidate's grid point
  (`score.py`'s `hop_probs` and `voice_flags`).
- **Review probe streams** keep their own construction (the review's specs,
  seeds and levels); only the labels are new (current-app dumps).

### 2.4 H4 — low held phonation next to buzz machines (gating)

**Voices, per sex:**

- real: the H1 real pool (100 per sex); men's records under 100 Hz are only
  13 (R5-B.3), so **men's < 100 Hz evidence is mainly synthetic** (stated
  with every H4 result);
- synthetic: 60 holds per sex from `vsynth_val` and 60 from `lfsynth_val`;
  f0 log-uniform in the sex's band with **at least half of the men's in
  75–100 Hz** (women: half in 160–200 Hz); kind hum, /a/ or /o/; quality
  modal, soft, breathy (and pressed for `lfsynth_val`); vibrato on a quarter;
  15 s holds;
- the review's screens **S1** (1,332 streams: 9 voices × hum / /a/ × modal /
  breathy × 12 machines × 0 / +10 / +20 dB, plus clean) and **S1b** (324
  streams: phone EQ, phone2 + AGC and 16 kHz variants at +10 dB).

**Beds:** the buzz class only (real and synthetic alternating), at **0 and
+10 dB**; microphone flat or phone EQ, alternating. S1 / S1b keep their own
beds.

**Gating readings (each sex; CORRECT hops in the sex's band):**

| reading | limit |
|---|---|
| each SNR (0 / +10 dB) × source (real, `vsynth_val`, `lfsynth_val`) | ≤ 1.5 % |
| S1: each SNR (0 / +10 / +20 dB); S1 clean | ≤ 1.5 %; ≤ 0.5 % |
| S1b: each microphone variant | ≤ 1.5 % |
| each **machine kind**, 0 and +10 dB pooled over sources (incl. S1) | ≤ 3 % |
| low sub-band at 0 dB, pooled over sources: men 75–100 Hz, women 160–200 Hz | ≤ 1.5 % |

The machine-kind limit (3 %) is the confirmatory V1 noise limit; it stops a
pooled pass from hiding one machine that vetoes whole holds, as the
microwave did (39 %).

**Reported:** streams with more than 10 % of their hops vetoed; f0 sub-bands;
lead 20 s vs 60 s; the median p of vetoed streams.

### 2.5 H5 — microphone AGC and harmonic buzz under long held notes (gating)

**Voices, per sex:**

- synthetic long holds: 24 per sex from each of `vsynth_val` and
  `lfsynth_val`, 90 or 120 s (alternating); men 75–130 Hz (half in
  75–100 Hz), women 160–300 Hz; hum or /a/; modal or soft; F0 wander
  U(3, 12) cents; vibrato on a quarter;
- real: the H2 real series (men 60, women 36);
- the review's **S4** (192 streams: 120 s holds, flat / phone2 / AGC /
  phone2 + AGC, clean and three beds at +10 dB) and **S2** (160 streams: 90 /
  120 s holds, eight conditions).

**Microphone:** every new H5 stream has AGC: `agc_only` or phone2 + AGC,
alternating. **Conditions:** clean, +10 dB and 0 dB, buzz-class beds.

**Gating readings** (each sex × condition × source; S4 and S2 each sex ×
their microphone variant × condition; every CORRECT hop, no band filter;
time t since the hold's onset):

| reading | limit |
|---|---|
| every 10-s bin of t | ≤ 0.5 % clean; ≤ 1.5 % with a bed |
| last 10 s vs first 10 s | ≤ first + 1 pp |

Bins under 400 CORRECT hops merge with the bin before (as H2). **Reported:**
hops per bin and the number of contributing holds next to each late-bin
share; the time of the first veto per hold; men's 75–100 Hz holds
separately.

### 2.6 H6 — SOVT exercises, repeated holds and no-speech practice sessions (gating)

**H6a — SOVT exercises** (per sex): lip trill, tongue trill, straw, hummed
siren, vowel slide, each rendered by `lfsynth_val` with the review's S3
recipe and by `vsynth_val` with the same AM / low-pass / glide recipe; 8
streams per exercise kind per synthesizer per condition; conditions clean,
+10 and 0 dB, beds from all classes in rotation (buzz included). Plus the
review's **S3** (120 streams).

**H6b — repeated holds** (per sex): 6 holds of 18 s with 2.5 s breaths (the
review's S2b recipe), 12 per synthesizer per condition (clean, +10, 0 dB),
bed classes in rotation. Plus the review's **S2b** (80 streams).

**H6c — no-speech practice sessions** (per sex): 10-minute one-room sessions
with no running speech — the case where a speech detector marks everything
as "no speech". One voice per session, one bed, one SNR, one microphone:

- 6 synthetic sessions per sex per condition: one synthetic voice (fixed
  tract and f0 centre) singing holds, hums, repeated holds, SOVT exercises
  and sirens (both synthesizers, alternating by session);
- 6 real sessions per sex per condition: one H2-pool participant's sustained
  vowels, cycled;
- conditions clean, +10 and 0 dB; microphone flat, phone EQ or phone2 + AGC
  in rotation; a 30 s bed-only lead; pauses from {1, 3, 8, 20 s}; voice
  fraction 35–65 %.

**Gating readings (each sex; every CORRECT hop):**

| row | reading | limit |
|---|---|---|
| H6a | each condition × exercise kind (synthesizers pooled); S3 each condition | ≤ 0.5 % clean; ≤ 1.5 % with a bed |
| H6b | each condition: every 10-s bin of series time; last 10 s vs first 10 s (also S2b) | ≤ 0.5 / 1.5 %; ≤ first + 1 pp |
| H6c | each condition: whole session; every 60-s bin of session time | ≤ 0.5 % clean; ≤ 1.5 % with a bed |
| H6c | each condition: last 120 s of voice vs first 120 s after the lead | ≤ first + 1 pp |

**Reported:** per hold index (1–6) in H6b; per exercise kind in H6c; SingBAP
val and `fsvoice` val exercises (sex unknown) pooled.

### 2.7 H7 — lip trills (gating)

- **H7a, real:** every hop of the VocalSet lip-trill takes in the round-3
  review's one-room sessions and in the round-5 review's `sess5` sessions
  (clean, +10, 0 dB), each condition as built, state carried through each
  session.
  Women's lip trills at 0 dB in the round-3 review's sessions had 717
  CORRECT hops.
- **H7b, synthetic:** the lip-trill streams of H6a and the lip-trill
  episodes of H6c.
- **H7c, reported:** `fsvoice` val clips matching the round-4 trill pattern
  (sex unknown), as fresh clean streams and in buzz-bed mixes at +10 / 0 dB,
  pooled.

**Gating readings** (each sex × condition, H7a per session set and H7b
separately): **≤ 0.5 % clean, ≤ 1.5 % with a bed.**

### 2.8 H8 — a machine switching on and off mid-session (gating for voice safety)

Track B learns its room profile as it goes; Track A does not. This row checks
both on the moment that matters for a learned profile.

- 40 one-room sessions per sex, 300 s, built like `r3/vsess` from rounds 1–2
  val-split groups with a stated sex (LibriSpeech test, VCTK val, Coswara
  val, SVD val), at +10 and 0 dB (alternating).
- The session starts clean (−70 dBFS floor). The bed **switches on** at
  U(60, 150) s (0.5 s fade-in) and stays on; in half of the sessions it
  **switches off** 120 s later. Beds rotate over all classes, buzz included.
- **Gating (each sex × SNR):** CORRECT hops vetoed from switch-on to
  switch-off (or the end) ≤ 1.5 %; in the first 60 s after switch-on ≤ 1.5 %;
  after switch-off ≤ 0.5 %; before switch-on ≤ 0.5 %.
- **Reported (adaptation):** FALSE hops removed in noise-only stretches by
  10-s bin of time since switch-on, and the time until removal first reaches
  50 % of its late level.

### 2.9 Reported rows (not gating)

- **N6 — noise removal next to every hazard row.** FALSE hops removed in the
  bed-only leads and noise-only stretches of H4–H8, per machine kind and per
  class, printed beside each voice-safety reading (the review asked that
  voice safety and noise removal be shown together).
- H2 and H5 late bins: hops per bin and contributing holds (process review).
- The share of each H4 / H5 reading that comes from real vs synthetic voices.
- Round 5's reported rows: spliced sessions, `fsr4` val, val negatives by D2
  label, tuning-194 by census label.

### 2.10 Size rules

- A gating cell, bin or machine kind needs **≥ 400 CORRECT hops for that
  sex**.
- **Synthetic cells are grown**, not pooled: more streams (next seeds, same
  distributions) until each reaches 400, **before any model scores the rows**.
- **Real cells and review-probe cells are not grown.** Below 400 they are
  reported as "cannot be evaluated (n CORRECT hops)" and do not gate; the
  Data step lists every such cell in R6-B before training, and the user is
  told.
- A machine kind under 400 merges into its class; a class under 400 is
  reported only. A time bin under 400 merges with the bin before it.
- **Sexes are never pooled.**

### 2.11 The new limits at a glance (each sex)

| row | what | limit |
|---|---|---|
| H4 | low held phonation, buzz beds, 0 / +10 dB, per source; review S1 / S1b | ≤ 1.5 % (clean ≤ 0.5 %) |
| H4 | per machine kind | ≤ 3 % |
| H4 | men 75–100 Hz / women 160–200 Hz at 0 dB | ≤ 1.5 % |
| H5 | AGC long holds: every 10-s bin; no growth | ≤ 0.5 % clean / 1.5 % bed; last ≤ first + 1 pp |
| H6a | SOVT exercises per kind | ≤ 0.5 % clean / 1.5 % bed |
| H6b | repeated holds: every 10-s bin; no growth | ≤ 0.5 / 1.5 %; last ≤ first + 1 pp |
| H6c | no-speech sessions: whole, every 60-s bin; no growth | ≤ 0.5 / 1.5 %; last 120 s ≤ first 120 s + 1 pp |
| H7 | lip trills, real and synthetic | ≤ 0.5 % clean / 1.5 % bed |
| H8 | switch-on / off sessions: on-period, first 60 s, before, after | ≤ 1.5 %, ≤ 1.5 %, ≤ 0.5 %, ≤ 0.5 % |

### 2.12 Validity check before training

After the rows are built and **before either track trains anything**:

- `custom-vd-r5`, `custom-vd-r4` and `custom-vd-r3` are scored on H4–H8 at
  their frozen points (validation only).
- **Expected:** `custom-vd-r5` fails at least one men's H4 reading and at
  least one H5 reading, as the review found.
- **If `custom-vd-r5` passes every new row**, the rows did not reproduce the
  review's failures. Round 6 stops before training and the user decides. The
  rows are not changed.
- The results go into Addendum R6-B, which is hashed and committed before
  either Train step starts.

## 3. Go rule, V4 protocol and runtime parity

### 3.1 The go rule (per track; unchanged from round 5 apart from the new rows and the two protocols)

A track's frozen point has a **go by the rule** only if all of these hold:

1. **Feasible on the extended bar, each sex:** round 4's rows, H1, H2 and
   the new H4–H8, on the deployable files (§6.4), and every voice-safety row
   again on the WASM files (§3.3).
2. **O ≥ 60 %** on the 194-clip tuning split's definition: O = min(tuning-194
   V2, val-negatives V2, one-room val sessions V2), pooled over FALSE hops,
   on the deployable files. Unchanged.
3. **V3:** `frame_ms` + lookahead ≤ 100 ms; median onset delay ≤ 100 ms,
   fresh and carried. Unchanged.
4. **V4 ≤ 2 ms per 25 ms** for the whole deployed detector, by §3.2's
   protocol, on the frozen deployable (reading V4-ii).
5. **The runtime parity gate** passes (§3.3).

A go by the rule is necessary, not sufficient: the look also needs the fresh
review and the user's confirmation (§7.3).

### 3.2 The V4 cost protocol (fixed now)

**What is measured.** The whole deployed detector per 25 ms capture chunk at
16 kHz (400 samples): the network, every feature computed outside the
network (JS / WASM), and, for Track B, the speech detector, the marking and
the room-profile update. Anything the detector needs that the app does not
already run continuously counts in full.

**Runtimes.** (a) Node 24 with onnxruntime-web 1.30.0 WASM, 1 thread; (b)
headless Chrome through puppeteer with the same onnxruntime-web build, a
temporary `--user-data-dir`, killed by its own PID (hard rule 2). Chrome's
version is read through puppeteer, never by running `chrome.exe`.

**Bench set (fixed now).** 8 validation streams at 16 kHz after the app's
resampler: the first two by ascending FNV-1a(`"r6v4:" + stream id`) from
each of: the one-room validation sessions (`r3/vsess`), the H5 synthetic
long holds with a buzz bed, the tuning-194 clips, and the fresh
validation speech streams. The first 10 s of each stream are a warm-up and
are not timed.

**Runs and statistic.**

- One measurement = **5 runs per runtime**, Node and Chrome interleaved.
- A run's value = total detector wall time ÷ audio duration, expressed in ms
  per 25 ms.
- **Reported value per runtime = the median of its 5 runs.** Also reported:
  min and max of the runs; per-chunk p95 and p99 over all runs.
- **Gating value = the larger of the Node and Chrome medians.** Limit
  2.0 ms.

**Machine load.**

- During each run the machine's CPU load from other processes is sampled
  every second and its mean recorded. A run is **quiet** if that mean is
  ≤ 20 %.
- The measurement waits for quiet runs for up to 3 hours. If 5 quiet runs
  per runtime exist, only they count. Otherwise all runs made count, **as
  measured, with the load stated**. An estimate never replaces a
  measurement.
- In the same session, round 4's frozen model (`custom-vd-r4`; 0.56 / 0.52 ms
  in its quiet round-4 session) is measured as a load reference and
  reported. It does not adjust the gating value.
- Machine, CPU model, OS, Node and Chrome versions are recorded.

**When, and which reading each rule uses.**

- **V4-i (architecture cost, before scoring).** Each architecture (§4–§5) is
  exported with random weights (cost does not depend on the weights) and
  measured by this protocol. The values go into the track's first addendum,
  **hashed before any checkpoint of that architecture is scored**. Selection
  uses V4-i for the V4 feasibility row and for the cost tie-break. An
  architecture whose V4-i exceeds **1.8 ms** is not trained (a margin for the
  frozen-weights pipeline); one over 2.0 ms is infeasible. V4-i is never
  re-measured to rescue an architecture.
- **V4-ii (the frozen deployable).** The exact frozen pipeline, measured by
  this protocol in the **Compare step**, both tracks' frozen points in one
  session, interleaved, after training on the machine has ended. The go rule
  (§3.1 item 4) and the comparison (§7) use V4-ii. If V4-ii exceeds 2.0 ms,
  that track has no go; nothing is re-selected.
- **Phone:** estimated from V4-ii × 2.4–4.5 (the benchmark's ratios),
  reported, not gating; measured on an attached phone only if the user has
  one connected.

**Model size** (V4's ≤ 5 MB) counts every model file the detector needs,
including the speech detector's (Silero v6.2.3: 2,327,524 bytes).

### 3.3 The runtime parity gate (trained networks) and deterministic features

**Runtimes compared.**

- **T:** the torch form used for the selection files (GPU, TF32 off, state
  carried; Track B with the speech detector's outputs as cached from ONNX
  CPU and the Python reference of the profile).
- **O:** onnxruntime CPU, 1 thread, chunks of 8 frames (the deployable
  re-check form).
- **W:** onnxruntime-web 1.30.0 WASM in Node, 1 thread, one 25 ms chunk (2
  frames) per run, running the **whole deployed pipeline** (JS feature code,
  the speech detector in WASM, the profile in JS).
- **C:** the same as W in headless Chrome, on 8 of the parity streams.

**Parity set (fixed now; validation only).** 48 streams, the first k by
ascending FNV-1a(`"r6parity:" + stream id`) in each group: 8 H1 synthetic hums
at 0 dB (4 per sex), 8 H4 streams (4 per sex), 8 H5 AGC holds (4 per sex), 6
tuning-194 stationary-tonal clips, 6 validation negatives, 6 one-room
validation sessions (300 s), 6 H6c sessions (600 s). About 2.5 hours of
audio.

**Limits (each runtime pair T–O, O–W, T–W, and W–C on its subset):**

| reading | limit |
|---|---|
| max \|Δp\| over all frames | ≤ min(0.01, θ / 5), θ = the operating threshold |
| hop-level veto decisions at the operating point (agg, threshold, hangover) | agree on ≥ 99.9 % of hops |
| per stream, veto share of CORRECT hops | differs by ≤ 0.5 pp |
| per stream, share of FALSE hops removed | differs by ≤ 2 pp |

**When.**

- (a) Random-weight networks of each architecture with the final feature
  code, before training (track addendum 1).
- (b) Each run's first scored checkpoint: reported, diagnostic.
- (c) **The frozen point: gating.** If (c) fails, that track has no go.
- **WASM re-read at the freeze:** every voice-safety feasibility row (fresh
  clean and mix cells, one-room V1 cells, H1–H8) is recomputed from W files
  of the frozen pipeline and must still pass. O and its parts come from the
  O files (as before); their W values are reported.

**Deterministic features (rules for every round-6 feature path).**

- Every discrete decision — an argmax or peak pick, a threshold crossing, a
  marking decision, a min / max recursion's choice — has a fixed tie-break
  (the lowest index) and compares values **quantized to a fixed grid**
  (round half to even), or uses a hysteresis margin, so that float32 vs
  float64 rounding can flip it only at a grid boundary.
- **F5d** (round 5's F5 with this rule): the cepstral residual is quantized
  to 0.01 dB before the peak pick; among the quefrencies with the largest
  quantized value the lowest is chosen; the previous frame's peak (± 1
  quefrency sample) is kept while its quantized residual is within 0.05 dB
  of the maximum; parabolic refinement uses the unquantized values around
  the chosen index.
- **Feature parity,** at (a) and (c): continuous features within 1e-3
  (absolute) on ≥ 99.99 % of frames, and every discrete pick in agreement on
  ≥ 99.9 % of frames, between the float64 batch form, the float32 streaming
  form, ONNX and JS.
- Features may be computed **outside** the ONNX graph in JS / WASM (cheaper
  than round 5's in-graph DFT); then a Python reference implementation is
  the training form and the parity rules above apply to it.

## 4. Track A — one frame-local model (design space)

### 4.1 What stays fixed

- **One model, `plain`:** one network run per 25 ms, state carried from the
  stream start, never reset. No speech detector, no room profile, no second
  copy.
- **Base network:** round 5's `r11-harm` architecture (log-mel 64 bands,
  causal convolutions `[[24,3],[48,3],[48,1]]`, GRU 96, fc 64, F1m channels,
  F1's flux EMAs) with **F5d** instead of F5 (§3.3).
- **Timing and memory:** `frame_ms` ≤ 82 ms, no lookahead; memory beyond the
  window only as recurrent state with fixed time constants ≤ 30 s (round 5
  §3.2).
- **Training never reads** validation streams or generators, the H rows, the
  sealed set, the old harness or the private recordings.

### 4.2 Training data (training side only; seeds Track A)

- **D1–D7 as built in round 5** (D7a list sha256 `45a07a97…c9712`, D7b bank
  sha256 `c6d95b4c…d4c`; re-hashed before use), D4–D6 as round 4.
- **D8 — new hazard generators, training-only code and seeds:**
  - `train/vsynth_r6.py`, two **new** voice sources, neither of which is a
    validation or earlier training source: (1) a Fujisaki–Ljungqvist glottal
    pulse with drawn tracts; (2) TD-PSOLA resynthesis of training-split held
    vowels (D7a records) to new f0 targets, held longer by looping pitch
    periods with drawn jitter and shimmer. Modes: holds; hums; repeated holds
    (4–8 holds of 8–25 s, breaths 1–4 s); lip trill (AM 18–35 Hz, depth
    0.5–0.95, lip low-pass); tongue trill (AM 25–35 Hz); straw (low-pass
    500–900 Hz); sirens and slides (1–1.6 octaves). f0: 40 % men 75–130 Hz
    (at least half under 100 Hz), 40 % women 160–300 Hz, 20 % in 130–160 /
    300–420 Hz.
  - `train/mach_r6.py`, new training machines: magnetostriction hum (2× mains,
    odd / even richness drawn), rectifier buzz, magnetron transformer,
    diaphragm pump (50–120 Hz with a drawn rattle nonlinearity), lamp ballast,
    beating fan pairs (blade-pass 60–140 Hz, beat 0.5–6 Hz), washer / idle
    engine (25–100 Hz with drawn irregularity); mains 50 or 60 Hz; every
    parameter drawn per clip.
  - `train/micsim_r6.py`, a training microphone simulator: high-pass 80–350 Hz
    (order 2–4), presence peak, low-pass 6–8 kHz; AGC as an RMS follower
    (attack 5–60 ms, release 0.3–4 s, target −28 … −14 dBFS, gain range
    drawn within −12 … +30 dB) or as a slow-gain peak limiter.
  - These ranges overlap the validation generators' fixed settings on
    purpose (otherwise training would never see them); the code, the source
    models and the seeds differ. Recorded as an optimism caution.
  - Seeds: Track A banks 7·10⁹ + [0, 5·10⁷).
- **D9 — hard-example mining (training data only).** A mining bank of 1,500
  training sessions (64–256 s, D1–D8 material, Track A seeds); current-app
  dumps (`valdump.mjs`, src dd92037); the round-4 and round-5 frozen models
  run at their points. **Hard negatives:** noise-only frames the app paints
  falsely that `custom-vd-r5` lets through. **Hard positives:** voice frames
  that `custom-vd-r4` vetoes. Marked frames get weight max(w, 3); the bank is
  drawn with p 0.15.
- **Draw shares** (fixed in addendum TA-1 before any scoring, within these
  bounds): hold sessions p 0.35 (round 5), of which D8 voices ≥ 1/3; D8
  machines ≥ 0.3 of the steady-bed draws in hold sessions; the microphone
  simulator on p 0.3 of sessions and crops; D9 p 0.15.

### 4.3 Design variables (bounded)

| variable | values |
|---|---|
| size | **base** (as §4.1) or **wide** (convolutions `[[32,3],[64,3],[64,1]]`, GRU 144, fc 96) — wide is trained only if its V4-i ≤ 1.8 ms |
| Bound | off, or on: l = max(l_gru, l_loc − 4), with an auxiliary BCE (0.5) on the memoryless local logit (round 5 §3.5) |
| loss weights | round 5's (decay penalty λ 1.0), or **multi-objective**: steady-negative weight 5, hazard-positive weight 3 (D8 positives), D9 weight 5 |

### 4.4 Runs (at most 6; seeds 61–66; 16,000 steps; EMA 0.999; EMA checkpoints at 4,000, 6,000, …, 16,000)

| run | seed | design |
|---|---|---|
| `r12a-base` | 61 | base, Bound off, round-5 weights |
| `r12a-bound` | 62 | base, Bound on, round-5 weights |
| `r12a-wide` | 63 | wide, Bound on, round-5 weights (if wide fails V4-i: `r12a-bound`'s design, second seed) |
| `r12a-mo` | 64 | base, Bound on, multi-objective weights |
| runs 5–6 | 65, 66 | by the rule below |

**Runs 5–6 rule** (applied after runs 1–4 are scored by §6, validation only,
and written into addendum TA-2, hashed **before run 5 starts**): second seeds
of the **two best designs**, ranked by their best feasible O; designs with no
feasible point rank after all feasible ones, by their fallback O. (Round 4's
and round 5's seeds differed by 7–12 pp in O, so seeds are worth more than
new ideas.)

## 5. Track B — a detector with room context (design space)

### 5.1 The deployed pipeline (all causal, all state carried from the stream start, never reset)

1. **Speech detector:** Silero VAD v6.2.3, the model the cue-strip branch
   ships (`silero_vad.onnx`, 2,327,524 bytes, sha256 `1a153a22…88e3`), run as
   its reference streaming wrapper: 16 kHz, 512-sample chunks with 64 samples
   of past context, LSTM state carried; one probability per 32 ms. It runs
   **continuously** while the detector runs.
2. **Voice-likeness screen VL** (fixed formulas, no learned parameters): from
   F5d's periodicity and micro-variation. A frame is **voice-like** if it is
   periodic (CPP ≥ the round-5 noise threshold) with pitch micro-variation
   (the 1 s EMA of |Δ ln q|) ≥ q_v, **or** its 50–1,000 Hz energy
   micro-variation (1 s EMA of |ΔE|) ≥ e_v. q_v and e_v are the 5th
   percentiles of those EMAs over training voice (D7a, D8), fixed in addendum
   TB-1 from training data only. Machines are steady (≤ 3–10 cents of wobble,
   stationary energy); breathy voice still carries shimmer and wander.
3. **Marking:** a 12.5 ms frame is **marked "room"** only if all hold:
   - every Silero chunk ending in the last 0.5 s has p < **0.2** (and at
     least one exists);
   - VL says not voice-like;
   - it is not under **onset protection**: an energy onset (50–1,000 Hz band
     energy ≥ 6 dB above its 2 s running minimum) starts a protection that
     ends when that band energy returns within 3 dB of its pre-onset level,
     or after **15 s** of continuous not-voice-like frames (the path by which
     a machine that switched on mid-session is adopted).
4. **Room profile** (fixed recursions over marked frames only; frozen on
   unmarked frames):
   - per log-mel band, an EMA mean and variance with time constants
     **10 s and 60 s of marked time** (both kept);
   - a **tonal-peak set**: up to 8 narrow peaks between 40 and 1,000 Hz in
     F5d's 1,024-point spectrum, present on ≥ 80 % of marked frames over the
     last 5 s of marked time and stable within 1 %; frequencies quantized to
     1/8 semitone;
   - **profile confidence** c = min(1, M / 5 s), M = marked seconds (EMA,
     τ 60 s of wall time).
   - Variant **b-emb** adds a learned room state: a GRU of 32 whose state is
     updated only on marked frames (input: the frame's log-mel), trained end
     to end.
5. **Network:** a local path (Track A's base: F1m + F5d, GRU 96) and a
   context path that also reads, per band, x − μ_R and log(v_R + ε) for both
   time constants (4 more input channels), the share of the frame's energy
   not explained by the profile, the share of its peaks that match profile
   peaks, and c. **The Silero probability is never a network input**: it
   only drives the marking, so the network cannot learn "no speech → veto",
   which would veto every held note.
6. **Output:** l = max(l_ctx, l_loc − 4) (Bound) with an auxiliary BCE (0.5)
   on l_loc; variant without Bound: l = l_ctx.

### 5.2 Warm-up: before any profile exists

While c < 1 (fewer than 5 s of marked time), the context path gets c = 0 and
"no profile" inputs. Two **deployment variants** of every Track B checkpoint
are scored in selection:

- **`wu-local`:** the detector's output is the local path alone (l = l_loc):
  round-5-like frame-local behaviour;
- **`wu-none`:** no veto at all until c = 1.

The validation rows include voice from the stream start (fresh streams, lead
0 mixes) and 20 / 60 s machine-only leads, so both variants are tested where
it matters.

### 5.3 A machine switching on mid-session

- The machine's onset starts onset protection. Its frames are adopted into
  the profile after 15 s of continuous not-voice-like frames, then the
  profile converges with the 10 s time constant. **Expected adoption:
  roughly 15–30 s.** Meanwhile the local path decides alone.
- Measured by H8: voice safety around the switch is gating; the adaptation
  time is reported (§2.8).

### 5.4 When the speech detector misses voice (held notes)

Silero scores held notes and sustained vowels near 0 (benchmark §4.1:
VocalSet held notes 99.6–100 % vetoed at p ≥ 0.5). So Silero alone would mark a
held note as "room", the profile would learn it, and the note would be
vetoed — round 4's decay failure in a new form. The design blocks this in
four places:

1. VL: a voice-like frame is never marked, whatever Silero says.
2. Onset protection: a note's onset freezes adoption until 15 s of continuous
   not-voice-like frames.
3. Silero is never a network input (§5.1 item 5).
4. Bound: a locally strong voice (p_loc ≥ 0.86) cannot be vetoed at a
   threshold of 0.1 (round 5 §3.5).

Residual risk, stated in advance: a hold that VL reads as not voice-like for
15 s (very steady, little shimmer, AGC-flattened) can be adopted and then
vetoed. H2, H5, H6b and H6c (no growth over the hold or session) are the
rows that catch it.

### 5.5 Cost

- Silero's measured desktop cost (onnxruntime-web 1.30.0 WASM, 1 thread;
  benchmark 2026-10-06 §4.1): **0.38 ms per 25 ms in headless Chrome 154,
  0.44 ms in Node 24**. It is re-measured by §3.2's protocol, alone and inside
  the full pipeline, in addendum TB-1.
- **How it counts:** in full. On the cue-strip branch Silero runs only while
  the opt-in "Likely heard as" panel is on, so Track B cannot assume it is
  already running. V4 is the whole pipeline: Silero + VL + marking + profile
  + network ≤ 2.0 ms per 25 ms (V4-ii); architectures with V4-i over 1.8 ms
  are not trained. Model files together ≤ 5 MB (Silero 2.33 MB + the network).
- Round 5's F1m + F5 network cost 1.57 ms in-graph under load, so F5d's
  spectrum is computed in JS for Track B (one 1,024-point real FFT per
  12.5 ms), with the parity rules of §3.3.

### 5.6 Other signals considered and not used

- **The pitch worker's posted voicing** (cheaper, and held notes are voiced):
  it reads the pitch worker's output, which is round 4's still-unanswered F3
  question, and training would need current-app dumps of every training
  session. Not used.
- **The detector's own local output** as the marker: self-referential, and
  round 5's local model barely flagged steady machines, which are exactly
  what the profile must learn. Not used.
- **WebRTC VAD:** not in the app, and its noise model learns a held tone as
  background (benchmark §4.3). Not used.

### 5.7 Training data (training side only; seeds Track B)

- D1–D9 as §4.2, built from Track B's own seeds (7·10⁹ + [5·10⁷, 10⁸)).
- **D10 — context sessions:** among noisy one-room sessions, the bed
  switches on at U(5, 120) s with p 0.25, switches off with p 0.1, and changes
  to a second bed with p 0.1; **no-speech practice sessions** (only D7 / D8
  holds, hums, SOVT and sirens, clean or with a bed) are p 0.15 of sessions;
  voice from the session start (no lead) p 0.15.
- **Silero outputs for training sessions:** either a pre-rendered bank of
  training sessions run through the deployed ONNX model on CPU, or a torch
  port of Silero accepted only if it matches ONNX CPU within 1e-4 on 20
  training sessions. The marking and the fixed profile are computed once per
  session (input-only, no gradient), like F1; b-emb's learned state is
  trained through.
- Labels as round 5.

### 5.8 Runs (at most 6; seeds 71–76; 16,000 steps; EMA 0.999; checkpoints as Track A; each checkpoint scored as `wu-local` and `wu-none`)

| run | seed | design |
|---|---|---|
| `r12b-stat` | 71 | fixed profile, Bound on |
| `r12b-emb` | 72 | fixed profile + learned room state, Bound on |
| `r12b-nobound` | 73 | fixed profile, no Bound |
| `r12b-stat-s74` | 74 | `r12b-stat`, second seed |
| runs 5–6 | 75, 76 | by Track A's runs 5–6 rule, applied to Track B's runs (addendum TB-2, hashed before run 5 starts) |

## 6. Selection inside each track (validation data only), and the freeze

### 6.1 Selection data and candidates

- Round 4's selection data and round 5's H1–H3 files (sha256 checked), plus
  H4–H8 (hashed by the Data step into
  `build/vad-train/r6/sel/inputs.sha256`).
- **Candidates:** the track's EMA checkpoints, each with its deployment rule
  (Track A `plain`; Track B `wu-local` and `wu-none`).
- **Reference rows,** re-scored in every rule run and **not eligible**:
  `custom-vd-r5`, `custom-vd-r4`, `custom-vd-r3`. They must reproduce their
  round-5 rule entries on the unchanged rows.
- **Independence:** neither Train step reads the other track's selection
  files, tables or notes before its own freeze record is hashed.

### 6.2 The rule (unchanged apart from the rows)

- **Grid:** 24 thresholds × 16 hangovers (0–3 s) × agg {`last`, `mean`,
  `max`} (round 3 §3.2).
- **Feasibility:** round 4's rows + H1 + H2 + H4–H8 (each sex) + V3 + V4-i.
- **Objective:** O, unchanged.
- **Within a candidate:** the feasible point with the largest O; within
  0.5 pp, the shorter hangover.
- **Between candidates:** the largest O; within 1 pp, the lower V4-i; then
  the larger val-negatives V2.
- **No feasible candidate** in a track: no freeze for that track; its table
  is reported (§7.2).

### 6.3 Implementation

- Selection files from the torch form (§3.3 T), state carried; Track B's
  Silero outputs computed once per stream with ONNX CPU and cached (they do
  not depend on the candidate).
- The scorer `r6/opselect_r6.py` = round 5's `opselect_r5.py` readings plus
  H4–H8, with a self-test against `score.py`'s functions at four grid points.

### 6.4 Deployable re-check and freeze

1. The chosen checkpoint is exported (streaming ONNX; Track B with its JS
   profile code and the Silero ONNX file).
2. **Every selection file is re-made** in form O (onnxruntime CPU, 1 thread,
   chunks of 8, state carried; Track B with Silero on ONNX CPU and the
   Python profile reference), the H rows included. The rule is re-run; **its
   pick is the frozen point.**
3. The parity gate (§3.3 c) and the WASM re-read of every voice-safety row
   are run on the frozen point.
4. **The freeze record** — `scripts/voice-detector/train/frozen/candidate-r6a.json`
   (Track A) or `candidate-r6b.json` (Track B): checkpoint, state-dict and
   ONNX sha256 (Track B also Silero's and the profile code's sha256),
   deployment rule, operating point, every go-rule reading per sex, V4-i,
   the parity results, a provisional V4-ii (informational), and an explicit
   go block that lists **every** row, V4 and parity included — is written and
   **hashed into the round-6 hash log at once**, together with the track's
   selection note.
5. **Train steps never commit or stage.** The Compare step commits and
   pushes both freeze records and both selection notes **before it computes
   any comparison**. No step before the look writes a probability file for a
   confirmatory or harness stream.

## 7. Cross-track comparison, the recorded GO and the one look

### 7.1 The comparison rule (fixed now)

In the Compare step, after the freeze commit and after V4-ii is measured for
both frozen points in one session:

- **A track is a candidate only if its frozen point passes the full go rule
  (§3.1).**
- **If both pass**, the winner is:
  1. the **higher O** (deployable files);
  2. if the two O values are within 1.0 pp: the **lower worst-sex hazard
     veto** WH = the largest single gating reading of H4–H8 (any cell, bin,
     machine kind or sub-band, for either sex) on the deployable files;
  3. if WH is within 0.1 pp: the **lower V4-ii**;
  4. then the larger val-negatives V2.
- **If one passes**, it is the winner.
- **If neither passes:** no look. Both tracks are reported row by row: every
  bar row per sex, O and its three parts, V4-i and V4-ii, the parity gate,
  each H4–H8 reading with N6 beside it, and the stage each track reached.

### 7.2 What is reported in every case

For both tracks: the selection table, the frozen point (or "no freeze" /
"not finished", §9.3), every go-rule reading per sex, and the comparison's
inputs. The loser's results are reported as fully as the winner's.

### 7.3 The recorded GO

The winner gets the look only after a **recorded GO**, written into the
Compare step's addendum (R6-C), hashed and committed, stating:

- the winner and the comparison's inputs;
- O and every feasibility reading per sex; V4-ii; the parity gate;
- the trills row: 444 CORRECT hops, gating, pooled (§1.1);
- the seal check (§1.2 item 1, repeated in the Compare step);
- **the fresh review's results** (§8.2);
- **the user's confirmation.** As in round 5: a review can find failures the
  rule does not cover, so the rule's go is necessary and the user's
  confirmation completes the record.

If the user declines, there is no look in round 6. The runner-up is never
promoted.

## 8. The confirmatory bar, the fresh review, the one look

### 8.1 The confirmatory bar (unchanged from rounds 3–5)

Round 3 §4, as round 5 §6.1 restates it, on the round-5 sealed set:

- **V1 clean** per subset ≤ 1 % (speech; held notes and sung phrases and
  their 75–130 / 130–300 / 300–400 Hz rows; breathy and dysphonic; real lip
  and tongue trills — 444 hops, pooled; humming; sirens and glides), worse
  gender;
- **V1 noise** ≤ 3 % per cell (+10 / 0 dB × 20 s lead / lead 0), worse
  gender;
- **V2** ≥ 60 % on NA ∪ NB pooled, ≥ 50 % on each group;
- **V3** ≤ 100 ms;
- **V4** permissive licence, ≤ 5 MB, WASM, ≤ 2 ms per 25 ms (measured by
  §3.2's protocol; phone estimated × 2.4–4.5);
- **V1 carried** ≤ 1 % clean / ≤ 3 % noisy;
- **V2 carried** ≥ 50 %.

Reported, not gating: as round 5 §6.1 (V1 noise by subset × gender with the
humming and held-note band rows; veto by time since episode onset in the
carried sessions, per gender; the trills row by source; other SOVT; per-class
V2; bootstrap intervals). For Track B the scorer runs the whole deployed
pipeline (Silero, profile, network) on every stream from its start.

**The old harness** stays the secondary guard (all 4,305 streams plus the
spliced run; old V1 rows worse than their bar by more than 1 pp flagged for
the user). Note at the look: the harness's 399 VocalSet long tones were
masked out of every round-6 row (§2.2), but the same singers' lip-trill takes
were round-6 validation material, so the VocalSet row is reported with that
note.

### 8.2 The fresh voice-safety review (required before the go; reported to the user)

Because the round-5 review's probes are now validation rows, the winner
(and, if time allows, the runner-up) is reviewed with **new probes** that no
round-6 row or training generator uses:

- a voice source not used anywhere in rounds 1–6 (a fifth synthesizer, or
  real recordings of held phonation and humming from a source no round has
  used, checked for disjointness from the sealed set as §1.2 item 5);
- machine families not in `vbeds`, `mach5`, `synth_r4` or `mach_r6`;
- a different microphone chain (another AGC and a noise-suppression model);
- exercises and session plans not in H6 / H7;
- the hazard classes of §0.2, per sex, **with noise removal on unseen steady
  machines reported beside them**.

The review reads neither the sealed set nor the private recordings.

### 8.3 Exactly one look

As §1.3: one run over every confirmatory stream and the old harness at the
winner's frozen point, after the recorded GO, with the seals verified first;
judge checks as round 3 §5 (independent re-score, WASM re-run through the
app's resampler, truncation causality, V4 re-measured by §3.2, licences and
attribution, freeze order from commit times vs probability-file times).

### 8.4 V5 (private, reported, not a gate)

After the look only. Results go to the private measurements folder; this
repository gets at most "Results on the private session recordings are kept
outside this repository."

## 9. Order of work, time budget, process limits

### 9.1 Order of work (binding; checked against the hash log)

1. **This file:** hashed, committed and pushed.
2. **Data step (shared):**
   - the §1.2 checks (blind) → **Addendum R6-A**;
   - the validation generators ported (digest-pinned, validation-only);
   - H4–H8 and the review probe streams rendered, current-app dumps, size
     rules and growth, `r6/sel/inputs.sha256`;
   - the shared code (`r6/opselect_r6.py`, the V4 bench, the parity tool,
     `r6/selftest_r6.py`);
   - the validity check (§2.12) → **Addendum R6-B**.

   Both addenda are hashed, then committed and pushed by the Data step (or,
   if that step may not commit, hashed and later committed by the Compare
   step). **Neither Train step builds any training data before R6-B is
   hashed.**
3. **Train A and Train B, in parallel, no commits:**
   - training data (D8–D9; Track B also D10 and Silero outputs);
   - **addendum TA-1 / TB-1** (data counts and hashes, code file sha256, VL
     and draw-share constants, V4-i per architecture, feature parity (a)) —
     hashed **before any training run starts**;
   - runs 1–4 → scored → **addendum TA-2 / TB-2** (runs 5–6) hashed **before
     run 5 starts** → runs 5–6;
   - the rule over all candidates → the deployable re-check → parity (c) and
     the WASM re-read → **the freeze record and the selection note**, hashed.
4. **Compare:** commit and push both tracks' addenda, freeze records and
   notes → V4-ii for both in one session → go by the rule per track → the
   comparison (§7.1) → the fresh review (§8.2) → the user's confirmation →
   **Addendum R6-C** (recorded GO or NO-GO), hashed, committed, pushed → only
   then, if GO, the one look, the judge checks, the evaluation note, V5
   (private).

A deviation from this order is written into its own dated file at once.
Round-6 addendum files: `measurements/voice-detector-round6-<tag>-<date>.md`
with tags `addendum-a`, `addendum-b`, `track-a-1`, `track-a-2`,
`track-a-selection`, `track-b-1`, `track-b-2`, `track-b-selection`,
`addendum-c`.

### 9.2 Time budget (wall-clock, including pauses by the machine's governor)

| step | budget |
|---|---|
| Data step | 16 h |
| Track A (from the start of its Train step to its hashed freeze record) | 48 h |
| Track B (same) | 60 h (more machinery: the speech detector, the profile, D10) |
| Compare, before the review | 12 h (waiting for the user is not counted) |

Inside a track's budget: a training run not finished by **budget − 16 h** is
stopped, and its saved EMA checkpoints are scored; selection starts no later
than **budget − 12 h**.

### 9.3 If a track cannot finish

- If a track has no hashed freeze record when its budget ends, it is
  **"not finished"**: no freeze, **not a candidate**, no look for it.
- It is still reported, row by row: the stage reached; each run's steps and
  scored checkpoints; the partial selection table (validation only); the
  best point so far with every go-rule reading per sex, labelled "not
  frozen"; and the reason (time, crash, an architecture over the cost
  limit, infeasible rows).
- The Compare step waits until each track has either a freeze record or a
  "not finished" record. The other track's go and comparison proceed as
  §7.1 with one candidate or none.

### 9.4 Process limits

- The two Train steps together run at most **6 heavy processes**: at most 3
  per track, of which at most 2 are training runs. The Data step runs at most
  3. The machine's governor may pause any of them; that is expected and not
  worked around.
- Every spawned browser runs through puppeteer with a temporary
  `--user-data-dir` and is killed by its own PID; never by image name.
- No download is planned. If one became necessary it would get an addendum
  first, land in its own folder, and be read only by Python run with `-I`.
- Data, caches and audio stay under `build/vad-train/` (gitignored). No
  audio, weights or private results are committed. Nothing under `src/`
  changes. No PR is opened.
- Commits use the repository's identity and end with the agreed trailer;
  only the steps told to commit do so.

## 10. Open questions for the user

1. **F3 / reading the pitch worker's output.** Still not used (round 4 §8
   Q1). Track B reads only the stream's own samples and Silero run on those
   samples.
2. **Does the granted `autoGainControl` ever come back true on your devices?**
   The diag snapshots would tell, but they are recordings of your voice and
   private, so round 6 does not read them. H5 gates AGC regardless.
3. **If the validity check does not reproduce the review's failures**
   (§2.12): proceed with the rows as built, or stop? Asked only if it
   happens.
4. **Real cells that cannot be evaluated** (§2.10) are listed in R6-B before
   training; if a hazard row ends up with no gating real cell for a sex, you
   are told before training starts.
5. **Carried over:** the V3 reading for convolutional context (round 3 §7
   Q1) is unchanged and not used; registration-gated clinical corpora (round
   3 §7 Q3) are not used.
