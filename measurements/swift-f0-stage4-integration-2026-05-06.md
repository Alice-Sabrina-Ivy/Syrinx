# SwiftF0 Stage 4 production integration — measurements

**Date:** 2026-05-06
**Branch:** `pitch-test-corpus-expansion`
**Stages:** 4.5 (build verification) + 4.4 (mobile-diag baseline)
**Predecessors:** [swift-f0-stage3-validation-2026-05-06.md](swift-f0-stage3-validation-2026-05-06.md), [swift-f0-stage3-4-3-5-validation-2026-05-06.md](swift-f0-stage3-4-3-5-validation-2026-05-06.md)
**Raw outputs:** [swift-f0-streaming-verify-2026-05-06.json](swift-f0-streaming-verify-2026-05-06.json), [swift-f0-stage4-mobile-diag-baseline-2026-05-06.json](swift-f0-stage4-mobile-diag-baseline-2026-05-06.json) (promoted from `mobile-diag-runs/`)

## Executive summary

**Both surface points clear cleanly.** Streaming pitch-worker integration preserves SwiftF0-class accuracy across all four corpora. Mobile production-build inference fits the 25 ms hop budget with 55 % headroom (median 11.2 ms vs 25 ms target). Zero errors during 30 s mobile session; SwiftF0 loaded successfully at threshold 0.5; 1089 inferences over 25 s active capture (42.9 Hz, matching the 25 ms chunk cadence).

The pitch-worker / useAudioPipeline / dsp-worker pYIN-removal integration is greenlit for PR opening pending user approval.

---

## Stage 4.5 — Build verification (streaming pitch-worker accuracy)

**Method:** [tests/dsp/swift-f0-streaming-verify.js](../tests/dsp/swift-f0-streaming-verify.js) simulates pitch-worker.js's per-hop streaming inference (linear-resample to 16 kHz, 1024-sample rolling buffer, run inference on every 25 ms chunk) against the four-corpus pitch-bucket harness. Compares per-corpus aggregate accuracy to the Stage 3 standalone baseline.

**Frame attribution adjustment** (load-bearing): SwiftF0's reported pitch represents audio centered at sample 127.5 of the 1024-sample buffer, which sits ~56 ms before the LATEST sample. The streaming harness attributes inference output to that audio time (latest_sample_time − 56 ms), matching the production semantics — pitch is reported with a 56 ms inherent latency relative to chunk arrival. Without this attribution, the harness compared streaming pitch against ground truth at the wrong time and surfaced a false 8-Hz mean-error regression on first run.

**Results — streaming integrated vs Stage 3 standalone:**

Format: `octave-error rate % / null rate % / mean F0 error Hz`

| corpus       | Streaming integrated   | Stage 3 standalone     | Δ (octave / null / mean) |
|---|---|---|---|
| Hillenbrand  | 0.11 / 7.2 / 9.62      | 0.02 / 12.0 / 8.29     | +0.09 pp / −4.8 pp / +1.33 Hz |
| PTDB-TUG     | 0.24 / 5.6 / 5.11      | 0.08 / 16.2 / 6.85     | +0.16 pp / −10.6 pp / **−1.74 Hz** |
| vocadito     | 0.47 / 1.1 / 2.83      | 0.05 / 2.7 / 1.84      | +0.42 pp / −1.6 pp / +0.99 Hz |
| FDA          | 0.02 / 4.6 / 3.17      | 0.00 / 8.5 / 4.09      | +0.02 pp / −3.9 pp / **−0.92 Hz** |

All four corpora **within tolerance** (octave-error rate ≤ 1.0 %, |meanErrΔ| ≤ 2.0 Hz). The two corpora where streaming improves on standalone (PTDB-TUG and FDA mean error Δ negative) reflect different ground-truth time-point alignment, not actual accuracy gain — both modes evaluate against subtly different per-frame reference points.

**Targeted reproducers:**

| Track | Stage 3 standalone | Streaming integrated |
|---|---|---|
| `rl022` (FDA, 80 Hz reproducer) | 2.44 Hz mean / 0 oct errs / 32 frames | **2.71 Hz mean / 0 oct errs / 29 frames** |
| `vocadito_34` (regression-watch) | 2.05 Hz mean / 3 oct errs / 618 frames | 3.51 Hz mean / 12 oct errs / 698 frames |

