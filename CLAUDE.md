# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## PR creation requires explicit user approval (load-bearing — DO NOT VIOLATE)

Branches and commits are autonomous on this project; **opening a PR requires the user to explicitly say "open the PR" (or equivalent).** Applies to every PR, including small or seemingly-obvious ones. If a fix has been approved in conversation but the user hasn't explicitly said "open a PR for it," the work goes to a branch and STOPS for approval before any `gh pr create` invocation.

The pattern from PR #68 onward, repeated for clarity:

1. Investigation → measurement file in `measurements/` (autonomous).
2. Branch + commits with the proposed fix (autonomous).
3. Push the branch (autonomous).
4. **STOP. Ask the user to open the PR.** Surface the branch name and a one-paragraph summary of what's in it.
5. User says "open the PR" → run `gh pr create`.

User approval of the *content* of a fix during investigation/discussion is **not** approval to open the PR. The PR-creation action is a separate gate. If a deliverable description includes phrasing like "PR opened" or "deliverable surfaced," interpret that as "branch ready for review, STOP before `gh pr create`" — even if the prior conversation approved every individual change in it.

This rule was added 2026-05-05 after PRs #70 and #71 were opened out of process (the content was greenlit in conversation, the PR-opening action was not). Out-of-process PRs aren't reverted, but the gate applies on every subsequent PR.

## Project Overview

Syrinx is a browser-based voice training toolkit providing real-time resonance, pitch, and vocal weight analysis. It runs entirely client-side with no backend — all audio processing happens in the browser. Currently targets voice feminization training.

Live demo: https://alice-sabrina-ivy.github.io/Syrinx/

## Commands

- **Dev server:** `npm run dev` (HTTP localhost only)
- **Dev server (LAN-accessible HTTPS, for phone testing):** `npm run dev:mobile` — see "Mobile testing" below
- **Production build:** `npm run build` (outputs to `docs/`)
- **Lint:** `npm run lint`
- **Preview production build:** `npm run preview`

No test framework is currently set up. Test files are runnable Node scripts (e.g. `node tests/ml/audio-utils-test.js`, `node tests/dsp/accuracy-test.js`) that print `pass/fail` and exit non-zero on failure.

### Mobile testing

`npm run dev:mobile` runs Vite with `--mode mobile --host`, which binds to all network interfaces and enables a self-signed HTTPS cert via `@vitejs/plugin-basic-ssl` (gated to `mode === 'mobile'` in [vite.config.js](vite.config.js) so default `npm run dev` is unchanged). HTTPS is required because mic capture (`getUserMedia`) refuses non-localhost origins over HTTP.

Vite prints both URLs at startup, e.g.:
```
  ➜  Local:   https://localhost:5173/Syrinx/
  ➜  Network: https://10.0.0.41:5173/Syrinx/
```

