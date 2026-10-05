#!/bin/sh
# Runs the real Syrinx chain over all corpora for the three Syrinx rows.
# Usage (repo root): sh scripts/pitch-benchmark/run_syrinx_corpora.sh [parallel=10]
# Trees (override with MAIN_SRC / NEW_SRC / NEW600_SRC): main = origin/main src
# extracted to $WORK/trees/main/src, new = src, new600 = $WORK/trees/new600/src
# (the new tree with BOERSMA_DEFAULTS.maxPitchHz 800 -> 600).
P=${1:-10}
WORK=${PITCH_BENCH_DIR:-build/pitch-benchmark}
MAIN_SRC=${MAIN_SRC:-$WORK/trees/main/src}
NEW_SRC=${NEW_SRC:-src}
NEW600_SRC=${NEW600_SRC:-$WORK/trees/new600/src}
mkdir -p "$WORK/logs"
for spec in "main:$MAIN_SRC" "new:$NEW_SRC" "new600:$NEW600_SRC"; do
  tag=${spec%%:*}; src=${spec#*:}
  for cs in fda:2 hil:3 ptdb:6 voc:4; do
    c=${cs%%:*}; n=${cs#*:}; i=0
    while [ $i -lt $n ]; do echo "$tag $src $c $i/$n"; i=$((i+1)); done
  done
done | WORK="$WORK" xargs -P "$P" -L 1 sh -c 'node --import ./scripts/session-oracle/lib/register.mjs scripts/pitch-benchmark/syrinx_corpus.mjs --tag=$0 --src=$1 --corpus=$2 --shard=$3 > "$WORK/logs/syr_$0_$2_$(echo $3 | tr / _).log" 2>&1'
echo done