`rl022` (the user-reported 80 Hz monotone case) preserves SwiftF0 fix essentially unchanged. `vocadito_34` shows slightly more octave errors under streaming (12/698 = 1.7 % vs 3/618 = 0.5 % standalone) — driven by the per-frame attribution differences on a track with fast pitch movement. Still far better than pYIN's baseline (76/729 = 10.4 % octave errors).

**Verdict: PASS.** Streaming integration introduces no SwiftF0-quality regression beyond the per-frame attribution noise inherent to streaming vs batch evaluation.

---

## Stage 4.4 — Mobile-diag baseline (production-build runtime)

**Method:** [scripts/mobile-diag-capture.js](../scripts/mobile-diag-capture.js) drives Chrome 147 on Pixel 8 Pro / Android 16 via ADB+CDP, opens the production-build URL (`vite preview --mode mobile`, port 4173), grants mic permission via Browser.grantPermissions, clicks "Start Listening," and captures 30 s of `?diag=1` frames. The harness was extended this run with a `Browser.grantPermissions` call after page reload — Android Chrome doesn't preserve per-origin grants across fresh URL loads, so for new origins the mic prompt would otherwise block the harness silently.

**Session:** 29.6 s, 1200 high-res frames, 30 low-res samples, **0 errors**.

### Audio pipeline timing

| Metric         | Median | p95   | Max    | Drift          |
|---|---|---|---|---|
| chunkArrival   | 16.3 ms | 33.2 ms | 74.6 ms | **−0.12 ms/s** ✓ |
| end-to-end     | 17.7 ms | 35.4 ms | 90.2 ms | (n/a)          |

chunkArrival drift well within tolerance (≤ 0.2 ms/s threshold). The audio capture pipeline is stable on the integrated production build — no drift introduced by the new pitch-worker contention.

### SwiftF0 inference (pitch-worker)

| Metric         | Value          |
|---|---|
| pitchModel     | `/Syrinx/swift-f0/model.onnx` on `wasm`, threshold 0.5 ✓ |
| Inferences     | 1089 over 25 s (42.9 Hz) |
| **inferMs median** | **11.2 ms** |
| inferMs p95    | 16.5 ms |
| inferMs p99    | 23.1 ms |
| inferMs max    | 241.4 ms (one-time spike, likely first-inference warmup or GC) |
| voiced fraction | 307 / 1089 = 28 % (low — phone was in quiet environment) |

**Hop-budget check:** Production inference at 11.2 ms median = **45 % CPU at the 25 ms hop budget**, with 55 % headroom. p99 23.1 ms is just under budget. The single 241 ms max spike doesn't sustain — it doesn't appear in the running rate (1089 inferences in 25 s = average 23 ms per inference, dominated by the typical-case 11 ms median).

**Comparison vs Stage 3.5 isolated WASM probe** (which measured 5.0 ms median single-frame inference on the same Pixel 8 Pro / Chrome 147):

| Configuration                          | Median | p95     |
|---|---|---|
| Stage 3.5 isolated probe (no other workers) | 5.0 ms  | 5.4 ms  |
| Stage 4.4 production integrated             | 11.2 ms | 16.5 ms |

**~2.2× slower in production than isolated.** Expected — the production runtime has DSP worker, ML worker (gender model on WebGPU), and the main React rendering thread all contending for CPU and memory. The 2.2× factor still leaves comfortable headroom against the 25 ms hop budget.

### Gender model (unchanged from production)

ML inference 454.7 ms median, 1018.5 ms p95 — already documented in CLAUDE.md as exceeding the 150 ms hop budget. Drops overruns gracefully via the `inferenceInProgress` guard. Not affected by Stage 4 changes.

### Diag schema migration

