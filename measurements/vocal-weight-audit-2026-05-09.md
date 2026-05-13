# Vocal weight metric audit — 2026-05-09

Audit-only, no implementation. Stage A of the deferred
formant/HNR/vocal-weight investigation flagged in CLAUDE.md.

User report: the "Vocal Weight" gauge bounces around significantly
on monotone speech where F0/F2/HNR appear stable. Screenshot
showed "17.8 dB" — suspicious, since vocal weight is typically
a perceptual scale not a raw dB value.

## TL;DR

- **The "Vocal Weight" gauge is showing a raw band-energy-ratio in dB,
  not a calibrated perceptual metric.** "17.8 dB" means the 0–1000 Hz
  band has ~60× more energy than the 1000–4000 Hz band. Direct readout
  of `10·log10(lowEnergy / highEnergy)`.
- **The metric is custom-built; not from any published vocal-weight
  model** (no Bauer/Kreiman, no Awan CSL, no H1-H2, no CPP, no spectral
  tilt slope). Naming mismatch with `computeSpectralTilt` and
  ARCHITECTURE.md — what the function computes is a low/high band
  energy ratio, which is *not* what acoustic phonetics calls "spectral
  tilt" (the latter is the slope of the spectral envelope in dB/octave).
- **No smoothing on the metric path.** F0 and F2 both have rolling
  medians (length 7) and formants additionally have outlier rejection
  (>500 Hz jumps discarded). Spectral tilt has none — every value the
  worker emits goes straight to the gauge.
- **No calibration or test fixture exists.** The metric has shipped
  unchanged since the gauge was added 2026-03-18.
- **PR #75 did NOT affect this code path.** SwiftF0 cutover removed
  the `pitch` field from the DSP analysis message; the spectralTilt
  computation, smoothing (none), and downstream consumers are byte-
  identical pre- and post-PR-#75. **This is not a regression.**

## 1. Where the metric is computed

