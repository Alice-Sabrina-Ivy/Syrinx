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
| Pitch detection | Boersma-AC (Praat-style window-corrected autocorrelation + bounded-Viterbi path tracker), pure JS, [src/dsp/boersma-ac.js](src/dsp/boersma-ac.js) in [src/dsp/pitch-worker.js](src/dsp/pitch-worker.js). ~0.2 ms/frame, no model fetch. Config: fl 1280 (80 ms), vt 0.35, oc **0.015**, path {ojc 0.15, vuc 0.20, L 2}. **Octave arbitration** `octaveEvidence` (2026-10-03): for each (f, 2f) candidate pair, odd-vs-even partial *prominence* from the frame's own power spectrum — f −0.05 when its odd multiples are absent (≤ −15 dB), partner 2f −0.03 when they are as prominent as the evens (≥ −3 dB); only partners ≤ 420 Hz (`maxPartnerHz`, coupling with the 800 Hz search). **Silence-term reference** (`globalPeak`) gated: only periodic frames (best r ≥ 0.35) contribute, as 1.2 × the 5th-largest of the last 12 frame peaks — a click/pop/bump can no longer latch it and blank a quiet mic for 30–50 s | 2026-06-09 (replaced SwiftF0 ONNX); re-tuned at deployed operating point 2026-07-19; octave arbitration + oc 0.015 + gated reference 2026-10-03 | [boersma-ac-tuning-2026-06-09.md](measurements/boersma-ac-tuning-2026-06-09.md), [pitch-l2-retune-2026-07-19.md](measurements/pitch-l2-retune-2026-07-19.md), [pitch-octave-arbitration-2026-10-03.md](measurements/pitch-octave-arbitration-2026-10-03.md), [pitch-globalpeak-transient-2026-10-03.md](measurements/pitch-globalpeak-transient-2026-10-03.md) |
| Pitch search + display range | Display/reported range 75–400 Hz (`PITCH_DISPLAY_RANGE`); detector searches 75–**800** Hz (2× the display ceiling) and the pitch worker posts any decode above 400 as **unvoiced** (`pitch: null`, confidence < 0.5; after the ghost veto, before the harmonic guard) — phonation above 400 Hz can no longer alias to a confident half-pitch value (user's true >400 Hz frames painted at half 43 % → 6 %, measured alone). Trace rendering clipped to plot rect. Top-edge octave-down candidate-scan bug fixed 2026-07-19 (guarded at 396–400 and 796–800 Hz) | floor 2026-06-10 (60→75); ceiling 2026-10-03 (400→800 search) | commit ceaa855; [pitch-ceiling-2026-10-03.md](measurements/pitch-ceiling-2026-10-03.md); [pitch-l2-retune-2026-07-19.md](measurements/pitch-l2-retune-2026-07-19.md) |
| Pitch latency + session accuracy | L=2 decode delay → ~90 ms worker-level display latency (40 ms window center + 50 ms decode); displayed-trace effective attribution ~112–120 ms incl. median-3 lag. **Session accuracy, combined 2026-10-03 chain (session oracle, real worker + real hook, consensus refs, Alice, pooled 4 sessions / held-out 06-09):** target band 160–400 Hz decoded 91.7 % correct / 5.4 % half (held-out 89.8 / 5.0; was 88.4 / 8.9, 84.7 / 10.3), **displayed 78.6 % correct / 3.8 % half / 14.6 % blank** (held-out 72.3 / 2.5 / 20.5; was 58.5 / 6.4 / 32.7, 48.5 / 7.1 / 40.2), readout half 15.9 → 3.8 %; low→target switch shown correct a median 50 ms into the new register's audio (never-shown 49 → 5 %) — content-time, i.e. on top of the ~110–120 ms display latency the alignment removes, so ≈ 160–170 ms wall-clock (was 380 ms content-time); low band 75–160 Hz displayed 89.5 % correct (was 87.2). Strict R1&CC gives the same picture (target displayed 61.8 → 82.9 %). **Two worker-level guards fail and await a human decision** (Alice 75–160 octave-up +0.39 pp under strict refs; Hillenbrand men worker correct −0.77 pp from the 800 Hz search) — §Residuals | latency 2026-07-19; accuracy 2026-10-03 | [pitch-l2-retune-2026-07-19.md](measurements/pitch-l2-retune-2026-07-19.md), [target-voice-combined-validation-2026-10-03.md](measurements/target-voice-combined-validation-2026-10-03.md) |
| Silence gate | AND-logic in [src/audio/pitchGate.js](src/audio/pitchGate.js): intensity < −50 dB AND confidence < 0.5, ≥3 consecutive frames | PR #74 semantics, module extracted later | PR #74 |
| Pitch display (paint) gate | [src/audio/pitchPaintGate.js](src/audio/pitchPaintGate.js): level-based octave-excursion gate (off-level = ≥ `EXCURSION_SEMI` 9.5 st from the median of recent painted values; accepted as a new register after `EXCURSION_SUSTAIN` **8** consistent frames mid-segment). **Register re-acquisition** (2026-10-03): after ≥ 2 frames without a fresh pitch, 4 consistent off-level frames accept the new register during the first 8 painted frames (level kept, so 2–3-frame onset locks stay suppressed; since 2026-10-04 the level ring is padded with the accepted run's median so the frame right after an accept is gated too — before, it painted ungated, octave errors included); **held** values (400 ms pitch hold) are pushed `fresh: false` and never feed the gate. Octave-class line break in `pitchTraceRef` (no connecting spike line by construction); readout/note show "—" instead of the other register's last value while a fresh off-level pitch is suppressed; frames store `painted` and SessionHistory draws the frames that are both voiced and painted (hold-bridged frames are recorded unvoiced, so they are gaps in history — §Canvas) | gate 2026-06-10; glide window 2026-07-19; re-acquisition 2026-10-03; post-accept level 2026-10-04 | [pitch-excursion-break-2026-06-10.md](measurements/pitch-excursion-break-2026-06-10.md), [paint-gate-glide-window-2026-07-19.md](measurements/paint-gate-glide-window-2026-07-19.md), [pitch-display-gate-redesign-2026-10-03.md](measurements/pitch-display-gate-redesign-2026-10-03.md) |
| Tonal-noise notch + voicing guards | Persistent-peak notch [src/dsp/noise-notch.js](src/dsp/noise-notch.js) on the pitch worker's 16 kHz stream: narrow 50–460 Hz peaks stable ≥ 5 s at ≥ 90 % duty promote (≤ 4 notches, Q 30); a track **born at a sound onset or inside a sound that began at one** (in-sound latch: band energy ≥ 10 dB over its 2 s minimum at 25 ms or 512 ms resolution, held until back near the pre-onset floor for 0.3 s) needs **20 s** since the note's latest start (the 20 s clock restarts — duty history kept — at the latch release or at a ≥ 20 dB sound offset with the line gone; a > 3 Hz pitch move inside the sound also counts as a new start) — so a note started after the stream's first audio is not notched within 20 s even through glides/steps, straight out of speech, or across repeated same-pitch holds with breaths; NOT covered: phonation already sounding in the stream's first chunk (same signal as a hum present at start, which keeps 5 s); trade: an interferer switching on during dense speech now takes ~20 s like any switch-on (shipped promoted it at ~5 s when no 10 dB dip preceded it); seen-to-promote; cascade keyed by track id, retuned in place. **Ghost veto** (narrowed 2026-10-03): a decode within max(2 %, 6 × wobble) of an active line *or its octave* → unvoiced (was ±4 % at f/2, f, 2f — blanked both of the user's registers under a 120 Hz hum). Then the harmonic voicing guard (≥ 2 harmonics @ 10 dB, debounce 4; unchanged) | notch 2026-07-19; guard 2026-07-20; voice-safety pass 2026-10-03; held-note robustness 2026-10-04 | [noise-robustness-oracle-2026-07-19.md](measurements/noise-robustness-oracle-2026-07-19.md) (tonal rows: see its 2026-10-03 note), [noise-notch-voice-safety-2026-10-03.md](measurements/noise-notch-voice-safety-2026-10-03.md) (see its 2026-10-04 correction), [noise-notch-held-note-robustness-2026-10-04.md](measurements/noise-notch-held-note-robustness-2026-10-04.md) |
| Perceived gender | JaesungHuh ECAPA-TDNN q8-**v2** (`Alice-Sabrina-Ivy/voice-gender-classifier-onnx-q8-v2`, ~15.4 M params, MIT; exclude-matmul re-quantization — 100/100 Hillenbrand, 0/93 uncertain-band, ~10× lower per-window noise than the retired `-q8` v1), single model on all platforms. Backend: WASM (WebGPU dropped 2026-07-19 — 4.7× slower + broken); desktop ~52 ms/inference at ~6.2 Hz cadence; mobile WASM measurement waived by user, guard degrades gracefully | model 2026-05-06, v2 + backend + cadence 2026-07-19 | [INVESTIGATIONS.md §gender](INVESTIGATIONS.md), [gender-model-latency-2026-07-19.md](measurements/gender-model-latency-2026-07-19.md) |
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

- **Pitch chain end-to-end** (any change to the pitch worker, its modules, `pitchGate.js` / `pitchSmoothing.js` / `pitchPaintGate.js` or the hook's pitch path): the session oracle [scripts/session-oracle/](scripts/session-oracle/README.md) — drives the REAL pitch worker, DSP worker and `handleAnalysisResult` over the four private-session sessions and the corpora; extract the baseline with `git archive <rev> src`, run `run.mjs` + `corpus.mjs` for both trees, compare with `analyze.py base head` / `corpus.mjs --report=base,head` (target, low, ≥400 bands at decoded/posted/painted/readout; switches; spikes; male/female corpora).
- **Pitch detector** (`boersma-ac.js`, `pitch-worker.js`): `node tests/dsp/boersma-ac-test.js` (frame-level guard incl. the weak-H1 case that motivated the cutover and the 2026-10-03 transient / octave-arbitration / search-ceiling cases), `node tests/dsp/pitch-worker-above-range-test.js` (drives the REAL worker: decodes above 400 Hz post unvoiced, never at half). Corpus-level accuracy claims need the shootout harnesses (`scripts/pitch-shootout-extract.js` + `scripts/pitch-shootout-analyze.py`); parameter sweeps use `scripts/ac-tuning-sweep.js`; displayed-accuracy attribution uses `scripts/pitch-accuracy-decompose.js`.
- **Noise notch / ghost veto** (`noise-notch.js`): `node tests/dsp/noise-notch-test.js` (promotion timing, onset-born delay, seen-to-promote, stable keying, narrow veto, held notes at 120/220 Hz through the real worker, and since 2026-10-04 the in-sound latch / new-note re-birth cases — mid-hold glide + step, speech → hold, phonation 0.15 s after stream start, 3 × 10 s holds with silent and audible breaths — plus interferer promotion guards). Corpus-level tonal-noise claims: `node scripts/noise-augment-oracle.js pitch --frontend=tracker` (runs the notch per chunk + ghost veto + above-range null + guard exactly as the worker since 2026-10-03; flushed tail frames too since 2026-10-04).
- **Silence gate / trace painting**: `node tests/audio/pitch-gate-test.js`, `node tests/audio/pitch-paint-gate-test.js`, `node scripts/paint-gate-glide-validate.js --skip-session` (synthetic glide / harmonic-lock scenarios; contract: locks shorter than `EXCURSION_SUSTAIN` never paint)
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

3. **Pitch Worker** ([src/dsp/pitch-worker.js](src/dsp/pitch-worker.js)) — hosts the Boersma-AC detector ([src/dsp/boersma-ac.js](src/dsp/boersma-ac.js)): Praat-style window-corrected autocorrelation + bounded-Viterbi path tracker. Pure JS, ~0.2 ms/frame, no model fetch. Resamples chunks to 16 kHz, runs them through the persistent-peak tonal-interferer notch ([src/dsp/noise-notch.js](src/dsp/noise-notch.js), 2026-07-19 — notches spectral peaks that stay frequency-stable >=5 s at >=90 % duty; since 2026-10-03 a track born at a sound onset needs 20 s, and since 2026-10-04 so does any track born inside a sound that began at one (in-sound latch), timed from the note's latest start — held notes, glides, speech-into-hold and repeated holds are not notched within 20 s of that start unless phonation was already sounding in the stream's first chunk (holds ≥ 20 s can still be notched; an interferer switching on mid-session, also during dense speech, takes ~20 s), [noise-notch-held-note-robustness-2026-10-04.md](measurements/noise-notch-held-note-robustness-2026-10-04.md)), keeps a rolling 1280-sample (80 ms) buffer, evaluates per 25 ms chunk; the L=2 path decode adds 50 ms (~90 ms worker-level display latency; L=4 scores ~0.3 pp better at higher latency — L chosen deliberately for responsiveness). Detector config: search 75–800 Hz (2× `PITCH_DISPLAY_RANGE.high`, [pitch-ceiling-2026-10-03.md](measurements/pitch-ceiling-2026-10-03.md)), voicingThreshold 0.35 (fl/vt re-tuned at the deployed operating point 2026-07-19, [pitch-l2-retune-2026-07-19.md](measurements/pitch-l2-retune-2026-07-19.md)), octaveCost 0.015 + odd/even partial-prominence octave arbitration for (f, 2f) candidate pairs with partners ≤ 420 Hz (the target-voice half-pitch fix, [pitch-octave-arbitration-2026-10-03.md](measurements/pitch-octave-arbitration-2026-10-03.md)), silence-term reference gated to periodic frames via a rank statistic so transients can't latch it ([pitch-globalpeak-transient-2026-10-03.md](measurements/pitch-globalpeak-transient-2026-10-03.md)). Post-decode, in this order: ghost veto (decode within max(2 %, 6 × wobble) of an active notch line or its octave → unvoiced), above-range null (decode > `PITCH_DISPLAY_RANGE.high` → unvoiced; before the guard so spurious high decodes never build its fail streak), harmonic voicing guard (debounced ≥ 2-harmonic check on the decoded frame's own buffer). Posts `{ pitch, confidence, voiced, ts, contextTime, inferMs?, notchedFreqs? }` preserving the invariant **pitch ≠ null ⟺ confidence ≥ 0.5** that the silence gate relies on. The "ready" status posts `{ detector: "boersma-ac", device: "js", threshold }` so diag snapshots record the backend. Replaced SwiftF0 ONNX 2026-06-09 (which replaced pYIN 2026-05-06) — arcs in [INVESTIGATIONS.md](INVESTIGATIONS.md).

4. **ML Worker** ([src/ml/gender-worker.js](src/ml/gender-worker.js)) — Transformers.js audio-classification pipeline. Production model: `Alice-Sabrina-Ivy/voice-gender-classifier-onnx-q8` (JaesungHuh ECAPA-TDNN q8 export, ~15.4 M params, MIT). Resamples to 16 kHz ([src/ml/audio-utils.js](src/ml/audio-utils.js)), 0.75 s rolling window, inference every 150 ms design target, peak-VAD gates silent windows, EMA-smooths the score (α=0.2), resets after a sustained silent run. Posts `{ score: 0–100, confidence, ts, inferMs? }`. "ready" status includes `modelId` and `device` ("webgpu"/"wasm"). Pure helpers in audio-utils.js are unit-testable without booting the worker.

5. **Main thread** ([src/audio/useAudioPipeline.js](src/audio/useAudioPipeline.js)) — React hook managing AudioContext / DSP / pitch / ML worker lifecycle; merges pitch-worker output into each DSP frame via `latestPitchRef` (nearest-neighbor temporal alignment, both at 25 ms cadence so lag ≤ 1 chunk); smoothing (rolling median — 3-window for pitch via [src/audio/pitchSmoothing.js](src/audio/pitchSmoothing.js), reduced 5→3 on 2026-07-19 since the Viterbi tracker suppresses single-frame flips upstream; formants median-smoothed with >500 Hz jump rejection); silence gating (5-second hold); history exposed via Refs for canvas rendering; setState throttled to ~5 fps for text readouts only.

   **Silence gate** ([src/audio/pitchGate.js](src/audio/pitchGate.js)): a frame is suppressed only when intensity < `SILENCE_THRESHOLD_DB` (−50 dB) AND pitch confidence < `CONFIDENCE_THRESHOLD` (0.5), for ≥ `SILENCE_DEBOUNCE_FRAMES` (3) consecutive frames. AND-logic is intentional (PR #74): both signals must agree on "noise"; either solo would over-suppress real speech. Pre-warmup frames (confidence null) fall back to intensity-only gating.

   **Paint gate** ([src/audio/pitchPaintGate.js](src/audio/pitchPaintGate.js)): decides WHEN a smoothed pitch is drawn, never alters the value. 3-frame onset confirmation; a value ≥ `EXCURSION_SEMI` (9.5 st) from the established level (median of recent painted values) is suppressed as an octave-class excursion unless it sustains a consistent new level — `EXCURSION_SUSTAIN` (8) frames mid-segment, or `REACQUIRE_SUSTAIN` (4) frames within the first `REACQUIRE_WINDOW` (8) painted frames after ≥ `REACQUIRE_GAP_FRAMES` (2) frames without a fresh pitch (register switch between words; 2026-10-03). An accept reseeds the level with the accepted run, padded to the 5 values the level needs with the run's median (2026-10-04: a 4-frame re-acquisition left the level undefined for one frame, which then painted ungated — octave-class line breaks drawn on the sessions −44 %). Values bridged by the 400 ms pitch hold are pushed `{ fresh: false }`: they may paint on-level but never move the level or count toward a register change. The hook inserts a gap entry before any painted point ≥ `EXCURSION_SEMI` from the previous one (octave-class line break), and while the gate suppresses a fresh off-level pitch (`lastReason() === "offlevel"`) the readout/note name show "—" instead of the last painted value (which on a register switch is the other register — the "readout an octave low" report). Frame-callback payloads carry `painted`; session stats keep using `voiced`/`f0` ([pitch-display-gate-redesign-2026-10-03.md](measurements/pitch-display-gate-redesign-2026-10-03.md)).

### Canvas Visualization Strategy

History arrays live in Refs (not React state), read directly by `requestAnimationFrame` loops. Avoids React re-renders. All canvases use ResizeObserver + devicePixelRatio scaling.

- **PitchTrace** — 15-second scrolling pitch waveform with target band. Plot range 75–400 Hz = the reported pitch range: the detector floor matches it (2026-06-10: the floor was raised 60→75 rather than widening the display, after sub-75 Hz detections painted under the chart; corpus cost negligible) and the worker posts decodes above 400 as unvoiced (2026-10-03; the detector searches to 800 so above-range phonation is recognized instead of aliasing to half pitch). Rendering is clipped to the plot rect in both PitchTrace and SessionHistory (stored pre-change frames can hold sub-75 Hz F0). The paint gate (§Main thread) suppresses octave-class excursions and re-acquires a new register promptly after a gap; an octave-class line break means a painted register change starts a new segment rather than a near-vertical connecting line ([pitch-excursion-break-2026-06-10.md](measurements/pitch-excursion-break-2026-06-10.md), [pitch-display-gate-redesign-2026-10-03.md](measurements/pitch-display-gate-redesign-2026-10-03.md)). SessionHistory draws only frames recorded both `voiced` and `painted` (legacy frames without the field draw as before), with the same octave break — so octave excursions the live gate suppressed are gaps in history too, but history is **not** an exact replica of the live trace: frames the live trace bridged with the 400 ms pitch hold are recorded `voiced: false` (stats must not count stale pitch) and draw as gaps — 29 % of live-painted hops on the four private-session sessions, gaps median 100 ms / p90 400 ms (2026-10-04 session-oracle count; corrects the 2026-10-03 "history matches what was shown live").
- **ResonanceMeter** — vertical thermometer titled "Perceived voice" for the ML score (0–100), reading `genderTraceRef`. Warm→cool gradient fill; faint bands mark masculine 0–30 / feminine 70–100; glowing indicator tweens via exponential lerp with opacity scaled by confidence; right-side history strip of last ~10 inferences; big number readout with score-range subtitle. The middle uncertain range collapses with the classifier's low-confidence region because confidence is by construction `|score − 0.5| × 2`. Replaced ResonanceScoreTrace + ResonanceGauge; an earlier hand-crafted vowel-normalized formula (`src/utils/resonanceScore.js`) was replaced because raw-formant geometry doesn't reliably model perceived gender.
- **VocalWeightGauge** — horizontal bar driven by CPP ([src/dsp/cpp.js](src/dsp/cpp.js)). Zero interaction: sliding ring of the last ~30 s of voiced CPP-aggregate emits (120 samples at 250 ms cadence); "Calibrating: N%" during fill; then displays σ-distance of current voice from the recent window, recomputing μ/σ per emit. Per-session calibration, no persistence. Sample-rate-invariant (internal resample to 16 kHz; cross-rate spread < 0.03 dB; Praat correlation r=0.64 PTDB / r=0.71 FDA). Arc: [measurements/vocal-weight-stage-c-implementation-2026-05-12.md](measurements/vocal-weight-stage-c-implementation-2026-05-12.md).
- **CombinedDashboard** — main practice view composing the above + session recording logic.

### Data Persistence

[src/db.js](src/db.js) defines a Dexie (IndexedDB) schema: **settings** (preferences, target ranges), **sessions** (summary stats), **frames** (raw per-frame metrics; since 2026-10-03 each frame also carries the live paint-gate decision `painted` — a non-indexed field, no schema bump), **exerciseResults** (stubbed). Schema is at v2; v2 is a `null`-drop of a short-lived `vocalWeightCalibration` table from the 2026-05-12 same-day revert (Dexie monotonic versioning requires the entry).

### UI Components

- **SessionHistory** ([src/components/SessionHistory.jsx](src/components/SessionHistory.jsx)) — past-sessions browser with expandable detail cards
- **DataManagement** ([src/components/DataManagement.jsx](src/components/DataManagement.jsx)) — settings panel: recording toggle, export/import, delete data

### Entry Points

`index.html` → `src/main.jsx` → `src/App.jsx` (three tabs: dashboard, pitch, history + welcome overlay + settings panel). Capture processor loaded dynamically from `public/`; workers spawned as module workers.

### Utilities

- [src/utils/constants.js](src/utils/constants.js) — target ranges, display ranges (`PITCH_DISPLAY_RANGE` 75–400 = the reported range; detector floor matched, detector search ceiling 2× — raising `high` means raising `maxPitchHz` too), time windows, colors
- [src/utils/pitchUtils.js](src/utils/pitchUtils.js) — Hz → musical note mapping

### Key Design Decisions

- Direct capture→Worker MessagePort communication, zero main-thread audio relay; capture broadcasts to a consumer-port list so DSP, pitch, and ML all receive raw audio.
- Pitch detection runs per 25 ms chunk at 0.21 ms/frame (pure JS — no ONNX runtime or model fetch on the pitch path since 2026-06-09). Confidence threshold 0.5 gates pitch reporting AND seeds the silence gate's voicedness arm by design (single threshold, no ambiguous middle band).
- LPC formant extraction throttled to every 6th frame (~200 ms); uses the main-thread-relayed `pitch-hint` for male-vs-female LPC order (one-frame lag acceptable — formants change slowly).
- ML gender inference: ~6.7 Hz design target over a rolling 0.75 s window. Runs on **WASM deliberately, not WebGPU** (2026-07-19: the WebGPU path "succeeds" at session creation but throws runtime WebGPU validation errors and measures 4.7× slower — production-path 249 ms vs 52 ms desktop median; the old "~190 desktop / ~460 mobile" figures were WebGPU numbers). Desktop now fits the hop budget (~6.2 Hz measured; hop timed start-to-start since 2026-07-19 — end-to-start timing made the real period 150 ms + inferMs). Mobile WASM unmeasured — the `inferenceInProgress` guard still drops overruns so the meter degrades gracefully wherever inference exceeds the hop. Decision data: [gender-model-latency-2026-07-19.md](measurements/gender-model-latency-2026-07-19.md). Two-arm VAD (2026-07-19): peak amplitude (peak, not RMS, so speech-with-pauses windows pass) AND pitch-voicedness recency — the main thread relays each pitch message as a `pitch-hint` and windows without voiced pitch in the trailing 500 ms are skipped (noise-only windows passed the peak arm 100 % of the time and dragged the EMA masculine; fails OPEN if the pitch feed stales >2 s). EMA α=0.2 (~750 ms time-constant; higher α produced smoothing-artifact misclassifications on borderline Hillenbrand samples). Smoothed score resets after ~2 s of silent inferences. `femaleScoreFromResult` parses by label name only (JaesungHuh id2label is `{0:male, 1:female}` — opposite of the prior model) and returns null on unrecognized labels, so a future model swap can't silently invert the meter.
- Resampling for workers is linear interpolation, not polyphase FIR — speech energy above 8 kHz is minimal and the browser already low-passes mic input.
- Rolling-median smoothing for outlier robustness; silence gating holds last voiced values 5 s, then resets; session frames buffered in memory, flushed to IndexedDB every 1 s; target ranges hardcoded in constants.js.
- **HF Hub `wav2vec2` tag on the gender model is wrong but load-bearing**: `config.json` at `Alice-Sabrina-Ivy/voice-gender-classifier-onnx-q8` deliberately sets `model_type: "wav2vec2"` (actual architecture: ECAPA-TDNN) because Transformers.js routes pipelines off `model_type` and `ecapa-tdnn` isn't a registered type. **Changing the field breaks production at `pipeline()` load time.** Leave it.

## Measurements & empirical results

Tuning sweeps, latency benchmarks, and other measurement artifacts live in `measurements/` at the repo root (NOT `docs/` — that's Vite build output, overwritten on deploy).

- **Naming:** `<topic>-<kind>-<YYYY-MM-DD>.{md,csv,txt}`
- **Belongs here:** baselines captured before tuning work, sweep results, latency/throughput measurements, before/after comparisons for any empirically-driven change.
- **Does NOT belong here:** ad-hoc debugging logs, test fixtures (stay in `tests/`), production code.

### Current oracles

- **Pitch:** **`scripts/session-oracle/`** (canonical end-to-end: real worker + real DSP worker + real hook on the private-session sessions — consensus and strict R1&CC refs, Alice/second voice, every stage incl. readout, register switches, spike events — plus the corpora through the same chain; bit-exact vs the phase-1 chain harness; decision data for the 2026-10-03 combined chain, [target-voice-combined-validation-2026-10-03.md](measurements/target-voice-combined-validation-2026-10-03.md)), `tests/dsp/boersma-ac-test.js` (frame-level, incl. the weak-H1 case), `scripts/pitch-shootout-extract.js` + `scripts/pitch-shootout-analyze.py` (corpus-level, fair per-detector attribution), `scripts/ac-tuning-sweep.js` (parameter sweeps), `scripts/pitch-accuracy-decompose.js` (displayed-accuracy attribution incl. smoothing lag — does NOT model the 400 ms pitch hold or the above-range null), `tests/dsp/pitch-worker-above-range-test.js` (real-worker contract), `scripts/noise-augment-oracle.js` (tonal/broadband noise; production-exact chain since 2026-10-03). Harnesses that build the chain from `createBoersmaAC` defaults (`ac-tuning-sweep`, `pitch-shootout-extract`, `pitch-accuracy-decompose`, `voicing-robustness-shootout`, `pitch-excursion-*`, …) now search to 800 Hz without the worker's above-range null — add the one-line null (or pass `maxPitchHz: 400` to reproduce historical numbers) before their next use ([pitch-ceiling-2026-10-03.md](measurements/pitch-ceiling-2026-10-03.md) §10). SwiftF0-era harnesses (`pitch-bucket-harness-swift.js`, `swift-f0-streaming-verify.js`, `swift-f0-threshold-sweep.js`, `swift-f0-adapter.js`) remain runnable for cross-detector comparisons; `swift-f0-streaming-verify.js` is still in `npm run test:dsp`.
- **Pitch vs other trackers:** [scripts/pitch-benchmark/](scripts/pitch-benchmark/README.md) — Syrinx (real worker + hook) head-to-head with Praat AC/CC, pYIN, PENN, CREPE and SwiftF0 on FDA / PTDB-TUG / vocadito / Hillenbrand (mir_eval-style metrics, per-detector offsets) and on the private-session sessions under non-circular reference conventions, plus CPU per second of audio ([pitch-detector-benchmark-2026-10-04.md](measurements/pitch-detector-benchmark-2026-10-04.md)).
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
- **The "m45 calibration noise floor" was quantization damage** (2026-07-19): m45 misclassified under every *q8-quantized* model/α — at fp32 (and under the matmul-excluded re-quantization) it classifies correctly and confidently. Lesson: before declaring a sample an architecture-independent floor, check the quantized-vs-fp32 axis too.
- **Score the user's actual registers** (2026-10-03): the session metric behind the 2026-06-09 and 2026-07-19 pitch tunes scored only Alice's 80–110 Hz band — the register she trains AWAY from. That 80–110 Hz-only metric hid the half-pitch errors in the 160–400 Hz target band — the register the tool exists for: decoded half-pitch 8.9 % pooled, 0.4–23.6 % by session (consensus refs, Alice; displayed half 6.4 % with 32.7 % blank, readout half 15.9 %; [target-voice-combined-validation-2026-10-03.md](measurements/target-voice-combined-validation-2026-10-03.md) §2). Ship metrics for this user population must cover the low (safety) register, the target register and register switches, under the gender-symmetric guards.
- **Reference selection bias** (2026-10-03): a "strict" reference that keeps only frames where an AC-family tracker agrees with another estimator drops exactly the frames where AC-family methods fail (octave-ambiguous breathy target voice), so it understates an AC detector's error. Use a majority across method families (AC / SHS / neural) plus a spectral odd-multiple arbiter on octave disputes as the primary reference, and report a second convention as sensitivity.
- **Committed oracles must mirror the shipped chain** (2026-10-03): `noise-augment-oracle.js` omitted the ghost veto (its tonal rows over-stated production: FDA fan-hum +10 dB 85.5 % reported vs 69.3 % production-exact), and `pitch-accuracy-decompose.js` omits the 400 ms hold. Before trusting an oracle number, drive the real worker / hook on the same input and confirm bit-exact parity (each 2026-10-03 workstream did; the two oracles above did not).

## Known issues / future work

### MSTP runtime fallback to AudioContext

`pickKind()` is feature detection, not runtime validation — if a browser detects-as-supported but the MSTP path fails at runtime (constructor exists, `readable.getReader()` errors or first frame never arrives), the pipeline hard-fails: no fallback, and the 5 s first-frame timeout surfaces a misleading "microphone access denied". **Practical risk: low** (no wild reports; validated on Chrome desktop + Android 147). Candidate failure surfaces: future Chrome, Firefox-mobile when it gains main-thread MSTP, Safari (has MSTP, never validated here). **Approach when addressed:** try/catch around the MSTP first-frame await; on failure, close cleanly and re-attempt `_createAudioContextSource` on the same `MediaStream`; surface the fallback in the diag overlay. Origin: Codex review on PR #69.

### Pitch detection of periodic non-speech content (fan hum, mechanical rumble)

**Mitigated (2026-07-19 notch + 2026-07-20 guard; voice-safety pass 2026-10-03).** Stationary tonal interferers are notched by the persistent-peak notch ([src/dsp/noise-notch.js](src/dsp/noise-notch.js)); a narrow ghost veto blanks decodes within max(2 %, 6 × wobble) of an active line or its octave (the notch rarely removes an interferer completely — unpromoted harmonics, wobble, rumble — and the residual is periodic at the line); the harmonic voicing guard caps sustained non-harmonic voicing at ~100 ms; the ML VAD gates on pitch voicedness. Production-exact FDA speech-in-noise at +10 dB: fan-hum 69.3 → 77.8 %, mains 65.1 → 77.9 % with the 2026-10-03 narrowing, every committed noise class at the previous false-voicing level ([noise-notch-voice-safety-2026-10-03.md](measurements/noise-notch-voice-safety-2026-10-03.md)). **Held notes (2026-10-04 precise form)**: a note started after the stream's first audio is not notched within 20 s of its latest start — through mid-note glides/steps, straight out of speech, and across repeated same-pitch holds with silent or audible breaths (in-sound latch + new-note re-births; the 2026-10-03 "≤ 20 s holds are never notched" held only for holds that start after silence and stay within ±3 Hz — 66–77 % reported otherwise, [noise-notch-held-note-robustness-2026-10-04.md](measurements/noise-notch-held-note-robustness-2026-10-04.md)). Background hums present before the voice keep the 5 s promotion. Residuals: phonation already sounding in the stream's first chunk is indistinguishable from a hum present at start (5 s, then blanked); a note held ≥ 20 s can still be notched and lose its tail (breathy holds go blank once notched); an interferer that switches on mid-session is notched after ~20 s instead of ~5 s and its line paints in speech pauses meanwhile — since 2026-10-04 also when it switches on during dense speech (synthetic probe: a 120 Hz fan at +5 dB under a 210 Hz voice, 72.7 → 27.5 % correct over the 30 s after switch-on); voice within ±2 % of an active line or its octave is still vetoed (frame-locally indistinguishable from the residual); non-stationary tonal sources (speed-varying fans) evade the stability criterion; rich-hum noise-only windows pass the gender VAD 100 % (pre-existing); the inter-harmonic guard floor (+4 pp low-band decoded) is deferred because it raises target-band half-pitch; field-recorded-noise validation pending.

**Historical (superseded 2026-10-03):** **Largely mitigated 2026-07-19** by the persistent-peak notch ([src/dsp/noise-notch.js](src/dsp/noise-notch.js), in the pitch worker): stationary tonal interferers (frequency-stable >=5 s at >=90 % duty) are notched before analysis — measured false-voicing on fan-hum noise-only audio 100 % -> 0-1 %, and the ML VAD additionally gates on pitch voicedness so noise-only windows stop feeding the gender EMA ([noise-robustness-oracle-2026-07-19.md](measurements/noise-robustness-oracle-2026-07-19.md)). A harmonic-structure voicing guard (2026-07-20, `createHarmonicVoicingGuard` in boersma-ac.js — SWIPE-flavored, selected by the voicing-robustness shootout over YIN-CMNDF and HNR vetoes) caps sustained non-harmonic voicing at ~100 ms: noise-only false-voicing ≤0.7 % for every synthetic class, gender noise-only VAD pass 0 %. Residuals: non-stationary tonal sources (varying-speed fans) evade the notch's stability criterion; field-recorded-noise validation pending. (The 2026-07-19 tonal speech-accuracy numbers came from an oracle that omitted the ghost veto — see the dated note in that file's §7. The ±4 % veto also blanked held notes once the notch promoted them after ~5 s.)

**Historical (superseded 2026-07-19):** The silence gate treats periodic harmonic content above threshold as voiced — it can't distinguish "voice" from "tonal noise". Characterized 2026-05-06 under SwiftF0, but **applies by construction to Boersma-AC**: autocorrelation responds to any stationary periodic signal inside the 75–400 Hz search range (a 120 Hz fan hum qualifies; not re-measured under AC). It's a pre-existing limitation across pitch-detection algorithms, not a regression of any cutover. Addressing requires VAD / spectral noise-floor analysis / speech-vs-tonal discrimination — separate scoped work; none of the gate-level mechanisms are sufficient by construction. Workaround: quieter environment or pause detection.

### Pitch octave errors from harmonic-stack interference during voiced speech

**Largely mitigated 2026-07-19** for STATIONARY interferers by the same persistent-peak notch: measured octave-capture during speech at fan-hum +10 dB dropped 46 % -> 0.7 %, mains-complex fully recovered ([noise-robustness-oracle-2026-07-19.md](measurements/noise-robustness-oracle-2026-07-19.md) §7 — octave-capture rates; that oracle omitted the ghost veto, which only nulls frames, so its speech-*accuracy* rows overstated production until 2026-10-03; production-exact fan-hum +10 octave-down is 0.4–0.5 %, [noise-notch-voice-safety-2026-10-03.md](measurements/noise-notch-voice-safety-2026-10-03.md) §7a). Non-stationary interferers (speed-varying fans) remain uncovered by construction; a wobbling fan's octave-down rose 2.8 → 4.3 % with the narrowed veto because speech the old veto blanked is now decoded (correct +7.1 pp).

**Historical:** Distinct from the above: active **during voiced speech**. A harmonic-rich tonal source near a multiple of the user's F0 (refrigerator compressor, HVAC resonance, mains 3rd harmonic at 180 Hz, fan whine) can pull the detector to the interferer's fundamental.

**Status caveat: characterized 2026-05-12 under SwiftF0** (the measured rates — ≥66 % sustained octave-up even at SNR +20 dB — are SwiftF0-CNN numbers). **Not re-validated under Boersma-AC.** The ruled-out-fix analysis suggests AC is also structurally susceptible at high interferer levels (the audio genuinely IS more periodic at the interferer's frequency — no frame-local algorithm can distinguish "voice + tonal interferer" from "interferer alone"), but re-run the reproducer (`tests/dsp/swift-f0-synthetic-stress.js` Test 7, `pitch-half-period-octave-fix` branch) against AC before citing numbers. Note this is NOT the weak-H1 octave-up failure on real voices — that one the 2026-06-09 cutover fixed.

**Mitigations:**
1. **User-side (recommended): find and remove the physical source.** `scripts/ambient-noise-probe/index.html` (serve via `npx serve scripts/ambient-noise-probe`) captures an ambient FFT; narrow peaks in 75–300 Hz with ≥15 dB prominence are likely culprits.
2. **Adaptive notch front-end** (Direction D, not pursued) — has its own failure modes (notching voice harmonics).
3. **PENN model** (Direction C, ruled out 2026-05-13): 0 % octave-up at realistic SNRs but 6–7× slower on browser WASM, 24× larger model, needs COI headers. Verdict + re-evaluation scaffolding: `measurements/penn-direction-c-verdict-2026-05-13.md` on the `pitch-detection-penn` branch.

**Effect on other features:** the vocal-weight gauge is unaffected (CPP is independent of pitch interpretation, and the gate uses confidence, which stays high on voiced speech regardless of pitch correctness). Only the pitch trace and note name are visibly wrong.

### Residuals of the 2026-10-03 target-voice half-pitch pass

Five workstreams integrated together (gated globalPeak, octave arbitration, 800 Hz search, notch voice safety, paint-gate redesign), each measured alone and then **validated as a combined chain** ([target-voice-combined-validation-2026-10-03.md](measurements/target-voice-combined-validation-2026-10-03.md); joint numbers in the Current-state "Pitch latency + session accuracy" row). Every display-level, noise, held-note (the 2026-10-03 requirement grid — holds starting after silence; the precise held-note guarantee is the 2026-10-04 one in §Pitch detection of periodic non-speech content) and transient guard passes; **two worker-level guards fail in combination and need a human decision** — no documented fallback (contested-pair arbitration, `maxPitchHz` 600, `EXCURSION_SUSTAIN` 10–12, measured cumulatively) passes all guards, so the code is as integrated:
- **Alice low-voice octave-up (75–160 Hz) under strict R1&CC refs: +0.39 pp** decoded/posted (0.29 → 0.68 %; consensus +0.17, displayed +0.16/+0.21, held-out +0.09). From the octave arbitration (+0.33 alone; the octave file's "strict" was R1 without CC, where it reads +0.27). 81 % of the flipped frames are arbiter-high (upper octave physically present), mostly session 05-26 — listening adjudication would settle it.
- **Hillenbrand men worker-level correct −0.77 pp** (61.21 → 60.44; displayed +0.24) and worker max(F_err, M_err) on Hillenbrand 38.79 → 39.56 — the 800 Hz search (vowel-onset 3f/4f locks posted unvoiced). `maxPitchHz` 600 still −0.60 and reopens 600–800 Hz aliasing. Same mechanism costs Alice's posted low-band correct −0.96 pp (displayed +2.3).
- **Painted up-spike runs ≈ double** (Alice 3.0 → 6.7 per voiced minute, consensus; down runs 16.6 → 13.2, total flat), no connected strokes.
- **Detector octave-down on target voice** is reduced, not gone (Alice 160–400 Hz decoded half 8.9 → 5.4 % pooled; session 05-26 still ~14 %). Stronger arbitration settings (+5–7 pp target) cost +0.65–0.95 pp low-voice octave-up, outside the guard — the next step only if the low-band references are adjudicated (e.g. listening-labelled 05-26 frames) ([pitch-octave-arbitration-2026-10-03.md](measurements/pitch-octave-arbitration-2026-10-03.md) §7–8).
- **Vowel-onset 3f/4f harmonic locks** (the Hillenbrand-men item above; −0.67 pp measured alone). A voiced-entry preference in the tracker is separate measured work ([pitch-ceiling-2026-10-03.md](measurements/pitch-ceiling-2026-10-03.md)).
- **Paint gate**: harmonic locks of ≥ 8 frames now paint their tail as a separate segment (~10–20 % of locks per the 06-10 run-length data); reference-based wrong-octave painted runs 2.7 → 4.7 per voiced minute (cons, production detector), with no connected spike lines ([pitch-display-gate-redesign-2026-10-03.md](measurements/pitch-display-gate-redesign-2026-10-03.md)).
- **Quiet-mic transients** validated on synthetic clicks/pops/bumps over real speech; field validation with a real AGC-off mic pending ([pitch-globalpeak-transient-2026-10-03.md](measurements/pitch-globalpeak-transient-2026-10-03.md)).
- **Above-range phonation** renders as a gap; a "> 400 Hz" indicator would need the worker to flag those frames (not shipped).

### Pitch accuracy vs other trackers (2026-10-04 benchmark)

Head-to-head on the same audio, scored the same way ([pitch-detector-benchmark-2026-10-04.md](measurements/pitch-detector-benchmark-2026-10-04.md); Syrinx-new = branch src 39bd0ff): on the laryngograph corpora Syrinx ≈ Praat AC/CC (±5 % correct FDA / PTDB 87.1 / 89.4 vs Praat AC 88.3 / 88.0, CC 89.1 / 87.6; pYIN 81.6 / 83.2) but behind offline SwiftF0 / PENN (90.4 / 95.9, 87.0 / 96.8 — PTDB is PENN's training set), the gap mainly in the **75–160 Hz register** (85.5 vs 93.0 / 90.3 %, Syrinx's loss mostly nulls); vocadito 97.2 (CREPE full 99.3, SwiftF0 99.2, pYIN 98.7, Praat AC 94.9). Cost: Syrinx ~23 ms CPU per s of audio, causal, ~90 ms latency, in the browser — vs 200–3 800 ms per s for the offline neural trackers (CREPE tiny 198, PENN 853, CREPE full 3 803; SwiftF0 17 offline but its streaming form lost the corpus advantage, 88.1 / 89.4). On Alice's target voice (160–400 Hz) under the non-circular SHS & PENN reference: **Syrinx-new 90.7** vs CREPE tiny 94.7 / SwiftF0 92.7 / pYIN 91.1 / Praat AC 78.4 (Syrinx-main 87.9). No session table is ground truth — the references disagree on her voice (PENN an octave below Praat AC & SHS on 35 % of held-out target frames). Next accuracy headroom, if pursued: the 75–160 Hz misses and the residual target-voice octave-down.

### Firefox-mobile worker-MSTP capture path

Next capture-architecture work item (see §Capture architecture). Testable on the harness Pixel under Firefox; do not start other capture work before it.

## Deployment

GitHub Actions (`.github/workflows/deploy.yml`) builds and deploys to GitHub Pages on push to `main`. Build output goes to `docs/`. Vite base path is `/Syrinx/` (uppercase S). This project is hosted on **GitHub** (`gh` CLI for PRs/issues); the Forgejo instance described in the user-level notes is not used here. See ARCHITECTURE.md for the full design document and roadmap.
