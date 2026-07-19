# Gender model: latency + accuracy investigation — 2026-07-19

Follow-up to the 2026-05-05/06 model-swap arc (INVESTIGATIONS.md
§Perceived-voice gender model). Production going in: JaesungHuh
ECAPA-TDNN q8 (`Alice-Sabrina-Ivy/voice-gender-classifier-onnx-q8`),
WebGPU-preferred worker, Hillenbrand 95.6/95.8, "~190 ms desktop /
~460 ms mobile — over the 150 ms hop budget everywhere measured."

**Outcome: three production changes (two shipped in this branch, one
staged pending a model-file upload + mobile validation):**

1. **Drop the WebGPU preference — WASM is 4.7× faster for this model**
   (production-path median 249 → 52 ms desktop).
2. **Time the inference hop start-to-start** (the end-to-start timing
   made the real cadence `150 ms + inferMs`); with (1)+(2) the meter
   runs at 6.19 Hz vs 2.44 Hz — effectively the 6.7 Hz design cadence
   (the residual is 25 ms chunk-arrival quantization).
3. **The q8 quantization — not the model — is the accuracy ceiling**:
   fp32 scores **100 %/100 %** on Hillenbrand with ~10× lower
   per-window noise (even m45, previously documented as the
   architecture-independent "calibration noise floor", classifies
   correctly at fp32). A better int8 recipe is the accuracy lever;
   see §5.

## 1. Where the latency went: the WebGPU path is broken-but-not-failing

New probe (`scripts/gender-ort-probe.js` + `tests/ml/gender-ort-probe/`,
pattern of the SwiftF0 WASM probe): isolated spawned Chrome, plain
ORT-web 1.26.0-dev (the exact version @huggingface/transformers 4.2.0
bundles), raw-audio input (the exported graph embeds its own log-mel
frontend). Desktop, 30 timed runs/cell:

| model | EP | window | median ms | p95 | notes |
|---|---|---|---|---|---|
| q8 (production file) | webgpu | 0.75 s | 198.8 | 232.9 | **spews WebGPU validation errors** (Invalid BindGroupLayout / "Concat"), still "works" |
| q8 | webgpu | 0.625 s | 196.5 | 210.7 | same errors |
| **q8** | **wasm** | 0.75 s | **50.5** | 68.5 | |
| q8 | wasm | 0.625 s | 50.6 | 68.6 | window doesn't move WASM latency (fixed overhead dominates) |
| fp32 export | wasm | 0.75 s | 431.4 | 458.3 | 8× q8 — not deployable |
| fp32 export | webgpu | — | session-create fails | | ShapeInferenceError (opset-18 STFT) |
| fp16 convert | any | — | session-create fails | | Cast type mismatch from converter |

The q8-on-WebGPU path *creates a session successfully* and then
partially falls apart at run time (uncaught WebGPU validation errors,
presumably per-node CPU fallbacks) — exactly the failure mode the
worker's try-webgpu-catch-fallback cannot catch. Quantized int8
operators are generally a poor fit for the WebGPU EP; this model's
Concat-heavy Res2Net topology makes it worse.

**Production-path confirmation** (real app: Transformers.js pipeline +
worker + capture, `scripts/desktop-diag-capture.js --voice-file`,
45 s, mlInferences ring from the diag snapshot):

| worker config | device | median inferMs | p95 | max | effective cadence |
|---|---|---|---|---|---|
| shipped (webgpu-first) | webgpu | 249.4 | 295.7 | 1906.6 | 2.44 Hz |
| WASM-only | wasm | 53.5 | 79.9 | 320.8 | 4.61 Hz |
| WASM-only + start-to-start hop | wasm | **52.1** | 67.0 | 382.7 | **6.19 Hz** |

Notes: the 2026-05 "real browser WASM was 191 ms" lesson-number was
measured through the then-production worker (WebGPU path) — the label
conflated the backend. The documented "~190 ms desktop / ~460 ms
mobile" figures are WebGPU numbers; mobile WASM has never been
measured (see §6).

## 2. Cadence: the hop was timed end-to-start

