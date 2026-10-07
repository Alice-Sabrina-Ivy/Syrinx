# Training direction: target ranges and their sources — 2026-10-07

Syrinx used to assume every user was feminising: a 165–255 Hz pitch band,
"F2 ≥ 1400 Hz in target" colouring, a "lighter = in target" vocal-weight
zone, the Perceived Voice meter's feminine end drawn in the in-target
colour, and session "in target" figures computed against those. It now
asks on every load — "What are you trying to sound like?": **More
feminine / More masculine / Androgynous or in between / Just exploring** —
with the last answer preselected (Dexie `settings.trainingDirection`),
changeable any time in Settings. Every direction uses the same look; "Just
exploring" (and "not answered yet") shows no bands and neutral readouts.
Code: `src/utils/trainingDirection.js`.

## Pitch (speaking F0)

| Direction | Target | Basis |
|---|---|---|
| More feminine | 165–255 Hz | typical adult women's speaking F0 |
| More masculine | 85–155 Hz | typical adult men's speaking F0 |
| Androgynous or in between | 145–175 Hz | the zone where listeners' gender judgements are ambiguous and resonance decides |

- Typical ranges: Baken, R. J. (2000). *Clinical Measurement of Speech
  and Voice* (2nd ed.), p. 177, from Fitch, J. L. & Holbrook, A. (1970),
  "Modal fundamental frequency of young adults", *Archives of
  Otolaryngology* 92, 379–382: typical adult men about 85/90–155 Hz,
  women 165–255 Hz. (Editions and secondary sources quote 85 or 90 Hz
  for the men's lower end; it has no practical effect on a training
  target and the pitch display floor is 75 Hz.)
- Ambiguous zone: Gelfer, M. P. & Bennett, Q. E. (2013), "Speaking
  fundamental frequency and vowel formant frequencies: effects on
  perception of gender", *J. Voice* 27(5) — formants mattered most for
  SFF 145–165 Hz, and men's voices were misidentified from 165 Hz up;
  Wolfe, V. I. et al. (1990), "Intonation and fundamental frequency in
  male-to-female transsexuals", *J. Speech Hear. Disord.* 55, 43–50 —
  the lowest mean F0 heard as a woman's was 155 Hz; Hardy, T. L. D. et
  al. (2020), *J. Voice* 34(2) — mean F0 was the only acoustic measure
  that moved attributions from "man" to "woman" or "ambiguous". 145–175 Hz
  spans the reported ambiguous SFFs (145–165 Hz) and the onset of
  reliable "woman" attributions; it overlaps both typical ranges on
  purpose.
- Hillenbrand, J. M. & Clark, M. J. (2009), "The role of f0 and formant
  frequencies in distinguishing the voices of men and women", *Attention,
  Perception, & Psychophysics* 71(5): pitch and formants act together —
  why the androgynous pitch band is a zone where resonance decides, not a
  sufficient target by itself.

## F2 (second formant, per frame)

| Direction | In target | Basis |
|---|---|---|
| More feminine | F2 ≥ 1375 Hz | at/above the typical man's median F2 |
| More masculine | F2 ≤ 1575 Hz | at/below the typical woman's median F2 |
| Androgynous or in between | 1375–1575 Hz | between the two |

Derived from Hillenbrand, J., Getty, L. A., Clark, M. J. & Wheeler, K.
(1995), "Acoustic characteristics of American English vowels", *JASA*
97(5) — the vowel data shipped in `tests/dsp/data/vowdata.dat` (steady-
state F2, 12 vowels, 45 men / 48 women):

| | men | women |
|---|---|---|
| pooled per-token F2, median (p25–p75) | 1366 (1068–1960) Hz | 1574 (1208–2330) Hz |
| per-speaker vowel-mean F2, mean ± SD (range) | 1508 ± 53 (1387–1652) Hz | 1763 ± 85 (1625–2014) Hz |
| share of tokens ≥ 1400 Hz (the old feminine rule) | 47 % | 63 % |
| same vowel, women / men | — | × 1.09–1.21 (mean 1.16) |

Thresholds are the pooled medians rounded to 25 Hz (1366 → 1375,
1574 → 1575); the old feminine rule (≥ 1400) becomes ≥ 1375. **This is a
weak cue and labelled as such**: per-frame F2 is dominated by which vowel
is being said (the vowel effect spans ~900–2800 Hz, the sex difference
~16 %), so per-frame colouring mostly tracks the vowel. Vowel-normalised
resonance is what the Resonance lab is evaluating; these bands only make
the existing readout stop assuming a direction.

## Vocal weight (CPP, relative to the user's own recent voice)

| Direction | Target |
|---|---|
| More feminine | lighter side (≥ +0.5 σ from the user's 30 s baseline) — unchanged |
| More masculine | heavier side (≤ −0.5 σ) — mirror image |
| Androgynous / Just exploring | none |

The gauge measures distance from the user's *own* recent voice, so there
is no population "in between" to aim at; the androgynous direction gets
no weight target rather than an invented one. Lighter for feminising and
heavier for masculinising follow the usual training direction for vocal
weight (the gauge's CPP correlate: Aaen et al. 2025, as cited in
`VocalWeightGauge.jsx`); the evidence that weight changes how a voice is
gendered is mixed, which is one more reason not to target it for
androgynous goals.

## Perceived Voice meter

No direction-dependent colouring: one neutral hue for every reading, the
0–30 and 70–100 ranges drawn identically (end labels kept until the
cue-strip redesign). See `perceived-voice-gate-2026-10-07.md`.

## Sessions and history

A recording stores a direction log (`directionLog: [{ atMs, direction }]`,
non-indexed field, no schema bump); time-in-target is computed per frame
against the direction in effect at that moment, frames recorded while
"Just exploring" don't count either way, and the History card shows
"Goal: …" and labels each figure with its range. Sessions recorded before
this change have no log: their traces are drawn neutrally with no band,
and their stored figures are labelled with the fixed range they were
computed against ("Pitch in 165–255 Hz", "F2 ≥ 1400 Hz") rather than
re-interpreted.

## Checks

`tests/data/training-direction-test.js` (targets, log, persistence,
stats), `tests/data/session-stats-test.js`, and the headless browser
check `scripts/voice-direction-smoke.mjs` (question on every load with
the last answer preselected, mid-session changes repaint the band and
colours at once, "Just exploring" draws no band) at 448×890 and 1280×800.
