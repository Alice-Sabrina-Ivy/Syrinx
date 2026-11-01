# Resonance row: hold through pauses, whatever the noise floor (2026-10-28)

Branch `resonance-mobile` (from `main` 9e1696b + the diagnosis 7afa3c1).
Public data only. Follows
[resonance-phone-vs-desktop-2026-10-28.md](resonance-phone-vs-desktop-2026-10-28.md)
§5 (the onset blink and the noisy-pause dropout). Owner decisions of
2026-10-28: build (1) the streak-blink fix, (2) keep the resonance thumb
through noisy pauses, (3) a phone-vs-headset measurement kit (separate
work, not in this note) and (4) fix the info text. On the branch only: no
PR, no merge.

## Plan (pre-registered, 2026-11-01, before any result)

Written and committed before the candidate is implemented or any of the
numbers below is computed.

### Candidate (CAND)

A display change in the cue strip's pure model
(`src/components/cueStripModel.js`) and its wiring in `CueStrip.jsx`. The
hook (`useAudioPipeline.js`), the pitch row, recorded session frames, the
resonance worker and every u value stay as they are.

- **Hold clock.** `createResonanceHold()` remembers the last time the
  strip's 4 Hz tick saw the gated `pitchVoiced` true. The tick calls
  `hold.tick(pitchVoiced, now)`, which returns true while at most
  `RESONANCE_HOLD_MS` (= `SILENCE_HOLD_MS`, 5000 ms) have passed since then.
  The flag is kept in the tick's view, and every render uses the latest
  tick's value. The clock is `performance.now()` in the app and the tick
  time in the harness.
- **Row state.** `cueRowStates({ …, resonanceHold })`: when the resonance
  row would be "idle" (no shown voice and no `pitchHolding`) and
  `resonanceHold` is true, the row takes the state it would have with
  `holding: true` — "holding" (the dimmed thumb at the current u), or
  "settling" / "needs running speech" where those apply — except "keep
  talking…" (warming): a row with no position yet stays idle, so the hold
  never shows "keep talking…" with nobody speaking (the 2026-10-21
  complaint). Every other state (starting, restarting, reload,
  unavailable, paused, narrowband, live) comes first, unchanged.
- **Trail.** Unchanged code (`createTrail`): it samples only while "live",
  freezes in other states and clears on idle and on any change into or out
  of "needs running speech" / "phone-quality audio". Because the held row
  is not idle, the trail is no longer cleared by short pauses or by the
  ~130 ms onset blink. After 5 s without shown voice the row goes idle and
  the trail clears, as today.
- **The pitch row** never reads `resonanceHold`.
- Screen-reader summary, header words and start ring follow the state as
  they do today in the quiet-pause hold (`holding` reads the
  start-relative words; the ring is drawn whenever a start exists).

By construction CAND's resonance state differs from BASE's only where
BASE's is "idle", and the thumb's u is the same snapshot in both.

**BASE** = this branch at 7afa3c1 (the shipped rule: the resonance row reads
`pitchVoiced` / `pitchHolding` only).

### Harness

The diagnosis's display chain, extended (no copy of the model logic):

1. `scripts/resonance/mobile/chain.mjs` functions: the REAL pitch worker with
   the real FireRedVAD model (`build/models/firered`), 1200-sample chunks at
   48 kHz, and the resonance worker's chain with the gated hint (gate on).
2. `pause-row.mjs`: the REAL DSP worker and the REAL `useAudioPipeline` hook
   (voice-gate setting on) per chunk.
3. `pause-report.mjs` `stripReplay`: the hook's state through the 200 ms
   throttle, the resonance posts, the CueStrip's 4 Hz tick and a render
   point every 25 ms, with the SHIPPED `createResonanceHold`,
   `cueRowStates`, `createTrail`, `dotOpacity`, `rowValue`, `axisPos` —
   BASE (`resonanceHold` never passed) and CAND (the tick's hold, as
   CueStrip wires it) on the same inputs.

### Data

- **Speech.** The 12 LibriSpeech dev-clean readers (first 6 men and 6 women
  by speaker id, `faster-prep.py --n=6`), each reader's 150 s stream at
  −32 dBFS active level, window 20–150 s. Conditions:
  - none (no added noise; measured pause floor about −67 dBFS);
  - brown and pink room noise at pause floors −55 / −50 / −48 / −40 dBFS;
  - the real air-conditioner clip (`tests/dsp/data/notch-real/ac114.wav`,
    MS-SNSD, CC0) at the same four floors.

  That is 13 conditions × 12 readers = 156 streams. They reuse the
  diagnosis's chain and hook outputs (`build/resonance-mobile/pause/runs`,
  `…/hook`), which were made from `src/` identical to this branch's: the
  candidate changes nothing upstream of the strip. Spot check: `pause-row.mjs`
  re-run on three conditions must give byte-identical hook records.
