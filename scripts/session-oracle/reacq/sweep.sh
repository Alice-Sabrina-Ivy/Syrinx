#!/bin/bash
# sweep.sh VARFILE [PAR]  — VARFILE lines: "tag json". Replays every variant on
# the 4 cached sessions through the real hook (var tree) and scores it with
# analyze.py (--quiet, JSON to build/session-oracle/scores/<tag>.json).
cd "$(dirname "$0")/../../.." && mkdir -p build/reacq/logs
VF=$1; PAR=${2:-4}
R="node --import ./scripts/session-oracle/lib/register.mjs"
run_one() {
  tag=$1; js=$2
  $R scripts/session-oracle/reacq/replay.mjs --src=build/trees/reacq-var/src --tag=$tag --set=sessions --pgv="$js" > build/reacq/logs/rp_$tag.log 2>&1 \
    && python scripts/session-oracle/analyze.py $tag --quiet >> build/reacq/logs/rp_$tag.log 2>&1 && echo "done $tag"
}
export -f run_one; export R
while read -r tag js; do
  while [ $(jobs -rp | wc -l) -ge $PAR ]; do sleep 1; done
  run_one "$tag" "$js" &
done < <(grep -v "^#" "$VF" | grep -v "^$")
wait
