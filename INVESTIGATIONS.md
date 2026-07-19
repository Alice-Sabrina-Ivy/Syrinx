# INVESTIGATIONS.md — historical investigation record

Narrative history of the project's major empirical investigations, moved
out of CLAUDE.md on 2026-07-07 to keep the every-session context lean.
The transferable **lessons** from these arcs are indexed in CLAUDE.md
(§"Methodology lessons"); this file preserves the full arcs so future
investigations don't re-derive conclusions or re-run ruled-out
directions. Raw data lives in `measurements/`.

Sections are ordered newest-first within each topic. Everything here is
historical: where this file and CLAUDE.md's "Current state" table
disagree, the table wins.

---

## Pitch detection

### Boersma-AC cutover (2026-06-09) — deployed

SwiftF0 replaced by a Praat-style window-corrected autocorrelation
detector + bounded-Viterbi path tracker (`src/dsp/boersma-ac.js`), pure
JS, no model fetch. Trigger: real-user-session validation showed SwiftF0
confidently octave-upping on weak-fundamental phonation (H2 louder than
H1 — routine in voice training): 25.6 % octave-up / 19.1 % null in the
user's 80–110 Hz register, vs 4.1 % / 0.4 % for tuned AC, at corpus
parity or better on two of four ground-truth corpora and ~25–50× less
compute (0.21 ms/frame vs 5–11 ms browser-WASM).

Full decision data: [measurements/swift-f0-vs-praat-sessions-2026-06-09.md](measurements/swift-f0-vs-praat-sessions-2026-06-09.md),
[measurements/pitch-detector-shootout-2026-06-09.md](measurements/pitch-detector-shootout-2026-06-09.md),
[measurements/boersma-ac-tuning-2026-06-09.md](measurements/boersma-ac-tuning-2026-06-09.md).
Held-out sessions: AC 96.5–97.5 % vs SwiftF0 70.9–84.4 % overall.

Two measurement-infrastructure findings from the tuning pass (both
still binding for any future pitch evaluation):

1. **Score each detector at its own response center.** The v0 shootout
   scored every detector against truth at SwiftF0's attribution time
   (~56 ms before the latest sample); AC's response is centered at its
   window center. Scored correctly, AC's apparent FDA deficit shrank
   ~16 pp.
2. **PTDB-TUG reference timestamps are offset ~+20 ms** relative to the
   loader's `i*hopMs` convention. With the correction, SwiftF0's PTDB
   correct rises 74.5 → 88.0 %. All pre-2026-06-09 PTDB numbers in the
   measurement history should be read with this in mind.

Post-cutover follow-ups: excursion-break + display-clip + 75 Hz floor
(2026-06-10, `pitch-trace-clip-floor` branch;
[measurements/pitch-excursion-break-2026-06-10.md](measurements/pitch-excursion-break-2026-06-10.md)).
The displayed 80–110 Hz band accuracy is ~94 % when scored at the
correct ~150 ms attribution (98 ms worker latency + 5-frame display
median lag); an earlier "81 %" figure was an attribution artifact.

### SwiftF0 era (2026-05-06 → 2026-06-09)

**Production description (historical):** pitch-worker.js hosted an ONNX
Runtime Web session for the SwiftF0 model (`lars76/swift-f0`, MIT,
388 KB ONNX, 95 K-param CNN operating on 1024-sample / 64 ms windows of
16 kHz mono audio). Resampled incoming chunks to 16 kHz via linear
interpolation, maintained a rolling 1024-sample buffer, ran inference
per 25 ms chunk (~56 ms inherent attribution latency). Median 11 ms
inference on Pixel 8 Pro / Chrome 147 / WASM, p95 17 ms. Confidence
threshold 0.5 gated pitch reporting and seeded the silence gate's
voicedness arm — the same single-threshold design Boersma-AC preserves.

**Cutover investigation arc (pYIN → SwiftF0):**

1. **Failure report**: 80 Hz monotone speech tracked at 240–400 Hz
   (3×–5× harmonics) in production while Voice Tools (closed-source
   Android reference) tracked cleanly. Reproducible across mics.
