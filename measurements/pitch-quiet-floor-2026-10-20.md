# Quiet floor for the pitch display ("too quiet to be a voice") — 2026-10-20

Branch `quiet-floor` (from `cue-strip`). User decision 2026-10-20: measure a
"too quiet to be a voice" floor — below an intensity that no real speech
reaches, nothing is voiced or painted, whatever the pitch confidence.

Background. In the user's silent room (PC fans and GPU coil whine, no speech)
the live app paints roughly a third of the pitch trace, mostly near 240 Hz and
always far below −50 dB; a probe through the real chain traced this to three
things — the tonal notch never engages (the whine is too wide and wanders),
the harmonic guard lets failing frames through until the 4th in a row, and the
silence gate never acts because the posted confidence stays ≥ 0.5. An in-app
`?diag=1` snapshot of the same room (Firefox, AudioWorklet capture, 48 kHz,
AGC / noise suppression / echo cancellation off) shows the app sees the same
levels as the room recording, within a few dB. Results on the private
recordings are kept outside this repository.

Hard rule 3 applies (`src/audio/pitchGate.js` and the pitch path): nothing
under `src/` changes until this note has results, and only on PASS.

## Plan (pre-registered)

Committed and pushed before any result exists. Deviations found later are
added under "Deviations" with a date; this section is not edited afterwards.

### 1. What the app sees (level scale)

- Capture: `useAudioPipeline` asks for `echoCancellation`, `noiseSuppression`
  and `autoGainControl` all `false` on both capture paths.
- Both paths hand the DSP worker channel-0 float samples with no gain stage:
  MSTP copies plane 0 as `f32-planar` (`captureSource.js`), the AudioWorklet
  copies input channel 0 (`public/capture-processor.js`).
- DSP intensity (`dsp-worker.js` `computeIntensity`) = 20·log10 RMS of the last
  50 ms at the capture rate, in dB re full scale (a full-scale sine reads
  −3 dB; digital silence −∞). This is the unit of every level in this note.
- Check before any result is used: drive Chrome through the repo's isolated
  harness (`scripts/desktop-diag-capture.js --voice-file=<public speech WAV>`,
  temporary profile, cleanup by its own PID) with `--kind=mstp` and
  `--kind=audiocontext`, and compare the snapshot's DSP intensity with the Node
  chain's on the same WAV. Pass: medians and p5 / p95 within 1 dB on both
  paths. If a path differs by more than 1 dB, the safety levels in §3 are
  shifted by that difference for that path and re-judged. The Firefox
  AudioWorklet path runs the same capture code; the in-app snapshot above is
  its field check.

### 2. Candidates

**Gate floor F** (main thread, `pitchGate.js`), F ∈ {−60, −65, −70, −75} dB:

```js
const intensityQuiet  = intensity < SILENCE_THRESHOLD_DB;          // −50, unchanged
const voicednessQuiet = typeof conf !== "number" || conf < 0.5;    // unchanged
const belowFloor      = intensity < QUIET_FLOOR_DB;                // new, = F
const frameQuiet = intensityQuiet && (voicednessQuiet || belowFloor);
```

- Debounce: unchanged — a frame counts toward the existing
  `SILENCE_DEBOUNCE_FRAMES` (3) run whether it is quiet by the AND rule or by
  the floor; the gate engages from the 3rd quiet frame in a row. This keeps
  1–2-frame dips between syllables from cutting the trace.
- Hysteresis: none, as today — the first frame at or above the floor (or with
  confidence ≥ 0.5 above −50 dB) releases the gate.
- An engaged gate takes the existing silence path: no paint, frame recorded
  `voiced: false`, paint-gate segment reset, 5 s dim readout hold.
- Scope: the trace, readout, note name and recorded frames (session stats).
  Consumers of the *posted* pitch (steadiness readout, "Likely heard as",
  resonance cue, pitch-only warning, formant hint) are not changed by the gate
  floor; their posted voicing is reported, not judged.
- PR #74 is respected: F ≤ −60 is ≥ 10 dB below the −50 dB arm, and the floor
  only acts on frames already below −50 dB.

