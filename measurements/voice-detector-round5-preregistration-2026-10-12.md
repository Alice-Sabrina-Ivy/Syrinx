# Custom voice-vs-machine detector — round 5 pre-registration (2026-10-12)

Branch `voice-detector`. This file is committed and pushed **before the
sealed set is changed, before any round-5 data is downloaded or built, and
before any round-5 model is trained**. It fixes:

- the blind repair of the trills row that the user ruled on (Addendum R4-A′);
- the new rows of the validation ("practice") bar for low male humming next
  to machines and for long holds;
- the round-5 design space aimed at the two failures the round-4 review found;
- the selection rule, the go rule, the bar and the one look.

Context:

- Started on the user's decisions of 2026-10-12 (§0.3).
- Round 4:
  [voice-detector-round4-preregistration-2026-10-11.md](voice-detector-round4-preregistration-2026-10-11.md)
  (incl. Addenda R4-A to R4-C) and
  [voice-detector-round4-selection-2026-10-12.md](voice-detector-round4-selection-2026-10-12.md).
  Round 3:
  [voice-detector-round3-preregistration-2026-10-07.md](voice-detector-round3-preregistration-2026-10-07.md),
  [voice-detector-round3-selection-2026-10-11.md](voice-detector-round3-selection-2026-10-11.md).
- Code: [scripts/voice-detector/r4/](../scripts/voice-detector/r4/README.md),
  [scripts/voice-detector/r3/](../scripts/voice-detector/r3/README.md),
  [scripts/voice-detector/train/](../scripts/voice-detector/train/README.md);
  round-5 code goes to `scripts/voice-detector/r5/` (to be written).
- **Measurement only.** `src/` is not touched, nothing is integrated, and no
  PR is opened. No audio and no weights are committed.
- **The detector's job** is unchanged: remove the stray pitch line the app
  paints during noise-only audio (about 24 % of noise-only time), without
  hiding real voice.
- **Private recordings.** The private session recordings are **never** used
  for training, selection or tuning. They are used once, for V5 (§6), and
  only after the look. The results stay in the private measurements folder;
  this repository gets at most one aggregate sentence.
- **Every voice-safety number is reported per sex.** A voice-safety limit
  holds for each sex separately (§2).

## 0. Why round 5

### 0.1 Round 4 (validation data only)

- Frozen: `custom-vd-r4` = `r10-notch` step 8,000 (an F1 network, seed 44),
  one model with its state carried and never reset, agg `mean`, p ≥ 0.10,
  hangover 300 ms.
- **O = 69.30 %** (bar 60 %), feasible on every round-4 validation reading,
  0.56 ms (Node) / 0.52 ms (headless Chrome) per 25 ms.
- Steady-noise removal rose sharply: tuning-194 stationary-tonal clips 52.8 →
  76.7 %, steady validation negatives 85.4 → 93.5 %, the 14 unseen `fsr4` val
  clips 54.9 → 88.4 %. On the review's own 20 unseen Freesound steady clips
  (80 streams, pooled over FALSE hops, recomputed from the review's
  `res-nfs.json`), 80.0 % against 60.6 % for round 3's freeze.
- **Go by the rule, but the look was not taken.** No model of any round has
  run on the sealed set.

### 0.2 What the round-4 voice-safety review found

The review ran the frozen model on probes outside the validation bar: the
round-1 review's source-filter voice synthesizer, the round-3 / round-4
reviews' synthetic room beds, real hums from Freesound, and VocalSet (an
old-harness set) in one-room streams. Its findings, which the bar did not
cover:

1. **HIGH — low male humming next to a running steady machine is vetoed.**
   Synthetic 15 s hums after a 20 s bed-only lead, +10 dB SNR (the review's
   screen, mean of four naturalness settings):

   | hum f0 | fan | fridge | HVAC | mains |
   |---|---|---|---|---|
   | 80 Hz | 78.8 % (r3: 28.4) | 88.1 % (0.7) | 96.8 % (0.0) | 84.9 % (67.3) |
   | 95 Hz | 65.6 % (0.0) | 92.8 % (0.0) | 88.8 % (0.0) | 86.0 % (0.0) |
   | 110 Hz | 0.0 % | 0.0 % | 79.0 % (0.0) | 0.0 % |
   | 140–300 Hz | ≤ 16 % (hvac / mains at 300 Hz), mostly 0 | | | |

   Share of the hum's voiced time vetoed by `custom-vd-r4`; in brackets
   round 3's freeze on the same streams. Clean hums and held /a/ vowels at
   the same pitches: 0 %. Women's hums at 160–300 Hz and men's held vowels
   are mostly unaffected (exception: /a/ at 80 Hz over a fridge, 19 %).
   Elsewhere in the review: synthetic male modal hums at +10 dB 34 %
   (round 3: 4.8 %); a 235 Hz PC-fan whine at +10 dB, male holds 41 %
   (round 3: 27 %). Real Freesound hums by men were not hit (+10 dB 0.2 %),
   but only 12 such clips existed. **The failure is gender-asymmetric.**
2. **HIGH — the voice probability decays during long steady holds.**
   Synthetic 30 s straight holds (8 pitches 80–390 Hz × modal / soft / breathy
   / hum), state carried, share vetoed by time since the hold's onset:

   | condition | 0–10 s | 10–20 s | 20–30 s |
   |---|---|---|---|
   | clean | 0.00 % | 3.53 % (m 3.09, f 3.97) | 23.67 % (m 31.83, f 2.72) |
   | PC fan +10 dB | 1–12 % | 25.9 % (m 59.4) | 47.1 % (m 95.3) |
   | fan 0 dB | 0 % | 4.7 % | 36.7 % (f 42.4) |

   Round 3's freeze: 0.00 % in every clean bin. Vetoes start 10–20 s into a
   held note **even in clean audio**.
3. **MEDIUM — 0 dB one-room sessions.** In 10-minute one-room VocalSet
   sessions at 0 dB: the female cell 3.20 % (the confirmatory carried limit is
   3 %; round 3: 2.45 %), female spoken excerpts 15.55 % vetoed (round 3:
   0.00 %), male breathy scales 5.62 % (round 3: 0.44 %).

These probes are review material: VocalSet is an old-harness set (round 3
§4, the secondary guard at the look), and the synthetic probes were scored
with the round-4 model. **None of them is used to build round 5's bar or for
selection** (§2.1). They are re-run after the round-5 freeze (§6.2).

### 0.3 The user's decisions (2026-10-12)

- **(a) Trills.** Drop the 1885 Volta recording `c_tr4_wc__a488f3b5`
  ("Trilled R", Addendum R4-A A.5) from the sealed set — blind: it has never
  been scored. **Continue the pre-registered trill search** with the next
  sources (`c_tr4_ds`, then `c_tr4_ia`), then **re-seal blind** before any
  look (§1).
- **(b) Fix first.** Run round 5 aimed at the two HIGH failures. Add
  low-male-humming-near-machines and long-held-note checks to the validation
  (practice) bar (§2). **The sealed set stays unseen until a recorded go.**
- **Consequence for round 4.** Round 4's go by the rule is **withdrawn** by
  decision (b). `custom-vd-r4` is never run on the sealed set. It stays a
  reference row (§4).

## 1. The trills ruling and the blind re-seal (Addendum R4-A′)

Blind has round 4 §2's meaning:

- no model of any round runs on a confirmatory stream before the look;
- nobody listens to, plots or scores a confirmatory clip;
- the only figures read are the current app's aggregate counts in the
  `seal.py counts` form, used only for the size and stop rules.

Round 3's guards stay. Training, validation and selection code refuse every
path under `build/vad-train/r3/conf/`; only the look sets `VAD_R3_LOOK=1`.

### 1.1 The drop

- `c_tr4_wc__a488f3b5` is dropped. Its manifest record gets the reason:
  "dropped by the user's ruling 2026-10-12: Volta Laboratory recording, trill
  label from a description of test phrases, not a trill exercise".
- The clip is in no mix and no session (R4-A A.5: new trill clips enter the
  fresh clean streams `cvoice` only). Its `cvoice` stream, reference, Praat
  track and dump leave the seal.
- **Its contributor's group is banned** from the rest of the search (one more
  file by the same contributor would bring the same question back).
- After the drop, the trills row is recounted (aggregate CORRECT hops, current
  app). This reveals the dropped clip's aggregate hop count by difference;
  that is a current-app count, not a model output, and it decides only the
  stop rule.

### 1.2 The search continues at source 3

The rules of round 4 §2.2 and Addendum R4-A A.4 apply **unchanged**: trill
metadata pattern, voice / music keyword exclusion, YAMNet ≥ 20 % human-vocal
patches, Praat-voiced ≥ 1.0 s (≥ 0.5 s for Commons), the trill-modulation
screen dropped (A.3), licences, fingerprints, ids and groups.

- **Sources, in order:** `c_tr4_ds` (Zenodo, Figshare, OSF, Harvard
  Dataverse; the round-4 query list and caps), then `c_tr4_ia` (Internet
  Archive; the round-4 query list and caps).
  - For `c_tr4_ds`, each record's participants (from its metadata or file
    name scheme) are written into Addendum R5-A **before any audio of that
    record is decoded** (round 4 §2.2 table).
- **New-people check, extended.** A name, uploader, contributor, speaker or
  participant is excluded case-insensitively (`fold_user`) if it is in:
  - `r3/exclude.json` and the round-4 `r3/train_exclude.json`;
  - the round-3 Commons IPA contributors and every round-4 trill source
    (kept or dropped, incl. the dropped clip's contributor);
  - **every round-4 training person** (Addendum R4-B B.11): the `fsr4`
    uploaders and every uploader, speaker or participant in `r4/d1.json`.
  - Round 5 adds **no new training person** (§3.3: D7 uses only records
    already on the rounds 1–2 training side, plus generated audio). If that
    ever changed, the new people would be excluded from the sealed set by
    the same rule, and only after this search is sealed.
- **Stop rule (unchanged).** After each finished source, the row's CORRECT
  hops (current app, `trills.py count`) are counted. The search stops after
  the first source at which the row reaches **≥ 800**. A source is never
  stopped part-way.
- **If the row stays under 400 after both sources:** it is reported as
  "cannot be evaluated (n CORRECT hops)", with its point estimate and
  bootstrap interval, and does not gate. **The user decides before the look**
  whether the look proceeds without the trills clause (round 4 §2.2).
- **Between 400 and 800:** the row gates under round 3 §1.3's size rules (per
  gender group ≥ 400, else pooled).

### 1.3 The re-seal

Before any round-5 validation row is scored by a model:

- the case-insensitive exclusion audit (`audit_exclusions.py`) is re-run; any
  new violation is dropped as in round 4 §2.1 and listed;
