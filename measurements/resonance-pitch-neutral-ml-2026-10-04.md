# Pitch-neutralised ML resonance candidates (pitch-neutral-ml) — 2026-10-04/05

Branch `resonance-lab` (worktree `Syrinx-res`). Family: make the deployed ECAPA
"Perceived voice" model (q8-v2) judge **pitch-neutral** input — resynthesise each window
at a FIXED reference F0 with the spectral envelope kept, then run the model — and, as a
follow-up, replace its final layer with a small head trained to read formant scale.
Scored on the shared resonance-validity benchmark
([resonance-benchmark-baselines-2026-10-04.md](resonance-benchmark-baselines-2026-10-04.md)).
No production code changed (`src/` untouched).

Code: [scripts/resonance-lab/candidates/pitch-neutral-ml/](../scripts/resonance-lab/candidates/pitch-neutral-ml/)

| file | what |
|---|---|
| `pnml_core.py` | resynthesis engines (TD-PSOLA, Praat PSOLA, WORLD, LPC vocoder), B2-identical windowing, raw-logit / embedding caches |
| `pnml.py` | every candidate class scored below (`bench.py score ".../pnml.py:<name>"`) |
| `gen_head_train.py`, `train_head.py` | head training data (train_dev only) and ridge / logistic heads |
| `cv_heads.py` | speaker-disjoint 5-fold dev evaluation of the heads (`--raw` for the ablation) |
| `fold_head.py` | folds a head into the ONNX final layer (deployable artifact) |
| `tdpsola.mjs` | streaming-ready JS TD-PSOLA (browser-port prototype) |
| `prodf0.mjs`, `precompute_prodf0.py` | production pitch-detector (Boersma-AC pitch-worker) emulation for the `_prodf0` variants |

Outputs (gitignored): `build/resonance-lab/pitch-neutral-ml/` (caches, head JSONs, logs,
`export/*.onnx`) and `build/resonance-lab/results/pnml_*.json`.

```bash
PY=build/resonance-lab/venv/Scripts/python
F=scripts/resonance-lab/candidates/pitch-neutral-ml/pnml.py
$PY scripts/resonance-lab/bench.py score "$F:pnml_tdpsola165_logit" --workers 6     # plain family, test
$PY scripts/resonance-lab/candidates/pitch-neutral-ml/gen_head_train.py 6 [--raw]   # head data, train_dev only
$PY scripts/resonance-lab/candidates/pitch-neutral-ml/train_head.py [--raw] scale scalesex sex scalesex035 scalesex100 scalesex140
$PY scripts/resonance-lab/candidates/pitch-neutral-ml/cv_heads.py embed [--raw]; $PY .../cv_heads.py eval [--raw]
$PY scripts/resonance-lab/bench.py score "$F:pnml_head_scalesex_none0" --workers 6   # best configuration
```

## TL;DR (test split, full run, unless marked "dev" / "quick")

1. **Input pitch-neutralisation alone removes most of the pitch leak but does not make a
   resonance meter.** TD-PSOLA to a fixed 165 Hz in front of the unchanged model: R2
   0.15 → 0.04 (Praat) / 0.00 (WORLD), AUC 1.00, men pushed toward "female" by +12 st
   0.35 → 0.23 G — but R3 only 0.22 → 0.40 (sign 0.79 → 0.93), and on isolated
   Hillenbrand vowels R3 0.21 / sign 0.53 (chance). All 20 plain variants on dev (5
   reference pitches, 2- and 3-pitch averages, 4 engines, fixed grains, 1.5 s window,
   prob vs logit, production F0) land at R3 0.26-0.38. **Plain family: FAIL (R3).**
   Once pitch is gone, ECAPA's men/women decision rests mostly on cues other than
   formant scale.
2. **What works is a re-trained readout, not the resynthesis.** Replace the model's final
   layer (fc7) with a 192→1 ridge head on its fc6 embedding, trained (train_dev only) to
   output ln(formant scale) + c·(±1 for women/men) on dev-clean speech WORLD-warped
   ×0.85-1.15 and pitch-jittered ±7 st. At the **a-priori c = 0.07** (≈ ln 1.15 / 2):
   * raw (un-flattened) input — `pnml_head_scalesex_none0` — **passes every public gate (R1–R4)**:
     R1 0.99, R2 0.01 / 0.03, **R3 0.88 / 0.89, sign 1.00 / 1.00** (Praat / WORLD),
     R3 at +8 st 0.93 (m) / 0.88 (f), **R4 0.35**.
   * TD-PSOLA input — `pnml_head_scalesex_tdpsola165` — passes R1-R3 (R3 0.86,
     sign 0.99) but **fails R4 (0.61)**: the flattening makes the head more
     vowel-dependent.
