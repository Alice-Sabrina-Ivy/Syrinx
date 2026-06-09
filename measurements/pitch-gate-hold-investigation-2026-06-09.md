# Pitch gate / pitch hold investigation — 2026-06-09

Autonomous follow-up to the user report "there still seem to be bugs around
pitch detection." Model-level accuracy was verified healthy first; the bugs
found are in the main-thread integration layer (`useAudioPipeline.js`), not
in SwiftF0.

## Baseline: model-level pitch detection is healthy on main

`node tests/dsp/swift-f0-streaming-verify.js` on main @ `9d71338`: **PASS**.
All four corpora within tolerance of the Stage 3 standalone baseline
(octave-error rates 0.02–0.47 %, mean errors within 2 Hz; rl022 reproducer
meanErr 2.71 Hz / 0 octave errors). Whatever users perceive as "pitch
detection bugs" beyond the two documented known limitations (tonal-noise
phantom pitch; harmonic-stack octave-up) is therefore downstream of the
model — in the merge/gate/display layer.

## Bug 1 — unbounded pitch hold paints phantom flatlines (user-visible)

`handleAnalysisResult` (pre-fix `useAudioPipeline.js:936-958`): when a frame
is *not* silence-gated but SwiftF0 reports no pitch (confidence < 0.5), the
pipeline held the last smoothed pitch and pushed it into the trace with
`voiced: true` — **with no time bound**. The silence gate
(`intensity < -50 dB AND confidence < 0.5`, debounced) does not engage when
intensity stays above −50 dB, so any sustained loud-but-pitchless audio —
breath into the mic, fan/HVAC broadband noise, typing, background talking
below the confidence gate — kept painting the last spoken pitch as a flat
line indefinitely. Consequences:

1. **Pitch trace**: phantom flat line at the stale pitch for the entire
   noise duration (plus glow dot + full-color Hz readout, since entries are
   `voiced: true`).
2. **Session statistics pollution**: recorded frames carry
   `voiced: true, f0: <stale pitch>`; `CombinedDashboard.jsx` session stats
   filter on `f.voiced && f.f0 !== null`, so avg F0 / time-in-target absorb
   arbitrarily long runs of a fabricated constant pitch.

Distinct from the two documented known limitations: in both of those,
SwiftF0 itself reports a (wrong or non-speech) pitch with real confidence.
Here the **app fabricates** a pitch SwiftF0 explicitly declined to report.

### Corpus grounding for the hold bound

The hold exists to bridge brief intra-speech gaps (unvoiced consonants,
momentary confidence dips) so the trace doesn't fragment mid-word — the
PR #74 concern. Bounding it needs the distribution of genuine intra-speech
null runs in production streaming mode. New harness:
`tests/dsp/swift-f0-null-gap-distribution.js` (mirrors
`swift-f0-streaming-verify.js`'s per-25 ms-hop simulation; measures maximal
runs of consecutive `confidence < 0.5` frames with voiced frames on both
sides — leading/trailing silence excluded). Full JSON:
`measurements/swift-f0-null-gap-distribution-2026-06-09.json`.

| corpus | interior runs | p50 | p90 | p95 | p99 | max | ≤400 ms bridged |
|---|---|---|---|---|---|---|---|
| hillenbrand (vowels) | 203 | 25 ms | 50 ms | 50 ms | 75 ms | 150 ms | 100 % |
| ptdb-tug (speech) | 1163 | 100 ms | 200 ms | 275 ms | 400 ms | 750 ms | ~99 % |
| fda (speech) | 668 | 100 ms | 200 ms | 250 ms | 350 ms | 425 ms | ~99.7 % |
| vocadito (singing) | 1145 | 75 ms | 375 ms | 500 ms | 775 ms | 4173 ms | ~91 % |

Caveat noted in the harness header: corpus interior runs include
inter-sentence pauses, which in production are mostly intensity-quiet and
owned by the silence gate — the distribution *overestimates* what the hold
must bridge. **Chosen bound: `PITCH_HOLD_MAX_MS = 400`** — covers ~p99 of
intra-speech null runs on both running-speech corpora while capping how
long a phantom value can outlive the voice that produced it at under half
a second. Vocadito's longer tail is rests between sung phrases — genuine
gaps that *should* render as gaps.

## Bug 2 — no staleness check on the pitch merge (stuck silence gate)

`latestPitchRef` merges pitch-worker output into DSP frames as "latest
value, any age." If the pitch-worker stalls or dies mid-session (model
fetch failure, ORT hang — the worker has a 1500 ms defensive timeout that
emits an event but the main thread did nothing with the staleness; port
failure), the ref freezes at its last value. If that last value had
`confidence ≥ 0.5`, the silence gate's voicedness arm reads "voiced"
**forever** — the AND-gate can never engage, in combination with bug 1 the
display holds stale values indefinitely, and the failure is silent.

