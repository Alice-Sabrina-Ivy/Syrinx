# HNR: window-corrected autocorrelation (Boersma 1993) — 2026-10-03

**Verdict: the production HNR measured mostly F0, not noise. Replaced with Praat's window-corrected autocorrelation method in a new module, `src/dsp/hnr.js`, on a 70 ms frame.**

> **User-visible consequence — HNR values are not comparable across this change.** Displayed HNR, per-frame stored HNR and session `avgHnr` all rise: on running speech typically by **~4–6 dB** (aggregate over the private session recordings, whose per-session numbers are kept outside this repository; corpus means move +4.6 dB for FDA men and more for higher-HNR voices), on clean singing by up to ~+9.7 dB (vocadito, §7). Sessions recorded before 2026-10-03 are on the old scale. **No migration is possible**: the old value is a lossy, F0-dependent, clamped function of audio Syrinx does not store, so old sessions cannot be re-scored. Suggested user-facing note: "HNR is now computed with Praat's method; values are ~4–6 dB higher than before 2026-10-03."

Item from the 2026-10-03 half-pitch investigation's DSP bug batch (on the dashboard side, not the pitch trace). The old `computeHNR` in `src/dsp/dsp-worker.js` took the raw, unwindowed, biased autocorrelation of the 50 ms analysis frame (capped at 2048 samples), took the max over lags sr/600..sr/75, clamped it at 0.99 and reported `10·log10(r/(1−r))`. A biased ACF's periodic peak is scaled by the lag overlap `(n−T)/n`, so the number mostly encodes F0. Claim to verify (phase-1 probe): a perfectly periodic 100 Hz complex reads ~5 dB, 300 Hz ~10.7 dB.

Harnesses are scratch (gitignored, not committed) in `build/measure-2026-10-03/hnr-vocalweight/` of the investigating checkout; the landed regression guard is `tests/dsp/hnr-test.js`. References: parselmouth 0.4.x `to_harmonicity_ac(0.01, 75, 0.1, 4.5)` (Praat's harmonicity defaults with the pitch detector's 75 Hz floor). Code baseline: 41f73d8 (its `src/` tree is identical to f92b11a, which this change lands on). The vocal-weight half of the same measurement pass is [vocal-weight-floor-and-register-2026-10-03.md](vocal-weight-floor-and-register-2026-10-03.md).

## 1. Harness and baseline match

- `gen-prod.mjs` writes `prod-dspw.mjs`, a byte copy of
  src/dsp/dsp-worker.js with only the cpp.js import path rewritten and an
  `export { computeHNR, fft, computeIntensity }` line appended, so `prod` in
  every table below **is** the production function.
- Baseline match: `baseline-match.mjs` re-runs the phase-1 synthetic probe
  (build/investigate-2026-10-03/bugs-dsp/p6-hnr.mjs, same generator and seed)
  through the mirror: **max |mirror − phase-1| = 0.0 dB over all 36 rows**.
  The phase-1 claim reproduces: true HNR 40 dB reads **5.37 dB at 100 Hz and
  10.64 dB at 300 Hz** (48 kHz); 3.97 dB at 80 Hz.
- Production-path check (`prodpath-check.mjs`): the *proposed*
  dsp-worker.js, driven through its real `init` → `port` → `processChunk`
  sequence in Node (fake `self`) in 25 ms chunks, posts HNR values
  identical to the harness's `prop` column (max diff 5e-4 dB = the
  harness's rounding; 0 null mismatches on HNR frames) at 48, 44.1 and
  16 kHz. (Run on private session audio; the landed tree's check on
  Hillenbrand audio is under What landed.)

Framing everywhere: window ends every 25 ms (the DSP chunk cadence);
Praat values taken at the nearest 10 ms frame to each variant's
analyzed-span center.

## 2. Variants

