#!/usr/bin/env bash
# run-dumps.sh — every production-chain dump of the voice-detector benchmark
# (dump.mjs), at most MAXJ (default 3) node processes at a time. Resumable:
# streams whose dump exists are skipped.
#
#   NOTCHVD_ROOT=<...>/build/notchvd SYRINX_CORPORA_DIR=<checkout>/tests/dsp/data \
#     [OUT=build/vad] [SRC=src] [MAXJ=3] bash scripts/voice-detector/run-dumps.sh [set ...]
set -euo pipefail
OUT=${OUT:-build/vad}; SRC=${SRC:-src}; MAXJ=${MAXJ:-3}
: "${NOTCHVD_ROOT:?set NOTCHVD_ROOT}"
declare -A SHARDS=( [noise]=3 [noiseho]=1 [vin20]=6 [vin0]=3 [fda]=1 [ptdb]=1 [voc]=1 [hil]=1 [vocalset]=2 [pvqd]=2 [voiced]=1 )
SETS=("$@"); [ ${#SETS[@]} -eq 0 ] && SETS=(vin20 vin0 noise noiseho pvqd vocalset voiced voc ptdb fda hil)
mkdir -p "$OUT/logs"
for s in "${SETS[@]}"; do n=${SHARDS[$s]}; for ((i = 0; i < n; i++)); do echo "$s $i/$n"; done; done |
  xargs -P "$MAXJ" -L 1 bash -c 'node --import ./scripts/session-oracle/lib/register.mjs scripts/voice-detector/dump.mjs \
    --set="$0" --shard="$1" --out="'"$OUT"'" --src="'"$SRC"'" --skip-existing >> "'"$OUT"'/logs/dump-$0-${1%/*}.log" 2>&1 \
    && tail -1 "'"$OUT"'/logs/dump-$0-${1%/*}.log"'
