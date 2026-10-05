# Pitch search ceiling + above-range presentation — 2026-10-03

**Shipped:** `BOERSMA_DEFAULTS.maxPitchHz` 400 → 800
([src/dsp/boersma-ac.js](../src/dsp/boersma-ac.js)); the pitch worker
posts any decode above `PITCH_DISPLAY_RANGE.high` (400) as unvoiced,
after the ghost veto and **before** the harmonic guard
([src/dsp/pitch-worker.js](../src/dsp/pitch-worker.js)); display range
unchanged. Guards: [tests/dsp/boersma-ac-test.js](../tests/dsp/boersma-ac-test.js)
(450/520/640 Hz decoded at true F0, 796/798/800 top edge, 900 above the
search) and the new [tests/dsp/pitch-worker-above-range-test.js](../tests/dsp/pitch-worker-above-range-test.js)
(drives the real worker). Worker-parity line in
`scripts/noise-augment-oracle.js` (both modes). Plus the octave-arbitration
coupling `octaveEvidence.maxPartnerHz: 420` (§8a, added at integration).

One of five measured workstreams from the 2026-10-03 half-pitch
investigation, integrated in this order:
[pitch-globalpeak-transient-2026-10-03.md](pitch-globalpeak-transient-2026-10-03.md) →
[pitch-octave-arbitration-2026-10-03.md](pitch-octave-arbitration-2026-10-03.md) →
this file → [noise-notch-voice-safety-2026-10-03.md](noise-notch-voice-safety-2026-10-03.md) →
[pitch-display-gate-redesign-2026-10-03.md](pitch-display-gate-redesign-2026-10-03.md).
Measured independently against the then-production chain (origin/main
at f92b11a: no globalPeak gate, octaveCost 0.01, no octave arbitration);
numbers below are this change alone, not the combined branch.

## Motivation

The user reports that the pitch trace sometimes shows **half** the actual
pitch. One of the phase-1 causes (investigation 2026-10-03, finding 3) is the
search ceiling: the detector searched 75–400 Hz, exactly the display range.
A true F0 above 400 Hz (sirens, excursions past a raised voice's break, sung
notes) has **no fundamental candidate**, so the AC picks the always-present
2T subharmonic and the pitch worker posts a confident value at half pitch —
inside the display range, painted like any other pitch (vocadito's sung
≥ 400 Hz frames: 97.6 % posted at half, §1).

Task: choose `BOERSMA_DEFAULTS.maxPitchHz` and how frames above
`PITCH_DISPLAY_RANGE.high` (400) are presented so that phonation above
400 Hz never shows as a confident half-pitch value, without new error
classes (octave-up of 200–400 Hz voices into 400–800, 3f locks of low
voices), without hurting the low register, any corpus by gender, or noise
immunity.

Grid measured: ceiling {400, 500, 600, 700, 800} × detector {production,
SHR_hi arbitration p=0.05 (`shr05`), p=0.10 (`shr10`) — phase-1 provisional
octave-down fix} × presentation {(i) post the real value — trace clips at
the plot top, readout shows Hz; (ii) post above-400 decodes as unvoiced;
(iii) raise `PITCH_DISPLAY_RANGE.high` (same pipeline numbers as (i);
rendering cost quantified separately)}, plus follow-up variants the data
called for (guard ordering, main-thread hold handling, an above-range veto
that keeps the tracker in range, an SHR domain restriction).

## Result in one paragraph

