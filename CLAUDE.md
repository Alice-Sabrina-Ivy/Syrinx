# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Syrinx is a browser-based voice training toolkit providing real-time resonance, pitch, and vocal weight analysis. It runs entirely client-side with no backend — all audio processing happens in the browser. Currently targets voice feminization training.

Live demo: https://alice-sabrina-ivy.github.io/Syrinx/

## Commands

- **Dev server:** `npm run dev`
- **Production build:** `npm run build` (outputs to `docs/`)
- **Lint:** `npm run lint`
- **Preview production build:** `npm run preview`

No test framework is currently set up. Test files are runnable Node scripts (e.g. `node tests/ml/audio-utils-test.js`, `node tests/dsp/accuracy-test.js`) that print `pass/fail` and exit non-zero on failure.

## Tech Stack

React 19 + Vite 7 + Tailwind CSS 4 (via `@tailwindcss/vite` plugin). Dexie for IndexedDB persistence. Visualizations use HTML Canvas directly (not a charting library). Audio capture and DSP use native Web Audio API (AudioWorklet + Web Worker). ES modules throughout.

## Architecture

### Audio Pipeline (four layers, each on a separate thread)

1. **AudioWorklet** (`public/capture-processor.js`) — runs on the audio thread, collects mic samples into ~25ms chunks, broadcasts each chunk to *all* registered consumer worker MessagePorts (currently DSP + ML). Uses pre-allocated buffers to avoid GC pauses. Each consumer gets an independent copy because `postMessage` with a transferable detaches the buffer.

2. **DSP Worker** (`src/dsp/dsp-worker.js`) — runs in a Web Worker, maintains a ring buffer (~200ms), computes all analysis metrics:
   - Pitch: pYIN Stage 2.B (Mauch & Dixon 2014 §2.1–2.3, librosa-style voicing-duplicated state space) with bounded-history Viterbi, σ=50 cents transition prior, lookback L=4 (100 ms latency at 25 ms hop). FFT-accelerated YIN CMND feeds into Beta(2,18) threshold integration → 600-state HMM (300 voiced + 300 unvoiced twins) → Viterbi decode. Stateful: HMM forward variables persist across `detectPitch` calls; tests treating stimuli as independent reset state via the `{type: "reset-pitch-hmm"}` worker message. Three harness-only overrides: `globalThis.__PYIN_STAGE` for algorithm version (0 = vanilla YIN baseline, 1 = Beta-threshold + naive argmax, 2 = production), `globalThis.__PYIN_LOOKBACK` for Viterbi history length L (default 4, exposed as the named constant `PYIN_LOOKBACK_DEFAULT`), and the `set-pyin-sigma` worker message for the transition prior σ in cents (default 50). All three were used during the σ-sweep and L-sweep and shouldn't be touched in production.
   - Formants: Burg LPC with polynomial root finding (downsampled to ~12kHz, runs every 6th frame ~200ms)
   - Spectral tilt: FFT low/high band energy ratio
   - HNR: harmonics-to-noise ratio via autocorrelation
   - Intensity: RMS in dB
   - Voicing: TWO signals exposed by Stage 2.B — `voicedness` (HMM-smoothed posterior, surfaced on the postMessage payload as a UI-confidence indicator; structurally ~0.5 on silence/no-evidence input due to uniform Bayesian fallback) and `voicednessObs` (raw per-frame Beta-CDF candidate mass; 0 on silence/DC, > 0 on signals containing pitch evidence). The two answer different questions and aren't interchangeable. See the worker's module-level comment block on `_pyinLastVoicedness` / `_pyinLastVoicednessObs` for the architectural distinction.
   - All pre-allocated buffers for zero-GC hot path

3. **ML Worker** (`src/ml/gender-worker.js`) — separate Web Worker hosting a Transformers.js audio-classification pipeline (default model: `prithivMLmods/Common-Voice-Gender-Detection-ONNX`, a `wav2vec2-base-960h` fine-tune for binary gender classification, Q8). Resamples incoming chunks to 16 kHz via simple linear interpolation (`src/ml/audio-utils.js`), maintains a 0.75-second rolling window, runs inference at ~6.7 Hz (every 150 ms), peak-VAD gates windows with no speech-level peaks (`windowPeak < VAD_PEAK_THRESHOLD`), EMA-smooths the score (α=0.55), and resets the smoothed value after a sustained silent run. Posts back `{ score: 0–100, confidence: 0–1, ts }`. Pure helpers (`resampleLinear`, `RingWindow`, `SilenceTracker`, `femaleScoreFromResult`, `windowPeak`, `windowRMS`, `ema`) live in `src/ml/audio-utils.js` so they can be unit-tested without booting the worker.

