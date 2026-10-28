#!/usr/bin/env bash
# pause-queue.sh — one shard of the pause-floor runs: the EXISTING runner
# (chain.mjs run: real pitch worker + real FireRedVAD, the resonance worker's
# chain, gate on) over the 12 readers' 150 s long streams at a -32 dBFS active
# speech level with stationary room noise at each pause floor, then the
# noise-only streams. Run 4 shards in parallel:
#   for i in 0 1 2 3; do bash scripts/resonance/mobile/pause-queue.sh $i 4 & done
# Then: pause-row.mjs (DSP worker + real hook + cue strip) and pause-report.mjs.
set -u
SI=$1; SN=$2
cd "$(dirname "$0")/../../.."
ROOT="$(pwd -W 2>/dev/null || pwd)"
MOD="$ROOT/scripts/resonance/mobile/pause-noise.mjs"
OUT=build/resonance-mobile/pause/runs
SEED=20261028
FLOORS="-50 -48 -52 -55 -45 -60 -40 -70"
FAMS=${FAMS:-brown pink}   # FAMS="ac": the real air-conditioner clip (MS-SNSD, CC0) looped
AC="$ROOT/tests/dsp/data/notch-real/ac114.wav"
noise() {
  if [ "$1" = ac ]; then echo "{\"type\":\"mod\",\"path\":\"$MOD\",\"params\":{\"kind\":\"file\",\"path\":\"$AC\",\"floorDb\":$2,\"hp\":50,\"hpN\":1,\"seed\":$SEED}}"
  else echo "{\"type\":\"mod\",\"path\":\"$MOD\",\"params\":{\"kind\":\"$1\",\"floorDb\":$2,\"hp\":50,\"hpN\":1,\"seed\":$SEED}}"; fi
}
name() { echo "$1_m${2#-}"; }
run() { # cond pert [extra args]
  local cond=$1 pert=$2; shift 2
  echo "== $(date +%T) $cond shard $SI/$SN"
  node scripts/resonance/mobile/chain.mjs run --cond="$cond" --pert="$pert" --gate=on --out="$OUT" "$@" || echo "!! $cond failed"
}
# speech: clean (level only) and both noise families at every floor
run clean '[{"type":"level","dbfs":-32}]' --kinds=long --shard="$SI/$SN"
for f in $FLOORS; do
  for k in $FAMS; do
    extra=()
    if [ "$f" = "-50" ] || [ "$f" = "-48" ]; then extra=(--worker); fi
    run "$(name $k $f)" "[{\"type\":\"level\",\"dbfs\":-32},$(noise $k $f)]" --kinds=long --shard="$SI/$SN" "${extra[@]}"
  done
done
# noise only (no speech): one 150 s stream per floor and family, spread over the shards
i=0
for f in $FLOORS; do
  for k in $FAMS; do
    if [ $((i % SN)) -eq "$SI" ]; then
      run "N-$(name $k $f)" "[$(noise $k $f)]" --f32=build/resonance-mobile/pause/zeros150.f32 --id=noise --sex=na
    fi
    i=$((i + 1))
  done
done
echo "== $(date +%T) shard $SI/$SN done"
