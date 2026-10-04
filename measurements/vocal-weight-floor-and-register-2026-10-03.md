# Vocal weight: MIN_VOICED_FRAMES floor + pitch-register confound — 2026-10-03

**Verdicts.** (1) `MIN_VOICED_FRAMES = 4` in `src/audio/vocal-weight-aggregator.js` now means **~100 ms** of pitched phonation per 1-s aggregate (CPP has run on every 25 ms DSP frame since c57b2a2), not the ~600 ms its comment claimed. Re-measured under the current chain, restoring 600 ms costs far more calibration time than it buys in needle stability, so **the value is deliberately kept at 4; only the comment changes.** (2) The gauge's pitch-register confound is **confirmed**: production CPP reads Alice's raised voice **+0.6…+1.4 σ lighter** than her low voice, while Praat CPPS moves the **opposite** way; both shifts are what each instrument's own F0 dependence predicts at constant voice quality. Register differences on the gauge must not be read as vocal-weight differences without F0 normalization. **Report only — no gauge change.**

Items from the 2026-10-03 half-pitch investigation's DSP bug batch. Claims verified: (a) the floor was tuned (e533b2e, 6 → 4) while CPP still ran every 6th frame, where 4 frames ≈ 600 ms, and CPP went per-frame seven minutes later; (b) Alice's raised voice reads "lighter" on the gauge while Praat CPPS moves the other way.

Harnesses are scratch (gitignored, not committed) in `build/measure-2026-10-03/hnr-vocalweight/` of the investigating checkout. They drive the **real** production modules: `src/dsp/pitch-worker.js` (Boersma-AC + notch + harmonic guard), `evaluateFrameGate` (`src/audio/pitchGate.js`), `computeCPP` (`src/dsp/cpp.js`), `VocalWeightAggregator` and `VocalWeightBaseline`, in the exact `useAudioPipeline.js` order. Praat CPPS uses `To PowerCepstrogram` / `Get CPPS` with the `scripts/praat-cpps-corpus.py` parameters. The HNR half of the same measurement pass is [hnr-window-corrected-2026-10-03.md](hnr-window-corrected-2026-10-03.md); the HNR change does not touch CPP or the vocal-weight path (CPP bit-identical on every frame in its production-path check).

## 1. The MIN_VOICED_FRAMES claim — confirmed

Attempted refutations, all failed:

1. **Ordering.** `measurements/calibration-timing-corpus-2026-05-10.json`
   timestamp 2026-05-10T15:36:27Z = 10:36 CDT; e533b2e (MIN_VOICED_FRAMES
   6 → 4) 10:37 CDT; c57b2a2 (CPP every frame) 10:44 CDT. The tune and its
   data predate the cadence change.
2. **Harness.** tests/audio/calibration-timing-corpus.js still hard-codes
   `CPP_FRAME_DIVISOR = 6`. A scratch copy (`calib-repro.mjs`, output
   redirected away from measurements/) with `CPP_DIV=6` reproduces the JSON
   **exactly** (MVF 6: combined median 64.78 s, p75 67.17; MVF 4: 39.42 s,
   p75 50.42; all per-corpus quantiles identical) — baseline match.
3. **Production cadence.** Both capture paths emit 25 ms chunks
   (captureSource.js `chunkMs ?? 25`; MSTP re-chunks hardware frames), one
   DSP analysis per chunk, and production pushes every frame with
   `voiced: hasPitch` and the per-frame CPP. 4 frames = **100 ms** of pitched
   phonation in the 1-s window (the source comment says "~600 ms, ~67 %").
4. **Does it matter at all in the old regime?** `CPP_DIV=1` in the same
   (SwiftF0, !isQuiet) harness: MVF 6 → 36.90 s, MVF 4 → 36.60 s — at 40 fps
   the floor is nearly irrelevant to lock time in that regime.

## 2. Floor sweep under the CURRENT chain

`vw-frames.mjs` runs the **real** src/dsp/pitch-worker.js (Boersma-AC +
notch + harmonic guard, fresh `init` per track), the real
`evaluateFrameGate` (pitchGate.js) for `hasPitch`, and the real
`computeCPP` on the dsp-worker 50 ms window every frame (resetCppState per
track). `vw-replay.mjs` / `vw-floor-eval.mjs` replay the real
`VocalWeightAggregator` (minVoicedFrames override) and `VocalWeightBaseline`
in the exact useAudioPipeline order (push every frame; fresh emit AND
hasPitch → accumulate). Tracks: the calibration-timing corpus selection (4
vocadito pairs, 4 PTDB-TUG speakers, 2 FDA speakers, per-speaker
concatenations, uncapped) + the three Alice sessions (mixed speakers, full
length). 25 ms frames ⇒ floor F frames = 25·F ms, so the frame floor and a
time floor are the same thing here.

