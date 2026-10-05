# Pitch display: faster target pickup after a register switch (2026-10-04)

> **Revised the same day after review (§10).** df497b9's median restart could paint a value no
> detector frame posted: the mean of two detections, on the 2nd frame after a held gap (a
> measurable share of painted hops on the session recordings). It could also paint a 1-frame
> outlier. The restart is now **conditional and seeded**. The numbers below are for the current
> code; the df497b9 numbers are in §3/§4/§7, kept as history, and compared side by side in §10.

**Shipped** (display chain only; the pitch worker is unchanged):

1. **Median restart on a register switch after a gap.**
   [src/audio/pitchSmoothing.js](../src/audio/pitchSmoothing.js) has `createSmoothingGapTracker()`
   (`SMOOTH_RESET_GAP_FRAMES` = 2, the same gap notion as `REACQUIRE_GAP_FRAMES`) and
   `smoothingBufferFor()`. When a fresh detection follows ≥ 2 frames without one **and** lies
   ≥ `SMOOTH_RESTART_SEMI` (9.5 st, = `EXCURSION_SEMI`) from the buffer median,
   [src/audio/useAudioPipeline.js](../src/audio/useAudioPipeline.js) restarts the median-3
   buffer as `[x1]`. The next medians are x1, median(x1, x1, x2) = x1, then median-3, so every
   painted value is a real detection. Before, the buffer survived every gap shorter than the
   400 ms pitch hold, so the first frames of a new-register word were medianed against the
   previous word. Any other post-gap value is still medianed against the previous word, so
   1-frame outliers stay hidden.
2. **Raw-agreement accept.** `push()` in [src/audio/pitchPaintGate.js](../src/audio/pitchPaintGate.js)
   takes the frame's unsmoothed fresh pitch (`{ raw }`). An off-level run is accepted only if
   that raw value is within `EXCURSION_SEMI` of the run's median. This keeps the post-gap
   onset-lock protection that change 1 would otherwise lose, and it also stops a lock that has
   already ended from being accepted on the median's one-frame tail.
3. **`EXCURSION_SUSTAIN` 8 → 7** (the mid-segment sustain). With change 2, a mid-word lock still
   has to last ≥ 8 raw frames before any of it paints, the same as before.

Unit tests: [tests/audio/pitch-paint-gate-test.js](../tests/audio/pitch-paint-gate-test.js), 43 → 112
cases. The `chain()` simulation drives the real `evaluateFrameGate`, so it includes held gaps.
The new cases add the review's held-gap invariants and a property test that every painted value
is a posted detection (§10.5). Harness:
[scripts/session-oracle/reacq/](../scripts/session-oracle/reacq/README.md).

**Verdict.** The display changes speed up target pickup after a register switch without new
error classes. Public evidence (§4, §10.4):

- frame-level drills through the real hook: alternating 300 ms words (clean) target 66.7 →
  75.0 %, low 84.9 → 88.5 % with ×2 up 1.8 → 0.0 %, latency to the first correct frame 100 →
  75 ms; the transmasculine direction (target first, error model) low 63.7 → 71.1 %;
- the audio-level synthetic breathy voice: alternating 300 ms target 55.3 → 59.8 %;
- corpora: male octave-up frames unchanged or lower; female octave-down ≤ +0.03 pp in the pooled
  groups. **Not** in the vocadito_34 canary: +0.96 pp (78 → 85 of 727 frames, from the raw check
  and ES 7, not the restart), with correct +1.65 pp and down-events falling;
- synthetic drills, held notes and noise-only painting: pass;
- painted values that are not a posted detection: 0, as in 5ebe609.

On the private session recordings (the primary oracle) target-voice displayed accuracy and the
low → target switch latency improved, the low-voice octave-up guard held, and real-session false
voicing was essentially flat (a small rise traces to hold-bridge churn, §10.4). Results on the private session recordings are kept outside this repository.

Two synthetic costs are documented in §5. The bigger levers (`REACQUIRE_SUSTAIN` 3, worker-side
octave-ambiguity evidence) were measured and rejected (§6).

## 0. Harness and conventions

- **Oracles.** The committed session oracle ([scripts/session-oracle/](../scripts/session-oracle/README.md)):
  real pitch worker + real DSP worker + real `useAudioPipeline.js` `handleAnalysisResult`, run
  on the private session recordings (results kept outside this repository), and `corpus.mjs`
  conventions for FDA / PTDB-TUG / Hillenbrand / vocadito.
- **Cache + replay** ([scripts/session-oracle/reacq/](../scripts/session-oracle/reacq/README.md)). The
  display chain consumes only the pitch messages and the DSP intensity, so `cache.mjs` runs the
  real workers once per stream. `replay.mjs` then drives the real hook of any src tree over the
  cached messages. Variants are a parametric copy of the 5ebe609 gate (`pitchPaintGate.param.js`)
  plus four inert knob/observation edits to the hook, built by `make_tree.py`. The replay also
  records which gate branch decided each frame, which feeds the attribution.
