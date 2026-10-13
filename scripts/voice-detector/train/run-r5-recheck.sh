#!/usr/bin/env bash
# run-r5-recheck.sh — custom voice detector, round 5 (pre-registration 2026-10-12 §4
# "Deployable re-check and freeze"): the chosen checkpoint exported to streaming ONNX,
# EVERY selection file re-made with onnxruntime CPU, 1 thread, chunk by chunk (fresh
# validation streams, the tuning 194, the one-room validation sessions, the H rows,
# round 2's spliced sessions via infer_carried.py, seed 20261007), then the rule
# (opselect_r5.py, rule "file"). Validation data only. Run from the repository root.
#   bash scripts/voice-detector/train/run-r5-recheck.sh NET CKPT
set -euo pipefail
NET=$1; CK=$2
PY=build/vad-train/venv/Scripts/python.exe
T=scripts/voice-detector/train
R=build/vad-train
M=$R/model-r5/custom-vd-r5.onnx
O=$R/r5/cand-onnx/$NET-onnx
mkdir -p $R/model-r5 $O $R/r5/sel
export PYTHONIOENCODING=utf8
$PY $T/export.py --ckpt=$CK --out=$M --check=8
$PY $T/infer.py --onnx=$M --out=$O --root=$R/val --sets=vvoice,vmix20,vmix0,vneg --shard=0/2 &
$PY $T/infer.py --onnx=$M --out=$O --root=$R/val --sets=vvoice,vmix20,vmix0,vneg --shard=1/2
wait
$PY $T/infer.py --onnx=$M --out=$O --root=build/vad --sets=noise --split=tune &
$PY $T/infer.py --onnx=$M --out=$O --root=$R/r3/vsess --sets=vsess
wait
$PY $T/infer.py --onnx=$M --out=$O --root=$R/r5/hval --sets=h1,h2 --shard=0/2 &
$PY $T/infer.py --onnx=$M --out=$O --root=$R/r5/hval --sets=h1,h2 --shard=1/2
wait
S="$R/val:vvoice,vmix20,vmix0,vneg;build/vad:noise@tune"
$PY $T/infer_carried.py --onnx=$M --out=$O-carried --streams="$S" --seed=20261007 --minutes=10 --sessions-json=$O-carried/sessions-0.json --shard=0/2 &
$PY $T/infer_carried.py --onnx=$M --out=$O-carried --streams="$S" --seed=20261007 --minutes=10 --sessions-json=$O-carried/sessions-1.json --shard=1/2
wait
python - "$O-carried" <<'PYEOF'
import json, sys
ref = json.load(open("build/vad-train/cand/r8ae-s8000-carried/sessions.json", encoding="utf8"))["sessions"]
for k in (0, 1):
    s = json.load(open(f"{sys.argv[1]}/sessions-{k}.json", encoding="utf8"))
    assert s["seed"] == 20261007 and s["sessions"] == ref, "spliced construction differs from round 2's"
print(f"spliced construction identical to round 2's: {len(ref)} sessions")
PYEOF
cd $T
python opselect_r5.py --cands=../../../$O:file --json=../../../$R/r5/sel/sel-r5-onnx.json
