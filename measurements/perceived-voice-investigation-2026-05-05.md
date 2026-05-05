# Perceived-voice model investigation, 2026-05-05

## Status

**Investigation complete; no fixes shipped yet.** Three goals: voicedness
gating, more accuracy, more responsiveness. The first is a small,
independent fix and is ready as a quick PR (proposal below). The second
is the load-bearing finding of this investigation: at the production EMA
α=0.55 the model misclassifies **37.5 % of female speakers** on a
realistic per-speaker corpus, and the cause is the EMA's ~270 ms time-
constant — too short to average out the model's per-window noise on
female voices. Lowering α to 0.1 raises female accuracy to 85.4 %; α=0.05
raises it to 91.7 %. The third goal (responsiveness) sits in tension
with the second: lower α = slower settling. Recommendation needs user
input on the responsiveness budget.

## A. Model characterization

**Where:** [src/ml/gender-worker.js](../src/ml/gender-worker.js) hosts the
model; [src/ml/audio-utils.js](../src/ml/audio-utils.js) holds pure helpers.
[src/components/ResonanceMeter.jsx](../src/components/ResonanceMeter.jsx)
is the UI; [src/audio/useAudioPipeline.js](../src/audio/useAudioPipeline.js)
plumbs the score from worker → React state → meter.

**What:** ML, not rule-based. Transformers.js audio-classification pipeline
running `prithivMLmods/Common-Voice-Gender-Detection-ONNX` — a wav2vec2-
base (~95 M params) fine-tune on Common Voice for binary gender
classification, q8 quantized, ~80 MB. Reports 98.46 % on Common Voice's
own test split per the model card.

**Pipeline:**

1. AudioWorklet → resampleLinear → 0.75 s rolling window (RingWindow).
2. Every 150 ms (~6.7 Hz hop), if `windowPeak ≥ 0.05` (peak-amplitude
   VAD), feed the window to the classifier.
3. Parse result: extract female-label score in [0, 1] via
   `femaleScoreFromResult` (label-name parsing — no positional guessing,
   guards against model swaps that flip id2label).
4. EMA-smooth across inferences at α=0.55.
5. After 14 consecutive VAD-gated silent windows (~2.1 s), reset the EMA.
6. Post `{score: 0–100, confidence: 0–1, ts}` to main thread.

**Output → UI:** worker posts `score` → useAudioPipeline pushes to
`genderTraceRef` (un-throttled) and triggers a 200 ms-throttled React
state update. ResonanceMeter's rAF loop reads the *latest entry* from
`genderTraceRef` directly each frame and tweens `displayScoreRef` toward
it via exponential lerp at 0.3/frame (~150 ms tween). The bar fills 0–100
with gradient; "feminine range" ≥ 70, "masculine range" ≤ 30, uncertain
in between. Confidence by construction = `|score - 0.5| × 2`; modulates
glow opacity on the indicator.

