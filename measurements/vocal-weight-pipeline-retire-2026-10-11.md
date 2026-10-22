# Retiring the vocal-weight (CPP) pipeline from the production path

2026-10-11. Written before any code change to `src/dsp/dsp-worker.js`, `src/dsp/cpp.js` or the
vocal-weight modules (CLAUDE.md Hard rule 3). Base tree: `cue-strip` at `364e0e1` (the Clarity row
already hidden). Public data only (LibriSpeech smoke WAVs, synthetic held vowel and noise).

## 1. Why

The user decided on 2026-10-11 to **hide the cue strip's Clarity row** (raw CPP, "Vocal weight" until
earlier that day) until a measure passes its test: the pre-registered clarity study failed
([clarity-cue-2026-10-08.md](clarity-cue-2026-10-08.md)). With the row gone, the production app still
computed CPP on every DSP frame (~40 Hz) and ran the aggregator → 30 s baseline → 5 s level chain on
the main thread for nobody. This note inventories every consumer, measures the cost and fixes the
acceptance check for turning it off.

## 2. Consumers of the CPP / vocal-weight pipeline (at `364e0e1`)

| Consumer | What it uses | User-facing or stored? |
|---|---|---|
| `src/dsp/dsp-worker.js` | `computeCPP(window, sr)` on **every** analysis frame (not throttled like formants / tilt / HNR), posts `cpp` on each `analysis` message; `cppMs` in the diag fields | producer |
| `src/audio/useAudioPipeline.js` | `VocalWeightAggregator` (1-s aggregate at 4 Hz, pitched frames only) → `VocalWeightBaseline` (first ~30 s, frozen μ/σ) → `createWeightLevel` (~5 s median); the `vocalWeight` state slice built on every throttled state update (3 call sites + initial / reset state) | feeds the slice below |
| `vocalWeight` state slice → `App.jsx` → `CombinedDashboard` → `CueStrip` | the Clarity row's dot, header, calibration progress, trail, screen-reader text | **removed from the UI in `364e0e1`** — no remaining reader (App and the Dashboard no longer pass it) |
| `src/diag/diag.js` | `vocalWeightEmits` ring + `vocalWeightFrames` tally in the `?diag=1` snapshot (`noteVocalWeightFrame`, `pushVocalWeightEmit`, `resetVocalWeightCounters`) | diag only; the overlay does not display them |
| Session frames / summary stats / History / export | — | **never stored**: the frame callback records f0, painted, f1–f3, intensity, spectral tilt and HNR only; `sessionStats.js`, `SessionHistory.jsx`, `exportFormat.js` and `sessionRepair.js` never read CPP or a vocal-weight value; the only schema trace is the v2 `null`-drop of the 2026-05-12 `vocalWeightCalibration` table, which stays |
| Weight × clarity lab view (`src/resonance-lab/weight-*.js`) | **its own** CPP-like feature inside the v5 frame features, computed in the lab worker on the lab's 16 kHz stream | independent — does not import `cpp.js` or read the production slice |
| Training direction / zones | — | zones removed 2026-10-11 (clarity-cue merge) |
| Tests / scripts | `tests/dsp/cpp-*.js`, `tests/audio/vocal-weight-*.js` (module-level), `scripts/vocal-weight-gate-scale-validate.js` | library-level, unaffected by the production wiring |

**Verdict: nothing user-facing or stored still needs it.** Plan: the DSP worker stops computing CPP
unless an `init` message asks for it (`cpp: true`; off in production — kept for harnesses and a future
measure that passes its test), the posted `cpp` field stays (always `null`) for message-shape
compatibility; the hook drops the aggregator / baseline / level and the `vocalWeight` slice; diag drops
the vocal-weight ring. `cpp.js` and the three vocal-weight modules stay as library code with their unit
tests (dormant, documented), so a later clarity measure can reuse them. Historical session data is
unaffected (it never held CPP).

## 3. Before: DSP-worker CPU on the built app (no diag)