`maybeInfer()` reset `lastInferenceMs` in its `finally`, so the emit
period was `INFERENCE_INTERVAL_MS + inferMs` — at 249 ms WebGPU
inference that's 2.5 Hz (matches measured 2.44), and even at 52 ms
WASM only 4.9 Hz. The Hillenbrand oracle that tuned α=0.2 steps
exactly one 150 ms hop per inference, i.e. it validated a cadence
production never ran at. Stamping `lastInferenceMs` at inference START
restores the designed cadence whenever inference fits in the hop
(6.19 Hz measured, ceiling ≈ 6.15 given 25 ms chunk quantization);
`inferenceInProgress` still serializes when it doesn't. EMA α stays
0.2 — production now finally matches the configuration the α sweep
validated (settling ~750 ms wall-clock; it was effectively ~2 s at
2.44 Hz).

## 3. Window length: keep 0.75 s

Oracle (`--window`, α=0.2, production q8):

| window | male acc | female acc | misclassified |
|---|---|---|---|
| 0.75 s (prod) | 95.6 | 95.8 | m21 m45 w32 w46 |
| 1.0 s | 95.6 | 95.8 | m21 m45 w32 w46 |
| 0.625 s | 95.6 | 95.8 | m28 m45 w26 w46 (boundary churn) |
| 0.5 s | 100.0 | **89.6** | 5 × female — **gender-asymmetric, ruled out** |

0.625 s is accuracy-neutral but buys nothing: WASM latency is flat in
window length (50.5 vs 50.6 ms — the probe shows fixed overhead
dominates q8 WASM). Keep 0.75 s.

## 4. Accuracy: quantization damage, not model ceiling

Oracle runs with locally exported variants (`--local-root`/`--dtype`,
new oracle flags; export via the preserved
`perceived-voice-jaesunghuh-tdnn-investigation` branch scripts):

| variant | male acc | female acc | median raw_std (m/f) |
|---|---|---|---|
| production q8 (dyn QUInt8 per-channel) | 95.6 | 95.8 | 0.216 / 0.196 |
| **fp32 export** | **100.0** | **100.0** | **0.013 / 0.019** |
| dyn QInt8 per-channel | 95.6 | 95.8 | 0.211 / 0.200 |
| static QDQ QInt8 per-channel (20-window calibration) | 95.6 | 97.9 | 0.206 / 0.189 |

The fp32 model is *perfect* on this corpus and ~10× quieter per
window. Every misclassification in production — including **m45,
documented since 2026-05-06 as the architecture-independent
"calibration noise floor" (fp32 final score 0.326, comfortably male)**
— is quantization damage. INVESTIGATIONS.md's m45 note should be
amended when this ships.

fp32 itself is not deployable (62 MB, 431 ms browser-WASM). fp16
browser paths are dead (converter emits an invalid graph; CPU fp16 is
slow regardless). The lever is a better int8 recipe.

## 5. Per-node quantization sensitivity — one matmul carries the damage

Quantizing one node at a time (static QDQ per node, 20 calibration +
40 eval Hillenbrand windows, mean |Δp(female)| vs fp32; script recipe
in §Reproduction):

| node | mean abs Δp | role |
|---|---|---|
| **node_matmul** | **0.1547** | attentive-statistics pooling product (activation × activation) |
| node_Conv_349 | 0.0162 | first conv after the mel frontend |
| node_conv1d_1 | 0.0048 | |
| all 35 other convs | ≤ 0.0030 | |
| node_Gemm_355, node_linear_1 | ≤ 0.0017 | classifier head |

The attention-pooling matmul multiplies two runtime activations —
dynamic quantization quantizes *both* operands on the fly, and the
attention weights' distribution takes ~10× more damage than any
weight-bearing conv.

**Fix: exclude that one node.** Re-quantized variants, full oracle:

| variant | male acc | female acc | median raw_std (m/f) | size |
|---|---|---|---|---|
| production q8 | 95.6 | 95.8 | 0.216 / 0.196 | 15.8 MB |
| **dyn QUInt8 per-channel, exclude `node_matmul` ("v2")** | **100.0** | **100.0** | **0.010 / 0.025** | 16.1 MB |
| + also exclude node_Conv_349 | 100.0 | 100.0 | 0.013 / 0.021 | 16.1 MB |
| static QDQ, same exclusions | 100.0 | 97.9 | 0.161 / 0.220 | 16.3 MB |

