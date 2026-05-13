# Stage A + B — CPP scale-display analysis

**Date:** 2026-05-11
**Context:** User direction confirmed hybrid self+target as the
calibration approach (per the [calibration research
appendix](vocal-weight-calibration-research-2026-05-11.md) §8.5).
Open question: what scale should the gauge axis display against?
The user proposed Option D — gauge axis bounds derived from
empirical running-speech-corpus CPP distribution.

This document covers the empirical distribution analysis (Stage A),
a sample-rate sensitivity diagnostic (Stage A.5, surfaced by the
distribution analysis), and the resulting scale-display
recommendation (Stage B).

## TL;DR

- **Option D as proposed is NOT viable.** Fixed corpus-derived axis
  bounds would place the same user's voice at materially different
  gauge positions depending on their device's sample rate. CPP is
  sample-rate-sensitive at the level that matters for fixed bounds:
  ~1.4-2× shift in CPP between 16 kHz (mobile silent downsample)
  and 48 kHz (desktop default) on the same audio.
- **Recommended axis-display strategy: user-derived bounds.**
  Gauge axis spans `baseline → target` if target captured, or
  `baseline ± 2σ_from_baseline_capture` if no target. Population
  data is NOT used for axis bounds. This is congruent with the
  hybrid self+target calibration recommendation already approved
  for the calibration layer.
- **Distribution shape findings.** Running-speech pool is bimodal
  in absolute CPP space (PTDB-TUG cluster at ~0.26 dB, FDA cluster
  at ~0.65 dB). Most of the bimodality is a sample-rate artifact:
  resampling PTDB-TUG (48 kHz native) to 16 kHz shifts its CPP
  from 0.26 to 0.37; resampling FDA (20 kHz native) to 48 kHz
  shifts from 0.56 to 0.29. Some residual cross-corpus environment
  variation persists after sample-rate normalization, but the
  algorithm sensitivity dominates.
- **Within-corpus IQR is tight on controlled corpora** (PTDB-TUG
  IQR 0.010 dB, FDA IQR 0.140 dB) suggesting that within-user
  consistent-device CPP variation is small. This makes
  baseline-relative scale display viable: a user's typical
  variation is well-bounded around their own baseline.

## Stage A — empirical distribution analysis

Data source:
`measurements/syrinx-cpp-corpus-2026-05-10.json` (per-track CPP
aggregate + per-frame medians, all 1436 corpus tracks, production
aggregation settings: divisor=1, MIN_VOICED_FRAMES=4, 3-bin
quefrency smoothing).

Script: `tests/dsp/cpp-corpus-distribution-analysis.js`
Output: `measurements/cpp-corpus-distribution-analysis-2026-05-11.json`

### A.1 Per-corpus distributions

| Corpus | n | Native SR | min | p5 | p25 | p50 | p75 | p95 | max | mean | stdev | IQR |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| Hillenbrand (sustained vowels) | 1116 | 16 kHz | 0.41 | 0.74 | 0.94 | 1.09 | 1.32 | 1.67 | 2.12 | 1.14 | 0.29 | 0.38 |
| PTDB-TUG (running speech) | 180 | 48 kHz | 0.25 | 0.25 | 0.26 | 0.26 | 0.27 | 0.29 | 0.32 | 0.26 | 0.01 | 0.010 |
| Vocadito (singing) | 40 | 44.1 kHz | 0.52 | 0.52 | 0.58 | 0.67 | 0.88 | 1.34 | 1.38 | 0.76 | 0.23 | 0.30 |
| FDA (running speech) | 100 | 20 kHz | 0.40 | 0.46 | 0.58 | 0.65 | 0.73 | 0.85 | 1.04 | 0.65 | 0.11 | 0.14 |

### A.2 Per-gender breakdown (where corpus permits)

Hillenbrand:
- M (n=540): p5=0.69, p50=0.98, p95=1.39, mean=1.01, stdev=0.22
- W (n=576): p5=0.84, p50=1.24, p95=1.76, mean=1.26, stdev=0.29

Gender separation: W mean (1.26) > M mean (1.01); ~0.25 dB shift.