Metrics: **lock** = wall-clock s to `baseline.ready()`; **needle error** =
at every hasPitch frame the gauge shows the latest emit; error =
(shown − consensus)/σref, consensus = median of ≥600 ms-voiced emits within
±2 s, σref = SD of those emits over the track (common to all floors);
**Δμ, σx** = frozen baseline μ shift (σref units) and σ ratio vs floor 24.

| group | floor | lock median (per track) | |err| med | |err|>1σ | >1σ heavy | Δμ | σx |
|---|---|---|---|---|---|---|---|
| Alice sessions (3) | **4 (100 ms)** | **65.0 s** [44, 70, 65] | 0.399 | 18.6 % | 11.9 % | −0.11 | 1.19 |
| | 12 (300 ms) | 70.0 s [47, 79, 70] | 0.394 | 17.3 % | 11.2 % | −0.13 | 1.15 |
| | 24 (600 ms) | 84.7 s [64, 102, 85] | 0.368 | 15.0 % | 9.4 % | 0 | 1.00 |
| PTDB-TUG (4) | **4** | **118.9 s** [113, 119, 114, 189] | 0.534 | 29.1 % | 15.2 % | +0.36 | 1.17 |
| | 12 | 139.8 s [120, 140, 133, 217] | 0.536 | 29.3 % | 19.6 % | +0.20 | 1.04 |
| | 24 | 185.2 s [148, 185, 187, DNF] | 0.492 | 25.6 % | 19.4 % | 0 | 1.00 |
| FDA (2) | **4** | **79.6 s** [80, 65] | 0.694 | 36.4 % | 23.1 % | +0.06 | 1.36 |
| | 12 | 85.2 s [85, 65] | 0.669 | 32.9 % | 22.3 % | 0.00 | 1.06 |
| | 24 | 125.8 s [126, 123] | 0.584 | 28.1 % | 21.4 % | 0 | 1.00 |
| vocadito (4) | **4** | **38.1 s** [36, 38, 45, 38] | 0.476 | 22.4 % | 15.1 % | −0.11 | 1.11 |
| | 12 | 40.6 s | 0.478 | 23.9 % | 16.5 % | −0.14 | 1.12 |
| | 24 | 43.8 s | 0.451 | 22.1 % | 14.6 % | 0 | 1.00 |

(Floors 8/16/20 in `vwfloor_final.log`; monotone between these rows.)

