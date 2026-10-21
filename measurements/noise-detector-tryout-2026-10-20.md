# Noise-detector try-out: FireRedVAD pitch gate (design note, 2026-10-20)

**Merged into `cue-strip` on 2026-10-21** (user decision: "works well enough
in my limited testing"), together with the resonance-row gate and an HNR
display gate, and with a plan for hosting the model — see "Merged into
cue-strip (2026-10-21)" below. The confirmation it waited for passed
([firered-confirmation-2026-10-21.md](firered-confirmation-2026-10-21.md),
CONFIRMATION: PASS). **Follow-up the same day** (branch
`voice-gate-followup`, section "Follow-up (2026-10-21)" below): the
resonance row follows the gate, the HNR readout keeps its 5 s silence hold,
the model loads from the pinned Hugging Face mirror, and the session oracle
runs the gate. The rest of this note is the try-out as built on
2026-10-20; where it disagrees with the merge section, the merge section
wins, and where the merge section disagrees with the follow-up, the
follow-up wins.

**Historical (superseded 2026-10-21):** Branch `noise-detector-tryout` (from
`cue-strip`). A **try-out build for the PC**, not a ship: the user decided on
2026-10-20 that blanking some held notes / sustained vowels is acceptable for
now and asked for a build to try next to a proper confirmation run. The
confirmation is separate work (pre-registered on branch `voice-detector`,
`measurements/firered-confirmation-2026-10-21.md`); nothing here replaces it.

## Follow-up (2026-10-21)

Branch `voice-gate-followup` (from `cue-strip` 1a1713f), after the merge's
review:

- **Resonance row follows the gate** (user decision: "make the resonance row
  not react to noise"). Both cue-strip rows now take their state from the
  pitch display's own flags `pitchVoiced` / `pitchHolding`
  (`cueStripModel.js` `cueRowStates`); the resonance row read the raw
  voiced / holding until then. Measured first,
  [voice-gate-resonance-row-2026-10-21.md](voice-gate-resonance-row-2026-10-21.md)
  (ROW GATE: GUARDS PASS): on noise only the row leaves "idle" 7.0 % of the
  time instead of 33.3 % (78.8 % less), "keep talking…" 4.0 % instead of
  26.9 %, a drawn dot 3.0 % instead of 6.3 %; never more on any noise
  stream; speech keeps the same state on 99.9 / 100.0 % of the time (women
  / men) with the same positions; no held vowel gets a new drawn position.
  A held vowel the detector hides now reads "—" (the row cannot tell a
  hidden hold from silence), not "keep talking…". That note also corrects
  the resonance note's wording (the 73 % was the worker's stored position,
  not the drawn dot: drawn dot −68.8 %). The strip's caption ("Start
  speaking — …") follows the same flag.
- **HNR readout** (user decision): in the 5 s silence hold it keeps the last
  value it showed, like the dim pitch readout, also once the detector says
  "no voice" ~2 s into the silence; "—" there only when the gate hid painted
  pitch after that value (`gateHidPaintRef`, the pitch readout's own
  exception). Review fix 2026-10-21: the held value is `shownHnr`, the last
  HNR the readout showed; before, noise the gate hid with an HNR but no
  painted pitch line could leave its HNR to show in the hold.
  Elsewhere unchanged: "—" on frames the gate hides; recorded frames keep the
  measured value.
- **Model hosting: the mirror is pinned.** `FIRERED_MODEL.mirrorCommit` =
  `7128fcfded226bac7b4852014c1c3caa88c80f07`
  (`Alice-Sabrina-Ivy/fireredvad-stream-vad-onnx`, both files byte-identical
  to the upstream commit, uploaded and verified by the repo owner; CORS
  allows the Pages origin). The pitch worker loads both files from
  `https://huggingface.co/<mirror>/resolve/<commit>/` through
  `loadVerifiedModel` (Cache Storage copy first, size + sha256 checked). No
  build carries a copy any more. `scripts/fetch-firered-model.mjs` stays for
  Node only — the parity test, the session oracle's `--voice-gate` option and
  the voice-gate drivers — and now writes to `build/models/firered/`
  (gitignored, outside `public/`, so a local build never ships it). Offline
  development of the app: `--out=public/models/firered` with `mirrorCommit`
  set to `null`.
  Checked in the built app (desktop Chrome, `scripts/voice-gate-smoke.mjs`,
  fresh profile, no local model files in `dist/`): both files requested at
  the pinned commit (the ONNX file redirects to Hugging Face's CDN, `cmvn.ark`
  to its resolve cache), none from the app's own server; the detector
  "ready" (size + sha256 passed); both files in Cache Storage
  (`syrinx-voice-detector-onnx` / `-cmvn`) with the pinned sha256, read back
  in the page; after a reload the detector is ready with no request for the
  ONNX file; with the Hugging Face hosts unreachable Settings says "Off: the
  voice detector could not load, so pitch is shown as before." and nothing is
  hidden; the gate hides the noise line as before.
- **Session oracle** (`scripts/session-oracle/`, `--voice-gate`): the
  merge's regression run used an uncommitted driver; `run.mjs` and
  `corpus.mjs` now run the real FireRedVAD model in the real pitch worker
  and drive the real hook with its decisions, gate on vs off, from one
  worker run. On vocadito it reproduces the merge's numbers exactly (every
  cell identical without the option / gate off / gate on; 31 222 / 1 228 / 0
  decisions; false painting on reference-unvoiced hops 52.56 → 51.81 %).

