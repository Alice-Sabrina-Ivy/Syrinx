# Custom voice-vs-machine detector — round 6, Addendum R6-A: the Data step (2026-10-13)

Branch `voice-detector`. Pre-registration:
[voice-detector-round6-preregistration-2026-10-13.md](voice-detector-round6-preregistration-2026-10-13.md)
(038a4a2, sha256 `6ba57941…d2508`). Code:
[scripts/voice-detector/r6/](../scripts/voice-detector/r6/README.md).

This addendum records the round-6 Data step. It is a separate file, hashed
into the round-6 hash log when written and never edited (pre-registration
"Hash log"). Every time below is from that log.

**What was done, in order:**

1. the §1.2 checks, blind, before any round-6 data existed (R6-A.1, R6-A.2);
2. the validation generators ported unchanged and checked bit for bit
   against the review files (R6-A.3);
3. the construction constants fixed in code and hashed **before any new-row
   stream was rendered** (R6-A.4);
4. the new rows H4–H8 and the review probe streams rendered, run once through
   the current app's chain, counted per sex for the size rules, and hashed
   (R6-A.5 to R6-A.8).

**What was not done** (R6-A.9): no model of any round ran on anything; no
training data was built; the validity check (§2.12) and the shared selection
code are left to the step that writes Addendum R6-B. The sealed set was not
read beyond the seal checks and the sealed matcher's keep / drop answers; the
private session recordings were not read; nothing under `src/` changed.

## R6-A.1 The seal checks (§1.2 items 1–3), blind, before any round-6 data

The seal, audit and training-side checks ran 04:24–04:27; items 4 and 5
(R6-A.2) ran 04:37–04:46. All outputs were hashed at 04:47:10 (tag
`r6a-checks`), before any round-6 stream existed. Outputs: `build/vad-train/r6/checks/` (gitignored).