**Phone workflow** (same Wi-Fi as the PC):
1. Open the Network URL on the phone.
2. Click through the self-signed cert warning. (Chrome on Android: tap "Advanced" → "Proceed to <ip> (unsafe)". Safari on iOS: similar — there's a "visit this website" link buried under the warning.) The warning is expected; the cert is generated on the fly and not signed by a trusted CA.
3. Grant mic permission when the page asks.

**If the phone can't reach the LAN URL**, Windows Firewall is almost certainly blocking inbound connections to port 5173. Vite fails silently — it'll happily bind and print the URL, but the firewall drops incoming packets at the OS layer. To allow it (run once, in an admin PowerShell):
```powershell
New-NetFirewallRule -DisplayName "Vite dev (5173)" -Direction Inbound -LocalPort 5173 -Protocol TCP -Action Allow -Profile Private
```
The `-Profile Private` scope confines the rule to the home/private Wi-Fi profile so port 5173 isn't exposed when on public networks. To revoke later: `Remove-NetFirewallRule -DisplayName "Vite dev (5173)"`.

### Diagnostic mode

Append `?diag=1` to the URL (`https://10.0.0.41:5173/Syrinx/?diag=1` for mobile testing, `http://localhost:5173/Syrinx/?diag=1` for plain dev) to surface a fixed top-right diagnostic overlay. Without the flag the app is byte-identical to production: the overlay component is `lazy`-loaded so its chunk isn't even fetched, and the hot-path instrumentation (extra timing fields, RMS, per-pitch-inference timings) is gated behind a `_diag` flag in each worker — off by default.

The overlay surfaces:

- **Per-frame timings** (current value + p95 + drift, over the ~30 s ring window):
  - `audio→worker` — capture-processor → DSP worker arrival. **Drift on this row is the load-bearing signal for mobile audio-clock skew / capture-buffer accumulation** — green = stable, amber = ≥0.2 ms/s, red = ≥1 ms/s. The `?diag=1` instrumentation diagnosed +11.5 ms/s drift on Pixel-class Android Chrome at 48 kHz with the default `latency: 0.04` constraint; the `latency: { ideal: 0.01, max: 0.05 }` getUserMedia hint added in `useAudioPipeline.js` is the first-line fix.
  - `worker total` — formants/tilt/HNR (every 6th frame). Pitch detection is in pitch-worker, see `pitchInferences` in the snapshot for SwiftF0 timings.
  - `worker→main` — DSP `postMessage` → main `onmessage` handler entry.
  - `main handler` — `handleAnalysisResult` duration.
  - `end-to-end` — audio captured (AudioContext time → epoch via `ctxCreatedAtEpochMs`) to display update. Drift here mirrors `audio→worker` since the worker side is constant-cost.
- **Last-5-seconds sparkline**: pitch (amber, 60–400 Hz scale), `confidence` (SwiftF0's voicing probability, cyan — replaced pYIN's `voicedness` and `voicednessObs` at the Stage 4 cutover), `inputRms ×4` (orange).
- **Audio context introspection** captured once at start: `AudioContext.sampleRate` (highlights amber if < 44.1 kHz — mobile silent downsampling), `baseLatency`, `outputLatency`, AudioWorklet vs ScriptProcessor confirmation, requested-vs-granted `getUserMedia` constraints (echoCancellation / noiseSuppression / autoGainControl). Mobile browsers may silently override these.
- **Lifecycle**: pointer-event tap age (for tap-to-display latency), `document.visibilityState`, frames-while-hidden tally.
- **Snapshot last 5s ↓**: downloads a JSON file with the full ring buffer + audio info + user agent + tap timestamps. Useful for capturing a specific reproduction (e.g. "phantom 70 Hz pitch from fan noise") and attaching to an investigation file under `measurements/`.

The overlay refreshes at 10 Hz from the diag ring buffer (which itself updates at the worker's analysis cadence ~40 fps). Reading the buffer is O(1); the overlay does not observe the audio pipeline directly.

**Investigating phantom pitch / mobile-specific behaviour**: open `?diag=1` on the phone, exercise the issue (let the fan noise generate the phantom), tap "Snapshot last 5s ↓", and stash the JSON in `measurements/<date>-<topic>.json` next to a `.md` file describing the repro. The snapshot includes `inputRms` and `confidence` per frame plus the `pitchInferences` ring of per-SwiftF0-call timings, so the failure mode (e.g. "confidence saturates while inputRms is at noise floor") is reconstructable later.

### Mobile audio platform floor (Pixel 8 Pro / Chrome 147, characterized 2026-05-05)

The mobile audio capture pipeline has a measured floor on this platform that's relevant for any future latency work. Sweep data: [measurements/mobile-latency-sweep-2026-05-05.md](measurements/mobile-latency-sweep-2026-05-05.md) and the platform-floor section below.

**The chunkArrival metric on mobile bottoms out around 100–120 ms** at the production config (`latencyHint: "balanced"`, default 25 ms chunkSize). Decomposed:

| Component | ms |
|---|---|
| Hardware mic buffer (granted `latency: 0.04`, immutable on this device) | 40 |
| AudioWorklet chunk-aggregation (chunkSize default) | 25 |
| AudioContext output-buffer offset (baseLatency at `lat=balanced`) | 20 |
| Worker handoff + main-thread handler | ~5 |
| **Theoretical floor** | **~90** |
| Measured median | ~110 |
| Unexplained AudioContext-internal overhead | ~20 |

**Levers tested and ruled out:**

- **`channelCount: 1` constraint**: already granted by default — no change.
- **Smaller `chunkSize` (10 ms via `?chunk=10`)**: doesn't move the metric. The metric tracks *latest sample* arrival, not earliest. Smaller chunks reduce *first-sample* latency at start of utterance (perceptually noticeable for transients) but don't change the steady-state median.
- **Strict latency constraint (`latency: { exact: 0.01 }` via `?latexact=0.01`)**: rejected by `getUserMedia` (`OverconstrainedError`). `exact: 0.02` accepted but the platform still grants `0.04`. The platform floor for hardware buffer is ~40 ms regardless of the constraint.
- **Sample-rate reduction (16 kHz)**: increases buffer time per sample (Android allocates buffers in samples, not time). Worse on this metric.

**Path that DID emerge (deferred, not shipped):**

`MediaStreamTrackProcessor` (Insertable Streams API, Chrome-only) delivers `AudioData` frames directly from the `MediaStreamTrack` without going through `AudioContext`. A 10 s probe on the same Pixel 8 Pro showed:

- Frames arrive every 40 ms (matches the hardware buffer exactly)
- Drift between wall clock and audio time: 0.8 ms median, 21 ms p95 over 10 s — essentially zero
- No AudioContext-internal overhead

Switching the capture path from `AudioContext + AudioWorklet` to `MediaStreamTrackProcessor + Worker` would lower the mobile latency floor from ~110 ms to ~50 ms. The trade-off is Chrome-only (Firefox lacks support, Safari historically lagged), so this is a separate architectural decision rather than a drop-in fix. Filed as a known followup in case the latency complaint resurfaces. The diag harness's `?capture=mstp` flag is reserved for measuring this path when it's implemented.

**Diagnostic flags relevant to this:** `?chunk=N` (5–50 ms), `?latexact=N` (strict latency), `?lat=N|interactive|balanced|playback` (latencyHint override), `?nolatconstraint=1`, `?sr=N`. All measurement-only. See [src/diag/diag.js](src/diag/diag.js) for the full list.

### Mobile diag capture harness

[scripts/mobile-diag-capture.js](scripts/mobile-diag-capture.js) drives Chrome on a USB-attached Android phone via ADB + Chrome DevTools Protocol, runs a configurable capture window, pulls the snapshot JSON straight out of the page, prints a summary, and saves the full snapshot to `measurements/mobile-diag-runs/<ISO-timestamp>.json`. Iterates on mobile latency fixes without manual phone interaction.

**One-time setup:**

1. Install Android Platform Tools so `adb` is on `PATH`. Either `winget install Google.PlatformTools` or download the standalone bundle from <https://developer.android.com/studio/releases/platform-tools> and add the extracted folder to `PATH`. Confirmed working with `adb 1.0.41 / 34.0.5-10900879` at `C:\adb\adb.exe`.
2. On the phone, enable Developer options (Settings → About → tap Build number 7×) and turn on USB debugging.
3. Plug the phone into the PC via USB. The USB mode must allow data (e.g. "File transfer / Android Auto"); "Charging only" leaves the data lines off and ADB will see no device.
4. The first time, `adb devices` shows the phone as `unauthorized` and a prompt appears on the device asking to trust this computer's RSA key. Tap "Always allow from this computer" → "OK". The harness detects this state and prints a recovery hint.
5. The first time the dev server URL is opened on the phone, accept the self-signed cert warning (Chrome on Android: Advanced → Proceed to <ip> (unsafe)). Subsequent loads are remembered.

**Run:**
```
node scripts/mobile-diag-capture.js [--duration=30] [--url=https://10.0.0.41:5173/Syrinx/?diag=1]
```

The harness:
1. Verifies ADB sees exactly one authorized device with Chrome installed.
2. Dispatches an `am start … VIEW` intent so Chrome navigates to the diag URL.
3. Runs `adb forward tcp:9222 localabstract:chrome_devtools_remote` and polls `http://localhost:9222/json/version` until CDP comes up (typically <1 s after Chrome foregrounds).
4. Connects Puppeteer to the remote browser, finds the Syrinx tab by origin, and waits for `window.__syrinxDiag` to attach.
5. Clicks the "Get Started" / "Start Listening" button if the welcome overlay or idle state is showing. Bails after 8 s if no frames arrive (mic permission, AudioWorklet error, etc.).
6. Sleeps for the configured duration with a 5 s heartbeat showing live frame count + last `chunkArrivalMs` + status-error count.
7. Reads the snapshot JSON directly out of the page (avoids the Android download-manager path, which is sandboxed differently per OEM). Saves to `measurements/mobile-diag-runs/<timestamp>.json` and prints a summary.

**Summary fields:** session duration, frame count, audio context (sampleRate, baseLatency, outputLatency, granted `latency`), `chunkArrivalMs` and `totalMs` distribution stats, drift slope (ms/s) for both, plus a coarse phase-change detector (split-half mean ratio) that flags bimodal sessions like the t≈22 s discontinuity Alice captured manually.

**Audio source for deterministic captures:** the phone's mic picks up ambient sound, which is non-reproducible across runs. For now, play a known reference signal (sustained vowel WAV) from PC speakers into the phone's mic during capture — manual but simple. A fully-automated alternative (push test audio to the phone, play through phone speaker, capture from phone mic) is a followup if iteration count justifies it.

**Phone state to leave between runs:** USB plugged in, screen unlocked, Chrome running. The harness re-uses the existing tab and re-clicks start as needed; no need to close anything between iterations.

**Strongly recommended: enable "Stay awake while charging"** in Settings → System → Developer options. Without it, the phone dozes after the screen-off timeout and Android suspends AudioWorklet processing — captures longer than a few seconds will randomly stop producing frames depending on whether the phone happened to still be awake from recent user interaction. The harness wakes the screen and sets `svc power stayon usb` at startup, which mitigates this for the duration of the run on most Android builds, but the developer-option toggle is the durable fix.

**Failure modes the harness detects and prints recovery hints for:**
- No device attached / unauthorized / multiple devices.
- Chrome not installed (`com.android.chrome` not in `pm list packages`).
- CDP doesn't come up (Chrome not foregrounded, or some Chrome variants need the `chrome://flags` "Enable USB debugging" flag).
- No matching tab (cert warning still showing, or Chrome opened a different URL).
- No frames within 8 s (mic permission, AudioWorklet error — surfaces `status.errors` from diag state).

If the harness exits with a hint that says "tap something on the device", do that and re-run. Anything else, capture the error and investigate.

### Desktop diag capture harness

The desktop analogue of the mobile harness — runs a configurable capture window, snapshots and saves the JSON to `measurements/desktop-diag-runs/<kind>-<ISO-timestamp>.json`. Used to compare MSTP vs AudioContext capture-source latency on desktop alongside the mobile harness's mobile measurements. Two harnesses, parallel use cases:

#### Isolated spawn (autonomous, synthetic-injection only)

[scripts/desktop-diag-capture.js](scripts/desktop-diag-capture.js) spawns a fresh Chrome with `--user-data-dir=<temp>`, runs the capture in that isolated profile, and tree-kills only the spawned PID on exit. No setup required from the user. Use `--voice-file=PATH` for autonomous regression runs against synthetic audio:

```
node scripts/desktop-diag-capture.js [--kind=mstp|audiocontext] [--duration=120] [--url=...] [--voice-file=PATH] [--play-wav=PATH]
```

**`--voice-file=PATH`** uses Chrome's `--use-file-for-fake-audio-capture` to replace the mic wholesale with the WAV's bytes (no real audio stack involved). Bit-exact reproducibility — the recommended mode for this harness.

**`--play-wav=PATH`** ATTEMPTS speaker-loopback through the spawned Chrome's default mic (via PowerShell `System.Media.SoundPlayer.PlayLooping`). **Does not work in Alice's environment** — the spawned isolated Chrome's default mic delivers `inputRms=0` across all captured frames regardless of speaker output. The fresh profile selects a non-physical or muted device distinct from the user's actual default mic. Code path retained because it works on the Pattern A harness (which inherits the user's real-mic config) and may work in other environments. **For real-mic testing on this dev environment, use Pattern A.**

**`--no-fake-device=true`** is also unusable on this dev environment for the same reason — the spawned profile's mic device routes to silence regardless of whether the synthetic-fake-device flag is present. Confirmed empirically 2026-05-06 with a 5 s direct ambient-noise probe (213 frames, all `inputRms = 0.000000`, `voicedness = 0.5` prior). Originally inferred from the `--play-wav` failure in the line above; now confirmed independently. The two probes (speaker→mic loopback AND room-noise mic capture) both produce digital silence on the isolated profile, so the failure is at the device-selection layer in the fresh profile, not at the speaker loudness or audio chain. **Any test that needs real-mic audio must use Pattern A (attach harness).**

The flags are mutually exclusive — `--voice-file` takes priority.

#### Attach to existing Chrome (for tests that need real session state)

[scripts/desktop-diag-capture-attach.js](scripts/desktop-diag-capture-attach.js) connects via CDP to a Chrome already running with `--remote-debugging-port`, opens the test page in a NEW WINDOW (not a tab — separate window so it doesn't hijack focus in the active session), runs the capture against the user's real Chrome session (real cookies, persisted permissions, real-profile mic preference), then closes only the window it opened via `Target.closeTarget({targetId})`. Other tabs and windows are unreachable by construction — CDP addresses targets by id, not pattern.

Use when the test needs the user's actual browser state, not just real audio. Prerequisite — the user must launch Chrome with both `--remote-debugging-port` AND `--user-data-dir` (one-time, with all current Chrome windows closed):

```powershell
& "C:\Program Files\Google\Chrome\Application\chrome.exe" --remote-debugging-port=9223 --user-data-dir="C:\temp\chrome-debug-profile"
```

**Both flags are required.** Chrome 136+ silently rejects `--remote-debugging-port` against the default profile (security hardening preventing unauthorized attach to the user's real session). Without `--user-data-dir`, port 9223 will not bind even though the launch appears to succeed. Verify with `curl http://localhost:9223/json/version` — should return JSON with browser info. If it returns "connection refused", the flag was silently dropped.

The `--remote-debugging-port` flag also only takes effect on a fresh launch — a second invocation while Chrome is already running gets absorbed into the existing instance and the flag is ignored. Make sure no Chrome windows are open before the launch command.

**Window-close caveat**: the harness closes its own test window via `Target.closeTarget` on completion. If the debug-Chrome instance has no other windows open (typical for fresh profiles), Chrome itself exits when its last window closes, and port 9223 becomes unbound. Subsequent harness runs need a fresh Chrome relaunch. To keep Chrome alive across runs, manually open one extra tab in the debug-Chrome instance (e.g., navigate to `about:blank`) before running the harness.

```
node scripts/desktop-diag-capture-attach.js [--kind=mstp|audiocontext] [--duration=120] [--url=...] [--port=9223] [--play-wav=PATH]
```

`--play-wav` works on this harness too, with the same semantics as on the isolated harness.

#### Focus / visibility emulation (load-bearing for both harnesses)

Both harnesses call `Emulation.setFocusEmulationEnabled({enabled:true})` and `Page.bringToFront` after attaching. Without this, when the test window sits behind the user's foreground app (a common situation for an unattended harness run), `document.visibilityState` reads `"hidden"` and React's onClick handlers get throttled enough that programmatic clicks via `Input.dispatchMouseEvent` appear to no-op — the click coordinate lands on the correct element, but `dismissWelcome`'s onClick never runs, the audio pipeline never starts, and `audio: null` / `frames: 0` / no errors propagate to the diag snapshot. Empirically observed 2026-05-05; both harnesses ship with the workaround. Diagnostic if the harness ever stalls again with this signature: check the page-state probe output for `vis: hidden`.

#### Why not spawn a debug-port-enabled Chrome that shares the user's profile?

We explored sharing the user's profile via Node spawn (which would have given a debug-enabled instance with the user's real mic preference, no `--play-wav` fixture proxy needed) and concluded it's not achievable through Node's `child_process` API. Five spawn variants tested 2026-05-05 (`detached:false/true`, `stdio:'inherit'/'ignore'`, `cmd /c start chrome`, `powershell -Command Start-Process chrome`, `windowsHide:false`) all caused Chrome to single-instance-merge into the user's running Chrome — even though manually typing `chrome.exe --remote-debugging-port=9223` in PowerShell does produce a new debug-enabled instance for the user. The difference between interactive-PowerShell and Node-launched-PowerShell isn't pinned, but the empirical conclusion is solid. The isolated-spawn harness with `--play-wav` sidesteps the issue entirely: deterministic test signal regardless of which mic the fresh profile picks. **Future sessions: do not redo this exploration.**

### Spawned-process cleanup rule (load-bearing — DO NOT VIOLATE)

**Any harness that spawns a Chrome (or any other) process MUST kill ONLY the PID it spawned, never pattern-match on `chrome.exe` or any similar broad selector.** Alice runs Chrome as her primary browser across multiple monitors with active work; pattern-matched kills (`Get-Process chrome | Stop-Process -Force`, `taskkill /IM chrome.exe`, etc.) terminate her sessions and lose work. This is non-negotiable.

The pattern enforced by [scripts/desktop-diag-capture.js](scripts/desktop-diag-capture.js):
1. `spawn()` returns a child object with `child.pid` — capture and store this.
2. Always launch with `--user-data-dir=<unique-temp-dir-per-run>` so Chrome cannot merge into an already-running instance with the same profile (in which case our `--remote-debugging-port` flag would be silently ignored and our spawned PID wouldn't be the actual debug-target process).
3. At cleanup, run `taskkill /pid <PID> /T /F` — `/T` tree-kills descendants (renderer, GPU process, network service, etc. that Chrome forks under the launched chrome.exe), `/F` forces. **Never** use `/IM chrome.exe`.
4. Register the cleanup against `process.on("exit")`, `SIGINT`, `SIGTERM`, `uncaughtException` — exit-path coverage means an aborted harness still cleans up its own children.
5. Remove the per-run profile dir after the kill so leftover cache files don't accumulate in temp.

If a future session needs to add another spawn-and-cleanup harness, copy this pattern verbatim. If something else is spawning Chrome (e.g., Puppeteer's `puppeteer.launch()`), the `browser.close()` API performs equivalent PID-scoped cleanup — that's fine. The only forbidden pattern is broad name-based matching.

### Capture architecture (Stage 2 onwards)

Audio capture goes through [src/audio/captureSource.js](src/audio/captureSource.js)'s `createCaptureSource()` factory, which returns one of two implementations:

- **`mstp`** (production default wherever the runtime supports main-thread `MediaStreamTrackProcessor` — Chrome desktop + Chrome Android + Safari ≥26): `getUserMedia` → `MediaStreamTrackProcessor` on the main thread → `ReadableStream` of `AudioData` → `MessageChannel` → DSP/ML worker.
- **`audiocontext`** (fallback when MSTP isn't available — Firefox in particular until worker-MSTP lands): `getUserMedia` → `MediaStreamAudioSourceNode` → `AudioWorkletNode` → `MessageChannel` → DSP/ML worker.

Stage 3 routing (`captureSource.js`'s `pickKind()`) returns `isMSTPSupported ? "mstp" : "audiocontext"`. The gate is feature detection on `MediaStreamTrackProcessor` + `AudioData` constructor presence — no UA gating. Decision basis: [measurements/capture-path-routing-2026-05-05.md](measurements/capture-path-routing-2026-05-05.md) (MSTP delivers ~5× lower chunkArrival latency on both desktop and mobile Chrome with no DSP-accuracy regression).

`?capture=audiocontext` and `?capture=mstp` URL flags remain as diag overrides for path-comparison measurement.

**Worker-MSTP path is deferred.** Chrome 147 mobile doesn't expose `MediaStreamTrackProcessor` in worker `globalScope` (verified empirically — `typeof MediaStreamTrackProcessor === "undefined"`), so the spec-conformant Firefox/Safari worker pattern can't be tested there. Firefox mobile is the right target for that work — it's testable on the same Pixel that runs the mobile harness, just under Firefox instead of Chrome. **The Firefox-mobile worker-MSTP path is the next capture-architecture work item after Stage 3 lands**; do not start it before then.

## Tech Stack

React 19 + Vite 7 + Tailwind CSS 4 (via `@tailwindcss/vite` plugin). Dexie for IndexedDB persistence. Visualizations use HTML Canvas directly (not a charting library). Audio capture and DSP use native Web Audio API (AudioWorklet + Web Worker). ES modules throughout.

## Architecture

### Audio Pipeline (five layers, each on a separate thread)

1. **AudioWorklet** (`public/capture-processor.js`) — runs on the audio thread, collects mic samples into ~25ms chunks, broadcasts each chunk to *all* registered consumer worker MessagePorts (currently DSP + ML + pitch). Uses pre-allocated buffers to avoid GC pauses. Each consumer gets an independent copy because `postMessage` with a transferable detaches the buffer.

2. **DSP Worker** (`src/dsp/dsp-worker.js`) — runs in a Web Worker, maintains a ring buffer (~200ms), computes formants/spectral-tilt/HNR/intensity:
   - Formants: Burg LPC with polynomial root finding (downsampled to ~12kHz, runs every 6th frame ~200ms). Receives a `pitch-hint` message from the main thread with the latest pitch-worker output; uses it for Praat-style pitch-adaptive LPC order (male: 10 / female: 12) and formant ceiling. Falls back to the female-default LPC config when no pitch is known.
   - Spectral tilt: FFT low/high band energy ratio
   - HNR: harmonics-to-noise ratio via autocorrelation
   - Intensity: RMS in dB
   - All pre-allocated buffers for zero-GC hot path. Pitch detection lives in pitch-worker (Stage 4 cutover, 2026-05-06) — this worker is now ~6 KB built (was multi-K LOC with the pYIN HMM machinery).

3. **Pitch Worker** (`src/dsp/pitch-worker.js`) — separate Web Worker hosting an ONNX Runtime Web inference session for the SwiftF0 model (`lars76/swift-f0`, MIT, 388 KB ONNX, 95 K-param CNN that operates on 1024-sample / 64 ms windows of 16 kHz mono audio). Resamples incoming chunks to 16 kHz via linear interpolation, maintains a rolling 1024-sample buffer, runs inference per 25 ms chunk. Posts back `{ pitch, confidence, voiced, ts, contextTime, inferMs? }`. Pitch is null when SwiftF0 confidence is below the gate threshold. The "ready" status message includes `modelUrl`, `device` (currently always "wasm"), and `threshold` so diag snapshots can record which model loaded under what config. **Confidence threshold 0.5** — selected in the Stage 3.4 sweep; the same value gates pitch reporting AND seeds the silence gate's voicedness arm by design (single threshold, no ambiguous middle band). Replaces pYIN, which previously lived in dsp-worker.js — investigation arc + ship rationale in §"Pitch detection — SwiftF0 cutover, 2026-05-06" under "Known issues / future work".

4. **ML Worker** (`src/ml/gender-worker.js`) — separate Web Worker hosting a Transformers.js audio-classification pipeline. Production model: `Alice-Sabrina-Ivy/voice-gender-classifier-onnx-q8`, a project-hosted q8 ONNX export of [JaesungHuh/voice-gender-classifier](https://huggingface.co/JaesungHuh/voice-gender-classifier) (ECAPA-TDNN, ~15.4 M params, MIT licensed). Replaces the prior `prithivMLmods/Common-Voice-Gender-Detection-ONNX` (wav2vec2-base, ~95 M params) — investigation arc + ship rationale in §"Perceived-voice gender model — investigation arc 2026-05-05/06" under "Known issues / future work". Resamples incoming chunks to 16 kHz via simple linear interpolation (`src/ml/audio-utils.js`), maintains a 0.75-second rolling window, runs inference at ~6.7 Hz (every 150 ms; see ORT-WASM perf note in design decisions), peak-VAD gates windows with no speech-level peaks (`windowPeak < VAD_PEAK_THRESHOLD`), EMA-smooths the score (α=0.2), and resets the smoothed value after a sustained silent run. Posts back `{ score: 0–100, confidence: 0–1, ts, inferMs? }` (inferMs only when init.diag=true). The "ready" status message includes `modelId` and `device` ("webgpu" or "wasm") so diag snapshots can record which ORT backend the model loaded under. Pure helpers (`resampleLinear`, `RingWindow`, `SilenceTracker`, `femaleScoreFromResult`, `windowPeak`, `windowRMS`, `ema`) live in `src/ml/audio-utils.js` so they can be unit-tested without booting the worker.

5. **Main thread** (`src/audio/useAudioPipeline.js`) — custom React hook that manages AudioContext / DSP / pitch / ML worker lifecycle, merges pitch-worker output into each DSP analysis frame via `latestPitchRef` (nearest-neighbor temporal alignment — both run at the 25 ms chunk cadence so the lag is at most one chunk), applies DSP result smoothing (rolling median: 2 samples for pitch, 7 for formants), outlier rejection (gates formant jumps > 500 Hz), silence gating (5-second hold), and exposes history via Refs for canvas rendering. Throttles setState to ~5fps for text readouts only.

   **Silence gate**: a frame is suppressed only when intensity is below `SILENCE_THRESHOLD_DB` (-50 dB) AND SwiftF0 confidence is below `CONFIDENCE_THRESHOLD` (0.5), for ≥ `SILENCE_DEBOUNCE_FRAMES` consecutive frames. AND-logic (not OR) is intentional — both signals must agree on "noise" before a frame is suppressed; either solo would over-suppress real speech. Pre-warmup frames before pitch-worker has emitted any output (confidence is null) fall back to intensity-only gating via the `typeof` short-circuit. Replaced PR #74's intensity-AND-pYIN-voicedness gate; the SwiftF0 confidence is the direct semantic replacement for pYIN's HMM-smoothed posterior, with cleaner calibration (no ~0.5-on-silence quirk).

### Canvas Visualization Strategy

History arrays are stored in Refs (not React state) and read directly by `requestAnimationFrame` loops in canvas components. This avoids React re-renders and keeps rendering smooth. All canvases use ResizeObserver for responsive sizing and device pixel ratio scaling.

- **PitchTrace** — 15-second scrolling pitch waveform with target band
- **ResonanceMeter** — vertical thermometer titled "Perceived voice" for the ML perceived-gender score (0–100). Reads `genderTraceRef` (entries `{ time, score, confidence }` posted by the ML Worker). Bar fills from 0 (bottom, "Masculine") to current score (top, "Feminine") with a warm→cool gradient; faint orange band marks the masculine range at 0–30, faint blue band marks the feminine range at 70–100, the middle 30–70 is the uncertain band. A glowing horizontal indicator at the current score tweens between samples via an exponential lerp in the rAF loop, with opacity scaled by confidence so low-confidence predictions read dim. A right-side history strip plots the last ~10 inferences fading by age. Big number readout below with a three-way subtitle driven by score range ("in feminine range" / "in uncertain range" / "in masculine range", plus "loading…" / "warming up" model-state messages). The middle uncertain range collapses with the classifier's low-confidence region because confidence is by construction `|score - 0.5| × 2`, so a single score-range check covers both. Replaces the older ResonanceScoreTrace + ResonanceGauge pair, which spread the same data across a 15-sec timeline + a separate horizontal bar. An earlier hand-crafted vowel-normalized formula (`src/utils/resonanceScore.js`) was tried and replaced because raw-formant geometry doesn't reliably model perceived gender.
- **VocalWeightGauge** — horizontal bar for vocal weight, driven by CPP (Cepstral Peak Prominence) computed in `src/dsp/cpp.js`. Zero user interaction: a sliding ring buffer holds the last ~30 s of voiced CPP-aggregate emits (120 samples at the production 250 ms emit cadence). During buffer fill, the gauge shows "Calibrating: N%"; once full, μ and σ are recomputed on every new emit (the oldest emit drops out FIFO), and the gauge displays the current voice's σ-distance from the recent window. Each session calibrates from scratch — no cross-session persistence, no buttons. Algorithm is sample-rate-invariant (resamples internally to canonical 16 kHz before the cepstrum pipeline) so CPP values are comparable across the sliding window regardless of audio configuration. Real-audio CPP spread across sample rates is < 0.03 dB; same-corpus Praat correlation r=0.64 (PTDB-TUG) / r=0.71 (FDA) on running speech. Investigation arc (6 cycles, including a same-day revert of a persistence+target-capture implementation that didn't pass the interaction-cost trade-off): [measurements/vocal-weight-stage-c-implementation-2026-05-12.md](measurements/vocal-weight-stage-c-implementation-2026-05-12.md).
- **CombinedDashboard** — main practice view composing the above, plus session recording logic

### Data Persistence

`src/db.js` defines a Dexie (IndexedDB) schema:
- **settings** — user preferences (record audio toggle, target ranges)
- **sessions** — practice sessions with summary stats (avg F0, F1, F2, F3, spectral tilt, HNR, time-in-target %)
- **frames** — raw per-frame metrics (timestamp, F0, F1, F2, F3, intensity, spectral tilt, HNR, voiced flag)
- **exerciseResults** — stubbed for future exercise system

The schema is at v2, but v2 is a `null`-drop of a short-lived `vocalWeightCalibration` table introduced and removed during the 2026-05-12 Stage C iteration (cycle 5a → 5b same-day revert). Dexie monotonic versions require a v2 entry; the `null` value cleanly removes the table for dev users who tested the persistence branch.

### UI Components

- **SessionHistory** (`src/components/SessionHistory.jsx`) — past sessions browser with expandable detail cards
- **DataManagement** (`src/components/DataManagement.jsx`) — settings panel with audio recording toggle, export/import, delete data

### Entry Points

`index.html` → `src/main.jsx` → `src/App.jsx` (three tabs: dashboard, pitch, history + welcome overlay + settings panel). AudioWorklet processor loaded dynamically from `public/`. DSP worker spawned as a module worker.

### Utilities

- `src/utils/constants.js` — target ranges (pitch, resonance, spectral tilt, HNR), display ranges, time windows, and color scheme
- `src/utils/pitchUtils.js` — Hz to musical note mapping (e.g., A3, C#4)

### Key Design Decisions

- Direct AudioWorklet→Worker MessagePort communication for zero main-thread audio relay; AudioWorklet broadcasts to a list of consumer ports so DSP, pitch, and ML can all receive raw audio
- Pitch detection (SwiftF0 ONNX in pitch-worker, post-Stage-4 cutover) runs per-25-ms-hop with single-frame inference. Median 11 ms inference on Pixel 8 Pro / Chrome 147 / WASM, p95 17 ms — fits the 25 ms hop budget with comfortable headroom (Stage 4.4 mobile-diag baseline). Confidence threshold 0.5 gates pitch reporting; the same threshold seeds the silence gate's voicedness arm by design.
- LPC formant extraction throttled to every 6th frame (~200ms) to save CPU; uses pitch-worker's pitch via the main-thread-relayed `pitch-hint` message for male-vs-female LPC order selection (one-frame lag acceptable since formants change slowly)
- ML gender inference runs at ~6.7 Hz design target (every 150 ms) over a rolling 0.75-second 16 kHz window. **Production model**: JaesungHuh ECAPA-TDNN q8 ONNX (~15.4 M params, project-hosted at `Alice-Sabrina-Ivy/voice-gender-classifier-onnx-q8`, MIT). Hillenbrand-corpus accuracy 95.6 % male / 95.8 % female (gender-symmetric, vs the prior `prithivMLmods` wav2vec2-base's 100 % / 81.3 %). **Real-world inference timing exceeds the 150 ms hop budget on every measured ORT-WASM browser configuration** — desktop browser WebGPU ~190 ms median, Pixel 8 Pro Chrome 147 / WebGPU ~460 ms median. The `inferenceInProgress` guard drops overruns gracefully; the meter degrades to ~5 Hz on desktop and ~2 Hz on mobile rather than queuing. A peak-amplitude VAD gate (`windowPeak < VAD_PEAK_THRESHOLD`) skips silent windows — peak rather than RMS so windows that mix speech with short pauses still pass. EMA smoothing α=0.2 (~750 ms time-constant) absorbs per-window noise; α=0.2 selected from a JaesungHuh Hillenbrand sweep where higher α values produced smoothing-artifact misclassifications on borderline samples. The smoothed score resets after `RESET_AFTER_SILENT_INFERENCES` consecutive silent inferences (~2 s at 6.7 Hz) so a new utterance doesn't blend with a stale pre-pause value. JaesungHuh uses id2label `{0:male, 1:female}` (opposite ordering from prithivMLmods); `femaleScoreFromResult` parses by label name only and returns null on unrecognized labels — no positional guessing — so a future model swap can't silently invert the meter. Runs in a dedicated worker so it doesn't block DSP.
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

**Multi-frame methodology is canonical.** The `accuracy-test.js` and `real-speech-test.js` Pass-1 measurements use multi-frame stepping (25 ms hops over the central 70 % of each recording, take the median of the non-null trace via `streamingMedianDetect`). This mirrors production hop cadence. Originally introduced for pYIN's HMM lookback warm-up; remains the canonical methodology for SwiftF0 evaluation since it matches production streaming behavior. Single-window-per-file (the legacy methodology from before pYIN) doesn't reflect production behavior and produces noise-dominated numbers; it's preserved only as historical context in the session-1 measurement files (`pitch-baseline-pre-impMin-*` etc.). Any future pitch-evaluation work should default to multi-frame.

**SwiftF0 ONNX is the deployed pitch detection algorithm** (post-Stage-4 cutover, 2026-05-06; replaces pYIN). Selection rationale, threshold tuning, and mobile-WASM latency in [measurements/swift-f0-stage3-validation-2026-05-06.md](measurements/swift-f0-stage3-validation-2026-05-06.md), [measurements/swift-f0-stage3-4-3-5-validation-2026-05-06.md](measurements/swift-f0-stage3-4-3-5-validation-2026-05-06.md), and [measurements/swift-f0-stage4-integration-2026-05-06.md](measurements/swift-f0-stage4-integration-2026-05-06.md). Confidence threshold 0.5; gender-symmetric per-corpus accuracy: Hillenbrand 0.02 % aggregate octave error, PTDB-TUG 0.08 %, vocadito 0.05 %, FDA 0.00 % (collapsed from pYIN's ~3 % across mid-range buckets). The user-reported 80 Hz monotone reproducer (FDA `rl022`) drops from 27.12 Hz mean error / 2 octave errs (pYIN) to 2.44 Hz / 0 octave errs (SwiftF0).

**Historical pYIN baseline** (pre-Stage-4 cutover, kept for context on the investigation arc): Stage 2.B σ=50 L=4 α=0.0001, full-corpus Hillenbrand mean F0 error M=9.6 Hz / F=11.3 Hz. Tuning history, σ/L/α sweeps, and the four ruled-out fix directions investigated within the pYIN framework live in [measurements/pyin-L-sweep-2026-05-04.md](measurements/pyin-L-sweep-2026-05-04.md), [measurements/pyin-sigma-at-bestL-2026-05-04-harness.txt](measurements/pyin-sigma-at-bestL-2026-05-04-harness.txt), [measurements/octave-lock-investigation-2026-05-05.md](measurements/octave-lock-investigation-2026-05-05.md), and [measurements/alpha-sweep-2026-05-06.md](measurements/alpha-sweep-2026-05-06.md). The ruled-out sweep harnesses (`pitch-bucket-{asymmetric,multi-mult,voicedness-transform}-sweep.js`) ship as durable infrastructure for any future pitch-detection investigation.

**Test helper-choice contract.** Two helpers, two regimes — keep them distinct. `steadyStateDetect` (in `pitch-detection-comprehensive.js`, `accuracy-test.js`, `yin-harmonic-test.js`, `real-speech-test.js`) for stationary stimuli where same-window-repeated equals sequential-frames-of-same-signal: pure tones, harmonic stress, vibrato within a single window. `streamingMedianDetect` (in `accuracy-test.js`, `real-speech-test.js`) for non-stationary recordings where adjacent windows differ. Mixing them up produces measurement artifacts that don't obviously fail — see [measurements/pass1-helper-diagnostic-2026-05-04.md](measurements/pass1-helper-diagnostic-2026-05-04.md) for the failure mode (F p95 = 210 Hz with the wrong helper vs ~28 Hz with the right one, a 7× difference on the Hillenbrand corpus).

**Production paths must be measured, not just harnesses.** Test infrastructure typically sets configuration via `globalThis.__VAR` overrides; production typically does not. The "fallback when override unset" code path is part of the ship surface and needs its own measurement pass — at least one end-to-end run through the actual production initialization sequence (`useAudioPipeline.js` → DSP worker init → `detectPitch`) before any ship claim is written. PR #68's original ship documented L=2 (50 ms latency) based on σ-sweep harness numbers that set `__PYIN_LOOKBACK` explicitly; production never set the override, so the deployed runtime silently fell back to L=5 (~125 ms latency). The harness numbers were correct for L=2 but irrelevant to what shipped. Caught by code review pre-merge; the L-axis sweep that resulted ([measurements/pyin-L-sweep-2026-05-04.md](measurements/pyin-L-sweep-2026-05-04.md)) revealed L=2 was also a sub-optimal cell and the eventual ship was L=4 σ=50. The named `PYIN_LOOKBACK_DEFAULT` constant in `dsp-worker.js` exists so this category of bug can't recur silently.

**Pitch accuracy targets are gender-symmetric.** The tool serves voice training in any direction — transmasculine, transfeminine, cisgender singers and speakers alike. Ship decisions optimize on a gender-symmetric metric (e.g., `max(F_error, M_error)`, or balanced F+M) rather than female accuracy alone. The L-axis sweep produced three defensible Pareto cells (L=2 σ=75, L=4 σ=50, L=5 σ=75); the cell minimizing female F0 error was L=2 σ=75 at F=11.75 Hz, but it had M=15.52 Hz — a 3.77 Hz gender gap that would have given trans men and cis male users substantially worse pitch accuracy than female users. L=4 σ=50 was selected for being gender-symmetric at a small cost to female accuracy. The α=0.0001 mixture prior added later improves both genders (M 12.15→9.6, F 12.16→11.3) — male improves more, widening the gender gap to 1.7 Hz, but absolute accuracy improves on both sides and the gender-symmetric max metric still strictly improves. Voice-training tools must not bake demographic assumptions into ship-criterion math without explicit justification.

## Known issues / future work

### MSTP runtime fallback to AudioContext

`pickKind()` in [src/audio/captureSource.js](src/audio/captureSource.js) routes to MSTP whenever `isMSTPSupported()` returns true. That's feature detection — it checks `MediaStreamTrackProcessor` and `AudioData` constructor presence — not runtime validation that the MSTP capture path actually delivers audio frames. If a browser detects-as-supported but the path fails at runtime (e.g. the `MediaStreamTrackProcessor` constructor exists but `processor.readable.getReader()` errors, or the first AudioData frame never arrives), the audio pipeline hard-fails. There's no fallback to the AudioContext path; `_createMstpSource`'s 5 s first-frame timeout throws and the React error state surfaces a generic "microphone access denied" message that misrepresents the actual failure.

**Practical risk: low.** On the browsers validated in the Stage 2.5 measurement (Chrome desktop 147, Chrome Android 147 / Pixel 8 Pro), MSTP works reliably when detected. No detection-passes-but-runtime-fails reports from the wild. Future Chrome versions, Firefox-mobile (when it gains main-thread MSTP), and Safari (which has MSTP but Syrinx hasn't been validated there) are the candidate failure surfaces.

**Forward-looking soundness gap.** Robust capture-path selection should prefer "MSTP if it actually works on this runtime", not "MSTP if the constructors exist". Worth addressing eventually even though no current breakage is observed.

**Approach when addressed:** wrap the MSTP path's first-frame await in a try/catch inside `createCaptureSource`. On failure (or first-frame timeout), close the MSTP path cleanly and re-attempt via `_createAudioContextSource` against the same `MediaStream`. Surface the fallback event in the diag overlay so future regressions show up in measurement runs.

**Origin:** Codex review on PR #69 (the pYIN octave-lock fix). Out of scope for that PR; documented here for future work.

### Pitch detection of periodic non-speech content (fan hum, mechanical rumble)

The pitch-worker reports periodic non-speech content (e.g., mechanical fan hum at consistent frequencies) as voiced pitch when intensity clears the silence threshold and SwiftF0 confidence exceeds the gate threshold. **This is a pre-existing limitation across pitch detection algorithms, not a SwiftF0 regression.** Empirical comparison 2026-05-06 confirmed both the pYIN production build and the SwiftF0 dev build detect a 120 Hz fan hum in the same environment. Production pYIN detected it less consistently — that inconsistency incidentally masked the issue from users; SwiftF0's higher reliability removes that accidental masking.

**What's actually happening:** the silence gate (`intensityQuiet AND voicednessQuiet`) treats periodic harmonic content above threshold as voiced. SwiftF0's confidence is purpose-built for "is there a clear pitch present," and a stationary fan is exactly that. The gate doesn't distinguish "voice" from "tonal noise."

**Addressing requires** voice-activity detection (VAD), spectral noise-floor analysis, or some other speech-vs-non-speech mechanism — separate scoped work, queued for a future session. None of the in-scope mechanisms (intensity threshold, voicedness/confidence threshold) are sufficient by construction.

**Practical impact:** users in environments with steady mechanical hums (laptop fans, HVAC, server room) will see the pitch trace track those frequencies during silence. Workaround: pause detection or move to a quieter environment until VAD ships. Not a regression vs the prior pYIN production build.

### Pitch detection — octave-up failure on low-F0 voices with harmonic-stack interference

Related to the periodic-non-speech limitation above, but distinct in mechanism and severity. **Active during voiced speech** (not just silence). Documented 2026-05-12; investigation arc in `pitch-half-period-octave-fix` branch (not merged to main — negative-finding artifact).

**Symptom:** SwiftF0 reports approximately 2× the user's actual F0 with high confidence, sustained over many frames. Specifically observed on a low-F0 voice (85-95 Hz) where the pitch trace sat at ~175 Hz predominantly with intermittent brief drops to the true F0.

**Root cause:** the recording environment contains a harmonic-rich tonal source at approximately 2× the user's fundamental — e.g., refrigerator compressor, HVAC duct resonance, mains-electrical 3rd harmonic (180 Hz), computer fan whine, or a room standing-wave resonance. The interferer's harmonic structure looks "voice-like" to SwiftF0's CNN, and the model reports the interferer's fundamental rather than the actual voice fundamental. Even at SNR=+20 dB (interferer 10× quieter than voice), the failure can produce ≥ 66 % sustained octave-up errors.

**Deterministic reproducer:** synthetic harmonic-stack added to a clean low-F0 corpus track. See `tests/dsp/swift-f0-synthetic-stress.js` Test 7 on the `pitch-half-period-octave-fix` branch.

**Fix attempted and ruled out:** frame-local half-period autocorrelation check (compare `r(sr/X)` vs `r(2·sr/X)`, prefer X/2 if half-period more periodic). MARGIN sweep showed no single value simultaneously achieves reproducer < 5 % octave-up AND clean-corpus regression < 2 % AND high-pitch invariance < 5 %. The autocorrelation approach is structurally limited because at high interferer levels the audio genuinely IS more periodic at the interferer's frequency — the algorithm has no information to distinguish "voice + tonal interferer" from "tonal interferer alone." See the negative-finding commit on `pitch-half-period-octave-fix`.

**Mitigation directions:**

1. **User-side: identify and remove the physical source.** This is the recommended workaround. Run `scripts/ambient-noise-probe/index.html` (standalone HTML utility, serve via `npx serve scripts/ambient-noise-probe`) to capture an ambient-noise FFT and identify narrow tonal peaks in the recording environment. Peaks in the speech F0 range (75-300 Hz) with high prominence (≥ 15 dB above local noise floor) are likely culprits. Common sources: refrigerator (~100-200 Hz with harmonics), HVAC duct resonance, computer fans, room standing waves. Physical isolation from the source resolves the failure without code changes.

2. **Adaptive noise-suppression front-end (Direction D, not pursued).** Identify persistent narrowband tonal sources from quiet moments + notch-filter before SwiftF0. Adds DSP complexity and has its own failure modes (e.g., notching at voice harmonics). Candidate for future investigation if user-base feedback indicates this failure is common.

3. **Alternative pitch model (Direction C, investigated and ruled out 2026-05-13).** PENN (Pitch Estimating Neural Networks, Morrison et al. 2023, MIT license) was empirically validated against the harmonic-stack reproducer. **Accuracy**: 0 % octave-up at realistic SNRs (interferer 5-20 dB quieter than voice) vs SwiftF0's 66-76 % — improvement is real. **Cost**: 6-7× slower than SwiftF0 on browser-WASM (25 ms median desktop with 4-threaded COI'd WASM, exactly at the 25 ms hop budget; ~60 ms median mobile extrapolated), 24× larger model (9.4 MB int8 vs 388 KB), 5× longer session load (480 ms vs <100 ms), requires Cross-Origin-Isolation headers for the threading to engage. Operational cost too high relative to the situational accuracy benefit for users WITHOUT the interference problem. Full verdict: `measurements/penn-direction-c-verdict-2026-05-13.md` on the `pitch-detection-penn` branch (not merged to main; preserved as scaffolding for any future revisit). Validation infrastructure (export / quantize / WASM probe) committed there for rapid re-evaluation if browser-WASM performance characteristics improve.

**Effect on other Syrinx features:** the vocal-weight gauge (CPP-based, in development on `vocal-weight-cpps-replacement` branch) is UNAFFECTED by this failure. CPP is computed independently of SwiftF0's pitch interpretation, and the silence gate uses SwiftF0's *confidence* (which stays high on voiced speech regardless of pitch correctness). Users hitting this failure can still use the vocal-weight gauge; only the pitch trace and pitch-derived UI (note name) are visibly wrong.

**Practical impact:** users in environments with strong harmonic tonal sources will see their pitch trace lock to multiples / submultiples of their actual F0. Currently mitigated only by physical-environment improvement. Document this as a known limitation in any user-facing pitch-training documentation.

### Pitch detection — SwiftF0 cutover, 2026-05-06 (resolved)

**Outcome:** Production pitch detection swapped from pYIN Stage 2.B (HMM with bounded-history Viterbi, σ=50/L=4/α=0.0001 tuning, 1633-LOC dsp-worker.js) to SwiftF0 (95 K-param CNN, MIT, 388 KB ONNX, lives in dedicated `src/dsp/pitch-worker.js`). User-reported 80 Hz monotone reproducer fixed (FDA `rl022` mean error 27.12 → 2.44 Hz, octave errors 2 → 0). Aggregate octave-error rates collapse 50–100× across all four corpora; mobile WASM inference 11.2 ms median on Pixel 8 Pro / Chrome 147 (45 % of 25 ms hop budget).

**Investigation arc** (preserved here so future pitch-detection investigations don't re-derive these conclusions):

1. **Failure report**: 80 Hz monotone speech tracks at 240–400 Hz (3×–5× harmonics) in production Syrinx while Voice Tools (closed-source Android reference) tracks cleanly. Reproducible across mic environments.

2. **Test corpus expansion** (committed in commits prior to the cutover): integrated Vocadito (CC-BY 4.0 singing corpus, 40 tracks, in-repo), CSTR FDA (100 sentences with laryngograph ground truth, fetch-on-demand via `bash scripts/fetch-fda-subset.sh`), re-integrated PTDB-TUG into the default test pipeline, built [tests/dsp/pitch-bucket-harness.js](tests/dsp/pitch-bucket-harness.js) for frame-level cross-corpus accuracy.

3. **Production baseline measurement** ([measurements/pitch-bucket-baseline-2026-05-06.md](measurements/pitch-bucket-baseline-2026-05-06.md)): pYIN production at 2.3–2.7 % octave-error rate on sub-90 Hz speech, 10.4 % octave-error rate on `vocadito_34`. Confirmed the failure mode quantitatively.

4. **Four pYIN-internal fix directions investigated and ruled out:**
   - **Symmetric α tuning** ([measurements/alpha-sweep-2026-05-06.md](measurements/alpha-sweep-2026-05-06.md)): per-corpus trade-off, no clean winner.
   - **Asymmetric α tuning** ([tests/dsp/pitch-bucket-asymmetric-sweep.js](tests/dsp/pitch-bucket-asymmetric-sweep.js)): directional hypothesis (octave-down errors dominate) confirmed but binary phase transition at α_up=0; intermediate values produced identical numbers to baseline.
   - **Voicedness-magnitude transform** ([tests/dsp/pitch-bucket-voicedness-transform-sweep.js](tests/dsp/pitch-bucket-voicedness-transform-sweep.js)): voicedness factor changes voiced/unvoiced labeling but NOT pitch ranking; per-frame pitch decisions identical across all p values. Operates at the wrong architectural layer.
   - **Multi-mult harmonic correction** ([tests/dsp/pitch-bucket-multi-mult-sweep.js](tests/dsp/pitch-bucket-multi-mult-sweep.js)): 5×3 grid all failed criteria; rl022 unmoved. Inherent contradiction in acceptance criteria.

5. **Field-level benchmark review**: [Nieradzik 2026 pitch-benchmark](https://github.com/lars76/pitch-benchmark) showed pYIN as the worst classical tracker on PTDB-TUG (72.1 % vs Praat 86.2 %, SwiftF0 90.4 %, PENN 91.0 %). pYIN as algorithm class structurally limited for sustained low-pitch speech.

6. **SwiftF0 selection + validation**:
   - **Stage 1** rl022 diagnostic ([tests/dsp/rl022-diagnostic.js](tests/dsp/rl022-diagnostic.js)): true F0 was in pYIN's top-3 pre-HMM candidates only 6.3 % of the time → candidate-generation broken surface, replacement is correctly targeted.
   - **Stage 2** SwiftF0 audit: model architecture + integration feasibility confirmed. Critical finding — SwiftF0 returns scalar pitch + confidence per frame, not per-bin posteriors, so original "SwiftF0 + Syrinx HMM" framing not viable. Selected Option A (SwiftF0 standalone, drop HMM).
   - **Stage 3** standalone four-corpus validation: [measurements/swift-f0-stage3-validation-2026-05-06.md](measurements/swift-f0-stage3-validation-2026-05-06.md). Octave-error rates collapsed across all corpora; rl022 fixed; vocadito_34 fixed.
   - **Stage 3.4** confidence threshold sweep: 0.5 selected — see [measurements/swift-f0-stage3-4-3-5-validation-2026-05-06.md](measurements/swift-f0-stage3-4-3-5-validation-2026-05-06.md).
   - **Stage 3.5** browser ORT-WASM mobile latency: 4.2 ms desktop / 5.0 ms Pixel 8 Pro median single-frame inference. 1.19× mobile/desktop ratio (vs JaesungHuh ECAPA-TDNN's 2.4×, wav2vec2-base's 4.5×). Same measurement file.

7. **Stage 4 production integration**: new pitch-worker.js, useAudioPipeline.js coordination changes, dsp-worker.js pYIN removal (HMM, candidate-mass, voicedness machinery, no-op infrastructure for the four ruled-out directions). Diag schema migrated: `voicedness` → `confidence`, `voicednessObs` removed (no SwiftF0 analog), new `pitchInferences` ring + `pitchModel` field. [measurements/swift-f0-stage4-integration-2026-05-06.md](measurements/swift-f0-stage4-integration-2026-05-06.md).

**Key methodology lessons** (transferable to future pitch-detection investigations):

- **Field-benchmark first when an algorithm class is suspected to be at fault.** Four within-pYIN tuning sweeps were run before the literature review surfaced that pYIN as a class is structurally limited for this regime. The benchmark review took ~2 hours; the prior tuning sweeps took ~2 days. For future "should we keep tuning vs replace" decisions, run the field-benchmark check earlier.

- **Frame attribution differs between batch and streaming inference modes.** SwiftF0's reported pitch represents audio centered ~56 ms before the latest sample in the 1024-sample buffer. The Stage 4.5 streaming verification harness initially failed by 8 Hz mean error before correctly attributing inference output to that audio time. Production pipeline has the same 56 ms inherent latency, but it's invisible to users — DSP frames at time T see pitch from time T-56ms, which is just normal pitch-detection latency.

- **Validation regimes need to match production regimes.** Stage 3 standalone (single one-shot inference per track) and Stage 4.5 streaming (per-25 ms-hop streaming) measure subtly different things — the per-frame attribution drift is real and acceptable but needs to be accounted for in test criteria. Tests assuming exact-match between batch and streaming will surface false regressions.

- **Mobile WASM inference timing on the production runtime is the only ship-criterion that matters.** Stage 3 standalone numbers (Node native ORT, ~0.66 ms/inference) are an order of magnitude faster than browser WASM. Mobile WASM is another 2–3× slower than desktop browser WASM. Don't anchor ship decisions on Node ORT numbers; measure directly on the gating-constraint hardware.

**Measurement infrastructure preserved on main**:
- [tests/dsp/swift-f0-adapter.js](tests/dsp/swift-f0-adapter.js) — SwiftF0 ONNX inference adapter for Node (onnxruntime-node).
- [tests/dsp/pitch-bucket-harness-swift.js](tests/dsp/pitch-bucket-harness-swift.js) — SwiftF0 mirror of pitch-bucket-harness.js.
- [tests/dsp/swift-f0-threshold-sweep.js](tests/dsp/swift-f0-threshold-sweep.js) — confidence threshold sweep.
- [tests/dsp/swift-f0-streaming-verify.js](tests/dsp/swift-f0-streaming-verify.js) — Stage 4.5 streaming integration verification.
- [scripts/swift-f0-wasm-probe.js](scripts/swift-f0-wasm-probe.js) — desktop + mobile browser ORT-WASM latency probe via puppeteer-core / ADB+CDP.
- The four ruled-out fix-direction sweep harnesses (`pitch-bucket-{asymmetric,multi-mult,voicedness-transform}-sweep.js`) ship as durable infrastructure for any future pitch-detection investigation.

### Pitch voicedness gate fragmentation — resolved 2026-05-06 (PR #74; superseded by SwiftF0 cutover)

The pitch trace fragmented during continuous speech because the original gate (`intensity < SILENCE_THRESHOLD_DB || voicedness < VOICEDNESS_THRESHOLD` — OR) over-suppressed real-speech frames. Either arm could solo-fire on legitimate speech: intensity dipped below the threshold during inter-phoneme transitions, and pYIN's HMM-smoothed voicedness signal measures clean periodicity rather than voiced speech (real continuous speech sits structurally below the 0.5 threshold). PR #74 inverted the operator to AND so suppression requires both signals to agree on noise.

The AND-logic semantics carry forward into the SwiftF0 cutover (Stage 4); the upstream voicedness signal changed from pYIN's HMM-smoothed posterior to SwiftF0's per-frame confidence, but the gate operator and the 0.5 threshold are unchanged. SwiftF0's confidence has cleaner calibration (no ~0.5-on-silence quirk that pYIN had).

**Methodology lesson** (load-bearing for any future gate work): the synthetic 200 Hz fixture (`tests/audio/fixtures/voice-200hz-10s.wav`) cannot substitute for real-voice testing of gate calibration. Fake-device injection bypasses the mic chain entirely (different inputRms levels), and the fixture's clean harmonic structure produces a much higher voicedness response than real speech at the same RMS. Synthetic fixtures stay useful as clean-signal upper bounds; real-voice regression requires public-domain corpora (Hillenbrand attenuated to mic-chain inputRms levels via `--voice-file` injection — filed as separate followup).

Investigation history, capture-derived statistics, and detailed methodology notes preserved in the merged [PR #74](https://github.com/Alice-Sabrina-Ivy/Syrinx/pull/74) and the linked measurement files there.

### Perceived-voice gender model — investigation arc 2026-05-05/06 (resolved)

**Outcome (2026-05-06)**: Production gender model swapped from `prithivMLmods/Common-Voice-Gender-Detection-ONNX` (wav2vec2-base, ~95 M params, 100 % male / 81.3 % female on Hillenbrand) to `Alice-Sabrina-Ivy/voice-gender-classifier-onnx-q8` (JaesungHuh ECAPA-TDNN q8, ~15.4 M params, 95.6 / 95.8 — gender-symmetric). Single model on both platforms. Resolves the female-accuracy gap that motivated the investigation AND makes mobile inference 4.6 × faster (a separate finding from late-stage measurement).

**Investigation arc** — preserved here so future model evaluations don't re-derive these conclusions:

1. **PR #71 (2026-05-05)**: α=0.2 EMA tuning on prithivMLmods raised Hillenbrand female accuracy 62.5 → 81.3 %. Spent 480 ms of meter responsiveness to claw back ~19 pp female accuracy on the existing noisy model.
2. **Audeering 6L investigation (2026-05-05, retired)**: `audeering/wav2vec2-large-robust-6-ft-age-gender` evaluated as a candidate. Hillenbrand 100 / 100, but mobile inference 1154 ms median on Pixel 8 Pro / Chrome 147 — 7.7× over hop budget. Architecture: wav2vec2-large; desktop:mobile ratio ~21×. Branch [`perceived-voice-audeering-6l-integration`](https://github.com/Alice-Sabrina-Ivy/Syrinx/tree/perceived-voice-audeering-6l-integration) preserved as historical record. Conversion scripts + Hillenbrand test live there.
3. **JaesungHuh investigation (2026-05-06)**: ECAPA-TDNN architecture, smaller (~15.4 M params). Hillenbrand 95.6 / 95.8. Mobile inference 460 ms median — also over budget but ~2.5× faster than audeering. Branch [`perceived-voice-jaesunghuh-tdnn-investigation`](https://github.com/Alice-Sabrina-Ivy/Syrinx/tree/perceived-voice-jaesunghuh-tdnn-investigation) preserved. Conversion scripts + Hillenbrand test live there. Q8 ONNX uploaded to HF Hub at `Alice-Sabrina-Ivy/voice-gender-classifier-onnx-q8` (MIT license inherited from upstream).
4. **Platform-split exploration (2026-05-06, didn't ship)**: Designed and prototyped a UA-routing + first-inference probe to ship JaesungHuh on desktop and prithivMLmods on mobile. Built the measurement infrastructure (`mlInferences` ring + `mlModel` field in diag snapshot, attach-Chrome harness usage). **Stage 5 mobile measurement revealed the design assumption was wrong**: prithivMLmods on Pixel 8 Pro / Chrome 147 / WebGPU is ~2100 ms per inference — substantially slower than JaesungHuh's 460 ms on the same device. The platform-split was solving a non-problem (assumed mobile prithivMLmods was fast enough to justify the asymmetry; it isn't). Single-model JaesungHuh ship dominates on every metric.
5. **Resolution PR (this branch)**: Single-model swap. JaesungHuh on both platforms. Drops UA detection, probe, swap-model logic — none needed.

**Key methodology lessons** (transferable to future model investigations):

- **Measure inference time on the production runtime, not on Node ORT.** Hillenbrand sweeps via `node tests/ml/perceived-voice-hillenbrand-test.js` use Transformers.js with `onnxruntime-node` (native bindings), which is roughly 18× faster than `onnxruntime-web` (WASM). The 11 ms desktop median we initially claimed for JaesungHuh was a Node measurement; real browser ORT-WASM (via desktop-diag-capture-attach.js) showed 191 ms. Both numbers are correct for their measurement context, but ship decisions need browser-runtime numbers because that's what users get.

- **Architecture-runtime interaction matters.** Refining the earlier "ORT-WASM mobile-fitness lesson" from the audeering retirement: small models aren't necessarily fast on mobile WASM, and mobile-fast architectures aren't necessarily desktop-fast. The desktop:mobile ratio for ECAPA-TDNN is ~2.4× (191 → 460 ms), but for wav2vec2-base it's ~4.5× (462 → 2100 ms) on this device. wav2vec2-large was ~21×. The runtime's optimization profile per architecture is more load-bearing than parameter count.

- **Don't assume "the current ship works" without direct measurement.** The platform-split design's core assumption was that prithivMLmods runs fast enough on mobile to justify shipping it there. That assumption was inherited from the model's reputation, not measured directly on Pixel 8 Pro Chrome 147. When we finally measured it (Stage 5 Mobile A test), it ran at 2100 ms per inference — barely usable. The current production ship has been degraded on mobile for some time without anyone noticing because nobody measured. Lesson: when about to ship a new model alongside the existing one, measure BOTH on the production runtime, not just the new candidate.

- **Don't transfer thresholds across decision contexts.** The "250 ms threshold" from the original Stage 4 framework was for a different decision (mobile q8-ONNX feasibility against the 150 ms hop budget). When we re-applied it for the platform-split fallback probe, it fired prematurely on every desktop session because the relevant boundary isn't "is inference within hop budget" but "is JaesungHuh perf on this device mobile-class." Different decisions need separately-anchored thresholds.

**Measurement infrastructure preserved on main**:
- `mlInferences` ring + `pushMlInference` + snapshot field in [src/diag/diag.js](src/diag/diag.js) — landed in PR #72.
- `mlModel` field in snapshot (modelId + ORT backend that succeeded) — added in this swap PR; useful for any future model evaluation.
- `--model=<HF_id>` parameter in [tests/ml/perceived-voice-hillenbrand-test.js](tests/ml/perceived-voice-hillenbrand-test.js) — run any model against the corpus without modifying the worker.
- Conversion scripts on the JaesungHuh branch (`scripts/export-jaesunghuh-onnx.py` + quantize + verify) are reproducible and can be cherry-picked or re-derived for a future ECAPA-TDNN candidate.

**Known borderline samples** (carry forward to future investigations): m45 misclassifies under any α value tested across both audeering 6L and JaesungHuh — model architecture properties, not model-quality issues. Don't re-litigate these in future evaluations; treat them as the calibration noise floor.

**HF Hub `wav2vec2` tag is wrong but load-bearing**: The repo at `Alice-Sabrina-Ivy/voice-gender-classifier-onnx-q8` has HF Hub auto-tagging the model card with "wav2vec2" because `config.json` sets `model_type: "wav2vec2"` and `architectures: ["Wav2Vec2ForSequenceClassification"]`. The actual architecture is ECAPA-TDNN. The wav2vec2 setting is a deliberate misrepresentation: Transformers.js's audio-classification pipeline routes off `model_type`, and `tdnn`/`ecapa-tdnn` aren't registered types. Setting `model_type: "wav2vec2"` makes Transformers.js use its `Wav2Vec2ForSequenceClassification` JS class, which is a thin ONNX wrapper that doesn't care about the actual architecture in the graph. If the field is changed, production breaks at `pipeline()` load time. Cosmetic-tag-vs-load-bearing tradeoff: leave config.json as-is.

## Deployment

GitHub Actions (`.github/workflows/deploy.yml`) builds and deploys to GitHub Pages on push to `main`. Build output goes to `docs/`. Vite base path is `/Syrinx/` (uppercase S). See ARCHITECTURE.md for the full design document and implementation roadmap.