Fix: pitch samples older than `PITCH_STALE_MS = 250` (10 missed hops at the
25 ms cadence — far outside healthy jitter given 11 ms median / 17 ms p95
mobile inference, well inside the 1500 ms worker timeout) are treated as
absent: pitch → null, confidence → null. Confidence-null collapses the gate
to intensity-only — the **same designed fallback** as the pre-warmup window
before SwiftF0's first inference, so no new behavior class is introduced.

## Fix shape

- New `src/audio/pitchGate.js` — frame-level gate/staleness/hold decisions
  extracted from `useAudioPipeline.js` (same extraction-for-testability
  pattern as `pitchSmoothing.js`). Gate semantics (AND logic, −50 dB, 0.5
  confidence, 3-frame debounce) are **unchanged** — verified by unit test.
- `useAudioPipeline.js` consumes the gate; pitchless-but-loud frames now:
  push an honest trace gap (`voiced: false`), reset the pitch-smoothing
  buffer once the hold expires (next utterance starts fresh instead of
  being medianed against pre-gap values), record `voiced: false, f0: null`
  to session frames, and continue updating formants/tilt/HNR (those are
  measured from the audio and were already updating in this regime on
  main — only the fabricated pitch stops).
- State `voiced` flag is now "displayable pitch this frame";
  `dspGateRef.voiced` remains "audio present" (gender-trace tagging and
  rAF consumers unchanged). Comment updated at the export site.
- `tests/audio/pitch-gate-test.js` — 26 checks: AND-gate + debounce
  preservation, pre-warmup intensity-only fallback, gap bridging ≤ bound
  (PR #74 anti-fragmentation), phantom-flatline expiry, hold re-arm,
  worker-death staleness, healthy-cadence never-stale.

## Verification

- `node tests/audio/pitch-gate-test.js` — 26/26 pass.
- `node tests/audio/pitch-smoothing-test.js` — 16/16 pass (unchanged).
- `node tests/audio/vocal-weight-aggregator-test.js` (42),
  `vocal-weight-baseline-test.js` (56), `tests/ml/audio-utils-test.js` (45)
  — all pass (gate output feeds the CPP aggregator's `voiced` flag; the
  debounced `isQuiet` semantics are preserved so no change propagates).
- `npm run lint` — no new errors in production files (`pitchGate.js`
  clean; the two `process is not defined` hits in new *test* files match
  the pre-existing pattern across all Node test files on main, 578
  pre-existing errors).
- `npm run build` — passes; docs/ output reverted (CI owns it).
- Not re-run post-change: `swift-f0-streaming-verify.js` — it exercises
  the model/adapter path only and does not import `useAudioPipeline.js`
  or `pitchGate.js`; the main baseline above stands.

## Limitations / follow-ups (not in this change)

- **No real-browser end-to-end repro captured.** The diag snapshot records
  the *raw* pitch-worker output (`latest.pitch`), not the held/displayed
  value, so the phantom flatline is not directly observable in snapshot
  JSONs — it lives in `pitchTraceRef`, which isn't snapshotted. A diag
  field for the displayed (post-hold) pitch would make this class of bug
  measurable in browser captures; worth adding if a regression is ever
  suspected.
- The `?voice-file` end-to-end harness could validate the fix behaviorally
  (speech segment → sustained noise segment fixture) once such a diag
  field exists.

## Unrelated findings from the same survey (flagged, NOT addressed here)

1. **pYIN-era test harnesses broken on main**: every harness that vm-loads
   `dsp-worker.js` as a classic script (`accuracy-test.js`,
   `real-speech-test.js`, `yin-harmonic-test.js`, `ptdb-tug-test.js`,
   `fda-test.js`, `vocadito-test.js`, `pitch-bucket-harness.js`, the four
   ruled-out-direction sweeps, octave-lock diagnostics — ~20 files) crashes
   at load: PR #78 added `import { computeCPP } from "./cpp.js"` to
   dsp-worker.js, and `vm.runInContext` can't evaluate ES-module syntax.
   They were *already* dead for pitch purposes — `detectPitch` left
   dsp-worker.js at the Stage 4 SwiftF0 cutover — so the vm crash just
   surfaces it loudly. CLAUDE.md still cites `node tests/dsp/accuracy-test.js`
   as a runnable example and names it a "tuning oracle"; that text is
   stale (superseded by `pitch-bucket-harness-swift.js` +
   `swift-f0-streaming-verify.js`). Cleanup (delete vs port to the SwiftF0
   adapter, e.g. accuracy-test's formant half is still unique) is a scope
   decision for Alice.
2. **~105 MB of ONNX models committed to `public/`** in `9d71338` (message
   "6/19/2026", 2026-05-17): `public/audeering-6l-gender/` (90 MB — the
   *retired* audeering candidate) and `public/jaesunghuh-gender/` (15 MB).
   Production loads the gender model from HF Hub
   (`env.allowLocalModels = false` in gender-worker.js), so these are
   unreachable dead weight in the repo and in every local build copy
   (`docs/` copies are gitignored, so they don't deploy). Likely an
   accidental `git add`-all; removal would need a history-aware decision
   (they're already in pack history), so flagged rather than acted on.
