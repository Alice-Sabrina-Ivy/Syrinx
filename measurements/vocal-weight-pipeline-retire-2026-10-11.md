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

## 5. Results

(filled in after the change)