4. **Main thread** (`src/audio/useAudioPipeline.js`) — custom React hook that manages AudioContext/DSP-Worker/ML-Worker lifecycle, applies DSP result smoothing (rolling median: 2 samples for pitch, 7 for formants), outlier rejection (gates formant jumps > 500 Hz), silence gating (5-second hold), and exposes history via Refs for canvas rendering. Throttles setState to ~5fps for text readouts only.

### Canvas Visualization Strategy

History arrays are stored in Refs (not React state) and read directly by `requestAnimationFrame` loops in canvas components. This avoids React re-renders and keeps rendering smooth. All canvases use ResizeObserver for responsive sizing and device pixel ratio scaling.

- **PitchTrace** — 15-second scrolling pitch waveform with target band
- **ResonanceMeter** — vertical thermometer titled "Perceived voice" for the ML perceived-gender score (0–100). Reads `genderTraceRef` (entries `{ time, score, confidence }` posted by the ML Worker). Bar fills from 0 (bottom, "Masculine") to current score (top, "Feminine") with a warm→cool gradient; faint orange band marks the masculine range at 0–30, faint blue band marks the feminine range at 70–100, the middle 30–70 is the uncertain band. A glowing horizontal indicator at the current score tweens between samples via an exponential lerp in the rAF loop, with opacity scaled by confidence so low-confidence predictions read dim. A right-side history strip plots the last ~10 inferences fading by age. Big number readout below with a three-way subtitle driven by score range ("in feminine range" / "in uncertain range" / "in masculine range", plus "loading…" / "warming up" model-state messages). The middle uncertain range collapses with the classifier's low-confidence region because confidence is by construction `|score - 0.5| × 2`, so a single score-range check covers both. Replaces the older ResonanceScoreTrace + ResonanceGauge pair, which spread the same data across a 15-sec timeline + a separate horizontal bar. An earlier hand-crafted vowel-normalized formula (`src/utils/resonanceScore.js`) was tried and replaced because raw-formant geometry doesn't reliably model perceived gender.
- **SpectralTiltGauge** — horizontal gauge for vocal weight
- **CombinedDashboard** — main practice view composing the above, plus session recording logic

### Data Persistence

`src/db.js` defines a Dexie (IndexedDB) schema with four tables:
- **settings** — user preferences (record audio toggle, target ranges)
- **sessions** — practice sessions with summary stats (avg F0, F1, F2, F3, spectral tilt, HNR, time-in-target %)
- **frames** — raw per-frame metrics (timestamp, F0, F1, F2, F3, intensity, spectral tilt, HNR, voiced flag)
- **exerciseResults** — stubbed for future exercise system

### UI Components

- **SessionHistory** (`src/components/SessionHistory.jsx`) — past sessions browser with expandable detail cards
- **DataManagement** (`src/components/DataManagement.jsx`) — settings panel with audio recording toggle, export/import, delete data

### Entry Points

`index.html` → `src/main.jsx` → `src/App.jsx` (three tabs: dashboard, pitch, history + welcome overlay + settings panel). AudioWorklet processor loaded dynamically from `public/`. DSP worker spawned as a module worker.

### Utilities

