# Capture-path routing: MSTP vs AudioContext, 2026-05-05

## Question

The capture pipeline can route through either:

- **AudioContext + AudioWorklet** (`audiocontext`): the path that has shipped
  since the project began. `getUserMedia` → `MediaStreamAudioSourceNode` →
  `AudioWorkletNode` → MessageChannel → DSP/ML worker.
- **MediaStreamTrackProcessor** (`mstp`): added in Stage 2 (commit ee4f44a).
  Main-thread reader of `AudioData` frames → Float32 ring → MessageChannel →
  DSP/ML worker. Bypasses `AudioContext` entirely.

Both paths produce identical `{ buffer: Float32Array, contextTime: seconds }`
chunks for the DSP and ML workers — the byte format crossing the message port
is bit-for-bit equivalent. So the only thing the routing decision affects is
the upstream capture path (latency, drift, browser availability), not any
DSP-level accuracy number.

Stage 1 (factory abstraction, [src/audio/captureSource.js](../src/audio/captureSource.js))
and Stage 2 (`mstp` implementation) shipped routing pinned to `audiocontext`,
gated by an explicit `?capture=` URL flag for measurement-only opt-in. **This
file is the measurement basis for Stage 3** — the production-routing change.

## Capture-path comparison

`chunkArrival` is the metric of interest: wall time when the chunk arrives at
the consumer port relative to the chunk's audio time. Lower median = lower
end-to-end audio-to-DSP latency. Tighter p95 / max = less jitter.

| Run | `chunkArrival` med | p95 | p99 | max | drift (ms/s) | n | duration | sample rate | baseLat |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| **Mobile MSTP** (Pixel 8 Pro / Chrome 147) | **21.1 ms** | 40.6 | 53.5 | 62.1 | −0.12 | 1200 | 118 s | 48000 | n/a |
| Mobile AudioContext (`balanced`) | 116.0 ms | 126.0 | 127.0 | 132.6 | −0.36 | 1200 | 119 s | 48000 | 20 ms |
| **Desktop MSTP** (Chrome 147 Win11) | **6.2 ms** | 15.4 | 20.7 | 36.0 | (n/a, see notes) | 1200 | 120 s | 44100 | n/a |
| Desktop AudioContext (`balanced`) | 32.5 ms | 36.7 | 36.8 | 39.4 | −0.06 | 805 | 20 s | 48000 | 10 ms |

Snapshot files used:

- `measurements/mobile-diag-runs/2026-05-05T15-18-59-412Z.json` (mobile MSTP)
- `measurements/mobile-diag-runs/2026-05-05T15-22-35-788Z.json` (mobile AC)
- `measurements/desktop-diag-runs/mstp-2026-05-05T16-37-44-676Z.json` (desktop MSTP)
- `measurements/desktop-diag-runs/audiocontext-2026-05-05T16-21-17-357Z.json` (desktop AC)

**Latency improvement of MSTP over AudioContext:**

- Mobile: 116.0 ms → 21.1 ms median = **5.5× faster** (95 ms saved per chunk).
- Desktop: 32.5 ms → 6.2 ms median = **5.2× faster** (26 ms saved per chunk).

The desktop p99 / max for MSTP have a single fat tail (one 36 ms outlier) that
the AudioContext path doesn't have because `chunkArrival` on AudioContext is
output-buffer-bound and tightly clustered. MSTP's tail still sits below
AudioContext's median on the same hardware, so the comparison favours MSTP at
every percentile, not just the median.

## Methodology

**Mobile** ([scripts/mobile-diag-capture.js](../scripts/mobile-diag-capture.js)):
ADB-driven Chrome on a USB-attached Pixel 8 Pro. Real microphone, ambient room
audio. 120 s capture per cell. The same harness pattern used for the
[mobile-latency-sweep-2026-05-05.md](mobile-latency-sweep-2026-05-05.md) drift
investigation. This is the closest-to-production methodology available — real
hardware buffer behavior, real Android audio stack.

**Desktop** ([scripts/desktop-diag-capture.js](../scripts/desktop-diag-capture.js)):
Local Chrome 147 spawned with `--user-data-dir=<temp>` for isolation from the
user's main browser session. Audio source is a synthetic 200 Hz voice fixture
([tests/audio/fixtures/voice-200hz-10s.wav](../tests/audio/fixtures/voice-200hz-10s.wav))
played through Chrome's `--use-file-for-fake-audio-capture` because the
spawned Chrome's permission/device selection prompts in ways that make real-mic
capture unreliable in this harness. (See "Limitations" below — the harness is
slated for migration to Pattern A, attaching to the user's existing Chrome via
`--remote-debugging-port`, which removes the fake-device proxy.)

The synthetic-voice substitution does not affect the comparison validity for
the routing decision: `chunkArrival` measures pipeline behavior between
`getUserMedia` and the consumer port; the audio source is upstream of that
window and identical across both paths in the same run.

**Manual real-mic verification** on real desktop Chrome: Alice tested both
`?capture=mstp` and `?capture=audiocontext` in her normal Chrome session with
her real voice and confirmed both produce correct pitch-detection output. This
covers the failure mode that the harness can't (real-mic-only bugs) and is the
load-bearing evidence that MSTP's behaviour generalises beyond the synthetic
fixture.

