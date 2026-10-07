# Perceived Voice meter: utterance gate + fresh-only display — 2026-10-07

Hard-rule-3 file for the `src/ml/gender-worker.js` change on branch
`voice-direction` (new `src/ml/utterance-gate.js`,
`src/components/perceivedVoiceView.js`). The meter itself is due to be
replaced by the cue-strip design; these are the no-regret fixes that hold
whatever replaces it.

## Why

An audit of the deployed meter (production chain replayed on public data,
2026-10-06) found that it

- showed a number during **noise-only audio 71 % of the time**, leaning
  masculine (median shown value 15);
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
relayed pitch-voicing stream (one hint per pitch frame, now with `pitch`):

| Rule | Setting |
|---|---|
| utterance opens on a run of consecutive voiced frames | ≥ 150 ms |
| utterance closes after no voiced frame for | 1000 ms |
| score only if the newest voiced frame is at most | 500 ms old ("recent") |
| …and at least this share of the window's frames are voiced | 15 % ("voiced") |
| …and at most this much of the window predates the onset | 50 % |
| EMA | reset on the first scored window of every utterance |
| held phonation ("needs running speech") | trailing 1.0 s: ≥ 90 % voiced AND voiced-pitch p90 − p10 ≤ 2 semitones |
| young utterance steady since onset | held at "updating" until it breaks voicing / moves pitch, or the 1 s test fires |
| after held phonation | utterance closed; a new one must start with voicing that begins after the note |
| sub-75 Hz periodicity probe | removed from the worker (kept in audio-utils for the old-chain oracles) |
| pitch feed dead > 2 s | legacy peak ≥ 0.05 fallback, unchanged (never seen in practice) |

The worker posts `voice-state` (`listening` / `updating` / `scoring` /
`pause` / `sustained`) on change.

**Display (`perceivedVoiceView.js`, ResonanceMeter)** — a number only
while the newest score is ≤ 1.2 s old (dimmed when the worker is not
currently scoring); "updating…" while an onset is being collected;
"needs running speech" (centre of the bar + status line) on held
phonation; nothing otherwise. The DSP-gate-open 6 s hold is gone. Colour:
one neutral hue for fill, indicator, history dots and readout; the two
outer ranges drawn identically (the blue "feminine = in range" / orange
colouring is removed). End labels kept for now.

## Method

Same production-chain replay as the audit, so before and after differ
only in the code under test:

1. **Chain** — the real pitch worker + DSP worker + `handleAnalysisResult`
   (DSP gate) over each 16 kHz stream in 25 ms chunks (recorded by the
   audit; the pitch and DSP code is unchanged on this branch).
2. **Gate** — *before*: the audit's exact replay of the old
   `maybeInfer`. *After*: `scripts/perceived-voice-gate-replay.mjs` feeds
   the recorded pitch frames (relayed one chunk late, as the main thread
   does) to the branch's `utterance-gate.js` and decides at the worker's
   150 ms ticks.
3. **Classifier** — logits from the deployed
   `voice-gender-classifier-onnx-q8-v2` ONNX in onnxruntime (CPU; parity
   with Transformers.js 6e-8), cached for every window the old gate
   scored. Every window the new gate scores is among them (asserted: 0
   missing on all sets).
4. **EMA + display** — before: the audit's replay of the old EMA and
   meter. After: `audio-utils.ema` (α 0.2, reset per gate) and the
   branch's `perceivedVoiceView` evaluated every 25 ms (before the rAF
   tween, as the audit did).

Public data only:

| Set | Content |
|---|---|
| running speech | 16 LibriSpeech test-clean speakers (8 women, 8 men), one 6–14 s utterance each, × 9 channel conditions: clean, −20 dB level, phone band, laptop mic, 0.5 s reverb, pink noise 0 dB SNR, real noise 10 / 0 dB, 6-talker babble 10 dB; 2 s of the condition's background before, 1 s after |
| noise only | 100 clips (≤ 30 s) from Freesound, DCASE, MS-SNSD, DEMAND and ESC-50: stationary-tonal 35, mixed 35, broadband 20, intermittent-tonal 10 |
| held phonation | VOICED sustained /a/ (109 holds), VocalSet long tones (204 holds), PVQD CAPE-V sustained vowels (456 holds); PVQD sentence/speech portions for false alarms |
| speaker changes | LibriSpeech woman↔man swaps with no gap and with 0.6–4 s pauses (76 streams) |

Coverage figures are per-clip means; onset figures are medians over 5
conditions × 8 speakers per sex (small n — read differences of a few
points as noise). "Speaking-time coverage" counts the 25 ms hops at which
the Praat F0 track of the clean recording was voiced in the last 300 ms.

## Results

### Noise and silence (no voice present)