## Merged into cue-strip (2026-10-21)

Branch `firered-merge` (from `cue-strip` 8e7252a): `noise-detector-tryout`
and `noise-detector-tryout-res` merged; conflicts only in the third-party
notices script / test (Voice Shaper's WORLD / Emscripten components next to
FireRedVAD's model licence: both kept) and the hook's imports (both kept).

**Decision data** (now in this branch's `measurements/`, copied from branch
`voice-detector`):
[offtheshelf-screen-2026-10-20.md](offtheshelf-screen-2026-10-20.md) (the
screen and the relaxed-rules addendum that picked the R1 h point) and
[firered-confirmation-2026-10-21.md](firered-confirmation-2026-10-21.md)
(fresh public data, every gate passed: 80.6 % of the false pitch line removed
on fresh noise — 86.9 % without one mislabelled interview clip — and 79.2 % on
held-out B; speech ≤ 0.2 % and songs 0 % blanked; mixes ≤ 1.4 %; clean held
voices ≤ 1.9 % on short (≤ 5 s) holds — long clean holds were not re-measured
(the screen's last 10 s of long clean holds: 15.6 / 29.0 % blanked, women /
men); onset delay 0 ms; desktop browser CPU 0.85 ms per 25 ms. Costs
it names: held voices in loud noise — up to 8 % of fresh notes at 0 dB, about
20 % for men's held series and up to 44 % for men's sustained /a/ in the old
mixes — and the false line right after speech, which stays for the 2 s
hangover: only 14–28 % of it is removed in the first 2 s).

**What changed with the merge:**

- **Resonance row** (user decision 2026-10-21): the hook sends the resonance
  worker a pitch hint with `voiced: false` on every hop the detector calls
  "no voice" while the setting is on; `pitch` / `contextTime` unchanged; no
  decision (loading / unavailable / off / slow) or the setting off: the hint
  as before. Exactly the measured variant of
  [noise-detector-tryout-resonance-2026-10-21.md](noise-detector-tryout-resonance-2026-10-21.md):
  73 % less noise-only position time (the pre-set bar was 80 % — built
  anyway), speech unchanged, held vowels still excluded. The worker keeps a
  position it already has (it freezes; it does not clear); the row draws it
  only while the pitch display is voiced or holding.
  **Historical (superseded 2026-10-21, follow-up):** The row's own
  voiced / holding flags stay raw (the DSP gate), so on noise the detector
  hides the row reads "keep talking…" with no position (the smoke's
  air-conditioner clip: no position, states warming / idle), and a held
  vowel the detector hides reads "keep talking…" instead of "needs running
  speech". Masking those flags would be a separate change with its own
  measurement.
- **HNR readout** (user decision 2026-10-21): the cue strip's "HNR … dB"
  showed noise-derived values with no one speaking. It shows "—" while the
  gate hides (**historical (superseded 2026-10-21, follow-up):** also during
  the 5 s silence hold once the detector says "no voice", ~2 s into a
  silence, while the dim pitch readout keeps its 5 s).
  Display only: `dsp-worker.js` computes HNR as before, recorded frames keep
  the measured value, and speech keeps its HNR as the confirmation keeps
  speech (≤ 0.2 % of speech hops blanked).
- **Model hosting** (user decision 2026-10-21), as the Silero speech
  detector (`src/ml/speech-detector.js`; [low-voice-noise-2026-10-07.md](low-voice-noise-2026-10-07.md)
  "Model hosting"): `FIRERED_MODEL.mirror` =
  `Alice-Sabrina-Ivy/fireredvad-stream-vad-onnx` (files
  `fireredvad_stream_vad_with_cache.onnx`, `cmvn.ark`, `LICENSE`,
  `README.md`), uploaded by the repo owner (pinned in the follow-up above).
  Once `FIRERED_MODEL.mirrorCommit`
  holds the mirror's commit, the pitch worker loads both files from
  `huggingface.co/<mirror>/resolve/<commit>/` through `loadVerifiedModel` (a
  Cache Storage copy first — HF's `/resolve/` redirect is `no-store` — one
  cache per file, sha256 checked, plus the size check). **Historical
  (superseded 2026-10-21, follow-up):** Until then
  `mirrorCommit` is `null` and the files load from the app's own
  `models/firered/` exactly as in the try-out (`scripts/fetch-firered-model.mjs`,
  a developer step). To switch: upload the two official files byte for byte
  (same sha256 as pinned), put the commit in `mirrorCommit`, and check the
  built app loads the detector ("ready"); `tests/dsp/firered-model-hosting-test.js`
  checks the URL shape, the cache and the failure paths with mocks.
- **Plain failure text:** any load failure (not there, wrong size, hash
  mismatch, network) is status `unavailable` (was `missing`); Settings says
  "Off: the voice detector could not load, so pitch is shown as before." No
  user-facing text names a developer command any more; the technical reason
  is in the diag overlay. Error / slow say the same "pitch is shown as
  before".
- **Settings text:** "A voice detector hides the pitch line, Hz / note,
  steadiness and HNR while it hears no voice, such as a fan or hum alone, and
  keeps most of that noise out of the resonance reading. It can blank parts
  of long held notes and vowels, more in loud noise, and noise can still show
  for about 2 s after you stop speaking." (Review 2026-10-21: "most of" —
  73 % less noise-only position time, and the worker keeps a position once it has one;
  "long held notes and vowels" — the long-hold cost below was not
  re-measured.) The switch keeps its label "Hide pitch when no voice is heard
  (experimental)", on by default; the text under it lists what it also hides.

