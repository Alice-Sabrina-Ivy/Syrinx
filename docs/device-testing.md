# Device testing and diagnostic harnesses

Phone testing on the dev server, the `?diag=1` overlay, and the phone / desktop diagnostic capture harnesses. Moved from CLAUDE.md on 2026-11-02 (local folder paths and the PC's LAN address replaced by placeholders; the harnesses' start-button wording brought up to date). CLAUDE.md keeps the commands and the gotchas; "§" references below point to CLAUDE.md sections. CLAUDE.md's hard rule 2 (kill only the PID you spawned, never by name) applies to every harness here.

## Mobile testing

`npm run dev:mobile` runs Vite with `--mode mobile --host`, which binds to all network interfaces and enables a self-signed HTTPS cert via `@vitejs/plugin-basic-ssl` (gated to `mode === 'mobile'` in [vite.config.js](../vite.config.js) so default `npm run dev` is unchanged). HTTPS is required because mic capture (`getUserMedia`) refuses non-localhost origins over HTTP.

Vite prints both URLs at startup, e.g.:
```
  ➜  Local:   https://localhost:5173/Syrinx/
  ➜  Network: https://<PC-LAN-IP>:5173/Syrinx/
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

## Diagnostic mode

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
- **Snapshot ↓ (~30 s full-rate + 10 min low-res)**: downloads a JSON file with the full ring buffer + audio info + user agent + tap timestamps. The snapshot includes `inputRms` and `confidence` per frame plus the `pitchInferences` ring, so a failure mode (e.g. "confidence saturates while inputRms is at noise floor") is reconstructable later — stash JSON + a repro `.md` in `measurements/` only when the audio is public or synthetic; a snapshot of the user's own voice is private (§Private session data).

The overlay refreshes at 10 Hz from the diag ring buffer (updated at the worker's ~40 fps analysis cadence); reading it is O(1) and does not observe the audio pipeline directly.

**Measurement-only URL flags:** `?capture=mstp|audiocontext`, `?chunk=N` (5–50 ms), `?latexact=N`, `?lat=N|interactive|balanced|playback`, `?nolatconstraint=1`, `?sr=N`. Full list in [src/diag/diag.js](../src/diag/diag.js).

## Mobile audio platform floor (Pixel 8 Pro / Chrome 147, characterized 2026-05-05)

Characterized on the **AudioContext capture path** — the fallback path since MSTP shipped as production default (Stage 3, 2026-05-05). Still the reference for Firefox and any AudioContext-fallback latency questions. Sweep data: [measurements/mobile-latency-sweep-2026-05-05.md](../measurements/mobile-latency-sweep-2026-05-05.md).

**chunkArrival on the AudioContext path bottoms out ~100–120 ms** at production config. Decomposed: hardware mic buffer 40 ms (granted `latency: 0.04`, immutable on this device) + AudioWorklet chunk aggregation 25 ms + output-buffer offset 20 ms + handoff ~5 ms ≈ 90 ms theoretical, ~110 ms measured (~20 ms unexplained AudioContext-internal overhead).

**Levers tested and ruled out** (don't redo): `channelCount: 1` (already granted); smaller `chunkSize` (moves first-sample latency only, not the steady-state median); `latency: { exact: 0.01 }` (OverconstrainedError; platform grants 0.04 regardless); 16 kHz sample rate (worse — Android allocates buffers in samples, not time).

**MSTP** delivers frames at the 40 ms hardware-buffer cadence with ~zero drift and no AudioContext overhead — ~50 ms floor vs ~110 ms. This motivated the Stage 3 capture-routing ship (see §Capture architecture).

## Mobile diag capture harness

[scripts/mobile-diag-capture.js](../scripts/mobile-diag-capture.js) drives Chrome on a USB-attached Android phone via ADB + Chrome DevTools Protocol, runs a configurable capture window, pulls the snapshot JSON out of the page, prints a summary, and saves to `measurements/mobile-diag-runs/<ISO-timestamp>.json`.

**One-time setup:**

1. Install Android Platform Tools so `adb` is on `PATH` (`winget install Google.PlatformTools` or the standalone bundle). Confirmed working with `adb 34.0.5`.
2. On the phone: enable Developer options and USB debugging.
3. USB mode must allow data ("File transfer"); "Charging only" leaves ADB with no device.
4. First run: accept the phone's RSA-key trust prompt ("Always allow from this computer").
5. First page load: accept the self-signed cert warning; remembered afterward.

**Run:** `node scripts/mobile-diag-capture.js [--duration=30] [--url=https://<PC-LAN-IP>:5173/Syrinx/?diag=1]` — the default `--url` is the script's `DEFAULT_URL`, the PC's LAN address when it was written; pass `--url` if it changed.

The harness verifies exactly one authorized device, navigates Chrome via `am start` intent, forwards CDP over `adb forward`, attaches Puppeteer, answers the goal sheet with "Just exploring" and presses "Start — allow the microphone" / "Start practicing" / "Start Listening" as needed (bails after 8 s if no frames arrive), heartbeats during capture, and saves + summarizes the snapshot (duration, frames, audio context, `chunkArrivalMs`/`totalMs` distributions, drift slopes, split-half phase-change detector).

**Audio source for deterministic captures:** play a known reference signal (sustained vowel WAV) from PC speakers into the phone's mic. **Phone state between runs:** USB plugged, screen unlocked, Chrome running — the harness reuses the tab. **Enable "Stay awake while charging"** in Developer options; otherwise Android dozes and suspends AudioWorklet processing mid-capture (the harness sets `svc power stayon usb` as mitigation, but the toggle is the durable fix).

**Failure modes detected with recovery hints:** no/unauthorized/multiple devices; Chrome not installed; CDP doesn't come up; no matching tab (cert warning showing); no frames within 8 s (mic permission, AudioWorklet error — surfaces `status.errors`). If the hint says "tap something on the device", do that and re-run; anything else, capture the error and investigate.

## Desktop diag capture harness

Desktop analogue — saves to `measurements/desktop-diag-runs/<kind>-<ISO-timestamp>.json`. Two harnesses:

### Isolated spawn (autonomous, synthetic-injection only)

[scripts/desktop-diag-capture.js](../scripts/desktop-diag-capture.js) spawns a fresh Chrome with `--user-data-dir=<temp>`, captures in that isolated profile, tree-kills only the spawned PID on exit (see CLAUDE.md [hard rule 2](../CLAUDE.md#2-spawned-process-cleanup)). No user setup.

```
node scripts/desktop-diag-capture.js [--kind=mstp|audiocontext] [--duration=120] [--url=...] [--voice-file=PATH] [--play-wav=PATH]
```

**`--voice-file=PATH`** uses Chrome's `--use-file-for-fake-audio-capture` to replace the mic wholesale with the WAV's bytes. Bit-exact reproducibility — the recommended mode for this harness.

**`--play-wav=PATH`** attempts speaker-loopback through the spawned Chrome's default mic. **Does not work in Alice's environment** — the isolated profile selects a non-physical or muted device: `inputRms=0` on all frames regardless of speaker output. **`--no-fake-device=true` is unusable for the same reason** (confirmed empirically 2026-05-06: 5 s ambient probe, 213 frames, all `inputRms = 0.000000`). Both real-audio probes produce digital silence on the isolated profile — the failure is at the fresh profile's device-selection layer. **Any test needing real-mic audio must use the attach harness.** The `--play-wav` code path is retained because it works on the attach harness. Flags are mutually exclusive; `--voice-file` wins.

### Attach to existing Chrome (for tests that need real session state)

[scripts/desktop-diag-capture-attach.js](../scripts/desktop-diag-capture-attach.js) connects via CDP to a Chrome the user launched with a debug port, opens the test page in a NEW WINDOW (so it doesn't hijack focus), captures against the real profile (real mic preference), then closes only its own window via `Target.closeTarget({targetId})` — other tabs/windows unreachable by construction.

Prerequisite — user launches Chrome with **both flags** (one-time, all Chrome windows closed first):

```powershell
& "C:\Program Files\Google\Chrome\Application\chrome.exe" --remote-debugging-port=9223 --user-data-dir="$env:TEMP\chrome-debug-profile"
```

Chrome 136+ silently rejects `--remote-debugging-port` against the default profile; without `--user-data-dir`, port 9223 never binds. Verify with `curl http://localhost:9223/json/version`. The flag also only takes effect on a fresh launch — a second invocation while Chrome runs gets absorbed into the existing instance.

**Window-close caveat:** if the debug Chrome has no other windows, Chrome exits when the harness closes its test window and port 9223 unbinds. Keep one extra `about:blank` tab open to keep Chrome alive across runs.

```
node scripts/desktop-diag-capture-attach.js [--kind=mstp|audiocontext] [--duration=120] [--url=...] [--port=9223] [--play-wav=PATH]
```

### Focus / visibility emulation (load-bearing for both harnesses)

Both harnesses call `Emulation.setFocusEmulationEnabled({enabled:true})` and `Page.bringToFront` after attaching. Without this, a test window behind the user's foreground app reads `visibilityState === "hidden"`, React onClick throttling makes programmatic clicks appear to no-op, the pipeline never starts, and the snapshot shows `audio: null` / `frames: 0` / no errors (observed 2026-05-05). Diagnostic if a harness stalls with that signature: check the page-state probe for `vis: hidden`.

### Why not spawn a debug-port-enabled Chrome sharing the user's profile?

Explored and ruled out 2026-05-05 — five `child_process` spawn variants (`detached`, `stdio`, `cmd /c start`, `Start-Process`, `windowsHide`) all single-instance-merged into the user's running Chrome, even though manually typing the same command in interactive PowerShell works. The isolated-spawn harness with `--voice-file` sidesteps it. **Future sessions: do not redo this exploration.**
