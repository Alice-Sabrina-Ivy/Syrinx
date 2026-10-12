#!/usr/bin/env bash
# run-r4-select.sh — custom voice detector, round 4 (pre-registration 2026-10-11 §4;
# Addendum R4-B part 2, B.10): selection files and the rule, VALIDATION data only.
#   bash scripts/voice-detector/train/run-r4-select.sh cand RUN   # one run's EMA checkpoints 4000..16000 (plain): fresh + tuning 194, one-room sessions, spliced
#   bash scripts/voice-detector/train/run-r4-select.sh fsr4val RUN   # the same checkpoints on the 14 fsr4 val clips (reported row only)
#   bash scripts/voice-detector/train/run-r4-select.sh rule        # opselect_r3.py over every round-4 candidate + the custom-vd-r3 reference row
set -euo pipefail
cd "$(dirname "$0")"
PY=../../../build/vad-train/venv/Scripts/python.exe
R=../../../build/vad-train
SEL=$R/r4/sel
mkdir -p $SEL
STEPS="4000 6000 8000 10000 12000 14000 16000"
case "$1" in
  cand)
    NETS=""
    for s in $STEPS; do NETS="$NETS${NETS:+,}$2-e$s=$R/train/runs/$2/ckpt_ema_$(printf %06d $s).pt"; done
    PYTHONIOENCODING=utf8 $PY infer_r3.py --nets="$NETS" --groups=fresh,vsess,spl --variants=plain --out=$R/r4/cand ;;
  fsr4val)
    for s in $STEPS; do
      n=$2-e$s
      PYTHONIOENCODING=utf8 $PY infer.py --ckpt=$R/train/runs/$2/ckpt_ema_$(printf %06d $s).pt --out=$R/r4/cand/$n/plain --root=$R/r4/fsr4val --sets=fsr4val
    done ;;
  rule)
    C=""
    for d in $R/r4/cand/*/; do C="$C${C:+,}$(basename $d):plain"; done
    PYTHONIOENCODING=utf8 python opselect_r3.py --root=$R/r4/cand --cands="$C" --json=$SEL/sel-r4.json
    PYTHONIOENCODING=utf8 python opselect_r3.py --root=$R/r3/cand --cands=r9-sess-b-e8000:plain --json=$SEL/sel-r4-ref.json --force ;;
  *) echo "usage: $0 cand RUN | fsr4val RUN | rule"; exit 2 ;;
esac