3. **The pass is not a knife edge and was not chosen on test.** c was fixed before any
   test run; the speaker-disjoint dev CV agrees (raw head c = 0.07: AUC 0.98, R2 0.02,
   R3 0.76, sign 1.00). On test, c ∈ {0.07, 0.10, 0.14} all pass; c = 0.035 fails (R2
   0.26, R3 1.52). On dev, c = 0.14 drops to R3 0.45 — the robust window is c ≈
   0.07-0.10.
4. **Pitch neutrality comes from the training augmentation, not resynthesis.** The head
   learns to ignore pitch because pitch was jittered independently of the target. The
   flattened variants are no better on R2 and worse on R4.
5. **Limits** (§6): "resonance" is learned from WORLD envelope warping. The Praat engine
   (sign 1.00) is the out-of-engine check, plus the private-session ordering (R6; results
   kept outside this repository). On isolated hVd vowels the head reaches only R3 0.46 /
   sign 0.80. Much of the men/women separation comes from the non-resonance sex term: a
   pure formant-scale head reaches only R1 0.77 (flattened) or 0.54 (raw). Children are
   untested on real audio. The synthetic boys/girls read at 0.82 / 1.01 of the way from
   men to women, not beyond women.
6. **Browser**: the head folds into the deployed ONNX's final layer (16.06 MB, same graph).
   The unchanged transformers.js audio-classification pipeline reproduces the Python
   head score to 1.7e-7 on 40 real windows, so the meter keeps the deployed ~52 ms
   desktop WASM inference. The recommended variant needs no resynthesis and no pitch
   track beyond the existing VAD hint.

## Method

