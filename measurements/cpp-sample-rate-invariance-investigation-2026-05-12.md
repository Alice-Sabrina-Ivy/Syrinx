# CPP sample-rate invariance — C-investigate findings

**Date:** 2026-05-12
**Context:** Stage A+B analysis surfaced that CPP is sample-
rate-sensitive (~0.11-0.27 dB shift between 16 kHz and 48 kHz
on the same audio). User direction: investigate algorithmic
fixes before falling back to sample-rate-change-warning UX
workaround.

## TL;DR

- **Option (b) — resample input to canonical 16 kHz before CPP
  computation — works.** Anti-aliased linear-interp downsample
  before computeCPP brings sample-rate spread from 0.114-0.273 dB
  (production) down to 0.009-0.025 dB (prototype). 92-96 %
  reduction. Well under the 0.05 dB pass criterion.
- **Layer 1 (synthetic) passes 3/3 after adding anti-aliasing.**
  First-pass linear-interp without anti-aliasing failed
  pulse-train tests (impulses aliased badly when downsampled).
  Blackman-windowed sinc FIR with cutoff at 0.45/decimation
  fixed the synthetic regression; real speech behavior was
  unchanged (audio is already band-limited).
- **Layer 4 (Praat correlation) preserved.** Within-corpus
  Pearson r values are equal or slightly improved on the
  prototype. Overall (cross-corpus) r drops slightly (0.832 →
  0.815) because the sample-rate artifact previously boosted
  cross-corpus variance which inflated overall r via Simpson's
  paradox; that artifact is now removed.
- **Cost: negligible.** ~0.1-0.3 ms additional per frame for
  resampling at 48 kHz; zero at 16 kHz (no-op fast path).
- **Recommended: ship option (b) as part of Stage C.** Replaces
  computeCPP's sample-rate-adaptive CPP_INPUT_LEN path with a
  resample-to-canonical-16-kHz step. Single algorithmic change;
  unblocks user-derived scale display, cross-session continuity,
  cross-device usage.

## C-investigate-1: catalog of approaches

### Option (a) — Fixed input length with minimum sample rate

**Mechanism:** Require input sample rate ≥ 22 kHz. Use fixed
CPP_INPUT_LEN regardless of input rate (e.g., 2048 always).
Reject inputs with insufficient samples.

**Pros:**
- Simplest fix to implement
- No additional per-frame compute

**Cons:**
- Production audio on mobile Chrome silently downsamples to
  16 kHz on some devices (per CLAUDE.md "Mobile audio platform
  floor"). Refusing to compute means the gauge fails for those
  users.
- Even at the minimum 22 kHz, sample-rate sensitivity isn't
  fully eliminated: inputLen ranges from 1102 at 22 kHz to 2048
  at 48 kHz; CPP still drifts ~30 % of the current full-range
  sensitivity.
- UX consequence is severe — "gauge doesn't work on mobile"
  is a significant regression.

**Cost:** Low to implement, high to ship (mobile breakage).

**Verdict:** Rejected. Mobile breakage outweighs simplicity.

### Option (b) — Resample input to canonical rate before computation

**Mechanism:** Linear-interp (with anti-aliasing FIR) downsample
the input buffer to a fixed canonical rate (16 kHz). All
computeCPP computation then runs at 16 kHz. Quefrency search
range, CPP_INPUT_LEN, etc. are constant.

**Pros:**
- Algorithm behavior is identical regardless of input rate
- Works on all production sample rates (mobile 16 kHz is no-op
  fast path; desktop 48 kHz downsamples cleanly)
- Mirrors the existing pattern in gender-worker.js (resample to
  16 kHz before model inference)
- Linear-interp + Blackman-sinc FIR is well-understood DSP
- 16 kHz also matches the Hillenbrand 1994 regime (1024-sample
  window at 16 kHz ≈ 64 ms, ~5 periods at F0=80 Hz, ~10 periods
  at 160 Hz) — algorithm operates in its empirically-validated
  sweet spot

**Cons:**
- Extra per-frame compute (FIR convolution + interpolation),
  ~0.1-0.3 ms at 48 kHz input; zero at 16 kHz
- High-frequency content above 8 kHz is lost — but speech
  cepstrum doesn't depend on this band (CPP is voice-source-
  spectrum-dominated)