Method: `node scripts/resonance/chrome-cpu.mjs --diag=0 --dist=<build> --seconds=60 --warmup=20
--trace=30` — `vite build` of the tree, `vite preview`, headless Chrome 154 (puppeteer, temporary
profile, PID-scoped cleanup), fake mic = `build/cue-strip-smoke/speech-woman.wav` (public LibriSpeech,
looped), production URL (no `?diag=1`), panel off, direction "exploring", 1280×800; thread CPU from a
30 s Chrome trace after 20 s of warm-up (sum of top-level task thread-clock durations), per audio second.

| run | build | DSP worker | pitch worker | resonance worker | main | app (main + workers) |
|---|---|---|---|---|---|---|
| base-1 | `364e0e1` | 24.5 | 27.6 | 18.6 | 56.4 | 127.1 |

(ms of thread CPU per audio second; the machine was under other load — the build took 4 min 22 s —
so the after-runs are interleaved with further base runs, §5.)

## 4. Acceptance check (fixed before the change)

1. **Bit identity on a fixed input.** A harness (`bitid.mjs`, scratch, method below) drives the REAL
   pitch worker, DSP worker and `useAudioPipeline` hook of a tree over `speech-woman.wav`,
   `speech-man.wav`, `held.wav` and `noise.wav` (48 kHz) at production cadence: 25 ms chunks to both
   workers, each pitch message relayed to the DSP worker as a `pitch-hint` and to the hook's own
   `handlePitchMessage`, each DSP `analysis` message to `handleAnalysisResult` (the session-oracle
   loader: react mock, extensionless imports, `SO_TAP=0`). On the base tree it also installs the
   aggregator / baseline / level that `start()` would, so the retired path really runs there. It
   hashes: every posted pitch message (minus timestamps), every DSP analysis payload minus `cpp` and
   timing fields (and per field: intensity, formants, spectral tilt, HNR), the hook's full React state
   per frame minus `vocalWeight` (pitch, level, readout, steadiness, smoothed formants, HNR, tilt,
   voiced / holding …), the session frame-callback record per frame and the painted pitch-trace point
   per frame. **Pass = every digest identical, base vs head, on all four inputs.**
2. **Resonance and the heard-as panel**: their workers (`src/resonance/`, `src/resonance-lab/`,
   `src/ml/`) are not touched; pass = the built worker chunks are byte-identical between the two
   builds, and the cue-strip smoke (resonance row, panel) passes at all five viewports.
3. **CPU**: DSP-worker thread CPU per audio second falls; no other thread rises beyond run-to-run
   noise.

## 5. Results (head = this change, base = `364e0e1`)

**Code change** (after this note): `dsp-worker.js` runs `computeCPP` (and `resetCppState`) only when
`init` carries `cpp: true` — no production caller sets it; `useAudioPipeline.js` drops the
aggregator / baseline / level refs, the per-frame push, the `buildVocalWeightState` calls and the
`vocalWeight` state slice; `diag.js` drops `vocalWeightEmits` / `vocalWeightFrames`. `cpp.js` and the
three vocal-weight modules are unchanged apart from a "dormant" header line; their unit tests still run.

### 5.1 Bit identity (acceptance 1): PASS

Every digest identical, base vs head, on all four inputs (9 of 9 streams each); the base tree run twice
gives the same digests (the harness is deterministic). On base the retired path really ran (CPP on
every DSP frame; non-null `vocalWeight.cpp` on 2881 / 2888, 2900 / 2933, 235 / 279 and 0 / 799 state
updates); on head the DSP worker posted no CPP and the state has no `vocalWeight`.

| input (48 kHz) | chunks | pitch msgs | DSP frames | formant / tilt / HNR frames | streams identical |
|---|---|---|---|---|---|
| speech-woman.wav (LibriSpeech) | 2889 | 2884 | 2888 | 482 / 474 / 473 | 9 / 9 |
| speech-man.wav (LibriSpeech) | 2934 | 2929 | 2933 | 489 / 481 / 476 | 9 / 9 |
| held.wav (synthetic vowel) | 280 | 275 | 279 | 47 / 40 / 40 | 9 / 9 |
| noise.wav (synthetic) | 800 | 795 | 799 | 134 / 134 / 133 | 9 / 9 |

