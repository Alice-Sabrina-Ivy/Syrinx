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
opt-in path). The cue-strip smoke (resonance row, panel) and the lab smoke results are in the commit
that ran them (CLAUDE.md "Current state").

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
- The other threads move within run-to-run noise in both directions (base-3 ran under outside load:
  its wall times are 1.3–1.6× its CPU times on every thread). The main-thread saving of the removed
  aggregator push and slice build is too small to resolve against that noise (main 56–86 base,
  62–71 head) — not claimed.
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
