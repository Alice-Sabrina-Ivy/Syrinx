# Target-voice half-pitch fix: combined-chain validation — 2026-10-03

**What is validated:** the five 2026-10-03 workstreams as integrated on branch
`target-voice-pitch-fix`, measured together for the first time:
[pitch-globalpeak-transient-2026-10-03.md](pitch-globalpeak-transient-2026-10-03.md) (gp) →
[pitch-octave-arbitration-2026-10-03.md](pitch-octave-arbitration-2026-10-03.md) (oct) →
[pitch-ceiling-2026-10-03.md](pitch-ceiling-2026-10-03.md) (ceil) →
[noise-notch-voice-safety-2026-10-03.md](noise-notch-voice-safety-2026-10-03.md) (notch) →
[pitch-display-gate-redesign-2026-10-03.md](pitch-display-gate-redesign-2026-10-03.md) (disp = the combined chain).
Baseline = origin/main src at f92b11a. Each was measured on its own against
that baseline. This file measures the combination and every cumulative prefix
of it, on the committed oracle [scripts/session-oracle/](../scripts/session-oracle/README.md).

## Verdict

On the private session recordings — the primary oracle for the
target-voice problem — the combined chain fixes the reported problem by a
wide margin: target-voice displayed accuracy, displayed blank, decoded and
readout half-pitch and the low → target register-switch latency all improve
substantially. Results on the private session recordings are kept outside this repository. Every display-level guard passes, and so do
noise, held notes and transients.

**Two worker-level guards fail in combination:**

1. **Low-voice octave-up (75–160 Hz) under the strict R1&CC convention**
   (private session recordings) narrowly exceeds the ~0.3 pp guard. It
   passes under the consensus convention and on the displayed trace. The
   octave arbitration alone already misses under strict R1&CC; the
   2026-10-03 octave file's "strict" was in fact session-label R1 *without*
   the CC agreement (§1).
2. **Hillenbrand men worker-level correct: 61.21 → 60.44 % (−0.77 pp, limit
   0.5).** This is entirely the 800 Hz search ceiling: vowel-onset 3f/4f
   locks decode above 400 Hz and are posted unvoiced. The ceiling file
   documented −0.67 pp on its own harness. The displayed level is +0.24
   (pass). The same frames move worker-level max(F_err, M_err) on Hillenbrand
   from 38.79 to 39.56.

Every documented fallback was measured, cumulatively, in the mandated order
(§11):
- (i) contested-pair arbitration (|s(f)−s(2f)| < 0.05): the strict low-band
  guard still fails.
- (i)+(ii) maxPitchHz 600: the low-band guard passes, but Hillenbrand men
  −0.60 still fails.
- (iii) EXCURSION_SUSTAIN 10/12: display-only, so it cannot move a
  worker-level guard (Hillenbrand men −0.60). It also costs target-voice
  display correct.

**No configuration passes every guard. No fallback is adopted. The code is
left exactly as integrated. The two failing guards need a human decision
(§12).**

**Decision (2026-10-04, user): ship as integrated.** Both worker-level guard misses are accepted because every displayed (user-visible) metric improves, including the displayed gender-symmetric max(F_err, M_err) on all three corpora; the 600 Hz and 400 Hz alternatives were offered with these numbers and declined (the 600 Hz option still misses the Hillenbrand-men guard and reopens 600–800 Hz half-pitch aliasing).

## Guard table (baseline → combined)

Worker = posted unless stated. Octave-up = ×2 (the established convention;
×3/×4 reported separately). The session-recording guards (target band,
low-voice octave-up) and the transient oracle (which mixes private session
excerpts with FDA) are kept outside this repository; their verdicts are in
the Verdict above.

