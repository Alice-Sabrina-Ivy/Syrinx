# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Syrinx is a browser-based voice training toolkit providing real-time resonance, pitch, and vocal weight analysis. It runs entirely client-side with no backend — all audio processing happens in the browser. Currently targets voice feminization training.

Live demo: https://alice-sabrina-ivy.github.io/Syrinx/

## Commands

- **Dev server:** `npm run dev`
- **Production build:** `npm run build` (outputs to `dist/`)
- **Lint:** `npm run lint`
- **Preview production build:** `npm run preview`

No test framework is currently set up.

## Tech Stack

React 19 + Vite 7 + Tailwind CSS 4. Visualizations use HTML Canvas directly (not a charting library). Audio capture and DSP use native Web Audio API (AudioWorklet + Web Worker). ES modules throughout.

## Architecture

### Audio Pipeline (three layers, each on a separate thread)

1. **AudioWorklet** (`public/capture-processor.js`) — runs on the audio thread, collects mic samples into ~50ms chunks, forwards to DSP Worker via MessagePort (bypasses main thread).

2. **DSP Worker** (`src/dsp/dsp-worker.js`) — runs in a Web Worker, maintains a ring buffer (~200ms), computes all analysis metrics:
   - Pitch: YIN-based autocorrelation (75–600 Hz)
   - Formants: Burg LPC with polynomial root finding (downsampled to ~12kHz, runs every 4th frame)
   - Spectral tilt: FFT low/high band energy ratio
   - HNR: harmonics-to-noise ratio via autocorrelation
   - Intensity: RMS in dB

3. **Main thread** (`src/audio/useAudioPipeline.js`) — custom React hook that manages AudioContext/Worker lifecycle, applies result smoothing (rolling median), silence gating (5-second hold), and exposes history via Refs for canvas rendering.

### Canvas Visualization Strategy

History arrays are stored in Refs (not React state) and read directly by `requestAnimationFrame` loops in canvas components. This avoids React re-renders and keeps rendering smooth.

- **PitchTrace** — 15-second scrolling pitch waveform with target band
- **VowelSpacePlot** — 2D F1/F2 scatter with 2-second fading trail
- **SpectralTiltGauge** — vocal weight indicator
- **CombinedDashboard** — main practice view composing the above

### Entry Points

`index.html` → `src/main.jsx` → `src/App.jsx` (tab navigation + welcome overlay). AudioWorklet processor loaded dynamically from `public/`. DSP worker spawned as a module worker.

### Key Design Decisions

- Direct AudioWorklet→Worker MessagePort communication for zero main-thread audio relay
- LPC formant extraction throttled to every 4th frame (~200ms) to save CPU
- Rolling median smoothing (3 frames for pitch, 5 for formants) for outlier robustness
- Silence gating holds last voiced values for 5 seconds, then resets
- Target ranges currently hardcoded in `src/utils/constants.js`

## Deployment

GitHub Actions (`.github/workflows/deploy.yml`) builds and deploys to GitHub Pages on push to `main`. Vite base path is `/Syrinx/` (uppercase S). See ARCHITECTURE.md for the full design document and implementation roadmap.
