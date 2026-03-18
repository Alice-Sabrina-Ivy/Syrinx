# Syrinx — Architecture Document

## Project Overview

**Syrinx** is a free, open-source voice training toolkit that runs entirely in the browser. No downloads, no accounts, no servers — just open the URL and start training. It provides real-time visual feedback on pitch, resonance, vocal weight, and intonation using your device's microphone, with long-term progress tracking stored locally on your device.

The name comes from the vocal organ of songbirds (the most resonant voices in nature) and a Greek myth about transformation.

**Live at**: `https://alice-sabrina-ivy.github.io/syrinx`

### Why This Exists

Voice training is one of the most impactful and most under-tooled aspects of transition. The existing landscape is fragmented:

- **Pitch-only apps** (Voice Tools, Voice Pitch Analyzer): Only track F0, which is actually the *least* important metric for voice feminization. They give users a false sense that pitch is all that matters.
- **Praat**: The gold standard for acoustic analysis, used by speech pathologists and linguists. Incredibly powerful, but its interface is hostile to anyone without a phonetics PhD.
- **Commercial voice coaching apps**: Subscription-based, closed-source, and generally shallow in their analysis.
- **Nothing** that combines real-time multi-metric feedback, guided exercises, and long-term progress tracking in a free, private, zero-install tool.

Syrinx fills this gap. It runs entirely on your device — your voice data never leaves your phone or computer.

### Target Users

- Transgender women and transfeminine people doing voice training (primary)
- Transmasculine people tracking vocal changes on testosterone
- Voice coaches who want clients to have a free practice tool between sessions
- Anyone doing intentional vocal modification work

### Design Principles

1. **Zero friction**: No install, no account, no signup. Open the URL → allow mic → start training.
2. **Privacy by architecture**: Everything runs client-side. No server, no analytics, no telemetry. Voice data never leaves the device.
3. **Multi-metric from day one**: Pitch, resonance, vocal weight, and intonation — not just pitch.
4. **Progressive complexity**: Beginners see a simple dashboard with clear feedback. Advanced users can access detailed formant plots, spectrograms, and custom exercises.
5. **Mobile-first**: Most people practice voice training on their phones. The UI must work great on small screens.

---

## Core Features

### MVP (v0.1) — Real-Time Feedback Engine

1. **Real-time pitch display**: Live-updating pitch trace with configurable target range, Hz readout, musical note mapping, and color-coded feedback (in target / close / out of range)
2. **Real-time resonance display**: F1/F2 vowel space plot showing the user's current resonance position as a moving dot with target zones for typical female formant ranges
3. **Real-time vocal weight display**: Spectral tilt indicator showing brightness/darkness of the voice
4. **Combined dashboard**: A unified view showing all metrics simultaneously with a clean, glanceable layout optimized for practice
5. **Session recording**: Start/stop a practice session; all per-frame metrics are saved locally for review
6. **Session history**: List of past sessions with summary stats, stored in the browser's IndexedDB

### v0.2 — Progress Tracking & Personalization

7. **Progress charts**: Plot key metrics over weeks/months — pitch median, F2 average, % time in target, spectral tilt trend
8. **Baseline capture**: A guided "record your starting point" flow. Progress is measured relative to where *you* started, not population averages.
9. **Goal configuration**: Personal target ranges for all metrics, with presets for common goals ("voice feminization," "androgynous," "voice masculinization")
10. **Data export/import**: Export all data as JSON for backup or migration between devices. Import to restore.

### v0.3 — Training Modules

11. **Pitch training mode**: Interactive exercises — sustain a target note, glide between pitches, read sentences within a target range, pitch agility drills
12. **Resonance training mode**: Sustained vowel targeting, "big dog / small dog" exercises, reading passages while maintaining resonance
13. **Intonation training mode**: Pitch contour matching, rising terminal practice, expressiveness drills
14. **Vocal weight exercises**: Practice lightening or darkening the voice while holding pitch steady

### v0.4 — Advanced Features (Stretch)

15. **Real-time scrolling spectrogram**: Full spectrogram view for users who want the complete spectral picture
16. **Voice profile snapshots**: A composite "voice card" summarizing all metrics, shareable as an image
17. **Guided warmup routines**: Configurable warmup sequences chaining exercises together
18. **Reading passage analysis**: Read a passage aloud, get a per-sentence breakdown with highlights on where you slipped out of target
19. **PWA offline support**: Full offline functionality via service worker caching

---

## Technical Architecture

### High-Level Design

Everything runs in the browser. There is no backend.

