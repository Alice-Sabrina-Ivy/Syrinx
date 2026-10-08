# Main-thread CPU of the listening app — 2026-10-08

Branch `main-thread-perf` (from `cue-strip` adf19c3). Public data only: the
fake microphone plays the LibriSpeech-derived smoke WAVs
(`build/cue-strip-smoke/speech-woman.wav`, `speech-man.wav`, made by
`scripts/cue-strip-smoke-wavs.mjs`). Desktop Chrome 154, headless, on the
development PC.

## 1. Pre-registration (committed before any candidate result)

**Base** = commit 5e26866: `cue-strip` adf19c3 plus measurement tooling and a
diag-only instrumentation of the pitch trace (`diag.noteTraceDraw`, active
only with `?diag=1`; production behaviour identical to adf19c3).

**Harness** = `scripts/main-thread/mt-cpu.mjs`: the BUILT app (`vite
preview`), headless Chrome, direction "Just exploring", 20 s warm-up, then a
15 s Chrome trace. Main-thread CPU = the thread-clock time of the top-level
scheduler tasks on the page's `CrRendererMain`, per second of traced audio
(the fake mic runs in real time), the same method as
`scripts/resonance/chrome-cpu.mjs`. No `?diag=1` for CPU numbers.

### TARGET

Main-thread CPU (ms per audio second, no diag), viewport **1280 × 800**
(DSF 1), cut by **≥ 35 %** against base, **panel off AND panel on** (the
experimental "Likely heard as" panel; on = the gender worker runs).
Statistic: for each panel state, 4 repetitions × {woman, man} WAV, base and
head runs **interleaved** (order alternating per repetition), so 8 runs per
tree; cut = 1 − median(head) / median(base). Both panel states must reach
35 %.

Secondary (reported, not gating): the same at **448 × 890** (DSF 3, mobile
emulation), 2 repetitions × {woman, man}.

### GUARDS (all must pass)

1. **Display latency** — capture → the trace draw that first shows a voiced
   point (diag `paintLatency`, `?diag=1`), 1280 × 800, panel off, 3
   repetitions × {woman, man} interleaved; median of the per-run medians:
   head − base ≤ **+5 ms**.
2. **Trace looks the same** — fixed-input render check
   (`scripts/main-thread/visual-check.mjs`): the real `PitchTrace` of each
   tree mounted with a fixed trace (voiced runs, gaps, an octave-class break,
   values outside the range), a fixed clock stepped at 25 ms data cadence,
   no target and a target band, DPR 1 and 3; the canvas captured at fixed
   clock times. Pass: no pixel differs by more than 8/255 in any channel on
   more than **0.2 %** of the canvas, and none in the axis-label area
   (outside the plot rectangle). Expected: identical.
3. **Scrolls smoothly** — (a) main-thread tasks > 50 ms and long tasks in the
   CPU windows, summed over all TARGET runs: head ≤ base + 1; (b) rAF probe
   (5 s after each CPU window, an own rAF loop): intervals > 50 ms summed:
   head ≤ base + 1; (c) the trace's redraw cadence while listening (diag
   `traceDraws`, guard-1 runs): gap between draws p99 ≤ 50 ms and max ≤
   100 ms, scroll step per draw p99 ≤ 2 CSS px.
4. **Cue strip identical** — fixed-input check (`visual-check.mjs`): the real
   `CueStrip` of each tree with a scripted prop / resonance-snapshot sequence
   and a stepped 250 ms tick, transitions disabled; after every tick each
   row's state, dot, hollow, value, trail length, target range, header text,
   the dot centre and the trail dot centres / opacities are identical
   (positions within 0.01 px).
5. **Readouts identical** — the hook's readout computation (pitch, level,
   note, steadiness, HNR, weight) is not changed (diff review);
   `tests/audio/display-hook-test.js`, `tests/audio/steadiness-test.js` pass.
   A candidate that changes the state cadence fails this guard (it changes
   which values are shown when).
6. **Tests** — `npm run lint`, `npm run test:unit`, `npm run build`, and
   `scripts/cue-strip-smoke.mjs` at all five viewports (phone 448 × 890,
   p402, p360, landscape 890 × 360, desktop 1280 × 800) pass.
7. **No change in worker CPU** — no diff in any worker source (pitch, DSP,
   resonance, gender, lab workers and the modules only they import), and the
   median worker thread CPU of the TARGET runs within ±15 % of base (machine
   noise; the workers vary ±25 % run to run on this PC).

Women and men are reported separately for every number.

### CANDIDATES (all reported)

