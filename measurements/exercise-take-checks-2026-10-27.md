# Take checks for the guided exercises: how much voice a real take has (2026-10-27)

Branch `guided-exercises`. The lessons' recordings (R3's bright / dark / in-between takes,
R4's try) get a note when a take is too short or has too little voice in it
(docs/guided-exercises-design.md §2 rule 3). "Too short" is a design choice from the text
the take asks for. "Too little voice" needs a threshold that real spoken takes pass, so it is
measured here first. R4's try also shows its pitch ("about N Hz"); this note fixes how much
voice that needs.

## 1. Pre-registration (written before any result was computed)

**Question.** How many seconds of voiced frames does the exercises frame tap
(`src/exercises/bridge.js`, the frame a session recording stores) receive during a real
spoken take, and during a take with no speech?

**Chain.** The shipped chain in Node: the real pitch worker with the voice gate's detector
(FireRedVAD, as the app runs it; `node scripts/fetch-firered-model.mjs`), the real DSP worker
and the real hook (`useAudioPipeline`), driven as the session oracle drives them
(`scripts/session-oracle/`), at a 48 kHz capture rate. Listening has run for 3 s of the
take's background before the take starts; only frames that arrive inside the take window
are counted. Before any number, the harness is checked against the real hook: the frames it
counts are the frames `exerciseFrameTap` receives (same objects, same order) on one input.

**Counts per take.**
- `a`: 0.025 s × frames with `voiced` true and `f0 > 0` (the frame log's own rule,
  `src/exercises/results.js` `createFrameLog`).
- `b` (primary): as `a`, but frames the voice gate hid (`voiceGate === "hidden"`) do not
  count. With no gate decision (setting off, model not loaded) `b` equals `a`.

