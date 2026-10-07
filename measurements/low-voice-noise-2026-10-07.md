# Perceived Voice meter: men's voices in heavy noise — diagnosis and pre-registered ship rule — 2026-10-07

**Status: pre-registration.** This file fixes the baseline and the rule a fix
must pass **before any candidate is tried**. No candidate result exists at the
time of this commit. Each candidate adds its own results section below the
rule, measured exactly as described here. It is the hard-rule-3 measurement
file for any candidate that touches `pitch-worker.js`, `boersma-ac.js`,
`gender-worker.js`, `dsp-worker.js`, `pitchGate.js`, `pitchSmoothing.js` or
`cpp.js` for this problem.

Branch `lowvoice-noise`, from `voice-direction` 852b5cc. The pitch, DSP, hook
and meter code there is identical to 5f6c8c7, the tip the diagnosis replayed.

## Problem

On `voice-direction` the Perceived Voice meter only scores running speech
once a voiced run has started (utterance gate,
[perceived-voice-gate-2026-10-07.md](perceived-voice-gate-2026-10-07.md)).
At 0–10 dB SNR that gate shows a number for **76.8 % of men's speaking time
vs 89.4 % of women's** (16-speaker set, the gate doc). The two lowest voices
there (94 and 100 Hz) get 55.8–61.3 %, against 90–95 % in quiet. The retired
gate showed a number regardless, because it held stale values, so this is a
new asymmetry in what is shown. CLAUDE.md requires gender-symmetric ship
metrics. The user's decision: **fix before shipping.**

## Method

This is the production-chain replay from the gate doc
(`scripts/perceived-voice-gate/`), widened and instrumented:

- **38-speaker set.** The full build of `prep.py chan` (`jobs_chan.full.json`):
  all 38 LibriSpeech test-clean speakers × 12 conditions. Those are the gate
  doc's 9 conditions plus pink noise 10 dB, 6-talker babble 0 dB and 1.0 s
  reverb, 456 streams in all. Labelled men with median F0 ≥ 180 Hz are
  excluded (ls672, 252 Hz). That leaves **19 women and 18 men: 6 men under
  110 Hz** (91, 94, 96, 100, 101, 101 Hz, all under 105 Hz) **and 12 at
  115–147 Hz.** The set contains the gate doc's 16 speakers.
- **Attribution chain.** The real pitch worker, DSP worker and
  `handleAnalysisResult`, run as in `chain.mjs`. Observation-only taps add a
  per-frame dump: tracker decode, best candidate and confidence inputs, ghost
  veto, above-range null, harmonic-guard verdict, and per-harmonic pass
  bitmasks on the decoded frame's own buffer. **Parity checks:**
  - The posted pitch, DSP gate and paint are identical to `chain.mjs`.
  - Replaying the shipped `utterance-gate.js` over these runs reproduces the
    committed shipped replay on every stream: 144 of 144 channel streams and
    every noise, held-phonation, flat-speech, singing and speaker-change
    stream.
  - The guard verdict is reproduced exactly offline from the bitmasks.
- **Speaking-time coverage** is defined as in the gate doc. Speaking hops
  are the 25 ms hops at which the clean recording's Praat F0 track was
  voiced in the last 300 ms. Coverage is the share of speaking hops at which
  the meter shows a number, averaged over clips.
  **Noisy** = pink 0 dB + real noise 10 dB + real noise 0 dB.
  **Clean-ish** = clean, −20 dB, phone band, laptop mic, 0.5 s reverb.
- **Lever sizes** below are upper-bound replays. Hint-stream variants are
  built from the per-frame dump and fed to an instrumented copy of the gate
  that accepts "weak" hints. That copy is bit-identical to the shipped gate
  when no weak hints are sent.

## Diagnosis

### Coverage by group and condition (38-speaker set)

| speaking-time coverage | women | men 115–147 Hz | men < 105 Hz | all men |
|---|---|---|---|---|
| clean-ish | 92.0 % | 91.1 % | 92.8 % | 91.6 % |
| **noisy** | **89.9 %** | **80.0 %** | **79.9 %** | **80.0 %** |
| pink 0 dB | 91.7 | 72.5 | 83.1 | 76.1 |
| real noise 0 dB | 84.6 | 74.6 | 64.3 | 71.1 |
| real noise 10 dB | 93.4 | 93.0 | 92.2 | 92.7 |
| pink 10 dB | 92.7 | 91.1 | 92.2 | 91.4 |
| phone band | 93.5 | 89.2 | 91.5 | 89.9 |
| 1.0 s reverb | **83.3** | 87.6 | 92.6 | 89.3 |
| babble 0 / 10 dB | 100 | 100 | 100 | 100 |
| utterance onset success, noisy (a number within 1 s of each ≥ 1 s burst) | 96.5 | 84.7 | 88.9 | 86.1 |

- **The gap is a heavy-noise problem for men, not a low-F0 problem.** It
  appears only at 0 dB SNR (pink 0, real 0). At 10 dB there is essentially
  none. Within men, median F0 does not predict noisy coverage (Spearman
  0.01). Three of the six men under 105 Hz score 94–96 % in noise.
- **The 55.8–61.3 % figures for the two lowest voices are specific to those
  speakers and noise clips.** Real 0 dB uses a different real-noise clip per
  speaker, so that column mixes speaker and noise. The 100 Hz voice gets 0 %
  at real 0 dB but 83.7 % at pink 0 dB.
- **Babble is scored for everyone.** The meter scores the babble itself.
- **Reverberation shows the opposite gap.** Women get less coverage than men
  in reverb (0.5 s: 87.2 vs 92.0 %; 1.0 s: 83.3 vs 89.3 %).

### Meter state of the speaking time with no number (noisy, % of speaking time)

| state | women | men 115–147 | men < 105 |
|---|---|---|---|
| never opened | 3.7 | 9.5 | 8.3 |
| closed by a > 1 s voicing gap inside speech | 2.8 | 5.6 | 9.9 |
| "updating" (onset being collected) | 2.5 | 2.2 | 2.5 |
| pause: recency or voiced-share rule | 0.24 | 1.1 | 0 |
| held-note rule fired on speech | 0.3 | 0.6 | 0 |
| peak floor | 0 | 0 | 0 |

In clean-ish conditions the never-opened share is 3.8 / 4.7 / 4.4 %. Skipped
inference is 0 by construction here, because the replay does not model it;
desktop inference fits the 150 ms hop.

### Why the gate does not open or stay open

Blank speaking time is split by the pitch stage of the Praat-voiced frames in
the trailing 500 ms. Updating and held-note time is excluded. Figures are for
noisy conditions, as % of speaking time:

| pitch stage | women | men 115–147 | men < 105 |
|---|---|---|---|
| posted voiced, but too fragmented to open or keep the utterance | 3.5 | 6.6 | 3.5 |
| tracker unvoiced, confidence < 0.35 | 0.3 | 1.1 | 2.1 |
| tracker unvoiced, confidence 0.35–0.5 | 1.3 | 4.1 | 4.5 |
| above-range null (decode > 400 Hz) | 0.2 | 1.7 | **5.0** |
| ghost veto | 0.07 | 1.1 | 0 |
| harmonic-guard veto | 0.14 | 0.2 | 1.3 |
| no reference voicing (gaps between words inside the 300 ms mask) | 1.2 | 1.4 | 1.7 |

The same breakdown at frame level, for Praat-voiced frames in noisy
conditions (% of frames):

| frame stage | women | men 115–147 | men < 105 |
|---|---|---|---|
| posted voiced | 73.5 | 63.6 | 62.2 |
| tracker unvoiced, confidence < 0.35 | 2.7 | 3.4 | 4.0 |
| tracker unvoiced, confidence 0.35–0.5 | 15.2 | 21.1 | 18.3 |
| above 400 Hz | 5.8 | 4.5 | 9.1 |
| ghost veto | 0.5 | 2.0 | 0 |
| guard veto | 2.3 | 5.5 | 6.4 |
| posted-voiced frames in runs < 150 ms (share of posted-voiced) | 19.8 | 32.1 | 26.9 |

By condition, the posted-voiced share is:

- **real 0 dB:** 60 / 50 / 44 %. Above-400 frames are 7.6 / 5.3 / **15.5 %**
  and guard vetoes 4.2 / 10.3 / 11.0 %.
- **pink 0 dB:** 69 / 56 / 61 %. Tracker frames at confidence 0.35–0.5 are
  20.6 / 32.4 / 26.3 %.

**The above-range decodes.** For low men in noise they sit at 5–8 × F0
(median about 590 Hz). These are formant-region harmonic locks that occur
when low-frequency noise masks the low harmonics. Only about 17 % of all
above-400 decodes fall on reference-voiced frames. The rest are noise, which
is why accepting them unconditionally raises the noise-only display.

**At pitch level the same loss shows up.** The real tracker in
`noise-augment-oracle.js` shows low-male nulls growing about 3–4 × more than
women's:

- FDA at +10 dB, men with reference F0 < 110 Hz, null rate: clean 6.6 %,
  pink 22.7 %, white 26.0 %, crickets 20.3 %.
- FDA women at 160 Hz and up, null rate: clean 1.8 %, pink 6.2 %, white 8.5 %.
- PTDB-TUG men < 110 Hz, null rate: 17.4 → 28.1 % with pink +10 dB. Women:
  2.1 → 4.5 %.

Frame-level recall of Praat-voiced frames on the channel set
(women / men 115–147 / men < 105):

| condition | women | men 115–147 | men < 105 |
|---|---|---|---|
| clean | 97.6 % | 96.0 % | 92.4 % |
| pink 0 dB | 68.6 % | 56.0 % | 61.4 % |
| real 0 dB | 60.1 % | 50.2 % | 44.4 % |

**Cause.** At 0 dB, low-frequency-heavy noise makes the tracker lose men's
voicing. That appears as frames at confidence 0.35–0.5, above-400 harmonic
locks, guard vetoes and fragmented runs. The utterance gate, with its 150 ms
onset and 1 s close, turns those losses into never-opened and closed-by-gap
time. The peak floor, inference and the held-note rule are not involved.

