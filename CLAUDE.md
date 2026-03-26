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

No test framework is currently set up. Stub test files exist in `tests/dsp/` but are not wired into any test runner.

## Tech Stack

React 19 + Vite 7 + Tailwind CSS 4 (via `@tailwindcss/vite` plugin). Dexie for IndexedDB persistence. Visualizations use HTML Canvas directly (not a charting library). Audio capture and DSP use native Web Audio API (AudioWorklet + Web Worker). ES modules throughout.

## Architecture

### Audio Pipeline (three layers, each on a separate thread)

1. **AudioWorklet** (`public/capture-processor.js`) — runs on the audio thread, collects mic samples into ~25ms chunks, forwards to DSP Worker via MessagePort (bypasses main thread). Uses pre-allocated buffers to avoid GC pauses.

2. **DSP Worker** (`src/dsp/dsp-worker.js`) — runs in a Web Worker, maintains a ring buffer (~200ms), computes all analysis metrics:
   - Pitch: YIN-based autocorrelation, FFT-accelerated (75–600 Hz)
   - Formants: Burg LPC with polynomial root finding (downsampled to ~12kHz, runs every 6th frame ~200ms)
   - Spectral tilt: FFT low/high band energy ratio
   - HNR: harmonics-to-noise ratio via autocorrelation
   - Intensity: RMS in dB
   - All pre-allocated buffers for zero-GC hot path

3. **Main thread** (`src/audio/useAudioPipeline.js`) — custom React hook that manages AudioContext/Worker lifecycle, applies result smoothing (rolling median: 2 samples for pitch, 7 for formants), outlier rejection (gates formant jumps > 500 Hz), silence gating (5-second hold), and exposes history via Refs for canvas rendering. Throttles setState to ~5fps for text readouts only.

### Canvas Visualization Strategy

History arrays are stored in Refs (not React state) and read directly by `requestAnimationFrame` loops in canvas components. This avoids React re-renders and keeps rendering smooth. All canvases use ResizeObserver for responsive sizing and device pixel ratio scaling.

- **PitchTrace** — 15-second scrolling pitch waveform with target band
- **ResonanceTrace** — 15-second scrolling F2 resonance plot
- **SpectralTiltGauge** — horizontal gauge for vocal weight
- **ResonanceGauge** — horizontal gauge for resonance brightness (F1/F2/F3 composite)
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

- Direct AudioWorklet→Worker MessagePort communication for zero main-thread audio relay
- LPC formant extraction throttled to every 6th frame (~200ms) to save CPU
- Rolling median smoothing for outlier robustness
- Silence gating holds last voiced values for 5 seconds, then resets
- Target ranges currently hardcoded in `src/utils/constants.js`
- Session frames buffered in memory and flushed to IndexedDB every 1 second

## Deployment

GitHub Actions (`.github/workflows/deploy.yml`) builds and deploys to GitHub Pages on push to `main`. Build output goes to `docs/`. Vite base path is `/Syrinx/` (uppercase S). See ARCHITECTURE.md for the full design document and implementation roadmap.
