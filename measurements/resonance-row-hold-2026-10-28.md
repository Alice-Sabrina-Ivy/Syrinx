# Resonance row: hold through pauses, whatever the noise floor (2026-10-28)

Branch `resonance-mobile` (from `main` 9e1696b + the diagnosis 7afa3c1).
Public data only. Follows
[resonance-phone-vs-desktop-2026-10-28.md](resonance-phone-vs-desktop-2026-10-28.md)
§5 (the onset blink and the noisy-pause dropout). Owner decisions of
2026-10-28: build (1) the streak-blink fix, (2) keep the resonance thumb
through noisy pauses, (3) a phone-vs-headset measurement kit (separate
work, not in this note) and (4) fix the info text. On the branch only: no
PR, no merge.

**Status (2026-11-01): STOP.** G1 (the noise-only cost) failed, and T1, T2
and G2–G5 passed. The candidate is kept on the branch for the owner's
decision (§Results). An independent review the same day reproduced every
number and found that G1's cold-start streams understate the cost in the
case the hold is for, noise in a pause after speech. That replay is added
as information, without a bar (§"After speech"); the plan and its bars are
unchanged.

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

## Results (2026-11-01)

**Verdict: STOP.** G1 failed at both phone levels; T1, T2 and G2–G5 passed.

- **What failed.** On fresh real noise, each clip played from a cold
  start, holding the thumb for 5 s draws it longer than BASE does:
  - pooled, +1.6 points at −48 dBFS and +3.2 at −40 dBFS (bar +1.0);
  - one clip, +31.5 and +41.0 points (bar +15).
- **After speech it costs more** (information, no bar). With a position
  already on screen, as in a pause after the user has spoken, the same
  noise gives +4.7 and +7.9 points pooled, with 21 and 35 clips over
  +15 points.
- **Rule applied.** Nothing was tuned. G2–G5 pass, so the candidate stays on
  the branch (commit 45e54f2), together with the info text. The owner
  decides whether to adopt it.

### Speech: T1 and T2 pass

12 readers, window 20–150 s, pooled. The 1–5 s pause share counts the
pauses in which the thumb disappears; the window runs from the pause's
start to its end + 250 ms. There are 186 such pauses per condition.

| condition (pause floor, DSP median) | mean trail BASE → CAND | 1–5 s pauses, thumb gone BASE → CAND | 0.3–1 s pauses, thumb gone BASE → CAND | row idle % BASE → CAND | trail clears / min BASE → CAND | ticks with a drawable streak (448×890) BASE → CAND |
|---|---|---|---|---|---|---|
| none (−66.6) | 2.1 → **11.7** | 74.2 → **0.0 %** | 42.4 → 0.0 % | 4.4 → 0.0 | 10.3 → 0.5 | 62.8 → 97.3 % |
| brown −55 (−54.3) | 2.0 → **12.2** | 79.6 → **0.0 %** | 45.6 → 0.0 % | 4.8 → 0.0 | 10.6 → 0.3 | 61.2 → 98.2 % |
| brown −50 (−49.6) | 1.8 → **12.7** | 99.5 → **0.0 %** | 35.2 → 0.0 % | 11.2 → 0.0 | 11.5 → 0.2 | 57.9 → 99.0 % |
| brown −48 (−47.7) | 2.0 → **12.8** | 100.0 → **0.0 %** | 27.2 → 0.0 % | 11.1 → 0.0 | 10.6 → 0.2 | 60.2 → 99.0 % |
| brown −40 (−39.8) | 1.6 → **12.9** | 100.0 → **0.0 %** | 41.9 → 0.0 % | 14.3 → 0.0 | 12.8 → 0.0 | 48.8 → 98.5 % |
| pink −55 (−54.6) | 2.0 → **12.2** | 79.0 → **0.0 %** | 46.1 → 0.0 % | 4.8 → 0.0 | 10.6 → 0.3 | 65.4 → 98.2 % |
| pink −50 (−49.8) | 1.8 → **12.7** | 100.0 → **0.0 %** | 33.1 → 0.0 % | 11.2 → 0.0 | 11.5 → 0.2 | 58.4 → 98.6 % |
| pink −48 (−47.8) | 2.0 → **13.0** | 100.0 → **0.0 %** | 23.5 → 0.0 % | 10.6 → 0.0 | 10.2 → 0.2 | 64.5 → 99.1 % |
| pink −40 (−39.9) | 1.8 → **12.8** | 100.0 → **0.0 %** | 33.3 → 0.0 % | 12.3 → 0.0 | 11.2 → 0.2 | 57.4 → 98.2 % |
| real AC −55 (−54.2) | 2.6 → **12.3** | 68.3 → **0.0 %** | 32.5 → 0.0 % | 3.9 → 0.0 | 8.6 → 0.4 | 71.1 → 97.9 % |
| real AC −50 (−49.5) | 6.7 → **12.9** | 29.0 → **0.0 %** | 8.3 → 0.0 % | 1.8 → 0.0 | 3.3 → 0.3 | 89.0 → 98.5 % |
| real AC −48 (−47.7) | 9.9 → **13.3** | 12.9 → **0.0 %** | 4.3 → 0.0 % | 0.9 → 0.0 | 1.6 → 0.2 | 95.3 → 98.9 % |
| real AC −40 (−39.9) | 10.1 → **13.4** | 9.1 → **0.0 %** | 2.9 → 0.0 % | 0.6 → 0.0 | 1.5 → 0.2 | 93.0 → 99.3 % |