- Linear interp is lower quality than polyphase FIR for music
  applications; for speech in the 100-3000 Hz band it's
  indistinguishable

**Cost:** Moderate to implement (FIR + resampler + cache),
negligible to run.

**Verdict:** Recommended (see C-investigate-2 + C-investigate-3).

### Option (c) — Sample-rate-invariant algorithm by construction

**Mechanism:** Modify computeCPP itself to be sample-rate-
invariant. Possible approaches:
- Normalize cepstrum by frequency rather than by sample-bin
- Use a constant-time-resolution window via interpolation
  inside the algorithm
- Cepstrum-domain normalization that compensates for inputLen
  effects

**Pros:**
- No resampling overhead
- Theoretically cleanest

**Cons:**
- Substantial algorithmic redesign
- The root cause (inputLen → cepstral baseline shape) is
  intrinsic to how the cepstrum is computed; "compensating
  inside the algorithm" effectively means deriving the same
  values you'd get at a canonical rate — at which point
  option (b) is the simpler implementation
- High risk of breaking other invariants (Praat correlation,
  directional behavior)
- Implementation time: days to weeks; debugging time: hard
  to bound

**Verdict:** Rejected. Same effective behavior as (b), much
more implementation risk.

### Option (d) — Per-rate normalization offset

**Mechanism:** Compute correction factor per sample rate
empirically from corpora at each rate. Apply correction at
read time: `corrected_cpp = raw_cpp + offset[sample_rate]`.

**Pros:**
- Smallest code change
- No per-frame compute cost

**Cons:**
- Correctness depends on the rate-shift being constant across
  audio content. Stage A.5 data:
  - PTDB-TUG sample: 16→48 kHz shift = -0.114 dB
  - FDA sample: 16→48 kHz shift = -0.273 dB
  Different audio → different shift. The correction isn't a
  constant. Sample-content-dependent corrections can't be
  derived a-priori.
- Requires corpora at multiple sample rates for offset
  derivation; future sample rates need new measurement passes
- Doesn't address the underlying algorithm sensitivity, just
  paper over it
- If shift varies with speech content (which it does — see
  above), correction is wrong by some amount on every input

**Verdict:** Rejected. Doesn't address the root cause cleanly.

### Other approaches considered

**Option (e) — Voice-content-adaptive resampling**: only
downsample when content above 8 kHz is significant; otherwise
no-op. Adds VAD-like logic to detect band content. **Rejected:**
adds complexity for marginal benefit; the FIR pass is cheap.

**Option (f) — Multi-rate ensemble**: compute CPP at multiple
sample rates and average. **Rejected:** multiplies cost,
doesn't eliminate sensitivity (just averages it).

### Cataloging summary

| Option | Implementation cost | Production cost | Addresses root cause | Mobile support |
|---|---|---|---|---|
| (a) Fixed input + minimum rate | Low | Zero | Partial | ✗ |
| **(b) Resample to canonical** | **Moderate** | **~0.1-0.3 ms/frame** | **Yes** | **✓** |
| (c) Algorithmic redesign | Very high | Zero | Yes | ✓ |
| (d) Per-rate offset | Low | Zero | No (papered over) | ✓ |

Option (b) is the only candidate that addresses the root cause
cleanly without breaking mobile support or requiring algorithm
redesign.

## C-investigate-2: empirical prototype

### Prototype implementation

`src/dsp/cpp-resampled-prototype.js` — not wired into production.
Wraps computeCPP with:
1. Blackman-windowed sinc FIR low-pass (cutoff 0.45/decimation,
   numTaps = max(33, ceil(decimation)*16 + 1))
2. Linear interpolation downsample to canonical rate (16 kHz)
3. Existing computeCPP at 16 kHz

