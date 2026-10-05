"""R4 with a speaker bootstrap CI (Hillenbrand, full set) from cached harness scores.
  python r4_boot.py <candidate_name> [...]       (G_hill recomputed in each resample)
"""
import os, sys, json
import numpy as np, pandas as pd
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", ".."))
from rlab import metrics as M  # noqa
from rlab.runner import manifest  # noqa
from rlab.paths import BUILD  # noqa

man = manifest("hill")
for c in sys.argv[1:]:
    sc = pd.read_parquet(os.path.join(BUILD, "scores", c, "hill.parquet"))
    win = M.windows(sc)
    agg = json.load(open(os.path.join(BUILD, "results", c + ".json")))["aggregate"]
    r = M.utt_readouts(win, man.item_id, agg)
    d = man.assign(r=man.item_id.map(r).values)
    d = d[np.isfinite(d.r)]
    def r4(dd):
        sp = dd.groupby(["speaker", "sex"]).r.median().reset_index()  # = metrics.gap on utterance readouts
        G = sp[sp.sex == "f"].r.median() - sp[sp.sex == "m"].r.median()
        sds = dd.groupby("speaker").r.agg(lambda v: np.std(v, ddof=1) if len(v) >= 8 else np.nan)
        return float(np.nanmedian(sds)) / G
    base = r4(d)
    spk = d.speaker.unique()
    g = {s: x for s, x in d.groupby("speaker")}
    rng = np.random.default_rng(0)
    bs = []
    for _ in range(1000):
        pick = rng.choice(spk, len(spk))
        dd = pd.concat([g[s].assign(speaker=f"{s}_{k}") for k, s in enumerate(pick)])
        bs.append(r4(dd))
    lo, hi = np.percentile(bs, [2.5, 97.5])
    print(f"{c:30s} R4 {base:.3f}  95% CI [{lo:.3f}, {hi:.3f}]  P(R4 <= 0.5) = {np.mean(np.array(bs) <= 0.5):.2f}")
