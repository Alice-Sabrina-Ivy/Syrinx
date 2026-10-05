# Pitch precision & steadiness pass — 2026-10-04

**Question (user-approved follow-up to
[pitch-detector-benchmark-2026-10-04.md](pitch-detector-benchmark-2026-10-04.md)):**
the benchmark put Syrinx's fine pitch error (FPE: std of the cents error over
frames within 20 % of the reference) at 38–53 cents on corpus speech, against
31–39 for Praat, and attributed part of it to the 25 ms hop and the 80 ms
window on gliding speech. A possible future **steadiness readout** — the 1-s
pitch SD in semitones, a common voice-training measure whose useful values
are a few tenths of a semitone — needs pitch precise to well under that. Where does the fine
error come from, can it be reduced, and **would a 1-s SD computed from the
chain track a reference SD**? The readout itself is not built (not approved).

## Verdict

**No change shipped.** Nothing measured improves precision or steadiness
agreement materially; this commit holds the measurement and its oracles
(`scripts/pitch-precision/`). `src/` is unchanged.

- **The estimator is not the limit.** On synthetic held vowels the production
  parabolic interpolation on the window-corrected autocorrelation is within
  **0.2 cents p95** of the true F0 on perfectly periodic input at every F0 from
  78 to 395 Hz and at 16 / 44.1 / 48 kHz input (the streaming resampler adds
  nothing measurable). With realistic jitter, shimmer and noise it tracks the
  window's own mean F0 within **0.15–2 cents** (sd). Praat-style sinc70 +
  golden-section refinement, log-parabolic interpolation and a
  harmonic-weighted spectral estimate change this by ≤ 1 cent; sinc is *worse*
  in noise (§2).
- **The corpus FPE is time resolution and reference roughness, not
  precision.** On a common frame set (§4), an oracle-candidate copy of the
  estimator at the production 80 ms / 25 ms reproduces the chain's posted FPE
  (FDA 28.6 vs 29.1, PTDB 26.7 vs 27.1, vocadito 13.0 vs 12.9 cents) — so
  candidate choice, tracker, guard and veto add nothing within 20 %. What moves
  it is sampling: linearly interpolating the same 25 ms estimates to the
  reference grid takes PTDB 26.7 → 19.7 and vocadito 13.0 → 8.4 (≈ Praat AC's
  19.0 / 6.0), and the excess sits almost entirely in frames gliding faster
  than 12 st/s. On FDA the laryngograph reference is cycle-scale rough: the
  reference itself sampled at the hop scores 28.9 against itself.
- **On held segments the chain is at the reference floor.** Slow segments
  (< 1 st/s): posted median |error| 1.3 cents vocadito, 7.5 PTDB. Synthetic
  held notes through the real chain: posted 1-s SD vs truth **MAE 0.016 st,
  r 0.997** over truth SDs 0.05–1.5 st (§3).
- **What would make a steadiness readout untrustworthy is not precision, it
  is which frames enter the window**: voicing membership (the estimator's
  own voicing decisions — onset/offset glide frames the reference calls
  unvoiced, frames it misses) and a few gross (octave-class) frames.
  Untrimmed, the gross frames dominate: on vocadito the posted plain 1-s SD
  has MAE 0.122 st (ref SD < 1 st) against 0.018 on gross-free windows; a
  3-semitone trim around the window median gives 0.017 at ref SD < 0.5 st
  (vs 0.152 plain) (§5.1). On real speech the voicing-membership cost comes
  on top of the trimmed figure (measured on the private session
  recordings, kept outside this repository).
- **The display level is the wrong source for a readout.** The median-3
  attenuates real modulation (painted SD / reference ≈ 0.88–0.94 on vibrato
  and held windows) and the hold bridge paints constant values through null
  gaps, which can make a window look *steadier than the voice*.