- **Session-oracle extensions used here.** `attr.py` attributes blank and wrong frames, and each
  switch, to a gate branch. `sfv.py` is the session false-voicing score: `session_fv.py` of
  `pitch-low-register-precision`, ported to run tables. `brk.py` classifies line breaks.
  `runs_feat.py` profiles off-level runs. `drills.mjs` runs frame-level drills through the real
  hook. `synth_eval.py` scores the 2026-10-03 audio-level synthetic voice and the noise-only WAVs
  through the real chain.

## 1. Baseline match (before any variant was trusted)

| check | result |
|---|---|
| cache + replay vs `run.mjs` on a session recording, every column of both passes | **0 mismatches** (`fl c0f uv dec post conf nnotch inten msg paint brk ro style rec paintA roA styleA brkA`) |
| cache + replay vs `corpus.mjs`, FDA and vocadito (all bands × stages) | **0 mismatching keys** |
| parametric tree with an empty config vs the 5ebe609 tree, a session recording + drills | 0 mismatches; drill output byte-identical |
| corpora on the 5ebe609 replay | PTDB m 80.91 / FDA m 83.20 / Hil m 63.57 correct; male ×2 up 0.15 / 0.04 / 0.03. These match [pitch-display-gate-redesign-2026-10-03.md](pitch-display-gate-redesign-2026-10-03.md) §2026-10-04 |
| df497b9 code vs the measured variant (`{smResetGap: 2, rawAgree: true, excursionSustain: 7}`); for the current code see §10.5 | **0 mismatches** on every display column of both passes on the session recordings; corpora JSON identical for all 4 corpora; all 90 drill scenarios identical |
| df497b9 code end-to-end through `run.mjs --src=src` (real workers + real hook, no cache), a session recording | **0 mismatches** vs the cached replay of the shipped code, on every column of both passes |

## 2. Attribution: what still blocks the target voice (5ebe609)

Every target frame was attributed to the gate branch that decided its display hop (paint /
accept / onset / off-level armed / off-level unarmed / hold / no-pitch / quiet), each register
switch to the branch that blocked most of its frames, and every off-level run was profiled
(`attr.py`, `runs_feat.py`) — on the private session recordings; results on the private session recordings are kept outside this repository.

What the attribution says:

- The largest remaining blocker is **in-segment**: most register switches in running speech
  have no ≥ 2-frame gap of fresh pitch before the new register. The worker voices through
  consonants and breath, so re-acquisition never arms and the 8-frame mid-segment sustain
  applies.
- The second blocker is the **re-acquisition sustain itself** (4 frames). It costs one frame
  more than necessary because the display median still holds the previous word. The first fresh
  new-register frame is medianed back to the old register. It then either paints the old value
  ("median lag" wrong frames) or is suppressed. So the off-level run starts one frame late.
- Held-value interplay and onset confirm are small.
- The detector-level part (worker half on target) is not reachable from the display.
- **Fast accept when the other octave is not competitive** has no basis: the decoded
  candidate's autocorrelation margin over the other octave barely separates genuine register
  changes from octave errors. This is the physics the 2026-10-03 file predicted: a genuinely
  high voice is also periodic at twice its period. Intensity dips point the wrong way and
  confidence dips separate weakly. Measured as gate variants in §3.

## 3. Variants (session oracle, pooled; corpora where run)

**Historical (superseded 2026-10-04, §10):** the row marked "shipped" below is df497b9's unconditional, unseeded median restart. The current code is `fxcs` in §10.3.

Displayed corpus values: ×2 up for male groups (PTDB m < 160, FDA m, Hil m) and ×½ for female
groups (PTDB f, FDA f, vocadito < 400); rows where the corpora were run. The target-voice,
low-voice, event and switch columns were scored on the private session recordings and are kept
outside this repository.

| variant | male ×2 up PTDB/FDA/Hil | female ×½ PTDB/FDA/voc |
|---|---|---|
| baseline (5ebe609) | 0.15/0.04/0.03 | 0.13/0.15/0.39 |
| REACQUIRE_SUSTAIN 3 | 0.15/0.04/0.03 | 0.24/0.23/0.45 |
| EXCURSION_SUSTAIN 5 | 0.15/0.04/0.03 | 0.15/0.15/0.51 |
| median restart after 2-frame gap (sm2) | 0.07/0.04/0.03 | 0.15/0.19/0.39 |
| raw-agreement accept (ra) | 0.15/0.04/0.03 | 0.11/0.15/0.39 |
| sm2 + ra | 0.07/0.04/0.03 | 0.15/0.15/0.40 |
| rs3 + sm2 | 0.07/0.04/0.03 | 0.26/**0.46**/0.44 |
| rs3 + sm2 + ra | 0.07/0.04/0.03 | 0.24/**0.46**/0.42 |
| **sm2 + ra + EXCURSION_SUSTAIN 7 (df497b9; superseded, §10)** | 0.07/0.04/0.03 | 0.15/0.15/0.42 |
| sm2 + ra + ES 6 | 0.07/0.04/0.03 | 0.15/0.15/0.45 |
| sm2 + ra + ES 5 | 0.07/0.04/0.03 | 0.17/0.15/0.48 |
| sm2 + ra + ES 4 | 0.07/0.04/0.03 | 0.19/0.15/0.53 |
| sm2 + ra + RW 16 | 0.07/0.04/0.03 | 0.19/0.15/0.44 |
| sm2 + ra + dip 0.7 | 0.07/0.04/0.03 | 0.15/0.15/0.43 |
| rs3 + sm2 + dip 0.7 | 0.07/0.04/0.03 | 0.34/**0.46**/0.48 |