Per-emit view at floor 4 (`vw-bucket.mjs`; deviation from the same
consensus, σ = the track's frozen σ):

| group | emits 100–275 ms voiced | their |dev| med | their signed mean | emits ≥600 ms |dev| med |
|---|---|---|---|---|
| Alice sessions | 13.8 % | 1.24–1.60 σ | −1.16…−1.19 σ | 0.42 σ |
| PTDB-TUG | 24.3 % | 1.09–1.59 σ | −0.43…−1.12 σ | 0.40 σ |
| FDA | 20.0 % | 1.00–1.66 σ | −0.52…−0.83 σ | 0.45 σ |
| vocadito | 3.8 % | 1.82–2.28 σ | −1.55…−2.26 σ | 0.48 σ |

Low-voiced-content emits are real (phrase-edge windows, onsets/offsets) and
read heavier, but because a higher floor *holds the previous emit* rather
than showing something better, the displayed-needle gain is small.

**Decision: do not change MIN_VOICED_FRAMES** (keep 4; fix the
comment — it documents a 600 ms meaning that has not been true since
c57b2a2). A 600 ms floor buys −3.6 pp (Alice) / −3.5 pp (PTDB) / −8.3 pp
(FDA) of >1σ needle excursions and a 1.1–1.4× less inflated frozen σ, at
+20 s / +66 s / +46 s median calibration time (calibration is already the
slowest part of the gauge UX) and a never-calibrating PTDB speaker. 300 ms
is a near-null trade either way (−1.3 pp Alice, +5 s). The landed change
is comment-only.

Side finding (not a proposal): lock time is set by the 30 s voiced-content
requirement × the hasPitch fraction (PTDB hasPitch 16–25 %, FDA 40–43 %,
Alice sessions 49–56 %, vocadito 61–77 %), not by the floor; a "≥10 new
voiced frames since last accepted emit" acceptance rule calibrates *slower*
(Alice 44 → 59 s, PTDB 113 → 155 s), so the current hasPitch-on-emit rule
is not the bottleneck either (`vw-lockdiag.mjs`).

## 3. Register confound (report only)

Alice, register-pure 1-s bins (≥80 % of Alice frames on one side of 160 Hz;
phase-1 per-frame production CPP dumps; Praat CPPS on the same 1 s of audio,
fit method "Robust" instead of "Robust slow" for speed — 11.02 vs 11.79 dB
on a probe bin), shift raised − low in units of the low-voice bin SD:

| session | F0 low / raised | production CPP shift | Praat CPPS shift | r(prod, Praat) all bins |
|---|---|---|---|---|
| 2025-09-08 | 113 / 226 Hz | **+1.21 σ** (1.04 → 1.28 dB) | **−1.50 σ** (19.0 → 14.4 dB) | −0.03 |
| 2026-05-26 | 110 / 209 Hz | **+0.63 σ** (0.65 → 0.77) | **−0.84 σ** (13.6 → 11.9) | 0.35 |
| 2026-06-09 | 111 / 241 Hz | **+1.00 σ** (0.63 → 0.80) | **−0.98 σ** (13.9 → 12.1) | 0.46 |

Through the full production gauge (`vw-register.mjs`: real chain, Alice-only
stream, real aggregator + frozen baseline), median σDelta raised vs low:
+0.22 vs −0.64 (Δ **+0.86 σ**), +1.04 vs −0.41 (Δ **+1.44 σ**), +1.15 vs
−0.22 (Δ **+1.37 σ**); raised emits sit in the "lighter" zone (≥ +0.5 σ)
38 / 69 / 67 % of the time vs 14 / 24 / 27 % for low-voice emits. The claim
(+0.6…+1.3 σ lighter; Praat opposite) is **confirmed**, slightly larger
through the real gauge.

Mechanism check on synthetic stimuli with **fixed** true HNR
(`cpp-synth.mjs` + `cpp_synth_praat.py`, vowel spectrum): production CPP at
16 kHz, HNR 15 dB: 100 Hz 0.85 → 130 Hz 1.07 → 160 Hz 1.14 → 200 Hz 1.11 →
250 Hz 0.99 dB (HNR 25: 1.19 → 1.47 → 1.59 → 1.59 → 1.47); Praat CPPS at
the same points: 19.7 → 19.5 → 18.0 → 15.8 → 13.3 dB. Interpolating to
Alice's ~110 → ~225 Hz registers at constant voice quality predicts
production **+0.7…+1.6 σ** and Praat **−1.7…−2.5 σ** — the observed shifts
are within what each instrument's own F0 dependence produces with no change
in voice quality at all. Neither the production gauge nor Praat CPPS can be
read as a cross-register vocal-weight comparison without F0 normalization.
No gauge redesign proposed here.

## What landed

`src/audio/vocal-weight-aggregator.js`: comment-only. The `MIN_VOICED_FRAMES` comment now states the current meaning (4 frames = 100 ms at per-frame CPP), the history (tuned at the 6th-frame cadence; c57b2a2 changed the cadence without revisiting it) and the 2026-10-03 cost/benefit numbers for keeping 4. The file header and the frame-ring comment also stop describing the 6.7 Hz cadence. `tests/audio/vocal-weight-aggregator-test.js` and `tests/audio/vocal-weight-baseline-test.js` pass unchanged.

## Open items

- `tests/audio/calibration-timing-corpus.js` is stale on three axes: SwiftF0 confidence + `!isQuiet` voicing where production uses Boersma-AC + `hasPitch`; `CPP_FRAME_DIVISOR = 6`; and every run overwrites the tracked `measurements/calibration-timing-corpus-2026-05-10.json`. `vw-frames.mjs` + `vw-floor-eval.mjs` (scratch) are the current-chain replacement.
- F0-normalized vocal weight (§3) — a design question, not scoped here.

## Reproduction

From `build/measure-2026-10-03/hnr-vocalweight/` (scratch; Node ≥ 20, Python with parselmouth / numpy / scipy / pandas / soundfile; the session steps need the Calliope session audio + labels):

```
CPP_DIV=6 node calib-repro.mjs; CPP_DIV=1 node calib-repro.mjs
MAXS=100000 node vw-frames.mjs corpora
for s in 2025-09-08 2026-05-26 2026-06-09; do node --max-old-space-size=4000 vw-frames.mjs session $s; done
TAG=final node vw-floor-eval.mjs vwframes_corpora_full.json vwframes_2025-09-08.json vwframes_2026-05-26.json vwframes_2026-06-09.json
node vw-bucket.mjs vwframes_corpora_full.json vwframes_2025-09-08.json vwframes_2026-05-26.json vwframes_2026-06-09.json
node vw-lockdiag.mjs vwframes_corpora.json vwframes_2025-09-08.json vwframes_2026-06-09.json
node cpp-synth.mjs && python cpp_synth_praat.py
for s in 2025-09-08 2026-05-26 2026-06-09; do python cpp_register_praat.py $s; done
python export_alicemask.py && node vw-register.mjs
```
