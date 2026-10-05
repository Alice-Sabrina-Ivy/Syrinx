#!/bin/sh
# run_variant.sh TAG SRC — one src tree through the low-register voicing
# oracles (2026-10-04): lowband-attr.mjs over the four sessions + FDA / PTDB /
# Hillenbrand / vocadito (sharded) and noise-fv.mjs (4 seeds x 60 s per class),
# P processes in parallel (default 12). Needs the pitch-benchmark corpus dump
# in $PITCH_BENCH_DIR (default build/pb; scripts/pitch-benchmark/export_corpora.mjs).
cd "$(dirname "$0")/../../.."
export PITCH_BENCH_DIR="${PITCH_BENCH_DIR:-build/pb}"
export NFV="${NFV:---seeds=4 --sec=60 --out=build/session-oracle/noisefv4}"
TAG=$1; SRC=$2
mkdir -p build/logs/$TAG
{
echo "noisefv x x"
for s in 2025-09-08 2026-05-07 2026-05-26 2026-06-09; do echo "sessions 0/1 --sessions=$s"; done
for c in fda:1 ptdb:2 hil:2 voc:2; do n=${c#*:}; c=${c%%:*}; i=0; while [ $i -lt $n ]; do echo "$c $i/$n"; i=$((i+1)); done; done
} | xargs -P ${P:-12} -L 1 sh -c 'L=build/logs/'$TAG'/$0_$(echo $1$2 | tr "/=" "__").log; if [ $0 = noisefv ]; then node --import ./scripts/session-oracle/lib/register.mjs scripts/session-oracle/noise-fv.mjs $NFV --tag='$TAG' --src='$SRC' > $L 2>&1; else node --import ./scripts/session-oracle/lib/register.mjs scripts/session-oracle/lowband-attr.mjs --tag='$TAG' --src='$SRC' --set=$0 --shard=$1 $2 > $L 2>&1; fi'
grep -l -i error build/logs/$TAG/*.log && echo "ERRORS in $TAG"
echo done $TAG
