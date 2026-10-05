#!/bin/bash
# usage: sweep.sh <listfile> ; each line: tag<TAB>json
cd "C:/Coding Projects/Syrinx-res/build/resonance-lab/vtln-warp"
P="C:/Coding Projects/Syrinx-res/build/resonance-lab/venv/Scripts/python"
export OMP_NUM_THREADS=4 OPENBLAS_NUM_THREADS=4 MKL_NUM_THREADS=4
while IFS=$'\t' read -r tag cfg; do
  [ -z "$tag" ] && continue
  if [ -f "dev_results/$tag.json" ]; then echo "skip $tag"; continue; fi
  echo "=== $tag $cfg"
  "$P" -W ignore -u exp.py "$cfg" "$tag" 2>&1 | grep --line-buffered -v "SAT it"
done < "$1"
echo SWEEP_DONE