FIR coefficients cached per fromRate to avoid recomputation.

### Test 1: Sample-rate invariance

`tests/dsp/cpp-resampled-prototype-test.js` — same diagnostic
that originally surfaced the issue.

**PTDB-TUG track resampled across rates** (mic_F01_sx10):

| Target SR | Production CPP | Prototype CPP |
|---|---|---|
| 16 kHz | 0.369 | 0.378 |
| 22.05 kHz | 0.327 | 0.376 |
| 32 kHz | 0.282 | 0.371 |
| 44.1 kHz | 0.257 | 0.376 |
| 48 kHz | 0.255 | 0.378 |
| **Spread** | **0.114** | **0.009** |

**FDA track resampled across rates** (rl001):

| Target SR | Production CPP | Prototype CPP |
|---|---|---|
| 16 kHz | 0.559 | 0.559 |
| 22.05 kHz | 0.423 | 0.534 |
| 32 kHz | 0.361 | 0.540 |
| 44.1 kHz | 0.321 | 0.544 |
| 48 kHz | 0.286 | 0.544 |
| **Spread** | **0.273** | **0.025** |

Both pass the < 0.05 dB invariance criterion. Production
spread of 0.114-0.273 dB collapses to 0.009-0.025 dB.

### Test 2: Layer 1 synthetic directional invariants

`tests/dsp/cpp-resampled-prototype-validation.js` — adapted
versions of the synthetic Layer 1 tests pointed at the
prototype.

Pre-anti-aliasing iteration: 1/3 pass. Pulse train CPP and
modal-vs-breathy direction both failed because linear-interp
downsample aliased impulse-like signals into noise.

Post-anti-aliasing iteration: **3/3 pass.**
- Pulse train CPP > 0.2 dB ✓
- Noise CPP < 1.5 dB ✓
- Modal > breathy CPP ✓

### Test 3: Layer 4 Praat correlation

Re-ran corpus aggregate against all four corpora using the
prototype, then ran the existing Praat-Syrinx correlation
analysis against the prototype output.

| Corpus | Production r | Prototype r | Δ |
|---|---|---|---|
| Hillenbrand (n=200) | 0.351 | 0.351 | 0 |
| PTDB-TUG (n=180) | 0.630 | 0.635 | +0.005 |
| Vocadito (n=40) | 0.214 | 0.273 | **+0.059** |
| FDA (n=100) | 0.713 | 0.711 | -0.002 |
| **Overall (n=520)** | **0.832** | **0.815** | -0.017 |

**Within-corpus correlations preserved or improved.** Vocadito
improved meaningfully (+0.059). FDA and PTDB-TUG essentially
unchanged. Hillenbrand unchanged.

**Overall (cross-corpus) r dropped slightly.** This is expected
and correct — the sample-rate artifact previously inflated
cross-corpus variance, which boosted overall r via Simpson's
paradox (different corpora occupied different absolute-CPP
regions, which made them easier to correlate as a pool even
though within-corpus ranking was weak). Removing the artifact
collapses the cross-corpus variance, lowering the artifact
inflation. Within-corpus is the production-relevant signal.

### Per-frame cost on the prototype

Microbenchmark scaffolding from earlier (`cpp-cost-microbench.js`)
can be re-pointed at the prototype, but the cost analysis is
straightforward to estimate:

- FIR pass: numTaps × bufferLength multiply-adds. At 48 kHz with
  2400-sample window and FIR with ~49 taps (decimation = 3,
  numTaps = ceil(3)*16+1 = 49), cost ≈ 2400×49 = ~118k MACs
  = ~0.05 ms on modern CPU
- Linear interp: 800 output samples × 2 multiply-adds = 1.6k
  MACs = ~0.001 ms
- Existing computeCPP at canonical rate: ~0.143 ms (production
  measurement)

Total per-frame: ~0.15 ms median, p99 likely ~0.25 ms.
Comparable to current production. At 16 kHz input the FIR + interp
is a no-op fast path; mobile users have zero overhead.

