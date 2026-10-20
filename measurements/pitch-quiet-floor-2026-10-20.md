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