| guard | metric | baseline → combined | verdict |
|---|---|---|---|
| PTDB male <125 / 125–160 octave-up | decoded | 0.14 → 0.08 / 0.11 → 0.11 | PASS |
| | displayed | 0.03 → 0.03 / 0.00 → 0.00 | PASS |
| FDA male octave-up | decoded / displayed | 0.13 → 0.04 / 0.09 → 0.04 | PASS |
| Hillenbrand men octave-up | decoded / displayed | 0.27 → 0.09 / 0.28 → 0.03 | PASS (decoded ×3/×4 0.34 → 2.37, all > 400 Hz, posted unvoiced: posted ×3/×4 0.30 → 0.21) |
| Male corpus correct ≥ −0.5 pp | PTDB m / FDA m worker | 84.19 → 84.29 / 85.68 → 85.73 | PASS |
| | **Hillenbrand men worker (posted / decoded)** | **61.21 → 60.44 (−0.77) / 61.23 → 60.44 (−0.79)** | **FAIL** |
| | displayed PTDB m / FDA m / Hil m | 77.29 → 80.91 / 81.55 → 83.20 / 63.33 → 63.57 | PASS |
| Female corpora / vocadito no regression | worker FDA f / PTDB f / Hil f | 87.69 → 87.61 / 94.92 → 95.02 / 61.58 → 61.55 | PASS (−0.08 / −0.03 within noise) |
| | worker vocadito / vocadito_34 | 96.48 → 98.31 / 54.57 → 77.49 | PASS |
| | displayed FDA f / PTDB f / Hil f / voc / v34 | 86.00 → 86.77 / 91.44 → 92.34 / 64.35 → 64.41 / 93.95 → 97.28 / 26.96 → 64.51 | PASS |
| max(F_err, M_err) flat or better | worker FDA / PTDB / Hil | 14.32 → 14.27 / 15.81 → 15.71 / **38.79 → 39.56** | **Hil FAIL** (same frames as above) |
| | displayed FDA / PTDB / Hil | 18.45 → 16.80 / 22.71 → 19.09 / 36.67 → 36.43 | PASS |
| Noise-only false voicing | real chain, posted / painted, 15 classes | ≤ baseline in every class; whine-520/640 99.8 → 0 | PASS |
| | committed oracle tail FV (parity) | pink 0.5 → 0.8 (10/5 dB), crickets 0.9 → 0.0, rest equal | PASS |
| | gender oracle noise-only VAD pass | fan-hum 6 → 0 %, rest identical | PASS |
| Held notes ≤ 20 s not blanked | requirement grid, painted | mean 48.7 (min 26.4) → 100.0 (min 100.0) | PASS |
| | main grid ≤ 20 s, painted | mean 57.2 → 97.8; 0 of 480 configs worse | PASS |
| Unit tests, lint, build | | all pass | PASS |
| CPU per pitch chunk | real worker, 5 min, interleaved ×3 | 0.741 → 0.730 ms | PASS |

## 1. The oracle and its verification

[scripts/session-oracle/](../scripts/session-oracle/README.md) (committed with this file):

- `run.mjs` / `lib/chain.mjs` drive the **real** `pitch-worker.js` (fake
  `self`, 25 ms chunks) and the **real** `dsp-worker.js` (its intensity).
  They also drive the **real** `useAudioPipeline.js` `handleAnalysisResult`
  (one-render React mock, the 2026-10-03 display workstream's real-hook
  driver). Everything is imported from a chosen src tree, so any commit can
  be measured with `git archive <rev> src`.
- `lib/tap-boersma.mjs` records the frame-local and decoded values the worker
  never posts, through an observation-only wrapper of the same tree's
  `boersma-ac.js`. With `SO_TAP=0` the posted pitch, confidence, notch,
  intensity, painted, readout, style and recorded columns are identical.
- `build_refs.py` builds the session references (Praat AC / SHS / CC,
  optionally PENN; the consensus; strict = session-label R1 where Praat CC
  agrees within 5 %; the spectral odd-multiple arbiter), and `analyze.py`
  produces the session tables. Both run on the private session recordings
  (results kept outside this repository).
- `corpus.mjs` runs FDA / PTDB-TUG / Hillenbrand / vocadito through the same
  real chain, per file, scoring worker and displayed levels.

Verification before trusting it:

- **Worker parity.** On origin/main src the runner reproduces phase-1
  `session-attribution/chain-harness.js` bit-exactly on every worker column
  (frame-local, top candidate, unvoiced strength, decoded, posted,
  confidence, notch count) and the DSP intensity, on every hop of the
  private session recordings.
- **Painted trace.** Painted differs only on a handful of hops, all on the
  400 ms hold boundary: the chain harness's unrounded timestamps refuse a
  hold that the real hook, which rounds, allows. This is the display
  workstream's known hold-boundary difference.
- **Phase-1 baseline reproduced exactly** on the private session recordings
  (kept outside this repository).
- **The octave file's "strict" was not R1&CC.**
  `display-chain/refs_strict` carries the session-label f0 on every R1-voiced
  frame, so it equals R1 exactly. The display and notch files' strict *is*
  R1&CC. This file reports R1&CC as "strict", as mandated. `r1` is kept as a
  `analyze.py` convention only for reproduction.
- **References reproduce.** `build_refs.py` reproduces the cached phase-1
  Praat contours bit-exactly. Its consensus / strict / arbiter tracks have 0
  mismatches. A fresh PENN run on a held-out recording equals the cached PENN
  bit-exactly.
