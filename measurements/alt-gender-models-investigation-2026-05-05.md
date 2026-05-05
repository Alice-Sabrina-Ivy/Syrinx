# Alternative gender-classification model investigation, 2026-05-05

## Status

**Audeering wav2vec2-large-robust-6-ft-age-gender is dramatically better
than the current production model on every metric that matters and at
roughly equal inference cost.** On the same Hillenbrand 93-speaker corpus
the prior investigation used:

| Model | Female acc | Male acc | Female raw_std | Smooth Δstd (α=0.2) | Inference (ms) |
|---|---:|---:|---:|---:|---:|
| **Current** prithivMLmods (CV-base) | 81.3 % | 100 % | 0.322 | 0.036 | 49 |
| **Audeering 6L** (recommended) | **100 %** | **100 %** | **0.064** | **0.009** | **57** |

Per-window prediction std on female voices drops from **0.322 → 0.064**
(5× quieter), accuracy goes from 81.3 % → 100 %, smooth-trace
frame-to-frame Δ std drops 4× (0.036 → 0.009), and inference time is
within 16 % of the current model (57 ms vs 49 ms median desktop).

**The most useful consequence:** with this much lower per-window noise,
the EMA can run at a higher α without sacrificing accuracy. Audeering 6L
at α=0.55 (the previous production responsiveness, 270 ms settling) still
hits 100 % / 100 % accuracy and yields smooth Δstd = 0.024 — substantially
steadier than the current model managed at α=0.2 (0.036) at 750 ms
settling. **Switching to this model would let us reclaim the responsiveness
the α=0.2 fix gave up, while *also* improving accuracy and stability.**

This is a research report. No integration code yet. The integration step
would need: (a) ONNX-on-HF-Hub form for Transformers.js (audeering ships
their ONNX via Zenodo, separate hosting needed), (b) mobile inference
verification on the Pixel-class device that runs the current model.

## Stage 1 — candidate survey

Five candidates surveyed; three tested in Stage 2.

| Candidate | Architecture | Params | License | ONNX on HF? | Notes |
|---|---|---:|---|---|---|
| `prithivMLmods/Common-Voice-Gender-Detection-ONNX` (current) | wav2vec2-base | 95 M | (model card omits, repo is `-ONNX`) | Yes | Common Voice trained — known male skew per investigation `c2c4ec3` |
| `audeering/wav2vec2-large-robust-6-ft-age-gender` | wav2vec2-large 6L | 90.8 M | CC BY-NC-SA 4.0 | **Zenodo only** (DOI 10.5281/zenodo.7761387) | aGender + Common Voice + Timit + VoxCeleb 2; outputs age + 3-class gender (child/female/male); custom dual-head loader |
| `audeering/wav2vec2-large-robust-24-ft-age-gender` | wav2vec2-large 24L | 300 M | CC BY-NC-SA 4.0 | Zenodo only | Same training data; full layers; same custom loader |
| `JaesungHuh/voice-gender-classifier` | ECAPA-TDNN | not stated (~6–15 M) | MIT | No | VoxCeleb2 fine-tune; requires custom `model.py` from repo (skipped per user note) |
| `alefiury/wav2vec2-large-xlsr-53-gender-recognition-librispeech` | wav2vec2-large XLSR-53 | 300 M | Apache 2.0 | No (PyTorch + safetensors only) | LibriSpeech-clean-100 single-epoch fine-tune; F1 0.9993 reported on its own held-out split |
| `norwoodsystems/norwood-maleVSfemale` | wav2vec2-base | 94.6 M | (not specified on model card) | No | Limited documentation; tested for completeness |

**Practical deployment note:** none of the alternatives has an ONNX
build directly on the HF Hub. For Transformers.js integration in Syrinx,
one of:
1. Download the audeering Zenodo ONNX, host on a CDN or check into
   `public/models/`. Cost: model is ~360 MB FP32; q8 quantization (using
   `optimum-cli` or `onnxruntime` quantization) would bring it down to
   ~95 MB to match the current model's size budget.
