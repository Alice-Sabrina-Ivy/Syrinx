#!/usr/bin/env bash
# run-r5-select.sh — custom voice detector, round 5 (pre-registration 2026-10-12 §4;
# Addendum R5-B part 2, B2.6): selection files and the rule, VALIDATION data only.
#   bash scripts/voice-detector/train/run-r5-select.sh cand RUN   # one run's EMA checkpoints 4000..16000 (plain): fresh + tuning 194, one-room sessions, spliced, H rows
#   bash scripts/voice-detector/train/run-r5-select.sh rule [RUN..] # opselect_r5.py over the round-5 candidates (all, or the listed runs) + the two reference rows
set -euo pipefail
cd "$(dirname "$0")"
PY=../../../build/vad-train/venv/Scripts/python.exe
R=../../../build/vad-train
SEL=$R/r5/sel
mkdir -p $SEL
STEPS="4000 6000 8000 10000 12000 14000 16000"
case "$1" in
  cand)
    NETS=""
    for s in $STEPS; do NETS="$NETS${NETS:+,}$2-e$s=$R/train/runs/$2/ckpt_ema_$(printf %06d $s).pt"; done
    PYTHONIOENCODING=utf8 $PY infer_r3.py --nets="$NETS" --groups=fresh,vsess,spl,hval --variants=plain --out=$R/r5/cand ${BUDGET:+--budget=$BUDGET} ;;
  rule)
    shift
    C=""
    for d in $R/r5/cand/*/; do
      n=$(basename $d)
      if [ $# -eq 0 ] || printf '%s\n' "$@" | grep -qx "${n%-e*}"; then C="$C${C:+,}$n:plain"; fi
    done
    PYTHONIOENCODING=utf8 python opselect_r5.py --root=$R/r5/cand --cands="$C" --json=$SEL/sel-r5.json
    PYTHONIOENCODING=utf8 python opselect_r5.py --root=$R/r4/cand --cands=r10-notch-e8000:plain --json=$SEL/sel-r5-ref4.json
    PYTHONIOENCODING=utf8 python opselect_r5.py --root=$R/r3/cand --cands=r9-sess-b-e8000:plain --json=$SEL/sel-r5-ref3.json ;;
  *) echo "usage: $0 cand RUN | rule [RUN..]"; exit 2 ;;
esac
