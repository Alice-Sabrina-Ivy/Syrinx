#!/bin/sh
# level-conds.sh <shard> <nshards> — runs every level / noise / floor condition's shard in turn.
# Conditions (cond|pert|kinds); gates both; out build/resonance-mobile/level.
cd "$(dirname "$0")/../../.." || exit 1
FLOOR='[{"type":"gain","db":-20},{"type":"mod","path":"scripts/resonance/mobile/level-floor.mjs","params":{"dbfs":-80}}]'
run() { node scripts/resonance/mobile/level-run.mjs run --cond="$1" --pert="$2" --kinds="$3" --gate=both --shard=$SH/$NS >> build/resonance-mobile/level/logs/$1-$SH.log 2>&1 || echo "FAILED $1 shard $SH" >> build/resonance-mobile/level/logs/failed.log; }
SH=$1; NS=$2
run g0 "" exc
run g-20 "gain:-20" ctl,sw,exc,long
run g-40 "gain:-40" ctl,sw,exc,long
run g-10 "gain:-10" ctl,sw,exc,long
run g-30 "gain:-30" ctl,sw,exc,long
run g-20_pink20 "gain:-20+noise:pink:20" ctl,sw,exc,long
run g-20_brown20 "gain:-20+noise:brown:20" ctl,sw,exc,long
run g-20_floor80 "$FLOOR" ctl,sw,exc,long
run g-20_pink10 "gain:-20+noise:pink:10" ctl,sw,exc,long
run g-20_brown10 "gain:-20+noise:brown:10" ctl,sw,exc,long
run g-20_pink30 "gain:-20+noise:pink:30" ctl,sw,exc,long
run g-20_brown30 "gain:-20+noise:brown:30" ctl,sw,exc,long
echo "DONE shard $SH" >> build/resonance-mobile/level/logs/done.log