**Computation:** [src/dsp/dsp-worker.js:613](src/dsp/dsp-worker.js#L613-L644) `computeSpectralTilt(buffer, sr)`.

```js
function computeSpectralTilt(buffer, sr) {
  const fftSize = 2048;
  const n = Math.min(buffer.length, fftSize);
  // ... Hann-window the last 2048 samples, FFT
  const binHz = sr / fftSize;
  const lowBinEnd  = Math.min(Math.floor(1000 / binHz), fftSize / 2);
  const highBinEnd = Math.min(Math.floor(4000 / binHz), fftSize / 2);
  let lowEnergy = 0, highEnergy = 0;
  for (let k = 1; k < lowBinEnd; k++)         lowEnergy  += re[k]*re[k] + im[k]*im[k];
  for (let k = lowBinEnd; k < highBinEnd; k++) highEnergy += re[k]*re[k] + im[k]*im[k];
  if (highEnergy === 0) return null;
  return 10 * Math.log10(lowEnergy / highEnergy);
}
```

So the metric is:

```
spectralTilt_dB = 10 · log10( ∑|X[k]|² over 1..1000 Hz  /  ∑|X[k]|² over 1000..4000 Hz )
```

A 2048-point Hann-windowed FFT taken on the last 2048 samples
(≈42.7 ms at 48 kHz) of the 50 ms DSP analysis window. Run every
6th analysis frame, so ~150 ms cadence ([dsp-worker.js:115-124](src/dsp/dsp-worker.js#L115-L124)).

**Display:** [src/components/SpectralTiltGauge.jsx:85](src/components/SpectralTiltGauge.jsx#L85)
renders the value verbatim with `${spectralTilt.toFixed(1)} dB`.
The component is titled "Vocal Weight" with "Lighter" / "Heavier"
end labels.

**Wiring:** [src/audio/useAudioPipeline.js:870](src/audio/useAudioPipeline.js#L870)
threads it through `currentTilt = spectralTilt ?? lastVoicedRef.current.spectralTilt`
into `lastVoicedRef`, the throttled state update, and the session
recording callback. No transformation along the way.

**Is it a published model?** **No.** It is a custom low-band/high-band
energy ratio. Published vocal-weight or "voice weight" correlates
in the voice-feminization and acoustic-phonetics literature include
H1-H2 (amplitude difference of first two harmonics, glottal openness
proxy), H1-A3 (first harmonic vs third formant), CPP (cepstral peak
prominence), spectral tilt slope in dB/octave (Stevens/Klatt), or
composite indices like AVQI/CSID. None of these are this computation.
The name "spectral tilt" is also a misnomer — that term in acoustic
phonetics specifically refers to the slope of the spectral envelope
(e.g., -12 dB/octave), not a band-energy ratio.

The closest published analogue I'm aware of is the broad-band
"high/low energy ratio" used in some signal-quality work, but those
are not vocal-weight metrics. Honest read: this is an ad-hoc
computation that produces a number that is *correlated* with voice
brightness on a per-vowel basis but is not a calibrated weight metric.

## 2. Inputs the metric consumes

| Input | Used? |
|---|---|
| F0 (any source — pYIN or SwiftF0) | **No** |
| Formants (F1, F2, F3, bandwidths) | **No** |
| HNR | **No** |
| Spectral tilt slope (H1-H2, H1-A3) | **No** |
| CPP / cepstral peak prominence | **No** |
| Voicedness / SwiftF0 confidence | **No** |
| Raw audio (last 2048 samples of 50 ms analysis window) | **Yes — only input** |

The metric depends solely on the raw waveform. There is no
gating on voicedness; if the analysis window contains audio above
the silence intensity threshold, the metric is computed and
emitted regardless of whether the audio is speech.

## 3. What "17.8 dB" represents

It is the metric value itself, displayed as raw `10·log10(low/high)`
in dB units. A reading of 17.8 dB means the integrated energy in
the 0–1000 Hz band is approximately 10^1.78 ≈ **60× greater** than
the integrated energy in the 1000–4000 Hz band over the analysis
window.

For reference, this number is dominated by:
1. **Vowel choice.** F1 (typically 270–800 Hz across vowels) sits
   inside the low band. F2 (typically 700–2400 Hz) sits in either
   band depending on vowel. /u/ has F1≈300, F2≈700 → both formants
   in low band → very high ratio. /i/ has F1≈270, F2≈2300 → F2 in
   high band → much lower ratio. The metric will swing 10+ dB
   between vowels even at constant F0 and constant phonation type.
2. **Pitch.** Number of harmonics in each band depends on F0.
   At F0=200 Hz, 5 harmonics fit below 1000 Hz; at F0=100 Hz, 10
   harmonics fit below 1000 Hz — a 3 dB shift just from harmonic
   count.
3. **Formant amplitudes** (i.e., bandwidths and source-filter
   interaction).
4. (Weakly) glottal source characteristics — which is the thing
   "vocal weight" is supposed to measure.

So the displayed number is a confounded mixture of vowel + pitch +
formant amplitudes + (weakly) glottal source. The user-facing
label "Vocal Weight" claims it measures the last item; the
mathematics overweights the first three.

## 4. Smoothing on the metric path

**None on spectral tilt.**

| Metric | Smoothing | Outlier rejection | Cadence |
|---|---|---|---|
| F0 (pitch) | rolling median, length `PITCH_SMOOTH_LEN`=2 | none (post-SwiftF0; harmonic reconciliation removed in 34cbc9e) | ~25 ms |
| F1/F2/F3 | rolling median, length 7 | discard frame-to-frame jumps > 500 Hz | ~150 ms |
| Spectral tilt | **none** | none | ~150 ms |
| HNR | none | none | ~150 ms |

[useAudioPipeline.js:870](src/audio/useAudioPipeline.js#L870):

```js
const currentTilt = spectralTilt ?? lastVoicedRef.current.spectralTilt;
const currentHnr  = hnr ?? lastVoicedRef.current.hnr;
```

The `??` only swaps null for the held last-voiced value (and that
"hold" only fires on the 5-of-6 frames where the worker hasn't
recomputed). When the worker emits a fresh value, it goes straight
to state with no median, no EMA, no outlier gate.

The gauge component itself has a `transition-all duration-100`
CSS rule on the marker ([SpectralTiltGauge.jsx:64](src/components/SpectralTiltGauge.jsx#L64))
which visually tweens the marker position over 100 ms — but the
numeric readout shows the raw value with no smoothing applied. So
the user sees both: a marker that "rubber bands" between values,
and a number readout that flips between widely separated dB values
every ~150 ms.

This is the most likely proximate cause of the perceived jitter.
Adding a rolling-median or EMA on tilt — matching the F2 setup —
would substantially calm the gauge even before any deeper metric
redefinition. (See hypothesis B below.)

## 5. Calibration / reference / test fixtures

**None.**

- No accuracy or calibration test for `computeSpectralTilt` exists
  in `tests/`. Searched the entire `tests/` tree; the only references
  to the function are in
  [tests/dsp/latency-benchmark.js](tests/dsp/latency-benchmark.js#L390),
  which only times execution, not values.
- No test fixture asserts that a known input produces a known
  spectral-tilt value.
- No comparison data with reference voice samples, no "spectral
  tilt of /a/ at 220 Hz monotone should read X dB" kind of fixture.
- The display range constants in [constants.js:24-26](src/utils/constants.js#L24-L26)
  (`SPECTRAL_TILT_RANGE = {min:-5, max:25}`, `SPECTRAL_TILT_TARGET = {low:-2, high:8}`)
  are unsourced. No comment, no measurement file backing them. The
  introducing commit (6fdfc03, 2026-03-18) does not justify the
  numbers either.
- ARCHITECTURE.md mentions spectral tilt in passing (line 957:
  "More negative (heavier) | Less negative (lighter)") but this
  description is **inverted relative to the actual computation** —
  the code returns positive values when low-band dominates, and the
  gauge labels "Lighter ← → Heavier" left to right with the value
  rising. So the architecture doc describes a different quantity
  (the published spectral-tilt-slope convention, which is negative)
  than the code implements (band ratio, which is positive). The
  *gauge* labeling matches the *code*; the architecture *doc*
  doesn't match either.

## 6. PR #75 impact on the metric

**Zero impact. Confirmed by diff inspection.**

PR #75 (commit `fd87aca`, "audio: ship SwiftF0 pitch detection via
dedicated worker, retire pYIN") changed dsp-worker.js as follows
relative to spectralTilt:

```diff
-// Pitch detection (YIN), formant extraction (Burg LPC), spectral tilt, HNR, intensity
+// Formant extraction (Burg LPC), spectral tilt, HNR, intensity. Pitch
 // Spectral tilt: 2048-point FFT (fixed size, independent of sample rate)
 const _tiltRe = new Float64Array(2048);
-  // Pitch detection — timed separately from formant/tilt/HNR when diag is on
   // Formants, spectral tilt, HNR are heavier — run every 6th analysis frame.
   let formants = null, spectralTilt = null, hnr = null;
     spectralTilt = computeSpectralTilt(window, sampleRate);
-      pitch, intensity, formants, spectralTilt, hnr,
+      intensity, formants, spectralTilt, hnr,
```

`computeSpectralTilt` itself was not edited. The only structural
change is that the analysis message no longer carries `pitch`
(since pitch comes from pitch-worker) — but spectral tilt was never
fed by pitch-worker or pYIN to begin with (verified in §2). No
dead references, no fallback paths, no broken inputs.

**Subsequent commit `6f04dd2` ("review: harden audio pipeline...",
2026-05-09) touched spectralTilt only in the session-summary path
(`avg(tiltValues)` for `avgSpectralTilt`)**, which is a stats
aggregator on saved sessions, not the live meter.

The jitteriness is pre-existing and has been present since the
gauge was added on 2026-03-18 (commit `6fdfc03`). It was not
introduced by PR #75.

## 7. Hypothesis ranking

Ordered by likelihood given the audit. Top two are co-primary —
either could plausibly be the "right" framing depending on the
fix the user wants.

### A. **Inputs genuinely vary even on monotone (definition issue)** — VERY HIGH

The metric is a band-energy ratio over 0–1000 vs 1000–4000 Hz.
This ratio is dominated by vowel content, not by glottal source.
The user reports F0/F2 appear stable on monotone, but "monotone"
in casual usage means constant *pitch*, not constant *vowel*. Real
speech traverses vowels even when pitch is held flat:
- "How are you" at constant pitch passes through /aʊ/, /ɑ/, /j/,
  /u/ — F1/F2 patterns and therefore band-energy ratios swing
  considerably across these.
- Even sustained vowels have within-vowel jitter as the vocal tract
  micro-adjusts.

So a 5–15 dB swing in this metric across a "monotone" speech
sentence is the **expected mathematical behavior** of the
metric, not a bug. Confirming this would require the user to
run a sustained single-vowel monotone (e.g., "aaaa" at constant
pitch) and check whether the gauge stabilizes.

If this is the right framing, **adding smoothing won't help much**
— the underlying signal is vowel-modulated and a 7-sample median
across 1.05 seconds of audio still spans multiple phonemes.

### B. **No smoothing on the metric path (cheap fix)** — HIGH

Independent of whether the metric *definition* is right, it is the
only metric on the dashboard with no smoothing. Adding rolling
median or EMA — matching the F2 path's `pushAndMedianGated` setup
— would visibly calm the gauge. This treats the symptom but is
cheap and has no architectural risk.

If A is also true, smoothing alone produces a calmer-but-still-
not-meaningful gauge. If A is *not* the dominant effect, smoothing
might produce an actually-useful gauge.

### C. **Wrong metric definition (substantive fix)** — HIGH

The audit revealed the metric is custom and uncalibrated, named
something it isn't ("spectral tilt"), labeled as something the
math doesn't measure ("vocal weight"). Published voice-weight
correlates exist (H1-H2, CPP, spectral tilt slope, AVQI). Replacing
the band-energy-ratio with one of those would produce a metric
that:
- Has a published reference scale for calibration.
- Is less vowel-dependent (H1-H2 specifically targets glottal source).
- Has documented training intuition for voice-feminization users.

This is the most substantive fix. CPP is probably the highest-
ROI candidate (single number, well-validated, robust to vowel
content, used in clinical voice quality assessment).

### D. **Display / rendering artifact (UI fix only)** — LOW

The gauge has a `transition-all duration-100` CSS rule that visually
tweens the marker. The numeric readout shows the raw dB value with
no transform. The display is faithfully showing the underlying
signal — it's not introducing jitter that isn't already in the data.
Removing the transition would make the marker snap rather than
rubber-band but would not address the user complaint (which is about
the gauge bouncing, not about animation feel).

### E. **PR #75 regression** — RULED OUT

Verified by inspection of `git show fd87aca` and the post-merge
hardening commit. `computeSpectralTilt` itself, its inputs, its
smoothing path, and its downstream consumers are byte-identical
across the cutover. The metric was always uncalibrated and
unsmoothed; the user is just now reporting a problem that has
existed since 2026-03-18.

## What this audit DIDN'T do

- Did not run the metric on real voice fixtures to quantify the
  per-vowel swing magnitude. That would be a Stage B measurement
  task — drive a known sustained-vowel WAV through the worker and
  log the spectralTilt trace, then drive a multi-vowel sentence and
  log the same. The expected difference between sustained-vowel
  variance and multi-vowel variance is what would *quantitatively*
  confirm hypothesis A.
- Did not propose a replacement metric. CPP, H1-H2, and spectral
  tilt slope are candidates; selection would require its own
  evaluation pass.
- Did not check whether the session-history `avgSpectralTilt`
  surfaces the same uncalibrated value to users (it does, but the
  audit scope didn't extend to fixing the persistence path; if the
  metric is replaced, session history needs to handle the schema
  change).

## Recommended next steps for user decision

The audit surfaces three plausible directions, distinct enough that
the user should pick which one(s) to pursue:

1. **Cheap fix (smoothing only).** Add rolling-median (length 7,
   matching F2) on spectralTilt in [useAudioPipeline.js:870](src/audio/useAudioPipeline.js#L870).
   Doesn't address the vowel-modulation problem but visibly calms
   the gauge in ~30 minutes of work.

2. **Honest labeling.** Rename the gauge from "Vocal Weight" to
   "Spectral balance" or similar — something that doesn't promise
   a perceptual scale the math doesn't deliver. Update the
   ARCHITECTURE.md description (which is inverted relative to the
   code anyway).

3. **Replacement.** Pick a published correlate (CPP recommended for
   single-number simplicity + clinical validation) and build a
   measurement-driven evaluation pass before swapping. This is the
   only direction that produces a metric the user can trust on
   monotone speech.

(1) and (2) are not mutually exclusive with (3), and (1)+(2) is a
defensible hold-the-line state if (3) is too expensive to scope
right now.
