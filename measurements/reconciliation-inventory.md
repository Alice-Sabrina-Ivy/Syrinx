# Reconciliation inventory: Syrinx (working tree) vs Syrinx-clone (clean GitHub state)

> **Status: read-only inventory. No changes applied to either tree.**
>
> Working tree: `C:\Coding Projects\Syrinx` (zip extraction; no `.git/`)
> Clean clone: `C:\Coding Projects\Syrinx-clone` (real GitHub state)
>
> Use this file to drive a manual copy/commit from the clean clone.
> Diffs computed with `diff -rq --strip-trailing-cr` so CRLF artifacts
> from the zip extraction don't masquerade as content changes.

## Out-of-scope (not part of either commit)

Trees that exist in only one side but aren't part of the work:

| Path | Side | Treatment |
|---|---|---|
| `.git/` | Syrinx-clone only | Git internal; ignore |
| `.claude/` | Syrinx only | Local Claude Code session state; ignore (typically already gitignored at user level) |

## Category 1: New files (in Syrinx but not in Syrinx-clone)

### Source / test code (commit these)

| Path | Notes |
|---|---|
| `tests/dsp/degraded-test.js` | Stage 2.B robustness harness on Hillenbrand + synthetic degradations (pink noise, reverb, AGC, soft clip). In-memory variants, no on-disk WAVs. |
| `tests/dsp/ptdb-tug-test.js` | Frame-by-frame F0 contour matching against PTDB-TUG laryngograph ground truth. Co-detected fair-comparison metric for production-equivalent measurement. |

### Data subdirectory (gitignore-candidate; flag, don't copy audio)

| Path | Treatment |
|---|---|
| `tests/dsp/data/ptdb-tug/.gitignore` | **Commit.** Excludes `*.wav`, `*.f0`, `*.lar`. |
| `tests/dsp/data/ptdb-tug/README.md` | **Commit.** Documents the corpus subset, REF format, license, citation, re-fetch instructions. |
| `tests/dsp/data/ptdb-tug/FEMALE/` | **Gitignore-candidate.** Audio + REF files (~117 MB total across MIC + REF subdirs). Re-fetched via `scripts/fetch-ptdb-tug-subset.sh`. |
| `tests/dsp/data/ptdb-tug/MALE/` | **Gitignore-candidate.** Same as FEMALE. |

Repo-root `.gitignore` should also be updated to exclude `tests/dsp/data/ptdb-tug/{FEMALE,MALE}/` (the subdir-local `.gitignore` already covers this for that subtree, but a top-level entry is more discoverable).

### Scripts (commit; one is obsolete)

| Path | Notes |
|---|---|
| `scripts/analyze-harmonic-sweep.js` | Pareto-frontier analysis from harmonic-gate sweep CSV. Companion to `tune-harmonic-gates.js` (also obsolete; see below). |
| `scripts/diagnose-helper-divergence.js` | One-off diagnostic that surfaced the `steadyStateDetect` vs `streamingMedianDetect` distinction during pass 1 helper investigation. Documents the failure mode that informed `pass1-helper-diagnostic-2026-05-04.md`. |
| `scripts/fetch-ptdb-tug-subset.sh` | Bash + curl. Downloads 4-speaker × 45-SX subset of PTDB-TUG (~117 MB) into `tests/dsp/data/ptdb-tug/`. |
| `scripts/pyin-stage1-harness.js` | Stage 1 vs Stage 0 comparison harness. Historical artifact from Stage 1's "naive Beta-argmax" experiment. |
| `scripts/pyin-stage2-harness.js` | Stage 2 (option A then B) sweep harness — full Hillenbrand corpus + synthetic stress, multiple lookbacks. |
| `scripts/pyin-stage2b-sigma-sweep-harness.js` | The sigma sweep that selected σ=75. Hillenbrand + PTDB-TUG, sigma ∈ {15, 20, 30, 50, 75, 100}, L=2. |
| `scripts/tune-harmonic-gates.js` | **OBSOLETE.** Text-substitutes `HARMONIC_IMPROVEMENT_MIN` and `HARMONIC_RELATIVE_K2` into the worker source — those constants no longer exist after pass 3. The script's findings are preserved in `measurements/harmonic-gate-*-2026-05-04.{csv,md,txt}`. **Recommend: delete during commit prep.** |

### Measurement files (all commit; large directory)

