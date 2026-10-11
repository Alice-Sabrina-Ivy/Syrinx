#!/usr/bin/env bash
# run-r3-select.sh — custom voice detector, round 3 (pre-registration
# 2026-10-07 §3; Addendum R3-B.3/B.4): selection files and the rule, on
# VALIDATION data only (fresh validation streams + tuning 194, the one-room
# validation sessions, round 2's spliced sessions).
#   bash scripts/voice-detector/train/run-r3-select.sh a0        # the A0 networks: plain, mean5/10, old5/10
#   bash scripts/voice-detector/train/run-r3-select.sh b RUN     # one round-3 run's EMA checkpoints: plain, old10
#   bash scripts/voice-detector/train/run-r3-select.sh rule      # opselect_r3.py over every candidate with files
set -euo pipefail
cd "$(dirname "$0")"
PY=../../../build/vad-train/venv/Scripts/python.exe
R=../../../build/vad-train
SEL=$R/r3/sel
mkdir -p $SEL
STEPS="8000 10000 12000 14000 16000"
case "$1" in
  a0)
    NETS="r5-bighard-e10000=$R/train/runs/r5-bighard/ckpt_ema_010000.pt"
    for s in $STEPS; do NETS="$NETS,r8a-e$s=$R/train/runs/r8a/ckpt_ema_$(printf %06d $s).pt"; done
    PYTHONIOENCODING=utf8 $PY infer_r3.py --nets="$NETS" --groups=fresh,vsess,spl --variants=plain,c5a,c5b,c10a,c10b ;;
  b)
    NETS=""
    for s in $STEPS; do NETS="$NETS${NETS:+,}$2-e$s=$R/train/runs/$2/ckpt_ema_$(printf %06d $s).pt"; done
    PYTHONIOENCODING=utf8 $PY infer_r3.py --nets="$NETS" --groups=fresh,vsess,spl --variants=plain,c10a,c10b ;;
  rule)
    C=""
    for d in $R/r3/cand/*/; do
      n=$(basename $d)
      if [ -d $d/c5a ]; then rules="plain mean5 mean10 old5 old10"; else rules="plain old10"; fi
      for r in $rules; do C="$C${C:+,}$n:$r"; done
    done
    PYTHONIOENCODING=utf8 python opselect_r3.py --cands="$C" --json=$SEL/sel-r3.json ;;
  *) echo "usage: $0 a0 | b RUN | rule"; exit 2 ;;
esac