**Tests added:** `tests/audio/voice-gate-resonance-hint-test.js` (real hook
`start()` relay with fake workers: no-voice hops reach the resonance worker
unvoiced, pitch / contextTime / ML / DSP hints unchanged, setting off /
unavailable / slow = today's hints, init names the model source; fails on the
pre-merge hook), HNR checks in `tests/audio/voice-gate-display-test.js` (fail
on the pre-merge hook), `tests/dsp/firered-model-hosting-test.js` (both
sources with mock fetch and Cache Storage; a hash mismatch, wrong size, 404 or
network error -> unavailable; the real pitch worker's loader on both sources;
plain status text). `scripts/voice-gate-smoke.mjs` now also checks, on the
committed air-conditioner clip, that with the gate on from the start the
resonance row gets no position (and, in a fresh run with the gate off, that
it does get one — the case is real), that the HNR readout shows "—", and the
plain "unavailable" text.

**Checks (2026-10-21, branch `firered-merge`, desktop Chrome):**

- `npm run lint` clean; `npm run test:unit` 67 / 67 scripts (incl. the new
  hosting and resonance-hint tests); `npm run build` green. FireRedVAD parity
  with the model fetched: 21 / 21 (probabilities within 3.0e-7 of the Python
  runner, decisions equal to score.py on all 720 hops).