v2 = the original quantize recipe plus `nodes_to_exclude=
["node_matmul"]` — one argument. It matches fp32 accuracy AND noise
exactly on this corpus, at production size. Browser WASM latency:
**46.2 ms median / 58.9 p95** (probe re-run) — slightly *faster* than
the all-quantized file (50.5) because the excluded matmul skips its
quant/dequant round-trip.

Candidate artifact staged at `build/jaesunghuh-gender-v2/`
(sha256 `fdc2dbdc…d86c252`); regeneration = export-jaesunghuh-onnx.py
(preserved branch) + quantize_dynamic(QUInt8, per_channel,
nodes_to_exclude=["node_matmul"]).

## 6. Ship plan + gates

**Shipped in this branch (worker changes, no model change):**
- WASM-only model load (drop WebGPU preference) — desktop 249 → 52 ms.
- Start-to-start hop timing — cadence 2.44 → 6.19 Hz.
- Combined displayed effect: meter update rate ~2.5×, EMA settling
  back to its designed ~750 ms.

**Mobile gate (required before merge):** mobile WASM has never been
measured for this model (the 460 ms figure is WebGPU). ECAPA's
desktop:mobile ratio ~2.4× predicts ~125 ms mobile WASM — under the
hop budget and ~3.7× faster than today — but per the 2026-05-06
lesson (don't assume; the platform-split design died from an
unmeasured assumption) this needs one `mobile-diag-capture.js` run on
the Pixel with the WASM build before the PR merges. If mobile WASM
measures *worse* than 460 ms, the load becomes platform-conditional —
decide on the measurement, not now.

**v2 model: uploaded and cut over (2026-07-19, same day).** Published
as `Alice-Sabrina-Ivy/voice-gender-classifier-onnx-q8-v2` (MIT,
new repo so v1 stays addressable); hub artifact verified byte-exact
against the staged file (sha256 `fdc2dbdc…d86c252`). Worker
`DEFAULT_MODEL_ID` bumped. Acceptance against the live hub file:

- **Oracle:** 100 % male (45/45) / 100 % female (48/48), raw_std
  0.010/0.025, **0/93 speakers in the uncertain band [0.3, 0.7]**
  (v1: 4 misclassified + borderline finals).
- **End-to-end production path** (diag capture, v2 from hub, device
  wasm): median 112.7 ms / p95 135.3, cadence 6.14 Hz — measured
  while a heavy unrelated workload (8 workers × ~3.5 GB) was running
  on the machine. A same-state control probe confirmed the load
  roughly doubles all inference times (probe WASM 46 → 100 ms), so
  the idle-machine numbers in §1 (~52 ms production path) and this
  loaded-state run bracket the real range. The load-bearing
  observations hold in BOTH states: WASM beats WebGPU ~2.5–4.7×, and
  the cadence stays at the ~6.1 Hz design ceiling because even
  loaded-state inference fits the 150 ms hop — where the retired
  WebGPU config was over budget even idle.

**Mobile measurement: waived by the user (2026-07-19)** — accepted
risk. If mobile WASM turns out slower than the old 460 ms WebGPU
path, the `inferenceInProgress` guard still degrades the meter
gracefully; the first mobile diag capture after this ships will
settle it as a side effect.

Follow-up headroom (separate measured decision, post-ship): with
per-window noise now ~10× lower, the EMA α=0.2 choice could be
revisited for responsiveness (the 05-05 audeering analysis showed
low-noise models tolerate α≈0.55 ≈ 270 ms settling).

**Also corrected by this investigation:** the m45 "architecture-
independent calibration noise floor" note (INVESTIGATIONS.md) — m45
classifies correctly and confidently at fp32 and under v2; the noise
floor was quantization damage all along.

## Reproduction

```
node scripts/gender-ort-probe.js --models-dir=DIR          # browser matrix
node scripts/desktop-diag-capture.js --kind=mstp --duration=45 \
  --voice-file=tests/audio/fixtures/voice-200hz-10s.wav    # production path
node tests/ml/perceived-voice-hillenbrand-test.js \
  [--window=S] [--model=ID] [--local-root=DIR] [--dtype=q8|fp32]
# fp32/fp16/re-quantized variants: export + quantize scripts on branch
# perceived-voice-jaesunghuh-tdnn-investigation (padding: vowels < 0.75 s
# are zero-padded for calibration windows)
```