**Search to 800 Hz (2× the display ceiling) and post every decode above
400 Hz as unvoiced, before the harmonic guard; display range unchanged.**
The structural alias is removed: for a true F0 in (400, 800) Hz the
fundamental is now a search candidate, and for (800, 1600) Hz the 2T value
is itself above 400 Hz and is nulled. Confident half-pitch on above-range
phonation falls sharply (vocadito sung ≥ 400 Hz posted at half: 97.6 % → 0
on the combined chain, [target-voice-combined-validation-2026-10-03.md](target-voice-combined-validation-2026-10-03.md)
§6), with an ordinary detector octave-down residual; a 520 / 640 Hz tonal
whine no longer paints at half (§6 of this file). Low-voice octave-up does
not rise anywhere (it falls on Hillenbrand men); male corpora are flat or better at the display level (PTDB male
+3.0 pp, FDA male +0.6, Hillenbrand men −0.1). One worker-level guard is
marginal: Hillenbrand men worker correct −0.67 pp (> the 0.5 pp guard) —
vowel-onset 3f/4f harmonic locks that now post unvoiced instead of correct;
39 of the 51 lost frames are the first three frames of voicing, which the
paint gate's 3-frame onset confirmation never paints anyway. 600 Hz passes
that guard (−0.49) but leaves true 600–800 Hz phonation aliasing into
300–400 Hz (same bug class) and leaves a 640 Hz tonal whine painting at
320 Hz. CPU unchanged (~0.31 ms/frame at both ceilings). On the private
session recordings the true ≥ 400 Hz frames painted at half pitch fell
several-fold with the target and low bands flat; results on the private session recordings are kept outside this repository.

## Harness

All scratch code lives in `build/measure-2026-10-03/ceiling/` in the main
checkout (gitignored `build/`, not in the repo; phase-1 harnesses under
`build/investigate-2026-10-03/`). The committed guards are the two test
files above and `scripts/noise-augment-oracle.js`.

- **Session chain — `ceil-chain.mjs`.** Mirrors `src/dsp/pitch-worker.js`
  `processChunk` (16 kHz WAV ⇒ resampler identity; noise notch → rolling
  1280 buffer → candidates → production `createPathTracker` (L=2) → ghost
  veto `isNearNotch` → production harmonic guard → `frameConfidence`) and
  `useAudioPipeline.js` `handleAnalysisResult` pitch paths (imports the real
  `pitchGate.js`, `pitchSmoothing.js`, `pitchPaintGate.js`; DSP-worker 50 ms
  RMS intensity, 400 ms hold, median-3, 5 s silence reset,
  `VOICED_FALL_FRAMES` readout hysteresis), same structure as phase-1
  `session-attribution/chain-harness.js`, plus the readout. From one worker
  pass it replays presentation (i) and (ii). `--null-pre` moves the
  above-400 null before the guard (the recommended ordering), `--av=` adds
  the above-range-veto variant. The notch output is variant-independent and
  is cached per session (`cache/`).
- **Detector variants — `acv.mjs`.** Phase-1
  `detector-vs-praat/acv.mjs` (bit-exact with production when given no
  options) plus two scratch options: `shrArb.maxF2` (restrict SHR
  arbitration to candidates whose octave partner is ≤ maxF2) and
  `aboveScan` (scan lags to 800 Hz but keep >maxPitch peaks out of the
  candidate set; report the strongest as `above`).
- **Main-thread replays.** `mainsim.mjs` (hold-handling variants `lite`,
  `lite2`), `mainsim-prop.mjs` (the sibling display workstream's proposed
  paint gate + readout policy, `build/measure-2026-10-03/display/proposed/`),
  both from saved worker columns; `mainsim.mjs` re-simulates the saved
  mode-(ii) columns with 0 mismatches as a self-check.
