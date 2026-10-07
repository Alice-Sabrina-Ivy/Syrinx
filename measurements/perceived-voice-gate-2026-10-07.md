# Perceived Voice meter: utterance gate + fresh-only display — 2026-10-07

Hard-rule-3 file for the `src/ml/gender-worker.js` change on branch
`voice-direction` (new `src/ml/utterance-gate.js`,
`src/components/perceivedVoiceView.js`). The meter itself is due to be
replaced by the cue-strip design; these are the no-regret fixes that hold
whatever replaces it. **Revised the same day after review** (audio clock,
held-phonation share 0.95, narrower claims, more conditions reported,
reproducible scripts); every number below is from the revised gate unless
marked "first version".

## Why

An audit of the deployed meter (production chain replayed on public data,
2026-10-06) found that it

- showed a number during **noise-only audio 71 % of the time**, leaning
  masculine;
- **seeded its EMA from the noise before speech**: the first windows of an
  utterance were mostly pre-onset audio, so women's readings started in
  the masculine range (38 % of clean-speech onsets) and took ~3 s to
  settle;
- **held stale values up to 6 s** whenever the DSP gate was merely open
  (any sound above −50 dB);
- read **held vowels and sung notes near 50** for women (it is a
  running-speech classifier).

Root causes: the 2026-07-19 gate scored a 0.75 s window whenever *any*
voiced pitch frame had arrived in the last 500 ms (one false-voiced noise
blip opened half a second of scoring), the sub-75 Hz periodicity probe
passed 8.6 % of real-noise windows on its own, the EMA only reset after
~2 s of gated windows, and the meter showed the newest score for up to
6 s while the DSP gate was open.

## What changed

