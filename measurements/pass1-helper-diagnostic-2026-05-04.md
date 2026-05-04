# Pass 1 helper diagnostic (2026-05-04)

> **Verdict: Explanation B is right. The current `steadyStateDetect` is
> producing artifacts on non-stationary signals.** The pass-1 real-speech
> numbers are contaminated and should not be the canonical Stage 2.B
> baseline. Helper redesign needed before pass 2 starts.
>
> **But the picture is richer than the simple A-vs-B framing suggested:**
> three methodologies behave very differently on real-speech, and the
> right fix isn't to make `steadyStateDetect` feed adjacent windows
> universally — comprehensive.js's stationary synthetic stimuli are
> actually well-served by the current helper. The fix is to use a
> *different* helper for real-speech-test specifically.

## Per-file diagnostic — top 3 worst-divergence female files

For each file:
- (a) steadyStateDetect — current pass-1 helper: reset HMM, feed central
  window `(lookback + 3)` times, return final result
- (b) sequential frames — step 25 ms hops over central 70 %, last non-null
- (b-median) — same as (b) but take the MEDIAN of the non-null trace
- (c) Stage 0 single window — historical baseline

```
w10uw  truth=238 Hz   571 ms recording   14 hops in (b)
  (a)        →  470.8 Hz   (err 232.8)
  (b) last   →  470.8 Hz   (err 232.8)
  (b) trace  →  [·, ·, 251, 245, 242, 242, 242, 239, 235, 235, 235, 471, 471, 471]
                                                              ^^^ trail-off jump
  (b-median) →  ~241 Hz    (err  3, the steady-state pitch)
  (c)        →  117.3 Hz   (err 120.7, Stage 0's halving)

w36uw  truth=219 Hz   756 ms recording   20 hops in (b)
  (a)        →  421.3 Hz   (err 202.3)
  (b) last   →  421.3 Hz   (err 202.3)
  (b) trace  →  [·, ·, 239, 445, 445, 445, 433, 433, 433, 421, 421×11]
                              ^^^ pitch jumps up early and stays high
  (b-median) →  ~421 Hz    (err 202)
  (c)        →  104.4 Hz   (err 114.6)

w10ei  truth=220 Hz   552 ms recording   14 hops in (b)
  (a)        →  421.3 Hz   (err 201.3)
  (b) last   →  445.4 Hz   (err 225.4)
  (b) trace  →  [·, ·, 226, 220, 220, 217, 217, 217, 214, 214, 421, 433, 445, 445]
                                                              ^^^ trail-off jump
  (b-median) →  ~218 Hz    (err  2)
  (c)        →  106.1 Hz   (err 113.9)
```

The traces reveal a phenomenon the simple A-vs-B framing missed:

- **In w10uw and w10ei**, the recording's pitch is genuinely steady around
  the truth f0 for the first 9-11 hops, then jumps to roughly 2× truth in
  the last 3-4 hops. This is real — the speaker's vocal tract is changing
  through the trail-off (vowel offset, formant shift). "Last non-null"
  picks up the trail-off pitch.
- **In w36uw**, the pitch jumps high almost immediately and stays there
  — the recording's "central 70 %" boundary catches mostly the high-
  pitch region. The ground-truth f0=219 was measured at a different
  point of the recording (Hillenbrand uses the steady-state portion,
  which may be earlier than 15 % of total length).
- **(a) steadyStateDetect** on these files happens to numerically match
  (b)-last because the central single window (used by (a)) lands in the
  high-pitch region for these specific files.

## Corpus-level comparison — full female corpus (n=576)

| Methodology | F mean | F median | F p95 |
|---|---:|---:|---:|
| (a) steadyStateDetect | 23.89 | 4.79 | **210.3** |
| (b) sequential last | 19.64 | 10.13 | **61.9** |
| **(b-median) sequential MEDIAN of trace** | **11.75** | **3.62** | **29.6** |

(b-median) is **2× better** on F mean than (a), with **7× lower p95**.
This is consistent with the σ-sweep harness's σ=75 PTDB-TUG codet p95
of 16.6 Hz — both report a tight long-tail because both are using
production-equivalent multi-frame methodologies that exploit the HMM's
temporal smoothing.

## Why (a) and (b) often look the same

`steadyStateDetect` feeds the SAME 50 ms window 5 times. After warm-up
convergence with uniform prior, the HMM's α concentrates on whatever
the obs distribution argmaxes — which for a non-stationary window with
multiple CMND minima is essentially "noisy YIN argmax".

