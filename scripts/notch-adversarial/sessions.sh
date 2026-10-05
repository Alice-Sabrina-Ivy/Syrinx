#!/bin/bash
# sessions.sh TAG_A SRC_A TAG_B SRC_B — session oracle (scripts/session-
# oracle/, the 4 private sessions) on two src trees, then analyze.py A B.
# e.g. bash scripts/notch-adversarial/sessions.sh r1b build/notch-adv/otree/bc42/src r1s src
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"; cd "$ROOT"
R=build/notch-adv/res/or; mkdir -p $R
# at most MAXJ (default 4) at once (shared workstation); SRC_A empty = reuse
# an existing TAG_A run
MAXJ=${MAXJ:-4}
throttle() { while (( $(jobs -rp | wc -l) >= MAXJ )); do wait -n; done; }
for s in 2025-09-08 2026-05-07 2026-05-26 2026-06-09; do
  if [ -n "$2" ]; then throttle
  node --import ./scripts/session-oracle/lib/register.mjs scripts/session-oracle/run.mjs --src=$2 --tag=$1 --refs=build/session-oracle/refs --sessions=$s > $R/sess_$1_$s.txt 2>&1 &
  fi; throttle
  node --import ./scripts/session-oracle/lib/register.mjs scripts/session-oracle/run.mjs --src=$4 --tag=$3 --refs=build/session-oracle/refs --sessions=$s > $R/sess_$3_$s.txt 2>&1 &
done
wait
python scripts/session-oracle/analyze.py $1 $3 > $R/sess_analyze_$1_$3.txt 2>&1
echo SESSIONS-DONE
