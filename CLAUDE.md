# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

Historical investigation narratives live in [INVESTIGATIONS.md](INVESTIGATIONS.md); raw tuning data lives in `measurements/`. Sections in this file get stale between cutover passes — **when any section here disagrees with the "Current state" table below, the table wins; fix the stale section when you notice it.** Mark superseded text `**Historical (superseded YYYY-MM-DD):**` rather than interleaving it with present-tense prose.

## Hard rules (load-bearing — DO NOT VIOLATE)

### 1. PR creation requires explicit user approval

Branches and commits are autonomous on this project; **opening a PR requires the user to explicitly say "open the PR" (or equivalent).** Applies to every PR, including small or seemingly-obvious ones. If a fix has been approved in conversation but the user hasn't explicitly said "open a PR for it," the work goes to a branch and STOPS for approval before any `gh pr create` invocation.

The pattern from PR #68 onward:

1. Investigation → measurement file in `measurements/` (autonomous).
2. Branch + commits with the proposed fix (autonomous).
3. Push the branch (autonomous).
4. **STOP. Ask the user to open the PR.** Surface the branch name and a one-paragraph summary of what's in it.
5. User says "open the PR" → run `gh pr create`.

User approval of the *content* of a fix during investigation/discussion is **not** approval to open the PR. The PR-creation action is a separate gate. If a deliverable description includes phrasing like "PR opened" or "deliverable surfaced," interpret that as "branch ready for review, STOP before `gh pr create`" — even if the prior conversation approved every individual change in it.

Added 2026-05-05 after PRs #70 and #71 were opened out of process (content greenlit in conversation, PR-opening action not).

### 2. Spawned-process cleanup

**Any harness that spawns a Chrome (or any other) process MUST kill ONLY the PID it spawned, never pattern-match on `chrome.exe` or any similar broad selector.** Alice runs Chrome as her primary browser across multiple monitors with active work; pattern-matched kills (`Get-Process chrome | Stop-Process -Force`, `taskkill /IM chrome.exe`, etc.) terminate her sessions and lose work. This is non-negotiable.

The pattern enforced by [scripts/desktop-diag-capture.js](scripts/desktop-diag-capture.js):