Also measured (session oracle only): EXCURSION_SUSTAIN 6 / 4, REACQUIRE_WINDOW 16 (also counted
in fresh frames), REACQUIRE_GAP_FRAMES 1, onset confirm 2 after a gap, arming on a confidence
dip / an intensity dip / an unreinforced level, octave-ambiguity fast accept, median restart
after 1 / 3 / 4 frames, and the dip / RW / ES / gap / onset combinations with rs3.

## 4. Guards: df497b9 vs 5ebe609

**Historical (superseded 2026-10-04, §10):** "shipped" in this section means df497b9. The current code's guards are in §10.4. One omission is corrected there: the vocadito_34 canary (`v34`) group's displayed octave-down rose 10.73 → 11.83 % under df497b9 (+1.10 pp; correct 65.61 → 67.40 %), which the female bullet below left out.

The per-session target / low-band tables and the other session guards (events, readout, second voice, painted octave-wrong frames, real-session false voicing, line breaks) were scored on the private session recordings; results on the private session recordings are kept outside this repository.

**Corpora** (`corpus.mjs` conventions; displayed correct / ×2 up / ×3–4 up / octave-down / blank):

| group | 5ebe609 | shipped |
|---|---|---|
| PTDB m < 160 | 80.85 / 0.15 / 0.00 / 0.02 / 6.46 | **81.80 / 0.07** / 0.00 / 0.02 / 6.57 |
| PTDB m 75–125 | 81.29 / 0.03 / 0 / 0 / 5.86 | 82.22 / 0.03 / 0 / 0 / 5.83 |
| FDA m | 83.20 / 0.04 / 0.04 / 0.00 / 3.35 | 83.46 / 0.04 / 0.04 / 0.04 / 3.13 |
| Hillenbrand m | 63.57 / 0.03 / 0.13 / 0.00 / 12.11 | 63.57 / 0.03 / 0.13 / 0.00 / 12.11 |
| PTDB f | 92.32 / 0.19 / 0.02 / 0.13 / 2.29 | 92.41 / 0.19 / 0.02 / 0.15 / 2.23 |
| FDA f | 86.77 / 0.31 / 0 / 0.15 / 1.65 | 87.19 / 0.31 / 0 / 0.15 / 1.27 |
| Hillenbrand f | 64.41 / 0.03 / 0 / 0.09 / 8.76 | 64.41 / 0.03 / 0 / 0.08 / 8.76 |
| vocadito < 400 | 97.33 / 0 / 0 / 0.39 / 1.80 | 97.45 / 0 / 0 / 0.42 / 1.66 |

Gender-symmetric reading:

- Male octave-up is unchanged or lower; PTDB m halves.
- Female octave-down is unchanged or within +0.03 pp (vocadito) in the pooled groups. The vocadito_34 canary group was omitted here: +1.10 pp (§10.1).
- Correct rises in every group except Hillenbrand, which is flat.

**Frame-level drills** (`drills.mjs`, real hook, 40 trials each; target = 230 Hz, safety = 120 Hz).
Cells are target-word correct, then low-word correct / ×2 up, then latency to the first correct
frame. "Error model" = 30 % of target words start 2–6 frames at half pitch, plus 2–4-frame octave
bursts.

| drill | 5ebe609 | shipped |
|---|---|---|
| alternating 300 ms words, clean (6 gap/loudness cells) | T 66.7 · L 84.9 / 1.8 up · 100 ms | **T 75.0 · L 88.5 / 0.0 · 75 ms** |
| alternating 500 ms words, clean | T 80.0 · L 88.3 / 1.4 · 100 ms | T 85.0 · L 91.1 / 0.0 · 75 ms |
| alternating 800 ms words, clean | T 87.5 · L 91.2 / 1.0 · 100 ms | T 90.6 · L 93.3 / 0.0 · 75 ms |
| alternating 300 ms words, error model | T 47.9 · L 76.7 / 1.9 up | T 52.9 · L 80.0 / 0.3 up |
| alternating 500 ms words, error model | T 62.9 · L 79.8 / 1.6 up | T 66.2 · L 82.4 / 0.3 up |
| alternating 800 ms words, error model | T 70.1 · L 82.4 / 1.2 up | T 72.3 · L 84.6 / 0.2 up |
| transmasculine direction (target first), 300 ms, error model | T 65.0 · L 63.7 / 6.0 up | T 67.3 · L 71.1 / 0.2 up |
| in-word 115 → 225 Hz (no gap) | T 70.8 | T 75.0 |
| in-word 225 → 115 Hz (no gap) | L 70.8 | L 75.0 |
| sirens 120–480 / 120–360 Hz | 89–100 % | identical |
| glide 110 → 220 Hz in 100 ms, then hold | hold 82.6 %, latency 175 ms | hold 85.1 %, 150 ms |
| glide 220 → 110 Hz in 100 ms, then hold | hold 83.1 %, 175 ms | hold 85.6 %, 150 ms |
| 2–4-frame ×2 / ×3 / ×½ bursts in steady voice (11 cells) | 0 burst frames painted | **0** |
| held 110 / 225 Hz, 10 s, vibrato + 2–4-frame bursts | 94.7 / 94.7 %, 0 burst frames painted | identical |
| post-gap 2- / 3-frame ×2, ×3, ×½ onset locks | 0 lock frames painted | **0** |
| post-gap 6-frame ×2 / ×3 onset lock | 50 % of lock frames painted | 66.7 % (§5) |
| mid-word ×2 / ×½ lock of 5 / 6 / 7 frames | 0 painted | **0** |
| mid-word lock of 8 / 11 frames | 12.5 / 36.4 % painted | 25.0 / 45.5 % (§5) |

