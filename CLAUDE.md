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
   - Pitch: YIN-based autocorrelation, FFT-accelerated (75–600 Hz)
   - Formants: Burg LPC with polynomial root finding (downsampled to ~12kHz, runs every 6th frame ~200ms)
   - Spectral tilt: FFT low/high band energy ratio
   - HNR: harmonics-to-noise ratio via autocorrelation
   - Intensity: RMS in dB
   - All pre-allocated buffers for zero-GC hot path

3. **ML Worker** (`src/ml/gender-worker.js`) — separate Web Worker hosting a Transformers.js audio-classification pipeline (default model: `Xenova/wav2vec2-large-xlsr-53-gender-recognition-librispeech`, Q8). Resamples incoming chunks to 16 kHz via simple linear interpolation (`src/ml/audio-utils.js`), maintains a 2-second rolling window, runs inference at 4 Hz (every 250 ms), peak-VAD gates windows with no speech-level peaks (`windowPeak < VAD_PEAK_THRESHOLD`), EMA-smooths the score (α=0.4), and resets the smoothed value after a sustained silent run. Posts back `{ score: 0–100, confidence: 0–1, ts }`. Pure helpers (`resampleLinear`, `RingWindow`, `SilenceTracker`, `femaleScoreFromResult`, `windowPeak`, `windowRMS`, `ema`) live in `src/ml/audio-utils.js` so they can be unit-tested without booting the worker.

4. **Main thread** (`src/audio/useAudioPipeline.js`) — custom React hook that manages AudioContext/DSP-Worker/ML-Worker lifecycle, applies DSP result smoothing (rolling median: 2 samples for pitch, 7 for formants), outlier rejection (gates formant jumps > 500 Hz), silence gating (5-second hold), and exposes history via Refs for canvas rendering. Throttles setState to ~5fps for text readouts only.

### Canvas Visualization Strategy

History arrays are stored in Refs (not React state) and read directly by `requestAnimationFrame` loops in canvas components. This avoids React re-renders and keeps rendering smooth. All canvases use ResizeObserver for responsive sizing and device pixel ratio scaling.

- **PitchTrace** — 15-second scrolling pitch waveform with target band
- **ResonanceMeter** — vertical thermometer for the ML perceived-gender score (0–100). Reads `genderTraceRef` (entries `{ time, score, confidence }` posted by the ML Worker). Bar fills from 0 (bottom, "Darker") to current score (top, "Brighter") with a warm→cool gradient; faint orange band at 0–30, faint blue target band at 70–100. A glowing horizontal indicator at the current score tweens between samples via an exponential lerp in the rAF loop, with opacity scaled by confidence so "uncertain" predictions read dim. A right-side history strip plots the last ~10 inferences fading by age. Big number readout below with a subtitle ("loading…", "warming up", "uncertain", "in target", "below target"). Replaces the older ResonanceScoreTrace + ResonanceGauge pair, which spread the same data across a 15-sec timeline + a separate horizontal bar. An earlier hand-crafted vowel-normalized formula (`src/utils/resonanceScore.js`) was tried and replaced because raw-formant geometry doesn't reliably model perceived gender.
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
- ML gender inference runs at 4 Hz (every 250 ms) over a rolling 2-second 16 kHz window; the Q8 model takes ~140 ms median per inference, leaving headroom under the hop budget. A peak-amplitude VAD gate (`windowPeak < VAD_PEAK_THRESHOLD`) skips silent windows — peak rather than RMS so windows that mix speech with short pauses still pass — EMA smoothing (α=0.4) absorbs single-window noise, and the smoothed score resets after `RESET_AFTER_SILENT_INFERENCES` consecutive silent inferences (~2 s at 4 Hz) so a new utterance doesn't blend with a stale pre-pause value. Runs in a dedicated worker so it doesn't block DSP.
- Resampling for the ML worker uses simple linear interpolation rather than a polyphase FIR — speech energy above 8 kHz is minimal and the browser already low-passes mic input
- Rolling median smoothing for outlier robustness
- Silence gating holds last voiced values for 5 seconds, then resets
- Target ranges currently hardcoded in `src/utils/constants.js`
- Session frames buffered in memory and flushed to IndexedDB every 1 second

## Deployment

GitHub Actions (`.github/workflows/deploy.yml`) builds and deploys to GitHub Pages on push to `main`. Build output goes to `docs/`. Vite base path is `/Syrinx/` (uppercase S). See ARCHITECTURE.md for the full design document and implementation roadmap.