### Levers sized so far (upper bounds, for context; not candidates)

"On" means weak frames count for the onset run only. "Hy" (hysteresis) means
weak frames only keep an open utterance alive (gap, recency, share); they
never open one and never enter the held-note test. "All" means both. Weak
hints are never posted or painted. Columns: change in noisy coverage in pp
(women / men 115–147 / men < 105 / all men), and change in noise-only time
with a number (baseline 22.3 %).

| lever | women | men 115–147 | men < 105 | all men | noise-only | other |
|---|---|---|---|---|---|---|
| guard-vetoed frames weak, on | +0.8 | +0.2 | +2.2 | +0.9 | +4.0 | |
| guard-vetoed frames weak, all | +1.5 | +1.3 | +3.4 | +2.0 | +12.7 | |
| confidence 0.35–0.5 (+ guard) weak, on | +2.5 | +7.2 | +3.8 | +6.0 | +5.1 | VOICED held vowels with a number 3.9 → 14.4 % |
| same, all | +7.6 | +15.4 | +14.0 | +14.9 | to 77.5 % | unusable |
| confidence 0.35–0.5 passing the guard check at the best candidate, on | +0.9 | +1.0 | +2.2 | +1.4 | +4.4 | |
| harmonic guard removed (posted) | +0.9 | −1.3 | −2.9 | −1.9 | +8.2 | more noise voicing trips the held-note rule |
| guard relaxed below 110 Hz | +0.6 | −1.1 | +2.2 | 0.0 | +5.5 | |
| guard counts harmonics up to 800 Hz | +0.5 | −0.4 | +2.0 | +0.3 | +5.7 | |
| guard debounce 4 → 8 frames | +0.4 | +0.8 | +2.1 | +1.2 | +6.1 | |
| guard ratio 10 → 5 | +0.8 | +1.3 | −2.8 | — | similar | |
| ghost veto removed | −0.7 | ≈ 0 | ≈ 0 | ≈ 0 | | |
| confidence ≥ 0.35 + guard check posted voiced | +2.1 | +2.5 | +2.1 | +2.4 | +4.2 | |
| every above-400 decode posted voiced | +3.3 | +13.5 | +11.1 | +12.7 | +17.0 | VocalSet women's held tones with a number 2.6 → 15.8 % |
| above-400 weak, on | +0.9 | +4.7 | +1.7 | +3.7 | +2.2 | VocalSet women 2.6 → 13.5 % |
| above-400 weak, hy | +0.7 | +1.6 | +6.1 | +3.1 | +5.6 | held / flat speech unchanged |
| above-400 with ≥ 2 partials of d/k not multiples of d ("absub2"), posted at d/k | +0.4 | +4.1 | +3.8 | +3.9 | +6.9 | held unchanged |
| absub2 weak, on | 0 | +2.3 | +0.7 | +1.7 | +0.5 | |
| absub2 weak, hy | +0.4 | +0.5 | +2.8 | +1.3 | +3.5 | |
| onset run 150 → 100 ms | +1.7 | +6.7 | +2.5 | +5.3 | +4.5 | flat women's speech with a number +2.8 |
| close after 2 s instead of 1 s | +1.3 | +2.3 | +1.9 | +2.2 | +1.6 | speaker-change reset weakens |
| recency 1000 ms + 2 s close | +1.4 | +3.0 | +2.1 | +2.6 | +1.9 | |
| fragment-tolerant onset (gate-doc review) | +1–3 | +1–3 | | | +2–3 | gap unchanged |
| C1 = onset 100 ms + absub2 hy | +2.0 | +7.7 | +5.4 | +6.9 | +8.4 | gap 5.0 pp |
| C2 = C1 + 2 s close | +2.4 | +8.8 | +7.4 | +8.3 | +9.9 | gap 4.0 pp |
| C3 = onset 100 ms + above-400 hy | +2.1 | +9.6 | +8.7 | +9.3 | +10.6 | gap 2.7 pp; women's noisy settle 0.69 → 1.14 s |
| C4 = onset 100 ms + absub2 posted | +2.0 | +9.2 | +8.9 | +9.1 | +12.2 | gap 2.8 pp |
| 2nd-order high-pass 150 Hz on the 16 kHz pitch stream | +1.5 | +2.2 | +10.2 | +4.8 | +6.6 | real 0 dB, men < 105 Hz 64 → 89 %; clean channel-set men recall 96.0 → 94.3 % |
| high-pass 100 Hz | +0.9 | +3.4 | +9.3 | +5.3 | +7.0 | FDA men < 110 Hz correct: clean 82.0 → 80.8, white +10 dB 68.5 → 66.0, pink +10 dB 69.8 → 72.7 %; women's real 0 dB octave-down 8.4 → 12.8 % |
| pre-emphasis 0.9 | | | | | | pink 0 dB recall, women, 69 → 8 %: ruled out |

**Every lever that adds periodicity evidence costs roughly 1 pp of noise-only
display for each pp it gains for men in noise.** The best ratios are absub2
onset-only (+1.7 for +0.5, but small), above-400 onset-only (+3.7 for +2.2,
but it scores held sung tones) and the 100 ms onset (+5.3 for +4.5).

No pitch-only lever removes the trade-off. On the private session
recordings, every lever that adds periodicity evidence also raised the
meter's display far from any voicing, and both high-pass front ends sharply
raised posted false voicing. Results on the private session recordings are
kept outside this repository.

## Baseline

Every rule figure is **paired**: the baseline and the candidate go through
the same frozen evaluator on identical streams. The baseline is the
`voice-direction` meter and pitch code (5f6c8c7 = 852b5cc).

### 38-speaker set (19 women, 18 men)

| | women | all men | men < 105 Hz |
|---|---|---|---|
| noisy coverage | 89.90 % | 79.96 % | 79.85 % |
| gap to women, noisy | — | **9.94 pp** | **10.04 pp** |
| clean-ish coverage | 92.00 % | 91.64 % | 92.80 % |
| real-noise lead before speech with a number (2 s, real 10 / 0 dB) | 12.18 % (both sexes) | | |
| the problem report's two lowest voices (94, 100 Hz), noisy | | 58.56 % (61.33 / 55.79) | |

| onset (median over streams) | women clean-ish | men clean-ish | women noisy | men noisy |
|---|---|---|---|---|
| first number after voice onset | 0.485 s | 0.525 s | 0.545 s | 0.550 s |
| settle to within ±10 of the steady value | 0.755 s | 0.545 s | 0.695 s | **0.675 s** |
| first value in the wrong range (≤ 30 vs ≥ 70) | 4.2 % | 0 % | 5.3 % | 3.8 % |

Two of 54 men's noisy streams get no number at all.

Coverage per condition is in the diagnosis table above.

### Held-out set: LibriSpeech dev-clean (`prep.py chandev`)

Built with the same builder and its own seed: 39 speakers × 12 conditions,
all measured. ls7976 is excluded (labelled male, 198 Hz), leaving **20
women and 18 men, 5 of them under 105 Hz** (90, 96, 97, 103, 104.7 Hz). This
set was built after the diagnosis and **no lever was sized on it.**

| | women | all men | men < 105 Hz |
|---|---|---|---|
| noisy coverage | 87.84 % | 82.88 % | 83.43 % |
| gap to women, noisy | — | **4.96 pp** | **4.41 pp** |
| clean-ish coverage | **88.77 %** | **92.87 %** | |
| real 0 / pink 0 / real 10 dB | 82.9 / 86.3 / 94.3 % | 72.8 / 83.4 / 92.5 % | |
| −20 dB / 0.5 s reverb / 1.0 s reverb | **86.2 / 84.2 / 77.7 %** | 93.5 / 92.2 / 90.4 % | |
| real-noise lead with a number | 16.06 % (both sexes) | | |

The held-out set confirms the noisy gap, at half the size, worst at real
0 dB. It also shows **the opposite asymmetry in quiet and reverberant
conditions: women's clean-ish coverage is 4.1 pp below men's.** That gap is
outside this rule. It is guarded (no condition may lose coverage) and left
open for a separate decision.

### Meter on public non-voice, held and flat sets (unchanged sets from the gate doc)

| measure | women | men |
|---|---|---|
| noise-only time with a number / any non-blank state (100 clips) | 22.26 % / 25.41 % | |
| held phonation with a number: VOICED /a/ | 3.9 % | 3.1 % |
| VocalSet long tones ≤ 400 Hz | 2.6 % | 6.0 % |
| PVQD vowels ≤ 400 Hz | 9.4 % | 11.9 % |
| all holds > 400 Hz (68, pooled) | 5.6 % | |
| "needs running speech" from 1.25 s into ≤ 400 Hz holds: VOICED / VocalSet / PVQD | 95.3 / 99.1 / 96.7 % | 100 / 100 / 96.7 % |
| PVQD speech portions: number / false "needs running speech" | 92.56 / 0.11 % | 88.08 / 0.25 % |
| false "needs running speech", F0-flattened LibriSpeech (38 speakers) / PVQD sentences | 7.2 / 7.9 % | 3.3 / 6.8 % |
| …natural LibriSpeech (orig, 1.5×, 2× slowed) / PVQD (orig, 1.5×) | 0 / 0.4 / 2.0 %, 0.2 / 1.6 % | 0 / 0 / 0.4 %, 0.1 / 1.3 % |

Speaker changes after a pause behave as in the gate doc. After a 1.5 s pause
the first value is 0.61 for woman → man and 90.5 for man → woman, and the
lag to 90 % is 0.90 / 0.98 s. After 2.5 s and 4 s pauses the first values
are 0.99 / 88.0 and 1.00 / 87.8.

The flattened-LibriSpeech row covers all 38 speakers. The gate doc's
16-speaker figures are 6.6 / 4.8 %.

### Pitch chain (for candidates that change it)

`noise-augment-oracle.js pitch --frontend=tracker` on FDA. Figures are
correct %, null %, and false voicing on the noise-only tail:

| noise | 20 dB | 10 dB | 5 dB |
|---|---|---|---|
| clean | 86.8 / 3.4 / — | | |
| white | 86.2 / 4.1 / 0.0 | 80.6 / 11.6 / 0.0 | 68.0 / 27.5 / 0.0 |
| pink | 86.1 / 4.2 / 0.0 | 82.1 / 9.3 / 0.0 | 72.5 / 19.7 / 0.0 |
| fan-hum | 78.0 / 12.7 / 0.0 | 77.8 / 13.2 / 0.1 | 76.7 / 14.7 / 0.0 |
| mains-complex | 77.7 / 12.9 / 0.0 | 77.9 / 12.7 / 0.0 | 77.9 / 12.7 / 0.0 |
| babble | 85.5 / 3.4 / 92.1 | 72.2 / 3.0 / 97.8 | 55.7 / 4.0 / 97.8 |
| crickets | 86.4 / 4.1 / 0.0 | 82.1 / 10.0 / 0.0 | 72.9 / 20.3 / 0.0 |
| cicadas | 86.3 / 4.0 / 0.0 | 80.8 / 11.2 / 0.0 | 67.6 / 27.4 / 0.0 |

The FDA / PTDB-TUG / Hillenbrand / vocadito chain figures
(`scripts/session-oracle/corpus.mjs`) are computed paired, on the baseline
tree and the candidate tree, by the first pitch-chain candidate's
evaluation. The session-oracle and `session_fv.py` baselines on the private
session recordings exist. Results on the private session recordings are
kept outside this repository.

## Pre-registered ship rule

**Sets and terms.**

- Evaluation set: the 38-speaker set. Held-out set: `chandev`. Both exclude
  labelled men with median F0 ≥ 180 Hz.
- "Men" = all remaining labelled men. "Lowest voices" = men with median F0
  < 105 Hz.
- "Noisy" and "clean-ish", and coverage, are defined as above.
- Every comparison is candidate vs baseline through the same frozen
  evaluator on identical streams. "Baseline" means the values in the tables
  above.

### PRIMARY — all required

- **P1 Sex gap in noise.** Women's minus men's noisy coverage
  ≤ max(3.0 pp, ½ × baseline 9.94 pp) = **4.97 pp**.
- **P2a The reported lowest voices.** The two speakers under 105 Hz of the
  gate doc's 16-speaker set (94 and 100 Hz): mean noisy coverage
  ≥ 58.56 % + 15.0 pp = **73.56 %**.
- **P2b All lowest voices.** Women's minus < 105 Hz men's (six speakers)
  noisy coverage ≤ max(3.0, ½ × 10.04) = **5.02 pp**.
- **P3 Men's settle in noise.** The median settle time over men's noisy
  streams is not worse: **≤ 0.675 s**.
- **H1 Held-out sex gap.** Women's minus men's noisy coverage on `chandev`
  ≤ max(3.0, ½ × 4.96) = **3.00 pp**.
- **H2 Held-out lowest voices.** Women's minus < 105 Hz men's (five
  speakers) noisy coverage on `chandev` ≤ max(3.0, ½ × 4.41) = **3.00 pp**.

### GUARDS — each must hold

- **G1 No condition loses coverage.** In each of the 12 conditions, women's
  and men's coverage ≥ baseline − 0.5 pp, on both sets (H3 on `chandev`).
- **G2 Clean speech.** Clean-ish coverage per sex is not lower (≥ baseline,
  at 0.05 pp resolution) on both sets. PVQD speech-portion coverage per sex
  is not lower.
- **G3 Noise.** All of these must hold:
  - Noise-only time with a number ≤ 22.26 + 1.0 = 23.26 %.
  - Noise-only time with any non-blank state ≤ 25.41 + 1.0 = 26.41 %.
  - Real-noise lead before speech with a number ≤ baseline + 1.0 pp on both
    sets (H4 on `chandev`).
  - The meter's display on hops ≥ 0.3 s from any reference voicing
    (Praat AC / CC / session-label R1) on the private session recordings
    ≤ baseline + 1.0 pp, per speaker label and overall (private).
- **G4 Held phonation.**
  - Number on screen during holds ≤ baseline + 1.0 pp for VOICED, VocalSet
    ≤ 400 Hz and PVQD vowels ≤ 400 Hz, each sex, and for all holds
    > 400 Hz pooled.
  - "Needs running speech" from 1.25 s into ≤ 400 Hz holds ≥ baseline
    − 1.0 pp per set and sex.
- **G5 False "needs running speech" on speech.**
  - F0-flattened speech (LibriSpeech mono and mono 1.5×, PVQD mono)
    ≤ baseline + 1.0 pp per sex.
  - Natural speech (LibriSpeech orig / 1.5× / 2×, PVQD orig / 1.5×, PVQD
    speech portions) ≤ baseline + 0.5 pp per sex.
- **G6 Onset quality.** Per sex, clean-ish and noisy:
  - The median time to the first number ≤ baseline + 0.15 s.
  - The first value in the wrong range ≤ baseline + 5 pp.
  - The median settle ≤ baseline + 0.15 s. For men in noise, P3 applies
    instead.
- **G7 Speaker change.** After 1.5, 2.5 and 4 s pauses, the median first
  value after the pause is in the new speaker's range (woman → man ≤ 30,
  man → woman ≥ 70). The median lag to 90 % ≤ baseline + 0.15 s.