- `scripts/voice-gate-smoke.mjs`: **24 / 24**. Committed air-conditioner
  clip: gate on hides the pitch line (0 of 313 painted frames shown), the
  resonance row gets no position over 20 s with the gate on from the start
  (0 of 76 samples), while a fresh run with the gate off gets one (first at
  12.8 s; 10.3 s in an earlier run), and the HNR readout shows "—" on 64 of
  64 samples after 3 s (gate off: a number on 44 of 46). Speech: 411 / 411
  painted frames kept. VocalSet long tones: 0 of 749 hidden. Model files
  removed: Settings says "Off: the voice detector could not load, so pitch is
  shown as before.", status `unavailable`, nothing hidden. Detector CPU
  1.2 ms median / 2.1 ms p95 per 25 ms hop; the catch-up hop after the model
  loads at most 19.3 ms. (An earlier run with the machine at 100 % CPU from
  other work failed only that catch-up check, 36 ms, with the detector median
  at 2.7 ms; the catch-up code is unchanged by the merge.)
- `scripts/cue-strip-smoke.mjs --pitch-only=man,woman` (phone viewport):
  110 / 110.
- `scripts/voice-preview-smoke.mjs` (Voice Shaper, all viewports): 304 / 304.
- `scripts/resonance-lab/lab-layout-smoke.mjs`: 63 / 63.
- `tests/site/no-local-paths-test.js`: pass.

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
    promise chain. Without a model the worker is synchronous and identical
    to before; the Node harnesses that drive it (session oracle, above-range
    test, resonance parity) never load the detector.
  - **Lag safeguard:** if the worker's own work puts the pitch messages
    more than 0.5 s behind real time, the detector switches itself off for
    the session ("slow"; Settings says so) rather than delay the pitch. The
    lag is a queue estimate: each chunk adds its handling time (wall clock,
    from the start of its handling to its post) and subtracts its own audio
    length, floored at zero. So a main-thread stall that delivers chunks
    late and in a burst, lost capture audio or audio-clock drift does not
    count — only the worker being slower than the audio. (Until the
    2026-10-20 review it counted chunks waiting in the chain; that count
    never goes above 1, because `run` finishes without yielding to the
    event loop, so a detector slower than real time just delayed the
    display without limit.)
