# Pitch display gate redesign: register re-acquisition + stale-readout fix — 2026-10-03

**Shipped:** register re-acquisition paint gate
([src/audio/pitchPaintGate.js](../src/audio/pitchPaintGate.js): held values pushed
`{ fresh: false }` never feed the gate; `REACQUIRE_GAP_FRAMES` 2 /
`REACQUIRE_SUSTAIN` 4 / `REACQUIRE_WINDOW` 8; `EXCURSION_SUSTAIN` 16 → 8;
`lastReason()`), [src/audio/useAudioPipeline.js](../src/audio/useAudioPipeline.js)
(fresh flag, octave-class line break entry in `pitchTraceRef`,
`heldReadoutStaleRef` readout fix, `painted` flag in the frame callback),
[src/components/CombinedDashboard.jsx](../src/components/CombinedDashboard.jsx)
(stores `painted`), [src/components/SessionHistory.jsx](../src/components/SessionHistory.jsx)
(draws painted frames with the same octave break). Guards:
[tests/audio/pitch-paint-gate-test.js](../tests/audio/pitch-paint-gate-test.js) (36 cases);
`scripts/paint-gate-glide-validate.js`'s harmonic-lock expectation updated to the
new contract (locks shorter than `EXCURSION_SUSTAIN` never paint; see Limitations).

One of five measured workstreams from the 2026-10-03 half-pitch investigation,
integrated last, in this order:
[pitch-globalpeak-transient-2026-10-03.md](pitch-globalpeak-transient-2026-10-03.md) →
[pitch-octave-arbitration-2026-10-03.md](pitch-octave-arbitration-2026-10-03.md) →
[pitch-ceiling-2026-10-03.md](pitch-ceiling-2026-10-03.md) →
[noise-notch-voice-safety-2026-10-03.md](noise-notch-voice-safety-2026-10-03.md) →
this file. Measured against the then-production worker (origin/main at f92b11a) and two
*provisional* improved detectors (phase-1 SHR rules `shr12p05` / `shr12p10`). The detector
octave fix that actually shipped is the odd/even prominence arbitration (sibling file
above), not these SHR rules; the gate ranking was identical across all three detectors
tested, and the combined chain is re-validated as a whole after integration. The code
committed here is byte-identical to the measured proposal (`proposed/` in the scratch dir).

## Motivation

The user reports that the pitch trace sometimes shows **half** the actual
pitch. The tool's users train register switches between words — e.g. a low
or "safety" voice and a raised target voice an octave apart, often with
breathy phonation. Phase 1 of the 2026-10-03 investigation split the
complaint into a detector part (octave-down on breathy target voice, handled
by a sibling workstream) and a **display-chain part on the main thread**,
which this document addresses:

1. `pitchPaintGate.js` anchors its established level on whichever register
   painted first and keeps it across every gap (only the 5 s quiet `reset()`
   clears it, and that never fires when room noise sits above −50 dB). A
   target-voice word after a low-voice word is off-level and needs 16
   consecutive consistent frames (400 ms) to be accepted, and the counter
   restarts at every word gap, so much of the target voice is displayed
   blank.
2. The 400 ms pitch hold (`PITCH_HOLD_MAX_MS`) pushes **held** values into the
   gate as if they were fresh, so a stale low-voice value keeps the low level
   alive across consonants.
3. While the gate suppresses a fresh off-level value, the readout and note
   name fall back to the last **painted** value — on a low→target switch
   that is the low register, i.e. the readout shows ~half the pitch. It is
   the most visible form of the "half pitch" report.

(Phase 1 and this pass quantified these on the private session recordings;
results kept outside this repository.)

The redesign must make register switches paint promptly and stop the
stale-readout behaviour **without bringing back the octave-spike lines** the
gate was built to remove (the 2026-06-10 excursion break, a private
measurement kept outside this repo;
[pitch-spike-flicker-2026-06-10.md](pitch-spike-flicker-2026-06-10.md),
[paint-gate-glide-window-2026-07-19.md](paint-gate-glide-window-2026-07-19.md)),
and it must be gender-symmetric: low-voice octave-up may not rise by more than
~0.3 pp anywhere.

## Harness