- **T1 PASS:** the smallest CAND trail is 11.7 points (none).
- **T2 PASS:** CAND's thumb disappears in 0.0 % of 1–5 s pauses at every
  condition.
- **Per sex.** CAND's mean trail is 12.6–13.7 for men and 10.8–13.2 for
  women; the women's lowest is clean speech, 10.8. Thumb gone in 1–5 s
  pauses: 0.0 % for both sexes everywhere. Full per-sex tables:
  `hold-report.mjs` output.
- **Real AC rows.** At ≥ −50 dBFS, BASE already keeps a longer trail there:
  the hum is posted voiced and shown in the pauses (the diagnosis's
  false-voicing case).
- **Streak at 360×690.** The streak was drawable on 96.7 % of clean-speech
  ticks, against 58.9 % before.

**Streak span** (CAND). The span is the wall-clock age of the oldest trail
point, taken at the ticks with a full 15-point trail:

| condition | full-trail ticks | median age [q10–q90] |
|---|---|---|
| none (no added noise) | 56 % | 42.5 s [38.3–49.3] |
| brown / pink at −55 / −50 / −48 / −40 dBFS | 61–71 % | 36.8–42.5 s |
| real AC at the four floors | 62–75 % | 31.5–40.5 s |

- **Ticks with ≥ 2 points.** The clean median is 39.3 s [12.5–46.8].
- **BASE never fills the trail.** Its full-trail share is 0 %, except
  where the AC hum is false-voiced. With ≥ 2 points its median age is about
  4–6 s (14–27 s with the false-voiced AC hum at ≥ −50 dBFS).
- **The info text says "about the last 40 s".** The clean median, 42.5 s,
  is exactly halfway between 40 and 45. The tie went to 40, because the
  median over ticks with ≥ 2 points is 39.3 s and the noisy floors are
  shorter. In speaking time, the trail is 15 samples × 2 s of live speech.

### G1 (noise only, 157 fresh real-noise clips): FAIL

The set:
- 85 DEMAND clips: 17 environments × 5;
- 72 Freesound clips (49 CC0, 22 CC BY 4.0, 1 CC BY 3.0).

Every class reached its planned count; the full list is
`scripts/resonance/mobile/hold-noise-list.json`. The traffic class pools
DEMAND STRAFFIC (5) with Freesound traffic (8).

Each 60 s stream was set to a median 50 ms DSP level of exactly −48.0 or
−40.0 dBFS. The measures are those of the app replay: the hook's 200 ms
throttle, the 4 Hz tick and a render every 25 ms.

| level | not idle BASE → CAND (Δ; bar +2.0) | thumb drawn BASE → CAND (Δ; bar +1.0) | "keep talking…" | largest single-clip Δthumb (bar +15) | G1 |
|---|---|---|---|---|---|
| −48 dBFS | 6.24 → 7.88 % (+1.63) | 1.73 → 3.36 % (+1.63) | 4.50 → 4.50 % | +31.5 (DEMAND PCAFETER) | **FAIL** (thumb, single clip) |
| −40 dBFS | 7.63 → 10.85 % (+3.23) | 3.99 → 7.22 % (+3.22) | 3.60 → 3.60 % | +41.0 (DEMAND SCAFE) | **FAIL** (all three) |