Connected ≥ 12 st strokes: 0 in every drill for both.

**Audio-level synthetic drills** (`synth_eval.py`): the 2026-10-03 breathy source-filter voice
with LF rumble, through the real worker, cached, then the real hook. Cells are target correct /
blank / median latency to first correct, then low correct.

| drill | 5ebe609 | shipped |
|---|---|---|
| alternating 300 ms | T 55.3 / 22.4 / 50 ms · L 86.2 | T 59.9 / 19.3 / 20 ms · L 89.0 |
| alternating 500 ms | T 60.8 / 12.7 / 50 ms · L 90.2 | T 63.8 / 9.7 / 20 ms · L 92.3 |
| alternating 800 ms | T 57.7 / 19.9 / 50 ms · L 92.2 | T 60.5 / 17.7 / 20 ms · L 93.6 |
| target → low alternating (transmasculine) | T 86.2 · L 87.5 / 69 ms | T 89.3 · L 91.5 / 49 ms |
| 110 → 220 glides, held note | hold 45.4 %, latency 150 ms | hold 46.6 %, 120 ms |
| sirens | 76.6 % | 76.8 % |

Target half-pitch on this voice (~16–18 %) is detector-level and unchanged. For target words
never shown, see §5.

**Noise-only painting** (the 2026-10-03 noise set at −35 dBFS, 60 s per class, scored after
10 s): identical in every class. Shipped and 5ebe609 both paint 0.00 % in every class except
sleep-birdies, which is 0.85 % in both.

## 5. Costs (all synthetic; none shows in the real-session or corpus guards)

1. **Long locks paint more of their tail.** Locks that already exceeded the sustain painted
   their tail before, by design (the 10-03 contract). A mid-word lock of 8 raw frames now paints
   25 % instead of 12.5 %, and an 11-frame lock 45.5 % instead of 36.4 %. A post-gap 6-frame
   onset lock paints 66.7 % instead of 50 %. Locks of up to 7 raw frames mid-word, and up to 3
   raw frames after a gap, still never paint. On the private session recordings,
   ref-confirmed painted octave errors and wrong-octave events both went down.
2. **The raw check refuses a "lucky" accept.** On the audio-level 300 ms alternation, 2 of 64
   target words are never shown (15 → 17). In both, the worker posts the target for 4 frames and
   then drops back to half. The 5ebe609 chain accepted on the median's one-frame tail, painting
   one correct frame while the raw value was already the wrong octave. The shipped chain cannot
   tell that pattern apart from a 3-frame onset lock followed by the true pitch: the two are
   mirror images. It treats both as not yet accepted. On the private session recordings,
   never-shown low → target switches did not rise.
3. **The previous word's median no longer paints over a new word's first frame** (since §10, only when the new word opens ≥ 9.5 st away from it, i.e. a register switch). In the
   onset-lock drills this frame happened to be right, because the drill repeats the same
   register. So low-word "correct" there drops by one frame per word (80.2 → 77.6 %). In real
   register switches that frame was the wrong register: it was the "median lag" painted-wrong
   category, which fell on the private session recordings.

## 6. Rejected

- **`REACQUIRE_SUSTAIN` 3**, alone or with any combination. It gives the largest pickup (private
  session recordings).

  But it lets the worker's own octave-down errors paint after a gap in **female** voices:
  - FDA f displayed octave-down 0.15 → 0.46 % (+0.31 pp);
  - FDA f down-events 2.76 → 7.36 / min;
  - PTDB f 0.13 → 0.24–0.26.

  The raw check does not help, because those runs are internally consistent. This is the
  gender-symmetric mirror of the low-voice octave-up guard (~0.3 pp), so it fails. It also adds
  up-events and real-session false voicing on the private session recordings. The 2026-10-03
  file rejected S = 3 for the same class of reason.
- **Median restart without the raw check (sm2, sm1).** It paints one frame of every post-gap
  3-frame ×2 / ×3 / ×½ onset lock (33 % of lock frames, against 0 before) and reseeds the level
  on the wrong octave. The true pitch after the lock is then blank for 175 ms. The 10-03 design
  requirement is that post-gap locks shorter than `REACQUIRE_SUSTAIN` never paint, so the raw
  check is required.
- **`EXCURSION_SUSTAIN` 6 / 5 / 4** (with sm2 + ra). More target correct, but:
  - mid-word locks of 7 / 6 / 5 raw frames start to paint (es6: 28.6 % of a 7-frame lock; es5:
    33 % of a 6-frame lock; 8-frame: 37.5 / 50 %);
  - female octave-down creeps up (vocadito 0.45 / 0.48 / 0.53 %);
  - painted octave-wrong frames rise on the private session recordings.

  7 is the largest step at which no lock of ≤ 7 frames paints.
