# CPU with the "Likely heard as" panel on — 2026-10-07

With the experimental, opt-in "Likely heard as" panel on, the gender worker
runs the q8-v2 ECAPA classifier on a 0.75 s window every 150 ms of scored
speech (~49 ms per inference on desktop at low load), and the resonance
worker's own busy time rose from 44.1 to 51.8 ms per audio second in the
correctness review (contention). The user asked (2026-10-07) to try to reduce
the panel-on CPU, and to ship as is if no change passes. This note
pre-registers the targets, guards and variants **before any code change**,
then records the baseline and every variant tried. Public data only:
LibriSpeech test-clean readers (CC BY 4.0), the Palette of Voices stimuli
(Munson & Dolquist 2025, CC BY 4.0) and synthetic signals.

## 1. Pre-registration (written before any change to src/)

### Metrics

- **Thread CPU per second of audio**, desktop Chrome, the BUILT app under
  `?diag=1`, fake mic = a public LibriSpeech reader (one woman, one man:
  `build/cue-strip-smoke/speech-{woman,man}.wav`, ~72 s each, looped by
  Chrome), `scripts/resonance/chrome-cpu.mjs` (extended in this pass): a
  Chrome trace of 30 s taken after 20 s of listening (and, panel on, after
  the model is ready); per thread, the sum of the thread-clock durations
  (`tdur`) of the outermost scheduler tasks (category `toplevel`), divided
  by the traced span (the fake mic runs in real time, so traced seconds =
  audio seconds). Threads are identified by the script URL of their tasks
  (`gender-worker`, `resonance-worker`, `pitch-worker`, `dsp-worker`) and
  `CrRendererMain` (main thread).
- **App CPU** = main thread + gender + resonance + pitch + DSP workers (the
  sum of the five rows). Also reported: the renderer / GPU / browser
  **process** CPU over the same window (`SystemInfo.getProcessInfo`), and
  the gender worker's inferences per second and median `inferMs`.
- **Resonance worker's own figure** = `resonancePerf.meanMsPerAudioS` (its
  busy time per audio second, session mean, wall clock) — the metric the
  44.1 / 51.8 figures were taken with.
- Runs are interleaved (panel off / on, baseline / variant, woman / man) and
  repeated; the figure per condition is the median over runs. Other jobs
  share the machine (load 70–100 %), which inflates wall-clock figures more
  than thread-clock ones; the panel-off figure from the same session is
  always reported next to the panel-on one.

### Target

1. **Panel-on app CPU reduced by ≥ 30 %** vs the current head (370d107),
   median over the interleaved runs.
2. **Resonance worker panel-on ≤ 45 ms per audio second**
   (`meanMsPerAudioS`). If machine load pushes the same session's panel-off
   figure above 45, the target is read as panel-on ≤ panel-off × 45 / 44.1
   (the review's ratio at ~74 % load), and both numbers are reported.

### Guards (a variant is kept only if it passes all of them)

1. **Palette through the production chain**: the panel's two-way share
   ("man", unsure counted half; the centre of the shown range), per stimulus,
   pooled over the whole stimulus as `scripts/heard-as/run_chain.mjs` does,
   changes by **≤ 1.0 point MAE** vs the current head (240 stimuli). The
   error vs the Palette listeners (head: 6.33 points) is reported too.
2. **Calibration equivalence**: `tests/ml/heard-as-equivalence-test.js`
   passes. Its window-set guard fails by design if the scored-window set
   changes; then the golden file is regenerated
   (`scripts/heard-as/make_golden.mjs` + `golden_check.py`) with the
   justification written here, and the JS-vs-Python aggregate checks
   (≤ 1e-9) must still pass on the new golden file.
3. **Time to first estimate** on continuous public speech (the 40 LibriSpeech
   test-clean readers of the calibration's hide-rule check, each reader's
   utterances concatenated with 0.3 s gaps, through the production chain in
   Node with the panel's 2 s update ticks): the median time to the first
   shown estimate is **not later by > 1 s** than at the head, for women and
   men separately.
4. **Hide rules unchanged**: on a synthetic held vowel (1 s silence + 6 s /a/
   at 200 Hz), pink noise (−30 dBFS), digital silence, and short speech (each
   reader's single utterances of ≤ 2.5 s voiced, followed by silence), the
   panel's hidden / shown state and hide reason at every tick (2 s updates +
   the 250 ms held-note check) are identical to the head's.
5. **Resonance parity unchanged**: `tests/resonance/vtln-production-parity-test.js`
   and `npm run test:resonance-lab` pass unchanged; `npm run lint`,
   `npm run test:unit`, `npm run build` pass.
6. **Gender symmetry**: every guard number is reported for women and men
   separately; a variant that passes for one and not the other fails.

### Variants (every one is reported, kept or not)

- **A. Longer classifier hop while only the panel uses the model** (the meter
  bar is gone; the estimate pools 8 s and updates every 2 s): the utterance
  gate keeps deciding every 150 ms (so held-note detection, voice states and
  span onsets are untouched), but the classifier runs only on a scored window
  at least `hop` after the previous classified one — 300 / 450 / 600 ms. The
  hide rule "≥ 10 scored windows" (which assumed a 150 ms hop) is rescaled to
  the same scored time (10 × 150 ms = 1.5 s, i.e. ⌈1500 / hop⌉ windows) if
  the time-to-first-estimate guard needs it; the 3 s voiced rule is unchanged.
- **B. Skip windows the utterance gate would not score before running
  inference** — check whether the worker already does this.
- **C. ONNX Runtime options**: the non-asyncify WASM build (transformers.js
  4.x loads the asyncify build in Chrome / Firefox, the plain one on Safari),
  graph optimisation level, CPU memory arena, a fixed input shape
  (`freeDimensionOverrides`). Threads: the app is not cross-origin isolated,
  so ORT-web runs single-threaded; not a lever without COOP / COEP headers.
- **D. Shared resampling between workers**: measure the resamplers' cost
  first; pursue only if it is material.
- **E. The resonance worker's own cost**: profile; a bit-exact speed-up is
  kept only with the parity tests unchanged; computing vtln less often would
  change the readout and needs its own tolerance guard — reported, not
  adopted, unless it passes one.

Decision rule: adopt the smallest change set that meets the target with
every guard passing; prefer the shortest hop that does.