- **Corpora + noise — `corp-run.mjs`.** FDA, PTDB-TUG (+20 ms ref offset),
  Hillenbrand, vocadito through the production worker chain incl. the real
  streaming resampler; `--display` adds the main-thread chain (painted
  values). Noise-only false voicing: 40 s per class at 0.05 FS, scored after
  10 s (phase-1 `notch-guard-risk/noise-fv2` convention), classes =
  `scripts/noise-synth.js` NOISE_TYPES + new above-400 classes
  `resonant-500`, `resonant-650` (white noise through a Q=5 resonator) and
  `whine-450/520/640` (stationary tone + 2nd/3rd harmonics, above the
  notch's 460 Hz search band).
- **References (session runs).** Consensus references across method
  families on the private session recordings (`cons`; `wide`, with
  wide-ceiling members, primary for true F0 ≥ 400 Hz; `strict` R1 & CC as
  sensitivity). Results on the private session recordings are kept outside this repository.
- **Scoring — `analyze_ceil.py`.** Classes and stage alignment exactly as
  phase-1 `session-attribution/analyze.py` (decoded frame index
  round((t+0.040)/0.025−1); posted adds L=2 hops; painted/readout add
  +30 ms median lag; correct = within 5 %, down2 = |ratio−0.5| ≤ 0.05,
  up2 = |ratio−2| ≤ 0.2, up3+ = ×3/×4).

## Baseline match

- `ceil-chain.mjs --prod --max=400` (real `src/dsp/boersma-ac.js`) and
  `--det=base --max=400` (`acv.mjs`, notch from cache) reproduce the phase-1
  `session-attribution/runs/baseline` columns **bit-exactly** on the
  private session recordings (0 mismatches; `python parity.py`).
- `acv.mjs` at 800 equals production `createBoersmaAC({maxPitchHz: 800})`
  bit-exactly on a session recording (all 15 columns) and on FDA.
- `corp-run.mjs` baseline = phase-1 `bugs-dsp/p17.log` (FDA f 87.76 %
  correct / 0.87 down / 1.36 null; m 85.79 / 4.42 null; vocadito ≥400 Hz
  97.6 % octave-down).

## 1. The production failure

True F0 ≥ 400 Hz, production (ceiling 400):

| | posted correct / half / null |
|---|---|
| vocadito sung ≥400 (n=207, worker) | 0.5 / 97.6 / 1.0 |

The same failure on the private session recordings (posted and painted at
half pitch) is kept outside this repository.

## 2. Ceiling × detector at the worker (posted, presentation (ii))

The ceiling × detector grid on true ≥ 400 Hz frames was scored on the
private session recordings; results on the private session recordings are kept outside this repository. Below the ceiling the
residual half is the ordinary detector octave-down class (fundamental
present, 2T preferred — phase-1 finding 1); above the ceiling it is
structural, so every ceiling below 800 leaves its own band (C, 800]
aliasing into (C/2, 400].

## 3. Presentation

### (i) report the real value (trace clips at the top; readout shows Hz)

Decodes above 400 enter the main thread. The paint gate's established level
then follows them (sirens are slow enough to pass the excursion break), so
after a high excursion the in-range voice is off-level and suppressed, and
spurious 3f/4f decodes of low voices also feed the level. Under (i) the
"correct" ≥400 painted values sit above the plot and are clipped, so the
user sees a line leaving the top edge (and the readout). On the private
session recordings this regressed painted accuracy in the low and target
registers — the target population's own registers (results kept outside
this repository). **Rejected.**

### (iii) raise PITCH_DISPLAY_RANGE.high

Same pipeline numbers as (i) (the cost above is the paint gate, not the
axis), plus the axis cost. Linear axis, pixel height per semitone at
100 Hz relative to today's 75–400: 75–600 → 0.62× (1.62× compressed),
75–800 → 0.45× (2.23× compressed); an 80–110 Hz low band shrinks
from 9.2 % of the plot height to 5.7 % / 4.1 %. A log axis 75–800 would give
100 Hz 1.37× *more* height than today but 220 Hz 0.62× and 300 Hz 0.46× —
a separate UI decision. **Rejected** for this change.

### (ii) post above-400 decodes as unvoiced — guard ordering

| | PTDB male worker correct | Hil men worker correct | pink-noise false voicing |
|---|---|---|---|
| base 400 | 84.20 | 64.32 | 0.00 % |
| 800, null AFTER guard | **83.43** (−0.77) | 63.60 | 0.00 % |
| **800, null BEFORE guard** | **84.31** (+0.11) | 63.65 | 0.25 % |

Posted after the guard, spurious high decodes (3–5.5× of a male F0) fail the
harmonic check and build the guard's fail streak, which then vetoes the next
correct-but-weak male frames (26 of 30 lost PTDB male frames at ceiling
500). Nulling them first means they never reach the guard (unvoiced frames
do not advance the streak by definition). The guard streak's carry across
gaps — load-bearing per phase-1 — is untouched. Cost: on noise that
produces above-400 decodes the streak builds more slowly (pink 0.25 % in the
40 s probe; committed oracle tail 0.5 → 1.1–1.2 % at 10/5 dB, §6).

### Main-thread hold handling (measured, rejected)

