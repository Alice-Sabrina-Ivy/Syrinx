# Quiet floor ("too quiet to be a voice") — measurement harness

Pre-registration, results and verdict:
[measurements/pitch-quiet-floor-2026-10-20.md](../../measurements/pitch-quiet-floor-2026-10-20.md)
(2026-10-20: FAIL — no floor on the current level reading is both safe for soft
speech and useful in a quiet room).

Every script drives the REAL pitch worker, DSP worker and `useAudioPipeline`
hook through `scripts/session-oracle/lib/chain.mjs`; the Node ones need its
loader (`node --import ./scripts/session-oracle/lib/register.mjs …`; `SO_TAP=0`
skips the observation tap and is faster). Public outputs go to the gitignored
`build/quiet-floor/`; anything computed on private recordings goes to a folder
outside the repository (`--out`).

| Script | Role |
|---|---|
| `make-trees.mjs` | baseline `src` (`git archive`) + candidate trees in `build/trees/qf-*` (`--extra=80,…` adds gate-only floors) |
| `prep_libri.py` | LibriSpeech dev-clean / test-clean items + Praat AC references (`--libri=<LibriSpeech root>`) |
| `corpus-qf.mjs` | public corpora at scaled voiced levels, per candidate (`--corpus=fda\|ptdb\|hil\|voc\|libri --split=dev\|held`) |
| `report-qf.mjs`, `tables-qf.mjs` | safety tables and the pre-registered decision |
| `file-qf.mjs` | one WAV (e.g. a noise-only room recording) through every candidate |
| `replay-qf.mjs` | an in-app `?diag=1` snapshot replayed through the real hook |
| `noise-qf.mjs` | noise-fv classes at several RMS scales |
| `sessions-qf.mjs`, `score_sessions.py` | the private session recordings (`$SYRINX_SESSIONS_DIR`); then `scripts/session-oracle/session_fv.py --attr=<out> --refs=<refs>` |
| `noise-augment-variant.mjs` | copies of `noise-augment-oracle.js` on a candidate tree (G·F check) |
| `level-offset.mjs` | guard-floor frame level vs DSP intensity |
| `chrome-level-check.mjs`, `chrome-level-compare.mjs` | Chrome (MSTP + AudioWorklet) vs Node DSP intensity on one WAV (headless puppeteer, temporary profile, PID-scoped cleanup) |

Order used: `make-trees` → `prep_libri` → `corpus-qf` (dev, every corpus,
sharded) → `report-qf --tag=dev` → `file-qf` / `replay-qf` / `noise-qf` /
`sessions-qf` → `tables-qf`.
