#!/usr/bin/env bash
# run-r4-train.sh — custom voice detector, round 4: the four training runs of the
# pre-registration §3.4 (Addendum R4-B part 2), crash-resumed. usage: run-r4-train.sh NAME
# Every run: round 3's r9-sess-b recipe (round-2 voice sources and weights, roughness 0.2,
# breathiness 0.15, whard_ac 3, EMA 0.999, p_sess 0.5, TBPTT 8 s, no state bank) with the
# round-4 training data D1-D6 (train_r4.py: D5 weights are its default --neg; sessions
# 64-256 s). F3 is not used (no user decision before training; §3.3 default): r10-notch
# is an F1 run with seed 44.
set -u
cd "$(dirname "$0")"
VENV=../../../build/vad-train/venv/Scripts/python.exe
VS='{"librispeech":0.12,"vctk":0.06,"coswara_counting":0.06,"coswara_vowel":0.18,"mdvr":0.04,"dcs":0.09,"esmuc":0.09,"csd":0.08,"svd":0.14,"singbap":0.07,"imitations":0.02,"kids":0.02,"fsvoice":0.03}'
COMMON="--steps=16000 --ema=0.999 --whard_ac=3 --vtag=r2 --p_rough=0.2 --p_breath=0.15 --p_sess=0.5 --sess_len=64,256 --resume"
PLAIN='{"convs":[[24,3],[48,3],[48,1]],"gru":96}'
F1='{"convs":[[24,3],[48,3],[48,1]],"gru":96,"f1":{"taus":[1.0,6.0],"eps":0.001,"v0":1.0,"fl0":1.0}}'
case "$1" in
  r10-data)   ARGS="--seed=41"; CFG=$PLAIN;;
  r10-stat-a) ARGS="--seed=42"; CFG=$F1;;
  r10-stat-b) ARGS="--seed=43"; CFG=$F1;;
  r10-notch)  ARGS="--seed=44"; CFG=$F1;;
  *) echo "unknown run $1"; exit 2;;
esac
for attempt in 1 2 3 4 5 6; do
  PYTHONIOENCODING=utf8 $VENV train_r4.py --name=$1 $COMMON $ARGS --cfg="$CFG" --vsrc="$VS" && break
  echo "attempt $attempt failed; resuming"
done