- **Arming re-acquisition without a gap** (confidence dip < 0.5–0.7, intensity dip 6–10 dB,
  stale level) and **re-acquisition window 12–24**. These attack the in-segment branch directly,
  but the armed state also accepts locks after 4 frames, which costs wrong-octave events and
  low-band octave-up on the private session recordings. The features barely separate genuine
  runs from octave errors (§2). "Stale level" never fires usefully.
- **Octave-ambiguity fast accept** (needs a new worker field). Tested from the tap, margin
  ≥ 0.05–0.25 over 2–3 frames.
  - It barely moves pooled target correct vs sm2 + ra but raises the down-events on the
    private session recordings.
  - Downward departures with a weak 2f candidate are accepted fast, and that includes
    octave-down errors.
  - The margin does not separate genuine runs from errors (§2), and it would need a pitch-worker
    protocol change.
  - Not worth it, which confirms the 2026-10-03 finding.
- **`REACQUIRE_GAP_FRAMES` 1, onset confirm 2 after a gap, a fresh-frame-counted window.** Each
  stays close to baseline on the private session recordings.

## 7. Implementation, tests, production path

**Historical (superseded 2026-10-04, §10.5):** the parity and test counts below are for df497b9.

- **Parity.** The shipped code (`src/`) replayed over the cached worker outputs equals the
  measured variant on every display column of both passes of the session recordings. It is
  identical on all 4 corpora and all 90 drill scenarios.
- **Production path.** `run.mjs --src=src` (real workers + real hook, no cache) on a session
  recording equals the cached replay on every column of both passes (§1 table).
- **Unit tests.** `node tests/audio/pitch-paint-gate-test.js` → 66 / 66. The new cases cover:
  - the raw check refusing and then accepting;
  - the no-raw caller contract;
  - the mid-segment raw check;
  - a hook-chain simulation (median restart + median-3 + gate): target word after a gap painted
    on its 4th frame, with no old-register frame; the same chain without the restart is one
    frame slower; the symmetric target → low case; post-gap 3-frame ×2 / ×3 / ×½ onset locks not
    painted; mid-word locks of 4 / 7 frames not painted while 8 is accepted;
  - the gap tracker's 1-frame vs 2-frame behaviour and `reset()`;
  - constants.

  The pre-change gate fails 7 of them: the raw-check cases (3), the onset-lock chain cases (3),
  and the 8-frame mid-word lock.
- **Other checks:**
  - `pitch-smoothing-test.js` 15 / 15;
  - `pitch-gate-test.js` 26 / 26;
  - `pitch-smoothing-octave-shift-harness.js` exit 0;
  - `npm run test:dsp` passes;
  - `npm run lint` clean;
  - `npm run build` succeeds (`docs/` restored afterwards).
- **`scripts/paint-gate-glide-validate.js --skip-session`.** Its synthetic gate scenarios feed
  post-median values without `raw`, so they exercise the gate without the raw check. They follow
  the constant:
  - glide recoveries are 1 frame faster;
  - the instant-jump accept moves from 8 to 7 frames;
  - in its smoothed-value lock scenario a 7-frame lock paints 1 frame. Through the real chain,
    with raw, a 7-raw-frame lock paints 0 (unit test above).

  Its contract text is parameterised on `EXCURSION_SUSTAIN` and still holds.
- **CPU.** The gate does one extra semitone comparison per accept attempt, and the tracker adds
  one counter per frame. Both are negligible next to the measured ~1–2 µs/frame of the gate
  (10-03).

### Interaction with the low-register voicing pass (branch `pitch-low-register-precision`)

The low-register pass's best compromise (`rxR2l`) was replayed with both displays on the private
session recordings. The shipped display lifts both workers by the same amount, but it does not
remove the rxR2l-specific held-out cost, which comes from newly voiced low-register frames right
before target onsets (they anchor the level low, and re-acquisition still needs
`REACQUIRE_SUSTAIN` raw frames). Removing it would take `REACQUIRE_SUSTAIN` 3, which is rejected
above for the female-octave-down guard. Results on the private session recordings are kept outside this repository.

## 8. Limitations

- Switch statistics rest on few L→T events on the session recordings, so "never" moves in
  coarse steps.
- The in-segment branch is still the largest blocker. No evidence available to the display
  separates an in-word register change from an octave lock better than duration does (§2).
- The attribution's "gap before run" uses the display alignment. The gate-state classification
  (armed vs unarmed at run start) is the reliable split.
- Hold-bridged frames are still recorded `voiced: false` (unchanged; see the 10-03 correction note).

## 9. Reproduction (worktree root)

Data: FDA / PTDB-TUG audio in `tests/dsp/data/`. The audio-level synthetic and noise WAVs are
the 2026-10-03 set (`build/measure-2026-10-03/display/{synth,noise}` of the main checkout,
generated by that file's `synth_audio.mjs` / `noise_build.mjs`). The session steps (session
cache, `run.mjs` parity, session replays, `sweep.sh`, `summ.py` / `attr.py` / `runs_feat.py` /
`sfv.py` / `brk.py`) need the private session recordings and are omitted here.

