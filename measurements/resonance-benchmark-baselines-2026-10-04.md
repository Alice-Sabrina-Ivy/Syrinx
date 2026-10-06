# Resonance-validity benchmark — harness + baselines (2026-10-04)

Branch `resonance-lab` (worktree `Syrinx-res`). Harness: [scripts/resonance-lab/](../scripts/resonance-lab/README.md).
Goal: one shared, calibration-free benchmark that every real-time resonance candidate
is scored on: works for any voice, with no per-user recordings. No production code
changed. These are baseline numbers for the candidate phase.

Reproduce (outputs in `build/resonance-lab/`, gitignored):

```bash
PY=build/resonance-lab/venv/Scripts/python      # system site-packages + pyworld 0.3.5
$PY scripts/resonance-lab/build_bench.py         # ~1 h on 14 workers
$PY scripts/resonance-lab/bench.py score scripts/resonance-lab/candidates/b1_raw_f2.py
$PY scripts/resonance-lab/bench.py score scripts/resonance-lab/candidates/b2_ecapa.py
$PY scripts/resonance-lab/bench.py score scripts/resonance-lab/candidates/b3_praat_vtl.py
```

## Benchmark contents (as built)

| set | items | audio | notes |
|---|---|---|---|
| r1_test | 1,000 utts, 40 test-clean speakers (20 F / 20 M) | 2.28 h (1.17 h voiced) | held-out speakers |
| ptdb / fda | 180 / 100 | 0.34 / 0.09 h | 4 and 2 speakers: AUCs are speaker-limited |
| hill | 1,116 Hillenbrand tokens (45 M / 48 W speakers) | 0.17 h | |
| manip_test | 200 sources × 42 conditions = 8,400 | 10.95 h | test-clean, crops ≤ 5 s |
| manip_hill | 240 tokens × 42 = 10,080 | 1.55 h | 10 M + 10 W × 12 vowels |
| synth | 1,617 vowdata tokens (532 M, 558 W, 305 boys, 222 girls), 2 s | 0.90 h | static-formant synthesis |
| r1_dev / manip_dev / train_dev | 1,000 / 3,360 / 2,703 | 2.1 / 4.4 / 5.4 h | dev-clean tuning + training pool |

### Manipulation QA (manip_test; realised vs intended)

Envelope scale = log-frequency shift of the mean LPC envelope against the condition's
same-engine reference. F0 = Praat median with an expectation-centred range.

| engine / kind | F0 ratio (median) | share off by > 5 % | envelope-scale error, median (IQR) |
|---|---|---|---|
| Praat pitch (PSOLA) | 1.003 | 9.3 % | 0.25 % (0.70 %) |
| Praat formant (Change gender) | 0.997 | 3.3 % | 0.10 % (0.70 %) |
| Praat +8 st × formant | 0.995 | 2.3 % | −0.02 % (0.67 %) |
| WORLD pitch | 1.001 | 6.9 % | 0.11 % (0.45 %) |
| WORLD formant | 1.001 | 6.4 % | 0.05 % (0.59 %) |
| orig (Praat re-measurement noise floor) | 1.001 | 3.5 % | – |

Hillenbrand manipulations are equally clean (envelope scale 0.853-1.155 for intended
0.85-1.15; pitch-only conditions keep the envelope at 1.000-1.007). All variants of a
source share one RMS-matched gain: a first build limited each variant's peak
separately (gains 0.51-0.98 between a condition and its reference) and was discarded.

### Parity checks

* B2 Python ORT vs the production transformers.js pipeline: 59 windows, max |Δp| = 6e-8.
* B1 imports `src/dsp/formants.js` unmodified. The Node bridge emulates 48 kHz capture,
  150 ms cadence, a 90 ms-lagged pitch hint, voiced gating and the 7-tap gated median.

## Leaderboard: baselines (split = test)

G = the candidate's own men-women gap (median of women speakers' median utterance
readouts minus the same for men, test-clean). R2/R3/R5 are in units of G.

