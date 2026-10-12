#!/usr/bin/env bash
# run-r5-train.sh — custom voice detector, round 5: the training runs of the
# pre-registration §3.6 (Addendum R5-B part 2), crash-resumed. usage: run-r5-train.sh NAME
# Every run: round 4's recipe (round-2 voice sources and weights, roughness 0.2, breathiness 0.15,
# whard_ac 3, EMA 0.999, p_sess 0.5, TBPTT 8 s, sessions 64-256 s, D1-D6 = train_r5.py's round-4 defaults)
# plus D7 (hold sessions p 0.35, D7 crops p 0.15) and the §3.4 loss terms (lambda 1.0). Architectures: arch_r5.py.
# Run 4 (seed 54) is fixed by the run-4 rule (§3.6) in an addendum before it starts: r11-bound or a second seed (r11-*-s54).
set -u
cd "$(dirname "$0")"
VENV=../../../build/vad-train/venv/Scripts/python.exe
VS='{"librispeech":0.12,"vctk":0.06,"coswara_counting":0.06,"coswara_vowel":0.18,"mdvr":0.04,"dcs":0.09,"esmuc":0.09,"csd":0.08,"svd":0.14,"singbap":0.07,"imitations":0.02,"kids":0.02,"fsvoice":0.03}'
COMMON="--steps=${STEPS:-16000} --ema=0.999 --whard_ac=3 --vtag=r2 --p_rough=0.2 --p_breath=0.15 --p_sess=0.5 --sess_len=64,256 --p_hold=0.35 --p_d7crop=0.15 --lam_dec=1.0 --resume"
case "$1" in
  r11-data)  SEED=51; ARCH=r11-data;;
  r11-floor) SEED=52; ARCH=r11-floor;;
  r11-harm)  SEED=53; ARCH=r11-harm;;
  r11-bound) SEED=54; ARCH=r11-bound;;
  *-s54)     SEED=54; ARCH=${1%-s54};;
  smoke-*)   SEED=9; ARCH=${1#smoke-};;
  *) echo "unknown run $1"; exit 2;;
esac
CFG=$($VENV arch_r5.py cfg $ARCH)
for attempt in $(seq 1 ${ATTEMPTS:-6}); do
  PYTHONIOENCODING=utf8 $VENV train_r5.py --name=$1 $COMMON --seed=$SEED --cfg="$CFG" --vsrc="$VS" && break
  echo "attempt $attempt failed; resuming"
done