1. `spawn()` returns a child object with `child.pid` — capture and store this.
2. Always launch with `--user-data-dir=<unique-temp-dir-per-run>` so Chrome cannot merge into an already-running instance with the same profile (in which case our `--remote-debugging-port` flag would be silently ignored and our spawned PID wouldn't be the actual debug-target process).
3. At cleanup, run `taskkill /pid <PID> /T /F` — `/T` tree-kills descendants (renderer, GPU, network service), `/F` forces. **Never** `/IM chrome.exe`.
4. Register cleanup against `process.on("exit")`, `SIGINT`, `SIGTERM`, `uncaughtException` — an aborted harness still cleans up its children.
5. Remove the per-run profile dir after the kill.

New spawn-and-cleanup harnesses copy this pattern verbatim. Puppeteer's `browser.close()` is equivalent PID-scoped cleanup — fine. The only forbidden pattern is broad name-based matching.

### 3. Measurements before tuning changes

Any optimization or tuning work on `boersma-ac.js`, `pitch-worker.js`, `dsp-worker.js`, `gender-worker.js`, `pitchSmoothing.js`, `pitchGate.js`, or `cpp.js` produces a measurement file in `measurements/` *before* code changes are proposed — changes in these files are grounded in numbers, not intuition. See §"Measurements & empirical results" for conventions and oracles.

## Current state (update at every cutover; wins over stale text elsewhere)

| Component | Deployed | Since | Decision data |
|---|---|---|---|
| Pitch detection | Boersma-AC (Praat-style window-corrected autocorrelation + bounded-Viterbi path tracker), pure JS, [src/dsp/boersma-ac.js](src/dsp/boersma-ac.js) in [src/dsp/pitch-worker.js](src/dsp/pitch-worker.js). 0.21 ms/frame, no model fetch. | 2026-06-09 (replaced SwiftF0 ONNX) | [boersma-ac-tuning-2026-06-09.md](measurements/boersma-ac-tuning-2026-06-09.md), [swift-f0-vs-praat-sessions-2026-06-09.md](measurements/swift-f0-vs-praat-sessions-2026-06-09.md) |
| Pitch search + display range | 75–400 Hz, detector and `PITCH_DISPLAY_RANGE` matched exactly; trace rendering clipped to plot rect | 2026-06-10 (floor 60→75) | commit ceaa855; [pitch-excursion-break-2026-06-10.md](measurements/pitch-excursion-break-2026-06-10.md) |
| Pitch latency | L=2 decode delay → ~98 ms worker-level display latency; displayed-trace effective attribution ~150 ms incl. 5-frame median lag; band accuracy ~94 % (80–110 Hz) | 2026-06-09/10 | same files |
| Silence gate | AND-logic in [src/audio/pitchGate.js](src/audio/pitchGate.js): intensity < −50 dB AND confidence < 0.5, ≥3 consecutive frames | PR #74 semantics, module extracted later | PR #74 |
| Perceived gender | JaesungHuh ECAPA-TDNN q8 (`Alice-Sabrina-Ivy/voice-gender-classifier-onnx-q8`, ~15.4 M params, MIT), single model on all platforms | 2026-05-06 | [INVESTIGATIONS.md §gender](INVESTIGATIONS.md) |
| Vocal weight | CPP ([src/dsp/cpp.js](src/dsp/cpp.js)), sliding ~30 s auto-calibration, no persistence | 2026-05-12; accuracy pass PR #86 | [vocal-weight-stage-c-implementation-2026-05-12.md](measurements/vocal-weight-stage-c-implementation-2026-05-12.md) |
| Audio capture | MSTP production default where supported (Chrome desktop/Android, Safari ≥26); AudioContext+AudioWorklet fallback (Firefox) | 2026-05-05 (Stage 3) | [capture-path-routing-2026-05-05.md](measurements/capture-path-routing-2026-05-05.md) |
| Hosting | **GitHub** (`origin` = github.com/alice-sabrina-ivy/Syrinx). PRs/issues via `gh`. The Forgejo instance in the user-level notes is other projects — not used here. | — | — |

## Project Overview

Syrinx is a browser-based voice training toolkit providing real-time resonance, pitch, and vocal weight analysis. It runs entirely client-side with no backend — all audio processing happens in the browser. Currently targets voice feminization training.

Live demo: https://alice-sabrina-ivy.github.io/Syrinx/

## Commands

- **Dev server:** `npm run dev` (HTTP localhost only)
- **Dev server (LAN-accessible HTTPS, for phone testing):** `npm run dev:mobile` — see "Mobile testing" below
- **Production build:** `npm run build` (outputs to `docs/`)
- **Lint:** `npm run lint`
- **Preview production build:** `npm run preview`
- **Core DSP regression bundle:** `npm run test:dsp`

No test framework is set up. Test files are runnable Node scripts that print pass/fail and exit non-zero on failure.

### Regression checklist — run the relevant set before proposing changes

- **Pitch detector** (`boersma-ac.js`, `pitch-worker.js`): `node tests/dsp/boersma-ac-test.js` (frame-level guard incl. the weak-H1 case that motivated the cutover). Corpus-level accuracy claims need the shootout harnesses (`scripts/pitch-shootout-extract.js` + `scripts/pitch-shootout-analyze.py`); parameter sweeps use `scripts/ac-tuning-sweep.js`; displayed-accuracy attribution uses `scripts/pitch-accuracy-decompose.js`.
- **Silence gate / trace painting**: `node tests/audio/pitch-gate-test.js`, `node tests/audio/pitch-paint-gate-test.js`
- **Pitch smoothing**: `node tests/audio/pitch-smoothing-test.js`, `node tests/audio/pitch-smoothing-octave-shift-harness.js`
- **Formants** (`dsp-worker.js` LPC): `node tests/dsp/formant-accuracy-test.js` (Hillenbrand real recordings vs professional measurements), `node tests/dsp/formant-debug.js` (synthetic regression guard)
- **CPP / vocal weight**: `node tests/dsp/cpp-test.js`, `node tests/audio/vocal-weight-aggregator-test.js`, `node tests/audio/vocal-weight-baseline-test.js`
- **ML / gender**: `node tests/ml/audio-utils-test.js`, `node tests/ml/perceived-voice-hillenbrand-test.js` (accepts `--model=<HF_id>`)
- **Everything**: `npm run lint` and `npm run build` before any ship claim.

### Mobile testing

`npm run dev:mobile` runs Vite with `--mode mobile --host`, which binds to all network interfaces and enables a self-signed HTTPS cert via `@vitejs/plugin-basic-ssl` (gated to `mode === 'mobile'` in [vite.config.js](vite.config.js) so default `npm run dev` is unchanged). HTTPS is required because mic capture (`getUserMedia`) refuses non-localhost origins over HTTP.

Vite prints both URLs at startup, e.g.:
```
  ➜  Local:   https://localhost:5173/Syrinx/
  ➜  Network: https://10.0.0.41:5173/Syrinx/
```

**Phone workflow** (same Wi-Fi as the PC):
1. Open the Network URL on the phone.
2. Click through the self-signed cert warning (Chrome on Android: "Advanced" → "Proceed to <ip> (unsafe)"; Safari iOS similar). Expected; the cert is generated on the fly.
3. Grant mic permission when the page asks.

**If the phone can't reach the LAN URL**, Windows Firewall is almost certainly blocking inbound port 5173 — Vite binds and prints the URL but the firewall silently drops packets. Allow it once (admin PowerShell):
```powershell
New-NetFirewallRule -DisplayName "Vite dev (5173)" -Direction Inbound -LocalPort 5173 -Protocol TCP -Action Allow -Profile Private
```
`-Profile Private` confines the rule to home/private Wi-Fi. Revoke later with `Remove-NetFirewallRule -DisplayName "Vite dev (5173)"`.

### Diagnostic mode

Append `?diag=1` to the URL to surface a fixed top-right diagnostic overlay. Without the flag the app is byte-identical to production: the overlay component is `lazy`-loaded so its chunk isn't fetched, and hot-path instrumentation (extra timing fields, RMS, per-pitch-eval timings) is gated behind a `_diag` flag in each worker — off by default.

The overlay surfaces:

- **Per-frame timings** (current value + p95 + drift, over the ~30 s ring window):
  - `audio→worker` — capture → DSP worker arrival. **Drift on this row is the load-bearing signal for mobile audio-clock skew / capture-buffer accumulation** — green = stable, amber = ≥0.2 ms/s, red = ≥1 ms/s. This instrumentation diagnosed +11.5 ms/s drift on Pixel-class Android Chrome at 48 kHz; the `latency: { ideal: 0.01, max: 0.05 }` getUserMedia hint in `useAudioPipeline.js` is the first-line fix.
  - `worker total` — formants/tilt/HNR (every 6th frame). Pitch timings live in the `pitchInferences` ring in the snapshot.
  - `worker→main` — DSP `postMessage` → main `onmessage` entry.
  - `main handler` — `handleAnalysisResult` duration.
  - `end-to-end` — audio captured (AudioContext time → epoch via `ctxCreatedAtEpochMs`) to display update.
- **Last-5-seconds sparkline**: pitch (amber, 60–400 Hz scale), `confidence` (the pitch worker's voicing confidence — Boersma-AC since 2026-06-09, same field name as the SwiftF0 era, cyan), `inputRms ×4` (orange).
- **Audio context introspection** captured once at start: `sampleRate` (amber if < 44.1 kHz — mobile silent downsampling), `baseLatency`, `outputLatency`, capture-path confirmation, requested-vs-granted `getUserMedia` constraints (mobile browsers may silently override).
- **Lifecycle**: pointer-event tap age, `document.visibilityState`, frames-while-hidden tally.
- **Snapshot last 5s ↓**: downloads a JSON file with the full ring buffer + audio info + user agent + tap timestamps. The snapshot includes `inputRms` and `confidence` per frame plus the `pitchInferences` ring, so a failure mode (e.g. "confidence saturates while inputRms is at noise floor") is reconstructable later — stash JSON + a repro `.md` in `measurements/`.

The overlay refreshes at 10 Hz from the diag ring buffer (updated at the worker's ~40 fps analysis cadence); reading it is O(1) and does not observe the audio pipeline directly.

**Measurement-only URL flags:** `?capture=mstp|audiocontext`, `?chunk=N` (5–50 ms), `?latexact=N`, `?lat=N|interactive|balanced|playback`, `?nolatconstraint=1`, `?sr=N`. Full list in [src/diag/diag.js](src/diag/diag.js).

### Mobile audio platform floor (Pixel 8 Pro / Chrome 147, characterized 2026-05-05)

Characterized on the **AudioContext capture path** — the fallback path since MSTP shipped as production default (Stage 3, 2026-05-05). Still the reference for Firefox and any AudioContext-fallback latency questions. Sweep data: [measurements/mobile-latency-sweep-2026-05-05.md](measurements/mobile-latency-sweep-2026-05-05.md).

**chunkArrival on the AudioContext path bottoms out ~100–120 ms** at production config. Decomposed: hardware mic buffer 40 ms (granted `latency: 0.04`, immutable on this device) + AudioWorklet chunk aggregation 25 ms + output-buffer offset 20 ms + handoff ~5 ms ≈ 90 ms theoretical, ~110 ms measured (~20 ms unexplained AudioContext-internal overhead).

**Levers tested and ruled out** (don't redo): `channelCount: 1` (already granted); smaller `chunkSize` (moves first-sample latency only, not the steady-state median); `latency: { exact: 0.01 }` (OverconstrainedError; platform grants 0.04 regardless); 16 kHz sample rate (worse — Android allocates buffers in samples, not time).

**MSTP** delivers frames at the 40 ms hardware-buffer cadence with ~zero drift and no AudioContext overhead — ~50 ms floor vs ~110 ms. This motivated the Stage 3 capture-routing ship (see §Capture architecture).

### Mobile diag capture harness

[scripts/mobile-diag-capture.js](scripts/mobile-diag-capture.js) drives Chrome on a USB-attached Android phone via ADB + Chrome DevTools Protocol, runs a configurable capture window, pulls the snapshot JSON out of the page, prints a summary, and saves to `measurements/mobile-diag-runs/<ISO-timestamp>.json`.

**One-time setup:**

1. Install Android Platform Tools so `adb` is on `PATH` (`winget install Google.PlatformTools` or the standalone bundle). Confirmed working with `adb 34.0.5` at `C:\adb\adb.exe`.
2. On the phone: enable Developer options and USB debugging.
3. USB mode must allow data ("File transfer"); "Charging only" leaves ADB with no device.
4. First run: accept the phone's RSA-key trust prompt ("Always allow from this computer").
5. First page load: accept the self-signed cert warning; remembered afterward.

**Run:** `node scripts/mobile-diag-capture.js [--duration=30] [--url=https://10.0.0.41:5173/Syrinx/?diag=1]`

The harness verifies exactly one authorized device, navigates Chrome via `am start` intent, forwards CDP over `adb forward`, attaches Puppeteer, clicks Get Started / Start Listening as needed (bails after 8 s if no frames arrive), heartbeats during capture, and saves + summarizes the snapshot (duration, frames, audio context, `chunkArrivalMs`/`totalMs` distributions, drift slopes, split-half phase-change detector).

**Audio source for deterministic captures:** play a known reference signal (sustained vowel WAV) from PC speakers into the phone's mic. **Phone state between runs:** USB plugged, screen unlocked, Chrome running — the harness reuses the tab. **Enable "Stay awake while charging"** in Developer options; otherwise Android dozes and suspends AudioWorklet processing mid-capture (the harness sets `svc power stayon usb` as mitigation, but the toggle is the durable fix).

**Failure modes detected with recovery hints:** no/unauthorized/multiple devices; Chrome not installed; CDP doesn't come up; no matching tab (cert warning showing); no frames within 8 s (mic permission, AudioWorklet error — surfaces `status.errors`). If the hint says "tap something on the device", do that and re-run; anything else, capture the error and investigate.

### Desktop diag capture harness

Desktop analogue — saves to `measurements/desktop-diag-runs/<kind>-<ISO-timestamp>.json`. Two harnesses:

#### Isolated spawn (autonomous, synthetic-injection only)

[scripts/desktop-diag-capture.js](scripts/desktop-diag-capture.js) spawns a fresh Chrome with `--user-data-dir=<temp>`, captures in that isolated profile, tree-kills only the spawned PID on exit (see Hard rule 2). No user setup.

```
node scripts/desktop-diag-capture.js [--kind=mstp|audiocontext] [--duration=120] [--url=...] [--voice-file=PATH] [--play-wav=PATH]
```

**`--voice-file=PATH`** uses Chrome's `--use-file-for-fake-audio-capture` to replace the mic wholesale with the WAV's bytes. Bit-exact reproducibility — the recommended mode for this harness.

**`--play-wav=PATH`** attempts speaker-loopback through the spawned Chrome's default mic. **Does not work in Alice's environment** — the isolated profile selects a non-physical or muted device: `inputRms=0` on all frames regardless of speaker output. **`--no-fake-device=true` is unusable for the same reason** (confirmed empirically 2026-05-06: 5 s ambient probe, 213 frames, all `inputRms = 0.000000`). Both real-audio probes produce digital silence on the isolated profile — the failure is at the fresh profile's device-selection layer. **Any test needing real-mic audio must use the attach harness.** The `--play-wav` code path is retained because it works on the attach harness. Flags are mutually exclusive; `--voice-file` wins.

#### Attach to existing Chrome (for tests that need real session state)

[scripts/desktop-diag-capture-attach.js](scripts/desktop-diag-capture-attach.js) connects via CDP to a Chrome the user launched with a debug port, opens the test page in a NEW WINDOW (so it doesn't hijack focus), captures against the real profile (real mic preference), then closes only its own window via `Target.closeTarget({targetId})` — other tabs/windows unreachable by construction.

Prerequisite — user launches Chrome with **both flags** (one-time, all Chrome windows closed first):

```powershell
& "C:\Program Files\Google\Chrome\Application\chrome.exe" --remote-debugging-port=9223 --user-data-dir="C:\temp\chrome-debug-profile"
```

Chrome 136+ silently rejects `--remote-debugging-port` against the default profile; without `--user-data-dir`, port 9223 never binds. Verify with `curl http://localhost:9223/json/version`. The flag also only takes effect on a fresh launch — a second invocation while Chrome runs gets absorbed into the existing instance.

**Window-close caveat:** if the debug Chrome has no other windows, Chrome exits when the harness closes its test window and port 9223 unbinds. Keep one extra `about:blank` tab open to keep Chrome alive across runs.

```
node scripts/desktop-diag-capture-attach.js [--kind=mstp|audiocontext] [--duration=120] [--url=...] [--port=9223] [--play-wav=PATH]
```

#### Focus / visibility emulation (load-bearing for both harnesses)

Both harnesses call `Emulation.setFocusEmulationEnabled({enabled:true})` and `Page.bringToFront` after attaching. Without this, a test window behind the user's foreground app reads `visibilityState === "hidden"`, React onClick throttling makes programmatic clicks appear to no-op, the pipeline never starts, and the snapshot shows `audio: null` / `frames: 0` / no errors (observed 2026-05-05). Diagnostic if a harness stalls with that signature: check the page-state probe for `vis: hidden`.

#### Why not spawn a debug-port-enabled Chrome sharing the user's profile?

Explored and ruled out 2026-05-05 — five `child_process` spawn variants (`detached`, `stdio`, `cmd /c start`, `Start-Process`, `windowsHide`) all single-instance-merged into the user's running Chrome, even though manually typing the same command in interactive PowerShell works. The isolated-spawn harness with `--voice-file` sidesteps it. **Future sessions: do not redo this exploration.**

### Capture architecture (Stage 2 onwards)

Audio capture goes through [src/audio/captureSource.js](src/audio/captureSource.js)'s `createCaptureSource()` factory:

- **`mstp`** (production default where the runtime supports main-thread `MediaStreamTrackProcessor` — Chrome desktop + Android, Safari ≥26): `getUserMedia` → MSTP on the main thread → `ReadableStream` of `AudioData` → `MessageChannel` → workers.
- **`audiocontext`** (fallback — Firefox in particular): `getUserMedia` → `MediaStreamAudioSourceNode` → `AudioWorkletNode` → `MessageChannel` → workers.

`pickKind()` returns `isMSTPSupported ? "mstp" : "audiocontext"` — feature detection on constructor presence, no UA gating. Decision basis: [measurements/capture-path-routing-2026-05-05.md](measurements/capture-path-routing-2026-05-05.md) (MSTP ~5× lower chunkArrival latency on desktop and mobile Chrome, no DSP-accuracy regression). `?capture=` URL flags remain as diag overrides.

**Worker-MSTP path is deferred.** Chrome 147 mobile doesn't expose MSTP in worker scope (verified empirically), so the spec-conformant Firefox/Safari worker pattern can't be tested there. **Firefox-mobile worker-MSTP is the next capture-architecture work item**; testable on the same Pixel under Firefox.

## Tech Stack

React 19 + Vite 7 + Tailwind CSS 4 (via `@tailwindcss/vite`). Dexie for IndexedDB persistence. Visualizations use HTML Canvas directly (not a charting library). Audio capture and DSP use native Web Audio API (AudioWorklet + Web Worker). ES modules throughout.

## Architecture

### Audio Pipeline (five layers, each on a separate thread)

1. **Capture** — MSTP main-thread reader or AudioWorklet (`public/capture-processor.js`) per §Capture architecture; collects mic samples into ~25 ms chunks and broadcasts each chunk to *all* registered consumer worker MessagePorts (DSP + ML + pitch). Pre-allocated buffers to avoid GC pauses; each consumer gets an independent copy because transferables detach.

2. **DSP Worker** ([src/dsp/dsp-worker.js](src/dsp/dsp-worker.js)) — ring buffer (~200 ms); computes formants / spectral tilt / HNR / intensity:
   - Formants: Burg LPC with polynomial root finding (downsampled to ~12 kHz, every 6th frame ~200 ms). Receives a `pitch-hint` message relayed from the main thread with the latest pitch-worker output; uses it for Praat-style pitch-adaptive LPC order (male: 10 / female: 12) and formant ceiling; falls back to female-default when no pitch known.
   - Spectral tilt: FFT low/high band energy ratio. HNR: autocorrelation. Intensity: RMS in dB.
   - Zero-GC pre-allocated hot path. Pitch detection does NOT live here (Stage 4 cutover, 2026-05-06); this worker is ~6 KB built.

3. **Pitch Worker** ([src/dsp/pitch-worker.js](src/dsp/pitch-worker.js)) — hosts the Boersma-AC detector ([src/dsp/boersma-ac.js](src/dsp/boersma-ac.js)): Praat-style window-corrected autocorrelation + bounded-Viterbi path tracker. Pure JS, 0.21 ms/frame, no model fetch. Resamples chunks to 16 kHz, keeps a rolling 1536-sample (96 ms) buffer, evaluates per 25 ms chunk; the L=2 path decode adds 50 ms (~98 ms worker-level display latency; L=4 scores ~0.3 pp better at ~148 ms — latency chosen deliberately). Detector config: search 75–400 Hz (matches `PITCH_DISPLAY_RANGE` exactly), voicingThreshold 0.40, octaveCost 0.01. Posts `{ pitch, confidence, voiced, ts, contextTime, inferMs? }` preserving the invariant **pitch ≠ null ⟺ confidence ≥ 0.5** that the silence gate relies on. The "ready" status posts `{ detector: "boersma-ac", device: "js", threshold }` so diag snapshots record the backend. Replaced SwiftF0 ONNX 2026-06-09 (which replaced pYIN 2026-05-06) — arcs in [INVESTIGATIONS.md](INVESTIGATIONS.md).

4. **ML Worker** ([src/ml/gender-worker.js](src/ml/gender-worker.js)) — Transformers.js audio-classification pipeline. Production model: `Alice-Sabrina-Ivy/voice-gender-classifier-onnx-q8` (JaesungHuh ECAPA-TDNN q8 export, ~15.4 M params, MIT). Resamples to 16 kHz ([src/ml/audio-utils.js](src/ml/audio-utils.js)), 0.75 s rolling window, inference every 150 ms design target, peak-VAD gates silent windows, EMA-smooths the score (α=0.2), resets after a sustained silent run. Posts `{ score: 0–100, confidence, ts, inferMs? }`. "ready" status includes `modelId` and `device` ("webgpu"/"wasm"). Pure helpers in audio-utils.js are unit-testable without booting the worker.

5. **Main thread** ([src/audio/useAudioPipeline.js](src/audio/useAudioPipeline.js)) — React hook managing AudioContext / DSP / pitch / ML worker lifecycle; merges pitch-worker output into each DSP frame via `latestPitchRef` (nearest-neighbor temporal alignment, both at 25 ms cadence so lag ≤ 1 chunk); smoothing (rolling median — 5-window for pitch via [src/audio/pitchSmoothing.js](src/audio/pitchSmoothing.js), formants median-smoothed with >500 Hz jump rejection); silence gating (5-second hold); history exposed via Refs for canvas rendering; setState throttled to ~5 fps for text readouts only.

   **Silence gate** ([src/audio/pitchGate.js](src/audio/pitchGate.js)): a frame is suppressed only when intensity < `SILENCE_THRESHOLD_DB` (−50 dB) AND pitch confidence < `CONFIDENCE_THRESHOLD` (0.5), for ≥ `SILENCE_DEBOUNCE_FRAMES` (3) consecutive frames. AND-logic is intentional (PR #74): both signals must agree on "noise"; either solo would over-suppress real speech. Pre-warmup frames (confidence null) fall back to intensity-only gating.

### Canvas Visualization Strategy

History arrays live in Refs (not React state), read directly by `requestAnimationFrame` loops. Avoids React re-renders. All canvases use ResizeObserver + devicePixelRatio scaling.

- **PitchTrace** — 15-second scrolling pitch waveform with target band. Plot range 75–400 Hz matches the detector search range exactly (2026-06-10: the floor was raised 60→75 rather than widening the display, after sub-75 Hz detections painted under the chart; corpus cost negligible). Rendering is clipped to the plot rect in both PitchTrace and SessionHistory (stored pre-change frames can hold sub-75 Hz F0). An established-level excursion break stops the line connecting across octave spikes ([measurements/pitch-excursion-break-2026-06-10.md](measurements/pitch-excursion-break-2026-06-10.md)).
- **ResonanceMeter** — vertical thermometer titled "Perceived voice" for the ML score (0–100), reading `genderTraceRef`. Warm→cool gradient fill; faint bands mark masculine 0–30 / feminine 70–100; glowing indicator tweens via exponential lerp with opacity scaled by confidence; right-side history strip of last ~10 inferences; big number readout with score-range subtitle. The middle uncertain range collapses with the classifier's low-confidence region because confidence is by construction `|score − 0.5| × 2`. Replaced ResonanceScoreTrace + ResonanceGauge; an earlier hand-crafted vowel-normalized formula (`src/utils/resonanceScore.js`) was replaced because raw-formant geometry doesn't reliably model perceived gender.
- **VocalWeightGauge** — horizontal bar driven by CPP ([src/dsp/cpp.js](src/dsp/cpp.js)). Zero interaction: sliding ring of the last ~30 s of voiced CPP-aggregate emits (120 samples at 250 ms cadence); "Calibrating: N%" during fill; then displays σ-distance of current voice from the recent window, recomputing μ/σ per emit. Per-session calibration, no persistence. Sample-rate-invariant (internal resample to 16 kHz; cross-rate spread < 0.03 dB; Praat correlation r=0.64 PTDB / r=0.71 FDA). Arc: [measurements/vocal-weight-stage-c-implementation-2026-05-12.md](measurements/vocal-weight-stage-c-implementation-2026-05-12.md).
- **CombinedDashboard** — main practice view composing the above + session recording logic.

### Data Persistence

[src/db.js](src/db.js) defines a Dexie (IndexedDB) schema: **settings** (preferences, target ranges), **sessions** (summary stats), **frames** (raw per-frame metrics), **exerciseResults** (stubbed). Schema is at v2; v2 is a `null`-drop of a short-lived `vocalWeightCalibration` table from the 2026-05-12 same-day revert (Dexie monotonic versioning requires the entry).

### UI Components

- **SessionHistory** ([src/components/SessionHistory.jsx](src/components/SessionHistory.jsx)) — past-sessions browser with expandable detail cards
- **DataManagement** ([src/components/DataManagement.jsx](src/components/DataManagement.jsx)) — settings panel: recording toggle, export/import, delete data

### Entry Points

`index.html` → `src/main.jsx` → `src/App.jsx` (three tabs: dashboard, pitch, history + welcome overlay + settings panel). Capture processor loaded dynamically from `public/`; workers spawned as module workers.

### Utilities

- [src/utils/constants.js](src/utils/constants.js) — target ranges, display ranges (`PITCH_DISPLAY_RANGE` 75–400, matched to the detector), time windows, colors
- [src/utils/pitchUtils.js](src/utils/pitchUtils.js) — Hz → musical note mapping

### Key Design Decisions

- Direct capture→Worker MessagePort communication, zero main-thread audio relay; capture broadcasts to a consumer-port list so DSP, pitch, and ML all receive raw audio.
- Pitch detection runs per 25 ms chunk at 0.21 ms/frame (pure JS — no ONNX runtime or model fetch on the pitch path since 2026-06-09). Confidence threshold 0.5 gates pitch reporting AND seeds the silence gate's voicedness arm by design (single threshold, no ambiguous middle band).
- LPC formant extraction throttled to every 6th frame (~200 ms); uses the main-thread-relayed `pitch-hint` for male-vs-female LPC order (one-frame lag acceptable — formants change slowly).
- ML gender inference: ~6.7 Hz design target over a rolling 0.75 s window. **Real-world ORT-WASM timing exceeds the 150 ms hop budget everywhere measured** (desktop ~190 ms, Pixel 8 Pro ~460 ms median); the `inferenceInProgress` guard drops overruns so the meter degrades to ~5 Hz desktop / ~2 Hz mobile rather than queuing. Peak-amplitude VAD (peak, not RMS, so speech-with-pauses windows pass). EMA α=0.2 (~750 ms time-constant; higher α produced smoothing-artifact misclassifications on borderline Hillenbrand samples). Smoothed score resets after ~2 s of silent inferences. `femaleScoreFromResult` parses by label name only (JaesungHuh id2label is `{0:male, 1:female}` — opposite of the prior model) and returns null on unrecognized labels, so a future model swap can't silently invert the meter.
- Resampling for workers is linear interpolation, not polyphase FIR — speech energy above 8 kHz is minimal and the browser already low-passes mic input.
- Rolling-median smoothing for outlier robustness; silence gating holds last voiced values 5 s, then resets; session frames buffered in memory, flushed to IndexedDB every 1 s; target ranges hardcoded in constants.js.
- **HF Hub `wav2vec2` tag on the gender model is wrong but load-bearing**: `config.json` at `Alice-Sabrina-Ivy/voice-gender-classifier-onnx-q8` deliberately sets `model_type: "wav2vec2"` (actual architecture: ECAPA-TDNN) because Transformers.js routes pipelines off `model_type` and `ecapa-tdnn` isn't a registered type. **Changing the field breaks production at `pipeline()` load time.** Leave it.

## Measurements & empirical results

Tuning sweeps, latency benchmarks, and other measurement artifacts live in `measurements/` at the repo root (NOT `docs/` — that's Vite build output, overwritten on deploy).

- **Naming:** `<topic>-<kind>-<YYYY-MM-DD>.{md,csv,txt}`
- **Belongs here:** baselines captured before tuning work, sweep results, latency/throughput measurements, before/after comparisons for any empirically-driven change.
- **Does NOT belong here:** ad-hoc debugging logs, test fixtures (stay in `tests/`), production code.

### Current oracles

- **Pitch:** `tests/dsp/boersma-ac-test.js` (frame-level, incl. the weak-H1 case), `scripts/pitch-shootout-extract.js` + `scripts/pitch-shootout-analyze.py` (corpus-level, fair per-detector attribution), `scripts/ac-tuning-sweep.js` (parameter sweeps), `scripts/pitch-accuracy-decompose.js` (displayed-accuracy attribution incl. smoothing lag). SwiftF0-era harnesses (`pitch-bucket-harness-swift.js`, `swift-f0-streaming-verify.js`, `swift-f0-threshold-sweep.js`, `swift-f0-adapter.js`) remain runnable for cross-detector comparisons; `swift-f0-streaming-verify.js` is still in `npm run test:dsp`.
- **Formants:** `tests/dsp/formant-accuracy-test.js` (Hillenbrand vs professional measurements), `tests/dsp/formant-debug.js` (synthetic guard).
- **CPP:** `tests/dsp/cpp-test.js` + the `cpp-*` probe scripts in `tests/dsp/`; Praat cross-checks via `scripts/praat-cpps-*.py`.
- **Gender:** `tests/ml/perceived-voice-hillenbrand-test.js` (`--model=<HF_id>` runs any candidate without touching the worker).

### Binding methodology rules

- **Multi-frame streaming evaluation is canonical for pitch.** Step 25 ms hops over each recording at production cadence, simulating the production rolling buffer. Single-window-per-file produces noise-dominated numbers (preserved only as historical context in session-1 files). Evaluation regime must match the stimulus's stationarity — the wrong helper regime once produced a 7× artifact (F p95 210 vs 28 Hz); see [INVESTIGATIONS.md](INVESTIGATIONS.md).
- **Score each detector at its own response center**, and note **PTDB-TUG reference timestamps are offset ~+20 ms** vs the loader's `i*hopMs` convention — pre-2026-06-09 PTDB numbers in the measurement history should be read with this in mind ([boersma-ac-tuning-2026-06-09.md](measurements/boersma-ac-tuning-2026-06-09.md)).
- **Production paths must be measured, not just harnesses.** Harnesses set config via `globalThis.__VAR` overrides; production doesn't. The fallback-when-unset path is part of the ship surface — at least one end-to-end run through the real production init sequence before any ship claim. (PR #68 shipped harness-only L=2 numbers while production silently ran L=5; the named-default-constant convention exists so this can't recur silently.)
- **Measure on the production runtime.** Node ORT is ~18× faster than browser ORT-WASM; mobile WASM another 2–4.5× slower than desktop depending on architecture. Ship decisions anchor on the gating-constraint hardware (browser, mobile).
- **Pitch accuracy targets are gender-symmetric.** The tool serves voice training in any direction — transmasculine, transfeminine, cis singers and speakers. Ship decisions optimize a gender-symmetric metric (e.g. `max(F_error, M_error)`), never female accuracy alone. Demographic assumptions don't go into ship-criterion math without explicit justification.
- **Real-speech corpora are the only signals that distinguish good from bad pitch settings.** Synthetic-stimulus suites are regression guards at best, insensitive for parameter selection (84-cell sweep, 2026-05-04). Synthetic fixtures also can't calibrate the silence gate — real speech has much lower voicedness than a clean fixture at the same RMS (PR #74).

### Methodology lessons index (full arcs in [INVESTIGATIONS.md](INVESTIGATIONS.md))

- **Field-benchmark first when an algorithm class is suspect** — the literature check (~2 h) that ruled out pYIN as a class came after ~2 days of within-pYIN sweeps.
- **Architecture-runtime interaction beats parameter count** — desktop:mobile WASM ratios: ECAPA-TDNN ~2.4×, wav2vec2-base ~4.5×, wav2vec2-large ~21×.
- **Don't assume the current ship works without measuring it** — production mobile gender inference ran at ~2100 ms for weeks unnoticed.
- **Don't transfer thresholds across decision contexts** — a threshold anchored for one decision fired spuriously when reused for another.
- **Batch and streaming inference attribute frames differently** — account for attribution latency in test criteria or streaming tests will surface false regressions.
- **Known borderline samples (Hillenbrand m45)** misclassify under every gender model/α tested — calibration noise floor, don't re-litigate.

## Known issues / future work

### MSTP runtime fallback to AudioContext

`pickKind()` is feature detection, not runtime validation — if a browser detects-as-supported but the MSTP path fails at runtime (constructor exists, `readable.getReader()` errors or first frame never arrives), the pipeline hard-fails: no fallback, and the 5 s first-frame timeout surfaces a misleading "microphone access denied". **Practical risk: low** (no wild reports; validated on Chrome desktop + Android 147). Candidate failure surfaces: future Chrome, Firefox-mobile when it gains main-thread MSTP, Safari (has MSTP, never validated here). **Approach when addressed:** try/catch around the MSTP first-frame await; on failure, close cleanly and re-attempt `_createAudioContextSource` on the same `MediaStream`; surface the fallback in the diag overlay. Origin: Codex review on PR #69.

### Pitch detection of periodic non-speech content (fan hum, mechanical rumble)

The silence gate treats periodic harmonic content above threshold as voiced — it can't distinguish "voice" from "tonal noise". Characterized 2026-05-06 under SwiftF0, but **applies by construction to Boersma-AC**: autocorrelation responds to any stationary periodic signal inside the 75–400 Hz search range (a 120 Hz fan hum qualifies; not re-measured under AC). It's a pre-existing limitation across pitch-detection algorithms, not a regression of any cutover. Addressing requires VAD / spectral noise-floor analysis / speech-vs-tonal discrimination — separate scoped work; none of the gate-level mechanisms are sufficient by construction. Workaround: quieter environment or pause detection.

### Pitch octave errors from harmonic-stack interference during voiced speech

Distinct from the above: active **during voiced speech**. A harmonic-rich tonal source near a multiple of the user's F0 (refrigerator compressor, HVAC resonance, mains 3rd harmonic at 180 Hz, fan whine) can pull the detector to the interferer's fundamental.

**Status caveat: characterized 2026-05-12 under SwiftF0** (the measured rates — ≥66 % sustained octave-up even at SNR +20 dB — are SwiftF0-CNN numbers). **Not re-validated under Boersma-AC.** The ruled-out-fix analysis suggests AC is also structurally susceptible at high interferer levels (the audio genuinely IS more periodic at the interferer's frequency — no frame-local algorithm can distinguish "voice + tonal interferer" from "interferer alone"), but re-run the reproducer (`tests/dsp/swift-f0-synthetic-stress.js` Test 7, `pitch-half-period-octave-fix` branch) against AC before citing numbers. Note this is NOT the weak-H1 octave-up failure on real voices — that one the 2026-06-09 cutover fixed.

**Mitigations:**
1. **User-side (recommended): find and remove the physical source.** `scripts/ambient-noise-probe/index.html` (serve via `npx serve scripts/ambient-noise-probe`) captures an ambient FFT; narrow peaks in 75–300 Hz with ≥15 dB prominence are likely culprits.
2. **Adaptive notch front-end** (Direction D, not pursued) — has its own failure modes (notching voice harmonics).
3. **PENN model** (Direction C, ruled out 2026-05-13): 0 % octave-up at realistic SNRs but 6–7× slower on browser WASM, 24× larger model, needs COI headers. Verdict + re-evaluation scaffolding: `measurements/penn-direction-c-verdict-2026-05-13.md` on the `pitch-detection-penn` branch.

**Effect on other features:** the vocal-weight gauge is unaffected (CPP is independent of pitch interpretation, and the gate uses confidence, which stays high on voiced speech regardless of pitch correctness). Only the pitch trace and note name are visibly wrong.

### Firefox-mobile worker-MSTP capture path

Next capture-architecture work item (see §Capture architecture). Testable on the harness Pixel under Firefox; do not start other capture work before it.

## Deployment

GitHub Actions (`.github/workflows/deploy.yml`) builds and deploys to GitHub Pages on push to `main`. Build output goes to `docs/`. Vite base path is `/Syrinx/` (uppercase S). This project is hosted on **GitHub** (`gh` CLI for PRs/issues); the Forgejo instance described in the user-level notes is not used here. See ARCHITECTURE.md for the full design document and roadmap.