**Windowing (all variants)**: identical to B2 / `src/ml/gender-worker.js`: causal
0.75 s window every 150 ms (0.75 s zero lead, 0.5 s zero tail), voicing-recency gate
(voiced F0 frame in the trailing 500 ms, from the supplied track), EMA α = 0.2 on the
window output, reset after 14 silent windows. `prob` outputs = 100·EMA(p_female)
pooled by mean (the deployed meter's scale); `logit` = EMA(female−male logit) pooled by
median (unsaturated, so leak is not hidden by saturation).

**Resynthesis engines** (`pnml_core.py`), all driven by the supplied F0 track. Voiced
stretches are resynthesised at the fixed F_ref, unvoiced audio is passed through, a
5 ms raised-cosine crossfade joins them, and the voiced output is RMS-matched to the
input per 20 ms.
* `tdpsola`: own TD-PSOLA. Analysis marks are peak-picked on a 1 kHz low-pass along the
  F0 track. Grains are 2 local periods with a Hann window, overlap-added at a spacing of
  sr/F_ref. Variants: `G67` / `G10` use fixed 6.7 / 10 ms grains, so every source F0
  gets the same envelope resolution. This is the reference for the JS port.
* `praat`: Praat Manipulation → constant PitchTier → overlap-add.
* `world`: pyworld CheapTrick + D4C on the supplied F0, resynthesised at F_ref.
* `lpc`: crude 18-pole LPC vocoder (pulse train at F_ref; noise when unvoiced).
* Multi-reference (`avg…`): raw logits averaged over 2-3 F_ref per window before the
  EMA.

**Learned head** (`gen_head_train.py`, `train_head.py`), **train_dev only** (LibriSpeech
dev-clean, 40 speakers, never a test speaker):
* Data: per utterance, a ≤ 4 s crop and 3 random (α, st) draws, with α log-uniform in
  [0.85, 1.15] and st uniform in [−7, +7]. WORLD analysis then warps the envelope and
  aperiodicity, S′(f) = S(f/α), sets F0 × 2^(st/12), resynthesises and RMS-matches. For
  the flattened variant the result is TD-PSOLA'd to 165 Hz with the scaled track; for
  `none0` it is left as is (same random draws, so the ablation is paired).
* Output: the ECAPA fc6 embedding (192-d, `relu_33`) on non-overlapping 0.75 s windows
  with ≥ 0.3 s voiced, giving 28,563 windows.
* Targets: `scale` = ln α; `scalesexNNN` = ln α + NNN/1000 · (+1 women / −1 men), with
  `scalesex` = c 0.07; `sex` = logistic women vs men (a plain re-head, for reference).
* Fit: standardised features, ridge (λ by 5-fold speaker-grouped CV on train_dev).
* The head replaces fc7. `fold_head.py` writes it into the graph as logits [0, s], so
  softmax "female" = sigmoid(s).

**Evaluation discipline**:
* Test-split numbers come from the shared harness (`bench.py score`).
* The dev split (`r1_dev`, `manip_dev`) is dev-clean, i.e. the head's own training
  speakers, so `--split dev` cannot score a head honestly. `cv_heads.py` re-fits every
  head in 5 speaker folds and scores each dev item only with the head that never saw
  its speaker. Metrics come from the harness's own `rlab.metrics`.
* c = 0.07 was set a priori. The c sweep (0.035 / 0.10 / 0.14) was run for the
  tradeoff and is reported in full. The recommendation does not depend on it.

## 1. Plain family (input neutralisation + unchanged model), dev quick subset

Dev-clean, `--split dev --quick` (320 r1_dev utterances, 840 manip_dev items from 20
sources). P = Praat engine, W = WORLD engine; R2/R3 in units of the variant's own G.

| variant | engine / F_ref / window / output | AUC 5 s | R2 P / W | M +12 st toward | R3 P / W | sign ±5 % P / W | R3 +8 st m / f | flicker |
|---|---|---|---|---|---|---|---|---|
| `pnml_none0_prob` | none (= B2 input) · 0.75 s · prob | 0.99 | 0.12 / 0.12 | 0.32 | 0.18 / 0.15 | 0.72 / 0.65 | 0.39 / 0.01 | 0.02 |
| `pnml_none0_logit` | none (= B2 input) · 0.75 s · logit | 0.99 | 0.18 / 0.15 | 0.46 | 0.21 / 0.19 | 0.75 / 0.70 | 0.41 / 0.11 | 0.07 |
| `pnml_none0_prodf0_logit` | none (= B2 input) · 0.75 s · logit · production F0 for the gate | 0.99 | 0.17 / 0.16 | 0.42 | 0.21 / 0.17 | 0.82 / 0.70 | 0.38 / 0.11 | 0.10 |
| `pnml_tdpsola135_logit` | tdpsola · 135 Hz · 0.75 s · logit | 0.99 | 0.01 / 0.01 | 0.09 | 0.35 / 0.31 | 0.90 / 0.82 | 0.38 / 0.19 | 0.11 |
| `pnml_tdpsola150_logit` | tdpsola · 150 Hz · 0.75 s · logit | 0.99 | 0.01 / 0.02 | 0.13 | 0.34 / 0.30 | 0.93 / 0.85 | 0.49 / 0.15 | 0.11 |
| `pnml_tdpsola165_logit` | tdpsola · 165 Hz · 0.75 s · logit | 0.99 | 0.00 / 0.02 | 0.24 | 0.31 / 0.30 | 0.90 / 0.85 | 0.55 / 0.14 | 0.12 |
| `pnml_tdpsola165_prob` | tdpsola · 165 Hz · 0.75 s · prob | 0.98 | 0.02 / 0.02 | 0.16 | 0.26 / 0.24 | 0.88 / 0.82 | 0.44 / 0.04 | 0.09 |
| `pnml_tdpsola180_logit` | tdpsola · 180 Hz · 0.75 s · logit | 0.99 | 0.00 / 0.02 | 0.23 | 0.31 / 0.30 | 0.95 / 0.85 | 0.56 / 0.14 | 0.11 |
| `pnml_tdpsola200_logit` | tdpsola · 200 Hz · 0.75 s · logit | 0.99 | 0.02 / 0.03 | 0.20 | 0.35 / 0.32 | 0.88 / 0.90 | 0.64 / 0.16 | 0.13 |
| `pnml_tdpsolaavg150_180_logit` | tdpsola · 150/180 Hz · 0.75 s · logit | 0.99 | 0.01 / 0.01 | 0.15 | 0.31 / 0.30 | 0.93 / 0.85 | 0.53 / 0.15 | 0.11 |
| `pnml_tdpsolaavg140_165_190_logit` | tdpsola · 140/165/190 Hz · 0.75 s · logit | 0.99 | 0.01 / 0.01 | 0.18 | 0.31 / 0.31 | 0.90 / 0.88 | 0.53 / 0.15 | 0.11 |
| `pnml_tdpsola165_w1500_logit` | tdpsola · 165 Hz · 1.5 s · logit | 0.99 | 0.00 / 0.02 | 0.20 | 0.28 / 0.26 | 0.90 / 0.85 | 0.55 / 0.10 | 0.13 |
| `pnml_tdpsola fixed 6.7 ms grains165_logit` | tdpsolaG67 · 165 Hz · 0.75 s · logit | 0.99 | 0.01 / 0.06 | 0.03 | 0.38 / 0.33 | 0.82 / 0.82 | 0.60 / 0.15 | 0.17 |
| `pnml_tdpsola fixed 10 ms grains165_logit` | tdpsolaG10 · 165 Hz · 0.75 s · logit | 0.99 | 0.02 / 0.07 | 0.11 | 0.34 / 0.34 | 0.93 / 0.85 | 0.59 / 0.18 | 0.13 |
| `pnml_tdpsola165_prodf0_logit` | tdpsola · 165 Hz · 0.75 s · logit · production F0 track | 0.99 | 0.03 / 0.02 | 0.25 | 0.30 / 0.28 | 0.93 / 0.88 | 0.46 / 0.13 | 0.14 |
| `pnml_praat165_logit` | praat · 165 Hz · 0.75 s · logit | 0.99 | 0.01 / 0.02 | 0.15 | 0.31 / 0.31 | 0.95 / 0.90 | 0.50 / 0.16 | 0.12 |
| `pnml_world165_logit` | world · 165 Hz · 0.75 s · logit | 0.99 | 0.01 / 0.01 | 0.25 | 0.31 / 0.31 | 0.93 / 0.82 | 0.48 / 0.13 | 0.13 |
| `pnml_world165_prob` | world · 165 Hz · 0.75 s · prob | 0.99 | 0.01 / 0.01 | 0.21 | 0.27 / 0.25 | 0.85 / 0.85 | 0.52 / 0.10 | 0.09 |
| `pnml_lpc165_logit` | lpc · 165 Hz · 0.75 s · logit | 0.99 | 0.01 / 0.03 | 0.03 | 0.36 / 0.34 | 0.90 / 0.88 | 0.53 / 0.21 | 0.13 |
| `pnml_lpc165_prob` | lpc · 165 Hz · 0.75 s · prob | 0.99 | 0.00 / 0.01 | 0.01 | 0.31 / 0.31 | 0.88 / 0.88 | 0.49 / 0.10 | 0.08 |

* **Every resynthesis variant collapses R2** (0.00-0.03 vs 0.18 for the same model on raw
  audio, logit output). The men-only residual (+12 st toward-female 0.03-0.25 G) is
  smallest for the LPC vocoder and fixed 6.7 ms grains, which remove the most
  source-F0-dependent spectral detail. Those two also have the worst sign accuracy.
* **R3 is pinned at 0.26-0.38 whatever the engine, reference pitch, averaging or
  window.** Multi-reference averaging (150/180, 140/165/190) changes nothing (R3 0.31)
  at 2-3× the inference cost. A higher F_ref raises men's R3 at +8 st and lowers
  women's.
* The production pitch track (Boersma-AC emulation, `prodf0.mjs`) instead of the
  harness's two-pass Praat track changes R2 by +0.03 and R3 by −0.01.

## 2. Test split — every variant scored on the full harness

`b2_ecapa` is the deployed baseline. "M +12 st toward / cross (base)" = median move of
men toward female from pitch alone, in G, and the share of men crossing the men/women
midpoint (base rate unshifted). Hill-manip = the same manipulations on isolated
Hillenbrand vowels. R7 = synthetic children, position on the synthetic men (0) → women
(1) axis.

| variant | R1 AUC 5 s | R2 Praat / WORLD | M +12 st toward / cross (base) | R3 Praat / WORLD | sign ±5 % P / W | R3 +8 st m / f | Hill-manip R3 / sign | R4 | R7 boys / girls | flicker | pass |
|---|---|---|---|---|---|---|---|---|---|---|---|
| `b2_ecapa` | 1.00 | 0.15 / 0.15 | 0.35 / 0.37 (0.00) | 0.22 / 0.19 | 0.79 / 0.81 | 0.54 / 0.04 | 0.05 / 0.49 | 0.15 | 0.95 / 0.93 | 0.03 | fail R3 |
| `pnml_tdpsola165_prob` | 1.00 | 0.03 / 0.00 | 0.17 / 0.21 (0.06) | 0.35 / 0.36 | 0.88 / 0.91 | 0.62 / 0.07 | 0.21 / 0.55 | 0.44 | 0.58 / 0.28 | 0.12 | fail R3 |
| `pnml_tdpsola165_logit` | 1.00 | 0.04 / 0.00 | 0.23 / 0.18 (0.05) | 0.40 / 0.39 | 0.93 / 0.94 | 0.64 / 0.15 | 0.21 / 0.53 | 0.38 | 0.58 / 0.32 | 0.15 | fail R3 |
| `pnml_head_sex_tdpsola165` | 1.00 | 0.15 / 0.12 | 0.43 / 0.53 (0.07) | 0.28 / 0.30 | 0.82 / 0.87 | 0.40 / 0.19 | 0.24 / 0.61 | 0.49 | 0.63 / 0.34 | 0.20 | fail R3 |
| `pnml_head_scale_tdpsola165` | 0.77 | 0.18 / 0.12 | -0.47 / 0.11 (0.32) | 2.13 / 2.15 | 0.98 / 0.98 | 2.11 / 2.28 | 1.12 / 0.62 | 1.85 | 0.75 / 0.71 | 0.52 | fail R1,R3,R4 |
| `pnml_head_scalesex035_tdpsola165` | 0.96 | 0.01 / 0.01 | -0.01 / 0.08 (0.11) | 1.18 / 1.19 | 0.99 / 1.00 | 1.24 / 1.20 | 0.64 / 0.66 | 0.78 | 0.69 / 0.56 | 0.23 | fail R4 |
| `pnml_head_scalesex_tdpsola165` | 0.99 | 0.06 / 0.06 | 0.14 / 0.07 (0.02) | 0.86 / 0.88 | 0.99 / 1.00 | 0.95 / 0.85 | 0.60 / 0.70 | 0.61 | 0.69 / 0.41 | 0.16 | fail R4 |
| `pnml_head_scalesex100_tdpsola165` | 0.99 | 0.08 / 0.08 | 0.20 / 0.11 (0.01) | 0.73 / 0.75 | 0.99 / 1.00 | 0.83 / 0.71 | 0.51 / 0.70 | 0.53 | 0.69 / 0.48 | 0.15 | fail R4 |
| `pnml_head_scalesex140_tdpsola165` | 0.99 | 0.11 / 0.10 | 0.26 / 0.15 (0.01) | 0.63 / 0.64 | 0.99 / 1.00 | 0.76 / 0.60 | 0.43 / 0.69 | 0.47 | 0.73 / 0.44 | 0.15 | **PASS** |
| `pnml_head_sex_none0` | 1.00 | 0.30 / 0.29 | 0.64 / 0.86 (0.03) | 0.17 / 0.16 | 0.77 / 0.74 | 0.26 / 0.12 | 0.08 / 0.56 | 0.23 | 0.99 / 0.99 | 0.12 | fail R2,R3 |
| `pnml_head_scale_none0` | 0.54 | 3.79 / 3.93 | -5.34 / 0.05 (0.52) | 10.63 / 11.14 | 0.99 / 0.99 | 8.62 / 11.53 | 5.09 / 0.75 | 4.27 | 1.10 / 1.06 | 2.06 | fail R1,R2,R3,R4 |
| `pnml_head_scalesex035_none0` | 0.90 | 0.26 / 0.28 | -0.16 / 0.06 (0.24) | 1.52 / 1.56 | 1.00 / 0.99 | 1.43 / 1.55 | 0.76 / 0.78 | 0.61 | 1.20 / 1.12 | 0.25 | fail R2,R3,R4 |
| `pnml_head_scalesex_none0` | 0.99 | 0.01 / 0.03 | 0.17 / 0.14 (0.07) | 0.88 / 0.89 | 1.00 / 1.00 | 0.93 / 0.88 | 0.46 / 0.80 | 0.35 | 0.82 / 1.01 | 0.14 | **PASS** |
| `pnml_head_scalesex100_none0` | 1.00 | 0.07 / 0.06 | 0.28 / 0.19 (0.02) | 0.71 / 0.70 | 1.00 / 1.00 | 0.78 / 0.68 | 0.36 / 0.79 | 0.29 | 0.99 / 1.02 | 0.12 | **PASS** |
| `pnml_head_scalesex140_none0` | 1.00 | 0.13 / 0.12 | 0.37 / 0.31 (0.01) | 0.56 / 0.56 | 1.00 / 1.00 | 0.69 / 0.53 | 0.30 / 0.77 | 0.27 | 1.00 / 1.03 | 0.11 | **PASS** |

Other numbers for the recommended `pnml_head_scalesex_none0`:
* G = 0.112 (score units), G_hill = 0.068.
* R1: utterance 0.98, speaker 0.99, PTDB 1.00, FDA 1.00, Hillenbrand token 0.96 /
  speaker 1.00.
* R5: flicker 0.14 G, held-vowel SD 0.09 G, time-to-stable 0.75 s.
* R6: results on the private session recordings are kept outside this repository.
* Combined male→female move (+12 st & ×1.15): additivity 1.16.
* Per-vowel offsets (G_hill): /i/ +0.29, /æ/ +0.19, /ʌ/ +0.16, /u/ −0.21, /ʊ/ −0.28.
  This is the same rounding / fronting pattern as apparent-VTL measures, but 3× smaller
  than B3's.

## 3. Speaker-disjoint dev CV of the heads (`cv_heads.py`)

5 speaker folds over train_dev. r1_dev quick (320 utts) + full manip_dev (3,360 items).
Praat-engine R2 / R3 / sign; WORLD agrees within 0.02-0.05 except for c = 0 raw.

| head target (c) | TD-PSOLA input: AUC 5 s / R2 / R3 / sign | raw input: AUC 5 s / R2 / R3 / sign |
|---|---|---|
| scale (c 0) | 0.84 / 0.06 / 1.96 / 0.98 | 0.72 / 1.84 / 5.69 / 1.00 |
| c 0.02 | 0.95 / 0.00 / 1.32 / 0.97 | 0.90 / 0.42 / 1.96 / 1.00 |
| c 0.035 | 0.97 / 0.03 / 1.09 / 0.99 | 0.96 / 0.21 / 1.31 / 1.00 |
| c 0.05 | 0.98 / 0.04 / 0.88 / 0.99 | 0.98 / 0.11 / 1.02 / 1.00 |
| **c 0.07 (a priori)** | 0.98 / 0.06 / 0.73 / 0.99 | **0.98 / 0.02 / 0.76 / 1.00** |
| c 0.10 | 0.98 / 0.07 / 0.59 / 0.99 | 0.98 / 0.05 / 0.58 / 1.00 |
| c 0.14 | 0.98 / 0.08 / 0.48 / 0.99 | 0.98 / 0.10 / 0.45 / 1.00 |
| sex (logistic re-head) | 0.98 / 0.11 / 0.23 / 0.87 | 0.98 / 0.26 / 0.14 / 0.76 |

Test-split R3 runs 0.1-0.15 higher than dev for the same c. Test-clean's men/women
gap in this score is smaller than dev-clean's; Praat's own formant-dispersion ratio is
1.072 on test-clean.

Reading the c sweep:
* c trades R3 (resonance sensitivity) against R1 / R4 (separation, vowel robustness).
* A pure formant-scale reader (c = 0) is very formant-sensitive but separates men from
  women poorly. In running speech the apparent men/women scale gap this embedding sees
  is only ~6-7 %: the flattened scale head's women−men gap is 0.040 in its own units,
  at slope 0.59 per ln α, i.e. ln 0.068. That matches B3's Praat 1.072.
* The raw scale-only head also has a large pitch leak, toward "longer tract" for higher
  F0: −0.028 per octave, about −4 % apparent scale per octave. The sex term absorbs
  that in the combined ridge solution. This is learned invariance (pitch was jittered
  independently of the target), but it is a reason the sex term cannot simply be
  dropped.

## 4. Ablation: is the pitch flattening needed?

No. Same head recipe, same random draws (paired), same c, embeddings of the un-flattened
WORLD output vs the TD-PSOLA-flattened output:

| | TD-PSOLA input | raw input |
|---|---|---|
| CV-on-train (WORLD aug) R3-like / R2-like, c 0.07 | 0.89 / 0.04 | 0.90 / 0.01 |
| dev speaker-CV R2 / R3 / sign, c 0.07 | 0.06 / 0.73 / 0.99 | 0.02 / 0.76 / 1.00 |
| test R2 / R3 / sign / R4, c 0.07 | 0.06 / 0.86 / 0.99 / **0.61** | 0.01 / 0.88 / 1.00 / **0.35** |
| test Hillenbrand-manip R3 / sign | 0.60 / 0.70 | 0.46 / 0.80 |
| test R7 boys / girls | 0.69 / 0.41 | 0.82 / 1.01 |

Flattening first buys nothing on R2 once the head is trained with pitch jitter. It costs
vowel robustness (R4) and children's placement, and it needs a pitch track and a
resynthesis stage in the browser. **The literal family (resynthesise, then the
unchanged model) fails. The working configuration is "pitch-neutral by training", not
"pitch-neutral by resynthesis".**

## 5. Production pitch detector

The harness's F0 (two-pass Praat on originals; source × intended factor on manipulated
items) is better than production's 75-400 Hz Boersma-AC at the extremes. `prodf0.mjs`
emulates the pitch worker (25 ms chunks → notch → 1280-sample buffer → Boersma-AC
candidates → L = 2 path tracker → notch veto + harmonic guard). Its track is mapped onto
the 10 ms grid.

