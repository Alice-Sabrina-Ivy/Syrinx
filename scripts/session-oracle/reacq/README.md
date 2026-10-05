# Display re-acquisition harness (2026-10-04)

Measurement tooling behind
[measurements/pitch-display-reacquire-2026-10-04.md](../../../measurements/pitch-display-reacquire-2026-10-04.md).
Built on the session oracle (`../lib/chain.mjs`, `../analyze.py`). Run everything from the repo
root with `node --import ./scripts/session-oracle/lib/register.mjs`. Outputs go to the
gitignored `build/`.

The display chain (`useAudioPipeline.js` `handleAnalysisResult` + `pitchGate.js` +
`pitchSmoothing.js` + `pitchPaintGate.js`) consumes only the pitch worker's messages and the DSP
worker's intensity. So the workers run once per stream (`cache.mjs`), and any number of display
variants replay through the **real** hook in about a second per session (`replay.mjs`). Parity:
replay = `run.mjs` on every column (0 / 117 577 hops on 2026-06-09), and = `corpus.mjs` on FDA /
vocadito.

| file | role |
|---|---|
| `cache.mjs` | real pitch + DSP workers over sessions / corpora (`--set=corpus --corpus=… --shard=i/n`) / a WAV dir. Writes `build/reacq/cache/<set>/<name>.{bin,json}`: per-chunk message pitch/confidence, intensity, the run.mjs detection columns, plus observation-only octave-ambiguity margins of the decoded candidate (`ambH` = r(d) − best r within ±1 st of d/2, `ambD` for 2d) |
| `replay.mjs` | drives the real hook of `--src` (default `build/trees/reacq-var/src`) over a cache. `--set=sessions` writes run.mjs-format tables to `build/session-oracle/runs/<tag>/` (mix + alice-only passes, plus gate-trace columns `g_*` / `gA_*`) for `analyze.py`. `--set=corpus` writes corpus.mjs-format JSON (+ `.ev` event counts). `--set=group` writes per-stream tables for synth/noise. `--pgv=JSON` = variant config |
| `pitchPaintGate.param.js` | parametric copy of the 5ebe609 gate. An empty config reproduces it bit-exactly; the knobs are listed at the top of the file |
| `make_tree.py [REV]` | builds `build/trees/reacq-var/src` = `git archive REV src` + the parametric gate + four inert hook edits: resetSegment reason, gate inputs, `smResetGap` median-restart knob (+ `smSeed`: seed a restarted/empty buffer with the value; `smCondSemi`: restart only on a value that many semitones from the buffer median — review fix, §10) |
| `sweep.sh VARFILE [P]` / `csweep.sh` | replay + `analyze.py --quiet` per variant line (`tag json`); corpus replays |
| `summ.py BASE TAG…` | one-line headline per variant (`--corpus` adds the corpus guard rows) |
| `attr.py TAG` | attributes Alice target frames and every L→T / T→L switch to the gate branch that blocked them; content and wall-clock switch latency |
| `runs_feat.py TAG` | profiles every off-level run (genuine vs octave error by the cons reference) by candidate arming features |
| `sfv.py TAG…` | real-session false voicing (`session_fv.py` of `pitch-low-register-precision`, on run tables) |
| `brk.py TAG…` | classifies octave-class line breaks against the reference |
| `realval.py TAG…` | invariant check: painted hops whose value is not one of the posted detections of the last 40 hops (the even-length median mean; §10) |
| `drills.mjs` | frame-level synthetic drills through the real hook (`--variants='name=JSON;…'`, `--groups=`) |
| `drillsum.py` | compact drill comparison |
| `synth_eval.py synth|noise TAG…` | scores the 2026-10-03 audio-level synthetic voice and noise-only WAVs (`--set=group` replays) |