```
┌──────────────────────────────────────────────────────────────┐
│  Browser                                                     │
│                                                              │
│  ┌──────────────┐    ┌──────────────────┐                    │
│  │ Microphone   │    │  React SPA       │                    │
│  │              │    │                  │                    │
│  └──────┬───────┘    │  ┌────────────┐  │   ┌────────────┐  │
│         │            │  │ Visualiza- │  │   │ IndexedDB  │  │
│         ▼            │  │ tion Layer │  │   │            │  │
│  ┌──────────────┐    │  │ (Canvas)   │  │   │ - sessions │  │
│  │ AudioWorklet │    │  └─────▲──────┘  │   │ - frames   │  │
│  │ (audio       │    │        │         │   │ - settings │  │
│  │  thread)     │    │  ┌─────┴──────┐  │   │ - baselines│  │
│  └──────┬───────┘    │  │ Analysis   │  │   └─────▲──────┘  │
│         │            │  │ State      │  │         │          │
│         │ samples    │  │ Manager    │  │─────────┘          │
│         ▼            │  └─────▲──────┘  │   persist/query    │
│  ┌──────────────┐    │        │         │                    │
│  │ DSP Worker   │────│────────┘         │                    │
│  │ (Web Worker) │    │  analysis data   │                    │
│  │              │    │                  │                    │
│  │ - Pitch      │    └──────────────────┘                    │
│  │ - LPC/       │                                            │
│  │   Formants   │    ┌──────────────────┐                    │
│  │ - Spectral   │    │ Service Worker   │                    │
│  │   tilt       │    │ (PWA offline)    │                    │
│  │ - HNR        │    └──────────────────┘                    │
│  └──────────────┘                                            │
└──────────────────────────────────────────────────────────────┘
```

### Key Architectural Decision: Web Worker for DSP

All audio analysis runs in a **dedicated Web Worker**, not on the main thread. This is critical:

- Formant extraction via LPC is the most CPU-intensive operation. Running it on the main thread would cause UI jank, especially on phones.
- The AudioWorklet captures audio in the audio thread and posts raw samples to the DSP Worker.
- The DSP Worker runs pitch detection, LPC formant extraction, spectral analysis, and posts results back to the main thread.
- The main thread only handles rendering and state management — it never touches DSP math.

### Tech Stack

| Layer | Technology | Rationale |
|-------|-----------|-----------|
| Framework | React (Vite) | Fast dev, good ecosystem, static build for GitHub Pages |
| Visualization | HTML Canvas | Best performance for real-time plots; requestAnimationFrame for smooth rendering |
| Progress charts | Recharts or D3.js | For session history and trend charts (not real-time) |
| Audio capture | AudioWorklet | Runs in audio thread, glitch-free capture |
| DSP / analysis | Web Worker + custom JS | Pitch (autocorrelation), formants (Burg LPC), spectral tilt (FFT) |
| Storage | IndexedDB (via Dexie.js) | Structured local storage, handles large datasets, async |
| PWA | Service Worker + manifest | Installable on phones, offline support |
| Hosting | GitHub Pages | Free, static, global CDN |
| Build | Vite → static HTML/JS/CSS | Single `npm run build`, deploy to `gh-pages` branch |

### Why Dexie.js for Storage?

Raw IndexedDB has a notoriously awful API. Dexie wraps it with a clean Promise-based interface, adds indexing, and handles schema migrations — essential since the data model will evolve across versions. It adds ~15KB gzipped, which is worth it.

---

## Client-Side Audio Analysis — Detailed Design

### Audio Capture Pipeline

```
Microphone (getUserMedia, mono, device sample rate)
    │
    ▼
AudioWorkletNode ("capture-processor")
    │  Collects samples into ~50ms chunks
    │  Posts Float32Array to main thread
    ▼
Main thread (thin relay)
    │  Forwards chunk to DSP Worker via postMessage
    │  (Transferable ArrayBuffer for zero-copy)
    ▼
DSP Web Worker
    │  Ring buffer (last ~200ms of audio)
    │  Runs all analysis on each new chunk
    │  Posts results back to main thread
    ▼
Main thread
    │  Updates React state
    │  Triggers Canvas re-render
    ▼
Visualization (requestAnimationFrame)
```

### AudioWorklet Processor

```javascript
// capture-processor.js — runs in the audio thread
class CaptureProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.buffer = new Float32Array(0);
    this.chunkSize = 2400; // ~50ms at 48kHz (adjusted on init)
  }

  process(inputs) {
    const input = inputs[0][0]; // mono channel
    if (!input) return true;

    // Append to buffer
    const newBuffer = new Float32Array(this.buffer.length + input.length);
    newBuffer.set(this.buffer);
    newBuffer.set(input, this.buffer.length);
    this.buffer = newBuffer;

    // Send complete chunks
    while (this.buffer.length >= this.chunkSize) {
      const chunk = this.buffer.slice(0, this.chunkSize);
      this.buffer = this.buffer.slice(this.chunkSize);
      this.port.postMessage(chunk.buffer, [chunk.buffer]);
    }
    return true;
  }
}
registerProcessor("capture-processor", CaptureProcessor);
```

### DSP Worker — Analysis Engine

The DSP Worker maintains a ring buffer and runs four analyses on each incoming chunk:

```javascript
// dsp-worker.js — runs in a Web Worker

const WINDOW_MS = 200;       // Analysis window size
let sampleRate = 48000;      // Negotiated with AudioContext
let ringBuffer = new Float32Array(0);
let windowSize = Math.floor(sampleRate * WINDOW_MS / 1000);

self.onmessage = (e) => {
  if (e.data.type === "init") {
    sampleRate = e.data.sampleRate;
    windowSize = Math.floor(sampleRate * WINDOW_MS / 1000);
    return;
  }

  if (e.data.type === "chunk") {
    const chunk = new Float32Array(e.data.buffer);
    appendToRingBuffer(chunk);

    if (ringBuffer.length < windowSize) return;

    const window = ringBuffer.slice(-windowSize);
    const results = {
      pitch: detectPitch(window, sampleRate),
      formants: extractFormants(window, sampleRate),
      spectralTilt: computeSpectralTilt(window, sampleRate),
      hnr: computeHNR(window, sampleRate),
      intensity: computeIntensity(window),
      timestamp: performance.now(),
    };

    self.postMessage({ type: "analysis", data: results });
  }
};
```

### Pitch Detection: Autocorrelation (YIN-based)

Pitch detection in JS is well-solved. We use a **YIN-based autocorrelation** algorithm, which is what most reliable pitch detectors use (including Praat internally):

```javascript
// Simplified YIN pitch detection
function detectPitch(buffer, sampleRate) {
  const threshold = 0.15;     // Aperiodicity threshold
  const minF0 = 75;           // Hz — low enough for baritone
  const maxF0 = 600;          // Hz — high enough for head voice

  const minLag = Math.floor(sampleRate / maxF0);
  const maxLag = Math.floor(sampleRate / minF0);
  const halfLen = Math.floor(buffer.length / 2);

  // Step 1: Difference function
  const diff = new Float32Array(halfLen);
  for (let tau = 1; tau < halfLen; tau++) {
    let sum = 0;
    for (let i = 0; i < halfLen; i++) {
      const d = buffer[i] - buffer[i + tau];
      sum += d * d;
    }
    diff[tau] = sum;
  }

  // Step 2: Cumulative mean normalized difference (CMND)
  const cmnd = new Float32Array(halfLen);
  cmnd[0] = 1;
  let runningSum = 0;
  for (let tau = 1; tau < halfLen; tau++) {
    runningSum += diff[tau];
    cmnd[tau] = diff[tau] / (runningSum / tau);
  }

  // Step 3: Absolute threshold
  let bestTau = -1;
  for (let tau = minLag; tau < Math.min(maxLag, halfLen); tau++) {
    if (cmnd[tau] < threshold) {
      // Find the local minimum
      while (tau + 1 < halfLen && cmnd[tau + 1] < cmnd[tau]) tau++;
      bestTau = tau;
      break;
    }
  }

  if (bestTau === -1) return null; // Unvoiced

  // Step 4: Parabolic interpolation for sub-sample accuracy
  const s0 = cmnd[bestTau - 1] || cmnd[bestTau];
  const s1 = cmnd[bestTau];
  const s2 = cmnd[bestTau + 1] || cmnd[bestTau];
  const refinedTau = bestTau + (s0 - s2) / (2 * (s0 - 2 * s1 + s2));

  return sampleRate / refinedTau;
}
```

**Accuracy**: YIN is well-studied and matches Praat's pitch detection closely for clean speech. The main limitation is handling very breathy or creaky voice, where it can produce octave errors. The confidence value (CMND minimum) helps detect these cases.

### Formant Extraction: Burg LPC

This is the most novel and most challenging part of the client-side approach. Praat uses the **Burg method** for linear predictive coding (LPC), which estimates the vocal tract's resonance structure. We implement it in JavaScript:

```javascript
// Burg LPC algorithm for formant extraction
function burgLPC(samples, order) {
  const n = samples.length;
  const a = new Float64Array(order + 1); // LPC coefficients
  a[0] = 1;

  // Forward and backward prediction errors
  let ef = new Float64Array(samples);
  let eb = new Float64Array(samples);
  let errorPower = 0;
  for (let i = 0; i < n; i++) errorPower += samples[i] * samples[i];
  errorPower /= n;

  for (let m = 1; m <= order; m++) {
    // Compute reflection coefficient
    let num = 0, den = 0;
    for (let i = m; i < n; i++) {
      num += ef[i] * eb[i - 1];
      den += ef[i] * ef[i] + eb[i - 1] * eb[i - 1];
    }
    const k = -2 * num / den;

    // Update LPC coefficients
    const aNew = new Float64Array(order + 1);
    aNew[0] = 1;
    for (let i = 1; i < m; i++) {
      aNew[i] = a[i] + k * a[m - i];
    }
    aNew[m] = k;

    // Update prediction errors
    const efNew = new Float64Array(n);
    const ebNew = new Float64Array(n);
    for (let i = m; i < n; i++) {
      efNew[i] = ef[i] + k * eb[i - 1];
      ebNew[i] = eb[i - 1] + k * ef[i];
    }
    ef = efNew;
    eb = ebNew;
    a.set(aNew);

    errorPower *= (1 - k * k);
  }

  return { coefficients: a, error: errorPower };
}

// Extract formant frequencies from LPC coefficients by finding
// the roots of the LPC polynomial and converting to frequencies
function extractFormants(buffer, sampleRate) {
  // Pre-emphasis (boost high frequencies)
  const preEmph = new Float64Array(buffer.length);
  preEmph[0] = buffer[0];
  for (let i = 1; i < buffer.length; i++) {
    preEmph[i] = buffer[i] - 0.97 * buffer[i - 1];
  }

  // Apply Hamming window
  const windowed = new Float64Array(preEmph.length);
  for (let i = 0; i < preEmph.length; i++) {
    windowed[i] = preEmph[i] * (0.54 - 0.46 * Math.cos(2 * Math.PI * i / (preEmph.length - 1)));
  }

  // LPC order: for formant analysis, typically 2 + (sampleRate / 1000)
  // For 48kHz looking at formants up to 5500Hz, we downsample to 11kHz first
  const targetSR = 11000;
  const downsampled = downsample(windowed, sampleRate, targetSR);
  const lpcOrder = 10; // ~2 per formant up to 5500Hz

  const { coefficients } = burgLPC(downsampled, lpcOrder);

  // Find roots of the LPC polynomial
  const roots = findPolynomialRoots(coefficients);

  // Convert roots to frequencies and bandwidths
  const formants = [];
  for (const root of roots) {
    if (root.imag <= 0) continue; // Only positive frequencies

    const freq = Math.atan2(root.imag, root.real) * targetSR / (2 * Math.PI);
    const bw = -Math.log(Math.sqrt(root.real ** 2 + root.imag ** 2)) * targetSR / Math.PI;

    // Filter: valid formants are 50-5500 Hz with bandwidth < 500 Hz
    if (freq > 50 && freq < 5500 && bw < 500) {
      formants.push({ freq, bw });
    }
  }

  // Sort by frequency and assign F1, F2, F3
  formants.sort((a, b) => a.freq - b.freq);

  return {
    f1: formants[0]?.freq || null,
    f2: formants[1]?.freq || null,
    f3: formants[2]?.freq || null,
  };
}
```

**Critical implementation notes:**