| variant (test quick subset unless noted) | R2 P / W | M +12 toward | R3 P / W | sign | R4 |
|---|---|---|---|---|---|
| `head_scalesex_tdpsola165`: harness F0 → production F0 | 0.07 / 0.07 → 0.04 / 0.07 | 0.14 → 0.12 | 0.95 / 0.97 → 0.94 / 0.93 | 1.00 → 1.00 | 0.58 → 0.54 |
| `head_scalesex100_tdpsola165` | 0.09 / 0.09 → 0.07 / 0.09 | 0.21 → 0.19 | 0.82 / 0.83 → 0.82 / 0.83 | 1.00 → 0.99 | 0.52 → 0.53 |
| `head_scalesex140_tdpsola165` | 0.12 / 0.10 → 0.10 / 0.11 | 0.26 → 0.25 | 0.71 / 0.71 → 0.74 / 0.75 | 1.00 → 1.00 | 0.52 → 0.54 |
| `tdpsola165_logit` (dev quick) | 0.00 → 0.03 | 0.24 → 0.25 | 0.31 → 0.30 | 0.90 → 0.93 | – |

Robust: the production detector changes nothing material. Below 75 Hz (men at −12 st)
production reports unvoiced, so TD-PSOLA passes those stretches through unflattened and
the gate closes. The recommended raw-input head uses F0 only for the voicing gate, as
the deployed meter already does.

