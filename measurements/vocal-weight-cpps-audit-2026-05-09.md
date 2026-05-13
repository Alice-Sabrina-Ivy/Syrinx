# Vocal weight CPPS replacement — Stage A audit

**Date:** 2026-05-09
**Scope:** Audit-only surface analysis for the CPPS replacement of the
existing alpha-ratio "Vocal Weight" gauge. No code changes.
**Companions:**
- [vocal-weight-audit-2026-05-09.md](vocal-weight-audit-2026-05-09.md) — Stage 0 audit of the existing metric.
- [vocal-weight-literature-2026-05-09.md](vocal-weight-literature-2026-05-09.md) — Stage L1/L2 literature scan that selected CPPS as the primary candidate.

## TL;DR

- **CPPS algorithm spec is well-pinned conceptually but not numerically pinned by an
  authoritative open implementation.** The widely-cited algorithm (Praat's
  `PowerCepstrogram` + `Get CPPS`) is documented at the API level on
  fon.hum.uva.nl but its default parameter values are not surfaced in
  the manual pages reachable without paywalled journals or the Praat
  source. The Hillenbrand 1994 original sat on sustained vowels at
  22.05 kHz with ~46 ms windows. **Syrinx will need to pin its own
  parameters in a measurement pass before declaring "this is CPPS as
  Aaen et al. report it."**
