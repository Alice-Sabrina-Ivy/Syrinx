# formant-vtl: calibration-free apparent vocal-tract length from formants (2026-10-04)

Candidate family **formant-vtl** on the shared resonance-validity benchmark
([resonance-benchmark-baselines-2026-10-04.md](resonance-benchmark-baselines-2026-10-04.md)).
Lab code: `scripts/resonance-lab/candidates/formant-vtl/` (branch `resonance-lab`); data and
logs under `build/resonance-lab/formant-vtl/` (gitignored). No `src/` change.

## Result

**`fv_app101214_gm1234_ridge2_bw800` passes every public rubric gate (R1–R4) on the official harness (test split,
JS implementation through the Node bridge):**

| R1 AUC 2 s / **5 s** / utt / spk | R2 leak Praat / WORLD | R3 sens Praat / WORLD | sign ±5 % Praat / WORLD | R3 @+8 st sens / sign | R4 | R5 flicker / held SD / t-stable | R7 boys / girls | R8 |
|---|---|---|---|---|---|---|---|---|
| 0.96 / **0.98** / 0.97 / 0.99 | **0.00** / 0.02 | **0.86** / 0.88 | **0.96** / 0.97 | 0.85 / 0.95 | **0.43** (speaker-bootstrap 95 % CI 0.37–0.54) | 0.68 / 0.03 / 1.5 s | 1.14 / 1.36 | 23.5 ms CPU per s audio, 0 MB (10 weights) |

Other columns: PTDB 5 s 1.00, FDA 5 s 1.00, Hillenbrand token AUC 0.90 / speaker 1.00; Hillenbrand
manipulations R2 0.01, R3 0.72, sign 0.92; women R3 0.88 / sign 0.97, men 0.84 / 0.95; pitch-alone
midpoint flips men +12 st 0.24 (base 0.17), women −12 st 0.04 (base 0.06); toward-class pitch
0.06 / −0.04 G, formant ×1.15 / ×0.85 1.00 / 1.06 G; additivity 1.10; highest-F0-quarter women vs
men AUC 0.98. G = 0.113 (log formant geometric mean; women/men ratio 1.12).

Lab (Python) and harness (JS) agree: lab test numbers for the same config were AUC5 0.976, R2 0.000,
R3 0.858 / sign 0.963, R4 0.434. JS-vs-Python parity: 267/268 bins identical to 1e-6,
one bin off by 0.0024 (float32 bandwidth near the 800 Hz limit in the lab's frame dump).

## Method (final candidate)

1. **Formants:** the app's LPC pipeline (scratch copy `allpoles.mjs` of `src/dsp/formants.js`:
   48 kHz capture emulation, 50 ms Hamming window every 25 ms, pre-emphasis 0.97, FIR decimation to
   12 kHz, Burg LPC, Durand-Kerner roots) returning **every pole with its bandwidth** at orders 10,
   12 and 14 (snapshots of one Burg recursion). Sex-blind: no pitch hint.
2. **Assignment:** per order, F1..F4 = the four lowest poles with 90 < f < 5400 Hz and bandwidth
   < 800 Hz.
3. **Per-frame estimate:** mean ln F1..F4 (log geometric mean of formants) minus a **vowel-shape
   correction** = ridge regression (degree-2 polynomial, 10 weights) on the scale-invariant shape
   vector (ln F_i − mean ln F, i = 1..3). Because the correction sees only formant ratios, a pure
   formant scaling moves the estimate by exactly ln(scale). The ridge is fit on **train_dev only**
   (all 40 LibriSpeech dev-clean speakers, order-12 voiced frames) to predict each frame's deviation
   from its speaker's median, i.e. it learns vowel offsets without vowel labels.
4. **Gating / aggregation:** voiced frames only (pitch track > 0; F0 values are not used in the
   estimate); the three orders' frame estimates are pooled and the median taken per 150 ms bin
   (≥ 2 values); readouts are medians of bins (harness).
5. **Calibration-free mapping:** UI position p = (score − 7.345) / (7.468 − 7.345), the
   train_dev men / women speaker medians (0 = typical man, 1 = typical woman; children land > 1).

Selection protocol: every variant was tuned on the dev split (r1_dev + manip_dev, learned parts
fit in 5 speaker-disjoint folds of train_dev so no dev speaker was seen by its corrector) with a
dev proxy for R4 (per-speaker SD across 12 unsupervised formant-shape classes). The final config
was picked on dev before its test numbers were seen; learned parts for test were fit on all of
train_dev; test speakers are disjoint by construction. Every variant scored is listed below.

## Findings