## 6. Failure modes and caveats

* **Learned from one manipulation engine.** The head's notion of "resonance" is WORLD's
  S(f/α) warp of dev-clean read speech. Praat's Change-gender engine (different
  algorithm) gives the same R3 and sign, which is the main evidence it is not reading
  WORLD artifacts. Real formant change in trainees (lip spreading, larynx raising,
  tongue fronting) is not a uniform envelope scale; the uniform-scale assumption is
  untested on real training recordings beyond the private session recordings (results
  kept outside this repository).
* **Isolated short vowels are weaker.** On Hillenbrand hVd tokens: R3 0.46, ±5 % sign
  0.80, vs 0.88 / 1.00 on running speech. Readouts on 1-2 s of a single vowel are less
  trustworthy than 5 s of speech.
* **The sex term is not resonance.** At c = 0.07 a ×1.15 envelope change moves the
  readout 0.88 G, which is most of the men→women gap. The rest of the measured
  men/women separation comes from other learned cues: voice quality, tilt, articulation
  style. Those may or may not be trainable. A voice with a female-typical resonance but
  male-typical other cues will read in between. Men's pitch-only push toward "female"
  (+12 st) is 0.17 G and 14 % cross the midpoint (base 7 %), which is small but not
  zero.
* **Children / very high F0**: only synthetic static vowels are available. Boys read
  0.82 and girls 1.01 on the men→women axis, so children are not recognised as
  "smaller than women". Real children's audio is unavailable.