| | B1 raw F2 (current UI) | B2 ECAPA meter (deployed) | B3 Praat dF / VTL |
|---|---|---|---|
| **R1** AUC 2 s / **5 s** / utt / speaker | 0.72 / **0.76** / 0.73 / 0.82 | 1.00 / **1.00** / 1.00 / 1.00 | 0.83 / **0.86** / 0.84 / 0.89 |
| R1 PTDB utt / FDA utt / Hill token / Hill speaker | 0.73 / 0.83 / 0.64 / 0.99 | 1.00 / 1.00 / 0.99 / 1.00 | 0.85 / 1.00 / 0.83 / 0.98 |
| **R2** pitch leak, Praat / WORLD | **0.00** / 0.04 | **0.15** / 0.15 | **0.06** / 0.04 |
| toward-class pitch Δ/G: men +12 st / women −12 st | 0.04 / −0.03 | **0.35 / 0.22** | −0.01 / −0.00 |
| pitch-alone flips men +12 st / women −12 st (base rate) | 0.41 / 0.22 (0.36 / 0.23) | **0.37 / 0.25 (0.00 / 0.02)** | 0.19 / 0.22 (0.20 / 0.24) |
| **R3** sensitivity, Praat / WORLD (ideal ≈ 1) | **0.80** / 0.82 | **0.22** / 0.19 | **0.65** / 0.65 |
| R3 sign accuracy ±5 %, Praat / WORLD (≥ 0.90) | 0.83 / 0.84 | 0.79 / 0.81 | 0.84 / 0.85 |
| toward-class formant Δ/G: men ×1.15 / women ×0.85 | 0.97 / 1.00 | 0.56 / 0.55 | 1.00 / 1.06 |
| toward-class formant Δ/G: men ×1.05 / women ×0.95 | 0.33 / 0.34 | **0.03 / 0.07** | 0.32 / 0.44 |
| R3 at +8 st: sens / sign (men; women) | 0.70 / 0.75; 1.13 / 0.83 | 0.54 / 0.96; 0.04 / 0.83 | 0.75 / 0.80; 0.91 / 0.90 |
| Hillenbrand R3 / sign ±5 % (Praat) | 0.87 / 0.96 | **0.05 / 0.49** | 0.64 / 0.86 |
| **R4** across-vowel SD / G_hill (≤ 0.5) | **2.12** | **0.15** | **0.63** |
| R5 flicker / held-vowel SD / time-to-stable | 0.95 / 0.03 / 21.8 s | 0.03 / 0.06 / 0.5 s | 1.14 / 0.03 / 9.2 s |
| R7 synthetic boys / girls position (men 0, women 1) | 1.66 / 2.13 | 0.95 / 0.93 | 2.29 / 3.89 |
| R7 AUC high-F0 / low-F0 women vs men | 0.72 / 0.69 | 1.00 / 1.00 | 0.87 / 0.81 |
| R8 CPU ms per s audio / model MB | 1.9 (extractor only) / 0 | 242 (ORT native, 1 thread) / 16.1 | 10.4 / 0 |
| pass R1 / R2 / R3 / R4 | ✗ / ✓ / ✗ / ✗ | ✓ / ✓ / ✗ / ✓ | ✓ / ✓ / ✗ / ✗ |

No baseline passes overall. Each fails differently.

Rubric item R6 (5 s readout ordering on the private session recordings) was also scored; results on the private session recordings are kept outside this repository.

## Findings

1. **The ×1.15 premise is right for true formants, but automatic tracking compresses it.**
   Hand-measured Hillenbrand (vowdata) women/men formant dispersion is **1.152**
   (F1 1.146, F2 1.153, F3 1.129, F4 1.166 ratio of medians). Praat Burg at a fixed 5500 Hz
   ceiling on the same audio gives **1.126**. On running speech (test-clean) it gives
   **1.072**. So "R3 ≈ 1 is ideal" holds for a perfect resonance measure. A
   tracker-based measure is compressed in both its gap and its response, which is why
   B3 reads 0.65.
2. **B1 (the current UI's mean F2) has no pitch leak but is dominated by vowel.**
   PSOLA leak is 0.00 G. Across-vowel SD is 2.1 G, and per-vowel offsets run from
   /iy/ +3.5 G to /oa/ −2.8 G. Hillenbrand token AUC is 0.64. Over 12 balanced vowels the
   speaker-level AUC is 0.99, so averaging over vowels works and single vowels do not. The
   needle flickers at 0.95 G per 150 ms window, and the readout takes ~22 s of voiced
   speech to settle within ±0.25 G.
3. **B2 (the deployed ECAPA meter) separates perfectly but is mostly not a resonance
   meter.** Its symmetric R2 of 0.15 passes, but the slope is diluted by saturation:
   each sex sits pinned at one end. Measured toward the other class, men move
   **+0.35 G per +12 st of pitch alone**, and 37 % of men cross the midpoint on pitch alone
   (base rate 0 %). A training-sized resonance change (×1.05) moves men **0.03 G**, and
   ×1.15 moves them 0.56 G. On isolated Hillenbrand vowels, formant-shift sign accuracy is
   **0.49 (chance)**. At +8 st it does respond to resonance for men (sign 0.96). Combined
   M→F moves are roughly additive (pitch alone +32 points, formants alone +52, both +82 on
   the 0-100 meter). On test-clean men, the meter moves +3 / +17 / +32 points for
   +4 / +8 / +12 st and +3 / +20 / +52 points for ×1.05 / ×1.10 / ×1.15 (Praat; WORLD is
   within 6 points). So an octave moves it 1.6× more than +10 % formants, consistent with
   the brainstorm's "~2×" (+8 st ≈ +10 % formants). The response is strongly non-linear: it
   is nearly blind to the 2-6 % changes training actually produces.
4. **B3 (Praat dispersion) is the best resonance-specific reference, and still not
   enough.** Leak 0.06, R3 0.65, sign accuracy 0.84 at ±5 %, vowel SD 0.63 G, 5 s AUC 0.86,
   flicker 1.14 G per window.
5. **Children / high F0.** Synthetic boys and girls sit beyond women on B1/B3 (1.7-3.9)
   and just below women on B2 (0.93-0.95). Praat Burg also inserts spurious poles on these
   static synthetic spectra, so treat R7 synthetic numbers as indicative only.

## Caveats

* R2/R3 rely on resynthesis. Every Δ is against a same-engine reference, and the two
  engines agree within 0.04 G on every baseline (R2 and R3), so engine artifacts are
  small relative to the effects reported.
* For saturating scores, read R2/R3 together with the toward-class and flip columns (added
  for this reason).
* The F0 track given to candidates (two-pass Praat; manipulated = source × factor) is
  better than production's 75-400 Hz detector at the extremes.
* R8 for B2 is native ORT. The production browser path is ORT-WASM at ~52 ms per inference
  (≈ 350 ms per s of audio at 6.7 Hz).
