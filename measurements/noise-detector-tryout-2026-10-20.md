# Noise-detector try-out: FireRedVAD pitch gate (design note, 2026-10-20)

Branch `noise-detector-tryout` (from `cue-strip`). A **try-out build for the
PC**, not a ship: the user decided on 2026-10-20 that blanking some held
notes / sustained vowels is acceptable for now and asked for a build to try
next to a proper confirmation run. The confirmation is separate work
(pre-registered on branch `voice-detector`,
`measurements/firered-confirmation-2026-10-21.md`); nothing here replaces it.

## Measurement it rests on (CLAUDE.md hard rule 3)

`measurements/offtheshelf-screen-2026-10-20.md` on branch `voice-detector`
(Stage A + "Addendum: relaxed rules", as of commit defde07). Stage A closed
the off-the-shelf route under the pre-registered rules. The addendum
(post hoc, information only) asked what happens if held notes / sustained
vowels may be blanked; its lead "R1 h" reading is the point built here.

**The point: FireRedVAD Stream-VAD, smoothing w5, p ≥ 0.55, 2 s hangover.**

| reading (selection data, real voices, women / men) | R1 h |
|---|---|
| tuning-194 false pitch line removed | **79.8 %** (resampled: median about 78 %, ≥ 60 % in every draw) |
| held notes / sustained vowels blanked, clean | 2.8 / 6.4 % (worst row 10.5 %, men's long holds) |
| … last 10 s of long clean holds | 15.6 / 29.0 % |
| … in noise, +10 dB / 0 dB | 9.3 / 20.2 % / 23.6 / 32.7 % (worst 42.7 %, men, 0 dB) |
| normal speech lost | ≤ 2.9 % pooled (0 dB); worst row children's speech in 0 dB noise, 4.9 % |
| speech onset delay | 0 ms median and p90 |

Best of a grid, scored on the clips it was picked on, no held-out check;
about half of the screen's held-voice audio is synthetic (the table uses
real voices only); the noise clips are 16 kHz.

## What was built

