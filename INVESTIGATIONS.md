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
H1 — routine in voice training) in the 80–110 Hz low register, far more
often than tuned AC, which also held up on held-out sessions (private
measurements, kept outside this repo), at corpus parity or better on two
of four ground-truth corpora and ~25–50× less compute (0.21 ms/frame vs
5–11 ms browser-WASM).

Full decision data: [measurements/boersma-ac-tuning-2026-06-09.md](measurements/boersma-ac-tuning-2026-06-09.md)
(the session comparison and detector shootout are private measurements,
kept outside this repo).

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
(2026-06-10, `pitch-trace-clip-floor` branch; the excursion-break
measurement is private, kept outside this repo).
The displayed low-band session accuracy (private measurement) was
underestimated by an attribution artifact; scored at the correct ~150 ms
attribution (98 ms worker latency + 5-frame display median lag) it was
materially higher.

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
across both audeering 6L and JaesungHuh — long treated as an
architecture-independent calibration noise floor. **Superseded
2026-07-19:** the floor was q8 quantization damage, concentrated in
the attentive-pooling matmul — at fp32, and under the re-quantization
that excludes that single node, m45 classifies correctly and
confidently and Hillenbrand reaches 100/100
([gender-model-latency-2026-07-19.md](measurements/gender-model-latency-2026-07-19.md)).

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

## Pitch-only warning history ("Likely heard as" panel)

Moved verbatim from CLAUDE.md on 2026-10-19 (audit against the `cue-strip` branch). The rule in production, its decisions and its remaining limits stay in CLAUDE.md's Current-state row "Likely heard as"; study data: [measurements/heard-as-pitch-only-warning-2026-10-07.md](measurements/heard-as-pitch-only-warning-2026-10-07.md).

### Rule S0 and the studies before A40+KP8-3+DS10 (superseded 2026-10-12)

**Historical (superseded 2026-10-12):** rule S0, pre-registered study: \|Δ posted pitch since the cue's start window\| ≥ 4 st AND \|u − startU\| ≤ 0.6 u on 2 consecutive 2 s updates; **on fresh speakers (LibriSpeech test-other, §8.2) it catches only 0.59 (male base) / 0.65 (female base) of pitch-only shifts within 10 s — below the pre-registered 0.85 bar — so a missing warning does not mean the reading is right (the panel's "More" list says so)**; the original study's test split hit 0.91 / 0.90, natural false alarms 1.0 / 0 % women / men; fresh LibriSpeech dev-clean false alarms 0.94 % W / 1.07 % M, but readers whose start window is atypical see it far more (worst 13.8 % W / 21.4 % M; one expressive man 6.6–61 % depending only on where the session started — P0 comes from one ~15 s start window; a **pre-registered steadier-start-reference study (2026-10-07, LibriSpeech dev-other / test-other) passed nothing**, so the rule is unchanged: every configuration, the shipped one included, missed the ≥ 0.85 hit bar, and on fresh test speakers the shipped rule hits 0.59 / 0.65 (male / female base) instead of round 2's 0.91 / 0.90; the misses come from the panel hiding after a shift, octave misreads of resynthesised voices and resonance drift, not from the reference; a slowly tracking start (D2-0.1, post hoc) removed most start-dependent false alarms but **failed its pre-registered fresh confirmation (2026-10-08, 66 LibriSpeech train-other-500 readers, §8.3): female-base hits 0.862 → 0.800 (bar ≥ 0.8115 = S0 − 0.05) and one expressive man's worst start 30.3 % (bar ≤ 15 %)** — not shipped, S0 kept; on that data S0 hits 0.83 / 0.86 and its natural false alarms are 0.5 % W / 4.1 % M, one expressive man 54 % (14–75 % by start); **2026-10-11 (§8.4): a pre-registered fix for men's false alarms (A40+KP8-3+DS10) failed its held-out test (11 of 15 checks) — not shipped, S0 kept; on 48 fresh LibriSpeech / MLS German speakers S0's natural false alarms are 2.50 % M / 0.48 % W, one man 27.4 %, an expressive man 9–37 % depending on the start** (these per-reader figures come from a replay that updates the resonance state every 2 s; at the live 0.2 s cadence readers moved by up to ~3 pp, e.g. that man 29.8 %); **2026-10-12 (§8.5): round 2 at the app's 0.2 s resonance cadence, drift-stratified split (192 fresh LibriSpeech / MLS / OpenSLR 83 readers) — the same rule (PREREG fallback pick; no candidate passed all dev checks) removed nearly all false alarms on test (men 3.39 → 0.27 %, women 0.33 → 0 %) but warned later on real shifts and failed 2 of 15 checks (male-base hits −0.036, female-base early-shift hits −0.050) — not shipped, S0 kept; S0's natural false alarms at the app cadence, 96 readers per sex: men 1.50 % update-weighted / 2.27 % reader-balanced, women 0.34 %, worst man 85 % (7 of his 8 eligible updates; next two men ~40 % of ~80), concentrated in readers whose pitch varies a lot — disclosed in the panel's "More" list as about 1–2 in 100 updates for men until the §8.6 adoption** — [heard-as-pitch-only-warning-2026-10-07.md](measurements/heard-as-pitch-only-warning-2026-10-07.md) §8.2–8.8.