PTDB-TUG:
- F (n=90): p5=0.25, p50=0.26, p95=0.29, mean=0.26, stdev=0.013
- M (n=90): p5=0.25, p50=0.26, p95=0.28, mean=0.26, stdev=0.009

Gender separation: negligible (means 0.262 vs 0.261).

FDA:
- M (n=50): p5=0.42, p50=0.60, p95=0.80, mean=0.61, stdev=0.12
- F (n=50): p5=0.54, p50=0.71, p95=0.85, mean=0.70, stdev=0.09

Gender separation: F mean (0.70) > M mean (0.61); ~0.09 dB shift.

Vocadito: gender unknown for all tracks.

### A.3 Distribution shape concerns

Running-speech pool (PTDB-TUG + FDA combined) is **bimodal**:

```
[0.25, 0.29):  172  ****************************************
[0.29, 0.33):    8  **
[0.33, 0.37):    0
[0.37, 0.41):    1
[0.41, 0.45):    3  *
[0.45, 0.49):    4  *
[0.49, 0.53):    4  *
[0.53, 0.57):   10  **
[0.57, 0.61):   11  ***
[0.61, 0.65):   15  ***
[0.65, 0.69):   15  ***
[0.69, 0.73):   13  ***
[0.73, 0.77):   12  ***
[0.77, 0.81):    4  *
[0.81, 0.85):    2
...
```

PTDB-TUG cluster at 0.25-0.29 (n=172, very narrow); FDA cluster at
0.49-0.81 (n=84, broader). The two clusters are 0.3+ dB apart
with a near-empty middle band. Pooling them and computing
percentiles gives misleading "central tendency" numbers because
the actual distribution has two peaks, not one.

This bimodality MUST be explained before recommending fixed
axis bounds — otherwise the gauge could place a single user's
voice in the wrong cluster region. The sample-rate sensitivity
diagnostic (Stage A.5) addresses it.

## Stage A.5 — sample-rate sensitivity diagnostic

Hypothesis: bimodality reflects sample-rate sensitivity in
computeCPP, not corpus content differences.

Script: `tests/dsp/cpp-sample-rate-sensitivity.js`
Output: `measurements/cpp-sample-rate-sensitivity-2026-05-11.json`

Method: take one corpus track from each running-speech corpus,
resample to multiple sample rates {16k, 20k, 22.05k, 32k, 44.1k,
48k}, compute median CPP at each. If CPP is sample-rate-invariant,
the medians should match across rates within ~0.1 dB.

### A.5.1 Results (real corpus audio resampled)

PTDB-TUG sample (mic_F01_sx10, 48 kHz native, 6.87s):

| Target SR | Median CPP | Δ from 48 kHz |
|---|---|---|
| 16 kHz | 0.369 | +0.114 |
| 20 kHz | 0.337 | +0.082 |
| 22.05 kHz | 0.327 | +0.072 |
| 32 kHz | 0.282 | +0.027 |
| 44.1 kHz | 0.257 | +0.002 |
| 48 kHz (native) | 0.255 | 0 |

FDA sample (rl001, 20 kHz native, 1.50s):

| Target SR | Median CPP | Δ from 48 kHz |
|---|---|---|
| 16 kHz | 0.559 | +0.273 |
| 20 kHz (native) | 0.477 | +0.191 |
| 22.05 kHz | 0.423 | +0.137 |
| 32 kHz | 0.361 | +0.075 |
| 44.1 kHz | 0.321 | +0.035 |
| 48 kHz | 0.286 | 0 |

**Verdict: sample-rate sensitivity confirmed.** Pattern is
monotonic — lower sample rate → higher CPP. Differential between
16 kHz and 48 kHz is ~0.11 dB on the PTDB sample and ~0.27 dB on
the FDA sample. Within the same CPP value range as the per-
gender effect (~0.09-0.25 dB) and the IQR (~0.01-0.14 dB on
running speech).

### A.5.2 How much of the bimodality is sample-rate sensitivity vs corpus content?

Looking at the data again, with sample-rate normalized to 48 kHz:

| Sample (at 48 kHz) | Median CPP |
|---|---|
| PTDB-TUG (mic_F01_sx10) | 0.255 |
| FDA (rl001) | 0.286 |

