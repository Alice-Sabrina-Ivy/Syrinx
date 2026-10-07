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
