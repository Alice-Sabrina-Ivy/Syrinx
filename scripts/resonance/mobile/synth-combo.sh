#!/usr/bin/env bash
# synth-combo.sh — synthesis check (mobile resonance diagnosis, 2026-10-28):
# are a darkening mic shape and an unsuppressed noise floor additive?
# Gate on, ctl + exc streams, 3 shards per condition, conditions in sequence
# (at most 3 heavy processes). Output: build/resonance-mobile/synthesis/<cond>.
cd "$(dirname "$0")/../../.." || exit 1
OUT=build/resonance-mobile/synthesis
run() { # cond pert
  for i in 0 1 2; do
    node scripts/resonance/mobile/level-run.mjs run --cond="$1" --pert="$2" --gate=on --kinds=ctl,exc --shard=$i/3 --out=$OUT > "$OUT/logs/$1-$i.log" 2>&1 &
  done
  wait
}
run s-pink20 "level:-34+noise:pink:20"
run s-peak3k-pink20 "peak:3000:6:2+level:-34+noise:pink:20"
run s-lp8b4k-pink20 "lp:4000:2.5629+lp:4000:0.9+lp:4000:0.6013+lp:4000:0.5098+level:-34+noise:pink:20"
echo ALLDONE > "$OUT/logs/done.txt"