**Gate floor + guard floor "G·F"** (the one extra variant, evaluated at each
F): the gate floor above, plus in the pitch worker a decoded frame whose own
level is below F and that fails the harmonic test (< 2 harmonics) is vetoed at
once instead of from the 4th failing frame. Frame level = 20·log10 RMS of the
last 50 ms (800 samples) of the decoded frame's 16 kHz buffer (the buffer the
guard already checks). The fail streak counts as today; frames at or above F
are unchanged. Its offset against DSP intensity on the corpora is reported.
G·F changes posted pitch, so it reaches every consumer.

Baseline = `cue-strip` at b60eec3 (`src` via `git archive`). Variant trees
are that `src` with only the change above.

### 3. Safety data (decides)

**Level model.** Voiced level of a file = mean power of its samples inside
reference-voiced frames, in dB re full scale (DSP intensity scale). Each file
is scaled by one gain so its voiced level hits the target; no noise is added.

| Level | Role |
|---|---|
| natural (as recorded) | decisive |
| −40, −45, −50, −55 dB | decisive |
| −60 dB | stress: reported, not decisive |

Why down to −55 dB: normal-effort speech is about 60 dB SPL at 1 m (ANSI
S3.5-1997: 62 dB); soft / casual speech is about 5–8 dB lower (Pearsons et al.
1977). At a laptop / webcam distance of about 0.5 m add 6 dB; voiced frames
carry the energy, about 2 dB above the overall level. A digital MEMS
microphone at the common −26 dBFS sensitivity (at 94 dB SPL), with AGC off and
no extra OS gain, then gives about −52 dB for normal speech and about −58 dB
for soft speech. Voice trainees often practise softly, so −55 dB is the
decisive bound (normal speech on the least-gain setup with 3 dB to spare, and
soft speech on any setup with ≥ 3 dB more gain) and −60 dB is the stress
level. Scaling without added noise is conservative: in a real room the noise
floor only adds to a frame's level, lifting frames above a floor. Gain above
natural is allowed while the peak stays ≤ 0.99 of full scale; files that would
clip are left out of that level and counted.

**Public corpora** through the real chain (`scripts/session-oracle/lib/chain.mjs`:
real pitch worker, real DSP worker, real `handleAnalysisResult`, 25 ms hops),
one fresh instance per file:

| Corpus | Groups | Reference | Dev / held-out split |
|---|---|---|---|
| FDA | m, f | laryngograph | utterance index even / odd (one speaker per sex) |
| PTDB-TUG (subset) | m, f | laryngograph (+20 ms offset) | speaker 01 / 02 |
| Hillenbrand | men, women | vowdata F0, central portion | speaker number odd / even |
| vocadito (sung) | mixed (no sex labels) | annotation | singer ID odd / even |
| LibriSpeech | m, f (SPEAKERS.TXT) | Praat AC 75–600 Hz, default settings, on the natural file | dev-clean / test-clean speakers (first 3 utterances of 3–15 s per speaker) |

Metrics per corpus × group × level, candidate against baseline at the same
level, on reference-voiced frames (scoring alignment as `corpus.mjs`):

- **Display loss** = frames painted by the baseline and not painted by the
  candidate, in % of reference-voiced frames. **Decisive: ≤ 0.5 pp** for every
  group at every decisive level.
- **Painted accuracy** = correct (|q − 1| < 0.05) share of painted
  reference-voiced frames. **Decisive:** falls by ≤ 0.3 pp, and the painted
  octave-error share (down + up) rises by ≤ 0.2 pp.
- Reported: readout (`ro`) loss, recorded-voiced loss, posted voicing (G·F),
  and **onsets / offsets** — the first and last 50 ms of every
  reference-voiced run of ≥ 4 frames (FDA, PTDB, vocadito, LibriSpeech;
  Hillenbrand has only a central reference). An onset / offset loss above
  2 pp is listed as a caveat.