All scripts live in `build/measure-2026-10-03/display/` in the main checkout (scratch,
gitignored `build/`, not in the repo; phase-1 harnesses under
`build/investigate-2026-10-03/`). The committed guard is
`tests/audio/pitch-paint-gate-test.js`.

- **Worker series.** `build/investigate-2026-10-03/session-attribution/chain-harness.js`
  runs the full pitch worker (notch, Boersma-AC, L=2 tracker, ghost veto,
  harmonic guard) on the private session recordings (and on the guard
  corpora, synthetic audio and noise below) and stores, per 25 ms hop, the
  posted pitch and confidence, the DSP worker's 50 ms RMS intensity, and
  the top-15 candidate list.
  - Production detector: `session-attribution/runs/baseline/` (phase-1 run).
  - Provisional improved detectors **shr12p05** and **shr12p10** (SHR_hi
    arbitration, −12 dB threshold, penalty 0.05 / 0.10, phase-1 finding 1):
    regenerated into `runs/shr12p05`, `runs/shr12p10` through
    `det-variant.mjs`, a `--detector` shim that uses the phase-1 variant AC
    (`detector-vs-praat/acv.mjs`, bit-exact with production when given no
    options) together with the production path tracker and guard. Decoded
    series match the phase-1 `detector-vs-praat/out/*.shr12p0x.dec.f32` on
    99.996–100 % of frames (`cmp.py`). The no-option shim reproduces the
    production baseline run column for column (`runs/paritycheck`).
- **Main-thread replay.** `replay.mjs` mirrors `handleAnalysisResult` line by
  line for the pitch, readout and recording paths. It imports the real
  `pitchGate.js` (silence gate, 250 ms staleness, 400 ms hold),
  `pitchSmoothing.js` (median-3), `constants.js` (`SILENCE_HOLD_MS` 5 s) and
  `pitchUtils.js` (note names), and models `VOICED_FALL_FRAMES` hysteresis,
  the lastVoiced readout/note fallback in both branches, the 5 s quiet reset
  and the L=2 message lag (the message consumed at display hop k describes
  analysis frame k−2). The paint gate is pluggable: `variants.mjs`
  `createGateV()` is a parametric superset of `pitchPaintGate.js`.
- **Real-hook driver (parity oracle).** `realhook/` imports the **real**
  `src/audio/useAudioPipeline.js` in Node: module hooks map `react` to a
  one-render mock and resolve the hook's extensionless imports. It then
  calls the hook's own `handleAnalysisResult` frame by frame, setting
  `latestPitchRef` and recording `pitchTraceRef`, the throttled state (with
  `performance.now` advanced so no update is dropped) and the frame-callback
  payload.
- **Modes, references, metrics (session runs).** A user-only mode (hops
  not labelled as the user replaced by pitchless frames at the session's
  10th-percentile room-noise intensity) and a mix mode (the recording as
  is); consensus references across method families with the spectral
  odd-multiple arbiter, and strict R1 & CC as sensitivity; target band
  (160–400 Hz) and low band (75–160 Hz) displayed correct / half / blank,
  low-band octave-up, readout wrong / half / note-octave-low, ref-based
  spike events, reference-free connected painted pairs ≥ 9 / ≥ 12 st, and
  register-switch latency (`score.mjs`). Results on the private session recordings are kept outside this repository.
- **Synthetic drills.** (a) Frame-level (`drills.mjs`): safety↔target
  alternating words of 300/500/800 ms with 100/200/400/600 ms gaps (loud
  breath gaps and quiet gaps), clean and with an error model (30 % of target
  words start 2–6 frames at half pitch, plus 2–4-frame octave bursts);
  sirens; glides; 2–4-frame ×2/×3/×0.5 bursts; onset harmonic locks after a
  gap. (b) Audio-level (`synth_audio.mjs` → chain harness →
  `synth_eval.mjs`): a source-filter breathy voice with LF room rumble, so
  candidate structure and tracker onsets are real.
- **Guard corpora** (`corpus_build.mjs`, `corpus_eval.mjs`): each corpus ×
  gender is concatenated into one 16 kHz "session" (production streaming
  resampler, 1 s near-silent gaps) and run through the chain harness for
  all three detectors. The groups are PTDB-TUG m/f, FDA m/f, Hillenbrand
  m/f and vocadito. Alignment is chosen per group on production.