| | before | after |
|---|---|---|
| noise-only time with a number on screen (mean of 100 clips) | **71.3 %** | **22.1 %** |
| median clip | 91.4 % | 5.1 % |
| clips never showing a number | 11 % | 43 % |
| clips showing one > 50 % of the time | 74 % | 19 % |
| real-noise lead before speech (chan real 10 / 0 dB) | 48.6 % | 17.7 % |
| silence (−70 dBFS floor; chan leads, browser check) | 0 % | 0 % |
| shown values where shown: median / share ≤ 30 | 15.0 / 75 % | 16.7 / 68 % |
| for reference: pitch trace painted (unchanged) | 23.2 % | 23.2 % |

By noise label (after): broadband 18 %, stationary-tonal 21 %,
intermittent-tonal 22 %, mixed 26 % (before: 61 / 76 / 92 / 67 %). What
remains tracks the pitch detector's own false voicing (per-clip Spearman
0.88 between shown and painted time): where the pitch trace shows a voice
in noise, so does the meter. Removing that needs a better voice detector,
not a stricter meter gate (see the sensitivity table).

### Running speech: time with a number on screen while speaking

| speaking-time coverage | women before | women after | men before | men after |
|---|---|---|---|---|
| clean-ish (clean, −20 dB, phone, laptop, reverb) | 98.2 % | 91.4 % | 97.9 % | 89.5 % |
| noisy (pink 0 dB, real 10 / 0 dB) | 98.6 % | 88.9 % | 98.8 % | 77.1 % |
| PVQD speech portions (time with a number) | 99.0 % | 92.2 % | 99.0 % | 87.7 % |

"Before" was near 100 % because stale values were held through every
pause. Of the speaking time now without a number (clean-ish), 3.7 % /
4.4 % (women / men) is the first ~0.5 s of an utterance ("updating…")
and 4.8 % / 6.0 % shows nothing at all — stretches where the pitch
detector reported too little voicing to open or continue an utterance;
in heavy noise the latter grows to 7 % / 20 %. The gap between men and women is 2 pp in
clean-ish conditions and 12 pp at 0–10 dB SNR, where the pitch detector
loses low voices more often — an accepted cost, documented below.

### Onset: what the first number says

| clean-ish conditions | women before | women after | men before | men after |
|---|---|---|---|---|
| first number after voice onset | 0.14 s | 0.56 s | 0.16 s | 0.54 s |
| first value vs the utterance's steady value, median abs error | 9.8 | 4.4 | 0.75 | 0.65 |
| …90th percentile | 67.5 | 15.4 | 4.0 | 1.7 |
| first value in the wrong range (≤ 30 vs ≥ 70) | **38 %** | **8 %** | 8 % | 0 % |
| settle to within ±10 of steady (median) | 3.07 s | 2.14 s | 0.17 s | 0.56 s |

In noise (pink 0 dB, real 10 / 0 dB) the women's first-value error fell
from 34.2 to 4.0 and wrong-range first values from 58 % to 8 %. The cost
is a later first number (≈ 0.4 s) — it now waits until at most half the
window predates the onset, which is what removes the pre-onset bias.
Women's later settle time is dominated by mid-utterance jitter, not the
onset.

### Speaker change after a pause (EMA reset at onset)

| woman → man / man → woman, pause | lag to 90 % of the new value before | after | first value after the pause before | after |
|---|---|---|---|---|
| 0.6 s | 2.03 / 2.10 s | 1.05 / 1.50 s | 66.9 / 3.5 | 0.8 / 54.7 |
| 1.5 s | 2.03 / 2.03 s | 1.05 / 0.98 s | 64.0 / 11.0 | 0.6 / 90.5 |
| no pause (swap) | 2.15 / 2.00 s | 2.08 / 2.08 s | — | — |

With no pause there is no new onset, so the EMA carries over as before.
A number stays on screen (dimmed) for up to ~1.7 s into a pause (scoring
continues while the window still holds speech, ≤ 500 ms, then 1.2 s
freshness), instead of the whole pause.

### Held vowels and sung notes

| share of the hold with a number on screen | before | after | "needs running speech" from 1.25 s into the hold |
|---|---|---|---|
| VOICED /a/, women / men | 95.9 / 95.9 % | 3.7 / 3.4 % | 95 / 100 % |
| VocalSet notes ≤ 400 Hz, women / men | 96.0 / 98.2 % | 2.4 / 6.3 % | 99 / 100 % |
| PVQD vowels, women / men | 98.7 / 99.2 % | 8.7 / 10.9 % | 97 / 97 % |
| sung notes above 400 Hz (pitch range) | 99.4 % | 5.6 % | — (pitch reports unvoiced: meter shows nothing) |