- **K1 cheap trace draw** — `PitchTrace` computes DPR / canvas size / plot
  geometry once per draw (not per point: `canvas.width`, `canvas.height`,
  `devicePixelRatio` are DOM reads); no `getBoundingClientRect` per frame
  (DPR changes caught by a `matchMedia` resolution listener + the
  ResizeObserver); background, grid, labels and target band cached in an
  offscreen canvas (rebuilt on size / DPR / target change) and blitted;
  no per-frame closures / font strings.
- **K2 redraw on new data** — no continuous rAF loop: the hook notifies the
  trace when it appends a point (one rAF per notification burst), plus a
  fallback timer that keeps it scrolling if data stops while mounted.
- **K3 incremental bitmap** — shift the previous trace bitmap by whole device
  pixels and draw only the new segment (requires a pixel-quantised clock).
- **K4 OffscreenCanvas in a worker** — evaluated only if the trace's own
  JS after K1 + K2 is still ≥ 15 ms/s on desktop.
- **K5 cue-strip dots off the main thread** — the moving dot (200 ms
  ease-out transform transition, today an SVG circle: SVG transitions run on
  the main thread at the display rate) drawn as a composited HTML element
  over the SVG with the same geometry and transition; rows memoised so a row
  re-renders only when its own inputs change.
- **K6 other main-thread transitions** — the voice-status dot
  (`transition-all`: background colour + box-shadow, main thread) made
  compositor-only with the same colours.
- **K7 React work** — skip a state update whose values are all unchanged;
  memoise subtrees whose props did not change; pure computations out of
  render. (Lowering the 5 Hz state cadence is reported, not adopted: guard 5.)

### DECISION RULE

Ladder on 1280 × 800, panel off, 2 repetitions × {woman, man} interleaved
against the previous rung: base → K1 → K1+K2 → +K7 → +K5 → +K6 → +K3.
K1 + K2 are the core. Each later candidate is kept only if its increment cuts
the median by ≥ 3 % of base and it passes guards 2–5. K4 per its condition.
The adopted combination = the kept rungs; it is then run under the full
TARGET protocol (panel off and on) and every guard. Adopt only if the TARGET
is met with every guard passing; otherwise report the miss and do not adopt.

### Base attribution (profiling before any change; noisy single runs)

Headless Chrome on this PC produces frames at ~152 Hz (no vsync cap), and
the trace's rAF loop asks for every one, so per-frame costs dominate:

| | desktop 1280 × 800 | phone 448 × 890 |
|---|---|---|
| main thread, panel off (woman / man) | 292 / 270 ms/s | 269 / 224 ms/s |
| main thread, panel on (woman / man) | 222 / 306 ms/s | 200 / 265 ms/s |
| main frames | 150–153 /s | 150–153 /s |

(Runs of the same build differ by ±20 % on this PC — other jobs share it;
the worker threads vary the same way. Hence medians of interleaved runs.)

Where it goes (desktop, panel off, woman; trace-event attribution of the
non-minified base build, ms per audio second):

- **Pitch-trace drawing (rAF `draw`) 85–98 ms/s JS**: `timeToX` + `hzToY`
  ~35 ms/s (each call reads `canvas.width` / `canvas.height` /
  `window.devicePixelRatio` — DOM getters — ~600 points × 2 calls × 152
  frames/s), `getBoundingClientRect` 17–26 ms/s (the per-frame DPR guard
  forces a style / layout check), the loop itself 16–19, `fillText` 3.5–5,
  other canvas calls ~10.
- **Rendering every frame** (style, layout, pre-paint, paint, commit):
  ~110–130 ms/s — Paint 25–31, Commit 24–26, style recalc 13–15, pre-paint
  11–13, layout 7–8, compositing inputs 6–8, layerize 6, animations 4–6.
- **React** (scheduler work) ~5 ms/s JS, plus the style / paint its DOM
  updates and CSS transitions cause.
- **Capture + messages** (the MSTP reader loop on the main thread, chunk
  copies and posts to the workers, worker `onmessage` handlers, microtask
  checkpoints): ~25 ms/s — the floor without moving capture off the main
  thread (deferred: Chrome has no worker-scope MSTP).

Ablations (attribution only, not candidates; desktop / phone, panel off,
single runs): no trace loop → 88 / 122 ms/s, 83–85 main frames/s; also no SVG
dot transition → 96 / 80 ms/s, 60–67 frames/s (the voice-status dot's
background / shadow transition and React updates keep frames coming); also
no React state updates and no cue-strip tick → 28 / 24 ms/s, 0 frames/s.
An own rAF loop alone (the earlier probe design) costs ~25 ms/s at 152 Hz —
an idle rAF loop is not free.
