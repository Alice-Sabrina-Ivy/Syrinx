# Training direction: target ranges, how they are judged, and their sources — 2026-10-07

Syrinx used to assume every user was feminising: a 165–255 Hz pitch band,
"F2 ≥ 1400 Hz in target" colouring, a "lighter = in target" vocal-weight
zone, the Perceived Voice meter's feminine end drawn in the in-target
colour, and session "in target" figures computed against those. It now
asks on every load — "What are you trying to sound like?": **More
feminine / More masculine / Androgynous or in between / Just exploring** —
with the last answer preselected (Dexie `settings.trainingDirection`),
changeable any time in Settings. Every direction uses the same look; "Just
exploring" (and "not answered yet") shows no bands and neutral readouts.
Code: `src/utils/trainingDirection.js`, `src/utils/pitchLevel.js`.

**Revised the same day after review** (this note describes the result):
the pitch target is judged on a running pitch level, not per frame; past
the band in the direction of travel reads neutral, not off target; the F2
and vocal-weight targets were removed (neutral readouts in every
direction). Sections below give the numbers behind each change.

## Pitch (speaking F0)

| Direction | Band (drawn) | On target | Basis |
|---|---|---|---|
| More feminine | 165–255 Hz | level ≥ 165 Hz | typical adult women's speaking F0 |
| More masculine | 85–155 Hz | level ≤ 155 Hz | typical adult men's speaking F0 |
| Androgynous or in between | 145–175 Hz | level in 145–175 Hz | the zone where listeners' gender judgements are ambiguous and resonance decides |

Sources:

- Typical ranges: Baken, R. J. & Orlikoff, R. F. (2000). *Clinical
  Measurement of Speech and Voice* (2nd ed.), Singular, p. 177, from
  Fitch, J. L. & Holbrook, A. (1970), "Modal vocal fundamental frequency
  of young adults", *Archives of Otolaryngology* 92, 379–382: typical adult
  men about 85/90–155 Hz, women 165–255 Hz. (Editions and secondary
  sources quote 85 or 90 Hz for the men's lower end; it has no practical
  effect here — the display floor is 75 Hz and below the band reads
  neutral, see below.)
- Ambiguous zone: Gelfer, M. P. & Bennett, Q. E. (2013), "Speaking
  fundamental frequency and vowel formant frequencies: effects on
  perception of gender", *J. Voice* 27(5) — speaking F0s of 116, 145, 155,
  165 and 207 Hz were tested; formants mattered most at 145–165 Hz, and
  men's voices were misidentified from 165 Hz up; Wolfe, V. I. et al.
  (1990), "Intonation and fundamental frequency in male-to-female
  transsexuals", *J. Speech Hear. Disord.* 55, 43–50 — the lowest mean F0
  heard as a woman's was 155 Hz; Hardy, T. L. D. et al. (2020), *J. Voice*
  34(2) — mean F0 was the only acoustic measure that moved attributions
  from "man" to "woman" or "ambiguous". **The 175 Hz upper bound is an
  extrapolation**: the highest ambiguous value tested is 165 Hz (and the
  next tested value, 207 Hz, was heard as female); 145–175 Hz spans the
  reported ambiguous values and the onset of reliable "woman"
  attributions, and overlaps both typical ranges on purpose.
- Hillenbrand, J. M. & Clark, M. J. (2009), "The role of f0 and formant
  frequencies in distinguishing the voices of men and women", *Attention,
  Perception, & Psychophysics* 71(5): pitch and formants act together —
  why the androgynous band is a zone where resonance decides, not a
  sufficient target by itself.

### Judged on the pitch level, not per frame

These are ranges of speakers' **average** speaking pitch (mean / modal F0
over a recording). The first version coloured every 25 ms frame and
counted per-frame time in target, which mostly measured intonation: the
bands are 7.5 st (feminine), 10.4 st (masculine) and 3.3 st (androgynous)
wide, so the same natural intonation fell outside the narrow androgynous
band most of the time. The trace, the F0 readouts, the session figure and
the History traces now judge the **pitch level** — the median of the
voiced pitch in the last 1.5 s (`PITCH_LEVEL_WINDOW_MS`), computed on the
painted trace live and on the recorded frames for sessions. The number
shown is still this moment's pitch; only the colour judges the level.