| name | what |
|---|---|
| `prod` | production (unwindowed biased ACF, max of r, clamp 0.99 ⇒ HNR never > 19.96 dB) |
| `fixed` (50 ms) | mean removal + Hann + divide by window ACF + local-max + parabolic interp + Praat reflection (r>1 → 1/r), production's 50 ms / ≤2048-sample frame |
| ablations | `v_noInterp`, `v_globalMax` (= phase-1 p6-fix candidate), `v_noWinCorr`, `v_noReflect` |
| `w60` | `fixed` on a 60 ms frame (Praat's 4.5 periods at 75 Hz) |
| **`prop`** | **`src/dsp/hnr.js` as landed**, on a 70 ms frame; FFT length adaptive (next pow2 ≥ n + maxLag + 2: 4096 at 44.1/48 kHz, 2048 at 16 kHz, 8192 at 96 kHz); lag search to sr/75 **+ 2** (Praat-style headroom) |

## 3. Synthetic, known HNR (synth.py: harmonics < 7.8 kHz, random phases, `saw` = 1/k, `vowel` = 1/k² source through /a/ formants; white noise at exact power ratio; HNR 0–25 dB × F0 80–400 Hz × 2 spectra; 1 s each)

Bias / MAE / F0 range of the per-F0 mean error (dB), vs TRUE HNR:

| variant | 16 kHz | 44.1 kHz | 48 kHz |
|---|---|---|---|
| Praat (reference) | +0.34 / 0.34 / 0.34 | +0.31 / 0.31 / 0.10 | +0.31 / 0.31 / 0.09 |
| **prod** | **−7.06 / 7.06 / 5.14** | **−7.26 / 7.26 / 5.27** | **−7.56 / 7.56 / 5.74** |
| fixed (50 ms) | +0.42 / 0.42 / 0.97 | +0.40 / 0.40 / 0.87 | +0.38 / 0.48 / 0.81 |
| v_noWinCorr | −6.30 / 6.30 / 8.76 | −6.68 / 6.69 / 9.22 | −7.19 / 7.19 / 9.72 |
| v_noReflect | +0.44 / 0.45 / 1.13 | +0.56 / 0.56 / 2.12 | +0.89 / 0.89 / 4.94 |
| v_noInterp ≡ v_globalMax | +0.38 / 0.40 / 0.99 | +0.32 / 0.35 / 0.88 | +0.36 / 0.47 / 0.86 |
| w60 | +0.25 / 0.26 / 0.38 | +0.17 / 0.19 / 0.14 | +0.12 / 0.19 / 0.46 |
| **prop (70 ms)** | **+0.17 / 0.20 / 0.31** | **+0.13 / 0.14 / 0.17** | **+0.12 / 0.16 / 0.28** |

Production per-F0 (vowel, 48 kHz, true 0/10/20/25 dB): 80 Hz → −2.6 / 2.4 /
3.4 / 3.5 dB; 400 Hz → −0.3 / 7.8 / 11.4 / 11.8 dB. It saturates near
3.5–12 dB depending on F0 and is ~insensitive to the noise level above
~10 dB. Window correction is the load-bearing part (dropping it leaves a
−7 dB bias and a 9 dB F0 range); reflection matters at 48 kHz.

**Pulse-like low voices** (synth_pulse.py: zero-phase cosine harmonics, 1/k²
or 1/k, /a/ formants, F0 75–160 Hz, HNR 10–30 dB — the worst case for the
window correction and the closest to glottal excitation). MAE / max |error|
vs true, dB:

| | Praat | prod | w60 | w70 | w80 | **prop (70 ms + headroom)** |
|---|---|---|---|---|---|---|
| pulse12, 16 kHz | 0.26 / 1.64 | 14.45 / 25.7 | 0.49 / 5.03 | 0.14 / 1.33 | 0.07 / 0.39 | **0.14 / 1.33** |
| pulse6, 16 kHz | 0.26 / 1.67 | 14.57 / 26.6 | 0.54 / 4.04 | 0.15 / 1.57 | 0.14 / 1.28 | **0.14 / 1.57** |
| pulse12, 48 kHz | 0.17 / 0.66 | 15.24 / 26.6 | NaN* | NaN* | NaN* | **0.08 / 0.71** |
| pulse6, 48 kHz | 0.14 / 0.83 | 15.39 / 26.8 | 3.15 / 29.4* | 2.89 / 29.4* | 2.86 / 29.4* | **0.14 / 1.93** |

\* w60/w70/w80 here are the generic prototype *without* the +2-lag headroom:
at 48 kHz an F0 of exactly 75 Hz puts the ACF peak on the last searched lag
(640), it is not an interior local maximum, and the frame reads −8…−29 dB or
null. The +2 headroom (as Praat's `maximumLag = … + 2`) fixes it (prop: 0.0 /
0.0 / +0.1 at 75 Hz).

**Frame-length resonance (why 70 ms, not Praat's 60 ms).** With a Hann
window + window-ACF division, frames spanning ~4.6–5.0 periods of F0 show a
phase-dependent correction error of ±0.2–0.4 % in r (direct computation,
`dbg-80.mjs`: clean 80 Hz complex, n = 60 ms: r_corr(T) 0.9966–1.0037 across
waveform offsets; 100 Hz: ±0.07 %). At high HNR that is decisive
(1 − r = 0.3 % at 25 dB). `dbg-win.mjs`, F0 80 Hz, true 25 dB, 16 kHz, our
frame length → mean HNR: 56 ms 25.2, 58 ms 28.8, **60 ms 34.3**, 62 ms 29.2,
64 ms 25.9, 66 ms 24.9, 70 ms 25.7; F0 75/85/90 Hz are flat (23.5–24.2) at
every length. Praat on the same stimuli reads 25.1–25.6 at every
periods-per-window 4.2–5.25 (so Praat does something we do not reproduce; not
chased further). At 60 ms the band lands on F0 ≈ 77–83 Hz — low male voices —
and the hnr-test guard fails there (80 Hz, true 20 dB: +1.5…+1.7 dB; 25 dB:
+8…+9 dB with 28–40 dB frame scatter). At 70 ms the band sits at ~66–71 Hz,
below the 75 Hz floor.

**Residual (found in review, 2026-10-04):** 70 ms reduces but does not
remove the low-F0 error. At true HNR ≥ 30 dB (48 kHz, production 70 ms /
25 ms framing), stationary clean voices at F0 ≈ 77–85 Hz read +0.5…+2.9 dB
high on average with a 2–5 dB per-frame SD; a few frames per second hit the
40 dB cap (the corrected true-period peak lands just above r = 1 and is
reflected). At F0 ≈ 151–155 Hz the 2T peak, just under maxLag, can out-score
T after correction (frames up to +4.7 dB). 90–400 Hz shows 0.3–0.9 dB SD.
At 25 dB the mean stays ≤ +0.75 dB, inside the hnr-test tolerance, which
checks means only up to 25 dB. Revisit path: a Gaussian window or derating
peaks within a few lags of maxLag.

## 4. Real speech vs Praat

The same comparison on the private session recordings gave the same verdict. Results on the private session recordings are kept outside this repository.

**Corpora** (`eval-corpora-hnr.mjs` + `analyze_corpora_hnr.py`; every track,
native rate, Praat-voiced frames):

| corpus | gender | F0 med | prod bias / MAE / r | w60 bias / MAE / r | **prop bias / MAE / r** |
|---|---|---|---|---|---|
| PTDB-TUG | m | 110 | −6.09 / 6.10 / 0.813 | −0.03 / 0.88 / 0.966 | −0.57 / 1.02 / 0.961 |
| PTDB-TUG | f | 210 | −6.41 / 6.42 / 0.836 | −0.03 / 0.74 / 0.977 | −0.49 / 0.91 / 0.975 |
| FDA | m | 120 | −5.10 / 5.12 / 0.805 | −0.01 / 0.83 / 0.958 | −0.53 / 0.94 / 0.958 |
| FDA | f | 254 | −5.57 / 5.61 / 0.822 | −0.02 / 0.73 / 0.972 | −0.40 / 0.84 / 0.974 |
| Hillenbrand | men | 129 | −7.98 / 8.00 / 0.786 | +0.07 / 0.70 / 0.984 | −0.47 / 0.84 / 0.981 |
| Hillenbrand | women | 220 | −9.33 / 9.35 / 0.786 | −0.10 / 0.69 / 0.984 | −0.65 / 0.91 / 0.984 |
| vocadito | — | 214 | −10.25 / 10.26 / 0.708 | −0.14 / 0.78 / 0.967 | −0.51 / 0.88 / 0.968 |

Gender-symmetric MAE vs Praat, max(F, M): **prod 9.35 dB → prop 1.02 dB**
(w60 0.88 dB). Error-vs-F0 slopes: prod −0.76…+2.12 dB/oct, prop −0.85…+0.12
(FDA m −0.85 is the only |slope| > 0.2; w60 −1.13 there).

## 5. 60 ms vs 70 ms — decision

| criterion | w60 (Praat parity) | prop 70 ms |
|---|---|---|
| real speech bias vs Praat (corpora) | ~0 (−0.14…+0.07) | −0.40…−0.65 (uniform across F0) |
| real speech MAE vs Praat (corpora) | 0.69–0.88 | 0.84–1.02 |
| F0 confound (real speech) | none | none |
| stationary clean voice at F0 ≈ 80 Hz (true 20 / 25 dB) | **+1.5…+1.7 / +8…+9 dB**, frame scatter 28–40 dB | ≤ +0.75 dB at 25 dB |
| hnr-test guard (44.1/48 kHz, 1/k + pulse, 75–400 Hz, ≤25 dB) | fails at 80 Hz | **109/109 pass** |

Chosen: **70 ms**. The 60 ms defect is a gender-asymmetric failure on exactly
the population whose readings must not be erratic (low voices sustaining a
clean vowel — a common exercise), and it is not an average-case effect the
running-speech tables would show. The price is a uniform ~0.4–0.65 dB offset
below Praat on the running-speech corpora, ~1/15 of the current bias. If Praat numerical
parity is ever required (e.g. comparing to published norms), revisit with a
Gaussian window or F0-adaptive frame length.

## 6. CPU

`bench-hnr.mjs` (one variant per process, 2000 frames × 5 reps, after JIT
warm-up; machine was concurrently loaded, so absolute numbers are
pessimistic, ratios valid):

| rate | prod | w60 | **prop** |
|---|---|---|---|
| 48 kHz | 0.589 ms | 0.692 ms | **0.666 ms** |
| 44.1 kHz | 0.582 ms | 0.694 ms | **0.620 ms** |
| 16 kHz | 0.481 ms | 0.231 ms | **0.217 ms** (2048-pt FFT) |

HNR runs every 6th DSP frame (~6.7 Hz): ~4.4 ms/s at 48 kHz (+0.5 ms/s vs
prod), far under the 25 ms/frame budget. One-time window/ACF init per sample
rate: O(n·maxLag) ≈ 2.2 M multiply-adds at 48 kHz.

## 7. Stored sessions: displayed / stored HNR rises ~4–6 dB (document in release notes)

`avgHnr` (CombinedDashboard) is the mean of recorded voiced-frame HNR, which
is computed on every 6th frame. The prod → prop shift of that mean was
simulated on the private session recordings (every 6th hop of
Praat-voiced frames); results on the private session recordings are kept outside this repository.

Corpora means move +4.6 (FDA m) … +9.7 dB (vocadito); higher-HNR voices move
more (prod was clamped at r ≤ 0.99 ⇒ ≤ 19.96 dB and compressed above ~10 dB).
**Typical shift: +4 to +6 dB for running speech; up to +9 dB for clean
singing.** Sessions recorded before the change are not comparable to sessions
after it; no migration is possible (raw audio is not stored). Suggested
user-facing note: "HNR is now computed with Praat's method; values are
~4–6 dB higher than before 2026-10-03." HNR_RANGE (0–35 dB) needs no change
(new cap 40 dB).

## 8. Rejected

- `fixed` 50 ms in place (no ring change): F0 range 0.8–1.0 dB on synthetic,
  80 Hz scatter worse than 60 ms.
- 60 ms (Praat parity): see §5.
- 80 ms: best synthetic (pulse max |e| 0.4–1.3 dB) but needs an 8192-pt FFT
  at 44.1/48 kHz (~2× cost) and drifts further from Praat on running speech.
- Band-limited 2×/4× ACF upsampling (`upsamp-proto.mjs`): fixes the 16 kHz
  parabolic-interpolation cap for bright (1/k) spectra at F0 ≥ 200 Hz
  (true 25 dB read 22.1 → 25.0), irrelevant at the production 44.1/48 kHz
  rates (39.1 vs 39.9 at true 40 dB) and for voice-like spectra; costs a
  2–4× larger inverse FFT. Not adopted; 16 kHz is only reachable via `?sr=`.
- Lag search around the relayed pitch hint: unnecessary — the max-r local
  maximum is Praat's own convention (octave cost 0 in To Harmonicity), and
  the window correction makes r(T) ≈ r(2T) for periodic frames anyway.

## What landed

- `src/dsp/hnr.js` (new): `computeHNR(frame, sr)` — mean removal, Hann window, normalized ACF via FFT divided by the Hann window's own normalized ACF, highest local maximum over lags sr/600..sr/75 + 2 with parabolic interpolation, Praat reflection (r > 1 → 1/r), capped at 40 dB (r ≤ 0.9999). FFT length = next power of two ≥ n + maxLag + 2 (no circular wrap); FFT buffers, Hann window and window ACF are allocated once per (frame length, sample rate), i.e. once per worker init / sample-rate change.
- `src/dsp/dsp-worker.js`: computes HNR on the last 70 ms of its existing 100 ms ring (null until the ring holds 70 ms, i.e. the first two 25 ms chunks); still every 6th frame. The old `computeHNR` and its 4096-point buffers are removed.
- `tests/dsp/hnr-test.js` (new, 109 checks; added to `npm run test:dsp`): 44.1 / 48 kHz × {1/k random-phase, zero-phase pulse} × true HNR {5, 15, 25} dB × F0 {75, 80, 100, 130, 160, 220, 300, 400} Hz — each within ±1.5 dB of the true HNR, the error spread across F0 ≤ 1.5 dB per cell, and silence → null. The new module passes 109/109; the same guard run against the old algorithm passes 9 and fails 100.

Production-path check of the landed tree: the real `src/dsp/dsp-worker.js` was driven in Node through its own `onmessage` (`init` → `port` → `pitch-hint` → 25 ms chunks, fake `self`) at 48 / 44.1 / 16 kHz, side by side with the measured proposal's worker and the origin/main worker. Audio: every 9th Hillenbrand file concatenated (44.1/48 kHz from the `resample_poly` cache). (The same check also ran on a private session recording; results on the private session recordings are kept outside this repository.)

| Audio @ rate | HNR frames (every 6th) | non-null | HNR vs measured proposal | intensity / tilt / CPP vs origin/main |
|---|---|---|---|---|
| Hillenbrand @ 48k | 447 | 445 | 0 mismatches | 0 / 0 / 0 mismatches (2678 frames) |
| Hillenbrand @ 44.1k | 446 | 442 | 0 | 0 / 0 / 0 (2676) |
| Hillenbrand @ 16k | 447 | 445 | 0 | 0 / 0 / 0 (2678) |

(The first HNR frame is null by design — the ring holds only 50 ms then; the remaining nulls are frames with no positive local ACF maximum. Formants change in the same branch for an unrelated reason, [formant-lpc-order-2026-10-03.md](formant-lpc-order-2026-10-03.md), and match that measured proposal bit-exactly.)

## Reproduction

(The scratch harness scripts live in the gitignored `build/measure-2026-10-03/hnr-vocalweight/`; the session steps — `prep_sessions.py`, `eval-sessions-hnr.mjs`, `analyze_sessions_hnr.py`, `prodpath-check.mjs` — need private session recordings that are not in this repo and are omitted below.)

From `build/measure-2026-10-03/hnr-vocalweight/` (Node ≥20, Python with
parselmouth/numpy/scipy/pandas/soundfile):

```
node gen-prod.mjs && node baseline-match.mjs
python synth.py && node eval-synth.mjs
python synth_pulse.py && node pulse-eval.mjs
node winsweep.mjs && node dbg-80.mjs && node dbg-win.mjs && node upsamp-test.mjs
node --max-old-space-size=8000 eval-corpora-hnr.mjs && python analyze_corpora_hnr.py
for r in 48000 44100 16000; do for v in prod w60 prop; do node bench-hnr.mjs $v $r; done; done
node proposed/tests/dsp/hnr-test.js          # new module: 109/109 (landed as tests/dsp/hnr-test.js)
node prodtest/tests/dsp/hnr-test.js          # same guard on the old algorithm: 9 passed, 100 failed
```

After the change lands: `node tests/dsp/hnr-test.js` (109/109, exit 0), also run by `npm run test:dsp`.