- **Noise-only** (`noise_build.mjs`, `noise_eval.mjs`): 60 s of each
  `scripts/noise-synth.js` class at −35 dBFS RMS, above the silence gate,
  i.e. the hard case.

## Baseline match

- **Replay = real hook, bit-exact.** `parity.mjs` drives the real
  `useAudioPipeline.js` and `replay()` on every frame of the private session recordings:
  painted value, readout Hz, note name, style (voiced/holding/inactive) and
  recorded f0. Result: **0 mismatches** on every frame for the
  production detector, for shr12p10, and in user-only mode
  (`PARITY OK`). The parametric gate `createGateV({})` also gives 0
  mismatches.
- **Replay vs chain-harness `paint` column:** painted differs only on a
  handful of hops, all exactly on the 400 ms hold boundary. chain-harness computes
  `now` as `(k+1)*400/16000*1000` without rounding, so a gap of exactly
  400 ms becomes 400.00000001 and the hold is refused there, while the real
  hook rounds `absoluteTime` and allows it. The replay follows the real
  hook.
- **Phase-1 numbers reproduced** on the private session recordings (kept outside this repository).

## Results on the private session recordings

The variant comparison (production gate, no gate, the recommended
re-acquisition design, reseed / evidence / sustain / display-hold
alternatives) was run on the private session recordings for the production
detector and two provisional SHR detectors, in user-only and mix mode,
under both reference conventions. In every session and convention the
recommended design raised target-voice displayed correct and cut the
target-voice blank and readout errors, while staying inside the ~0.3 pp
low-voice octave-up guard on every detector × convention cell; the best
gate did not change with the detector. Results on the private session recordings are kept outside this repository.

## Guard corpora (displayed trace; cor / blank / octave-up / octave-down %)

Production detector shown; shr12p05 and shr12p10 give the same picture
(`results_corpus_final.txt`).

| group | production | recommended |
|---|---|---|
| PTDB male 75–125 | 78.0 / 7.7 / 0.03 / 0.00 | 78.5 / 8.1 / 0.02 / 0.00 |
| PTDB male 125–160 | 84.0 / 6.5 / 0.00 / 0.18 | 84.9 / 5.5 / 0.00 / 0.18 |
| FDA male | 78.2 / 8.3 / 0.17 / 0.00 | 81.5 / 4.5 / 0.22 / 0.00 |
| Hillenbrand men | 58.8 / 8.3 / 0.00 / 0.00 | 59.6 / 7.2 / 0.09 / 0.01 |
| PTDB female | 91.2 / 3.1 / 0.15 / 0.02 | 91.6 / 2.4 / 0.15 / 0.15 |
| FDA female | 86.0 / 2.5 / 0.31 / 0.18 | 86.5 / 2.0 / 0.32 / 0.23 |
| Hillenbrand women | 62.4 / 5.6 / 0.00 / 0.12 | 62.4 / 5.6 / 0.00 / 0.27 |
| vocadito | 92.1 / 5.0 / 0.00 / 1.69 | 93.6 / 3.0 / 0.00 / 2.30 |

(Hillenbrand absolute correct is low because its reference is a single
steady F0 over the central 70 %. Only the deltas matter.) Male octave-up
moves by at most +0.09 pp and male correct rises everywhere. Female
correct rises; displayed half rises slightly, by up to +0.61 pp on
vocadito with the current detector and +0.21 pp with shr12p10, because
fewer of the detector's own octave-down frames are suppressed. On PTDB /
FDA, max(F_error, M_error) on the displayed trace goes from 22.0 % to
21.5 % (PTDB male < 125 is the worst cell in both).

## Synthetic drills

**Frame-level** (`results_drills_final.txt`, 100 trials). Examples:

- Alternating 500 ms words with 200 ms loud gaps, with the error model.
  Target-word correct 13.8 → 63.5 %, readout wrong 75.6 → 10.3 %, low-word
  correct 55.6 → 80.5 %.
- 800 ms words with 600 ms quiet gaps, with the error model. Target-word
  correct 30.7 → 71.6 %, readout wrong 31.3 → 4.5 %.
- 2–4-frame ×2 / ×3 / ×0.5 bursts in steady voice: 0 burst frames painted,
  identical to production.