**Positive takes (real speech, public).** LibriSpeech. Selection set: dev-clean, 20 men and
20 women. Confirmation set: test-clean, 20 men and 20 women. Readers are taken in sorted
speaker-id order per sex. Utterances are whole LibriSpeech utterances of 1.5–4.0 s.
- *Single* (R3's take: one sentence): one utterance; up to 5 per reader.
- *Double* (R4's try: the sentence twice): two utterances of the same reader with a 0.4 s
  gap, at most 8.0 s of speech (the take cap); up to 3 per reader.
- Each take: 0.8 s before the speech and 0.6 s after it (the press of Record and Stop).
- Conditions: *clean* (the file's own level, pink noise at −60 dBFS under the whole take);
  *quiet* (the speech 20 dB lower, same noise floor); *noisy* (pink noise at +10 dB SNR
  against the speech's RMS over the speech portion).

**Negative takes (no speech).** 30 takes per class, 15 of 2.0 s and 15 of 5.0 s, seeds
varied: (n1) white noise at −70 dBFS; (n2) pink noise at −45 dBFS; (n3) pink noise at
−30 dBFS; (n4) brown noise at −30 dBFS; (n5) a 120 Hz hum with four harmonics at −35 dBFS
over pink noise at −50 dBFS; (n6) whisper-like speech: LibriSpeech utterances of the
selection-set readers re-made with noise excitation through a frame-wise LPC envelope
(25 ms frames, order 2 + rate / 1000), at the source's level.

**Candidates.** T ∈ {0.25, 0.5, 0.75, 1.0} s of voice, on count `b` (count `a` reported
beside it).

**Selection rule (per take type, single and double, separately).** On the selection set,
the largest T at which the share of positive takes with `b ≥ T` is at least 99.0 % in every
sex × condition cell (men / women × clean / quiet / noisy). On the confirmation set: if any
cell falls under 98.0 % at that T, step down one candidate; if T = 0.25 s fails there, STOP —
report the numbers and build no voice check (only "too short").

**Reported, no bar.** The share of negative takes flagged (`b < T`) per class at the chosen
T; a class flagged under 50 % is named in the lesson notes as a known limitation. Count `a`
beside `b` for every number.

**Fixed by design (not tuned here).**
- "Too short": R2 and R3 takes under 1.0 s; R4's try under 3.0 s (it asks for the sentence
  twice, as R4's own recording step, which needs 3 s). Reported: the share of positive takes
  that would trip it (expected none).
- R4's try pitch: shown when count `b` ≥ 1.0 s (Voice Shaper's own minimum for the recording
  it is compared with: ≥ 1 s voiced). Reported on the double takes: the share that reach it
  per cell, and the difference in semitones between the take's median voiced `f0` and the
  median of the same take in the clean condition, for the quiet and noisy conditions.
- R2's takes are whispered by design: no voice check there, only "too short".

## 2. Results

**Outcome: STOP for both take types.** On count `b`, no candidate T keeps 99.0 % of the
selection set's takes in every cell, for single or for double takes. Under §1 the app
builds no "too little voice" check; only "too short" applies. Every take that fails is in
the *quiet* condition, from a reader whose recording is already 8–21 dB below the set's
median level. After the 20 dB drop the speech sits at or under the −60 dBFS noise floor, and
the voice gate hides most or all of it. No positive take trips "too short". R4's try pitch
(count `b` ≥ 1.0 s) is reached by 94.6–100 % of the double takes per cell.

### 2.1 What was run

- **Chain:** as §1. The real pitch worker with FireRedVAD (FireRedTeam/FireRedVAD c30ec49;
  sha256 of both files in `provenance.txt`), the real DSP worker and the real hook, 25 ms
  chunks at 48 kHz, the setting "Only show pitch while I'm speaking" on (the default). Source
  code: a frozen copy of HEAD 1dc298a (deviation D1). Node 24.14.1, ffmpeg 8.1.1 (soxr).
- **Detector decisions.** Every hop of every stream got one: none missing, none late, none
  dropped. Over all hops, background included: selection 160 798 voice / 155 108 no voice;
  confirmation 152 764 / 141 353; negatives 11 457 / 35 163.
- The full run (1 956 streams) took about 7 minutes in 16 shards.

**Takes.** Each positive take was run in all three conditions (clean, quiet, noisy), so a
set has 3 streams per positive take.

| set | readers (men + women) | single takes, men / women | double takes, men / women | streams |
|---|---|---|---|---|
| selection (dev-clean) | 20 + 20 | 99 / 96 | 56 / 56 | 921 |
| confirmation (test-clean) | 20 + 20 | 88 / 93 | 49 / 55 | 855 |
| negatives | — | 6 classes × 30 takes (15 of 2.0 s, 15 of 5.0 s) | | 180 |

Some readers have too few utterances of 1.5–4.0 s for 5 single and 3 double takes, so they
give fewer (D4). Speech per take: median 3.0 s (single) and 6.4 s (double).

### 2.2 Parity check (done before any number)

**PASS on every check.** Input: one take, `sel|174|double|0` (utterances 174-50561-0002 and
-0003) in the noisy condition. That is 415 chunks at 48 kHz, take window 3.000–10.285 s. The
real pitch worker with FireRedVAD posted 410 messages: 240 voice, 170 no voice, none
missing or late.

Two paths were compared:
- **H, the harness path:** the hook's `handlePitchMessage` / `handleAnalysisResult`
  through its refs, with the tap installed.
- **P, the app's path:** the real hook's `start()` with fake capture and Worker shells. The
  same messages go through the hook's own pitch-worker and DSP-worker `onmessage`
  handlers. The tap is installed with `setExerciseFrameTap`, and a session-recording frame
  callback is set.

Checks:
1. In P, the tap receives exactly the objects the session recording's frame callback
   receives: 414 of 414, same objects, same order.
2. H and P tap the same 414 frames in the same order, equal in every field (`voiced`,
   `f0`, `voiceGate`, `painted`, formants, HNR, …) and in arrival time.
3. The 291-frame take window is the same on both paths.
4. The counts are the same: a = b = 2.15 s, median f0 129.3 Hz, gate voice 236 / hidden 55.
5. The counted frames are exactly the tapped frames that arrive after Record and up to
   Stop: display hops 120–410 without a gap, one per DSP frame.
6. `a` and `b` recounted from the raw frames match.
7. The input contains both detector decisions and silence-gated frames.
8. Path H rerun in a clean child process with no fake globals (as `run.mjs` runs it) taps
   the same frame sequence.
9. The session oracle's own drive (`runWorkersVad` + `buildFramesVad` + `driveHook`) records
   the same f0 on all 414 hops. On every hop, the detector decision equals the frame's
   `voiceGate`.

A separate review reran `parity.mjs` and got the same output. It also reran 10 streams in a
fresh process, in another order (the failing quiet takes, a hum and a whisper negative,
clean and noisy takes). Every row came out identical. It recomputed every table below from
the rows with its own script; no number changed.

### 2.3 How much voice a take has

Count `b` in seconds: median (5th percentile). Count `a`'s median is the same or at most
0.075 s higher.

| set, take | m-clean | m-quiet | m-noisy | f-clean | f-quiet | f-noisy |
|---|---|---|---|---|---|---|
| sel, single | 1.475 (0.848) | 1.375 (0.575) | 1.350 (0.668) | 1.688 (0.738) | 1.375 (0.000) | 1.475 (0.550) |
| conf, single | 1.525 (0.750) | 1.325 (0.659) | 1.313 (0.625) | 1.675 (0.840) | 1.500 (0.725) | 1.450 (0.750) |
| sel, double | 3.025 (1.719) | 2.825 (1.587) | 2.650 (1.494) | 3.362 (1.862) | 2.888 (1.013) | 2.925 (1.556) |
| conf, double | 2.825 (1.845) | 2.675 (1.725) | 2.525 (1.560) | 3.275 (2.152) | 3.075 (1.772) | 2.900 (1.927) |

Read speech is voiced about half the time, so a single take of ~3 s holds ~1.5 s of voice.

### 2.4 Pass shares per take type

Share of positive takes with count `b` ≥ T, in %. The number of takes under T is in square
brackets. Count `a`'s share is in round brackets.

**Single takes, selection set (dev-clean).** n = 99 per men's cell, 96 per women's cell.

| T (s) | m-clean | m-quiet | m-noisy | f-clean | f-quiet | f-noisy |
|---|---|---|---|---|---|---|
| 0.25 | 100 [0] (100) | **98.99 [1]** (100) | 100 [0] (100) | 100 [0] (100) | **92.71 [7]** (100) | 100 [0] (100) |
| 0.5 | 98.99 [1] (98.99) | 95.96 [4] (96.97) | 97.98 [2] (97.98) | 97.92 [2] (97.92) | 90.63 [9] (94.79) | 96.88 [3] (96.88) |
| 0.75 | 96.97 [3] (96.97) | 89.90 [10] (90.91) | 90.91 [9] (90.91) | 94.79 [5] (95.83) | 84.38 [15] (88.54) | 89.58 [10] (89.58) |
| 1.0 | 81.82 [18] (82.83) | 77.78 [22] (77.78) | 73.74 [26] (73.74) | 85.42 [14] (85.42) | 76.04 [23] (80.21) | 81.25 [18] (81.25) |

**Single takes, confirmation set (test-clean).** n = 88 per men's cell, 93 per women's cell.

| T (s) | m-clean | m-quiet | m-noisy | f-clean | f-quiet | f-noisy |
|---|---|---|---|---|---|---|
| 0.25 | 100 [0] (100) | 100 [0] (100) | 100 [0] (100) | 100 [0] (100) | 97.85 [2] (100) | 100 [0] (100) |
| 0.5 | 98.86 [1] (98.86) | 98.86 [1] (98.86) | 98.86 [1] (98.86) | 100 [0] (100) | 96.77 [3] (97.85) | 97.85 [2] (97.85) |
| 0.75 | 95.45 [4] (95.45) | 87.50 [11] (88.64) | 87.50 [11] (87.50) | 96.77 [3] (96.77) | 93.55 [6] (94.62) | 95.70 [4] (95.70) |
| 1.0 | 82.95 [15] (84.09) | 78.41 [19] (79.55) | 77.27 [20] (77.27) | 90.32 [9] (91.40) | 86.02 [13] (88.17) | 84.95 [14] (84.95) |

**Double takes, selection set (dev-clean).** n = 56 per cell.

| T (s) | m-clean | m-quiet | m-noisy | f-clean | f-quiet | f-noisy |
|---|---|---|---|---|---|---|
| 0.25 | 100 [0] (100) | 100 [0] (100) | 100 [0] (100) | 100 [0] (100) | **94.64 [3]** (100) | 100 [0] (100) |
| 0.5 | 100 [0] (100) | 100 [0] (100) | 100 [0] (100) | 100 [0] (100) | 94.64 [3] (100) | 100 [0] (100) |
| 0.75 | 100 [0] (100) | 98.21 [1] (100) | 100 [0] (100) | 100 [0] (100) | 94.64 [3] (100) | 100 [0] (100) |
| 1.0 | 100 [0] (100) | 98.21 [1] (100) | 100 [0] (100) | 100 [0] (100) | 94.64 [3] (100) | 100 [0] (100) |

**Double takes, confirmation set (test-clean).** n = 49 per men's cell, 55 per women's cell.

| T (s) | m-clean | m-quiet | m-noisy | f-clean | f-quiet | f-noisy |
|---|---|---|---|---|---|---|
| 0.25 | 100 [0] (100) | 100 [0] (100) | 100 [0] (100) | 100 [0] (100) | 100 [0] (100) | 100 [0] (100) |
| 0.5 | 100 [0] (100) | 100 [0] (100) | 100 [0] (100) | 100 [0] (100) | 98.18 [1] (100) | 100 [0] (100) |
| 0.75 | 100 [0] (100) | 100 [0] (100) | 100 [0] (100) | 100 [0] (100) | 98.18 [1] (100) | 100 [0] (100) |
| 1.0 | 100 [0] (100) | 100 [0] (100) | 100 [0] (100) | 100 [0] (100) | 98.18 [1] (100) | 100 [0] (100) |

### 2.5 The chosen T: the rule applied

`summarize.mjs` applies §1's rule to the rows; nothing was chosen by hand.

| take type | count `b` (binding) | count `a` (reported only) |
|---|---|---|
| single (R3's take) | selection: no T has every cell ≥ 99.0 % (at 0.25 s: m-quiet 98.99 %, f-quiet 92.71 %) → **STOP** | selection 0.25 s; confirmation at 0.25 s: every cell 100 % → 0.25 s |
| double (R4's try) | selection: no T has every cell ≥ 99.0 % (f-quiet 94.64 % at every T) → **STOP** | selection 1.0 s; confirmation at 1.0 s: every cell 100 % → 1.0 s |

On count `b` the rule stops at the selection step, so the confirmation step had no T to
check (D2). The confirmation figures are in §2.4 for reference.

**Why it stops.** The cells hold 49–99 takes, so the 99.0 % bar allows no failing take in
any selection cell. These are the positive takes with `b` < 0.25 s. "Speech level" is the
speech's RMS after the 20 dB drop. The floor is pink noise at −60 dBFS. For comparison, the
clean takes' speech RMS: selection median −25.0 dBFS (lowest −45.5); confirmation median
−25.2 dBFS (lowest −37.4).

| take | speech level | a (s) | b (s) | frames: voice / hidden |
|---|---|---|---|---|
| sel 174, single 2 (m) | −59.0 dBFS | 0.50 | 0 | 0 / 138 |
| sel 1993, singles 0–4 (f) | −62.5 to −65.5 dBFS | 0.375–1.325 | 0 | 0 / all |
| sel 1993, doubles 0–2 (f) | −63.6 to −64.9 dBFS | 1.45–2.35 | 0 | 0 / all |
| sel 3081, single 2 (f) | −59.3 dBFS | 0.40 | 0 | 0 / 136 |
| sel 3081, single 4 (f) | −53.1 dBFS | 0.325 | 0.175 | 60 / 66 |
| conf 3729, single 2 (f) | −56.5 dBFS | 1.325 | 0.15 | 55 / 133 |
| conf 3729, single 3 (f) | −55.4 dBFS | 0.25 | 0.125 | 79 / 81 |

- "Quiet" is 20 dB below each file's own level. Reader 1993's files are at about
  −42.5 to −45.5 dBFS, so their quiet takes put the speech 2.5–5.5 dB under the floor.
- On the 11 takes with `b` = 0, the voice gate (FireRedVAD) says "no voice" on every frame.
  On the other three it hides about half the frames or more. The pitch chain still posts
  voiced frames on all of them (`a` = 0.25–2.35 s).
- The same takes have `b` = 0.33–3.7 s in the clean and noisy conditions.
- So the STOP comes from the voice gate hiding very quiet speech, not from short takes.

**Sensitivity, not binding (§1 does not allow dropping a reader).**
- Single takes: without reader 1993, f-quiet is still 97.8 % at 0.25 s (2 of 91 under),
  so the result would still be STOP.
- Double takes: all three f-quiet failures are reader 1993's. Without that reader, the rule
  would select 0.5 s (m-quiet is 98.21 % at 0.75 s) and confirm it (worst cell: f-quiet
  98.18 %).

### 2.6 Negative takes

Share flagged (`b` < T), count `b`, 30 takes per class. Count `a` gives the same shares.

| class | T = 0.25 | T = 0.5 | T = 0.75 | T = 1.0 | `b` range (s) |
|---|---|---|---|---|---|
| n1 white noise, −70 dBFS | 100 | 100 | 100 | 100 | 0 |
| n2 pink noise, −45 dBFS | 100 | 100 | 100 | 100 | 0 |
| n3 pink noise, −30 dBFS | 100 | 100 | 100 | 100 | 0 |
| n4 brown noise, −30 dBFS | 100 | 100 | 100 | 100 | 0 |
| n5 120 Hz hum + pink −50 dBFS | **0** | **0** | **0** | **0** | 2.000 (2 s takes), 2.475 (5 s takes) |
| n6 whisper-like | 96.7 (2 s takes 100, 5 s takes 93.3) | 100 | 100 | 100 | 0–0.30 |

- With STOP there is no chosen T, so the app flags no negative take.
- At every candidate T, **n5 is the only class flagged under 50 %**. Any future voice check
  must name it as a known limitation. The voice gate reads the hum as voice on every frame,
  and the pitch chain posts 120 Hz, until the noise notch promotes the hum. That happens
  about 5.5 s into the stream, about 2.5 s into the take (listening ran 3 s before it).
- Not in §1, read off the same rows: a 5 s hum-only take reaches R4's try-pitch minimum
  (`b` 2.475 s ≥ 1.0 s, median 120 Hz). So R4's try would show "about 120 Hz" for a hum with
  no voice in it. In this run the hum started with listening, 3 s before Record, and read
  as voice until the notch removed it about 5.5 s in. A hum that has run long enough before
  Record for the notch to remove it was not tested; a hum that switches on during listening
  is notched only after about 20 s (CLAUDE.md, "Tonal-noise notch"), also not tested here.
- n6 (whisper-like) never reaches 1.0 s, so R4's try would show no pitch on it.

### 2.7 "Too short" (fixed by design)

Counted per stream (take × condition).

| rule | selection | confirmation |
|---|---|---|
| single take < 1.0 s | 0 of 585 (shortest 2.960 s) | 0 of 543 (shortest 3.095 s) |
| double take < 3.0 s | 0 of 336 (shortest 5.670 s) | 0 of 312 (shortest 5.780 s) |

As expected, no spoken take trips it.

### 2.8 R4's try pitch (double takes)

**Share of takes with `b` ≥ 1.0 s (pitch shown), %; count `a` in brackets.**

| set | m-clean | m-quiet | m-noisy | f-clean | f-quiet | f-noisy |
|---|---|---|---|---|---|---|
| selection | 100 (100) | 98.2 (100) | 100 (100) | 100 (100) | 94.6 (100) | 100 (100) |
| confirmation | 100 (100) | 100 (100) | 100 (100) | 100 (100) | 98.2 (100) | 100 (100) |

Every take that misses it is a quiet take: reader 1993's three doubles (§2.5), one man's
double in the selection set (`b` = 0.70 s) and one woman's in the confirmation set (`b` =
0.40 s).

**How far the shown pitch moves:** |12 · log2(median f0 in the condition / the same take's
clean median)|. A pair counts when both takes reach the minimum on that count. For count
`b`, the median f0 is over the `b` frames; for count `a`, over the `a` frames. p90 uses
linear interpolation.

| set, condition | n (b) | median (st) | p90 (st) | max (st) | n (a) | median (st) | p90 (st) | max (st) |
|---|---|---|---|---|---|---|---|---|
| sel, quiet | 108 | 0.10 | 0.47 | 2.17 | 112 | 0.11 | 0.58 | 2.17 |
| sel, noisy | 112 | 0.18 | 0.74 | 3.35 | 112 | 0.19 | 0.74 | 3.35 |
| conf, quiet | 103 | 0.12 | 0.47 | 1.67 | 104 | 0.12 | 0.46 | 1.47 |
| conf, noisy | 104 | 0.16 | 0.75 | 1.52 | 104 | 0.16 | 0.65 | 1.52 |

Per sex, median / p90 (st):

| set, condition | b, men | b, women | a, men | a, women |
|---|---|---|---|---|
| sel, quiet | 0.08 / 0.43 | 0.11 / 0.49 | 0.10 / 0.45 | 0.12 / 0.61 |
| sel, noisy | 0.19 / 0.76 | 0.17 / 0.71 | 0.20 / 0.68 | 0.18 / 0.76 |
| conf, quiet | 0.05 / 0.51 | 0.15 / 0.44 | 0.06 / 0.44 | 0.16 / 0.46 |
| conf, noisy | 0.16 / 0.65 | 0.20 / 0.76 | 0.15 / 0.65 | 0.20 / 0.63 |

A quieter voice or noise moves the shown pitch by a median 0.1–0.2 semitones. Nine takes in
ten stay within 0.75 st. The largest move is 3.35 st (selection, noisy).

### 2.9 Sensitivity, not in §1: the recorder's 8 s cap

§1 allows up to 8.0 s of speech plus 1.4 s of lead and tail, so a double take can run to
9.4 s. The take recorder stops at 8 s (`src/exercises/takes.js` `TAKE_MAX_S`). 44 of 112
(selection) and 44 of 104 (confirmation) double takes run longer than 8.0 s. Counting only
the frames up to 8.0 s after Record changes no take's result:
- pass share at T = 0.25 s, all cells pooled: 99.1 % (selection) and 100 % (confirmation),
  as without the cap;
- pitch shown: 98.8 % and 99.7 %, as without the cap.

### 2.10 Deviations and interpretations

Where §1 is silent, or could not be followed to the letter, the choice is written down
here. Only D2 bears on the outcome; the others are how the takes and the chain were built.

- **D1. Source code.** The run used a frozen copy of HEAD 1dc298a (`git archive HEAD src`),
  not the live `src/`, because another session was editing `src/` during the run. At run
  start the chain files (`src/dsp`, `src/audio`, `src/exercises/bridge.js`, `src/utils`,
  `src/ml`, `src/resonance`) were identical to HEAD in the working tree. A later review found
  the copy differs from the working tree only in line endings, in two files. It is the
  shipped chain.
- **D2. STOP at the selection step.** §1 writes out STOP only for "T = 0.25 s fails" on the
  confirmation set. Here no candidate passes the selection set at all, so no T can be
  selected. STOP was applied (no voice check, only "too short"); it applies all the more.
- **D3. Double takes.** Built from consecutive pairs of the reader's eligible utterances
  (sorted by id: E0 + E1, E2 + E3, …), keeping the first 3 pairs whose speech (u1 + 0.4 s +
  u2) is ≤ 8.0 s. So double takes reuse the single takes' utterances.
- **D4. Readers with fewer takes** ("up to" in §1). Every other reader gives 5 singles and 3
  doubles.

  | set | reader (sex): singles / doubles |
  |---|---|
  | dev-clean | 1673 (f) 1 / 0; 422 (m) 4 / 2; 2902 (m) 5 / 1; 3000 (m) 5 / 2; 3576 (f) 5 / 2 |
  | test-clean | 2961 (f) 1 / 0; 3570 (f) 2 / 1; 2300 (m) 3 / 1; 4077 (m) 2 / 1; 5639 (m) 3 / 1; 7729 (m) 4 / 2; 8224 (m) 1 / 0; 8230 (m) 5 / 2 |

  The 98.0 % confirmation bar allows 1 failing take for n = 55, 88 or 93, and none for n = 49.
- **D5. Noisy condition, double takes.** The "speech portion" used for the +10 dB SNR is
  u1 + the 0.4 s gap + u2.
- **D6. Noisy condition, the floor.** The noisy condition has only the +10 dB SNR pink noise;
  it is not added on top of the −60 dBFS floor. dBFS means RMS re 1.0 throughout.
- **D7. Noise generation.** Pink noise: Paul Kellet's refined filter on xorshift white noise,
  generated at 48 kHz (the filter was designed for 44.1 kHz). Brown noise: a leaky
  integrator with pole 0.9995, mean removed. Each generator discards 1 s of warm-up and is
  normalised to unit RMS over the stream. Each positive take has one pink realisation,
  seeded by an FNV-1a hash of the take id and scaled per condition.
- **D8. n5.** "A 120 Hz hum with four harmonics" is read as 120 Hz plus four overtones (240,
  360, 480, 600 Hz), as `scripts/noise-synth.js` words it. Amplitudes 1/k, seeded phases;
  the sum at −35 dBFS, over pink noise at −50 dBFS.
- **D9. n6, made at the 16 kHz source rate.**
  - Whisper re-synthesis: LPC order 18 (= 2 + 16000 / 1000) on 25 ms periodic-Hann frames
    with a 12.5 ms hop. Each frame's noise is filtered through 1/A(z) and scaled to the
    source frame's RMS, then overlap-added. The result is scaled to the source utterance's
    RMS and upsampled with soxr.
  - Reader and utterance: take i uses selection reader i in the order m0, w0, m1, w1, …,
    and that reader's first utterance (sorted) at least as long as the take. The take is
    its first 2.0 or 5.0 s.
  - Background: pink noise at −60 dBFS, under the take and for the 3 s before it.
- **D10. Resampling.** LibriSpeech is decoded and upsampled 16 → 48 kHz with ffmpeg soxr
  (precision 28; exactly 3× the length, no lag). Speech content therefore stops at 8 kHz;
  the added noise is full-band at 48 kHz.
- **D11. Chain conventions**, taken from the session oracle (its README, "Voice gate"):
  - the pitch message of frame kk reaches the hook with display hop kk + L (L = 2);
  - `msg.ts` and the DSP frame's `absoluteTime` are the hop's audio-clock time;
  - the worker phase runs on a frozen performance clock, so the detector never switches
    itself off as "slow";
  - pitch hints are not relayed to the DSP worker (they set only its formant ceiling).

  The hook is driven through its own `handlePitchMessage` / `handleAnalysisResult` (via
  refs, without `start()`), with the real worker messages and real DSP data. The parity
  check (§2.2) shows this equals the `start()` path.
- **D12. Take window.** A frame counts if take start < arrival ≤ take end, where arrival is
  the end of the 25 ms chunk the DSP frame analysed. Record is pressed at 3.0 s, Stop at
  3.0 + 0.8 + speech + 0.6 s; the stream runs 0.1 s past the take.
- **D13. Take length.** §1's takes run to 9.4 s, longer than the recorder's 8 s cap. §1 was
  followed; the capped count is reported in §2.9 and changes nothing.
- **D14. R4's try pitch.**
  - The take's "median voiced f0" is the median over the count-`b` frames (voiced,
    f0 > 0, not hidden), as the pitch would be shown. The count-`a` medians are beside it.
  - The main semitone figures use pairs where both the clean take and the quiet / noisy
    take reach the minimum (≥ 1.0 s) on that count.
  - p90 uses linear interpolation (numpy's default).

### 2.11 Harness and how to re-run it

Harness: [scripts/exercises/take-checks/](../scripts/exercises/take-checks/README.md)
(`stimuli.mjs` the takes, `chain.mjs` the chain and the counts, `parity.mjs` the check of
§2.2, `run.mjs` one set in shards, `merge.mjs`, `summarize.mjs` §1's rule). Outputs go to the
gitignored `build/exercise-take-checks/`: `parity.txt`, `rows-sel.jsonl`, `rows-conf.jsonl`,
`rows-neg.jsonl`, `summary.txt`, `summary.json`, `provenance.txt`.

Needs `ffmpeg` with soxr on `PATH` and LibriSpeech dev-clean / test-clean (path in
`TAKE_CHECKS_LIBRI`; the README gives the default). From the repo root, in Git Bash:

```bash
node scripts/fetch-firered-model.mjs     # once: build/models/firered/
mkdir -p build/exercise-take-checks/tree build/exercise-take-checks/logs
git archive 1dc298a src | tar -x -C build/exercise-take-checks/tree
R="node --import ./scripts/session-oracle/lib/register.mjs scripts/exercises/take-checks"
SO_TAP=0 $R/parity.mjs
for s in sel conf; do for i in 0 1 2 3 4 5 6; do
  SO_TAP=0 $R/run.mjs --set=$s --shard=$i/7 > build/exercise-take-checks/logs/$s.$i.log 2>&1 &
done; done
for i in 0 1; do
  SO_TAP=0 $R/run.mjs --set=neg --shard=$i/2 > build/exercise-take-checks/logs/neg.$i.log 2>&1 &
done
wait
node scripts/exercises/take-checks/merge.mjs
node scripts/exercises/take-checks/summarize.mjs
```

`--src=` points every script at another source tree. About 0.7 s per stream on a desktop.

### 2.12 What the app uses

- **"Too little voice": no check, for R3's take or for R4's try** (STOP for both take
  types under §1). R2's whispered takes have none by design.
- **"Too short":** R2 and R3 takes under **1.0 s**; R4's try under **3.0 s** (fixed by
  design; no spoken take tripped them).
- **R4's try pitch:** shown only when count `b` (voiced, f0 > 0, not hidden by the voice
  gate) is at least **1.0 s**; the shown value is the median f0 of those frames. Known
  limitation: a steady hum the notch has not yet removed can reach it (§2.6).