| Path | Notes |
|---|---|
| `measurements/harmonic-gate-analysis-2026-05-04.md` | σ-sweep precursor: Pareto analysis of HARMONIC_* constants. Historical: led to the `0.003 → 0.010` ship before pYIN work began. |
| `measurements/harmonic-gate-sweep-2026-05-04-summary.txt` | Same era; raw sweep summary. |
| `measurements/harmonic-gate-sweep-2026-05-04.csv` | Same era; full sweep grid. |
| `measurements/pitch-after-impMin-tighten-2026-05-04.txt` | Pre-pYIN ship: `HARMONIC_IMPROVEMENT_MIN: 0.003 → 0.010` ship summary. |
| `measurements/pitch-after-impMin-tighten-2026-05-04-{accuracy,comprehensive,pitch-smoothing,real-speech,yin-harmonic}.txt` | Per-suite outputs from that ship. |
| `measurements/pyin-stage1-2026-05-04.md` | Stage 1 (Beta-argmax, no HMM) writeup. |
| `measurements/pyin-stage1-2026-05-04-harness.txt` | Raw harness output. |
| `measurements/pyin-stage2-2026-05-04.md` | Stage 2 option (A) writeup — single-unvoiced-super-state design, exposed the voicing-trap failure. |
| `measurements/pyin-stage2-2026-05-04-harness.txt` | Raw output. |
| `measurements/pyin-stage2b-2026-05-04.md` | Stage 2 option (B) writeup — voicing-duplicated 600-state space. |
| `measurements/pyin-stage2b-2026-05-04-harness.txt` | Raw output. |
| `measurements/pyin-stage2b-degraded-2026-05-04-harness.txt` | Stage 2.B σ=20 on Hillenbrand-degraded variants. |
| `measurements/pyin-stage2b-degraded-sigma75-2026-05-04-harness.txt` | Stage 2.B σ=75 on Hillenbrand-degraded variants. |
| `measurements/pyin-stage2b-ptdb-2026-05-04-harness.txt` | Stage 2.B σ=20 on PTDB-TUG; surfaced the σ=20 regression. |
| `measurements/pyin-stage2b-realworld-2026-05-04.md` | Corpus expansion writeup. |
| `measurements/pyin-stage2b-sigma-sweep-2026-05-04.md` | **σ=75 selection writeup.** Pareto across Hillenbrand + PTDB-TUG. |
| `measurements/pyin-stage2b-sigma-sweep-2026-05-04-harness.txt` | Raw output. |
| `measurements/pass1-helper-diagnostic-2026-05-04.md` | Helper-choice diagnostic that surfaced the `steadyStateDetect` vs `streamingMedianDetect` split. |
| `measurements/pass1-stage2b-baseline-2026-05-04.md` | Pass 1 canonical baseline writeup (post-helper-fix). |
| `measurements/pass2-vmcontext-conversion-2026-05-04.md` | Pass 2 writeup (vm-context conversion of inline-copy tests). |
| `measurements/pass3-multimult-deletion-2026-05-04.md` | Pass 3 writeup (multi-mult dead-code deletion). |
| **`measurements/pass4-stage2b-final-baseline-2026-05-04.md`** | **Canonical final baseline. Reference this in the commit message.** |
| `measurements/pass1/{accuracy,comprehensive,real-speech,smoothing,yin-harmonic}.txt` | Per-suite raw outputs from each four-pass stage. |
| `measurements/pass2/...` | Same. |
| `measurements/pass3/...` | Same. |
| `measurements/pass4/...` | Same. |

### Old-build-output baselines (in `docs/`, but per CLAUDE.md `docs/` is overwritten on deploy)

| Path | Treatment |
|---|---|
| `docs/pitch-baseline-2026-05-04-{accuracy,comprehensive,pitch-smoothing,real-speech,yin-harmonic}.txt` | These were captured in the FIRST session of this multi-session arc, before the `measurements/` convention was added to CLAUDE.md. They're functionally measurement files in the wrong location. **Recommend: move to `measurements/` for consistency, OR delete (superseded by later canonical baselines in `measurements/pass4/`).** Either way, don't leave them in `docs/` — that directory gets overwritten by `npm run build`. |
| `docs/pitch-experiment-2026-05-04-...` (5 files) | Same situation. The "experiment" suffix denotes the post-tune-experiment outputs from the same first session. Same recommendation. |

## Category 2: Modified files (different content in both trees)

