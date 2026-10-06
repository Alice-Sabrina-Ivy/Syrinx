"""JS-vs-Python parity for a learned-envelope model on the saved parity clips.

  python parity.py <model_name>      (model JSON in models/; clips in build/.../learned-envelope/parity/)
Runs node le_band.mjs on parity/jobs.json and compares per-bin scores with le_cand.make(model).score.
"""
import os, sys, json, subprocess
import numpy as np
HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
sys.path.insert(0, os.path.dirname(os.path.dirname(HERE)))
from le_cand import make  # noqa: E402
from rlab.f0 import F0Track  # noqa: E402
from rlab.paths import BUILD  # noqa: E402

name = sys.argv[1]
PD = os.path.join(BUILD, "learned-envelope", "parity")
ROOT = os.path.dirname(os.path.dirname(BUILD))
jobs = json.load(open(os.path.join(PD, "jobs.json")))
out = os.path.join(PD, f"out_{name}.jsonl")
subprocess.run(["node", os.path.join(HERE, "le_band.mjs"), os.path.join(PD, "jobs.json"), out,
                os.path.join(HERE, "models", name + ".json")], check=True, cwd=ROOT)
js = {}
for l in open(out):
    d = json.loads(l)
    if "key" in d:
        js[d["key"]] = np.array([np.nan if v is None else v for v in d["s"]], float)
c = make(name)()
c.setup()
md, n, nn = 0.0, 0, 0
for j in jobs:
    x = np.fromfile(os.path.join(ROOT, j["audio"]), np.float32)
    f = np.fromfile(os.path.join(ROOT, j["f0"]), np.float32)
    t, s = c.score(x, 16000, F0Track(0.005 + 0.01 * np.arange(len(f)), f.astype(float)))
    a = js[j["key"]]
    assert len(a) == len(s), (len(a), len(s))
    both = np.isfinite(a) & np.isfinite(s)
    nn += int((np.isfinite(a) != np.isfinite(s)).sum())
    md = max(md, float(np.max(np.abs(a[both] - s[both]))) if both.any() else 0.0)
    n += int(both.sum())
print(f"{name}: {n} bins compared, max |js - py| = {md:.2e}, NaN-pattern mismatches = {nn}")
