# Learned-envelope resonance candidate — 2026-10-04

Candidate family: a small learned model on **pitch-removed spectral-envelope features**, trained
on LibriSpeech dev-clean speakers only, with the harness's own manipulation engines used as
**invariance (pitch-only) and sensitivity (formant-only) training**. Scored on the shared
resonance-validity benchmark (`scripts/resonance-lab/bench.py`, rubric R1–R6; see
[resonance-benchmark-baselines-2026-10-04.md](resonance-benchmark-baselines-2026-10-04.md)).
No production code changed. Branch `resonance-lab`; no PR.

Code: `scripts/resonance-lab/candidates/learned-envelope/`. Data/caches/logs (gitignored):
`build/resonance-lab/learned-envelope/`.

## Verdict

**The final candidate `le_ens_h64` passes every public rubric gate (R1–R4) on the full test split.** It is a
mean of 3 seeds of a 64-unit tanh MLP on a 64-band log envelope (500–6000 Hz), with 0.2 MB of
JSON weights, about 2 ms CPU per second of audio, and no calibration.

| R1 AUC 5 s (test-clean) | R2 leak P/W | R3 sens P/W | sign ±5 % P/W | R4 | flicker | t-stable |
|---|---|---|---|---|---|---|
| 0.97 | 0.04 / 0.01 | 0.75 / 0.76 | 0.99 / 0.99 | **0.43** | 0.58 | 1.5 s |

The pass is thinner than the table suggests. These are the points to weigh before trusting it:

1. **R4 is marginal.**
   - Full-set R4 is 0.43. The speaker-bootstrap 95 % CI is [0.36, 0.53], with P(R4 ≤ 0.5) = 0.91.
   - Single seeds of the same configuration range from 0.40 to 0.505. 5 of 6 single-seed runs pass; h16 seed 2 fails at 0.505.
   - On the harness `--quick` Hillenbrand subset, the same ensemble gives 0.53 (fail).
   - The vowel offsets that remain are /æ/ +0.59, /ɛ/ +0.38, /u/ −0.62 and /o/ −0.58 G. Open front vowels still read "brighter" and back rounded vowels "darker".
   - I found **no dev-legal proxy that predicts R4.** Two were tried and both fail (see below). So R4 could only be checked out of sample, never tuned.
