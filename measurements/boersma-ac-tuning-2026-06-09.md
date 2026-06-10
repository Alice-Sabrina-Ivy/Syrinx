# Boersma-AC tuning pass + final detector shootout — 2026-06-09

Continuation of [pitch-detector-shootout-2026-06-09.md](pitch-detector-shootout-2026-06-09.md).
User direction: tune the Praat-style AC detector toward full replacement
of SwiftF0 ("I think I'm probably going to pick that one").

**Outcome: tuned AC-alone is the recommended production detector.** It
resolves the weak-H1 octave-up failure on the user's real voice
(49 → 94 % correct in the 80–110 Hz band), reaches parity or better on
two of four ground-truth corpora, runs at 0.21 ms/frame (~25–50× cheaper
than SwiftF0 browser-WASM), and would remove the ONNX model + runtime
from the pitch path entirely. The earlier E1 hybrid recommendation is
withdrawn — under fair scoring it is dominated by pure AC where it
matters (session 80 % vs 94 % correct).

## Two measurement-infrastructure findings (correct earlier numbers)

1. **v0 shootout under-scored AC via attribution mismatch.** The first
   shootout scored every detector against truth at SwiftF0's attribution
   time (~56 ms before the latest sample). AC's response is centered at
   its window center. Scored at its own center, v0 AC's FDA "deficit"
   shrinks ~16 pp. The final harness attributes each detector at its own
   response center.
2. **PTDB-TUG reference timestamps are offset ~+20 ms** relative to the
   loader's `i*hopMs` convention (attribution probes: every detector's
   PTDB accuracy peaks ~20 ms later than its true response center, while
   FDA/vocadito/session peak exactly at center — consistent with REF
   files timestamping the start of RAPT's 32 ms window). With the
   correction, **SwiftF0's PTDB correct rises 74.5 → 88.0 %** (its 19.6 %
   "other" was mostly misalignment), and prior PTDB-based numbers across
   the project's measurement history should be read with this in mind.

## Tuning arc (stages on `scripts/ac-tuning-sweep.js`, ~25 s/cell)

- **Stage A** (voicingThreshold × octaveCost, frame-local, 1024 window):
  octaveCost is the sharp axis — anything above Praat's default 0.01
  trades corpus octave-down for session octave-UP (it is literally a
  high-octave bias; at 0.2 the session band hits 48.5 % octave-up).
  voicingThreshold flat across 0.30–0.45. Locked vt 0.40 / oc 0.01.
- **Stage B** (window length): 1536 samples (96 ms @16 kHz) beats 1024
  (vocadito +1.8, session +2.1, flips −2.7, FDA −0.7) and 2048 (which
  blurs dynamic speech: FDA −2.2, ptdb −2.3). Attribution lag 48 ms ≈
  SwiftF0's 56 ms. Locked 1536.
- **Stage C** (bounded-Viterbi path tracker, new `createPathTracker` in
  [tests/dsp/boersma-ac.js](../tests/dsp/boersma-ac.js); Praat-style
  octave-jump + voiced/unvoiced transition costs, L-frame decode delay
  mirroring the retired pYIN L=4 design): octaveJumpCost 0.15, L=4.
  Higher jump costs make a wrong octave stickier (worse, not better).
  L=6 is marginally better (+0.3 correct) for +50 ms delay; L=2 loses
  0.3 and flips 5.0 vs 4.3. Locked ojc 0.15 / vuc 0.20 / L 4.

**Locked config**: minPitch 50, maxPitch 600, voicingThreshold 0.40,
octaveCost 0.01, peakFloor 0.15, frameLength 1536 @ 16 kHz, path
tracker {octaveJumpCost 0.15, voicedUnvoicedCost 0.20, lookback 4}.

## Final shootout (fair attribution + PTDB offset, all detectors)

Corpora, correct % (octave-up + octave-down %):

| corpus | SwiftF0 | AC tuned | E1 hybrid |
|---|---|---|---|
| fda | **90.3** (0.0) | 84.2 (0.9) | 90.6 (1.4) |
| hillenbrand | 61.8 (0.1) | **62.9** (1.6) | 61.8 (2.1) |
| ptdb-tug | **88.0** (0.3) | 87.2 (0.7) | 89.5 (1.5) |
| vocadito | **97.8** (0.5) | 95.0 (1.7) | 97.6 (1.6) |

User session 2026-05-26 (Praat reference), 80–110 Hz band:

| detector | correct | octave-up | null | flip (Praat self: 4.27) |
|---|---|---|---|---|
| SwiftF0 (production) | 49.1 | 25.6 | 19.1 | 5.5 |
| **AC tuned** | **93.7** | **4.1** | **0.4** | **4.3** |
| E1 hybrid | 79.8 | 11.8 | 0.3 | 9.4 |

AC's remaining corpus gaps are precision/null, not octave errors: FDA
−6.1 pp (9.3 % "other" near-misses on connected speech + 1 pp null);
vocadito −2.8 pp (3.1 % null + 1.7 % octave-down on singing). AC's
mean error is *better* than SwiftF0 on ptdb (1.71 vs 1.92 Hz) and
vocadito (0.90 vs 1.30 Hz).

## Cost / latency

- Compute: 0.21 ms/frame including candidates + Viterbi (Node; pure JS,
  no WASM/ONNX). SwiftF0: 5–11 ms browser-WASM. ~25–50× cheaper;
  sustained mobile CPU drops from ~40 % of a core to ~1 %.
- Payload: removes the 388 KB model + pitch-worker's onnxruntime-web
  dependency (a ~23 MB WASM asset, ~5.7 MB gzipped) and the ORT failure
  modes (fetch, init, inference hangs).
- Display latency: 48 ms window center + 100 ms L4 decode ≈ 148 ms,
  vs SwiftF0's ~56 ms. Comparable to the pYIN era (~125 ms). If this is
  felt in practice, L=2 gives ≈ 98 ms at −0.3 pp correct / flip 5.0.

## Recommendation

Replace SwiftF0 with the tuned Boersma-AC + path tracker in
pitch-worker.js. The gate's voicedness arm maps from SwiftF0 confidence
to the AC voiced decision (candidate strength vs unvoiced strength —
threshold semantics preserved at the pitchGate level). Acceptance: re-run
this shootout post-integration + the standard corpus suites; document
the FDA/vocadito deltas as the accepted trade for the field win.

Overfit guard: tuning touched only Praat-default-adjacent knobs
(octaveCost stayed at Praat default; voicingThreshold 0.45 → 0.40;
window/lookback structural), tuned on corpora + one session, with the
session as the target and corpora as regression constraint. A held-out
check on the other two Calliope sessions is cheap future validation.

## Reproduction

```
node scripts/ac-tuning-sweep.js A|B|C [out.json]   # stages (env AC_BEST / AC_FL)
node scripts/pitch-shootout-extract.js --corpora build/pitch-compare/shootout-corpora.json
node scripts/pitch-shootout-extract.js --wav=<SESSION.wav> --praat=build/pitch-compare/praat-contours.json \
    build/pitch-compare/shootout-session.json
python -u scripts/pitch-shootout-analyze.py build/pitch-compare/shootout-corpora.json \
    build/pitch-compare/shootout-session.json measurements/pitch-detector-shootout-tuned-2026-06-09.json
```
