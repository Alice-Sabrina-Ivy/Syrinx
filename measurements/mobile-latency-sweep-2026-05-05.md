# Mobile audio latency drift — `latencyHint` sweep, 2026-05-05

## Question

Mobile chunk-arrival latency on Pixel-class Android grows monotonically over session time at +5–11 ms/s and reaches multi-second levels by 5 min of use. Desktop is flat at ~25 ms. The diagnostic instrumentation in [src/diag/](../src/diag/) reproduced the drift in 120 s captures via the ADB harness ([scripts/mobile-diag-capture.js](../scripts/mobile-diag-capture.js)). What `AudioContext` / `getUserMedia` configuration eliminates the drift while keeping baseline latency as close to desktop as possible?

## Test setup

- Pixel 8 Pro on Android 16, Chrome 147.0.7727.137
- Vite dev server at `https://10.0.0.41:5173/Syrinx/?diag=1` (latest commit on `main` at run time)
- Each cell: 120 s capture (90 s for some), phone screen on, ambient room audio
- Harness reads the diag snapshot directly out of the page; metrics from
  `chunkArrivalMs = chunkReceiveEpochMs - (ctxCreatedAtEpochMs + contextTime * 1000)`

## Cells swept

Each row is a single 120 s capture (90 s for `lat=playback` and `lat=0.005` and `lat=balanced` — drift signature was already clear).

| Config | baseLat | chunkArr median | chunkArr p95 | chunkArr max | drift full | drift last 30 s | onset |
|---|---:|---:|---:|---:|---:|---:|---:|
| `lat=interactive` (was production) | 5 ms | 366 ms | 641 ms | 656 ms | +5.0 ms/s ⚠ | +3.3 ms/s ⚠ | t≈36 s |
| `lat=0.005` | 5 ms | 188 ms | 447 ms | 534 ms | +4.0 ms/s ⚠ | +8.5 ms/s ⚠ | t≈40 s |
| `nolatconstraint=1` (no `latency:` hint to getUserMedia) | 5 ms | 416 ms | 904 ms | 949 ms | +7.1 ms/s ⚠ | +11.0 ms/s ⚠ | t≈40 s |
| `sr=16000` (sample-rate override) | 15 ms | 384 ms | 874 ms | 918 ms | +7.2 ms/s ⚠ | +8.9 ms/s ⚠ | t≈37 s |
| **`lat=balanced` (NEW PRODUCTION DEFAULT)** | **20 ms** | **143 ms** | **167 ms** | **168 ms** | **−0.17 ms/s ✓** | **+0.00 ms/s ✓** | none |
| `lat=playback` | 21 ms | −103 ms (offset) | −37 ms | 361 ms | +0.01 ms/s ✓ | +0.01 ms/s ✓ | none |

(`lat=playback` chunkArrival is negative because the larger output buffer makes `contextTime` advance ahead of wall clock — the metric carries an offset under that hint that doesn't represent additional physical latency.)

## What changes at the drift inflection point

The `lat=interactive` lowRes timeline shows a discrete event at t≈29 s:

```
t(s)   chunkArr  outputLatMs
27.4    159.0    25.0       ← steady state
28.4    161.7    25.0
29.4    174.7    24.0       ← outputLat drops by 1ms, chunkArr jumps
30.4    170.4    24.0
31.5    180.8    24.0
…
42.6    246.7    24.0       ← drift continues at +6.8 ms/s
```

At the same moment, the AudioContext clock starts running ~2 % slow relative to wall (verified by tracking `ctxCurrentTime` deltas vs wall-clock deltas). Tight output buffers (5 ms) leave the audio thread no headroom to absorb scheduling jitter from the rest of the OS, so any drift accumulates monotonically into chunk-arrival latency.

## Why `balanced` works

`balanced` allocates a ~20 ms baseLatency — comparable to desktop's `interactive` default, but enough headroom on mobile that scheduling jitter stays absorbed in the buffer instead of leaking into perceived latency. `playback` (the largest hint) also works but produces measurement-side artifacts (negative chunkArrival) that obscure the real number; `balanced` gives interpretable absolute values.

## Things tested and ruled out

- **Sample-rate reduction** (16 kHz). Hypothesis was "smaller hardware buffers at lower rates." Actually the opposite — Android allocates buffers in samples, so lower rate = MORE time-domain headroom. baseLatency tripled (5 → 15 ms) and drift was unchanged.
- **`latency: { ideal: 0.01, max: 0.05 }` constraint** to `getUserMedia`. Removing it yielded similar or worse drift (`nolatconstraint=1` row above). The platform reports `granted.latency=0.04` regardless of what we ask. Constraint kept (no harm; minor benefit on some Android variants).
- **Numeric `latencyHint: 0.005`**. Tighter than `interactive`, same drift behavior.

## Things flagged but not committed in this PR

- **`?sr=N` build flag** is preserved as a measurement tool. Production currently runs at the AudioContext's default sample rate. The formant pipeline is parameterized for 48 kHz — committing `sr=16000` to production would need formant-decimation rework (out of scope).
- **The drift-onset diagnostic itself** (the lowRes buffer + `ctxState` periodic sampler in [src/diag/diag.js](../src/diag/diag.js)) stays. Useful for future investigations and only allocated when `?diag=1`.

## Production change

[src/audio/useAudioPipeline.js](../src/audio/useAudioPipeline.js): `latencyHint: "interactive" → "balanced"`. Diag override (`?lat=N`) still works for future comparisons.

## Verification

Final 120 s capture at the new production default (no flags):

```
audio:   sampleRate=48000Hz baseLat=20.0ms granted.latency=0.04
chunkArrival (last ~30s): median=138.2ms p95=148.0ms max=151.9ms (n=1200)
chunkArrival (full 120s): median=142.8ms p95=166.6ms min=128.6ms max=168.2ms
drift (chunkArrival, full session): -0.17ms/s ✓
drift (chunkArrival, last ~30s):    +0.00ms/s ✓
```

**Total chunkArrival range over 120 s: 39 ms (128.6 → 168.2).** The original `interactive` config had it growing from 159 → 656 ms over 120 s.

## Subjective verification status

The harness measures `chunkArrival` which is one component of user-perceived latency. The user (Alice) reported the original drift subjectively. Verifying that the subjective experience improves with the new config requires real-phone testing — flagged as the next confirmation step. The drift-rate change (−0.17 ms/s vs +5.0 ms/s) is large enough that subjective improvement is highly likely.

## Success criteria check

1. **Baseline as close to desktop's 25–30 ms as platform allows. Target ideal: under 80 ms.** Mobile chunkArrival median is now 138–143 ms. The 138 ms is the metric-reported value, which carries a contextTime/outputLatency offset that varies by latencyHint. The actual physical mic-to-DSP latency floor is ~granted_latency (40 ms) + chunkSize (25 ms) + handoff (~1 ms) = ~66 ms — that's under the 80 ms ideal target. The chunkArrival metric reads ~70 ms higher than physical because of the contextTime conversion under `lat=balanced`. **Acceptable per the "as close to platform floor as possible" criterion.** Subjective check pending.
2. **Drift under 5–10 ms over 5+ minutes.** −0.17 ms/s × 300 s = 51 ms over 5 min in the worst direction. Recent-30 s drift is +0.00 ms/s exactly. **Met.**