```bash
R="node --import ./scripts/session-oracle/lib/register.mjs"
# 1. worker cache (real pitch + DSP workers, once per stream)
for c in fda:2 ptdb:2 hil:2 voc:1; do n=${c#*:}; for i in $(seq 0 $((n-1))); do $R scripts/session-oracle/reacq/cache.mjs --set=corpus --corpus=${c%%:*} --shard=$i/$n & done; done; wait
D="C:/Coding Projects/Syrinx/build/measure-2026-10-03/display"
$R scripts/session-oracle/reacq/cache.mjs --set=dir --dir="$D/synth" --group=synth
$R scripts/session-oracle/reacq/cache.mjs --set=dir --dir="$D/noise" --group=noise
# 2. parametric display tree (5ebe609 + param gate + inert hook knobs)
python scripts/session-oracle/reacq/make_tree.py 5ebe609
# 3. corpus sweeps (lines "tag json")
bash scripts/session-oracle/reacq/csweep.sh VARFILE 6     # corpora
# 5. drills, audio-level synth, noise
$R scripts/session-oracle/reacq/drills.mjs --trials=40 --variants='b0={};sm2es7ra={"smResetGap":2,"rawAgree":true,"excursionSustain":7}' --out=build/reacq/drills/x.json
for t in b0:{} sm2es7ra:'{"smResetGap":2,"rawAgree":true,"excursionSustain":7}'; do for g in synth noise; do
  $R scripts/session-oracle/reacq/replay.mjs --tag=${t%%:*} --set=group --group=$g --pgv="${t#*:}"; done; done
python scripts/session-oracle/reacq/synth_eval.py synth b0 sm2es7ra
python scripts/session-oracle/reacq/synth_eval.py noise b0 sm2es7ra
node tests/audio/pitch-paint-gate-test.js   # 66/66
```

Variant configs used in §3 (`--pgv` JSON):

- `{"reacquireSustain":3}`
- `{"excursionSustain":N}`
- `{"reacquireWindow":N}`
- `{"windowMode":"fresh","reacquireWindow":16}`
- `{"reacquireGapFrames":1}`
- `{"onsetAfterGap":2}`
- `{"dipConf":0.7}`
- `{"intenDipDb":6}`
- `{"staleN":2}`
- `{"smResetGap":2}`
- `{"rawAgree":true}`
- `{"ambMin":0.15,"ambN":2}`

Variants and values that appear in the §3 table are combined as named
there; the rest (e.g. `windowMode`, `reacquireGapFrames`, `onsetAfterGap`,
`intenDipDb`, `staleN`, `ambMin`) were scored on the session oracle only
(results kept outside this repository). The shipped configuration is
`{"smResetGap":2,"rawAgree":true,"excursionSustain":7}`.

## 10. Review fix: a value-preserving median restart (2026-10-04, later the same day)

An adversarial review of df497b9 confirmed one defect, reproduced through the real hook, and two
gaps in this file.

### 10.1 The defect

df497b9 cleared the median-3 buffer whenever a fresh detection followed ≥ 2 frames without
one. Two things went wrong:

- The first frame after the restart was an unsmoothed single frame.
- The second frame was `median([x1, x2])`, and `pitchSmoothing.median` returns the **mean of
  the middle pair** for an even-length buffer. That is a value no detector frame posted.

The paint gate did not catch either one. The hook turns a short gap into **held** frames, not
trace breaks: the silence gate needs 3 quiet frames before it engages, and the 400 ms pitch
hold bridges loud unvoiced frames. Held frames call `push(median, { fresh: false })`, which
does not reset `onStreak`. So after a 2-frame held gap the gate was already past onset confirm
and painted the restarted values at once. Examples:

- 110 Hz word, 2-frame gap, then 110, 220 (a 1-frame flip), 110. Painted: 110, **165**, 110.
- A 1-frame on-level outlier opening the word (150 Hz, or ×1.5 = 165 Hz on a 110 Hz level)
  painted, where the old median would have hidden it.

This broke two documented invariants: "the painted value is always a real detected pitch" and
"a 1-frame flip never paints".

**Size on the real sessions** (`realval.py`: painted hops whose value is not one of the posted
detections of the last 40 hops): 5ebe609 0, df497b9 a measurable share, the fixed (shipped)
code 0 — on the private session recordings; results on the private session recordings are kept outside this repository.

**Gap 2.** `chain()` in the unit tests modelled every gap as `resetSegment()`, so it could not
see held frames. It now drives the real `evaluateFrameGate` (§10.5).

**Gap 3.** §4 said female octave-down rose "at most +0.03 pp" but left out the tracked
vocadito_34 canary group (`v34`). For df497b9 that group's displayed octave-down went
10.73 → 11.83 % (+1.10 pp), while correct rose 65.61 → 67.40 %. §10.4 reports v34 for the fix.

### 10.2 The fix

[src/audio/pitchSmoothing.js](../src/audio/pitchSmoothing.js) `smoothingBufferFor(buf, value,
afterGap)` returns the buffer the fresh value is pushed into:

- **Restart only on a register switch.** After a gap (the tracker's `afterGap`, still
  `SMOOTH_RESET_GAP_FRAMES` = 2), the buffer restarts only if the fresh value is
  ≥ `SMOOTH_RESTART_SEMI` (9.5 st, equal to `EXCURSION_SEMI`, test-asserted) from the buffer
  median. That is the case that motivated the restart. Any other post-gap value is medianed
  against the previous word as before (5ebe609 behaviour), so a 1-frame on-level outlier is
  still hidden.
- **Seeded, odd-length restart.** A restarted buffer, or any fresh value that arrives on an
  empty buffer, starts as `[x1]`. The next medians are x1, then median(x1, x1, x2) = x1, then
  median-3. The buffer never holds exactly two distinct values, so every median is a real
  detection.

[src/audio/useAudioPipeline.js](../src/audio/useAudioPipeline.js) replaces the unconditional
clear with `if (hasPitch) pitchSmoothRef.current = smoothingBufferFor(…, pitch, freshAfterGap)`.
The raw-agreement accept and `EXCURSION_SUSTAIN` 7 are unchanged.

### 10.3 Variants (session oracle; same cache, same `analyze.py`)

Harness knobs (`make_tree.py`): `smSeed` (seeded restart, and seeding on an empty buffer) and
`smCondSemi` (conditional restart). Both are inert when unset: the df497b9 config replays
bit-exactly on the new tree. All variants include ra + ES 7: df497b9 (clear always), seeded
always (`fxs`), **seeded only ≥ 9.5 st (`fxcs`, shipped)**, seeded only ≥ 7 st (`fxcs7`),
unseeded only ≥ 9.5 st (`fxcond`), `fxcs` with ES 8 (`fxcs8`), and no restart (`es7ra`). They
were scored on the private session recordings; results on the private session recordings are kept outside this repository.

Why `fxcs`:

- `fxs` keeps slightly more of the gain, but it still paints the first post-gap frame
  unsmoothed. The 1-frame on-level outlier case fails: it paints the outlier because `onStreak`
  carried through the held frames.
- `fxcs` passes every invariant test (§10.5), paints no non-posted value and keeps most of
  df497b9's display gain over 5ebe609.
