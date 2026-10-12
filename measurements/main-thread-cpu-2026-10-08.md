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

## 2. Results (after the pre-registration)

**Verdict: TARGET met, every guard passes → adopted** (K1 + K2 + K5 + K6;
K7 rejected by the rule; K3 / K4 not built, see §2.2). Branch head 4f900c9
(the measured build is 7d16843; 4f900c9 only moves the hook's trace-listener
set from a `useState` to a `useRef` — no browser-side difference — and adds
tests / comments).

### 2.1 TARGET (main-thread CPU, no diag, ms per audio second; median of interleaved runs)

| | base | head | cut |
|---|---|---|---|
| **1280 × 800, panel off** (8 / 8 runs) | 237.3 | 88.4 | **−62.8 %** |
| — woman / man | 238.7 / 235.8 | 89.8 / 86.8 | −62.4 / −63.2 % |
| **1280 × 800, panel on** (8 / 8 runs) | 260.8 | 105.9 | **−59.4 %** |
| — woman / man | 262.3 / 253.8 | 98.0 / 110.1 | −62.7 / −56.6 % |
| 448 × 890 DSF 3, panel off (secondary, 4 / 4) | 244.1 | 90.6 | −62.9 % (woman −62.7, man −61.3) |
| 448 × 890 DSF 3, panel on (secondary, 4 / 4) | 258.6 | 101.6 | −60.7 % (woman −62.8, man −58.1) |

Per-run values (1280 × 800): panel off base woman 205.1 / 237.2 / 240.2 / 242.9,
man 233.1 / 234.3 / 237.3 / 237.5; head woman 81.1 / 88.6 / 91.0 / 92.8, man
80.5 / 85.3 / 88.2 / 90.3. Panel on base woman 246.5 / 260.4 / 264.1 / 271.4,
man 236.2 / 246.4 / 261.1 / 268.4; head woman 96.4 / 97.9 / 98.0 / 108.9, man
104.8 / 107.0 / 113.3 / 113.9. Main frames produced: 152–153 /s → 77–83 /s.

### 2.2 Ladder (1280 × 800, panel off, 2 × {woman, man} interleaved per rung)

| rung | median ms/s (runs) | increment (% of base) | kept |
|---|---|---|---|
| base | 199.2 (185.6, 212.7, 263.3, 178.3) | — | |
| K1 cheap draw | 173.3 (199.2, 148.7, 197.8, 148.9) | −13 % | core |
| K1 + K2 redraw on data | 105.1 (117.4, 109.2, 94.4, 100.9) | −34 % | core |
| K2 again (2nd session) | 87.7 (96.5, 86.0, 81.5, 89.4) | | |
| + K7 React | 95.6 (95.2, 99.5, 96.0, 87.4) | +4.0 % (no cut) | **no** — reverted (7f3d4f1) |
| + K5 cue dot / memo rows (on K7) | 78.4 (71.3, 78.8, 77.9, 90.1) | −8.6 % | yes |
| K1 + K2 + K5 (K7 reverted) | 78.5 (79.1, 78.0, 76.3, 89.7) | | |
| + K6 status dot / heard-as ring | 58.5 (59.2, 57.8, 68.5, 57.0) | −10.0 % | yes |

- **K3 incremental bitmap — not built.** Its upper bound is the whole trace
  draw after K1 + K2 + K5 + K6: 4.3 ms/s inclusive (non-minified profile) =
  2.2 % of the base median, below the 3 % bar, and it would need a
  pixel-quantised clock (a visible change in sub-pixel motion).
- **K4 OffscreenCanvas in a worker — not evaluated**: its condition (trace JS
  ≥ 15 ms/s after K1 + K2) is not met (4.3 ms/s).
- **Lower React state cadence — not measured, not adopted** (guard 5: it
  changes which readout values are shown when).
- What is left (head, desktop, panel off, one non-minified run, 60 ms/s):
  frame lifecycle at ~79 frames/s (`UpdateLifecycle` 18.7, `BeginMainFrame`
  9.3, commit 5.7 — composited animations and React updates still tick main
  frames), worker messages ~6, the MSTP capture reader and microtask
  checkpoints ~10, trace draw 4.3, React 2.8.

### 2.3 Guards

