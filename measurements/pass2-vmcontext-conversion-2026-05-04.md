# Pass 2: vm-context conversion of inline-copy tests (2026-05-04)

> **Status: pass 2 complete.** `accuracy-test.js` and `yin-harmonic-test.js`
> converted from inline-detectPitch to vm-context loading of dsp-worker.js.
> Helper-choice contract honored: `steadyStateDetect` for stationary
> synthetic stimuli, `streamingMedianDetect` for Hillenbrand recordings.
> Inline-copy audit removed from `pitch-detection-comprehensive.js [15]`.
>
> **Headline result: `accuracy-test.js` female F0 mean = 7.0 Hz —
> the historical < 10 Hz target is now met for the first time** in
> the project's pitch-detection history. Stage 2.B σ=75 with the
> right helper-choice methodology delivered the result the corpus
> expansion data predicted.

## Pass-2 suite results

| Suite | Result | Stage 2.B numbers |
|---|---|---|
| `tests/dsp/yin-harmonic-test.js` | **12 / 0** ✓ | All synthetic stress passes (clean 100/130/200/250/300/440 Hz, 3rd-harmonic dominant, /u/-like back vowel) |
| `tests/dsp/accuracy-test.js` | structural PASS | **F0 female 7.0 Hz** (< 10 target ✓), F0 male 9.5 (< 10 ✓), F1/F2 within targets |
| `tests/audio/pitch-smoothing-test.js` | 32 / 0 | Unchanged (no detectPitch dep) |
| `tests/dsp/pitch-detection-comprehensive.js` | 77 / 8 | 3 audit assertions removed; 8 Stage-2.B characteristic failures unchanged from pass 1 |
| `tests/dsp/real-speech-test.js` | 5 / 0 ✓ | F=11.8, M=12.7, p95 27.7/11.5 (canonical baseline from pass 1) |

## What `accuracy-test.js` produces under Stage 2.B σ=75

Synthetic stimuli (steadyStateDetect):
```
Synthetic pitch (pure):    PASS (0/10 over 3 Hz)
Synthetic pitch (complex): PASS (0/10 over 5 Hz)
Octave-doubling (2·f0):    PASS (0/24 over 5 Hz)
```

Hillenbrand corpus (streamingMedianDetect):
```
MALE voices:
  F0: mean=9.5 Hz   (target: < 10 Hz)  PASS
  F1: mean=30.0 Hz  (target: < 80 Hz)  PASS
  F2: mean=105.3 Hz (target: < 120 Hz) PASS

FEMALE voices:
  F0: mean=7.0 Hz   (target: < 10 Hz)  PASS  ← historical target met
  F1: mean=40.8 Hz  (target: < 80 Hz)  PASS
  F2: mean=110.4 Hz (target: < 120 Hz) PASS
```

Note: this is the 60-women / 60-men accuracy-test subset (5 files per
vowel × 12 vowels × 2 genders). The full-corpus number is 11.8 Hz from
real-speech-test.js — the subset numbers are noisier but still cleanly
below target.

## Diff summary

[tests/dsp/accuracy-test.js](tests/dsp/accuracy-test.js):
- Comment block documenting helper-choice contract
- Removed inline `fft` (~37 lines) and inline `detectPitch` (~103 lines).
  Kept inline `extractFormants`, `decimateWithFilter`, `burgLPC`,
  `findPolynomialRoots`, `designLowPassFIR` — the formant code is a
  separate concern that converts only when its own stateful refactor
  motivates it
- Added `loadWorker`, `steadyStateDetect`, `streamingMedianDetect`
  helpers
- Pre-loaded `w48` and `w16` worker contexts (synthetic stimuli use
  both; Hillenbrand uses only w16)
- 5 synthetic call sites use `steadyStateDetect(w48, ...)` or
  `steadyStateDetect(w16, ...)` matching the stimulus's sample rate
- Hillenbrand call site uses `streamingMedianDetect(w16, samples, sr)`
  on the full samples (helper handles its own central-70 % windowing)
- Formant extraction still uses the inline `extractFormants` on a 50 ms
  middle window, with the streamed-median pitch passed in for
  gender-adaptive LPC order

[tests/dsp/yin-harmonic-test.js](tests/dsp/yin-harmonic-test.js):
- Comment block documenting state-contract requirement and pointing at
  `real-speech-test.js` for the full helper-choice contract
- Removed inline `fft` (~36 lines) and inline `detectPitch` (~100 lines)
- Added `loadWorker`, `steadyStateDetect`. No `streamingMedianDetect`
  needed — all stimuli are stationary 50 ms harmonic synthesis
- Pre-loaded `w48` worker context
- 6 call sites use `steadyStateDetect(w48, sig, SR)`

[tests/dsp/pitch-detection-comprehensive.js](tests/dsp/pitch-detection-comprehensive.js):
- Removed section [15] inline-copy audit (3 assertions). Replaced with
  a comment noting the audit's purpose and why it's now obsolete.
- No other changes from pass 1's state

## What's now untouched and what isn't

The ONLY remaining inline-copy DSP code in the test suite is in
`accuracy-test.js`'s formant extraction section (`extractFormants`,
`burgLPC`, `findPolynomialRoots`, `decimateWithFilter`,
`designLowPassFIR`). These are NOT pYIN code; they're the legacy YIN-
era formant code, which has been stable across all the pYIN work. They
should be converted to vm-context if/when the formant code itself gets
a stateful refactor — but that's outside the scope of the Stage 2.B
ship.

`pitch-smoothing-test.js` remains unchanged — it tests pure helpers
that don't call detectPitch, so it has no relationship to Stage 2 vs
Stage 0.

## Pass-2 status

✓ `accuracy-test.js` converted to vm-context with split helpers
✓ `yin-harmonic-test.js` converted to vm-context with steadyStateDetect
✓ Inline-copy audit removed from comprehensive (now obsolete)
✓ All 5 suites run; comprehensive's 8 known Stage-2.B failures unchanged
✓ Headline target met: accuracy-test female F0 mean 7.0 Hz < 10 Hz

**Proceeding to pass 3** (delete dead multi-mult code) per prior
auto-greenlight on pass 2.

## Per-suite output files

- [measurements/pass2/yin-harmonic.txt](measurements/pass2/yin-harmonic.txt) — 12/0
- [measurements/pass2/smoothing.txt](measurements/pass2/smoothing.txt) — 32/0
- [measurements/pass2/comprehensive.txt](measurements/pass2/comprehensive.txt) — 77/8
- [measurements/pass2/accuracy.txt](measurements/pass2/accuracy.txt) — F=7.0/9.5
- [measurements/pass2/real-speech.txt](measurements/pass2/real-speech.txt) — 5/0
