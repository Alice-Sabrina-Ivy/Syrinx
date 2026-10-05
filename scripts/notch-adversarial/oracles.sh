#!/bin/bash
# oracles.sh A B — the committed oracles on two notch modules, for the
# round-1 decision rule (2026-10-04). A / B: "bc42" (bc42ad0's notch), "head"
# (6f8be18's) or "src" (the repo's src/). Each runs in build/notch-adv/otree/<t>
# = scripts/ + src/ copies with that notch module (tests/ is shared).
# Writes build/notch-adv/res/or/*.txt|json; the session oracle runs separately
# (sessions.sh).
set -e
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
O="$ROOT/build/notch-adv/otree"; R="$ROOT/build/notch-adv/res/or"
mkdir -p "$R"
for t in "$@"; do
  rm -rf "$O/$t"; mkdir -p "$O/$t"
  cp -r "$ROOT/src" "$ROOT/scripts" "$O/$t/"
  ln -s "$ROOT/tests" "$O/$t/tests"
  case $t in
    bc42) git -C "$ROOT" show bc42ad0:src/dsp/noise-notch.js > "$O/$t/src/dsp/noise-notch.js" ;;
    head) git -C "$ROOT" show 6f8be18:src/dsp/noise-notch.js > "$O/$t/src/dsp/noise-notch.js" ;;
    *) ;;   # src / fin / any other tag: the repo's src/
  esac
done
set +e
# at most MAXJ (default 4) oracle processes at once (shared workstation)
MAXJ=${MAXJ:-4}
throttle() { while (( $(jobs -rp | wc -l) >= MAXJ )); do wait -n; done; }
run() { throttle; local t=$1 tag=$2; shift 2; (cd "$O/$t" && node "$@" > "$R/${tag}_$t.txt" 2>&1) & }
# 1. pitch oracle, tracker front-end: default noises + sleep-birdies x 20/10/5
for t in "$@"; do
  for nz in white pink fan-hum mains-complex babble crickets cicadas sleep-birdies; do
    run $t "p_$nz" scripts/noise-augment-oracle.js pitch --frontend=tracker --noises=$nz
  done
done
wait
# 2. extra tonal classes x 10/5 (extra-noise.mjs, registered by extra-preload.mjs); vocadito x fan-hum/mains/sleep-birdies
for t in "$@"; do
  for nz in fan-wobble0.6 fan-wobble1.5 fan-drift hum-rich120 hum-rich60 fan-wobble0.6+rich; do
    run $t "x_$nz" --import ./scripts/notch-adversarial/extra-preload.mjs scripts/noise-augment-oracle.js pitch --frontend=tracker --noises=$nz --snrs=10,5
  done
  for nz in fan-hum mains-complex sleep-birdies; do
    run $t "v_$nz" scripts/noise-augment-oracle.js pitch --frontend=tracker --corpus=vocadito --noises=$nz
  done
done
wait
# 3. gender + voicing shootout
for t in "$@"; do
  run $t g scripts/noise-augment-oracle.js gender
  run $t vs scripts/voicing-robustness-shootout.js
done
wait
echo ORACLES-DONE
