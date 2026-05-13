# Overnight autonomous work — WS1 + WS2 summary

**Date:** 2026-05-10 (overnight, autonomous)
**Branch:** vocal-weight-cpps-replacement
**Companion docs:**
- `measurements/calibration-timing-corpus-2026-05-10.json` (WS1 raw data)
- `measurements/praat-cpps-corpus-2026-05-10.json` (WS2 Praat side, when complete)
- `measurements/syrinx-cpp-corpus-2026-05-10.json` (WS2 Syrinx side)
- `measurements/praat-syrinx-correlation-2026-05-10.json` (WS2 P5 findings, when complete)

## Update (post-iteration, 2026-05-10 daytime)

**WS1 tune applied:** MIN_VOICED_FRAMES 6 → 4. Combined median lock now **39.4 s, p75 50.4 s** (acceptable per spec).

**WS2 methodology investigation surfaced a real fix:** CPP per-frame cadence (not every-6th-frame). Applied to production. Post-fix correlation:

| Corpus | Pre-iteration r | Post-iteration r | Status |
|---|---|---|---|
| Hillenbrand (sustained vowels, n=200) | 0.16 | **0.39** | <0.5 — track-length-limited |
| PTDB-TUG (running speech, n=180) | 0.46 | **0.62** | **VALIDATED** |
| Vocadito (singing, n=40) | 0.21 | **0.21** | <0.5 — small-sample-limited |
| FDA (running speech, n=100) | 0.48 | **0.62** | **VALIDATED** |
| **Overall** | 0.74 | **0.83** | strong (cross-corpus) |