- **Corpora.** Baseline worker numbers equal the octave workstream's
  `corpus.mjs` (Hillenbrand men 61.23 / 61.21, women 61.60 / 61.58, PTDB
  male 86.37 / 84.19, FDA female 87.73 / 87.69). The ceiling workstream's
  `corp-run.mjs` used a different chunking/front-end order and reports
  Hillenbrand ~3 pp higher in absolute terms (64.32). Only deltas are
  compared across files.

Cumulative prefixes were measured as extracted src trees: base, +gp (cb483ab),
+oct (1039832), +ceil (0b0616c), +notch (bc42ad0), +disp (39bd0ff = HEAD src).

## 2–5. Session results

The target-voice (160–400 Hz) tables by stage, tree and convention, the
register-switch / readout / spike-event tables, the low-voice (75–160 Hz)
guard and the second-voice and true ≥ 400 Hz tables were all scored on the
private session recordings. Results on the private session recordings are kept outside this repository.

## 6. Corpora by gender (worker and displayed)

The real chain runs per file (`corpus.mjs`). Cells are correct / octave-down
(×½, ×⅓) / ×2 up / ×3–4 up / null %.

| group / band | n | posted base | posted combined | painted base | painted combined |
|---|---|---|---|---|---|
| PTDB m 75–125 | 3552 | 84.23 / 0 / 0.14 / 0.03 / 9.46 | 84.32 / 0 / 0.08 / 0.06 / 9.40 | 78.05 / 0 / 0.03 / 0.06 / 8.82 | 81.29 / 0 / 0.03 / 0 / 5.86 |
| PTDB m 125–160 | 884 | 91.74 / 0.23 / 0.11 / 0 / 2.83 | 91.86 / 0.23 / 0.11 / 0 / 2.94 | 82.34 / 0.11 / 0 / 0 / 8.89 | 87.96 / 0.11 / 0 / 0 / 3.04 |
| PTDB m all | 4667 | 84.19 / 0.17 / 0.15 / 0.02 / 9.54 | 84.29 / 0.15 / 0.11 / 0.04 / 9.51 | 77.29 / 0.15 / 0.11 / 0.04 / 9.84 | 80.91 / 0.13 / 0.15 / 0 / 6.39 |
| FDA m all | 2312 | 85.68 / 0.04 / 0.04 / 0.13 / 4.54 | 85.73 / 0.04 / 0.04 / 0.17 / 4.63 | 81.55 / 0 / 0.09 / 0.04 / 5.18 | 83.20 / 0 / 0.04 / 0.04 / 3.35 |
| Hillenbrand m 75–125 | 3400 | 63.79 / 0 / 0.24 / 0.50 / 10.53 | 62.74 / 0 / 0.06 / 0.24 / 13.24 | 65.20 / 0 / 0.20 / 0.54 / 13.02 | 65.10 / 0 / 0 / 0.13 / 14.13 |
| Hillenbrand m 125–160 | 3495 | 60.31 / 0 / 0.17 / 0.17 / 9.56 | 59.57 / 0 / 0.03 / 0.23 / 11.30 | 64.20 / 0 / 0.13 / 0.33 / 8.50 | 63.63 / 0 / 0 / 0.17 / 9.83 |
| **Hillenbrand m all** | 7727 | **61.21** / 0.05 / 0.26 / 0.30 / 10.11 | **60.44** / 0.01 / 0.09 / 0.21 / 12.27 | 63.33 / 0 / 0.28 / 0.39 / 11.24 | 63.57 / 0 / 0.03 / 0.13 / 12.11 |
| PTDB f all | 4661 | 94.92 / 0.97 / 0.24 / 0.02 / 0.47 | 95.02 / 0.88 / 0.21 / 0.02 / 0.47 | 91.44 / 0.04 / 0.19 / 0.02 / 3.45 | 92.34 / 0.13 / 0.21 / 0.02 / 2.25 |
| FDA f all | 2640 | 87.69 / 0.87 / 0.30 / 0 / 1.44 | 87.61 / 0.64 / 0.27 / 0 / 2.35 | 86.00 / 0.04 / 0.38 / 0 / 2.34 | 86.77 / 0.15 / 0.31 / 0 / 1.61 |
| Hillenbrand f all | 9623 | 61.58 / 0.79 / 0.04 / 0 / 6.05 | 61.55 / 0.50 / 0.05 / 0 / 6.90 | 64.35 / 0.24 / 0.05 / 0 / 7.92 | 64.41 / 0.09 / 0.03 / 0 / 8.75 |
| vocadito < 400 | 21380 | 96.48 / 2.15 / 0 / 0 / 1.21 | 98.31 / 0.93 / 0.01 / 0 / 0.60 | 93.95 / 1.12 / 0 / 0 / 4.18 | 97.28 / 0.43 / 0 / 0 / 1.71 |
| vocadito_34 | 733 | 54.57 / 42.43 / 0 / 0 / 2.86 | 77.49 / 20.46 / 0 / 0 / 1.77 | 26.96 / 26.96 / 0 / 0 / 44.43 | 64.51 / 11.83 / 0 / 0 / 23.11 |
| vocadito ≥ 400 (sung) | 207 | 0.48 / 97.58 / 0 / 0 / 0.97 | 0.97 / 0 / 0 / 0 / 99.03 | 0 / 53.11 / 0 / 0 / 45.93 | 18.18 / 0 / 0 / 0 / 34.93 |