2. **Test corpus expansion**: integrated Vocadito (CC-BY 4.0 singing
   corpus, 40 tracks, in-repo), CSTR FDA (100 sentences with
   laryngograph ground truth, fetch-on-demand via
   `bash scripts/fetch-fda-subset.sh`), re-integrated PTDB-TUG, built
   the frame-level cross-corpus bucket harness.
3. **Production baseline** ([measurements/pitch-bucket-baseline-2026-05-06.md](measurements/pitch-bucket-baseline-2026-05-06.md)):
   pYIN at 2.3–2.7 % octave-error on sub-90 Hz speech, 10.4 % on
   `vocadito_34`.
4. **Four pYIN-internal fix directions investigated and ruled out**:
   symmetric α tuning ([measurements/alpha-sweep-2026-05-06.md](measurements/alpha-sweep-2026-05-06.md) —
   per-corpus trade-off, no clean winner); asymmetric α (binary phase
   transition at α_up=0, intermediate values identical to baseline);
   voicedness-magnitude transform (changes voiced/unvoiced labeling but
   not pitch ranking — wrong architectural layer); multi-mult harmonic
   correction (5×3 grid all failed criteria; inherent contradiction in
   acceptance criteria). The sweep harnesses were deleted in the
   2026-06-09 harness cleanup; recover from git history if needed.
