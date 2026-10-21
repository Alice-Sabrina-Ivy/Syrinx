# "Likely heard as": low pitch and breath pauses — attribution and pre-registered plan — 2026-10-21

**Status: attribution of the shipped panel + pre-registered plan.** The
attribution below measures only the shipped code. The plan (§6) is committed
and pushed before any candidate is coded or run; candidate results will be
appended below it. This is the hard-rule-3 measurement file for any change to
the heard-as modules (`src/ml/heard-as.js`, `heardAsCalibration.js`,
`utterance-gate.js`, `gender-worker.js`, `speech-detector.js`, and the
panel's `src/components/HeardAsPanel.jsx`) that comes out of it.

Branch `heard-as-responsiveness`, from `cue-strip` 53e3832 (the pitch chain,
the utterance gate, the speech detector, the classifier and the panel are
those of 53e3832). Public data only: LibriSpeech dev-clean and test-clean
(CC BY 4.0), PTDB-TUG, FDA, Hillenbrand et al. (1995) /hVd/ words. No private
recording.

## 1. Why (user report, 2026-10-21)

Two reports from using the app:

1. "Likely heard as" seems not to work when pitch drops below about 80 Hz.
2. It needs too much unbroken speech to give a reading. In the report's
   screenshot the user was speaking in a feminine voice (pitch about
   150–200 Hz) with natural pauses, and the panel said "Can't tell yet — the
   range covers most of the scale" with a range of about 0–9 in 10 — so the
   complaint is also how long it takes to get an informative reading, not
   only the first one. (The below-80 Hz case happened separately.)

## 2. How the panel decides (from the code at 53e3832)

- **Inputs.** The gender worker decides on a 0.75 s window every 150 ms
  (utterance gate: the Silero speech detector says someone is speaking, the
  window is at most 60 % pre-onset, the newest speech frame is ≤ 500 ms old,
  ≥ 15 % of the window's speech frames are speech, peak above the silence
  floor, no held note); the classifier runs on a scored window every 450 ms.
  `heard-as.js` pools the scored windows of the trailing **8 s**: the mean
  logit of the classified windows whose own span holds ≥ 200 ms of posted
  voiced pitch, and the median of the posted voiced pitch inside the windows.
  The worker's EMA and its silence reset do **not** feed the panel (it pools
  the unsmoothed window logits).
- **First reading.** At a 2 s update the pool must hold ≥ 10 scored windows,
  **≥ 3.0 s of posted voiced pitch inside the scored windows' spans**, at least
  one qualifying classified window, a pooled F0 inside **81–293 Hz** and a
  meter logit inside the fit range; the newest scored window must be ≤ 5 s old.
  Otherwise it hides ("Keep talking", "Outside the range it was tested on",
  "Waiting for running speech", …).
- **The range never narrows with more speech.** It is always
  eta ± 2.25 logit (`halfWidth`, chosen for ≥ 80 % coverage of held-out
  listener data). Rounded outward to tenths it spans ≥ 8 tenths — "Can't tell
  yet" — whenever |eta| < 1.40 logit, however many windows are pooled. More
  speech can only move the reading, not tighten it. A range of "about 0–9 in
  10" (either answer) means 0.05 ≤ |eta| ≤ 0.86: the pooled reading sits near
  the middle of the scale. At a pooled F0 of 175 Hz every meter logit from
  −5.7 to +2.3 gives "Can't tell yet"; an informative reading on the
  "woman" side needs the classifier at ≥ +2.3 (at 150 Hz ≥ +3.9, at 200 Hz
  ≥ +1.0).

## 3. Streams and chain