- **Candidates measured through the real chain** (§6): post-decode sinc
  refinement (decisions bit-identical by construction) — no change anywhere,
  +130 % CPU per voiced frame; a centred 40 ms refinement window — FDA FPE
  −1.4 cents on glides but worse on held segments (PTDB slow 16.4 → 19.5),
  Hillenbrand −0.7/−0.9 pp; display median
  removed (`m1`) — display one hop earlier, same accuracy at its own
  alignment, no better SD agreement, and it re-opens the spike
  question the median closes. None passes "material gain, no regression".

## 1. Setup

- **Synthetic held vowels** (`lib.mjs synth`): additive harmonic model with a
  known instantaneous F0, per-cycle jitter (0.3–1 % RMS period) and shimmer
  (2–6 %), harmonic amplitudes h⁻¹ × a 4-formant vowel envelope (/a i u e/),
  white aspiration noise (SNR 15–40 dB), contours: steady, slow wander
  (0.2–3 Hz components), vibrato 5.5 Hz, slow glide. Truth for the 1-s SD is
  the smooth contour (jitter excluded — it is not pitch wander).
- **Real chain**: the session-oracle chain (`scripts/session-oracle/lib/chain.mjs`
  — real `pitch-worker.js`, `dsp-worker.js`, `handleAnalysisResult`). Stages:
  **posted** (worker output, window centre = chunk end − 40 ms) and **painted**
  (live trace; display alignment + L·hop + 30 ms, as in the session oracle).
  The baseline is the 2026-10-04 low-register pass's `base` dump of the
  current src (bit-identical re-run; private measurement, kept outside this repo).
- **Corpora**: FDA and PTDB-TUG (laryngograph references; PTDB +20 ms shift),
  vocadito (sung, annotated), via the pitch-benchmark corpus dump.
- **Sessions**: the 1-s SD agreement was also scored on the private
  session recordings (`steady_sess.py`, Praat AC reference). Results on the private session recordings are kept outside this repository.
- **1-s SD**: SD of 12·log2 f over the voiced values in a 1-s window, 0.25 s
  grid. "Held" windows: AC voiced on ≥ 90 % of frames; "speech-like": ≥ 60 %.
  *Own* voicing = the estimator's own voiced values (what a readout would
  see); *joint* = its values at the reference's voiced frames (precision with
  voicing taken out); *trim* = drop values > 3 st from the window median first.

## 2. Estimator precision on synthetic frames (`est.mjs`)

Oracle candidate (AC peak nearest the truth, within 5 %), production frame
(1280 samples at 16 kHz). Cents; "win" truth = Hann²-weighted mean
instantaneous F0 over the frame; "ctr" = smooth F0 at the frame centre.

| condition | band | parabolic (prod) sd / p95 vs win | sinc70 | spectral | parabolic rms vs ctr |
|---|---|---|---|---|---|
| perfectly periodic, 16 / 44.1 / 48 kHz | 75–110 | 0.02 / 0.03 | 0.01 / 0.01 | 0.01 / 0.03 | — |
| | 260–400 | 0.09 / 0.17 | 0.00 / 0.01 | 0.01 / 0.02 | — |
| jitter 0.5 %, shimmer 3 %, SNR 30 | 75–110 | 0.15 / 0.31 | 0.15 / 0.31 | 0.52 / 1.04 | 4.20 |
| | 260–400 | 0.14 / 0.28 | 0.15 / 0.30 | 0.32 / 0.66 | 2.46 |
| jitter 1 %, shimmer 6 %, SNR 15 | 75–110 | 1.14 / 2.39 | 1.63 / 3.37 | 1.03 / 2.06 | 8.46 |
| | 260–400 | 2.12 / 4.79 | 3.67 / 7.66 | 0.64 / 1.21 | 5.67 |
| + vibrato 5.5 Hz ±50 c | 160–260 | 0.73 / 1.56 | 0.73 / 1.55 | 0.78 / 1.44 | 4.21 |
| + wander 40 c RMS | 160–260 | 0.14 / 0.29 | 0.14 / 0.30 | 0.37 / 0.73 | 3.06 |

