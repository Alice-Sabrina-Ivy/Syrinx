# Pitch-smoothing octave-shift lock — 2026-05-09

## Problem

User report (2026-05-09 in-browser validation): when they speak around
100 Hz, then abruptly shift to ~200 Hz, the on-screen pitch trace stays
locked at the 100 Hz range for several seconds before "abruptly self-
correcting." Same behavior in reverse (200 → 100). Reproduces every time.

## Reproduction

`tests/audio/pitch-smoothing-octave-shift-harness.js` drives synthetic
pitch sequences through three smoother variants and reports per-frame
output, frames-to-converge, and aggregate error. The harness includes a
sanity check that variant `current` matches the production
`src/audio/pitchSmoothing.js` exactly.

Drive sequence: 15 frames of 100 Hz, then 30 frames of 200 Hz (no
silence gap). Run-to-run deterministic.

```
Scenario: shift-100-to-200  (length=45)
  current            mae=86.6Hz  max=100.0Hz  conv=never  final=100/200
  no-reconcile       mae=22.4Hz  max=100.0Hz  conv=2f     final=200/200
  sustained-shift    mae=22.4Hz  max=100.0Hz  conv=2f     final=200/200

Scenario: shift-200-to-100  (length=45)
  current            mae=86.6Hz  max=100.0Hz  conv=never  final=200/100
  no-reconcile       mae=22.4Hz  max=100.0Hz  conv=2f     final=100/100
  sustained-shift    mae=22.4Hz  max=100.0Hz  conv=2f     final=100/100
```

The status-quo `current` smoother **never converges** to the new pitch.
Output stays stuck at 100 Hz (or 200 Hz, in reverse) for the full 30
post-shift frames. With a 25 ms hop cadence that's 750 ms of stuck
trace per measured run; in real use the lock persists indefinitely
until prolonged silence (≥ `SILENCE_HOLD_MS` = 5 s) clears
`pitchSmoothRef.current` and the smoother starts fresh.

## Root cause

[pitchSmoothing.js](../src/audio/pitchSmoothing.js)'s
`pushAndMedianPitch` calls `reconcileHarmonic` on every new value once
the ring buffer has filled past `RECONCILE_AFTER_FRAMES`. When the
buffer holds 5 × 100 Hz and the user shifts to 200 Hz:

1. `reconcileHarmonic(200, 100)` checks the k=2 window (200 ± 30 Hz).
2. 200 is exactly k·current — corrected = 200/2 = 100 Hz. Returns 100.
3. The "corrected" value 100 is pushed to the buffer.
4. The buffer stays `[100, 100, 100, 100, 100]` indefinitely.
5. The next 200 Hz sample reconciles against the same median, returns
   100 again. Self-reinforcing lock.

The same logic locks 100 Hz speech against a 200 Hz buffer (sub-harmonic
correction multiplies 100 → 200).

## Why it didn't show up earlier

Test coverage gap: `tests/audio/pitch-smoothing-test.js` covered
**transient** harmonic spikes (1–4 frames) but had no test case for
**sustained** octave shifts. The transient cases work as designed —
single-frame and short-burst spikes get reconciled away by the median.
The harness above adds the missing sustained-shift coverage.

`reconcileHarmonic` was originally added to defeat pYIN's brief
2- and 3-frame harmonic-doubling errors. With pYIN as the detector, the
real-world failure mode was indeed transient spikes, so the smoother
never saw a sustained-octave input. With SwiftF0 (Stage 4 cutover,
2026-05-06) the detector itself shifts pitch instantly across an octave
boundary — and that's the case the smoother never had to handle before.

## Why this is now defensible to remove

The 2026-05-04 "delete `reconcileHarmonic`" hypothesis was rejected at
the time (memory note `feedback_measurements_first.md`) because pYIN
was the active detector and pYIN had a 2.3 % octave-error rate across
mid-range buckets. Reconciliation was load-bearing.

After the SwiftF0 cutover, octave-error rates measured per-corpus
(per [swift-f0-stage3-validation-2026-05-06.md](swift-f0-stage3-validation-2026-05-06.md))
collapsed to:

| Corpus | Pre-SwiftF0 (pYIN) | Post-SwiftF0 |
|---|---|---|
| Hillenbrand aggregate | 2.3 % | **0.02 %** |
| PTDB-TUG | ~3 % | **0.08 %** |
| vocadito | varies | **0.05 %** |
| FDA | varies | **0.00 %** |

That's a 100×–∞× reduction. SwiftF0 essentially does not produce octave
errors. Reconciliation has nothing to do.

## Variants compared

The harness compares three smoother implementations on a fixed scenario
matrix (steady tones, octave shifts, transient spikes of various
durations, glides, slow ramps).

### `current` — status quo
- Locks indefinitely on octave shifts (the user-reported bug).
- Tolerates 1–4 frame transient spikes (the original design intent).

