#!/usr/bin/env bash
# run-r3-train.sh — custom voice detector, round 3: the four training runs of the
# pre-registration §3.1 (Addendum R3-B), crash-resumed. usage: run-r3-train.sh NAME
set -u
cd "$(dirname "$0")"
VENV=../../../build/vad-train/venv/Scripts/python.exe
VS='{"librispeech":0.12,"vctk":0.06,"coswara_counting":0.06,"coswara_vowel":0.18,"mdvr":0.04,"dcs":0.09,"esmuc":0.09,"csd":0.08,"svd":0.14,"singbap":0.07,"imitations":0.02,"kids":0.02,"fsvoice":0.03}'
COMMON="--steps=16000 --ema=0.999 --whard_ac=3 --vtag=r2 --p_rough=0.2 --p_breath=0.15 --resume"
case "$1" in
  r9-leak)     ARGS="--seed=31 --p_state=0.75 --bank=8192"; CFG='{"convs":[[24,3],[48,3],[48,1]],"gru":96,"leak_tau":3}';;
  r9-sess-a)   ARGS="--seed=32 --p_sess=0.5"; CFG='{"convs":[[24,3],[48,3],[48,1]],"gru":96}';;
  r9-sess-b)   ARGS="--seed=33 --p_sess=0.5"; CFG='{"convs":[[24,3],[48,3],[48,1]],"gru":96}';;
  r9-sessleak) ARGS="--seed=34 --p_sess=0.5"; CFG='{"convs":[[24,3],[48,3],[48,1]],"gru":96,"leak_tau":3}';;
  *) echo "unknown run $1"; exit 2;;
esac
for attempt in 1 2 3 4 5 6; do
  PYTHONIOENCODING=utf8 $VENV train.py --name=$1 $COMMON $ARGS --cfg="$CFG" --vsrc="$VS" && break
  echo "attempt $attempt failed; resuming"
done