Per class at −48 / −40 dBFS. Δ = CAND − BASE in points. "Shown voiced" is
the share of hops that the pitch worker posts voiced and the gate does not
hide.

| class (clips) | shown voiced % | thumb BASE → CAND, −48 | Δ not idle −48 / −40 | clips with Δthumb > 0, −48 / −40 |
|---|---|---|---|---|
| public / café (25, DEMAND babble) | 4.3 / 7.6 | 4.45 → 10.35 | +5.91 / +11.14 | 8 / 13 |
| living room (5, DEMAND) | 9.3 / 15.9 | 8.13 → 18.38 | +10.24 / +14.77 | 4 / 5 |
| transport (15, DEMAND metro / bus / car) | 4.9 / 9.1 | 5.61 → 8.50 | +2.88 / +8.93 | 5 / 7 |
| traffic (13) | 0.8 / 1.0 | 0.35 → 0.99 | +0.65 / +0.66 | 1 / 1 |
| fans / PC / coil whine (14) | 0.5 / 0.6 | 0.49 → 0.77 | +0.28 / +0.58 | 1 / 1 |
| outdoor (15) | 0.9 / 1.1 | 0.94 → 1.07 | +0.13 / +0.11 | 1 / 1 |
| mains hum / transformer / ballast (14) | 1.7 / 2.9 | 0.71 → 0.71 | +0.01 / +0.13 | 1 / 1 |
| HVAC (14), fridge / freezer (12), kitchen / washing (10), office (10), washing machine / kitchen appliance (10) | 0.0–0.2 | 0.00 → 0.00 | 0 / 0 | 0 / 0 |

**Information (no bar).**
- **Without the public / café class** (132 clips), not idle at −48 / −40:
  4.98 → 5.81 % and 4.76 → 6.49 %; thumb 1.21 → 2.04 % and 2.42 → 4.14 %.
  So G1 would still fail without it.
- **By source**, next to the pooled figure (cold start):

  | source (clips) | not idle −48 | thumb −48 | not idle −40 | thumb −40 |
  |---|---|---|---|---|
  | DEMAND (85) | 9.71 → 12.58 % | 2.94 → 5.82 % | 12.43 → 18.17 % | 7.07 → 12.81 % |
  | Freesound (72) | 2.15 → 2.32 % | 0.30 → 0.47 % | 1.96 → 2.21 % | 0.36 → 0.61 % |
  | all (157) | 6.24 → 7.88 % | 1.73 → 3.36 % | 7.63 → 10.85 % | 3.99 → 7.22 % |

- **Without the two clips the corrected word rule drops** (deviation 3;
  155 clips): thumb 1.75 → 3.41 % (+1.66) at −48 and 4.04 → 7.31 % (+3.26)
  at −40; not idle +1.66 / +3.27; largest single clip unchanged
  (+31.5 / +41.0). G1 fails the same way.

**Why it fails, and what the cold start hides.**
- **The hold only extends moments of shown voice.** It starts only at a
  tick that saw the gated `pitchVoiced`, so no clip draws a thumb under
  CAND unless BASE draws one at some point too. Pooled thumb time is
  1.95× BASE at −48 and 1.81× at −40.
- **Most clips never get a position from a cold start.** A noise-only
  stream must first build about 3 voiced seconds before the worker has a
  position at all. 136 of 157 clips at −48 and 128 at −40 never draw a
  thumb in either arm, including 69 of the 72 Freesound clips. So the
  cold-start figures say little about machine noise. The after-speech
  replay below is the case the hold is for.
- **Much of the cost comes from real distant speech**, not from machine
  noise mistaken for voice. DEMAND's own description of its scenes
  (DEMAND.pdf, §2) points to people in most of the classes behind the
  failure:
  - a busy office cafeteria, a university restaurant at lunchtime, the
    main transfer area of a busy subway station, a town square with many
    tourists, a café terrace on a public square;
  - public transport: a subway and a public transit bus;
  - also, among the rest, a well-visited city park, a sports field with
    activity nearby, a small office with three people using computers, and
    a hallway with individuals and groups passing by.

  The living room is described only as "inside a living room". What the
  detector hears there (shown voice on 9 % / 16 % of hops at −48 / −40,
  class means) was not checked.