2. **Out-of-domain voices are unpredictable.**
   - On the synthetic static vowels (the only children's check), the MLPs barely separate synthetic women from men. The ensemble's AUC there is 0.45, below chance, against 0.56 for B3 and 0.70 for the linear ridge.
   - The children's positions swing with seed and width: boys +3.7, −2.0, +0.8 and girls +6.3, −4.4, −0.1 across single models. Those "positions" divide by a near-zero synthetic gap.
   - In test-clean G units, synthetic boys and girls do read above synthetic men for every MLP. Within a vowel, the score still rises with formant scale on synthetic audio: slope 0.26 per ln F, t = 11.
   - The nonlinear model is trained only on adult running speech, so **its behaviour on children, and on voices far outside the adult dev-clean range, is unverified.**
3. **Pitch is mostly handled, but not perfectly.**
   - The directional pitch leak is about +0.035 G per octave under PSOLA and about 0 under WORLD.
   - Any PSOLA pitch shift, up or down, raises the score by 0.06–0.14 G relative to the PSOLA reference (U-shaped). Under WORLD the offset is +0.03–0.05. This looks like a response to resynthesis rather than to pitch, but it is not proven.
   - On real speech, within-speaker natural F0 correlates with the score at +0.24 (men) / +0.21 (women) G per octave. This is confounded by intrinsic vowel F0, stress and effort; B3 shows −0.21 / +0.25 under the same analysis.
   - Men's +12 st readouts cross the midpoint 25 % of the time, against a 13 % base rate.
4. **Sensitivity drops on high-F0 isolated vowels.**
   - On Hillenbrand women's tokens (isolated vowels, F0 around 220 Hz), R3 is 0.45 with sign 0.84. At +8 st (around 350 Hz), R3 is 0.29 with sign 0.75.
   - On running test-clean speech at +8 st it holds: R3 0.71, sign 0.98.
   - This is the LPC-at-high-F0 problem in a milder form: sparse harmonics sample the envelope poorly.
5. **The production pitch detector instead of the harness's Praat track** (the `le_ens_h64_prodf0` quick runs plus a full Hillenbrand run):
   - R1 is unchanged (0.97 vs 0.98 on the quick subset).
   - R2 rises from 0.03/0.00 to 0.05/0.05.
   - R3 drops from 0.67 to 0.65; sign 0.98 to 1.00.
   - Full-set R4 goes from 0.43 to 0.45.
   - The band features use the F0 track **only for the voiced/unvoiced decision**, so the detector matters only through voicing.

## Method (final candidate)

**Features** (`lefeat.py`, method `band`; the JS port is `le_band.mjs`):
- For each voiced 10 ms frame (voicing taken from the F0 track): a 32 ms Hann window, 1024-point FFT at 16 kHz, then the power spectrum.
- The power is pooled into 64 triangular bands on a log-frequency grid from 150 to 6000 Hz. Each band is max(450 Hz, 0.25·fc) wide, so a band covers at least one harmonic spacing up to F0 = 450 Hz.
- Log, then the frame mean is subtracted (level normalisation).
- Frames are averaged into 150 ms bins (at least 3 voiced frames) and emitted at the bin end (causal).
- The model input keeps the bands from 500 to 6000 Hz (35 bands), mean-removed and standardised.

**Targets and training** (`train_eval.py`, `train_models.py`). The training data is all 40 dev-clean speakers (2,703 utterances, 94k bins).

Augmentation (`make_aug.py`, using the harness's `rlab.manip` engines):
- 30 utterances per speaker, cropped to 6 s or less.
- Praat PSOLA/"Change gender" and WORLD variants with **continuous random** amounts: pitch ±2–12 st, formant scale fs log-uniform in [0.80, 1.25] with |ln fs| ≥ 0.02, and combined moves. Each variant keeps its same-engine reference.
- Total: 15,600 renders, 420k bins.

The loss has two parts, with speaker-balanced weights:
- Absolute rows: target = ln(1.15)·female + ln fs. Pitch-only variants keep the source target; formant variants shift it by ln fs.
- Paired difference rows (variant minus same-engine reference, bin-matched): Δ = 0 for pitch-only, Δ = ln fs for formant-only and combined.

Model: 1 hidden layer of 64 tanh units. Adam (lr 3e-3, weight decay 1e-4), 30 epochs, batch 4096. The final candidate is the mean of seeds 0, 1 and 2.

Readout: the harness pools 150 ms bin scores with the mean. The units are arbitrary (about ln formant scale; the test-clean G is 0.085).

**Selection discipline:**
- Variants were compared with speaker-wise 5-fold CV on dev-clean (8 speakers per fold, 4 F + 4 M). The CV metrics are harness-style: AUC5, R2, R3 and sign on the held-out speakers' own augmented variants, plus flicker.
- Test sets were used only for scoring. The ensemble-of-3-seeds form was fixed before any ensemble was scored.
- Test R4 was looked at once to validate a proposed dev proxy, not to select a model. The proxy failed, as described below.

## Every variant tried

Speaker-wise 5-fold CV on dev-clean. AUC5 = speaker-balanced women>men AUC over 5 s voiced
chunks. R2/R3/sign use the held-out speakers' Praat (P) and WORLD (W) augmentation variants.
"men +oct" is the median toward-female move per octave for men's upward pitch shifts, in G.
Flicker is the within-utterance SD of bin scores / G. "band" is the fixed-band log envelope;
"ct" is CheapTrick-style F0-adaptive; "cep" is fixed-lifter cepstral; a trailing "p" means
power-domain bin pooling; "band7" is a 700 Hz minimum band; "hs" is the harmonic-sampled
envelope (peak per harmonic, interpolated in log-frequency). Rows are generated from
`build/resonance-lab/learned-envelope/cv_results.jsonl` (the last run per name; a dash means the
metric was not logged by that early run). "pairs_*" rows are ridge models with aug + pair rows.

| variant | config | AUC5 | R2 P/W | R3 P/W | sign P/W | men +oct | flicker |
|---|---|---|---|---|---|---|---|
| logreg_band | logreg; band 150-6000 Hz; no aug | 0.868 | 0.089/0.176 | 0.24/0.29 | 0.66/0.72 | +0.45 | 0.67 |
| logreg_ct | logreg; ct 150-6000 Hz; no aug | 0.934 | 0.187/0.508 | 0.15/0.14 | 0.61/0.60 | +0.50 | 0.42 |
| logreg_cep | logreg; cep 150-6000 Hz; no aug | 0.891 | 0.173/0.306 | 0.23/0.22 | 0.62/0.57 | +0.18 | 0.49 |
| ridge_band_noaug | ridge; band 150-6000 Hz; no aug | 0.891 | 0.071/0.155 | 0.23/0.27 | 0.65/0.71 | +0.43 | 0.66 |
| ridge_band_augabs | ridge; band 150-6000 Hz; aug abs | 0.888 | 0.055/0.096 | 0.46/0.48 | 0.86/0.91 | +0.43 | 0.69 |
| ridge_ct_augabs | ridge; ct 150-6000 Hz; aug abs | 0.932 | 0.164/0.457 | 0.22/0.22 | 0.74/0.74 | +0.44 | 0.37 |
| ridge_cep_augabs | ridge; cep 150-6000 Hz; aug abs | 0.873 | 0.207/0.384 | 0.33/0.32 | 0.74/0.73 | +0.22 | 0.47 |
| ridge_band_pairs | ridge; band 150-6000 Hz; aug abs+pairs | 0.864 | 0.040/0.056 | 0.53/0.55 | 0.93/0.95 | +0.38 | 0.69 |
| ridge_ct_pairs | ridge; ct 150-6000 Hz; aug abs+pairs | 0.912 | 0.147/0.410 | 0.27/0.27 | 0.82/0.84 | +0.38 | 0.39 |
| ridge_cep_pairs | ridge; cep 150-6000 Hz; aug abs+pairs | 0.853 | 0.241/0.451 | 0.42/0.41 | 0.83/0.81 | +0.26 | 0.55 |
| ridge_band_pairs_p10 | ridge; band 150-6000 Hz; aug abs+pairs, pitch-pair x10 | 0.875 | 0.045/0.078 | 0.47/0.49 | 0.89/0.92 | +0.35 | 0.65 |
| ridge_band_pairsonly | ridge; band 150-6000 Hz; pairs | 0.764 | 0.015/0.021 | 0.84/0.86 | 0.97/0.96 | +0.30 | 1.17 |
| pairs_band_150_6000 | ridge; band 150-6000 Hz; aug abs+pairs | 0.864 | 0.040/0.056 | 0.53/0.55 | 0.93/0.95 | +0.38 | 0.69 |
| pairs_band_300_6000 | ridge; band 300-6000 Hz; aug abs+pairs | 0.864 | 0.036/0.020 | 0.56/0.58 | 0.92/0.95 | +0.37 | 0.73 |
| pairs_band_500_6000 | ridge; band 500-6000 Hz; aug abs+pairs | 0.868 | 0.024/0.003 | 0.54/0.56 | 0.92/0.95 | +0.34 | 0.70 |
| pairs_band_800_6000 | ridge; band 800-6000 Hz; aug abs+pairs | 0.826 | 0.008/0.089 | 0.85/0.97 | 0.81/0.84 | +0.34 | 1.42 |
| pairs_band_1500_6000 | ridge; band 1500-6000 Hz; aug abs+pairs | 0.763 | 0.028/0.015 | 0.41/0.48 | 0.65/0.63 | +0.01 | 1.61 |
| pairs_band_500_4500 | ridge; band 500-4500 Hz; aug abs+pairs | 0.876 | 0.025/0.000 | 0.56/0.59 | 0.91/0.95 | +0.36 | 0.75 |
| pairs_ct_150_6000 | ridge; ct 150-6000 Hz; aug abs+pairs | 0.912 | 0.147/0.410 | 0.27/0.27 | 0.82/0.84 | +0.38 | 0.39 |
| pairs_ct_300_6000 | ridge; ct 300-6000 Hz; aug abs+pairs | 0.860 | 0.028/0.009 | 0.58/0.62 | 0.80/0.79 | +0.22 | 0.89 |
| pairs_ct_500_6000 | ridge; ct 500-6000 Hz; aug abs+pairs | 0.888 | 0.038/0.031 | 0.52/0.56 | 0.78/0.78 | +0.23 | 0.87 |
| pairs_ct_800_6000 | ridge; ct 800-6000 Hz; aug abs+pairs | 0.815 | 0.069/0.058 | 0.47/0.49 | 0.71/0.70 | +0.07 | 0.84 |
| pairs_ct_1500_6000 | ridge; ct 1500-6000 Hz; aug abs+pairs | 0.827 | 0.006/0.003 | 0.36/0.34 | 0.67/0.61 | +0.00 | 0.80 |
| pairs_ct_500_4500 | ridge; ct 500-4500 Hz; aug abs+pairs | 0.879 | 0.039/0.030 | 0.76/0.83 | 0.78/0.80 | +0.37 | 1.29 |
| pairs_band7_500 | ridge; band7 500-6000 Hz; aug abs+pairs | 0.867 | 0.024/0.078 | 0.50/0.53 | 0.93/0.94 | +0.30 | 0.64 |
| pairs_bandp_500 | ridge; bandp 500-6000 Hz; aug abs+pairs | 0.874 | 0.026/0.027 | 0.55/0.59 | 0.90/0.93 | +0.37 | 0.85 |
| pairs_band7p_500 | ridge; band7p 500-6000 Hz; aug abs+pairs | 0.867 | 0.029/0.084 | 0.45/0.48 | 0.93/0.95 | +0.29 | 0.68 |
| pairs_ctp_500 | ridge; ctp 500-6000 Hz; aug abs+pairs | 0.889 | 0.028/0.036 | 0.50/0.58 | 0.73/0.75 | +0.24 | 1.04 |
| pairs_band500_v0.3 | ridge; band 500-6000 Hz; aug abs+pairs, var-pen 0.3 | 0.871 | 0.024/0.008 | 0.53/0.55 | 0.92/0.94 | +0.33 | 0.69 |
| pairs_band500_v1 | ridge; band 500-6000 Hz; aug abs+pairs, var-pen 1 | 0.875 | 0.027/0.013 | 0.53/0.55 | 0.90/0.94 | +0.33 | 0.69 |
| pairs_band500_v3 | ridge; band 500-6000 Hz; aug abs+pairs, var-pen 3 | 0.880 | 0.030/0.018 | 0.52/0.54 | 0.89/0.93 | +0.34 | 0.70 |
| pairs_band500_v10 | ridge; band 500-6000 Hz; aug abs+pairs, var-pen 10 | 0.885 | 0.036/0.021 | 0.52/0.56 | 0.88/0.92 | +0.35 | 0.72 |
| pairs_band500_v30 | ridge; band 500-6000 Hz; aug abs+pairs, var-pen 30 | 0.891 | 0.038/0.024 | 0.52/0.56 | 0.87/0.91 | +0.35 | 0.73 |
| pairs_band500_a1.08 | ridge; band 500-6000 Hz; aug abs+pairs, anchor 1.08 | 0.840 | 0.016/0.016 | 0.73/0.77 | 0.94/0.96 | +0.39 | 0.90 |
| pairs_band500_a1.11 | ridge; band 500-6000 Hz; aug abs+pairs, anchor 1.11 | 0.856 | 0.019/0.007 | 0.57/0.60 | 0.93/0.95 | +0.33 | 0.71 |
| pairs_band500_a1.20 | ridge; band 500-6000 Hz; aug abs+pairs, anchor 1.20 | 0.877 | 0.027/0.008 | 0.51/0.53 | 0.91/0.94 | +0.34 | 0.69 |
| pairs_band500_al0.01 | ridge; band 500-6000 Hz; aug abs+pairs, alpha 0.01 | 0.870 | 0.031/0.011 | 0.54/0.56 | 0.92/0.95 | +0.35 | 0.70 |
| pairs_band500_al0.1 | ridge; band 500-6000 Hz; aug abs+pairs, alpha 0.1 | 0.870 | 0.031/0.011 | 0.54/0.56 | 0.92/0.95 | +0.35 | 0.70 |
| pairs_band500_al10 | ridge; band 500-6000 Hz; aug abs+pairs, alpha 10 | 0.860 | 0.007/0.013 | 0.57/0.60 | 0.92/0.94 | +0.32 | 0.74 |
| pairs_band500_al100 | ridge; band 500-6000 Hz; aug abs+pairs, alpha 100 | 0.836 | 0.025/0.058 | 0.69/0.74 | 0.92/0.94 | +0.27 | 0.90 |
| pairs_band500_tilt | ridge; band 500-6000 Hz, tilt removed; aug abs+pairs | 0.846 | 0.013/0.040 | 0.56/0.65 | 0.79/0.87 | +0.34 | 0.91 |
| pairs_band300_tilt | ridge; band 300-6000 Hz, tilt removed; aug abs+pairs | 0.878 | 0.031/0.055 | 0.61/0.65 | 0.89/0.93 | +0.48 | 0.84 |
| pairs_band500_tilt_p10 | ridge; band 500-6000 Hz, tilt removed; aug abs+pairs, pitch-pair x10 | 0.866 | 0.015/0.020 | 0.46/0.52 | 0.74/0.82 | +0.31 | 0.81 |
| pairs_band500_p30 | ridge; band 500-6000 Hz; aug abs+pairs, pitch-pair x30 | 0.887 | 0.026/0.011 | 0.49/0.52 | 0.87/0.91 | +0.33 | 0.70 |
| pairs_band500_p100 | ridge; band 500-6000 Hz; aug abs+pairs, pitch-pair x100 | 0.889 | 0.025/0.012 | 0.49/0.52 | 0.86/0.90 | +0.33 | 0.70 |
| pairs_band500_tilt_p100 | ridge; band 500-6000 Hz, tilt removed; aug abs+pairs, pitch-pair x100 | 0.873 | 0.016/0.013 | 0.41/0.48 | 0.72/0.79 | +0.29 | 0.77 |
| pairs_ct500_tilt | ridge; ct 500-6000 Hz, tilt removed; aug abs+pairs | 0.881 | 0.053/0.039 | 0.49/0.53 | 0.78/0.77 | +0.22 | 0.81 |
| logreg_band500_tilt | logreg; band 500-6000 Hz, tilt removed; no aug | 0.894 | 0.016/0.028 | 0.18/0.24 | 0.59/0.63 | +0.26 | 0.68 |
| mlp_band500_h16 | MLP h=16; band 500-6000 Hz; aug abs+pairs | 0.931 | 0.005/0.039 | 0.85/0.89 | 1.00/1.00 | +0.28 | 0.76 |
| mlp_band500_h64 | MLP h=64; band 500-6000 Hz; aug abs+pairs | 0.946 | 0.002/0.025 | 0.78/0.81 | 0.99/0.99 | +0.24 | 0.67 |
| moe_band500_k4 | mixture K=4; band 500-6000 Hz; aug abs+pairs | 0.928 | 0.004/0.039 | 0.78/0.83 | 0.98/0.99 | +0.29 | 0.75 |
| moe_band500_k16 | mixture K=16; band 500-6000 Hz; aug abs+pairs | 0.939 | 0.004/0.027 | 0.78/0.82 | 0.99/0.99 | +0.23 | 0.66 |
| mlp_band150_h64 | MLP h=64; band 150-6000 Hz; aug abs+pairs | 0.935 | 0.012/0.019 | 0.93/0.97 | 0.99/1.00 | +0.33 | 0.80 |
| moe_band150_k16 | mixture K=16; band 150-6000 Hz; aug abs+pairs | 0.949 | 0.004/0.013 | 0.70/0.73 | 0.99/0.99 | +0.25 | 0.60 |
| mlp_band500_h16_noaug | MLP h=16; band 500-6000 Hz; no aug | 0.952 | 0.009/0.022 | 0.30/0.34 | 0.72/0.72 | +0.22 | 0.58 |
| mlp_band500_h16_augabs | MLP h=16; band 500-6000 Hz; aug abs | 0.961 | 0.010/0.004 | 0.53/0.56 | 0.94/0.96 | +0.22 | 0.50 |
| mlp_band500_h16_tilt | MLP h=16; band 500-6000 Hz, tilt removed; aug abs+pairs | 0.937 | 0.015/0.054 | 0.73/0.79 | 0.97/0.98 | +0.23 | 0.72 |
| mlp_band500_h16_p10 | MLP h=16; band 500-6000 Hz; aug abs+pairs, pitch-pair x10 | 0.952 | 0.006/0.017 | 0.68/0.71 | 0.97/0.99 | +0.23 | 0.62 |
| mlp_band300_h16 | MLP h=16; band 300-6000 Hz; aug abs+pairs | 0.916 | 0.005/0.008 | 0.71/0.73 | 0.99/1.00 | +0.24 | 0.63 |
| mlp_hs500_h16 | MLP h=16; hs 500-6000 Hz; aug abs+pairs | 0.930 | 0.036/0.017 | 0.76/0.81 | 0.95/0.95 | +0.17 | 0.76 |
| pairs_hs500 | ridge; hs 500-6000 Hz; aug abs+pairs | 0.862 | 0.004/0.020 | 0.56/0.58 | 0.76/0.77 | +0.13 | 0.94 |

What the table shows:
- **Augmentation is what turns a sex classifier into a resonance meter.** Without augmentation, every model separates the sexes (AUC 0.87–0.95) but responds weakly to formant scaling: R3 0.15–0.30, sign 0.57–0.72. Absolute augmented rows raise sign to about 0.9. Explicit pair rows (Δ = ln fs, Δ = 0 for pitch) raise R3 to about 0.8 and sign to about 1.0.
- **Nonlinearity is what makes R4 possible.**
  - Every linear model scored on test has R4 of 0.83–0.94. Their vowel offsets track F1/F2 (/æ/ +1.17, /u/ −1.54 G for the ridge).
  - The MLP and mixture-of-experts models, given the same features and data, reach 0.40–0.50.
  - In effect they learn an implicit vowel-class correction from running speech, because the training target is constant per speaker across all phones.
- **CheapTrick and cepstral envelopes separate the sexes better but leak pitch** (R2 0.15–0.24 for linear models). The fixed-band envelope above 500 Hz leaks least.
- **The men's pitch-up toward-female move (+0.22 to +0.48 G per octave in CV) was never removed** by pitch-pair weighting (×10 to ×100), tilt removal or the band range. Most of it is the symmetric "any PSOLA shift" offset described in Verdict item 3.

## Test-split results (full runs unless marked)

| candidate | R1 5 s | R2 P/W | R3 P/W | sign P/W | R4 (95 % CI) | pass |
|---|---|---|---|---|---|---|
| le_logreg_band | 0.97 | 0.10/0.20 | 0.32/0.36 | 0.82/0.86 | 0.83 | R3, R4 ✗ |
| le_ridge_band500_pairs | 0.94 | 0.06/0.05 | 0.48/0.50 | 0.95/0.95 | 0.94 [0.81, 1.27] | R3, R4 ✗ |
| le_mlp_band500_h16 (s0/s1/s2) | 0.97/0.98/0.96 | 0.04–0.05 / 0.00–0.01 | 0.71–0.72 | 0.99 | 0.46 / 0.41 / 0.505 | ✓ / ✓ / R4 ✗ |
| le_mlp_band500_h64 (s0/s1/s2) | 0.97/0.97/0.97 | 0.03–0.04 / 0.01 | 0.71–0.72 | 0.99 | 0.48 / 0.40 / 0.44 | ✓ ✓ ✓ |
| le_ens_h16 | 0.97 | 0.04/0.01 | 0.72/0.74 | 0.99/0.99 | 0.46 [0.37, 0.54] | ✓ |
| **le_ens_h64** | **0.97** | **0.04/0.01** | **0.75/0.76** | **0.99/0.99** | **0.43 [0.36, 0.53]** | **✓** |
| le_ens_h64 --quick | 0.98 | 0.03/0.00 | 0.67/0.68 | 0.98/0.99 | 0.53 | R4 ✗ |
| le_ens_h64_prodf0 --quick | 0.97 | 0.05/0.05 | 0.65/0.66 | 0.98/1.00 | 0.59 (full hill: 0.45) | R4 ✗ on quick |
| (B2 ECAPA, for reference) | 1.00 | 0.15/0.15 | 0.22/0.19 | 0.79/0.81 | 0.155 [0.13, 0.19] | R3 ✗ |
| (B3 Praat VTL) | 0.86 | 0.06/0.04 | 0.65/0.65 | 0.84/0.85 | 0.635 [0.52, 0.79] | R3, R4 ✗ |

More detail for le_ens_h64:
- PTDB / FDA 5 s AUC 1.00 / 1.00. Hillenbrand token AUC 0.91 and speaker AUC 1.00.
- R1 for the highest- and lowest-F0 quarters of women vs men: 0.97 / 0.96.
- Training-sized changes: ×1.05 moves men 0.28 G toward female and ×0.95 moves women 0.22 G toward male. That is 10× the deployed ML meter (0.03 / 0.07).
- Combined male→female move (+12 st, ×1.15): 0.98 G, of which 91 % comes from the formant change alone; additivity 1.11.
- Results on the private session recordings (rubric item R6) are kept outside this repository.
- R8: 1.8 ms CPU per s of audio (Python), 0.2 MB of weights (3 × 66 KB JSON).

## Dev proxies for R4 that failed

1. **Synthetic Peterson & Barney vowels** (`r4proxy.py`; the cascade synthesiser, 12 synthetic speakers per sex). Linear models gave a plausible ranking. For MLPs the synthetic men–women gap collapses or flips sign (proxy values of −71 to +19), so it is unusable for nonlinear models. This is the same domain shift seen in R7.
2. **Real-speech vowel-space proxy** (`vowelproxy.py`).
   - Method: Praat F1/F2 per 150 ms dev-clean bin, Lobanov-normalised per speaker, 8 k-means vowel regions, then the SD across regions of a held-out speaker's region-mean scores / G.
   - Result: it ranks ridge (0.47) **better** than the MLP h16 (0.51). On test the R4 order is the opposite (0.94 vs 0.46).
   - It measures how strongly the score follows within-speaker formant variation. A more formant-sensitive model scores worse on it even though it is more vowel-robust on isolated tokens.
   - Rejected.

## JS / browser port

`le_band.mjs` is a self-contained ESM port with no dependencies: radix-2 FFT, band matrix, the
hs envelope, and linear / MLP / gated heads. It is streaming-shaped: voiced frames are fed in
time order and each 150 ms bin closes when time passes its end.

Parity against Python on 8 clips (321 bins), checked with `parity.py`:

| model | max abs difference | NaN-pattern mismatches |
|---|---|---|
| ridge | 8e-16 | 0 |
| MLP h16 | 1.7e-15 | 0 |
| MLP h64 | 1.0e-15 | 0 |

Cost in Node is 0.20 CPU-s for 63 s of audio (about 3 ms per s, including JIT warm-up). That is
about 100 FFTs of 1024 points per second plus a 35×64 + 64 MLP per bin. A 3-member ensemble
shares one envelope pass. The JSON weights are 66 KB per member.

In the app it would run in the pitch worker or a sibling worker:
- Use the pitch worker's 16 kHz resampled stream and its voicing decision.
- Run a 32 ms frame every 10 ms (or one per 25 ms chunk, at a slight resolution cost; untested).
- Emit every 150 ms.
- Display a rolling mean over the last few seconds of voiced bins. Time-to-stable is 1.5 s; for a stable trainee readout, take the mean over 5 s.

## Failure modes / open risks

- **R4 margin.** The single-seed and quick-subset variation straddles the 0.5 line, and there is no dev proxy to tune it. Back rounded vowels (/u/, /o/) read about 0.6 G "darker" and /æ/ about 0.6 G "brighter".
- **Unverified outside adult read speech.** This covers children (the synthetic results are unstable), very high or very low F0 beyond about 75–400 Hz, whisper, falsetto, singing, and non-English vowel systems.
- **High-F0 isolated vowels.** Sensitivity on women's Hillenbrand tokens at +8 st is 0.29 with sign 0.75, which hurts anyone holding high sustained vowels.
- **The resynthesis U-shape** (+0.06–0.14 G for any PSOLA shift). The benchmark cannot tell whether natural pitch raising produces a similar offset. The natural-F0 correlation (+0.2 G per octave within speaker) is confounded.
- **One microphone domain per corpus**, with LibriSpeech-only training. Channel and room effects on the 500–6000 Hz envelope are untested, and the level normalisation does not remove spectral tilt from microphones.
- **Not run on the production capture path.** That means 48 kHz capture, the browser resampler and the noise notch; the production pitch tracks did come from the src/dsp emulation.