- **FFT infrastructure already in place is adequate.** The existing
  radix-2 FFT in [dsp-worker.js:567-609](src/dsp/dsp-worker.js#L567-L609)
  + 2048-pt buffers + Hann windowing all reuse cleanly. CPPS adds
  one log+IFFT cycle and a regression baseline computation per analysis
  frame. ~2 ms incremental cost per frame on a Pixel 8 Pro WASM
  estimate (consistent with Syrinx's other DSP routines).
- **Aggregation infrastructure is the substantive new design surface.**
  No analogue currently exists in dsp-worker.js — every existing metric
  is per-frame. CPPS needs voiced-frame accumulation gated on SwiftF0
  confidence, with a frame-buffering scheme the worker doesn't have.
  Recommended placement: dsp-worker.js maintains a per-frame CPP ring,
  the main thread aggregates into a CPPS over the most recent ≥1 s
  voiced window. **This split keeps hot-path DSP in the worker and
  windowed bookkeeping in JS where it's easier to reason about.**
- **Display cadence change is a UX commitment, not just an
  engineering decision.** Going from per-frame raw-value updates to
  ~1 Hz aggregated updates is fundamentally a different feedback
  modality. **A 1 s aggregate updated every 250 ms with a 75 %
  rolling overlap is the recommended path** — it keeps the meter
  feeling alive without re-introducing per-frame jitter.
- **Reference ranges are the calibration honesty problem.** No
  Syrinx-applicable population reference for CPPS exists (clinical
  studies use studio mics; consumer-mic CPPS distributions are
  unmeasured). **Ship with relative trend display + per-user
  baseline anchored to the user's own first ~30 s of voiced
  speech** — not a population-derived absolute range.
- **Alpha-ratio code: remove on the same PR.** The existing metric
  has no other consumer; keeping it as a "secondary signal" adds
  surface for no demand. Remove computation, schema field, and
  display together. Session-history `avgSpectralTilt` for past
  saved sessions is a backwards-compat schema migration question
  flagged below.
- **Validation needs three layers**: (1) unit-level synthetic
  pulse-train tests (analogous to formant-debug.js), (2)
  Hillenbrand corpus regression (does CPPS distinguish
  attenuated-attack vs strong-attack vowels?), (3) user-side
  real-mic spot check (deliberate "lighter" vs "heavier" speech
  under same conditions). Layers (1) and (2) are tractable unit
  tests; (3) is non-automatable.
- **Implementation cost (rough estimate):** Stage B
  implementation is on the order of "non-trivial — comparable to a
  formant overhaul, not a one-day task." Worker-side cepstrum + main-
  thread aggregation + UI + tests + measurement pass. Probably
  multi-day even with focused work.

---

## 1. CPPS algorithm specification

### 1.1 What we know with confidence

From the Praat manual pages (fon.hum.uva.nl/praat/manual/Sound__To_PowerCepstrogram___.html
+ PowerCepstrogram__Get_CPPS___.html) and Wikipedia's Cepstrum entry,
the conceptual algorithm is:

1. **Per-frame analysis.** Window the signal in overlapping frames.
   Praat sets the frame length to "three periods of pitch floor"
   (i.e., ~3/F0_min seconds, e.g., ~30 ms at F0=100 Hz).
2. **Pre-emphasis.** First-order high-pass on the input. Praat has a
   "Pre-emphasis from" parameter; the default is conventionally
   50 Hz cutoff but the manual pages don't surface a default in the
   text I could fetch.
3. **Gaussian window** the framed segment.
4. **Compute power spectrum.** `|FFT(windowed)|²`.
5. **Compute power cepstrum.** `IFFT(log(power_spectrum))`. (Praat
   uses log-power, sometimes referred to as the "log-magnitude
   cepstrum" interchangeably; the difference is a constant scale
   factor that washes out in the dB-relative CPP.)
6. **Search peak in quefrency range.** Lower bound = `1/pitchCeiling`
   (e.g., 500 Hz → 2 ms). Upper bound = `1/pitchFloor` (e.g., 60 Hz →
   16.67 ms). Praat documentation explicitly says the lower bound is
   "more critical" than the upper.
7. **Fit regression baseline** in dB across a quefrency range
   (default lower bound 0.001 s = 1 ms in the Praat manual). Three
   methods available; Praat's default is **Theil's robust slow**
   (median-of-pairwise-slopes — outlier-robust). Trend type can be
   linear or exponential.
8. **CPP per frame** = `peak_dB − baseline_at_peak_dB`.
9. **CPPS** = average across frames after smoothing in the time
   AND quefrency dimensions (Praat exposes both as separate
   parameters).

### 1.2 What we DON'T know without a measurement pass

The Praat manual pages I could fetch list these parameters by
name without surfacing default values:

- Pitch floor (Hz) — typical literature default 60 Hz, sometimes 75
- Pitch ceiling (Hz) — typical literature default 330 Hz or 500 Hz
- Time step (s) — typical 0.002 s (2 ms hop)
- Maximum frequency (Hz) — typical 5000 Hz
- Pre-emphasis from (Hz) — typical 50 Hz
- Time averaging window (s) — typical 0.001-0.01 s
- Quefrency averaging window (s) — typical 0.00005-0.001 s
- Trend line quefrency range (s) — Praat default "starts at 0.001 s"

**Implication for Stage B:** these need to be pinned by either (a) a
direct read of Praat's source code, (b) a comparison run against
Praat output via `parselmouth` on a fixed corpus, OR (c) accepting
that Syrinx CPPS values won't be directly comparable to clinical
literature absolute values and using only a relative scale.

The literature review's anchor citation (Aaen et al. 2025) doesn't
surface these defaults in the abstract either. **The realistic stance
is that absolute CPPS values won't transfer cleanly from clinical
literature to a consumer-mic Web Audio pipeline regardless of what
parameters we pick** — see §6 (reference ranges) for the calibration
implication.

### 1.3 Hillenbrand 1994 original (the simpler reference)

The original CPP definition is more pinned-down than CPPS:

- Sample rate 22.05 kHz; window length ~46 ms (1024 samples).
- Hann window.
- Real cepstrum: `IFFT(log|FFT(signal)|)` (NOT power cepstrum;
  factor-of-2 difference in the dB scale).
- Search peak in quefrency range corresponding to ~60-300 Hz F0.
- Regression baseline: least-squares linear fit across the search
  range.
- CPP = peak_value_dB − baseline_dB at peak quefrency.
- Reported on sustained vowels.

This is implementable directly without a Praat-comparison
measurement pass and is reproducible. Aaen et al. cite Hillenbrand
1994 in their methodology. **Hillenbrand-style CPP is a defensible
conservative choice for first ship**; CPPS smoothing can be added
in a follow-up if the per-window CPP turns out too noisy after
≥1 s aggregation.

### 1.4 Recommended Syrinx CPPS parameters (provisional)

Pinned by hybrid of Hillenbrand 1994 + Praat conventions + Syrinx's
existing infrastructure. Each parameter gets a measurement-pass
sanity check before ship.

| Parameter | Recommended value | Rationale |
|---|---|---|
| Per-frame analysis window | 1024 samples (~21 ms at 48 kHz) | Matches existing FFT buffer size; spans ~3 periods of F0=140 Hz minimum, ~6 periods at 280 Hz |
| Window function | Hann | Matches existing tilt code; Praat uses Gaussian but the difference is small in CPP space |
| Pre-emphasis | 50 Hz first-order high-pass | Praat convention |
| FFT size | 2048 (existing buffer; zero-padded from 1024 input) | Existing `_tiltRe/_tiltIm` reusable in concept; should be a separate buffer |
| Spectrum dB transform | `20·log10(|X[k]|)` (real-cepstrum-style — Hillenbrand 1994 convention) | Matches the simpler reference; CPPS smoothing layer can be added later |
| Cepstrum | IFFT of the dB log-magnitude spectrum | Real cepstrum convention. Use existing FFT with conjugation trick: `IFFT(x) = conj(FFT(conj(x)))/N` |
| Quefrency search range | 1.6-13.3 ms (75-625 Hz F0 range) | Brackets the speech F0 range with safety margin |
| Regression baseline | Linear least-squares over the search range | Hillenbrand convention; Praat's Theil-robust is more robust to peak influence but adds compute. Re-evaluate in Stage B if peak influence is a problem. |
| CPP per frame | peak_dB − baseline_at_peak_quefrency_dB | Standard |
| Aggregation | Mean over voiced-only CPP frames in the last ≥1 s | See §3 |
| Optional smoothing layer (CPPS proper) | Time-window 7 frames + quefrency-bin 7 bins, deferred to follow-up if needed | Adds complexity; not required for first ship if 1 s aggregation already produces a stable signal |

### 1.5 What this commits us to

A first-ship **CPP-with-aggregation** rather than canonical
**CPPS-with-time-and-quefrency-smoothing**. The vocal-weight literature
review used "CPPS" loosely; the Aaen citation specifically uses CPP
(Hillenbrand-style) on sustained vowels. **For Syrinx's running-speech
context, the dominant noise reduction comes from the 1 s aggregation,
not from quefrency smoothing.** Adding canonical CPPS smoothing as a
later refinement is reasonable; shipping it day-one is over-scoping.

In documentation we should call this "CPP aggregated over a 1 s
voiced window" or "Aggregated CPP" rather than CPPS, to avoid
implying we're producing the Maryn-Weenink Praat-compatible value.

---

## 2. Pipeline integration

### 2.1 Where CPP computation lives

**Recommendation: dsp-worker.js**, alongside formants/HNR/intensity.

Reasoning:
- It's another FFT-derived spectral measure — same family.
- The existing 50 ms analysis window + every-6th-frame cadence
  (~150 ms per emission) maps cleanly onto CPP-per-frame: each
  6th-frame emission gets a CPP value alongside formants/HNR/tilt.
- No new worker bootstrap, no new MessagePort wiring, no new
  init-ack handshake.
- The `analysisCount % 6 === 0` cadence in
  [dsp-worker.js:122](src/dsp/dsp-worker.js#L122) is the natural
  insertion point.

Reasons NOT to spawn a new worker:
- CPP isn't compute-heavy enough to need its own thread (single
  IFFT + linear regression).
- It needs SwiftF0 confidence as a voicing gate; main-thread
  is the only place that has both signals already merged
  (`latestPitchRef.current` in useAudioPipeline.js). A new worker
  would re-introduce the cross-worker timing problem PR #75
  spent effort eliminating.
- A new worker would also need its own audio routing (broadcast
  port from capture-source), increasing pipeline complexity.

### 2.2 What dsp-worker.js needs

New per-frame fields on the analysis message:
- `cpp` — the per-frame CPP in dB, or null if the frame is
  unvoiced or failed (e.g., flat spectrum).

(The existing `spectralTilt` and `hnr` fields stay during the
PR; alpha-ratio computation goes away in §7.)

New module-scope state:
- `_cepRe`, `_cepIm` — Float64Array(2048) buffers for cepstrum
  computation. Separate from the tilt buffers because the
  tilt computation runs in the same `if (analysisCount % 6 === 0)`
  block — overlapping buffer reuse is a footgun.
- `_cepLogMag` — Float64Array(1024) for the half-spectrum log
  magnitude (we only need positive frequencies for the cepstrum;
  the negative-frequency mirror is implicit).

New function:
- `computeCPP(buffer, sampleRate)` — symmetric with
  `computeSpectralTilt` and `computeHNR`. Pre-emphasis, Hann window,
  FFT, log magnitude, IFFT, peak search, regression, CPP.

### 2.3 What the main thread needs

In [useAudioPipeline.js](src/audio/useAudioPipeline.js):

- `cppFrameRef` — ring buffer of `{ time, cpp, voiced }` entries
  for the most recent ≥1 s of audio.
- `aggregatedCppRef` — most recently computed CPP-aggregate value
  + the timestamp it was computed at + the number of voiced
  frames included.
- New aggregation pass triggered on each DSP analysis emission:
  - Push `{time, cpp, voiced: hasPitch && confidence > threshold}` into ring.
  - Trim entries older than 1 s (or 2 s with the 50% history padding
    for a sliding-window mean — see §3 for tradeoffs).
  - If voiced-frame count in the ring ≥ MIN_VOICED_FRAMES (~6 frames
    = 900 ms of voiced audio at the 6th-frame cadence), compute
    aggregate.
  - Update `aggregatedCppRef` and the throttled state.

The voicing gate uses **the same SwiftF0 confidence ≥ 0.5 condition**
as the silence gate (consistency with the rest of the pipeline,
single source of truth for voicing).

### 2.4 What changes in the analysis-message protocol

```diff
 self.postMessage({
   type: "analysis",
   data: {
     pitch: null,
-    intensity, formants, spectralTilt, hnr,
+    intensity, formants, hnr, cpp,
     absoluteTime: ...
   }
 });
```

The wire-protocol change is small. `spectralTilt` removal is the
substantive bit; `cpp` addition is one new field.

The corresponding handler in
[useAudioPipeline.js:705](src/audio/useAudioPipeline.js#L705) needs
the destructured field swap, plus the new aggregation logic before
`throttledSetState`.

---

## 3. Aggregation infrastructure

This is the substantive new design surface. The existing pipeline has
zero windowed-aggregate metrics — every emission is per-frame.

### 3.1 What the literature requires

From the Stage L1 review:
- LTAS-style aggregation across ≥ 1 s of voiced speech to wash
  out per-vowel CPP variance.
- Voicing gate to exclude silence and fricatives (CPP undefined
  on aperiodic content).
- Mean (or trimmed mean) across the included frames.

### 3.2 What "≥ 1 s of voiced speech" means operationally

The ambiguity the user flagged: does the buffer reset on unvoiced
regions, or accumulate across them with unvoiced frames excluded?

Three options:

#### Option A — Hard reset on silence
Buffer accumulates voiced frames until silence > X ms is detected;
on silence, drop the buffer and start fresh after voicing resumes.

Pros: aggregate always represents one continuous utterance.
Cons: very sensitive to inter-phoneme silences. A 200 ms pause for
a stop consonant resets the buffer, and the user sees "still
accumulating" until 1 s of speech accumulates again. In practice
the gauge would update only during long sustained utterances.

#### Option B — Time-window with voiced-only accumulation
Buffer holds the last N seconds of audio. On each emission, drop
entries older than N. CPP is averaged over voiced entries only;
unvoiced entries are kept for the time-window-trim logic but
excluded from the mean.

Pros: gauge updates continuously regardless of speech rhythm.
Tracks recent-history average smoothly across phrasing.
Cons: aggregate spans phonatory transitions if the user actually
modulates voice quality across a sentence. Trade-off between
responsiveness (small N) and stability (large N).

#### Option C — Voiced-frame count with elastic time
Buffer holds the last K voiced frames (e.g., K=12 ≈ 1.8 s of
voiced audio at the 150 ms emission cadence). Time-stamp the
entries but trim by frame count, not by time.

Pros: aggregate always reflects 1.8 s of *actual voiced phonation*,
regardless of how spread out across wall-clock time.
Cons: aggregate can span a multi-minute pause if K voiced frames
took that long. A 10-s pause followed by 1.8 s of speech would
produce an aggregate that mixes pre-pause and post-pause voice
qualities.

### 3.3 Recommendation

**Hybrid of A and B**: time-window of 1 s, voiced-only accumulation,
with a hard reset rule when the unvoiced gap exceeds 2 s.

```
on each emission:
  push frame into ring
  trim ring entries older than 1 s
  if oldest voiced entry in ring is older than 3 s
     OR most recent unvoiced gap > 2 s:
    reset aggregate, mark "warming up"
  if voiced-frame-count in ring >= 6:
    compute mean(cpp values from voiced frames)
    update aggregate
```

This keeps the gauge updating across natural phrasing while
preventing stale aggregates from spanning long pauses.
**The 2 s hard reset is the same threshold the gender-worker
uses for its EMA reset** — consistency with existing pipeline
behaviour.

### 3.4 Buffering overhead

At 6.7 Hz emission cadence (every 150 ms), a 1 s ring is ~7 entries.
Each entry: `{time: ms, cpp: f64, voiced: bool}`. Negligible memory.

### 3.5 Edge cases and gotchas

1. **No voiced frames in window.** Aggregate is null;
   gauge displays "—" or "warming up" indicator.
2. **Voicing gate flapping.** Confidence near 0.5 will cause the
   gate to oscillate, leading to inconsistent voiced-frame counts.
   The existing 5-frame `SILENCE_DEBOUNCE_FRAMES` smoothing
   inherits cleanly here — use the *debounced* voicing state
   (`dspGateRef.current.voiced` post-debounce) rather than the
   raw confidence threshold.
3. **CPP-itself-is-null frames.** When `computeCPP` returns null
   (flat spectrum, computation failure), exclude from aggregate
   regardless of voicing state.
4. **Hop-cadence drift.** The 150 ms cadence (`analysisCount % 6`)
   actually depends on chunk arrival; if chunks are bursty, the
   aggregation window can have non-uniform sample density.
   Practical impact small but worth noting in the Stage B impl.

---

## 4. Display cadence + UI surface

### 4.1 The fundamental shift

Current behavior: gauge updates per analysis emission (~6.7 Hz).
The CSS transition smooths the marker over 100 ms, but the
underlying value flips every 150 ms.

Proposed behavior: gauge value updates ~once per second (when a new
1-s aggregate is computed). Between aggregate updates, the gauge
sits still.

**This is a UX commitment as much as a technical one.** Users who
rely on per-frame feedback for "is the meter responsive to my
voice" will perceive the new gauge as slower. The trade-off is the
new gauge actually *means something*.

### 4.2 Recommended approach

**Aggregate computed every 250 ms with a 1 s rolling window.**

That's a 75 % overlap between consecutive aggregates, so the gauge
updates 4× per second but each value reflects a 1-s average. The
UX feels alive while the underlying signal is genuinely smoothed.

Implementation: the aggregation pass in §3 fires on every DSP
emission (~6.7 Hz) but only updates the gauge state every 250 ms
via a separate throttle (similar to the existing `STATE_UPDATE_INTERVAL`
in useAudioPipeline.js).

### 4.3 "Warming up" state

When the buffer doesn't yet have ≥ 1 s of voiced speech (first ~1 s
of an utterance, post-pause), the gauge should show:
- A "warming up" indicator (text or visual cue).
- The marker is hidden or shown at gauge-center with low opacity.
- The numeric readout is `—` or text like "listening...".

This is an existing pattern in Syrinx (the Resonance Meter shows
"warming up" while the gender model collects its first inferences).
Consistency wins; reuse the same visual idiom.

### 4.4 "Last reading is X seconds old" state

When voicing has stopped (e.g., user paused > 1 s), the existing
hold-then-clear pattern applies:
- 0-1 s after voicing stop: aggregate continues to show as last-known.
- 1-2 s: indicator dims (e.g., the existing `holding` opacity
  treatment in `SpectralTiltGauge.jsx`).
- ≥ 2 s unvoiced: aggregate cleared, "warming up" returns.

This matches the existing silence-hold UX in
[useAudioPipeline.js:781-806](src/audio/useAudioPipeline.js#L781-L806)
but at a slightly longer scale (since the underlying metric needs
more voiced speech to recover).

### 4.5 Numeric display

The current readout shows `${value.toFixed(1)} dB`. Recommendation
for CPP: same format, but the dB units are now meaningful (peak-to-
baseline ratio) and the directional meaning has flipped:

- **Higher CPP = lighter voice** (Aaen 2025; matches trans pedagogy).
- The existing gauge labels "Lighter" (left) ← → "Heavier" (right)
  need to flip, OR the value-to-position mapping flips.

Cleaner: **flip the value-to-position mapping** so the gauge labels
stay consistent ("Lighter" still on the left, but now LEFT
corresponds to high CPP). This avoids breaking users' learned
left-to-right mental model. Spec the mapping explicitly in the
gauge component to avoid silent inversions.

### 4.6 Honest framing

Per the literature review, "vocal weight" is a perceptual construct
without an absolute acoustic correlate. The gauge label and tooltip
should reflect this:

- Gauge title: "Vocal weight" (unchanged — users know this term).
- Subtitle / tooltip: "Estimated from cepstral peak prominence
  (CPP), a correlate of phonatory density."
- Optional: a "?" info icon that links to a one-paragraph explainer
  explaining the construct vs the measure.

This is honest framing without burying the construct.

---

## 5. Reference ranges

### 5.1 The calibration honesty problem

Clinical CPP/CPPS literature typically reports values in the
10-30 dB range, but those are studio-mic + sustained-vowel + a
specific algorithm (Praat-Maryn or Hillenbrand). Consumer-mic +
running-speech + Syrinx's algorithm will produce a different
empirical range.

We have no public reference for "what CPP do typical users on
consumer microphones produce in running speech" — neither for cis
populations nor for trans populations across training stages.

### 5.2 Recommendation: per-user baseline

Ship with **no fixed gauge min/max**. Instead, compute the user's
baseline from the first ~30 s of voiced speech in their session,
then map the gauge to ±1.5 σ around that baseline.

```
session start:
  collect first 30 s of voiced CPP frames
  compute mean μ and std σ
  set gauge: low=μ-2σ, high=μ+2σ, "lighter" target band = μ+0.5σ to μ+2σ
```

This sidesteps the population-reference question entirely. The
gauge becomes "are you lighter or heavier than your own usual
voice" rather than "are you lighter or heavier than a population
median."

### 5.3 Trade-offs of per-user baseline

Pros:
- Honest about the calibration gap.
- Useful from session 1 (no need to record-and-train against
  external anchors).
- Robust to mic differences across users.
- Aligns with the literature review's "subjective-rating
  calibration is needed regardless" finding.

Cons:
- The user can't transfer learning across devices unless the
  baseline migrates (which it should — store baseline in IndexedDB
  alongside settings).
- A user who starts the session in a "heavier" voice and modulates
  toward "lighter" will see their baseline shift toward heavier
  than truly representative.
- Cross-session comparisons get subtle (if baseline updates
  per session, "I'm hitting +1σ this session" is hard to compare
  across days).

**Mitigation:** per-user baseline with a clearly-marked "reset
baseline" UI affordance, plus display of the absolute CPP value
underneath the gauge for users who want to compare across sessions.

### 5.4 Alternative: deferred fixed range with empirical anchor

Run a measurement pass on the Hillenbrand corpus + some Syrinx
test-pipeline real-mic captures, derive an empirical "consumer
mic, running speech" CPP distribution, and ship a fixed range
based on that.

This is more work for a less-honest result (population reference
that doesn't generalize across mic types). **Don't recommend.**

### 5.5 Constants we'll need

Replacing [constants.js:23-26](src/utils/constants.js#L23-L26):

```js
// Removed:
//   SPECTRAL_TILT_RANGE = { min: -5, max: 25 };
//   SPECTRAL_TILT_TARGET = { low: -2, high: 8 };

// Added:
export const VOCAL_WEIGHT_BASELINE_SECONDS = 30; // initial calibration
export const VOCAL_WEIGHT_BASELINE_SIGMA = 2;     // ±2σ gauge range
export const VOCAL_WEIGHT_LIGHT_THRESHOLD_SIGMA = 0.5; // target band start
export const VOCAL_WEIGHT_AGGREGATE_SECONDS = 1.0;
export const VOCAL_WEIGHT_HARD_RESET_SECONDS = 2.0;
export const VOCAL_WEIGHT_MIN_VOICED_FRAMES = 6;
```

---

## 6. Alpha-ratio code disposition

### 6.1 Current footprint

`computeSpectralTilt` is called once per analysis frame ([dsp-worker.js:124](src/dsp/dsp-worker.js#L124))
and consumed by:
- `useAudioPipeline.js` — display state + session-frame callback
- `SpectralTiltGauge.jsx` — gauge display
- `CombinedDashboard.jsx:443` — `avgSpectralTilt` summary stat
- `SessionHistory.jsx:198-202` — past-session detail card display
- `db.js` schema — `spectralTilt` per-frame field, `avgSpectralTilt`
  per-session field

There are no other consumers. No exports to other code paths.

### 6.2 Recommendation: remove on the same PR

Remove `computeSpectralTilt`, the `spectralTilt` analysis-message
field, the per-frame database field, and the gauge wiring.

Reasoning (matches user's read):
- It's not a measure anyone independently uses; it was the gauge's
  computation. Without the gauge, no consumer.
- Keeping it as an "internal signal" or "secondary feature" creates
  surface for no demand.
- If a future feature (e.g., a brightness sub-meter, a session
  insights panel) wants alpha ratio specifically, a fresh
  implementation under a clear name is cleaner than a hangover from
  the old vocal-weight code.

### 6.3 Backwards-compat / schema migration

Past saved sessions in IndexedDB have:
- `frames.spectralTilt` per-frame
- `sessions.avgSpectralTilt` per-session

These exist on real users' devices (if any). The PR needs a
migration plan. Two options:

#### Option A — keep schema fields, stop populating them
Frames after the PR have `spectralTilt: null`. Old frames retain
their values. SessionHistory's "Avg Spectral Tilt" row continues
to display for old sessions, hides for new ones (the existing
`!= null` guard handles this).

Pros: No destructive migration. Old sessions remain readable.
Cons: Schema carries dead fields forever.

#### Option B — Dexie version bump, drop the fields
Increment `db.version(2)` with a migration that strips
`spectralTilt`/`avgSpectralTilt` from existing rows.

Pros: Clean schema.
Cons: Dexie version migrations are easy to break; old session
data is partially lost (the alpha-ratio history isn't useful
anyway, but it's user-visible data).

#### Option C — keep alpha-ratio fields, add CPPS fields alongside
Frames get both `spectralTilt` (kept) and `cpp` (new); sessions get
both `avgSpectralTilt` and `avgCpp`.

Pros: Past sessions remain comparable to themselves;
forwards-compatible with a future "show both" feature.
Cons: Database surface grows; users see a redundant "Spectral
tilt" stat for new sessions.

**Recommendation: Option A.** Stop populating; keep the schema
fields for old-session readability. The fields are nullable
already, so post-PR sessions just have `null` there. `SessionHistory`
already guards against null with `session.avgSpectralTilt != null`.

The comment in `db.js:18-23` should be updated to mark the field
as legacy.

### 6.4 What to rename

If we keep the existing UI variable name `spectralTilt` everywhere
in the React tree (state, props, etc.) and just have it carry
the new CPP-aggregate value, that's silent corruption. **Rename
explicitly.** Suggested:

- DSP worker emission: `cpp` (new field, replacing `spectralTilt`).
- Main thread aggregation result: `vocalWeight` (semantic name for
  the displayed value, not the underlying measure).
- React state, props, ref names: `vocalWeight` everywhere.

In the database, we add a new field `vocalWeight` (the aggregate)
and either also `cpp` (per-frame, for future feature use) or just
drop the per-frame value.

---

## 7. Architecture doc fix (in scope for the PR)

The doc inversion in ARCHITECTURE.md line 957 ("More negative
(heavier) | Less negative (lighter)") was a documentation bug for
the alpha-ratio metric. It needs replacement, not correction:

- Remove the spectral-tilt-perceptual-direction row in the metrics
  table.
- Add a "Vocal weight" row describing the new measure: "CPP-based
  correlate of phonatory density. Higher = lighter (less heavy)."
- Update the description in line 5/33/45 about "vocal weight"
  computation to reference CPP rather than spectral tilt.
- Update the metric table at line 956 to flag vocal weight as a
  correlate, not an absolute measurement.

This is a doc-only change but should be in the same PR as the
metric replacement.

---

## 8. Validation surface

The user explicitly flagged this section as deserving attention.
Currently we have NO calibration test for the existing alpha-ratio.
Whatever ships for CPPS is the project's first validated voice-
weight measure.

### 8.1 Layer 1 — synthetic unit tests (high value, high feasibility)

Pattern: model after [tests/dsp/formant-debug.js](tests/dsp/formant-debug.js)
which generates synthetic vowels with known acoustic properties and
asserts formant extraction recovers them.

For CPP, the synthetic-signal approach is:

| Test signal | Expected CPP behavior |
|---|---|
| Pure pulse train at F0=120 Hz, no noise | High CPP (~25-30 dB) — clean periodicity |
| Pulse train + 0 dB SNR white noise | Moderate CPP (~10-15 dB) |
| Pulse train + -10 dB SNR white noise | Low CPP (~3-8 dB) |
| Pure noise (no fundamental) | Very low / null CPP |
| Pulse train + spectral tilt + cascaded resonances (synthetic vowel) | CPP comparable to clean pulse train (formants don't strongly affect CPP) |
| Sustained vowel at F0=80 vs F0=240 Hz | Comparable CPP (within ~3 dB) — F0-independence sanity |
| Modal vs breathy synthesized phonation | Modal CPP > breathy CPP (~5-10 dB difference) |

These can all be automated. A `tests/dsp/cpp-test.js` mirroring
formant-debug.js's pattern is feasible. Pass criteria are quantified
("clean pulse train should produce CPP > 20 dB"); the test exits
non-zero if any case fails.

The synthetic breathy-vs-modal test is particularly valuable
because it exercises the directional claim ("higher CPP = lighter").
Without it we're trusting the algorithm direction matches Aaen
without empirical confirmation in our pipeline.

### 8.2 Layer 2 — corpus regression (medium feasibility)

The Hillenbrand corpus + (optionally) Vocadito provide real-speech
samples with documented characteristics. Existing infrastructure
([tests/dsp/data/](tests/dsp/data/), `pitch-bucket-harness.js`)
can be adapted:

- For each Hillenbrand sample, compute CPP-aggregate over the
  central 70% of the recording (matching the pitch-bucket
  methodology).
- Report distribution stats (mean, median, p25/p75) split by
  M/F. Critical: M and F distributions should be **comparable
  in width** — CPPS shouldn't be a covert F0/gender proxy.
- For Vocadito (singing, 40 tracks), expect higher mean CPP than
  Hillenbrand (sustained singing has more periodicity than
  conversational speech).

The harness measures distribution, not accuracy — there's no
ground-truth "vocal weight" label per recording. So this layer is
sanity check + regression guard, not validation.

### 8.3 Layer 3 — user-side real-mic verification (non-automatable)

The literature is clear: perceived vocal weight is partially
subjective. The only way to know "does this gauge correlate with my
perceived weight" is to:

1. Record a user (yourself, the dev) deliberately producing
   "lighter" vs "heavier" voice on the same vowel/sentence.
2. Inspect the gauge readings during each.
3. Compare to your own perception.

This is non-automatable. Recommend the user-facing measurement as a
**deliberate session entry in the project log** (e.g., a measurement
file in `measurements/vocal-weight-real-mic-spotcheck-<date>.md`)
that documents:
- Captured audio not committed (privacy).
- Subjective labels per phrase.
- Gauge readings observed.
- Direction match / mismatch noted.

This isn't a regression test; it's "before-shipping confirmation
that we got the direction right." A single 5-minute capture session
suffices for first ship; subsequent regressions can ride on Layer 1.

### 8.4 What we DON'T need (yet)

- A perceptual-rating study with multiple raters. That's the
  literature review's Stage 3 (subjective calibration
  infrastructure) — explicitly deferred per the user's scope.
- A cross-device calibration suite. Single-device dev validation
  is enough for first ship.
- A continuous-time-segmentation accuracy measure. The aggregate
  is a single number per ~1 s; there's no "frame-level accuracy"
  to validate.

---

## 9. Risks specific to CPPS replacement

### 9.1 First-time users see the gauge update once per second

Currently the gauge moves continuously (every 150 ms). Users
unfamiliar with the change may perceive the slower update as
"broken" or "stuck."

**Mitigation:** the 250 ms aggregate-emit cadence + 75 % rolling
overlap (§4.2) keeps the gauge feeling alive. The "warming up"
indicator handles the actual zero-update period (first 1 s of any
utterance).

**Risk if not mitigated:** users churn before the metric proves
useful.

### 9.2 Users with intuition against the broken metric see new readings

Some users have built mental models against the alpha-ratio gauge
("when this gauge reads 5 dB I sound feminine to me"). The new
gauge will show different absolute numbers in the same situations.

**Mitigation:** the gauge title remains "Vocal weight" but the
displayed scale changes from "raw dB" to "σ around your baseline,"
and the tooltip explicitly notes the underlying measure changed.
Migration notes in the release / commit message.

**Risk if not mitigated:** transient user confusion. Bounded — the
new gauge will become useful within one or two sessions of use.

### 9.3 Per-user baseline doesn't generalize to "novice → trained" arc

A user starting at heavy phonation, who trains over months toward
lighter phonation, will see their baseline gradually shift heavier
as the training data accumulates. The "+1σ above baseline" target
becomes a moving goalpost.

**Mitigation:** baseline is computed from the first 30 s of *each
session*, not cumulatively. So a session-2 user with a now-lighter
modal voice has their baseline at the lighter modal voice;
"lighter than baseline" still corresponds to "lighter than my
current usual voice."

**Risk if not mitigated:** the gauge converges to "stays at 0σ"
over time. Architectural choice with the per-session reset
sidesteps this.

### 9.4 SwiftF0 confidence as voicing gate is brittle for fricatives

The voicing gate inherits from the SwiftF0 confidence ≥ 0.5
threshold. Voiced fricatives (/v/, /z/) often produce low
confidence; the existing gate tolerates this because the silence
debounce smooths over short low-confidence frames.

**Mitigation:** use the debounced `dspGateRef.voiced` rather than
raw confidence (§3.5). Same as the rest of the pipeline.

**Risk if not mitigated:** the aggregate would systematically miss
parts of speech that ARE voiced but ARE NOT clearly periodic.
Would slightly bias the aggregate toward strongly-voiced content
(modal sustained vowels) — which is actually fine for vocal-weight
estimation, where strongly voiced content IS the signal.

### 9.5 CPP failure modes specific to consumer mics

Consumer microphone behaviors that could destabilize CPP:
- AGC (automatic gain control) — fluctuating signal levels
  shouldn't affect CPP (it's a peak-to-baseline ratio in dB,
  scale-invariant) but extreme AGC compression flattens spectral
  features.
- Noise suppression / echo cancellation — non-linear processing
  that may degrade harmonic structure.
- Sample rate downsampling (mobile silently downsamples to
  16 kHz on some platforms) — affects the FFT bin grid but
  Hillenbrand 1994 actually used 22.05 kHz, so 16 kHz isn't
  catastrophic.
- Fan / mechanical hum — already a known issue ([CLAUDE.md "Pitch
  detection of periodic non-speech content"](CLAUDE.md)). Fan
  hum is periodic; CPP would happily report it as a strong peak.
  The voicing gate (SwiftF0 confidence) is the only mitigation.

**Mitigation:** Layer 3 user-side spotcheck includes "test under
fan noise" as a gauge-direction sanity check.

**Risk if not mitigated:** the gauge could report stable
"high CPP, lighter voice" during silence with mechanical hum.
Same root issue as the existing fan-hum-pitch-detection
limitation; fixing requires VAD beyond confidence threshold,
which is out of scope.

### 9.6 Algorithm-parameter drift between Syrinx and clinical literature

The audit assumes the Syrinx CPPS won't match clinical-literature
CPPS values numerically (different windows, different
pre-emphasis, no Praat-comparison validation). If a user reads a
clinical paper saying "healthy adults have CPPS of ~14 dB on /a/"
and Syrinx shows them 22 dB, this is potentially confusing.

**Mitigation:** Documentation explicitly notes Syrinx CPPS is
algorithm-specific and not directly comparable to clinical values.
The gauge displays σ-around-baseline rather than raw CPP exactly to
avoid this trap.

**Risk if not mitigated:** users may misinterpret the gauge against
external references. Manageable with clear in-app text.

---

## 10. Open questions / what needs measurement before ship

These need a Stage B measurement pass to resolve. Enumerated only;
this audit doesn't propose them.

1. **What CPP value do typical voiced phonemes produce on
   consumer mics in the Syrinx pipeline?** Determines whether the
   ±2σ baseline range is reasonable (vs e.g. ±1σ being too tight
   or ±3σ too loose).

2. **Is the 1 s aggregation window sufficient to remove vowel-
   modulated variance in CPP?** The literature reasoning says yes
   for LTAS-aggregation but Syrinx-specific empirical confirmation
   is needed.

3. **What's the practical range of CPP differences between user-
   labeled "lighter" and "heavier" phonation in the dev's voice?**
   Layer 3 spotcheck answers this; needs to be > σ (otherwise the
   gauge is pure noise) and ideally > 1σ (so the directional
   feedback is unambiguous).

4. **Does CPP track the same direction as user perception across
   trans voice training contexts (transmasculine, transfeminine,
   non-binary modulation)?** The literature is mostly
   transfeminine-direction-validated. Single-dev spotcheck only
   covers one direction; broader validation is deferred.

5. **What is the SPL confound's practical magnitude for Syrinx
   use?** Brockmann-Bauser shows it exists; the Syrinx-specific
   question is whether typical-use SPL variation generates trend-
   direction noise that masks weight modulation. Could be addressed
   by an SPL-controlled spotcheck (record at constant subjective
   loudness, modulate weight).

6. **Should CPPS smoothing (the canonical Maryn-Weenink
   quefrency+time smoothing) be added in a follow-up?** First-ship
   is CPP-with-aggregation; canonical CPPS adds compute and
   complexity. Empirical decision: if first-ship CPP-aggregate is
   already stable and directionally correct, defer; otherwise
   evaluate adding smoothing.

7. **Storage policy for the user's per-session baseline.** Stored
   in Dexie? In-memory only? Reset between sessions or persist?
   UX decision deferred to Stage B.

---

## 11. Implementation cost estimate

Rough effort sizing for Stage B:

| Component | Estimate |
|---|---|
| `computeCPP` in dsp-worker.js (FFT reuse, IFFT, regression, peak search) | ~half day |
| Aggregation + voicing gate + hard-reset logic in useAudioPipeline.js | ~half day |
| Per-user baseline computation + storage | ~half day |
| UI (gauge rename, label flip, warming-up state, tooltip) | ~half day |
| Database schema migration (Option A: keep alpha-ratio fields) | ~quarter day |
| Layer 1 synthetic unit tests | ~half day |
| Layer 2 Hillenbrand corpus regression | ~half day |
| Layer 3 real-mic spotcheck + measurement document | ~quarter day |
| Architecture doc updates | ~quarter day |
| Total | **~3-4 days of focused work** |

Multi-day is consistent with formant work. Comparable to the
SwiftF0 cutover scope (which was ~2 weeks calendar but tight focus
for the implementation itself).

---

## 12. Recommended decision points

Before Stage B implementation begins, the user should explicitly
decide:

1. **Algorithm tier**: Hillenbrand-style real-cepstrum CPP (recommended)
   vs Praat-compatible PowerCepstrogram CPPS (more clinical
   transferability, more parameter-tuning work).

2. **Aggregation strategy**: Hybrid time-window + hard-reset
   (recommended) vs pure voiced-frame count (simpler).

3. **Reference-range strategy**: per-user baseline (recommended) vs
   fixed empirical range from a corpus measurement pass.

4. **Schema migration**: keep alpha-ratio DB fields for legacy
   sessions (recommended) vs drop them via Dexie version bump.

5. **Naming**: gauge title stays "Vocal weight" (recommended); the
   underlying measure documentation says "CPP-based correlate."

6. **Validation depth**: all three layers (recommended) vs Layer 1
   + Layer 3 only (skip corpus regression).

If decisions are confirmed, Stage B implementation starts with
`computeCPP` synthetic-test development (Layer 1 first), since the
synthetic tests pin the algorithm direction and unit-correctness
before any production-pipeline integration.