Before, women's held vowels were shown at a median of 55–59 (VOICED,
PVQD). False "needs running speech" on running speech: 0 % on clean
LibriSpeech, 0.3–0.8 % with 0.5 s reverb, 0.18 % / 0.35 % (women / men)
on PVQD speech portions.

## Parameter choice

Each row changes one setting from the shipped one (top row). Noise =
noise-only time with a number; coverage = speaking-time coverage.

| variant | noise | clean women | clean men | noisy women | noisy men |
|---|---|---|---|---|---|
| **shipped** (onset 150 ms, gap 1 s, recency 500 ms, share 15 %, fresh 1.2 s) | **22.1 %** | **91.4 %** | **89.5 %** | **88.9 %** | **77.1 %** |
| onset run 100 ms | 26.7 % | 91.8 % | 90.8 % | 91.6 % | 81.4 % |
| onset run 200 ms | 17.1 % | 90.5 % | 88.2 % | 81.2 % | 66.8 % |
| recency 300 ms | 21.1 % | 90.9 % | 88.8 % | 87.2 % | 74.8 % |
| voiced share 0 % | 23.5 % | 91.4 % | 90.1 % | 89.1 % | 79.1 % |
| voiced share 25 % | 20.4 % | 91.4 % | 88.7 % | 84.3 % | 74.5 % |
| gap 600 ms | 21.1 % | 91.4 % | 89.3 % | 85.5 % | 74.2 % |
| fresh 1.0 s | 21.0 % | 91.0 % | 88.1 % | 87.7 % | 75.2 % |
| fresh 1.5 s | 23.5 % | 91.5 % | 90.9 % | 90.3 % | 79.6 % |
| first draft (100 ms / 600 ms / 300 ms / 25 % / 1.0 s) | 21.0 % | 90.9 % | 87.0 % | 82.5 % | 70.9 % |

No setting moves noise much below ~17 % without costing low voices in
noise heavily (onset 200 ms: men's noisy coverage −10 pp for −5 pp noise):
the remainder is the pitch detector's false voicing. The shipped values
trade the first draft's men-vs-women coverage gap (3.9 → 1.9 pp clean,
11.6 → 11.8 pp noisy) and men's noisy coverage (+6 pp) for +1 pp noise.

The steady-onset hold costs ≤ 0.3 pp of speech coverage and cuts the
numbers shown on held vowels to between a quarter and a half (without it: VOICED 14 / 12 %, VocalSet
22 / 16 %, PVQD 22 / 23 % of the hold, women / men). The held-phonation
test was chosen on the same data: over 1.0 s, ≥ 90 % voiced with spread
≤ 2 semitones fires on ≥ 98 % of held-vowel time (≥ 1 s in) and on 0.2 %
of non-held PVQD speech (women 0.3 %, men 0 %); a 0.75 s window or a 1.5 semitone limit was
worse (false alarms on reverberant speech up to 2.9 %, or vibrato missed
in 17 % of VocalSet notes).

## Browser check (production build, headless Chrome, fake mic)

`scripts/voice-direction-smoke.mjs`, 448×890 (phone) and 1280×800: on a
looped refrigerator recording (a median clip of the noise set) the meter
showed "needs running speech" while the pitch detector false-voiced the
compressor tone during the notch's first seconds, then nothing — no
number in 80 samples on either viewport (old meter on this clip in the
replay: 98 % of the time); silence: no number; a looped held /a/
(woman, 214 Hz): "needs running speech" through each hold, never a
number; running speech (a man, ~100 Hz): a number in 87–89 % of the
250 ms samples. All 29 checks pass on both viewports.

## Accepted costs and residuals

- **Later first number** (~0.55 s after onset instead of ~0.15 s) — the
  price of not scoring pre-onset audio.
- **Coverage gap in heavy noise**: men 77 % vs women 89 % of speaking time
  at 0–10 dB SNR, because the gate follows pitch voicing and the pitch
  detector loses low voices first. A dedicated voice detector would help
  both this and the residual noise numbers.
- **Noise false voicing**: 22 % of noise-only time still shows a number,
  where the pitch trace also shows a voice.
- **Short phrases** under ~0.5 s (single words) get "updating…" but no
  score — the meter is a running-speech readout.
- **Sustained sub-75 Hz phonation** is no longer scored (the probe that
  allowed it passed 8.6 % of real-noise windows; the pitch trace, whose
  floor is 75 Hz, doesn't show it either).

## Reproduce

Needs the audit's recorded chain runs (per-clip pitch frames, DSP gate,
cached logits; scratch, not committed):
`node scripts/perceived-voice-gate-replay.mjs --runs=<audit out dir> --set=<chan|noise|voiced|vocalset|pvqd|dyn>`
writes per-clip verdicts, posted scores and the per-hop display; the
analysis reuses the audit's metric code on both before and after.