* **Plain family**: the deployed model given pitch-flattened input still reports mostly
  non-resonance cues (R3 ≤ 0.40). Women at +8 st have R3 0.15: almost no formant
  sensitivity in exactly the trainee-relevant case.
* **Resynthesis artifacts**: TD-PSOLA from a high source F0 down to 165 Hz cannot restore
  envelope detail between sparse harmonics. That is the residual men +12 st leak in the
  plain family (0.23 G) and the extra vowel dependence of the flattened head.
* **R8 numbers in the result JSONs are cache-distorted** for the head variants: they were
  scored from cached embeddings. The true cost is the deployed model's: native ORT
  1 thread ≈ 230-250 ms CPU per s of audio at 6.7 inferences/s, measured on the
  uncached plain runs (`pnml_tdpsola165_logit` 230 ms/s incl. Python TD-PSOLA;
  `pnml_none0_logit` dev 247 ms/s).

## 7. Browser real-time port

**Recommended (`pnml_head_scalesex_none0`)**: a model-file swap, no new DSP.
* `fold_head.py` writes `export/ecapa_q8v2_pnhead_raw_scalesex.onnx` (16,058,106 bytes,
  the same quantized graph up to fc6, fp32 192×2 final MatMul).
* Placed in a model directory with the existing `config.json` / `preprocessor_config.json`,
  the **unchanged** transformers.js `pipeline("audio-classification", …, {dtype: "q8"})`
  runs it. Its female probability, converted back to logit, matches the Python
  embedding + head to 1.7e-7 on 40 real test-clean windows (`pnhead_parity.mjs`).
  Node ORT took 23.7 ms per inference.