- **"Keep talking…" is unchanged**, by design: the hold never shows it.

### After speech (information, no bar, added after review)

G1's streams start cold, so they understate the hold's cost in the case
the hold exists for: noise in a pause after the user has spoken, when the
column already shows a position.

- **Method.** The same hook records (the real hook on the real noise
  streams) were replayed through the same shipped functions (`stripReplay`,
  `cueRowStates`, `createResonanceHold`). The resonance worker's state was
  replaced by one established position for the whole stream: u 0.5,
  fill 1, 30 voiced s, verdict "score", narrowband decided off, long since
  resume. This is `hold-report.mjs`'s "After speech" section.
- **Not modelled.** The worker's own changes in the noise (verdict,
  settling, the narrowband detector) are left out; only the hook's flags
  and, for CAND, the hold move.
- **Reproduced.** The reviewer's own script on the same records gave the
  same figures.

With a position, BASE draws the thumb whenever the row is not idle, so
BASE's thumb time here equals its cold-start not-idle time.

| level | thumb drawn BASE → CAND | Δ | CAND / BASE | clips Δ > 15 points | largest clip Δ |
|---|---|---|---|---|---|
| −48 dBFS | 6.24 → 10.92 % | +4.68 | 1.75 | 21 | +44.4 (DEMAND SCAFE) |
| −40 dBFS | 7.63 → 15.49 % | +7.86 | 2.03 | 35 | +56.9 (DEMAND SCAFE) |

Against G1's cold-start figures: +1.63 / +3.22 points, with 6 / 18 clips
over +15.

Per class and source, thumb drawn BASE → CAND (%):

| class (clips) | −48 dBFS | −40 dBFS | clips Δ > 15, −48 / −40 |
|---|---|---|---|
| public / café (25) | 12.91 → 30.70 | 22.74 → 47.62 | 14 / 16 |
| living room (5) | 16.07 → 30.59 | 28.87 → 45.63 | 3 / 3 |
| transport (15) | 13.96 → 21.04 | 19.17 → 37.57 | 4 / 10 |
| traffic (13) | 5.65 → 7.22 | 3.35 → 7.66 | 0 / 1 |
| outdoor (15) | 7.23 → 9.27 | 3.40 → 7.66 | 0 / 2 |
| mains hum / transformer / ballast (14) | 2.12 → 3.49 | 3.49 → 7.60 | 0 / 2 |
| fans / PC / coil whine (14) | 1.68 → 2.11 | 1.26 → 3.14 | 0 / 1 |
| office (10) | 4.15 → 5.67 | 0.37 → 1.98 | 0 / 0 |
| kitchen / washing (10) | 5.18 → 5.58 | 0.17 → 0.97 | 0 / 0 |
| fridge / freezer (12) | 1.18 → 1.82 | 0.72 → 1.36 | 0 / 0 |
| HVAC (14) | 0.64 → 1.25 | 0.46 → 1.07 | 0 / 0 |
| washing machine / kitchen appliance (10) | 1.60 → 1.60 | 1.57 → 2.37 | 0 / 0 |
| **source: DEMAND (85)** | 9.71 → 17.63 | 12.43 → 25.02 | 21 / 31 |
| **source: Freesound (72)** | 2.15 → 3.01 | 1.96 → 4.24 | 0 / 4 |

- **Without the public / café class:** thumb 4.98 → 7.18 % (7 clips over
  +15) at −48 and 4.76 → 9.40 % (19 clips) at −40.
- **Without the two word-rule clips:** 6.31 → 11.06 % and 7.71 → 15.62 %,
  with the same clip counts (21 / 35).
- **Machine noise is not free after speech.** At −40 dBFS, fans, mains hum,
  traffic, outdoor and office noise roughly double to quintuple their small
  BASE shares. Single machine-class clips rise a lot (−40 dBFS):
  - a computer hard drive (fs__254493, fans): 17.0 → 43.3 %;
  - an electric-arc buzz (fs__776446, mains): 38.8 → 64.4 %;
  - a commuter train (fs__704618, mains): 5.8 → 29.2 %. It runs across
    several stops, and whether it holds announcements was not checked.
