#!/bin/bash
# csweep.sh VARFILE [PAR] — corpus replays (fda ptdb hil voc) for each variant line "tag json"
cd "$(dirname "$0")/../../.." && mkdir -p build/reacq/logs
VF=$1; PAR=${2:-6}
R="node --import ./scripts/session-oracle/lib/register.mjs"
while read -r tag js; do
  for c in fda ptdb hil voc; do
    while [ $(jobs -rp | wc -l) -ge $PAR ]; do sleep 1; done
    $R scripts/session-oracle/reacq/replay.mjs --src=build/trees/reacq-var/src --tag=$tag --set=corpus --corpus=$c --pgv="$js" >> build/reacq/logs/c_$tag.log 2>&1 &
  done
done < <(grep -v "^#" "$VF" | grep -v "^$")
wait