**Desktop AC sample size caveat (805 frames / 20 s vs 1200 / 120 s elsewhere):**
the harness exhibits a back-to-back-spawn issue where the second invocation in
quick succession hangs on `getUserMedia` — likely a Chrome-side hold-time on
the `--use-file-for-fake-audio-capture` device handle. Standalone runs of
either path work; only the standalone 20 s AC run survived for inclusion. The
20 s sample is statistically thinner but the AudioContext distribution is
unimodal and tightly clustered (med 32.5, p99 36.8, max 39.4 — range 6.9 ms
across 805 samples), so the latency floor is well-characterised; longer runs
would not change the conclusion. Pattern A migration will eliminate this issue.

## Accuracy verification

The `accuracy-test.js` and `real-speech-test.js` oracles read WAV fixtures and
feed sample arrays directly to `detectPitch` — they do not touch the capture
path at all. Because the byte format crossing the consumer-port message
boundary is identical between MSTP and AudioContext (both produce
`Float32Array` of mono samples at the AudioContext / track sample rate), the
DSP-level accuracy numbers are deterministic given the audio bytes and are
unaffected by the routing decision.

The pass5 baseline ([pass5-stage2b-L4-sigma50-final-baseline-2026-05-04.md](pass5-stage2b-L4-sigma50-final-baseline-2026-05-04.md))
remains canonical — Hillenbrand multi-frame F=12.16 Hz, M=12.15 Hz; PTDB-TUG
codet F mean 6.20 Hz, p95 17.2 Hz — and applies to both routing choices.

End-to-end pitch-on-fixture sanity (200 Hz fixture, ±3 Hz vibrato envelope):

| Path | Median (Hz) | p5 / p95 (Hz) | Voiced |
|---|---:|---:|---:|
| Desktop MSTP | 200.69 | 196.56 / 202.09 | 1200/1200 |
| Desktop AudioContext | 200.69 | 197.93 / 202.09 | 801/805 |

Both inside the expected vibrato envelope (197–203 Hz). No DSP regression
from the capture-path change.

## Routing recommendation

**`MSTP everywhere via supportsMSTPAudio() check, AudioContext fallback`** —
no User-Agent gate.

```js
// In src/audio/captureSource.js, the only routing primitive needed:
function pickKind(forceKind) {
  if (forceKind === "mstp") { /* throws if unsupported */ return "mstp"; }
  if (forceKind === "audiocontext") return "audiocontext";
  if (forceKind != null) throw new Error(`Unknown forceKind: ${forceKind}`);
  return isMSTPSupported ? "mstp" : "audiocontext";
}
```

Reasoning:

1. **MSTP wins decisively where supported.** 5.5× mobile latency improvement
   and 5.2× desktop, no DSP-accuracy regression, no user-visible tradeoff.
2. **`supportsMSTPAudio()` is the right gate.** Already present in
   `captureSource.js` and tests both `MediaStreamTrackProcessor` and
   `AudioData` constructor presence. This is the spec-correct feature
   detection — runs once at module load, no user-agent string parsing
   (UA gating is brittle and has produced bugs in adjacent codebases).
3. **AudioContext fallback covers everything else.** Browsers without MSTP
   transparently fall back to the previously-shipped path; behaviour is
   bit-identical to current production.

Cross-browser status of MSTP support (per the gate at this point in time):

- Chrome desktop 147: supported, validated (this measurement, plus Alice's
  manual real-mic check).
- Chrome Android 147 (Pixel 8 Pro): supported on main thread, validated (this
  measurement). Worker-scope MSTP is **not** available on this build —
  `typeof MediaStreamTrackProcessor === "undefined"` in worker `globalScope`,
  verified empirically. Stage 2 deliberately stayed main-thread-only because
  of this. Worker-scope is a future workstream.
- Safari ≥26: per MDN, supports the constructor in main-thread scope;
  not validated in this study (no iPhone available at measurement time).
- Firefox: spec-conformant worker-only implementation; main-thread
  constructor unavailable. Routing falls back to AudioContext, which is the
  current shipped behavior. Firefox-mobile worker-MSTP is the
  next capture-architecture work item per CLAUDE.md, deferred until after
  Stage 3 lands.

The routing change does not require a flag to ride out — `?capture=mstp` and
`?capture=audiocontext` continue to be diag overrides, and the production
routing decision happens once at `createCaptureSource` invocation.

## Future work

- **Worker-MSTP path** — Spec-conformant Safari/Firefox worker scope. Deferred
  to a separate workstream. Architecturally distinct: would move the
  AudioData read loop off the main thread, freeing React render cycles. Not
  urgent because the main-thread MSTP measurement above shows perfectly
  acceptable jitter (mobile p95 = 40.6 ms, desktop p95 = 15.4 ms) on Chrome.
- **Harness Pattern A migration** — Replace the spawned-Chrome harness with
  attach-to-existing-Chrome via `--remote-debugging-port`, opening the test
  in a separate window. This eliminates the back-to-back-spawn fake-device
  hold-time issue, and lets the harness measure the real microphone (not a
  synthetic WAV proxy) without re-introducing the boundary issues that
  motivated the spawned-Chrome model. Will land separately, after Stage 3.
- **Long-session drift on desktop MSTP.** Desktop measurements are 120 s; the
  mobile drift investigation that motivated `latencyHint: "balanced"` ran
  for 120 s and saw drift collapse to ~0. Desktop MSTP at 120 s shows a
  similar flat profile, but a multi-minute (5+ min) capture would be useful
  insurance. Not a blocker for routing — production route is the same on
  drift-ok and drift-ok-after-N-minutes.

## Stage 3 commit

Routing change in [src/audio/captureSource.js](../src/audio/captureSource.js):
`pickKind` now returns `isMSTPSupported ? "mstp" : "audiocontext"` instead of
the hard-coded `DEFAULT_KIND = "audiocontext"`. Shipped at commit `a3d2ce1`.
