"""Production-detector F0 tracks (src/dsp Boersma-AC pitch-worker emulation, via the
pitch-neutral-ml agent's prodf0.mjs, invoked read-only) for benchmark items, keyed by the
sha1 of the 16 kHz float32 audio; written under build/resonance-lab/learned-envelope/prodf0/.
  python precompute_prodf0.py r1_test ptdb fda hill manip_test manip_hill synth sessions [--quick] [--shards 2]
"""
import os, sys, json, argparse, subprocess, hashlib
import numpy as np
HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.dirname(os.path.dirname(HERE)))
from rlab import audio  # noqa
from rlab.f0 import F0Track  # noqa
from rlab.runner import manifest, subsample  # noqa
from rlab.paths import BUILD  # noqa
OUT = os.path.join(BUILD, "learned-envelope", "prodf0")
WORK = os.path.join(BUILD, "learned-envelope", "prodf0_work")
MJS = os.path.join(os.path.dirname(HERE), "pitch-neutral-ml", "prodf0.mjs")


def key(x):
    return hashlib.sha1(np.ascontiguousarray(x, np.float32).tobytes()).hexdigest()


def path_for(x):
    k = key(x)
    return os.path.join(OUT, k[:2], k + ".npy")


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("sets", nargs="+"); ap.add_argument("--shards", type=int, default=2)
    ap.add_argument("--quick", action="store_true")
    a = ap.parse_args()
    os.makedirs(WORK, exist_ok=True)
    jobs, seen = [], set()
    for s in a.sets:
        m = manifest(s)
        if a.quick:
            m = subsample(m, s)
        for _, r in m.iterrows():
            x = audio.load(r.path, r.sr_src)
            p = path_for(x)
            if os.path.exists(p) or p in seen:
                continue
            seen.add(p)
            ip = os.path.join(WORK, os.path.basename(p)[:-4] + ".f32")
            x.astype("<f4").tofile(ip)
            jobs.append(dict(audio=ip, out=ip + ".f0", n10=len(F0Track.load(r.f0_path).t), final=p))
    print(len(jobs), "items to track", flush=True)
    procs = []
    try:
        for i in range(min(a.shards, len(jobs))):
            jp = os.path.join(WORK, f"jobs{i}.json")
            json.dump(jobs[i::a.shards], open(jp, "w"))
            procs.append(subprocess.Popen(["node", MJS, jp]))
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
