#!/bin/sh
# Offline reference trackers over all corpora (Praat AC/CC, pYIN, PENN, CREPE).
# Usage (repo root): PY=<venv python with torchcrepe> sh scripts/pitch-benchmark/run_py_corpora.sh
# CREPE full is ~3.8 s of CPU per second of audio single-threaded (hours).
C=fda,ptdb,voc,hil
PY=${PY:-python}
D=scripts/pitch-benchmark
WORK=${PITCH_BENCH_DIR:-build/pitch-benchmark}
mkdir -p "$WORK/logs"
( for d in praat_ac praat_ac_cal praat_cc; do $PY $D/detectors.py $d $C --procs=4; done
  $PY $D/detectors.py pyin $C --procs=6 ) > "$WORK/logs/py_A.log" 2>&1 &
( $PY $D/detectors.py penn $C --procs=4 --threads=1
  $PY $D/detectors.py crepe_tiny $C --procs=4 --threads=1
  $PY $D/detectors.py crepe_full $C --procs=4 --threads=1 ) > "$WORK/logs/py_B.log" 2>&1 &
wait