- **Gate** (`createVoiceGate`): screen.py's / score.py's definitions exactly —
  trailing mean of the last 5 frame probabilities (float64 running-sum
  difference, rounded to float32), "on" when the newest available frame's
  score ≥ 0.55 (0 before the first frame), voice while a hop within the last
  2 s was on. A frame counts as available by the screen's own timing rule
  (`framesAvailableAt`: frame i from 26 + 10 i ms, the screen's
  `first_avail_ms` 26), so the app makes the decisions the screen scored,
  hop for hop.
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
  History shows the same gaps. **Silence:** the dim held Hz / note readout
  keeps its 5 s silence hold as without the gate (the detector's "no voice"
  2 s into a silence does not clear it); only when the gate hid painted
  frames after the held value does it show "—" instead (the held value
  would be older than what the chain last drew).
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
  runner's (limit 1e-3); the gate decision equal to score.py's (the
  screen's 26 ms frame timing, `gate["26"]`) on all 720 hops — the old
  25 ms timing fails that comparison — also when the model arrives at hop
  1, 37, 60, 300 or 700 (at 300 and 700 more than the 4 s backlog had
  waited; caught up within 9 hops, at most 50 frames per model call), and
  a 1 s backlog cap (shorter than the model's memory) fails it; two broken
  front ends (no pre-emphasis; samples not scaled to the int16 range) and a
  0.97 → 0.9 pre-emphasis edit of the module all fail it. The model part
  skips with a notice where the model is not fetched (CI); the front-end
  and gate parts always run.
- `tests/dsp/firered-vad-gate-test.js` (state machine, frame timing vs
  score.py's formula, front end, CMVN parser, backlog cap and per-hop
  catch-up) and `tests/audio/voice-gate-display-test.js` (the REAL hook:
  hidden frames empty; every other output, the recorded voiced / f0 and
  every unhidden frame's painted value bit-identical to the run without
  decisions; setting off = no change; the silence hold after speech
  unchanged, "—" after a hidden line).
- `tests/dsp/pitch-worker-vad-test.js` (the REAL pitch worker in Node with
  a fake model through its test seam `setVadModelLoaderForTests`): a model
  slower than real time (40 ms per hop) switches the detector off as
  "slow" after 28 pitch messages, about 0.8 s of audio, and every later
  message carries no decision, none lost; 10 ms per hop, a 3 s burst of
  chunks (as after a main-thread stall) and a fast model never trip it; the
  model arriving after 20 s is caught up within 9 hops at ≤ 50 frames per
  call and ≤ 8.2 ms of detector time per hop; the posted pitch is
  bit-identical to the worker without the detector. Disabling the lag
  estimate fails 4 of its checks.
- `scripts/firered/tune194-replay.mjs` — the JS detector + gate (ORT-web
  WASM in Node, 400-sample hops) on the screen's tuning-194 noise clips,
  scored on the benchmark dumps' falsely painted hops exactly as the screen
  counts them: **79,223 false hops (the screen's count), 79.76 % removed
  (the screen: 79.8 %)**; per class stationary-tonal / mixed / broadband /
  intermittent-tonal 75.9 / 84.8 / 79.4 / 74.5 %, the screen's numbers. With
  the screen's frame timing this is the screen's own result: the review's
  re-score of the screen's probabilities with its 26 ms rule gives 63,187
  removed hops, 79.758 %, and the JS detector gives the same hops (with the
  1 ms earlier timing used until the review: 79.85 %, different decisions
  on 22 of 194 clips, mostly at the start). The same clips band-limited to
  48 kHz and passed through the app's linear 48 → 16 kHz resampler (what
  the detector reads from a 48 kHz microphone): 87.0 % removed
  (86.0 / 90.3 / 76.1 / 84.7). Selection data, information only.
- `scripts/voice-gate-smoke.mjs` (built app, headless desktop Chrome, fake
  mic, two runs before the review, one after; 19 / 19 after it):
  air-conditioner noise (the committed CC0 clip) — the gate hid all 178
  (after the review: 162) painted frames after the first 3 s (switched off:
  0 of 460 frames differ from the chain; on again: all hidden); LibriSpeech
  speech — 426 of 426 (411 of 411) painted frames kept; VocalSet long tones
  (2.75–3.5 s holds) — 0 of 749 hidden; model files removed — Settings says
  so, nothing hidden; no page or console errors. **Detector CPU in the
  pitch worker, desktop Chrome: 1.0–1.2 ms median, 1.3–1.9 ms p95 per 25 ms
  hop** (about 2,770–2,950 hops per run; worker timer at 0.1 ms resolution;
  the pitch detector itself 0.3–0.4 ms median). Since the review the smoke
  also times the hops that catch up on the frames that waited for the
  model: 1 hop per run here (the model loads in well under a second), at
  most 14.7 ms, under the 25 ms the check allows. With a tuning clip
  FireRedVAD hears as voice (Freesound HVAC 121285: no "no voice" hop even
  on its native 16 kHz samples) the gate hides only 13–25 % of that clip's
  line — the detector, not the plumbing.
- `scripts/cue-strip-smoke.mjs --pitch-only=man,woman` (phone viewport):
  110 / 110. Its synthetic held vowel: with the gate on the pitch row is
  live on 0 of 31 samples (FireRedVAD scores clean synthetic hums low,
  as the screen found) while the resonance row stays active (31 of 31);
  since the review the smoke checks both (pitch row live on ≤ 10 % of the
  samples while the detector runs — the documented cost, kept visible; the
  resonance row active on ≥ 80 %), then switches the gate off for its
  resonance checks and back on afterwards.
- `npm run lint`, `npm run test:unit` (51 / 51), `npm run build` green; the
  detector also loads under `npm run dev` in the worktree.

## Known differences from the screen (for the confirmation to settle)

- **Resampler:** the detector reads the app's linear 48 → 16 kHz resampler
  (no anti-alias filter); the screen fed scipy polyphase audio, and its
  noise clips were 16 kHz at the source. On the tuning clips this path
  removes more (87.0 vs 79.8 %, above); what it costs voices is not
  measured.
- **Cold start:** the model's first outputs from a zero state are about
  0.58, so the gate opens at the first hops and stays open for its 2 s
  hangover after Start, as in the screen's runs (with the screen's frame
  timing the app's first hops are the screen's, decision for decision).
- **Model load:** hops before the model is ready (well under a second
  locally) carry no decision and are not gated. The audio that waited, the
  last 4 s at most, is then scored at most 50 frames per hop, with no
  decision until it has caught up (within 9 hops); the later decisions
  equal a run from the start, because 4 s holds more than the model's
  152-frame memory, the smoothing and the 2 s hangover.
- Desktop only; phone CPU and the mobile WASM path are not measured.

## Changes after the review (2026-10-20)

A review of the branch at 7bb6d72 (read-only, its own probes) found one
medium and two low problems and three information items. All six were
taken:

1. **The "slow" switch could never fire** (medium). It counted chunks
   waiting in the chain, which never exceeds 1 (above, "Lag safeguard"); a
   40 ms-per-hop slowdown in the built app left the display about 8 s
   behind and growing with the detector still "ready". Now a lag estimate
   from the worker's own handling time. Built app, headless Chrome, the
   review's probe changed to busy-wait 40 ms only on the pitch posts that
   carry a decision (a detector too slow for the device): switched off as
   "slow" at 0.51 s of estimated lag within the first 5 s, after which the
   pitch messages run at real time again (40.2 per second against 40 of
   audio). With the review's original probe (the busy-wait on every post,
   so the whole worker is slow, not only the detector) it switches off the
   same way and the remaining slowness is the worker's own. Main-thread
   stalls of 0.3 / 0.7 / 1.5 / 3 s do not switch it off.
   `tests/dsp/pitch-worker-vad-test.js` drives the real worker with a slow
   fake model.