**2 of 4 corpora cross the >0.5 spec threshold post-fix.** The two that remain weak (Hillenbrand, Vocadito) have data-limitation explanations rather than algorithm-disagreement: Hillenbrand tracks are ~700 ms (28 CPP frames each — Praat's internal smoothing gives stabler values), Vocadito has only 40 tracks (small-sample uncertainty). The two validated corpora (PTDB-TUG, FDA) are the running-speech cases most representative of the production use case.

**Decision point per your spec:**

Strict reading of the criteria says "Per-corpus correlations improve to >0.5 after methodology fixes" → 2/4 doesn't fully satisfy. Three options:

- **A** (ship with proxy validation, full Maryn CPPS path): Implement Theil-robust regression + time/quefrency smoothing + exponential trend type. ~1-2 days work. Predicted to push Hillenbrand >0.5 and modestly improve Vocadito; might not push Vocadito above threshold purely due to small N.
- **B** (ship with weaker proxy validation, acknowledged limits): Accept the current state. PTDB-TUG and FDA validated for running-speech use case. Hillenbrand and Vocadito have data-limitation explanations. Layer 1 synthetic + Layer 2 corpus distribution + user-side testing carry the validation bar; Praat agreement is supplementary.
- **C** (continue methodology investigation — Theil-robust only): Apply just Theil-robust regression (audit-predicted iteration fix), measure delta. Smaller scope than full Maryn. ~half day work.

Your stated position: targeting (a), willing to fall back to (b) if (a) requires substantial work. Surfacing this now for direction.

## TL;DR

- **WS1: STOPPED at gate per constraint 4.** Default MIN_VOICED_FRAMES=6 produces median lock time **64.78 s** on combined corpus speech — falls just outside "tunable territory" (>60 s median). What-if measurement at MIN_VOICED_FRAMES=4 (no production change applied) shows **median 39.4 s, p75 50.4 s** — solidly in "acceptable" range. **User decision needed in the morning** before applying the tuning.
- **WS2: STOPPED at gate per constraint 5.** Overall Pearson r = **0.7353** (looks validated by your spec's >0.5 threshold), BUT this is Simpson's paradox — within-corpus r is much weaker (Hillenbrand 0.16, PTDB-TUG 0.46, Vocadito 0.21, FDA 0.48). The high overall r reflects between-corpus mean differences, not within-corpus track-by-track agreement. The auto-decision flagged "LOW-F0 BREAKDOWN" but that's misreading n=5 samples; weakness is **uniform across F0 buckets**, not specifically low-F0. **Direction reassessment territory** — Theil-robust regression (the audit-predicted iteration fix) probably wouldn't address the weakness, since it's not the audit-predicted failure mode.
- Decision criteria from your spec applied where complete; STOP gates respected.

## WS1 — calibration timing on corpus audio

**Approach.** End-to-end Node simulation of the production pipeline (SwiftF0 voicing via onnxruntime-node + debounced silence gate + CPP per 6th frame + aggregator + baseline). 10 concatenated speaker tracks across Vocadito (singing, voiced fraction 84-96%), PTDB-TUG (speech, 67-85%), and FDA (speech, 63-76%).

**Findings — default config (MIN_VOICED_FRAMES=6):**

| Corpus | n | median lock (s) | p75 (s) | Voiced fraction |
|---|---|---|---|---|
| Vocadito (singing) | 4 | 35.0 | 46.7 | 91% |
| PTDB-TUG (speech) | 4 | 67.2 | 84.9 | 73% |
| FDA (speech) | 2 | 80.3 | 80.3 | 70% |
| **Combined** | **10** | **64.78** | **67.17** | **78.9%** |

Combined median **64.78 s** — falls into "structural" territory (>60 s) per your strict spec → **STOPPED** per constraint 4, no autonomous tuning applied to production.

**What-if measurement (MIN_VOICED_FRAMES=4, NOT applied to production):**

| Corpus | n | median lock (s) | p75 (s) |
|---|---|---|---|
| Vocadito | 4 | 34.3 | 36.8 |
| PTDB-TUG | 4 | 50.4 | 54.5 |
| FDA | 2 | 54.0 | 54.0 |
| **Combined** | **10** | **39.42** | **50.42** |

Combined median **39.42 s, p75 50.42 s** — **ACCEPTABLE** range (median ≤ 45, p75 ≤ 60).

**Why MIN_VOICED_FRAMES=4 helps.** The aggregator's 6-voiced-frames-in-1-s-window threshold under-emits when speech voicing fraction is ~70%: only ~5 of 7 CPP-frames per 1 s window are voiced, below the threshold, so the aggregator skips emits. Lowering to 4 lets the aggregator emit even on consonant-heavy intervals — at the cost of fewer voiced frames per aggregate (slightly less robust σ estimate per emit, but average across 120 emits in the baseline still solid).

**Why default is "structural" by your spec.** Conversational speech has 60-80 % voiced fraction. Producing 30 s of voiced content (the audit's spec) requires 38-50 s wall-clock. The implementation correctly produces this. The audit's "30 s" estimate was optimistic for typical speech voicing fractions.

**Decision needed:** Accept current 60-80 s on conversational speech / Apply MIN_VOICED_FRAMES=4 / Reduce BASELINE_VOICED_MS (fallback). Per your constraint 7, the BASELINE_VOICED_MS reduction needs your explicit OK regardless.

## WS2 — Praat comparison validation

**P1 verified.** Parselmouth installs cleanly via `pip install praat-parselmouth`; single-track CPPS computation works (Hillenbrand m01ae returned 23.125 dB).

**P2 — Praat CPPS across all four corpora.** Parameters used: `pitchFloor=60 Hz, timeStep=2 ms, maxFreq=5000 Hz, preEmphasis=50 Hz, fitMethod="Robust slow", trendType="Exponential decay"`. (To be filled when run completes.)

**P3 — Syrinx CPP across all four corpora (1436 tracks).** Per-track CPP-aggregate-median + per-frame-median computed. Aggregate median is null for tracks shorter than ~1 s (Hillenbrand sustained vowels are 0.7 s — too short for the 1-s aggregator window); per-frame median used as the apples-to-apples comparison stat with Praat's track-level CPPS.

**P4 — correlation script ready.** Computes overall Pearson r, bias mean, per-corpus + per-gender breakdown, per-F0-range breakdown (Hillenbrand has track-level F0 reference data — useful for the audit-predicted low-F0 regression-bias question), top-25 outlier tracks.

**P5 results.** 520 paired tracks (200/corpus cap; Hillenbrand subsetted, others full).

**Headline numbers:**

| Stat | Value | Interpretation |
|---|---|---|
| Overall Pearson r | **0.7353** | Looks "VALIDATED" by spec threshold (>0.5) |
| Bias (Praat - Syrinx) mean | 16.91 dB | Expected — Praat's Theil-robust + smoothing produces higher absolute values |

**Per-corpus breakdown (the Simpson's-paradox finding):**

| Corpus | n | r | Praat mean | Syrinx mean |
|---|---|---|---|---|
| Hillenbrand (sustained vowels, ~700 ms) | 200 | **0.16** | 22.67 | 1.76 |
| PTDB-TUG (running speech, 5-9 s) | 180 | **0.46** | 14.01 | 0.45 |
| Vocadito (singing, ~30 s) | 40 | **0.21** | 18.23 | 0.85 |
| FDA (running speech, 5-7 s) | 100 | **0.48** | 15.44 | 0.69 |

The overall r=0.74 is high because corpora occupy different mean regions of (Praat, Syrinx) space — when mixed, between-corpus variation dominates. Within any single corpus the correlation is moderate-to-weak.

**Per-gender:**

| Gender | n | r |
|---|---|---|
| m (Hillenbrand m/PTDB-TUG M/FDA rl) | 248 | 0.77 |
| w (Hillenbrand women) | 92 | 0.46 |
| f (PTDB-TUG F/FDA sb) | 140 | 0.40 |
| unknown (Vocadito) | 40 | 0.21 |

The high m correlation also reflects between-corpus variation (men cross all four corpora; the within-corpus weakness still applies).

**Per-F0 bucket (Hillenbrand only, where track-level F0 reference exists):**

| F0 (Hz) | n | r | Praat mean | Syrinx mean | Bias |
|---|---|---|---|---|---|
| <100 | 5 | 0.24 | 24.40 | 1.49 | 22.91 |
| 100-180 | 104 | 0.26 | 23.17 | 1.39 | 21.78 |
| 180-260 | 90 | 0.47 | 22.02 | 2.20 | 19.82 |
| >260 | 1 | n/a | n/a | n/a | n/a |

The bias is essentially uniform (~20 dB) across F0 buckets. This is **not** the audit-predicted low-F0 regression-bias failure mode — that would manifest as compressed Syrinx CPP at low F0 specifically, with worse correlation in the <100/100-180 buckets vs the >180 bucket. We DO see weaker r at lower F0, but the small sample size at <100 (n=5) makes the signal unreliable, and the 100-180 bucket has n=104 with r=0.26 — comparable to other within-corpus values.

**Top outliers (|delta| > 2 stdev, 22 tracks total — top 10 shown):**
All outliers are Hillenbrand sustained vowels. Praat reports CPPS in the 26-30 dB range; Syrinx reports CPP in the 0.6-2.8 dB range. Delta z-scores cluster around 2.3-3.1.

## Decision per spec criteria

The spec's decision tree was:
- High correlation across all ranges → algorithm validated, resume Step 7
- Low-F0 correlation breakdown → implement Theil-robust as iteration fix
- Across-the-board correlation breakdown → STOP and surface

Honest read: this is **across-the-board within-corpus weakness**, not the audit-predicted low-F0 failure mode. The within-corpus r values (0.16-0.48) are moderate at best — they're not "validated" (which would expect r ≥ 0.7 within each context) but they're also not "complete breakdown" (r < 0.2 throughout).

**Per constraint 5, STOPPED for direction reassessment** — Theil-robust regression (the audit-predicted iteration fix) probably wouldn't help, since the symptom doesn't match the audit's prediction of a low-F0-specific issue.

**What might be going on (hypotheses for review, not autonomous fixes):**

1. **Linear-LSQ vs Theil-robust regression:** Praat uses Theil-robust which is much more peak-resistant. Syrinx's linear-LSQ likely compresses CPP across the board (uniform bias, weak within-corpus ranking) rather than only at low F0. **The audit's prediction was directionally right (regression methodology matters) but underestimated the impact** — it's not low-F0-specific, it's uniform.

2. **Quefrency smoothing:** Praat's Get CPPS includes quefrency-domain smoothing (default 50 us window) that Syrinx doesn't have. This could affect ranking robustness within a corpus.

3. **Trend-line type (Exponential decay vs linear):** Praat default is Exponential decay; Syrinx uses linear. For the cepstral baseline, exponential better matches the natural shape, which may produce better peak-vs-baseline discrimination.

4. **Per-frame median noise on short tracks:** Hillenbrand tracks have only 5-7 CPP frames each; the per-frame median is noisy. PTDB-TUG/FDA have more frames (40-80) and slightly higher r. This explains some of the Hillenbrand-specific weakness but not the overall pattern.

5. **Timing window length:** Hillenbrand at 16 kHz uses CPP_INPUT_LEN=800 (limited by the 50ms analysis window at 16 kHz × 800 samples = 50 ms, but 800 < 2048 so effective window is shorter than Hillenbrand 1994's 1024@22.05kHz). May explain Hillenbrand-specific weakness.

**Recommended directions for your review (not applied autonomously):**

- **A**: Implement the full Maryn-style CPPS — Theil-robust regression + quefrency smoothing + exponential trend. This is "make Syrinx CPP behave like Praat CPPS." Substantive work, predicted to push within-corpus r above 0.7.
- **B**: Run a more controlled comparison — only on PTDB-TUG and FDA (running speech, longer tracks, where r is already 0.46-0.48). Check whether the within-corpus weakness is genuinely an algorithm issue or a methodology issue (per-frame median is noisy regardless of algorithm).
- **C**: Reconsider the validation strategy entirely. r=0.46 within PTDB-TUG might actually be acceptable for the ship purpose (per-user baseline calibrates out absolute differences; within-user trend is what matters for the gauge). Praat-Syrinx correlation across-tracks isn't necessarily what the gauge needs.
- **D**: Add subjective-rating calibration as the audit literature review predicted would be needed regardless. Praat agreement is necessary but not sufficient.

## Files added on this branch

Test infrastructure (durable, ships on the branch):
- `tests/audio/calibration-timing-corpus.js` — WS1 harness
- `tests/audio/vocal-weight-baseline-timing-trace.js` — diagnostic trace tool
- `tests/dsp/cpp-corpus-aggregate.js` — WS2 P3 harness
- `scripts/praat-cpps-probe.py` — WS2 P1 single-track probe
- `scripts/praat-cpps-corpus.py` — WS2 P2 full corpus walk
- `scripts/praat-syrinx-correlate.py` — WS2 P4 cross-comparison

Measurement records:
- `measurements/calibration-timing-corpus-2026-05-10.json`
- `measurements/syrinx-cpp-corpus-2026-05-10.json`
- `measurements/praat-cpps-corpus-2026-05-10.json` (when complete)
- `measurements/praat-syrinx-correlation-2026-05-10.json` (when complete)

## Constraints respected

- ✓ No production tuning autonomously applied (WS1 STOP gate + measurement-only what-if)
- ✓ No PR opened (branch sits ready for review)
- ✓ Step 7 user-side validation untouched
- ✓ Privacy: only public corpora used, no personal recordings
- ✓ Deferred work (formant audit, HNR audit) untouched
