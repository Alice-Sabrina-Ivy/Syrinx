# Pitch-detector benchmark

Head-to-head of the Syrinx pitch chain against the trackers people actually
use (Praat AC / CC, pYIN, PENN, CREPE, SwiftF0), on the same audio, scored the
same way (2026-10-04). Decision data and every number:
[measurements/pitch-detector-benchmark-2026-10-04.md](../../measurements/pitch-detector-benchmark-2026-10-04.md).

- **Ground-truth corpora** (FDA, PTDB-TUG, vocadito, Hillenbrand) through the
  project's own loaders, mir_eval-style metrics (RPA / RCA / ±5 % / GPE /
  FPE / VDE, octave classes), per-detector best time offset.
- **Alice's sessions** (no ground truth) against reference conventions that
  never score a tracker against itself (unanimous AC & SHS & PENN,
  leave-one-family-out, and a cross view against both two-voter references).
- **Cost**: CPU per second of audio, single thread, same 60 s clip.

Syrinx rows run the **real** chain (`pitch-worker.js` + `dsp-worker.js` +
`useAudioPipeline.js handleAnalysisResult`) through
[scripts/session-oracle/lib/chain.mjs](../session-oracle/README.md).

## Layout

No data is committed. Everything is written under the work dir
`$PITCH_BENCH_DIR` (default `build/pitch-benchmark/`, gitignored):
`data/` (corpus dump), `out/` (detector outputs, scores, timing), `tmp/`,
`logs/`, `trees/` (extracted src trees). Other inputs: session-oracle
references (`$SO_REFS`, default `build/session-oracle/refs`, from
`scripts/session-oracle/build_refs.py`) and session-oracle runs
(`build/session-oracle/runs/<tag>`), the private session WAVs + label parquet
(`$SYRINX_SESSIONS_DIR`, personal recordings outside the repo), and
`tests/dsp/data/swift-f0/model.onnx`.

| file | role |
|---|---|
| `paths.py` | shared locations (work dir, refs, sessions, model) |
| `export_corpora.mjs` | corpus dump via `tests/dsp/data/corpora.js` (bit-identical audio + refs for every detector) |
| `syrinx_corpus.mjs`, `run_syrinx_corpora.sh` | real Syrinx chain over the corpora (posted, painted, decoded, confidence per hop) |
| `detectors.py`, `run_py_corpora.sh` | Praat AC / CC, pYIN, PENN, CREPE wrappers over the corpora |
| `swift.py` | SwiftF0 offline and the retired production stream (corpora or one WAV) |
| `sess_detect.py` | offline trackers on the session spans |
| `score_corpora.py`, `score_sessions.py` | metrics, offset sweep, reference conventions |
| `sanity_baseline.py`, `sanity_sessions.py`, `mireval_check.py` | reproduction checks against the committed oracles and mir_eval |
| `timing.py`, `timing_syrinx.py` | CPU per second of audio |
| `make_tables.py` | the measurement's §5 tables |

## Setup

Python: `numpy scipy pandas pyarrow soundfile praat-parselmouth librosa
onnxruntime torch penn`; CREPE and the mir_eval cross-check need a venv with
`--system-site-packages` plus `torchcrepe mir_eval` (keeps the global Python
untouched):

```bash
python -m venv --system-site-packages build/pitch-benchmark/venv
build/pitch-benchmark/venv/Scripts/python -m pip install torchcrepe mir_eval
```

## Reproduce (repo root)

```bash
W=build/pitch-benchmark; VPY=$W/venv/Scripts/python
# 0. data + trees
node scripts/pitch-benchmark/export_corpora.mjs
mkdir -p $W/trees/main && git archive 4000952 src | tar -x -C $W/trees/main      # origin/main at benchmark time
mkdir -p $W/trees/new600 && git archive 39bd0ff src | tar -x -C $W/trees/new600  # then maxPitchHz 800 -> 600 in src/dsp/boersma-ac.js
# 1. Syrinx rows: corpora (new = ./src, or NEW_SRC=<tree> for the measured 39bd0ff src)
sh scripts/pitch-benchmark/run_syrinx_corpora.sh 9
#    sessions: main / new = session-oracle runs base / disp (scripts/session-oracle/README.md); new600:
for s in 2025-09-08 2026-05-07 2026-05-26 2026-06-09; do
  node --import ./scripts/session-oracle/lib/register.mjs scripts/session-oracle/run.mjs \
    --src=$W/trees/new600/src --tag=new600 --out=$W/out/sess_runs --refs=build/session-oracle/refs --sessions=$s & done; wait
# 2. offline trackers (CREPE full: hours of CPU)
PY=$VPY sh scripts/pitch-benchmark/run_py_corpora.sh
python scripts/pitch-benchmark/swift.py offline fda,ptdb,voc,hil; python scripts/pitch-benchmark/swift.py stream fda,ptdb,voc,hil
for d in praat_ac praat_ac_cal praat_cc; do python scripts/pitch-benchmark/sess_detect.py $d; done
python scripts/pitch-benchmark/sess_detect.py pyin --procs=4; python scripts/pitch-benchmark/sess_detect.py penn --procs=5
python scripts/pitch-benchmark/sess_detect.py swift_offline --procs=2; $VPY scripts/pitch-benchmark/sess_detect.py crepe_tiny --procs=4
for s in 2025-09-08 2026-05-07 2026-05-26 2026-06-09; do
  python scripts/pitch-benchmark/swift.py stream --wav="$SYRINX_SESSIONS_DIR/$s/session.wav" --name=$s; done
# 3. sanity, scoring, tables
python scripts/pitch-benchmark/sanity_baseline.py   # must print the 2026-10-03 committed corpus numbers
python scripts/pitch-benchmark/sanity_sessions.py   # must print 88.01 / 91.37 (session-oracle convention)
python scripts/pitch-benchmark/score_corpora.py     # PENN voicing 0.10; --penn-thr=X to change
python scripts/pitch-benchmark/score_sessions.py --dets=syrinx_main,syrinx_new,syrinx_new600,syrinx_main_disp,syrinx_new_disp,syrinx_new600_disp,praat_ac,praat_ac_cal,praat_cc,pyin,penn,crepe_tiny,swift_offline,swift_stream,swift_offline_g09,penn_ungated,crepe_tiny_ungated,swift_offline_ungated,pyin_ungated
$VPY scripts/pitch-benchmark/mireval_check.py
$VPY scripts/pitch-benchmark/timing.py && python scripts/pitch-benchmark/timing_syrinx.py   # idle machine
python -X utf8 scripts/pitch-benchmark/make_tables.py > $W/out/tables.md
```

## Verification (2026-10-04, at commit)

The committed scripts are the measured `build/benchmark/` scratch scripts with
only paths parametrised. Against the original outputs: `export_corpora.mjs`
reproduces the corpus dump (`index.json` and every file checked byte-equal on
the first 2 000 of 2 873); `syrinx_corpus.mjs` reproduces the FDA shard 0/2
Syrinx-main series byte-for-byte; `detectors.py praat_ac` and
`swift.py offline` reproduce FDA arrays exactly; `score_corpora.py`,
`score_sessions.py` and `make_tables.py` regenerate the measurement's tables
from the stored detector outputs (see the measurement's §10).