- a new seal: `scripts/voice-detector/r3/seal-confirmatory-r5.sha256`,
  `seal-r5.json` (round 3 §1.6 counts, sources, licences, code commit), the
  updated `conf-manifest.jsonl`;
- `seal-r5-changes.json`: every path removed, added or changed against the
  **round-4** seal;
- checks: `seal.py verify --tag=r5`, and the round-4 seal re-hashed minus the
  listed changes (and, as before, round 3's seal minus both change lists);
- `train_exclude.json` rebuilt (`train_side.py build`) and `train_side.py
  check` run.

All of this is committed and pushed as **Addendum R5-A (= R4-A′)**. At the
look, the round-5 seal is verified first, then the round-4 and round-3 seals
minus the listed changes.

## 2. The validation (practice) bar: new rows

Round 4's validation feasibility rows stay **unchanged** (§4). Round 5 adds
two **gating** row families, H1 and H2, and one **reported** family, H3.
Their limits are the existing validation limits: **0.5 %** clean, **1.5 %**
with a machine bed. Each limit holds for **each sex** separately.

### 2.1 What the new rows may be built from

**Allowed** (validation side only, no audio a model has been trained on):

| role | source | split / seeds | licence |
|---|---|---|---|
| real voice | Coswara **val** participants' sustained vowels (`vowel-a`, `vowel-e`, `vowel-o`) | rounds 1–2 val split | CC BY 4.0 |
| real voice | SVD (Saarbrücken) **val** speakers' sustained-vowel records | rounds 1–2 val split | as recorded in the rounds 1–2 manifests |
| synthetic voice | the **round-1 review's** source-filter synthesizer (`vsynth.py`, KLGLOTT88 flow derivative, per-cycle jitter / shimmer, F0 wander, aspiration, cascade formants, nasal antiformant for a hum; `vsynth2.py`'s per-cycle form), ported unchanged to `r5/vsynth_val.py` | seeds 5·10⁹ + i | generated |
| real bed | validation-split non-voice clips (FSD50K eval, `fstrain` val, `fsr4` val), ≥ 20 s, steady machine topic (below) | rounds 1–2 val split, `fsr4` val | per clip, from the manifests (validation use only) |
| synthetic bed | the round-3 / round-4 reviews' room-bed generators (`beds.py`: fan, mains, fridge, HVAC, voice-like motor; `beds4.py`: PC fan, 50 Hz transformer, dehumidifier, window AC), ported unchanged to `r5/vbeds.py` | seeds 6·10⁹ + i | generated |

- **Steady machine topic** of a real bed: its FSD50K labels or Freesound
  query / title match
  `(?i)(fan|air.?cond|\bac\b|hvac|ventil|blower|refrig|fridge|freezer|compressor|dehumid|hum|buzz|mains|transformer|generator|motor|idling|engine)`,
  **and** it is steady by round 4's D2 rule (S_stat ≤ 2.051 dB, or `census.py`
  stationary-tonal).
- **Bed classes** (for rotation and reported rows): *air* (fan, AC, HVAC,
  ventilation, blower; synthetic fan / HVAC / window AC / PC fan), *fridge*
  (fridge, freezer, compressor, dehumidifier; synthetic fridge / dehumidifier),
  *mains* (hum, buzz, mains, transformer; synthetic mains / 50 Hz
  transformer), *motor* (motor, engine, idling, generator; synthetic
  voice-like motor). A real class with fewer than 3 clips is filled with
  synthetic beds of that class.
- **Never used in training.** `r5/vsynth_val.py` and `r5/vbeds.py` are
  validation-only. A static check (in the round-5 self-test) fails if any
  training or packing script imports them. Training code refuses the H stream
  folder (`build/vad-train/r5/hval/`), as it refuses `r3/conf/`.

**Not allowed:**

- the sealed confirmatory set (any path under `r3/conf/`);
- the old harness sets (VocalSet, PVQD, VOICED, FDA, PTDB-TUG, vocadito,
  Hillenbrand and the benchmark's noises): they are the secondary guard at the
  look;
- the round-4 review's streams and probe lists (they were scored with
  `custom-vd-r4`; the review's Freesound hums are not validation data);
- any training-split record and the training generators (`synth.py` training
  seeds, `synth_r4.py`, the round-5 training synthesizer `vsynth_r5.py`);
- the private session recordings.

**A caution recorded in advance.** The synthetic voice and synthetic beds of
H1 / H2 come from the generators that found the round-4 failures. That makes
the new rows good at detecting those failures and a little optimistic for
the generators' own quirks. Round 5's training uses **different** generators
(§3.3), so the network cannot learn the validation generators. The real-voice
cells and the sealed set are the checks on that optimism.

### 2.2 Stream construction (seed 20261012)

- **Timeline.** A bed-only lead (the machine runs first), the voice program,
  a 5 s tail; the bed runs throughout, looped with 1 s cross-fades
  (`loop_bed`). The lead is **20 s**, and **60 s** for every third stream in
  seeded order. Clean streams use the same timeline with a −70 dBFS seeded
  white floor instead of a bed.
- **Levels.** Voice active level −26 dBFS ± 6 dB (one draw per stream). The SNR
  is computed on the voice's active RMS, as `build_mixes.py` does: **0, +10
  and +20 dB**.
- **Rates.** Real voices at their native rate. Synthetic streams rendered at
  48 / 44.1 / 16 kHz in rotation; every second synthetic stream gets the
  review's phone-microphone EQ (250 Hz high-pass, +8 dB at 3 kHz, 7 kHz
  low-pass).
- **Bed choice.** For each stream, the bed class rotates over air / fridge /
  mains / motor in a seeded order (seed 20261013); within a class, a real bed
  and a synthetic bed alternate.
- **Labels.** Each stream runs once through the current app's chain
  (`train/valdump.mjs`, src dd92037, as in rounds 3–4; ≤ 2 processes). Hop
  labels are `dump.mjs`'s CORRECT / FALSE / WRONG / EDGE. The reference F0 is
  the synthesizer's truth for synthetic voices, and Praat AC on the clean
  voice layer (round 3 §1.6 settings) for real voices.
- **Band filter.** A CORRECT hop counts in a male cell only if its reference
  F0 lies in **75–130 Hz**, and in a female cell only if it lies in
  **160–300 Hz**, except where H2 says otherwise. Hop reference time is
  score.py's td = (k + 1)·hop − 40 ms − L·hop − 30 ms.
- **Scoring.** The candidate runs with its deployment rule (`plain`: state
  carried from the stream start, never reset). Veto share = CORRECT hops the
  candidate vetoes / CORRECT hops, pooled over the cell's streams, at the
  candidate's grid point (score.py's `hop_probs` and `voice_flags`).

### 2.3 H1 — held phonation and hums next to steady machines (gating)

**Voices, per sex:**

- **Real held vowels.** Coswara val vowels and SVD val sustained vowels of
  that sex whose Praat median F0 lies in the sex's band (75–130 Hz men,
  160–300 Hz women). At most 2 records per participant and 100 per sex, in
  FNV-1a order of `"r5:" + id`. SVD records are cut to their first 30 s.
- **Synthetic hums and held vowels.** 80 holds per sex:
  - f0 log-uniform in the sex's band; tract scale 1.0 (men) / 1.17 (women);
  - kind: hum (nasal tract) for half, /a/ or /o/ for the other half;
  - quality modal, soft or breathy (a third each);
  - F0 wander U(6, 40) cents; vibrato (5–6 Hz, 30–60 cents) on a quarter;
  - hold length U(10, 20) s.

**Conditions per voice:** clean, and a bed at 0, +10 and +20 dB.

**Gating cells and limits (each sex separately):**

| cell | voice kinds | limit |
|---|---|---|
| H1 clean | real vowels; synthetic vowels; synthetic hums (3 cells per sex) | ≤ 0.5 % each |
| H1 machine | each SNR (0 / +10 / +20 dB) × the same 3 voice kinds (9 cells per sex) | ≤ 1.5 % each |

**Reported, not gating:** per bed class; real vs synthetic beds; f0 sub-bands
(75–100 / 100–130 Hz, 160–230 / 230–300 Hz); lead 20 s vs 60 s; the number of
streams with more than 10 % of their CORRECT hops vetoed.

### 2.4 H2 — long holds, clean and next to machines (gating)

**Voices, per sex:**

- **Synthetic long holds.** 40 holds per sex, 30, 45 or 60 s long (in
  rotation):
  - f0 log-uniform: men 75–160 Hz (at least half in 75–130 Hz), women
    160–400 Hz (at least half in 160–300 Hz); tract scale as H1;
  - kind and quality as H1;
  - three quarters straight (F0 wander ≤ 12 cents, no vibrato), a quarter with
    vibrato.
- **Real repeated holds.** Per val participant, the sustained vowels joined
  in order (Coswara: `vowel-a`, `vowel-e`, `vowel-o`; SVD: the speaker's
  vowel records in file order) with 2 s gaps, while the bed or floor
  continues. A series must have ≥ 30 s of voice; shorter ones are skipped. At
  most 60 series per sex, in FNV-1a order of `"r5:" + participant`.

**Conditions:**

- synthetic holds: clean, +20, +10 and 0 dB;
- real series: clean, +10 and 0 dB.

For H2, every CORRECT hop counts (no band filter): the row tests time, not
register. Band rows are reported.

**Readings, per sex × condition × {synthetic holds, real series}.** Time t =
td − the hold's (series') onset.

1. **Every 10-s bin of t** (0–10, 10–20, …; the last bin of a hold is its
   last 10 s) stays within the limit: **≤ 0.5 %** clean, **≤ 1.5 %** with a
   bed. Pooled over the cell's holds.
2. **No growth over the hold:** the veto share in the **last 10 s** of the
   holds is **≤ the share in their first 10 s + 1 pp**. Pooled over the
   cell's holds.
3. **Reported:** the veto share by 10-s bin, per hold length; the number of
   holds whose last 10 s are more than 10 % vetoed.

### 2.5 Size rules

- A cell (or an H2 bin) gates if it has **≥ 400 CORRECT hops** for that sex.
- **Synthetic cells are grown, not pooled.** If a synthetic cell has fewer
  than 400, more holds are added (next seeds, same distributions) until it
  reaches 400. This happens **before any model scores the rows**.
- **Real cells** below 400 are reported as "cannot be evaluated (n CORRECT
  hops)" and do not gate. Under the caps above none is expected to be that
  small.
- An H2 bin below 400 is merged with the bin before it.
- Sexes are **never** pooled: a limit that can only be read for one sex is
  stated as such.

### 2.6 H3 — reported rows (round-4 medium finding)

From the existing validation material, no new streams:

- the 240 one-room validation sessions (`r3/vsess`): veto share per val group
  (speech groups: LibriSpeech, VCTK, MDVR-KCL, Coswara counting; held /
  vowel groups; clinical / breathy; singing; children) × sex × condition
  (clean / +10 / 0 dB);
