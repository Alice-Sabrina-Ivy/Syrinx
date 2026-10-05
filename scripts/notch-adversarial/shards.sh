#!/bin/bash
# shards.sh OUTDIR NSHARDS SCRIPT args... — run NSHARDS shards of a suite
# script (each writes OUTDIR/s<i>.json + .log), at most MAXJ (default 4) at
# once: the suite shares a workstation, keep ~10 % CPU / RAM free.
out=$1; n=$2; shift 2
maxj=${MAXJ:-4}
mkdir -p "$out"
for ((i=0;i<n;i++)); do
  while (( $(jobs -rp | wc -l) >= maxj )); do wait -n; done
  node "$@" --shard=$i/$n --out="$out/s$i.json" > "$out/s$i.log" 2>&1 &
done
wait
echo "done $out"