- Post-gap 3-frame ×2 / ×3 onset lock: not painted, identical to
  production. Both reseed designs paint it on 11 % of frames.
- 6-frame onset lock: the recommended design paints its tail (up 11 % of
  frames). The reseed designs paint 22 % and then blank the true pitch.

**Audio-level** (`results_synth_final.txt`; breathy synthetic voice with LF
rumble). On the current detector:

| drill | production | recommended |
|---|---|---|
| alternating 300 ms words: target correct / readout wrong | 1.4 / 90.9 % | 54.6 / 23.2 % |
| alternating 500 ms words: target correct / readout wrong | 18.3 / 76.1 % | 60.1 / 26.5 % |
| alternating 800 ms words: target correct / readout wrong | 28.4 / 63.1 % | 57.0 / 24.3 % |
| target→low alternating (transmasculine direction): target / low correct | 44.4 / 24.3 % | 85.1 / 84.3 % |
| sirens (120–480 / 120–360 Hz): siren correct / readout wrong | 70.9 / 28.1 % | 75.6 / 12.9 % |
| 110→220 Hz glide then hold: held-note correct / never correct | 38.1 / 38 % | 45.5 / 6 % |

In every drill the connected octave-class strokes as rendered go to 0 (the
production gate shows 2.1/min on sirens and 5.3/min on glides). Target
half on the synthetic voice (~17 %) is detector-level: no gate gives
16–21 %.

## Noise-only (60 s per class at −35 dBFS, production detector)

Painted % of frames, production → recommended: pink 1.29 → 0.00, brown
2.58 → 0.00, sleep-noise 1.00 → 0.71, sleep-birdies 2.04 → 1.42,
resonant-noise 2.96 → 2.29, fan-hum 9.92 → 9.84 (notch warm-up within the
first 60 s), white / mains-complex / crickets / cicadas 0 → 0. The
recommended design paints no more noise than production in any class.
Because held values no longer extend the onset streak, noise blips stop
bridging into painted stretches.

## CPU

Paint gate alone: 1.79 µs/frame (current) vs 1.21 µs/frame (proposed),
measured over 633 k frames in Node (`bench.mjs`). The whole replayed
main-thread pitch chain takes 8.8 → 17.2 µs/frame, including replay
bookkeeping arrays. Both figures are four orders of magnitude below the
25 ms hop. The pitch worker is untouched.

## Session history / recorded f0

Recorded f0 bypasses the gate. It is keyed on `hasPitch` by design, so
session stats are "truthful per frame". Recorded f0 vs painted values were
compared on the private session recordings (`record.mjs`; results kept
outside this repository).

The recorded series is the better source for statistics: its time-in-target
is closer to the truth, and painted under-counts target time because
switches are blanked. It is the worse source for drawing: it keeps the
octave-class connected steps (the spike lines the live gate was built to
remove). **Recommendation: store a `painted` flag.** Add it to
the frame-callback payload and to the frame record. It is a non-indexed
Dexie field, so no schema bump is needed. `SessionHistory` draws its trace
from painted frames, with the same octave-class line break, so the history
matches what was shown live. Session stats keep using `voiced` / `f0`.
Legacy frames without the field draw as before. Included in the proposed
change.

> **Correction (2026-10-04):** "the history matches what was shown live" is
> not exact. History draws frames recorded `voiced` **and** `painted`; frames
> the live trace bridged with the 400 ms pitch hold are recorded
> `voiced: false` (on purpose — stats must not count stale pitch), so they draw
> as gaps in history although they were painted live (a sizeable share of
> live-painted hops on the private session recordings; counts kept outside
> this repository). What does match: octave excursions the live gate
> suppressed are gaps in history too, and the octave-class line break is the
> same. Recording the painted value of held frames (a separate field, so
> stats stay honest) would close it; not done.

## Chosen design and why

**Register re-acquisition gate, line break, and stale-readout fix**
(`gw_s4_w8 + lb + ro_dashOff_clr` in the scripts):

1. **Held values do not feed the gate.** `push(pitch, { fresh: false })`
   for hold-path values. They may still paint on-level once continuity is
   confirmed, so consonants are bridged as before, but they never enter the
   level ring or the counters, and they count as gap frames.