Decoded level, same groups: Hillenbrand m 61.23 → 60.44. Its decoded ×3/×4
rises 0.34 → 2.37, all above 400 Hz and posted unvoiced. PTDB m <125 / 125–160
×2 up goes 0.14 → 0.08 / 0.11 → 0.11; FDA m 0.13 → 0.04.

**Attribution, worker correct (posted).** Hillenbrand m: base 61.21, +gp
61.21, +oct 61.32, **+ceil 60.44**, +notch 60.44, combined 60.44. So the
whole −0.77 pp comes from the ceiling. vocadito_34 54.57 → 76.94 at +oct.
vocadito 96.48 → 98.15 at +oct, 98.31 at +notch.

| max(F_err, M_err) | base | combined |
|---|---|---|
| worker FDA / PTDB / Hillenbrand | 14.32 / 15.81 / 38.79 | 14.27 / 15.71 / **39.56** |
| displayed FDA / PTDB / Hillenbrand | 18.45 / 22.71 / 36.67 | 16.80 / 19.09 / 36.43 |

## 7. Noise

**Real chain, noise-only, 40 s per class, scored after 10 s**
(`build/so/noise_real.mjs`). Classes are the `scripts/noise-synth.js` set
plus the ceiling file's above-400 classes. The x0.05 and −35 dBFS levels give
identical numbers. Posted voiced % / painted %:

| class | base | combined |
|---|---|---|
| white, pink, brown, sleep-noise, mains, crickets, cicadas, whine-450 | 0 / 0 | 0 / 0 |
| sleep-birdies | 0.33 / 2.67 | 0.33 / 1.42 |
| resonant-noise (330) | 0.33 / 1.83 | 0 / 0 |
| fan-hum | 0.08 / 0.17 | 0.08 / 0 |
| resonant-500 / -650 | 0.17 / 0.75, 0.08 / 1.25 | 0 / 0, 0 / 0 |
| **whine-520 / -640** | **99.83 / 100**, **99.83 / 100** | **0 / 0**, **0 / 0** |

**Committed oracle,** `scripts/noise-augment-oracle.js pitch --frontend=tracker`
(FDA in noise; correct % / noise-only tail false voicing). The origin/main
copy of the script never applied the ghost veto (notch file §2), so the
baseline column comes from the branch script with the baseline notch API
(`activeFreqs`). That copy is `build/trees/base-full/scripts/noise-augment-oracle.parity.js`.

| cell | base | combined |
|---|---|---|
| clean | 86.8 | 86.8 |
| white 20 / 10 / 5 dB | 86.1 / 80.7 / 68.6 · 0.0 | 86.2 / 80.6 / 68.0 · 0.0 |
| pink 20 / 10 / 5 | 86.1 / 81.8 / 72.6 · 1.0 / 0.5 / 0.5 | 86.1 / 82.1 / 72.5 · 0.7 / 0.8 / 0.8 |
| **fan-hum** 20 / 10 / 5 | 69.4 / 69.3 / 68.4 · 0.0 / 0.1 / 0.0 | **78.0 / 77.8 / 76.7** · 0.0 / 0.1 / 0.0 |
| **mains** 20 / 10 / 5 | 65.1 / 65.1 / 65.0 · 0.0 | **77.7 / 77.9 / 77.9** · 0.0 |
| babble 20 / 10 / 5 | 85.6 / 71.9 / 55.0 · 91.0 / 98.1 / 98.1 | 85.5 / 72.2 / 55.7 · 92.1 / 97.8 / 97.8 |
| crickets 20 / 10 / 5 | 86.3 / 81.7 / 72.4 · 0.9 | 86.4 / 82.1 / 72.9 · 0.0 |
| cicadas 20 / 10 / 5 | 86.3 / 80.7 / 67.4 · 0.0 | 86.3 / 80.8 / 67.6 · 0.0 |

