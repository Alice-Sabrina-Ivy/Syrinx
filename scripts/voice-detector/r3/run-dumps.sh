#!/usr/bin/env bash
# run-dumps.sh — custom voice detector, round 3: the current app's production
# chain (train/valdump.mjs, dump.mjs format and labels) over the round-3 stream
# sets, at most MAXJ (default 2) node processes. Resumable (--skip-existing).
#   ROOT=build/vad-train/r3/conf bash scripts/voice-detector/r3/run-dumps.sh cvoice:4 cneg:2 ...
#   ROOT=build/vad-train/r3/vsess bash scripts/voice-detector/r3/run-dumps.sh vsess:4
set -euo pipefail
ROOT=${ROOT:?set ROOT}; SRC=${SRC:-src}; MAXJ=${MAXJ:-2}
mkdir -p "$ROOT/logs"
for spec in "$@"; do s=${spec%%:*}; n=${spec##*:}; for ((i = 0; i < n; i++)); do echo "$s $i/$n"; done; done |
  xargs -P "$MAXJ" -L 1 bash -c 'node --import ./scripts/session-oracle/lib/register.mjs scripts/voice-detector/train/valdump.mjs \
    --set="$0" --shard="$1" --val="'"$ROOT"'" --src="'"$SRC"'" --skip-existing >> "'"$ROOT"'/logs/dump-$0-${1%/*}.log" 2>&1 \
    && tail -1 "'"$ROOT"'/logs/dump-$0-${1%/*}.log"'
