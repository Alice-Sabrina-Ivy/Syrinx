#!/bin/sh
# level-helper.sh <k> — helps shard 2/3 of level-conds2.sh from the END of its queue:
# runs --shard=<k>/6 (k = 2 or 5: together exactly shard 2/3's items) for the
# conditions in reverse order; finished (id, gate) pairs are skipped (resumable).
cd "$(dirname "$0")/../../.." || exit 1
FLOOR='[{"type":"gain","db":-20},{"type":"mod","path":"scripts/resonance/mobile/level-floor.mjs","params":{"dbfs":-80}}]'
K=$1
run() { node scripts/resonance/mobile/level-run.mjs run --cond="$1" --pert="$2" --kinds="$3" --gate=both --shard=$K/6 >> build/resonance-mobile/level/logs/$1-h$K.log 2>&1 || echo "FAILED $1 helper $K" >> build/resonance-mobile/level/logs/failed.log; echo "$1 h$K" >> build/resonance-mobile/level/logs/progress.log; }
run g-10 "gain:-10" ctl,sw,exc
run g-20_brown30 "gain:-20+noise:brown:30" ctl,sw,exc
run g-20_pink30 "gain:-20+noise:pink:30" ctl,sw,exc
run g-20_brown10 "gain:-20+noise:brown:10" ctl,sw,exc
run g-20_floor80 "$FLOOR" ctl,sw,exc
run g-20_brown20 "gain:-20+noise:brown:20" ctl,sw,exc
echo "DONEH $K" >> build/resonance-mobile/level/logs/done.log