The babble tail is speech. Pink +0.3 pp tail false voicing is the ceiling's
documented guard-streak effect.

**Gender mode:** 31/31 on every cell in both trees, mean drift identical.
Noise-only VAD pass is identical except fan-hum 6 % → 0 %.

**`scripts/voicing-robustness-shootout.js`:** the shipped criterion
(`harm10deb4`) on noise-only voiced / painted:
- pink 0.3 / 0.0 → 0.9 / 0.3
- crickets 0.3 / 0.1 → 0.3 / 0.1
- every other class ≤ 0.6 / 0.3 in both trees
- speech: FDA 86.9 → 86.9, vocadito 97.1 → 98.8

Its no-criterion "baseline" row jumps on pink (6.3 → 37.9 % voiced) because
the shootout still searches to 800 Hz **without** the worker's above-400
null (follow-up listed in CLAUDE.md). The real-chain table above is the
production number: pink posted 0.

## 8. Held notes (notch voice safety)

The notch workstream's synthetic held-note grids ran through the real chain
(`build/so/held_real.mjs`); scored on the held portion within 8 % of f0.

| grid | base posted / painted | combined posted / painted |
|---|---|---|
| requirement (120 / 220 Hz, 8 / 12 / 20 / 30 s, 5 modulations × 3 qualities) ≤ 20 s | 44.0 / 48.7 (min 26.4) | **100.0 / 100.0 (min 100.0)** |
| requirement, 30 s notes | 22.0 / 24.5 | 70.6 / 72.4 (onset-born promotion at 20 s, by design) |
| main (150–300 Hz, 6–20 s, 8 modulations × 3 qualities) | 49.5 / 57.2 | 94.0 / 97.8 |

No configuration in either grid (585 distinct) paints less than baseline. The 32 main-grid configs
under 95 % are all 300 Hz breathy-/i/ (painted 89.2 % mean for 300 Hz; base
58.4 %).

## 9. Transients (globalPeak)

The globalpeak transient oracle (FDA concatenations plus excerpts of private
session recordings at speech peak P; clicks / pops / bumps, single / every
4 s / typing burst) ran through the real worker (`build/so/transient_real.mjs`).
The combined chain keeps the loss near zero in every cell except one new
interaction cell on above-range (> 400 Hz) content, far below the baseline's
worst cell. Results on the private session recordings are kept outside this repository.

## 10. Unit tests, lint, build, CPU

- `tests/dsp/boersma-ac-test.js` 41/41
- `tests/dsp/pitch-worker-above-range-test.js` 7/7
- `tests/dsp/noise-notch-test.js` 36/36
- `tests/audio/pitch-gate-test.js` 26/26
- `tests/audio/pitch-paint-gate-test.js` 36/36
- `tests/audio/pitch-smoothing-test.js` 15/15
- `tests/audio/pitch-smoothing-octave-shift-harness.js` exit 0
- `tests/ml/audio-utils-test.js` 67/67
- `tests/dsp/cpp-test.js` 28/28
- vocal-weight aggregator 42/42, baseline 56/56
- `tests/dsp/formant-debug.js` passes
- `npm run test:dsp` passes
- `npm run lint` clean; `npm run build` succeeds
- **CPU:** real pitch worker, which includes resampler + notch + AC + tracker
  + guard. 5 min of speech audio, base and combined interleaved ×3 on an idle
  machine: **0.741 → 0.730 ms per 25 ms chunk** (runs 0.735 / 0.732 / 0.757
  vs 0.761 / 0.692 / 0.736). That is flat and ≪ the hop.

## 11. Fallbacks (measured cumulatively, in the mandated order)

Trees: `fb1` = combined + octave arbitration only on contested pairs
(`octaveEvidence.maxContestDelta: 0.05`: skip a pair when the pre-penalty
|s(f) − s(2f)| ≥ 0.05). `fb12` = fb1 + `maxPitchHz` 600, keeping the
above-400 null. `fb123_10/12` = fb12 + `EXCURSION_SUSTAIN` 10 / 12.

| config | Hil m worker correct | max(F,M) Hil worker | verdict |
|---|---|---|---|
| base | 61.21 | 38.79 | — |
| combined | **60.44** | **39.56** | FAIL (2) |
| (i) fb1 | **60.37** | **39.63** | FAIL (2) |
| (i)+(ii) fb12 | **60.61** | **39.39** | FAIL (Hil m −0.60) |
| (i)+(ii)+(iii) sustain 10 | **60.61** | **39.39** | FAIL (Hil m) |
| (i)+(ii)+(iii) sustain 12 | **60.61** | **39.39** | FAIL (Hil m) |