Streams: posted pitch messages; DSP payloads minus `cpp` / timing; intensity; formants; spectral
tilt; HNR; hook state per frame minus `vocalWeight`; session frame-callback records; painted trace
points. Harness: drives the real workers + hook as described in §4 (kept outside the repo; the
session-oracle loader `scripts/session-oracle/lib/register.mjs` with `SO_TAP=0`).

### 5.2 Resonance, heard-as, pitch, lab workers (acceptance 2): PASS

Built worker chunks, base vs head: `pitch-worker`, `resonance-worker`, `gender-worker` and
`lab-worker` are **byte-identical** (same hashed file names, `cmp` equal); only `dsp-worker` changed
(11 530 → 11 571 B: the flag check; `cpp.js` is still bundled for the
opt-in path). Browser smoke on the head build (`dist/` of `e67ab7a`):

- `scripts/cue-strip-smoke.mjs --pitch-only=man,woman` at all five viewports: **94 / 94 checks pass**
  at 448×890, 402×750, 360×690, 890×360 and 1280×800 (two rows only, resonance warming → settling →
  live, heard-as panel on / off / reload, the pitch-only warning, noise / silence). First-screen
  layout, panel off → on (px): 448×890 trace 114–345, strip 353–495, session row 543–581 → panel
  503–729, session row 737–775 (everything on the first screen either way); 402×750 strip 317–459,
  panel on to 724; 360×690 strip 317–473, panel on 481–754 (its lower part and the session row
  below the fold, as before — the rule is trace + strip); 890×360 strip beside the trace, 114–238;
  1280×800 strip 114–336 in the right column.
- `scripts/resonance-lab/lab-smoke.mjs`: **all five runs pass on a woman's voice** (isolation until the tab is opened;
  lab live after opening; tab opened before listening; four cards fit at 402×750; weight × clarity
  model on demand, mapping, ≥ 1 readable bin — 10 of 25 — and the plot in the first screen at all
  five viewports). Two harness notes: `--wav` must be an **absolute** path (Chrome resolves
  `--use-file-for-fake-audio-capture` against its own working directory; a relative path gives a
  silent mic and runs 2–4 fail with "Voiced so far 0 s"), and run 5 needs a clip whose "softer" and
  "louder" mapping phases really differ in level: plain looped LibriSpeech clips came out 0.2, −0.1
  and 2.6 dB apart (the view's compression check, < 4 dB, turns readings off — and with that warning
  shown the plot's bottom axis sits 5 px under the Stop bar at 360×690, identical on the unmodified
  `weight-lab` tip `05e4685`). The passing run used `speech-woman.wav` looped twice with a level
  profile following the prompts (−4 dB, then −10 dB for 27–47 s and 0 dB for 47–67 s after capture
  start; `--weight-map-seconds=100`): loudness check 12.4 dB. **Correction (review round, §6):** the
  weight × clarity check passed only on that woman's voice (lab-smoke run 7). The other weight run (run 6)
  used a woman-then-man clip and read 0 of 25 bins (20 "Not mapped at this pitch / loudness"). That was a
  harness-design failure: it mapped the woman's voice, then read the man's (~102 Hz) against her map. A
  man's voice mapped and read on its own is reported in §6.1.

### 5.3 CPU (acceptance 3): PASS

Thread CPU ms per audio second, interleaved runs (base-1 before the change, then head-1, base-2,
head-2, base-3, head-3), same method as §3:

| run | DSP worker | pitch worker | resonance worker | main | app (main + workers) |
|---|---|---|---|---|---|
| base-1 | 24.5 | 27.6 | 18.6 | 56.4 | 127.1 |
| head-1 | 8.4 | 31.6 | 21.6 | 71.0 | 132.5 |
| base-2 | 25.8 | 29.6 | 19.2 | 61.6 | 136.3 |
| head-2 | 8.1 | 29.7 | 20.3 | 62.0 | 120.2 |
| base-3 | 34.9 | 36.8 | 28.5 | 86.0 | 186.3 |
| head-3 | 8.5 | 31.8 | 20.7 | 66.4 | 127.4 |
| **median base / head** | **25.8 / 8.4** | 29.6 / 31.6 | 19.2 / 20.7 | 61.6 / 66.4 | 136.3 / 127.4 |

- **DSP worker −17.4 ms per audio second (−67 %)**, every head run below every base run (8.1–8.5 vs
  24.5–34.9). That is the per-frame CPP (~0.4 ms × 40 frames/s on this desktop); formants / tilt / HNR
  every 6th frame and intensity remain.
- **Main thread and pitch worker: no claim.** In these three pairs the head runs sat slightly above the
  two base runs without outside load (main 62.0–71.0 vs 56.4 / 61.6; pitch 29.7–31.8 vs 27.6 / 29.6).
  base-3 ran under outside load (its wall times are 1.3–1.6× its CPU times on every thread) and is not a
  usable reference. The change only removes work from the main thread (the aggregator push and the
  slice build). Four more pairs, two per voice, are in §6.2. **Corrected 2026-10-11 (review round):** this
  bullet first said "the other threads move within run-to-run noise", and that leaned on base-3.
- Mobile not measured (the 2026-05-10 note put per-frame CPP at ~80 ms/s on desktop under diag
  timing; on a phone the saving is larger in absolute terms). The phone session planned for
  2026-10-11 can confirm it with the same build.

### 5.4 What stays

- `src/dsp/cpp.js`, `src/audio/vocal-weight-{aggregator,baseline,level}.js` and their unit tests
  (`tests/dsp/cpp-test.js`, `tests/audio/vocal-weight-*-test.js`) — library code, not called.
- Stored data: nothing to migrate — no session frame, summary or export ever held a CPP or
  vocal-weight value; Dexie v2's `vocalWeightCalibration: null` drop is unchanged.
- The Resonance lab's "Weight × clarity" view computes its own features in the lab worker and is
  unaffected (lab worker chunk byte-identical).

## 6. Review round (2026-10-11): plan, written before the fixes

A review of `0332f3c` found no blocking code problem. It raised these points about how the results
were measured and reported, plus two small robustness gaps. Planned fixes and their checks:

1. **Weight × clarity lab smoke covered only a woman's voice** (§5.2). The passing run (lab-smoke
   run 7) used `speech-woman.wav`. The run with a woman-then-man clip (run 6) read **0 of 25** bins
   (20 "Not mapped at this pitch / loudness"). That was a harness-design failure: it mapped the
   woman's voice and then read the man's (~102 Hz) against her map. No run has yet shown a readable
   bin for a man's voice read against his own map. Fix: build `man-prompted.wav`, which is
   `speech-man.wav` (public LibriSpeech) looped twice with the same level profile as the woman's clip
   (−4 dB; −10 dB for 27–47 s; 0 dB for 47–67 s; dB-linear 0.5 s ramps at each step). The woman's
   clip, rebuilt with this recipe, matches the original to ±1 LSB. Then run `lab-smoke.mjs
   --weight-map-seconds=100` on the head build once per voice, and report readable bins for women
   and men separately. Pass = ≥ 1 readable bin after mapping for each voice, plus the other lab-smoke
   checks.
2. **CPU, other threads** (§5.3). "Other threads within run-to-run noise" leaned on base-3, which ran
   under outside load. Fix: four more interleaved base/head pairs with the §3 method: two with
   `speech-woman.wav` and two with `speech-man.wav`, alternating which build runs first. Report
   medians without base-3, separately per voice. Make no claim about a thread whose head runs all sit
   above its base runs unless the gap is larger than the spread between runs.
