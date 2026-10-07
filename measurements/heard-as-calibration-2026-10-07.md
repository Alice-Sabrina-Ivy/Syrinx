# "Likely heard as" (experimental, opt-in): calibration — 2026-10-07

The Dashboard's opt-in **"Likely heard as · Experimental"** panel shows how
listeners in published studies might hear a voice: the shares who would say
*man*, *might be unsure* and *woman*, each as a **range** in "x in 10", never a
verdict. It is off by default. This note records what its constants are, what
they were fitted on, how well they do on held-out listener data, and the known
failures the panel must (and does) disclose. Every number comes from public
listener data, or public / rebuilt stimuli measured with the app's own chain.
No private recordings were used.

Code: `src/ml/heard-as.js` (aggregation, shares, formatting),
`src/ml/heardAsCalibration.js` (constants + provenance),
`src/components/HeardAsPanel.jsx` (display). Tooling: `scripts/heard-as/`.
The per-window classifier logit it pools is documented in
`measurements/heard-as-window-logit-2026-10-07.md`.

## 1. Model and constants

    eta = 17.6724 − 0.34910 · meterLogit − 3.53735 · ln(F0 in Hz)
    s   = 1 / (1 + e^(−eta))    (share answering "man" in a two-way choice; unsure counted half each way)

- `meterLogit` = mean, over the classifier windows the utterance gate scored,
  of ln p_female − ln p_male (deployed q8-v2 ECAPA classifier, unsmoothed).
- Talker-bootstrap 95 % intervals: bMeter [−0.385, −0.314], bLnF0
  [−3.65, −2.89]; prediction SD 0.15–0.18 logit at typical inputs.
- F0 at which half answer "man": 219 / 180 / 148 / 121 / 100 Hz at
  meterLogit −4 / −2 / 0 / +2 / +4.
- Fit: logistic link, least squares on the share; each source weighted by
  √(listener data); per-source intercept offsets summing to zero; **the app
  uses offset 0** (the average listener group). Offsets: H&C concatenations
  +0.74, RB695 +0.52, Palette +0.22, Skuk −0.06, H&C sentences −0.41,
  Meyer −1.01 (SD 0.64).
- Target: "half" = man + unsure/2 (beat man / (man + woman): mean
  leave-one-source-out MAE 13.1 vs 13.9).
- Form A only (meter + ln F0). Adding the resonance cue or an F0 × vtln term
  added nothing once the classifier is in the model.

**Display.** The range is eta ± **2.25** logit. Unsure share
u = min(max(0.02, 0.42 · 4s(1−s)), 2·min(s, 1−s)); man = s − u/2,
woman = 1 − s − u/2 (the inverse of the fitted target; shares sum to 1).
Ranges are shown in tenths with the low end rounded down and the high end up
("about 2–6 in 10"); below 0.05 "fewer than 1 in 10", above 0.95 "nearly all".
No percent signs, no verdict word, no colour per row.

| Estimate s | Man share (range) | Unsure | Woman share (range) |
|---|---|---|---|
| 5 % | 1 (0–15) % | 8 % | 91 (48–99) % |
| 30 % | 12 (1–67) % | 35 % | 52 (6–92) % |
| 50 % | 29 (2–83) % | 42 % | 29 (2–83) % |
| 70 % | 52 (6–92) % | 35 % | 12 (1–67) % |
| 95 % | 91 (48–99) % | 8 % | 1 (0–15) % |

The unsure constant depends on how listeners are asked: k = 0.54 with
explicit "other gender" + "no answer" options (Palette), 0.10 with "other
gender" alone, 0.28 for a 7-point midpoint (RB695); 0.42 is the pooled
licence-clean fit. The 0.04 floor proposed earlier is not supported (clear
voices show 2–5 % unsure, which k · 4s(1−s) already gives); 0.02 is kept as a
display minimum.

## 2. Inputs and licences

**Fit set** (only these set a constant; only numbers ship — no audio, no
per-stimulus tables):