**Chain** (`scripts/heard-as/low-pitch-pauses/run.mjs`): the app's chain in
Node, line for line `scripts/heard-as/chain.mjs` `replay()` with the speech
detector live from the stream start — the REAL pitch worker (fake `self`),
the gender worker's 150 ms decision tick, the REAL utterance gate fed the
relayed pitch frames and the Silero v6.2.3 frames (sha256-pinned,
onnxruntime-web WASM), `decideMlWindow`, the silence floor, `classifyDue`
(450 ms), the deployed q8-v2 classifier — plus observation-only taps: an
independent replica of `pitch-worker.js` `processChunk` built from the same
factories records each posted frame's tracker decode, ghost veto, above-400 Hz
null and harmonic-guard veto (its posted value is checked equal to the real
worker's on every frame; the run stops otherwise), each tick's gate verdict
and whether a "warming" verdict is the post-onset share rule or the
steady-onset hold, and every speech-detector probability. `check_runner.mjs`
confirmed the runner reproduces `chain.mjs` `replay()` exactly (posted pitch,
scored windows, voice states) on two streams.

**Panel** (`analyze.mjs`): `src/ml/heard-as.js` with the shipped constants,
as `HeardAsPanel.jsx` and the earlier heard-as harnesses simulate it: an
update every 2 s of audio from the stream start, the 250 ms held-note check,
the display sampled every 250 ms. "Informative" = a shown reading that is not
"Can't tell yet" (`isWideShare`, the panel's own rule). Times are measured
from the start of speech (each stream has a 1 s lead-in of low noise);
shares are over the samples from speech start to 1 s after the last speech.
The **settled reading** of a stream is the aggregate of all its scored
windows pooled at once (no hide rules) — where the panel's reading would sit
given unlimited speech.

**Streams** (`build_streams.py`):
- **LibriSpeech readers:** 80 readers — test-clean (20 women, 20 men; the
  **dev** split) and dev-clean (20 / 20, in no fit; **held-out**). Per reader
  36 s of their utterances in order, each trimmed to its speech (50 ms
  margins) and joined back to back. **Breath pauses** go at the quietest
  20 ms point within ±0.4 s of a target every U(2, 4) s (seeded per reader,
  the same points in every condition): none (**p0**, continuous), fixed
  0.3 / 0.6 / 1.0 / 1.5 / 2.5 s, and **pnat** = U(0.3, 1.0) s per pause (the
  "natural pauses" condition). Pause fill: noise at −65 dBFS RMS.
- **WORLD voices** (pyworld: harvest F0 on the 8 kHz-decimated signal —
  men 60–300 Hz, women 100–500 Hz — CheapTrick envelope and D4C aperiodicity
  at 16 kHz; formants kept, F0 × factor): each reader's 36 s with its median
  voiced F0 moved to **75 Hz** (w75, the 70–80 Hz band), **90 Hz** (w90,
  85–95 Hz), **185 Hz** (w185, 150–220 Hz — the feminine-voice stand-in: a
  man's formants at a feminine pitch for men, women's own formants for
  women) and left in place (**w1**, the vocoder control). w75 / w90 / w185 in
  p0 and pnat, w1 in pnat. The shifted F0 track is the reference F0.
- **Natural low and other speech:** PTDB-TUG M01, M02, F01, F02 (60 s of
  sentences each, laryngograph reference), FDA rl / sb (60 s, laryngograph
  reference), Hillenbrand men (45) and women (48): each talker's 12 /hVd/
  words twice with 0.25 s gaps. Sentences / words separated by pnat pauses
  (Hillenbrand: 0.25 s).

1219 streams, 14.6 h of audio.

## 4. Results — the shipped panel

All 80 readers (dev + held-out) unless marked; per sex (W / M). Times are
medians over streams of the mean over four 2 s-timer phases (the panel's 2 s
timer starts when the panel mounts, not when speech starts; a phase that
never reaches the state counts the stream's whole span; "never" counts the
streams where no phase does). Shares are of the time from speech start to
1 s after the last speech.

### 4.1 Pauses (family b): the panel on natural reading

| pauses | sex | first reading s | informative s (never) | shown % | informative % | "Can't tell yet" % | hidden "Keep talking" (voiced < 3 s) % | hidden, < 10 windows % | other hidden % |
|---|---|---|---|---|---|---|---|---|---|
| none (p0) | W | 5.2 | 5.2 (1) | 84.2 | 72.8 | 11.4 | 6.8 | 3.8 | 5.2 |
| none (p0) | M | 5.8 | 5.8 (1) | 82.3 | 75.4 | 6.9 | 9.3 | 4.0 | 4.4 |
| 0.3 s | W | 5.8 | 5.8 (1) | 84.6 | 72.7 | 11.9 | 7.4 | 3.5 | 4.6 |
| 0.3 s | M | 6.2 | 6.2 (1) | 81.9 | 74.7 | 7.3 | 10.4 | 3.7 | 3.9 |
| 0.6 s | W | 5.8 | 5.8 (1) | 84.6 | 72.6 | 11.9 | 8.0 | 3.3 | 4.2 |
| 0.6 s | M | 6.8 | 6.8 (1) | 79.7 | 72.5 | 7.2 | 13.3 | 3.4 | 3.6 |
| 1.0 s | W | 6.2 | 6.2 (1) | 83.1 | 72.2 | 10.9 | 10.3 | 3.0 | 3.7 |
| 1.0 s | M | 7.0 | 7.0 (1) | 73.3 | 66.5 | 6.8 | 20.4 | 3.1 | 3.3 |
| 1.5 s | W | 6.8 | 7.0 (1) | 76.8 | 67.0 | 9.8 | 17.0 | 2.7 | 3.5 |
| 1.5 s | M | 7.2 | 7.2 (2) | 59.9 | 54.8 | 5.1 | 34.5 | 2.8 | 3.0 |
| 2.5 s | W | 7.8 | 7.8 (2) | 48.4 | 42.1 | 6.3 | 46.7 | 2.3 | 2.6 |
| 2.5 s | M | 8.5 (1 never) | 8.5 (2) | 31.5 | 29.1 | 2.4 | 63.9 | 2.3 | 2.4 |
| natural 0.3–1.0 s (pnat) | W | 5.8 | 6.0 (1) | 84.5 | 72.8 | 11.7 | 8.1 | 3.2 | 4.1 |
| natural 0.3–1.0 s (pnat) | M | 6.8 | 6.8 (1) | 78.4 | 71.0 | 7.4 | 14.9 | 3.4 | 3.5 |

("Other hidden" is almost all "Waiting for running speech" before the first
scored window, plus held-note hides.) Held-out readers alone, pnat: first
reading W 6.25 / M 6.75 s, informative 6.5 / 6.75 s, informative share
74.8 / 71.9 %; dev readers: 5.75 / 6.75 s, 5.75 / 6.75 s, 70.7 / 70.0 %.

**What blocks the first reading** (hidden updates before it, timer phase 0):

| pauses | sex | hidden updates | rule failing: voiced < 3 s | < 10 windows | no qualifying logit | voiced in the pool s (median) | all posted voiced in the last 8 s s | speech in the last 8 s s |
|---|---|---|---|---|---|---|---|---|
| p0 | W | 49 | 100 % | 0 % | 0 % | 2.05 | 2.15 | 3.00 |
| p0 | M | 62 | 100 % | 0 % | 0 % | 1.91 | 1.98 | 3.00 |
| pnat | W | 59 | 98.3 % | 1.7 % | 0 % | 2.08 | 2.12 | 3.00 |
| pnat | M | 82 | 98.8 % | 1.2 % | 0 % | 2.00 | 2.00 | 4.03 |
| 2.5 s | W | 131 | 98.5 % | 1.5 % | 0 % | 2.15 | 2.12 | 3.11 |
| 2.5 s | M | 162 | 98.8 % | 1.2 % | 0 % | 1.91 | 1.89 | 3.57 |

The pool already holds nearly all the posted voiced pitch there is: the
gate is not losing it. Running speech posts voiced pitch for about two
thirds of its duration (~0.65 s per second of speech here), so 3.0 s of
voiced pitch needs ~4.5–5 s of speech inside the trailing 8 s.

**After the first reading** (updates from the first reading to the end of
speech, phase 0):

| pauses | shown W / M % | hidden "Keep talking" W / M % | voiced in the pool at shown updates W / M s |
|---|---|---|---|
| p0 | 99.7 / 99.5 | 0.0 / 0.5 | 5.70 / 4.97 |
| pnat | 98.8 / 92.7 | 1.0 / 7.3 | 4.72 / 4.20 |
| 1.0 s | 97.0 / 86.8 | 2.7 / 13.2 | 4.33 / 3.89 |
| 1.5 s | 88.9 / 70.9 | 10.8 / 29.1 | 3.95 / 3.65 |
| 2.5 s | 57.4 / 37.3 | 42.4 / 62.7 | 3.60 / 3.45 |

Longer pauses take speech out of the 8 s clock window, the pooled voiced time
falls under 3.0 s and the reading hides ("Keep talking") — more for men,
whose voices post less voiced pitch per second of speech.

**The utterance gate and the other rules** (speech windows = windows ≥ 50 %
inside speech):

| pauses | sex | scored % | warming: post-onset share % | warming: steady-onset hold % | pause: no speech ≤ 500 ms % | pause: < 15 % speech % | silent (utterance closed) % | held note % | utterances per min of speech | scored windows mostly in a pause % | classified windows whose logit doesn't count (< 200 ms voiced) % | detector hangover after speech ms |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| p0 | W | 96.8 | 0.3 | 0.4 | 1.4 | 0.2 | 0.7 | 0.3 | 4.5 | 0.4 | 4.1 | — |
| p0 | M | 96.2 | 0.3 | 0.4 | 2.2 | 0.4 | 0.5 | 0.1 | 4.1 | 0.4 | 10.0 | — |
| pnat | W | 94.6 | 0.6 | 1.2 | 1.9 | 0.3 | 1.2 | 0.2 | 7.3 | 8.9 | 10.4 | 52 |
| pnat | M | 93.7 | 0.9 | 1.0 | 2.4 | 0.2 | 1.7 | 0.1 | 8.8 | 8.1 | 15.3 | 31 |
| 1.0 s | W | 93.1 | 1.0 | 2.4 | 1.6 | 0.2 | 1.6 | 0.2 | 13.6 | 7.8 | 9.3 | 50 |
| 1.0 s | M | 93.1 | 1.1 | 1.6 | 2.2 | 0.1 | 1.7 | 0.1 | 15.8 | 7.0 | 15.2 | 24 |
| 2.5 s | W | 93.0 | 1.0 | 2.4 | 1.6 | 0.1 | 1.7 | 0.2 | 22.2 | 5.6 | 5.9 | 50 |
| 2.5 s | M | 93.0 | 1.1 | 1.6 | 2.1 | 0.2 | 1.8 | 0.1 | 22.8 | 5.2 | 12.1 | 34 |

(No speech window was lost to the silence floor.) Pauses of ≥ 1 s close the
utterance (`gapMs` 1000) at every pause, so each restart costs its
post-onset share (~300 ms) and the steady-onset watch — together 2.5–3.5 %
of speech windows. The speech detector releases ~25–50 ms after speech
ends. No reading went stale (`freshMs` 5 s; no pause here is that long).
The voiced-windows rule drops 4–17 % of classified windows' logits but never
emptied a pool (0 % "no qualifying logit"). The gender worker's EMA and
silence reset do not reach the panel.

### 4.2 Low pitch (family a)

| stream | sex | first reading s (never) | shown % | informative % | "Can't tell yet" % | hidden "Keep talking" % | hidden "Outside the range" % |
|---|---|---|---|---|---|---|---|
| WORLD 75 Hz, continuous | W | 29.5 (14 of 40) | 13.4 | 6.2 | 7.2 | 78.0 | 0.5 |
| WORLD 75 Hz, continuous | M | 30.9 (14) | 14.8 | 14.4 | 0.4 | 77.0 | 0.0 |
| WORLD 75 Hz, pnat | W | never (24 of 40) | 5.0 | 2.2 | 2.7 | 88.2 | 0.1 |
| WORLD 75 Hz, pnat | M | never (27) | 5.5 | 5.4 | 0.0 | 87.7 | 0.0 |
| WORLD 90 Hz, continuous | W | 6.2 (0) | 78.2 | 22.2 | 56.0 | 13.4 | 0.0 |
| WORLD 90 Hz, continuous | M | 7.0 (1) | 74.2 | 72.4 | 1.8 | 17.5 | 0.0 |
| WORLD 90 Hz, pnat | W | 7.0 (1) | 70.1 | 19.4 | 50.8 | 22.7 | 0.0 |
| WORLD 90 Hz, pnat | M | 7.5 (1) | 60.9 | 59.8 | 1.1 | 32.5 | 0.0 |
| WORLD own F0 (control), pnat | W | 5.8 (0) | 84.8 | 73.7 | 11.1 | 7.7 | 0.0 |
| WORLD own F0 (control), pnat | M | 6.2 (0) | 81.6 | 73.6 | 8.0 | 11.5 | 0.0 |
| PTDB-TUG (2 + 2 talkers) | W | 6.5 (0) | 85.4 | 85.4 | 0.0 | 10.6 | 0.0 |
| PTDB-TUG | M | 21.5 (0) | 41.8 | 41.8 | 0.0 | 53.6 | 0.0 |
| FDA (1 + 1) | W | 8.8 (0) | 65.4 | 65.4 | 0.0 | 29.8 | 0.0 |
| FDA | M | 8.8 (0) | 74.6 | 74.6 | 0.0 | 22.0 | 0.0 |
| Hillenbrand /hVd/ (48 + 45) | W | 6.8 (0) | 67.1 | 65.7 | 1.5 | 18.0 | 0.0 |
| Hillenbrand /hVd/ | M | 6.8 (1) | 60.0 | 53.0 | 7.5 | 24.2 | 0.0 |

The utterance gate scores low voices like any other (WORLD 75 Hz pnat:
93–94 % of speech windows scored, as for natural voices). The pooled F0 is
the median of the POSTED pitch, which stays above the fit floor (median
87–90 Hz for the 75 Hz voices: only their higher frames get posted), so the
"Outside the range it was tested on" rule (81 Hz) hides ≤ 0.7 % of the time.
The loss is the voiced time: the pitch worker posts too little of a voice
below 75 Hz, the pool never reaches 3.0 s, and the panel says "Keep
talking". Where the reference F0 is (pitch-worker stage of
reference-voiced frames inside speech):

| stream | sex | reference F0 | frames | posted % | tracker says unvoiced % | decoded > 400 Hz → null % | harmonic guard % |
|---|---|---|---|---|---|---|---|
| WORLD 75 Hz, pnat | W | < 75 Hz | 23173 | 4.4 | 77.5 | 16.5 | 1.5 |
| WORLD 75 Hz, pnat | M | < 75 Hz | 23278 | 6.7 | 75.6 | 15.5 | 2.2 |
| WORLD 75 Hz, pnat | W | 75–81 Hz | 7114 | 59.0 | 27.1 | 5.7 | 8.2 |
| WORLD 75 Hz, pnat | M | 75–81 Hz | 6256 | 56.4 | 28.6 | 6.8 | 8.1 |
| WORLD 90 Hz, pnat | W | 81–90 Hz | 11234 | 77.1 | 14.0 | 3.5 | 5.4 |
| WORLD 90 Hz, pnat | M | 81–90 Hz | 8844 | 74.1 | 16.2 | 3.5 | 6.3 |
| WORLD own F0, pnat | M | 100–160 Hz | 26729 | 80.1 | 14.5 | 3.0 | 2.4 |
| WORLD own F0, pnat | W | 160–230 Hz | 27864 | 89.2 | 8.8 | 1.7 | 0.2 |
| PTDB-TUG (natural) | M | 81–90 Hz | 242 | 81.4 | 6.2 | 0.4 | 12.0 |
| PTDB-TUG (natural) | M | 100–160 Hz | 1362 | 92.8 | 4.3 | 0.4 | 2.4 |

(The ghost veto never fired: no tonal noise in these streams.) Below the
detector's 75 Hz floor the tracker calls the frame unvoiced (~76–78 %) or
locks onto a high harmonic that the above-400 Hz rule nulls (~16 %).
Between 75 and 81 Hz ~57–59 % is posted. The WORLD vocoder itself costs
posted voicing (own-F0 control: 80–89 % posted vs 93–98 % on the
laryngograph corpora at similar pitch), so the WORLD rows are somewhat
pessimistic; the control's panel numbers (shown 84.8 / 81.6 %) are close to
the natural readers' (84.5 / 78.4 %), so the vocoder does not drive the
panel results. Natural low men: the two PTDB-TUG men (median posted F0
~98 and ~116 Hz) get a first reading after 21.5 s (median of 2) and are
shown 42 % of the time — the 98 Hz talker posts too little voicing for
3.0 s in 8 s (the same "Keep talking" loss, without any frame below 81 Hz).

### 4.3 Feminine-voice speech (family c)

| stream | sex of the original speaker | first reading s | informative s (never) | shown % | informative % | "Can't tell yet" % | streams whose settled reading is "Can't tell" | of the "Can't tell" time: the voice (settled reading also wide) % | … pooling (settled reading informative) % | settled meter logit (median) | settled F0 Hz (median) |
|---|---|---|---|---|---|---|---|---|---|---|---|
| natural women, pnat | W | 5.8 | 6.0 (1) | 84.5 | 72.8 | 11.7 | 5 of 40 | 73.0 | 27.0 | +3.70 | 191 |
| natural women, continuous | W | 5.2 | 5.2 (1) | 84.2 | 72.8 | 11.4 | 5 | 74.0 | 26.0 | +3.76 | 191 |
| WORLD own F0 (control), pnat | W | 5.8 | 6.0 (1) | 84.8 | 73.7 | 11.1 | 5 | 70.7 | 29.3 | +3.80 | 191 |
| WORLD 185 Hz, pnat | W | 5.8 | 6.0 (1) | 85.1 | 78.5 | 6.6 | 2 | 57.4 | 42.6 | +3.78 | 187 |
| WORLD 185 Hz, pnat | M | 6.2 | never (30 of 40) | 84.3 | 5.0 | 79.2 | 38 of 40 | 98.3 | 1.7 | −2.24 | 187 |
| WORLD 185 Hz, continuous | M | 5.2 | never (31) | 84.7 | 5.7 | 79.1 | 38 | 99.3 | 0.7 | −2.25 | 188 |
| natural men, pnat (for comparison) | M | 6.8 | 6.8 (1) | 78.4 | 71.0 | 7.4 | 2 | 52.8 | 47.2 | −5.03 | 119 |

- **A feminine pitch gets a first reading as fast as any voice** (5.8–6.2 s
  with natural pauses). Pauses delay it by ~0.6–1 s (§4.1).
- **A wide range is mostly the voice, not too little speech.** Men's voices
  raised to ~185 Hz with their own (male) formants — the stand-in for a
  voice that has changed pitch more than resonance — settle at a meter logit
  of about −2.2 at 187 Hz: eta ≈ +0.3 (settled eta between −1.9 and +0.9;
  inside the "Can't tell" band for 38 of 40 voices). The panel then says
  "Can't tell yet" 79 % of the time, and 98–99 % of that time belongs to
  voices whose settled reading — all their speech pooled at once — is itself
  "Can't tell". More speech or a faster pool would not change it: it is the
  calibration's answer for that voice (failure #1 of the calibration note:
  it follows pitch more than listeners do; and no trans women's voices were
  in the fit). For women's own voices "Can't tell yet" is 11.7 % of the
  time: three quarters of it from the five women whose settled reading is
  itself in the middle (five voices give 75 % of the women's "Can't tell"
  time), and about a quarter (27 %; men 47 % of a smaller 7.4 %) is
  pooling — a reading that sits in the middle for a while before it settles
  on one side. Most of the women's "Can't tell" updates (78 of 107) come
  after the first 15 s, not at the start.