1. **Latency** (diag, 3 × {woman, man} interleaved): capture → painted median
   of run medians base 6.8 ms (woman 6.7, man 6.9), head 6.5 ms (woman 7.3,
   man 5.7): **−0.3 ms, pass** (≤ +5). Capture → state update 3.3 / 3.1 ms.
2. **Trace pixels** (`visual-check.mjs`, 24 captures: 6 data steps × {no
   target, feminine} × DPR {1, 3}): every capture **passes** — 28 pixels
   differ by ≤ 5/255 (the anti-aliased ends of the 7 grid lines, now drawn in
   the cached static layer), 0 pixels by > 8/255. Reported, not judged: 7 ms
   after a data step the head still shows the frame drawn at that step
   (0.8–1.5 % of pixels differ from base, which has scrolled 7 ms further).
3. **Smoothness** — (a) main-thread tasks > 50 ms and long tasks over all
   TARGET runs: 0 base / 0 head (> 16.7 ms: 2 / 1); (b) rAF probe intervals
   > 50 ms: 0 / 0 (> 25 ms: 1 / 0); (c) head redraw cadence while listening:
   40.0 draws/s, gap p99 ≤ 34.2 ms, max 41.3 ms; scroll step p99 ≤ 1.43 CSS
   px, max 2.14 px (base: 142 draws/s, step p99 0.38 px). **Pass.** The trace
   now moves in 25 ms data steps (≈ 1.2 CSS px at desktop width, ≈ 0.6 px on
   the phone layout) instead of every display frame.
4. **Cue strip** (3 directions / widths / viewports × 240 ticks: 482 live
   row-ticks, 530 dots, 2 626 trail dots): **identical**, incl. dot centres,
   opacities and the start ring.
5. **Readouts**: no change to the hook's readout computation (the K7 state
   bail-out was reverted); `display-hook-test` (23, incl. 3 new trace-
   notification checks) and `steadiness-test` pass. **Pass.**
6. **Tests**: lint, `npm run test:unit` (38 / 38), build pass; smoke: §2.4.
7. **Workers**: no worker source changed (`git diff 5e26866 HEAD -- src`
   touches App, the hook's trace notifier, CombinedDashboard, CueStrip,
   HeardAsPanel, PitchTrace only); median worker CPU within −4.1 … +2.6 %
   (desktop) and −3.8 … +0.2 % (phone; gender −3.5 %). **Pass.**

Caveat: headless Chrome on this PC renders at ~152 Hz (no vsync cap). Base
cost scaled with the display rate (every frame redrew), so on a 60 Hz display
the base — and therefore the absolute saving — is smaller; on 120–165 Hz
monitors it is similar. The phone figures are desktop Chrome emulating the
phone viewport (DSF 3), not a phone; the phone check is the next step.

### 2.4 Smoke and a post-measurement fix

`scripts/cue-strip-smoke.mjs` on the measured build failed one check at every
viewport: "man: axis, end words and range fit inside the panel" — K6's
transform wrapper for the heard-as ring overhung the axis and widened the
panel's scrollable area. Fixed in af52aa5 (the wrapper sits in a clip box
reaching 6 px past each axis end; the ring and its composited transition are
unchanged). After the fix the smoke passes at all five viewports (phone
448 × 890: 68 / 68, p402 68 / 68, p360 68 / 68, landscape 890 × 360 68 / 68,
desktop 1280 × 800 68 / 68), and a confirmation run of the final build
against base (1280 × 800, panel on, 2 × {woman, man} interleaved) gives
258.4 → 113.8 ms/s, **−55.9 %** (woman 284.7 → 99.4, −65.1 %; man 256.3 →
127.1, −50.4 %; workers +0.6 … +4.3 %, within noise; no task > 50 ms).

### 2.5 Integration re-measure on `cue-strip` (2026-10-08, after the merge)

`main-thread-perf` (201a1b4) was fast-forwarded into `cue-strip`; the D2-0.1
confirmation failed, so no other code changed (fc2a207 is docs only). Desktop
CPU per thread, re-measured with `scripts/resonance/chrome-cpu.mjs --diag=0`
(the production URL, no overlay; 30 s Chrome trace after a 20 s warm-up;
headless Chrome 154, 1280 × 800, ~150 Hz frames), base = `cue-strip` adf19c3,
head = the integrated `cue-strip` build, base then head in every pair (a
fixed order — not alternated, as §1 asked; corrected 2026-10-08 after review),
2 runs × {LibriSpeech woman, man} per panel state (16 runs). A review run
with the order alternated (one run per voice and panel state) reproduced the
cut: main thread −57 … −69 %, app −34 … −44 % (§3). Median ms of
thread CPU per audio second:

| | Main | App (main + 4 workers) | Pitch worker | DSP worker | Resonance worker | Gender worker | Compositor | Renderer threads total | GPU process |
|---|---|---|---|---|---|---|---|---|---|
| Panel off, base | 183.7 | 260.8 | 29.8 | 26.2 | 21.2 | — | 73.1 | 354.1 | 386.4 |
| Panel off, head | **66.7** | **144.1** | 29.4 | 26.0 | 21.9 | — | 47.1 | 204.7 | 160.6 |
| — cut | −63.7 % | −44.7 % | | | | | | | |
| Panel on, base | 198.5 | 412.6 | 30.4 | 27.1 | 22.3 | 134.5 | 78.5 | 517.9 | 401.2 |
| Panel on, head | **77.1** | **282.5** | 29.5 | 26.1 | 22.2 | 129.1 | 50.7 | 355.0 | 165.8 |
| — cut | −61.2 % | −31.5 % | | | | | | | |

Women / men separately (main thread, base → head): panel off 182.9 → 68.9
(−62.3 %) / 184.6 → 66.7 (−63.9 %); panel on 198.5 → 74.7 (−62.4 %) /
200.3 → 78.0 (−61.1 %). App total: panel off −43.6 / −45.1 %, panel on
−31.1 / −31.4 %. Worker threads move by ≤ ±1.3 ms/s (noise; no worker code
changed). Outside the renderer, the GPU process falls from ~390 to ~160 ms/s
and the compositor thread from ~75 to ~48 — fewer frames to raster and
composite. With the panel on, the gender worker (classifier + speech
detector, ~130 ms/s) is now the largest single consumer, ahead of the main
thread. The same caveat as §2.1 applies: headless Chrome draws ~150 frames
per second, so on a 60 Hz display the base, and the absolute saving, is
smaller. Run files: scratch only (`mainthread-warning/integrate/cpu/`).

Checks on the integrated build: `npm run lint`, `npm run test:unit` (38 / 38),
`npm run test:resonance-lab` (89 passed, 0 failed) and `npm run build` pass;
`scripts/cue-strip-smoke.mjs --pitch-only=man,woman` passes 90 / 90 at every
viewport (phone 448 × 890, p402 402 × 750, p360 360 × 690, landscape
890 × 360, desktop 1280 × 800).

## 3. Review fixes (pre-registered 2026-10-08, before any change or result)

A review of `cue-strip` 3297f9f reproduced the main-thread cut with base /
head order alternated (one run per voice and panel state, busier PC: main
thread panel off woman 223.6 → 91.8 ms/s, −59.0 %, man 197.9 → 85.7,
−56.7 %; panel on woman 248.3 → 100.1, −59.7 %, man 280.8 → 87.3, −68.9 %;
app total −34 … −44 %). It raised the points below. **Prev** = 3297f9f.