5. **Field-level benchmark review**: [Nieradzik 2026 pitch-benchmark](https://github.com/lars76/pitch-benchmark)
   showed pYIN as the worst classical tracker on PTDB-TUG (72.1 % vs
   Praat 86.2 %, SwiftF0 90.4 %, PENN 91.0 %) — pYIN as an algorithm
   class is structurally limited for sustained low-pitch speech.
6. **SwiftF0 selection + validation**: Stage 1 rl022 diagnostic showed
   true F0 in pYIN's top-3 pre-HMM candidates only 6.3 % of the time
   (candidate generation broken → replacement correctly targeted).
   Stage 2 audit: SwiftF0 returns scalar pitch + confidence per frame,
   not per-bin posteriors, so "SwiftF0 + Syrinx HMM" was not viable;
   selected SwiftF0 standalone. Stage 3 four-corpus validation:
   [measurements/swift-f0-stage3-validation-2026-05-06.md](measurements/swift-f0-stage3-validation-2026-05-06.md).
   Stage 3.4 threshold sweep (0.5 selected) + Stage 3.5 mobile WASM
   latency: [measurements/swift-f0-stage3-4-3-5-validation-2026-05-06.md](measurements/swift-f0-stage3-4-3-5-validation-2026-05-06.md).
7. **Stage 4 integration**: new pitch-worker.js, dsp-worker.js pYIN
   removal (1633 → ~6 KB built), diag schema migration
   (`voicedness` → `confidence`, new `pitchInferences` ring):
   [measurements/swift-f0-stage4-integration-2026-05-06.md](measurements/swift-f0-stage4-integration-2026-05-06.md).

Outcome: user-reported 80 Hz monotone reproducer (FDA `rl022`) dropped
from 27.12 Hz mean error / 2 octave errors (pYIN) to 2.44 Hz / 0
(SwiftF0); aggregate octave-error rates collapsed 50–100× across all
four corpora (Hillenbrand 0.02 %, PTDB-TUG 0.08 %, vocadito 0.05 %,
FDA 0.00 %).

### pYIN era (pre-2026-05-06)

**Final production baseline**: Stage 2.B σ=50 L=4 α=0.0001, full-corpus
Hillenbrand mean F0 error M=9.6 Hz / F=11.3 Hz. Tuning history:
[measurements/pyin-L-sweep-2026-05-04.md](measurements/pyin-L-sweep-2026-05-04.md),
[measurements/pyin-sigma-at-bestL-2026-05-04-harness.txt](measurements/pyin-sigma-at-bestL-2026-05-04-harness.txt),
[measurements/octave-lock-investigation-2026-05-05.md](measurements/octave-lock-investigation-2026-05-05.md),
[measurements/alpha-sweep-2026-05-06.md](measurements/alpha-sweep-2026-05-06.md).

**Gender-symmetric ship criterion (established here, still binding —
also summarized in CLAUDE.md):** the L-axis sweep produced three
defensible Pareto cells; the cell minimizing female F0 error (L=2 σ=75,
F=11.75 Hz) had M=15.52 Hz — a 3.77 Hz gender gap. L=4 σ=50 was
selected for gender symmetry at a small cost to female accuracy. The
α=0.0001 mixture prior improved both genders (M 12.15→9.6, F
12.16→11.3).

**PR #68 production-path lesson (full version):** PR #68's original
ship documented L=2 (50 ms latency) based on σ-sweep harness numbers
that set `__PYIN_LOOKBACK` explicitly; production never set the
override, so the deployed runtime silently fell back to L=5 (~125 ms).
The harness numbers were correct for L=2 but irrelevant to what
shipped. Caught by code review pre-merge; the resulting L-axis sweep
revealed L=2 was also sub-optimal and the eventual ship was L=4 σ=50.
The named `PYIN_LOOKBACK_DEFAULT` constant existed so this category of
bug couldn't recur silently — the same named-default convention should
apply to any config with a test-override path.

**Test helper-choice contract (full version):** the pYIN-era harnesses
had two helpers for two regimes — `steadyStateDetect` for stationary
stimuli (same-window-repeated equals sequential-frames-of-same-signal)
and `streamingMedianDetect` for non-stationary recordings (adjacent
windows differ). Mixing them produced measurement artifacts that didn't
obviously fail: F p95 = 210 Hz with the wrong helper vs ~28 Hz with the
right one, a 7× difference on Hillenbrand
([measurements/pass1-helper-diagnostic-2026-05-04.md](measurements/pass1-helper-diagnostic-2026-05-04.md)).
The generalized lesson: evaluation regime must match the stimulus's
stationarity, and streaming evaluation must match production cadence.

**Harness cleanup (2026-06-09):** the pYIN test/sweep harnesses that
drove `detectPitch` from a vm-loaded dsp-worker.js (accuracy-test,
real-speech-test, yin-harmonic-test, pitch-detection-comprehensive,
degraded-test, per-corpus ptdb-tug/fda/vocadito tests,
pitch-bucket-harness + its four ruled-out-direction sweeps, octave-lock
diagnostics, rl022-diagnostic, latency-benchmark,
scripts/pyin-L-sweep-harness) were deleted from main — dead since Stage
4 removed `detectPitch`, and PR #78's `import` in dsp-worker.js crashed
their vm loaders. Recover from git history (pre-2026-06-09) if needed.
Also retired earlier: the synthetic `yin-harmonic-test.js` suite —
synthetic-stimulus suites proved to be regression guards at best,
insensitive for parameter selection (84-cell sweep, 2026-05-04).

### Silence-gate fragmentation — PR #74 (2026-05-06)

The pitch trace fragmented during continuous speech because the
original gate (`intensity < threshold OR voicedness < threshold`)
over-suppressed real speech: intensity dipped during inter-phoneme
transitions, and pYIN's HMM-smoothed voicedness measures clean
periodicity, which real continuous speech sits structurally below at
the 0.5 threshold. PR #74 inverted the operator to AND so suppression
requires both signals to agree on "noise". The AND semantics and the
0.5 threshold carried forward through the SwiftF0 cutover and into
Boersma-AC (whose posted confidence preserves the
pitch≠null ⟺ confidence ≥ 0.5 invariant by construction).

**Methodology lesson (binding for future gate work):** the synthetic
200 Hz fixture (`tests/audio/fixtures/voice-200hz-10s.wav`) cannot
substitute for real-voice testing of gate calibration — fake-device
injection bypasses the mic chain (different inputRms), and the
fixture's clean harmonic structure produces much higher voicedness
than real speech at the same RMS. Synthetic fixtures are clean-signal
upper bounds only. Full history in
[PR #74](https://github.com/Alice-Sabrina-Ivy/Syrinx/pull/74).

---

## Perceived-voice gender model (2026-05-05/06) — resolved

**Outcome:** production model swapped from
`prithivMLmods/Common-Voice-Gender-Detection-ONNX` (wav2vec2-base,
~95 M params, 100 % male / 81.3 % female on Hillenbrand) to
`Alice-Sabrina-Ivy/voice-gender-classifier-onnx-q8` (JaesungHuh
ECAPA-TDNN q8, ~15.4 M params, 95.6 / 95.8 — gender-symmetric). Single
model on both platforms; also 4.6× faster on mobile.

**Arc:**

1. **PR #71 (2026-05-05)**: α=0.2 EMA tuning on prithivMLmods raised
   Hillenbrand female accuracy 62.5 → 81.3 % — spent 480 ms of meter
   responsiveness to claw back ~19 pp on the existing noisy model.
2. **Audeering 6L (2026-05-05, retired)**:
   `audeering/wav2vec2-large-robust-6-ft-age-gender` — Hillenbrand
   100/100 but mobile inference 1154 ms median on Pixel 8 Pro (7.7×
   over hop budget); wav2vec2-large desktop:mobile ratio ~21×. Branch
   [`perceived-voice-audeering-6l-integration`](https://github.com/Alice-Sabrina-Ivy/Syrinx/tree/perceived-voice-audeering-6l-integration)
   preserved (conversion scripts + Hillenbrand test live there).
3. **JaesungHuh (2026-05-06)**: ECAPA-TDNN, Hillenbrand 95.6/95.8,
   mobile 460 ms median — over budget but ~2.5× faster than audeering.
   Branch [`perceived-voice-jaesunghuh-tdnn-investigation`](https://github.com/Alice-Sabrina-Ivy/Syrinx/tree/perceived-voice-jaesunghuh-tdnn-investigation)
   preserved. Q8 ONNX uploaded to HF Hub (MIT, inherited upstream).
4. **Platform-split exploration (didn't ship)**: designed UA-routing +
   first-inference probe to ship JaesungHuh on desktop and
   prithivMLmods on mobile. Stage 5 mobile measurement killed it: the
   design assumed mobile prithivMLmods was fast enough to justify the
   asymmetry, but it measured ~2100 ms per inference on Pixel 8 Pro /
   Chrome 147 / WebGPU — slower than JaesungHuh's 460 ms on the same
   device. The production ship had been degraded on mobile for some
   time without anyone noticing, because nobody measured. Single-model
   JaesungHuh dominated on every metric.
5. **Resolution PR**: single-model swap, both platforms; UA detection,
   probe, and swap-model logic all dropped — none needed.

**Lessons (indexed in CLAUDE.md):** measure on the production runtime,
not Node ORT (Node ORT is ~18× faster than browser WASM — JaesungHuh's
"11 ms desktop" was a Node number; real browser WASM was 191 ms);
architecture-runtime interaction beats parameter count (desktop:mobile
WASM ratio — ECAPA-TDNN ~2.4×, wav2vec2-base ~4.5×, wav2vec2-large
~21×); don't assume the current ship works without direct measurement;
don't transfer thresholds across decision contexts (the "250 ms"
threshold from mobile-feasibility work fired premature fallbacks when
reused for the platform-split probe — different decisions need
separately-anchored thresholds).

**Known borderline samples:** m45 misclassifies under any α tested,
across both audeering 6L and JaesungHuh — architecture-independent;
treat as the calibration noise floor, don't re-litigate in future
evaluations.

**Measurement infrastructure preserved on main:** `mlInferences` ring +
`pushMlInference` + `mlModel` snapshot field in
[src/diag/diag.js](src/diag/diag.js); `--model=<HF_id>` parameter in
[tests/ml/perceived-voice-hillenbrand-test.js](tests/ml/perceived-voice-hillenbrand-test.js).
Conversion scripts (export/quantize/verify) on the JaesungHuh branch.

---

## Vocal weight (CPP) — Stage C (2026-05-12)

Shipped as the sliding-window auto-calibrating gauge (see CLAUDE.md
§VocalWeightGauge). Six investigation cycles including a same-day
revert of a persistence+target-capture implementation that failed the
interaction-cost trade-off — the revert is why the Dexie schema has a
`null`-drop v2 entry. Full arc:
[measurements/vocal-weight-stage-c-implementation-2026-05-12.md](measurements/vocal-weight-stage-c-implementation-2026-05-12.md).
Accuracy pass merged as PR #86 (2026-07).
