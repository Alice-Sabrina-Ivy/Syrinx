# "Likely heard as": only voiced windows in the reading, and the calibration with the speech detector — 2026-10-08

**Status: pre-registration.** Written and committed before any result of
this study is computed (no candidate code exists at this commit; the
harness is written after it). Results are appended below it. This is the
hard-rule-3 measurement file for any change to `src/ml/heard-as.js`.

Branch `cue-strip` (head = 95700c3 merged with the voice-direction review
fixes; the pitch chain, the utterance gate, the speech detector and the
classifier are those of 95700c3). Public data only: LibriSpeech dev-clean
and test-clean (CC BY 4.0), the Palette of Voices stimuli (Munson & Dolquist
2025, CC BY 4.0), EARS and Expresso whisper / regular readings (CC BY-NC
4.0, the speech-gate probe set `pwhis`, measurement only), MUSDB18 excerpts
(CC BY 4.0, probe set `palone`), the frozen low-voice evaluator's 38-talker
noise / channel / reverb set `chanx` (LibriSpeech talkers), and synthetic
held vowel / noise / silence. No private recording.

## Why (two review findings, 2026-10-07)

1. **Whisper inside voiced speech feeds the reading.** User decision (A):
   score only stretches with some voiced (pitched) sound; whisper must not
   get readings. The panel hides unless its 8 s pool holds ≥ 3 s of posted
   voiced pitch, so whisper alone gets no reading. But `meterLogit` is the
   mean of **every** classified window in the pool, including windows with
   no voiced sound, so whispered stretches between voiced speech move the
   reading (a built-app A/B on three EARS men: median axis position
   0.39 → 0.30 with 3 s of whisper in place of 3 s of silence; indicative,
   one run per arm).
2. **The constants were fitted on a different window set.** The form-A
   constants were checked against the production chain with the
   pitch-voicing gate (`heard-as-calibration-2026-10-07.md` §3). Since the
   voice-direction merge the gate asks the Silero speech detector whether
   someone is speaking. Nothing has re-checked the constants on the
   detector's windows, and the CI window-set guard replays pitch hints only.

## Chain and panel simulation (both parts)

- **Chain:** `scripts/heard-as/chain.mjs` (real pitch worker, the gender
  worker's 150 ms decision tick, `decideMlWindow` with the real utterance
  gate, the 450 ms classifier hop, the silence floor), extended to feed the
  speech detector exactly as `gender-worker.js` `handleChunk` does: per
  25 ms capture chunk, after the relayed pitch hints, the chunk is
  resampled to 16 kHz, appended to the window ring and cut by
  `createSpeechFramer`; each 32 ms frame goes through `createSileroRunner`
  (onnxruntime-web WASM in Node, the pinned Silero v6.2.3 file, sha256
  checked) into `gate.noteSpeech`, then the decision runs. The detector is
  live from the stream start (in the app it becomes ready a few seconds
  after the panel is switched on). The deployed q8-v2 classifier gives each
  classified window's logit (cached by window time, so arms that classify
  the same window share its logit).
- **Arms:** **P** = no speech hints (the gate's pitch-voicing path — the
  window set the constants were checked on); **S** = the speech detector
  live (the shipped head); **S+V** = S with a candidate rule V below.