2. **Post-gap re-acquisition.** After ≥ 2 consecutive frames with no fresh
   pitch (`REACQUIRE_GAP_FRAMES`), an off-level run needs only **4**
   consistent frames (`REACQUIRE_SUSTAIN`, 100 ms) to be accepted. This
   applies during the first **8** painted frames of the new segment
   (`REACQUIRE_WINDOW`). The level itself is kept, so a 2–3-frame onset
   harmonic lock after a gap is still suppressed.
3. **`EXCURSION_SUSTAIN` 16 → 8** mid-segment. Within the re-acquisition
   design, 8 vs 16 changes low-voice octave-up and up-events negligibly on
   every detector × convention, and substantially reduces "switch never shown"
   (private session recordings).
4. **Octave-class line break.** Before a painted point ≥ `EXCURSION_SEMI`
   from the previous painted point, `pitchTraceRef` gets a gap entry, so
   the canvas never strokes a near-vertical connecting line. Connected
   ≥ 12 st pairs go to 0 by construction.
   No renderer change is needed.
5. **Readout never falls back to a stale value from the other register.**
   When the gate suppresses a fresh pitch for being off-level
   (`lastReason() === "offlevel"`), the held readout and note name are
   marked stale. They show "—" in the dim style, and stay stale through
   following hold and quiet frames until the next painted frame. On the
   private session recordings this cut readout wrong, readout half and
   note-name octave-low on target frames several-fold.

Why this point on the frontier: it has the lowest added low-voice
octave-up of the responsive designs, and it is the only one that stays
inside the ~0.3 pp guard on every detector × convention cell. It does not
paint post-gap onset locks shorter than 4 frames, unlike the reseed
designs. It needs no worker-protocol change, unlike evidence gating. It is
gender-symmetric by construction: target→low switches re-acquire exactly
like low→target, and the synthetic transmasculine-direction drill goes from
24 % to 84 % low-word correct. It gives up some target correct against
the most responsive alternatives (private session recordings).

Exact code: `proposed/src/audio/pitchPaintGate.js`,
`proposed/src/audio/useAudioPipeline.js`,
`proposed/tests/audio/pitch-paint-gate-test.js` (36 cases, all pass), plus
`proposed/src/components/{CombinedDashboard,SessionHistory}.jsx` for the
painted flag. Unified diff: `proposed.diff`. **Implementation parity:**
the proposed hook, driven through the real-hook driver, matches the replay
of `gw_s4_w8+lb+ro_dashOff_clr` with 0 mismatches. That covers painted,
line-break, readout, note, style, recorded f0 and painted flag, on every
session recording for both detectors and in user-only mode. So every number
in this document is the number the proposed code produces.

## Rejected options

- **Clear the level after N gap frames** (phase-1 "reseed2_holdgap", N=1–4,
  with or without hold-as-gap). It gives the most target correct, but it
  disengages the gate for the first ~8 frames of every segment, so
  connected ≥ 12 st pairs rise many-fold without a line break (private
  session recordings). Post-gap onset locks paint, and a ≥ 5-frame lock
  then anchors the young level and blanks the true pitch (synthetic
  6-frame lock: 26 % blank, 18 % painted wrong).
  Low-voice up fails the guard on the shr12p10 detector. Young-level
  override and `minRingAfterReseed` 1/3 did not fix this (`r2s8yo*`).
- **Clear after T ms without a fresh pitch** (100/150/250/400 ms):
  dominated by the frame-count reseed at equal spike cost.
- **`EXCURSION_SUSTAIN` alone** (12, 8): it cannot fix per-word
  re-anchoring, because the off-level counter restarts at every gap.
- **Level timeout by time since last painted** (250/400/1000 ms):
  dominated.