**Worker (utterance gate, `utterance-gate.js`)** — driven only by the
relayed pitch-voicing stream (one hint per pitch frame, with `pitch` and
the frame's capture `contextTime`):

| Rule | Setting |
|---|---|
| clock | the **audio clock**: hint time = its frame's capture time, "now" = the capture time of the newest audio in the ML window |
| utterance opens on a run of consecutive voiced frames | ≥ 150 ms (a gap > 100 ms of audio in the hint stream breaks the run) |
| utterance closes after no voiced frame for | 1000 ms |
| score only if the newest voiced frame is at most | 500 ms old ("recent") |
| …and at least this share of the window's frames are voiced | 15 % ("voiced") |
| …and at most this much of the window predates the onset | 50 % |
| EMA | reset on the first scored window of every utterance |
| held phonation ("needs running speech") | trailing 1.0 s: ≥ 95 % voiced AND voiced-pitch p90 − p10 ≤ 2 semitones |
| young utterance steady since onset | held at "updating" until it breaks voicing / moves pitch, or the 1 s test fires |
| after held phonation | utterance closed; a new one must start with voicing that begins after the note |
| sub-75 Hz periodicity probe | removed from the worker (kept in audio-utils for the old-chain oracles) |
| pitch feed dead > 2 s (audio time) | legacy peak ≥ 0.05 fallback, unchanged (never seen in practice) |

The worker posts `voice-state` (`listening` / `updating` / `scoring` /
`pause` / `sustained`) on change.

**Display (`perceivedVoiceView.js`, ResonanceMeter)** — a number only
while the newest score is ≤ 1.2 s old (dimmed when the worker is not
currently scoring); "updating…" while an onset is being collected;
"needs running speech" (centre of the bar + status line) on held single
vowels / notes; nothing otherwise. The DSP-gate-open 6 s hold is gone.
Colour: one neutral hue for the indicator, history dots and readout; the
two outer ranges drawn identically (the blue "feminine = in range" /
orange colouring is removed); no fill growing from the masculine end (a
feminine reading showed as a full bar, a masculine one as empty); more
space between the "Masculine" end label and the number. End labels kept
for now.

### Review fixes (same day)

- **Audio clock.** The first version stamped hints with the pitch worker's
  decode *wall* time and broke a voiced run on any > 60 ms hole between
  consecutive hints. Capture delivers chunks in bursts, one burst per
  hardware audio frame, so with frames ≥ 64 ms apart every burst looked
  like a hole, no run ever reached 150 ms, and the meter never showed a
  number (local diag snapshots: Pixel 8 Pro MSTP max hint gap 62 ms,
  desktop MSTP under main-thread load up to 117 ms). On the audio clock
  hints are exactly one capture chunk apart however they are delivered:

  | capture frames every | 10 ms | 25 | 40 | 50 | 60 | 64 | 80 | 100 |
  |---|---|---|---|---|---|---|---|---|
  | first version: share of decisions scored (speech 1–6 s in) | 100 % | 100 | 100 | 100 | 100 | **0** | **0** | **0** |
  | audio clock | 100 % | 100 | 100 | 100 | 100 | 100 | 100 | 100 |

  (Synthetic running speech, real gate, the delivery model of
  `tests/ml/utterance-gate-test.js` "bursty delivery".) A clock that jumps
  back > 1 s (a new capture stream) resets the gate.
- **Held-phonation share 0.9 → 0.95** — flat-intonation speech tripped the
  1-s test (below).
- Wording narrowed to **held single vowels / notes of about 1 s or
  longer**: melodic singing is mostly scored (below).

## Method

Same production-chain replay as the audit, so before and after differ
only in the code under test (scripts in `scripts/perceived-voice-gate/`,
see Reproduce):

1. **Chain** (`chain.mjs`) — the real pitch worker + DSP worker +
   `handleAnalysisResult` (DSP gate) over each 16 kHz stream in 25 ms
   chunks; it also replays the retired gate per 150 ms tick (the "before"
   arm). The pitch / DSP / hook code is unchanged on this branch.
2. **Gate** — *before*: the retired gate's codes from (1). *After*
   (`replay.mjs`): the recorded pitch frames as hints on the audio clock
   (the message posted at chunk k describes frame k − 2 and reaches the ML
   worker one chunk later, as relayed by the main thread) into the
   branch's `utterance-gate.js`, decided at the worker's 150 ms ticks.
3. **Classifier** (`score.py`) — logits from the deployed
   `voice-gender-classifier-onnx-q8-v2` ONNX in onnxruntime (CPU; parity
   with Transformers.js 6e-8), for every window the retired gate scored.
   Every window the new gate scores is among them (asserted: 0 missing on
   all sets). The held-phonation adversarial sets (flat / slowed speech,
   vocadito) replay verdicts only.
4. **EMA + display** — before: the old EMA and meter (`common.py`). After:
   `audio-utils.ema` (α 0.2, reset per gate) and the branch's
   `perceivedVoiceView` evaluated every 25 ms (before the rAF tween).
5. **Metrics** (`analyze.py`) — the same code on both arms.

Public data only:

| Set | Content |
|---|---|
| running speech | 16 LibriSpeech test-clean speakers (8 women, 8 men), one 6–14 s utterance each, × 9 channel conditions: clean, −20 dB level, phone band, laptop mic, 0.5 s reverb, pink noise 0 dB SNR, real noise 10 / 0 dB, 6-talker babble 10 dB; 2 s of the condition's background before, 1 s after |
| noise only | 100 clips (≤ 30 s) from Freesound, DCASE, MS-SNSD, DEMAND and ESC-50: stationary-tonal 35, mixed 35, broadband 20, intermittent-tonal 10 |
| held phonation | VOICED sustained /a/ (109 holds), VocalSet long tones (204 holds), PVQD CAPE-V sustained vowels (456 holds); PVQD sentence/speech portions for false alarms |
| flat / slowed speech | the 16 LibriSpeech utterances and PVQD sentence portions of 20 women + 19 men (lowest CAPE-V severity): natural, F0 flattened at the median (Praat overlap-add, timing kept), 1.5× / 2× lengthened (pitch kept) |
| singing | vocadito solo singing, 40 clips (CC BY) |
| speaker changes | LibriSpeech woman↔man swaps with no gap and with 0.6–4 s pauses (76 streams) |

Coverage figures are per-clip means; onset figures are medians over 5
conditions × 8 speakers per sex (small n — read differences of a few
points as noise). "Speaking-time coverage" counts the 25 ms hops at which
the Praat F0 track of the clean recording (adversarial sets: Praat AC on
the stream) was voiced in the last 300 ms.

## Results

### Noise and silence (no voice present)

| | before | after |
|---|---|---|
| noise-only time with a number on screen (mean of 100 clips) | **71.3 %** | **22.3 %** |
| …with any non-blank state (number, "needs running speech", "updating…") | 71.3 % | 25.4 % (22.3 + 1.7 + 1.4) |
| median clip (number) | 91.4 % | 5.6 % |
| clips never showing a number | 11 % | 43 % |
| clips showing one > 50 % of the time | 74 % | 19 % |
| real-noise lead before speech (chan real 10 / 0 dB) | 48.6 % | 16.1 % |
| silence (−70 dBFS floor; chan leads, browser check) | 0 % | 0 % |
| values on screen (pooled over hops with a number): median / share ≤ 30 | 18.8 / 72 % | 20.0 / 66 % |
| for reference: pitch trace painted (unchanged) | 23.2 % | 23.2 % |

By noise label (after, number): broadband 19 %, stationary-tonal 21 %,
intermittent-tonal 22 %, mixed 26 % (before: 61 / 76 / 92 / 67 %).
"Needs running speech" on noise: 1.7 % of noise-only time, worst clip
37 % (an intermittent-tonal machine clip whose tone the pitch detector
calls a steady voice), 7 of 100 clips above 10 %. What remains tracks the
pitch detector's own false voicing (per-clip Spearman 0.88 between shown
and painted time): where the pitch trace shows a voice in noise, so does
the meter. Removing that needs a better voice detector, not a stricter
meter gate (see the parameter table).