Part of the residual painted half on true ≥400 frames under (ii) is the
400 ms hold bridging the nulled frames with a stale smoothed value that was
itself a half error. Removing it was measured three ways (`lite` — an
above-range frame clears the smoothing buffer; `lite2` — clear only if the
above-range value ≈ 2× the held value; `iv` — no hold + readout shows the
above-range Hz) on the private session recordings (results kept outside
this repository). The hold is genuinely useful for spurious above-range
decodes (a low voice's 3f lock, a female voice's octave-up flicker): it
bridges them with the correct held value, so removing it cost more
in-range painted correct than it saved on the small above-range band, and
`iv` additionally surfaces spurious above-range values in the readout.
**Rejected; no main-thread change.**

## 4. New error class: octave-up into 400–800 Hz and 3f locks

Worker level, posted under (i) (i.e. before any nulling). The
session-recording rows are kept outside this repository.

Corpora (worker, all <400 Hz truth): Hillenbrand men up3+ 0.31 → 2.03 %
(800), women up2 0.04 → 0.56 %, FDA f up3+ 0 → 0.34 %. The class is real
but small, and **every one of these values is > 400 Hz**, so under (ii)
they become nulls, not errors: Hillenbrand men up2+up3+ 0.58 → 0.36 %
(800, null before guard), women up2 0.04 → 0.05 %. Their cost is the
correct→null conversion counted in §5.

## 5. In-range accuracy and corpora (recommended = base 800, null before guard)

### Sessions

