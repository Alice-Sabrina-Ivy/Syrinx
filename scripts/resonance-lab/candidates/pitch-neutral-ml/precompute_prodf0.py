"""Precompute production-detector (Boersma-AC pitch-worker emulation) F0 tracks for the
items of the given benchmark sets, keyed by audio hash, for the *_prodf0 variants.
  python precompute_prodf0.py r1_dev manip_dev [--quick] [--shards 12]
"""
import os, sys, json, argparse, subprocess, hashlib
import numpy as np
HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.dirname(os.path.dirname(HERE)))
sys.path.insert(0, HERE)
from rlab import audio  # noqa
from rlab.f0 import F0Track  # noqa
from rlab.runner import manifest, subsample  # noqa
import pnml_core as C  # noqa
OUT = os.path.join(os.path.dirname(C.CACHE), "prodf0")
WORK = os.path.join(os.path.dirname(C.CACHE), "prodf0_work")

ap = argparse.ArgumentParser()
ap.add_argument("sets", nargs="+"); ap.add_argument("--quick", action="store_true"); ap.add_argument("--shards", type=int, default=12)
a = ap.parse_args()
os.makedirs(WORK, exist_ok=True)
jobs, seen = [], set()
for s in a.sets:
    m = manifest(s)
    if a.quick:
        m = subsample(m, s)
    for _, r in m.iterrows():
        x = audio.load(r.path, r.sr_src)
        key = C.cache_key(x, None)
        p = os.path.join(OUT, key[:2], key + ".npy")
        if os.path.exists(p) or p in seen:
            continue
        seen.add(p)
        n10 = len(F0Track.load(r.f0_path).t)
        ip = os.path.join(WORK, key + ".f32")
        x.astype("<f4").tofile(ip)
        jobs.append(dict(audio=ip, out=ip + ".f0", n10=n10, final=p))
print(len(jobs), "items to track", flush=True)
procs = []
try:
    for i in range(min(a.shards, len(jobs))):
        jp = os.path.join(WORK, f"jobs{i}.json")
        json.dump(jobs[i::a.shards], open(jp, "w"))
        procs.append(subprocess.Popen(["node", os.path.join(HERE, "prodf0.mjs"), jp]))
    for p in procs:
        if p.wait() != 0:
            raise RuntimeError("prodf0 shard failed")
finally:
    for p in procs:
        if p.poll() is None:
            p.kill()          # this child's PID only
for j in jobs:
    f = np.fromfile(j["out"], "<f4")
    os.makedirs(os.path.dirname(j["final"]), exist_ok=True)
    np.save(j["final"], f)
    os.remove(j["out"]); os.remove(j["audio"])
print("done", flush=True)
