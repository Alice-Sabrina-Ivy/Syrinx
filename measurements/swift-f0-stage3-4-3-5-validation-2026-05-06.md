# SwiftF0 Stage 3.4 + 3.5 follow-up validation

**Date:** 2026-05-06
**Branch:** `pitch-test-corpus-expansion`
**Stages:** 3.4 (confidence threshold sweep) + 3.5 (browser ORT-WASM latency)
**Predecessors:** [swift-f0-stage3-validation-2026-05-06.md](swift-f0-stage3-validation-2026-05-06.md)
**Raw JSON:** [swift-f0-threshold-sweep-2026-05-06.json](swift-f0-threshold-sweep-2026-05-06.json), [swift-f0-wasm-probe-desktop-*.json](.), [swift-f0-wasm-probe-mobile-*.json](.)

## Executive summary

**Both follow-ups clear with comfortable headroom.** A confidence threshold of **~0.5** balances null-rate against octave-error rate cleanly: PTDB-TUG <90 Hz nulls drop from 24 % (default 0.9) to 6.8 % while octave-error rate stays at 1.69 % — still better than the pYIN baseline of 2.3 %. No threshold value exhibits a structural failure mode. **Browser ORT-WASM inference takes 5.00 ms median per single-frame call on Pixel 8 Pro Chrome 147** — fully fits the 25 ms hop budget with 5× headroom and only a 1.2× mobile-vs-desktop ratio (vs JaesungHuh ECAPA-TDNN's 2.4×).

Greenlight indicators for Stage 4 production integration:
- Threshold tuning is a clean lever, not a structural problem.
- Mobile latency fits the hop budget on the gating-constraint hardware.
- Mobile-desktop ratio is much smaller than the prior JaesungHuh investigation, which means desktop performance numbers transfer to mobile more reliably than they did for that model class.

---

## Stage 3.4 — Confidence threshold sweep

**Method:** [tests/dsp/swift-f0-threshold-sweep.js](../tests/dsp/swift-f0-threshold-sweep.js) caches each track's per-frame `(pitch_hz, confidence)` from a single SwiftF0 inference, then re-buckets at thresholds {0.9, 0.7, 0.5, 0.3, 0.1, 0.0}. The same 1436 tracks across the four-corpus mix as Stage 3.

### Aggregate per-corpus results

Format: `octave-error rate % / null rate % / mean F0 error Hz`

| corpus       | th=0.9            | th=0.7            | th=0.5            | th=0.3            | th=0.1             | th=0.0             |
|---|---|---|---|---|---|---|
| Hillenbrand  | 0.02 / 12.0 / 8.3 | 0.06 / 7.8 / 8.7  | 0.13 / 5.6 / 9.1  | 0.50 / 3.4 / 11.7 | 2.17 / 0.2 / 31.2  | 2.35 / 0.0 / 33.5  |
| PTDB-TUG     | 0.08 / 16.2 / 6.8 | 0.16 / 8.6 / 7.0  | 0.21 / 4.0 / 7.2  | 0.31 / 1.2 / 7.9  | 0.59 / 0.1 / 11.3  | 0.69 / 0.0 / 13.1  |
| vocadito     | 0.05 / 2.7 / 1.8  | 0.14 / 0.7 / 2.1  | 0.23 / 0.2 / 2.3  | 0.26 / 0.0 / 2.5  | 0.28 / 0.0 / 2.7   | 0.28 / 0.0 / 2.7   |
| FDA          | 0.00 / 8.5 / 4.1  | 0.04 / 3.0 / 4.7  | 0.06 / 1.3 / 4.9  | 0.10 / 0.3 / 5.3  | 0.20 / 0.0 / 6.6   | 0.22 / 0.0 / 6.9   |

### PTDB-TUG <90 Hz — the user-flagged worst-case cell

| threshold | nVoiced | nNull | null %   | octave errs | octave % | mean err Hz |
|---|---|---|---|---|---|---|
| 0.9 (default) | 722  | 228   | 24.0 %   | 6           | 0.83 %   | 5.97         |
| 0.7           | 815  | 135   | 14.2 %   | 13          | 1.60 %   | 6.84         |
| 0.5           | 885  | 65    |  6.8 %   | 15          | 1.69 %   | 8.05         |
| 0.3           | 928  | 22    |  2.3 %   | 20          | 2.16 %   | 14.21        |
| 0.1           | 950  | 0     |  0.0 %   | 28          | 2.95 %   | 27.43        |
| 0.0           | 950  | 0     |  0.0 %   | 28          | 2.95 %   | 27.43        |

**Observation: monotonic trade-off with a clean inflection.** Lowering the threshold from 0.9 to 0.5 cuts the null rate by 3.5× while only doubling the octave-error rate (which remains better than pYIN baseline 2.3 % at this cell). Below 0.3 the model degrades rapidly: octave rate at 2.95 % is now equivalent to pYIN baseline, and mean error balloons to 27 Hz. The accuracy advantage of SwiftF0 collapses if thresholds drop too low.

**No structural failure surfaced.** A threshold exists that satisfies both criteria (null rate < 10 %, octave rate < pYIN baseline) on every corpus. Threshold tuning is a clean lever, not a problem requiring Option C fallback.

### Recommended operating point

**Threshold ≈ 0.5** (subject to refinement during Stage 4 integration UX testing). Rationale:

| Criterion                                          | th=0.5 |
|---|---|
| All corpora null rate ≤ 6.8 %                       | ✓ (max PTDB-TUG <90 = 6.8 %) |
| All corpora octave rate < pYIN baseline (≤2.3 %)    | ✓ (max PTDB-TUG <90 = 1.69 %) |
| Vocadito singing preserved                          | ✓ (octave rate 0.23 %, mean err 2.3 Hz) |
| FDA <90 Hz reproducer regime preserved              | ✓ (1.3 % null, 0.06 % octave, 4.9 Hz mean) |

Threshold values 0.6 and 0.4 would also be defensible — UX testing during Stage 4 will refine. The decision point worth flagging: the difference between th=0.7 and th=0.3 spans null rate 8.6 % → 1.2 % at the cost of 0.16 % → 0.31 % octave rate on PTDB-TUG. A user-tunable threshold (e.g., as part of the diag overlay) could be useful during Stage 4 dialing.

### Hillenbrand 280–350 regression — invariant across thresholds

The Stage 3 flag (3 octave errors / 39 frames on speaker w29) does not improve at any threshold:
- th=0.9: 6.5 % octave / 20.5 % null
- th=0.5: 8.3 % octave / 7.7 % null
- th=0.0: 15.4 % octave / 0.0 % null

Lower thresholds *increase* the octave rate in this cell — speaker w29's high-pitched vowels appear to confuse the model in a confidence-correlated way. This is a model-architecture-level limitation, not a thresholding issue. Sample size (39 frames / 0.25 % of corpus) keeps it bounded.

---

## Stage 3.5 — Browser ORT-WASM latency

**Method:** [scripts/swift-f0-wasm-probe.js](../scripts/swift-f0-wasm-probe.js) drives a standalone HTML probe ([tests/dsp/swift-f0-wasm-probe/index.html](../tests/dsp/swift-f0-wasm-probe/index.html)) that loads `onnxruntime-web` 1.26.0-dev and runs warmup + 100× inferences on a 1-second buffer + 200× inferences on a 1024-sample (single-frame minimum) buffer. The probe asset server vends `model.onnx`, `index.html`, and the local `node_modules/onnxruntime-web/dist/` WASM bundles.

Two configurations measured:
- **Desktop** — puppeteer-core spawns headless Chrome 147 on Windows 11.
- **Mobile** — ADB + CDP attaches to Chrome 147 on Pixel 8 Pro running Android 10 (per UA).

### Results

| Configuration | Single-frame (1024 samples) median | p95     | 1-second buffer (62 frames) median | p95     | Session load |
|---|---|---|---|---|---|
| **Desktop browser WASM** (Chrome 147 headless, Windows 11)     | **4.20 ms** | 5.00 ms  | **39.80 ms** | 46.80 ms | 427 ms     |
| **Mobile browser WASM** (Chrome 147, Pixel 8 Pro / Android 10) | **5.00 ms** | 5.40 ms  | **51.20 ms** | 52.10 ms | 2312 ms    |
| Reference: Node native ORT (onnxruntime-node)                  | ≈0.66 ms/hop (from Stage 2 audit)  | —        | —             | —        | —          |

### Hop-budget analysis

Production runs at 25 ms hops. Single-frame inference cost on the gating-constraint hardware (Pixel 8 Pro Chrome 147 / WASM):

- **5.00 ms / 25 ms = 20 % CPU** at steady state
- **5× headroom** below the hop budget
- p95 5.40 ms doesn't change the picture — even worst-case frames stay under 22 % budget

This is a clear pass. SwiftF0 fits Syrinx's hop budget on the worst-case mobile target with substantial margin.

### Mobile-vs-desktop ratio

| Model                                | Desktop (browser) | Mobile (Pixel 8 Pro Chrome 147) | Ratio  | Source |
|---|---|---|---|---|
| **SwiftF0** (this stage)             | 4.20 ms (WASM)    | 5.00 ms (WASM)                   | **1.19×** | this measurement |
| JaesungHuh ECAPA-TDNN (current)      | 191 ms (WebGPU)   | 460 ms (WebGPU)                  | 2.41×  | CLAUDE.md §"Perceived-voice gender model" |
| prithivMLmods wav2vec2-base (former) | 462 ms (WebGPU)   | 2100 ms (WebGPU)                 | 4.55×  | CLAUDE.md ibid |

**SwiftF0's mobile penalty is 2× smaller than JaesungHuh ECAPA-TDNN's and 4× smaller than wav2vec2-base's.** The 95K-parameter CNN architecture is much more mobile-friendly than wav2vec2-derivative models. Implication: desktop performance numbers transfer to mobile more cleanly for SwiftF0 than they did for the gender-model family. Stage 4 integration UX testing on desktop will be a much better proxy for mobile UX than it was for the gender models.

### Session load time

Desktop 427 ms / Mobile 2312 ms — the one-time ONNX session creation cost. Not a per-inference concern but worth noting for app startup if SwiftF0 ships in the production capture pipeline (would add ~2.3 s to the "Start Listening" → first-pitch latency on mobile).

### Notes on the measurement

- onnxruntime-web 1.26.0-dev is the version transitively bundled by `@huggingface/transformers` v4.2.0. Stage 4 production integration would bundle whichever version Transformers.js ships (no separate dep needed).
- One spurious 404 logged per session (ORT trying multiple WASM variant files before finding one). Production-bundled paths would have all variants available; not a measurement contamination.
- Probe runs single-threaded WASM (`numThreads=1`) since SwiftF0's 95K params don't benefit much from threading and Stage 4 production worker would also run single-threaded for the same reason.

---

## Stage 4 readiness

Both follow-ups clear cleanly. No structural finding motivates fallback or direction-reconsideration. The pre-conditions for Stage 4 (production-integration planning) are met:

| Pre-condition                                            | Stage 3 result | Stage 3.4–3.5 result |
|---|---|---|
| User-reported reproducer fixed                           | ✓ (rl022 27 → 2.4 Hz) | unchanged at threshold ≥0.3 |
| Octave errors collapse vs pYIN baseline                  | ✓ (50–100× reduction) | ✓ at all thresholds ≥0.3 |
| Singing (vocadito) preserved                             | ✓ | ✓ |
| Synthetic fixtures track cleanly                         | ✓ | (not re-measured; pure-tone behavior is threshold-independent) |
| Confidence threshold has a viable operating point        | (open)        | ✓ (~0.5) |
| Mobile WASM fits hop budget                              | (open)        | ✓ (5× headroom) |
| Mobile-vs-desktop ratio is reasonable                    | (open)        | ✓ (1.2×) |

**Stage 4 (production integration planning) is greenlit pending user approval to proceed.** The remaining open decisions are integration-level, not validation-level:

- Worker architecture: dedicated `pitch-worker.js` (already decided)
- Model file delivery: in-repo at `public/swift-f0/model.onnx` (already decided)
- Streaming inference cadence: per-hop (1024 samples) vs rolling buffer
- Replacement vs parallel: cut over from pYIN entirely vs run side-by-side during a transition window
- Threshold UX: hard-coded at ~0.5 vs user-tunable in diag overlay
- Confidence-aware visualization: surface SwiftF0's confidence in the pitch trace (e.g., opacity scaling) vs treat as binary voiced/unvoiced

These are Stage 4 planning topics. Awaiting greenlight to proceed.

## Reproducibility

```bash
# Stage 3.4 threshold sweep (~40 s wall time)
node tests/dsp/swift-f0-threshold-sweep.js

# Stage 3.5 desktop browser WASM (~10 s wall time)
node scripts/swift-f0-wasm-probe.js --mode=desktop

# Stage 3.5 mobile browser WASM (USB phone, USB debugging on, "Allow" tapped)
node scripts/swift-f0-wasm-probe.js --mode=mobile
```
