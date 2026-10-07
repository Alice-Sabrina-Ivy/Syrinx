#!/usr/bin/env bash
# run-valdumps.sh — production-chain dumps of the custom detector's validation
# streams (valdump.mjs), at most MAXJ (default 3) node processes. Resumable.
#   [VALROOT=build/vad-train/val] [SRC=src] [MAXJ=3] bash scripts/voice-detector/train/run-valdumps.sh [set ...]
set -euo pipefail
VALROOT=${VALROOT:-build/vad-train/val}; SRC=${SRC:-src}; MAXJ=${MAXJ:-3}
declare -A SHARDS=( [vneg]=1 [vvoice]=6 [vmix20]=6 [vmix0]=4 [tneg]=8 )
SETS=("$@"); [ ${#SETS[@]} -eq 0 ] && SETS=(vneg vvoice vmix20 vmix0)
mkdir -p "$VALROOT/logs"
for s in "${SETS[@]}"; do n=${SHARDS[$s]}; for ((i = 0; i < n; i++)); do echo "$s $i/$n"; done; done |
  xargs -P "$MAXJ" -L 1 bash -c 'node --import ./scripts/session-oracle/lib/register.mjs scripts/voice-detector/train/valdump.mjs \
    --set="$0" --shard="$1" --val="'"$VALROOT"'" --src="'"$SRC"'" --skip-existing >> "'"$VALROOT"'/logs/dump-$0-${1%/*}.log" 2>&1 \
    && tail -1 "'"$VALROOT"'/logs/dump-$0-${1%/*}.log"'