3. **`cueSummary()`** (`src/components/cueStripModel.js`, a cue-strip module) returns the resonance
   sentence for any cue other than `"pitch"`, so `cueSummary("clarity", …)` returns a resonance
   sentence while `rowValue("clarity", …)` returns `null`. Fix: return the resonance sentence only
   for `"resonance"` and `null` otherwise. Check: a unit test that `cueSummary("clarity", { state:
   "live" }) === null` and that every existing summary string is unchanged. This is a robustness
   fix, not tuning, and no user-visible output changes, because only `"pitch"` and `"resonance"` are
   rendered.
4. **Main-thread CPU fixture** (`scripts/main-thread/fixture/cue.jsx`) still passes a `vocalWeight`
   prop to `CueStrip`, which now ignores it, and its `__dump` still reads `[data-cue-progress]`. Fix:
   remove both and update the header comment. Document that `visual-check.mjs --only=cue` compares
   two trees only when both are on the same side of `364e0e1` (the row hide). Across `364e0e1` the
   strip differs by a whole row by design.
5. **Docs**: in the CLAUDE.md Current-state Clarity row, three decision-data links sat in a fifth
   table cell, so they did not render. The cue-strip checklist line still listed
   `vocal-weight-level-test.js`, and the Resonance lab paragraph still listed CPP among the production
   workers.
6. **Phone plan** (scratch, not in the repo): today's phone session built H from `origin/cue-strip`.
   That ref now includes this retirement, so H vs B would mix three changes. H and V are now pinned
   to `53704cc`. An optional run builds `0332f3c`, and that run is compared only with H.

### 6.1 Results: weight × clarity smoke, women and men separately

All runs use `lab-smoke.mjs --wav=<absolute path> --weight-map-seconds=100` on the head build (`af62b6c`).
Each clip is public LibriSpeech test-clean audio, looped twice, with the level profile of item 1.

