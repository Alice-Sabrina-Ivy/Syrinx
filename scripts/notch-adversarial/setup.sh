#!/bin/bash
# setup.sh — build the notch trees the suite loads (2026-10-04 round 1).
# build/notch-adv/trees/<t>/src is a copy of the repo's src/ whose
# dsp/noise-notch.js is replaced by:
#   bc42 = bc42ad0's module, head = 6f8be18's (in-sound latch), cand =
#   cand-notch.js (option-flag candidate module; variants.mjs), r1 =
#   cb00425's (round 1, N13), cand2 = cand2-notch.js (round-2 option-flag
#   candidate: cb00425 + flags), cand3 = cand3-notch.js (2026-10-05: r8-notch.js
#   + line-coherence voice / machine classifier, flags).
# Every pitch-worker.js is the repo's (byte-identical to production).
#   bash scripts/notch-adversarial/setup.sh
set -e
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
T="$ROOT/build/notch-adv/trees"
for t in bc42 head cand r1 cand2 cand3; do
  rm -rf "$T/$t"; mkdir -p "$T/$t"; cp -r "$ROOT/src" "$T/$t/src"
done
git -C "$ROOT" show bc42ad0:src/dsp/noise-notch.js > "$T/bc42/src/dsp/noise-notch.js"
git -C "$ROOT" show 6f8be18:src/dsp/noise-notch.js > "$T/head/src/dsp/noise-notch.js"
cp "$ROOT/scripts/notch-adversarial/cand-notch.js" "$T/cand/src/dsp/noise-notch.js"
git -C "$ROOT" show cb00425:src/dsp/noise-notch.js > "$T/r1/src/dsp/noise-notch.js"
cp "$ROOT/scripts/notch-adversarial/cand2-notch.js" "$T/cand2/src/dsp/noise-notch.js"
cp "$ROOT/scripts/notch-adversarial/cand3-notch.js" "$T/cand3/src/dsp/noise-notch.js"
echo "trees ready under $T"