| Path | Diff lines | Summary of changes |
|---|---:|---|
| `CLAUDE.md` | ~12 | Added "Measurements & empirical results" section + the "Pitch-detector tuning oracles" note. **NOTE: pass-4 CLAUDE.md updates (multi-frame canonical methodology, two-voicedness architecture, σ=75 default) were deferred for consolidation and are NOT yet in this file.** |
| `src/dsp/dsp-worker.js` | 608 | Headline change: full pYIN Stage 2.B implementation. (a) Beta(2,18) CDF lookup table + threshold integration (Stage 1). (b) HMM with bounded-history Viterbi over 600-state voicing-duplicated space (Stage 2.B). (c) σ=75 cents transition prior. (d) `_pyinLastVoicedness` (HMM-smoothed posterior, surfaced on postMessage payload as `voicedness`) + `_pyinLastVoicednessObs` (raw candidate-mass signal, internal). (e) `_PYIN_STAGE_DEFAULT = 2` (pYIN production default). (f) Stage 1, Stage 2.B helpers `_detectPitchPyinStage1` / `_detectPitchPyinStage2`. (g) `set-pyin-sigma`, `reset-pitch-hmm` message handlers. (h) Multi-mult correction block + `HARMONIC_IMPROVEMENT_MIN` / `HARMONIC_RELATIVE_K2` constants DELETED (pass 3 cleanup). |
| `tests/dsp/accuracy-test.js` | 252 | vm-context conversion. Deleted inline `fft` (~37 lines) and inline `detectPitch` (~103 lines); kept inline formant code. Added `loadWorker`, `steadyStateDetect`, `streamingMedianDetect`. Synthetic call sites use `steadyStateDetect`; Hillenbrand uses `streamingMedianDetect` on full samples. |
| `tests/dsp/pitch-detection-comprehensive.js` | 264 | (a) Helper-choice contract docblock at top. (b) `loadWorker` returns `ctx`, `getLastVoicedness`, `getLastVoicednessObs`. (c) `steadyStateDetect` helper. (d) Per-stimulus call sites in [1]–[11], [13] use `steadyStateDetect`. (e) Section [15] inline-copy audit removed (now obsolete). (f) 8 pass-4 assertion rewrites: 600 Hz boundary, silence/DC/noise → voicednessObs-based, vibrato tolerance widened, 0 dB SNR predicate expanded, `[12b]` reset between f-loop iterations. Each rewrite has an intent-preserving comment. |
| `tests/dsp/real-speech-test.js` | 91 | (a) Helper-choice contract docblock. (b) `loadWorker` returns `ctx`. (c) Both `steadyStateDetect` AND `streamingMedianDetect` defined with per-helper headers. (d) Pass 1 single-window-per-file call replaced with `streamingMedianDetect(w16, samples, 16000)`. Pass 2 multi-frame stepping unchanged (production-mirror semantics). |
| `tests/dsp/yin-harmonic-test.js` | 215 | vm-context conversion. Deleted inline `fft` and inline `detectPitch`. Added `loadWorker`, `steadyStateDetect`. All 6 call sites use `steadyStateDetect(w48, sig, SR)`. |

### Files that show up in raw `diff -rq` but are CRLF-only artifacts

These differ on disk because the zip extraction gave Windows-style CRLF line endings, but content is unchanged. **Do NOT copy these to the clean clone** — that would just introduce noise. Listed here so you can verify with `diff --strip-trailing-cr` if you want to spot-check:

`.github/workflows/deploy.yml`, `.gitignore`, `ARCHITECTURE.md`, `README.md`, `docs/Syrinx.svg`, `docs/assets/*`, `docs/capture-processor.js`, `docs/index.html`, `eslint.config.js`, `index.html`, `package-lock.json`, `package.json`, `public/*`, all `src/components/*.jsx`, `src/App.jsx`, `src/db.js`, `src/index.css`, `src/main.jsx`, `src/audio/{pitchSmoothing.js,useAudioPipeline.js}`, `src/ml/*`, `src/utils/*`, `tests/audio/pitch-smoothing-test.js`, `tests/dsp/{formant-debug,latency-benchmark}.js`, `tests/ml/*`, `vite.config.js`.

(`.github/workflows/deploy.yml` is the GitHub Actions config; on a Windows clone of a Unix-line-ending repo, it would show CRLF. No real change.)

## Category 3: Deleted files (in Syrinx-clone but not in Syrinx)

**None.** No files were deleted from the working tree during this session. Confirmed via `diff -rq` "Only in Syrinx-clone" entries — only `.git/` itself, which is expected.

## Summary

- **6 modified files** (CLAUDE.md + 1 worker + 4 test files)
- **2 new test files** (`degraded-test.js`, `ptdb-tug-test.js`)
- **2 new committed files** in `tests/dsp/data/ptdb-tug/` (.gitignore + README; audio is gitignored)
- **7 new scripts** (one obsolete: `tune-harmonic-gates.js` — recommend delete)
- **~40 new measurement files** in `measurements/` (durable record of the multi-session work)
- **10 misplaced files** in `docs/` from session 1 (recommend move-to-measurements or delete)
- **0 deleted files**

## Notes for the manual copy/commit step

1. The single most important file to commit-message-cite is
   [pass4-stage2b-final-baseline-2026-05-04.md](pass4-stage2b-final-baseline-2026-05-04.md)
   — that's the canonical Stage 2.B σ=75 reference.
2. The σ=75 selection rationale lives in
   [pyin-stage2b-sigma-sweep-2026-05-04.md](pyin-stage2b-sigma-sweep-2026-05-04.md).
   Worth citing if the commit message explains the σ choice.
3. Update the repo-root `.gitignore` to add
   `tests/dsp/data/ptdb-tug/{FEMALE,MALE}/` for top-level discoverability,
   even though the subdir-local `.gitignore` already excludes the audio.
4. Decide on the `docs/pitch-{baseline,experiment}-*.txt` files: move
   to `measurements/`, or delete as superseded by `measurements/pass4/`.
5. Decide on `scripts/tune-harmonic-gates.js`: delete (it'll throw if
   run, since the constants it patches no longer exist).
6. CLAUDE.md is currently in mid-flight: pass-1-era updates landed,
   pass-4-era updates (multi-frame canonical methodology, two-voicedness
   architecture, σ=75 default, stateful detectPitch + reset-pitch-hmm)
   were deferred for the consolidation step and need to be added before
   commit per the prior consolidation plan.