- So the user's screenshot (feminine pitch, "Can't tell yet", about 0–9 in
  10) is what the panel shows when the pooled classifier reading is near the
  middle — at 175 Hz any meter logit from −5.7 to +2.3. Waiting does not
  narrow it; nothing in this plan changes that (the range width is the
  calibration's coverage, not a speed setting).

## 5. Attribution in plain words

1. **Breath pauses.** The only rule that holds back the first reading is
   "≥ 3.0 s of posted voiced pitch in the last 8 s" (98–100 % of the hidden
   updates before it). Speech posts voiced pitch for about two thirds of
   its duration, so the panel needs ~4.5–5 s of speech inside 8 s; with natural
   pauses the first reading comes after ~5.8 s (women) / 6.8 s (men) of
   talking, and the 2 s update timer adds on average ~1 s of that. Once
   shown, pauses take speech out of the 8 s clock window: with 1.5 s pauses
   the reading hides again 11 % (women) / 29 % (men) of the time, with 2.5 s
   pauses 42 % / 63 %. The utterance gate (`gapMs`, post-onset share,
   recency, minimum share), the speech detector's hangover, `freshMs`, the
   window-count rule and the gender worker's EMA cost little or nothing:
   the gate leaves 3–7 % of speech windows unscored, but the pool still
   holds nearly all posted voiced pitch (their frames fall inside
   neighbouring windows' spans); the window count fails at 1–2.5 % of the
   hidden updates; nothing went stale; the EMA does not reach the panel.
2. **Low pitch.** Below ~80 Hz the panel is held back by the **pitch
   worker**, not the panel: under its 75 Hz floor 93–96 % of voiced frames
   are posted as unvoiced (tracker unvoiced, or a high-harmonic lock nulled
   above 400 Hz), so the 3.0 s voiced rule is rarely met ("Keep talking"
   78–88 % of the time; 24–27 of 40 voices at ~75 Hz with pauses never get a
   reading). The 81 Hz "Outside the range" rule is not the cause (≤ 0.7 %),
   because only the higher, posted frames enter the pooled F0. At ~90 Hz men
   get readings (61–74 % of the time); women's voices lowered to 90 Hz mostly
   read "Can't tell yet" (their formants against a man's pitch).
3. **"Can't tell yet" in a feminine voice.** The range has a fixed width; it
   says "Can't tell yet" whenever the pooled reading is near the middle. For
   a voice that raised its pitch with male-typical resonance that is where
   the reading settles (98 % of its "Can't tell" time). A minority of the
   "Can't tell" time of typical voices (~¼ for women, ~½ for men) is a
   reading that has not settled yet.

## 6. Plan (pre-registered 2026-10-21)

Committed and pushed before any candidate is coded or run. Every number
below is computed with `scripts/heard-as/low-pitch-pauses/` on the streams of
§3 (the same build), the panel simulated as in §3–4 (four timer phases).

### 6.1 Candidates (heard-as modules only)

- **H1 — voiced minimum at the fit level:** `minVoicedMs` 3000 → **2000**
  (`heardAsCalibration.js`). The constants were fitted on single utterances
  of ~2 s voiced (Palette median 2.06 s inside the scored windows,
  calibration note §3); the 3.0 s minimum is a display rule stricter than the
  fit material (§7 there: estimate noise SD 0.67 logit at 1 s voiced, 0.53 at
  3 s). `minWindows` stays 10.
- **H2 — a pool of speech time, not clock time** (`heard-as.js`
  `aggregate()` / `estimate()`): the pool keeps the scored windows whose end
  lies within the trailing **8 s of speech time** — clock time in which every
  gap between consecutive scored windows (and between the newest scored
  window and now) counts at most 750 ms (one window length) — and never
  reaches back more than **16 s** of clock time. In unbroken speech it is the
  shipped pool; in pauses it stops the pool draining. `freshMs` (5 s) is
  unchanged, so a reading still goes away 5 s after the last scored window.
  The legend "From your last ~8 s of speech" becomes literally true.
- **H3 — show the first reading when it is ready** (`HeardAsPanel.jsx`):
  while the panel shows no reading, it re-checks every 250 ms (the existing
  held-note check timer) and shows a reading as soon as `estimate()` returns
  one; once a reading is shown, updates stay on the 2 s timer. The
  pitch-only warning is fed only on the 2 s timer, as now (the extra checks
  never reach it).
- **Configurations:** H1, H2, H3, H1+H2, H1+H3, H2+H3, H1+H2+H3.

**Not candidates:** narrowing the range (`halfWidth`) — a wide range for an
ambiguous voice is the calibration's answer (§4.3); the 81 Hz range floor —
it hides ≤ 0.7 % (§4.2); the utterance gate, the speech detector,
`freshMs`, `minWindows`, `logitMinVoicedMs` and the worker EMA (§5, item 1).

**Separate, NOT in the selection:**
- **P1 (pitch chain — needs user approval):** let the pitch worker post
  voices below 75 Hz for the heard-as pool — e.g. search from ~55–60 Hz and
  pass sub-75 Hz values to the gender worker / heard-as only (the trace,
  readout and session stats keep the 75 Hz floor), and do not null a
  > 400 Hz decode that is a harmonic lock of a voice just below the floor.
  Evidence: §4.2 (93–96 % of < 75 Hz voiced frames lost). It needs the full
  pitch regression checklist (session oracle, real-session false voicing,
  corpora) and the user's approval before any work.
- **W1 (wording — user decision):** "Can't tell yet" promises that waiting
  helps; for a voice whose reading sits in the middle it does not (§4.3).
  Possible words once a reading is shown: "Could go either way — listeners
  would be split". Display only; no estimate changes.

### 6.2 Split and selection

- **Dev:** the 40 LibriSpeech test-clean readers (20 W / 20 M) and their
  pause / WORLD streams. **Held-out:** the 40 dev-clean readers (20 / 20, in
  no fit) and theirs. PTDB-TUG, FDA and Hillenbrand are reported only.
- **Selection (dev only, written to `build/heard-as/lowpause/selection.json`
  before any held-out candidate number is computed):** a configuration is
  eligible if on dev, for women and for men, it passes (i), (ii) and the
  live parts of (iii) below. Of the eligible ones, the one with the fewest
  changes; ties → the larger min-over-sexes improvement in median time to an
  informative reading. If none is eligible: verdict FAIL, nothing ships, the
  numbers are reported.

### 6.3 The bar (held-out, women and men separately; failing for one sex fails)

(i) **Responsiveness, natural voices with natural pauses (pnat):**
- median time to the first reading ≥ 30 % shorter than shipped (held-out
  shipped: W 6.25 s, M 6.75 s → ≤ 4.38 / 4.73 s);
- median time to an informative reading ≥ 30 % shorter, over the streams
  whose shipped settled reading is informative (W 18, M 19 of 20; a stream
  that never gets one counts as infinite; shipped W 6.25 s, M 6.75 s →
  ≤ 4.38 / 4.73 s);
- mean share of time with an informative reading higher than shipped
  (held-out shipped W 74.8 %, M 71.9 %).

(ii) **Low pitch:**
- WORLD 75 Hz, pnat: the number of voices that never get a reading falls by
  at least a third (held-out shipped: W 14 of 20, M 12 of 20 → ≤ 9 / ≤ 8);
- WORLD 90 Hz, pnat: shown share ≥ shipped + 10 pp (held-out shipped
  W 68.5 %, M 67.3 %).

(iii) **No accuracy change beyond the calibration's tolerances:**
- the aggregate definitions the constants were fitted on are untouched:
  `tests/ml/heard-as-equivalence-test.js` passes unchanged,
  `make_golden.mjs` regenerates `tests/ml/fixtures/heard-as-golden.json`
  byte-identical and `golden_check.py` agrees, the test vectors are
  unchanged, and the whole-stimulus Palette estimates are unchanged (H1–H3
  do not touch a whole-stimulus aggregate; the equivalence test's
  "live estimate at the stimulus end == the fit-time aggregate" covers H2);
- **live readings shown by both** (held-out natural readers, all pause
  conditions pooled): mean eta difference candidate − shipped within
  ± 0.225 logit (a tenth of the half-width; the tolerance of
  `heard-as-voiced-windows-2026-10-08.md` A2) per sex;
- **readings only the candidate shows** (same streams): the share that are
  informative on the OPPOSITE side from the stream's settled reading is at
  most the shipped shown readings' share + 2 pp, per sex; their mean
  |eta − settled eta| is reported next to the shipped readings'.

(iv) **No new readings where there should be none** (every sample hidden,
as shipped):
- synthetic held vowel, pink noise and digital silence
  (`scripts/cue-strip-smoke-wavs.mjs`, 48 kHz), 60 s of the −65 dBFS pause
  fill alone, 60 s of pink noise at speech level;
- held notes: synthetic held vowels at 110 / 220 / 330 Hz (5 s, ±0.3 st
  vibrato) alone and right after 10 s of reading — no reading while the
  voice state is "sustained", and a shown reading still hides within 250 ms
  of it (held notes stay excluded);
- whisper (user decision: whisper gets no reading): the 2026-10-08 whisper
  streams (EARS / Expresso, rebuilt from the public sources): whisper-only
  streams get no reading; on speech + whisper the whisper logit share (B1
  of `heard-as-voiced-windows-2026-10-08.md`) stays ≤ 5.0 % per sex. If
  the whisper set cannot be rebuilt, the verdict is HELD until it is.

(v) **Nothing gets worse elsewhere:** continuous reading (p0, held-out):
shown share ≥ shipped − 0.5 pp and median first reading not later, per
sex; every other pause condition, PTDB-TUG, FDA and Hillenbrand reported.

(vi) **CI and app:** `npm run lint`, `npm run test:unit` (only the pinned
constants in `tests/ml/heard-as-test.js` change, with new cases for H2 /
H3), `npm run test:resonance-lab`, `npm run build`; with H3 the cue-strip
smoke and `scripts/resonance-lab/lab-layout-smoke.mjs` (panel states) pass.
The pitch-only warning's golden test passes unchanged; the change in the
update stream it is fed (time of the first shown update, updates per
minute) is reported, and the user decides whether its study needs a re-run.

**Verdict:** SHIP-ELIGIBLE only if (i)–(vi) all pass on held-out for both
sexes; otherwise FAIL with the numbers, and the user decides. No PR is
opened by this work.

## 7. Reproduce

```
python scripts/heard-as/low-pitch-pauses/build_streams.py --libri=<LibriSpeech root> \
  --corpora=<tests/dsp/data> --out=build/heard-as/lowpause/streams --shard=0/2   # and 1/2
node scripts/heard-as/low-pitch-pauses/run.mjs --jobs=<streams>/jobs.0.json,<streams>/jobs.1.json \
  --out=build/heard-as/lowpause/run.0.jsonl --shard=0/2 --silero=<silero_vad.onnx>   # and 1/2
node scripts/heard-as/low-pitch-pauses/check_runner.mjs --run=<run.jsonl> --ids=<id,…> --silero=<silero_vad.onnx>
node scripts/heard-as/low-pitch-pauses/analyze.mjs --runs=<run.0.jsonl>,<run.1.jsonl> --out=<dir>
python scripts/heard-as/low-pitch-pauses/report.py <dir>/streams.shipped.json [--split=dev|test]
```

Python: numpy, scipy, soundfile, pyworld 0.3.5. The Silero file is the
pinned v6.2.3 (`SPEECH_DETECTOR.modelUrl`, sha256-checked); the classifier
is the deployed q8-v2 from the transformers.js cache. 1219 streams, 14.6 h
of audio, ~58 min wall in two processes. In `report.py` and the stream
files, `split` "dev" = test-clean, "test" = dev-clean (held-out).
