# Noise notch: held-note robustness (2026-10-04)

> **Correction (2026-10-05, round 2) — read [Round 2](#round-2-2026-10-05-reverted-to-bc42ad0) first; it supersedes everything below.**
> Round 1 (cb00425) also regressed interferer handling (a review confirmed four delays, reproduced
> by the round-2 suite: a hum that changes frequency after switching on, a hum masked by a note that
> moves or ends into continuous speech, a beating hum whose trough meets a short pause, a hum on a
> held note's track). The round-2 candidate (`R8`) closes those and keeps the breath gains, but
> never notches a tonal source that itself cuts out for 0.15–1 s every few seconds — the
> repeated-holds signal by construction. By the strict decision rule **`src/dsp/noise-notch.js` is
> bc42ad0's module again** (comment-only additions). Every held-note shape below is a **known
> limitation**: repeated holds with breaths, mid-hold glides / steps, speech → hold, phonation in
> the stream's first observation windows, holds ≥ 20 s. Round 1 and §1–§8 are **Historical
> (superseded 2026-10-05)**.

> **Historical (superseded 2026-10-05). Correction (2026-10-04, round 1) — read [Round 1](#round-1-2026-10-04-latch-reverted-breath-re-birth--glide-handoff-on-bc42ad0) first.**
> The in-sound latch (`D6`, 6f8be18) described in §1–§8 below **regressed interferer handling**
> (an adversarial review confirmed it, and the round-1 suite reproduces it through the real worker):
> a hum present from stream start was never notched when speech began in the first ~0.6 s; weak
> hums (+3/+6 dB) switching on mid-speech were never notched; capture pre-roll (dither / fade-in)
> turned a session-start hum into a 20 s switch-on; and "breaths 0.3–2 s" did not cover catch
> breaths < 0.3 s. **The latch is reverted.** What ships is bc42ad0's onset rule plus a
> line-gated breath re-birth and a glide/step handoff (round 1). Speech → hold and phonation in the
> stream's first observation windows are again **known limitations** (as on bc42ad0). §1–§8 are
> **Historical (superseded 2026-10-04)**.

**Historical (superseded 2026-10-04, see Round 1):** shipped an **in-sound latch** and **new-note re-births** in
[src/dsp/noise-notch.js](../src/dsp/noise-notch.js) (configuration `D6` below). The 2026-10-03
onset-born rule ([noise-notch-voice-safety-2026-10-03.md](noise-notch-voice-safety-2026-10-03.md))
keyed on "first seen *at* an onset". Three routine exercise shapes escaped it and were notched
~5 s in, then blanked by the ghost veto. With D6, every held-note scenario in a 1008-run suite
(16 and 48 kHz) is reported at the no-notch ceiling, except phonation that is already sounding in
the stream's first chunk. Every interferer case and every committed oracle is unchanged. Session
accuracy is unchanged. `pitch-worker.js` is unchanged.

**Corrected guarantee** (replaces "held notes ≤ 20 s are never notched"): a note that starts
after the stream's first audio is never notched before it has sounded for 20 s since its latest
start. "Start" means its onset, the end of a breath (the latch release or a sound offset), or a
pitch move of more than 3 Hz inside the sound. This holds whether the note is reached by a glide
or step, comes straight out of speech, or is one of a series of same-pitch holds separated by
breaths (silent or audible). Not guaranteed:

- phonation already sounding when the stream's first chunk arrives (§7);
- holds of 20 s or more (a 20.0 s hold can promote on the observation just after it ends, as
  before).

Commits:

- `fix(oracle)` (1724c4f): `scripts/noise-augment-oracle.js` flush path. Baseline-match step §2.
- `fix(noise)`: this change, plus tests and docs.

Scratch work lives in `build/nh/` of the `Syrinx-pitch` worktree (gitignored).

## 1. The three gaps, reproduced through the real worker

The suite drives the real `src/dsp/pitch-worker.js` in Node with a fake worker `self`. It feeds
25 ms chunks at 16 kHz and at 48 kHz (the streaming resampler is live at 48 kHz). The cells below
are % of hold frames reported at pitch (|p/f0 − 1| < 0.08), with the number of scenarios where a
notch promoted onto the voice in parentheses. HEAD = 2ee7ab5 (the bc42ad0 notch).

| family (scenarios per SR) | origin/main f92b11a | HEAD 16 kHz | HEAD 48 kHz | **D6 16 kHz** | **D6 48 kHz** | no notch |
|---|---|---|---|---|---|---|
| mid-hold glide/step, 20–150 c up and 50 c down, at 2/4/8 s, 16 s holds (160) | 47.4 (160) | 74.3 (149) | 72.9 (145) | **100.0 (0)** | **100.0 (0)** | 100.0 |
| speech → 12 s hold, gap 0/60/150 ms, hold 0/−10 dB re speech (72) | 43.0 (72) | 66.6 (48) | 66.9 (48) | **100.0 (0)** | **100.0 (0)** | 100.0 |
| 3 × 8 s / 3 × 10 s holds, breaths 0.3–2 s (80) | 20.3 (80) | 77.0 (63) | 76.7 (62) | **100.0 (0)** | **100.0 (0)** | 100.0 |
| same, audible inhalation −20/−30 dB in 0.3–1 s breaths (24) | 17.0 (24) | 65.9 (24) | 65.7 (24) | **100.0 (0)** | **100.0 (0)** | 100.0 |
| phonation from t = 0.15 s, 8/12/20 s (24) | 44.4 (24) | 44.8 (24) | 44.9 (24) | **100.0 (0)** | **100.0 (0)** | 100.0 |
| 3 s speech from t = 0, then a hold (8) | 41.7 (8) | 48.9 (8) | 60.5 (7) | **100.0 (0)** | **100.0 (0)** | 100.0 |
| phonation from sample 0, 8/12/20 s (24) | 45.7 (24) | 46.2 (24) | 46.1 (24) | 46.2 (24) | 46.1 (24) | 100.0 |
| steady holds 8/12/20 s × 120–250 Hz × 0–25 c vib / 15 c drift × modal/breathy (96) | 43.6 (95) | 99.9 (28) | 100.0 (27) | 99.9 (28) | 100.0 (27) | 99.9 |
| vowel change a→u mid-hold; ±10 dB messa di voce (16) | 35.4 (16) | 100.0 (0) | 100.0 (0) | 100.0 (0) | 100.0 (0) | 100.0 |
| **all (504)** | 39.6 | 75.8 | 75.5 | **97.4** | **97.4** | 100.0 |

- **Steady (28) / (27).** These are the 20 s holds, promoted on the trailing observation 0.1 s
  after the note ended, with 100 % reported. This is the pre-existing 20 s edge, unchanged.
- **Painted** (display replay: median-3 + paint gate, no hold bridging) tracks the worker column
  within 0.6 pp in every cell.

Mechanisms (matches the review's three findings):

1. **Glide or step.** A move of more than `matchHz` (3 Hz) spawns a new track 2+ s into the
   sound. There is no onset at that time, so the track is not onset-born. It is notched ~5 s
   later.
2. **Speech into a hold.** A 512 ms observation window never dips 10 dB across gaps under
   ~0.3 s. At session start the first observation has no history.
3. **Repeated holds.** Re-birth applied only to tracks younger than 2 s, so same-pitch holds
   accumulate on one track until its span passes 20 s.

## 2. Baseline match and harness parity

- **Oracle flush path (own commit, 1724c4f).** `noise-augment-oracle.js` appended the tracker's
  end-of-stream flush (the last L = 2 frames of every track) raw. Those frames, always inside the
  noise-only tail, skipped the veto, the above-range null and the guard. A shared `postFilter()`
  now runs the worker's order for the loop and for the flush, in pitch mode and in the gender
  voiced timeline.
  - Re-baseline on HEAD modules (default noises + sleep-birdies, 20/10/5 dB): pink tail FV
    0.7 / 0.8 / 0.8 → **0.0 / 0.0 / 0.0**.
  - Every other cell is unchanged.
  - Gender mode is identical before and after.
- **Real worker vs mirror.** The candidate module with every new option off is message-for-message
  identical to the production worker: **0 mismatches** in 8279 messages (16 + 48 kHz glide,
  speech→hold, t = 0, repeat, and hum + note).
- **Implementation vs candidate.** The shipped `src/dsp/noise-notch.js` matches candidate `D6`:
  **0 mismatches in 137 572 messages**. That covers 160 runs: every 7th suite scenario at 16 and
  48 kHz, plus 19 noise + voice mixes. The session oracle on `src/` (tag `nhF`) equals the
  candidate run (`nhD6`) on all 4 sessions.
- **2026-10-03 grids re-run through the real worker** (the 10-03 pass used the chainlib mirror).
  HEAD reproduces the 10-03 tables exactly:
  - main grid 94.0 / 93.9 / 94.0 / 94.0 (= no-notch ceiling);
  - requirement grid 100 / 100 / 100 / 70.6.

## 3. Candidates

All candidates are options of one scratch module (`build/nh/tree/src/dsp/noise-notch.js`),
selected per run.

| id | design |
|---|---|
| **R** | Reviewers' patch set. Obs-level in-sound latch (released when band energy returns within 10 dB of the pre-onset floor). Births before `energyHist` holds 2 s are onset-born ("onset unknown"). New tracks inherit `onsetBorn`/`firstObs`/hits from an unpromoted onset-born track seen within `missSec` and 100 c. Any-age re-birth of unpromoted onset-born tracks after ≥ 2 missed observations. |
| **S** | Principled alternative (ii). Every track needs ≥ 3 observations seen at full strength while the 500–4000 Hz energy is ≥ 10 dB below its 10 s maximum (speech absent), else a 20 s fallback (30 s variant), reset by co-dips. |
| D1 | Chunk-level (25 ms, 50 Hz–4 kHz biquad band) onsets. In-sound latch released after 0.3 s back within 10 dB of the floor. Line-level co-dip re-birth (line unseen or −6 dB while the band is −6 dB, 2 observations). |
| D2 / D5 | D1 / D4o20 plus a pairwise evidence fast path. An onset-born line seen at full strength in two observations whose band energy differs by ≥ X dB promotes at 5 s. D5 skips the first 0.6 s after birth. |
| D3r3 / D4 / D4o20 | Re-birth only at sound offsets: the latch release (D3), plus an offset ≥ 15 / 20 dB below the last second's maximum followed by line-gone-while-band-down (D4 / D4o20). |
| **D6** | D4o20, but re-births restart only the onset-born **delay clock** (`noteObs`). Duty keeps the track's whole history. |
| *u | The same, with "onset unknown at session start" counted as onset-born. |

## 4. Results

### 4a. Held-note suite (16 kHz; % reported, (# promoted onto voice))

| family | HEAD | R | S | D1 | D4o20 | D5x8 | **D6** |
|---|---|---|---|---|---|---|---|
| glide / step | 74.3 (149) | 100 (0) | 100 (0) | 100 (0) | 100 (0) | 100 (0) | **100 (0)** |
| speech → hold | 66.6 (48) | 100 (0) | **59.8 (54)** | 100 (0) | 100 (0) | 99.8 (2) | **100 (0)** |
| repeated holds | 77.0 (63) | 100 (0) | 100 (0) | 100 (0) | 100 (0) | 100 (0) | **100 (0)** |
| repeated, audible inhalation | 65.9 (24) | — | — | 100 (0) | 100 (0) | 100 (0) | **100 (0)** |
| from t = 0.15 s | 44.8 (24) | 100 (0) | 100 (0) | 100 (0) | 100 (0) | 100 (0) | **100 (0)** |
| speech from t = 0, then hold | 48.9 (8) | **78.1 (5)** | 100 (0) | 100 (0) | 100 (0) | 100 (0) | **100 (0)** |
| from sample 0 | 46.2 (24) | 100 (1) | 100 (0) | 46.2 (24) | 46.2 (24) | 46.2 (24) | 46.2 (24) |
| vowel change | 100 (0) | 100 (0) | **77.2 (4)** | 100 (0) | 100 (0) | 100 (0) | **100 (0)** |
| messa di voce ±10 dB | 100 (0) | 100 (0) | 100 (0) | 100 (0) | 100 (0) | **47.5 (8)** | **100 (0)** |

D3 with a 0.3 s release and no offset rule (D3r3) leaves audible-inhalation breaths at 65.9 %.
The latch never releases while inhalation keeps the level above the floor. D4 adds the offset
rule.

### 4b. Interferer side (suite through the real worker)

Cells are speech correct % / pause false-voicing %, means over cells.

| part | HEAD | R | D1 | D1u | D4 (offset 15) | D5x8 | D6u | **D6** |
|---|---|---|---|---|---|---|---|---|
| interferer from t = 0, speech from 3 s (7 classes × +10/+5 dB × 2 speech offsets) | 75.0 / 5.0 | **69.0 / 48.6** | 75.0 / 5.0 | **69.7 / 38.3** | 75.0 / 5.0 | 75.0 / 5.0 | **68.3 / 57.4** | **75.0 / 5.0** |
| switch-on at 20 s during FDA speech (the 10-03 onset-mid design), scored over 30 s | 68.6 / 37.9 | 67.7 / 46.4 | 68.2 / 39.7 | 68.2 / 39.7 | 68.4 / 40.6 | 70.5 / 14.7 | — | **68.6 / 37.9** |
| switch-on at 20 s in a silent pause, speech again at 40 s (pause FV / speech / gap FV) | 57.4 / 71.1 / 2.3 | = | = | = | = | = | — | **=** |

Noise-only, 40 s, all 16 synthetic classes plus a 100 ms digital-zero lead for the tonal ones:

- D6 equals HEAD in every cell. Tonal classes promote at 5.4 s; broadband classes never promote.
- R, D1u and D6u promote a session-start hum at 20.4 s, so the first 20 s are painted. Fan-hum
  painted over 10–40 s: 34.8 % vs 0 %.

**D6 is identical to HEAD in every interferer cell.** D4o20 differed in one cell (hum-rich60
+5 dB, −1.2 pp), through slot competition among 5 lines after a clock reset restored a weak
line's duty. D6's duty-preserving re-birth removes that.

### 4c. Decision

| | voice suite | interferer suite | committed oracles | sessions |
|---|---|---|---|---|
| R | t = 0 fixed; speech-from-start 78 % | session-start hums 20 s (start 69.0 / 48.6); mid-session resets | (would regress the 8 s-lead oracle) | — |
| S | speech → hold 59.8 %, vowel change 77.2 % (speech-absent evidence fires on a hold after speech) | — | — | — |
| D1 | ceiling except sample 0 | co-dip resets hum lines (hum-rich120 +10 mid-session 20 → 29 s) | — | — |
| D2 / D5 (evidence) | soft breathy holds after speech (D2) and messa di voce (D5: 47.5 %) notched at 5 s | mid-session 37.9 → 14.7 % FV | — | — |
| D4o20 | ceiling except sample 0 | 1 cell −1.2 pp | identical | notched a weak real room-hum line on a private session recording, costing posted accuracy there |
| **D6** | **ceiling except sample 0** | **identical** | **identical** | **accuracy unchanged** |

**Why D6.**

- It is the only design that is at the ceiling on every voice family a start can be observed for,
  and identical to HEAD on every interferer and committed-oracle cell.
- It changes notch activity on the private session recordings only where the change measured better (results kept outside this repository).
- Its rules are one-directional for interferers. Making a line onset-born, or restarting its delay
  clock, can only delay a promotion, and the delay applies only when the evidence says "a sound
  stopped":
  - The latch release needs the band back near the floor from before the sound. An unpromoted
    onset-born interferer would hold the band above that floor, so the release cannot happen
    while it plays.
  - The offset rule needs the line itself to vanish or weaken while the band is down. A hum line
    in a speech pause keeps its power. A hum line masked by speech has the band up.

**Why not the evidence fast path.** It is the only family that would *speed up* mid-session
interferers (switch-on FV 37.9 → 14.7 %). But "line at full strength while the band level
changes by X dB" is also what a soft hold after speech and a crescendo/decrescendo do. A messa di
voce is a core voice exercise. At X = 8 dB, D5 notched 8/8 of them. No X both catches hums at
+5 dB SNR (a 6.2 dB speech/pause band ratio) and spares those.

## 5. Implementation (D6)

`src/dsp/noise-notch.js` (new `NOTCH_DEFAULTS`: `latchReleaseSec` 0.3, `offsetDb` 20,
`offsetObs` 5, `dipDb` 6):

1. **Per-chunk band energy.** A 50 Hz high-pass plus 2 × 4 kHz low-pass RBJ biquad cascade runs
   on a scratch copy of the raw 16 kHz chunk.
2. **Chunk-level onset.** The chunk energy is ≥ 10 dB over its 2 s minimum. Exact digital silence
   before the stream's first audio is excluded from that reference, so a hum present when audio
   starts flowing still promotes at ~5 s. This is tested.
3. **The latch.**
   - A chunk-level onset or the existing observation-level onset sets it.
   - It releases when the last 0.3 s returns within 10 dB of the pre-onset floor (in chunk units).
     If the latch came from an observation-level onset with no chunk reference, it releases at
     observation level instead.
   - A track born while latched is onset-born.
4. **Sound offset.** The last 0.3 s is ≥ 20 dB below the loudest chunk of the preceding second.
   It re-arms once the level is back within 10 dB of that maximum.
5. **Re-birth of unpromoted onset-born tracks.** `noteObs = now` is set on either of two events:
   - the latch release;
   - within 5 observations of an offset, the line is unseen or ≥ 6 dB under its median power
     (last 9 sightings) while the band is ≥ 6 dB under its 2 s maximum.
6. **Promotion.** An onset-born track needs `now − max(noteObs, firstObs) + 1 ≥ 20 s` of
   observations, with duty ≥ 0.9 over its whole life. Every other rule (young re-birth,
   seen-to-promote, cascade keying, veto) is unchanged.

**CPU.** Full worker step, interleaved best of 5, one process:

- speech slice A (100 s): 0.367 → 0.377 ms per 25 ms chunk;
- speech slice B (100 s): 0.372 → 0.384 ms per 25 ms chunk.

That is +0.01 ms, or 0.05 % of the hop.

## 6. Oracles: no regression

| oracle | HEAD (bc42ad0 notch) → D6 |
|---|---|
| `noise-augment-oracle.js pitch --frontend=tracker` (flush-fixed): clean + white, pink, fan-hum, mains-complex, babble, crickets, cicadas, sleep-birdies × 20/10/5 dB | **all 32 cells identical**. fan-hum 78.0 / 77.8 / 76.7 % correct; mains 77.7 / 77.9 / 77.9; sleep-birdies 86.0 / 85.4 / 83.9 (tail FV 0 / 1.2 / 1.2) |
| same, notch agent's extra classes (fan-wobble0.6 / 1.5, fan-drift, hum-rich120 / 60, fan-wobble0.6+rich × 10/5 dB) | **all 12 cells identical** (e.g. fan-wobble0.6 +10 74.3 %, hum-rich120 +10 74.5 %) |
| same, vocadito (40 tracks) × fan-hum / mains / sleep-birdies × 20/10/5 | identical except clean 97.4 → 97.6, fan-hum +20 90.4 → 90.5, mains +20 86.0 → 86.2 (a sung line no longer promoted in clean audio) |
| `noise-augment-oracle.js gender` (31 speakers × 7 default noises × 3 SNRs, noise-only VAD) | **identical output** |
| `voicing-robustness-shootout.js` (FDA + vocadito speech per criterion; noise-only every class incl. babble, resonant q5/q2) | **byte-identical output** |
| 10-03 held main grid (480) / requirement grid (120), real worker | identical: 94.0 (ceiling) / 100 · 100 · 100 · 70.6 |
| mid-session switch-on, FDA speech, 30 s after onset (10-03 onset-mid design, 7 classes × 2 SNR × 2 offsets) | identical (68.6 % correct / 37.9 % gap FV; promotion 20.1 s) |
| `tests/dsp/noise-notch-test.js` | 52 / 52. The same file on HEAD modules fails 14: every new gap check, plus the mid-speech switch-on check, which promotes at 5.2 s on HEAD (see §7) |
| `boersma-ac-test` 41/41, `pitch-gate` 26/26, `pitch-paint-gate` 36/36, `pitch-smoothing` 15/15, `audio-utils` 67/67, `npm run test:dsp` 28/28, lint, build | pass |

### Sessions

The session oracle (`scripts/session-oracle/`) was run on `src/` with cons / strict references
over the private session recordings: no accuracy regression, and a weak real room-hum line that
the previous module notched during continuous speech is no longer notched. Results on the private session recordings are kept outside this repository.

## 7. Residual limitations and trades

### Phonation from sample 0

A note already sounding in the stream's first chunk has no pre-onset reference. It is the same
signal as a hum present when audio starts, so it keeps the 5 s promotion: 46.2 % of hold frames
reported.

Making such tracks onset-born (D6u, the reviewers' "onset unknown") costs every session that
starts with a hum:

- noise-only: painted for the first 20 s (fan-hum 34.8 % painted over 10–40 s vs 0 %);
- with speech from 3 s: correct 75.0 → 68.3 %, pause FV 5.0 → 57.4 %;
- it would regress the committed oracles' 8 s noise lead and noise-only cells.

Phonation that starts ≥ 0.15 s after the first audio chunk is covered at 16 and 48 kHz.

### Interferer switching on during dense speech

This is the latch's cost, and it is the same physics as speech running into a hold: a stable
line appearing inside continuous voice.

HEAD made such a line onset-born only if the 512 ms band energy had dipped 10 dB in the
preceding 2 s:

- **FDA speech (0.4–1.2 s gaps):** onset-born → 20 s in HEAD too, which is why the onset-mid
  oracle is identical.
- **Dense speech (40–120 ms syllable gaps, a 1.2 s pause every 8 s):** HEAD promoted at ~5 s.
  D6 takes 20 s, the documented switch-on latency.

`build/nh/dense.mjs` (synthetic speech, 40 s, interferer at 10 s, scored over 30 s). Cells are
correct % / pause FV % / promotion (s):

| speaker F0 | interferer | SNR | HEAD | D6 |
|---|---|---|---|---|
| 210 Hz | fan-hum | +10 | 97.2 / 1.8 / 5.1 | 84.8 / 61.4 / 20.1 |
| 210 Hz | fan-hum | +5 | 72.7 / 8.8 / 5.1 | **27.5** / 59.6 / 20.1 |
| 210 Hz | hum-rich120 | +5 | 59.5 / 0 / 5.1 | **22.7** / 57.9 / 20.1 |
| 210 Hz | fan-wobble0.6 | +5 | 66.1 / 10.5 / 5.1 | **26.5** / 60.5 / 20.1 |
| 210 Hz | mains-complex | +10 / +5 | 93.0 / 85.0 | 93.0 / 78.6 |
| 120 Hz | fan-hum / mains / fan-wobble +5 | | 89.9 / 87.6 / 90.1 | 96.1 / 91.8 / 97.8 (a 120 Hz notch vetoes the user's own 120 Hz voice) |
| **mean (16 cells)** | | | **88.4 / 31.7** | **79.7 / 59.4** |

For a 210 Hz voice, a 120 Hz fan switching on mid-utterance at +5 dB captures the decode for
~15 s longer than HEAD.

The only mechanism measured that recovers this is the evidence fast path. D5x8 restores HEAD at
+10 dB, but not at +5 dB, and it notches messa di voce (§4c).

**Flagged for a human decision.** The voice-safety gain is concrete: the three exercise shapes
go from 66–77 % to 100 %. The cost is the 10-03 accepted trade (mid-session interferers ~20 s),
now applied consistently instead of only after a dip.

### Other residuals

- **Holds of 20 s or more** are notched as before: requirement grid 30 s holds 70.6 %.
- **Synthetic speech and noise.** The held-note voices, dense speech and extra hum classes are
  synthetic. The sessions are the only real-voice check of the latch. Field-recorded hum
  validation is still pending, as in 07-19 and 10-03.

## 8. Rejected

- **R (reviewers' set as written):**
  - "onset unknown" makes every session-start hum a 20 s promotion (start 75.0 → 69.0 % /
    5 → 48.6 % FV);
  - any-age re-birth after ≥ 2 misses resets mid-session hums masked by speech (fan-wobble0.6
    +10 promotion 20 → 37 s; hum-rich120 never);
  - speech from t = 0 into a hold is still 78 % (no onset ever latched).
- **S (speech-absent evidence, ii):** a hold after speech is "speech absent" in the 500–4000 Hz
  band (speech → hold 59.8 %), and so is a vowel change to /u/ (77.2 %).
- **D1 (line-level co-dip):** resets hum lines masked by speech for 2 observations
  (hum-rich120 +10 mid-session 20 → 29 s).
- **D2 / D5 (pairwise evidence fast path):** voice false positives (soft breathy holds after
  speech; messa di voce 47.5 %).
- **D4 (offset 15 dB):** fires in speech pauses (fan-drift +10 mid-session 20 → 29 s).
- **D4o20 (offset re-birth restoring duty):** restored the duty of a weak intermittent room-hum
  line on a private session recording, costing posted accuracy there; one interferer cell −1.2 pp.
- **Inheritance across a glide:** redundant once tracks born inside a sound are onset-born.

## Reproduction

All commands run from the `Syrinx-pitch` worktree root. `build/nh/` is scratch.

```
node tests/dsp/noise-notch-test.js                                   # 52/52
node scripts/noise-augment-oracle.js pitch --frontend=tracker [--noises=fan-hum]
node scripts/noise-augment-oracle.js gender --noises=fan-hum
node scripts/voicing-robustness-shootout.js

# suite (variants in build/nh/variants.mjs; HEAD = build/nh/headtree, NEW = src/, MAIN = origin/main)
node build/nh/suite-held.mjs --variants=HEAD,NEW,noNotch --sr=16000,48000 --shard=i/n --out=F
node build/nh/suite-noise.mjs --part=nonly|start|midsp|midpa --variants=HEAD,NEW --out=F
node build/nh/agg-held.mjs DIR [--by=family+sr]; node build/nh/agg-noise.mjs DIR
node build/nh/grid.mjs --set=main|req --variants=HEAD,NEW      # 10-03 grids, real worker
node build/nh/dense.mjs --variants=HEAD,NEW                   # dense-speech switch-on trade
node build/nh/parity.mjs; node build/nh/parity2.mjs NEW D6 7  # bit-exactness checks
node build/nh/cpu.mjs

# candidate oracles: build/nh/tree is src+scripts with the option-flag module
NOTCH_VARIANT=D6 node --import ./build/nh/setopts.mjs build/nh/tree/scripts/noise-augment-oracle.js \
  pitch --frontend=tracker --noises=hum-rich120 --snrs=10,5     # (extra classes, --corpus=vocadito)

# session-oracle runs (scripts/session-oracle/) need the private session recordings (not in this repo)
```

---

## Round 1 (2026-10-04): latch reverted, breath re-birth + glide handoff on bc42ad0

> **Correction (2026-10-05) — Historical (superseded 2026-10-05, reverted in [Round 2](#round-2-2026-10-05-reverted-to-bc42ad0)).**
> R1.2, R1.6, R1.7 and the module comment overstated what `N13` guaranteed:
>
> - "A handoff can only delay a promotion, and only until the next pause" (R1.2, noise-notch.js):
>   false. The handoff revoke needed a ≥ 6 dB band dip observed for 0.7 s plus 3 sightings — about
>   a **1.5 s audio pause** after the 512 ms window's lag. Pauses of 0.3 / 0.5 / 0.9 s never revoked
>   it, and noise-only audio has no pause at all.
> - "Each needs evidence a stationary interferer does not produce" (R1.2, commit message,
>   CLAUDE.md): false. A completely steady hum got a fresh 20 s clock when a held note beside it
>   moved or ended into continuous speech (`r2int.mjs --part=masked`: 49 / 156 cells later than
>   bc42ad0, mean promotion 9.8 → 14.3 s); an onset-born hum that stepped frequency was handed off
>   to itself (`step`: 40 / 96 cells, alternating 115 / 121 Hz fans never notched noise-only); a
>   beating hum whose trough met a 0.25–0.6 s pause was re-born and the next syllable confirmed it
>   (`beatpause`: 34 / 240); a hum sharing a held note's track read as "the line dipped" in every
>   breath (`shared`: 48 / 144, 2 s / 0.4 s holds at −25 dB never notched).
> - "Every interferer cell notches no later than bc42ad0" (R1.6) held only for round 1's cells.
> - "A glide or step of ≤ 160 c from a held note carries the start over" (R1.7): not after a
>   0.15–0.2 s catch breath — the breath re-birth reset the parent's held time, so the handoff
>   never fired (breathstep family: 78.2 %, = bc42ad0).

**Historical (superseded 2026-10-05). Decision: SHIP** (the strict rule below holds in every cell). `src/dsp/noise-notch.js` =
bc42ad0's module plus three voice-side rules. 6f8be18's in-sound latch, chunk-level onsets,
latch-release re-birth and stream-start digital-silence handling are removed. `pitch-worker.js`
is unchanged. Candidate id in the suite: `N13`.

### R1.1 Suite

[scripts/notch-adversarial/](../scripts/notch-adversarial/README.md) drives the **real**
`src/dsp/pitch-worker.js` (fake worker `self`, 25 ms chunks) at **16 and 48 kHz** on bc42ad0's
module (`B`), 6f8be18's (`H`), the option-flag candidate module (`cand-notch.js`, `N*` / `C*`) and
`src/`. Checks before trusting it:

- **Parity.** `src/` vs candidate `N13`: **0 mismatches in 123 794 messages** (every 7th held
  scenario, both rates), and 0 in every sampled `start` / `weak` / `weak2` run (95 runs).
- **Reproducibility.** Re-running `B` and `H` on one shard each of `held` / `start` / `weak`
  reproduced the stored baselines exactly (204 / 204 variant-cells).
- **The review's findings reproduce** on `H` (tables below):
  - (a) never notched with speech from 0.1 / 0.2 s, 40 / 40 cells each;
  - (b) +6 dB P4 / P8 never notched in 9 / 16 cells each, pause FV 0 → 35.6 % and 5.0 → 33.2 %;
  - (c) promoted at 20.2–20.4 s after dither / fade-in pre-roll;
  - (d) 0.15 s catch breaths 74.8 %, every scenario promoted.

Parts:

- `held.mjs`: 536 held-note scenarios per rate. Steady holds; glides / steps of 20–150 c at
  2 / 4 / 8 s; speech → hold with 0 / 60 / 150 ms gaps; phonation from t = 0 / 0.15 s; speech from
  t = 0 then a hold; 3 × 8 / 10 s same-pitch holds with 0.15 / 0.25 / 0.3 / 0.5 / 1 / 2 s silent
  breaths and audible −20 / −30 dB inhalations; vowel change; messa di voce.
- `int.mjs --part=start`: 6 hum classes from the first sample. Speech from 0.1 / 0.2 / 0.4 / 0.6 /
  1 / 3 s or none, dense (P4) or sparse (P8). Also 100 ms zeros, 300 ms of 1e-5 dither and an
  80 ms fade-in as capture pre-roll.
- `int.mjs --part=weak`: a hum at +3 / +6 / +9 / +12 dB band energy over a broadband floor,
  switching on mid-utterance or in a pause, under dense / sparse / utterance speech, with 210 and
  165 Hz voices.
- `int.mjs --part=weak2`: beating hums (two fans 0.5 Hz apart) and 0.3 Hz AM hums at
  +6 … +18 dB. This is the breath re-birth's adversary.
- `handoff-adv.mjs`: 168 cells of a hum beside a held note. This is the handoff's adversary.
- `dense.mjs`: a hum switching on during dense speech.
- `fda.mjs`: real FDA voices × interferer, in 4 placements.
- `grid.mjs`: the 2026-10-03 grids.

### R1.2 What ships (`N13`)

1. **Breath re-birth.** This restarts an unpromoted onset-born track's 20 s clock. Its duty
   history is kept. It needs two things:
   - A sound offset: the 50 Hz–4 kHz band energy of the last 0.3 s is ≥ 20 dB under the loudest
     25 ms chunk of the preceding second, or that of the last 0.1 s is ≥ 18 dB under it (a catch
     breath).
   - Within 5 observations of the offset, the **line itself** dips ≥ 6 dB under its median power
     while the band is ≥ 6 dB under its 2 s max. The line power is read off the spectrum at the
     track frequency, independent of peak picking.

   It applies only to onset-born tracks. A stationary hum keeps its line power through pauses.
2. **Re-birth revokes.** Either of two conditions restores the clock:
   - The line is still a picked peak 0.7 s into the dip, in 3 consecutive observations. This is
     a note sitting on a hum's track.
   - The line is back at ≥ −6 dB of its pre-dip median in 2 consecutive observations while the
     band is still down. This is a beating or AM hum whose trough met a pause. `N12`, which lacks
     this condition, promoted weak2 beat +9 / +18 dB ~10 s late in 3 cells.
3. **Glide / step handoff.** Some lines are born not at an onset. Such a line is onset-born, with
   its **own** 20 s clock, when all of these hold:
   - it is within 160 c of an unpromoted onset-born line;
   - that line was held ≥ 1 s at duty ≥ 0.7;
   - that line vanished ≤ 1.5 s ago (the new line may be up to 0.6 s older than the vanishing);
   - the band holds.

   It is revoked (back to not onset-born) when it is still a peak 0.7 s into a band dip, in 3
   observations. That case is a hum the note had masked and then glided onto. A handoff can only
   delay a promotion, and only until the next pause.

Each rule can only *delay* the promotion of an onset-born line. Each needs evidence a stationary
interferer does not produce: its own line dipping in a pause, or a held note moving while the band
holds. Lines present before any onset are never onset-born, so session-start hums keep their 5 s
promotion.

### R1.3 Held notes

Cells are % of hold frames at pitch, with the number of scenarios promoted onto the voice in
parentheses. 16 + 48 kHz.

| family | n | bc42ad0 | 6f8be18 | **final (N13)** | no notch |
|---|---|---|---|---|---|
| mid-hold glide / step | 320 | 73.6 (294) | 100.0 (0) | **100.0 (0)** | 100.0 |
| repeated holds, 0.15 s breaths | 32 | 74.8 (32) | 74.8 (32) | **100.0 (0)** | 100.0 |
| repeated holds, 0.25 s | 32 | 74.3 (32) | 99.0 (1) | **100.0 (0)** | 100.0 |
| repeated holds, 0.3 / 0.5 / 1 s | 96 | 72.7 (96) | 100.0 (0) | **100.0 (0)** | 100.0 |
| repeated holds, 2 s | 32 | 85.1 (14) | 100.0 (0) | **100.0 (0)** | 100.0 |
| audible inhalation, 0.15 / 0.25 s | 32 | 67.3 (32) | 75.4 (24) | **100.0 (0)** | 100.0 |
| audible inhalation, 0.3 / 0.5 / 1 s | 48 | 65.9 (48) | 100.0 (0) | **100.0 (0)** | 100.0 |
| speech → hold (0 / 60 / 150 ms gaps) | 144 | 66.7 (96) | 100.0 (0) | 66.7 (96) | 100.0 |
| phonation from t = 0.15 s | 48 | 44.9 (48) | 100.0 (0) | 44.9 (48) | 100.0 |
| speech from t = 0, then a hold | 16 | 54.7 (15) | 100.0 (0) | 54.7 (15) | 100.0 |
| phonation from sample 0 | 48 | 46.2 (48) | 46.2 (48) | 46.2 (48) | 100.0 |
| steady holds 8 / 12 / 20 s | 192 | 100.0 (55) | 100.0 (55) | 100.0 (55) | 100.0 |
| vowel change; messa di voce | 32 | 100.0 (0) | 100.0 (0) | 100.0 (0) | 100.0 |
| **all** | 1072 | 75.2 | 96.1 | **90.0** | 100.0 |

- No scenario is worse than bc42ad0.
- The (55) steady cells are the 20 s holds. They are promoted on the trailing observation after
  the note ended, with 100 % reported. This is the pre-existing 20 s edge.

### R1.4 Interferers

Cells are promotion time in s with [never notched] counts, pause FV %, and speech correct %.

**Hum present from the first sample** (`start`, 372 cells). Final is identical to bc42ad0 in all
372.

| speech from | n | promo bc42ad0 / 6f8be18 / final | pause FV | speech |
|---|---|---|---|---|
| 0.1 s | 40 | 5.4 [0] / – [40] / 5.4 [0] | 11.7 / 60.0 / 11.7 | 87.5 / 79.7 / 87.5 |
| 0.2 s | 40 | 5.4 [0] / – [40] / 5.4 [0] | 16.3 / 60.0 / 16.3 | 85.3 / 72.7 / 85.3 |
| 0.4 s | 40 | 5.4 [0] / 25.4 [38] / 5.4 [0] | 4.5 / 60.0 / 4.5 | 86.8 / 75.4 / 86.8 |
| 0.6 / 1 / 3 s, none | 144 | 5.4–5.5, all three | equal | equal |
| 100 ms zeros, then speech at 0.2 s | 12 | 5.4 [0] / – [12] / 5.4 [0] | 8.7 / 66.7 / 8.7 | 78.7 / 67.8 / 78.7 |
| 300 ms 1e-5 dither (3 speech cases) | 36 | 5.1 [0] / 20.2 [0] / 5.1 [0] | 6.4–13.2 / 32.8–38.8 / = bc42ad0 | — |
| 80 ms fade-in (3 speech cases) | 36 | 5.5 [0] / 20.4 [0] / 5.5 [0] | 6.9–13.2 / 33.0–38.8 / = bc42ad0 | 80.9–87.2 / 75.8–83.4 / = bc42ad0 |

**Weak hums switching on mid-session** (`weak`, 176 cells). Final is identical to bc42ad0 in all
176. Pause FV is scored from switch-on + 21 s. Each cell lists P4 · P8 · U. Promotion is the mean
over the notched cells, with [never notched] counts.

| level | promo bc42ad0 | promo 6f8be18 | pause FV bc42ad0 | pause FV 6f8be18 |
|---|---|---|---|---|
| +3 dB | 12.6 [12] · 12.7 [12] · 12.6 [6] | 5.2 [14] · 5.1 [14] · 5.2 [9] | 10.3 · 12.1 · 0.0 | 22.4 · 24.6 · 16.5 |
| +6 dB | 10.6 [2] · 11.0 [3] · 5.3 [2] | 5.1 [9] · 5.2 [9] · 5.4 [6] | 0.0 · 5.0 · 1.0 | 35.6 · 33.2 · 25.3 |
| +9 dB | 13.6 [4] · 15.2 [4] · 12.6 [0] | 17.1 [6] · 16.4 [8] · 15.1 [3] | 15.4 · 21.0 · 0.0 | 27.9 · 40.6 · 16.7 |
| +12 dB | 12.6 [0] · 14.6 [0] · 16.4 [0] | 17.1 [6] · 16.1 [5] · 21.0 [3] | 3.4 · 5.4 · 3.6 | 27.8 · 21.1 · 28.4 |

**The other interferer parts:**

| part | cells | bc42ad0 | 6f8be18 | `N12` | **final** |
|---|---|---|---|---|---|
| weak2, beating / AM hums: mean promo [never]; cells later than bc42ad0; cells with pause FV > bc42ad0 + 2 pp | 96 | 13.1 [14] | 15.1 [48]; 35; 34 | 13.5 [14]; 3; 3 | **13.1 [14]; 0; 0** |
| hum beside a held note (handoff adversary): mean promo; later; FV > +2 pp | 168 | 8.6 | 10.3; 25; 19 | 8.6; 0; 0 | **8.6; 0; 0** |
| dense-speech switch-on (`dense.mjs`): correct / pause FV | 16 | 86.1 / 30.8 | 80.6 / 47.9 | — | **86.1 / 30.8 (identical in 16 / 16)** |
| FDA voices × interferer (noise-only / from start / mid-speech / in a pause) | 109 | — | — | — | **identical to bc42ad0 in 109 / 109** |
| 2026-10-03 grids, real worker (main 480 / requirement 120) | 600 | 94.0 / 92.7 | — | — | **identical in 600 / 600** |

### R1.5 Committed oracles and sessions

The bc42ad0 module vs final, on an otherwise identical tree.

| oracle | bc42ad0 notch → final |
|---|---|
| `noise-augment-oracle.js pitch --frontend=tracker`: clean + white, pink, fan-hum, mains-complex, babble, crickets, cicadas, sleep-birdies × 20 / 10 / 5 dB | **byte-identical output** (fan-hum 78.0 / 77.8 / 76.7 % correct, mains 77.7 / 77.9 / 77.9, sleep-birdies 86.0 / 85.4 / 83.9) |
| same, extra tonal classes (fan-wobble0.6 / 1.5, fan-drift, hum-rich120 / 60, fan-wobble0.6+rich) × 10 / 5 dB | **byte-identical** (e.g. fan-wobble0.6 74.3 / 69.4 %, hum-rich120 74.5 / 66.8 %) |
| same, vocadito × fan-hum / mains / sleep-birdies × 20 / 10 / 5 | **byte-identical** |
| `noise-augment-oracle.js gender` (31 speakers × 7 noises × 3 SNRs, noise-only VAD) | **byte-identical** |
| `voicing-robustness-shootout.js` | **byte-identical** |
| session oracle, 4 private sessions (`r1b2` = bc42ad0 notch, `r1n13` = final) | `.hops.f32` **byte-identical on all 4 sessions**, so every analyze.py row is equal (results on the private session recordings are kept outside this repository) |
| `tests/dsp/noise-notch-test.js` | 59 / 59 + 6 KNOWN LIMITATION lines (speech → hold, phonation 0.15 s after stream start). New: interferer regressions (a)–(f), including (f), a beating hum switching on at the end of a pause (`N12`: 43.75 / 40.45 s; final and bc42ad0: 20.15 s), and 0.15 / 0.25 s catch breaths |
| `pitch-worker-above-range-test` 7 / 7, `boersma-ac-test` 41 / 41, `pitch-paint-gate-test` 43 / 43, lint, build | pass |

The bc42ad0 oracle outputs were produced on the same tree (`build/notch-adv/otree/bc42` = today's
`src/` + `scripts/` with bc42ad0's notch). A re-run of `p_fan-hum` reproduced them byte-for-byte.
`oracles.sh` step 2 originally crashed on the extra classes ("unknown noise type") on both trees.
`extra-preload.mjs` now registers them.

### R1.6 Strict decision rule: met

- **Promotion timing.** Every interferer cell notches no later than bc42ad0, and none is
  "not notched" where bc42ad0 notched. `start`, `weak`, `dense`, FDA and the grids are
  identical; weak2 and the handoff cells have 0 later.
- **Pause false voicing.** It is ≤ bc42ad0 + 2 pp in every cell (0 exceedances).
- **Held notes.** Every held-note family is ≥ bc42ad0 (0 scenarios worse).
- **Oracles.** The committed oracles and sessions are unchanged (R1.5).

### R1.7 Corrected guarantee and known limitations

**Guarantee.** A note that **starts at a sound onset** is not notched within 20 s of its latest
start. A sound onset is band energy ≥ 10 dB over its 2 s minimum in a 512 ms observation window.

- A breath renews the start: an offset of ≥ 20 dB over 0.3 s or ≥ 18 dB over 0.1 s, with the line
  itself dipping. This covers every suite breath from 0.15 to 2 s, silent or audible.
- A glide or step of ≤ 160 c from a held note carries the start over.

**Known limitations.** These are bc42ad0's behavior, measured above. `noise-notch-test.js`
prints them as KNOWN LIMITATION lines, not failing checks.

- **Speech running straight into a hold.** Gaps under ~0.3 s never dip 10 dB in a 512 ms window.
  66.7 % of hold frames are reported; the notch promotes ~5 s into the hold.
- **Phonation in the stream's first observation windows.** There is no onset history yet. From
  sample 0: 46.2 %. From 0.15 s: 44.9 %. Speech from t = 0, then a hold: 54.7 %.
- **Holds of 20 s or more.** This is the pre-existing edge.

**Why the latch is not kept.** Covering the first two limitations needs a notion of "inside a
sound", which is exactly what the latch was. The interrupted attempt tried latch-keeping
candidates `C1`–`C10` (line-gated release, plausible-level pre-roll, floor bounds). The results
below are stored from that attempt, not re-run. Every one of them hit the latch's structural cost:
a hum switching on during dense speech is latched as onset-born. `C9` was the best of them:

- it reached the voice ceiling on every family except sample 0;
- it passed `start` and `weak`;
- but it equals 6f8be18 on `dense.mjs` (mean promotion 16.8 s vs 4.8 s, pause FV 47.9 % vs
  30.8 %), which fails the rule.

### R1.8 Reproduction

Run from the worktree root. At most 4 processes run at once (`MAXJ`).

```
bash scripts/notch-adversarial/setup.sh
S=scripts/notch-adversarial; R=build/notch-adv/res
node $S/parity.mjs N13 SRC 7 16000,48000
bash $S/shards.sh $R/fin13/held 16 $S/held.mjs --variants=SRC --sr=16000,48000   # and int.mjs --part=start|weak|weak2
bash $S/shards.sh $R/fin13/hadv 8 $S/handoff-adv.mjs --variants=SRC --sr=16000,48000
node $S/dense.mjs --variants=B,SRC
bash $S/shards.sh $R/fin13/fda_start 4 $S/fda.mjs --part=start --variants=B,SRC   # and nonly|midsp|midpa
bash $S/oracles.sh bc42 n13
# bash $S/sessions.sh ...  (session oracle; needs the private session recordings, not in this repo)
node tests/dsp/noise-notch-test.js
```

## Round 2 (2026-10-05): reverted to bc42ad0

**Decision: REVERT** (the strict rule fails in one class). `src/dsp/noise-notch.js` is bc42ad0's
module again, byte-identical except for a comment block listing the held-note gaps.
`pitch-worker.js` is unchanged. The round-2 candidate `R8` is kept as a flag-free drop-in,
[scripts/notch-adversarial/r8-notch.js](../scripts/notch-adversarial/r8-notch.js), for a product
decision (R2.6).

### R2.1 The review's findings, reproduced

The round-1 review confirmed six findings against cb00425 (`N13`, `R1` below). The suite ports the
reviewers' repro scripts into [`r2int.mjs`](../scripts/notch-adversarial/r2int.mjs) (real
`pitch-worker.js`, 16 + 48 kHz) and adds held families to `scenarios.mjs`. Every interferer
finding reproduces on `R1` (cells failing the strict rule vs bc42ad0):

| finding | part | cells | `R1` fails | example |
|---|---|---|---|---|
| 1. an onset-born hum that changes frequency (step 115→121 Hz, 110→120, 117→121.5, alternating 115 / 121 every 8 / 12 s, spin-up), noise-only / dense / sparse speech | `step` | 96 | 40 | step 115→121 noise-only: 23.15 vs 8.15 s; alternating noise-only: never vs 13.15 / 17.15 s |
| 2. a hum present from t = 0, masked by a 116 / 125 Hz note, the note gliding / stepping / running into speech with 0.3 / 0.9 / 1.5 s pauses | `masked` | 156 | 49 | glide, 0.9 s pauses: 25.35 vs 10.35 s, painted pause FV 45.7 vs 0 % |
| 3. steady / AM / beating (2:1, 1:1) hums switching on in silence, speech with 0.25–0.6 s pauses, 12 seeds | `beatpause` | 240 | 34 | 1:1 beat at rms 0.008: mean promotion 46.7 s [14 of 24 never] vs 20.1 s [0] |
| 5. a hum switching on in silence, then held notes within 3 Hz of it (one track), 16–30 dB over the hum, 0.25–1.3 s breaths | `shared` | 144 | 48 | 118.2 Hz, −25 dB, 2 s / 0.4 s: never vs 20.15 s, pause FV 100 vs 1.1 % |
| 6. a step after a 0.15 / 0.2 s catch breath (no handoff: the re-birth reset the parent's held time) | held `breathstep` | 32 | (= bc42ad0) | 78.2 % of hold frames on bc42ad0, `R1` and `R8` |

Finding 4 (the docs overstated the guarantees) is the dated correction at the top of Round 1.

### R2.2 Candidate (`R8`)

`cand2-notch.js` = cb00425 + option flags (`variants.mjs` `R2h` … `R8`). Iteration:

1. **No handoff** (`R2h`). Findings 1, 2 and 6 are all handoff cases. A hum that steps in
   frequency, and a hum reappearing beside a note that moved, have the same signature as a moved
   note. Removing the handoff makes `step` and `masked` identical to bc42ad0 (mid-hold glides /
   steps go back to bc42ad0's 73.6 %).
2. **Quiet-window line gate** (`R2q`, `R2`). A breath re-birth also needs the line to be ABSENT
   from a quiet window: 100 ms of raw audio inside the breath, in chunks ≥ 18 dB under the last
   1.3 s max, skipping the run's first chunk. Absent means < 10 × the local floor (the median of
   the bins 25–90 Hz either side). A hum stays a prominent line in every pause: beating, AM, or
   16–30 dB under a note on its track. This closed findings 3 and 5. `R2` replaced cb00425's
   revokes by a revoke on a quiet window where the line is STEADY.
3. **Reverberant tails** (`R3`–`R5`). A Schroeder-reverb repeated-holds family (RT60 0.3 / 0.6 s)
   showed the tail ringing in the breath. Comb ringing held a 150 ms plateau, so the line looked
   steady and present. Fixes: run-scoped STEADY over 5 windows (200 ms), and a line decaying ≥ 6 dB
   within 100 ms counts as absent.
4. **Beat nulls** (`R6`–`R8`). An equal-amplitude (1:1) beat can vanish for ~100 ms in a pause.
   Fixes:
   - re-births made inside the quiet run are provisional and cannot promote;
   - they are void if the line comes back (+6 dB over its minimum, ≥ 20 × floor) inside the run;
   - fast decay counts as absent only at ≥ 3 dB per 50 ms on average since the run began. A tail
     decays from the moment the note stops; a beat slides slowly, then plunges.

   Beatpause seed 8 (1:1, rms 0.008): 22.35 vs 20.15 s on `R7`, 20.15 s on `R8`.

`R8` parity with its flag-free port (`r8-notch.js`, which was `src/` during the runs): 0 mismatches
in 61 436 messages (every 17th held scenario, both rates), and 64 / 64 identical `beatpause` /
`shared` cells.

### R2.3 Results (16 + 48 kHz)

**Interferers.** Cells give mean promotion in s with [never notched] counts, painted pause FV %,
and cells failing the strict rule. Painted pause FV is scored from switch-on + 21 s for
switch-on parts, and over the whole window for `masked`.

| part | cells | bc42ad0 (= final) | 6f8be18 | cb00425 (`R1`) | candidate `R8` |
|---|---|---|---|---|---|
| `step` | 96 | 11.6 [0] / 21.6 | 22.1 [24] / 28.6; 84 fail | 16.8 [10] / 27.6; 40 fail | **identical to bc42ad0, 96 / 96** |
| `masked` | 156 | 9.8 [47] / 33.4 | 5.5 [141] / 90.0; 99 fail | 14.3 [47] / 40.9; 49 fail | **identical, 156 / 156** |
| `beatpause` | 240 | 20.2 [23] / 4.0 | 23.1 [79] / 19.7; 77 fail | 22.2 [38] / 11.0; 34 fail | **identical, 240 / 240** |
| `shared` | 144 | 20.3 [30] / 16.0 | 20.3 [77] / 31.1; 47 fail | 23.4 [65] / 32.6; 48 fail | **identical, 144 / 144** |
| `intermit`: a hum that itself cuts out 0.15 / 0.3 / 0.5 / 1 s every 5 / 8 s, noise-only | 32 | 20.2 [4] / 10.2 | 20.2 [24] / 67.8; 20 fail | 20.2 [29] / 83.1; 25 fail | **20.2 [29] / 83.1; 25 fail** |
| `int start` (hum from the first sample; speech 0.1–3 s; pre-roll) | 380 | 5.1–5.5 [0] | 212 fail | identical | **identical, 380 / 380** |
| `int weak` (+3 … +12 dB switch-on) | 176 | see R1.4 | 52 fail | identical | **identical, 176 / 176** |
| `int weak2` (beating / AM switch-on, fixed pause schedule) | 96 | 13.1 [14] | 35 fail | identical | **identical, 96 / 96** |
| `handoff-adv` (hum beside a held note) | 168 | 8.6 | — | 0 later | **0 later** |
| `dense.mjs` (switch-on during dense speech), 16 / 48 kHz | 32 | 86.1 / 30.8 (16 k) | 80.6 / 47.9 | identical | **identical, 32 / 32** |
| FDA voices × interferer (4 placements) | 109 | — | — | identical | **identical, 109 / 109** |
| 2026-10-03 grids (main 480 / requirement 120) | 600 | 94.0 / 92.7 | — | identical | **identical, 600 / 600** |

**Held notes.** Cells are % of hold frames at pitch, with scenarios promoted onto the voice in
parentheses (598 scenarios × 2 rates). The 6f8be18 column is round 1's (R1.3), for the families
it ran.

| family | n | bc42ad0 (= final) | 6f8be18 | cb00425 | candidate `R8` |
|---|---|---|---|---|---|
| repeated holds, 0.15 s breaths | 32 | 74.8 (32) | 74.8 (32) | 100.0 (0) | 98.9 (2) |
| repeated holds, 0.25 / 0.3 / 0.5 s | 96 | 73.7 (96) | ≥ 99.0 | 100.0 (0) | 99.7 (1) |
| repeated holds, 1 / 2 s | 64 | 78.3 (46) | 100.0 (0) | 100.0 (0) | 99.4 (3) |
| audible inhalation, 0.15–1 s | 80 | 66.4 (80) | 75.4–100 | 100.0 (0) | 99.6 (4) |
| abrupt-release catch breaths (10 / 30 ms ramps) | 32 | 66.7 (32) | — | 91.7 (8) | 91.7 (8) |
| repeated holds under reverb (RT60 0.3 / 0.6 s) | 24 | 65.3 (24) | — | 100.0 (0) | 91.5 (8) |
| step after a 0.15 / 0.2 s catch breath | 32 | 78.2 (32) | — | 78.2 (32) | 78.2 (32) |
| ladder through 0.15–0.4 s breaths | 36 | 91.8 (12) | — | 91.8 (12) | 91.8 (12) |
| mid-hold glide / step | 320 | 73.6 (294) | 100.0 (0) | 100.0 (0) | 73.6 (294) |
| speech → hold; phonation from 0 / 0.15 s; speech from 0 | 256 | 44.9–66.7 | 100 except sample 0 | = bc42ad0 | = bc42ad0 |
| steady, vowel change, messa di voce | 224 | 100.0 | 100.0 | 100.0 | 100.0 |
| **all** | 1196 | **75.33** | — | 89.96 | 82.61 |

Neither cb00425 nor `R8` is worse than bc42ad0 in any scenario (0 scenarios > 1 pp below).

**Committed oracles and sessions, `R8` vs bc42ad0.** All byte-identical once the wall-clock
lines are dropped:

- `noise-augment-oracle.js pitch --frontend=tracker` (8 default classes, 6 extra tonal classes,
  vocadito × 3);
- `gender`;
- `voicing-robustness-shootout.js`;
- the session oracle's `.hops.f32` on all 4 private sessions.

The final module is bc42ad0's, so all of these are trivially unchanged for the commit.

### R2.4 Why the strict rule fails: an intermittent tonal source *is* the repeated-holds signal

Take a hum that cuts out for 0.15–1 s every 5–8 s. Its line vanishes from every quiet window,
dips in the 512 ms observation, and comes back at the same frequency and level. A steady
same-pitch hold series with silent breaths does exactly the same: the suite's `repeat` families
include vib 0 / wander 0 notes.

- bc42ad0 never renews a track's clock, so it notches the cutting-out hum at ~20 s (28 of 32
  cells; 1 s gaps every 5 s drop its duty under 0.9).
- Every breath rule so far renews the clock at each cut-out and never notches it: 6f8be18, round
  1 and `R8`. With `R8`, 83 % of the noise-only audio is painted as voice (bc42ad0: 10 %).

No frame-local or spectral criterion here can tell the two apart. The decision rule puts
interferer handling first, so the module is reverted. `tests/dsp/noise-notch-test.js` (k) guards
this case: it passes on bc42ad0 and fails on `R8`. Physical sources with this signature should be
rare: sub-2 s cut-outs at ≥ 90 % duty, 50–460 Hz, with longer gaps pruning the track anyway.
They are not impossible, though, and the trade belongs to the user.

### R2.5 What bc42ad0 guarantees (precise), and the known gaps

**Guarantee.** A track first seen while the 50 Hz–4 kHz band energy of a 512 ms observation is
≥ 10 dB over its 2 s minimum is onset-born. An onset-born track is not notched until 20 s after
its first sighting, at duty ≥ 0.9. Any other track needs 5 s. Hums present before the voice keep
5 s; an interferer switching on mid-session takes ~20 s.

**Known gaps** (all measured above; `noise-notch-test.js` prints them as KNOWN LIMITATION lines):

- **Repeated same-pitch holds with breaths.** One track spans the series and is notched once the
  series passes 20 s: 64–85 % of hold frames.
- **Mid-hold glide / step > 3 Hz.** The moved line is not onset-born and is notched ~5 s later:
  73.6 %.
- **Speech running into a hold** (gaps < ~0.3 s): 66.7 %.
- **Phonation in the stream's first observation windows.** From 0 / 0.15 s: 46.2 / 44.9 %. Speech
  from t = 0, then a hold: 54.7 %.
- **Holds ≥ 20 s.**

Notched notes are then blanked by the ghost veto (or go blank when breathy).

### R2.6 For a product decision: adopting `R8`

Copy `scripts/notch-adversarial/r8-notch.js` over `src/dsp/noise-notch.js`. The two entries
below are the measured trade, both rates.

| | **gain** | **cost** |
|---|---|---|
| held notes | Repeated holds with breaths (0.15–2 s, silent or audible) go from 64–85 % to 98.9–99.7 %. Abrupt-release catch breaths go 66.7 → 91.7 %, reverberant repeats 65.3 → 91.5 %. All held scenarios: 75.3 → 82.6 %. | — |
| interferers | — | A tonal source that cuts out for 0.15–1 s every few seconds is never notched, and is painted as voice in ~83 % of noise-only audio. |

Everything else in R2.3 is identical to bc42ad0. Glides / steps, speech → hold and early phonation
stay as on bc42ad0.

### R2.7 Reproduction

Run from the worktree root. The runners cap concurrent processes at `MAXJ` (round 2 used 3); a
resource governor may suspend jobs.

```
bash scripts/notch-adversarial/setup.sh
S=scripts/notch-adversarial; R=build/notch-adv/res2
for p in step masked beatpause shared intermit; do bash $S/shards.sh $R/r2_$p 4 $S/r2int.mjs --part=$p --variants=B,H,R1,R8 --sr=16000,48000; done
node $S/agg-r2.mjs $R/r2_step $R/r2_masked $R/r2_beatpause $R/r2_shared $R/r2_intermit --fails
for p in start weak weak2; do bash $S/shards.sh $R/int_$p 8 $S/int.mjs --part=$p --variants=B,H,R1,R8 --sr=16000,48000; done
bash $S/shards.sh $R/held 12 $S/held.mjs --variants=B,R1,R8 --sr=16000,48000
node $S/agg-held.mjs $R/held --vars=B,R1,R8 --by=sub --worse
bash $S/shards.sh $R/hadv 4 $S/handoff-adv.mjs --variants=B,R1,R8 --sr=16000,48000
node $S/dense.mjs --variants=B,H,R1,R8 [--sr=48000]
for p in nonly start midsp midpa; do bash $S/shards.sh $R/fda_$p 4 $S/fda.mjs --part=$p --variants=B,R1,R8; done
bash $S/shards.sh $R/grid_main 4 $S/grid.mjs --set=main --variants=B,R1,R8   # and --set=req
# oracles on the candidate: copy r8-notch.js over src/dsp/noise-notch.js, then
bash $S/oracles.sh r2    # (sessions.sh needs the private session recordings, not in this repo)
node tests/dsp/noise-notch-test.js
```
