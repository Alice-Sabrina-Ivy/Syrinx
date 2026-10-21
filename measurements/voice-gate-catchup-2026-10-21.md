# Voice gate: catch-up after the model loads (2026-10-21)

Branch `voice-gate-followup`. Review finding (LOW): the voice-gate smoke
failed one check, "catch-up after the model loads: every hop's detector time
< 25 ms" (10 hops, max 45.7 ms, CPU about 80 % busy). Since the model now
comes from Hugging Face, the first load is slower, so more audio waits in the
detector's backlog (up to its 4 s cap) and more hops run at the catch-up cap
(`CATCHUP_FRAMES` = 50 frames per hop, [src/dsp/firered-vad.js](../src/dsp/firered-vad.js)).
Each such hop adds to the pitch worker's lag estimate; past 0.5 s the worker
switches the detector off for the session ("slow"). Phone CPU is unmeasured.

## Plan (committed before any result)

**Question.** How far behind real time does the first-use catch-up put the
pitch posts, on this desktop and on a slower CPU? Is the cap of 50 frames per
hop too high?

**Method.** `scripts/firered/catchup-lag.mjs` (Node, onnxruntime-web WASM,
one thread — the app's runtime build; the real model from
`build/models/firered/`; the real `createVoiceDetector`):

- Input: synthetic 16 kHz audio (white noise plus a harmonic tone). The
  model's cost does not depend on the content.
- Backlog before the model is ready: 1, 2 and 4 s (4 s = the cap, the worst
  case). Hops of 25 ms (400 samples) go through `pushAudio` + `noteHop`
  meanwhile, as in the worker.
- Then `setModel`, and per hop `pushAudio` + `await hop(t)`, timed with
  `performance.now()`, until the first decided hop and 20 hops more.
  Five repeats per setting; per hop the median over repeats.
- Caps K = 50 (current), 30, 20, 15, 10.
- Slower CPUs are modelled by scaling each hop's time by m = 1, 2, 3, 4.5
  and 6 (4.5 = the largest desktop:mobile WASM ratio in CLAUDE.md), plus
  0.25 ms × m for the pitch part of the hop. The lag is the worker's own
  estimate (`noteLag`: lag = max(0, lag + busy − 25 ms) per hop).
- Reported: peak lag during the catch-up, the worst single hop (× m), and
  the catch-up length (hops until the first decision × 25 ms).
- Machine load noted at the time of the run.

**Criteria** (4 s backlog):

- C1: at m = 4.5 the peak lag is ≤ 0.25 s (half the 0.5 s switch-off).
- C2: at m = 2 (a busy desktop) the worst single hop is < 25 ms (the
  smoke's check).
- C3: at m = 1 the catch-up ends within 1.0 s of audio.

**Decision rule.** Keep K = 50 if it meets C1 and C2. Otherwise use the
largest K in the grid that meets C1–C3. If none does, report it and keep 50
for the user to decide. A different K changes only when the first decision
comes, not any decision (the backlog is scored the same way; the module
header explains why every decision after the catch-up equals a run from the
start). Then: the unit tests, and one run of `scripts/voice-gate-smoke.mjs`
on the built app.