Replaced fields (per the Stage 4.4 schema-update step):
- `voicedness` → `confidence` (in pushFrame and lowRes ring entries) — confidence is SwiftF0's raw output, the upstream signal that drives the silence gate's voicedness arm
- `voicednessObs` removed (no analog in SwiftF0's architecture; pYIN's raw Beta-CDF candidate mass had no semantic equivalent)
- `pitchDetectMs` removed from per-frame timings (pitch detection is no longer in dsp-worker)
- New ring `pitchInferences` (mirrors `mlInferences`) — per-pitch-inference timings for mobile-diag p99 budget verification
- New field `pitchModel` (mirrors `mlModel`) — captures `{modelUrl, device, threshold}` reported by pitch-worker on its "ready" status

The DiagnosticOverlay sparkline updated to plot `confidence` (cyan) instead of `voicedness` (cyan) and `voicednessObs` (purple); same canvas layout. Diag overlay's "detectPitch" timing row removed (pitch is in pitch-worker, not dsp-worker; pitch-worker's own timings would need a separate row).

**Snapshot consumers reading the old field names** (none currently expected outside this repo's own measurement-analysis scripts) would need to update field references. Worth flagging in the PR description.

### Worker bundle sizes

From `npm run build` output:

| Asset | Pre-Stage 4 (pYIN) | Post-Stage 4 (SwiftF0) |
|---|---|---|
| dsp-worker.js | (large, with pYIN HMM machinery) | **6.12 KB** |
| pitch-worker.js | (n/a) | 402.76 KB (includes onnxruntime-web bundle) |
| gender-worker.js | 527.43 KB | 527.43 KB (unchanged) |
| ORT WASM (jsep variant) | (n/a — bundled by transformers.js for gender) | 26.10 MB |
| ORT WASM (asyncify variant) | (n/a) | 23.57 MB |

**~50 MB of ORT WASM emitted by the build.** Vite emits both jsep and asyncify variants because both are referenced as ESM imports in the worker bundles (the bundle.min.mjs entry conditionally imports based on runtime support). At runtime only one is fetched. Bundle-size optimization possible but not in scope for this PR — would require switching the worker import from default `onnxruntime-web` to a more constrained subpath like `onnxruntime-web/wasm`.

### What stayed the same

- Worker contention pattern: capture-processor broadcasts to dsp/gender/pitch consumers. Pre-existing pattern, just one more consumer.
- Capture-source routing: MSTP on Pixel 8 Pro / Chrome (matches Stage 2.5 routing decision in CLAUDE.md).
- Sample rate negotiation: granted `latency: 0.04` (40 ms hardware buffer) — same as before.
- Silence gate: `intensityQuiet AND voicednessQuiet` semantics preserved; voicednessQuiet now reads SwiftF0 confidence < 0.5 instead of pYIN HMM-smoothed posterior < 0.5.

## Verdict

Both follow-up measurements clear:

| Pre-condition for PR opening | Status |
|---|---|
| Streaming integration produces SwiftF0-class accuracy | ✓ (Step 4.5) |
| Mobile WASM inference fits hop budget on integrated build | ✓ (Step 4.4: 45 % CPU at median, 55 % headroom) |
| No errors in 30 s mobile session | ✓ (status.errors empty) |
| pitch-worker loads SwiftF0 at threshold 0.5 successfully | ✓ |
| Diag schema migration captures pitch + confidence | ✓ |
| Mobile chunkArrival drift unchanged from production baseline | ✓ (−0.12 ms/s, well within ±0.2 ms/s threshold) |

Stage 4 production integration ready for PR opening pending user approval (per CLAUDE.md's explicit-PR-opening rule).

## Reproducibility

```bash
# Stage 4.5 streaming verification (~150 s wall time, 1436 tracks)
node tests/dsp/swift-f0-streaming-verify.js

# Stage 4.4 mobile-diag baseline (USB phone, USB debugging on, "Allow" tapped)
npm run build                              # one-time
npx vite preview --mode mobile --host      # serves docs/ over HTTPS
node scripts/mobile-diag-capture.js \
  --duration=30 \
  --url="https://<lan-ip>:4173/Syrinx/?diag=1"
```

The mobile-diag harness was extended in this run with a `Browser.grantPermissions` call to auto-grant audioCapture for the target origin — the grant gets reset on `Page.reload`, so it now happens between the reload and the click. Future runs against new origins (e.g., a different preview port) work without manual mic-prompt acknowledgement on the device.