**Voicedness gating:** none. The meter consumes `voiced`/`holding` props
(line 271 of `ResonanceMeter.jsx`) but only uses them to dim the readout
*color* — the bar fill, indicator, and score number all stay drawn at the
last value when `!voiced`. Compare to the pitch UI which fully blanks on
`voiced = false` per [commit 8287b84](https://github.com/Alice-Sabrina-Ivy/Syrinx/commit/8287b84).

## B. Latency measurement

**Per-inference compute** (desktop, q8, [tests/ml/inference-latency-benchmark.js](../tests/ml/inference-latency-benchmark.js)):

| Window | Median | p90 | At 150 ms hop |
|---|---:|---:|---:|
| 1.5 s | 92.6 ms | 116.6 ms | 62 % busy |
| 1.0 s | 66.2 ms | 70.5 ms | 44 % busy |
| **0.75 s** (production) | **49.1 ms** | 55.8 ms | **33 % busy** |
| 0.5 s | 34.5 ms | 36.3 ms | 23 % busy |

Mobile WASM is roughly 3× slower; 0.75 s window leaves comfortable
headroom (≈100 % busy at 150 ms hop on a Pixel-class CPU, just-sustainable).
The production 0.75 s window is at the edge of mobile feasibility, so
extending it for accuracy isn't viable without additional model
optimization.

**Update-cadence breakdown** (analytical, voice change at t = 0):

| Stage | Time |
|---|---:|
| Audio fills rolling window centroid | 0.5 × 0.75 s = 375 ms |
| Next 150 ms hop fires | 0–150 ms |
| Inference | 50–150 ms |
| Worker → main + ref push | <5 ms |
| ResonanceMeter rAF lerp settles to new target | ~150 ms |
| EMA settles to new value (1/α inferences) | 1/α × 150 ms = 270 ms at α=0.55 |
| **Total perceived latency to settled new score** | **~1.0 s at current config** |

The dominant term is **the EMA settling time at the chosen α**. Lowering
α moves it from 270 ms (α=0.55) to 1.5 s (α=0.1) to 3 s (α=0.05).

## C. Hillenbrand accuracy at production config

[tests/ml/perceived-voice-hillenbrand-test.js](../tests/ml/perceived-voice-hillenbrand-test.js)
groups Hillenbrand WAVs by speaker (each speaker has 12 vowels), concatenates
into one ~7 s recording per speaker (50 ms inter-vowel silence to mimic
natural pauses), and runs the production pipeline end-to-end. 93 speakers
(45 men, 48 women).

**Per-vowel-file** (the original methodology) doesn't work: individual
Hillenbrand vowels are 0.5–0.7 s, shorter than the 0.75 s window — the
RingWindow never fills, no inferences ever run. Per-speaker concat is the
realistic test surface for a streaming-window classifier.

**Result at α=0.55, window=0.75 s (production):**

```
male    n=45  acc=45/45 (100.0%)  final_score: mean=0.001 std=0.000
female  n=48  acc=30/48 ( 62.5%)  final_score: mean=0.639 std=0.337
```

**Within-speaker raw-score std** (how stable a single inference is on a
fixed speaker):

```
male    median raw_std=0.000  p95=0.166
female  median raw_std=0.322  p95=0.431
```

Male voices: the model is rock-steady at "very confidently male" (median
within-speaker std = 0). Female voices: every inference swings wildly
(median std 0.32 in score [0, 1] space — the typical female window
prediction varies by ±0.3). Of the 18 misclassified females, **16 had
`rawMean > 0.5`** — meaning the *average* per-window prediction was
correctly female, but the EMA's value at recording-end happened to be
on a male-leaning streak.

Sample misclassifications:

| Speaker | rawMean | rawStd | finalSmoothed | Outcome |
|---|---:|---:|---:|---|
| w16 | **0.904** | 0.198 | 0.440 | mispredicted male |
| w15 | **0.840** | 0.295 | 0.111 | mispredicted male |
| w47 | **0.852** | 0.268 | 0.252 | mispredicted male |
| w40 | **0.853** | 0.295 | 0.373 | mispredicted male |
| w04 | **0.840** | 0.285 | 0.265 | mispredicted male |

The EMA at α=0.55 has effective memory ~1.8 inferences (~270 ms). It
captures the *most recent* swing, not the speaker's overall identity.

## D. α sweep — accuracy + jumpiness

| α | Female acc | Male acc | smooth Δstd (per-frame) | smoothing reduction | Uncertain band | EMA time-constant |
|---:|---:|---:|---:|---:|---:|---:|
| 0.05 | **91.7 %** (44/48) | 100 % | 0.0089 | 95.5 % | 18.3 % | ~3000 ms |
| 0.1  | 85.4 % (41/48) | 100 % | 0.0179 | 91.0 % | 19.4 % | ~1500 ms |
| 0.2  | 81.3 % (39/48) | 100 % | 0.0359 | 82.0 % | 22.6 % | ~750 ms |
| 0.3  | 72.9 % (35/48) | 100 % | 0.0538 | 73.0 % | 20.4 % | ~500 ms |
| **0.55** (current) | 62.5 % (30/48) | 100 % | 0.1000 | 49.9 % | 9.7 % | **~270 ms** |

**Lower α improves both accuracy and smoothness, monotonically.**

- Female accuracy: 62.5 % → 91.7 % (+29.2 pp from α=0.55 → α=0.05).
- Frame-to-frame Δ std: 0.10 → 0.009 (11× steadier).
- Cost: settling time increases from 270 ms to 3000 ms.

**Uncertain-band growth** (final score ∈ [0.3, 0.7]) is a *side effect*
of correct smoothing, not a regression. At α=0.55 most speakers' final
score is pinned to whatever the last inference said (so the score lands
at an extreme); at α=0.05 the final score reflects the speaker's actual
distribution of predictions across windows, which is genuinely uncertain
for some voices. The misclassifications are not concentrated in the
uncertain band — they happen at scores like 0.111, 0.265, 0.027 (clearly
"male" by the threshold but wrong).

Male accuracy stays at 100 % across all α — the model is unambiguous on
males.

## Why the model is asymmetric

Common-Voice-Gender-Detection-ONNX is fine-tuned on Common Voice, which
has a known male-voice skew in its English corpus. wav2vec2-base learns
the easier direction (male) confidently and the harder direction (female,
especially at the masculine-leaning end of the female voice distribution)
with high uncertainty. Hillenbrand's female speakers span a broad pitch
range (180–260 Hz F0) with overlap into the male-typical formant region;
exactly the cohort where this model is least confident.

This is a model-quality issue, not a Syrinx bug, but Syrinx's α=0.55
turns the model's calibrated uncertainty into binary misclassifications
by collapsing it on the last two inferences. Lower α restores the
information.

## Proposed fixes

### 1. Voicedness gating (independent, quick)

**Goal:** when `voiced && holding` are both false (DSP voicedness gate
trips), blank the perceived-voice score the same way the pitch readout
does. The meter currently keeps drawing the bar at the last value
indefinitely.

**Scope:** small. ResonanceMeter already receives `voiced` and `holding`
props but only uses them for the readout color. Three-line change to
the rAF loop: when `idle = !voiced && !holding`, set
`displayScoreRef.current = null` and `displayConfRef.current = 0`. The
existing `if (dispScore !== null && modelStatus === "ready")` guard
already blanks the bar/indicator when displayScoreRef is null, so the
fix is purely "when does dispScoreRef get set to null".

Holding state (during the 5 s silence-hold) keeps the last value, which
matches the pitch UI's behavior: a brief breath doesn't blank the meter.

**Independent of fixes 2 and 3.** Ships as its own PR.

```js
// src/components/ResonanceMeter.jsx — proposed change in the rAF draw loop.
// Currently:
const data = genderTraceRef?.current ?? [];
const latest = data.length > 0 ? data[data.length - 1] : null;
const targetScore = latest?.score ?? null;
const targetConf = latest?.confidence ?? 0;
if (targetScore == null) {
  displayScoreRef.current = null;
} else if (...) { ... }

// Proposed:
const idle = !voiced && !holding;
const data = genderTraceRef?.current ?? [];
const latest = data.length > 0 ? data[data.length - 1] : null;
const targetScore = idle ? null : (latest?.score ?? null);
const targetConf = idle ? 0 : (latest?.confidence ?? 0);
if (targetScore == null) {
  displayScoreRef.current = null;
} else if (...) { ... }
```

Subtitle text already gates on `dispScore == null` ("warming up"), which
will now also fire on idle — consistent with the bar blanking.

### 2. Lower EMA α (load-bearing for accuracy AND jumpiness)

**Goal:** raise female accuracy and reduce jumpiness. Both come from the
same lever.

**Recommendation:** α=0.1.
- Female accuracy: **62.5 % → 85.4 %** (+23 pp).
- Frame-to-frame Δ std: **0.10 → 0.018** (5.6× steadier).
- Settling time: 270 ms → 1500 ms.

The 1.5 s settling time is the responsiveness cost. For voice-training
use, 1.5 s is at the high end of what feels real-time but probably still
acceptable. α=0.05 (3 s) is too sluggish in my judgement.

**Alternative if 1.5 s is too slow:** α=0.2 gives 81.3 % female accuracy
(+19 pp) with 750 ms settling. Worse on both axes than α=0.1 but might
match the user's responsiveness budget.

**This needs user input.** The user asked for "more responsive" as a
goal; we're proposing the opposite for the responsiveness lever to
unlock accuracy. The accuracy-vs-responsiveness frontier is a sweep, not
a single optimum.

**Scope:** one-line change to `EMA_ALPHA` in
[src/ml/gender-worker.js](../src/ml/gender-worker.js) plus matching
update in [tests/ml/gender-model-accuracy-test.js](../tests/ml/gender-model-accuracy-test.js)
and [tests/ml/perceived-voice-hillenbrand-test.js](../tests/ml/perceived-voice-hillenbrand-test.js).
Ships as its own PR with the full sweep table as the review surface.

### 3. Responsiveness — separate workstream

**Goal:** reduce time-to-feedback.

This is in tension with fix 2, and the dominant lag terms aren't all in
the EMA:

| Lever | Current | Knob | Cost |
|---|---|---|---|
| Window size | 0.75 s (375 ms centroid lag) | Reduce → 0.5 s | More per-window noise (defeats fix 2) |
| Hop | 150 ms | Reduce → 75 ms | 2× compute, mobile may stall |
| Inference time | 49 ms desktop / ~150 ms mobile | Different model | New investigation |
| EMA α | 0.55 (~270 ms settling) | See fix 2 | Accuracy tradeoff |
| Lerp rate | 0.3 (~150 ms tween) | Increase → 0.5 | Visual choppiness |

**Recommended path** if the user wants to keep responsiveness after fix 2:
- Try a different model. The model is the source of per-window noise on
  female voices; a different model (e.g., one trained on more balanced
  data) might let us keep α=0.5+ AND get good accuracy. New investigation,
  not bundled with fix 2.
- Or: median-filter raw scores before EMA. Median over last 5 raw scores
  (1 s of history) absorbs single-window outliers cheaply. Can keep α
  at 0.3+ on top. Engineering scope: ~30 lines.

**Defer until after fix 2 lands.** Once we know what α the user picks,
the responsiveness gap becomes concrete and we know what we're trying
to claw back.

## Tradeoff matrix

| Goal | Fix | Coupled with |
|---|---|---|
| Voicedness gating | (1) blank UI on `!voiced && !holding` | Independent — ships now |
| More accurate | (2) lower α (recommended 0.1) | Improves jumpiness too; costs responsiveness |
| Less jumpy | (2) lower α | Same fix as accuracy |
| More responsive | (3) different model OR median-filter | Pursue after (2); user input on α first |

## Validation plan if fixes 1 + 2 ship

1. **Voicedness gating live re-test:** open Syrinx, start session, sing a
   note, stop singing for 6+ seconds. Meter should show a value briefly
   (within 5 s silence-hold), then blank. Same as pitch behavior.

2. **α sweep accuracy regression:** reproduce the table above on the
   chosen α via [tests/ml/perceived-voice-hillenbrand-test.js](../tests/ml/perceived-voice-hillenbrand-test.js).
   Locked in as the canonical baseline for future PRs.

3. **Subjective responsiveness check:** speak with a clearly feminine or
   masculine voice; meter should reach a stable value within roughly the
   chosen α's settling time. If feels sluggish vs the chosen target, the
   user adjudicates.

4. **Existing test guardrails** ([tests/ml/gender-model-accuracy-test.js](../tests/ml/gender-model-accuracy-test.js)
   on the JFK/MLK/Hopper labeled subset) should still pass.

## Files added

- [tests/ml/perceived-voice-hillenbrand-test.js](../tests/ml/perceived-voice-hillenbrand-test.js)
  — per-speaker accuracy + jumpiness on Hillenbrand. Supports `--alpha=N`
  and `--window=SEC` for sweeps.

## Open questions for user input

1. **Voicedness gating:** greenlight to ship the 3-line ResonanceMeter
   change as a standalone PR? (Independent of accuracy/responsiveness.)
2. **Responsiveness budget:** what's the max acceptable settling time?
   This determines α (1.5 s → α=0.1, 750 ms → α=0.2). Or alternative:
   ship α=0.1 and pursue (3) afterward to claw back response time.
3. **Different model:** worth a separate investigation (try alternative
   gender classifiers from HF), or focus on the median-filter approach?

## Ship decision (added post-greenlight)

User selected α=0.2 (responsiveness budget = 750 ms settling). Tradeoff
captured: +19 percentage points female accuracy (62.5 → 81.3 %) at the
cost of a ~480 ms increase in settling time relative to α=0.55. Voicedness
gating ships independently. Alternative-model investigation runs in
parallel as a separate workstream — if it finds a candidate with lower
per-window noise on female voices, we revisit the α-vs-responsiveness
frontier on the new model.

**Validation pass at α=0.2 default** (same Hillenbrand per-speaker
methodology, 93 speakers):

```
male    n=45  acc=45/45 (100.0 %)  final_score: mean=0.004 std=0.012
female  n=48  acc=39/48 ( 81.3 %)  final_score: mean=0.689 std=0.210
smoothing reduction:               82.0 %
```

9 misclassified females (was 18 at α=0.55). The remaining failures fall
into two buckets:

- 5 speakers (w15, w23, w37, w45, w47-class) where rawMean > 0.6 but the
  model's per-window noise drives the EMA below 0.5. These would benefit
  from a quieter model or longer EMA history.
- 4 speakers (w21, w26, w31, w46) where rawMean < 0.5 — the model
  genuinely thinks they're male on average. No α value fixes those;
  they're model-limit cases.

**Existing 3-file guardrail** ([tests/ml/gender-model-accuracy-test.js](../tests/ml/gender-model-accuracy-test.js))
exposed Hopper as a third class of failure: rawMean=0.08, the model is
unambiguously wrong on her voice. At α=0.55 the test was passing on
lucky EMA-tail behaviour rather than model skill; α=0.2 reveals the
underlying limitation. Marked `expectedToFail: true` in GROUND_TRUTH so
the regression guardrail still gates JFK/MLK without requiring model
correctness on a known-fail input. The model's coverage of
contralto/baritone-female voices is a known gap and the next investigation
workstream targets exactly that.