Bias is ≤ 0.33 cents everywhere. The frame-to-truth residual vs the centre
value (last column, 2.5–8.5 cents) is the jitter the 80 ms window averages
over, not estimator error. The 16 / 44.1 / 48 kHz rows are identical to two
decimals; `static16` also asserts that the reproduction's parabolic
frequencies equal the production `candidates()` frequencies exactly.

## 3. Synthetic held notes through the real chain (`synth-chain.mjs`)

96 notes × 5 s (12 F0s 82–390 Hz × 8 truth SDs 0.05–1.5 st; wander / vibrato /
glide; 48 or 44.1 kHz input), 1 296 posted windows. Δ = detector SD − truth SD.

| stage | truth SD bin (st) | n | median Δ | MAE | p90 abs Δ | median ratio |
|---|---|---|---|---|---|---|
| posted | all | 1296 | +0.002 | 0.016 | 0.041 | 1.00 (r 0.997) |
| posted | < 0.15 | 464 | +0.011 | 0.017 | 0.039 | 1.21 |
| posted | 0.3–0.5 | 183 | +0.000 | 0.008 | 0.013 | 1.00 |
| posted | 0.5–0.8 (mostly vibrato) | 210 | −0.025 | 0.031 | 0.068 | 0.97 |
| painted | all | 1325 | −0.002 | 0.029 | 0.089 | 0.99 (r 0.985) |
| painted | 0.5–0.8 | 226 | −0.079 | 0.087 | 0.141 | 0.90 |
| painted | vibrato windows | 336 | −0.04 to −0.05 | 0.05–0.08 | 0.11–0.13 | 0.87–0.88 |

The posted noise floor is ~0.05 st SD-equivalent (truth 0.05 st reads 0.07):
the jitter/noise residual of §2. Above ~0.15 st the posted SD is unbiased to
< 0.03 st; the 80 ms window attenuates 5.5 Hz vibrato by ~3–5 %. The painted
median-3 attenuates it by another ~10 %.

## 4. Corpus fine-error decomposition (`est-real.mjs`, `er_an.py`)

Common frame set (every estimator within 20 % of the reference, smoothed glide
rate defined): FDA 15 825 / PTDB 15 849 / vocadito 79 233 frames. Cells: FPE
std / median |error| in cents; last two columns are the slowest and fastest
glide bins. "oracle" = AC peak nearest the reference, production refinement
unless noted; "nearest" = the estimate nearest each reference time (the
session-oracle convention), "interp" = linear interpolation between estimates
(mir_eval style).

| estimator | FDA | PTDB | vocadito | PTDB < 1 st/s | PTDB > 12 st/s |
|---|---|---|---|---|---|
| reference sampled at nearest 25 ms hop centre | 28.9 / 13.0 | 22.1 / 3.2 | 12.7 / 3.0 | 4.8 / 0.5 | 28.5 / 11.5 |
| reference × Hann² 80 ms, at hop | 26.1 / 14.1 | 22.4 / 9.8 | 12.6 / 4.2 | 9.5 / 4.5 | 27.9 / 15.2 |
| oracle 80 ms / 25 ms, nearest | 28.6 / 15.0 | 26.7 / 12.5 | 13.0 / 3.6 | 14.6 / 7.9 | 32.5 / 17.5 |
| — sinc70 refinement | 28.7 / 15.0 | 26.8 / 12.5 | 13.0 / 3.6 | 14.6 / 7.7 | 32.6 / 17.5 |
| — spectral refinement | 28.6 / 15.0 | 26.9 / 12.7 | 13.6 / 3.9 | 14.3 / 8.4 | 32.8 / 17.1 |
| oracle 80 ms / 25 ms, interp | 23.8 / 13.5 | 19.7 / 10.2 | 8.4 / 2.9 | 14.4 / 8.1 | 22.4 / 12.6 |
| oracle 80 ms / 10 ms | 24.7 / 13.6 | 19.4 / 9.7 | 8.3 / 2.3 | 13.3 / 7.2 | 22.3 / 12.4 |
| oracle 40 ms / 10 ms | 22.1 / 12.2 | 18.5 / 9.3 | 7.8 / 2.0 | 14.9 / 7.7 | 19.6 / 10.5 |
| Praat AC (10 ms, interp) | 19.6 / 10.9 | 19.0 / 9.3 | 6.0 / 1.6 | 14.7 / 7.4 | 20.3 / 10.7 |
| Praat CC (10 ms, interp) | 23.6 / 13.4 | 21.8 / 11.4 | 12.4 / 4.4 | 15.2 / 7.3 | 24.3 / 14.4 |
| **Syrinx posted** | **29.1 / 15.2** | **27.1 / 12.7** | **12.9 / 3.6** | **14.0 / 7.5** | **32.7 / 17.8** |
| Syrinx painted | 31.9 / 16.1 | 31.0 / 14.0 | 14.5 / 4.8 | 19.6 / 9.1 | 37.1 / 19.0 |