- **Evidence-based gating.** The worker would post octave-alternative
  margins (strength of the best candidate within ±1 st of p·{¼,⅓,½,2,3,4}
  minus the decoded candidate's strength). An off-level value is suppressed
  only while the level-octave alternative is within δ. The best setting,
  δ=0.02 with 3-frame confirm, keeps connected strokes low with good
  target correct, but it was rejected for three reasons:
  1. It is physically asymmetric. A genuinely high voice is also periodic
     at 2T, so on an upward switch the half-pitch candidate stays
     competitive. Synthetic target words after a low level reach 62 %,
     against 85 % for the recommended design.
  2. It depends on the detector's strength calibration, which the SHR
     penalty changes (low-voice up fails the guard on shr12p10 strict).
  3. It needs a pitch-worker protocol change.
- **Shorter display hold** (0 / 150 / 250 ms): 0 ms blanks much of the
  low voice; 150 / 250 ms barely change target correct.
- **Re-acquisition with S=3 or W=16** (`gw_s3_w8`, `gw_s3_w16`,
  `gw_s4_w16`): a little more target correct, but shr12p10 strict
  low-voice up reaches or exceeds the guard, and 3-frame onset locks paint
  at S=3. Arm-gap 1 / 3 / 4 frames: close to 2. Two frames is kept
  so that single dropped frames inside a word do not arm it.
- **Readout variants:**
  - "Dash on any suppressed fresh frame" has a similar wrong rate, but it
    blanks the 2 onset-confirm frames of every word, which flickers at the
    5 fps readout.
  - "Dash only on the current off-level frame", without keeping the stale
    flag through hold and quiet frames: a higher wrong rate.
  - Shortening the quiet-branch held readout (400 ms / 1 s): no measurable
    effect on any metric. The quiet-branch hold is left at 5 s.
  - The readout fix alone on the production gate (`prodV+ro_dashOff_clr`)
    already removes most readout errors. It is a safe standalone
    fallback if the gate change were deferred.

## Limitations / follow-ups

- Spike events against the reference (painted runs > 1.5× ref) rise on
  the private session recordings. These are painted wrong-octave segments,
  not connected lines, since the line break removes the strokes. Arbiter
  checks on these frames are ambiguous: a large fraction are
  consensus-reference octave disputes in the 140–200 Hz zone.
- `scripts/paint-gate-glide-validate.js`'s harmonic-lock check was written
  for `EXCURSION_SUSTAIN` 16. With 8 it reports locks of ≥ 8 frames
  painting their tail: 8 / 11 / 15-frame locks paint 1 / 4 / 8 frames. Per
  the 2026-06-10 lock-length data (private), a minority of locks
  paint a tail, as a separate segment. The corpus metrics above (and the
  private session metrics) include this, and it is not measurable against the sustain-16
  variant. The script's expectation is updated with this change: it now
  reports locks shorter than `EXCURSION_SUSTAIN` as "(ok)" only when nothing
  paints, and ≥ `EXCURSION_SUSTAIN` locks as an expected accepted tail.
- `scripts/pitch-accuracy-decompose.js` still does not model the hold
  (phase-1 note). The new `{ fresh }` argument is optional, and the old
  scripts call `push(sm)` and keep working.
- The register-switch latency rests on few L→T switch events. The medians
  are stable, but never-% moves in coarse steps.
- The evaluation detectors are provisional. Re-run `eval.mjs` with the
  final detector's run dir. The ranking was identical across all three
  detectors tested.

## Reproduction

Committed guards (run anywhere):

```
node tests/audio/pitch-paint-gate-test.js       # 36/36
node scripts/paint-gate-glide-validate.js --skip-session
```

Scratch harnesses (main checkout). The session steps — provisional-detector
worker series over the session recordings, `export_refs.py` /
`export_arb2.py`, the `parity.mjs` hook parity runs, `eval.mjs` / `tab.mjs`
and `record.mjs` — need the private session recordings and phase-1
references, which live outside the repo, and are omitted here:

```
cd build/measure-2026-10-03/display
node drills.mjs --variants=prod,noGate,gw_s4_w8+lb+ro_dashOff_clr --trials=100
node synth_audio.mjs   # then chain-harness --wav=synth/<name>.wav --name=<name> --out=runs_synth --tag=<det>
node synth_eval.mjs --dets=baseline,shr12p05,shr12p10 --variants=prod,noGate,gw_s4_w8+lb+ro_dashOff_clr
node corpus_build.mjs  # then chain-harness on corpus/<group>.wav -> runs_corpus/<det>
node corpus_eval.mjs --dets=baseline,shr12p05,shr12p10 --variants=prod,gw_s4_w8+lb+ro_dashOff_clr
node noise_build.mjs   # then chain-harness on noise/<class>.wav -> runs_noise/baseline
node noise_eval.mjs --variants=prod,gw_s4_w8+lb+ro_dashOff_clr
node bench.mjs
node proposed_run/tests/audio/pitch-paint-gate-test.js              # 36/36
```
Sweeps behind the variant choice: `results/sweep{1..4}_*.json`,
`results/readout_*.json` (variant table in `variants.mjs`).

## 2026-10-04 — level defined immediately after a re-acquisition accept

**Defect (review finding, confirmed by two independent verifiers).** An
accept reseeds the level ring with the accepted run: `ring = win.slice(-levelRingLen)`.
A re-acquisition accept has only `REACQUIRE_SUSTAIN` = 4 values, below
`MIN_RING_FOR_LEVEL` = 5, so `level()` returned null on the next frame. That
frame was therefore treated as on-level whatever its value, painted (onset
streak already ≥ 3), and pushed into the ring — an octave error landing right
after a register switch painted, and became part of the new level. Mid-segment
accepts (8 values) were not affected.

**Fix** ([src/audio/pitchPaintGate.js](../src/audio/pitchPaintGate.js)): after
any accept the ring is padded to `MIN_RING_FOR_LEVEL` with the accepted run's
median, so the level equals the accepted register from the next frame on. The
4-frame accept latency, the kept-level onset-lock protection and every
constant are unchanged. Guard:
[tests/audio/pitch-paint-gate-test.js](../tests/audio/pitch-paint-gate-test.js)
+5 cases (level defined right after the accept; ×½ and ×2 frames right after it
suppressed; on-level frame keeps painting; pad = median of a wobbly run). The
old gate fails 4 of them.

> **Correction (2026-10-04, review follow-up):** the guard is **7** cases, not
> 5 — the list above omits "accept paints on its last frame" and "×½ of a
> wobbly accepted run is suppressed". And the ×2 check was not "right after"
> the accept: it ran on the same gate after the ×½ check, i.e. on the second
> frame after the accept, when the ring was already refilled, so it passed on
> the old gate too. It now has its own fresh gate (established at 110 Hz, 2-frame
> gap, 4 × 225 Hz, then 450 Hz must not paint). The pre-36985d4 gate now fails
> **5 of the 7** (level defined; ×½ and ×2 right after the accept; pad = median;
> ×½ of the wobbly run); the fixed gate passes all 43 cases of the file.

**Measurement** — the committed session oracle
([scripts/session-oracle/](../scripts/session-oracle/README.md)), real workers
+ real hook, on the private session recordings, baseline = branch HEAD
6f8be18 src (`pg0`), fix = the same tree with only this file changed
(`pg1`). The worker columns are identical by construction (verified: every
detection column equal). Results on the private session recordings are kept outside this repository.

Corpora through the same chain (`corpus.mjs`): worker columns identical;
displayed correct identical on every male group (PTDB m 80.91, FDA m 83.20,
Hillenbrand men 63.57) and within ±0.02 pp on the female groups and vocadito;
male displayed ×2 octave-up identical (PTDB m 0.15, FDA m 0.04, Hil m 0.03).
`scripts/paint-gate-glide-validate.js --skip-session` output is byte-identical.

Reading: on the session recordings the accuracy metrics moved within
run-to-run cascade noise (a defined level changes the next decisions). The
clear effect is the one the defect predicts: octave-class painted steps —
each one a line break in the live trace — fall substantially, because the
frame after a re-acquisition can no longer paint an off-register value.
Every guard is unchanged or better.

Reproduce (worktree root; the session-oracle `run.mjs` / `analyze.py` steps
need the private session recordings, which are outside the repo):

```
mkdir -p build/trees/pg0 && git archive 6f8be18 src | tar -x -C build/trees/pg0
mkdir -p build/trees/pg1 && cp -r build/trees/pg0/src build/trees/pg1/ && cp src/audio/pitchPaintGate.js build/trees/pg1/src/audio/
# corpus.mjs --corpus=fda|ptdb|hil|voc per tree, then
node scripts/session-oracle/corpus.mjs --report=pg0,pg1
node tests/audio/pitch-paint-gate-test.js     # 43/43
```