- **Vowel-shape correction is what makes R4 pass.** Uncorrected log-GM has R4 0.76 on test (vowel
  offsets span 2.0 G); the train_dev ridge correction brings it to 0.43–0.48 (range 0.99 G). Even
  hand-measured Hillenbrand formants without correction give R4 0.42–1.19 depending on estimator
  (0.21–0.35 with oracle vowel labels), so no uncorrected formant estimator can be expected to pass.
- **Residual vowel bias (test, final):** /uw/ −0.59, /oa/ −0.52, /er/ −0.41, /oo/ −0.22 vs /eh/
  +0.40, /ae/ +0.40, /ah/ +0.30 G. The running-speech-trained correction under-corrects isolated
  back/rhotic vowels. R4's bootstrap CI reaches 0.54, so the R4 pass is not robust; men are worse
  (0.47) than women (0.41).
- **Multi-order pooling (10/12/14) and a looser bandwidth limit (800 Hz) raise R3** (0.73 → 0.86)
  and sign accuracy (0.93 → 0.96) over order 12 alone; the app's order-12 LPC compresses the true
  ×1.15 scaling (sensitivity 0.72 uncorrected).
- **Praat Burg formants did worse than the app's LPC** in this family (praat5500 + ridge: AUC5 0.90,
  sign 0.887).