- **Downsampling before LPC**: We downsample from 48kHz to ~11kHz before running Burg. This is essential — running LPC at 48kHz would require a huge order (100+) and most of the frequency range is irrelevant for formant tracking. Downsampling to 11kHz (Nyquist = 5500 Hz, matching Praat's `maximum_formant=5500`) lets us use order 10, which is fast and stable. This is exactly what Praat does internally.
- **Polynomial root finding**: This is the tricky part. We need a robust complex root finder for a degree-10 polynomial. The Durand-Kerner or Aberth method works well. Alternatively, we can use a companion matrix eigenvalue decomposition. There are JS implementations available.
- **Accuracy vs. Praat**: The Burg algorithm is the same one Praat uses, so in principle the results should be very close. The main accuracy risk is in the root-finding step and the pre-processing (windowing, pre-emphasis, downsampling filter quality). We should validate against Praat using test recordings.

### Spectral Tilt: FFT Band Energy Ratio

```javascript
function computeSpectralTilt(buffer, sampleRate) {
  // Use Web Audio-compatible FFT or manual implementation
  const fftSize = 2048;
  const fft = performFFT(buffer.slice(-fftSize), fftSize);

  // Compute energy in low band (0-1kHz) and high band (1-4kHz)
  const binHz = sampleRate / fftSize;
  let lowEnergy = 0, highEnergy = 0;

  for (let i = 0; i < fftSize / 2; i++) {
    const freq = i * binHz;
    const magnitude = fft[i];
    const energy = magnitude * magnitude;

    if (freq < 1000) lowEnergy += energy;
    else if (freq < 4000) highEnergy += energy;
  }

  if (highEnergy === 0) return null;
  return 10 * Math.log10(lowEnergy / highEnergy); // dB ratio
}
```

### HNR: Harmonics-to-Noise Ratio

```javascript
function computeHNR(buffer, sampleRate) {
  // Autocorrelation-based HNR
  // Find the peak in the autocorrelation (at the pitch period)
  // HNR = 10 * log10(peak / (1 - peak))

  const halfLen = Math.floor(buffer.length / 2);
  const autocorr = new Float64Array(halfLen);
  let r0 = 0;

  for (let i = 0; i < buffer.length; i++) r0 += buffer[i] * buffer[i];

  for (let lag = 0; lag < halfLen; lag++) {
    let sum = 0;
    for (let i = 0; i < buffer.length - lag; i++) {
      sum += buffer[i] * buffer[i + lag];
    }
    autocorr[lag] = sum / r0;
  }

  // Find max autocorrelation in the pitch range (75-600 Hz)
  const minLag = Math.floor(sampleRate / 600);
  const maxLag = Math.floor(sampleRate / 75);
  let maxVal = 0;
  for (let lag = minLag; lag < Math.min(maxLag, halfLen); lag++) {
    if (autocorr[lag] > maxVal) maxVal = autocorr[lag];
  }

  if (maxVal <= 0 || maxVal >= 1) return null;
  return 10 * Math.log10(maxVal / (1 - maxVal));
}
```

### Result Smoothing

Smoothing runs on the main thread before updating React state:

```javascript
class ResultSmoother {
  constructor() {
    this.f0History = [];   // maxLen: 3
    this.f1History = [];   // maxLen: 5
    this.f2History = [];   // maxLen: 5
    this.f3History = [];   // maxLen: 5
    this.silenceThreshold = 45; // dB
  }

  process(raw) {
    // Silence gate
    if (!raw.intensity || raw.intensity < this.silenceThreshold) {
      return { voiced: false };
    }
    if (!raw.formants.f1 || !raw.formants.f2) {
      return { voiced: false };
    }

    // Rolling median for formants (robust to outliers)
    this.f1History.push(raw.formants.f1);
    this.f2History.push(raw.formants.f2);
    if (raw.formants.f3) this.f3History.push(raw.formants.f3);
    if (raw.pitch) this.f0History.push(raw.pitch);

    // Keep histories bounded
    if (this.f1History.length > 5) this.f1History.shift();
    if (this.f2History.length > 5) this.f2History.shift();
    if (this.f3History.length > 5) this.f3History.shift();
    if (this.f0History.length > 3) this.f0History.shift();

    return {
      voiced: true,
      f0: median(this.f0History),
      f1: median(this.f1History),
      f2: median(this.f2History),
      f3: this.f3History.length ? median(this.f3History) : null,
      spectralTilt: raw.spectralTilt,
      hnr: raw.hnr,
      intensity: raw.intensity,
    };
  }
}

function median(arr) {
  const sorted = [...arr].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}
```

---

## Visualization Design

### View 1: Resonance — F1/F2 Vowel Space Plot

The primary resonance training view. Shows a 2D plot following standard phonetics convention:

- **X-axis**: F2 (high on left, low on right — reversed, per convention)
- **Y-axis**: F1 (low on top, high on bottom — inverted, per convention)
- **Current position**: A glowing dot that moves as you speak
- **Trail**: The last ~2 seconds of positions shown as a fading trail
- **Target zones**: Semi-transparent shaded regions for typical female formant ranges per vowel
- **Reference zones** (optional toggle): Typical male ranges for comparison

**Approximate target ranges (Hz) for cisgender female voices:**

| Vowel | F1 Range | F2 Range |
|-------|----------|----------|
| /i/ (as in "see") | 270–400 | 2300–2800 |
| /a/ (as in "father") | 700–1000 | 1200–1600 |
| /u/ (as in "boot") | 270–400 | 700–1100 |
| /e/ (as in "say") | 400–600 | 2000–2500 |
| /o/ (as in "go") | 400–600 | 800–1200 |

These are population averages and should be configurable per user.

### View 2: Pitch — Real-Time F0 Display

- **Scrolling pitch trace**: F0 over time, scrolling left to right, Y-axis spanning configured range
- **Target band**: Shaded horizontal region for the user's target pitch range
- **Instantaneous readout**: Current pitch in Hz + nearest musical note (e.g., "196 Hz — G3")
- **Color coding**: Green in target, yellow close, red far off
- **Pitch histogram** sidebar: Distribution of pitch values for the current session
- **Pitch statistics**: Running min, max, mean, standard deviation

### View 3: Combined Dashboard (Default View)

The default practice mode — everything at a glance:

- **Top**: Compact resonance plot + compact pitch trace side by side (stacked on mobile)
- **Middle**: Key live stats — current F0, F2, spectral tilt, HNR
- **Bottom**: Session controls (start/stop, timer, notes) + quick metrics (time in target, session duration)

On **mobile** this becomes a vertically scrolling layout:
1. Pitch trace (most glanceable metric, gets top billing on small screens)
2. Key stats row
3. Resonance plot
4. Session controls

### View 4: Intonation Contour (v0.3)

- **Target contour**: A curve showing expected pitch pattern for a phrase
- **User contour**: Overlaid in real time as they speak
- **Match score**: How closely the contours align

### Silence Handling (All Views)

When silence is detected:

- Vowel space dot freezes and fades to lower opacity
- Pitch trace shows a gap (not a drop to zero)
- "Listening..." indicator appears
- Stats hold their last voiced values

---

## Training Modules Design (v0.3)

### Module Architecture

Each exercise is defined as a JSON object:

```json
{
  "id": "pitch-hold-a3",
  "name": "Pitch Hold — A3 (220 Hz)",
  "category": "pitch",
  "description": "Sustain a comfortable note at A3 (220 Hz) for 10 seconds.",
  "targetMetrics": {
    "f0": { "target": 220, "tolerance": 15 }
  },
  "duration": 10,
  "instructions": [
    "Take a breath and relax your throat.",
    "Say 'ahh' at a comfortable pitch near A3 (220 Hz).",
    "Try to hold it steady for the full duration."
  ],
  "scoring": {
    "timeInTarget": { "weight": 0.7 },
    "stability": { "weight": 0.3 }
  }
}
```

Exercises are bundled as static JSON in the app — no backend needed.

### Exercise Categories

**Pitch exercises**: pitch hold, pitch glide, pitch range exploration, sentence reading in target range, pitch agility (alternating notes)

**Resonance exercises**: vowel targeting, big dog / small dog, resonance hold during reading, vowel space mapping

**Intonation exercises**: contour matching, rising terminal practice, expressiveness drills

**Vocal weight exercises**: lighten while holding pitch, darken while holding pitch, weight isolation drills

### Exercise UI

The `ExerciseRunner` component:
1. Shows instructions and countdown
2. Displays the appropriate visualization with targets highlighted
3. Scores in real-time (progress bar, color feedback)
4. Shows a results summary on completion (score, breakdown, comparison to previous attempts)

---

## Data Model (IndexedDB via Dexie)

```javascript
// db.js
import Dexie from "dexie";

const db = new Dexie("syrinx");

db.version(1).stores({
  // User settings (single row for now; multi-profile in future)
  settings: "id",
  // settings row: {
  //   id: "default",
  //   displayName, goalPreset,
  //   targetF0Low, targetF0High,
  //   targetF1Low, targetF1High,
  //   targetF2Low, targetF2High,
  //   targetSpectralTiltMax,
  //   createdAt, updatedAt
  // }

  // Baselines
  baselines: "++id, capturedAt",
  // baseline row: {
  //   id (auto), label, capturedAt,
  //   avgF0, avgF1, avgF2, avgF3,
  //   avgSpectralTilt, avgHnr,
  //   pitchRangeLow, pitchRangeHigh,
  //   audioBlob (Blob — stored directly in IDB)
  // }

  // Sessions
  sessions: "++id, startedAt, sessionType",
  // session row: {
  //   id (auto), startedAt, endedAt, durationSeconds,
  //   sessionType, audioBlob (optional),
  //   avgF0, avgF1, avgF2, avgF3,
  //   medianF0, medianF2,
  //   avgSpectralTilt, avgHnr,
  //   pctTimeInPitchTarget, pctTimeInResonanceTarget,
  //   pitchRangeLow, pitchRangeHigh, pitchStdev,
  //   notes
  // }

  // Per-frame metrics (the raw time series)
  frames: "++id, sessionId, timestampMs",
  // frame row: {
  //   id (auto), sessionId, timestampMs,
  //   voiced, f0, f1, f2, f3,
  //   intensity, spectralTilt, hnr
  // }

  // Exercise results
  exerciseResults: "++id, sessionId, exerciseId, startedAt",
  // exerciseResult row: {
  //   id (auto), sessionId, exerciseId,
  //   startedAt, completedAt,
  //   score, metrics (object), notes
  // }
});

export default db;
```

### Storage Considerations

- **IndexedDB limits**: Browsers typically allow at least 50MB without prompting, and up to 10-20% of disk on mobile. At ~3MB of frame data per 30-min session (no audio), users can store hundreds of sessions before hitting limits.
- **Audio storage**: Saving raw audio as Blobs in IDB is possible but expensive (~165MB per 30-min session). Default to *not* saving audio; offer it as an opt-in toggle with a warning about storage impact. Consider recording as Opus (via MediaRecorder) instead of PCM to cut this to ~5-10MB per 30 minutes.
- **Data export**: Provide JSON export/import of all data (excluding audio blobs, which export as separate files) for backup and device migration.

---

## PWA Configuration

### manifest.json

```json
{
  "name": "Syrinx — Voice Training Toolkit",
  "short_name": "Syrinx",
  "description": "Free voice training with real-time resonance, pitch, and vocal weight feedback.",
  "start_url": "/syrinx/",
  "display": "standalone",
  "background_color": "#0f0f0f",
  "theme_color": "#7c3aed",
  "orientation": "any",
  "icons": [
    { "src": "icons/icon-192.png", "sizes": "192x192", "type": "image/png" },
    { "src": "icons/icon-512.png", "sizes": "512x512", "type": "image/png" },
    { "src": "icons/icon-maskable-512.png", "sizes": "512x512", "type": "image/png", "purpose": "maskable" }
  ]
}
```

### Service Worker Strategy

- **App shell**: Cache all static assets (HTML, JS, CSS, exercise JSON) on first load. The app works fully offline after one visit.
- **No network requests ever**: Since there's no backend, the service worker just manages the static cache. No API caching logic needed.
- **Update flow**: When a new version is deployed to GitHub Pages, the service worker detects the change and prompts the user to refresh.

---

## Project Structure

```
syrinx/
├── index.html
├── vite.config.js
├── package.json
├── public/
│   ├── manifest.json
│   ├── sw.js                           # Service worker
│   ├── icons/                          # PWA icons
│   └── exercises/                      # Exercise definition JSON files
│       ├── pitch.json
│       ├── resonance.json
│       ├── intonation.json
│       └── vocal-weight.json
├── src/
│   ├── main.jsx                        # Entry point
│   ├── App.jsx                         # Router + layout
│   ├── db.js                           # Dexie IndexedDB setup
│   │
│   ├── audio/
│   │   ├── capture-processor.js        # AudioWorklet (audio thread)
│   │   └── useAudioPipeline.js         # Hook: mic → worklet → worker → state
│   │
│   ├── dsp/
│   │   ├── dsp-worker.js              # Web Worker entry point
│   │   ├── pitch.js                    # YIN autocorrelation pitch detection
│   │   ├── formants.js                 # Burg LPC + root finding
│   │   ├── spectral.js                # Spectral tilt, HNR
│   │   ├── util.js                     # FFT, windowing, downsampling
│   │   └── smoother.js                # Result smoothing + silence gating
│   │
│   ├── components/
│   │   ├── dashboard/
│   │   │   ├── CombinedDashboard.jsx   # Default combined view
│   │   │   ├── LiveStats.jsx           # Real-time stats readout
│   │   │   └── SessionControls.jsx     # Start/stop, timer, notes
│   │   ├── resonance/
│   │   │   └── VowelSpacePlot.jsx      # F1/F2 canvas renderer
│   │   ├── pitch/
│   │   │   ├── PitchTrace.jsx          # Scrolling F0 trace
│   │   │   ├── PitchReadout.jsx        # Hz + musical note display
│   │   │   └── PitchHistogram.jsx      # Distribution sidebar
│   │   ├── training/
│   │   │   ├── ExerciseRunner.jsx      # Generic exercise execution
│   │   │   ├── ExerciseList.jsx        # Browse/select exercises
│   │   │   └── ScoreDisplay.jsx        # Scoring UI
│   │   ├── history/
│   │   │   ├── SessionHistory.jsx      # Past sessions list
│   │   │   ├── ProgressCharts.jsx      # Long-term trends
│   │   │   └── BaselineCompare.jsx     # Current vs. baseline
│   │   ├── settings/
│   │   │   ├── GoalConfig.jsx          # Target range configuration
│   │   │   └── DataManagement.jsx      # Export/import/clear data
│   │   └── common/
│   │       ├── MicPermission.jsx       # Mic access prompt UX
│   │       └── InstallPrompt.jsx       # PWA install suggestion
│   │
│   ├── utils/
│   │   ├── constants.js                # Target ranges, colors, config
│   │   ├── pitchUtils.js              # Hz→note mapping
│   │   └── scoringUtils.js            # Exercise scoring logic
│   │
│   └── styles/
│       └── index.css                   # Tailwind + custom styles
│
├── tests/
│   ├── dsp/
│   │   ├── pitch.test.js              # Pitch detection accuracy tests
│   │   ├── formants.test.js           # LPC formant extraction tests
│   │   └── spectral.test.js           # Spectral tilt tests
│   └── fixtures/
│       └── test-audio/                 # WAV samples with known formant values
│
└── .github/
    └── workflows/
        └── deploy.yml                  # GitHub Actions: build + deploy to gh-pages
```

### GitHub Actions Deployment

```yaml
# .github/workflows/deploy.yml
name: Deploy to GitHub Pages

on:
  push:
    branches: [main]

jobs:
  deploy:
    runs-on: ubuntu-latest
    permissions:
      pages: write
      id-token: write
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 20
      - run: npm ci
      - run: npm run build
      - uses: actions/upload-pages-artifact@v3
        with:
          path: dist
      - uses: actions/deploy-pages@v4
```

Push to `main` → GitHub Actions builds → deploys to Pages. That's it.

---

## Implementation Plan (Claude Code Sessions)

### Session 1: Audio Pipeline + Pitch Detection

**Goal**: Mic → AudioWorklet → DSP Worker → pitch values displayed on screen.

- Initialize Vite + React project with Tailwind
- Implement the AudioWorklet capture processor
- Implement the DSP Web Worker with YIN pitch detection
- Build `useAudioPipeline` hook: connects mic → worklet → worker → React state
- Display raw pitch values as text + a simple Hz readout with note name
- Test on both desktop and mobile browsers
- **Success criteria**: You speak and see accurate, real-time pitch values with musical note names. Silence is properly detected.

### Session 2: Pitch Visualization

**Goal**: Replace raw numbers with the pitch training view.

- Build `PitchTrace` scrolling canvas component with target band and color coding
- Build `PitchReadout` with large Hz + note display
- Build `PitchHistogram` sidebar
- Implement pitch target configuration (UI to set your target range)
- **Success criteria**: A polished, usable pitch training view that updates in real time with clear visual feedback on whether you're in target.

### Session 3: Formant Extraction + Resonance View

**Goal**: Add LPC formant analysis and the vowel space plot.

- Implement Burg LPC in the DSP Worker (downsampling, LPC, root finding)
- Validate formant accuracy against known test recordings
- Build `VowelSpacePlot` canvas component with target zones, moving dot, trail
- Add silence gating for the resonance display
- **Success criteria**: The vowel space plot accurately tracks your resonance position. Saying "ee" puts the dot in the /i/ zone, saying "ah" puts it in the /a/ zone.

### Session 4: Spectral Tilt + Combined Dashboard

**Goal**: Add vocal weight tracking and build the main practice view.

- Implement spectral tilt and HNR in the DSP Worker
- Build the `CombinedDashboard` layout (responsive: side-by-side on desktop, stacked on mobile)
- Build `LiveStats` readout showing all metrics
- Build `SessionControls` (start/stop/timer)
- **Success criteria**: The combined dashboard shows pitch, resonance, and vocal weight all updating in real time, with a clean responsive layout.

### Session 5: Session Persistence + History

**Goal**: Save sessions and review them later.

- Set up Dexie IndexedDB schema
- Implement session recording: capture per-frame metrics to IDB during recording
- Compute and store session summary stats on session end
- Build `SessionHistory` list view with summary cards
- Optional: save audio via MediaRecorder (Opus) with storage size warning
- **Success criteria**: You can record a practice session, see it in your history, and view its summary stats.

### Session 6: Progress Charts + Baselines

**Goal**: Track improvement over time.

- Implement baseline capture flow
- Build `ProgressCharts` with Recharts (pitch trend, resonance trend, time-in-target trend)
- Build `BaselineCompare` (current vs. baseline)
- Implement goal presets + custom target configuration
- Add data export/import (JSON)
- **Success criteria**: After several sessions, the progress charts show trends, and you can see improvement relative to your baseline.

### Session 7: PWA + Deploy

**Goal**: Make it installable and deploy to GitHub Pages.

- Add manifest.json and PWA icons
- Implement service worker for offline caching
- Add install prompt UI (suggest "Add to Home Screen")
- Set up GitHub Actions deployment workflow
- Write README with screenshots, feature list, and contributing guide
- **Success criteria**: The app is live at `alice-sabrina-ivy.github.io/syrinx`, installable on phones, works offline, and the README looks great.

### Session 8: Training Modules

**Goal**: Interactive exercises.

- Design exercise JSON schema and bundle starter exercises
- Build `ExerciseRunner`, `ExerciseList`, and `ScoreDisplay` components
- Implement pitch exercises (pitch hold, pitch glide, sentence reading)
- Implement resonance exercises (vowel targeting, big dog/small dog)
- Store exercise results in IDB, show scores in session history
- **Success criteria**: You can browse exercises, run them with real-time scoring, and see your scores in your history.

---

## Reference: Voice Feminization Metrics

| Metric | Typical Male Range | Typical Female Range | Training Goal | Importance |
|--------|-------------------|---------------------|---------------|------------|
| **F2 (resonance)** | Varies by vowel | **~10-20% higher** | **Raise via vocal tract shaping** | **Highest** |
| F1 | Varies by vowel | ~10-20% higher | Moderate shift | Moderate |
| F0 (pitch) | 85–180 Hz | 165–255 Hz | Raise habitual pitch | Moderate — necessary but not sufficient |
| Spectral tilt | More negative (heavier) | Less negative (lighter) | Lighten vocal weight | High — often undertrained |
| HNR | Higher (cleaner) | Similar or slightly lower | Maintain clarity | Low — mainly diagnostic |
| Pitch variability (σ) | Lower (flatter) | Higher (more expressive) | Increase intonation range | Moderate |

**Key insight**: Pitch gets all the attention, but resonance and vocal weight are what listeners primarily use to gender a voice. Syrinx treats voice feminization as the multi-dimensional problem it actually is.

---

## Open Questions / Decisions to Make During Implementation

1. **Polynomial root finding**: The LPC formant extraction needs a robust complex root finder for degree-10 polynomials. Options: Durand-Kerner iteration, companion matrix eigenvalues (needs a small linear algebra lib), or Laguerre's method. This should be benchmarked for accuracy and speed. Could also consider porting this specific piece to WASM for performance if JS is too slow.

2. **Formant accuracy validation**: Before shipping, formant extraction should be validated against Praat on a set of test recordings with known formant values. If accuracy is unacceptable, we may need to compile Praat/Parselmouth to WASM (this has been done in research contexts but is heavy — ~2MB payload).

3. **Mobile performance**: The DSP Worker needs to run at 20fps on mid-range phones. If the full analysis pipeline is too heavy, we can reduce the frame rate for formants (10fps) while keeping pitch at full rate, since pitch detection is much cheaper.

4. **Audio recording format**: MediaRecorder produces Opus in WebM or Ogg containers on most browsers. This is much smaller than PCM (~10x) but not seekable without decoding. Worth the tradeoff for mobile storage constraints.

5. **Browser compatibility**: AudioWorklet is supported in all modern browsers. The main risk is older iOS Safari versions. We should test on iOS 15+ and provide a fallback message for unsupported browsers.

6. **Accessibility**: The visualizations are inherently visual, but we should provide audio feedback options (tones that change with your pitch/resonance) and screen-reader-accessible stats readouts for visually impaired users.

7. **Privacy statement**: Even though the app is fully client-side, we should have a clear privacy page explaining that no data leaves the device, no analytics are collected, and the source code is open for verification.

8. **Transmasculine support**: Different target ranges, tracking pitch deepening over time on testosterone. Should be a v0.2 goal preset.

9. **Future: native apps**: If the PWA has limitations on certain platforms (iOS mic access in background, notification reminders), Capacitor can wrap the existing web app into native iOS/Android binaries with minimal changes.