### `no-reconcile` — strip `reconcileHarmonic`, keep rolling median
- Tracks octave shifts in **2 frames** (= the natural rolling-median
  latency at `PITCH_SMOOTH_LEN` = 5 — once 3 of the 5 buffer slots hold
  the new value, the median flips).
- Tolerates 1- and 2-frame spikes (median outvotes them naturally).
- Lets 3+ frame spikes pass through visibly.

### `sustained-shift` — keep reconcileHarmonic but accept after N
- Tracks 1- and 2-frame transient spikes the same as status quo.
- Tracks octave shifts in 2 frames after detecting `SHIFT_CONFIRM` = 3
  consecutive raw values that all fall in the same harmonic window.
- Has a 1-frame "ghost spike" at the moment of confirmation (the value
  shows through unfiltered when the smoother flushes its buffer).
- More code, more moving parts.

## Per-scenario summary

(Full table in the harness's CSV output.)

| Scenario | current | no-reconcile | sustained-shift |
|---|---|---|---|
| steady-100 | ✓ | ✓ | ✓ |
| steady-200 | ✓ | ✓ | ✓ |
| shift-100-to-200 | ❌ (locks 100) | ✓ (2-frame lag) | ✓ (2-frame lag) |
| shift-200-to-100 | ❌ (locks 200) | ✓ | ✓ |
| shift-100-to-300 | ❌ (locks 100) | ✓ | ✓ |
| shift-300-to-100 | ❌ (locks 300) | ✓ | ✓ |
| spike-1-frame (rejected by both) | ✓ | ✓ | ✓ |
| spike-2-frames (rejected by both) | ✓ | ✓ | ✓ |
| spike-3-frames | ✓ (caught by reconcile) | partial (1 frame visible) | partial (1 frame ghost) |
| spike-4-frames | ✓ (caught by reconcile) | partial (3 frames visible) | partial (3 frames visible) |
| glide-130-to-200 (smooth ramp) | ✓ | ✓ | ✓ |
| rising-100-to-220-slow (ramp through k=2) | ✓ | ✓ | ✓ |

## Decision

**Apply `no-reconcile`** — strip `reconcileHarmonic` and reduce
`pushAndMedianPitch` to a plain rolling-median over `PITCH_SMOOTH_LEN` =
5 samples. Rationale:

1. The user-facing bug is severe and trivially reproducible.
2. The protection `reconcileHarmonic` provides (catching 3+ frame
   harmonic spikes) defends against a failure mode that the post-
   SwiftF0 detector essentially doesn't produce (≤ 0.08 % octave-error
   rate across all measured corpora).
3. The rolling median alone still tolerates 1- and 2-frame spikes —
   that's the natural arithmetic of a length-5 median, not specific to
   reconciliation.
4. `sustained-shift` solves the same bug with more complexity and
   doesn't materially out-perform `no-reconcile` on any scenario in the
   harness. Adding code without a measurable accuracy gain is not
   justified.
5. If a future detector regression reintroduces transient harmonic
   errors, `reconcileHarmonic` is recoverable from git history; until
   then it's a liability rather than an asset.

## Code changes

Apply to `src/audio/pitchSmoothing.js`:

- Remove `reconcileHarmonic` (no production callers outside this file).
- Remove `RECONCILE_AFTER_FRAMES`, `PITCH_HARMONIC_TOLERANCE`,
  `PITCH_HARMONIC_KS`, `PITCH_VALID_MIN_HZ`, `PITCH_VALID_MAX_HZ`
  (only `reconcileHarmonic` referenced them).
- Reduce `pushAndMedianPitch` to: push, drop oldest if over capacity,
  return median.
- Keep `PITCH_SMOOTH_LEN` and `median` exports — both still in use.

`tests/audio/pitch-smoothing-test.js` is rewritten to drop the
`reconcileHarmonic` test cases (the function is gone) and update the
sustained-spike expectations to match the new behavior. The
post-silence-contamination case becomes a no-op since the contamination
mechanism was specifically reconciliation against a single bad first
reading.

`tests/audio/pitch-smoothing-octave-shift-harness.js` ships as durable
infrastructure — if a future smoother change wants to re-introduce
spike protection or some other pre-filter, this is the harness it
needs to pass.

## Acceptance criteria

After applying:

- `node tests/audio/pitch-smoothing-octave-shift-harness.js` reports
  `current` matching production AND `current` showing `conv=never` on
  shift scenarios is replaced by `conv=2f` (i.e. production = the new
  no-reconcile path).
- `node tests/audio/pitch-smoothing-test.js` passes (after rewrite).
- User can validate manually in the dev server: speak at one pitch,
  shift abruptly to its octave, observe trace converging within ~50 ms
  rather than locking for seconds.