2. **Frames were used 1 ms earlier than the screen's rule** (low). Now the
   screen's rule; the parity test compares with `gate["26"]` and the old
   timing fails it. The tuning-clip replay now gives the screen's own
   number (above).
3. **One pitch stall when the model loads late** (low): the first ready hop
   scored the whole backlog at once (review: 328 ms after 26 s, ~0.75 s at
   the old 60 s cap). Now the backlog is capped at 4 s and scored at most 50
   frames per hop, with no decision until caught up (within 9 hops); the
   decisions afterwards are unchanged (above, "Model load"). In the browser
   smoke the catch-up hops took at most 14.7 ms of detector time.
4. **The dim held readout cleared after ~2 s of silence, not 5 s** (info):
   the gate cut the silence hold short. Now the hold is as without the gate,
   unless the gate hid painted frames after the held value ("Display mask").
5. **Not deployable as is** (info): see "Before any merge to main".
6. **The cue-strip smoke only logged the held-vowel cost** (info): now a
   check (above).

## Known issue: the resonance row in noise (2026-10-21)

**Historical (superseded 2026-10-21):** built anyway by user decision — see
"Merged into cue-strip (2026-10-21)". Kept as written:

User report: with only PC fans and coil whine, the pitch line is hidden but
the Dashboard's resonance row moves and can show "beyond the scale" — its
pitch hints are not gated (above, "Display mask"). Gating that hint was
measured (`measurements/noise-detector-tryout-resonance-2026-10-21.md`,
branch `noise-detector-tryout-res`): speech and held vowels unchanged, but
noise-only time with a resonance position fell 73 %, short of the 80 % bar,
so it was not built. Most of the rest is the readout keeping a position
once a little noise gets through, plus noise the detector hears as voice.

## Before any merge to main

**Updated 2026-10-21 (follow-up):** the mirror is uploaded and pinned
(`mirrorCommit` 7128fcf…; checked in the built app, section "Follow-up"
above). Still open before `main`: phone CPU and the mobile WASM path are not
measured.

**Historical (superseded 2026-10-21, follow-up):** the developer instruction
is gone (plain "could not load" text), and the hosting is decided — the
Hugging Face mirror, pending its upload. Still open before `main`: upload the
mirror and pin `mirrorCommit` (until then the live site would show the gate
as unavailable, pitch as before); phone CPU and the mobile WASM path are not
measured.

**Historical (superseded 2026-10-21):** Fine for this PC try-out, not for the
live site:

- CI and the Pages deploy do not fetch the model files, so a merge as is
  would ship with the gate always "missing" (nothing hidden; Settings says
  the files are not installed).
- That Settings text tells the user to run
  `node scripts/fetch-firered-model.mjs` — a developer instruction.

Both need fixing first (for example: host the pinned files with the app or
fetch and check them in the workflows, and a user-facing message).

## How to turn it off

Settings → "Hide pitch when no voice is heard (experimental)" → off (kept
across reloads): pitch, HNR and the resonance hint are then exactly as
without the detector. If the model cannot load, the gate is off by itself
and Settings says so.