- **Real noise (fresh, public, noise only; for G1).** At least 150 clips of
  60 s, downloaded to `C:/Coding Projects/Syrinx-cache/noise-real/` (outside
  the repo). The list (id, URL, licence, sha256, class) and the fetch script
  are committed under `scripts/resonance/mobile/`. Selection, fixed now:
  - **DEMAND** (Zenodo 1227121; the record says CC BY 4.0, the dataset's own
    document CC BY-SA 3.0 Unported), 48 kHz, channel 1 only (HTTP range
    reads).
    - 17 environments: all except OMEETING, whose content is a conversation
      ("a meeting room while the microphone array is discussed").
    - Each 300 s recording cut into five consecutive 60 s clips: 85 clips.
    - Classes:
      - outdoor: NFIELD, NPARK, NRIVER;
      - traffic: STRAFFIC;
      - transport: TMETRO, TBUS, TCAR;
      - public / café: PSTATION, PCAFETER, PRESTO, SPSQUARE, SCAFE (babble of
        distant voices by nature);
      - office: OOFFICE, OHALLWAY;
      - kitchen / washing: DKITCHEN, DWASHING;
      - living room: DLIVING.
  - **Freesound** HQ previews (the lossy Vorbis rendition Freesound serves),
    found with search-page queries (no API key), duration filter 60–900 s,
    results in the site's order, query by query until each class cap.
    - Licence read on each sound's own page: only CC0 or CC BY (no NC, no
      ND, no Sampling+).
    - A sound is dropped if its title or tags contain voice, vocal, speech,
      speak, talk, sing, song, music, radio, tv, television, people, crowd,
      chatter, conversation, child, kid, baby, laugh, bird or birds.
    - At most 2 sounds per uploader; the first 60 s of each.
    - Classes and caps (72 in all):
      - fans / PC / coil whine: 14;
      - HVAC: 14;
      - fridge / freezer: 12;
      - mains hum / transformer / ballast: 14;
      - washing machine / kitchen appliance: 10;
      - traffic: 8.
    - A class that cannot be filled stays smaller and is reported.
  - **Levels.** Each clip is played as a 60 s, 48 kHz noise-only stream
    (resampled with the app's `resampleClip`, as `pause-noise.mjs`), through
    a 50 Hz high-pass (a phone microphone's low cut, as the diagnosis). Its
    scale makes the median of the DSP worker's 50 ms full-band intensity
    equal one of two phone levels, both binding:
    - **L1 −48 dBFS**: a phone hearing a room just above the hook's
      −50 dBFS silence threshold. The older phone captures sat about here,
      and here BASE has no silence hold, so CAND's extra holding is largest.
    - **L2 −40 dBFS**: a noisier room or street.
  - Overlap with the clips the voice gate was tuned on in 2026-10 is not
    checked: those lists were deleted. The detector is not tuned here.

### Metrics

Time shares are taken on the 25 ms render grid (the app replay); trail
metrics at the ticks.

- **Thumb drawn**: `dotOpacity(state) !== null` and `u !== null`.
- **Not idle**: the state is neither "idle" nor "starting".
- **Speech, per condition, pooled over the 12 readers:**
  - mean resonance trail (points, at every tick in the window);
  - the share of 1–5 s pauses in which the thumb disappears. Pauses come
    from the clean run's posted voicing, as in the diagnosis. A pause counts
    when any render point from its start to its end + 250 ms has no thumb.
  - Also reported: row idle %, trail clears / min, ticks with a drawable
    streak (448 × 890 and 360 × 690), 0.3–1 s pauses, per sex.
- **Noise only, per level and class and pooled over clips:** not-idle %,
  "keep talking…" %, thumb drawn %, and per clip CAND − BASE.
- **Streak span** (for the info text): at each tick, the wall-clock age of
  the oldest trail point. Reported as median and q10–q90, on ticks with a
  full trail (15 points) and on ticks with ≥ 2 points, for clean speech and
  per floor.

### Targets (speech, every condition)

- **T1.** The mean resonance trail is ≥ 10 points.
- **T2.** The thumb disappears in ≤ 5 % of 1–5 s pauses (pooled over the 12
  readers).

### Guards

- **G1 (noise only, real-noise set, at L1 and at L2).**
  - Drawn-thumb time: CAND ≤ BASE + 1.0 point, pooled.
  - Not-idle time: CAND ≤ BASE + 2.0 points, pooled.
  - No single clip with CAND drawn-thumb time > BASE + 15 points.
  - Per-class numbers are reported. The pooled figure without the public /
    café class is reported as information; it is not a bar.
- **G2.** The thumb's u is identical wherever both arms draw: every render
  point, speech and noise.
- **G3.** The pitch row's state is identical at every tick and render point,
  speech and noise.
- **G4.** On speech, CAND's resonance state and thumb differ from BASE's
  only at render points and ticks where BASE's resonance state is "idle".
  The trail is meant to differ; that is T1.
- **G5.** These pass:
  - `npm run lint`, `npm run test:unit`, `npm run build`;
  - the cue-strip tests: `tests/audio/cue-strip-model-test.js`,
    `cue-meter-geometry-test.js`, `voice-gate-display-test.js`,
    `cue-strip-wiring-test.js`;
  - `scripts/cue-strip-smoke.mjs` at phone, p402, p360 and desktop;
  - `scripts/resonance-lab/lab-layout-smoke.mjs --panel=0`, if it can run
    here.

### Selection rule

- **Every target and guard passes:** CAND is committed to the branch, with
  the info text (below) and the CLAUDE.md row.
- **Any target or guard fails:** STOP. No tuning. The code stays on the
  branch only if G2–G5 pass. The numbers are reported for an owner
  decision.

### Info text (owner decision 4)

- **The streak.** The resonance info's sentence "The streak shows the last
  ~30 s." is replaced by the measured span on clean speech: the median over
  ticks with a full trail, rounded to 5 s. It also says that the streak
  starts over after about 5 s without speech.
- **The device.** One plain sentence is added: readings depend on the
  microphone and how it is held, so compare yourself on one device.
- **Checks.** No gender words. The popover must still fit at p360 / phone /
  p402 / desktop (`scripts/cue-strip-smoke.mjs`). Any test or smoke that
  asserts the old text is updated.
