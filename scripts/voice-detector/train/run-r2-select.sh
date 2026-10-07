#!/usr/bin/env bash
# run-r2-select.sh — custom voice detector, round 2 (pre-registration
# Addendum D.4): selection inputs for EMA checkpoints of the round-2 runs —
# fresh-state probability files on the val streams and the tuning 194, the
# carried-state files (seed 20261007, sessions of >= 10 min), then the
# pre-registered rule (opselect.py --carried). Selection data only.
#   bash scripts/voice-detector/train/run-r2-select.sh r8a:8000 r8b:8000 ...
# STAGGER=T (Addendum F): the staggered state reset with period T s (stagger.py);
# candidate dirs get the suffix -st<T>.
set -euo pipefail
PY=build/vad-train/venv/Scripts/python.exe
R=build/vad-train
cks=(); outs=(); couts=()
for rs in "$@"; do
  run=${rs%%:*}; step=$(printf "%06d" "${rs##*:}")
  name="${run}e-s$((10#$step))${STAGGER:+-st$STAGGER}"
  cks+=("$R/train/runs/$run/ckpt_ema_$step.pt"); outs+=("$R/cand/$name"); couts+=("$R/cand/$name-carried")
done
CK=$(IFS=,; echo "${cks[*]}"); OUT=$(IFS=,; echo "${outs[*]}"); COUT=$(IFS=,; echo "${couts[*]}")
cd scripts/voice-detector/train
P=../../../$PY
ST=${STAGGER:+--stagger=$STAGGER}
PYTHONIOENCODING=utf8 $P infer.py --ckpt=$(echo "$CK" | sed "s#build/#../../../build/#g") --out=$(echo "$OUT" | sed "s#build/#../../../build/#g") \
  --root=../../../$R/val --sets=vvoice,vmix20,vmix0,vneg $ST
PYTHONIOENCODING=utf8 $P infer.py --ckpt=$(echo "$CK" | sed "s#build/#../../../build/#g") --out=$(echo "$OUT" | sed "s#build/#../../../build/#g") \
  --root=../../../build/vad --sets=noise --split=tune $ST
PYTHONIOENCODING=utf8 $P infer_carried.py --ckpt=$(echo "$CK" | sed "s#build/#../../../build/#g") --out=$(echo "$COUT" | sed "s#build/#../../../build/#g") \
  --streams="../../../$R/val:vvoice,vmix20,vmix0,vneg;../../../build/vad:noise@tune" --seed=20261007 --minutes=10 \
  --sessions-json=../../../${couts[0]}/sessions.json $ST
for o in "${outs[@]}"; do cp "../../../$o/candidate.json" "../../../$o-carried/candidate.json"; done
cd ../../..
PYTHONIOENCODING=utf8 python scripts/voice-detector/train/opselect.py "${outs[@]}" --carried --json="$R/cand/sel-r2-$(date +%H%M%S).json"