(The strict low-band guard fails for combined and fb1 and passes from fb12
on; that column and the target-voice / switch columns were scored on the
private session recordings and are kept outside this repository.)

Other fb12 numbers:
- Hillenbrand m decoded 60.61, displayed 63.85.
- PTDB m worker 84.23; FDA m 85.64.
- vocadito_34 worker 75.03 (combined 77.49).

The fallbacks give up target-voice accuracy (private session recordings).
Even so, the Hillenbrand-men worker guard still fails at −0.60. (iii) is
display-only, so it cannot reach a worker-level guard, and it costs target
painted correct and L→T never-shown. **Stopped: no configuration passes,
and none is adopted.**

## 12. Open decisions and risks (for a human)

**Decision (2026-10-04, user): ship as integrated.** Both worker-level guard misses are accepted because every displayed (user-visible) metric improves, including the displayed gender-symmetric max(F_err, M_err) on all three corpora; the 600 Hz and 400 Hz alternatives were offered with these numbers and declined (the 600 Hz option still misses the Hillenbrand-men guard and reopens 600–800 Hz half-pitch aliasing). Items 1–2 below are kept as the record of what was decided.

1. **Hillenbrand men worker-level −0.77 pp** (the 800 Hz ceiling). It is
   correct → null on vowel-onset 3f/4f locks. The displayed level is +0.24
   and the posted ×3/×4 rate falls. The 600 Hz fallback still misses (−0.60
   with (i)) and reopens the 600–800 Hz alias class (ceiling file §2).
   Options:
   - accept a displayed-level guard for this class; or
   - keep 800 and add an onset-specific remedy (unmeasured); or
   - revert to 400 and lose the ≥ 400 fix (measured on the private session
     recordings).
2. **Low-voice octave-up under strict R1&CC** (worker level; passes under
   the consensus convention and on the displayed trace). On most of the
   flipped frames the arbiter says the upper octave is real. Options:
   - adjudicate those frames by listening; or
   - accept on the displayed / held-out evidence; or
   - adopt fallback (i)+(ii), which passes it but fails item 1.
3. **Up-spike events per voiced minute rise**; total wrong-octave
   events are flat. These are painted segments, not strokes. Not a listed
   guard.
4. **Posted low-band correct falls** from the same ceiling mechanism as
   item 1; the displayed level rises.
5. **Harnesses still lack the above-400 null:** `ac-tuning-sweep.js`,
   `pitch-shootout-extract.js`, `pitch-accuracy-decompose.js`,
   `pitch-excursion-*` and `voicing-robustness-shootout.js` search to 800
   without it. Use the session oracle for production numbers.
6. **A new transient interaction cell** (§9), on above-range content. It is
   far below the baseline's worst cell.
(Items 2–4 and 6 were measured on the private session recordings; results
kept outside this repository.)

## 13. Reproduce

Committed oracle (outputs in gitignored `build/session-oracle/`). The
session steps (`build_refs.py`, `run.mjs` per tree × session, `analyze.py`)
need the private session recordings (`$SYRINX_SESSIONS_DIR`, not in this
repo) and are omitted here:

```bash
# trees: baseline + every cumulative prefix (HEAD src = combined)
for c in f92b11a:base cb483ab:gp 1039832:oct 0b0616c:ceil bc42ad0:notch 39bd0ff:disp; do
  mkdir -p build/trees/${c#*:} && git archive ${c%%:*} src | tar -x -C build/trees/${c#*:}; done
# corpora (shards per corpus: fda 2, hil 2, ptdb 6, voc 4)
node --import ./scripts/session-oracle/lib/register.mjs scripts/session-oracle/corpus.mjs \
  --corpus=hil --src=build/trees/disp/src --tag=disp --shard=0/2      # ... every corpus/shard/tree
node scripts/session-oracle/corpus.mjs --report=base,gp,oct,ceil,notch,disp
```

Fallback trees: copy `build/trees/disp` and apply the edits in §11. They are
in `boersma-ac.js` (`maxContestDelta` check in the octave-pair loop;
`maxPitchHz`) and `pitchPaintGate.js` (`EXCURSION_SUSTAIN`).

The other guards run from scratch scripts in the worktree's gitignored
`build/so/`. They use the committed `lib/chain.mjs`, plus the phase-1 synth
and globalpeak sources under the main checkout's
`build/investigate-2026-10-03/` and `build/measure-2026-10-03/`:

```bash
R="node --import ./scripts/session-oracle/lib/register.mjs"
$R build/so/held_real.mjs --src=build/trees/disp/src --set=main --out=held_main_disp.json   # and --set=req, base tree
$R build/so/noise_real.mjs --src=build/trees/disp/src --out=noise_real_disp.json
node scripts/noise-augment-oracle.js pitch --frontend=tracker                 # combined (HEAD)
node build/trees/base-full/scripts/noise-augment-oracle.parity.js pitch --frontend=tracker   # baseline, veto parity
node scripts/noise-augment-oracle.js gender ; node scripts/voicing-robustness-shootout.js    # each tree
```

## 14. Final integrated chain (2026-10-05)

**What is measured:** the pitch PR branch `target-voice-pitch-fix` as it will be proposed, after
merging, in order:

1. `pitch-display-reacquire` (df497b9 + bd89dc1 + 90d00a8): faster target pickup after a register
   switch — value-preserving median restart, raw-agreement accept, `EXCURSION_SUSTAIN` 8 → 7, and the
   real-hook test ([pitch-display-reacquire-2026-10-04.md](pitch-display-reacquire-2026-10-04.md) §10);
2. `pitch-low-register-precision` (a81f333 + 7b12c21): measurement-only, no `src/` change;
3. `pitch-merge-prep` (0ac9e29 = 5ebe609 + origin/main @1946e72: #95 bug batch, #96 formants/HNR,
   #97 CI / `dist/` / `test:unit`). origin/main had not moved past 1946e72.

The notch is bc42ad0's module (7ebec37, round 2 of
[noise-notch-held-note-robustness-2026-10-04.md](noise-notch-held-note-robustness-2026-10-04.md)).
Tree `final` = `git archive <merge HEAD> src`. **Baseline = `base`** (origin/main src at f92b11a,
this file's baseline; runs reused). `disp` = the 2026-10-03 combined chain (§2–§7), for reference.

**Worker parity.** On the private session recordings the `final` tree's
worker and DSP columns (frame-local, top candidate, unvoiced strength,
decoded, posted, confidence, notch count, intensity) are **bit-identical to
`disp`** on every hop. So main's #95–#97 (incl. the dsp-worker
formants/HNR split) and the notch round trip back to bc42ad0 change nothing
upstream of the display, and every session difference is the display
chain. The corpus worker level is likewise identical to `disp` in every
group.

### 14.1 Sessions

The session-oracle tables for the final chain (target band, low voice,
register switches and events, second voice, ≥ 400 Hz) were scored on the
private session recordings. Results on the private session recordings are kept outside this repository.

### 14.2 Corpora (real chain per file)

The worker level is identical to the 10-03 combined chain in every group (§6). Displayed correct %,
base → final:

| PTDB m | FDA m | Hil m | PTDB f | FDA f | Hil f | vocadito < 400 | vocadito_34 |
|---|---|---|---|---|---|---|---|
| 77.29 → 80.93 | 81.55 → 83.29 | 63.33 → 63.58 | 91.44 → 92.30 | 86.00 → 87.19 | 64.35 → 64.41 | 93.95 → 97.34 | 26.96 → 65.47 |

vocadito_34 displayed octave-down goes 26.96 → 12.93 %. Displayed ×2 octave-up: PTDB m 0.11 → 0.15
(combined 0.15; the < 125 and 125–160 bands are 0.03 → 0.03 and 0 → 0), FDA m 0.09 → 0.04, Hil m
0.28 → 0.03.

| max(F_err, M_err) | base | 10-03 combined | **final** |
|---|---|---|---|
| worker FDA / PTDB / Hillenbrand | 14.32 / 15.81 / 38.79 | 14.27 / 15.71 / 39.56 | **14.27 / 15.71 / 39.56** |
| displayed FDA / PTDB / Hillenbrand | 18.45 / 22.71 / 36.67 | 16.80 / 19.09 / 36.43 | **16.71 / 19.07 / 36.42** |

**vocadito / v34 vs the reacquire file.** The reacquire file (§10.4) reports v34 displayed 67.26 %
with octave-down 11.69 %, and vocadito 97.43 %, on 5ebe609's worker. The final tree reads 65.47 /
12.93 and 97.34. A tree equal to `final` but with 5ebe609's `noise-notch.js` (`final_n5`, vocadito
only) reproduces the reacquire numbers exactly: v34 posted 78.72, displayed 67.26; vocadito
displayed 97.43. So the difference is the round-2 notch revert to bc42ad0 on sung held notes, not
the display: v34 posted 77.49 vs 78.72, displayed −1.79 pp. Both trees remain far above base (v34
26.96, vocadito 93.95).

