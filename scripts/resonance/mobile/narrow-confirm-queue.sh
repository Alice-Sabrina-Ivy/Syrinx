#!/usr/bin/env bash
# narrow-confirm-queue.sh — one shard of the confirmation speech runs of the
# narrower resonance-row hold round (measurements/resonance-row-hold-narrow-2026-11-01.md
# §5.2): pause-queue.sh's speech part with FAMS="brown pink ac",
# FLOORS="-55 -50 -48 -40", NOISE_ONLY=0, QUIET=1, the same seed (20261028),
# the same perturbation specs and --worker at -50 and -48 — run through the
# quiet runner narrow-confirm-chain.mjs (chain.mjs's functions and record,
# integrity lines only). Run 3 shards in parallel:
#   for i in 0 1 2; do bash scripts/resonance/mobile/narrow-confirm-queue.sh $i 3 & done
# Then: pause-row.mjs --runs=<OUT> --readers=<STREAMS>/readers-conf.json --quiet.
set -u
SI=$1; SN=$2
cd "$(dirname "$0")/../../.."
ROOT="$(pwd -W 2>/dev/null || pwd)"
MOD="$ROOT/scripts/resonance/mobile/pause-noise.mjs"
OUT=${OUT:-build/resonance-mobile/narrow/confirm/pause/runs}
STREAMS=${STREAMS:-build/resonance-mobile/narrow/confirm/streams}
TAG=${TAG:-conf}
SEED=20261028
FLOORS=${FLOORS:--55 -50 -48 -40}
FAMS=${FAMS:-brown pink ac}
AC="$ROOT/tests/dsp/data/notch-real/ac114.wav"
noise() {
  if [ "$1" = ac ]; then echo "{\"type\":\"mod\",\"path\":\"$MOD\",\"params\":{\"kind\":\"file\",\"path\":\"$AC\",\"floorDb\":$2,\"hp\":50,\"hpN\":1,\"seed\":$SEED}}"
  else echo "{\"type\":\"mod\",\"path\":\"$MOD\",\"params\":{\"kind\":\"$1\",\"floorDb\":$2,\"hp\":50,\"hpN\":1,\"seed\":$SEED}}"; fi
}
name() { echo "$1_m${2#-}"; }
run() { # cond pert [extra args]
  local cond=$1 pert=$2; shift 2
  echo "== $(date +%T) $cond shard $SI/$SN"
  node --max-old-space-size=4096 scripts/resonance/mobile/narrow-confirm-chain.mjs speech --cond="$cond" --pert="$pert" \
    --out="$OUT" --streams="$STREAMS" --tag="$TAG" --shard="$SI/$SN" "$@" || echo "!! $cond failed"
}
run clean '[{"type":"level","dbfs":-32}]'
for f in $FLOORS; do
  for k in $FAMS; do
    extra=()
    if [ "$f" = "-50" ] || [ "$f" = "-48" ]; then extra=(--worker); fi
    run "$(name $k $f)" "[{\"type\":\"level\",\"dbfs\":-32},$(noise $k $f)]" "${extra[@]}"
  done
done
echo "== $(date +%T) shard $SI/$SN done"