(This common set excludes most onset/offset frames, so its FPE is below the
benchmark's all-frames 38–53 cents; the ranking is the same.)

Reading:
- **Syrinx posted = the oracle at the same window/hop** (±0.5 cents): within
  20 % the chain's candidate choice, tracker and guard cost no precision.
- **Peak refinement is irrelevant** (sinc / spectral ±0.1–0.6 cents).
- **The 25 ms hop, scored nearest-hop, is the largest single term**: +4.6 to
  +7 cents FPE vs interpolating the same estimates, all of it in fast glides
  (PTDB > 12 st/s: 32.5 → 22.4). It is a sampling-of-the-contour effect —
  irrelevant to a 1-s SD, relevant to frame-level scores against 5–10 ms
  references. A 10 ms hop would need 2.5× the detector CPU.
- **Window length** matters little: 40 vs 80 ms at 10 ms hop is −0.5 to −2.6
  cents overall, and the 80 ms window is better on slow segments (PTDB 13.3 vs
  14.9).
- **Reference roughness**: on FDA even the reference smoothed by the 80 ms
  frame scores 26.1 against itself (cycle-scale laryngograph F0); PTDB's
  slow-segment floor for any 80 ms windowed estimator is ~9.5 cents std.
- Painted adds the median-3 lag and the hold bridge (vocadito: held-bridge
  frames are 1.4 % of painted frames but have median |error| 53 cents vs 5
  for fresh frames).

## 5. Steadiness readout fidelity on real voices

### 5.1 Vocadito (sung, annotated reference; `steady_real.py --sets=voc`)

| stage, estimator | windows ref SD < 0.5 st | MAE | ref SD < 1 st | MAE | r | windows with a gross frame |
|---|---|---|---|---|---|---|
| posted, plain | 60 | 0.152 | 144 | 0.122 | 0.39 | 2.8 % |
| posted, plain, gross-free windows | — | — | 140 | 0.018 | 0.99 | 0 |
| posted, 3-st trim | 62 | 0.017 | 200 | 0.035 | 0.97 | — |
| painted, plain | 64 | 0.036 | 152 | 0.033 | 0.97 | 0 |

### 5.2 Sessions

The same fidelity analysis (§5.2: 1-s SD MAE by stage and voicing
convention; §5.3: session-level "best windows") was run on the private
session recordings. Results on the private session recordings are kept outside this repository.

## 6. Candidate improvements through the real chain

Variant trees (`variants.py`), full low-register guard set
(`lowband/run_variant.sh` + `table.py`: FDA / PTDB / Hillenbrand /
vocadito, 12 noise classes × 4 seeds, plus the private session recordings
whose results are kept outside this repository), precision comparison
`prec_cmp.py`
(common frames — a larger set than §4's: only the compared variants' own
values must be within 20 %, hence the higher absolute FPE). `sinc` and `sub40` refine the **posted value only**, after
every decision (veto, range, guard use the unrefined decode; the refined value
is kept only within 4 % and capped at 400 Hz).

| variant | worker decisions | largest guard deltas (pp) | FPE posted FDA / PTDB / voc (base 42.0 / 39.4 / 14.0) | PTDB slow | CPU |
|---|---|---|---|---|---|
| `sinc` (full frame, sinc70 + golden section) | identical (VDE, nulls, octave classes +0.00 on every row) | ±0.04 display; PTDB f 75–160 RPA −0.44 (small n) | 42.1 / 39.5 / 14.0 | 16.3 (16.4) | refine 0.65 ms vs candidates() 0.49 ms per voiced frame (+130 %) |
| `sub40` (centred 40 ms window, parabolic) | identical | FDA m 75–160 C5 +1.09, Hillenbrand m/f −0.85 / −0.71 | 40.6 / 39.7 / 14.5 | 19.5 | 0.22 ms (+45 %) |
| `m1` (PITCH_SMOOTH_LEN 3 → 1) | identical | painted at its own alignment (+5 ms instead of +30): FDA C5 84.53 vs 84.46, PTDB 86.00 vs 85.81, voc 95.97 vs 96.27 | painted 43.1 / 43.1 / 17.1 (base 45.8 / 48.7 / 19.9) | painted 22.5 (28.0) | — |

Noise-only false voicing is identical for all three (decisions unchanged).
`m1` scored at the deployed +30 ms display alignment shows −5 to −15 pp
painted C5 — an alignment artifact (one hop less display lag), not a loss;
at its own alignment it is at parity. It is a latency/robustness trade-off of
the display (the 2026-07-19 K=5 → 3 decision's territory, spike/conn12 guards
not re-run here), not a precision lever, and it does not improve the painted
steadiness agreement.

## 7. What this means for a steadiness readout (not built)

- **Trustworthy if** it is computed from **posted** values (not painted /
  readout / held), over a 1-s window with a voicing-coverage gate, with a
  **robust spread** (3-st trim around the window median, or equivalent) and a
  gross-frame guard (reject or flag windows whose trimmed set loses more than
  a few values). Then it tracks the reference to ~0.02 st on synthetic held
  notes (posted MAE 0.016 st, §3) and on vocadito (posted 3-st trim MAE
  0.017 st, ref SD < 0.5 st, §5.1). On real speech the estimator's own
  voicing decisions (voicing-boundary frames) add error beyond that
  trimmed-reference figure, so a readout on its own voicing is less
  precise than ~0.02 st (session results kept outside this repository).
- **Not trustworthy** untrimmed (vocadito posted plain MAE 0.152 st, driven
  by octave-class frames), or from the painted trace (median attenuation,
  held values reading as perfectly steady).
- A readout should state its noise floor: ~0.05 st (synthetic, §3) — values
  below ~0.1 st are not distinguishable from each other.

## 8. Follow-ups

1. If a steadiness readout is approved: build it on posted values with the
   §7 rules, and validate with `steady_sess.py` (own / trim) plus a held-note
   recording session with a known external measurement.
2. Frame-level scores against 5–10 ms references should interpolate the 25 ms
   hops (or report both): nearest-hop scoring charges Syrinx ~5–7 cents FPE (common-set std) of
   pure contour sampling on fast glides.
3. The remaining fine-error gap to Praat on speech is time resolution
   (10 ms hop) — only addressable by evaluating more than one frame per 25 ms
   chunk (2.5× detector CPU); not worth it for any current display.

## Reproduction

`scripts/pitch-precision/README.md` (all commands; work dir `build/prec/`).
Verified at commit: `er_an.py` and `steady_sess.py` re-run from the committed
scripts reproduce the scratch outputs byte-for-byte; `est.mjs static16` and
`synth_an.py base` reproduce §2 / §3; `tests/dsp/boersma-ac-test.js` passes on
the unchanged src.
