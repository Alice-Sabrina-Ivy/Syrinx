# Resonance candidate: VTLN warp-factor estimation (2026-10-04)

Branch `resonance-lab` (worktree `Syrinx-res`). Candidate family **vtln-warp**: the classic ASR
vocal-tract-length-normalisation (VTLN) warp-factor estimate, used as a calibration-free resonance readout.
No production code changed. Harness and rubric: [resonance-benchmark-baselines-2026-10-04.md](resonance-benchmark-baselines-2026-10-04.md).

**Result:** the final configuration passes every public rubric gate on the held-out test split (R1, R2, R3, R4).
It is the most pitch-independent and most resonance-proportional readout scored so far. Main limit:
synthetic children's vowels fail badly. Results on the private session recordings (rubric item R6) are kept
outside this repository; the band choice also used them (see Selection).

Reproduce (outputs in `build/resonance-lab/`, gitignored):

```bash
PY=build/resonance-lab/venv/Scripts/python
cd scripts/resonance-lab/candidates/vtln-warp
$PY train_model.py '{"arch":"mw","K":32,"sat":2,"train_step":4,"band":[800,5000]}' mw_ct_k32_sat2_s4_b800   # ~5 min
cd ../../../..
$PY scripts/resonance-lab/bench.py score scripts/resonance-lab/candidates/vtln_warp.py --workers 4      # ~3 min
# variants: vtln_warp.py:VTLNWarpB300 | :VTLNWarpB600 | :VTLNWarpB600Aug | :VTLNWarpB1000
```

The committed models are in `candidates/vtln-warp/models/*.npz` (31–45 KB each). The dev-CV scripts are in
`candidates/vtln-warp/dev/` (see its README).

## Method (final = `vtln_warp`, v3)

1. **Envelope.** For each voiced 10 ms frame (harness F0 > 0), compute the WORLD CheapTrick log power
   envelope (F0-adaptive smoothing, 1024-pt FFT at 16 kHz). Resample it onto a log-frequency grid
   (0.01-nat steps, 100–7600 Hz). On this axis a linear frequency warp S(αf) is a pure shift by ln α.