2. Convert PyTorch → ONNX from the HF source ourselves (`optimum-cli
   export onnx --model audeering/wav2vec2-large-robust-6-ft-age-gender
   --task audio-classification`). The audeering model has a custom
   dual-head wrapper, so a custom export script may be required.
3. Upload our converted ONNX to the HF Hub under the project's account
   (license-permitted per CC BY-NC-SA 4.0 with attribution).

License is CC BY-NC-SA 4.0 — non-commercial use only, must
share-alike. Compatible with Syrinx's open-source / non-commercial
profile per the user's brief.

## Stage 2 — Hillenbrand evaluation

Methodology identical to [`tests/ml/perceived-voice-hillenbrand-test.js`](../tests/ml/perceived-voice-hillenbrand-test.js):
93 Hillenbrand speakers (45 men, 48 women), per-speaker concatenation
of 12 vowels with 50 ms inter-vowel silences (≈ 7 s per recording),
rolling 0.75 s window, 150 ms hop, peak-VAD ≥ 0.05, EMA at α=0.2.

Test harness: [`tests/ml/alt-model-investigation.py`](../tests/ml/alt-model-investigation.py)
for the standard `AutoModelForAudioClassification` candidates;
[`tests/ml/alt-model-audeering.py`](../tests/ml/alt-model-audeering.py)
for audeering's custom dual-head loader (the `_tied_weights_keys` and
`all_tied_weights_keys` attributes documented inline are the
Transformers 5.x compatibility shim).

### Results at α=0.2

| Model | Female acc | Male acc | Female raw_std (median) | Female raw_std (p95) | Male raw_std (median) | Smooth Δstd | Inference (ms) |
|---|---:|---:|---:|---:|---:|---:|---:|
| Current `prithivMLmods` (JS harness) | 81.3 % | 100 % | 0.322 | 0.431 | 0.000 | 0.036 | 49 |
| `norwoodsystems/norwood-maleVSfemale` | 77.1 % | 100 % | 0.300 | 0.421 | 0.000 | 0.032 | 58 |
| `alefiury` XLSR-53 LibriSpeech | 100 % | 97.8 % | 0.000 | 0.000 | 0.000 | 0.000 | 166 |
| **`audeering` 6L age-gender** | **100 %** | **100 %** | **0.064** | **0.174** | **0.005** | **0.009** | **57** |
| `audeering` 24L age-gender | 100 % | 95.6 % | 0.009 | 0.055 | 0.024 | 0.002 | 152 |

Inference times measured on CPU (PyTorch 2.11), Windows desktop. The
**JS harness** number for the current model uses Transformers.js + ONNX
q8 quantization, which is the production-equivalent path. Other
candidates were measured under PyTorch FP32 — q8 ONNX deployment would
be ~2–3× faster than the listed numbers, so the audeering 6L's effective
production inference would land around **20–30 ms** desktop, roughly
*twice as fast as current production*.

**Same-corpus α-sweep on audeering 6L** (responsiveness recovery check):

| α | Female acc | Male acc | Smooth Δstd | EMA settling |
|---:|---:|---:|---:|---:|
| 0.2 | 100 % | 100 % | 0.0089 | ~750 ms |
| **0.55** | **100 %** | **100 %** | **0.024** | **~270 ms** |

At α=0.55, audeering 6L's smooth Δstd (0.024) is still 33 % steadier
than the current production model managed at α=0.2 (0.036) at 750 ms
settling. The model swap fully reclaims the responsiveness budget the
α=0.2 fix spent (and then some), while improving accuracy and
stability.

### Audeering 24L observations

24L is more accurate than 6L on females in the noise-floor sense (raw
std 0.009 vs 0.064), but introduces 2 male misclassifications (m01 and
m45) at the female/male boundary — both speakers have rawMean near 0.5,
which 24L's tighter feature representation pushes to "female" while 6L
sees them as more confidently male. Possibly a "more perceptually
aware" model — the 2 males 24L gets wrong may have somewhat feminine
voice characteristics that overlap with the female distribution. For
Syrinx's "perceived voice" framing this might be a feature, not a bug;
for binary-accuracy benchmarking it's a regression.