- **Detector** (`src/dsp/firered-vad.js`, in the pitch worker): the official
  streaming ONNX with cache (`fireredvad_stream_vad_with_cache.onnx` +
  `cmvn.ark`, FireRedTeam/FireRedVAD @ c30ec49, Apache-2.0) through
  onnxruntime-web WASM — the app's own copy of the plain ORT runtime it
  already ships (no new dependency); our JavaScript Kaldi 80-band fbank
  (25 ms / 10 ms, the official front end's settings) + CMVN; fresh state at
  every Start. It reads the pitch worker's own 16 kHz stream (the
  resampler's output, before the notch).
  - **Why the pitch worker, not a companion worker:** the decision for the
    pitch message of chunk k is computed from the audio up to the end of
    chunk k and travels in that same message — exactly the hop alignment the
    screen scored — with no second resampler and no cross-worker timing.
    The cost is that the worker turns asynchronous once the model is loaded
    (ONNX Runtime Web's `run` is async): chunks then go through an in-order
    promise chain, and if it falls 20 chunks (0.5 s) behind the detector
    switches itself off ("slow") rather than delay the pitch. Without a
    model the worker is synchronous and identical to before; the Node
    harnesses that drive it (session oracle, above-range test, resonance
    parity) never load the detector.
- **Gate** (`createVoiceGate`): screen.py's / score.py's definitions exactly —
  trailing mean of the last 5 frame probabilities (float64 running-sum
  difference, rounded to float32), "on" when the newest available frame's
  score ≥ 0.55 (0 before the first frame), voice while a hop within the last
  2 s was on.
- **Display mask** (`useAudioPipeline.js`): while the setting is on and the
  latest hop's decision is "no voice", the pitch trace shows a gap, the
  Hz / note and steadiness readouts show "—", and the pitch-display flags
  (`pitchVoiced` / `pitchHolding`: trace header, the cue strip's pitch row,
  the listening status) read as unvoiced. It masks the unchanged chain
  (smoothing, paint gate, silence gate, hold), which is the veto the screen
  scored. Unchanged: DSP / ML / resonance pitch hints, "Likely heard as",
  the pitch-only warning, formants / HNR, the resonance row (raw
  `voiced` / `holding`), and the recorded `voiced` / `f0` that session stats
  use. Recorded frames carry `voiceGate` ("voice" | "hidden" | "novoice";
  non-indexed, no schema bump); `painted` is what the live trace drew, so
  History shows the same gaps.
- **Setting:** Settings → "Hide pitch when no voice is heard (experimental)",
  **on by default in this try-out**; switching it off shows the unmasked
  display from the next frame (the detector keeps running, so switching back
  is immediate). Settings shows the detector's state; if the model files are
  missing the gate stays off and Settings says so.
- **Diag** (`?diag=1`): "Voice gate (try-out)" rows (detector state, smoothed
  p and decision, gate state, worker ms per hop) and the score in the
  sparkline (violet); the snapshot carries `voiceGate` and per-frame
  `vadP` / `vadVoice` / `painted` / `shown`.
- **Model files** are not committed: `node scripts/fetch-firered-model.mjs`
  downloads them from the pinned commit, checks size + sha256 and writes
  `public/models/firered/` (gitignored); the worker checks them again.
  Licence text: `licenses/fireredvad/LICENSE`, attribution in
  `THIRD_PARTY_NOTICES.md` (both ship in `THIRD_PARTY_NOTICES.txt`).

## Checks (2026-10-20)

- `tests/dsp/firered-vad-parity-test.js` — fixture: committed public clips
  (CC0 MS-SNSD air conditioner + CC BY 4.0 LibriSpeech, 18 s), reference
  written by `scripts/firered/make-parity-ref.py` with the screen's own
  runner, smoothing and score.py code (git blob ids recorded):
  log-mel equal to the runner's on every 20th frame (max |Δ| 9.5e-7, the
  float32 rounding of the reference);
  probabilities through ORT-web WASM within **3.0e-7** of the Python
  runner's (limit 1e-3); the gate decision equal to score.py's on all 720
  hops, also when the model arrives 1.5 s late; two broken front ends (no
  pre-emphasis; samples not scaled to the int16 range) and a 0.97 → 0.9
  pre-emphasis edit of the module all fail it. The model part skips with a
  notice where the model is not fetched (CI); the front-end and gate parts
  always run.
- `tests/dsp/firered-vad-gate-test.js` (state machine, front end, CMVN
  parser, backlog replay) and `tests/audio/voice-gate-display-test.js` (the
  REAL hook: hidden frames empty; every other output, the recorded
  voiced / f0 and every unhidden frame's painted value bit-identical to the
  run without decisions; setting off = no change).
- `scripts/firered/tune194-replay.mjs` — the JS detector + gate (ORT-web
  WASM in Node, 400-sample hops) on the screen's tuning-194 noise clips,
  scored on the benchmark dumps' falsely painted hops exactly as the screen
  counts them: **79,223 false hops (the screen's count), 79.85 % removed
  (the screen: 79.8 %)**; per class stationary-tonal / mixed / broadband /
  intermittent-tonal 76.3 / 84.4 / 80.0 / 74.5 % (screen 75.9 / 84.8 / 79.4 /
  74.5). The same clips band-limited to 48 kHz and passed through the app's
  linear 48 → 16 kHz resampler (what the detector reads from a 48 kHz
  microphone): 86.9 % removed (85.8 / 90.2 / 77.3 / 84.8). Selection data,
  information only.
- `scripts/voice-gate-smoke.mjs` (built app, headless desktop Chrome, fake
  mic, two runs): air-conditioner noise (the committed CC0 clip) — the gate
  hid all 178 painted frames after the first 3 s (switched off: 0 of 460
  frames differ from the chain; on again: all hidden); LibriSpeech speech —
  426 of 426 painted frames kept; VocalSet long tones (2.75–3.5 s holds) —
  0 of 749 hidden; model files removed — Settings says so, nothing hidden;
  no page or console errors. **Detector CPU in the pitch worker, desktop
  Chrome: 1.1–1.2 ms median, 1.6–1.9 ms p95 per 25 ms hop** (about 2,770
  hops per run; worker timer at 0.1 ms resolution; the pitch detector
  itself 0.3–0.4 ms median). With a tuning clip FireRedVAD hears as voice
  (Freesound HVAC 121285: no "no voice" hop even on its native 16 kHz
  samples) the gate hides only 13–25 % of that clip's line — the detector,
  not the plumbing.
- `scripts/cue-strip-smoke.mjs --pitch-only=man,woman` (phone viewport):
  108 / 108. Its synthetic held vowel: with the gate on the pitch row is
  never live (0 of 31 samples; FireRedVAD scores clean synthetic hums low,
  as the screen found) while the resonance row stays active (31 of 31); the
  smoke records that, then switches the gate off for its resonance checks
  and back on afterwards.
- `npm run lint`, `npm run test:unit` (50 / 50), `npm run build` green; the
  detector also loads under `npm run dev` in the worktree.

## Known differences from the screen (for the confirmation to settle)

- **Resampler:** the detector reads the app's linear 48 → 16 kHz resampler
  (no anti-alias filter); the screen fed scipy polyphase audio, and its
  noise clips were 16 kHz at the source. On the tuning clips this path
  removes more (86.9 vs 79.8 %, above); what it costs voices is not
  measured.
- **Frame availability:** a frame is used as soon as its 400 samples arrive
  (25 + 10 i ms); the screen declared 26 ms for every stream. On the parity
  fixture this changes 1 of 720 hops (the first).
- **Cold start:** the model's first outputs from a zero state are about
  0.58, so the gate opens at the first hops and stays open for its 2 s
  hangover after Start (the screen started every stream the same way).
- **Model load:** hops before the model is ready (well under a second
  locally) carry no decision and are not gated; the waiting frames are then
  scored and replayed, so later decisions equal a run from the start.
- Desktop only; phone CPU and the mobile WASM path are not measured.

## How to turn it off

Settings → "Hide pitch when no voice is heard (experimental)" → off (kept
across reloads). Without the model files the gate is off by itself.