`sequential frames + last non-null` similarly takes a single-window
result, but FROM THE END of the recording. On Hillenbrand the trail-off
region is often where pitch shifts up (formant transitions, low SNR),
so "last" lands on the same kind of artifact (a) is producing —
high-pitch noise.

The HMM's actual benefit (stable pitch tracking through a recording)
shows up only when you sample from the MIDDLE of the trace, not the
ends.

## What the σ-sweep harness was actually measuring

The σ-sweep harness used "step 25 ms hops over central 70 %, last non-
null" — methodology (b) above. Its σ=75 numbers are real on PTDB-TUG
because PTDB-TUG REF F0 is a per-frame contour over 6+ second
recordings, and the trail-off effect is averaged out by frame-by-frame
matching (rather than file-level last-frame).

For Hillenbrand single-vowel recordings, methodology (b) is more
trail-off-sensitive than for PTDB-TUG continuous speech. The σ-sweep's
Hillenbrand row (Stage 2 σ=75 L=2 → F=19.64) is a slight
under-estimate of Stage 2.B's true single-vowel performance — same as
what we just measured.

## Verdict

Both **A** (single-window starves HMM) and **B** (helper artifact) are
partially correct, but the actionable conclusion is sharper than either:

- For **stationary stimuli** (comprehensive's pure tones, harmonic
  stress, vibrato, etc.): `steadyStateDetect` is correct as-is. Feed
  the same 50 ms window 5 times → HMM converges on stationary obs's
  argmax, which is the right answer for stationary signals.
- For **non-stationary recordings** (real speech): a different helper
  is needed. The pattern that works is **step sequential 25 ms hops
  over the central 70 %, take the median of the non-null trace**.

The pass-1 real-speech numbers are not canonical — they reflect a
methodology mismatch.

## Proposed fix

Add a second helper alongside `steadyStateDetect`:

```js
// streamingMedianDetect — for non-stationary recordings (real speech).
// Steps sequential 25 ms hops over the central 70 % of the input,
// returns the MEDIAN of non-null pitch values. Median is robust to
// trail-off and onset pitch artifacts. Uses the worker's stateful HMM
// across hops (NO reset within the file — this is exactly what
// production does).
function streamingMedianDetect(w, samples, sr) {
  w.ctx.self.onmessage({ data: { type: "reset-pitch-hmm" } });
  const winN = Math.floor(sr * 50 / 1000);
  const hopN = Math.floor(sr * 25 / 1000);
  const startN = Math.floor(samples.length * 0.15);
  const endN = Math.floor(samples.length * 0.85);
  const trace = [];
  for (let i = startN; i + winN <= endN; i += hopN) {
    const r = w.detectPitch(samples.subarray(i, i + winN), sr);
    if (r !== null) trace.push(r);
  }
  if (trace.length === 0) return null;
  const sorted = [...trace].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
}
```

Use this in `real-speech-test.js` Pass 1 instead of `steadyStateDetect`.
Do NOT touch `comprehensive.js` — its synthetic stimuli are stationary
and `steadyStateDetect` is correct there.

## Expected pass-1 numbers after fix

| Suite | Currently (broken) | After fix (predicted from b-median) |
|---|---:|---:|
| real-speech F mean | 23.9 Hz | **~11.8 Hz** |
| real-speech F p95 | 210.3 Hz | **~29.6 Hz** |
| real-speech M mean | 17.8 Hz | (need to recompute) |

These are within shouting distance of Stage 0's historical baseline
(F=14.2) — Stage 2.B σ=75 is COMPETITIVE on Hillenbrand single-vowel
recordings, not catastrophically worse as the broken pass-1 numbers
suggested.

## Plan to recover

1. Add `streamingMedianDetect` to `real-speech-test.js` (alongside
   `steadyStateDetect`)
2. Replace Pass 1's `steadyStateDetect(w16, window, 16000)` call with
   `streamingMedianDetect(w16, samples, 16000)` (no need to extract a
   single-window slice — the helper takes the full samples)
3. Re-run all 5 suites
4. Replace [pass1-stage2b-baseline-2026-05-04.md](pass1-stage2b-baseline-2026-05-04.md)
   numbers with the corrected ones
5. Then proceed to pass 2

This is the recover step the user explicitly anticipated. ~2 hours.