**Other people's speech** (6-talker babble at 10 dB before the speaker):
the gate scores it by design — it is speech. A number shows 58.5 / 57.6 %
of the babble lead (women's / men's clips; before 63 %), and the first
value after the speaker starts is in the wrong range 50 / 38 % of the time
(before 62 / 38 %): the meter starts from the babble's reading until the
speaker's own utterance takes over.

### Running speech: time with a number on screen while speaking

| speaking-time coverage | women before | women after | men before | men after |
|---|---|---|---|---|
| clean-ish (clean, −20 dB, phone, laptop, reverb) | 98.2 % | 92.0 % | 97.9 % | 89.9 % |
| noisy (pink 0 dB, real 10 / 0 dB) | 98.6 % | 89.4 % | 98.8 % | **76.8 %** |
| PVQD speech portions (time with a number) | 99.0 % | 92.6 % | 99.0 % | 88.1 % |

"Before" was near 100 % because stale values were held through every
pause. Of the speaking time now without a number (clean-ish), 3.1 % /
3.5 % (women / men) is the first ~0.5 s of an utterance ("updating…")
and 4.9 % / 6.5 % shows nothing at all — stretches where the pitch
detector reported too little voicing to open or continue an utterance; in
heavy noise the latter grows to 7.4 % / 20.5 %.

**Gender asymmetry in noise — open for a decision.** The gap between men
and women is 2 pp clean-ish but 12.6 pp at 0–10 dB SNR, worst for the
lowest voices:

| speaker (median F0) | clean-ish | noisy | pink 0 dB | real 0 dB |
|---|---|---|---|---|
| man, 94 Hz | 95.1 % | 61.3 % | 57.3 % | 39.7 % |
| man, 100 Hz | 90.5 % | 55.8 % | 83.7 % | 0.0 % |
| man, 116 Hz | 93.0 % | 92.9 % | 92.4 % | 92.4 % |
| man, 119 Hz | 90.8 % | 83.1 % | 70.9 % | 84.4 % |
| man, 120 Hz | 90.1 % | 79.3 % | 81.4 % | 67.2 % |
| man, 121 Hz | 72.9 % | 64.4 % | 51.2 % | 69.5 % |
| man, 128 Hz | 94.5 % | 98.6 % | 95.9 % | 100 % |
| man, 130 Hz | 92.0 % | 78.7 % | 40.8 % | 97.7 % |
| woman, 166 Hz | 88.9 % | 90.0 % | 88.4 % | 90.8 % |
| woman, 167 Hz | 95.3 % | 92.0 % | 90.2 % | 85.7 % |
| woman, 170 Hz | 92.4 % | 97.6 % | 92.8 % | 100 % |
| woman, 176 Hz | 93.5 % | 87.6 % | 91.1 % | 78.6 % |
| woman, 184 Hz | 91.1 % | 89.4 % | 93.6 % | 80.9 % |
| woman, 191 Hz | 91.6 % | 79.4 % | 91.2 % | 58.2 % |
| woman, 194 Hz | 92.1 % | 92.1 % | 92.1 % | 92.1 % |
| woman, 201 Hz | 90.9 % | 87.0 % | 90.9 % | 79.4 % |