| Source | Stimuli / listener data / talkers | Licence |
|---|---|---|
| Palette of Voices — Munson & Dolquist (2025), JSLHR, doi:10.1044/2025_JSLHR-24-00756; OSF n3twm | 240 / 240 / 20 (trans and cis men, running speech) | CC BY 4.0 |
| Meyer, Rachman, Araiza-Illan, Gaudrain & Başkent (2023), PLOS ONE 18:e0294328, doi:10.1371/journal.pone.0294328 — Fig. 6B cells on the PICKA F0 × VTL grid rebuilt from LibriSpeech | 198 / 9 / 11 | figure CC BY 4.0; data (doi:10.34894/IAGXVF) CC0 |
| Skuk et al. (2020), JSLHR 63(9):3155–3175, doi:10.1044/2020_JSLHR-20-00026; OSF f85tj | 38 / 19 / 2 pairs (F0-only, timbre-only, full morphs) | CC BY 4.0 |
| Hillenbrand & Clark (2009), APP 71(5):1150–1166, doi:10.3758/APP.71.5.1150 — condition rates on 4-syllable concatenations rebuilt from the Hillenbrand et al. (1995) /hVd/ recordings | 372 / 8 / 93 | published rates used as facts; H95 audio used only as measurement input, not redistributed (dropping it moves predictions ≤ 0.14 logit) |
| Hillenbrand & Clark (2009) sentence rates on a LibriSpeech sentence proxy | 320 / 8 / 40 | facts; LibriSpeech CC BY 4.0 |
| Mohsenin & Munz (2024), Psychological Science, doi:10.1177/09567976241238222; ResearchBox 695 / Zenodo doi:10.5281/zenodo.15038471 | 16 / 9 / 3 (TTS voices incl. male raised, female lowered) | listener data CC BY 4.0; vendor TTS audio measured locally, never redistributed |

LibriSpeech (Panayotov et al. 2015, openslr.org/12) is CC BY 4.0. The
classifier (JaesungHuh voice-gender-classifier, ECAPA-TDNN) is MIT.

**Tested and left out of the fit:** bmmb (MIT) — made validation worse (15.3 →
16.6) and needs a +0.80 offset (single 0.3–0.9 s /hid/ syllables, a 4-way task
with child categories); used as natural-voice validation instead.

**Validation only** (reported in aggregate below; no constant depends on
them): Jebens, Başkent & Rachman 2022 (doi:10.1121/10.0016601; data
doi:10.34894/ICA98X, CC BY-NC-SA), Nagels et al. 2020
(doi:10.1038/s41598-020-61732-6; data doi:10.34894/XCPMVK, CC BY-NC-SA),
bmmb (Barreda & Silbert, MIT), Kong, Tran & Hennequin 2025 (arXiv:2511.02726,
STraDa CC BY-NC), Neuenswander et al. 2024 (OSF msnke) and Mooshammer &
Etzrodt 2022 (OSF 39pts) (no data licence), LibriTTS-P × LibriTTS-R (CC BY 4.0).

**Sensitivity.** Predictions move by at most 0.08 logit with equal source
weights, 0.04 without Skuk, 0.12 without RB695, 0.22 without Meyer and 0.24
without both Hillenbrand & Clark sets.

## 3. The aggregation the constants assume — and the app uses

One definition, in `src/ml/heard-as.js`, used live and by the tooling:

- **Windows:** every 0.75 s gender-worker window the utterance gate scored
  (`decideMlWindow` verdict `score`, gated mode, peak above the silence
  floor) whose end lies in the trailing **8 s** of audio-clock time.
- **meterLogit:** arithmetic mean of those windows' ln p_female − ln p_male
  (never the EMA or the 0–100 score; no clamping).
- **ln F0:** ln of the median of the pitch worker's **posted** voiced pitch
  values whose capture time lies inside at least one of those windows (not
  smoothed, painted, held or readout values).
- **Voiced time:** the audio-clock spacing before each such voiced frame,
  capped at 100 ms (25 ms per frame normally).
- Recomputed every **2 s**.

**Fit-time pooling.** The calibration pooled each stimulus once with the
resonance lab's chain (lab gate: a window ending every 0.15 s scored when a
voiced 10 ms frame lies in its last 0.5 s; mean logit; ln of the median
voiced F0). Replaying the live utterance gate on those items changed eta by
−0.03 to −0.04 logit on average (q90 |Δ| 0.20).

### Production-chain check (this branch)