- **the round-4 medium finding as its own row: 0 dB, speech groups, female**
  (and its male twin);
- round 2's spliced sessions, as before.

These rows are **reported, not gating**. The feasibility reading on the
one-room sessions (each SNR cell ≤ 1.5 %, worse gender) is unchanged.

### 2.7 Validity check before training

The new rows must detect the failure they were built for. After the rows are
built and **before any round-5 training run starts**:

- `custom-vd-r4` and `custom-vd-r3` are scored on H1–H3 at their frozen
  points. `r10-data-e16000` (round 4's best log-mel network, no F1) is scored
  at its round-4 pick as a diagnostic: does the decay come from F1 or from
  the round-4 data?
- **Expected:** `custom-vd-r4` fails at least one male H1 machine cell and at
  least one H2 reading.
- **If `custom-vd-r4` passes every H row**, the rows did not reproduce the
  review's failures. Round 5 stops before training and the user decides. The
  rows are not changed.
- Results are recorded in Addendum R5-B (part 3) before training.

## 3. Round-5 design space

### 3.1 Causes (hypotheses, from the review and the round-4 design)

1. **Steady harmonic input is machine evidence.** Round 4 put more than half
   of all negative draws on steady material (D5: `stat` + D4 + `fsr4` = 0.56)
   and gave falsely painted steady frames weight 3 (D6). Its synthetic
   families include harmonic stacks in exactly the low male range: steady
   hums at 40–460 Hz (35 % at 80–250 Hz), fridge compressors at 30–200 Hz,
   50 / 60 Hz complexes. A hum has little formant energy above ~500 Hz (the
   nasal antiformant and a low-pass tract), so in the log-mel it looks like
   a steady low harmonic stack — a machine. A woman's hum at 160–300 Hz sits
   above most of those stacks; a man's held /a/ keeps its formants. That fits
   the asymmetry in §0.2.
2. **Long steadiness is machine evidence.** F1's τ = 6 s statistics converge
   on a held note: x − μ₆ → 0 and v₆ shrinks within about 3τ ≈ 18 s, the same
   signature as a machine. The decay starts 10–20 s into a hold, and round 3
   (no F1) shows none. No training positive was a steady hold of ≥ 10 s: the
   training sessions' voice episodes are utterances and short takes.
3. **No positive like the failure.** No training example was a low male hum
   (or held note) next to a running machine. Real hums with a known sex do
   not exist on the training side.

Whether cause 2 lies in F1 or in the data alone is open (`r10-data` was not
reviewed); §2.7's diagnostic row reports it.

### 3.2 What stays fixed

- **Single model, `plain`.** One network run per 25 ms, state carried from
  the stream start and never reset. No two-copy variants.
- **Base network:** round 4's (`model.py`, cfg `f1`): log-mel 64 bands
  50–7800 Hz, 32 ms window, 12.5 ms hop, causal convolutions
  `[[24,3],[48,3],[48,1]]`, GRU 96, fc 64, `frame_ms` 82.
- **Data D1–D6 and their weights** as round 4 (Addenda R4-B), re-filtered
  against the round-5 seal (§1.3) with `train_side.filter_records()`.
- **Bounded memory.** Memory beyond the 82 ms feed-forward window is carried
  only as recurrent state: the GRU state and first-order recursive filters
  with fixed time constants (≤ 30 s), so every input's influence decays.
  Nothing adds a feed-forward window over 82 ms. Every new feature path's own
  window is ≤ 82 ms, so `frame_ms` + lookahead stays ≤ 100 ms (V3).
- **Budget.** At most **four** training runs (seeds 51–54), 16,000 steps
  each, EMA 0.999, EMA checkpoints scored at 4,000 / 6,000 / … / 16,000 (7
  per run). At most two heavy processes at a time.
- **Training never reads** validation, H rows, the sealed set, the old
  harness or the private recordings.

### 3.3 D7 — positives like the failures (training side only)

**D7a — real held-phonation series.** From training-split records only
(after D1, `r4/d1.json` `train_ids`, re-filtered):

- Coswara train sustained vowels, joined per participant in the order a, e,
  o with breath gaps of U(0.5, 3) s;
- SVD train sustained-vowel records, joined per speaker the same way;
- DCS and ESMUC choir recordings as they are (held sung notes).
- **Sex balance:** per-sex durations are capped at the smaller sex's total.
  The low-male band (75–130 Hz) share and the female 160–300 Hz share are
  reported.

**D7b — synthetic holds from a new training synthesizer**, `train/vsynth_r5.py`,
training seeds [4·10⁹, 5·10⁹). It is **not** the validation synthesizer:

| property | training synthesizer (D7b) | validation synthesizer (§2.1) |
|---|---|---|
| glottal source | Rosenberg-type pulse with a return phase, open quotient 0.4–0.8 | KLGLOTT88 flow derivative |
| tract | formants F1–F5 drawn per hold within ±15 % of /a e i o u/ tables; hum tract with a nasal pole at 200–300 Hz and a zero at 600–1,500 Hz, both drawn | fixed Peterson–Barney-like tables, one fixed hum tract |
| tract scale | men 0.92–1.05, women 1.10–1.25 | 1.0 / 1.17 |
| jitter, shimmer, wander | 0.2–1.5 %, 1–6 %, 3–40 cents | per quality preset |
| vibrato | p 0.3, 4.5–6.5 Hz, 20–80 cents | as §2.3 |
| aspiration | −40 … −15 dB | per quality preset |

- f0, log-uniform within a mixture: **40 % in 75–130 Hz with a male tract,
  40 % in 160–300 Hz with a female tract**, 20 % in 130–160 or 300–420 Hz
  with either tract.
- Kind: hum 40 %, vowel 60 %. Hold length U(5, 60) s. Onset 0.05–0.4 s,
  offset 0.1–0.5 s.
- Bank: **2,000 holds**, packed like `synth_r4_train` (int16, 16 kHz).
  Labels from the synthesizer's truth (voiced where the source is on).

**Use in training:**

- **Hold sessions.** With p **0.35**, a one-room training session is a hold
  session:
  - its voice episodes come half from D7a series, half from D7b holds;
  - its bed comes from the steady pools (`stat`, D4, `fsr4` train) with
    p 0.8, else from the D5 draw;
  - SNR U(−3, +25) dB on the voice's active level, or clean with p 0.2;
  - length, pauses and voice fraction as round 4's sessions (64–256 s).
- **Crops.** With p **0.15**, a voice crop is taken from D7 (any offset in the
  hold) and mixed as round 3's crops.
- Every other session and crop is drawn as in round 4.

### 3.4 Loss terms against decay

Applied in hold sessions, to voice episodes of ≥ 10 s:

- **Tail weight.** Voice frames at t ≥ 10 s after the episode's onset get
  loss weight **max(w, 3)** (the D6 rule mirrored for voice).
- **Decay penalty.** L_dec = mean over voice frames with t ≥ 5 s of
  relu(p̄₀ − p_t), where p̄₀ = the mean p over the episode's frames in
  [0.5 s, 5 s) after its onset, with no gradient through p̄₀. The total loss
  adds **λ · L_dec, λ = 1.0**. With TBPTT, p̄₀ is carried from the chunk that
  holds it (detached).

### 3.5 Feature variants

**F1m — a floor reference that a held voice cannot pull up.** It replaces
F1's τ = 6 s statistics; the τ = 1 s statistics stay.

- Per band, a recursive floor m_t = min(x_t, m_{t−1} + ρ·Δt), with
  **ρ = 0.05 dB/s** (3 dB per minute; in natural-log units of the log-mel)
  and m₀ = x₀. A steady bed sets the floor. A voice held 10 dB above the bed
  for 60 s lifts it by at most 3 dB.
- Input channels to the first convolution: x, x − μ₁, log(v₁ + ε), x − m,
  log(w + ε), where w = the τ = 1 s EMA of (x − m)². That is 5 channels, as
  in F1.
- First-order recursive, input-only (no feedback from the output), so it can
  be computed once per session without a gradient, like F1 (Addendum R4-B
  B.8).

**F5 — voice-likeness: harmonic structure, envelope, onset history.** Fed to
the GRU input next to F1's flux EMAs.

- **Harmonic structure** (one 64 ms Hann window, 1,024 points at 16 kHz, per
  12.5 ms hop):
  - the cepstral peak prominence over quefrencies 2.5–13.3 ms (75–400 Hz);
  - the peak's quefrency q (parabolic);
  - micro-variation: |log q_t − log q_{t−1}| on periodic frames (else 0), and
    |Δ log energy| in the 50–1,000 Hz band; for each, EMAs with τ 0.25 s and
    1 s.
  - Voice has jitter, shimmer, wander and vibrato; the machines in the review
    wobble ≤ 3–10 cents.
- **Envelope:** coefficients 1–12 of the DCT-II of the 64 log-mel bands (the
  formant / nasal shape).
- **Onset history:** the positive spectral flux (mean over bands of
  max(0, x_t − x_{t−1})); its decaying maxima o ← max(flux, o·exp(−Δt/τ)) for
  τ = 3 s and 30 s. A machine running since the stream start has no recent
  onset; a held note began at a known time.
- Window 64 ms ≤ 82 ms, so `frame_ms` stays 82.

**Bound — a voice-presence term caps the steady-noise evidence** (only in run
4 under §3.6's rule).

- A second head reads the convolution stack and F5 without the GRU:
  l_loc, a memoryless voice logit.
- Final logit: **l = max(l_gru, l_loc − B), B = 4**, with an auxiliary BCE
  on l_loc (weight 0.5).
- Memory can lower the logit at most to 4 below the local voice evidence. A
  locally strong voice (p_loc ≥ 0.86) can no longer be vetoed at threshold
  0.1. The price, if any, shows in O.

**Considered and not used:**

- Removing D4's low steady hums from the negatives: machines really are
  harmonic and steady at those pitches; the fix is to teach what makes a
  hum a voice, not to stop showing machines.
- A long feed-forward window (minimum over the last D seconds, a long
  spectral window): fails V3 under round 1's reading.
- F3 (the pitch worker's notch lines as input): still not accepted by the
  user (round 4 §8 Q1). Default: not used.
- New real hum downloads for training: sex is rarely stated, and every new
  person would have to be kept out of the sealed set; D7a and D7b cover the
  f0 × tract grid.

### 3.6 Runs

All runs use D1–D6, D7 and §3.4's loss terms.

| run | seed | features | question |
|---|---|---|---|
| `r11-data` | 51 | F1 (round 4's network) | do the data and the loss alone fix it? |
| `r11-floor` | 52 | F1m | does a floor that a voice cannot pull up remove the decay? |
| `r11-harm` | 53 | F1m + F5 | do voice-likeness features separate low hums from machines? |
| run 4 | 54 | by the rule below | |

- **Run 4 rule**, applied after runs 1–3 are scored by §4's rule (validation
  only) and recorded in an addendum **before run 4 starts**:
  - if at least one checkpoint of runs 1–3 has a point feasible under the
    extended bar (§4), run 4 is a **second seed (54)** of the feature set of
    the best such candidate (largest O; ties as §4). Round 4's three F1 seeds
    differed by up to 7 pp in O, so a second seed of the working design is
    worth more than a new idea;
  - otherwise run 4 is **F1m + F5 + Bound** (`r11-bound`, seed 54).
- Runs 1–2 train in parallel, then run 3; run 4 waits for the rule.

### 3.7 Details left to Addendum R5-B

Fixed **before any round-5 model is scored on validation data**, and never
chosen by looking at validation scores:

- ε and initial values of F1m and F5;
- the cepstral periodicity threshold;
- D7's exact record lists and counts, the per-sex caps, the synthesizer's
  parameter tables;
- the sampler code and its draw shares;
- the parity checks (F1m / F5 batch vs streaming vs ONNX, as Addendum R4-B
  B.8);
- the WASM cost of each architecture.

## 4. Selection (validation data only)

**Selection data:**

- round 4's, **unchanged and checked by sha256** against round 4's
  `build/vad-train/r4/sel/inputs.sha256`: the 194-clip tuning split, the
  rounds 1–2 validation streams, the 240 one-room validation sessions, the
  spliced sessions (reported);
- **plus H1, H2 and H3** (§2), hashed into `build/vad-train/r5/sel/inputs.sha256`
  when they are built.

**Candidates:**

- the 28 EMA checkpoints of §3.6, each `plain`;
- reference rows `custom-vd-r3` and `custom-vd-r4`, re-scored in the same
  rule run (eligible).
  - They must reproduce their round-3 / round-4 rule entries on the unchanged
    rows.
  - `custom-vd-r4` is expected to be infeasible (§2.7).

**Grid:** round 3 §3.2, unchanged: 24 thresholds × 16 hangovers (0–3 s) × agg
{`last`, `mean`, `max`}.

**Feasibility = round 4 §4's rows plus H1 and H2:**

| reading | limit |
|---|---|
| fresh: every clean val group, worse gender | ≤ 0.5 % |
| fresh: every val mix cell, worse gender | ≤ 1.5 % |
| one-room carried: every clean group; each SNR cell, worse gender | ≤ 0.5 %; ≤ 1.5 % |
| V3: `frame_ms` + lookahead; median onset delay, fresh and carried | ≤ 100 ms; ≤ 100 ms |
| V4: desktop onnxruntime-web WASM (Node, 1 thread) | ≤ 2 ms per 25 ms |
| **H1 clean: each sex × voice kind** | **≤ 0.5 %** |
| **H1 machine: each sex × SNR (0 / +10 / +20 dB) × voice kind** | **≤ 1.5 %** |
| **H2: each sex × condition × {synthetic holds, real series}: every 10-s bin** | **≤ 0.5 % clean; ≤ 1.5 % with a bed** |
| **H2: same cells: last 10 s vs first 10 s** | **≤ first + 1 pp** |

**Objective and choice** (round 4 §4, unchanged):

- **O** = min(tuning-194 V2, val-negatives V2, one-room val sessions V2),
  pooled over FALSE hops.
- Within a candidate: the feasible point with the largest O; within 0.5 pp,
  the shorter hangover.
- Between candidates: the largest O; within 1 pp, the lower measured WASM
  cost (per architecture: F1, F1m, F1m + F5, F1m + F5 + Bound), then the
  larger val-negatives V2.
- If no candidate has a feasible point: no freeze and no look; the selection
  table goes to the user.

**Reported, not in the rule:** round 4's reported rows (spliced sessions,
`fsr4` val, val negatives by D2 label, tuning-194 by census label); H1 / H2
reported breakdowns; H3; the run-4 rule's inputs.

**Implementation.**

- Selection files: `infer_r3.py`'s method (GPU torch, TF32 off, state
  carried) with F1m / F5 / Bound-aware streaming forms, for the old rows and
  the H streams.
- The scorer: `opselect_r3.py`'s logic plus the H readings (`opselect_r5.py`,
  with a self-test against score.py's functions).
- **Deployable re-check and freeze**, as round 4:
  - the chosen checkpoint is exported to streaming ONNX;
  - every selection file, **the H rows included**, is re-made with
    onnxruntime CPU, 1 thread, chunk by chunk;
  - the rule is re-run; its pick is the frozen point;
  - the freeze is written to `scripts/voice-detector/train/frozen/candidate-r5.json`
    and **committed and pushed before its runner touches any harness or
    confirmatory stream**.

**A caution recorded in advance.** As in round 4, O on the tuning split is
optimistic: the design targets its noise types, and the choice among seeds
is a selection on it. The new rows add a second optimism (§2.1: the
validation generators found the failures). The sealed set is the check on
both.

## 5. Go rule

**The look is taken only if the frozen point is feasible under §4's extended
bar, H1 and H2 included, and O ≥ 60 % on the 194-clip tuning split**, both on
the deployable re-check. That is round 4's go rule with the new rows.
Otherwise round 5 stops before the look, the seal stays unbroken, and the
user decides.

**A recorded go** states:

- O and every feasibility reading, H1 / H2 per sex;
- the trills row after §1: gating, or "cannot be evaluated" with the user's
  decision;
- the seal check (round-5 seal; round-4 and round-3 seals minus the listed
  changes);
- the post-freeze review's results (§6.2);
- **the user's confirmation.** Round 4 showed that a review can find failures
  the rule does not cover, so the rule's go is a necessary condition and the
  user's confirmation, written into the freeze addendum, completes the
  record.

## 6. Confirmatory bar, the review before the look, and the one look

### 6.1 The bar (unchanged)

Round 3 §4, as round 4 §6 restates it, applies **unchanged** to the re-sealed
confirmatory set (§1.3):

- V1 clean per subset ≤ 1 % (speech; held notes and sung phrases and their
  75–130 / 130–300 / 300–400 Hz rows; breathy and dysphonic; real lip and
  tongue trills; humming; sirens and glides), worse gender;
- V1 noise ≤ 3 % per cell;
- V2 ≥ 60 % on NA ∪ NB pooled, ≥ 50 % on each group;
- V3 ≤ 100 ms;
- V4 permissive, ≤ 5 MB, WASM, ≤ 2 ms per 25 ms (phone estimated × 2.4–4.5);
- V1 carried ≤ 1 % clean / ≤ 3 % noisy;
- V2 carried ≥ 50 %.

**Added reported rows (not gating):**

- V1 noise split by subset × gender, with humming and the held-note band rows
  (75–130 Hz especially) in each noise cell;
- veto share by time since episode onset (10-s bins) in the confirmatory
  carried sessions, per gender;
- the trills row split by source (round 3's Commons IPA clips, `c_tr4_fs`,
  `c_tr4_wc`, and any `c_tr4_ds` / `c_tr4_ia` clips);
- as round 4: "other SOVT", per-class V2, bootstrap intervals.

**The old harness** stays the secondary guard (round 3 §4): all 4,305 streams
plus the spliced run, old V1 rows worse than their bar by more than 1 pp
flagged for the user.

### 6.2 The review before the go (reported to the user, not part of the rule)

After the freeze commit and before the go is recorded, the round-4 voice-safety
review's probes are re-run on the frozen round-5 candidate with the same
scripts:

- the hum screen; the long synthetic holds; VocalSet repeated holds and
  10-minute one-room sessions; real hums and SOVT probes;
- the review's Freesound steady clips and synthetic noise-only beds.

The results go to the user with the selection note. VocalSet is old-harness
material that every round's reviews have read, so this does not touch the
sealed set.

### 6.3 Exactly one look

- One run of the round-3 scorer over every confirmatory stream and the old
  harness, at the frozen point, after the freeze commit and a **recorded go**
  (§5), with the seals verified first.
- No re-selection after it. Any later point is post hoc, with the number of
  looks.
- Judge checks as round 3 §5.
- **V5 (private, reported, not a gate):** after the look only. Results go to
  the private measurements folder; this repository gets at most "Results on
  the private session recordings are kept outside this repository."

## 7. Order of work

1. **This file:** committed and pushed (now).
2. **Data step A′ (blind; the sealed side; §1):**
   - the drop;
   - `c_tr4_ds` (the scan, then the participant list into the addendum, then
     the downloads), prepare, count;
   - if the row is still under 800, `c_tr4_ia`, prepare, count;
   - the dumps of new streams;
   - the audit, the re-seal, `train_exclude.json`.

   **Addendum R5-A (= R4-A′)** is committed and pushed.
3. **Data step V (the validation side; §2):**
   - port the validation generators;
   - build H1 / H2 (and the size rules' growth);
   - the current-app dumps (≤ 2 processes);
   - hash the selection inputs.

   **Addendum R5-B part 1** (stream counts, CORRECT hops per cell and sex,
   licences of the real beds) is committed and pushed. No model has scored
   the rows yet.
4. **Data step B (the training side; §3):**
   - D1 re-filter, D7a lists, the D7b bank;
   - F1m / F5 / Bound and the loss code, with parity checks.

   **Addendum R5-B part 2** is committed and pushed.
5. **Validity check (§2.7):** the reference and diagnostic rows on H1–H3.
   **Addendum R5-B part 3** is committed and pushed. If `custom-vd-r4` passes
   every H row: stop, and the user decides.
6. **Training and selection:**
   - runs 1–3 (≤ 2 at a time); the rule; the run-4 decision (addendum); run 4;
   - the rule over all 28 checkpoints and the reference rows;
   - the deployable re-check;
   - **the freeze committed and pushed**; go / no-go by the rule (§5).
7. **If go by the rule:** the review (§6.2); the user's confirmation recorded;
   then the one look, the judge checks, the evaluation note, and V5
   (private).

Process limits:

- at most two heavy processes; other work may run, and a governor may pause
  jobs;
- every spawned browser runs with a temporary `--user-data-dir` and is killed
  by its own PID;
- downloads and caches stay under `build/vad-train/` (gitignored);
- no audio, weights or private results are committed;
- no PR is opened.

## 8. Open questions for the user

1. **F3 (notch-line input).** Still unanswered from round 4 (§8 Q1).
   **Default:** not used.
2. **Trills.** If §1.2 cannot bring the row to 400 after both sources, may
   the look proceed without the trills clause? Asked only if that happens,
   and always before the look.
3. **If the new rows do not reproduce the round-4 failure** (§2.7): proceed
   with them as built, or stop? Asked only if that happens.
4. **VocalSet and the review probes stay out of the practice bar** (§2.1),
   because they are look-time material and were scored with `custom-vd-r4`.
   Using them would make the bar closer to the review but leave the review
   with no independent probes. **Default:** they stay out; they are re-run as
   §6.2's review.
5. **Carried over:** the V3 reading for convolutional context (round 3 §7 Q1)
   is unchanged and not used. Registration-gated clinical corpora (round 3
   §7 Q3) are not used.

## Addendum R5-A (= R4-A′) — data step A′, the sealed side (2026-10-12)

Written during data step A′, **before any round-5 data is downloaded on the
training or validation side and before any round-5 model exists**. No model
of any round has run on a confirmatory stream; nobody listened to, plotted
or scored a confirmatory clip. The only figures read are the current app's
aggregate trills-row counts (`trills.py count`) and the `seal.py counts`
form.

Code: [scripts/voice-detector/r5/trills_r5.py](../scripts/voice-detector/r5/trills_r5.py)
(wraps round 4's `r4/trills.py`), `r3/seal.py --tag=r5` (commit 0b65b67).

### R5-A.1 The drop (§1.1)

- `trills_r5.py drop`: `c_tr4_wc__a488f3b5` gets a manifest drop record with
  the reason "dropped by the user's ruling 2026-10-12: Volta Laboratory
  recording, trill label from a description of test phrases, not a trill
  exercise". Its `tr4_wc` selection record carries the same drop, and its
  contributor group (`c_tr4_wc:aecac46ea`) is on the selection file's ban
  list.
- It was in no mix and no session (fresh clean stream `cvoice` only), so
  only `cvoice.json` changed. Its audio, reference, Praat track and dump
  left the seal (R5-A.4).
- **Recount (current app, aggregate):** trills row **444** CORRECT hops
  (gender unknown, pooled), down from 835. As §1.1 says, the difference
  (391 hops) is the dropped clip's own current-app count. It decides only
  the stop rule.

### R5-A.2 The extended new-people list (§1.2)

`trills_r5.py people` -> `build/vad-train/r5/people-exclude.json` (fold_user
keys, gitignored): 26,193 keys in all — `exclude.json` 24,355,
`train_exclude.json` (round 4) 1,255, round-3 Commons IPA contributors 7,
every round-4 trill source (all Freesound candidates and rejections of
`c_tr4_fs`, every checked Commons item's artist / uploader and group,
incl. the dropped clip's) 295, every round-4 training person (every
uploader, speaker, participant and group of `r4/d1.json` `train_ids`, plus
all `fsr4` uploaders) 13,874. `trills.Ctx` takes these keys for `ds` and
`ia`.

### R5-A.3 The search, source 3 then source 4 (§1.2)

**A bug found and fixed before any candidate was checked.** Round 4's
`ds-scan` asked Zenodo for 100 records per page. Zenodo now caps anonymous
pages at 25 and answers a larger page with HTTP 400 and no hits; the code
read that as "no records" for every query. Fixed in `r4/trills.py` (pages
of 25, up to 4 pages = the intended 100, any non-200 answer is an error).
The first scan's output is kept as `ds-scan.zenodo-size-bug.json` (sealed);
the scan was re-run.

| source | read | candidates / checked | kept | trills row after it (CORRECT hops) |
|---|---|---|---|---|
| (after the drop) | — | — | 10 Commons IPA + 1 `c_tr4_fs` + 3 `c_tr4_wc` | **444** |
| `c_tr4_ds` research datasets | 8 queries × Zenodo (type dataset, open access: 0 records for every query), Figshare (8 dataset records), OSF (1 node), Harvard Dataverse (0) | 9 records, **none with an audio file or archive** (PDF / XLS supplements and a pre-registration) | **0** | **444** |
| `c_tr4_ia` Internet Archive | 4 queries: 7 items ("lip trill" 1, "lip trills" 2, "tongue trill" 0, "vocal warm up" 4) | 10 files checked: 4 keyword rule (dogs, party, street, dog), 2 licence CC BY-NC-ND 3.0, 4 no trill / SOVT pattern | **0** | **444** |

- No `c_tr4_ds` record had audio, so **no participant list was needed**
  and no audio of any record was decoded (`ds-cands.json`: 0 records).
- No clip matched only the other-SOVT pattern: that reported row stays
  empty.
- **No further source is pre-registered** (round 4 §2.2 lists four; the
  first two were searched in round 4). The search is finished.

**Result under the stop rule (§1.2):** the row ends at **444 CORRECT hops**,
between 400 and 800. It **gates** under round 3 §1.3's size rules: every
clip's gender is unknown, so the row is read pooled (444 ≥ 400). It is not
"cannot be evaluated", so §8 Q2 does not arise. The margin is small: any
later drop of more than 44 hops' worth of trill clips would push the row
under 400.

### R5-A.4 Re-seal (§1.3)

- **Audit re-run** (`r4/audit_exclusions.py`, self-test PASS; output copied
  to `build/vad-train/r5/audit-exclusions.json`): A — 1 violation,
  `c_fsv__716881`, already dropped; **0 kept violations**; the ≤ 2 per
  uploader cap holds. B — 7 rounds 1–2 records touch the sealed set, 0 kept
  (the QuartzGate FSD50K clips, dropped for their licence). C, D as in
  round 4. No new drop.
- **New seal**: `scripts/voice-detector/r3/seal-confirmatory-r5.sha256`
  (60,008 lines, 47,781 unique paths, 15.2 GB; sha256 `6dcbbe5f…2f44`),
  `seal-r5.json` (round 3 §1.6 counts, sources, licences; code commit
  0b65b67), the updated `conf-manifest.jsonl` (sha256 `663e381b…2438`; the
  drop record with its reason). Kept records **7,938** (round 4: 7,939).
- **Changes against round 4's seal** (`seal-r5-changes.json`): **6 removed**
  (the dropped clip's two audio files, dump (2), Praat track and
  reference), **5 added** (`tr4_ds/ds-scan.json`, `ds-scan.zenodo-size-bug.json`,
  `ds-cands.json`; `tr4_ia/candidates.json`, `selection.json`), **3
  changed** (`dl/tr4_wc/selection.json`, `manifest.jsonl`,
  `streams/cvoice.json`). No mix, session, noise stream or other stream
  changed.
- **Checks**: `seal.py verify --tag=r5` 0 mismatches; `verify-r4 --tag=r5`
  (round 4's seal minus the round-5 changes) 47,773 paths, 0 mismatches;
  `verify-r3 --tag=r5` (round 3's seal minus the round-4 and round-5
  changes) 47,738 paths, 0 mismatches.
- **Set sizes** (current app, §1.6 form): `cvoice` 5,940 streams / 13.67 h;
  `cneg` 191 / 3.52 h; `cmix20`, `cmix0` 764 each; `csess` 160 (all
  unchanged except `cvoice`). Trills row 444 CORRECT hops (unknown gender,
  pooled).
- **Licences of the kept set (7,938)**: CC BY 4.0 6,524; CC BY-NC-SA 4.0
  1,086 and MTG-QBH 118 (evaluation only); CC0 141; CC BY-NC 3.0 / 4.0 46,
  CC BY-SA 3.0 / 4.0 11 (evaluation only); CC BY 3.0 12. (The one public
  domain record was the dropped clip.)
- **Training side**: `train_side.py build` rebuilt `r3/train_exclude.json`;
  it is **byte-identical** to round 4's (sha256 `9dea5dcf…e670`: the
  dropped clip's record stays in it, since dropped records are excluded too,
  and the new searches added no Freesound candidate). `train_side.py check`:
  0 kept rounds 1–2 records touch it (the 7 touching records are the
  dropped QuartzGate clips). `r4/d1.json` was built against the same file,
  so D1 needs no re-filter.

**Status after data step A′.** The sealed set is re-sealed; no model of
any round has run on it. Data step V (the validation rows, Addendum R5-B
part 1) starts only after this addendum is pushed.

## Addendum R5-B part 1 — data step V, the validation rows (2026-10-12)

Written after Addendum R5-A was pushed (d83873a) and **before any model has
scored an H row**. No model of any round has run on these streams. The only
figures read are the current app's aggregate CORRECT-hop counts per cell,
used for the size rules (§2.5). Code:
[scripts/voice-detector/r5/](../scripts/voice-detector/r5/README.md)
(`vsynth_val.py`, `vbeds.py`, `hval.py`, `selftest_r5.py`; commit 6f9f42a).

### R5-B.1 The validation generators (§2.1)

- `r5/vsynth_val.py` and `r5/vbeds.py` are the review files ported unchanged
  (only the headers and the in-module import differ).
  - They are bit-exact against the review modules: `vsynth2.synth` on two
    settings, `beds4.bed` on all ten kinds.
  - `selftest_r5.py` pins digests taken from the review files.
- `selftest_r5.py` also checks that no script under `train/` (28 files) and
  no round-5 training-side script imports either module or names `r5/hval`:
  PASS.

### R5-B.2 Real beds (§2.1)

`hval.py beds` -> `build/vad-train/r5/hval/beds.json`.

- **A correction made before any stream was built.**
  - The pre-registered topic pattern has no word boundaries, so "hum"
    matched inside FSD50K's label `Thump_and_thud` (waves, scissors, a
    bathtub, trains).
  - The rule now reads FSD50K's `_` as a space and puts a word-start
    boundary on every term (`\b(fan|air.?cond|ac\b|…|engine)`). Terms still
    match as prefixes ("fans", "motorcycle").
  - This removed 12 candidates, every one a `Thump and thud` clip (listed in
    `beds.json`): 187 → **175** candidates, 112 → **109** kept.
- **Steady clips.** Of the 175 val machine-topic clips of ≥ 20 s (FSD50K
  eval, `fstrain` val, `fsr4` val), **109 are steady** by round 4's D2 rule
  (S_stat ≤ 2.051 dB or census stationary-tonal): `fstrain` 57, FSD50K
  eval 41, `fsr4` val 11.
- **Classes:** air 50, motor 33, mains 15, fridge 11. Every class has at
  least 3 real clips, so none is filled with synthetic beds only.
- **Licences** (validation use only): CC0 1.0 62, CC BY 3.0 24, CC BY 4.0 23,
  all from the rounds 1–2 / `fsr4` manifests.

### R5-B.3 Real voices (§2.3, §2.4)

`hval.py voices` -> `voices.json`:

- Reference: Praat AC 60–1100 Hz, 10 ms, 30 dB level gate (round 3 §1.6),
  on the 16 kHz files.
- Records: 1,028 val records with a stated sex (Coswara `vowel-a/e/o`, SVD
  `iau` files).
- Licence: CC BY 4.0 (Coswara, SVD).

| row | men | women |
|---|---|---|
| H1 real held vowels: median F0 in band, ≤ 2 per person, ≤ 100 | **100** | **100** |
| — by source | Coswara 80, SVD 20 | Coswara 59, SVD 41 |
| — median F0 range | 86–130 Hz (13 under 100 Hz) | 162–293 Hz (54 under 230 Hz) |
| H2 real series: ≥ 30 s Praat-voiced, ≤ 60 | **60** | **36** |
| — by source | Coswara 47, SVD 13 | SVD 22, Coswara 14 |
| — series length | 39–177 s, median 55 s | 39–158 s, median 59 s |

Only 36 women have a series with ≥ 30 s of voice, so the cap of 60 is not
reached. This affects only the size of the real cells, and §2.5 is still met
(R5-B.6).

### R5-B.4 Construction details fixed here (§2.2–2.4)

All fixed in `hval.py` before any stream was rendered.

- **Lead.**
  - 60 s when FNV-1a(`"r5lead:" + stream id`) mod 3 = 2, else 20 s. This is
    a seeded order that adding streams cannot reshuffle.
  - Result: 474 of 1,440 H1 streams and 202 of 608 H2 streams have the 60 s
    lead.
- **Level.** One draw per stream, from seed (20261012, FNV-1a of the id).
  The clean floor (−70 dBFS white) uses the same seed.
- **Bed rotation.**
  - Per family, in construction order: real voices (men, then women), then
    the synthetic holds interleaved by index (men k, then women k).
  - Classes follow the seeded order of seed 20261013.
  - Within a class, real comes first, then synthetic, alternating.
  - Real clips: FNV order, cycling, resampled to the stream rate
    (`resample_poly`).
  - Synthetic kinds cycle per class (air: fan, hvac, aircon, pcfan; fridge:
    fridge, dehum; mains: mains, xfmr50; motor: vmotor). Seeds are
    6·10⁹ + i (H2: + 500,000).
  - Result: every class gets the same number of real and synthetic beds (H1
    135 each, H2 54 each), and all 109 real clips are used.
- **Synthetic holds.** Seed = 5·10⁹ + offset + k. Offsets: H1 men 0, women
  100,000; H2 men 200,000, women 300,000.
  - Kind cycles hum, /a/, hum, /o/. Quality cycles modal, soft, breathy.
  - Vibrato when k mod 8 ∈ {1, 6}: a quarter of the holds, hums and vowels
    alike.
  - Rate cycles 48 / 44.1 / 16 kHz. Every second synthetic stream gets the
    phone EQ.
  - Onset and offset: the synthesizer's default 0.25 s.
  - **H1:** f0 log-uniform in the band; wander U(6, 40) cents; hold
    U(10, 20) s.
  - **H2:**
    - length 30 / 45 / 60 s in rotation;
    - f0 log-uniform in the core band (75–130 / 160–300 Hz) for even k, in
      the wide band (75–160 / 160–400 Hz) for odd k;
    - wander U(3, 12) cents.
- **H2 time.**
  - t = td − series onset. For a real series, the onset is the first
    vowel's start, and the 2 s gaps stay inside the series.
  - Bins are 0–10, 10–20, … s; "last" is the series' last 10 s.

### R5-B.5 Streams and the current-app dumps

The streams were built with `hval.py build`. The dumps were then made with
`ROOT=build/vad-train/r5/hval run-dumps.sh h1:2 h2:1`, using
`train/valdump.mjs`, src dd92037 (unchanged) and at most 2 processes. A
governor paused them at times.

| family | streams | hours | streams per sex, by voice kind and condition |
|---|---|---|---|
| H1 | 1,440 | 21.6 | real 100, synthetic vowels 40, synthetic hums 40; each × clean, 0, +10, +20 dB |
| H2 | 608 | 15.7 | real series (men 60, women 36) × clean, +10, 0 dB; synthetic 40 (20 vowels, 20 hums) × clean, +20, +10, 0 dB |

- Sample rates, H1: 48 kHz 988 streams, 44.1 kHz 236, 16 kHz 216.
- Sample rates, H2: 48 kHz 379, 44.1 kHz 125, 16 kHz 104.
- Audio: 11 GB, gitignored.

### R5-B.6 Size rules (§2.5): CORRECT hops (current app, aggregate)

**H1** (band-filtered: men 75–130 Hz, women 160–300 Hz):

| cell | men: real | men: syn vowel | men: syn hum | women: real | women: syn vowel | women: syn hum |
|---|---|---|---|---|---|---|
| clean | 30,292 | 23,483 | 23,988 | 31,663 | 21,372 | 22,853 |
| +20 dB | 27,531 | 23,305 | 23,267 | 28,977 | 20,206 | 20,416 |
| +10 dB | 24,492 | 17,283 | 22,554 | 25,433 | 20,284 | 19,334 |
| 0 dB | 20,527 | 9,792 | 9,699 | 15,831 | 19,652 | 8,588 |

**H2** (every CORRECT hop, no band filter). Each cell shows first 10 s /
last 10 s:

| cell | men: syn | men: real | women: syn | women: real |
|---|---|---|---|---|
| clean | 15,916 / 4,182 | 18,481 / 15,517 | 15,812 / 6,031 | 9,361 / 8,992 |
| +20 dB | 15,738 / 9,946 | — | 14,131 / 6,924 | — |
| +10 dB | 12,686 / 8,059 | 15,942 / 11,819 | 14,038 / 7,709 | 7,374 / 6,482 |
| 0 dB | 9,404 / 7,787 | 12,876 / 9,014 | 8,971 / 6,078 | 5,129 / 4,593 |

- **Every gating cell has ≥ 400 CORRECT hops for each sex.**
- **No synthetic cell needed growth.** `counts --grow` found none under 400,
  so the plan stays at 80 (H1) and 40 (H2) holds per sex.
- **Synthetic H2 bins** run to 40–50 s, plus "last"; each has ≥ 1,046 hops.
- **Real series bins.**
  - Beyond about 70–120 s, the bins fall under 400. By §2.5 each such bin
    merges with the bin before it.
  - The merged tail bins are 80–150 s (women) and 130–170 s (men), each with
    ≥ 478 hops.
- Sexes are never pooled.

### R5-B.7 Hashes

- `hval.py hash` -> `build/vad-train/r5/sel/inputs.sha256`; the list's
  sha256 is `a5121c50…7157`.
- It covers 8,198 files: the two specs; each stream's audio, reference and
  dump; and `beds.json`, `voices.json`, `plan.json`, `counts.json`.
- H3 needs no new streams: it uses the existing `r3/vsess` sessions (§2.6).

## Addendum R5-B part 2 (data) — data step B, the training additions (2026-10-12)

The feature, loss and sampler code — F1m, F5, Bound, the §3.4 loss terms,
D7's draw shares in the sampler, the parity checks and the WASM cost — is in
**part 2 (code)** below, written before the validity check (§2.7). No model
is trained before then.

### D1

- No re-filter is needed. `train_exclude.json` after the round-5 re-seal is
  byte-identical to round 4's (R5-A.4), and `r4/d1.json` was built against
  it.
- `d7.py` still runs `train_side.filter_records` on every D7a record.

### D7a

`r5/d7.py lists` -> `build/vad-train/r5/d7a.json` (sha256
`45a07a97…c9712`). Training-split records only, all CC BY 4.0, no new
person.

- **Before the cap:** women 1,912 series / 20.10 h; men 2,432 / 24.37 h.
- **After the cap:** the men are capped at 20.10 h. **Men 2,038 series /
  20.10 h, women 1,912 / 20.10 h**, 7,495 records.
- **Hours by source:**

  | | Coswara | SVD | DCS | ESMUC |
  |---|---|---|---|---|
  | women | 4.70 | 9.49 | 2.65 | 3.25 |
  | men | 9.26 | 5.53 | 3.28 | 2.04 |

- **Share of Praat-voiced frames in band:**
  - men in 75–130 Hz: **37.9 %**;
  - women in 160–300 Hz: **59.6 %**;
  - women in 75–130 Hz: 6.7 %;
  - men in 160–300 Hz: 29.1 % (choir parts and SVD's high-pitch takes).

### D7b

`train/vsynth_r5.py pack --n=2000` ->
`build/vad-train/train/vsynth_r5_train.i16` (2.0 GB) + `.npz` (sha256
`c6d95b4c…d4c`).

- **Bank:** 2,000 holds, 17.75 h, training seeds 4·10⁹ + i.
  - Tracts: men 978, women 1,022.
  - Kinds: hums 811, vowels 1,189.
  - f0 bands: 75–130 Hz 797, 160–300 Hz 822, 130–160 Hz 212, 300–420 Hz 169.
  - Vibrato on 629.
- **The model** is the one in §3.3's table, with these details fixed in the
  file header:
  - glottal source: Rosenberg opening and closing, with an exponential return
    phase;
  - F0 wander: Ornstein–Uhlenbeck, plus a slow sinusoid;
  - vowels: drawn vowel tracts;
  - hums: a drawn nasal pole and zero, upper formants and a lip low-pass;
  - breath noise: high-passed aspiration, gated by the open phase;
  - truth: voiced where the envelope is ≥ −30 dB.
- **Spot check against Praat AC on 8 holds:**
  - voiced coverage 1.00;
  - median |error| 1–11 cents on 7 of them;
  - on the eighth (a female /a/ at 369 Hz), Praat reads half the truth F0.
    The spectrum has no subharmonic energy (−56 dB at f0/2), so the error is
    Praat's.

### Not used, as pre-registered

- VocalSet (an old-harness set, §2.1).
- SingBAP (its participants are on the sealed side, `c_sbi`).
- Any new download for training. Round 5 adds no training person.

## Addendum R5-B part 2 (code) — features, sampler, loss, parity and cost (2026-10-12, before the validity check)

Written **before any round-5 model is trained and before any model has
scored an H row**. Nothing here reads the sealed set, a validation score or
the private session recordings. The only networks run: random-weight networks
for the parity checks and the cost; two code smoke tests of `train_r5.py`
(12 and 6 steps, deleted, never scored); and the three reference networks of
§2.7, whose H probability files were written (`infer_r3.py --groups=hval`)
but **not scored** before this addendum was pushed.

Code: `train/model.py` (cfg `f1m`, `f5`, `bound`; every round-3 / round-4
path unchanged: re-exporting the round-3 and round-4 freezes gives
byte-identical ONNX files, sha256 `1af5a357…979b` and `c10b28f3…84a5`),
`train/train_r5.py` (`train_r4.py` + D7 + §3.4; `train_r4.py` unchanged),
`train/arch_r5.py`, `train/run-r5-train.sh`, `train/calib_r5.py` →
`train/f5const_r5.json`, `train/parity_r5.py`, `train/samplercheck_r5.py`,
`train/opselect_r5.py`, `train/infer_r3.py` (group `hval`), `train/export.py`
(round-5 state names), `r5/selftest_r5.py`.

### B2.1 F1m as implemented (§3.5)

- Per band of the log-mel x_t (natural log, before normalisation):
  - μ₁, v₁: F1's τ = 1 s mean and variance (unchanged);
  - the floor m_t = min(x_t, m_{t−1} + ρ), **ρ = 0.05 dB/s = 1.4391e-4 nat
    per 12.5 ms frame**, m₀ = x₀;
  - w = the τ = 1 s EMA of (x − m)².
- Channels to the first convolution: x, x − μ₁, log(v₁ + ε), x − m,
  log(w + ε); **ε = 1e-3**, **v₀ = w₀ = 1.0** nat² (F1's "not yet known to be
  steady" value).
- **F1's flux EMAs (τ 1 s and 6 s, start 1.0) stay** at the GRU input: §3.5
  replaces F1's τ = 6 s *per-band* statistics, and F5 is fed "next to F1's
  flux EMAs". This reading is fixed here.
- Computation: the floor is first-order recursive with a min, computed as
  m_t = min(m_prev + (t + 1)ρ, min_{s≤t} x_s + (t − s)ρ) — a cumulative min in
  float64 for training / batch inference, a lower-triangular min inside the
  streaming / ONNX graph (ONNX has no CumMin). Input-only, no gradient,
  computed once per training session as F1 (B.8).
- State (ONNX inputs after h): `mv` [1, 4, 64] (μ₁, v₁, m, w), `xprev`
  [1, 64], `fl` [1, 2], `init` [1, 1]; all zero = stream start.

### B2.2 F5 as implemented (§3.5)

- **Spectrum:** the 1,024-point (64 ms) periodic-Hann window ending where the
  mel frame ends (audio context 824 samples; the mel path reads the last 512).
  Computed exactly by a radix-4 polyphase DFT (4 sample phases × one
  256-point DFT convolution, twiddles, Hann applied in frequency); against
  numpy's rfft of the windowed frames: relative error 5.4e-7. (A first
  radix-2 form with dilated convolutions was replaced before any training for
  cost: same spectrum, half the multiply-adds.)
- **Cepstrum:** of L = 10·log₁₀(P + 1e-10) (dB), quefrencies 40–213 samples
  (2.5–13.3 ms). A regression line is fitted over the same range; **CPP** =
  the largest residual above it; its quefrency q is refined parabolically
  (not at the range ends). Inputs: CPP (dB) and ln(q / 16 kHz).
- **Periodic frame:** CPP ≥ **cpp_thr = 0.8114 dB** = the 99th percentile of
  CPP over 400 s of generated Gaussian white noise (`calib_r5.py`; noise
  median 0.55 dB; synthetic harmonic tones at 80–350 Hz read 4.8–6.1 dB with
  their pitch to 0.1 Hz).
- **Micro-variation:** dq_t = |ln q_t − ln q_{t−1}| when frames t and t−1 are
  both periodic, else 0; dE_t = |E_t − E_{t−1}|, E = ln of the power in bins
  4–64 (62.5–1,000 Hz). EMAs τ 0.25 s and 1 s of each, started at **dq0 =
  0.05492** and **de0 = 0.07828** = their means over training voice (300 D7a
  series, 571 records: dq over periodic frame pairs, dE over Praat-positive
  frames; `calib_r5.py`). Inputs: ln(EMA + 1e-4) for dq, ln(EMA + 1e-3) for dE.
- **Envelope:** orthonormal DCT-II coefficients 1–12 of the 64 log-mel bands.
- **Onset history:** the positive flux mean_b max(0, x_t − x_{t−1}); its
  decaying maxima for τ 3 s and 30 s, started at 0; inputs ln(o + 1e-3).
  Float64 log-domain cumulative max in batch, lower-triangular max in ONNX.
- **20 F5 inputs** join the flux EMAs at the GRU input (one BatchNorm over
  the 22). State `f5s` [1, 9] (ln q, periodic, E, 2 + 2 EMAs, 2 maxima).
- Window 64 ms ≤ 82 ms: `frame_ms` stays 82.

### B2.3 Bound as implemented (§3.5; used only if §3.6's rule picks it)

- Local head: Linear(fc 64 + the 20 normalised F5 inputs → 32), ReLU,
  Linear(32 → 1) = l_loc; final logit l = max(l_gru, l_loc − 4); auxiliary
  BCE on l_loc with the same frame weights, weight 0.5.

### B2.4 Sizes, parity, cost

| architecture | parameters | ONNX bytes | WASM ms per 25 ms (Node, ORT-web 1.30.0, 1 thread; loaded machine) |
|---|---|---|---|
| F1 (round 4's network) | 91,213 | 1,516,974 | 1.88 / 1.81 |
| F1m | 91,213 | 1,516,940 | 1.89 |
| F1m + F5 | 97,013 | 2,228,796 | 3.90 / 3.71 |
| F1m + F5 + Bound | 99,766 | 2,241,261 | 3.95 |

- **Parity** (`parity_r5.py`, random-weight networks, a generated 40 s
  stream): the floor and onset recursions, both forms, vs a naive per-frame
  loop ≤ 4.8e-7; the round-5 raw inputs, chunks of 1 / 2 / 37 / 700 frames
  with the state carried vs the whole stream ≤ 4.4e-4 (log of small
  variances); probabilities, torch streaming (chunks 1, 2, 8, 700) vs batch
  ≤ 1.8e-7; exported streaming ONNX (dynamic chunk 1, 2, 8) vs batch ≤ 7.2e-7.
- **Cost.** All four measured in one session, but the shared machine was at
  100 % CPU from other work: round 4's F1 network measured 0.56 ms there in
  round 4 and 1.8–1.9 ms now. The **order** is what the tie-break of §4 uses:
  F1 ≈ F1m < F1m + F5 ≈ F1m + F5 + Bound (F5 about 2.0–2.1×). V4 (≤ 2 ms) is
  measured again on the frozen point; if the load is still high, the
  measurement conditions are stated with it.

### B2.5 D7 and the loss in the sampler (§3.3, §3.4)

- **Hold sessions:** with p 0.35 a one-room training session is a hold
  session. Episodes are whole D7 items, each D7a or D7b with p 0.5, truncated
  at the session end; D7a series are drawn by duration (equal hours per sex),
  their records joined with breath gaps U(0.5, 3) s; D7b holds uniformly.
  Lead U(0, 30) s, pauses from round 4's set, 35–65 % voice (≤ 50 draws), 64–
  256 s. Bed: the steady pools (`stat`, `synth_r4` = D4, `fsr4`) with
  relative D5 weights 0.28 : 0.18 : 0.10 with p 0.8, else the D5 draw (D6
  marks as round 4). SNR U(−3, +25) dB; clean with p 0.2.
- **D7 crops:** with p 0.15 a voice crop (mix or clean) comes from a D7 item
  (D7a / D7b p 0.5, any offset). Everything else is drawn as round 4.
- **Labels:** D7a from the records' Praat labels; D7b positive where its
  truth is voiced, with tcommon's 2-frame boundary margins masked.
- **Tail weight:** positive frames at t ≥ 10 s in episodes ≥ 10 s get weight
  max(w, 3). Positive frames already have weight 3 (`--wpos`), so **this
  term changes no weight**. It is implemented as written; the decay penalty
  is the active term.
- **Decay penalty:** p̄₀ = mean p over the episode's *positive* frames in
  [0.5, 5) s (detached, sums carried across the 8 s TBPTT chunks per
  session slot); L_dec = mean over all positive frames at t ≥ 5 s of the
  step's hold-session episodes ≥ 10 s of relu(p̄₀ − p_t); loss + 1.0 · L_dec.
  Times follow the speed perturbation's frame warp (onset = the episode's
  first frame after the warp).
- **Sampler check** (`samplercheck_r5.py`, 60 hold sessions, training data):
  length 65–253 s, voice fraction 0.37–0.65, 2.85 episodes per session, 88 %
  of them ≥ 10 s; D7 items 106 D7a / 94 D7b; in all 169 items with both label
  kinds, positive frames are louder than negative ones; D7 share of voice
  crops 13.7 % (3,000 draws; nominal 15 %).
- **Refusals:** `train_r5.py` refuses `r5/hval` and `r3/conf` on every bank
  and list it opens; `selftest_r5.py` checks that and still finds no training
  or packing script importing the validation generators (the selection-side
  scripts `infer_r3.py` and `opselect_r5.py` read the H rows by design and
  are listed as such).

### B2.6 Runs and selection as implemented (§3.6, §4)

- `run-r5-train.sh NAME`: round 4's recipe and arguments (D1–D6, sessions
  64–256 s, EMA 0.999, 16,000 steps, checkpoints every 1,000) plus
  `--p_hold=0.35 --p_d7crop=0.15 --lam_dec=1.0`. Runs `r11-data` (F1, seed
  51), `r11-floor` (F1m, 52), `r11-harm` (F1m + F5, 53); run 4 (seed 54) by
  §3.6's rule, recorded in an addendum before it starts.
- **Selection files:** `infer_r3.py --groups=fresh,vsess,spl,hval
  --variants=plain` (GPU, TF32 off, state carried).
- **The rule:** `opselect_r5.py` = `opselect_r3.py`'s readings, feasibility,
  O and within-candidate pick, plus:
  - H1: per sex × condition × voice kind, CORRECT hops in the sex's band;
  - H2: per sex × condition × {synthetic, real}, every 10-s bin (as
    `hval.py counts`: bins 0, 1, … and the hold's last 10 s); a bin under 400
    current-app CORRECT hops joins the bin before it (fixed from the dumps,
    no model); last ≤ first + 1 pp;
  - a self-test of the H readings against score.py's `hop_probs` /
    `voice_flags` at four grid points.
- **Reference rows:** `custom-vd-r3` and `custom-vd-r4` from their rounds'
  selection files plus new H files written next to them; `r10-data-e16000`
  (diagnostic, §2.7) the same way.

## Addendum R5-B part 3 — the validity check (§2.7), before training (2026-10-12)

Written after part 2 (code) was pushed (68d0729) and **before any round-5
training run starts**. Scored: the three reference networks at their points
on H1–H3 (validation data only; `opselect_r5.py --point`, probability files
from `infer_r3.py --groups=hval`, GPU torch, TF32 off, state carried from
each stream's start):

- `custom-vd-r4` (r10-notch step 8,000; mean, p ≥ 0.10, 300 ms);
- `custom-vd-r3` (r9-sess-b step 8,000; mean, p ≥ 0.30, 600 ms);
- `r10-data-e16000` (round 4's best log-mel network, no F1; its round-4 pick:
  max, p ≥ 0.30, 2,000 ms) — diagnostic.

Checks first:

- The H readings agree with score.py's `hop_probs` / `voice_flags` at four
  grid points (`opselect_r5.py --selftest`: 0 mismatches).
- On the unchanged round-4 rows the three points reproduce their round-3 /
  round-4 entries: feasible, O = 69.30 / 51.93 / 62.72 %.
- H2 bin merging (§2.5, from the current-app dumps): only the real-series
  tail bins merge (men from 130 s, women from 80–90 s), as part 1 said.

**H1** (veto % of in-band CORRECT hops; limit 0.5 clean / 1.5 bed; ✗ = over the limit)

| cell | custom-vd-r4 | custom-vd-r3 | r10-data-e16000 |
|---|---|---|---|
| men real clean | 0.00 | 0.00 | 0.00 |
| men real snr+20 | 0.15 | 0.82 | 0.00 |
| men real snr+10 | 0.19 | 0.45 | 0.01 |
| men real snr+0 | 1.96 ✗ | 0.07 | 0.11 |
| men syn_vowel clean | 0.00 | 0.00 | 0.00 |
| men syn_vowel snr+20 | 5.19 ✗ | 0.00 | 0.91 |
| men syn_vowel snr+10 | 7.28 ✗ | 7.12 ✗ | 12.02 ✗ |
| men syn_vowel snr+0 | 25.28 ✗ | 30.14 ✗ | 40.23 ✗ |
| men syn_hum clean | 9.08 ✗ | 0.00 | 0.44 |
| men syn_hum snr+20 | 18.37 ✗ | 0.73 | 2.40 ✗ |
| men syn_hum snr+10 | 27.79 ✗ | 8.54 ✗ | 9.05 ✗ |
| men syn_hum snr+0 | 21.64 ✗ | 12.36 ✗ | 15.93 ✗ |
| women real clean | 0.00 | 0.00 | 0.02 |
| women real snr+20 | 0.04 | 0.01 | 0.01 |
| women real snr+10 | 0.01 | 0.01 | 0.02 |
| women real snr+0 | 0.29 | 0.63 | 0.55 |
| women syn_vowel clean | 0.00 | 0.00 | 0.00 |
| women syn_vowel snr+20 | 0.00 | 0.00 | 0.00 |
| women syn_vowel snr+10 | 0.00 | 0.00 | 0.88 |
| women syn_vowel snr+0 | 0.82 | 1.38 | 5.51 ✗ |
| women syn_hum clean | 0.00 | 0.00 | 0.00 |
| women syn_hum snr+20 | 0.00 | 0.00 | 0.00 |
| women syn_hum snr+10 | 0.00 | 0.02 | 0.00 |
| women syn_hum snr+0 | 2.31 ✗ | 4.46 ✗ | 4.94 ✗ |

**H2** (every CORRECT hop; worst 10-s bin / first 10 s / last 10 s, veto %; ✗ = a bin over the limit or last > first + 1 pp)

| cell | custom-vd-r4 | custom-vd-r3 | r10-data-e16000 |
|---|---|---|---|
| men syn clean | 64.05 / 0.70 / 36.68 ✗ | 0.00 / 0.00 / 0.00 | 64.05 / 0.00 / 18.99 ✗ |
| men syn snr+20 | 65.53 / 3.46 / 54.96 ✗ | 0.01 / 0.01 / 0.00 | 29.48 / 2.20 / 19.61 ✗ |
| men syn snr+10 | 76.98 / 20.35 / 70.22 ✗ | 27.24 / 6.07 / 17.33 ✗ | 33.52 / 3.39 / 32.67 ✗ |
| men syn snr+0 | 95.11 / 24.12 / 83.49 ✗ | 36.82 / 8.39 / 29.87 ✗ | 86.32 / 8.01 / 71.14 ✗ |
| men real clean | 0.78 / 0.01 / 0.47 ✗ | 0.03 / 0.00 / 0.00 | 1.08 / 0.01 / 0.08 ✗ |
| men real snr+10 | 0.42 / 0.02 / 0.00 | 2.39 / 0.85 / 0.84 ✗ | 2.35 / 0.00 / 0.70 ✗ |
| men real snr+0 | 4.95 / 2.69 / 2.66 ✗ | 5.27 / 3.60 / 4.16 ✗ | 8.38 / 1.93 / 8.38 ✗ |
| women syn clean | 2.51 / 0.56 / 0.32 ✗ | 0.00 / 0.00 / 0.00 | 0.00 / 0.00 / 0.00 |
| women syn snr+20 | 23.03 / 0.00 / 20.35 ✗ | 0.00 / 0.00 / 0.00 | 11.50 / 0.00 / 11.50 ✗ |
| women syn snr+10 | 55.82 / 0.00 / 31.30 ✗ | 2.56 / 0.02 / 0.45 ✗ | 29.97 / 0.77 / 29.06 ✗ |
| women syn snr+0 | 49.33 / 6.08 / 49.33 ✗ | 6.73 / 6.73 / 5.76 ✗ | 78.32 / 5.87 / 78.32 ✗ |
| women real clean | 0.07 / 0.00 / 0.01 | 0.00 / 0.00 / 0.00 | 0.11 / 0.00 / 0.00 |
| women real snr+10 | 0.11 / 0.00 / 0.00 | 0.10 / 0.00 / 0.00 | 1.20 / 0.00 / 1.20 ✗ |
| women real snr+0 | 0.67 / 0.00 / 0.07 | 0.78 / 0.29 / 0.78 | 0.76 / 0.29 / 0.00 |

**H3** (reported; one-room validation sessions, speech rows, veto %)

| row | custom-vd-r4 | custom-vd-r3 | r10-data-e16000 |
|---|---|---|---|
| speech, men, clean | 0.00 | 0.00 | 0.00 |
| speech, men, +10 dB | 0.02 | 0.02 | 0.00 |
| speech, men, +0 dB | 0.02 | 0.01 | 0.03 |
| speech, women, clean | 0.00 | 0.00 | 0.00 |
| speech, women, +10 dB | 0.01 | 0.02 | 0.00 |
| speech, women, +0 dB | 0.09 | 0.06 | 0.04 |

custom-vd-r4: H feasible False, fails 64, round-4 rows feasible True, O 69.30 · custom-vd-r3: H feasible False, fails 29, round-4 rows feasible True, O 51.93 · r10-data-e16000: H feasible False, fails 63, round-4 rows feasible True, O 62.72

**Result.**

- **`custom-vd-r4` fails the new rows, as expected** (64 failing readings):
  male H1 machine cells (synthetic hums 18–28 % vetoed at +20 / +10 dB, 9 %
  even clean; synthetic vowels 5–25 %; real vowels at 0 dB 2 %), and H2 in
  both sexes (male synthetic holds: last 10 s 37 % vetoed clean, 55–83 % with
  a bed, against 0.7–24 % in the first 10 s). The rows reproduce the review's
  two HIGH failures; §2.7's stop condition does not apply, and round 5
  proceeds to training.
- **The decay is not F1's alone.** `r10-data-e16000` (round 4's data, no F1)
  shows the same growth over a hold (male synthetic holds, clean: 0.0 % in
  the first 10 s, 19 % in the last; women at +20 dB 0 → 11.5 %). The round-4
  training data are enough to produce it.
- **`custom-vd-r3` fails the new bar too** (29 readings), but only at +10 and
  0 dB: synthetic male vowels and hums 7–30 %, women's synthetic hums at 0 dB
  4.5 %, H2 male synthetic holds at +10 / 0 dB with growth (6 → 17 %, 8 →
  30 %), and real male series at 0 dB (3.6–5.3 %). Clean and +20 dB pass.
  So the new rows ask for more than any earlier round delivered: **the 0 dB
  and +10 dB synthetic cells may be out of reach for every round-5 candidate.**
  The bar is not changed (§2.7: "the rows are not changed"); if no candidate
  is feasible, §4 applies (no freeze, no look, the table goes to the user).
- **H3 (reported):** the round-4 medium finding (female speech 15.5 % vetoed
  at 0 dB in VocalSet sessions) does not appear in the validation one-room
  sessions: speech rows ≤ 0.09 % for all three networks, both sexes.

## Addendum R5-C — runs 1–3 and the run-4 decision (2026-10-12, before run 4 starts)

Runs 1–3 trained as B2.6 (`run-r5-train.sh`, 16,000 steps each, no crash or
resume; a governor paused the jobs at times under other load). Their 21 EMA
checkpoints were scored by §4's rule (`opselect_r5.py`, validation data only),
in the same rule runs as the two reference rows. Notes:

- The selection inputs were re-hashed first: round 4's 18,610 files and the
  8,198 H files, 0 mismatches (`r5/verify_inputs.py`).
- `r11-harm`'s files were made with a smaller GPU frame budget per batch
  (`infer_r3.py --budget=40000`; runs 1–2: the default 300,000): F5's batch
  spectrum did not fit next to the other GPU work at the default. Only the
  chunking differs (state carried; float rounding only).
- Reference rows: `custom-vd-r4` has **no** feasible point under the extended
  bar (round-4 rows alone: 229 feasible points); `custom-vd-r3` is feasible
  only at mean, p ≥ 0.01, 50 ms, O = 5.48 %.

**Best feasible point per run** (extended bar; torch files; the last column is
the best O on round 4's rows alone, reported):

| run | step | pick (agg / p / hangover) | O % | val-negatives V2 % | one-room sessions V2 % | same checkpoint, best O on round-4 rows only % |
|---|---|---|---|---|---|---|
| `r11-data` | 16,000 | mean / 0.05 / 3000 ms | 10.15 | 20.98 | 39.50 | 53.32 |
| `r11-floor` | 10,000 | mean / 0.05 / 200 ms | 12.21 | 28.18 | 37.52 | 34.02 |
| `r11-harm` | 10,000 | mean / 0.05 / 200 ms | 31.22 | 45.84 | 56.66 | 44.29 |

- 20 of the 21 checkpoints have a feasible point (`r11-data-e12000` has
  none), but only at low thresholds: the best O is **31.22 %**
  (`r11-harm-e10000`), far under the go bar of 60 %.
- Even on round 4's rows alone, the round-5 runs reach at most 53.3 % (round
  4's best: 69.3 %): the D7 training costs steady-noise removal.
- A reported diagnostic (`hbind_r5.py`, not in the rule) on runs 1–2: setting
  aside the 0 dB and +10 dB readings, or the men's readings, restores most of
  each checkpoint's round-4-rows O; the men's synthetic hums and vowels next
  to machines and the men's synthetic long holds are what bind.

**The run-4 rule (§3.6).** At least one checkpoint of runs 1–3 has a feasible
point, so run 4 is a **second seed (54) of the best such candidate's feature
set**. The best is `r11-harm-e10000` (O 31.22 %); no other checkpoint is
within 1 pp (next: `r11-harm-e12000`, 27.06 %), so no tie-break is needed.
**Run 4 = `r11-harm-s54`: F1m + F5, seed 54**, everything else as runs 1–3.
Bound is not trained.
