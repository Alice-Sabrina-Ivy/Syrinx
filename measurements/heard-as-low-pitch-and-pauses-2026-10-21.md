# "Likely heard as": low pitch and breath pauses — attribution and pre-registered plan — 2026-10-21

**Status: attribution of the shipped panel + pre-registered plan (§1–7) +
results (§8).** The attribution measures only the shipped code. The plan (§6)
was committed and pushed (2d8ce1d) before any candidate was coded or run; the
dev selection (H1+H3) was committed and pushed (d1c4d46) before the pick's one
held-out run. **Result: H1+H3 passes every part of the bar on held-out for
women and men (§8).** A review the same day (§9) rebuilt the §8.3 guard
baseline (pass / fail unchanged) and added what the bar did not check: the
new ~75 Hz readings lean toward "woman", early readings for one feminine-pitch
male voice, and short "Keep talking" flashes (§8.5). **Addendum (2026-10-21, after §9): a pre-registered low-voice hide rule —
FAIL on dev, nothing implemented** (no rule hides the ~75 Hz readings
without costing ~90 Hz voices 12–60 points; §A.4). This is the hard-rule-3 measurement file for any change to
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

Candidates and the bar (after §6 was committed):

```
node scripts/heard-as/low-pitch-pauses/candidates.mjs --runs=<run.0.jsonl>,<run.1.jsonl> --out=<dir> --split=dev
node scripts/heard-as/low-pitch-pauses/candidates.mjs --runs=… --out=<dir> --split=test --variant=H1+H3
node scripts/heard-as/low-pitch-pauses/analyze.mjs --runs=… --out=<dir> --variant=H1+H3
python scripts/heard-as/low-pitch-pauses/build_guards.py --out=<guards> --smoke=build/cue-strip-smoke \
  --streams=build/heard-as/lowpause/streams --whisper="<Expresso dir>;<EARS dir>"
node scripts/heard-as/low-pitch-pauses/run.mjs --jobs=<guards>/jobs.json --out=<guards>/run.0.jsonl --shard=0/2 --silero=…   # and 1/2
node scripts/heard-as/low-pitch-pauses/guards.mjs --runs=<guards>/run.0.jsonl,<guards>/run.1.jsonl --variant=H1+H3
```

`candidates.mjs --split=dev` writes `selection.json` once and refuses to
overwrite it; `--split=test` runs only the variant `selection.json` names, once.
"shipped" in all three scripts is the panel before 2026-10-21 (3 s rule, no
first-reading check), pinned in `analyze.mjs` `VARIANTS` since the review
(§8.3, §9); before that it followed `heardAsCalibration.js`. The review's
extra checks of §8.5 (low-pitch bias, flashes, readings only H1+H3 shows):
`node scripts/heard-as/low-pitch-pauses/review_checks.mjs --runs=<run.0.jsonl>,<run.1.jsonl>`.

The CI fixture (§8.7), from the same runs:

```
node scripts/heard-as/low-pitch-pauses/make_test_fixture.mjs --runs=<run.0.jsonl>,<run.1.jsonl> \
  --guards=<guards>/run.0.jsonl,<guards>/run.1.jsonl
node tests/ml/heard-as-responsiveness-test.js
```

## 8. Results (2026-10-21)