`scripts/heard-as/run_chain.mjs` runs each stimulus through the **app's own
chain** — the real pitch worker, the gender worker's window schedule with
`decideMlWindow` and the real utterance gate, the deployed classifier
pipeline in Node, then `heard-as.js` over the whole stimulus — and
`analyze_palette.py` compares with the lab-chain inputs the constants were
fitted on. On the 240 Palette stimuli (the fit's largest source):

| | Result |
|---|---|
| stimuli with ≥ 1 scored window | 240 / 240 (median 16 windows, min 6; median 2.06 s voiced inside them) |
| meterLogit, production − lab | mean −0.072, SD 0.453, \|Δ\| q90 0.745 |
| ln F0, production − lab | mean −0.0006 (−0.1 % in Hz), \|Δ\| q90 0.008 |
| eta, production − lab | mean +0.027 logit, \|Δ\| q90 0.27, max 0.63 |
| MAE vs Palette listeners, offset 0 | lab inputs **6.12**, production inputs **6.33** points |

The constants transfer to the production chain with a negligible level shift
and a 0.2-point change in Palette error, so they are shipped as fitted. A
full refit of every source through the production chain was **not** run (the
rebuilt grids and TTS stimuli are outside this repository); the spec's stop
condition (refit LOSO MAE more than 3 points worse than form A's 12.2, or
held-out 80 %-range coverage below 0.6) is not met: the licence-clean refit's
mean LOSO MAE is 13.1 (+0.9) and its coverage 0.86.

**Equivalence in CI** (`tests/ml/heard-as-equivalence-test.js`, golden file
`tests/ml/fixtures/heard-as-golden.json` from `make_golden.mjs` on the three
public LibriSpeech lab fixtures): `heard-as.js` reproduces an independent
Python implementation of the definition (`golden_check.py`) to ≤ 2e-15 in
meterLogit / ln F0 and ≤ 2e-18 in the shares; the live `estimate()` equals the
fit-time aggregate on a whole stimulus; and replaying the production chain
reproduces the stored scored-window times and posted pitch exactly — a change
to the utterance gate, the pitch chain or `decideMlWindow` fails the test with
the instruction to re-run `scripts/heard-as` and re-check the constants.

**Burst jitter.** Live, the worker's 150 ms hop runs on `performance.now()`
and capture delivers chunks in bursts, so window positions jitter by up to a
hardware buffer. Replaying the Palette with 40 ms bursts plus 0–5 ms
scheduling jitter on the hop clock vs the audio-clock hop: meterLogit Δ mean
−0.003, SD 0.157, |Δ| q90 0.25; the "man" share Δ mean +0.03 points, |Δ| q90
1.6, max 5.0 points (whole stimuli of ~2 s voiced; the live 8 s pooling
averages more windows).

## 4. Errors (held out)

MAE in points of "% man" per listener datum, offset 0, (bias = prediction − heard).

**Leave one source out:**

| Held-out source | all | feminine-presenting | ambiguous | masculine-presenting |
|---|---|---|---|---|
| Palette | 6.9 (−3.1) | — | — | 6.9 |
| Meyer | 18.0 | 17.2 (+17.2) | 28.3 | 8.6 |
| Skuk | 9.8 | 10.7 (+9.1) | — | 8.8 (−8.8) |
| H&C concatenations | 13.6 | 12.1 (−10.3) | — | 15.2 (−15.2) |
| H&C sentences | 18.5 | 23.0 (+23.0) | — | 14.1 (−14.1) |
| RB695 | 11.9 | 4.6 | — | 26.4 (−26.4) |
| **Mean of source MAEs** | **13.1** | | | |

Non-Palette sources pooled: feminine 12.1, masculine 13.1 — the
gender-symmetric max(fem, masc) is **13.1**.

**Validation sources** (full fit, offset 0; aggregate only): PICKA Jebens
LibriSpeech cells 15.4, VariaNTS sentences 12.8, PICKA Nagels 26.4; H&C
syllables 9.1; LibriTTS-P (196 readers) 15.6 (fem 14.9, masc 17.2); Mooshammer
ambiguous voice 12.6; bmmb adults ("adult man") 10.2; **Kong singing 34.7**
(masculine singers 52.1). Neuenswander women: predicted 5–14 % "man", Spearman
−0.02 with rated femininity — the estimate does not grade femininity within
clearly female voices.

## 5. Range width and coverage

The earlier ±1.79-logit range "covered only 22–68 % of individual voices"
because observed shares from 3- or 15-listener panels are often exactly 0 or
100 %, which a range ending at 1–2 % can never contain. Separating panel noise
from per-voice error (binomial latent model, voice bootstrap):

| Natural held-out voices | per-voice σ | coverage at ±2.25 (in tenths, outward rounding) |
|---|---|---|
| Palette, leave one talker out | 0.51 | 1.00 |
| bmmb women ("man or boy") | 1.13 | 0.97 |
| bmmb men ("adult man") | 0.93 | 0.99 |
| bmmb women ("adult man") | ≈0 (level offset −3.07) | 1.00 |
| LibriTTS-P women / men | ≈0 | 1.00 |

The binding constraint is condition-level held-out listener data (the
manipulated and conflicting-cue voices). Source-balanced coverage:

| half-width | feminine | ambiguous | masculine | all non-Palette | worst source |
|---|---|---|---|---|---|
| 1.79 | 0.66 | 0.75 | 0.83 | 0.77 | 0.44 |
| 2.00 | 0.74 | 0.75 | 0.83 | 0.80 | 0.56 |
| **2.25** | **0.81** | **0.83** | **0.88** | **0.86** | 0.67 |
| 2.50 | 0.89 | 0.92 | 0.93 | 0.91 | 0.67 |

2.25 is the smallest width with ≥ 80 % on every side (the feminine side
binds). A "likely man" / "likely woman" call at this width — computed only for
this note; the panel shows no verdict — never landed on the wrong side of 50 %
on 347 held-out listener data (0 of 240 Palette, 0 of 93 bmmb, 0 of 196
LibriTTS-P voices); the cost is a wide "split" for many clear voices.

## 6. Known failures the panel discloses

| # | Failure | Numbers | How the panel says it |
|---|---|---|---|
| 1 | Pitch moved without resonance is over-credited, **in both directions** | Male voice, pitch raised, formants unchanged: 12–62 points too little "man" (median 21; 4 held-out data; worst the RB695 male TTS raised to ~161 Hz, 89.5 % heard vs 27.8 % predicted). Female voice, pitch lowered, formants unchanged: median +20, up to +46 points too much "man" (7 of 11 data; the NC-licensed PICKA validation grids agree, +11 to +40 points). Pitch and resonance moved together: median miss 5 (male base) / 8 (female base) points | caveat: "It follows pitch more than listeners do: change pitch without resonance and it shows more movement than listeners would hear, in either direction"; the **conflict note** when the pitch and resonance cues point different ways |
| 2 | Clear voices look less clear than they are | clear women 6–15 % predicted vs 0.4–3 % heard; clear men 83–86 % vs 97.5–99.6 % | "More": typical voices are shown further from the ends than listeners put them |
| 3 | Listener groups differ | between-study offset SD 0.64 logit (−1.01 to +0.74) | caveat: "Listener groups disagree a lot." |
| 4 | Tested population | Fit: masculine-presenting natural voices (Palette) plus resynthesised / TTS voices; no natural trans-feminine or trans-masculine training voices with listener data are public | caveat: "Tested mostly on masculine-presenting and computer-altered voices, not on trans or nonbinary speakers." |
| 5 | Out of scope | children (bmmb /hid/ median F0: girls 241, boys 243, women 227 Hz — F0 cannot separate them; boys predicted 6–8 % "man", heard 60 %); singing (Kong 34.7 points); held vowels, single words, < ~3 s voiced | caveat: "Adults' speaking voice only."; "More": singing, children, held vowels and single words not supported; hidden on held notes and short speech (§7) |
| 6 | Extrapolation | fit stimuli span 81–376 Hz (q99 293 Hz), meterLogit −7.3…+5.7; natural running speech in the fit ends at 213 Hz | the **range note** "Outside the range it was tested on" outside 81–293 Hz or that meter range |

## 7. When the panel hides

| Rule | Why | Effect (40 LibriSpeech readers, continuous reading) |
|---|---|---|
| fewer than **3.0 s** of voiced frames inside scored windows, or fewer than **10** scored windows, in the trailing 8 s | live estimates at or above the fit material (1.4–3 s voiced); estimate noise falls from SD 0.67 logit at 1 s voiced to 0.53 at 3 s | hidden on 9 % of display updates overall, 0 % in steady reading; first estimate a median 5.5 s after speech starts |
| the gender worker's voice state is `sustained` (held vowel or note) | the classifier puts held vowels near 50 | "Needs running speech" |
| no scored window for > 5 s | never show an old estimate; 2–5 s old it is dimmed | "Waiting for running speech" |
| model loading / error, nothing scored yet | — | a one-line reason |

The minimum-input rule is a **display** rule, not a calibration-domain rule:
the fit stimuli are single ~2 s utterances (217 of the 240 Palette stimuli
would fail the live minimums on their own), while the live estimate pools up
to 8 s.

Melodic singing is **not** detected (the gate scores 81.5 % of sung time),
and neither are children's voices; both are disclosed instead.

## Reproduce

```
node tests/ml/heard-as-test.js                 # constants, test vectors, shares, formatting, hide rules
node tests/ml/heard-as-equivalence-test.js     # live aggregation == fit-time definition; window-set guard
node scripts/heard-as/run_chain.mjs <jobs_pov.json> build/heard-as/palette_chain.jsonl
node scripts/heard-as/run_chain.mjs <jobs_pov.json> build/heard-as/palette_chain_burst40.jsonl --burst=40 --jitter=5
python scripts/heard-as/analyze_palette.py <pov_stimuli.csv> build/heard-as/palette_chain.jsonl build/heard-as/palette_chain_burst40.jsonl
node scripts/heard-as/make_golden.mjs          # after any gate / pitch / window-decision change
```

The source tables and fit scripts of the calibration (form A refit, LOSO,
coverage, unsure model, hide rules) are described in `scripts/heard-as/README.md`.