| check | result |
|---|---|
| `seal.py verify --tag=r5` (60,008 lines, seal sha256 `6dcbbe5f…2f44`) | **0 mismatches** |
| `seal.py verify-r4 --tag=r5` (round 4's seal minus the round-5 changes) | 47,773 paths, **0 mismatches** |
| `seal.py verify-r3 --tag=r5` (round 3's seal minus the round-4 and round-5 changes) | 47,738 paths, **0 mismatches** |
| `r4/audit_exclusions.py --selftest` | PASS |
| `r4/audit_exclusions.py` | **0 kept violations**; output identical to round 5's (`r5/audit-exclusions.json`, sha256 `4bc1ab1b…829d`): A — 1 violation, `c_fsv__716881`, already dropped; B — 7 rounds 1–2 records touch the sealed set, 0 kept. The script writes into `r4/audit-exclusions.json`; that file was restored to its round-4 content afterwards (sha256 `9426462d…7860`), as round 5 did |
| `train_side.py build` | `train_exclude.json` **byte-identical** to `9dea5dcf…e670` |
| `train_side.py check` | 0 kept rounds 1–2 records touch the sealed set (the same 7 dropped QuartzGate clips) |
| `conf-manifest.jsonl` | sha256 `663e381b…2438`, unchanged |

No mismatch, so round 6 continued. No search was resumed (item 6).

## R6-A.2 Items 4 and 5: no new training person; new validation material disjoint

`r6/disjoint_r6.py` (run with `python -I`; hashed with its outputs at
04:47:10).

**Item 4.** Round 6 starts from these training lists, unchanged: `r4/d1.json`
(36,898 `train_ids`, sha256 `b96f0d18…59dc`, built against `train_exclude`
`9dea5dcf…e670`), `r5/d7a.json` (`45a07a97…c9712`), the D7b bank
`train/vsynth_r5_train.npz` (`c6d95b4c…d4c`). **No round-6 training item
exists** (R6-A.9), so no new training person was added.

**Item 5.** Every real source that becomes a round-6 validation row for the
first time:

| material | items | removed | kept |
|---|---|---|---|
| fsnew (the round-4 review's kept unseen Freesound clips) | 20 | 0 | **20** |
| VocalSet takes of the round-5 review's `sess5` sessions (all takes of the six techniques it uses) and of the round-3 review's one-room sessions (first take per technique) | 780 | 1 | 779 |
| real beds of the round-3 review's sessions (benchmark tuning-split clips) | 5 | 1 | 4 |

- **Ids and uploaders / people** (case-insensitive) against `exclude.json`,
  `train_exclude.json` and `r4/d1.json`: no fsnew id or uploader matched any
  of them. No VocalSet singer is on the sealed side or in training. All 20
  singers are in `exclude.json`'s `bench_vocalset`: that is the old harness,
  which the masking rule of §2.2 handles. The five tuning beds are in
  `exclude.json` as benchmark clips, as expected.
- **Sealed set:** the sealed matcher answered **keep for all 805 items**.
- **Earlier audio (r3/fp, 56,305 clips):** no fsnew clip matched. The
  VocalSet takes and tuning beds match their own earlier non-training copies:
  the review downloads, the round-1 review's level, EQ and PSOLA copies of
  the same singer's takes, the harness long tones, and the benchmark file of
  the same clip. Those hits are recorded as "own-corpus" (374 items) and do
  not remove a clip: none is training data or sealed data, and the
  pre-registration names these sources as validation material (§2.2, §8.1).
  The rule, stated in the script before the second run, is:
  - an own-corpus hit is a `probe:` or harness item of the **same singer**,
    or of the **same clip**;
  - a hit on rounds 1–2 data (`data:`), on another singer, or on another
    source removes the clip.
- **Removed by the rule:**
  - `vocalset:female6/scales/lip_trill/f6_scales_lip_trill_o.wav` (in
    `sess5`) matched a level copy of **another singer's** lip trill
    (female3, telephone EQ) at BER 0.349, just under the 0.35 limit. Its
    hops are masked in every `sess5` session of that singer (6 episodes).
  - the tuning bed `116866` matched a **different** benchmark clip
    (`freesound__refrigerator__116865`, BER 0.074). The four round-3 review
    sessions that use it as their bed leave validation:
    `female2` +10 dB, `female7` 0 dB, `male11` +10 dB, `male6` 0 dB.
- **Disclosure:** a first run used a narrower own-copy rule (file name only).
  It flagged 158 items, all of them hits on the same singer's review copies
  or the same clip's review copy. That output is kept and hashed as
  `checks/disjoint.v1-narrow-identity.json`. Before the second run, the rule
  was widened to the one above. This was a defect in the checker; no
  validation number was involved.

## R6-A.3 The validation generators (§2.2), ported unchanged

All in `scripts/voice-detector/r6/`, VALIDATION ONLY:

| module | from (the review file) | what differs |
|---|---|---|
| `lfsynth_val.py` | round-5 review `lfsynth.py` (sha256 `3993f148…a684`) | header only |
| `mach5_val.py` | round-5 review `mach5.py` (`e11e766a…3703`) | header only |
| `micsim_val.py` | round-5 review `screen5.py` (`026c3c1d…d34d`) lines 40–87: `peak_eq`, `phone_eq`, `phone2` (300 Hz high-pass phone, AGC on / off), `agc_only` | header and imports |
| `probes5_val.py` | `screen5.py` `specs()` / `make()` (screens S1, S1b, S2, S2b, S3, S4) | `specs()` takes the screen name as an argument; the scoring code is not ported |
| `sess5_val.py` | round-5 review `build_sess5.py` (`bb275be2…0a90`) | module names (`mach5_val`, `micsim_val` in place of `screen5_eq.py`, whose functions are identical), output folder |
| `sess3_val.py` | round-3 review `build_sess.py` (`436579bf…08d2`) | `r5/vbeds.bed3` in place of the review's `beds.py` (the same functions, ported in round 5), input root written out, output folder |

**Bit-exact checks** (04:58–05:11):

- `lfsynth_val.synth` on 3 settings, `mach5_val.bed` on all 6 synthetic kinds
  and 2 real clips, and all 4 microphone functions are identical to the
  review modules' outputs.
- `probes5_val.make` re-renders the review's saved chain-confirmed subsets
  **x1 (80 S1 streams), x3 (40 S3), x4 (48 S4)** sample for sample, with the
  same truth tracks.
- `sess5_val` re-renders all **60 `sess5` sessions** and `sess3_val` all
  **60 round-3 review sessions** bit for bit: the same samples, references
  and metadata as the reviews' saved files.

`selftest_r6.py` (PASS) pins the output digests of the three ported
generator modules, which were taken from the review files. It also checks:

- that no training script (35 under `train/`, plus `r5/d7.py`) imports a validation
  generator or names a validation folder (`r6a/` and `r6b/` do not exist
  yet; they will be scanned once they do);
- that the validation seeds stay in [5·10⁹, 7·10⁹), below both tracks'
  training seeds (7·10⁹ +);
- the buzz rule and the corrected topic rule;
- the bin merge rule.

## R6-A.4 Construction details, fixed before any new-row stream was rendered

Fixed in `hval6.py` / `hcells.py`. Both files, the ported generators,
`selftest_r6.py` and the bed lists (`beds.json`) were hashed at **05:06:42**
(tag `r6a-code`). The first new-row stream was rendered after that. §2.3 says
the per-row seed offsets are "fixed in R6-B before any rendering"; R6-B is
written only after the validity check (§9.1), so they are fixed in the code
hashed at 05:06:42 and reported here.

Two runs came before that hash, both disclosed:

- A dry run at 04:55–04:58 rendered 43 sample streams into a scratch folder
  with the same code, to test it. Those files are not part of the rows.
- The two review-session builders ran 04:59–05:10. They carry no round-6
  constant: their outputs are the reviews' own files, bit for bit.

**Seeds** (§2.3):

| what | value |
|---|---|
| construction (level, floor) | (20261013, FNV-1a(stream id)) |
| bed-class rotation | 20261014 (a seeded permutation per stream group) |
| lead | 60 s when FNV-1a(`"r6lead:" + id`) mod 3 = 2, else 20 s (H6c: fixed 30 s; H8: the `r3/vsess` 30 s lead) |
| `vsynth_val` / `lfsynth_val` voices | 5·10⁹ + 1,000,000 / + 2,000,000, + row offset + k |
| voice row offsets | H4 men 0, women 10,000; H5 20,000 / 30,000; H6a 40,000 / 50,000 (+ 1,000 × exercise index); H6b 60,000 / 70,000; H6c 80,000 / 90,000 |
| synthetic beds | 6·10⁹ + 1,000,000 + row offset (H4 0, H5 100,000, H6a 200,000, H6b 300,000, H6c 400,000, H8 600,000) + sex (men 0, women 50,000) + source (real 0, `vsynth` 10,000, `lfsynth` 20,000) + 2,000 × exercise index + 4k + condition index |
| sessions | H6c: 20261013·1000 + 100 (+ 50 women) + k; H8: 20261013·1000 + 600 (+ 100 women) + j |

**Beds** (§2.2):

- **Classes:** air 50, fridge 11, mains 15, motor 33 real clips (round 5's
  109 val beds), and **buzz 25**.
  - The buzz real clips are round 5's 15 mains-class beds plus the **10 fsnew
    clips** that match the buzz rule: 144046, 201788, 466429, 653967, 668617,
    735113, 830089, 848181, 851426, 860297.
  - The buzz synthetic kinds are `vbeds` mains and `xfmr50`, plus the
    `mach5_val` microwave, ballast, aquarium pump, two beating fans and
    washer.
  - fsnew clips that do not match the buzz rule appear only inside the
    review probe streams.
- **Choosing a bed:** each stream's bed is a fixed function of its group (row
  × sex × source, × exercise for H6a) and its index in that group, so growth
  never moves an earlier stream.
  - The class cycles through a seeded permutation: buzz only for H4 and H5;
    all five classes for H6a, H6b, H6c and H8.
  - Within a class, real and synthetic beds alternate.
  - Real beds are looped with 1 s cross-fades.
- **Machine kind** (for the H4 kind row): the synthetic generator kind, or
  the real clip's id. A kind under 400 hops merges into its class.

**Voices and conditions**:

| row | voices per sex | conditions | microphone |
|---|---|---|---|
| H4 | the H1 real pool (100); `vsynth_val` 60 + `lfsynth_val` 60: 15 s holds, kind hum / a / hum / o, quality modal / soft / breathy (+ pressed for `lfsynth_val`), vibrato when k mod 8 ∈ {1, 6}, wander U(6, 40) cents, f0 log-uniform in 75–100 Hz (men) / 160–200 Hz (women) for even k and in the full band (75–130 / 160–300 Hz) for odd k | 0, +10 dB, buzz beds | flat / phone EQ, alternating |
| H5 | the H2 real series (men 60, women 36; series with 2 s gaps); `vsynth_val` 24 + `lfsynth_val` 24: 90 / 120 s, hum / a, modal / soft, vibrato on a quarter, wander U(3, 12) cents, half the holds from the low band, half from the full band | clean, +10, 0 dB, buzz beds | AGC alone / 300 Hz phone + AGC, alternating (every stream has AGC) |
| H6a | 5 exercises × 2 synthesizers × 8: lip trill, tongue trill, straw, hummed siren, vowel slide by the review's S3 recipe; the lower f0 drawn log-uniform in 75–100 / 160–200 Hz, siren top 260 / 380 Hz; on `vsynth_val` the sirens use its own up-down glide, three 4 s glides with 1 s gaps | clean, +10, 0 dB, all classes | flat |
| H6b | 2 synthesizers × 12: six 18 s holds with 2.5 s breaths (S2b recipe; on `vsynth_val` six separate holds with the same f0); hum / a, modal / soft, vibrato (5.4 Hz, 45 cents) on a quarter, wander 8 cents | clean, +10, 0 dB, all classes | flat |
| H6c | 6 synthetic sessions (`vsynth_val` / `lfsynth_val` alternating; one f0 centre; episodes drawn from holds, hums, repeated holds, lip / tongue trills, straw, sirens, slides) + 6 real sessions (one H2 participant's vowels, cycled); 600 s, 30 s lead, pauses {1, 3, 8, 20} s, voice fraction 35–65 % | clean, +10, 0 dB, all classes | flat / phone EQ / phone + AGC by session |
| H8 | 40 voice groups: men Coswara 12, LibriSpeech 12, SVD 11, VCTK 5; women Coswara 11, LibriSpeech 11, SVD 10, VCTK 8; 300 s `r3/vsess` sessions | +10 / 0 dB alternating; bed on at U(60, 150) s with a 0.5 s fade-in; in half the sessions of each sex × SNR it goes off 120 s later (0.5 s fade-out) | none |

Synthetic voices are rendered at 48, 44.1 and 16 kHz in turn; real voices at
their native rate. H7 has no stream of its own (§2.7):

- H7a reads the lip-trill takes of `sess3` and `sess5`;
- H7b reads the H6a lip-trill streams and the lip-trill episodes of H6c;
- H7c is **empty**: none of the 17 `fsvoice` val clips matches the round-4
  trill pattern (their metadata are humming, scales, singing and talking).

**Masks** (§2.2): in `sess5`, every hop within 0.5 s of a take from the old
harness's 399 long tones (the `long_tones/straight` takes, 300 episodes) or of
the removed take (6 episodes) is never read. `sess3` has no harness take.

**Cells** (`hcells.py`):

- **H4:** band-filtered (men 75–130 Hz, women 160–300 Hz of the hop's
  reference F0). Kept separately: the 0 dB low sub-band (75–100 / 160–200 Hz)
  pooled over the new streams and S1, and each machine kind pooled over 0 and
  +10 dB and S1.
- **H5, H6b and the S2 / S2b / S4 probes:** 10-s bins of time since the hold
  or series onset, with "last" = each hold's last 10 s. A bin under 400 hops
  merges with the bin before it.
- **S3 and S4:** read per the review's own conditions.
- **H6c:** whole session, 60-s bins of session time, the first 120 s after
  the lead, and the last 120 s of voice.
- **H8:** before switch-on, on, the first 60 s after switch-on, after
  switch-off.

## R6-A.5 The rows as built

Rendered 05:07–05:55, 3 processes, by `hval6.py build`. New rows are 16-bit
WAV; the probe screens and the review sessions are float WAV, as the reviews
wrote them.

| set | row | streams (men / women) | hours (men / women) |
|---|---|---|---|
| `h4` | H4 new | 440 / 440 | 6.59 / 6.72 |
| `s1` | H4: the review's S1 | 740 / 592 | 7.40 / 5.92 |
| `s1b` | H4: the review's S1b | 180 / 144 | 1.80 / 1.44 |
| `h5` | H5 new | 324 / 252 | 10.69 / 8.85 |
| `s4` | H5: the review's S4 | 96 / 96 | 3.76 / 3.76 |
| `s2` | H5: the review's S2 | 96 / 64 | 3.36 / 2.24 |
| `h6a` | H6a new (also H7b) | 240 / 240 | 3.60 / 3.54 |
| `s3` | H6a: the review's S3 | 60 / 60 | 0.62 / 0.62 |
| `h6b` | H6b new | 72 / 72 | 3.18 / 3.19 |
| `s2b` | H6b: the review's S2b | 48 / 32 | 1.89 / 1.26 |
| `h6c` | H6c new (also H7b) | 36 / 36 | 6.00 / 6.00 |
| `sess5` | H7a: the round-5 review's sessions | 33 / 27 | 5.50 / 4.50 |
| `sess3` | H7a: the round-3 review's sessions (4 left validation, R6-A.2) | 31 / 25 | 5.17 / 4.17 |
| `h8` | H8 new | 40 / 40 | 3.33 / 3.33 |
| **all** | | **2,436 / 2,120** (4,556) | **118.4 h** |

The review's chain-confirmed subsets x1, x3 and x4 are subsets of S1, S3 and
S4 here; they are not a separate set. Audio is about 50 GB, under
`build/vad-train/r6/hval/` (gitignored).

## R6-A.6 The current-app dumps (labels)

- Every stream ran once through the current app's production chain:
  `train/valdump.mjs`, `--src=src`.
- This checkout's `src` tree is `6a1bd785…`, identical to dd92037's, as in
  rounds 3–5.
- 05:44–07:44, 3 node processes. 4,556 streams, 0 failures.
- Hop labels are CORRECT / FALSE / WRONG / EDGE as `dump.mjs` assigns them.
- References:
  - synthetic voices: the synthesizer's truth;
  - real voices: the gated Praat AC tracks (r5 `praat/`, rounds 1–2 `f0_path`);
  - review sessions: the reviews' own Praat tracks.

## R6-A.7 Size rules (§2.10): CORRECT hops per gating cell, per sex

`hval6.py counts --grow` reads only the current app's aggregate counts
(`hcells.py` cells) and writes `counts.json`. There are 1,464 gating keys and
344 reported keys. **Sexes are never pooled.**

**No synthetic cell was under 400, so nothing was grown.** The plan stays at
its base counts: H4 60 + 60, H5 24 + 24, H6a 8 per exercise and synthesizer,
H6b 12 + 12, H6c 6 synthetic + 6 real sessions, per sex.

Smallest cell per row and sex (after the bin merge rule):

| row | men: cells, smallest (where) | women: cells, smallest (where) |
|---|---|---|
| H4 per SNR × source | 6, 20,390 (0 dB real) | 6, 16,202 (0 dB real) |
| H4 S1 per SNR / clean | 4, 11,920 (clean) | 4, 9,536 (clean) |
| H4 S1b per microphone | 3, 32,046 (16 kHz) | 3, 22,750 (16 kHz) |
| H4 machine kind (35 kinds: 8 synthetic, 27 real clips; see the naming note below) | 35, 1,039 | 35, 974 |
| H4 0 dB low sub-band (75–100 / 160–200 Hz) | 75,203 | 49,880 |
| H5 10-s bins (new; real and synthetic) | 114, 459 (real, 0 dB, 80–90 s) | 101, 937 (real, +10 dB, 70–80 s) |
| H5 S4 bins | 192, 642 | 192, 781 |
| H5 S2 bins | 192, 570 | 180, **388** (see below) |
| H6a per exercise × condition | 15, 4,009 (tongue trill 0 dB) | 15, 3,572 (hummed siren 0 dB) |
| H6a S3 per condition | 6, 2,142 | 6, 2,264 |
| H6b 10-s bins | 39, 3,013 | 39, 4,186 |
| H6b S2b bins | 52, 1,765 | 52, 1,037 |
| H6c whole / first 120 s / last 120 s | 9, 16,146 | 9, 12,975 |
| H6c 60-s bins | 30, 4,474 | 30, 2,903 |
| H7a lip-trill takes (sess3, sess5 × condition) | 6, 1,172 (sess3 0 dB) | 6, **329** (sess3 0 dB) |
| H7b synthetic lip trills | 3, 9,072 | 3, 8,927 |
| H8 periods × SNR | 8, 5,226 (after, 0 dB) | 8, 4,103 (first 60 s, 0 dB) |

**Cells that cannot be evaluated** (real or review-probe cells, not grown;
§2.10, listed here and again in R6-B before training):

1. **H7a, women, round-3 review sessions, 0 dB: 329 CORRECT hops.** This is
   the session set of the round-5 review's women's lip-trill finding (717
   hops). The cell is smaller here for two reasons:
   - H7a counts only the `lip_trill` takes (§2.2);
   - the `female7` 0 dB session left validation with bed 116866 (R6-A.2).

   Women's lip trills at 0 dB still gate in two places: `sess5` (real, 5,628
   hops) and H7b (synthetic, 8,927 hops). So §10 Q4 (a hazard row with no
   gating real cell for a sex) **does not arise**.
2. **H5 / S2, women: the last-10-s bin of 7 cells has 388–398 hops**, just
   under 400. The cells are flat + two beating fans at +10 dB, and phone + AGC
   with clean, two beating fans +10, aquarium pump +10, 144046 +10, 848181 +10
   and 530917 0 dB.
   - Only that last bin, and so the last-vs-first reading, cannot be
     evaluated.
   - Every other bin of these cells has ≥ 400 hops after merging and gates.
   - The same readings for men, and all S4 cells, gate.

   (`counts.json` lists these 7 cells as whole-cell entries; the bin-level
   reading here is the binding one.)

All other H4–H8 gating cells, bins and machine kinds have ≥ 400 CORRECT hops
for each sex. No machine kind needed merging into its class.

**Machine-kind naming (fixed here, before any model scores the rows).** The
four fsnew clips that appear both as new-H4 beds and in S1 have two names:
- S1 names its real beds by the bare Freesound id (`144046`, `201788`,
  `830089`, `848181`);
- the new H4 streams name them `fsnew__<id>`.

They are the same clips, so the machine-kind reading **pools them**: the alias
`<id>` ≡ `fsnew__<id>` gives 35 kinds, not the 39 raw keys of `counts.json`.
`counts.json` keeps the raw keys and is not edited, so the scorer applies the
alias.
- Pooled counts, men: 144046 19,427, 201788 21,057, 830089 19,339, 848181
  21,313.
- Pooled counts, women: 144046 20,877, 201788 8,732, 830089 9,607, 848181
  19,850.

Every kind has ≥ 974 hops either way.

## R6-A.8 Hashes

All in the round-6 hash log (outside the repository), never edited after:

| tag, time | what |
|---|---|
| `r6a-checks`, 04:47:10 | the §1.2 outputs (`checks/`), `disjoint_r6.py`, `hashlog.py` |
| `r6a-code`, 05:06:42 | `hval6.py` (`ae5b120f…085d`), `hcells.py` (`366fa1ad…d17d`), the ported generators, `selftest_r6.py`, `beds.json` (`faac0074…9928`), the self-test output |
| `r6a-rows`, 07:51:20 | **`build/vad-train/r6/sel/inputs.sha256`** (19,301 files: every spec, audio file, reference and dump, plus `beds.json`, `plan.json`, `counts.json`, the dropped-session lists and `disjoint.json`; list sha256 **`479b5ed4…3b90`**), `counts.json` (`93246040…85ca`), `plan.json` (`9f0bd244…bfd`), the 16 stream lists, the bit-exact check outputs, the render and dump logs, `portcheck_r6.py`, `sesscheck_r6.py` |
| `r6a-addendum` | this file |

Notes:

- `portcheck_r6.py` and `sesscheck_r6.py` are the scratch scripts that ran
  the bit-exact checks. They were copied into the repository afterwards; the
  only change is a header.
- Round 5's selection inputs are unchanged: `r5/sel/inputs.sha256` has
  sha256 `a5121c50…7157` and `r4/sel/inputs.sha256` has `7d8e6c2b…3b46f`.
  The step that writes R6-B re-hashes their files.

## R6-A.9 What this step did not do, and why

- **No model scored anything.** No model of any round ran on an H row, a probe
  stream, a confirmatory stream or a harness stream. The only figures read
  are the current app's aggregate CORRECT-hop counts per cell (R6-A.7), the
  seal checks and the sealed matcher's keep / drop answers.
- **No training data was built, for either track.** The workflow's task text
  for this step also asked for training-side data: Track A's and Track B's
  new generators and seeds, and Track B's room sessions. The
  pre-registration does not allow it here:
  - §9.1 is binding. Its Data step (item 2) has no training data.
  - Training data (D8, D9; for Track B also D10 and the speech detector's
    outputs) belongs to the Train steps (item 3), and "Neither Train step
    builds any training data before R6-B is hashed".
  - R6-B comes after the validity check (§2.12). That check scores the
    round-3 to round-5 freezes on H4–H8, which this step may not do.
  - Building training data now would put it ahead of R6-B. The round-5
    process review flagged exactly this order deviation (LOW).

  So **no round-6 training item exists**. The training generators
  (`train/vsynth_r6.py`, `train/mach_r6.py`, `train/micsim_r6.py`), D9 mining,
  D10 and the speech-detector outputs are built by Train A and Train B after
  R6-B is hashed, with the seeds of §4.2 and §5.7 (Track A 7·10⁹ + [0, 5·10⁷),
  Track B 7·10⁹ + [5·10⁷, 10⁸)). No training seed was used here (R6-A.3).
- **Still required before either Train step trains** (§9.1 item 2):
  - the shared code: `r6/opselect_r6.py` (= round 5's readings plus H4–H8 by
    `hcells.py`, self-tested against `score.py`), the V4 bench and the parity
    tool;
  - the validity check of §2.12: `custom-vd-r5`, `-r4` and `-r3` scored on
    H4–H8 at their frozen points, validation only;
  - **Addendum R6-B**, hashed, committed and pushed.

## R6-A.10 Deviations and notes, in one place

1. **Training data was not built**, although the workflow's task text asked
   for it. The binding order (§9.1) puts it after R6-B (R6-A.9).
2. **Where the seed offsets are recorded.** §2.3 says they are fixed "in R6-B
   before any rendering". They were fixed in code hashed at 05:06:42, before
   any new-row stream was rendered, and are reported here (R6-A.4).
3. **Two runs came before that hash:** a dry run of 43 sample streams into a
   scratch folder with the same code (not part of the rows), and the two
   review-session builders, which carry no round-6 constant and reproduce the
   reviews' files bit for bit (R6-A.4).
4. **The checker's first own-copy rule was too narrow.** The first output is
   kept and hashed. The rule was widened before the second run (R6-A.2).
5. **Removed by the §1.2 item 5 check:**
   - the take `female6/scales/lip_trill/f6_scales_lip_trill_o.wav`, which is
     masked in `sess5`;
   - the round-3 review's bed 116866, so four of its sessions left
     validation (R6-A.2).
6. **Not evaluable:**
   - women's H7a in the round-3 review sessions at 0 dB (329 hops);
   - the last-10-s bin of 7 women's S2 cells (388–398 hops).

   Women's 0 dB lip trills still gate through `sess5` and H7b (R6-A.7).
7. **The `r4/audit-exclusions.json` side effect.** `audit_exclusions.py`
   overwrites that file. It was restored to its round-4 content, and the
   round-6 output is kept in `checks/` (R6-A.1).
8. **Machine-kind alias.** S1's bare Freesound ids and the new rows'
   `fsnew__<id>` names are the same clips and are pooled (R6-A.7).

## R6-A.11 Status

- The seal is **unbroken**. No model of any round has run on a confirmatory
  or harness stream, and no probability file exists for any round-6 row.
- The private session recordings were not read. Nothing under `src/`
  changed. No PR was opened.
- **Next, before either Train step builds training data or trains** (§9.1):
  - `r6/opselect_r6.py`, which reads H4–H8 through `hcells.py` and the
    machine-kind alias above, with its self-test against `score.py`;
  - the V4 bench and the parity tool;
  - the validity check of §2.12 on these rows (`r6/sel/inputs.sha256`,
    `479b5ed4…3b90`);
  - **Addendum R6-B**, which repeats the not-evaluable list of R6-A.7.