- **Pitch robustness:** R2 ≤ 0.012 G for every corrected app variant scored on test (≤ 0.05 on dev); F0 enters only through voicing.
  With the **production pitch-worker voicing** (Boersma-AC emulation tracks precomputed by the
  pitch-neutral-ml agent from each item's own audio) the final config still passes: AUC5 0.969, R2
  0.009, R3 0.86 / sign 0.95, R4 0.454.
- **High F0:** highest-F0-quarter women vs men AUC 0.98; R3 at +8 st 0.85 / sign 0.95. Explicit
  high-F0 defences (harmonic-proximity gate on F3/F4 or F1/F2, F0 < 250 Hz limit) did not help on
  dev and were dropped.
- **Shape-GMM (scale-invariant plausibility model) gates** gave no clear gain; **GMM-driven per-frame
  order selection** improved the dev R4 proxy (0.28 vs 0.37) and test R3/sign (sel1214: AUC5 0.987,
  R3 0.87, sign 0.97, R4 0.42) but the 10/12/14 version got R4 0.48 on test: the dev R4 proxy
  (LibriSpeech shape clusters) does not predict Hillenbrand R4 well. The best-on-dev variant
  (`sel101214_gm1234_ridge2_bw800_g05`, lab only, chosen after the final) reached test AUC5 0.985,
  R2 0.001, R3 0.91, sign 0.985, R3 @+8 st 0.93 / 0.975, R4 0.467: better resonance
  sensitivity, worse vowel robustness. It needs a JS port of the 8-component GMM before it can be
  scored on the harness.
- **Private sessions (R6):** results on the private session recordings are kept outside this repository.
- **Children (synthetic only):** boys 1.14, girls 1.36 on the men = 0 / women = 1 scale, correct
  direction, no saturation.

## Limits / failure modes

- R4 margin is thin (CI to 0.54); vowel-dependent bias of ±0.5 G remains, as large as a
  training-sized 5 % formant shift (≈ 0.43 G). Readouts need several seconds of varied speech; a
  held single vowel reads differently by vowel.
- Per-150 ms flicker 0.68 G: the meter must show a multi-second median (t-stable 1.5 s).
- The R3/R2 manipulations are clean resynthesis; real training changes (larynx height, lip
  spreading) are not uniform formant scalings and may move the correction differently.
- Not tested: background noise, reverberation, phone microphones, whisper/breathy voice, non-English
  vowel systems (the correction is learned on English read speech), real children's audio.
- Population mapping uses 20 + 20 LibriSpeech dev speakers; its q10–q90 spread of men (7.30–7.38)
  and women (7.41–7.51) barely overlaps, so the scale is coarse at the ends.

## Variants

Full per-variant table (dev and test summaries) is generated from `variants_dev.jsonl` /
`variants_test.jsonl` by `build/resonance-lab/formant-vtl/table.py`; reproduced below.

| variant | dev AUC5 | R2 | R3 | sign | R3@+8st | sign@+8st | R4 proxy | test AUC5 | R2 | R3 | sign | R4 |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| app12_dF1234 | 0.924 | 0.008 | 0.584 | 0.85 | 0.632 | 0.831 | – | 0.892 | 0.001 | 0.821 | 0.912 | 0.67 |
| app12_dF234 | 0.919 | 0.01 | 0.591 | 0.844 | 0.648 | 0.819 | – | – | – | – | – | – |
| app12_dF34 | 0.909 | 0.011 | 0.619 | 0.85 | 0.68 | 0.856 | – | – | – | – | – | – |
| app12_gm1234 | 0.969 | 0.023 | 0.632 | 0.856 | 0.642 | 0.881 | – | 0.949 | 0.019 | 0.717 | 0.912 | 0.761 |
| app12_gm34 | 0.919 | 0.004 | 0.643 | 0.863 | 0.707 | 0.85 | – | – | – | – | – | – |
| app12_f3 | 0.824 | 0.016 | 0.721 | 0.869 | 0.748 | 0.831 | – | – | – | – | – | – |
| app12_f4 | 0.886 | 0.017 | 0.577 | 0.838 | 0.644 | 0.812 | – | – | – | – | – | – |
| app12_dF123 | 0.88 | 0.026 | 0.615 | 0.844 | 0.691 | 0.812 | – | – | – | – | – | – |
| app14_dF1234 | 0.937 | 0.063 | 0.805 | 0.881 | 0.716 | 0.794 | – | – | – | – | – | – |
| app14_gm1234 | 0.95 | 0.041 | 0.834 | 0.863 | 0.813 | 0.8 | – | – | – | – | – | – |
| app14_f4 | 0.937 | 0.052 | 0.762 | 0.887 | 0.791 | 0.838 | – | – | – | – | – | – |
| praat5500_dF1234 | 0.886 | 0.076 | 0.459 | 0.806 | 0.618 | 0.787 | – | – | – | – | – | – |
| praat5500_gm1234 | 0.95 | 0.016 | 0.564 | 0.831 | 0.64 | 0.875 | – | – | – | – | – | – |
| praat5500_f4 | 0.817 | 0.085 | 0.501 | 0.812 | 0.847 | 0.8 | – | – | – | – | – | – |
| app12_gm1234_mean | 0.972 | 0.021 | 0.526 | 0.787 | 0.538 | 0.856 | 0.617 | – | – | – | – | – |
| app12_gm1234_tmean_mean | 0.972 | 0.021 | 0.53 | 0.838 | 0.524 | 0.831 | 0.652 | – | – | – | – | – |
| app12_gm1234_mean_mean | 0.973 | 0.018 | 0.531 | 0.819 | 0.523 | 0.831 | 0.673 | – | – | – | – | – |
| app14_gm1234_mean | 0.956 | 0.04 | 0.706 | 0.869 | 0.696 | 0.825 | 0.598 | – | – | – | – | – |
| app12_dF1234_mean | 0.926 | 0.003 | 0.561 | 0.775 | 0.547 | 0.731 | 0.86 | – | – | – | – | – |
| app12_gm1234_K8 | 0.967 | 0.023 | 0.637 | 0.869 | 0.63 | 0.838 | 0.516 | – | – | – | – | – |
| app12_gm1234_K16 | 0.967 | 0.03 | 0.601 | 0.838 | 0.63 | 0.819 | 0.507 | 0.947 | 0.021 | 0.763 | 0.92 | 0.643 |
| app12_gm1234_K32 | 0.966 | 0.03 | 0.662 | 0.875 | 0.652 | 0.887 | 0.444 | – | – | – | – | – |
| app12_tm_K16 | 0.845 | 0.034 | 0.585 | 0.738 | 0.676 | 0.781 | 0.726 | – | – | – | – | – |
| app12_dF1234_K16 | 0.963 | 0.02 | 0.603 | 0.85 | 0.723 | 0.863 | 0.522 | – | – | – | – | – |
| app12_tm_K8 | 0.854 | 0.028 | 0.603 | 0.769 | 0.671 | 0.781 | 0.579 | – | – | – | – | – |
| app12_f4_K16 | 0.943 | 0.013 | 0.652 | 0.831 | 0.648 | 0.831 | 0.427 | – | – | – | – | – |
| app12_gm1234_ridge2 | 0.97 | 0.013 | 0.698 | 0.881 | 0.703 | 0.85 | 0.453 | 0.963 | 0.009 | 0.733 | 0.93 | 0.466 |
| app14_gm1234_K16 | 0.952 | 0.06 | 0.823 | 0.863 | 0.738 | 0.819 | 0.438 | – | – | – | – | – |
| app12_gm1234_ridge3 | 0.971 | 0.01 | 0.707 | 0.875 | 0.694 | 0.85 | 0.425 | – | – | – | – | – |
| app12_tm_K32 | – | – | – | – | – | – | – | – | – | – | – | – |
| app12_gm1234_ridge2_a100 | 0.967 | 0.023 | 0.683 | 0.863 | 0.687 | 0.856 | 0.496 | – | – | – | – | – |
| app12_dF1234_ridge2 | 0.963 | 0.015 | 0.645 | 0.887 | 0.683 | 0.838 | 0.418 | 0.949 | 0.004 | 0.83 | 0.91 | 0.447 |
| praat5500_gm1234_K16 | 0.957 | 0.027 | 0.525 | 0.869 | 0.612 | 0.875 | 0.348 | – | – | – | – | – |
| app12_f4_ridge2 | 0.959 | 0.015 | 0.631 | 0.875 | 0.652 | 0.831 | 0.386 | – | – | – | – | – |
| app12_gm34_ridge2 | 0.964 | 0.015 | 0.652 | 0.881 | 0.699 | 0.85 | 0.428 | – | – | – | – | – |
| app14_gm1234_ridge2 | 0.973 | 0.049 | 0.832 | 0.894 | 0.754 | 0.863 | 0.316 | – | – | – | – | – |
| app1214_gm1234_ridge2 | 0.979 | 0.015 | 0.698 | 0.925 | 0.69 | 0.875 | 0.43 | 0.984 | 0.002 | 0.851 | 0.943 | 0.478 |
| app12_ens3_ridge3 | 0.964 | 0.019 | 0.656 | 0.875 | 0.671 | 0.844 | 0.406 | – | – | – | – | – |
| app101214_gm1234_ridge2 | 0.971 | 0.005 | 0.788 | 0.912 | 0.827 | 0.931 | 0.479 | 0.975 | 0.004 | 0.858 | 0.948 | 0.451 |
| app1214_ens3_ridge3 | 0.982 | 0.01 | 0.727 | 0.887 | 0.737 | 0.887 | 0.414 | – | – | – | – | – |
| praat5500_gm1234_ridge2 | 0.901 | 0.049 | 0.683 | 0.863 | 0.913 | 0.844 | 0.371 | 0.9 | 0.03 | 0.73 | 0.887 | 0.486 |
| app1214_gm1234_ridge3 | 0.98 | 0.013 | 0.723 | 0.906 | 0.745 | 0.881 | 0.425 | – | – | – | – | – |
| app12_gm1234_ridge2_hp0.8 | 0.957 | 0.031 | 0.676 | 0.812 | 0.69 | 0.831 | 0.434 | – | – | – | – | – |
| app12_gmf4_ridge3 | 0.964 | 0.015 | 0.665 | 0.875 | 0.682 | 0.85 | 0.401 | – | – | – | – | – |
| app12_gm1234_ridge2_f43 | 0.953 | 0.012 | 0.785 | 0.875 | 0.761 | 0.887 | 0.461 | – | – | – | – | – |
| app12_gm1234_ridge2_bw400 | 0.964 | 0.026 | 0.688 | 0.819 | 0.804 | 0.825 | 0.34 | – | – | – | – | – |
| app12_gm1234_ridge2_bwmax400 | 0.948 | 0.005 | 0.722 | 0.781 | 0.75 | 0.806 | 0.33 | – | – | – | – | – |
| app12_gm1234_ridge2_bwmax800 | 0.976 | 0.008 | 0.765 | 0.925 | 0.754 | 0.906 | 0.362 | 0.967 | 0.005 | 0.836 | 0.925 | 0.437 |
| app12_gm1234_ridge2_fmax5000 | 0.975 | 0.016 | 0.743 | 0.919 | 0.82 | 0.887 | 0.35 | 0.958 | 0.012 | 0.789 | 0.917 | 0.458 |
| app12_gm1234_ridge2_fmin200 | 0.964 | 0.011 | 0.668 | 0.875 | 0.654 | 0.856 | 0.372 | – | – | – | – | – |
| app12_gm1234_ridge2_rms30 | 0.97 | 0.013 | 0.698 | 0.881 | 0.703 | 0.85 | 0.453 | – | – | – | – | – |
| app12_gm1234_ridge2_bin05 | 0.966 | 0.021 | 0.666 | 0.881 | 0.704 | 0.881 | 0.433 | – | – | – | – | – |
| app12_gm1234_ridge2_bin30 | 0.966 | 0.025 | 0.705 | 0.894 | 0.725 | 0.9 | 0.435 | – | – | – | – | – |
| app101214_gm1234_ridge2_bw800 | 0.975 | 0.006 | 0.846 | 0.912 | 0.855 | 0.906 | 0.375 | 0.976 | 0 | 0.858 | 0.963 | 0.434 |
| app1214_gm1234_ridge2_bw800 | 0.973 | 0.037 | 0.766 | 0.912 | 0.745 | 0.875 | 0.368 | – | – | – | – | – |
| app101214_gm1234_ridge2_bw800_fx5000 | 0.978 | 0.014 | 0.808 | 0.919 | 0.856 | 0.919 | 0.339 | 0.975 | 0.009 | 0.878 | 0.96 | 0.413 |
| app101214_gm1234_ridge3_bw800 | 0.975 | 0.013 | 0.809 | 0.9 | 0.823 | 0.906 | 0.37 | – | – | – | – | – |
| app101214_dF1234_ridge2_bw800 | 0.974 | 0.011 | 0.742 | 0.894 | 0.758 | 0.906 | 0.274 | 0.972 | 0.008 | 0.865 | 0.955 | 0.437 |
| app101214_gm1234_ridge2_bw800_bin30 | 0.975 | 0.018 | 0.825 | 0.912 | 0.817 | 0.931 | 0.361 | – | – | – | – | – |
| app12_gm1234_ridge2_g02 | 0.964 | 0.022 | 0.71 | 0.9 | 0.736 | 0.869 | 0.419 | – | – | – | – | – |
| app12_gm1234_ridge2_g05 | 0.963 | 0.019 | 0.718 | 0.894 | 0.727 | 0.881 | 0.375 | – | – | – | – | – |
| app12_gm1234_ridge2_g10 | 0.963 | 0.019 | 0.74 | 0.906 | 0.776 | 0.894 | 0.355 | – | – | – | – | – |
| app12_gm1234_none_g05 | 0.966 | 0.021 | 0.669 | 0.875 | 0.662 | 0.85 | 0.547 | – | – | – | – | – |
| sel101214_gm1234_ridge2 | 0.964 | 0.011 | 0.888 | 0.919 | 0.893 | 0.919 | 0.311 | – | – | – | – | – |
| sel101214_gm1234_ridge2_g05 | 0.964 | 0.012 | 0.861 | 0.944 | 0.856 | 0.938 | 0.284 | 0.982 | 0.01 | 0.85 | 0.963 | 0.484 |
| sel1214_gm1234_ridge2_g05 | 0.978 | 0.009 | 0.832 | 0.931 | 0.775 | 0.919 | 0.28 | 0.987 | 0.008 | 0.873 | 0.97 | 0.418 |
| app12_gm1234_ridge2_bw800_fx5000 | 0.979 | 0.006 | 0.754 | 0.919 | 0.783 | 0.919 | 0.331 | – | – | – | – | – |
| sel101214_gm1234_ridge2_bw800_g05 | 0.963 | 0.01 | 0.95 | 0.944 | 0.938 | 0.956 | 0.306 | 0.985 | 0.001 | 0.908 | 0.985 | 0.467 |
| app12_gm1234_ridge2_hp12 | 0.957 | 0.017 | 0.624 | 0.794 | 0.728 | 0.806 | 0.354 | – | – | – | – | – |
| app12_gm1234_ridge2_f0max250 | 0.965 | 0.015 | 0.753 | 0.869 | 0.834 | 0.789 | 0.475 | – | – | – | – | – |
| app101214_gm1234_ridge2_bw800_prodf0 | – | – | – | – | – | – | – | 0.969 | 0.009 | 0.86 | 0.95 | 0.454 |
| app101214_gm1234_ridge2_prodf0 | – | – | – | – | – | – | – | 0.972 | 0.001 | 0.782 | 0.927 | 0.491 |

Column notes: dev = r1_dev / manip_dev (learned parts speaker-cross-fit); "R4 proxy" = dev
per-speaker SD across 12 unsupervised shape classes / G (not the Hillenbrand R4); test = lab
evaluator on the test sets with learned parts fit on all of train_dev (same metric code as bench.py).
`app12_tm_K32` produced no output (template matcher degenerate at K = 32). Variant name key:
`app<orders>` app LPC order(s) pooled; `sel<orders>` per-frame order chosen by shape-GMM likelihood;
`praat5500` Praat Burg, 5500 Hz ceiling; estimator `gm1234` mean ln F1..F4, `dF*` Reby & McComb
formant-dispersion regression, `f3`/`f4` single formants, `tm` scale-invariant template matching;
`_K<k>` k-means shape-class offsets, `_ridge<d>` polynomial shape correction; gates `bw*`/`bwmax*`
bandwidth limits, `fx5000`/`fmax5000` upper frequency limit, `fmin200`, `f43` F4/F3 ratio window,
`hp*` harmonic-proximity rejection, `f0max250`, `g<q>` shape-GMM likelihood quantile gate,
`rms30` level gate, `bin05`/`bin30` bin width, `_mean` mean aggregation, `_prodf0` production
pitch-worker voicing.