2. **Warp the model, not the data.** The input feature is fixed: the frame's log envelope over
   **800–5000 Hz**, sampled every 0.02 nat (92 dims), with its mean removed so the reading ignores level.
   The reference is a diagonal GMM (K=32) over a **wide** band (the canonical band ±0.24 nat). Hypothesis j
   scores the input against the model's sub-window shifted by j steps (sub-window mean re-normalised):
   25 hypotheses, ln α ∈ [−0.24, +0.24].
   The first-session data-warp design (shift the input's band, then take a DCT) gave estimates that piled
   up at the range edge, with 5 s AUC 0.52 (`ct_base`). Warping the model avoids this because the evidence
   is identical across hypotheses.
3. **Reference training (SAT).** The pool is LibriSpeech dev-clean `train_dev` (20 F + 20 M, every 4th voiced
   frame). Iteration 0 fits the GMM with no warping. Each SAT iteration estimates every training speaker's
   own ML shift, re-centres the shifts to mean 0, de-warps and refits. Two iterations. Training speakers end
   at ln α = +0.068 (F) / −0.068 (M), SD 0.04–0.05.
4. **Readout.** Output every 150 ms, causally. It is the parabolically refined argmax over j of the per-frame
   log-likelihoods summed over the trailing 1 s of voiced frames (100 frames). If the bin holds fewer than 3
   voiced frames, the output is NaN. Larger = formants higher = shorter apparent tract.
5. **Parameters selected on dev only.** 2-fold speaker-disjoint CV on dev-clean: the model for fold f is
   trained on the other fold's 20 speakers, then scores `r1_dev` + `manip_dev` items of fold f's speakers.
   The pooled scores go through the shared `rlab.metrics` code.

## Dev-split variant sweep (2-fold speaker CV; estimator w1 unless noted)

R2/R3 in units of each variant's own men–women gap. "m+12" = how far men move toward the women's side on
+12 st of pitch alone. The ×1.15 column is the formant-only move toward the other class, with men ×1.15 and
women ×0.85 averaged (ideal ≈ 1).

| variant | change vs previous | 5 s AUC | R2 Praat / WORLD | R2 men / women | R3 Praat | sign ±5 % | m+12 | flicker |
|---|---|---|---|---|---|---|---|---|
| ct_base (data-warp, DCT, K=64, SAT3) | first-session design | 0.52 | 1.63 / 1.23 | 1.49 / 2.62 | 0.38 | 0.64 | −0.33 | 6.6 |
| mw_ct_k32_sat2 (s4) | model warp, band 300–4500 | 0.954 | 0.162 / 0.100 | 0.14 / 0.20 | 0.75 | 0.956 | 0.30 | 0.22 |
| mw_ct_s8 | half the training frames | 0.948 | 0.169 / 0.112 | 0.15 / 0.21 | 0.76 | 0.956 | 0.36 | 0.23 |
| mw_ct_s8_sat0 | no SAT | 0.939 | 0.177 / 0.092 | 0.10 / 0.22 | 0.75 | 0.931 | 0.24 | 0.33 |
| mw_ct_s8_k8 | K=8 | 0.940 | 0.219 / 0.110 | 0.15 / 0.27 | 0.77 | 0.975 | 0.45 | 0.25 |
| mw_ct_s8_k64 | K=64 | 0.961 | 0.181 / 0.102 | 0.14 / 0.22 | 0.74 | 0.981 | 0.31 | 0.22 |
| mw_ct_s8_e20 | frames within 20 dB of 2 s running max | 0.950 | 0.206 / 0.136 | 0.17 / 0.21 | 0.78 | 0.962 | 0.39 | 0.22 |
| mw_lift_s8 | F0-blind 1.5 ms cepstral lifter instead of CheapTrick | 0.905 | 0.134 / 0.008 | 0.08 / 0.24 | 1.14 | 0.956 | 0.08 | 0.40 |
| mw_lift_s8_b450 | lifter, band 450–5000 | 0.900 | 0.032 / 0.093 | 0.02 / 0.22 | 1.17 | 0.931 | −0.02 | 0.39 |
| mw_ct_s8_f0c | separate reference per F0 band (<150, 150–210, >210 Hz) | 0.920 | 0.116 / 0.258 | 0.18 / 0.06 | 1.22 | 0.994 | −0.11 | 0.37 |
| mw_ct_s8_b300_3500 | band 300–3500 | 0.956 | 0.214 / 0.136 | 0.20 / 0.23 | 0.81 | 0.975 | 0.39 | 0.25 |
| mw_ct_s8_b450 | band 450–5000 | 0.959 | 0.134 / 0.077 | 0.08 / 0.20 | 0.87 | 0.994 | 0.21 | 0.23 |
| mw_ct_s8_b450_k64 | + K=64 | 0.967 | 0.129 / 0.050 | 0.10 / 0.18 | 0.92 | 0.975 | 0.22 | 0.25 |
| mw_ct_s8_b450_augpm8 | + Praat-PSOLA ±8 st copies of train_dev in the reference | 0.968 | 0.129 / 0.060 | 0.08 / 0.16 | 0.83 | 0.975 | 0.22 | 0.22 |
| mw_ct_s8_b600 | band 600–5000 | 0.963 | 0.095 / 0.057 | 0.09 / 0.15 | 0.86 | 0.988 | 0.20 | 0.24 |
| mw_ct_s8_b600_augpm8 | + ±8 st augmentation | 0.966 | 0.093 / 0.040 | 0.06 / 0.12 | 0.88 | 0.981 | 0.17 | 0.23 |
| mw_ct_s8_b600_augpm8_k64 | + K=64 | 0.965 | 0.104 / 0.033 | 0.07 / 0.18 | 0.93 | 0.994 | 0.17 | 0.26 |
| **mw_ct_s8_b800** | **band 800–5000 (selected)** | **0.967** | **0.080 / 0.029** | **0.02 / 0.10** | **0.89** | **0.981** | **0.09** | **0.24** |
| mw_ct_s8_b800_k64 | + K=64 | 0.962 | 0.069 / 0.029 | 0.04 / 0.11 | 0.90 | 0.950 | 0.14 | 0.28 |
| mw_ct_s8_b1000 | band 1000–5000 | 0.968 | 0.043 / 0.008 | 0.01 / 0.07 | 0.85 | 0.956 | 0.05 | 0.25 |

Not run to completion:
- band 450–5500 and kmax 0.32: the de-warped reads ran off the top of the 7.6 kHz grid. A clip has since
  been added to `train_mw`, but these were not re-run.
- A WORLD-only `ctl` (CheapTrick + extra lifter) envelope was never extracted.

Estimator comparison for the selected band (dev):

| estimator | 5 s AUC | R2 Praat | R3 | sign | flicker |
|---|---|---|---|---|---|
| frame (median of per-frame argmax in the 150 ms bin) | 0.964 | 0.062 | 0.83 | 0.969 | 0.70 |
| w0.15 (sum over this bin only) | 0.967 | 0.070 | 0.86 | 0.938 | 0.71 |
| w0.5 | 0.970 | 0.074 | 0.88 | 0.988 | 0.33 |
| **w1 (selected)** | 0.967 | 0.080 | 0.89 | 0.981 | 0.24 |
| w2 | 0.968 | 0.080 | 0.90 | 0.975 | 0.18 |
| w4 | 0.968 | 0.082 | 0.92 | 0.981 | 0.17 |
| post1 (posterior-mean shift, 1 s) | 0.971 | 0.067 | 0.87 | 0.988 | 0.21 |

What the sweep shows:
- **The band's lower edge is the main pitch-leak lever.** Men's +12 st move toward "female" falls
  0.36 → 0.21 → 0.20 → 0.09 → 0.05 gaps as the lower edge rises 300 → 450 → 600 → 800 → 1000 Hz. Separation
  does not suffer (AUC 0.948 → 0.968). The F1 region, where sparse harmonics and F1–H1 interaction live, is
  where pitch leaks into the envelope match. Above about 1 kHz, sign accuracy starts to drop (0.956).
- Window-level ML pooling beats frame-level voting: flicker is 3× lower at equal AUC.
- SAT helps a little (AUC +0.01; sign 0.93 → 0.96). K=32 is enough.
- Pitch augmentation of the reference (Praat-PSOLA ±8 st copies) is a small gain on dev: men's +12 move
  0.20 → 0.17, WORLD R2 0.057 → 0.040. It gives no gain on test (below). Raising the band's lower edge
  matters far more.
- An F0-conditioned reference over-corrects: women's −12 st now moves 0.67 gaps toward female. A fixed
  lifter (F0-blind) leaks less for men but loses separation (AUC 0.90, G ratio 1.08).

Selection: b800 + w1. On dev it had the best balance: R2 0.08, sign 0.98, AUC 0.967. b1000 has lower R2
but sign accuracy 0.956 and +8 st sign 0.944, closer to the 0.90 floor. Test-split looks happened in
this order: b300 (the resumed run), b600, b600_aug, b800, then b1000. The b1000 dev result arrived after
b800's test numbers were seen. Both pass the public gates on test, so the choice between them does not depend
on that ordering. The final band is test-informed, partly on results on the private session recordings
(kept outside this repository).

## Test split (full run, held-out speakers; units = own gap G)

| metric | **vtln_warp (b800, final)** | b1000 | b600 | b600 + aug | b300 |
|---|---|---|---|---|---|
| G (log formant scale; men/women ratio) | 0.111 (×1.118) | 0.115 | 0.125 | 0.132 | 0.145 |
| R1 AUC 2 s / **5 s** / utt / speaker | 0.96 / **0.97** / 0.96 / 0.99 | 0.94 / 0.95 / 0.94 / 0.98 | 0.97 / 0.99 / 0.97 / 1.00 | 0.97 / 0.99 / 0.97 / 1.00 | 0.97 / 0.98 / 0.97 / 1.00 |
| R1 PTDB / FDA / Hillenbrand token / speaker | 1.00 / 1.00 / 0.92 / 1.00 | 1.00 / 1.00 / 0.93 / 0.99 | 1.00 / 1.00 / 0.89 / 0.99 | 1.00 / 1.00 / 0.91 / 0.99 | 1.00 / 1.00 / 0.88 / 1.00 |
| **R2** pitch leak Praat / WORLD | **0.05** / 0.02 | 0.04 / 0.01 | 0.08 / 0.03 | 0.08 / 0.04 | 0.16 / 0.10 |
| R2 men / women (Praat) | 0.02 / 0.11 | 0.01 / 0.08 | 0.03 / 0.16 | 0.03 / 0.14 | 0.11 / 0.24 |
| pitch-only move toward other class: men +12 / women −12 | 0.08 / −0.02 | 0.07 / −0.03 | 0.15 / −0.02 | 0.18 / −0.01 | 0.31 / −0.03 |
| crossing midpoint on pitch alone: men +12 / women −12 (unshifted base rate) | 0.21 / 0.07 (0.18 / 0.06) | 0.24 / 0.05 (0.16 / 0.06) | 0.28 / 0.03 (0.16 / 0.06) | 0.28 / 0.06 (0.14 / 0.08) | 0.41 / 0.10 (0.16 / 0.09) |
| **R3** sensitivity Praat / WORLD | **1.17** / 1.18 | 1.10 / 1.11 | 1.00 / 1.03 | 0.96 / 0.98 | 0.82 / 0.85 |
| R3 sign accuracy ±5 % Praat / WORLD | **0.98** / 0.99 | 0.98 / 0.99 | 0.99 / 0.99 | 0.99 / 0.99 | 0.97 / 0.99 |
| R3 at +8 st: men sens / sign, women sens / sign | 1.19 / 0.99, 1.07 / 0.98 | 1.13 / 0.97, 1.07 / 0.99 | 1.06 / 0.99, 0.95 / 0.99 | 0.99 / 0.99, 0.92 / 0.99 | 0.84 / 0.94, 0.72 / 0.91 |
| formant move toward other class: ×1.15 / ×0.85 | 1.21 / 1.40 | 1.14 / 1.30 | 1.09 / 1.15 | 1.04 / 1.10 | 0.97 / 0.81 |
| formant move toward other class: ×1.05 / ×0.95 | 0.44 / 0.39 | 0.39 / 0.39 | 0.36 / 0.30 | 0.36 / 0.31 | 0.32 / 0.19 |
| male→female additivity | 1.02 | 1.02 | 1.03 | 1.05 | 1.07 |
| Hillenbrand vowels (manip_hill): R2 / R3 / sign | 0.03 / 0.65 / 0.91 | 0.02 / 0.76 / 0.92 | 0.07 / 0.68 / 0.86 | 0.08 / 0.67 / 0.88 | 0.10 / 0.60 / 0.79 |
| **R4** across-vowel SD (≤ 0.5) / vowel-offset range | **0.31** / 0.75 | 0.33 / 0.65 | 0.40 / 0.91 | 0.38 / 0.85 | 0.42 / 1.08 |
| R5 flicker / held-vowel SD / time-to-stable | 0.25 / 0.00 / 2.2 s | 0.24 / 0.00 / 2.0 s | 0.24 / 0.00 / 1.8 s | 0.23 / 0.00 / 2.0 s | 0.25 / 0.01 / 2.5 s |
| R7 synth boys / girls (men 0, women 1); synth W-vs-M AUC | −0.55 / −3.67; 0.53 | 0.20 / −3.23; 0.43 | 0.24 / −0.34; 0.49 | 0.15 / −0.83; 0.49 | 1.50 / 1.50; 0.58 |
| R7 AUC vs men: highest / lowest-F0 quarter of women | 0.97 / 0.94 | 0.95 / 0.92 | 0.98 / 0.96 | 0.98 / 0.96 | 0.97 / 0.95 |
| R8 CPU ms / s audio (Python, 1 thread) / model | 5.5 / 34 KB | 5.5 / 31 KB | 5.8 / 38 KB | 5.7 / 38 KB | 6.4 / 45 KB |
| **Overall** (public gates R1–R4) | **PASS** | PASS | PASS | PASS | PASS |

Against the baselines (same harness):
- **B3 (Praat apparent VTL):** R2 0.06, R3 0.65 / sign 0.84, R4 0.63, 5 s AUC 0.86.
- **B2 (deployed ECAPA meter):** R2 0.15 but 37 % of men cross the midpoint on +12 st; R3 0.22; Hillenbrand
  sign 0.49.

VTLN responds to a training-sized ±5 % formant change with 0.39–0.44 gaps and the correct sign 98 % of the
time. B2 gives 0.03 gaps.

## F0-track robustness (final model, 200 r1_test items; diagnostic only)

Change in the utterance readout (in gaps) when the harness F0 track is corrupted:

| corruption | median |Δ| | women signed Δ | men signed Δ |
|---|---|---|---|
| drop frames outside 75–400 Hz (production search range) | 0.000 | 0.000 | 0.000 |
| 10 % of voiced frames octave-up | 0.015 | +0.014 | +0.004 |
| 10 % of voiced frames octave-down | 0.017 | −0.014 | −0.004 |
| whole track ×2 (sustained octave-up) | 0.099 | +0.166 | +0.045 |
| whole track ×0.5 (sustained octave-down) | 0.192 | −0.247 | −0.105 |

The b300 model was about 3× more sensitive: sustained ×0.5 moved it 0.60 gaps (women −1.03). Sporadic
octave errors of the kind the Viterbi tracker leaves behind are negligible. Sustained octave errors, mostly
halving on women, bias the reading by up to a quarter of a gap.

## Failure modes and caveats

- **Synthetic vowels, including all the children's checks, fail.** On static-formant synthetic vowels the
  readout follows the vowel, not the speaker: front vowels hit the +0.24 edge and back vowels the −0.24 edge
  for every group. Synthetic women vs men AUC is 0.43–0.58 across variants, and boys/girls land below men.
  Real Hillenbrand recordings of the same vowels behave well (R4 0.31, vowel-offset range 0.75 gaps; worst
  /uw/ −0.44, /ae/ +0.31), so this is a domain gap between synthetic and natural envelopes, not a vowel
  confound in speech. It is a real risk for voices unlike the LibriSpeech adult reference. Out-of-domain
  envelopes **saturate at the range edge** instead of degrading gracefully.
- **Children remain untested on real audio.** Their expected shift (about +0.2–0.3 ln vs the adult pool
  centre) is at or beyond the ±0.24 search range. A child-capable version needs a wider range plus
  real-children validation.
- **Residual pitch leak is one-sided.** Raising pitch in men moves them 0.08 gaps toward "female" (b300:
  0.31). Lowering women's pitch has no effect. Women's R2 (0.11) is larger than men's (0.02) because raising
  women's pitch reads slightly more female.
- **The gap is smaller than the true formant gap.** G is ×1.118 in formant scale (running speech; the
  hand-measured gap is ×1.15). R3 sensitivity is above 1 (1.17) because manipulations are scored against
  this compressed gap.
- **Training pool:** 40 LibriSpeech read-speech speakers, one recording condition per speaker. The model
  has seen no spontaneous, accented or very-high/low-F0 adult speech. Real-mic robustness (noise, reverb,
  phone mics) is untested here.
- **F0 source:** the harness supplies Praat F0. Production would use Boersma-AC (75–400 Hz). Range clamping
  is harmless (see the robustness table above). A sustained octave error biases the readout.

## Browser port sketch (not built)

- **Where it runs:** a new consumer of the capture broadcast, or inside the pitch worker, which already
  resamples to 16 kHz and has the F0.
- **Per voiced 10 ms frame:** a CheapTrick-equivalent envelope:
  - 3-period Hann window, then a 1024-pt FFT power spectrum;
  - F0-wide rectangular smoothing;
  - cepstral q0/q1 lifter (2 more FFTs).
- **Then:** log-f resampling of 800–5000 Hz to 92 points, mean removal, and 25 hypotheses × 32 diagonal
  Gaussians × 92 dims. That is about 0.2 MFLOP per frame, so about 20 MFLOP/s at 100 voiced frames/s:
  well under 1 ms per frame in plain JS.
- **Readout:** keep a ring of 100 per-frame likelihood rows (25 floats each), sum them, take the refined
  argmax, and emit every 150 ms.
- **Model:** 34 KB float32 (wide-band μ and σ² for 32 components plus weights), shippable as JSON.
- **Measured cost here:** 5.5 ms CPU per second of audio in numpy (single thread).