Measured with `scripts/training-direction-band-coverage.mjs` on 61 public
speakers (31 women, 30 men): the laryngograph reference F0 of PTDB-TUG
(2 + 2) and FDA (1 + 1), and the real chain's painted trace on LibriSpeech
test-clean (8 + 8) and PVQD sentence portions (20 + 19), the same streams
as `perceived-voice-gate-2026-10-07.md`. "Recentred" moves each speaker so
their median sits at the band's geometric centre — a speaker whose average
voice is exactly on target — and isolates band width from where the
speaker's voice happens to be. Small n per corpus; read differences of a
few points as noise.

| Share of voiced time in the band, speaker recentred (mean, 10th percentile of speakers) | feminine (7.5 st) | masculine (10.4 st) | androgynous (3.3 st) |
|---|---|---|---|
| per frame (first version) | 82 % (65) | 91 % (78) | **50 % (32)** |
| level, 1.0 s | 91 % (78) | 96 % (88) | 65 % (40) |
| **level, 1.5 s (shipped)** | **92 % (82)** | **97 % (88)** | **69 % (46)** |
| level, 2.0 s | 94 % (83) | 98 % (93) | 73 % (46) |
| level, 3.0 s | 96 % (89) | 98 % (94) | 80 % (56) |

Real speakers in their own band (women: feminine, men: masculine), all 61:

| | per frame: in band / on target | level 1.5 s: in band / on target |
|---|---|---|
| women (median 188 Hz) | 65 % / 73 % | 76 % / 81 % |
| men (median 123 Hz) | 78 % / 84 % | 86 % / 87 % |

("On target" adds "beyond", below.) What remains below 100 % is mostly
speakers whose own average sits near a band edge (e.g. LibriSpeech women
at 166–176 Hz; the FDA woman at 250 Hz is in band only 35 % of the time
but on target 100 %), which is real information.

**The bands are still not equivalent for the androgynous direction**: a
speaker centred in the 3.3 st zone reads on target 69 % of the time
against 92–97 % for the other two. Equal coverage needs equal width —
about 7 st — because the level's own wander (sentence to sentence) is the
same in every register:

| androgynous candidate (recentred, level 1.5 s) | 145–175 Hz (3.3 st) | 140–180 (4.4 st) | 138–184 (5.0 st) | 135–188 (5.7 st) | 130–195 (7.0 st) |
|---|---|---|---|---|---|
| share in the band | 69 % (46) | 79 % (56) | 83 % (64) | 87 % (71) | 91 % (81) |

An equal-coverage band (≈ 130–195 Hz) would include average pitches most
listeners hear as a man's (130–145 Hz) or a woman's (185–195 Hz) on pitch
alone, so it is **not adopted**: the literature zone is kept, the running
level lifts it from 50 % to 69 %, and the remaining gap is a documented
product decision (widen the zone, or a longer level window — 3 s gives
80 % at the cost of slower colour changes).

### "Beyond": past the band in the direction of travel

A lower voice is not less masculine and a higher one is not less
feminine. Levels past the band in the direction of travel (below 85 Hz for
"More masculine", above 255 Hz for "More feminine") are **"beyond"**:
drawn in the neutral colour (not red) and counted as on target in the
session figure ("Pitch on target (≥ 165 Hz)" / "(≤ 155 Hz)"). Same rule
for both directions; the androgynous zone has no direction of travel, so
both of its sides are off target. The band drawn is still the typical
range.

## F2 (second formant) — no target in any direction

The first version coloured per-frame F2 with bands derived from Hillenbrand,
J., Getty, L. A., Clark, M. J. & Wheeler, K. (1995), "Acoustic
characteristics of American English vowels", *JASA* 97(5) (the vowel data
in `tests/dsp/data/vowdata.dat`, steady-state F2, 12 vowels, 45 men /
48 women): feminine ≥ 1375 Hz, masculine ≤ 1575 Hz (the pooled per-token
medians of men and women), androgynous between. Share of the corpus's
vowel tokens inside each band:

| band | men's tokens | women's tokens |
|---|---|---|
| feminine (≥ 1375 Hz) | 49 % | 66 % |
| masculine (≤ 1575 Hz) | 58 % | 50 % |
| androgynous (1375–1575 Hz) | 7.4 % | 16.2 % |

Per-frame F2 is dominated by which vowel is being said (the vowel effect
spans ~900–2800 Hz, the sex difference ~16 % for the same vowel), so the
colour told feminising and masculinising users little (the masculine band
held women's vowels about as often as men's) and showed androgynous users
red for 84–93 % of vowel tokens. **F2 is now a neutral readout in every
direction** — no band, no colour, no session figure (new sessions store
`pctTimeInResonanceTarget: null`) — until a vowel-normalised resonance
readout ships (the Resonance lab is evaluating candidates).

| | men | women |
|---|---|---|
| pooled per-token F2, median (p25–p75) | 1366 (1068–1960) Hz | 1574 (1208–2330) Hz |
| per-speaker vowel-mean F2, mean ± SD (range) | 1508 ± 53 (1387–1652) Hz | 1763 ± 85 (1625–2014) Hz |
| share of tokens ≥ 1400 Hz (the old feminine rule) | 47 % | 63 % |

## Vocal weight — no target in any direction

The gauge's CPP correlate reads a raised voice as lighter and a lowered
one as heavier from CPP's dependence on pitch alone (CLAUDE.md "Register
confound"; `vocal-weight-floor-and-register-2026-10-03.md`). A "lighter =
on target" zone for feminising (the zone every user saw before this
change) and its mirror for masculinising therefore rewarded a pitch change
as a weight change — in the browser check a man's ~94 Hz speech showed
"−1.6 σ (heavier)" in green under "More masculine" at 80 Hz. **The gauge is
now neutral in every direction** (no zone, no green) until pitch is
factored out of the reading; its σ readout is unchanged. The weight
literature also gives no population "in between" for an androgynous goal.

## Perceived Voice meter

No direction-dependent colouring: one neutral hue for every reading, the
0–30 and 70–100 ranges drawn identically, and an indicator line with no
fill growing from either end (end labels kept until the cue-strip
redesign). See `perceived-voice-gate-2026-10-07.md`.

## Sessions and history

A recording stores a direction log (`directionLog: [{ atMs, direction }]`,
non-indexed field, no schema bump); the on-target figure is computed per
frame, on the frame's pitch level, against the direction in effect at
that moment. Frames recorded while "Just exploring" don't count either
way, and `pctVoicedWithPitchTarget` stores the share of voiced time that
had a target — History shows it next to the figure when it is below
100 % ("75% over the 57% of voiced time with a target"). "Goal:" lists the
log in order, returns included ("More feminine → Just exploring → More
feminine"). Sessions recorded before this change have no log: their
traces are drawn neutrally with no band, and their stored figures are
shown **in a neutral colour** with the fixed range they were computed
against ("Pitch in 165–255 Hz", "F2 ≥ 1400 Hz") — never judged on or off
target.

## The question itself

A real modal: the page behind it is inert while the welcome, the question
or Settings is open (no focus, no taps — the microphone can't start and
Settings can't open behind it), the focused option shows an outline,
Escape confirms a preselected / chosen answer without starting the
microphone (an answer is required), Continue confirms **and starts
listening** on every load (one tap, as Start Listening alone was before),
and the welcome, the question and Settings scroll on short viewports
(phone landscape 890 × 360). Settings takes focus when it opens, closes
on Escape and returns focus to the gear.

## Checks

`tests/data/training-direction-test.js` (targets, statuses, the pitch
level, log, persistence, level-based stats), `tests/data/session-stats-test.js`,
and the headless browser check `scripts/voice-direction-smoke.mjs` on the
production build at 448 × 890 (phone), 1280 × 800 and 890 × 360
(landscape: welcome / question only): the question on every load with the
last answer preselected, inert background (Tab and taps can't reach it),
Escape behaviour, mid-session changes repaint the band and colours at
once, "Just exploring" draws no band, F0 colour by level (a ~100 Hz voice:
not red under "More masculine", red under "More feminine"), F2 neutral,
History old sessions neutral and goals in order.
