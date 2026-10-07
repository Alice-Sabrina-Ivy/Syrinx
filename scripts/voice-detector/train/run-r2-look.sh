#!/usr/bin/env bash
# run-r2-look.sh — custom voice detector, round 2 (pre-registration Addendum
# D.5): the harness probability files of the FROZEN round-2 candidate, written
# only after the freeze commit: fresh state (every harness stream, 3 shards) and
# carried state (all 4,305 streams concatenated in a seeded random order, seed
# 20261008, sessions of about 20 minutes). Both with the staggered state reset
# (T = 10 s, Addendum F), the deployable ONNX file, onnxruntime CPU, 1 thread.
# The look itself is score.py (see the evaluation note).
#   bash scripts/voice-detector/train/run-r2-look.sh
set -euo pipefail
PY=../../../build/vad-train/venv/Scripts/python.exe
M=../../../build/vad-train/model-r2/custom-vd-r2.onnx
OUT=../../../build/vad/cand/custom-vd-r2
SETS=noise,noiseho,vin20,vin0,fda,ptdb,voc,hil,vocalset,pvqd,voiced
cd scripts/voice-detector/train
for sh in 0 1 2; do
  PYTHONIOENCODING=utf8 $PY infer.py --onnx=$M --stagger=10 --out=$OUT --root=../../../build/vad --sets=$SETS --shard=$sh/3 &
done
wait
cp frozen/candidate-r2.json "$OUT/candidate.json"
PYTHONIOENCODING=utf8 $PY infer_carried.py --onnx=$M --stagger=10 --out=$OUT-carried \
  --streams="../../../build/vad:$SETS" --seed=20261008 --minutes=20 --cand-from=$OUT