(One clip per speaker and condition; the real-noise clip differs per
speaker, so the "real 0 dB" column mixes speaker and noise.) The cause is
the pitch detector losing low voices in noise — the gate follows pitch
voicing — not the gate's onset rule: a fragment-tolerant onset (≥ 150 ms
voiced within 250–300 ms) gained both sexes 1–3 pp, left the gap at
11–13 pp and raised noise-only display 2–3 pp (review measurement). The
retired gate showed a number regardless (stale values), so this is a new
asymmetry in what is *shown*; CLAUDE.md requires gender-symmetric ship
metrics, so it is the user's call before a PR. A dedicated voice detector
would help both this and the noise figures.

### Onset: what the first number says

| clean-ish conditions | women before | women after | men before | men after |
|---|---|---|---|---|
| first number after voice onset | 0.14 s | 0.51 s | 0.16 s | 0.48 s |
| first value vs the utterance's steady value, median abs error | 9.8 | 4.0 | 0.75 | 0.58 |
| …90th percentile | 67.5 | 13.8 | 4.0 | 1.7 |
| first value in the wrong range (≤ 30 vs ≥ 70) | **38 %** | **5 %** | 8 % | 0 % |
| settle to within ±10 of steady (median) | 3.07 s | 2.14 s | 0.17 s | 0.48 s |

In noise (pink 0 dB, real 10 / 0 dB) the women's first-value error fell
from 34.2 to 3.6 and wrong-range first values from 58 % to 8 %; men's
error 6.6 → 0.7, wrong range 4 % → 9 % (2 of 23 clips). The cost is a
later first number (≈ 0.35 s) — it now waits until at most half the
window predates the onset, which is what removes the pre-onset bias.
Women's later settle time is dominated by mid-utterance jitter, not the
onset.

### Speaker change after a pause (EMA reset at onset)

| woman → man / man → woman, pause | lag to 90 % of the new value before | after | first value after the pause before | after |
|---|---|---|---|---|
| 0.6 s | 2.03 / 2.10 s | 0.90 / 1.50 s | 66.9 / 3.5 | 0.6 / 54.7 |
| 1.5 s | 2.03 / 2.03 s | 0.90 / 0.98 s | 64.0 / 11.0 | 0.6 / 90.5 |
| no pause (swap) | 2.15 / 2.00 s | 2.30 / 2.15 s | — | — |

The EMA restarts only when an utterance closes, i.e. after ≥ 1 s without
voicing. **The reset is guaranteed only for pauses of ≥ 1 s of unvoiced
time; shorter pauses blend.** With a 0.6 s pause (plus each recording's
own leading / trailing silence) the voicing gap crosses 1 s for some
streams and not others: man → woman's first value is 54.7 (median of 4 —
the uncertain range; the woman's steady value is ~82), woman → man's 0.6.
At 1.5 s both start fresh (0.6 / 90.5). With no pause there is no new
onset, so the EMA carries over as before. A number stays on screen
(dimmed) for up to ~1.7 s into a pause (scoring continues while the
window still holds recent speech, ≤ 500 ms, then 1.2 s freshness),
instead of the whole pause.

### Held single vowels / long tones

| share of the hold with a number on screen | before | after | "needs running speech" from 1.25 s into the hold |
|---|---|---|---|
| VOICED /a/, women / men | 95.9 / 95.9 % | 3.9 / 3.1 % | 95 / 100 % |
| VocalSet long tones ≤ 400 Hz, women / men | 96.0 / 98.2 % | 2.6 / 6.0 % | 99 / 100 % |
| PVQD vowels, women / men | 98.7 / 99.2 % | 9.4 / 11.9 % | 97 / 97 % |
| sung notes above 400 Hz (pitch range) | 99.4 % | 5.6 % | — (pitch reports unvoiced: meter shows nothing) |