### Memory bound while the panel is off (resolved 2026-10-13)

**Resolved 2026-10-13** with the KS-Q5 adoption ([heard-as-pitch-only-warning-2026-10-07.md](measurements/heard-as-pitch-only-warning-2026-10-07.md) §8.9, committed before the code): [src/ml/pitch-only-warning.js](src/ml/pitch-only-warning.js) now decides S0's P0 in `addPitch()` at the first frame past t_start and freezes A40 there at the first frame past max(t_start, t_fill + 40 s), then empties its buffer; a voiced-frame cap gives up on a start window still open once it would hold more than 7,200 voiced frames (2c′, §8.9 decisions of 2026-10-13; silence does not count — the first cap, 180 s of audio after t_fill, also ended a start after a long pause); the K-seed reads an 8 s ring of posted frames (released once the panel's first update came before t_fill); KP8 histories are a count and a sum of squares. Retained frames ≤ 7,521 at any time (25 ms frames) and ≤ 321 once A40 is final; on a simulated hour with the panel off ~74 KB held vs ~7.1 MB for the shipped module (`node --expose-gc scripts/heard-as/pitch-only/warning_bound.mjs`); outputs identical to the shipped module with the panel on from the start (0 mismatches on 1,596,129 recorded updates) until the voiced-frame cap applies (never on the recorded streams). **Historical (superseded 2026-10-13):** Found in the 2026-10-13 review of the late-panel round 2 ([heard-as-pitch-only-warning-2026-10-07.md](measurements/heard-as-pitch-only-warning-2026-10-07.md) §8.8, review notes); older than that round. In [src/ml/pitch-only-warning.js](src/ml/pitch-only-warning.js) the `frames` buffer is emptied only in `refAt()`, reached only through `update()`, which only `HeardAsPanel` calls, only while the panel is on; the hook calls `addPitch()` for every posted pitch frame and `noteResonance()` for every resonance-cue state regardless. With the panel off (the default) every voiced frame after the cue's first fill is kept until stop / start, a cue restart or a resonance-worker overloaded / error status: up to 40 small objects per second of voiced audio, ~144,000 per hour (a few MB; not measured). Switching the panel on scans the buffer once, freezes A40 and empties it. A fix (freeze A40 inside `addPitch()` once a frame past max(t_start, t_fill + 40 s) arrives and S0's P0 is known) changes the module, so hard rule 3 applies: a replay-parity run showing identical warning strings first. Any KS-Q5 port reads the same buffer for its K-seed.