**F1 — trace redraw fallback.** Since K2 the trace draws when a point is
appended, plus a 100 ms `setInterval` fallback that only draws if ≥ 100 ms
passed since the last draw, so a delivery hiccup can freeze the trace for up
to ~200 ms. In one of five review runs (prev, diag, desktop) the longest gap
between draws was 121.2 ms (step 5.08 CSS px) — guard 3c (max ≤ 100 ms)
fails there; the §2.3 figure (max 41.3 ms) came from fewer runs. Change: the
fallback becomes a timeout re-armed after every draw — 50 ms while data is
arriving (a notification in the last 1 s), 100 ms otherwise (idle cadence as
before) — so a stalled feed still scrolls at ≥ ~20 draws/s and a gap is at
most ~50 ms plus one display frame. The scheduling logic moves to a small
module (`src/components/traceRedrawScheduler.js`) with a Node unit test
(`tests/audio/trace-redraw-test.js`): a 25 ms feed draws once per point with
no fallback draws; a stalled feed draws every ≤ 50 ms + 1 frame; idle draws
every ~100 ms; a pending frame in a hidden page is not duplicated; stop()
cancels everything. **Historical (superseded 2026-10-12, §4):** a
display-rate rAF loop capped at 60 Hz (the review's other option) is **not**
adopted: it would bring back per-frame main-thread work, which is the cost
this pass removed; the phone session judges the data-driven cadence on a real
40 ms-buffer device (phone plan). (The phone check led the user to adopt that
loop on 2026-10-12 — §4.)

**F2 — device-pixel-ratio change.** Under Chrome's emulation a DPR-only
change (same CSS size) fires `window` `resize` but not the
`(resolution: Ndppx)` media query, and the ResizeObserver sees no size
change, so the canvas kept its old backing size. Change: a `resize` listener
also invalidates the geometry (the media query stays). Check: a new
`visual-check.mjs` step — the fixture at DPR 1, then DPR 2 at the same CSS
size — asserts `canvas.width == round(rect.width × dpr)` (and height) for
base and head; pass = both trees.

**F3 — latency statistic.** Capture → painted carries a run-to-run clock
offset of the capture epoch (~10 ms, review). Judged figure from now on:
draw − readout update per frame (diag paint latency − handler latency, the
same capture epoch cancels); `mt-cpu.mjs` prints it. Guard 1 is re-run with
it: head vs base 5e26866, 3 × {woman, man}, order alternated, 1280 × 800,
panel off, diag; median of run medians head − base ≤ +5 ms. Capture →
painted is reported, not judged.

**F4 — erratum** (D2-0.1 confirmation, Appendix B of
heard-as-pitch-only-warning-2026-10-07.md): two truncated hashes were
mistyped; a dated erratum with full hashes goes after the verbatim block.

**F5 — wording.** §2.5's runs were base then head in every pair (fixed order),
not alternated; reworded, and the review's alternated reproduction cited.

**F6 — heard-as range box.** The shaded range still has a
`transition-[left,width] duration-300` (main-thread style + layout every
frame for 300 ms after each change of the range). Attribution first
(attribution build, not a candidate): prev vs prev with that transition
removed, `mt-cpu.mjs`, 1280 × 800, panel on, no diag, 3 × {woman, man},
order alternated; also counted: changes of the range (`data-axis-lo` /
`-hi`) per second during the CPU window. Decision: if removing it lowers
the main-thread median by **≥ 6 ms/s** (3 % of the §2.5 panel-on base,
198.5 — the ladder's bar) the transition is removed (the range then jumps
between tenths; the ring keeps its composited slide — a transform + scale
version would distort the 1 px border, rounded corners and the dashed
"can't tell yet" outline); otherwise it stays and is recorded as an accepted
exception in CLAUDE.md's main-thread budget.

**Re-measure after F1 + F2 (+ F6 if adopted)** — all must pass:
- Guard 1 as F3 above.
- Guard 3c: head, diag, 1280 × 800, panel off, 5 × {woman, man} (the 6
  guard-1 runs + 4 more): in **every** run gap p99 ≤ 50 ms, max ≤ 100 ms,
  step p99 ≤ 2 CSS px.
- TARGET still met: `mt-cpu.mjs` (the §2.1 harness, no diag; it also
  counts guard 3a / 3b), base adf19c3 vs head, 1280 × 800, 2 × {woman, man}
  per panel state, order alternated per pair; main-thread cut ≥ 35 % in both
  panel states (women and men reported), worker threads reported.
- Guards 2 and 4 (`visual-check.mjs` vs 5e26866) incl. the F2 step; guard
  3a / 3b counts (tasks > 50 ms, rAF probe > 50 ms) in the TARGET runs ≤
  base + 1; lint, `npm run test:unit`, `npm run build`, smoke at the five
  viewports.

### 3.1 Results (2026-10-11, after the pre-registration)

Desktop, headless Chrome 154, 1280 × 800, `mt-cpu.mjs`, public LibriSpeech
woman / man WAVs as in §2. Fix commits: 4b5ff4e (F1, F2 as pre-registered,
F6) and 96a5a08 (F2 revised, below). Run files: scratch only
(`mainthread-warning/fix3297/`).

**F6 — range-box transition (attribution, decided before F1 / F2 were
measured).** 3297f9f vs 3297f9f without the `left` / `width` transition,
panel on, no diag, 3 × {woman, man}; order fixed per voice (women base
first, men candidate first — not alternated within a voice). Main thread:

| | 3297f9f | no transition | median diff | range changes / s |
|---|---|---|---|---|
| Woman | 95.7, 94.1, 110.6 (median 95.7) | 92.2, 97.2, 104.1 (97.2) | +1.5 | 0.04–0.22 |
| Man | 107.3, 116.4, 115.7 (115.7) | 95.1, 102.8, 105.8 (102.8) | −12.9 | 0.28–0.43 |
| Pooled | 108.9 | 100.0 | **−8.9** | |

−8.9 ms/s ≥ the 6 ms/s bar: **the transition is removed** (4b5ff4e). The
saving comes from the man's runs, where the range moves 3–4 times as often;
on the woman's runs the range barely moves and the difference is noise.

**Guard 1 — latency (F3 statistic).** 4b5ff4e vs 5e26866, diag, panel off,
3 × {woman, man}, each voice run in both orders. Draw − readout update,
median of run medians: base 3.85 ms, head 3.45 ms, **−0.40 ms, pass**
(≤ +5) — women 3.90 → 3.40, men 3.80 → 3.50. Reported, not judged:
capture → painted 6.40 → 6.10 ms, capture → readout update 2.80 → 2.70 ms.

**Guard 3c — redraw cadence.** 4b5ff4e, diag, panel off, 5 × {woman, man}:
every run 40.0 draws/s, gap p99 33.7–33.8 ms, max 34.5–50.0 ms, step p99
1.43 CSS px — **all 10 pass**. For reference, base 5e26866 (rAF loop,
~96 draws/s with diag) had a max gap of 10.6–21.2 ms in five of six runs and
**247.1 ms** in one: stalls of that size come from the machine and hit the
old loop too; the new fallback bounds how long the trace stays still after
one.

**TARGET.** adf19c3 vs 4b5ff4e, no diag, 2 × {woman, man} per panel state,
each (panel, voice) in both orders. Median ms of thread CPU per audio second:

| | Main, base → head | Women | Men | Pitch | DSP | Resonance | Gender |
|---|---|---|---|---|---|---|---|
| Panel off | 235.6 → **89.8 (−61.9 %)** | 232.6 → 89.1 (−61.7 %) | 240.8 → 89.8 (−62.7 %) | +0.7 % | +1.3 % | +4.5 % | — |
| Panel on | 246.0 → **94.7 (−61.5 %)** | 264.3 → 94.2 (−64.4 %) | 235.1 → 95.2 (−59.5 %) | +0.9 % | −0.9 % | +5.1 % | +4.0 % |

**Pass** (≥ 35 % in both panel states, both voices). No worker source
changed; the worker moves (≤ 1.3 ms/s for resonance, 6.7 ms/s for the
gender worker) are within the run-to-run spread. Guards 3a / 3b over these
runs: main-thread tasks > 50 ms base 1 / head 1, rAF intervals > 50 ms
base 1 / head 0 — **pass** (≤ base + 1). The absolute figures differ from
§2.5 (`chrome-cpu.mjs`, a quieter machine) — compare within a table only.

**F2 — the pre-registered change failed its check; revised.** With the
`resize` listener (4b5ff4e) `visual-check.mjs` failed the DPR-only step for
the head: the canvas stayed 640 × 240 at DPR 2 and 3 (31 / 33). A probe in the
same headless emulation showed that a DPR-only change fires **no event at
all** — no window `resize`, no `(resolution: Ndppx)` media-query change, no
`device-pixel-content-box` ResizeObserver callback (the review's alternative
fix) — while `window.devicePixelRatio` does report the new value. Revised
(96a5a08): `draw()` re-measures when `window.devicePixelRatio` differs from
the measured value — a property read, no layout, once per draw (≤ 40/s);
the media-query and `resize` listeners are removed; the ResizeObserver
still handles container size. `visual-check.mjs` vs 5e26866: **33 / 33**
(trace pixels: 28 pixels differ by ≤ 5/255 at every data step, as in §2.3;
DPR-only 1 → 2 → 3 → 1 resizes the canvas in both trees; cue strip
identical). Because this build differs from the measured one, a
confirmation (4b5ff4e vs 96a5a08, no diag, alternated): panel off
1 × {woman, man} 92.7 → 93.9 ms/s (+1.2), panel on 3 × {woman, man}
87.4 → 92.7 (+5.3; women +6.2, men +4.3) — inside the ±10 ms/s spread of
single runs of one build, and one property read per draw cannot cost
milliseconds per second; read as noise. The TARGET cut is unaffected
(~−62 %). Diag on 96a5a08, 1 × {woman, man}: 40.0 draws/s, gap p99
33.7 / 33.9 ms, max 39.6 / 52.1 ms, step p99 1.43 px (guard 3c pass),
draw − readout 3.4 / 3.4 ms.

**Historical (superseded 2026-10-12, §4: adopted after the phone check):**
**not adopted:** the review's display-rate rAF loop capped at 60 Hz (F1,
reason in §3). It is prepared as a phone-check variant, so the phone session
can price its smoothness against its main-thread cost if the data-driven
cadence fails there.