- **Street traffic.** Evening traffic in a city street with horns
  (fs__439218) goes 19.3 → 58.3 % at −40 dBFS; voices in it were not
  checked.

### G2–G4: PASS

Every render point (25 ms) and every tick:

- **Speech** (811 356 render points, 81 120 ticks):
  - G2: the thumb's u differs on 0 of the 754 009 points where both arms
    draw.
  - G3: the pitch row differs on 0 render points and 0 ticks.
  - G4: the resonance state or thumb differs on 0 points where BASE is not
    idle. The 57 347 points that differ are all ones where BASE is idle.
- **Noise only** (753 600 render points, 75 046 ticks): G2 0 of 21 560; G3
  0 / 0; G4 0 / 0. The 18 310 points that differ are all ones where BASE is
  idle.
- **Reused speech inputs, spot check.** `pause-row.mjs` was re-run on
  clean, pink −48 and AC −40 (36 streams). The hook records were
  byte-identical to the diagnosis's, 36 of 36.

### G5: PASS

- `npm run lint`: clean.
- `npm run test:unit`: 76 / 76 scripts.
- `npm run build`: OK.
- Cue-strip tests:
  - `cue-strip-model-test.js` 95 / 95, with 23 new hold checks;
  - `cue-meter-geometry-test.js` 8 / 8;
  - `voice-gate-display-test.js` 48 / 48;
  - `cue-strip-wiring-test.js` 14 / 14, with 5 new wiring checks.
- `scripts/cue-strip-smoke.mjs`:
  - phone 97 / 97, p402 97 / 97, p360 97 / 97, desktop 103 / 103;
  - every info popover opens, wraps, is on top and stays inside the
    viewport. At 360 × 690 the resonance popover is 453 px tall. The
    phone-quality-audio popover (notice + info + direction note) reaches its
    80 dvh cap and scrolls inside, as designed.
  - The inputs were made by `cue-strip-smoke-wavs.mjs` from LibriSpeech
    test-clean readers 121 (woman) and 61 (man).
- `scripts/resonance-lab/lab-layout-smoke.mjs --panel=0`: 78 / 78 (no box
  moved).

### What changes for the user (on this branch)

- **A pause no longer clears the streak.** In quiet or noisy pauses of up
  to about 5 s, the resonance thumb stays, dimmed, at its last position.
  The streak no longer restarts at every pause or at the first moment of
  resumed speech.
  - The trail averages 12–13 points instead of about 2.
  - The streak spans about the last 40 s instead of about the last 4 s.
  - The thumb no longer disappears in 1–5 s pauses (before: 9–100 %
    depending on the floor; 74 % even with no added noise).
- **After more than 5 s without speech** the column goes to "—" and the
  streak starts over, as before.
- **The info text now says:**
  - "The streak shows about the last 40 s and starts over after about 5 s
    without speech."
  - "Readings depend on the microphone and how you hold or wear it, so
    compare yourself on one device, held or worn the same way."
- **The cost.** Wherever the voice detector hears voice in the background,
  the column keeps a stale position on screen for up to 5 s after each
  such moment. Most of these places have other people talking: cafés, a
  station, a square, a metro or bus. DEMAND's living-room recording does
  this too, and so do a few machine and traffic recordings.
  - In a pause after speech, the position is drawn 10.9 % of the noise's
    time instead of 6.2 % at −48 dBFS, and 15.5 % instead of 7.6 % at
    −40 dBFS (pooled over the 157 clips).
  - In the babble scenes it is drawn 31–48 % of the time instead of
    13–23 %.
- **Screen readers.** In a held pause the summary reads like a live
  position (band words and "… than your start"), as it already does today
  in quiet pauses. With the hold this happens in every pause of up to 5 s.
  Before, a noisy pause read "no voice right now". Not changed here; see
  below.

### For the owner's decision (nothing below was tried)

- **Adopt as is.** This overrides G1: the streak fix and the noisy-pause
  thumb, at the cost above. The after-speech figures are the ones that
  describe that cost; the cold-start G1 figures understate it.
- **Revert.** The trail then holds about 2 points again, so the streak
  sentence must go back to something true for that behaviour (about the
  last 4 s). The device sentence holds either way.