| run | clip (one reader each) | Praat median F0, p10–p90 spread | map | loudness check | readable bins after mapping | lab smoke |
|---|---|---|---|---|---|---|
| 9 | woman: `speech-woman.wav` | 172 Hz, 11.4 st | 7 areas | 10.9 dB | **13 of 25 (52 %)** | 5 / 5 PASS |
| 8 | man: `speech-man.wav` (the cue-strip smoke's reader) | 131 Hz, **21.8 st** | **0 areas** ("No part of your voice had 5 seconds of running speech at one pitch and loudness") | — | 0 | run 5 FAIL |
| 10 | man: reader 908 (`man-908-prompted.wav`) | 107 Hz, 11.7 st | 6 areas | 9.7 dB | **10 of 25 (40 %)** | 5 / 5 PASS |

- **A man's voice, mapped and read against his own map, gives readable bins (run 10).** Women 13 of 25,
  men 10 of 25, on readers with a similar pitch spread (11.4 vs 11.7 st). The plot was in the first
  screen at all five viewports for both voices.
- **Run 8 is a clip problem, not a men's-voice problem.** The cue-strip smoke's man reader reads several
  passages in a high voice: Praat AC places 17–24 s at a median of 311 Hz and 62–70 s at 286 Hz, so the
  clip spans 21.8 st, about twice the woman's 11.4 st. The 1-s bins scattered over 2-semitone cells from
  about 80 to 320 Hz. A Node replay of the same mapping (the lab engine and weight tap as in
  `scripts/resonance-lab/weight/cpu.mjs`, prompts advanced every 20 s) gave 2 ready cells and 1 readable
  bin on this clip, against 6 / 13 for the woman and 5 / 25 for reader 908. Chrome's fake mic loops the
  file from its own start point, so the browser run got none. The view behaves as specified here: a cell
  needs 5 bins of running speech at one pitch and loudness, and a voice that keeps changing register
  doesn't fill one in 100 s. The same holds for a woman who changes register as often.
  `man-908-prompted.wav` is built like the woman's clip: reader 908's first eight test-clean utterances
  with 0.4 s gaps, resampled 16 → 48 kHz, set to the woman clip's median 100 ms RMS, looped twice,
  same level profile.
- In run 8's failed-mapping state, the "No part of your voice…" note pushes the plot's bottom axis 5 px
  under the Stop bar at 360×690. This is the same layout as the compression warning in §5.2, which is
  identical on the unmodified `weight-lab` tip. It is lab-only and not changed here.

### 6.2 Results: CPU, four more interleaved pairs

Same method as §3, on the base build (`364e0e1`) and the head build (`af62b6c`). Run order: base-4w,
head-4w, head-5w, base-5w, base-4m, head-4m, head-5m, base-5m (w = `speech-woman.wav`, m =
`speech-man.wav`). Thread CPU in ms per audio second:

| run | DSP worker | pitch worker | resonance worker | main | app (main + workers) |
|---|---|---|---|---|---|
| base-4w | 33.7 | 38.0 | 29.3 | 98.8 | 199.8 |
| head-4w | 10.9 | 38.0 | 30.4 | 103.8 | 183.1 |
| head-5w | 10.2 | 36.5 | 27.8 | 95.5 | 170.0 |
| base-5w | 31.1 | 36.7 | 29.8 | 94.6 | 192.2 |
| base-4m | 33.1 | 38.0 | 29.8 | 97.7 | 198.6 |
| head-4m | 10.7 | 38.0 | 28.8 | 95.6 | 173.1 |
| head-5m | 12.3 | 38.7 | 30.1 | 102.1 | 183.1 |
| base-5m | 31.5 | 38.0 | 30.0 | 94.0 | 193.4 |
| **median base / head, woman** | **32.4 / 10.6** | 37.3 / 37.2 | 29.5 / 29.1 | 96.7 / 99.7 | 196.0 / 176.6 |
| **median base / head, man** | **32.3 / 11.5** | 38.0 / 38.4 | 29.9 / 29.4 | 95.8 / 98.8 | 196.0 / 178.1 |

- The machine was busier than in §5.3: wall time ran 1.11–1.22× CPU time on the busiest thread in every
  run, and every thread read about 1.4× its §5.3 value. Compare runs only within a session.
- **DSP worker: −21.8 ms per audio s for the woman and −20.8 for the man.** Every head run is below
  every base run (10.2–12.3 vs 31.1–33.7). With §5.3, that is 7 of 7 pairs.
- **Pitch and resonance workers: unchanged.** The medians are within 0.5 ms/s in both voices, and the
  base and head ranges overlap.
- **Main thread: no claim.** The head median is 2–3 ms/s higher (woman 99.7 vs 96.7, man 98.8 vs 95.8),
  but the ranges overlap (base 94.0–98.8, head 95.5–103.8), and the change only removes main-thread
  work. Together with §5.3 there are seven pairs, and the head main thread is higher in five of them.
  That pattern is reported, not explained. A real main-thread rise from deleting code is implausible,
  and these runs can't resolve a 3 ms/s effect against this spread. The phone session's optional
  R-vs-H run (item 6) measures the main thread separately.
- **App total (main + workers): every head run is below every base run** in this session (170.0–183.1 vs
  192.2–199.8), led by the DSP worker.

### 6.3 Results: the other items

- `cueSummary`: `node tests/audio/cue-strip-model-test.js` 62 / 62 (new: an unknown cue or `"clarity"`
  gives `null`, matching `rowValue`). `scripts/main-thread/visual-check.mjs --only=cue` with
  `0332f3c` as base and the head as head, run with the cleaned fixture: 3 / 3 checks, 240 ticks
  identical each, including the screen-reader text. The guard changes no rendered output.
- On the head build: `npm run lint` is clean; `npm run test:unit` passes 40 / 40; `npm run build` gives a
  dsp-worker of 11.57 kB, with LabView and labPipeline as separate lazy chunks.
  `scripts/cue-strip-smoke.mjs --pitch-only=man,woman` passes **94 / 94 at each of the five
  viewports** (448×890, 402×750, 360×690, 890×360, 1280×800). At 448×890 with the panel off, the
  trace is at 114–345, the strip at 353–495 and the session row at 543–581, as in §5.2.
- Docs and phone plan: done as listed in items 5 and 6.
