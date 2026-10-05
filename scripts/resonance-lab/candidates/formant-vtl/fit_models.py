"""Fit formant-vtl learned parts on train_dev ONLY (all 40 LibriSpeech dev-clean speakers)
and write them to models/<name>.json:
  * the shape corrector (ridge polynomial / kmeans offsets) for the variant's config;
  * the population mapping: train_dev men / women speaker medians of the corrected score
    (UI position p = (score - men) / (women - men): 0 = typical man, 1 = typical woman).

  python fit_models.py <name> '<cfg json>' '<corr spec json>'
"""
import os
import sys
import json
import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import lab  # noqa: E402
import fvtl  # noqa: E402

MODELS = os.path.join(HERE, "models")
os.makedirs(MODELS, exist_ok=True)


def corr_dict(c):
    if isinstance(c, fvtl.RatioRegressor):
        return dict(type="ridge", deg=c.deg, idx=list(c.idx), alpha=c.alpha, w=c.w.tolist())
    if isinstance(c, fvtl.ShapeCorrector):
        return dict(c.to_dict(), type="kmeans")
    if isinstance(c, fvtl.TemplateMatcher):
        return c.to_dict()
    return None


def fit(name, cfg, spec):
    corr = lab.fit_corrector(cfg, spec) if spec else None
    sc = lab.score_set("train_dev", cfg, corr)
    m = lab.manifest("train_dev")
    import pandas as pd
    r = sc[np.isfinite(sc.s)].groupby("item_id").s.median()
    d = m.assign(r=m.item_id.map(r)).groupby(["speaker", "sex"]).r.median().reset_index()
    pop = dict(men_median=float(d[d.sex == "m"].r.median()), women_median=float(d[d.sex == "f"].r.median()),
               men_q10_q90=[float(d[d.sex == "m"].r.quantile(q)) for q in (.1, .9)],
               women_q10_q90=[float(d[d.sex == "f"].r.quantile(q)) for q in (.1, .9)],
               n_speakers=int(len(d)))
    out = dict(name=name, cfg=cfg, corr_spec=spec, corr=corr_dict(corr), population=pop,
               trained_on="train_dev (LibriSpeech dev-clean, 40 speakers)")
    json.dump(out, open(os.path.join(MODELS, name + ".json"), "w"), indent=1)
    print(name, json.dumps(pop))
    return out


if __name__ == "__main__":
    fit(sys.argv[1], json.loads(sys.argv[2]), json.loads(sys.argv[3]) if len(sys.argv) > 3 and sys.argv[3] != "null" else None)