**Checks on 96a5a08:** `npm run lint`, `npm run test:unit` (39 / 39, incl.
the new `tests/audio/trace-redraw-test.js`, 15 checks), `npm run build`, and
`scripts/cue-strip-smoke.mjs --pitch-only=man,woman` at the five viewports
(90 / 90 at each: phone 448 × 890, p402 402 × 750, p360 360 × 690, landscape 890 × 360, desktop 1280 × 800).

**Phone.** Not measured here (measured 2026-10-12, §4). The phone check covers main-thread CPU (base
adf19c3 vs head, production page), guard 3c on the phone's 40 ms audio
buffers (and the by-eye judder check), the resonance worker, and the gender
worker + speech detector at the 450 ms hop, in one session.

## 4. Status after the phone check (2026-10-12)

[phone-cpu-2026-10-12.md](phone-cpu-2026-10-12.md). On a Pixel 11 Pro XL
(Chrome 154, portrait, 40 ms audio buffers, public LibriSpeech speech) the
`cue-strip` head (c925457) used 30 % (panel off) / 34 % (panel on) less
main-thread CPU than adf19c3 (`/proc`; the whole cue-strip change, not this
pass alone). Its data-driven redraw ran at ~25 draws/s: SMOOTH by the
automated screen-recording rule, but guard 3c failed on the gap p99 (52 ms vs
the desktop-set 50 ms bar). The rAF loop capped at ~60 Hz (F1's rejected
option) drew ~53 /s, passed 3c and was also SMOOTH, at +27 / +30 % main
thread vs the head on the phone. **User decision 2026-10-12: adopted** — the
F1 decision above ("not adopted") is superseded; `traceRedrawScheduler.js` is
now that loop (branch `trace-raf60`). It draws on most, not every, 60 Hz
frame: its 16 ms gate reads the clock inside the frame callback, so callback
jitter skips some frames (on the phone ~12 % of draw gaps were doubled, ~53
draws/s, gap p99 34 ms; a 90 Hz display draws 45/s). Desktop cost of the
change (headless Chrome 154 at ~180 frames/s, `mt-cpu.mjs`, 1280 × 800, no
diag): main thread **+52 to +58 %** — the result that reproduces. In ms/s it
depends on machine load: 108 → 172 panel off, 114 → 174 panel on (+60 to +63
ms/s) in the builder's session on a loaded machine (workers ~2× a quiet run),
54.5 → 85.3 / 52.8 → 80.5 / 57.9 → 88.3 (women off / men off / women on,
+28 to +31 ms/s, +52 to +57 %) in a quieter-machine review repeat. The
women / men split (+51 / +82 % vs +57 / +52 % panel off) is within run spread,
not a voice difference. A new point reaches the screen ~6–9 ms later on the
desktop (draw − readout; ~1 ms on the phone); trace pixels at data steps and
the cue strip unchanged. The desktop was not re-measured against adf19c3 (the
§3.1 TARGET figures come from another session; compare within one table
only). On the phone the adopted build stays 11 % / 14 % below adf19c3.
**2026-10-12, branch `trace-vsync`** ([phone-cpu-2026-10-12.md](phone-cpu-2026-10-12.md)
§7; not yet phone-checked, merge pending the §7.3 phone check as amended):
the loop's gate compares the frame timestamp (15 ms) instead of
`performance.now()`, so it should draw on every 60 Hz frame (~60 /s on the
phone instead of a9ddd6b's ~53, unit model); on the desktop at ~180 Hz draws,
main-thread CPU and latency are unchanged within run spread. The loop the
user adopted on 2026-10-12 after the phone check is a9ddd6b's.