The in-range accuracy on the private session recordings showed no
material regression; some target-band painted frames were lost right
after above-range runs (a paint-gate interaction that the display
workstream's re-acquiring gate shrinks, §8). Results on the private
session recordings are kept outside this repository.

### Corpora by gender, all-<400 Hz truth, worker correct (posted) and displayed (painted)

| corpus | base 400 worker | 800 worker | base 400 painted | 800 painted |
|---|---|---|---|---|
| FDA female | 87.76 | 87.53 | 86.00 | 85.89 |
| FDA male | 85.79 | 85.71 | 81.55 | 82.16 |
| PTDB female | 94.92 | 94.94 | 91.48 | 92.27 |
| PTDB male | 84.20 | 84.31 | 77.39 | 80.37 |
| Hillenbrand women | 62.69 | 62.55 | 64.35 | 64.09 |
| Hillenbrand men | 64.32 | **63.65** | 63.33 | 63.21 |
| vocadito (all <400) | 96.53 | 96.71 | 93.95 | 94.59 |

Male octave-up by band (worker, up2 / up3+): PTDB <125 0.14/0.03 →
0.08/0.06, 125–160 0.11/0 → 0.11/0; FDA <125 0.07/0.21 → 0.07/0.28,
125–160 0/0 → 0/0; Hillenbrand <125 0.25/0.52 → 0.09/0.25, 125–160
0.18/0.18 → 0.06/0.24. max(F_err, M_err) per corpus, worker: FDA
14.21 → 14.29, PTDB 15.80 → 15.69, Hillenbrand 37.31 → 37.45; displayed:
FDA 18.45 → 17.84, PTDB 22.61 → 19.63, Hillenbrand 36.67 → 36.79.

**Hillenbrand men −0.67 pp worker correct** (600: −0.49, 700: −0.59): 51
frames, all correct→null, 39 of them in the first three frames of the
reference voicing (`diag-hilm.mjs`), decoded at ×3–×5.5 — the tracker enters
voicing on a high harmonic at the vowel onset (no established path), which
at ceiling 400 was out of range for F0 ≳ 100–130 Hz. The paint gate never
paints the first three frames of a segment, so the displayed cost is
−0.12 pp. Displayed-level PTDB male +3.0 pp (blank 9.8 → 6.3 %): mechanism
not isolated; consistent with the high-harmonic locks that the 800 search
now prefers over in-range 2f/3f locks being posted unvoiced (bridged by the
hold with the correct value) instead of painting/entering the paint gate's
level ring.

## 6. Noise

Noise-only false voicing (worker-posted values ≤ 400 Hz, % of hops after
10 s, 40 s per class):

| class | base 400 | 600 | **800** |
|---|---|---|---|
| white / brown / sleep-noise / mains / crickets / cicadas | 0.00 | 0.00 | 0.00 |
| pink | 0.00 | 0.25 | 0.25 |
| sleep-birdies / resonant-330 | 0.33 / 0.33 | 0.33 / 0.33 | 0.33 / 0.33 |
| fan-hum | 0.08 | 0.08 | 0.00 |
| resonant-500 / resonant-650 | 0.17 / 0.08 | 0.00 / 0.08 | 0.00 / 0.00 |
| **whine-520 / whine-640** | **100 / 100** (at half: 260 / 320 Hz) | 0 / **100** | **0 / 0** |

The whines expose an existing hole: a stationary tonal source above the
notch's 460 Hz search band is decoded at its subharmonic, inside the
display, 100 % of the time in production. With the search at 800 it decodes
at its true frequency and is posted unvoiced.

Committed oracle (`scripts/noise-augment-oracle.js pitch --frontend=tracker`,
FDA speech in noise; "after" = the proposed worker-parity line added to the
oracle's chain): clean correct 86.8 → 86.6 %; every noise cell within
±0.3 pp correct; tail false voicing white/fan-hum/mains/cicadas unchanged
(0–0.2 %), crickets 0.9 → 0.0 %, babble 91.0/98.1/98.1 → 90.3/97.5/97.5 %,
**pink 1.0/0.5/0.5 → 1.0/1.1/1.2 %** (20/10/5 dB; the guard-streak effect
of §3 (ii)).

## 7. Top-edge candidate scan (the 2026-07-19 minLag bug class)

`edge.mjs`: harmonic tones f = C−40 … C+60 Hz in 0.5 Hz steps, frame-local
and steady-state through the L=2 tracker, two stimuli (the test-suite top-
edge tone 0.6/0.3/0.15 and a weak-H1 0.3/1.0/0.5/0.25 tone with 0.5 %
jitter). Every in-range f decodes correctly at every ceiling except exactly
f = C on ceilings whose period is an integer number of samples (400 → 40,
500 → 32, 800 → 20): `edge-fine.mjs` shows the failure window is ≤ 0.15 Hz
wide (799.85–800.00 Hz at 800; 399.95–400.00 at 400 in production today) —
the interpolated peak lands a hair above `maxPitchHz` on some frames and the
frequency filter drops it. Negligible, pre-existing, and at 800 it is
harmless anyway: the half value (400) sits on the display edge. Above C
every ceiling decodes the half (the inherent alias), which is why the
ceiling is set at 2× the display ceiling. New frame-level guards in the
proposed test: 796/798/800 Hz not octave-down, 450/520/640 Hz decoded at
their true F0, 900 Hz not reported as 900; the old 396/398/400 checks kept.

## 8. Interactions with the sibling workstreams

**SHR_hi arbitration (detector-octave workstream).** At ceiling 400 the
arbitration can only touch candidates ≤ 200 Hz (it needs the octave partner
in the candidate set). At 800 it reaches every female F0, and pushes
Hillenbrand women octave-up: worker correct 62.79 → 57.14 % (p=0.10),
62.89 → 61.75 % (p=0.05). Restricting it to candidates whose partner is
≤ 400 Hz (`2 * c.freq <= 400 * 1.05`, i.e. the 400-ceiling domain) removes
the regression (shr10 62.28, shr05 62.59 %) and keeps its in-range benefit
(measured on the private session recordings, kept outside this repository).
**If SHR ships with this change, it must carry that restriction.**

**§8a. As integrated (2026-10-03).** The octave rule that shipped is not
the phase-1 amplitude-sum SHR measured above but the odd/even
partial-prominence arbitration
([pitch-octave-arbitration-2026-10-03.md](pitch-octave-arbitration-2026-10-03.md)),
measured at the 400 Hz search. It carries the restriction in the same
form: `octaveEvidence.maxPartnerHz: 420` (= `PITCH_DISPLAY_RANGE.high` ×
1.05) — a candidate is only paired with a 2f partner ≤ 420 Hz, so the
arbitration's domain is exactly the one it was measured on. Checks at
integration: (1) with `maxPitchHz: 400` the integrated module's voiced
candidate list equals the octave-arbitration proposal's frame for frame
on two 120 s slices of private session recordings (0 mismatches) — the
restriction is a no-op at the measured ceiling; (2) frame-level test in
`tests/dsp/boersma-ac-test.js`: a 250 Hz voice with very weak odd
partials and H1 (−25 dB) stays at 250 Hz at the 800 Hz search, while the
same frame with `maxPartnerHz: Infinity` decodes ~500 Hz — the
restriction is live and load-bearing. The combined chain (ceiling +
arbitration + the other workstreams) is re-validated as a whole after
integration.

**Proposed display gate (display workstream: register re-acquisition,
fresh-only level, stale-readout fix).** Both worker variants were replayed
through `build/measure-2026-10-03/display/proposed/src/audio/pitchPaintGate.js`
with its readout policy on the private session recordings: the two changes
are complementary (that gate re-acquires faster, so it paints the
production half values *more*). Results on the private session recordings are kept outside this repository.

**Above-range veto alternative (`av`, measured, rejected).** Keep the
tracker in 75–400 (male decodes identical to production by construction)
and null a decoded frame when a frame-local candidate in 400–800 beats the
best in-range candidate and sits at 2× the decoded value. W=0 (own frame):
worse above-range coverage than 800-null (private session recordings) and
Hillenbrand women −0.46 pp; W=±2 frames: better coverage but cost the female
corpora FDA f −1.56, Hillenbrand women −2.07 and PTDB f −0.86.
Octave-ambiguous female frames are exactly where the frame-local 2× winner
is wrong; the full-range tracker resolves them with path continuity. A
target-band cost was also measured on the private session recordings
(kept outside this repository).

## 9. CPU

`cpu.mjs`, 60 s of speech, candidates + tracker + guard, 5 interleaved
rounds, median ms/frame: production 400 0.308 / 0.347, 800 0.306 / 0.321
(two runs; differences within noise — `maxLag` and the FFT size are
unchanged, the scan gains 20 lags). shr05m-800 0.303 / 0.361. All ≪ 25 ms
hop.

## 10. Consumers of the 400 Hz assumption

| consumer | effect of the recommended change |
|---|---|
| `src/utils/constants.js` `PITCH_DISPLAY_RANGE` | unchanged (75–400); now also documented as the reported range |
| `PitchTrace.jsx`, `SessionHistory.jsx` | unchanged; posted values stay ≤ 400, clip remains the structural guarantee (comment updated) |
| session stats (`CombinedDashboard` avg/median/range/time-in-target) | unchanged — above-range frames record `voiced:false, f0:null` |
| `src/diag/` sparkline (60–400 scale) | unchanged — the diag ring records the posted pitch (null) |
| `noise-notch.js` `bandHiHz` 460 | unchanged (comment updated): 460–800 Hz interferers are now nulled by the worker instead of painting at half; widening the band would promote held sung notes there |
| harmonic guard (k·f0 < sr/2 − 100) | only sees ≤ 400 Hz values (null applied first); at 800 Hz k=1..4 would still fit (3.2 kHz) |
| ML pitch-hint (`voiced`) | above-range frames relay `voiced:false`, so the gender VAD's voiced-recency arm reads "unvoiced" for windows whose trailing 500 ms is entirely above-400 phonation. **Corrected 2026-10-04:** such windows are then *not* simply skipped — the worker runs the sub-floor probe (`subFloorVoiced` in `src/ml/audio-utils.js`, normalized AC at 40–75 Hz lags with a peakedness test) and scores the window if it passes. Steady above-400 phonation passes it (a periodic 450 Hz voice is periodic at 7 × its period, ≈ 64 Hz lag, with the half-lag anti-phase); vibrato or a glide breaks the long-lag correlation and fails it (probe, synthetic 10-harmonic voice 410–750 Hz: steady and breathy-steady pass at every f0, 3 % / 5.5 Hz vibrato and a 50 %/s glide fail at every f0). So the meter scores some high phonation and freezes on the rest (no new inference; the smoothed score resets after ~2 s of skipped windows). Whether the classifier is meaningful above 400 Hz is unmeasured |
| DSP pitch-hint (formant ceiling) | null → female-default LPC branch, the same branch any pitch ≥ 140 Hz already takes |
| silence gate | invariant pitch ≠ null ⟺ confidence ≥ 0.5 kept (`frameConfidence(false, …)` ≤ 0.499); loud above-range phonation stays non-quiet via intensity |
| CPP vocal-weight feed (gated on `hasPitch`) | above-range frames do not feed CPP (as for any unvoiced frame) |
| harnesses building the chain from `createBoersmaAC` defaults (`ac-tuning-sweep`, `pitch-shootout-extract`, `pitch-accuracy-decompose`, `voicing-robustness-shootout`, `pitch-excursion-*`, …) | will search to 800 without the worker null → no longer production-parity; the proposed diff updates `noise-augment-oracle.js` (both chains); the others need the same one-liner (or `maxPitchHz: 400` to reproduce historical numbers) before their next use |

## Chosen configuration

- `BOERSMA_DEFAULTS.maxPitchHz` **400 → 800**.
- `pitch-worker.js`: after the ghost veto, **before** the harmonic guard:
  `if (vetoed > PITCH_DISPLAY_RANGE.high) vetoed = null;` (posted as
  unvoiced; confidence < 0.5).
- `PITCH_DISPLAY_RANGE` unchanged; no main-thread change.
- Tests: `tests/dsp/boersma-ac-test.js` (450 Hz "not reported" check
  replaced by 450/520/640 Hz decoded at true F0, 796/798/800 Hz top-edge
  checks, 900 Hz above the search ceiling) and new
  `tests/dsp/pitch-worker-above-range-test.js` (drives the real worker).
  Comment updates in `constants.js`, `noise-notch.js`, `PitchTrace.jsx`;
  worker-parity line in `scripts/noise-augment-oracle.js`; CLAUDE.md
  current-state row. Full diff: `build/measure-2026-10-03/ceiling/proposed_full.diff`
  (scratch copies with the change applied: `repo/`; originals: `repo_orig/`).

Why: it is the only measured option that removes the structural alias for
every above-range F0 below 1600 Hz (for a true F0 in (400, 800) the
fundamental is a search candidate; for (800, 1600) the 2T value is itself
above 400 and is nulled), cuts confident half-pitch on
true ≥400 phonation several-fold (private session recordings), leaves every
in-range display metric flat or better, does not raise low-voice octave-up
anywhere, closes the 460–800 Hz tonal-whine hole, and costs no CPU. The
residual painted half on true ≥400 frames is ordinary detector octave-down
(fundamental present, 2T preferred) plus the hold bridging a preceding half
error — the detector-octave and display workstreams' targets, not the
ceiling's.

## Rejected options

- **Ceiling 500 / 600 / 700 with (ii)**: leave (C, 800] aliasing into
  (C/2, 400] (measured on the private session recordings; results kept
  outside this repository); 640 Hz whine still painted at 320 Hz at 600.
  600 passes the Hillenbrand-men worker guard (−0.49 vs −0.67) — the
  fallback if that guard is held strictly.
- **Presentation (i)** and **(iii)** (§3): paint-gate poisoning (painted
  regressions in the low and target registers on the private session
  recordings); (iii) adds 2.2× low-register compression on a linear axis.
- **Null after the guard**: PTDB male −0.77 pp via guard-streak cascades.
- **Main-thread hold removal (`lite`, `lite2`, `iv`)** (§3): in-range
  painted cost larger than the above-range gain.
- **Above-range veto with the tracker kept in range (`av`)** (§8): worse
  coverage at W=0, large female cost at W=±2.
- **Unrestricted SHR arbitration at 800** (§8): Hillenbrand women −5.6 pp
  (p=0.10).

## Guard results (recommended vs production)

| guard | result |
|---|---|
| target band 160–400 Hz and true ≥400 Hz half-pitch (private session recordings) | target band flat; above-range half-pitch cut several-fold — PASS (results on the private session recordings are kept outside this repository) |
| low-voice octave-up ≤ +0.3 pp (PTDB m <125 / 125–160, FDA m, Hillenbrand men; also the private recordings' low band) | all flat or down (largest rise FDA m <125 up3+ 0.21 → 0.28) — PASS |
| male corpus correct ≥ −0.5 pp | PTDB m +0.11, FDA m −0.08, **Hillenbrand men −0.67 (worker) / −0.12 (displayed)** — worker-level FAIL by 0.17 pp (onset frames, §5); PASS at 600 |
| female corpora / vocadito no regression | FDA f −0.23 (worker) / −0.11 (displayed), PTDB f +0.02 / +0.79, Hillenbrand women −0.14 / −0.26, vocadito +0.18 / +0.64 — flat |
| max(F_err, M_err) | worker FDA +0.08, PTDB −0.11, Hillenbrand +0.14; displayed FDA −0.61, PTDB −2.98, Hillenbrand +0.12 — flat |
| noise-only false voicing | whine-520/640 100 → 0 %, resonant-500 0.17 → 0; pink 0 → 0.25 % (probe), oracle tail pink 0.5 → 1.1–1.2 % at 10/5 dB — no material rise |
| `tests/dsp/boersma-ac-test.js` incl. weak-H1 | 31/31 pass with the change (old 450 Hz "not reported" check replaced by the new contract); new frame-level checks fail on production, as intended |
| new `tests/dsp/pitch-worker-above-range-test.js` | 7/7 with the change; 4/7 fail on production (520 Hz posted voiced at 260 Hz; siren posts down to 200 Hz) |
| CPU | ~0.31 ms/frame at 400 and 800 — PASS |

## Reproduce

Committed guards (run anywhere):

```
node tests/dsp/boersma-ac-test.js
node tests/dsp/pitch-worker-above-range-test.js
node scripts/noise-augment-oracle.js pitch --frontend=tracker
```

Scratch harnesses — from the main checkout root (`C:/Coding Projects/Syrinx`),
scratch dir `build/measure-2026-10-03/ceiling/`. The session steps (wide
references, `ceil-chain.mjs --session=…` parity and grid runs, the
`mainsim*.mjs` replays and `analyze_ceil.py` / `report*.py` /
`decomp.py` / `final_tables.py` scoring) need the private session
recordings and phase-1 references, which live outside the repo, and are
omitted here.

```
cd build/measure-2026-10-03/ceiling
# corpora + noise
node corp-run.mjs fda|ptdb|hil|voc|noise                    # grid, worker level
node corp-run.mjs <c> --vars=base_400,base_500np,base_600np,base_700np,base_800np,shr05_400,shr05_600np,shr05_800np --suffix=_np
node corp-run.mjs <c> --vars=base_400,base_600np,base_700np,base_800np,shr05_400,shr05_800np,shr05m_800np --display --suffix=_disp
node corp-run.mjs <c> --vars=base_400,base_400avW0,base_400avW2,base_400avW2r3,shr05_400avW2,shr05m_800np,shr10m_800np,shr10_800np --suffix=_av
python corp_summary.py
node diag-ptdbm.mjs; node diag-hilm.mjs
# edge, CPU, committed oracle before/after (repo_orig = production copy, repo = proposed change)
node edge.mjs; node edge-fine.mjs; node cpu.mjs
#   (the oracle needs repo*/tests/dsp/data -> tests/dsp/data: cmd /c mklink /J
#    repo\tests\dsp\data ..\..\..\tests\dsp\data ; remove with cmd /c rmdir, never rm -r)
node repo_orig/scripts/noise-augment-oracle.js pitch --frontend=tracker
node repo/scripts/noise-augment-oracle.js pitch --frontend=tracker
node repo/tests/dsp/boersma-ac-test.js; node repo/tests/dsp/pitch-worker-above-range-test.js
```

## Follow-ups

- Vowel-onset harmonic locks (the Hillenbrand-men worker cost): the tracker
  enters voicing on a 3f/4f candidate when there is no established path.
  A voiced-entry preference (e.g. octave-cost on the entering transition)
  is tracker tuning — separate measured work.
- Optional UI: an "above range" indicator (▲ / "> 400 Hz") would need the
  worker to flag nulled-above-range frames (`aboveRange: true`); not
  included — the measured readout variant (`iv`) showed spurious
  above-range values cost more than they help.
- Update the remaining harnesses (§10 table) with the worker-parity null
  before their next use.
- Field validation on a live session with sirens (the data here are
  recordings through the Node mirror).