- Worker outputs are run once per file × level for the gate-only candidates
  (their workers are identical to the baseline's); each G·F runs its own
  workers.

**Private session recordings** (`$SYRINX_SESSIONS_DIR`, set here): the session
oracle (`run.mjs` + `analyze.py`) for baseline and every candidate at the
recordings' stored level, `cons` references (strict as sensitivity). Decisive:
display loss ≤ 0.5 pp per band (75–110, 110–160, 160–200, 200–260, 260–400 Hz)
for the user's voice and the second voice, pooled over the oracle sessions.
`session_fv.py` painted false voicing reported. Results private.

### 4. Benefit data

- **Room recording** (private, through the real chain). **Decisive:** painted
  share of display hops drops by ≥ 90 % against the baseline. Posted, readout
  and recorded-voiced shares reported.
- **In-app snapshot replay** (private, the Firefox AudioWorklet path): the
  snapshot's per-frame DSP intensity and its posted pitch messages replayed
  through the real hook. **Decisive** for the gate floor: painted share drops
  by ≥ 90 %. G·F's worker part cannot be replayed without audio, so G·F is
  judged here on its gate part only.
- **Committed noise classes** (`scripts/noise-synth.js`, the classes of
  `scripts/noise-augment-oracle.js`) through the real chain with
  `scripts/session-oracle/noise-fv.mjs`, 3 seeds: posted and painted false
  voicing at the committed scale (RMS 0.03, about −30 dB, where no floor
  acts — must be unchanged) and at quiet-room scales of −60, −70 and −80 dB
  RMS. Reported.
- G·F only: `node scripts/noise-augment-oracle.js pitch --frontend=tracker`
  speech-in-noise accuracy must be unchanged (expected bit-identical: its
  speech never falls below the floors).

### 5. Selection

1. On **dev**, keep the candidates that pass every decisive safety check
   (§3: public corpora at every decisive level, private sessions) and both
   decisive benefit checks (§4).
2. Pick the **least aggressive**: the lowest F; at equal F the gate floor
   before G·F. Reason: the benefit target is met with the most room left for
   devices and voices quieter than the level model.
3. **Held-out, one look:** the picked candidate must pass the same public
   safety checks on the held-out speakers. If it fails, the result is FAIL —
   no stepping to another candidate.

### 6. What ships on PASS

- `src/audio/pitchGate.js`: `QUIET_FLOOR_DB = F` and the `frameQuiet` rule of
  §2, comments citing this note. For G·F also the guard option
  (`createHarmonicVoicingGuard({ floorDb })` in `boersma-ac.js`) and the frame
  level in `pitch-worker.js`.
- Tests: new cases in `tests/audio/pitch-gate-test.js` (confident pitch below
  F for 3 frames → quiet; at F → not quiet; 1–2-frame dips do not engage;
  pre-warmup unchanged) and `tests/audio/display-hook-test.js` (real hook: a
  confident pitch below F never paints; at natural speech levels nothing
  changes); for G·F a guard case in `tests/dsp/boersma-ac-test.js`.
- Regression set: `npm run lint`, `npm run test:unit`, `npm run build`, the
  silence-gate / paint / smoothing tests and
  `scripts/paint-gate-glide-validate.js --skip-session`; for G·F also
  `tests/dsp/boersma-ac-test.js`, `tests/dsp/pitch-worker-above-range-test.js`,
  `tests/dsp/noise-notch-test.js`.
- `CLAUDE.md` "Silence gate" Current-state row and §Main thread paragraph
  updated; this note gets its Results section. Merged into `cue-strip`, pushed.
  No PR.

### 7. What is reported on FAIL

No `src/` change. The Results section gives, per candidate, per sex and per
level: display loss, painted-accuracy change, onset / offset loss, the room and
in-app painted-share drops, and the noise-class false voicing; it names the
binding constraint (which group and level fail first) and the gap between the
most aggressive safe floor and the least aggressive floor that reaches the
benefit. Committed, merged into `cue-strip` and pushed.

### 8. Privacy

The room recording, the in-app snapshot and the session recordings stay
local; their results are kept outside this repository. This note may carry
one aggregate sentence per private source. Public outputs go to the
gitignored `build/`.

## Deviations (2026-10-20)

Recorded after the plan; none changes a decisive rule.

1. **Chrome level check (§1)** used a new headless script,
   [`scripts/quiet-floor/chrome-level-check.mjs`](../scripts/quiet-floor/chrome-level-check.mjs)
   (puppeteer, temporary profile, Chrome's fake microphone playing the WAV,
   cleanup by its own PIDs), against a production build served by
   `vite preview`, instead of `scripts/desktop-diag-capture.js` against a dev
   server. The old harness does not answer the app's first-visit direction
   question, so it never starts listening; and a dev server would rewrite the
   dependency cache that other worktrees share. Same capture code, same
   `?capture=` paths.
2. **Session references** were built with `build_refs.py --no-arb` and without
   PENN (torch / penn are not installed here). `cons` is then the AC-family
   and SHS agreement on every frame (the oracle's rule outside its PENN spans);
   the arbiter is only used by `cons_arb`, which this check does not use.
3. **Onsets / offsets** are counted on 25 ms display hops: the first / last two
   hops of every reference-voiced display run of ≥ 4 hops.
4. **Harness bug, fixed before any decision:** the first LibriSpeech run read
   reference files of under 4 KB from Node's shared buffer pool, so their
   reference tracks were wrong. The loader was fixed and LibriSpeech was run
   again; every number below is from the fixed run. (All candidates already
   failed on PTDB-TUG and FDA, which this bug did not touch.)
5. **Held-out was not run.** No candidate passed on dev, so there was nothing
   to confirm (§5.3).
6. **Added after the result, not pre-registered, no effect on the verdict:**
   gate-only floors of −80 to −100 dB on dev (to find the safe floor for §7's
   "gap"), and a diagnostic count of lost hops in the last 150 ms of each
   reference-voiced run. The sweep's −60 … −75 dB rows reproduce the main run
   exactly (270 of 270 count tables identical).

## Results (2026-10-20)

**Verdict: FAIL.** Every candidate fails the public safety check on dev, so
nothing under `src/` changes.

Harness: [`scripts/quiet-floor/`](../scripts/quiet-floor/) — `make-trees.mjs`
(candidate trees), `corpus-qf.mjs` (public corpora through the real workers and
hook), `file-qf.mjs` / `replay-qf.mjs` (benefit), `noise-qf.mjs`,
`sessions-qf.mjs` + `score_sessions.py` (private sessions),
`noise-augment-variant.mjs`, `level-offset.mjs`, `report-qf.mjs`,
`tables-qf.mjs`, `chrome-level-check.mjs` + `chrome-level-compare.mjs`,
`prep_libri.py`. Outputs in the gitignored `build/quiet-floor/`.

### Level scale — PASS

A public speech WAV (four PTDB-TUG sentences, 27 s, 48 kHz) through Chrome 155
(headless, fake microphone) and through the Node chain. DSP intensity
percentiles, Chrome minus Node:

| Path | Chrome rate | p5 | median | p95 |
|---|---|---:|---:|---:|
| MSTP | 44.1 kHz | −0.26 dB | +0.12 dB | −0.18 dB |
| AudioWorklet | 48 kHz | −0.16 dB | −0.12 dB | +0.02 dB |

Both within 1 dB, so the level model needs no shift. The G·F frame level (last
50 ms of the 16 kHz buffer) matches DSP intensity too: median offset 0.0 dB on
every corpus (p5 −2.1 dB on FDA, whose 20 kHz audio loses some fricative energy
above 8 kHz; within ±0.15 dB elsewhere).

### Safety on the public corpora (dev) — every candidate FAILS

Display loss = frames the baseline painted and the candidate did not, in pp of
reference-voiced frames. Decisive: ≤ 0.5 pp for every corpus × sex group at
natural, −40, −45, −50 and −55 dB voiced level; −60 dB is reported only. Men
and women are pooled here over FDA, PTDB-TUG, Hillenbrand and LibriSpeech
(per-group values are in `build/quiet-floor/report-dev.txt`); "worst group" is
the largest single corpus × sex value. `gNN` = gate floor at −NN dB, `gfNN` =
gate floor plus guard floor. Dev files: FDA 25 + 25, PTDB-TUG 45 + 45,
Hillenbrand 264 men + 288 women, LibriSpeech 60 + 60, vocadito 22; no file
had to be left out for clipping.

| Floor | Voices | natural | -40 dB | -45 dB | -50 dB | -55 dB | -60 dB |
|---|---|---:|---:|---:|---:|---:|---:|
| **g60** FAIL | men | 0.07 | 2.99 | 7.67 | 16.11 | 31.52 | 58.65 |
|  | women | 0.16 | 2.50 | 6.35 | 14.88 | 31.32 | 60.02 |
|  | sung (vocadito) | 0.12 | 1.88 | 3.84 | 8.03 | 18.95 | 62.95 |
| | worst group | 0.61 (fda_f) | 5.27 (hil_m) | 11.69 (hil_m) | 19.10 (fda_f) | 42.02 (fda_f) | 72.42 (fda_f) |
| **g65** FAIL | men | 0.02 | 0.83 | 2.94 | 7.50 | 15.73 | 31.45 |
|  | women | 0.06 | 0.94 | 2.52 | 6.27 | 14.71 | 31.24 |
|  | sung (vocadito) | 0.03 | 0.85 | 1.86 | 3.82 | 8.01 | 18.94 |
| | worst group | 0.23 (fda_f) | 1.38 (fda_f) | 5.27 (hil_m) | 11.69 (hil_m) | 19.25 (fda_f) | 41.86 (fda_f) |
| **g70** FAIL | men | 0.01 | 0.28 | 0.79 | 2.86 | 7.23 | 15.67 |
|  | women | 0.02 | 0.36 | 0.97 | 2.43 | 6.21 | 14.68 |
|  | sung (vocadito) | 0.00 | 0.21 | 0.84 | 1.85 | 3.80 | 8.01 |
| | worst group | 0.08 (ptdb_f) | 0.99 (fda_f) | 1.68 (fda_f) | 5.27 (hil_m) | 11.66 (hil_m) | 19.17 (fda_f) |
| **g75** FAIL | men | 0.00 | 0.10 | 0.26 | 0.79 | 2.73 | 7.21 |
|  | women | 0.01 | 0.12 | 0.35 | 0.93 | 2.41 | 6.20 |
|  | sung (vocadito) | 0.00 | 0.04 | 0.22 | 0.84 | 1.83 | 3.80 |
| | worst group | 0.04 (ptdb_f) | 0.53 (fda_f) | 1.07 (fda_f) | 1.60 (fda_f) | 5.24 (hil_m) | 11.66 (hil_m) |
| **gf60** FAIL | men | 0.07 | 3.70 | 9.16 | 18.10 | 34.18 | 61.15 |
|  | women | 0.20 | 2.87 | 7.07 | 16.02 | 33.34 | 61.97 |
|  | sung (vocadito) | 0.15 | 2.00 | 4.14 | 8.34 | 19.51 | 63.67 |
| | worst group | 0.84 (fda_f) | 5.71 (hil_m) | 12.43 (hil_m) | 21.07 (ptdb_m) | 43.01 (fda_f) | 72.96 (fda_f) |
| **gf65** FAIL | men | 0.03 | 1.08 | 3.82 | 8.93 | 17.76 | 34.08 |
|  | women | 0.09 | 1.09 | 2.92 | 7.03 | 15.86 | 33.27 |
|  | sung (vocadito) | 0.06 | 0.93 | 2.00 | 4.11 | 8.31 | 19.50 |
| | worst group | 0.46 (fda_f) | 1.91 (fda_f) | 5.71 (hil_m) | 12.43 (hil_m) | 20.99 (ptdb_m) | 42.86 (fda_f) |
| **gf70** FAIL | men | 0.01 | 0.43 | 1.08 | 3.62 | 8.60 | 17.68 |
|  | women | 0.03 | 0.45 | 1.11 | 2.83 | 6.98 | 15.81 |
|  | sung (vocadito) | 0.01 | 0.29 | 0.93 | 1.98 | 4.09 | 8.30 |
| | worst group | 0.31 (fda_f) | 1.45 (fda_f) | 2.29 (fda_f) | 5.71 (hil_m) | 12.40 (hil_m) | 20.91 (ptdb_m) |
| **gf75** FAIL | men | 0.00 | 0.17 | 0.41 | 1.06 | 3.41 | 8.56 |
|  | women | 0.01 | 0.18 | 0.45 | 1.08 | 2.80 | 6.95 |
|  | sung (vocadito) | 0.00 | 0.06 | 0.30 | 0.90 | 1.97 | 4.09 |
| | worst group | 0.08 (fda_f) | 0.99 (fda_f) | 1.60 (fda_f) | 2.14 (fda_f) | 5.68 (hil_m) | 12.40 (hil_m) |

The painted-accuracy and octave checks pass for every candidate (worst group
over the decisive levels; decisive: correct share falls ≤ 0.3 pp, octave share
rises ≤ 0.2 pp). Pooled, accuracy goes up slightly, because the frames that
are cut are less accurate than average:

| Floor | min Δ correct (pp) | max Δ octave (pp) |
|---|---:|---:|
| g60 | -0.10 | 0.10 |
| g65 | -0.11 | 0.06 |
| g70 | -0.10 | 0.06 |
| g75 | -0.10 | 0.02 |
| gf60 | -0.25 | 0.11 |
| gf65 | -0.22 | 0.05 |
| gf70 | -0.22 | 0.05 |
| gf75 | -0.22 | 0.02 |

Onsets and offsets (loss in pp of the first / last 50 ms of voiced runs; men /
women / sung). Every candidate is above the 2 pp caveat line at offsets from
−45 or −55 dB on:

| Floor | onset −45 | offset −45 | onset −55 | offset −55 |
|---|---|---|---|---|
| g60 | 2.97 / 1.19 / 0.78 | 28.42 / 25.21 / 32.24 | 14.81 / 15.27 / 6.85 | 78.57 / 77.07 / 77.38 |
| g65 | 1.27 / 0.58 / 0.26 | 11.73 / 10.80 / 16.81 | 4.60 / 3.68 / 1.73 | 51.30 / 50.30 / 54.51 |
| g70 | 0.47 / 0.40 / 0.09 | 3.22 / 3.92 / 7.89 | 1.01 / 0.43 / 0.43 | 28.35 / 25.43 / 32.24 |
| g75 | 0.25 / 0.12 / 0.00 | 1.01 / 1.52 / 2.08 | 0.25 / 0.21 / 0.09 | 11.80 / 10.80 / 16.81 |
| gf60 | 5.94 / 3.01 / 1.73 | 31.75 / 26.55 / 33.36 | 24.40 / 22.69 / 11.35 | 80.59 / 77.89 / 77.82 |
| gf65 | 3.04 / 1.61 / 0.52 | 13.65 / 11.37 / 17.59 | 9.41 / 6.93 / 3.38 | 55.25 / 52.01 / 55.20 |
| gf70 | 1.23 / 0.73 / 0.17 | 3.73 / 4.17 / 8.41 | 3.22 / 2.19 / 1.21 | 32.11 / 27.04 / 33.80 |
| gf75 | 0.58 / 0.24 / 0.17 | 1.38 / 1.79 / 2.51 | 1.34 / 1.19 / 0.35 | 13.69 / 11.44 / 17.68 |

**Binding constraint.** Display loss at the quiet end of the level model. The
first group to fail is FDA women: at −40 dB already for the −75 dB floors
(0.53 pp for the gate floor), then PTDB-TUG men at −45 dB and every other group
at −50 dB; at −55 dB every group fails for every candidate. The loss depends on the
distance between the voice level and the floor: each 5 dB quieter voice costs
about what a 5 dB higher floor costs. The cut frames are the ends of voiced
stretches: at −55 dB, 82–100 % of them lie in the last 150 ms of a
reference-voiced run (table below). There the voice is fading, and the display
still shows the pitch of audio about 65–90 ms older than the 50 ms level
window the gate reads (posted pitch: frame centre 40 ms before the chunk end
plus the 2-hop decode; level: the last 50 ms). So the floor blanks the last
painted frames of a word whenever the room behind the voice is quieter than the
floor, which in a quiet room is always. The added G·F guard floor only adds
loss (it also vetoes some failing quiet frames inside voiced runs).

### Private session recordings

On the private session recordings, at their recorded level, every candidate
stayed far inside the 0.5 pp display-loss bound in every band for both voices,
and painted false voicing hardly moved. Results on the private recordings are
kept outside this repository.

### Benefit

- **Room recording (private):** only the −60 dB floors (gate floor and G·F) cut
  the painted share by at least 90 %; −65 dB and lower did not, and the
  dev-safe −95 dB floor (below) removes only a small part.
- **In-app snapshot replay (private, Firefox AudioWorklet path):** the −60 and
  −65 dB gate floors reached the 90 % cut; −70 and −75 dB did not, and the
  dev-safe −95 dB floor removes well under half.
- So only F = −60 dB passes both benefit checks — and it fails safety by the
  widest margin.

Results on the private recordings are kept outside this repository.

**Noise classes** (reported). Painted false voicing, % of display hops, 3 seeds
× 30 s; classes where any tree paints ≥ 0.1 % at some scale:

| Class | Scale (RMS) | base | g60 | g65 | g70 | g75 | gf60 | gf65 | gf70 | gf75 |
|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| sleep-noise | −30 dB | 0.5 | 0.5 | 0.5 | 0.5 | 0.5 | 0.5 | 0.5 | 0.5 | 0.5 |
| sleep-noise | −60 dB | 0.0 | 0.0 | 0.0 | 0.0 | 0.0 | 0.0 | 0.0 | 0.0 | 0.0 |
| sleep-noise | −70 dB | 0.0 | 0.0 | 0.0 | 0.0 | 0.0 | 0.0 | 0.0 | 0.0 | 0.0 |
| sleep-noise | −80 dB | 0.0 | 0.0 | 0.0 | 0.0 | 0.0 | 0.0 | 0.0 | 0.0 | 0.0 |
| sleep-birdies | −30 dB | 0.9 | 0.9 | 0.9 | 0.9 | 0.9 | 0.9 | 0.9 | 0.9 | 0.9 |
| sleep-birdies | −60 dB | 0.2 | 0.0 | 0.0 | 0.2 | 0.2 | 0.0 | 0.0 | 0.2 | 0.2 |
| sleep-birdies | −70 dB | 0.2 | 0.0 | 0.0 | 0.0 | 0.0 | 0.0 | 0.0 | 0.0 | 0.0 |
| sleep-birdies | −80 dB | 0.2 | 0.0 | 0.0 | 0.0 | 0.0 | 0.0 | 0.0 | 0.0 | 0.0 |
| resonant-noise | −30 dB | 1.6 | 1.6 | 1.6 | 1.6 | 1.6 | 1.6 | 1.6 | 1.6 | 1.6 |
| resonant-noise | −60 dB | 0.4 | 0.4 | 0.4 | 0.4 | 0.4 | 0.4 | 0.4 | 0.4 | 0.4 |
| resonant-noise | −70 dB | 0.4 | 0.0 | 0.0 | 0.4 | 0.4 | 0.0 | 0.0 | 0.4 | 0.4 |
| resonant-noise | −80 dB | 0.4 | 0.0 | 0.0 | 0.0 | 0.0 | 0.0 | 0.0 | 0.0 | 0.0 |
| fan-hum | −30 dB | 19.7 | 19.7 | 19.7 | 19.7 | 19.7 | 19.7 | 19.7 | 19.7 | 19.7 |
| fan-hum | −60 dB | 17.8 | 10.8 | 17.8 | 17.8 | 17.8 | 10.8 | 17.8 | 17.8 | 17.8 |
| fan-hum | −70 dB | 17.8 | 0.0 | 0.0 | 10.7 | 17.8 | 0.0 | 0.0 | 10.7 | 17.8 |
| fan-hum | −80 dB | 17.8 | 0.0 | 0.0 | 0.0 | 0.0 | 0.0 | 0.0 | 0.0 | 0.0 |
| babble | −30 dB | 78.5 | 78.5 | 78.5 | 78.5 | 78.5 | 78.5 | 78.5 | 78.5 | 78.5 |
| babble | −60 dB | 77.2 | 39.3 | 75.3 | 76.9 | 77.2 | 37.5 | 75.3 | 76.9 | 77.2 |
| babble | −70 dB | 77.2 | 0.0 | 0.0 | 39.3 | 75.3 | 0.0 | 0.0 | 37.4 | 75.3 |
| babble | −80 dB | 77.2 | 0.0 | 0.0 | 0.0 | 0.0 | 0.0 | 0.0 | 0.0 | 0.0 |
| resonant-noise-q5 | −30 dB | 1.6 | 1.6 | 1.6 | 1.6 | 1.6 | 1.6 | 1.6 | 1.6 | 1.6 |
| resonant-noise-q5 | −60 dB | 0.4 | 0.4 | 0.4 | 0.4 | 0.4 | 0.4 | 0.4 | 0.4 | 0.4 |
| resonant-noise-q5 | −70 dB | 0.4 | 0.0 | 0.0 | 0.4 | 0.4 | 0.0 | 0.0 | 0.4 | 0.4 |
| resonant-noise-q5 | −80 dB | 0.4 | 0.0 | 0.0 | 0.0 | 0.0 | 0.0 | 0.0 | 0.0 | 0.0 |

At the committed scale (RMS 0.03) every class is identical to the baseline except: crickets gf60 posted 0.06 → 0.03. (Painted is unchanged; the G·F guard floor vetoed one quiet
cricket frame.) Below the floor, a floor removes painted hum and distant
babble, as intended.

**G·F speech in noise.** `noise-augment-oracle.js pitch --frontend=tracker`
with the guard floor added to its copy of the worker chain: gf60, gf65, gf70
and gf75 are identical to the baseline in every cell.

### Gap between the safe floor and the useful floor

Exploratory gate-only sweep on dev (added after the result): worst corpus × sex
display loss per level, the dev decision, and the share of lost hops in the
last 150 ms of a reference-voiced run (−55 dB, all groups):

| Floor | natural | -40 dB | -45 dB | -50 dB | -55 dB | -60 dB | dev | lost in last 150 ms |
|---|---:|---:|---:|---:|---:|---:|---|---:|
| −60 dB | 0.61 | 5.27 | 11.69 | 19.10 | 42.02 | 72.42 | fail | 82 % |
| −65 dB | 0.23 | 1.38 | 5.27 | 11.69 | 19.25 | 41.86 | fail | 94 % |
| −70 dB | 0.08 | 0.99 | 1.68 | 5.27 | 11.66 | 19.17 | fail | 98 % |
| −75 dB | 0.04 | 0.53 | 1.07 | 1.60 | 5.24 | 11.66 | fail | 99 % |
| −80 dB | 0.00 | 0.26 | 0.61 | 0.99 | 1.60 | 5.24 | fail | 99 % |
| −85 dB | 0.00 | 0.08 | 0.31 | 0.53 | 0.99 | 1.60 | fail | 99 % |
| −90 dB | 0.00 | 0.04 | 0.08 | 0.23 | 0.53 | 0.99 | fail | 100 % |
| −95 dB | 0.00 | 0.00 | 0.04 | 0.00 | 0.23 | 0.53 | pass | 100 % |
| −100 dB | 0.00 | 0.00 | 0.00 | 0.00 | 0.00 | 0.23 | pass | – |

- Most aggressive gate floor that passes the dev safety checks: **−95 dB**
  (−90 dB misses by 0.03 pp, FDA women at −55 dB).
- Least aggressive floor that reaches the benefit: **−60 dB**.
- **Gap: 35 dB.** No level-only floor on the current level reading can be both
  safe for soft speech and useful in this room.

### What this suggests (not measured)

The level reading and the displayed pitch are not aligned in time. A floor
that judges the level of the audio the displayed pitch came from — for example
the loudest DSP frame over the window behind the displayed pitch, or the
decoded frame's own level inside the pitch worker, applied to every decoded
frame rather than only to frames that fail the harmonic test — would not cut
word endings just because the room behind them is silent. Fading voice that is
itself below the floor would still be cut, so such a floor needs its own
pre-registered measurement on the same data. A different route is to work on
the other two causes the room probe found: the harmonic guard's 4-frame
debounce, and a whine too wide and wandering for the tonal notch.
