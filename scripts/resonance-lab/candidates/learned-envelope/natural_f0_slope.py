"""Natural-pitch leak diagnostic on r1_test (no manipulation): within each speaker, slope of
150 ms bin score vs log2 of the bin's mean F0 (harness Praat track); median over speakers / G,
split by sex. Confounded by intrinsic vowel F0 / stress / effort, so it is indicative only.
  python natural_f0_slope.py <candidate_name> [...]
"""
import os, sys, json
import numpy as np, pandas as pd
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", ".."))
from rlab.paths import BUILD, MANIFESTS  # noqa
from rlab.f0 import F0Track  # noqa

man = pd.read_parquet(os.path.join(MANIFESTS, "r1_test.parquet")).set_index("item_id")
for c in sys.argv[1:]:
    G = json.load(open(os.path.join(BUILD, "results", c + ".json")))["G"]
    sc = pd.read_parquet(os.path.join(BUILD, "scores", c, "r1_test.parquet"))
    sc = sc[np.isfinite(sc.s)]
    rows = []
    for iid, g in sc.groupby("item_id"):
        tr = F0Track.load(man.loc[iid, "f0_path"])
        for t, s in zip(g.t.values, g.s.values):
            m = (tr.t >= t - 0.15) & (tr.t < t) & (tr.f0 > 0)
            if m.sum() >= 3:
                rows.append((man.loc[iid, "speaker"], man.loc[iid, "sex"], np.log2(np.mean(tr.f0[m])), s))
    d = pd.DataFrame(rows, columns=["spk", "sex", "oct", "s"])
    def sl(g):
        x = g.oct - g.oct.mean(); y = g.s - g.s.mean()
        return float((x * y).sum() / (x * x).sum())
    r = d.groupby(["spk", "sex"]).apply(sl, include_groups=False).reset_index(name="b")
    out = {sx: round(float(r[r.sex == sx].b.median()) / G, 3) for sx in ("m", "f")}
    print(f"{c:28s} natural within-speaker score change per octave of F0 / G: men {out['m']:+.3f}  women {out['f']:+.3f}")