- **G8 If the pitch chain changes** (any file under `src/dsp` or
  `src/audio`, or the pitch worker's posted message):
  - **a.** `noise-augment-oracle.js pitch --frontend=tracker`, every noise
    class × SNR (20 / 10 / 5 dB):
    - Tail false voicing ≤ baseline + 0.5 pp.
    - Correct ≥ baseline − 0.5 pp.
    - Octave-down and octave-up each ≤ baseline + 0.5 pp.
  - **b.** `scripts/session-oracle/corpus.mjs` on FDA, PTDB-TUG, Hillenbrand
    and vocadito, at the posted and the displayed (painted) stage, for
    references < 400 Hz:
    - Correct ≥ baseline − 0.3 pp per corpus × sex (vocadito pooled).
    - Octave-down and octave-up each ≤ baseline + 0.3 pp.
    - max(F_err, M_err) per corpus ≤ baseline + 0.3 pp.
    - Vocadito references ≥ 400 Hz: octave-down ≤ baseline + 0.3 pp.
  - **c.** Session oracle (private). Consensus and strict references, both
    speakers, posted / painted / readout:
    - 160–400 and 75–160 Hz: correct ≥ baseline − 0.3 pp.
    - 160–400, 75–160 and ≥ 400 Hz: half and octave-up each ≤ baseline
      + 0.3 pp.
  - **d.** `session_fv.py` (private): posted and painted false voicing
    ≤ baseline + 0.3 pp per speaker label and overall.
  - **e.** `npm run test:dsp` passes, with the corpora present.
- **G9 Every candidate.** `npm run lint`, `npm run test:unit` and
  `npm run build` pass.

### Procedure

- **R1 Frozen evaluator.** The following are fixed by SHA-256 before the
  first candidate is evaluated:
  - the metric code, replay, rule checker, and the baseline runs and
    results;
  - the oracle harnesses: `scripts/perceived-voice-gate/analyze.py` and
    `common.py`, `scripts/session-oracle/`, `noise-augment-oracle.js`,
    `noise-synth.js` and the corpus loader.

  The oracle harnesses must be unchanged in the candidate commit.
- **R2 Real code, harness parity.** Each candidate is measured through its
  own pitch worker, gender worker, utterance gate and view. Harness
  extensions are limited to recording or forwarding new hint fields. Any
  extension must reproduce the baseline replay on the baseline tree with 0
  differing streams, on every set.
- **R3 Validity.** The replay assumes no inference is skipped. A candidate
  that adds work to a worker shows, in a desktop production build, that
  gender inference plus the added work stays under the 150 ms hop at p95.
  Otherwise its figures are invalid.
- **R4 Reporting.**
  - Every candidate and every parameter variant is a separate entry,
    reported with the full criterion table, failures included.
  - No threshold, set or definition changes after the first candidate
    result.
- **R5 Decision.**
  - Ship only if every criterion passes.
  - Any fail means the candidate is not shippable under this rule. The
    user may still decide, as with the accepted 2026-10-04 guard misses,
    but the recorded verdict stays FAIL.
- **R6 Shipping.** The shipping branch commits the public-data part of the
  evaluator under `scripts/low-voice-noise/` and adds its results here:
  public numbers only, with private guards as one aggregate sentence.

**Checks on the evaluator before registration.**

- The baseline run against itself, including the noise-oracle inputs,
  passes every guard. It fails only the five primary criteria that require
  a gain (P1, P2a, P2b, H1, H2), as it should. P3 passes because it only
  forbids a regression.
- Re-deriving one diagnosis lever (C1) through the checker, after the rule
  was fixed, reproduces that lever's coverage and noise deltas.
- The session-meter replay reproduces its stored baseline byte for byte.

### Changes from the brief (tightenings only)

The brief's rule was: men's noisy coverage within 3 pp of women's or the gap
halved; lowest voices +15 pp; men's settle not worse; and the guards on
women's per-condition coverage, clean coverage, noise-only and non-blank
budgets of +1 pp, held phonation +1 pp, flat-speech note +1 pp, and the
pitch-chain guards. It was made precise and tightened as follows:

1. **Evaluation set: the 38-speaker set.** It has 19 women and 18 men
   rather than 8 and 8. Within men, F0 does not predict coverage, and the
   gate doc's low-voice figures are specific to speakers and noise clips.
2. **P2a is defined on the two voices the problem was reported for.** For
   the six speakers under 105 Hz of the 38-speaker set, +15 pp would mean
   94.9 % in noise. That is above their own clean-ish coverage (92.8 %), so
   it cannot be met. **P2b** was added because one stream can carry P2a on
   its own: the 100 Hz voice at real 0 dB goes from 0 % to 90 %.
3. **The held-out H1–H4 were added.** Every lever above was sized on the
   38-speaker streams, so a fix has to generalise to speakers and noise
   draws it was not tuned on.
4. **G1 applies to men too**, for symmetry, and to the held-out set. **G2
   adds** the PVQD speech portions.
5. **G3 adds the real-noise leads and the private-session meter display.**
   The latter covers real-room non-speech that the noise clips lack. The
   2026-10-04 low-register pass found it to be the binding constraint for
   pitch voicing changes.
6. **G4 adds holds above 400 Hz** (above-range levers score sung notes) and
   the "needs running speech" rate. **G5 adds natural speech** at +0.5 pp.
7. **G6 onset quality** protects what the utterance gate was built to fix.
   Onset levers move it: C3 raised women's noisy settle from 0.69 to 1.14 s.
8. **G7** protects the documented ≥ 1 s speaker-change reset, which a
   longer close weakens.
9. **G8 now covers all SNRs, octave classes, posted and displayed stages,
   Hillenbrand, vocadito and the ≥ 400 Hz band.** The above-range levers
   act exactly where the Hillenbrand-men vowel-onset locks and sung notes
   live. **G9** applies CI to every candidate.

**What the rule implies.** With a noise-only budget of +1 pp, none of the
levers sized above passes. Pitch-evidence levers trade about 1 : 1 with
noise-only display. The only one inside the budget, absub2 onset-only,
closes 1.7 of the 9.9 pp gap. A passing fix has to add discrimination
between voice and noise, not more periodicity evidence. One example is a
voice detector that gates the meter, possibly combined with a pitch front
end that is robust to low-frequency noise.

## Reproduce

- **Sets.** `python scripts/perceived-voice-gate/prep.py chan` builds the
  16-speaker set and, in `jobs_chan.full.json`, the 38-speaker set. `prep.py
  chandev` builds the held-out set from the resonance lab's `r1_dev`
  manifest. The 38-speaker streams were built before these scripts were
  committed, so a rebuild can move those figures by a few tenths (see the
  scripts' README). The held-out streams were built by `prep.py chandev`
  as committed here. The rule is evaluated on the frozen streams.
- **Pipeline.** For each set:
  1. Run the real chain over it, as `chain.mjs` does, plus the per-frame
     stage dump.
  2. Replay the code under test: its own `utterance-gate.js` and
     `perceivedVoiceView.js`, fed the hints its `gender-worker.js` sends.
     Settle and speaker change use classifier logits for every tick, from
     `score.py <set> 0/1 all`; these depend on the audio only.
  3. Compute the metrics with `analyze.py <variant> noise held adv dyn`
     (committed) plus the 38-speaker and held-out coverage and onset
     metrics defined above.
- **Pitch guards.** `noise-augment-oracle.js` and
  `session-oracle/corpus.mjs`, run on both trees.
- **Private guards.** `session-oracle/run.mjs` + `analyze.py`, and
  `lowband-attr.mjs` + `session_fv.py`, run with `SYRINX_SESSIONS_DIR`.

R6 commits the attribution chain, the frozen metric code and the rule
checker with the shipping candidate.

## Candidate "pitch-absub" (2026-10-07) — VERDICT: FAIL (both variants)

Branch `lowvoice-pitch-absub` (variant **absub**, commit 3d9da7e) and
branch `lowvoice-pitch-absub-c4` (variant **absub_c4**, commit 3b64654 =
3d9da7e + the 100 ms onset). This is a pitch-chain candidate
(`KIND=pitch`), and this file is its hard-rule-3 measurement file.

### What it changes

- A new module, `src/dsp/above-range-sub.js`, is called by
  `pitch-worker.js` where an above-400 Hz decode used to be posted as null.
  This is the diagnosis lever "absub2". When the tracker's decode d is above
  the display range and the decoded frame shows **at least 2 partials of d/k
  that are not multiples of d**, **d/k is posted voiced**. The search uses:
  - k = 2…10, with d/k in 75–400 Hz;
  - harmonics 1…12, up to 1 kHz;
  - the harmonic guard's 10 dB peak-vs-band-median rule for each partial;
  - the k with the most such partials wins, the smaller k on a tie.

  A rescued frame skips the harmonic guard and leaves its streak untouched,
  as every above-range frame did before. (Above-range frames that advanced
  the streak cost PTDB men 0.8 pp in 2026-10-03.)
- **One addition to the diagnosis algorithm.** A qualifying partial must
  also reach **−40 dB of the frame's strongest bin below 1 kHz**.
  - Without it (variant **v0**, the diagnosis algorithm exactly), a clean
    synthetic 520 Hz tone is posted at 520/6 = 86.6 Hz on every frame. Hann
    sidelobe leakage between its harmonics passes the median-ratio test.
  - With v0, `tests/dsp/pitch-worker-above-range-test.js` fails 3 of 7
    checks (G9), so v0 was not evaluated further.
  - On the 18 lowest-voice clean / pink 0 / real 0 streams, the floor
    removes none of the rescues the diagnosis counted (189 of 189 kept).
- **absub_c4** also sets the utterance gate's `onsetRunMs` from 150 to
  100 ms.

### How it was measured

- Both variants ran the frozen `prereg/run_candidate.sh` step by step, with
  `K=absub` or `K=absub_c4` and `KIND=pitch`.
- **One deviation.** `replay_lvn.mjs` looks up the hint construction by
  variant name. It has no entry for these keys, so it exits with "unknown
  hint variant". The replay was therefore run with `--hint=base` added. That
  is the base hint construction (posted pitch → voiced), which is exactly
  what the unchanged `gender-worker.js` sends. Nothing else changed.
- **Parity checks:**
  - With the 852b5cc gate and view, the session-meter copies reproduce the
    stored baseline byte for byte.
  - The absub and absub_c4 pitch-chain runs are byte-identical (same
    `src/dsp` and `src/audio`).
  - The evaluator SHA-256 and harness checks passed.
- **Tests, on both branches:**
  - `npm run lint`, `npm run test:unit` (23/23) and `npm run build` pass
    (G9).
  - `npm run test:dsp` passes on both trees (G8e).
  - The main checkout's `node_modules` lacks `@babel/core` and `.bin`, so
    lint and build ran against a complete `npm ci` of the same lockfile.

### Primary results (public)

| criterion | rule | base | absub | absub_c4 |
|---|---|---|---|---|
| P1 noisy gap women − men (pp) | ≤ 4.97 | 9.94 | 6.33 FAIL | **2.81** pass |
| P2a the 94 / 100 Hz voices, noisy (%) | ≥ 73.56 | 58.56 | 70.07 FAIL | **79.75** pass |
| P2b noisy gap women − men < 105 Hz (pp) | ≤ 5.02 | 10.04 | 6.58 FAIL | **3.12** pass |
| P3 men's median settle in noise (s) | ≤ 0.675 | 0.675 | 0.665 pass | 0.550 pass |
| H1 held-out noisy gap (pp) | ≤ 3.00 | 4.96 | 5.10 FAIL | 2.70 pass |
| H2 held-out gap < 105 Hz (pp) | ≤ 3.00 | 4.41 | 7.06 FAIL | 3.46 FAIL |

Noisy coverage on the 38-speaker set, by `attr_lvn.py` group:

| | women | men 115–147 Hz | men < 110 Hz |
|---|---|---|---|
| base | 89.9 % | 80.0 % | 79.9 % |
| absub | 90.3 % | 84.1 % | 83.7 % |
| absub_c4 | 91.9 % | 89.2 % | 88.8 % |

These match the diagnosis sizes: absub +0.4 / +4.1 / +3.8 pp and C4
+2.0 / +9.2 / +8.9 pp.

### Failed guards (public)

| guard | rule | base | absub | absub_c4 |
|---|---|---|---|---|
| G3 noise-only time with a number (%) | ≤ 23.26 | 22.26 | 29.03 | 34.40 |
| G3 noise-only time, any non-blank state (%) | ≤ 26.41 | 25.41 | 32.14 | 38.13 |
| G3 real-noise lead with a number (%) | ≤ 13.18 | 12.18 | 14.51 | 19.23 |
| H4 held-out real-noise lead (%) | ≤ 17.06 | 16.06 | 17.12 | 20.45 |
| G4 holds > 400 Hz with a number (%) | ≤ 6.62 | 5.62 | **28.60** | **45.11** |
| G4 VocalSet women ≤ 400 Hz with a number (%) | ≤ 3.55 | 2.55 | 3.57 | 3.57 |
| G4 VocalSet men ≤ 400 Hz with a number (%) | ≤ 7.05 | 6.05 | 6.87 pass | 7.18 |
| G1 women, 1.0 s reverb (%) | ≥ 82.80 | 83.30 | 81.78 | 81.97 |
| H3 held-out women, 1.0 s reverb (%) | ≥ 77.19 | 77.69 | 76.74 | 77.06 |
| G8b painted FDA women correct (%) | ≥ 86.89 | 87.19 | 86.89 (−0.307) | same |

- **G8a** (`noise-augment-oracle.js`, FDA): all 87 class × SNR criteria are
  identical to the baseline (0.0 pp change), so all pass.
- **G8b:** every other criterion passes (table below).
- **Private guards.** On the private session recordings, both variants fail
  the session-oracle and session false-voicing guards (G8c, G8d), and
  absub_c4 also fails the meter's display-away-from-voicing guard (G3).
  Results on the private session recordings are kept outside this
  repository.

| | public criteria failed | full rule failed | PRIMARY | VERDICT |
|---|---|---|---|---|
| absub | 13 | 33 of 363 | FAIL | FAIL |
| absub_c4 | 10 | 33 of 363 | FAIL | FAIL |

### Why it fails

- **Sung and held tones above 400 Hz.** This is the aliasing the 400 Hz
  null exists to stop.
  - 10.3 % of all VocalSet frames are newly posted at a sub-multiple
    (median 86 Hz, mostly k = 6). Almost all of them are on the women's
    long tones at 509–558 Hz.
  - The meter shows a number on 28.6 % of held time above 400 Hz (45.1 %
    with the 100 ms onset). The sub-multiple pitch jumps between k values,
    so the held-note rule no longer sees a steady note.
  - At the posted stage, vocadito references ≥ 400 Hz go from 99.0 % null
    to 62.8 % null. Those frames are posted at d/k, which the corpus report
    counts neither as correct nor as octave-down, so G8b's ≥ 400 Hz guard
    does not see them.
- **Noise.** 5.1 % of noise-only frames are rescued (median 94 Hz).
  Noise-only display rises +6.8 pp (absub) and +12.1 pp (C4), as the
  diagnosis predicted (+6.9 / +12.2). The 1 : 1 trade of evidence against
  noise display holds.
- **Wrong values on women.** Choosing the k with the most off-multiple
  partials favours large k, because large k gives noise more slots to fill.
  On Praat-voiced frames of the 38-speaker set at real 0 dB, the share of
  rescued frames within ±3 st of Praat is:
  - men < 110 Hz: 73 %;
  - men 115–147 Hz: 62 %;
  - women: 22 % (41 % an octave low, 37 % other).

  This is a plausible cause of the women's 1.0 s reverb loss.

### Variants tried (all of them)

| variant | change | evaluated | outcome |
|---|---|---|---|
| v0 | diagnosis algorithm exactly | unit test only | G9 FAIL (clean 520 Hz tone posted at 86.6 Hz) |
| **absub** | v0 + −40 dB floor | full rule | FAIL (13 public / 33 total) |
| **absub_c4** | absub + onset 100 ms | full rule | FAIL (10 public / 33 total; P1, P2a, P2b, P3, H1 pass) |
| vA (probe) | floor −20 dB instead of −40 dB | exploration subsets | VocalSet tones > 400 Hz: 3.1 % of frames still rescued (median 80 Hz). Women's rescued frames at real 0 dB: 24 % correct. Noise: 3.9 % of frames rescued |
| vB (probe) | absub + partials k−1 and k+1 must both pass | exploration subsets | Worse. VocalSet tones > 400 Hz: 16.7 % rescued. Low men's rescued frames: 42 % correct |

The probes ran the real chain on subsets and were scored against Praat:

- VocalSet tones above 400 Hz;
- the 38-speaker men's clean, pink 0, real 0 and real 10 streams;
- the women's clean, pink 0 and real 0 streams;
- half of the noise set.

They are exploration, not candidates. They were not run through the rule
because neither removes the sub-multiple aliasing of held tones.

### R3 (validity)

- The added step runs on the pitch worker, not the gender worker, and only
  on above-range decodes.
- It was timed in headless Chrome on the production build: puppeteer-core,
  a temporary profile closed by PID, and a fake mic playing LibriSpeech 1089
  at real 0 dB.
  - Per call: 0.8–0.9 ms median, 1.1–1.5 ms p95.
  - Pitch-worker chunk p95 stays at 2–5.5 ms, against the 25 ms cadence.
- Gender inference p95 in the same runs was 118–175 ms for the candidate
  and 134–364 ms for the baseline. Other jobs loaded the machine heavily, so
  the 150 ms budget could not be shown cleanly for either tree.
- The added work is about 1 % of that budget, and it runs on another
  thread.

### Full public criterion tables

`check_rule.py` output, public part (`verdict_public.txt`). **absub:**

```text
   section                                                  criterion    base    cand  delta                            rule  pass
P/G 38-spk                              P1 noisy gap women - men (pp)   9.939   6.333 -3.606  <= max(3.0, 0.5 x 9.94) = 4.97 False
P/G 38-spk              P2b noisy gap women - men < 105 Hz (n=6) (pp)  10.042   6.581 -3.461 <= max(3.0, 0.5 x 10.04) = 5.02 False
P/G 38-spk             P2a noisy coverage, the 94 / 100 Hz voices (%)  58.560  70.071 11.511                  >= base + 15.0 False
P/G 38-spk                                G1 coverage women clean (%)  93.014  93.014  0.000                   >= base - 0.5  True
P/G 38-spk                                  G1 coverage men clean (%)  92.322  92.771  0.449                   >= base - 0.5  True
P/G 38-spk                              G1 coverage women quiet20 (%)  92.739  92.739  0.000                   >= base - 0.5  True
P/G 38-spk                                G1 coverage men quiet20 (%)  92.022  92.626  0.604                   >= base - 0.5  True
P/G 38-spk                               G1 coverage women laptop (%)  93.577  93.577  0.000                   >= base - 0.5  True
P/G 38-spk                                 G1 coverage men laptop (%)  91.909  92.069  0.160                   >= base - 0.5  True
P/G 38-spk                                G1 coverage women phone (%)  93.459  93.459  0.000                   >= base - 0.5  True
P/G 38-spk                                  G1 coverage men phone (%)  89.942  91.265  1.323                   >= base - 0.5  True
P/G 38-spk                             G1 coverage women reverb05 (%)  87.219  87.329  0.110                   >= base - 0.5  True
P/G 38-spk                               G1 coverage men reverb05 (%)  92.009  92.222  0.213                   >= base - 0.5  True
P/G 38-spk                             G1 coverage women reverb10 (%)  83.304  81.777 -1.527                   >= base - 0.5 False
P/G 38-spk                               G1 coverage men reverb10 (%)  89.251  90.320  1.069                   >= base - 0.5  True
P/G 38-spk                               G1 coverage women pink10 (%)  92.713  92.713  0.000                   >= base - 0.5  True
P/G 38-spk                                 G1 coverage men pink10 (%)  91.437  91.708  0.271                   >= base - 0.5  True
P/G 38-spk                                G1 coverage women pink0 (%)  91.724  91.891  0.168                   >= base - 0.5  True
P/G 38-spk                                  G1 coverage men pink0 (%)  76.050  76.953  0.903                   >= base - 0.5  True
P/G 38-spk                               G1 coverage women real10 (%)  93.370  93.370  0.000                   >= base - 0.5  True
P/G 38-spk                                 G1 coverage men real10 (%)  92.687  93.345  0.658                   >= base - 0.5  True
P/G 38-spk                                G1 coverage women real0 (%)  84.593  85.554  0.961                   >= base - 0.5  True
P/G 38-spk                                  G1 coverage men real0 (%)  71.133  81.519 10.386                   >= base - 0.5  True
P/G 38-spk                             G1 coverage women babble10 (%)  99.931  99.931  0.000                   >= base - 0.5  True
P/G 38-spk                               G1 coverage men babble10 (%) 100.000 100.000  0.000                   >= base - 0.5  True
P/G 38-spk                              G1 coverage women babble0 (%) 100.000 100.000  0.000                   >= base - 0.5  True
P/G 38-spk                                G1 coverage men babble0 (%) 100.000 100.000  0.000                   >= base - 0.5  True
P/G 38-spk                            G2 clean-ish coverage women (%)  92.002  92.024  0.022       >= base (0.05 resolution)  True
P/G 38-spk                              G2 clean-ish coverage men (%)  91.641  92.191  0.550       >= base (0.05 resolution)  True
P/G 38-spk         G3 real-noise lead before speech with a number (%)  12.179  14.506  2.326                   <= base + 1.0 False
H held-out                              H1 noisy gap women - men (pp)   4.960   5.103  0.143  <= max(3.0, 0.5 x 4.96) = 3.00 False
H held-out               H2 noisy gap women - men < 105 Hz (n=5) (pp)   4.407   7.062  2.655  <= max(3.0, 0.5 x 4.41) = 3.00 False
H held-out                                H3 coverage women clean (%)  91.362  91.661  0.299                   >= base - 0.5  True
H held-out                                  H3 coverage men clean (%)  93.743  93.743  0.000                   >= base - 0.5  True
H held-out                              H3 coverage women quiet20 (%)  86.248  86.354  0.106                   >= base - 0.5  True
H held-out                                H3 coverage men quiet20 (%)  93.506  93.506  0.000                   >= base - 0.5  True
H held-out                               H3 coverage women laptop (%)  90.859  90.965  0.106                   >= base - 0.5  True
H held-out                                 H3 coverage men laptop (%)  93.386  93.461  0.075                   >= base - 0.5  True
H held-out                                H3 coverage women phone (%)  91.123  91.915  0.792                   >= base - 0.5  True
H held-out                                  H3 coverage men phone (%)  91.557  92.763  1.206                   >= base - 0.5  True
H held-out                             H3 coverage women reverb05 (%)  84.238  84.608  0.370                   >= base - 0.5  True
H held-out                               H3 coverage men reverb05 (%)  92.154  92.480  0.326                   >= base - 0.5  True
H held-out                             H3 coverage women reverb10 (%)  77.690  76.737 -0.953                   >= base - 0.5 False
H held-out                               H3 coverage men reverb10 (%)  90.415  91.785  1.370                   >= base - 0.5  True
H held-out                               H3 coverage women pink10 (%)  90.808  91.002  0.194                   >= base - 0.5  True
H held-out                                 H3 coverage men pink10 (%)  91.810  92.907  1.098                   >= base - 0.5  True
H held-out                                H3 coverage women pink0 (%)  86.344  88.011  1.667                   >= base - 0.5  True
H held-out                                  H3 coverage men pink0 (%)  83.375  84.421  1.046                   >= base - 0.5  True
H held-out                               H3 coverage women real10 (%)  94.292  95.951  1.660                   >= base - 0.5  True
H held-out                                 H3 coverage men real10 (%)  92.456  93.407  0.950                   >= base - 0.5  True
H held-out                                H3 coverage women real0 (%)  82.879  87.518  4.639                   >= base - 0.5  True
H held-out                                  H3 coverage men real0 (%)  72.804  78.343  5.540                   >= base - 0.5  True
H held-out                             H3 coverage women babble10 (%) 100.000 100.000  0.000                   >= base - 0.5  True
H held-out                               H3 coverage men babble10 (%) 100.000 100.000  0.000                   >= base - 0.5  True
H held-out                              H3 coverage women babble0 (%) 100.000 100.000  0.000                   >= base - 0.5  True
H held-out                                H3 coverage men babble0 (%) 100.000 100.000  0.000                   >= base - 0.5  True
H held-out                            H3 clean-ish coverage women (%)  88.766  89.101  0.334       >= base (0.05 resolution)  True
H held-out                              H3 clean-ish coverage men (%)  92.869  93.191  0.321       >= base (0.05 resolution)  True
H held-out         H4 real-noise lead before speech with a number (%)  16.056  17.122  1.066                   <= base + 1.0 False
P/G 38-spk                        P3 men's median settle in noise (s)   0.675   0.665 -0.010                         <= base  True
  G6 onset                         G6 median settle men clean-ish (s)   0.545   0.525 -0.020                  <= base + 0.15  True
  G6 onset                   G6 median first number men clean-ish (s)   0.525   0.485 -0.040                  <= base + 0.15  True
  G6 onset        G6 first value in the wrong range men clean-ish (%)   0.000   0.000  0.000                   <= base + 5.0  True
  G6 onset                       G6 median settle women clean-ish (s)   0.755   0.755  0.000                  <= base + 0.15  True
  G6 onset                 G6 median first number women clean-ish (s)   0.485   0.485  0.000                  <= base + 0.15  True
  G6 onset      G6 first value in the wrong range women clean-ish (%)   4.211   4.211  0.000                   <= base + 5.0  True
  G6 onset                       G6 median first number men noisy (s)   0.550   0.535 -0.015                  <= base + 0.15  True
  G6 onset            G6 first value in the wrong range men noisy (%)   3.846   3.846  0.000                   <= base + 5.0  True
  G6 onset                           G6 median settle women noisy (s)   0.695   0.705  0.010                  <= base + 0.15  True
  G6 onset                     G6 median first number women noisy (s)   0.545   0.545  0.000                  <= base + 0.15  True
  G6 onset          G6 first value in the wrong range women noisy (%)   5.263   5.263  0.000                   <= base + 5.0  True
  G3 noise                         G3 noise-only time with number (%)  22.256  29.027  6.772                   <= base + 1.0 False
  G3 noise            G3 noise-only time with any non-blank state (%)  25.412  32.143  6.731                   <= base + 1.0 False
   G4 held     G4 held pvqd f: 'needs running speech' from 1.25 s (%)  96.666  96.666  0.000                   >= base - 1.0  True
   G4 held     G4 held pvqd m: 'needs running speech' from 1.25 s (%)  96.689  96.689  0.000                   >= base - 1.0  True
   G4 held G4 held vocalset f: 'needs running speech' from 1.25 s (%)  99.129  99.129  0.000                   >= base - 1.0  True
   G4 held G4 held vocalset m: 'needs running speech' from 1.25 s (%) 100.000 100.000  0.000                   >= base - 1.0  True
   G4 held   G4 held voiced f: 'needs running speech' from 1.25 s (%)  95.278  95.278  0.000                   >= base - 1.0  True
   G4 held   G4 held voiced m: 'needs running speech' from 1.25 s (%) 100.000 100.000  0.000                   >= base - 1.0  True
   G4 held                               G4 held all >400: number (%)   5.617  28.602 22.984                   <= base + 1.0 False
   G4 held                                 G4 held pvqd f: number (%)   9.402   9.567  0.165                   <= base + 1.0  True
   G4 held                                 G4 held pvqd m: number (%)  11.906  12.339  0.433                   <= base + 1.0  True
   G4 held                             G4 held vocalset f: number (%)   2.554   3.573  1.019                   <= base + 1.0 False
   G4 held                             G4 held vocalset m: number (%)   6.046   6.866  0.821                   <= base + 1.0  True
   G4 held                               G4 held voiced f: number (%)   3.903   3.903  0.000                   <= base + 1.0  True
   G4 held                               G4 held voiced m: number (%)   3.055   3.055  0.000                   <= base + 1.0  True
   G5 note                  G5 PVQD speech portions f: false note (%)   0.110   0.126  0.016                   <= base + 0.5  True
   G5 note                  G5 PVQD speech portions m: false note (%)   0.250   0.250  0.000                   <= base + 0.5  True
  G2 clean                      G2 PVQD speech portions f: number (%)  92.558  92.889  0.330       >= base (0.05 resolution)  True
  G2 clean                      G2 PVQD speech portions m: number (%)  88.078  88.780  0.702       >= base (0.05 resolution)  True
   G5 note         G5 ls mono f: 'needs running speech' on speech (%)   7.190   7.639  0.449                   <= base + 1.0  True
   G5 note         G5 ls mono m: 'needs running speech' on speech (%)   3.328   3.328  0.000                   <= base + 1.0  True
   G5 note  G5 ls mono_slow15 f: 'needs running speech' on speech (%)   8.001   8.648  0.647                   <= base + 1.0  True
   G5 note  G5 ls mono_slow15 m: 'needs running speech' on speech (%)   3.872   4.019  0.147                   <= base + 1.0  True
   G5 note         G5 ls orig f: 'needs running speech' on speech (%)   0.000   0.000  0.000                   <= base + 0.5  True
   G5 note         G5 ls orig m: 'needs running speech' on speech (%)   0.000   0.000  0.000                   <= base + 0.5  True
   G5 note       G5 ls slow15 f: 'needs running speech' on speech (%)   0.422   0.422  0.000                   <= base + 0.5  True
   G5 note       G5 ls slow15 m: 'needs running speech' on speech (%)   0.000   0.000  0.000                   <= base + 0.5  True
   G5 note       G5 ls slow20 f: 'needs running speech' on speech (%)   2.009   2.009  0.000                   <= base + 0.5  True
   G5 note       G5 ls slow20 m: 'needs running speech' on speech (%)   0.385   0.385  0.000                   <= base + 0.5  True
   G5 note         G5 pv mono f: 'needs running speech' on speech (%)   7.950   8.265  0.315                   <= base + 1.0  True
   G5 note         G5 pv mono m: 'needs running speech' on speech (%)   6.812   6.812  0.000                   <= base + 1.0  True
   G5 note         G5 pv orig f: 'needs running speech' on speech (%)   0.193   0.193  0.000                   <= base + 0.5  True
   G5 note         G5 pv orig m: 'needs running speech' on speech (%)   0.123   0.123  0.000                   <= base + 0.5  True
   G5 note       G5 pv slow15 f: 'needs running speech' on speech (%)   1.637   1.887  0.250                   <= base + 0.5  True
   G5 note       G5 pv slow15 m: 'needs running speech' on speech (%)   1.293   1.293  0.000                   <= base + 0.5  True
 G7 change           G7 first value after a 1.5 s pause, f2m (median)   0.610   0.610  0.000                           <= 30  True
 G7 change                G7 lag to 90 % after a 1.5 s pause, f2m (s)   0.900   0.900  0.000                  <= base + 0.15  True
 G7 change           G7 first value after a 1.5 s pause, m2f (median)  90.540  90.540  0.000                           >= 70  True
 G7 change                G7 lag to 90 % after a 1.5 s pause, m2f (s)   0.975   0.975  0.000                  <= base + 0.15  True
 G7 change           G7 first value after a 2.5 s pause, f2m (median)   0.990   0.990  0.000                           <= 30  True
 G7 change                G7 lag to 90 % after a 2.5 s pause, f2m (s)   0.950   0.950  0.000                  <= base + 0.15  True
 G7 change           G7 first value after a 2.5 s pause, m2f (median)  88.040  88.040  0.000                           >= 70  True
 G7 change                G7 lag to 90 % after a 2.5 s pause, m2f (s)   1.025   1.025  0.000                  <= base + 0.15  True
 G7 change           G7 first value after a 4.0 s pause, f2m (median)   0.995   0.995  0.000                           <= 30  True
 G7 change                G7 lag to 90 % after a 4.0 s pause, f2m (s)   0.950   0.950  0.000                  <= base + 0.15  True
 G7 change           G7 first value after a 4.0 s pause, m2f (median)  87.795  87.795  0.000                           >= 70  True
 G7 change                G7 lag to 90 % after a 4.0 s pause, m2f (s)   1.175   1.175  0.000                  <= base + 0.15  True

118 criteria evaluated, 13 FAIL; missing inputs: 0
PRIMARY: FAIL
VERDICT: FAIL```

**absub_c4:**

```text
   section                                                  criterion    base    cand  delta                            rule  pass
P/G 38-spk                              P1 noisy gap women - men (pp)   9.939   2.814 -7.124  <= max(3.0, 0.5 x 9.94) = 4.97  True
P/G 38-spk              P2b noisy gap women - men < 105 Hz (n=6) (pp)  10.042   3.116 -6.926 <= max(3.0, 0.5 x 10.04) = 5.02  True
P/G 38-spk             P2a noisy coverage, the 94 / 100 Hz voices (%)  58.560  79.750 21.190                  >= base + 15.0  True
P/G 38-spk                                G1 coverage women clean (%)  93.014  93.763  0.749                   >= base - 0.5  True
P/G 38-spk                                  G1 coverage men clean (%)  92.322  93.656  1.334                   >= base - 0.5  True
P/G 38-spk                              G1 coverage women quiet20 (%)  92.739  93.237  0.498                   >= base - 0.5  True
P/G 38-spk                                G1 coverage men quiet20 (%)  92.022  93.363  1.341                   >= base - 0.5  True
P/G 38-spk                               G1 coverage women laptop (%)  93.577  93.978  0.401                   >= base - 0.5  True
P/G 38-spk                                 G1 coverage men laptop (%)  91.909  92.581  0.672                   >= base - 0.5  True
P/G 38-spk                                G1 coverage women phone (%)  93.459  93.721  0.262                   >= base - 0.5  True
P/G 38-spk                                  G1 coverage men phone (%)  89.942  92.843  2.901                   >= base - 0.5  True
P/G 38-spk                             G1 coverage women reverb05 (%)  87.219  87.766  0.547                   >= base - 0.5  True
P/G 38-spk                               G1 coverage men reverb05 (%)  92.009  93.052  1.043                   >= base - 0.5  True
P/G 38-spk                             G1 coverage women reverb10 (%)  83.304  81.966 -1.338                   >= base - 0.5 False
P/G 38-spk                               G1 coverage men reverb10 (%)  89.251  90.905  1.653                   >= base - 0.5  True
P/G 38-spk                               G1 coverage women pink10 (%)  92.713  93.093  0.380                   >= base - 0.5  True
P/G 38-spk                                 G1 coverage men pink10 (%)  91.437  92.666  1.229                   >= base - 0.5  True
P/G 38-spk                                G1 coverage women pink0 (%)  91.724  92.639  0.915                   >= base - 0.5  True
P/G 38-spk                                  G1 coverage men pink0 (%)  76.050  85.316  9.265                   >= base - 0.5  True
P/G 38-spk                               G1 coverage women real10 (%)  93.370  94.707  1.338                   >= base - 0.5  True
P/G 38-spk                                 G1 coverage men real10 (%)  92.687  93.782  1.095                   >= base - 0.5  True
P/G 38-spk                                G1 coverage women real0 (%)  84.593  88.380  3.787                   >= base - 0.5  True
P/G 38-spk                                  G1 coverage men real0 (%)  71.133  88.185 17.052                   >= base - 0.5  True
P/G 38-spk                             G1 coverage women babble10 (%)  99.931  99.931  0.000                   >= base - 0.5  True
P/G 38-spk                               G1 coverage men babble10 (%) 100.000 100.000  0.000                   >= base - 0.5  True
P/G 38-spk                              G1 coverage women babble0 (%) 100.000 100.000  0.000                   >= base - 0.5  True
P/G 38-spk                                G1 coverage men babble0 (%) 100.000 100.000  0.000                   >= base - 0.5  True
P/G 38-spk                            G2 clean-ish coverage women (%)  92.002  92.493  0.492       >= base (0.05 resolution)  True
P/G 38-spk                              G2 clean-ish coverage men (%)  91.641  93.099  1.458       >= base (0.05 resolution)  True
P/G 38-spk         G3 real-noise lead before speech with a number (%)  12.179  19.227  7.048                   <= base + 1.0 False
H held-out                              H1 noisy gap women - men (pp)   4.960   2.704 -2.255  <= max(3.0, 0.5 x 4.96) = 3.00  True
H held-out               H2 noisy gap women - men < 105 Hz (n=5) (pp)   4.407   3.455 -0.952  <= max(3.0, 0.5 x 4.41) = 3.00 False
H held-out                                H3 coverage women clean (%)  91.362  91.936  0.574                   >= base - 0.5  True
H held-out                                  H3 coverage men clean (%)  93.743  93.898  0.155                   >= base - 0.5  True
H held-out                              H3 coverage women quiet20 (%)  86.248  86.822  0.574                   >= base - 0.5  True
H held-out                                H3 coverage men quiet20 (%)  93.506  93.906  0.400                   >= base - 0.5  True
H held-out                               H3 coverage women laptop (%)  90.859  91.745  0.886                   >= base - 0.5  True
H held-out                                 H3 coverage men laptop (%)  93.386  93.822  0.436                   >= base - 0.5  True
H held-out                                H3 coverage women phone (%)  91.123  92.130  1.007                   >= base - 0.5  True
H held-out                                  H3 coverage men phone (%)  91.557  93.349  1.792                   >= base - 0.5  True
H held-out                             H3 coverage women reverb05 (%)  84.238  84.608  0.370                   >= base - 0.5  True
H held-out                               H3 coverage men reverb05 (%)  92.154  92.706  0.551                   >= base - 0.5  True
H held-out                             H3 coverage women reverb10 (%)  77.690  77.064 -0.625                   >= base - 0.5 False
H held-out                               H3 coverage men reverb10 (%)  90.415  92.045  1.630                   >= base - 0.5  True
H held-out                               H3 coverage women pink10 (%)  90.808  91.648  0.840                   >= base - 0.5  True
H held-out                                 H3 coverage men pink10 (%)  91.810  93.065  1.255                   >= base - 0.5  True
H held-out                                H3 coverage women pink0 (%)  86.344  89.030  2.686                   >= base - 0.5  True
H held-out                                  H3 coverage men pink0 (%)  83.375  87.947  4.571                   >= base - 0.5  True
H held-out                               H3 coverage women real10 (%)  94.292  96.837  2.545                   >= base - 0.5  True
H held-out                                 H3 coverage men real10 (%)  92.456  94.193  1.737                   >= base - 0.5  True
H held-out                                H3 coverage women real0 (%)  82.879  89.989  7.110                   >= base - 0.5  True
H held-out                                  H3 coverage men real0 (%)  72.804  85.603 12.799                   >= base - 0.5  True
H held-out                             H3 coverage women babble10 (%) 100.000 100.000  0.000                   >= base - 0.5  True
H held-out                               H3 coverage men babble10 (%) 100.000 100.000  0.000                   >= base - 0.5  True
H held-out                              H3 coverage women babble0 (%) 100.000 100.000  0.000                   >= base - 0.5  True
H held-out                                H3 coverage men babble0 (%) 100.000 100.000  0.000                   >= base - 0.5  True
H held-out                            H3 clean-ish coverage women (%)  88.766  89.448  0.682       >= base (0.05 resolution)  True
H held-out                              H3 clean-ish coverage men (%)  92.869  93.536  0.667       >= base (0.05 resolution)  True
H held-out         H4 real-noise lead before speech with a number (%)  16.056  20.453  4.397                   <= base + 1.0 False
P/G 38-spk                        P3 men's median settle in noise (s)   0.675   0.550 -0.125                         <= base  True
  G6 onset                         G6 median settle men clean-ish (s)   0.545   0.480 -0.065                  <= base + 0.15  True
  G6 onset                   G6 median first number men clean-ish (s)   0.525   0.475 -0.050                  <= base + 0.15  True
  G6 onset        G6 first value in the wrong range men clean-ish (%)   0.000   0.000  0.000                   <= base + 5.0  True
  G6 onset                       G6 median settle women clean-ish (s)   0.755   0.695 -0.060                  <= base + 0.15  True
  G6 onset                 G6 median first number women clean-ish (s)   0.485   0.475 -0.010                  <= base + 0.15  True
  G6 onset      G6 first value in the wrong range women clean-ish (%)   4.211   4.211  0.000                   <= base + 5.0  True
  G6 onset                       G6 median first number men noisy (s)   0.550   0.515 -0.035                  <= base + 0.15  True
  G6 onset            G6 first value in the wrong range men noisy (%)   3.846   3.704 -0.142                   <= base + 5.0  True
  G6 onset                           G6 median settle women noisy (s)   0.695   0.685 -0.010                  <= base + 0.15  True
  G6 onset                     G6 median first number women noisy (s)   0.545   0.485 -0.060                  <= base + 0.15  True
  G6 onset          G6 first value in the wrong range women noisy (%)   5.263   8.772  3.509                   <= base + 5.0  True
  G3 noise                         G3 noise-only time with number (%)  22.256  34.398 12.142                   <= base + 1.0 False
  G3 noise            G3 noise-only time with any non-blank state (%)  25.412  38.132 12.720                   <= base + 1.0 False
   G4 held     G4 held pvqd f: 'needs running speech' from 1.25 s (%)  96.666  96.666  0.000                   >= base - 1.0  True
   G4 held     G4 held pvqd m: 'needs running speech' from 1.25 s (%)  96.689  96.689  0.000                   >= base - 1.0  True
   G4 held G4 held vocalset f: 'needs running speech' from 1.25 s (%)  99.129  99.129  0.000                   >= base - 1.0  True
   G4 held G4 held vocalset m: 'needs running speech' from 1.25 s (%) 100.000 100.000  0.000                   >= base - 1.0  True
   G4 held   G4 held voiced f: 'needs running speech' from 1.25 s (%)  95.278  95.278  0.000                   >= base - 1.0  True
   G4 held   G4 held voiced m: 'needs running speech' from 1.25 s (%) 100.000 100.000  0.000                   >= base - 1.0  True
   G4 held                               G4 held all >400: number (%)   5.617  45.110 39.492                   <= base + 1.0 False
   G4 held                                 G4 held pvqd f: number (%)   9.402   9.567  0.165                   <= base + 1.0  True
   G4 held                                 G4 held pvqd m: number (%)  11.906  12.586  0.680                   <= base + 1.0  True
   G4 held                             G4 held vocalset f: number (%)   2.554   3.573  1.019                   <= base + 1.0 False
   G4 held                             G4 held vocalset m: number (%)   6.046   7.182  1.136                   <= base + 1.0 False
   G4 held                               G4 held voiced f: number (%)   3.903   3.903  0.000                   <= base + 1.0  True
   G4 held                               G4 held voiced m: number (%)   3.055   3.055  0.000                   <= base + 1.0  True
   G5 note                  G5 PVQD speech portions f: false note (%)   0.110   0.126  0.016                   <= base + 0.5  True
   G5 note                  G5 PVQD speech portions m: false note (%)   0.250   0.250  0.000                   <= base + 0.5  True
  G2 clean                      G2 PVQD speech portions f: number (%)  92.558  93.252  0.694       >= base (0.05 resolution)  True
  G2 clean                      G2 PVQD speech portions m: number (%)  88.078  89.592  1.514       >= base (0.05 resolution)  True
   G5 note         G5 ls mono f: 'needs running speech' on speech (%)   7.190   7.639  0.449                   <= base + 1.0  True
   G5 note         G5 ls mono m: 'needs running speech' on speech (%)   3.328   3.328  0.000                   <= base + 1.0  True
   G5 note  G5 ls mono_slow15 f: 'needs running speech' on speech (%)   8.001   8.648  0.647                   <= base + 1.0  True
   G5 note  G5 ls mono_slow15 m: 'needs running speech' on speech (%)   3.872   4.019  0.147                   <= base + 1.0  True
   G5 note         G5 ls orig f: 'needs running speech' on speech (%)   0.000   0.000  0.000                   <= base + 0.5  True
   G5 note         G5 ls orig m: 'needs running speech' on speech (%)   0.000   0.000  0.000                   <= base + 0.5  True
   G5 note       G5 ls slow15 f: 'needs running speech' on speech (%)   0.422   0.422  0.000                   <= base + 0.5  True
   G5 note       G5 ls slow15 m: 'needs running speech' on speech (%)   0.000   0.000  0.000                   <= base + 0.5  True
   G5 note       G5 ls slow20 f: 'needs running speech' on speech (%)   2.009   2.009  0.000                   <= base + 0.5  True
   G5 note       G5 ls slow20 m: 'needs running speech' on speech (%)   0.385   0.385  0.000                   <= base + 0.5  True
   G5 note         G5 pv mono f: 'needs running speech' on speech (%)   7.950   8.265  0.315                   <= base + 1.0  True
   G5 note         G5 pv mono m: 'needs running speech' on speech (%)   6.812   6.812  0.000                   <= base + 1.0  True
   G5 note         G5 pv orig f: 'needs running speech' on speech (%)   0.193   0.193  0.000                   <= base + 0.5  True
   G5 note         G5 pv orig m: 'needs running speech' on speech (%)   0.123   0.123  0.000                   <= base + 0.5  True
   G5 note       G5 pv slow15 f: 'needs running speech' on speech (%)   1.637   1.887  0.250                   <= base + 0.5  True
   G5 note       G5 pv slow15 m: 'needs running speech' on speech (%)   1.293   1.293  0.000                   <= base + 0.5  True
 G7 change           G7 first value after a 1.5 s pause, f2m (median)   0.610   0.610  0.000                           <= 30  True
 G7 change                G7 lag to 90 % after a 1.5 s pause, f2m (s)   0.900   0.900  0.000                  <= base + 0.15  True
 G7 change           G7 first value after a 1.5 s pause, m2f (median)  90.540  90.540  0.000                           >= 70  True
 G7 change                G7 lag to 90 % after a 1.5 s pause, m2f (s)   0.975   0.975  0.000                  <= base + 0.15  True
 G7 change           G7 first value after a 2.5 s pause, f2m (median)   0.990   0.990  0.000                           <= 30  True
 G7 change                G7 lag to 90 % after a 2.5 s pause, f2m (s)   0.950   0.950  0.000                  <= base + 0.15  True
 G7 change           G7 first value after a 2.5 s pause, m2f (median)  88.040  88.040  0.000                           >= 70  True
 G7 change                G7 lag to 90 % after a 2.5 s pause, m2f (s)   1.025   1.025  0.000                  <= base + 0.15  True
 G7 change           G7 first value after a 4.0 s pause, f2m (median)   0.995   0.995  0.000                           <= 30  True
 G7 change                G7 lag to 90 % after a 4.0 s pause, f2m (s)   0.950   0.950  0.000                  <= base + 0.15  True
 G7 change           G7 first value after a 4.0 s pause, m2f (median)  87.795  87.795  0.000                           >= 70  True
 G7 change                G7 lag to 90 % after a 4.0 s pause, m2f (s)   1.175   1.175  0.000                  <= base + 0.15  True

118 criteria evaluated, 10 FAIL; missing inputs: 0
PRIMARY: FAIL
VERDICT: FAIL```

G8b (public corpora; identical for both variants, same pitch chain):

```text
   section                                                  criterion    base    cand  delta                            rule  pass
       G8b corpora                        G8b post|fda_m|all<400: correct (%)  85.727  85.813  0.087                   >= base - 0.3  True
       G8b corpora                    G8b post|fda_m|all<400: octave down (%)   0.043   0.087  0.043                   <= base + 0.3  True
       G8b corpora                      G8b post|fda_m|all<400: octave up (%)   0.216   0.216  0.000                   <= base + 0.3  True
       G8b corpora                        G8b post|fda_f|all<400: correct (%)  87.614  87.652  0.038                   >= base - 0.3  True
       G8b corpora                    G8b post|fda_f|all<400: octave down (%)   0.644   0.795  0.152                   <= base + 0.3  True
       G8b corpora                      G8b post|fda_f|all<400: octave up (%)   0.265   0.265  0.000                   <= base + 0.3  True
       G8b corpora                       G8b post|ptdb_m|all<400: correct (%)  84.294  84.380  0.086                   >= base - 0.3  True
       G8b corpora                   G8b post|ptdb_m|all<400: octave down (%)   0.150   0.150  0.000                   <= base + 0.3  True
       G8b corpora                     G8b post|ptdb_m|all<400: octave up (%)   0.150   0.193  0.043                   <= base + 0.3  True
       G8b corpora                       G8b post|ptdb_f|all<400: correct (%)  95.023  95.023  0.000                   >= base - 0.3  True
       G8b corpora                   G8b post|ptdb_f|all<400: octave down (%)   0.880   0.923  0.043                   <= base + 0.3  True
       G8b corpora                     G8b post|ptdb_f|all<400: octave up (%)   0.236   0.236  0.000                   <= base + 0.3  True
       G8b corpora                        G8b post|hil_m|all<400: correct (%)  60.437  60.839  0.401                   >= base - 0.3  True
       G8b corpora                    G8b post|hil_m|all<400: octave down (%)   0.013   0.078  0.065                   <= base + 0.3  True
       G8b corpora                      G8b post|hil_m|all<400: octave up (%)   0.298   0.298  0.000                   <= base + 0.3  True
       G8b corpora                        G8b post|hil_f|all<400: correct (%)  61.550  61.561  0.010                   >= base - 0.3  True
       G8b corpora                    G8b post|hil_f|all<400: octave down (%)   0.499   0.655  0.156                   <= base + 0.3  True
       G8b corpora                      G8b post|hil_f|all<400: octave up (%)   0.052   0.052  0.000                   <= base + 0.3  True
       G8b corpora                          G8b post|voc|all<400: correct (%)  98.307  98.307  0.000                   >= base - 0.3  True
       G8b corpora                      G8b post|voc|all<400: octave down (%)   0.926   0.935  0.009                   <= base + 0.3  True
       G8b corpora                        G8b post|voc|all<400: octave up (%)   0.009   0.014  0.005                   <= base + 0.3  True
       G8b corpora                       G8b post fda: max(F_err, M_err) (pp)  14.273  14.187 -0.087                   <= base + 0.3  True
       G8b corpora                      G8b post ptdb: max(F_err, M_err) (pp)  15.706  15.620 -0.086                   <= base + 0.3  True
       G8b corpora                       G8b post hil: max(F_err, M_err) (pp)  39.563  39.161 -0.401                   <= base + 0.3  True
       G8b corpora                        G8b post|voc|>=400: octave down (%)   0.000   0.000  0.000                   <= base + 0.3  True
       G8b corpora                       G8b paint|fda_m|all<400: correct (%)  83.290  83.464  0.174                   >= base - 0.3  True
       G8b corpora                   G8b paint|fda_m|all<400: octave down (%)   0.000   0.000  0.000                   <= base + 0.3  True
       G8b corpora                     G8b paint|fda_m|all<400: octave up (%)   0.087   0.087  0.000                   <= base + 0.3  True
       G8b corpora                       G8b paint|fda_f|all<400: correct (%)  87.193  86.887 -0.307                   >= base - 0.3 False
       G8b corpora                   G8b paint|fda_f|all<400: octave down (%)   0.153   0.192  0.038                   <= base + 0.3  True
       G8b corpora                     G8b paint|fda_f|all<400: octave up (%)   0.307   0.268 -0.038                   <= base + 0.3  True
       G8b corpora                      G8b paint|ptdb_m|all<400: correct (%)  80.928  80.971  0.043                   >= base - 0.3  True
       G8b corpora                  G8b paint|ptdb_m|all<400: octave down (%)   0.128   0.128  0.000                   <= base + 0.3  True
       G8b corpora                    G8b paint|ptdb_m|all<400: octave up (%)   0.150   0.150  0.000                   <= base + 0.3  True
       G8b corpora                      G8b paint|ptdb_f|all<400: correct (%)  92.301  92.280 -0.021                   >= base - 0.3  True
       G8b corpora                  G8b paint|ptdb_f|all<400: octave down (%)   0.150   0.150  0.000                   <= base + 0.3  True
       G8b corpora                    G8b paint|ptdb_f|all<400: octave up (%)   0.214   0.214  0.000                   <= base + 0.3  True
       G8b corpora                       G8b paint|hil_m|all<400: correct (%)  63.584  64.519  0.935                   >= base - 0.3  True
       G8b corpora                   G8b paint|hil_m|all<400: octave down (%)   0.000   0.015  0.015                   <= base + 0.3  True
       G8b corpora                     G8b paint|hil_m|all<400: octave up (%)   0.163   0.148 -0.015                   <= base + 0.3  True
       G8b corpora                       G8b paint|hil_f|all<400: correct (%)  64.411  64.637  0.226                   >= base - 0.3  True
       G8b corpora                   G8b paint|hil_f|all<400: octave down (%)   0.079   0.124  0.045                   <= base + 0.3  True
       G8b corpora                     G8b paint|hil_f|all<400: octave up (%)   0.034   0.034  0.000                   <= base + 0.3  True
       G8b corpora                         G8b paint|voc|all<400: correct (%)  97.339  97.217 -0.122                   >= base - 0.3  True
       G8b corpora                     G8b paint|voc|all<400: octave down (%)   0.459   0.459  0.000                   <= base + 0.3  True
       G8b corpora                       G8b paint|voc|all<400: octave up (%)   0.000   0.000  0.000                   <= base + 0.3  True
       G8b corpora                      G8b paint fda: max(F_err, M_err) (pp)  16.710  16.536 -0.174                   <= base + 0.3  True
       G8b corpora                     G8b paint ptdb: max(F_err, M_err) (pp)  19.072  19.029 -0.043                   <= base + 0.3  True
       G8b corpora                      G8b paint hil: max(F_err, M_err) (pp)  36.416  35.481 -0.935                   <= base + 0.3  True
       G8b corpora                       G8b paint|voc|>=400: octave down (%)   0.478   0.478  0.000                   <= base + 0.3  True
```