### 14.3 Noise

- **`scripts/noise-augment-oracle.js pitch --frontend=tracker`** (FDA in noise; correct % and
  noise-only tail false voicing). Every cell equals the 10-03 combined column of §7 except one: pink
  tail false voicing is now **0.0 / 0.0 / 0.0 %** at 20 / 10 / 5 dB (10-03: 0.7 / 0.8 / 0.8; base
  1.0 / 0.5 / 0.5). The cause is 1724c4f: the oracle's flushed tail frames now go through veto →
  above-range null → guard, as the worker does. So the 10-03 pink parity note no longer applies.
  fan-hum 78.0 / 77.8 / 76.7 and mains 77.7 / 77.9 / 77.9 (base 69.4 / 69.3 / 68.4 and 65.1 / 65.1 /
  65.0).
- **`gender`:** identical to the 10-03 combined run on every cell (accuracy, drift, noise-only VAD
  pass). fan-hum VAD pass is 0 % (base 6 %). The oracle mirrors main's current VAD (silence floor +
  voiced gate).
- Real-session false voicing (`session_fv.py`) was not re-run on the merged
  tree; the worker is bit-identical to the combined chain (the display
  change's real-session false-voicing check is kept outside this
  repository).

### 14.4 Checks

- `npm run lint` clean.
- `npm run test:unit`: **18 / 18** scripts pass, incl. `display-hook-test.js` 20 / 20,
  `pitch-paint-gate-test.js` 112 / 112, `noise-notch-test.js` 56 / 56 (the held-note gaps print as
  KNOWN LIMITATION lines), `pitch-worker-above-range-test.js` 7 / 7, `boersma-ac-test.js` 41 / 41,
  `export-import-test.js`, `session-stats-test.js`, `hnr-test.js` 109 / 109 and
  `formant-accuracy-test.js`.
- `npm run test:dsp` passes (streaming verify, formant accuracy at 16 / 44.1 / 48 kHz, formant-debug,
  cpp 28 / 28, hnr 109 / 109).
- `npm run build` succeeds (to `dist/`, deleted afterwards; nothing committed).
- `node scripts/paint-gate-glide-validate.js --skip-session` exits 0 under `EXCURSION_SUSTAIN` 7: a
  4-frame lock paints 0 frames, so the gate-level contract "locks shorter than `EXCURSION_SUSTAIN`
  never paint" holds.
- CPU: the session runs reported 1.0–3.3 ms per chunk, but they ran 4-way parallel on a machine at
  ~94 % CPU with corpus shards alongside. That is not comparable to §10's idle 0.730 ms. The worker
  is bit-identical to the combined chain, and the display change is O(1) per frame.

### 14.5 Guards, and the user-accepted exceptions

| guard | final | verdict |
|---|---|---|
| session-recording guards: target band improves; low-voice octave-up ≤ +0.3 pp | kept outside this repository | target band PASS; strict low-voice octave-up **FAIL, user-accepted 2026-10-04** (unchanged by this merge) |
| Hillenbrand men worker correct ≥ −0.5 pp | 61.21 → 60.44 (−0.77) | **FAIL, user-accepted 2026-10-04** (unchanged) |
| worker max(F_err, M_err), Hillenbrand | 38.79 → 39.56 | **FAIL, the same accepted mechanism** |
| displayed max(F_err, M_err), all three corpora | 18.45 → 16.71, 22.71 → 19.07, 36.67 → 36.42 | PASS |
| male corpora octave-up | worker as combined; displayed FDA m and Hil m down, PTDB m 0.11 → 0.15 (= combined) | PASS (as combined) |
| female corpora / vocadito, no regression vs base | all up. v34 is −1.79 pp vs the reacquire file (the notch revert), still +38.5 pp vs base | PASS |
| noise-only false voicing, gender VAD | ≤ base in every class; pink tail 0 | PASS |
| unit tests, lint, build, test:dsp, glide validate | all pass | PASS |

Not re-run on the merged tree, because their inputs are unchanged: the held-note grids (§8; the
notch is bc42ad0, as measured there and by the round-2 held-note suite), the transients (§9; the
worker is bit-identical) and real-session false voicing (above).

Reproduce: §13 with `final` as the tree (`git archive HEAD src`), then
`node scripts/session-oracle/corpus.mjs --report=base,disp,final` (the
session comparison, `python scripts/session-oracle/analyze.py base disp
final`, needs the private session recordings).