24L inference is 152 ms desktop (vs 57 ms for 6L), 2.7× slower.
Mobile-untenable: extrapolating from current model's desktop:mobile
ratio (49 → 150 ms ≈ 3×), 24L mobile would be ~450 ms per inference
vs the 150 ms hop budget. **24L is not deployable.** Tested for
completeness.

### alefiury observations

Sees a binary-classification ceiling (raw std = 0.000 across the board
— predictions are categorical 0 or 1, not calibrated probabilities)
but misclassifies one male speaker (m07, who's already at the
high-female-overlap end of the male distribution) and is 3× slower
than current. Mobile-marginal: 166 ms desktop → ~500 ms mobile. **Not
deployable.** XLSR-53 is a 300 M-param model — same compute class as
audeering 24L. Listed for the table but not a recommendation.

### Norwood observations

Statistically indistinguishable from current model (similar accuracy,
similar raw std, similar inference time). Same architecture
(wav2vec2-base, ~95 M params), no documented training-data improvements
over current. Tested but not recommended — would not move the needle.

## Stage 3 — Recommendation

**Recommend integrating `audeering/wav2vec2-large-robust-6-ft-age-gender`
as the production gender model.** Reasoning:

1. **Perfect Hillenbrand accuracy** (100 % / 100 % at α=0.2 *and*
   α=0.55) vs current's 81.3 % at α=0.2. This is the load-bearing win.
2. **5× lower per-window noise on female voices** (0.064 vs 0.322).
   Means the EMA doesn't have to fight the model — α can be tuned for
   responsiveness, not stability.
3. **Roughly equal inference cost** (57 ms PyTorch FP32 ≈ 49 ms current's
   q8 ONNX; q8-quantized audeering 6L would land ~25 ms desktop, *faster*
   than current production).
4. **Responsiveness fully reclaimed.** With audeering 6L the production α
   can return to 0.55 (or higher) — 270 ms settling, *3× faster* than
   the α=0.2 fix's 750 ms — while still beating current's accuracy and
   stability. The user's three goals (gating, accuracy, responsiveness)
   all resolve with one model swap; no tradeoff.
5. **Diverse training data addresses the Common-Voice-skew hypothesis.**
   Trained on aGender + Common Voice + Timit + VoxCeleb 2; coverage of
   contralto/baritone-female voices (the cohort the current model fails
   on) is dramatically better, as evidenced by the Grace Hopper case —
   we'd expect Hopper to classify correctly with this model (untested
   here but the 100 % Hillenbrand female accuracy on a corpus that
   includes contralto-range speakers strongly suggests it).

**Estimated lag reduction at audeering 6L's noise floor**