**Order.** Plan committed and pushed 10:20:56 CDT (2d8ce1d). Candidates
coded afterwards (`heard-as.js` gained the H2 options, default off — the
shipped panel's stream metrics regenerate byte-identical). Dev selection
written 10:30:36 CDT and committed and pushed with the code (d1c4d46,
10:30:47). The pick's one held-out run: 10:31:17.

### 8.1 Selection on dev (LibriSpeech test-clean, 20 W / 20 M)

Dev shipped: first reading W 5.75 / M 6.75 s (targets ≤ 4.03 / ≤ 4.73 s);
informative reading the same; informative share 70.7 / 70.0 %; WORLD 75 Hz
pnat with no reading 10 / 15 of 20 (targets ≤ 6 / ≤ 10); WORLD 90 Hz pnat
shown 71.8 / 54.4 % (targets ≥ 81.8 / ≥ 64.4 %).

| config | W: first / informative s, inf. share % | W: 75 Hz never, 90 Hz shown % | W: Δeta both / opposite % | M: first / informative s, inf. share % | M: 75 Hz never, 90 Hz shown % | M: Δeta both / opposite % | eligible |
|---|---|---|---|---|---|---|---|
| H1 | 3.75 / 3.75, 75.5 ✓ | 3, 86.5 ✓ | 0.000 / 0.0 ✓ | **4.75** / 4.75, 81.0 ✗ | 1, 80.8 ✓ | 0.000 / 0.0 ✓ | no |
| H2 | 5.75 / 5.75, 70.9 ✗ | 9, 73.8 ✗ | +0.002 / 0.0 ✓ | 6.75 / 6.75, 75.4 ✗ | 14, 61.2 ✗ | +0.003 / 0.0 ✓ | no |
| H3 | 5.00 / 5.00, 73.0 ✗ | 10, 76.9 ✗ | 0.000 / 0.0 ✓ | 5.75 / 5.75, 74.1 ✗ | 15, 61.9 ✗ | 0.000 / 0.0 ✓ | no |
| H1+H2 | 3.75 / 3.75, 75.5 ✓ | 3, 87.0 ✓ | +0.002 / 0.0 ✓ | **4.75** / 4.75, 82.0 ✗ | 1, 81.5 ✓ | +0.003 / 0.0 ✓ | no |
| **H1+H3** | 3.00 / 3.00, 77.5 ✓ | 3, 89.2 ✓ | 0.000 / 0.0 ✓ | 4.00 / 4.00, 83.1 ✓ | 1, 83.6 ✓ | 0.000 / 0.0 ✓ | **yes** |
| H2+H3 | 5.00 / 5.00, 72.9 ✗ | 9, 78.3 ✗ | +0.002 / 0.0 ✓ | 5.75 / 5.75, 78.0 ✗ | 14, 68.1 ✗ | +0.003 / 0.0 ✓ | no |
| H1+H2+H3 | 3.00 / 3.00, 77.5 ✓ | 3, 89.5 ✓ | +0.002 / 0.0 ✓ | 4.00 / 4.00, 83.9 ✓ | 1, 84.1 ✓ | +0.003 / 0.0 ✓ | yes |

(Δeta both = mean eta difference where both versions show a reading,
tolerance ± 0.225; opposite = readings only the candidate shows that are
informative on the other side of the stream's settled reading, bar: the
shipped readings' share + 2 pp — shipped 0.0 %.) Eligible: H1+H3 and
H1+H2+H3. **Pick: H1+H3** (fewest changes). H1 alone missed the men's
first-reading target by 0.03 s; H2 and H3 alone are far from it.

### 8.2 The pick on held-out (LibriSpeech dev-clean, 20 W / 20 M) — the bar

| part | measure | W shipped → H1+H3 (target) | M shipped → H1+H3 (target) | result |
|---|---|---|---|---|
| (i) | first reading, natural pauses (median s) | 6.25 → **3.38** (≤ 4.38) | 6.75 → **3.88** (≤ 4.73) | pass |
| (i) | informative reading, natural pauses (median s; 18 / 19 streams) | 6.25 → **3.38** (≤ 4.38) | 6.75 → **3.75** (≤ 4.73) | pass |
| (i) | time with an informative reading % | 74.8 → **81.6** (> 74.8) | 71.9 → **82.1** (> 71.9) | pass |
| (ii) | WORLD 75 Hz, pauses: voices with no reading | 14 → **1** of 20 (≤ 9) | 12 → **1** of 20 (≤ 8) | pass |
| (ii) | WORLD 90 Hz, pauses: shown % | 68.5 → **89.4** (≥ 78.5) | 67.3 → **87.3** (≥ 77.3) | pass |
| (iii) | readings both show: mean eta change | 0.000 (79,259 samples) | 0.000 (72,998) | pass |
| (iii) | readings only H1+H3 shows: informative on the wrong side | 0.0 % of 16,915 (≤ 0.0 + 2) | 0.0 % of 21,755 (≤ 0.0 + 2) | pass |
| (iii) | … their mean \|eta − settled eta\| (reported) | 0.27 (shipped readings 0.18) | 0.27 (0.22) | — |
| (iii) | equivalence test, golden file, test vectors | 28 / 28 pass; `make_golden.mjs` rewrites `heard-as-golden.json` byte-identical (its `golden_check.py` agrees); the test vectors pass unchanged | | pass |
| (iv) | noise, silence, pause fill, held notes, whisper | no new reading anywhere (§8.3) | | pass |
| (v) | continuous reading: shown % | 83.4 → 90.6 (≥ 82.9) | 83.2 → 90.0 (≥ 82.7) | pass |
| (v) | continuous reading: first reading s | 5.25 → 3.13 (not later) | 5.75 → 3.25 | pass |
| (vi) | lint, unit tests, resonance-lab tests, build, smoke | §8.4 | | pass |

**Verdict: SHIP-ELIGIBLE** — every part passes on held-out for women and for
men. Readings that both versions show are identical by construction: H1 and
H3 never change what a pool holds, only whether it is shown, and when.
Readings that only H1+H3 shows sit further from where the voice settles
(mean |eta − settled| 0.27 vs 0.18–0.22: they pool 2–3 s of voiced pitch
instead of ≥ 3 s), but none of them was informative on the wrong side.

Held-out, every condition (shipped → H1+H3; times = median of the per-stream
mean over the four timer phases):

| stream | sex | first reading s | informative s | no reading (of 20) | shown % | informative % | "Can't tell yet" % | shown after the first reading % |
|---|---|---|---|---|---|---|---|---|
| natural, continuous | W | 5.25 → 3.13 | 5.25 → 3.25 | 0 → 0 | 83.4 → 90.6 | 74.3 → 81.1 | 9.0 → 9.5 | 98.6 → 99.6 |
| natural, continuous | M | 5.75 → 3.25 | 5.75 → 3.25 | 0 → 0 | 83.2 → 90.0 | 75.4 → 81.9 | 7.8 → 8.0 | 99.5 → 99.9 |
| natural, 0.3 s pauses | W | 5.75 → 3.25 | 5.75 → 3.25 | 0 → 0 | 83.8 → 91.1 | 74.5 → 81.5 | 9.4 → 9.7 | 98.9 → 99.8 |
| natural, 0.3 s pauses | M | 6.25 → 3.50 | 6.25 → 3.50 | 0 → 0 | 82.3 → 90.4 | 74.0 → 81.9 | 8.3 → 8.5 | 97.6 → 100.0 |
| natural, 0.6 s pauses | W | 5.75 → 3.50 | 6.00 → 3.50 | 0 → 0 | 84.1 → 91.6 | 74.7 → 81.7 | 9.3 → 9.9 | 99.2 → 99.8 |
| natural, 0.6 s pauses | M | 6.75 → 3.88 | 6.75 → 3.88 | 0 → 0 | 81.0 → 90.6 | 73.0 → 82.3 | 8.0 → 8.3 | 96.3 → 99.8 |
| natural, 1.0 s pauses | W | 6.25 → 3.63 | 6.50 → 3.88 | 0 → 0 | 82.8 → 91.9 | 74.3 → 82.9 | 8.5 → 9.0 | 97.0 → 99.9 |
| natural, 1.0 s pauses | M | 6.75 → 4.13 | 6.75 → 4.13 | 0 → 0 | 75.6 → 90.5 | 67.7 → 81.6 | 7.9 → 8.9 | 88.0 → 99.3 |
| natural, 1.5 s pauses | W | 7.00 → 3.63 | 7.25 → 4.13 | 0 → 0 | 76.0 → 92.2 | 68.3 → 82.3 | 7.7 → 9.8 | 88.4 → 99.8 |
| natural, 1.5 s pauses | M | 7.25 → 4.75 | 7.25 → 4.75 | 0 → 0 | 64.4 → 89.5 | 58.1 → 80.9 | 6.3 → 8.6 | 75.3 → 98.2 |
| natural, 2.5 s pauses | W | 7.75 → 3.63 | 8.00 → 4.63 | 0 → 0 | 47.0 → 90.5 | 43.2 → 81.4 | 3.8 → 9.1 | 53.8 → 97.1 |
| natural, 2.5 s pauses | M | 8.25 → 5.63 | 8.25 → 5.63 | 0 → 0 | 35.2 → 84.7 | 31.6 → 76.3 | 3.5 → 8.4 | 38.9 → 92.5 |
| natural, natural pauses | W | 6.25 → 3.38 | 6.50 → 3.50 | 0 → 0 | 84.3 → 91.5 | 74.8 → 81.6 | 9.5 → 9.8 | 98.8 → 99.9 |
| natural, natural pauses | M | 6.75 → 3.88 | 6.75 → 3.88 | 0 → 0 | 80.0 → 90.5 | 71.9 → 82.1 | 8.1 → 8.4 | 94.1 → 99.8 |
| WORLD 75 Hz, continuous | W | 29.8 → 8.4 | never → 19.9 | 8 → 0 | 10.0 → 53.9 | 2.2 → 18.3 | 7.8 → 35.6 | 34.6 → 72.6 |
| WORLD 75 Hz, continuous | M | 30.6 → 6.3 | 31.5 → 6.3 | 8 → 0 | 18.2 → 62.9 | 17.5 → 61.2 | 0.7 → 1.7 | 59.2 → 79.6 |
| WORLD 75 Hz, pauses | W | never → 12.8 | never → 24.4 | 14 → 1 | 3.3 → 33.2 | 1.0 → 11.3 | 2.3 → 21.9 | 42.9 → 52.5 |
| WORLD 75 Hz, pauses | M | never → 7.1 | never → 7.1 | 12 → 1 | 7.3 → 47.7 | 7.3 → 46.3 | 0.1 → 1.4 | 46.4 → 64.8 |
| WORLD 90 Hz, continuous | W | 6.50 → 3.75 | 33.6 → 33.6 | 0 → 0 | 77.4 → 89.0 | 17.2 → 20.7 | 60.2 → 68.3 | 98.0 → 99.9 |
| WORLD 90 Hz, continuous | M | 6.50 → 3.50 | 6.75 → 3.50 | 0 → 0 | 76.5 → 88.7 | 72.8 → 84.9 | 3.7 → 3.8 | 94.3 → 99.8 |
| WORLD 90 Hz, pauses | W | 7.50 → 4.25 | 29.8 → 29.8 | 0 → 0 | 68.5 → 89.4 | 13.6 → 22.0 | 54.9 → 67.4 | 85.6 → 99.6 |
| WORLD 90 Hz, pauses | M | 7.00 → 4.38 | 7.00 → 4.38 | 0 → 0 | 67.3 → 87.3 | 65.2 → 85.1 | 2.1 → 2.2 | 82.0 → 97.0 |
| WORLD 185 Hz, continuous | W | 5.75 → 3.25 | 5.75 → 3.25 | 0 → 0 | 84.1 → 90.6 | 78.4 → 84.9 | 5.7 → 5.7 | 99.1 → 99.7 |
| WORLD 185 Hz, continuous | M | 5.25 → 3.00 | never → never | 0 → 0 | 85.2 → 91.4 | 10.0 → 10.9 | 75.2 → 80.4 | 99.8 → 99.9 |
| WORLD 185 Hz, pauses | W | 6.25 → 3.25 | 6.25 → 3.25 | 0 → 0 | 85.4 → 92.1 | 78.5 → 85.1 | 7.0 → 7.0 | 99.2 → 99.8 |
| WORLD 185 Hz, pauses | M | 5.75 → 3.25 | never → never | 0 → 0 | 85.3 → 92.2 | 8.5 → 9.4 | 76.8 → 82.8 | 98.9 → 100.0 |
| WORLD own F0 (control), pauses | W | 6.25 → 3.25 | 6.25 → 3.25 | 0 → 0 | 85.2 → 92.0 | 75.8 → 82.3 | 9.5 → 9.8 | 99.3 → 99.8 |
| WORLD own F0 (control), pauses | M | 6.25 → 3.50 | 6.25 → 3.63 | 0 → 0 | 82.1 → 91.3 | 72.2 → 81.1 | 9.8 → 10.2 | 96.8 → 100.0 |

Reported only (natural low and other speech, all talkers; shipped → H1+H3):

| set | sex | talkers | first reading s | shown % | informative % | no reading |
|---|---|---|---|---|---|---|
| PTDB-TUG | W | 2 | 6.5 → 3.8 | 85.4 → 95.1 | 85.4 → 95.1 | 0 → 0 |
| PTDB-TUG | M | 2 | 21.5 → 4.6 | 41.8 → 84.0 | 41.8 → 84.0 | 0 → 0 |
| FDA | W | 1 | 8.8 → 5.0 | 65.4 → 93.5 | 65.4 → 93.5 | 0 → 0 |
| FDA | M | 1 | 8.8 → 5.2 | 74.6 → 93.6 | 74.6 → 93.6 | 0 → 0 |
| Hillenbrand /hVd/ | W | 48 | 6.8 → 3.9 | 67.1 → 80.9 | 65.7 → 79.2 | 0 → 0 |
| Hillenbrand /hVd/ | M | 45 | 6.8 → 4.0 | 60.0 → 77.1 | 53.0 → 68.4 | 1 → 0 |

### 8.3 No new readings (bar iv)

Streams of `build_guards.py` through the same chain (`run.mjs`, speech
detector live), shipped (the panel before 2026-10-21: 3 s rule, no
first-reading check) and H1+H3 on the same runs, four timer phases each
(shown 250 ms samples, summed over the phases):

| stream | streams | shown, shipped → H1+H3 | notes |
|---|---|---|---|
| synthetic held vowel (cue-strip smoke WAV) | 1 | 0 → 0 | |
| synthetic pink noise, −30 dBFS (smoke WAV) | 1 | 0 → 0 | |
| digital silence (smoke WAV) | 1 | 0 → 0 | |
| 60 s pause fill (−65 dBFS) | 1 | 0 → 0 | |
| 60 s pink noise at speech level (−22.3 dBFS) | 1 | 0 → 0 | |
| held vowel 110 / 220 / 330 Hz alone (5 s, ±0.3 st vibrato) | 3 | 0 → 0 | "sustained" reached in every phase |
| held vowel after 10 s of reading (8 readers × 3 pitches) | 24 | 2,160 → 3,386 (of 7,008; the readings of the 10 s of speech) | shown while the voice state is "sustained": 0 → 0; still shown after "sustained" began: 0 → 0 (hidden within 250 ms); shown in the note before "sustained" (the reading of the speech before it): 288 → 288 of 1,824 |
| whisper alone, unphonated talkers (EARS + Expresso) | 24 W / 24 M | 0 → 0 | |
| whisper alone, the five phonated EARS women | 5 | **664 → 1,012 (+52 %)** | shipped already shows readings: these "whisper" recordings are 33–46 % phonated (whisper-voicing-2026-10-07.md); the faster panel shows clearly more of them |
| speech + whisper, unphonated talkers: B1 (whisper share of the pooled logits) | 9 W / 8 M | W 1.2 → 0.9 %, M 0.5 → 0.4 % (bar ≤ 5.0 %) | over every shown panel computation (2 s updates and H3's first readings); shown samples W 4,424 → 6,394, M 4,737 → 6,605 |
| speech + whisper, phonated EARS women: B1 | 5 | 24.7 → 21.6 % | reported (not in the 2026-10-08 B1); shown samples 1,336 → 1,644 |

**Baseline rebuilt (review, 2026-10-21).** The first version of this table
(up to b2a440d) compared H1 with H1+H3, not the panel before 2026-10-21 with
H1+H3: `analyze.mjs` had `VARIANTS.shipped = { agg: {} }`, which takes
`minVoicedMs` from `heardAsCalibration.js`; that file carried H1's 2 s from
10:33 on, and `guards.mjs` ran at 10:44. It reported the phonated whisper-only
streams as 944 → 1,012 (+7 %), B1 as W 0.9 → 0.9 / M 0.4 → 0.4 % and the
phonated B1 as 22.5 → 21.6 %; the rows above are the re-run with the true
baseline. Pass / fail does not change (the bar's limits are absolute: no
reading where the old panel had none, B1 ≤ 5 %). `VARIANTS.shipped` is now
pinned to the 3 s rule in `analyze.mjs` (and every variant except H1's to
3 s), so the reproduce commands of §7 give the old panel at any commit. §8.1
and §8.2 ran before the change (10:30 and 10:31) and are unaffected: with the
pin, `analyze.mjs --variant=shipped` regenerates the stored
`streams.shipped.json` byte-identical, `--variant=H1+H3` the stored
`streams.H1+H3.json`, and `candidates.mjs --split=dev` into a fresh directory
prints the stored dev log line for line and the same `selection.json` (only
its timestamp differs).

### 8.4 CI and the app (bar vi)

- `npm run lint` clean; `npm run test:unit` 46 / 46 scripts pass (the pinned
  `minVoicedMs` and a 1.9 s / 2.1 s case in `tests/ml/heard-as-test.js`; new
  cases for the H2 option — unbroken speech gives the clock pool, a pause no
  longer drains it, never more than 16 s back, the whole-stimulus aggregate
  unchanged — and for the panel's 250 ms check (`heardAsAxisModel.js`
  `quickCheck`) in `tests/ml/heard-as-axis-test.js`); the pitch-only
  warning's tests (217, incl. its golden) pass unchanged.
- `npm run test:resonance-lab` 89 / 89; `npm run build` ok.
- `scripts/cue-strip-smoke.mjs --viewport=desktop --pitch-only=man,woman`
  (built app, fake mic): 107 / 107 — the panel turns on, shows the bar on
  speech, hides on held notes and silence; the pitch-only warning appears
  6.2 s after the man's shift. `--viewport=phone`: 83 / 83.
- `scripts/resonance-lab/lab-layout-smoke.mjs` (360 / 448 px and desktop):
  63 / 63 — the live panel on gapped speech passes through shown, "Can't
  tell yet", "Older reading", "Keep talking" and stale with nothing below it
  moving, and all 78 forced panel states keep one height. (A first run with a
  relative `--out` failed parts 1–3 only because Chrome could not find the
  fake-mic WAV — a harness invocation error; rerun with the default path.)

### 8.5 What it does not change, and the pitch-only warning

- **"Can't tell yet" for a feminine pitch with male-typical resonance** (the
  user's screenshot: speaking in a feminine voice, not below 80 Hz). H1+H3
  gives that voice a reading sooner (WORLD 185 Hz men, pauses: 5.75 → 3.25 s)
  but the reading is still "Can't tell yet" (76.8 → 82.8 % of the time; more
  time shown, the same reading in the middle). As §4.3 found, that is where
  the calibration puts such a voice; only the wording (W1, the user's call)
  could change what it says.
- **Below ~75 Hz** readings now appear (WORLD 75 Hz with pauses: 1 of 20
  voices per sex without one, was 14 / 12), but the pitch worker still posts
  few frames there (§4.2), so they come late (median 7–13 s) and women's
  voices lowered that far mostly read "Can't tell yet". P1 (the pitch-chain
  change) stays a separate decision.
- **Those new low readings are for voices below the tested range, on a pitch
  that reads too high** (review, 2026-10-21; bar iii never checked them —
  it judged the natural readers only). The pooled F0 is the median of the
  posted frames, and the pitch worker drops most frames below 75 Hz: only
  the higher frames get through, so the pooled F0 sits above the voice's
  and the "Outside the range it was tested on" rule (81 Hz) does not fire.
  On the WORLD 75 Hz streams with natural pauses (all 80 readers, both
  splits; `review_checks.mjs` "f0bias", shown 2 s updates over the four timer
  phases, against the same 8 s of the WORLD reference pitch):

  | | W shipped → H1+H3 | M shipped → H1+H3 |
  |---|---|---|
  | shown 2 s updates | 182 → 1,085 | 192 → 1,385 |
  | … with the reference pitch below 81 Hz | 59 → 86 % | 57 → 85 % |
  | pooled F0 / reference F0 (median) | 1.14 → 1.14 | 1.12 → 1.15 |
  | eta(pooled F0) − eta(reference F0) (median; < 0 = toward "woman") | −0.45 → −0.47 logit | −0.38 → −0.48 logit |
  | shown readings that change "Can't tell yet" / side with the reference pitch | 40 → 35 % | 1 → 2 % |

  So these readings lean toward "would say woman" by about twice the
  ±0.225 logit tolerance of bar (iii). Men's readings stay "would say man"
  (98 % informative); a woman's voice lowered to 75 Hz (synthetic here — real
  voices that low are almost all men's) changes "Can't tell yet" / side in a
  third of its readings. On the held-out 75 Hz voices a reading is now shown
  33 % (W) / 48 % (M) of the time, against 3 % / 7 % before (§8.2). The
  panel's "More" text said "very high or low voices hide it"; since the
  review it says that very high voices hide it and that very low voices
  (below about 80 Hz) can get a reading that is less reliable and leans
  toward "would say woman". Not done (each needs its own pre-registered
  measurement, and P1 the user's approval): hide a reading when many voiced
  frames are lost near the 75 Hz floor, or tie these readings to P1.
- **Feminine pitch with male-typical resonance: an early reading can lean
  the wrong way** (review, 2026-10-21; the kind of voice in the user's
  screenshot — a feminine pitch whose settled reading is "Can't tell yet"). On
  the held-out WORLD 185 Hz men (`review_checks.mjs` "newonly"), 3.74 % of the
  readings that only H1+H3 shows (64 of 1,712 samples over the four phases) are informative on the
  side opposite the stream's settled reading; the panel before 2026-10-21
  shows none (0 %). All 64 are one voice (6295, the natural-pause and the
  continuous stream): about 2 s of an informative "would say woman" reading
  (eta −1.71) from ~3.75 s, where the settled answer is "Can't tell yet"
  (eta +0.10 / +0.15). Dev: none. Bar (iii) checked the natural readers
  only; there no early reading is informative on the wrong side (0.0 %).
- **Short "Keep talking" flashes; low voices blink** (review, 2026-10-21;
  the bar measured neither). A 2 s update can hide the reading and the next
  250 ms check show it again. Held-out, per minute of speech
  (`review_checks.mjs` "flicker", four phases):

  | stream | hides between two readings, W / M | of them ≤ 250 ms, W / M | shown ↔ hidden changes, W / M |
  |---|---|---|---|
  | natural, natural pauses | 0.39 → 0.27 / 0.56 → 0.22 | 0.03 → 0.27 / 0.02 → 0.10 | 2.18 → 1.92 / 2.53 → 1.80 |
  | natural, 2.5 s pauses | 5.68 → 1.54 / 5.27 → 2.44 | 0.00 → 0.37 / 0.00 → 0.53 | 12.7 → 4.0 / 12.0 → 5.8 |
  | WORLD 75 Hz, natural pauses | 0.09 → 3.20 / 0.36 → 2.43 | 0.00 → 0.45 / 0.00 → 0.32 | 0.74 → 8.15 / 1.61 → 6.57 |

  On natural voices the panel hides less often than before, but a hide that
  remains is now often a 250 ms flash (before, a hide lasted until the next
  2 s update). The ~75 Hz voices, which mostly got no reading before, now
  switch between shown and hidden 6.6–8.2 times a minute. Not changed: a
  rule that re-shows only when the reading is still ready at the next check
  would change the pre-registered H3 and delay every first reading by
  250 ms; it needs its own measurement (the user's call).
- **Pitch-only warning feed** (2 s updates; the first-reading checks never
  reach it): shown updates per minute of speech, natural pauses, held-out
  W 25.9 → 27.3, M 24.4 → 27.0; first shown 2 s update (median) 7 → 5 s. Its
  late-switch-on seed keeps its own 3 s rule (`pitch-only-warning.js`
  `seedMinVoicedMs` pinned at 3000, so the warning is the one its study
  measured). Whether its study needs a re-run on the new update stream is the
  user's decision.

### 8.6 Deviations from the plan

1. **Dev targets** are the plan's relative rules on dev's own shipped
   numbers (30 % faster than dev shipped, a third fewer "never"); the plan
   wrote out only the held-out values.
2. **"Opposite side"** (iii): an informative reading whose eta has the other
   sign from the stream's settled eta (the plan did not say how to treat a
   settled reading that is itself "Can't tell"; sign is used for every
   stream). Shipped and candidate are both at 0.0 % either way: no
   informative reading on the wrong side exists in either (natural readers,
   the bar's population; on the WORLD 185 Hz men H1+H3 has 3.74 %, §8.5).
3. **H3 in the simulation**: after the selection, the simulation was made to
   match the panel code exactly — a first-reading check that finds no reading
   leaves the hidden view and its reason as they are (it had refreshed the
   reason). Checked on all 1,219 streams: only the hidden-reason breakdown
   changes; every bar number is identical.
4. **Whisper set rebuilt** from the public mirror (Malfaro43/whisperedAudio-
   benchmark; EARS and Expresso, CC BY-NC 4.0) with the 2026-10-08 probe
   rules: 53 whisper-alone streams (the probe set had 54: Expresso grouping on
   the files at hand) and 22 speech + whisper streams; new floor-noise seed.
   "No reading on whisper alone" is judged on the unphonated talkers (B1's
   population); the five phonated EARS women already got readings shipped.
   This choice hides a large rise there: H1+H3 shows 52 % more readings on
   those five partly voiced "whisper-only" streams (664 → 1,012 samples,
   §8.3 with the rebuilt baseline).
5. **Held notes and noise** are synthetic (/a/ with the smoke WAV's
   formants; "speech level" pink noise at the probe sets' −22.3 dBFS
   reference); held notes after reading use the first 10 s of 8 readers'
   continuous streams (2 W + 2 M dev, 2 W + 2 M held-out).
6. **The H2 option stays in `heard-as.js`**, default off and unit-tested, so
   the dev table can be reproduced.
7. **Not re-measured:** the noise / phone-channel shown shares quoted in the
   panel's "More" text and in CLAUDE.md were measured with the 3 s rule; with
   2 s readings will be shown at least as often there (not re-run). The
   pitch-only warning's study was not re-run either (§8.5).

### 8.7 Regression test (CI)

`tests/ml/heard-as-responsiveness-test.js` (in `npm run test:unit`) replays
the panel's two timers on the audio clock as `HeardAsPanel.jsx` runs them —
`compute()` at mount and every 2 s; every 250 ms the app's own `quickCheck()`
(update / first reading / nothing) — over the app's aggregator with the
shipped constants, at the four timer phases. A source check ties the replay to
the JSX (the 250 ms constant, the two timers, `first()` showing a ready reading
and never calling the pitch-only warning; since the review, also `first()`
showing the pitch-only note exactly when it tells screen readers the warning,
§9).

**Fixture** `tests/ml/fixtures/heard-as-responsiveness.json` (44 KB, public
data, derived numbers only), written by
`scripts/heard-as/low-pitch-pauses/make_test_fixture.mjs` from this study's
`run.mjs` records: held-out readers with natural pauses (W `ls-dev-3576`,
M `ls-dev-777`, first 20 s) and 2.5 s pauses (W `ls-dev-1673`, M `ls-dev-174`,
30 s), the same readers' WORLD 75 Hz streams (W `ls-dev-1993`, M `ls-dev-3170`,
20 s), held vowels after reading (`held.after.121.220`, `held.after.174.110`)
and alone (110 / 220 / 330 Hz, the smoke WAV's), pink noise at speech level,
the pause fill, the smoke WAV's noise and silence. The script refuses to write
unless the stored stream (f0 rounded to 0.01 Hz, pruned to what the panel
reads) gives the same panel as the full record at every 250 ms sample, at all
four phases, under the 3 s rule and the shipped one. The real whisper streams
(EARS / Expresso, CC BY-NC 4.0) are not stored; the test builds a synthetic
stand-in patterned on the worst unphonated one (below).

**Checks** (shipped panel; the 3 s rule in brackets, from the test's own
reference replay):

| check | W | M |
|---|---|---|
| natural pauses: first reading ≤ 4.5 s at every phase | 3.5 s at all phases [7 / 7.5 / 6 / 6.5] | 4.0 s [7 / 7.5 / 8 / 8.5] |
| natural pauses: the same first-reading time at all four phases (shown when ready, not on the timer) | yes [no] | yes [no] |
| 2.5 s pauses: first reading ≤ 3.5 s at every phase | 2.75 s [8–21 s] | 2.75 s [8–15.5 s] |
| 2.5 s pauses: a reading shown ≥ 70 % of the time (30 s) | 76–85 % [7–14 %] | 85–90 % [27–41 %] |
| WORLD 75 Hz: a reading by 8 s at every phase | 5.5 s [none in 20 s] | 5.75 s [none in 20 s] |
| every reading the 3 s rule shows is shown, identical (eta, wide) | 784 samples, 0 differ (all speech streams pooled) | |
| held vowel after reading: hidden at the first 250 ms check of "sustained", none while it lasts; a reading before it | pass | pass |
| held vowels alone, noise, pause fill, silence: no reading | pass | |
| synthetic unphonated whisper: no reading in 30 s (its pool reaches 40 windows, 5 counted logits, 1.65 s voiced; asserted ≥ 10, > 0, 1.2–2 s) | pass | |

**Fails on the old panel:** with the 53e3832 sources the test stops at its
import (`quickCheck` does not exist). With the old panel's 250 ms timer
supplied as `quickCheck` (recompute only to hide a shown reading on a held
note), 12 checks fail: the two wiring checks, all eight pause checks and both
75 Hz checks. Each half of the pick alone also fails: H1 without H3 fails 7
(first reading 3.5–5.5 s and phase-dependent; 2.5 s pauses 62–79 % shown),
H3 without H1 fails 8 (first reading 5.75 / 7 s; no 75 Hz reading in 20 s).
The held-note, noise, silence and whisper checks pass on both panels by
design: they guard that the faster panel adds no reading there.

**Whisper margin.** On the rebuilt whisper set (§8.3), the unphonated
whisper-only streams pool at most **1.375 s** of posted voiced pitch in the
8 s window (EARS p084; next 1.1 s, p002; the rest ≤ 0.8 s), against the 2 s
rule: a 0.6 s margin (1.6 s with the 3 s rule). That is the population B1
judges; the five phonated EARS women pool 4.3–5.2 s and got readings before
and after the change. A whisperer whose recordings carry more voicing than
p084's could now get a reading; the synthetic stand-in in the test pools up
to 1.65 s (stricter than p084; 1.2–2 s asserted), so a lower `minVoicedMs`
would be caught. The review confirmed the 1.375 s and added: these
unphonated whisper-only streams are only 14–23 s long (the phonated ones
17–25 s), so a longer stretch of whisper has more 8 s windows in which to
reach 2 s.

**Golden file not updated.** The plan (§6.3 iii) requires
`tests/ml/fixtures/heard-as-golden.json` to stay as is: H1 and H3 change no
aggregate definition, only whether and when a pool is shown, and
`make_golden.mjs` regenerated it byte-identical at d555c06; this test adds a
new fixture instead.

With the test in place: `npm run lint` clean, `npm run test:unit` 47 / 47
scripts, `npm run build` ok, `scripts/cue-strip-smoke.mjs --pitch-only=man,woman`
(phone viewport, built app) 107 / 107 — the pitch-only warning appears 6.4 s
(man) and 7.5 s (woman) after the shift.

## 9. Review (2026-10-21) and fixes

An independent review the same day found no high-severity issue. It
confirmed the order (plan pushed 10:20:59, candidates and dev pick 10:30:50,
the one held-out run 10:31:17, code 11:11), that the sim change of §8.6
item 3 moves no bar number (0 differences over 1,219 streams), that the
shipped code is the pick (two streams re-run through the real chain match
the stored records; the real `HeardAsPanel.jsx` in headless Chrome with a
virtual clock matched the simulation at all four timer phases, 0 differences
over 1,460 samples of 250 ms, at 53e3832 and at the pick), that readings
both versions show are the same, that the regression test fails on the old
code, and that lint, the unit tests and the privacy rules pass. Its
findings and what was done (every number re-run here from the stored runs
with the review's scripts before it was written down; the ones §8.5 cites
are committed as `scripts/heard-as/low-pitch-pauses/review_checks.mjs`):

1. **Medium — the §8.3 "shipped" column was H1, not the old panel.**
   Fixed: `VARIANTS.shipped` (and every variant but H1's) pinned to the 3 s
   rule in `analyze.mjs`; `guards.mjs` re-run; §8.3 rows corrected and the
   rebuild noted there; §8.6 item 4 now states the +52 % on the phonated
   whisper-only streams. The pin was checked to reproduce §8.1–8.2's stored
   outputs exactly (§8.3).
2. **Medium — the new ~75 Hz readings are for voices below the tested range,
   on a pitch that reads too high; bar (iii) never checked them.** Fixed as
   the review's minimum: the numbers are in §8.5; the panel's "More" text
   no longer says low voices hide it (it says very low voices, below about
   80 Hz, can get a reading that is less reliable and leans toward "would
   say woman"); CLAUDE.md says the same. Not done: a new hide rule for
   voices that lose many frames near the 75 Hz floor, or tying these
   readings to P1 — a hide rule is a new heard-as candidate and needs its
   own pre-registered measurement (hard rule 3), and P1 needs the user's
   approval. Both are the user's call.
3. **Low — new 250 ms "Keep talking" flashes; low voices blink.** Fixed as
   asked: reported in §8.5 with the numbers. The optional change (re-show
   only if still ready at the next check) was not made: it alters the
   pre-registered H3 and delays every first reading by 250 ms, so it would
   need its own measurement.
4. **Low — after a hide, `first()` showed the reading without the
   pitch-only note while the live region still announced it.** Fixed in
   `HeardAsPanel.jsx`: `first()` sets the note from the warning's held run,
   the same value as the live region (`pitchOnly: held, live: held`), so
   the visible note and what screen readers are told agree. It still never
   feeds the warning. `tests/ml/heard-as-responsiveness-test.js` gained a
   source check for it. (Display only: no estimate, timing or warning
   decision changes.)
5. **Low — the screenshot's kind of voice can now get an early reading that
   leans the wrong way.** Fixed as asked: reported in §8.5 (WORLD 185 Hz
   men, one held-out voice, 3.74 % of the new-only readings, the old panel
   0 %).
6. **Low — disclosed trade-offs** (0.6 s whisper margin on 14–25 s whisper
   streams; the unused H2 option; the pitch-only warning's study and the
   "More" noise numbers not re-run). Nothing to change; the stream-length
   point is added to the whisper margin paragraph (§8.7) and §8.6 item 7
   now names the warning's study.

Checks after the fixes: `npm run lint` clean; `npm run test:unit` 47 / 47
scripts (`heard-as-responsiveness-test.js` 30 / 30; its new `first()` check
fails on the previous panel source); `npm run build` ok;
`scripts/cue-strip-smoke.mjs --pitch-only=man,woman` (built app, fake mic)
107 / 107 at the phone and desktop viewports — the "More" list still wraps
inside the panel, and the pitch-only warning appears 6.1 s (man) and 7.5 s
(woman) after the shift and stays on 76 / 76 shown samples.
`lab-layout-smoke.mjs` was not re-run: `first()` can now show a reading
with the note, a state `compute()` already produced, and that smoke does
not open the "More" list.

## Addendum: low-voice hide (pre-registered, 2026-10-21)

**Why.** §8.5: since H1+H3, voices around 75 Hz get readings, but the pitch
worker drops most of their frames below its 75 Hz floor, so the pooled F0
reads ~1.14× high, the 81 Hz "outside the tested range" rule does not fire,
and ~85 % of those readings are for a voice below the tested range, leaning
~0.47 logit toward "woman". **User decision (2026-10-21):** hide readings for
very low voices (below ~80 Hz) for now, with a measured rule, so they get the
panel's existing out-of-range state ("Outside the range it was tested on");
the pitch-detector fix (P1) is deferred. This plan is committed and pushed
before the chain is run on any stream or any candidate is coded.

**Baseline ("shipped")** = the panel on `cue-strip` 35bf286: H1+H3
(`minVoicedMs` 2000, first-reading check) — `analyze.mjs` variant `H1+H3`.

### A.1 Candidates (heard-as modules only; each can only hide)

Both are computed in `heard-as.js` `estimate()` from what the aggregator
already holds — the pooled posted voiced F0 values (the frames the pooled
median uses: posted voiced frames inside the scored windows' spans) and the
posted frames, voiced or not, inside those spans. A reading that fires the
rule is hidden as `"outside"` (the panel's existing out-of-range state),
checked after the existing "short" rule, on the 2 s updates and on the
first-reading check alike.

- **L1 — low tail of the posted pitch:** hide when the q-th percentile of the
  pooled voiced F0 values is below T Hz. Percentile = the value at index
  floor(q · (n − 1) / 100) of the ascending list.
  Grid: q ∈ {10, 20}, T ∈ {76, 77, 78, 79, 80} Hz (10 cells).
- **L2 — lost voicing at a low pitch:** hide when the pooled F0 (the median,
  as shown) is below M Hz AND the voiced share of the pooled spans — posted
  voiced time / posted frame time (each frame counted by its capped spacing,
  as `voicedMs` counts it) inside the scored windows' spans — is below V.
  Grid: M ∈ {95, 100, 110} Hz, V ∈ {0.30, 0.35, 0.40, 0.45, 0.50} (15 cells).

### A.2 Streams (a fixed subset, rebuilt)

`build_streams.py` (unchanged except a new `--conds` option that builds a
subset of conditions; same seeds, so the streams are the §3 ones):
**all 80 LibriSpeech readers** (dev = test-clean 20 W / 20 M, held-out =
dev-clean 20 / 20), conditions **nat p0, nat pnat, w75 p0, w75 pnat, w90 pnat,
w185 pnat** (the other pause conditions, w90 p0, w185 p0 and w1 are not
rebuilt), plus PTDB-TUG (M01, M02, F01, F02), FDA (rl, sb) and Hillenbrand
(45 men, 48 women) as in §3. Same chain (`run.mjs`, speech detector live),
two processes. The candidates are simulated over the stored runs exactly as
`analyze.mjs` simulates the panel (four 2 s-timer phases, 250 ms display
samples, the first-reading check).

### A.3 Split, selection, the bar

- **Dev:** the 40 test-clean readers' streams. **Held-out:** the 40 dev-clean
  readers' streams and PTDB-TUG / FDA (in no fit, never used to choose).
  Hillenbrand: reported only.
- **Selection (dev only, written to `build/heard-as/lowhide/selection.json`
  before any held-out candidate number is computed):** a cell is eligible if
  on dev it passes (a)–(d) for both sexes (with dev's groups: w75; w90 and
  natural LibriSpeech men; natural LibriSpeech women and w185). Of the
  eligible cells: the largest min-over-sexes reduction in (a); ties (within
  2 points) → the smaller largest drop in (b); then L1 before L2, then the
  smaller threshold (T, or M then V). If none is eligible: FAIL, nothing is
  implemented, the numbers are reported.
- **The bar (held-out, one look at the pick; women and men separately;
  failing one group fails):**
  - **(a) ~75 Hz voices** (w75, p0 and pnat pooled): shown readings below the
    tested range — shown 250 ms display samples (four phases) whose reference
    F0 (median of the WORLD reference's voiced values in the trailing 8 s) is
    below 81 Hz — drop by **≥ 80 %** per sex.
  - **(b) ~90 Hz voices and natural male speech:** time with a reading (the
    mean over streams of the shown share, `analyze.mjs` `shareShown`) drops by
    **≤ 2.0 points** for w90 pnat (W, M), LibriSpeech men (nat p0 + pnat),
    PTDB-TUG men (M01 + M02) and FDA rl — each group judged on its own.
  - **(c) women, natural and feminine-shifted:** the same shown share changes
    by **≤ 0.5 point** for LibriSpeech women (nat p0 + pnat), PTDB-TUG women
    (F01 + F02), FDA sb and w185 pnat (W, and M — the feminine-pitch stand-in
    for men).
  - **(d) no new readings:** on every rebuilt stream, at every 250 ms sample
    and phase, the candidate shows a reading only where the baseline shows
    one, with the same eta (it can only hide).
- **Reported (not judged):** Hillenbrand men / women shown share; the (a)
  share on dev; shown ↔ hidden changes per minute on w75 / w90 (blinking); how
  many shown readings the rule hides on each group.
- **Verdict:** PASS only if (a)–(d) all pass on held-out. If the pick passes,
  it is implemented (a hide rule in `heard-as.js` + its constants in
  `heardAsCalibration.js`, unit tests, the panel's "More" text); if not,
  nothing is implemented.

Scripts: `scripts/heard-as/low-pitch-pauses/lowhide.mjs` (written after this
commit; it imports `analyze.mjs` `simulate` with the candidate rule supplied
to the aggregator).

### A.4 Results (2026-10-21) — FAIL on dev, nothing implemented

**Order.** Plan committed and pushed 12:46:03 CDT (db9bb0d); the streams were
being built meanwhile (no chain run, no panel number). Chain run 12:53–13:19
(579 streams, two processes). Dev selection written 13:21:22
(`build/heard-as/lowhide/selection.json`). One deviation: at 13:09, while the
run was going, `lowhide.mjs` was smoke-tested on the 48 dev streams finished
by then, in a scratch directory (dev only; no held-out stream was evaluated
at any point).

**No cell is eligible on dev, so there is no pick and no held-out look.
Verdict: FAIL. No hide rule is implemented** (`heard-as.js` and the panel are
unchanged by this addendum; readings for ~75 Hz voices stay as in §8.5).

Dev (LibriSpeech test-clean, 20 W / 20 M readers), the shipped panel
(H1+H3) → the cell; (a) = drop in shown readings below the tested range on
the ~75 Hz voices (bar ≥ 80 %), (b) = drop in time with a reading (points;
bar ≤ 2.0) — the 90 Hz voices are the binding group; (c) passed for every cell
(women and the 185 Hz voices: 0.00 points everywhere):

| cell | (a) W / M % | (b) w90 W / M, points | (b) LibriSpeech men, points | w90 shown ↔ hidden changes / min, W / M (shipped 2.2 / 2.4) |
|---|---|---|---|---|
| L1 q10 T76 | 5.2 / 3.6 | max 0.39 | | |
| L1 q10 T77 | 27.8 / 29.1 | max 2.46 | | |
| L1 q10 T78 | 57.8 / 61.9 | max 10.8 | | |
| L1 q10 T79 | 78.1 / 81.2 | 23.5 / 15.5 | 0.50 | 6.6 / 6.3 |
| L1 q10 T80 | 90.7 / 90.1 | 37.7 / 33.0 | 2.34 | 9.0 / 7.3 |
| L1 q20 T76–T80 | 0.0–50.8 / 0.0–45.7 | max 0.0–7.1 | | |
| L2 M95 V0.30 | 39.6 / 40.6 | 0.54 / 0.96 | 0.02 | 2.5 / 2.9 |
| L2 M95 V0.40 | 74.9 / 72.4 | max 8.4 | | |
| L2 M100 V0.30 | 43.7 / 46.0 | max 1.33 | | |
| L2 M100 V0.40 | 84.7 / 81.3 | 12.5 / 13.2 | 0.96 | 6.3 / 7.6 |
| L2 M100 V0.45 | 91.3 / 85.6 | 25.0 / 27.2 | 1.64 | 8.7 / 9.6 |
| L2 M100 V0.50 | 93.1 / 86.2 | 44.2 / 40.7 | 2.42 | 7.6 / 8.9 |
| L2 M110 V0.40 | 90.0 / 94.1 | 14.8 / 22.8 | 1.30 | 6.3 / 8.7 |
| L2 M110 V0.45 | 97.1 / 98.5 | 28.8 / 43.4 | 3.04 | 8.5 / 8.9 |
| L2 M110 V0.50 | 99.0 / 99.1 | 50.0 / 59.8 | 7.03 | 7.1 / 6.4 |

(Every cell: `build/heard-as/lowhide/dev.log`; blank = not printed here.)
Every cell that reaches (a) also costs the ~90 Hz voices 12–60 points of time
with a reading and makes them blink about 3–4× as often; every cell that keeps
(b) within 2 points removes at most ~46 % of the low readings (L2 M100
V0.30). Natural LibriSpeech men lose less on average — 0.96 to 7.0 points in
the cells that reach (a) — but the average hides single voices: under L2 M100
V0.40 (mean 0.96) two of the 40 natural male streams lose more than 5 points,
the worst (reader 1089, natural pauses) 17.2 points (92.5 → 75.3 % shown;
under L1 q10 T79 the same stream loses 7.0) — a per-stream replay of the same
simulation in the review (2026-10-21), whose group means match `dev.log`
exactly. The 90 Hz voices are the binding problem: their pitch also reaches below the 75 Hz floor, so they lose frames
in the same way, only less — neither the low tail of the posted pitch nor the
voiced share separates "about 75 Hz" from "about 90 Hz" well enough. The
missing frames are the cause, so the fix belongs in the pitch chain (P1,
deferred by the user to after 2026-10-25), not in a heard-as hide rule.

**(d) as written fails for every cell that hides anything, but no cell shows a
reading where the panel shows none.** The plan's (d) asked for "a reading
only where the baseline shows one, with the same eta". After a rule hide, the
first-reading check (H3) shows the next ready reading at once, from a newer
pool than the one the shipped panel is still showing — so the eta differs
(e.g. L2 M100 V0.40: 78–678 such samples per group). Shown where the shipped
panel shows nothing: **0 samples in every group and cell**. This did not
decide the verdict ((a) and (b) cannot both pass in any cell).

**Not done:** held-out, PTDB-TUG, FDA, Hillenbrand (no pick to look at);
`lowhide.mjs --split=test` stays unrun. The stream subset (§A.2) and
`analyze.mjs`'s new `makeAgg` hook (used only by `lowhide.mjs`; every other
variant simulates as before) are the only code changes.

**What users see:** unchanged for low voices — voices around 75 Hz can still
get a reading that is less reliable and leans toward "would say woman" (the
"More" text says so since the §9 review). Options for the user: (1) accept a
cell that hides most low readings at the cost of the ~90 Hz voices — e.g. L2
M100 V0.40: −81 to −85 % of low readings, −12 to −13 points for 90 Hz voices,
natural LibriSpeech men −1.0 point on average but −17.2 for the worst natural
male voice (two of 40 streams lose more than 5). **This option cannot pass
the bar as written:** besides (b), (d) fails on dev for every cell that hides
anything, by design (after a hide, H3 shows the next ready reading; 78–678
such samples per group for this cell), and would fail on held-out too. Taking
it means the user redefining (d) after seeing dev results — e.g. "never shown
where the current panel shows nothing" (0 samples in every group and cell on
dev) — and accepting the (b) cost, as explicit decisions, before its one
held-out look. (2) Wait for P1.

**Checks (2026-10-21, with the "Could go either way" wording; no hide rule):**
`npm run lint` clean; `npm run test:unit` 68 / 68 scripts
(`tests/ml/heard-as-axis-test.js` 32 / 32 — its new wording checks fail on
the old words); `npm run build` ok; `scripts/cue-strip-smoke.mjs
--pitch-only=man,woman` (phone viewport, built app, fake mic) 109 / 109 — the
live panel showed "Could go either way — listeners would be split" with the
matching screen-reader label, and the pitch-only warning appeared 6.3 s (man)
and 7.7 s (woman) after the shift.