* Cost is identical to the deployed meter: ~52 ms per inference on desktop WASM at the
  ~6.2 Hz cadence. Mobile WASM is unmeasured, as for the current meter. Model 16.06 MB.
* Needed in `gender-worker.js`:
  * read s = logit(p) instead of p·100 (s spans only ±0.1, so p sits at 0.47-0.53), or
    fold a display gain into the head so men/women medians land near 15 / 85;
  * apply the EMA to s;
  * change the label from "Perceived voice" to a resonance-weighted readout.
* The existing pitch-recency VAD stays as the gate.

**TD-PSOLA variants** (not recommended):
* JS TD-PSOLA (`tdpsola.mjs`) costs 15 ms CPU per s of audio in Node, unoptimised (the
  raised-cosine crossfade loop dominates); that is < 0.4 ms per 25 ms chunk.
* Driven by the pitch track the ML worker already receives as `pitch-hint` (25 ms
  cadence, interpolated to samples).
* Adds the pitch worker's ~90 ms latency plus one analysis period.
* JS vs Python flattening fed through the model: mean window logit within 0.03-0.3
  (G = 6.2 logits), per-window correlation 0.79-0.98 over 6 dev utterances.

## Variants tried (all)

* **Plain, dev quick**: none (raw) × {prob, logit, logit + production F0}; TD-PSOLA at
  135 / 150 / 165 / 180 / 200 Hz (logit), 165 Hz prob; 2- and 3-pitch averages; 1.5 s
  window; fixed 6.7 / 10 ms grains; production F0; Praat PSOLA, WORLD (logit + prob),
  LPC vocoder (logit + prob). 20 variants, table §1.
* **Plain, test**: `tdpsola165_logit`, `tdpsola165_prob` (full); `tdpsola165_logit`,
  `none0_logit` (quick: R2 0.19, M +12 toward 0.43, R3 0.25, sign 0.82, i.e. the
  unflattened logit reproduces B2's leak).
* **Heads, test full**: {TD-PSOLA, raw} × {scale, c 0.035, 0.07, 0.10, 0.14, sex}. 12
  variants, table §2.
* **Heads, test quick**: production-F0 versions of TD-PSOLA c 0.07 / 0.10 / 0.14.
* **Heads, dev speaker-CV**: {TD-PSOLA, raw} × {c 0, 0.02, 0.035, 0.05, 0.07, 0.10,
  0.14, sex} (table §3).

Not tried:
* Non-linear heads.
* Heads trained on Praat-engine augmentation. This would remove the single-engine
  dependence but make the Praat test less independent.
* Heads on other backbones.
* Real-children data (none available).