**Difference at the same sample rate: 0.031 dB.** Compare to
their native-rate medians: 0.255 vs 0.477 — a 0.222 dB gap that
collapses to 0.031 dB when both are resampled to 48 kHz.

**Most of the corpus-level bimodality is sample-rate sensitivity.**
The residual cross-corpus environment variation is ~0.03 dB —
much smaller than the algorithm's sample-rate effect.

### A.5.3 Synthetic-signal check

The synthetic-vowel diagnostic showed a different pattern — non-
monotonic across sample rates, with the synthetic value swinging
between 1.93 and 3.39 dB. This is consistent with FFT-bin/harmonic
alignment effects on synthetic signals (pure pulse trains have
harmonics that land at specific bin frequencies; at certain sample
rates the harmonics align cleanly with bin grids and at others
they don't).

For real speech (with naturally jittered harmonics), the synthetic
non-monotonicity disappears — the monotonic real-audio pattern is
the load-bearing finding. Lower SR → higher CPP for real signals.

### A.5.4 Why does this happen?

Likely cause: the sample-rate-adaptive CPP_INPUT_LEN.

cpp.js uses `min(buffer.length, CPP_INPUT_LEN)` with CPP_INPUT_LEN
capped at 2048 samples (production default). At 48 kHz, the 50 ms
analysis window has 2400 samples → uses full 2048 input + zero-pad
to FFT size 2048. At 16 kHz, the 50 ms window has 800 samples →
uses 800 input + zero-pads to 2048.

Different inputLen values → different effective frequency
resolution → different cepstral baseline → different peak-to-
baseline gap (CPP).

**This is a known design tradeoff** documented in cpp.js (the
sample-rate-adaptive path was added per Finding 1 in the earlier
audit cycle to make CPP work on mobile silent-downsample sample
rates). The tradeoff is correctness-vs-portability: making CPP
work across sample rates means CPP values differ across sample
rates.

## Stage B — recommendation for gauge axis bounds

### B.1 Option D as proposed (fixed corpus-derived bounds) is NOT viable

Reason: same voice on different devices produces materially
different CPP values. A user moving from desktop (48 kHz) to
mobile (16 kHz silent downsample) sees their CPP shift by
~0.11-0.27 dB without their voice changing. On a fixed axis
calibrated to a single sample rate's distribution, this would
appear as gauge movement.

Even if we adjust bounds per device sample rate, residual cross-
environment variation (mic gain, room acoustics, noise floor)
would still affect absolute CPP values. The gauge axis would be
unreliable across user contexts.

### B.2 Recommended approach: user-derived axis bounds

Gauge axis comes from the user's own baseline and target:

- **If user has captured both baseline AND target:** axis spans
  `min(baseline, target)` to `max(baseline, target)` with some
  padding (e.g., 10% on each end). Gauge polarity ("Lighter ←→
  Heavier") is determined by `sign(target - baseline)`. Current
  voice is plotted as a marker on this axis. Baseline tick and
  target tick are shown at their positions on the axis.

- **If user has captured baseline only (no target yet):** axis
  spans `baseline ± 2σ_from_baseline_capture`. σ is captured
  during baseline calibration (same as current implementation).
  The user can add a target later, at which point the axis
  switches to baseline-to-target.

- **Population data is NOT used for axis bounds.** It's also not
  used for "typical user is here" markers — that would re-
  introduce the sample-rate problem.

### B.3 Why this works

1. **User's baseline + target + current voice are all captured on
   the user's own device in the user's own environment.** Sample
   rate, mic, room are constant across the three. Their relative
   positions on the axis are meaningful even if absolute CPP
   values differ from another user's.

2. **Cross-session continuity is preserved** because baseline and
   target are persisted (per the calibration approach already
   approved). The user sees the SAME axis across sessions, even
   if they switch devices — though changing device mid-training
   would shift their current-voice marker (mitigation: prompt to
   re-baseline if device sample rate changes between sessions).

3. **No claim about "where this user falls in the population"**
   because population data doesn't reliably map across devices
   anyway. The gauge says "you are between your starting voice
   and your target," not "you are at the 70th percentile of
   female voices."

4. **The within-corpus IQR data validates this scale.** PTDB-TUG
   IQR is 0.01 dB and FDA IQR is 0.14 dB. Within a consistent-
   device context, a user's natural CPP variation is small (a
   fraction of the baseline-to-target distance the user is
   working toward). The axis isn't dominated by noise.

### B.4 Honest tradeoffs

- **Cross-device sample-rate shift remains a real issue.** A user
  who trains on desktop and then opens the app on mobile may see
  their gauge position shift by ~0.1-0.3 dB without their voice
  changing. Mitigations:
  1. Detect device sample rate at session start; if different
     from baseline-capture sample rate, prompt: "your audio
     setup changed; re-baseline?"
  2. Store sample rate alongside baseline/target so the gauge
     can warn when reading current voice at a different rate.
  3. Document this in onboarding.

- **No comparison to "typical users."** Some users may want this
  ("am I doing better than average?"). Tradeoff is that the
  comparison would be unreliable. Skip the comparison rather
  than ship an unreliable one.

- **Axis bounds depend on user's target choice.** If user picks a
  target very close to their baseline, the axis is narrow and
  small voice movements look big. If user picks a target far
  from baseline, the axis is wide and small voice movements look
  small. This is actually a UX feature, not a bug — the gauge
  scales to the user's chosen training distance. But documenting
  this in-app helps users understand the gauge isn't an
  "absolute" measure.

- **The within-corpus IQR finding is uncertain for the production
  case.** PTDB-TUG and FDA are studio-recorded controlled corpora;
  consumer-mic real-mic captures may produce wider within-user
  IQRs. The 0.01-0.14 dB figure is a *floor* on within-user
  variance, not a typical case. Step 7 user-side testing will
  surface the consumer-mic figure.

### B.5 Implementation notes (for Stage C if direction confirmed)

This is a relatively small change from the existing implementation:

1. **Persist baseline to IndexedDB** (replaces per-session
   re-capture). Schema already supports it via the Dexie
   `settings` table.
2. **Add optional target-capture flow**: ~30 seconds of voiced
   speech of the target voice, computed via the same CPP
   pipeline, persisted alongside baseline.
3. **Modify gauge axis math**:
   - If `baseline && target`: axis is `[min(b,t) - pad, max(b,t) + pad]`.
   - Else if `baseline`: axis is `[baseline - 2σ, baseline + 2σ]`.
   - Else: gauge shows "calibrating".
4. **Add re-baseline button** (already proposed in §5.1 of the
   calibration research).
5. **Add device-sample-rate-change warning** (new).
6. **Update gauge labels**: "Your starting voice" / "Your target
   voice" rather than fixed "Lighter / Heavier" anchors. Sign-
   of-difference determines visual polarity.

Total implementation: ~1-2 days. No new infrastructure beyond
what's in the calibration research §5.1 recommendation.

### B.6 What this does NOT solve

- Cross-device migration (sample-rate change). User must re-
  baseline if they change devices. Warning UX helps but the
  underlying algorithm sensitivity remains.
- Mic-specific variation (different mics on the same sample rate
  can still differ). Mitigation: same-session capture for both
  baseline and target (recommended in onboarding).
- "How does my voice compare to other people's voices?" — this
  question is out of scope for the gauge. Could be added later
  as an optional supplementary feature with explicit caveats,
  but doesn't belong on the main gauge.

## Files added

- `tests/dsp/cpp-corpus-distribution-analysis.js` — durable
  distribution analysis harness, re-runnable as corpus data
  evolves.
- `tests/dsp/cpp-sample-rate-sensitivity.js` — durable sample-
  rate-sensitivity diagnostic.
- `measurements/cpp-corpus-distribution-analysis-2026-05-11.json`
- `measurements/cpp-sample-rate-sensitivity-2026-05-11.json`
- This document.

## Decision needed from user

The Stage A finding (sample-rate sensitivity dominates absolute
CPP) rules out Option D as proposed (fixed population-derived
bounds). Recommendation: ship Option D-as-modified — user-derived
axis bounds with baseline-to-target spanning. This is congruent
with the hybrid self+target calibration recommendation, requires
minimal additional infrastructure, and avoids cross-device
inconsistency.

If approved: proceed to Stage C (implementation). If reassess:
surface a different direction.
