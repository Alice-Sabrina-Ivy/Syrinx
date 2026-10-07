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

---

## Candidate meter-c1 (2026-10-07) — VERDICT: FAIL

**Branch `lowvoice-meter-c1`, commit ec3ab6d** (code; this section is a later
commit on the same branch). Variant **meter-c2** = the same code plus a 2 s
utterance close: **branch `lowvoice-meter-c2`, commit 0ba28af**. Both are
measured with the frozen evaluator above, as required; both fail.

### What it changes

The C1 lever from the diagnosis, implemented in the real workers:

- **Utterance gate** (`src/ml/utterance-gate.js`): the onset run drops from
  150 to 100 ms. A new **weak** hint keeps an *already open* utterance alive
  (it refreshes the gap and recency clocks and counts as voiced in the
  window's voiced share). It never opens one: it breaks a voiced run like any
  unvoiced hint, and it counts as unvoiced in the held-phonation test. It is
  never posted as a pitch and never painted.
- **Pitch worker** (`src/dsp/pitch-worker.js` + new
  `src/dsp/subharmonic-evidence.js`): when the tracker decodes above
  400 Hz, one extra 4096-point FFT on the decoded frame's buffer counts, for
  each sub-multiple f = d/k (k = 2–10, 75 ≤ f ≤ 400 Hz), the partials h·f ≤
  1000 Hz (h ≤ 12) that clear the band median by 10 dB (the harmonic guard's
  rule) and are not multiples of d. If the best count is ≥ 2 the frame is
  posted (still unvoiced, pitch null) with `subharmonic: true`. The hook
  relays it to the ML worker as `weak`; `gender-worker.js` hands it to the
  gate. `boersma-ac.js` only exports its FFT.
- Every posted pitch, confidence, painted value and readout is unchanged.
  The candidate's chain runs reproduce the baseline runs' posted pitch,
  contextTime, DSP gate, paint and every stage-dump column on every
  public set (0 differing streams); the flag matches the diagnosis's
  `absub2` definition frame for frame (chanx: 3 340 of 3 340 flagged frames,
  noise: 5 432 of 5 432).
- **Known limitation** (in the module and its test): a clean harmonic
  note above 400 Hz is often flagged too, because Hann sidelobes of its
  strong partials clear the 10 dB floor at sub-multiple partials within
  ~60 Hz of them. Flags never open an utterance, so such a note can only
  keep one open.

### Variants tried (all of them)

| variant | onset run | weak hysteresis | close (gapMs) | verdict |
|---|---|---|---|---|
| meter-c1 | 100 ms | `subharmonic` frames | 1 s | FAIL (8 public criteria; 12 with the private guards) |
| meter-c2 | 100 ms | `subharmonic` frames | 2 s | FAIL (12 public criteria; 16 with the private guards) |

No other parameter was changed or tried. meter-c2 shares meter-c1's pitch
worker and hook (`git diff ec3ab6d 0ba28af -- src/dsp src/audio` is empty),
so its replays use meter-c1's chain runs and its G8 inputs are meter-c1's.

### How it was measured

`run_candidate.sh` with K=meter-c1, REV=ec3ab6d, KIND=pitch, step by step:

- Freeze checks pass (evaluator SHA-256, oracle harnesses unchanged).
- The pitch worker posts a new field, so two harness copies record it and
  nothing else: `chain-attr-meter-c1.mjs` (adds a `sub` column to the
  stage dump) and, for the private session-meter check, a copy of
  `lowband-attr.mjs` with a `sub` column. Parity: the chain-attr copy on the
  base tree reproduces every column of the base chanx runs (456 of 456
  streams, 0 flagged frames); the lowband-attr copy reproduces every column
  of the frozen harness's dumps on the same tree.
- The replay copy `replay_meter-c1.mjs` changes only the hint construction
  (voiced = posted pitch, weak = posted `subharmonic`, pitch = posted pitch).
  Parity on the base tree: 0 differing streams on all ten sets
  (`parity_lvn.py` exit 0). The session-meter copy reproduces the stored
  baseline byte for byte.
- Replays report 0 missing logits.
- G9: `npm run lint`, `npm run test:unit` (24/24, incl. the new
  `tests/dsp/subharmonic-evidence-test.js` and the extended
  `tests/ml/utterance-gate-test.js`) and `npm run build` pass. The main
  checkout's `node_modules` was incomplete (no `.bin`, no `@babel/core`), so
  these ran against a clean `npm ci` of the branch's lockfile in scratch.
- G8e: `npm run test:dsp` passes in the candidate tree, with the corpora.

### Results

Noisy coverage (pink 0 dB + real 10 dB + real 0 dB), % of speaking time:

| set | | women | men 115–147 Hz | men < 105 Hz | all men | gap |
|---|---|---|---|---|---|---|
| 38-speaker | baseline | 89.90 | 80.01 | 79.85 | 79.96 | 9.94 |
| | meter-c1 | 91.91 | 87.68 | 85.33 | 86.90 | 5.01 |
| | meter-c2 | 92.33 | 88.77 | 87.28 | 88.27 | 4.06 |
| held-out `chandev` | baseline | 87.84 | 82.67 | 83.43 | 82.88 | 4.96 |
| | meter-c1 | 91.56 | 88.98 | 87.60 | 88.59 | 2.96 |
| | meter-c2 | 92.00 | 89.82 | 88.55 | 89.46 | 2.54 |

Utterance onset success in noise (a number within 1 s of each ≥ 1 s burst),
all men: 86.1 → 92.6 % (both variants); women 96.5 → 98.2 %.

The diagnosis predicted C1 at women +2.0, all men +6.9 pp, gap 5.0 pp and
noise-only +8.4 pp; the real workers give +2.0, +6.9, 5.01 pp and +8.5 pp.

**Full public criterion table** (every criterion the frozen checker
evaluates without private inputs; baseline = voice-direction 852b5cc):

| criterion | rule | baseline | meter-c1 | | meter-c2 | |
|---|---|---|---|---|---|---|
| P1 noisy gap women - men (pp) | <= max(3.0, 0.5 x 9.94) = 4.97 | 9.94 | 5.01 | **FAIL** | 4.06 | pass |
| P2b noisy gap women - men < 105 Hz (n=6) (pp) | <= max(3.0, 0.5 x 10.04) = 5.02 | 10.04 | 6.58 | **FAIL** | 5.05 | **FAIL** |
| P2a noisy coverage, the 94 / 100 Hz voices (%) | >= base + 15.0 | 58.56 | 69.36 | **FAIL** | 74.21 | pass |
| G1 coverage women clean (%) | >= base - 0.5 | 93.01 | 93.76 | pass | 93.76 | pass |
| G1 coverage men clean (%) | >= base - 0.5 | 92.32 | 93.07 | pass | 93.48 | pass |
| G1 coverage women quiet20 (%) | >= base - 0.5 | 92.74 | 93.24 | pass | 93.24 | pass |
| G1 coverage men quiet20 (%) | >= base - 0.5 | 92.02 | 93.07 | pass | 93.28 | pass |
| G1 coverage women laptop (%) | >= base - 0.5 | 93.58 | 93.98 | pass | 93.98 | pass |
| G1 coverage men laptop (%) | >= base - 0.5 | 91.91 | 92.58 | pass | 92.94 | pass |
| G1 coverage women phone (%) | >= base - 0.5 | 93.46 | 93.72 | pass | 93.72 | pass |
| G1 coverage men phone (%) | >= base - 0.5 | 89.94 | 92.25 | pass | 92.61 | pass |
| G1 coverage women reverb05 (%) | >= base - 0.5 | 87.22 | 87.34 | pass | 87.34 | pass |
| G1 coverage men reverb05 (%) | >= base - 0.5 | 92.01 | 92.75 | pass | 92.95 | pass |
| G1 coverage women reverb10 (%) | >= base - 0.5 | 83.30 | 83.49 | pass | 83.49 | pass |
| G1 coverage men reverb10 (%) | >= base - 0.5 | 89.25 | 90.24 | pass | 90.44 | pass |
| G1 coverage women pink10 (%) | >= base - 0.5 | 92.71 | 93.09 | pass | 93.09 | pass |
| G1 coverage men pink10 (%) | >= base - 0.5 | 91.44 | 92.67 | pass | 93.00 | pass |
| G1 coverage women pink0 (%) | >= base - 0.5 | 91.72 | 92.64 | pass | 92.81 | pass |
| G1 coverage men pink0 (%) | >= base - 0.5 | 76.05 | 84.46 | pass | 86.72 | pass |
| G1 coverage women real10 (%) | >= base - 0.5 | 93.37 | 94.71 | pass | 94.96 | pass |
| G1 coverage men real10 (%) | >= base - 0.5 | 92.69 | 94.02 | pass | 94.51 | pass |
| G1 coverage women real0 (%) | >= base - 0.5 | 84.59 | 88.38 | pass | 89.23 | pass |
| G1 coverage men real0 (%) | >= base - 0.5 | 71.13 | 82.22 | pass | 83.58 | pass |
| G1 coverage women babble10 (%) | >= base - 0.5 | 99.93 | 99.93 | pass | 99.93 | pass |
| G1 coverage men babble10 (%) | >= base - 0.5 | 100.00 | 100.00 | pass | 100.00 | pass |
| G1 coverage women babble0 (%) | >= base - 0.5 | 100.00 | 100.00 | pass | 100.00 | pass |
| G1 coverage men babble0 (%) | >= base - 0.5 | 100.00 | 100.00 | pass | 100.00 | pass |
| G2 clean-ish coverage women (%) | >= base (0.05 resolution) | 92.00 | 92.41 | pass | 92.41 | pass |
| G2 clean-ish coverage men (%) | >= base (0.05 resolution) | 91.64 | 92.75 | pass | 93.05 | pass |
| G3 real-noise lead before speech with a number (%) | <= base + 1.0 | 12.18 | 15.39 | **FAIL** | 15.39 | **FAIL** |
| H1 noisy gap women - men (pp) | <= max(3.0, 0.5 x 4.96) = 3.00 | 4.96 | 2.96 | pass | 2.54 | pass |
| H2 noisy gap women - men < 105 Hz (n=5) (pp) | <= max(3.0, 0.5 x 4.41) = 3.00 | 4.41 | 3.96 | **FAIL** | 3.45 | **FAIL** |
| H3 coverage women clean (%) | >= base - 0.5 | 91.36 | 91.94 | pass | 92.02 | pass |
| H3 coverage men clean (%) | >= base - 0.5 | 93.74 | 93.82 | pass | 94.07 | pass |
| H3 coverage women quiet20 (%) | >= base - 0.5 | 86.25 | 86.82 | pass | 86.91 | pass |
| H3 coverage men quiet20 (%) | >= base - 0.5 | 93.51 | 93.91 | pass | 94.16 | pass |
| H3 coverage women laptop (%) | >= base - 0.5 | 90.86 | 91.75 | pass | 91.83 | pass |
| H3 coverage men laptop (%) | >= base - 0.5 | 93.39 | 93.82 | pass | 93.95 | pass |
| H3 coverage women phone (%) | >= base - 0.5 | 91.12 | 91.64 | pass | 91.80 | pass |
| H3 coverage men phone (%) | >= base - 0.5 | 91.56 | 93.35 | pass | 93.47 | pass |
| H3 coverage women reverb05 (%) | >= base - 0.5 | 84.24 | 84.45 | pass | 84.50 | pass |
| H3 coverage men reverb05 (%) | >= base - 0.5 | 92.15 | 92.55 | pass | 92.55 | pass |
| H3 coverage women reverb10 (%) | >= base - 0.5 | 77.69 | 78.12 | pass | 78.21 | pass |
| H3 coverage men reverb10 (%) | >= base - 0.5 | 90.42 | 91.97 | pass | 92.22 | pass |
| H3 coverage women pink10 (%) | >= base - 0.5 | 90.81 | 91.65 | pass | 91.84 | pass |
| H3 coverage men pink10 (%) | >= base - 0.5 | 91.81 | 93.06 | pass | 93.19 | pass |
| H3 coverage women pink0 (%) | >= base - 0.5 | 86.34 | 89.03 | pass | 89.63 | pass |
| H3 coverage men pink0 (%) | >= base - 0.5 | 83.38 | 87.21 | pass | 87.90 | pass |
| H3 coverage women real10 (%) | >= base - 0.5 | 94.29 | 96.46 | pass | 96.46 | pass |
| H3 coverage men real10 (%) | >= base - 0.5 | 92.46 | 94.19 | pass | 94.52 | pass |
| H3 coverage women real0 (%) | >= base - 0.5 | 82.88 | 89.18 | pass | 89.91 | pass |
| H3 coverage men real0 (%) | >= base - 0.5 | 72.80 | 84.38 | pass | 85.97 | pass |
| H3 coverage women babble10 (%) | >= base - 0.5 | 100.00 | 100.00 | pass | 100.00 | pass |
| H3 coverage men babble10 (%) | >= base - 0.5 | 100.00 | 100.00 | pass | 100.00 | pass |
| H3 coverage women babble0 (%) | >= base - 0.5 | 100.00 | 100.00 | pass | 100.00 | pass |
| H3 coverage men babble0 (%) | >= base - 0.5 | 100.00 | 100.00 | pass | 100.00 | pass |
| H3 clean-ish coverage women (%) | >= base (0.05 resolution) | 88.77 | 89.32 | pass | 89.41 | pass |
| H3 clean-ish coverage men (%) | >= base (0.05 resolution) | 92.87 | 93.49 | pass | 93.64 | pass |
| H4 real-noise lead before speech with a number (%) | <= base + 1.0 | 16.06 | 18.59 | **FAIL** | 18.59 | **FAIL** |
| P3 men's median settle in noise (s) | <= base | 0.68 | 0.57 | pass | 0.57 | pass |
| G6 median settle men clean-ish (s) | <= base + 0.15 | 0.55 | 0.48 | pass | 0.48 | pass |
| G6 median first number men clean-ish (s) | <= base + 0.15 | 0.53 | 0.48 | pass | 0.48 | pass |
| G6 first value in the wrong range men clean-ish (%) | <= base + 5.0 | 0.00 | 0.00 | pass | 0.00 | pass |
| G6 median settle women clean-ish (s) | <= base + 0.15 | 0.76 | 0.69 | pass | 0.64 | pass |
| G6 median first number women clean-ish (s) | <= base + 0.15 | 0.48 | 0.47 | pass | 0.47 | pass |
| G6 first value in the wrong range women clean-ish (%) | <= base + 5.0 | 4.21 | 4.21 | pass | 4.21 | pass |
| G6 median first number men noisy (s) | <= base + 0.15 | 0.55 | 0.53 | pass | 0.53 | pass |
| G6 first value in the wrong range men noisy (%) | <= base + 5.0 | 3.85 | 3.77 | pass | 3.77 | pass |
| G6 median settle women noisy (s) | <= base + 0.15 | 0.69 | 0.69 | pass | 0.69 | pass |
| G6 median first number women noisy (s) | <= base + 0.15 | 0.55 | 0.48 | pass | 0.47 | pass |
| G6 first value in the wrong range women noisy (%) | <= base + 5.0 | 5.26 | 8.77 | pass | 17.54 | **FAIL** |
| G3 noise-only time with number (%) | <= base + 1.0 | 22.26 | 30.75 | **FAIL** | 32.19 | **FAIL** |
| G3 noise-only time with any non-blank state (%) | <= base + 1.0 | 25.41 | 34.35 | **FAIL** | 35.22 | **FAIL** |
| G4 held pvqd f: 'needs running speech' from 1.25 s (%) | >= base - 1.0 | 96.67 | 96.67 | pass | 96.67 | pass |
| G4 held pvqd m: 'needs running speech' from 1.25 s (%) | >= base - 1.0 | 96.69 | 96.69 | pass | 96.69 | pass |
| G4 held vocalset f: 'needs running speech' from 1.25 s (%) | >= base - 1.0 | 99.13 | 99.13 | pass | 99.13 | pass |
| G4 held vocalset m: 'needs running speech' from 1.25 s (%) | >= base - 1.0 | 100.00 | 100.00 | pass | 100.00 | pass |
| G4 held voiced f: 'needs running speech' from 1.25 s (%) | >= base - 1.0 | 95.28 | 95.28 | pass | 95.28 | pass |
| G4 held voiced m: 'needs running speech' from 1.25 s (%) | >= base - 1.0 | 100.00 | 100.00 | pass | 100.00 | pass |
| G4 held all >400: number (%) | <= base + 1.0 | 5.62 | 5.62 | pass | 5.62 | pass |
| G4 held pvqd f: number (%) | <= base + 1.0 | 9.40 | 9.43 | pass | 11.42 | **FAIL** |
| G4 held pvqd m: number (%) | <= base + 1.0 | 11.91 | 12.54 | pass | 13.44 | **FAIL** |
| G4 held vocalset f: number (%) | <= base + 1.0 | 2.55 | 2.55 | pass | 2.55 | pass |
| G4 held vocalset m: number (%) | <= base + 1.0 | 6.05 | 6.05 | pass | 6.05 | pass |
| G4 held voiced f: number (%) | <= base + 1.0 | 3.90 | 3.90 | pass | 3.90 | pass |
| G4 held voiced m: number (%) | <= base + 1.0 | 3.06 | 3.06 | pass | 3.06 | pass |
| G5 PVQD speech portions f: false note (%) | <= base + 0.5 | 0.11 | 0.11 | pass | 0.11 | pass |
| G5 PVQD speech portions m: false note (%) | <= base + 0.5 | 0.25 | 0.25 | pass | 0.25 | pass |
| G2 PVQD speech portions f: number (%) | >= base (0.05 resolution) | 92.56 | 93.26 | pass | 94.52 | pass |
| G2 PVQD speech portions m: number (%) | >= base (0.05 resolution) | 88.08 | 89.29 | pass | 91.18 | pass |
| G5 ls mono f: 'needs running speech' on speech (%) | <= base + 1.0 | 7.19 | 7.19 | pass | 7.19 | pass |
| G5 ls mono m: 'needs running speech' on speech (%) | <= base + 1.0 | 3.33 | 3.33 | pass | 3.33 | pass |
| G5 ls mono_slow15 f: 'needs running speech' on speech (%) | <= base + 1.0 | 8.00 | 8.00 | pass | 8.00 | pass |
| G5 ls mono_slow15 m: 'needs running speech' on speech (%) | <= base + 1.0 | 3.87 | 3.87 | pass | 3.87 | pass |
| G5 ls orig f: 'needs running speech' on speech (%) | <= base + 0.5 | 0.00 | 0.00 | pass | 0.00 | pass |
| G5 ls orig m: 'needs running speech' on speech (%) | <= base + 0.5 | 0.00 | 0.00 | pass | 0.00 | pass |
| G5 ls slow15 f: 'needs running speech' on speech (%) | <= base + 0.5 | 0.42 | 0.42 | pass | 0.42 | pass |
| G5 ls slow15 m: 'needs running speech' on speech (%) | <= base + 0.5 | 0.00 | 0.00 | pass | 0.00 | pass |
| G5 ls slow20 f: 'needs running speech' on speech (%) | <= base + 0.5 | 2.01 | 2.01 | pass | 2.01 | pass |
| G5 ls slow20 m: 'needs running speech' on speech (%) | <= base + 0.5 | 0.39 | 0.39 | pass | 0.39 | pass |
| G5 pv mono f: 'needs running speech' on speech (%) | <= base + 1.0 | 7.95 | 7.95 | pass | 7.95 | pass |
| G5 pv mono m: 'needs running speech' on speech (%) | <= base + 1.0 | 6.81 | 6.81 | pass | 6.81 | pass |
| G5 pv orig f: 'needs running speech' on speech (%) | <= base + 0.5 | 0.19 | 0.19 | pass | 0.19 | pass |
| G5 pv orig m: 'needs running speech' on speech (%) | <= base + 0.5 | 0.12 | 0.12 | pass | 0.12 | pass |
| G5 pv slow15 f: 'needs running speech' on speech (%) | <= base + 0.5 | 1.64 | 1.64 | pass | 1.64 | pass |
| G5 pv slow15 m: 'needs running speech' on speech (%) | <= base + 0.5 | 1.29 | 1.29 | pass | 1.29 | pass |
| G7 first value after a 1.5 s pause, f2m (median) | <= 30 | 0.61 | 0.61 | pass | 2.44 | pass |
| G7 lag to 90 % after a 1.5 s pause, f2m (s) | <= base + 0.15 | 0.90 | 0.90 | pass | 1.43 | **FAIL** |
| G7 first value after a 1.5 s pause, m2f (median) | >= 70 | 90.54 | 90.54 | pass | 55.35 | **FAIL** |
| G7 lag to 90 % after a 1.5 s pause, m2f (s) | <= base + 0.15 | 0.97 | 0.97 | pass | 1.50 | **FAIL** |
| G7 first value after a 2.5 s pause, f2m (median) | <= 30 | 0.99 | 0.99 | pass | 0.99 | pass |
| G7 lag to 90 % after a 2.5 s pause, f2m (s) | <= base + 0.15 | 0.95 | 0.95 | pass | 0.95 | pass |
| G7 first value after a 2.5 s pause, m2f (median) | >= 70 | 88.04 | 88.04 | pass | 88.04 | pass |
| G7 lag to 90 % after a 2.5 s pause, m2f (s) | <= base + 0.15 | 1.02 | 1.02 | pass | 1.02 | pass |
| G7 first value after a 4.0 s pause, f2m (median) | <= 30 | 0.99 | 0.99 | pass | 0.99 | pass |
| G7 lag to 90 % after a 4.0 s pause, f2m (s) | <= base + 0.15 | 0.95 | 0.95 | pass | 0.95 | pass |
| G7 first value after a 4.0 s pause, m2f (median) | >= 70 | 87.80 | 87.80 | pass | 87.80 | pass |
| G7 lag to 90 % after a 4.0 s pause, m2f (s) | <= base + 0.15 | 1.18 | 1.18 | pass | 1.18 | pass |

**G8 pitch-chain guards.** G8a (noise-augment oracle, every class × 20 / 10 /
5 dB) and G8b (FDA, PTDB-TUG, Hillenbrand, vocadito through
`session-oracle/corpus.mjs`, posted and painted): all 137 criteria pass with
a delta of exactly 0, as expected from a bit-identical posted pitch stream.
G8e passes. The base corpus runs (`prereg/corpus/base.*`) were computed by
this candidate's evaluation, once, from the frozen 852b5cc tree.

**Private guards.** On the private session recordings the pitch-chain guards
(G8c session oracle, G8d `session_fv.py`) are unchanged, and the meter's
display far from any voicing rises by more than the +1 pp allowance for
every speaker label and overall (G3), for both variants. Results on the
private session recordings are kept outside this repository.

**R3 (validity).** Desktop production build, headless Chrome (puppeteer, temp
profile, closed by PID), fake mic = a 48 kHz LibriSpeech-derived speech WAV,
`?diag=1`, 60–90 s per run. The added work, `subharmonicPartialCount`, timed
in a module worker of the same Chrome over 3 800 calls on 1 280-sample
buffers: median 0.6–0.9 ms, p95 1.0–1.7 ms, p99 1.1–2.9 ms. It runs in the
pitch worker (25 ms budget per chunk), at most once per chunk. Gender
inference p95 was 95.1, 96.1, 120.6, 150.5 and 172.9 ms on five candidate
runs and 94.8 and 113.9 ms on two interleaved baseline runs (medians
74–96 ms vs the documented ~52 ms). The machine was at 48–100 % CPU from
other jobs during every run, so these are contended figures. Inference plus
the added work stays under 150 ms at p95 in 3 of the 5 candidate runs. The
candidate does not change the gender worker's inference. The baseline was
not measured on an idle machine either. R3 is therefore **not established
for this candidate on a quiet desktop**. The verdict is FAIL regardless.

### Verdict

**meter-c1: FAIL.** It fails P1 (gap 5.01 vs ≤ 4.97 pp), P2a (69.36 vs
≥ 73.56 %), P2b (6.58 vs ≤ 5.02 pp) and H2 (3.96 vs ≤ 3.00 pp). It also fails
the noise guards: G3 noise-only time with a number 22.26 → 30.75 %,
non-blank 25.41 → 34.35 %, real-noise lead 12.18 → 15.39 % (H4 16.06 →
18.59 %), and the private session display. It passes P3 (men's noisy settle
0.675 → 0.575 s), H1 (2.96 pp) and every G1, G2, G4–G9 criterion.

**meter-c2: FAIL.** It passes P1 (4.06 pp), P2a (74.21 %) and H1 (2.54 pp)
but still fails P2b (5.05 pp) and H2 (3.45 pp). It also fails the G3 noise
guards (noise-only with a number 32.19 %), and adds G4 (PVQD held vowels with
a number, women 9.40 → 11.42 %, men 11.91 → 13.44 %), G6 (women's noisy first
value in the wrong range 5.26 → 17.54 %) and G7 (after a 1.5 s pause the
first man → woman value is 55.35 instead of ≥ 70, and the lag to 90 % is
1.43–1.50 s). The 2 s close carries the previous speaker across a 1.5 s
pause.

As the rule anticipated, both trade about 1 pp of noise-only display per pp
gained for men in noise. Neither closes the low-voice gap on the held-out
set.