- 9.5 st (the gate's own off-level threshold) and 7 st score the same. 9.5 is kept because it
  has a principled meaning, and because a ×1.5 (7.02 st) outlier must not trigger a restart.

### 10.4 Guards: shipped (`fxcs`) vs 5ebe609 (df497b9 in brackets)

The per-session target / low-band tables, the other session guards (events, readout, second
voice, painted octave-wrong frames, line breaks, switch latencies) and the real-session false
voicing (`sfv.py`: essentially flat, with a small rise that a hop-level diff traces to
churn in hold-bridge paints, not fresh detections painted in silence; `es7ra` alone, with no
restart, already shows it, so it is not a new failure mode) were scored on the private session
recordings. Results on the private session recordings are kept outside this repository.

**Corpora** (displayed correct / ×2 up / ×3–4 up / octave-down / blank):

| group | 5ebe609 | shipped | df497b9 |
|---|---|---|---|
| PTDB m < 160 | 80.85 / 0.15 / 0.00 / 0.02 / 6.46 | 80.87 / 0.15 / 0.00 / 0.02 / 6.61 | 81.80 / 0.07 / … |
| PTDB m 75–125 | 81.29 / 0.03 / 0 / 0 / 5.86 | 81.38 / 0.03 / 0 / 0 / 5.92 | 82.22 / 0.03 |
| FDA m | 83.20 / 0.04 / 0.04 / 0.00 / 3.35 | 83.29 / 0.04 / 0.04 / 0.00 / 3.26 | 83.46 / 0.04 / 0.04 / 0.04 |
| Hillenbrand m | 63.57 / 0.03 / 0.13 / 0.00 / 12.11 | 63.58 / 0.03 / 0.13 / 0.00 / 12.11 | 63.57 |
| PTDB f | 92.32 / 0.19 / 0.02 / 0.13 / 2.29 | 92.30 / 0.19 / 0.02 / 0.15 / 2.29 | 92.41 / … / 0.15 |
| FDA f | 86.77 / 0.31 / 0 / 0.15 / 1.65 | 87.19 / 0.31 / 0 / 0.15 / 1.27 | 87.19 / … / 0.15 |
| Hillenbrand f | 64.41 / 0.03 / 0 / 0.09 / 8.76 | 64.41 / 0.03 / 0 / 0.08 / 8.76 | 64.41 / … / 0.08 |
| vocadito < 400 | 97.33 / 0 / 0 / 0.39 / 1.80 | 97.43 / 0 / 0 / 0.42 / 1.67 | 97.45 / … / 0.42 |
| **vocadito_34 (v34 canary)** | **65.61 / 0 / 0 / 10.73 / 23.11** | **67.26 / 0 / 0 / 11.69 / 20.50** | 67.40 / … / 11.83 / 20.36 |

Male octave-up frames are unchanged or lower in every group. FDA m up-runs go 8 → 9 per corpus
(9.40 vs 8.36 per voiced minute), but its ×2 and ×3 frames (1 / 1) and its non-octave
"other" frames (307) are identical: an existing run of q > 1.5 frames is now counted as two.
Female octave-down rises ≤ +0.03 pp in the pooled groups (PTDB f +0.02, vocadito +0.03).

**v34, explicitly.** v34 is one track of 727 referenced display frames.

- Displayed octave-down: 78 → 85 frames (10.73 → 11.69 %, **+0.96 pp**).
- Correct: 477 → 489 frames (+1.65 pp).
- Blank: 168 → 149 frames (−2.61 pp).
- Down-events: 49.5 → 46.2 per voiced minute.

So of the 19 newly painted frames, 12 are correct and 7 are the worker's own octave-down. The
rise does not come from the median restart. The decomposition by variant:

| variant | v34 down frames |
|---|---|
| 5ebe609 | 78 |
| median restart alone (sm2) | 79 |
| raw check alone (ra) | 82 |
| ra + ES 7, no restart | 84 |
| ra + restart, ES 8 (`fxcs8`) | 82 |
| shipped (`fxcs`) | 85 |
| df497b9 | 86 |

So it comes from the raw-agreement check (+4) and ES 7 (+3), both part of df497b9. Going back to
ES 8 would recover 3 of the 7 frames, at a cost in target pickup on the private session
recordings. This file treats v34 as a canary, not a gate: its correct % rises and its
down-event rate falls. The pooled female groups pass the ≤ +0.03 pp octave-down bar. The
canary's +0.96 pp is still a real cost on a hard track; the user decides whether it is
acceptable.

**Drills, synthetic audio, noise.**

- **Frame-level drills** (`drills.mjs`, 90 scenarios, 40 trials): 73 scenarios are identical
  to df497b9. The other 17 are all error-model alternation drills, and in those the pooled cells
  move by at most 0.1 pp (for example, alt300 error model target half 11.3 → 11.2 %). So every
  drill number in §4 still holds to its printed precision, within 0.1 pp: alternation, in-word
  switches, sirens, glides, bursts, held notes, onset and mid-word locks, and 0 connected
  ≥ 12 st strokes.
- **Audio-level synthetic voice** (`synth_eval.py`): target correct is within 0.2 pp of df497b9
  in every drill (alt300 59.8 vs 59.9; alt500 63.8; alt800 60.5; target→low 89.3; held note
  46.4 vs 46.6; sirens 77.0 vs 76.8).
- **Noise-only painting**: identical to 5ebe609 in all 10 classes (0.00 %, sleep-birdies 0.85 %).

### 10.5 Tests, parity, production path

- **Unit tests.** `tests/audio/pitch-paint-gate-test.js`: 66 → **112 / 112**.
- **`chain()` now models the hook.** It drives the real `evaluateFrameGate` and has three gap
  models:
  - `"quiet"`: −70 dB. The first 2 frames of a gap are held frames under the silence debounce,
    later frames are silence.
  - `"loud"`: −38 dB, held for up to 400 ms.
  - `"reset"`: the old model.

  It also has three restart models: shipped, none, and df497b9.
- **The pickup assertions run in every gap model.** They cover the target word after a gap
  painted on frame `REACQUIRE_SUSTAIN` with no old-register frame, a frame slower without the
  restart, the symmetric case, and post-gap 3-frame ×2 / ×3 / ×½ onset locks after 2- and
  4-frame gaps.
- **New tests:**
  - the review defect reproduced: the df497b9 restart paints 165, the shipped chain paints only
    110 and no blank;
  - a 1-frame on-level outlier (150 Hz, 165 Hz = ×1.5) after a 2-frame held gap does not paint,
    with a control showing df497b9 painted it;
  - a 1-frame octave flip opening a word after a held gap never paints, and the true pitch
    resumes;
  - a property test: 300 random sequences, 21 541 painted frames, every painted value is a
    posted detection; the same test finds a non-posted value under the df497b9 restart;
  - the `smoothingBufferFor` contract;
  - `SMOOTH_RESTART_SEMI === EXCURSION_SEMI`.
- **Parity.** The shipped `src/` replayed over the cache equals `fxcs` on every display column
  of both passes of the session recordings. It is identical on all 4 corpora (JSON and events),
  on all 90 drill scenarios, and on the 33 synthetic and 10 noise streams.
- **Production path.** `run.mjs --src=src` (real workers + real hook, no cache) on a session
  recording equals the cached replay on every column of both passes.
- **Other checks:**
  - `pitch-smoothing-test.js` 15 / 15;
  - `pitch-gate-test.js` 26 / 26;
  - `pitch-smoothing-octave-shift-harness.js` exit 0;
  - `paint-gate-glide-validate.js --skip-session` exit 0 (gate unchanged);
  - `npm run test:dsp` passes;
  - `npm run lint` clean;
  - `npm run build` succeeds (`docs/` restored).

Reproduction, in addition to §9:

```bash
python scripts/session-oracle/reacq/make_tree.py 5ebe609
# variant lines: fxs {"smResetGap":2,"smSeed":true,"rawAgree":true,"excursionSustain":7}
#                fxcs {"smResetGap":2,"smSeed":true,"smCondSemi":9.5,"rawAgree":true,"excursionSustain":7}
bash scripts/session-oracle/reacq/csweep.sh VARFILE 6
# session sweeps / scoring (sweep.sh, summ.py, realval.py, sfv.py, replay --set=sessions) need
# the private session recordings (not in this repo)
```
