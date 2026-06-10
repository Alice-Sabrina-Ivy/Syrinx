# Vocal-weight accuracy pass — 2026-06-10

User report: vocal-weight gauge "feels off / pretty inaccurate." After
re-reading the literature review (which concludes CPP is the
best-supported single measure and per-user-relative is the only honest
path absent perceptual ground truth), the agreed plan was three targeted
fixes to the existing CPP architecture rather than a from-scratch rebuild
(which would reconverge on CPP):

1. Pitch-gate the CPP feed (was silence-gate).
2. Freeze the per-user baseline μ/σ after calibration + widen span
   (was a continuously-sliding window, zero interaction either way).
3. Revisit the Maryn CPPS chain for correlation headroom.

Step 3 is measured on the four ground-truth corpora (Praat CPPS
correlation). Steps 1–2 were measured on a private session recording
(real voice + real noise); results on the private session recordings are
kept outside this repository. Harnesses:
`tests/dsp/cpp-quefrency-bins-sweep.js`,
`scripts/vocal-weight-gate-scale-validate.js`.

## Step 1 — pitch-gate the CPP feed

The aggregator's per-frame `voiced` flag drove which frames feed the
gauge. It was `!isQuiet` (silence gate: intensity OR confidence,
debounced) — which passes loud-but-unpitched material (breath,
fricatives, background noise). Noise has low CPP → reads as
"heavy/breathy," polluting the gauge. CPP measures harmonic periodicity,
so the principled gate is "the pitch detector confirms a pitch this
frame" (`hasPitch`).

The gate's contamination (share of gate-passing frames a Praat
reference calls unvoiced) dropped with the new gate on the private
session recording.
Applied to both the aggregator push and the baseline accumulate gate.

## Step 2 — freeze baseline μ/σ + widen span ±2σ→±3σ

The baseline was a 30-s sliding FIFO recomputing μ/σ every emit. Two
defects:

- **Mean-reversion:** a sustained change pulls μ to meet it, so the
  needle drifts back toward center as if nothing changed — on a
  sustained lighter passage the sliding gauge moved toward *heavier*
  while the voice stayed lighter, because μ rose; the frozen gauge
  stayed in the lighter half. This is almost certainly the bulk of
  "feels off."
- **Sensitivity drift:** a continuously-recomputed σ deadens the gauge
  whenever recent speech is varied (big σ) and over-sensitizes when
  monotone.

Fix: compute μ/σ once when the 30-s buffer first fills, then freeze both
for the session.

Frozen σ (measured over the calm first 30 s) underestimates full-session
spread, so a ±2σ span clamps more later frames than the sliding window
did. The span was widened: `BASELINE_SIGMA` 2 → 3 (chosen on a span
sweep over the private session recording; numbers kept outside this
repository).

**Trade-off (documented in code):** freezing means the first 30 s must be
reasonably representative — a throat-clear or deliberately-heavy warm-up
miscalibrates the whole session with no recovery until restart. The
"Calibrating…" UI implicitly asks for normal speech; accepted as the
zero-interaction cost. The sliding window's "adaptivity" was not a
feature here — it was the mean-reversion bug.

## Step 3 — Maryn CPPS chain: quefrency-bin count

The 2026-05-10 component isolation already established that of the Maryn
additions only **quefrency smoothing helped** (mean Praat r 0.460 →
0.487 at 3 bins; Theil regression, exponential trend, and time smoothing
all hurt and were reverted). The bin *count* was taken from Praat's
default 3 and never swept. Sweep (`cpp-quefrency-bins-sweep-2026-06-10
.json`):

| bins | hillen | ptdb | vocad | fda | mean r |
|---|---|---|---|---|---|
| 1 | 0.387 | 0.615 | 0.273 | 0.648 | 0.481 |
| 3 (old) | 0.351 | 0.635 | 0.272 | 0.711 | 0.493 |
| **5** | 0.380 | 0.629 | 0.267 | **0.724** | **0.500** |
| 7 | 0.360 | 0.616 | 0.263 | 0.687 | 0.481 |
| 11 | 0.320 | 0.619 | 0.315 | 0.654 | 0.477 |

5 is the peak (FDA 0.711 → 0.724, others flat; 7+ regress). Marginal but
free — `CPP_DEFAULT_QUEFRENCY_SMOOTH_BINS` 3 → 5. **This knob family is
now exhausted**: the Maryn chain has no further correlation headroom.

## Honest limitations (carried forward)

- **No weight ground truth exists**, so "accuracy" here means Praat-CPPS
  correlation (a proxy) + internal consistency, not validated weight.
- **Aggregate CPP spread is tiny on consumer-mic running speech**. The
  gauge resolves weight from a very small dynamic range — inherently
  sensitive to measurement noise. Pushing Praat correlation past ~0.5 within a single corpus
  appears to require either spectral-tilt fusion (the deferred step 4) or
  perceptual-rating calibration (rejected on interaction grounds).
- Per-corpus correlations remain moderate (0.27–0.72). The gauge is a
  best-effort relative proxy, not a calibrated weight meter; framing in
  any user-facing copy should stay comparative.

## Verification

cpp-test 28/28, vocal-weight-baseline 56/56 (sliding-behavior tests
rewritten as freeze tests), vocal-weight-aggregator 42/42, lint clean
(production), build passes.