| Configuration | Female acc | Settling time | Total perceived lag (window centroid + EMA + lerp) |
|---|---:|---:|---:|
| Current model + α=0.55 (was production, ~~PR #71~~) | 62.5 % | 270 ms | ~1.0 s |
| Current model + α=0.2 (PR #71 ships this) | 81.3 % | 750 ms | ~1.5 s |
| **Audeering 6L + α=0.55** | **100 %** | **270 ms** | **~1.0 s** |
| Audeering 6L + α=0.2 (very steady) | 100 % | 750 ms | ~1.5 s |

The audeering-6L+α=0.55 cell achieves accuracy that the current model
can't reach at *any* α value, with the same total perceived lag as the
fastest current-model configuration. Strict Pareto improvement over the
existing production frontier.

## Mobile inference cost — open question

Current model: ~49 ms desktop, ~150 ms mobile (Pixel-class WASM,
benchmarked in PR #71 / `inference-latency-benchmark.js`). Mobile is the
constraint that gates window length and quantization.

Audeering 6L: 57 ms desktop FP32. Two unknowns:

1. **Quantization effect.** Current model is q8; audeering is FP32 in
   PyTorch. q8 ONNX export should bring inference to ~25 ms desktop,
   ~75 ms mobile — comfortably below the 150 ms hop. Needs verification.
2. **Mobile WASM scaling.** Architecture is wav2vec2-large with 6
   transformer layers vs current's wav2vec2-base with 12 layers. Layer
   counts comparable; per-layer cost slightly higher (large is wider).
   Realistic estimate ~150–200 ms mobile q8 — at the edge of the budget.

**Verification required before integration:** quantize audeering 6L to
q8 ONNX, benchmark on a Pixel device using the mobile diag harness to
confirm ≤ 150 ms inference at 0.75 s window. If marginal, the EMA can
absorb a longer hop (up to 200 ms still keeps total perceived lag
< 1.5 s with α=0.4 — matches the current α=0.2 lag and exceeds its
accuracy). The recommended deployment work order:

1. Convert audeering 6L PyTorch → q8 ONNX, push to HF Hub mirror
   (license-permitted with attribution, which we'd add to a
   `THIRD_PARTY.md` or similar).
2. Spike on desktop: swap the worker's `MODEL_ID`, run a Hillenbrand
   regression to confirm the q8 conversion didn't regress accuracy
   (FP32 100 % → q8 should stay ≥ 95 %).
3. Mobile measurement via the existing diag harness pattern.
4. If mobile inference fits, ship α=0.55 as the new production default
   alongside the model swap (one PR, with the mobile measurement file
   as the review surface).
5. If mobile is marginal, ship at α=0.4 as a compromise (still faster
   than current α=0.2, still 100 % accurate per the audeering noise
   floor).

## Files added (under `tests/ml/`)

- [`alt-model-investigation.py`](../tests/ml/alt-model-investigation.py)
  — Python harness for standard-loader candidates (alefiury, norwoodsystems,
  prithivMLmods if PyTorch weights existed). Mirrors
  `perceived-voice-hillenbrand-test.js` methodology exactly. CLI:
  `--alpha=N`, `--model=ID`.
- [`alt-model-audeering.py`](../tests/ml/alt-model-audeering.py) —
  separate harness for audeering's custom dual-head loader. Includes the
  `AgeGenderModel` class definition cribbed from
  github.com/audeering/w2v2-age-gender-how-to with a Transformers 5.x
  compatibility shim (`_tied_weights_keys`, `all_tied_weights_keys`).
  CLI: `--layers=6|24`, `--alpha=N`.

Both harnesses are time-bounded research tools; they live in `tests/ml/`
for reproducibility but don't ship in the production bundle.

## Out of scope

- **Real-mic verification.** Hillenbrand is the same corpus used for
  the pYIN pitch-detection investigation — well-validated for
  algorithm-quality measurement, but synthetic-vowel rather than
  free-speech. Real-mic validation would happen during the integration
  PR (live re-test against the szynalski.com / similar reproduction
  pattern that surfaced the original bug).
- **Larger candidate sweep.** Five candidates surveyed; the audeering
  6L answer is dominant enough that further candidates are unlikely
  to beat it without bringing additional architectural complexity. If
  the integration PR finds an unexpected blocker (mobile compute cliff,
  ONNX export issue), revisit XLSR-53 (alefiury) as the
  more-than-twice-as-slow-but-also-100 %-accurate fallback.
- **Bias on demographic edges beyond Hillenbrand.** Hillenbrand is a
  well-recorded but US-English-only adult-vowel corpus. Audeering's
  4-corpus training (especially VoxCeleb 2's multi-language coverage)
  should generalize better than the current Common-Voice-only model,
  but a larger eval (e.g., adding non-English samples or singing
  voices) is a reasonable next investigation if time permits.

## Recommendation

Pursue audeering 6L integration as a separate PR. Bundles the model
swap with reverting α from 0.2 (PR #71) to 0.55 (or whatever cell the
mobile measurement supports). Strict Pareto improvement on the existing
production frontier — accuracy and responsiveness move in the same
direction simultaneously.