- **A narrower candidate, for a new pre-registered round.** For example,
  hold only across the ~130 ms onset blink, or only in pauses quieter than
  the preceding speech. This would need new targets and guards before any
  result; it was not measured here. Such a round should:
  - guard noise after speech (an established position), not only
    cold-start noise;
  - split the noise guard into a babble / talker class and a speech-free
    class, and screen the speech-free list, for example by listening or
    with a speech detector.
- **Screen-reader wording (separate decision).** The held summary could
  say it is the last reading, for example by adding "(last reading)". That
  would change quiet pauses on `main` too, so it was left out of this
  candidate.

### Deviations from the plan

1. **Fetch flag.** The fetch script ran with `python -P`, not `-I`: `-I`
   also hides the user site-packages that hold numpy. `-P` still keeps the
   script's and the working directory's paths off `sys.path`. Downloads
   stayed in their own folder.
2. **Streak rounding.** "Rounded to 5 s" fell on a tie (42.5 s); it was
   resolved as described above.
3. **Word rule.** The plan drops a Freesound sound whose title or tags
   contain a voice word. The fetch script matched whole words only, so two
   inflected forms passed:
   - fs__65808 (traffic), "talking traffic lights2.mp3": a pedestrian
     crossing whose lights talk;
   - fs__843696 (mains hum), tagged "musical" and "chiptune".

   `voice_word()` now matches each stem with common English endings
   (talking, musical, children, singers); a plain substring test would also
   have dropped "passing" and "crossing". The evaluated list was not
   re-selected. `hold-noise-fetch.py --check-list` marks the two clips
   (`wordRuleMiss` in the list), and `hold-report.mjs` reports the figures
   without them (above): G1 fails the same way.

   Not excluded by the rule, but noted:
   - fs__634551 (a refrigerator with a sound machine playing crickets);
   - fs__845520 and fs__776446 (designed electrical effects, not room
     noise);
   - fs__848744 (a few birds in the background).
4. **Freesound queries.** The plan fixed the classes, caps and rules, not
   the search queries. The queries are in `hold-noise-fetch.py`. The
   Freesound fetch started at 12:30 PM (US Central; the first cached search
   page), 9 minutes before the DEMAND-only G1 result (12:39 PM, already a
   FAIL). The script, queries included, was committed at 12:45 PM, and the
   Freesound clips entered G1 at 1:33 PM. Nothing in the record shows that
   the queries changed after 12:39 PM, but nothing pins them before it
   either.
   - DEMAND alone fails G1 more clearly than the pooled set: thumb +5.74
     points at −40 dBFS, against +3.22 pooled.
   - G1 is therefore also reported per source (above).
   - The candidate did not change between the two results: all 170 DEMAND
     rows, the speech rows and the speech G2–G4 counts are identical in
     both summaries.
5. **Device sentence.** The plan's wording was "the microphone and how it
   is held". It became "how you hold or wear it", because a headset or
   boom microphone is worn, not held. This is text only, not a bar.

No other changes from the plan.

### Reproduce

```
python -P scripts/resonance/mobile/hold-noise-fetch.py --only=demand   # then --only=freesound
python -P scripts/resonance/mobile/hold-noise-fetch.py --check-list    # marks the word-rule clips; no download
for i in 0 1 2; do node scripts/resonance/mobile/hold-noise-run.mjs --shard=$i/3 & done; wait
for i in 0 1 2; do SO_TAP=0 node --import ./scripts/session-oracle/lib/register.mjs scripts/resonance/mobile/pause-row.mjs \
  --runs=build/resonance-mobile/hold/runs --out=build/resonance-mobile/hold/hook --shard=$i/3 & done; wait
node scripts/resonance/mobile/hold-report.mjs      # speech from build/resonance-mobile/pause (the diagnosis's runs)
```

- **Speech inputs.** `pause-queue.sh` and `pause-row.mjs`, as in the
  diagnosis.
- **Clips.** Under `C:/Coding Projects/Syrinx-cache/noise-real/clips/`.
  Every download and clip is pinned by sha256 in the list. No audio is
  committed.
- **Review additions.** `hold-report.mjs` prints the after-speech replay
  and the word-rule figures from the same hook records; no new runs are
  needed. Its earlier output is unchanged line for line.