- `src/utils/constants.js` — target ranges (pitch, resonance, spectral tilt, HNR), display ranges, time windows, and color scheme
- `src/utils/pitchUtils.js` — Hz to musical note mapping (e.g., A3, C#4)

### Key Design Decisions

- Direct AudioWorklet→Worker MessagePort communication for zero main-thread audio relay; AudioWorklet broadcasts to a list of consumer ports so DSP and ML can both receive raw audio
- LPC formant extraction throttled to every 6th frame (~200ms) to save CPU
- ML gender inference runs at ~6.7 Hz (every 150 ms) over a rolling 0.75-second 16 kHz window using a `wav2vec2-base` backbone (~95M params, ~3-4× cheaper than the previous `wav2vec2-large-xlsr-53` backbone of ~317M params). The combination of the smaller model and the shorter window gives ~6-8× faster inference than the prior pipeline, which is what makes the 0.75 s window feasible on a Pixel-8-class mobile CPU at 6.7 Hz and halves end-user perceptual lag (the meter "sees" a vocal change in ≤0.75 s instead of ≤1.5 s). The `inferenceInProgress` guard drops overruns gracefully if the device can't sustain that rate. A peak-amplitude VAD gate (`windowPeak < VAD_PEAK_THRESHOLD`) skips silent windows — peak rather than RMS so windows that mix speech with short pauses still pass — EMA smoothing (α=0.55) absorbs single-window noise, and the smoothed score resets after `RESET_AFTER_SILENT_INFERENCES` consecutive silent inferences (~2 s at 6.7 Hz) so a new utterance doesn't blend with a stale pre-pause value. The `Common-Voice-Gender-Detection-ONNX` model uses id2label `{0:female, 1:male}`, the OPPOSITE ordering to the previous model — `femaleScoreFromResult` parses by label name only and returns null on unrecognized labels (no positional guessing) so a future model swap can't silently invert the meter. Runs in a dedicated worker so it doesn't block DSP.
- Resampling for the ML worker uses simple linear interpolation rather than a polyphase FIR — speech energy above 8 kHz is minimal and the browser already low-passes mic input
- Rolling median smoothing for outlier robustness
- Silence gating holds last voiced values for 5 seconds, then resets
- Target ranges currently hardcoded in `src/utils/constants.js`
- Session frames buffered in memory and flushed to IndexedDB every 1 second

## Measurements & empirical results

Tuning sweeps, latency benchmarks, and other measurement artifacts live in `measurements/` at the repo root (not `docs/`, which is the Vite build output and gets overwritten on deploy).

- **Naming:** `<topic>-<kind>-<YYYY-MM-DD>.{md,csv,txt}` — e.g. `pitch-baseline-2026-05-04.txt`, `harmonic-gate-sweep-2026-05-04.csv`, `ml-latency-2026-05-04.md`
- **Belongs here:** baseline test outputs captured before tuning work, parameter sweep results, latency/throughput measurements, before/after comparisons for any change driven by empirical evidence
- **Does NOT belong here:** ad-hoc debugging logs, test fixtures (those stay in `tests/`), production code

Convention: any optimization or tuning work on `dsp-worker.js`, `gender-worker.js`, or `pitchSmoothing.js` should produce a measurement file in `measurements/` *before* code changes are proposed — changes in these files are grounded in numbers, not intuition.

**Pitch-detector tuning oracles:** `tests/dsp/yin-harmonic-test.js` is a regression guard, not a tuning oracle — it uses very strong synthetic stimuli (deep CMND dips at the true period) and was insensitive across the entire 84-cell sweep on 2026-05-04, so it cannot drive parameter selection. `tests/dsp/accuracy-test.js` and `tests/dsp/real-speech-test.js` (Hillenbrand et al. 1995 vowel corpus) are the tuning oracles for any future change to `detectPitch` constants — they're the only signals that distinguish good from bad gate settings on real speech.

**Multi-frame methodology is canonical.** The `accuracy-test.js` and `real-speech-test.js` Pass-1 measurements use multi-frame stepping (25 ms hops over the central 70 % of each recording, take the median of the non-null trace via `streamingMedianDetect`). This mirrors production hop cadence and is the only methodology that exercises Stage 2.B's HMM as it runs in production. Single-window-per-file (the legacy methodology from before pYIN) doesn't satisfy the HMM's lookback warm-up and produces noise-dominated numbers; it's preserved only as historical context in the session-1 measurement files (`pitch-baseline-pre-impMin-*` etc.). Any future pitch-evaluation work should default to multi-frame.

**Stage 2.B σ=50 L=4 is the deployed pitch detection algorithm.** L was selected via the L-axis Pareto sweep at [measurements/pyin-L-sweep-2026-05-04.md](measurements/pyin-L-sweep-2026-05-04.md) — L=4 (100 ms latency at the 25 ms hop, exactly the original budget) is the gender-symmetric optimum on the full 1116-file Hillenbrand corpus (F=12.16 Hz, M=12.15 Hz, gender gap < 0.01 Hz). σ was then re-verified at L=4 across {50, 75, 100} in [measurements/pyin-sigma-at-bestL-2026-05-04-harness.txt](measurements/pyin-sigma-at-bestL-2026-05-04-harness.txt): σ=50 strictly dominates σ=75 at L=4 (M=12.15 vs 12.95). PTDB-TUG codet at L=4 σ=50: F mean 6.20 Hz, p95 17.2 Hz (Stage 0 baseline 6.82 / 18.0 — pYIN strictly dominates with the σ-sweep Pareto criteria still satisfied). Canonical post-ship baseline numbers in [measurements/pass5-stage2b-L4-sigma50-final-baseline-2026-05-04.md](measurements/pass5-stage2b-L4-sigma50-final-baseline-2026-05-04.md). The σ-rate-scaling argument resolves cleanly: paper σ=20 cents at 10 ms hop ≈ rate-equivalent σ=50 cents at our 25 ms hop, which the L-axis sweep at L=4 confirms empirically. The earlier L=2-only σ-sweep at [measurements/pyin-stage2b-sigma-sweep-2026-05-04.md](measurements/pyin-stage2b-sigma-sweep-2026-05-04.md) had selected σ=75 — context preserved there for why the prior draft of PR #68 shipped at L=2 σ=75; superseded by the L-axis sweep.

**Test helper-choice contract.** Two helpers, two regimes — keep them distinct. `steadyStateDetect` (in `pitch-detection-comprehensive.js`, `accuracy-test.js`, `yin-harmonic-test.js`, `real-speech-test.js`) for stationary stimuli where same-window-repeated equals sequential-frames-of-same-signal: pure tones, harmonic stress, vibrato within a single window. `streamingMedianDetect` (in `accuracy-test.js`, `real-speech-test.js`) for non-stationary recordings where adjacent windows differ. Mixing them up produces measurement artifacts that don't obviously fail — see [measurements/pass1-helper-diagnostic-2026-05-04.md](measurements/pass1-helper-diagnostic-2026-05-04.md) for the failure mode (F p95 = 210 Hz with the wrong helper vs ~28 Hz with the right one, a 7× difference on the Hillenbrand corpus).

**Production paths must be measured, not just harnesses.** Test infrastructure typically sets configuration via `globalThis.__VAR` overrides; production typically does not. The "fallback when override unset" code path is part of the ship surface and needs its own measurement pass — at least one end-to-end run through the actual production initialization sequence (`useAudioPipeline.js` → DSP worker init → `detectPitch`) before any ship claim is written. PR #68's original ship documented L=2 (50 ms latency) based on σ-sweep harness numbers that set `__PYIN_LOOKBACK` explicitly; production never set the override, so the deployed runtime silently fell back to L=5 (~125 ms latency). The harness numbers were correct for L=2 but irrelevant to what shipped. Caught by code review pre-merge; the L-axis sweep that resulted ([measurements/pyin-L-sweep-2026-05-04.md](measurements/pyin-L-sweep-2026-05-04.md)) revealed L=2 was also a sub-optimal cell and the eventual ship was L=4 σ=50. The named `PYIN_LOOKBACK_DEFAULT` constant in `dsp-worker.js` exists so this category of bug can't recur silently.

**Pitch accuracy targets are gender-symmetric.** The tool serves voice training in any direction — transmasculine, transfeminine, cisgender singers and speakers alike. Ship decisions optimize on a gender-symmetric metric (e.g., `max(F_error, M_error)`, or balanced F+M) rather than female accuracy alone. The L-axis sweep produced three defensible Pareto cells (L=2 σ=75, L=4 σ=50, L=5 σ=75); the cell minimizing female F0 error was L=2 σ=75 at F=11.75 Hz, but it had M=15.52 Hz — a 3.77 Hz gender gap that would have given trans men and cis male users substantially worse pitch accuracy than female users. L=4 σ=50 was selected for being gender-symmetric (F=12.16, M=12.15) at a small cost to female accuracy. Voice-training tools must not bake demographic assumptions into ship-criterion math without explicit justification.

## Deployment

GitHub Actions (`.github/workflows/deploy.yml`) builds and deploys to GitHub Pages on push to `main`. Build output goes to `docs/`. Vite base path is `/Syrinx/` (uppercase S). See ARCHITECTURE.md for the full design document and implementation roadmap.