Before, women's held vowels were shown at a median of 55–59 (VOICED,
PVQD). False "needs running speech" on natural running speech: 0 % on
clean LibriSpeech, 0.3–0.8 % with 0.5 s reverb, 0.11 % / 0.25 % (women /
men) on PVQD speech portions.

### Limits of the held-phonation test

**Melodic singing is mostly scored.** The rule is a single-held-note test
(≥ 95 % voiced and ≤ 2 st spread over 1 s). On vocadito solo singing a
number shows 81.5 % of the sung time (median clip 88 %, 38 of 40 clips
above 50 %; first version 78.9 %) and "needs running speech" 7.5 %; even
on held notes ≥ 1 s inside the melodies (27 notes) a number shows 58.5 %
of the time ("needs running speech" 27.6 %): the 1-s test can't fire in a
note's first second, and the steady-onset hold applies only at the start
of an utterance. On synthetic hint streams the review also found these
scored: vibrato wider than ±1.05 st, glides faster than 2.5 st/s, legato
notes shorter than ~0.5 s, one-pitch chant with ≥ 2 unvoiced frames per
syllable, held notes with ≥ 10 % detector dropouts or ~25 % octave-down
frames; and 3–4 st/s glides, once "sustained" has fired, show nothing for
about half the time (continuous phonation can't reopen an utterance until
voicing breaks). Covering singing would need a broader rule (e.g. ≥ 90 %
voicing over ~2 s regardless of pitch spread), measured on vocadito plus
the speech, PVQD and flat-speech sets first — not done.

**Flat-intonation speech** (resonance practice on one pitch, all-voiced
practice sentences) looks like a held note to a pitch-only rule:

| share of speaking time | natural: number | F0 flattened: number | flattened: "needs running speech" (first version) | clips with the note > 5 % of speaking time |
|---|---|---|---|---|
| LibriSpeech, women / men | 92.9 / 91.4 % | 80.1 / 84.0 % | 6.6 / 4.8 % (12.0 / 6.8 %) | 5 of 16 (10) |
| PVQD sentences, women / men | 94.7 / 93.8 % | 75.5 / 74.1 % | 7.9 / 6.8 % (11.9 / 11.4 %) | 28 of 39 (32) |

The 0.95 share roughly halves it at no cost on held vowels (above); a
1.5-s window on top would cut it further (≈ 2–3 %, review measurement on
the first version's clock) but makes the note on held vowels late (from
1.25 s in: 76–89 % instead of ≥ 95 %), so it was not taken. Slowed natural speech is fine (1.5× / 2× lengthened, pitch kept:
the note ≤ 1.6 % of speaking time). A full fix needs a cue held vowels
lack — spectral / formant change, since running speech changes vowels and
a held note doesn't — measured on these sets before adopting.

## Parameter choice

Each row changes one setting from the shipped one (top row). Noise =
noise-only time with a number; coverage = speaking-time coverage.

| variant | noise | clean women | clean men | noisy women | noisy men |
|---|---|---|---|---|---|
| **shipped** (onset 150 ms, gap 1 s, recency 500 ms, share 15 %, fresh 1.2 s, held share 0.95, audio clock) | **22.3 %** | **92.0 %** | **89.9 %** | **89.4 %** | **76.8 %** |
| onset run 100 ms | 26.8 % | 92.5 % | 91.2 % | 91.6 % | 81.1 % |
| onset run 200 ms | 17.2 % | 91.0 % | 88.7 % | 81.7 % | 67.2 % |
| recency 300 ms | 21.0 % | 91.6 % | 88.7 % | 87.3 % | 74.5 % |
| voiced share 0 % | 23.7 % | 92.0 % | 90.6 % | 89.6 % | 79.2 % |
| voiced share 25 % | 21.3 % | 92.0 % | 89.3 % | 86.5 % | 74.8 % |
| gap 600 ms | 21.4 % | 92.0 % | 89.7 % | 85.8 % | 74.0 % |
| fresh 1.0 s | 21.2 % | 91.5 % | 88.6 % | 87.9 % | 75.0 % |
| fresh 1.5 s | 23.7 % | 92.3 % | 91.3 % | 90.8 % | 79.3 % |
| held share 0.9 | 21.8 % | 91.9 % | 89.7 % | 89.3 % | 76.8 % |
| hints on their posting chunk (wall-clock-like, even delivery) | 22.5 % | 91.6 % | 89.7 % | 89.0 % | 77.0 % |
| first version (wall clock, held share 0.9, 60 ms holes) | 22.1 % | 91.4 % | 89.5 % | 88.9 % | 77.1 % |