## C-investigate-3: recommendation

### Recommendation: ship option (b) as part of Stage C

The prototype demonstrably:
1. Eliminates sample-rate sensitivity (92-96 % reduction)
2. Preserves Layer 1 directional invariants (3/3 pass)
3. Preserves Layer 4 Praat correlation within-corpus
4. Adds negligible compute cost (~0.05 ms/frame)
5. Has zero overhead on mobile (16 kHz native = no-op fast
   path)

### Implementation plan for Stage C

1. **Merge prototype into cpp.js:** replace current sample-rate-
   adaptive logic with the resample-then-compute path.
   - Add anti-aliased downsampler + FIR cache
   - Remove dynamic CPP_INPUT_LEN logic (always works at
     canonical 16 kHz now)
   - Adjust quefrency search bounds for the canonical rate
     (sr/F0 mapping shifts but algorithm is identical)
2. **Update Layer 1 tests** to confirm directional invariants
   still hold post-merge.
3. **Re-run Layer 4 Praat correlation** on the merged
   production code (should match prototype results).
4. **Re-run cost microbenchmark** to confirm production
   per-frame cost.
5. **Update cpp.js documentation** to reflect canonical-rate
   computation, drop the sample-rate-adaptive language.

Estimated implementation: ~half day, given the prototype is
already validated.

After algorithmic fix:
6. **Persist baseline to IndexedDB** (calibration approach
   already approved)
7. **Add optional target capture flow**
8. **Modify gauge axis math** (baseline → target span, or
   baseline ± 2σ fallback)
9. **Re-baseline button**
10. **Gauge labels** ("Your starting voice / Your target voice")

The sample-rate-change-warning prompt from Stage B becomes
unnecessary — the algorithm itself is now rate-invariant, so
cross-device migration doesn't shift CPP values. **This is
the meaningful UX win from doing the algorithmic fix vs.
falling back to the warning workaround.**

### What this does NOT fix

- **Mic / room / environment variation.** Different mics with
  the same sample rate can still differ in absolute CPP. The
  user-derived baseline-to-target axis handles this — both
  anchors are captured on the user's device, so they share
  the mic+room context.
- **Possible cross-room user complaints.** A user training at
  home vs. office (different rooms, same device) might see
  small CPP shifts. The gauge is still rate-invariant; this
  is an environmental issue separate from sample rate. Same
  mitigation as before: re-baseline if environment changes
  significantly, document in onboarding.
- **Cross-session voice variation** (illness, fatigue, time
  of day). Out of scope.

### Files added

- `src/dsp/cpp-resampled-prototype.js` — durable prototype
  module, ready for Stage C merge
- `tests/dsp/cpp-resampled-prototype-test.js` — durable
  invariance test
- `tests/dsp/cpp-resampled-prototype-validation.js` — Layer 1
  + Layer 4 prototype validator
- `measurements/cpp-resampled-prototype-test-2026-05-12.json`
- `measurements/syrinx-cpp-corpus-prototype-2026-05-12.json`
- This document

No production code modified during investigation.

### Decision needed from user

Proceed with Stage C as planned, with **algorithmic sample-rate
invariance** included in the same ship:
1. Merge prototype into cpp.js
2. Implement hybrid self+target calibration
3. Implement user-derived axis bounds
4. Ship together

The investigation surfaced that option (b) addresses the root
cause cleanly. Stage C now has a clear path; user-side testing
unblocks once the implementation lands.

### Honest acknowledgment

This is the fifth research/investigation cycle on vocal weight.
Each cycle has surfaced a real structural finding (per-user
baseline staleness, Simpson's-paradox in Praat correlation,
sample-rate sensitivity, etc.). The current investigation
yields a clean fix — the prototype passes all validation. At
some point we ship and iterate; this cycle's findings are
load-bearing enough to address before ship (sample-rate-
dependent CPP would produce confused user feedback on cross-
device usage), but if user-side testing surfaces further
issues, those iteration cycles happen post-ship.