- **Live panel:** `src/ml/heard-as.js` with the shipped constants, as in
  `HeardAsPanel.jsx` and `scripts/heard-as/hop-study.mjs`: an update every
  2 s of audio from the stream start, the 250 ms check that hides a shown
  estimate once the voice state is "sustained"; the display is sampled every
  250 ms (the last update's state). "Shown share" = share of those samples
  showing an estimate. "Can't tell yet" = a shown estimate whose two-way
  range spans ≥ 8 tenths (`isWideShare`).
- **Whole-stimulus aggregate** (Palette, as `run_chain.mjs`): `aggregate()`
  over the whole stimulus, minimum rules off; two-way share "man"
  s = σ(eta), in points.

## Part A — the constants on the speech detector's windows (finding 2)

A1 **Palette** (240 stimuli), S vs P:
- per-stimulus |s_S − s_P| MAE **≤ 1.0 point**, overall and for the
  listener-majority groups heard-as-man (Palette two-way share ≥ 50) and
  heard-as-woman separately (the bar of the 450 ms hop pass,
  `heard-as-cpu-2026-10-07.md` guards 1 / 6);
- error vs the Palette listeners (two-way, offset 0) per group: S ≤ P
  + 0.5 point;
- stimuli with no classified window in either arm are reported and
  excluded; more than 5 % of a group's stimuli without one under S fails A1.

A2 **Running speech, held-out readers:** the 40 LibriSpeech dev-clean
readers (20 women, 20 men; in no fit) and the 40 test-clean readers of the
calibration's hide-rule check (20 / 20), each reader's five utterances
concatenated with 0.3 s gaps (the `hop-study.mjs` streams), live panel:
- mean eta difference S − P over updates shown in both arms within
  **± 0.225** (a tenth of the ±2.25 half-width), women and men separately,
  per corpus;
- reported: shown share, time to first estimate and the "Can't tell yet"
  share per sex in each arm.

**Outcome:** A1 and A2 pass → the constants are confirmed for the detector's
window set. Otherwise the result is reported as "needs a refit" and the user
decides (no refit in this pass). Part A is also reported for the Part B
selection (S+V vs P).

## Part B — classified windows count only when their own span is voiced (finding 1)

**Rule family** (in `heard-as.js` `aggregate()`; default off until
selected): a classified window's logit enters `meterLogit` only if its own
750 ms span `[end − 750 ms, end]` holds enough **posted** voiced pitch. The
window still counts as a scored window (window count, voiced time and F0
spans unchanged), as the classifier-hop windows do; if no classified window
in the pool qualifies, `meterLogit` is null and the panel hides with
"short".
- **V25 / V100 / V200:** ≥ 25 / 100 / 200 ms of posted voiced frames in the
  span (each frame counts its capped spacing, as `voicedMs`).
- **R75 / R150:** a run of consecutive posted voiced frames lasting
  ≥ 75 / 150 ms inside the span (a run breaks at an unvoiced frame or a
  > 100 ms gap in the posted frames).

**Whisper streams.** Per EARS / Expresso talker of `pwhis`: the talker's
regular readings (active spans, Expresso streams joined with 0.3 s gaps)
cut into 6 s pieces, alternating with 3 s pieces of the same talker's
whisper (same text, natural level relative to the regular reading; the
whisper pieces cycle if they run out), starting and ending with regular
speech. Paired control: the same stream with each whisper piece replaced by
digital silence of the same length. A **whisper window** is a classified
window whose span lies ≥ 90 % (≥ 675 ms) inside whisper pieces. Talker
groups: **unphonated** = every talker except the five EARS women whose
"whisper" Praat finds 33–46 % voiced (p027, p033, p062, p064, p104;
whisper-voicing-2026-10-07.md), reported separately as **phonated**. Dev /
test talkers as in whisper-voicing-2026-10-07.md: dev = EARS women p002,
p011, p033, p061, p064, p084, men p007, p031, p087, Expresso ex02 (W),
ex01 (M); test = the rest.

**PRIMARY (B1):** whisper logit share = over every shown update of the
speech + whisper streams, the share of the logits pooled into the shown
`meterLogit` that come from whisper windows. **≤ 5.0 % for women and for
men separately**, unphonated talkers (dev + test pooled). Reported, not
decisive: the test talkers alone; the phonated talkers; **B2** mean
|s_whisper − s_silence| over updates shown in both paired arms, and the
shown share of each arm, per sex.

**Selection (dev talkers only):** among V25, V100, V200, R75, R150, the
variants whose dev B1 is ≤ 5.0 % for both sexes; of those, the one that
excludes the fewest classified windows on the 40 dev-clean readers' S runs
(pooled; ties → V before R, then the smaller threshold). If none qualifies,
the variant with the lowest max(women, men) dev B1. The selection is
written to scratch before its guard numbers are looked at. Every variant's
numbers are reported.

**Guards for the selection (vs the S head; women and men separately; a
variant that passes for one sex only fails):**
- **G1 Palette:** per-stimulus |Δs| MAE ≤ 1.0 point, overall and per
  listener-majority group; error vs listeners reported; stimuli that lose
  every qualifying window reported (> 5 % of a group fails).
- **G2 Running speech** (the 80 readers of A2): shown share ≥ head
  − 0.5 pp per sex and corpus; median time to first estimate not later by
  > 1 s per sex; mean |Δs| on updates shown in both, and the "Can't tell
  yet" share, reported.
- **G3 Noise, channel and reverb** (`chanx`: 38 talkers, 19 W / 19 M, × 12
  conditions — clean, pink 10 / 0 dB, babble 10 / 0, real noise 10 / 0,
  phone, laptop, reverb 0.5 / 1.0 s, −20 dB): shown share of the samples
  from 3 s after speech onset to 1 s after its end ≥ head − 1.0 pp per sex
  and condition.
- **G4 Hide rules:** synthetic held vowel, pink noise, digital silence
  (`build/cue-strip-smoke/`): hidden / shown state and reason identical at
  every sample.
- **G5 Music alone** (`palone` instrumental and with vocals at 0 / −10 /
  −20 dB, 12 streams each, nobody at the mic): shown share ≤ head
  + 0.1 pp.
- **G6 CI:** `tests/ml/heard-as-equivalence-test.js` passes with its
  golden file regenerated **with recorded speech-detector probabilities**
  for the fixtures (the window-set guard then replays the detector's hints
  too); `npm run lint`, `npm run test:unit`, `npm run test:resonance-lab`,
  `npm run build` and the cue-strip smoke at every viewport pass.

**Verdict:** SHIP-ELIGIBLE (the rule becomes the default) only if B1 and
every guard pass. Otherwise FAIL with the numbers; the rule stays off and
the user decides.

## Also reported from these runs (descriptive, no bar)

- "Can't tell yet" share of shown estimates per sex on the held-out
  readers (dev-clean, test-clean), head and selection (review finding:
  never measured per sex).
- Panel shown share per sex in noise and reverb (`chanx`, head) — to word
  the panel's "More" line on noise, which still describes the old pitch
  gate.
- Music alone: shown share per stream (distribution, head) — the earlier
  "music got none" came from one built-app run.

---

## Results (2026-10-08)

**Verdict: Part A — the constants are confirmed for the speech detector's
window set. Part B — V200 selected and SHIP-ELIGIBLE (primary and every
guard pass); it is now the default** (`HEARD_AS_CALIBRATION.logitMinVoicedMs
= 200`, `src/ml/heardAsCalibration.js`).

**Order and integrity.** The pre-registration above was committed (6424c39,
sha256 `2f3cfb99…f422`, unchanged since) before the harness ran on any
study stream. The selection was written to scratch (`selection.json`,
05:31:31 UTC, sha256 `07331ab2…ac9f`) by `eval.mjs --phase=select`, which
computes only the dev whisper share and the dev-clean exclusion counts; the
guard numbers came after it (`--phase=all`). Every shown update's pooled
logits were recomputed independently in `eval.mjs` and matched heard-as.js's
`meterLogit` to 1e-9 (the run aborts otherwise).

**Runs.** 895 streams, 6.2 h of audio (whisper mixes 35 min, readers 56 min
× 2 arms, Palette 13 min × 2, `chanx` 96 min, music 30 min, synthetic
1 min) through the production chain in Node with the speech detector live
(arm S; arm P for readers, Palette and synthetic), the deployed q8-v2
classifier on every classified window (logits shared by window time), and
the live panel simulated as pre-registered. Tooling:
`scripts/heard-as/voiced-windows/` (`build_streams.py`, `run.mjs`,
`eval.mjs`) and the speech-detector option of `scripts/heard-as/chain.mjs`.

### Part A — the constants on the detector's windows: PASS

| check | women / heard-as-woman | men / heard-as-man | bar |
|---|---|---|---|
| A1 Palette \|s_S − s_P\| MAE (points) | 0.09 (52 stimuli) | 0.37 (188) | ≤ 1.0 — pass (overall 0.31) |
| A1 error vs listeners, S vs P (points) | 7.02 vs 7.11 | 6.14 vs 6.16 | S ≤ P + 0.5 — pass |
| A1 stimuli with no classified window | 0 | 0 | ≤ 5 % — pass |
| A2 mean eta S − P, dev-clean readers | +0.031 (332 updates) | −0.009 (373) | ± 0.225 — pass |
| A2 mean eta S − P, test-clean readers | +0.029 (332) | −0.029 (417) | ± 0.225 — pass |

Reported (shown share of panel samples / "Can't tell yet" share of shown
samples / median time to the first estimate), P → S: dev-clean women
83.9 → 84.4 % / 5.4 → 6.5 % / 6 → 6 s, men 84.9 → 84.9 % / 7.1 → 7.4 % /
6 → 6 s; test-clean women 83.8 → 83.8 % / 19.7 → 20.4 % / 6 → 6 s, men
84.4 → 84.6 % / 6.3 → 6.3 % / 6 → 6 s. The speech detector moves the
estimate less than the 450 ms classifier hop did (Palette 0.31 vs 0.81
points). The selection V200 against P: Palette MAE 0.39 (heard-as-man) /
0.09 (heard-as-woman), error vs listeners 6.12 / 7.02; readers' mean eta
difference +0.006 / −0.000 (dev-clean), +0.000 / −0.001 (test-clean) —
closer to the pitch-gate windows than the head.

### Part B — voiced windows only

**Selection (dev talkers only).** Whisper windows' share of the pooled
logits, unphonated dev talkers, women / men; classified windows the variant
drops on the 40 dev-clean readers (of 3,307):

| variant | dev B1 W / M (%) | dev-clean windows dropped |
|---|---|---|
| head | 20.28 / 21.32 | 0 |
| V25 | 13.06 / 12.69 | 31 |
| V100 | 5.07 / 5.71 | 112 |
| **V200** | **1.43 / 0.45** | 300 |
| R75 | 6.32 / 4.71 | 93 |
| R150 | 1.71 / 0.87 | 316 |

Qualifying (≤ 5.0 % for both sexes): V200, R150. Selected: **V200** (fewer
dropped windows).

**Primary B1** (all unphonated talkers, dev + test; 142 / 153 shown
updates; %):

| variant | women | men | test talkers W / M | phonated EARS women |
|---|---|---|---|---|
| head | 20.87 | 22.21 | 21.65 / 23.32 | 27.72 |
| V25 | 13.29 | 14.10 | 13.61 / 15.78 | 26.79 |
| V100 | 5.45 | 5.62 | 5.98 / 5.52 | 26.19 |
| **V200** | **0.96** | **0.50** | 0.32 / 0.56 | 25.23 |
| R75 | 6.37 | 5.77 | 6.44 / 7.02 | 26.77 |
| R150 | 1.92 | 0.97 | 2.20 / 1.09 | 24.95 |

**PRIMARY: PASS** (V200 ≤ 5.0 % for women and for men). The phonated
women's "whisper" windows stay in (~25 %), as decision A asks: they hold
voiced sound.

**B2** (mean |s_whisper − s_silence| over updates shown in both arms, points
of the two-way share): head women 0.58, men 3.30; V200 women 0.28, men
1.64. Shown share, whisper / silence arm: women 61.1 / 54.5 %, men 62.6 /
58.1 % (the same for every variant). What remains comes from windows that
straddle a speech / whisper boundary; they hold voiced speech.

**Guards (V200 vs head):**

| guard | result | bar |
|---|---|---|
| G1 Palette \|Δs\| MAE | 0.06 overall; heard-as-man 0.08, heard-as-woman 0.00 points; error vs listeners 6.12 vs 6.14 / 7.02 vs 7.02; 0 stimuli lost | ≤ 1.0 — pass |
| G2 shown share, dev-clean | women 84.4 → 84.4 %, men 84.9 → 84.9 % | ≥ −0.5 pp — pass |
| G2 shown share, test-clean | women 83.8 → 83.8 %, men 84.6 → 84.6 % | ≥ −0.5 pp — pass |
| G2 median first estimate | 6 s → 6 s, every sex and corpus | ≤ +1 s — pass |
| G2 mean \|Δs\| on shown updates | dev-clean 0.34 / 0.41, test-clean 0.41 / 0.27 points (W / M) | reported |
| G3 `chanx`, 12 conditions × 2 sexes | identical shown share in all 24 cells | ≥ −1.0 pp — pass |
| G4 held vowel / pink noise / silence | identical state and reason at every sample | identical — pass |
| G5 music alone, 6 cells | identical per stream | ≤ +0.1 pp — pass |
| G6 CI | equivalence test with the regenerated golden file (speech-detector probabilities stored; the independent Python check implements the rule); lint, unit tests, resonance-lab parity, build and the cue-strip smoke at every viewport — recorded with the commit | see the commit |

**What it does not do.** It drops a classified window's logit only; the
window still counts for the panel's window count, voiced time and F0, so no
hide rule moves. The classifier still runs on whispered windows (CPU while
the panel is on and someone whispers). Skipping them in the worker would
need the pitch hints at decision time — they lag the audio by the ~90 ms
decode delay — and would change which windows are classified on speech;
not done.

## Also from these runs (descriptive)

**"Can't tell yet" per sex** (share of shown samples, head):

| readers | women | men |
|---|---|---|
| LibriSpeech dev-clean (20 + 20, in no fit) | 6.5 % | 7.4 % |
| LibriSpeech test-clean (20 + 20) | 20.4 % | 6.3 % |
| pooled | ~13 % | ~7 % |

It depends on the voice more than on sex: in test-clean three women (ls1284,
ls1995, ls2961) and one man (ls6930) get it on 79–100 % of their shown
readings, and most readers never do. The panel's "More" list now says so.

**Panel shown share in noise and on other channels** (`chanx`, head, %;
samples from 3 s after speech onset to 1 s after the end of each ~10 s
utterance, so quiet is ~60 %, not the ~84 % of continuous reading):

| condition | women | men |
|---|---|---|
| quiet (clean) | 62.6 | 55.6 |
| −20 dB level | 58.2 | 55.6 |
| pink noise 10 / 0 dB | 58.2 / 29.7 | 45.7 / 16.3 |
| real noise 10 / 0 dB | 59.3 / 17.6 | 46.2 / 18.1 |
| babble 10 / 0 dB | 96.3 / 97.8 | 94.9 / 94.2 |
| phone band / laptop mic | 59.6 / 61.1 | 47.6 / 51.3 |
| reverb 0.5 / 1.0 s | 60.9 / 64.0 | 59.5 / 59.9 |

Men's readings are shown less often, most in 10 dB noise and on the phone /
laptop channels (about 12 pp). The hide reason is the panel's own ≥ 3 s of
voiced pitch ("short"), not the speech detector: the pitch tracker posts
less voiced pitch for low voices in noise. Reverb does not hide it longer.
Babble shows a reading most of the time because the babble's own speech is
read (disclosed: "works best when you're the only one talking"). The old
"More" line ("low voices are recognised as speech less often") is replaced
by one worded from this table.

**Music alone, nobody at the mic** (head, 12 streams per cell, shown share
of panel samples): instrumental at 0 / −10 / −20 dB and music with vocals
at 0 / −10 dB: 0 % on every stream; music with vocals at −20 dB: 1 of 12
streams 32 % (mean 2.7 %). With the built-app runs (integration note: one
run, 0 %; review: three runs, 8.8 %, 0 %, 0 %), music with vocals gets
**rare, short readings**, not none.

**The whisper hide words** (scratch check on the `pwhis` streams as they
are: 2 s lead, one reading each). The panel now says "Needs voiced
(pitched) speech — whispering gets no reading, and loud noise can hide your
pitch" when ≥ 10 scored windows hold voiced pitch on < 10 % of their span
(`heardAsAxisModel.js` `shortReason`). Unphonated whisper: women 25 % /
men 50 % of samples show it (the rest: "Waiting for running speech" / "Keep
talking" while the pool fills); regular reading and every reader stream:
never; real 0 dB noise, men: 5.9 % of samples (hence "loud noise" in the
words).

## Reproduce

```
python scripts/heard-as/voiced-windows/build_streams.py --out=<dir> --pwhis=<speech-gate probes> \
  --r1=<jobs_r1.json> --r1dev=<jobs_r1dev.json> --pov=<jobs_pov.json> --chanx=<chanx sets> \
  --palone=<speech-gate probes> --smoke=build/cue-strip-smoke
node scripts/heard-as/voiced-windows/run.mjs --jobs=<dir>/jobs.json --out=run.0.jsonl --shard=0/2 --silero=<silero_vad.onnx>
node scripts/heard-as/voiced-windows/run.mjs --jobs=<dir>/jobs.json --out=run.1.jsonl --shard=1/2 --silero=<silero_vad.onnx>
node scripts/heard-as/voiced-windows/eval.mjs --runs=run.0.jsonl,run.1.jsonl --pov=<pov_stimuli.csv> --out=eval --phase=select
node scripts/heard-as/voiced-windows/eval.mjs --runs=run.0.jsonl,run.1.jsonl --pov=<pov_stimuli.csv> --out=eval --phase=all
node scripts/heard-as/make_golden.mjs --silero=<silero_vad.onnx>
```

The speech-gate probe sets (`pwhis`, `palone`: EARS / Expresso via the HF
mirror `Malfaro43/whisperedAudio-benchmark`, MUSDB18) and the frozen
evaluator's `chanx` set are built by the low-voice-noise tooling (scratch,
not committed); `jobs_r1dev.json` lists the 40 dev-clean readers' five
utterances each. Outputs stay outside the repository.
