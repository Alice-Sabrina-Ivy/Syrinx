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
