#!/bin/bash
# setup.sh — build the notch trees the suite loads (2026-10-04 round 1).
# build/notch-adv/trees/<t>/src is a copy of the repo's src/ whose
# dsp/noise-notch.js is replaced by:
#   bc42 = bc42ad0's module, head = 6f8be18's (in-sound latch), cand =
#   cand-notch.js (option-flag candidate module; variants.mjs).
# Every pitch-worker.js is the repo's (byte-identical to production).
#   bash scripts/notch-adversarial/setup.sh
set -e
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
T="$ROOT/build/notch-adv/trees"
for t in bc42 head cand; do
  rm -rf "$T/$t"; mkdir -p "$T/$t"; cp -r "$ROOT/src" "$T/$t/src"
done
git -C "$ROOT" show bc42ad0:src/dsp/noise-notch.js > "$T/bc42/src/dsp/noise-notch.js"
git -C "$ROOT" show 6f8be18:src/dsp/noise-notch.js > "$T/head/src/dsp/noise-notch.js"
cp "$ROOT/scripts/notch-adversarial/cand-notch.js" "$T/cand/src/dsp/noise-notch.js"
echo "trees ready under $T"