No setting moves noise much below ~17 % without costing low voices in
noise heavily (onset 200 ms: men's noisy coverage −10 pp for −5 pp noise):
the remainder is the pitch detector's false voicing. On even delivery the
audio clock changes little (it makes the first number ~50 ms earlier: the
onset is placed at its audio time, not 50 ms later when it was decoded);
its point is bursty delivery (above).

The steady-onset hold costs ≤ 0.3 pp of speech coverage and cuts the
numbers shown on held vowels to between a quarter and a half (first
version without it: VOICED 14 / 12 %, VocalSet 22 / 16 %, PVQD 22 / 23 % of
the hold, women / men). The held-phonation test was chosen on the same
data: over 1.0 s, spread ≤ 2 semitones fires on ≥ 95 % of held-vowel time
(≥ 1.25 s in) and on ≤ 0.25 % of non-held PVQD speech; a 0.75 s window or a
1.5 semitone limit was worse (false alarms on reverberant speech up to
2.9 %, or vibrato missed in 17 % of VocalSet notes).

## Browser check (production build, headless Chrome, fake mic)

`scripts/voice-direction-smoke.mjs`, 448×890 (phone) and 1280×800: on a
looped refrigerator recording (a median clip of the noise set) the meter
showed "needs running speech" while the pitch detector false-voiced the
compressor tone during the notch's first seconds, then nothing — no
number in 76–80 samples (old meter on this clip in the replay: 98 % of
the time); silence: no number; a looped held /a/ (woman, 214 Hz): "needs
running speech" through each hold, never a number; running speech (a man,
~100 Hz): a number in most of the 250 ms samples.

## Accepted costs and residuals

- **Later first number** (~0.5 s after onset instead of ~0.15 s) — the
  price of not scoring pre-onset audio.
- **Men lose more coverage than women in heavy noise** (77 % vs 89 % at
  0–10 dB SNR; the two lowest voices 56–61 %) — open, see above.
- **Noise false voicing**: 22 % of noise-only time still shows a number
  (25 % any non-blank state), where the pitch trace also shows a voice.
- **Other people's speech is scored** (babble lead 58 %).
- **Short phrases** under ~0.5 s (single words) get "updating…" but no
  score — the meter is a running-speech readout.
- **Melodic singing** mostly scored; **flat-intonation speech** can show
  "needs running speech" (6.6–7.9 % of speaking time on flattened speech).
- **Pauses under 1 s blend** the previous utterance into the next.
- **Sustained sub-75 Hz phonation** is no longer scored (the probe that
  allowed it passed 8.6 % of real-noise windows; the pitch trace, whose
  floor is 75 Hz, doesn't show it either).

## Reproduce

`scripts/perceived-voice-gate/` (README there): `prep.py` builds the sets
(public data: the resonance lab's LibriSpeech benchmark under
`$SYRINX_RLAB_BUILD`, the notch real-data corpora under `$NOTCHVD_ROOT`,
the PVQD `Demographics.xlsx` via `--pvqd-demographics`) →
`chain.mjs` runs the production chain (+ the retired gate) →
`score.py` scores the windows with the deployed ONNX → `replay.mjs` runs
the branch gate + view → `analyze.py before|<variant> noise chan onset dyn
held adv` and `analyze.py x sweep --variants=…` print every table above.
Outputs go to the gitignored `build/perceived-voice-gate/`. The
retired-gate arm reproduces the audit's figures, and `replay.mjs
--clock=post --gate='{"sustainMinShare":0.9,"maxHopMs":60}'` reproduces
the first version's (checked: 22.1 / 91.4 / 89.5 / 88.9 / 77.1 %).
`noise-augment-oracle.js gender` now runs the same utterance gate
(`--vad=voiced` for the retired one).
