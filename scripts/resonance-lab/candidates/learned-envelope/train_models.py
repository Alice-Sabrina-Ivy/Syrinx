"""Fit learned-envelope variants on ALL 40 dev-clean speakers and export JSON for the harness.

  python train_models.py <variant> [...]     (variants defined in VARIANTS below)
Writes scripts/resonance-lab/candidates/learned-envelope/models/<variant>.json and a
one-file harness candidate candidates/learned-envelope/le_<variant>.py.
"""
import os
import sys
import json
import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import train_eval as T  # noqa: E402

MODELS = os.path.join(HERE, "models")


def F(method="band", **k):
    return dict(method=method, **k)


VARIANTS = {
    "logreg_band": dict(model="logreg", feat=F("band"), alpha=1.0,
                        desc="sex logistic regression on 150 ms log band envelope 150-6000 Hz, no augmentation"),
    "ridge_band500_pairs": dict(model="ridge", feat=F("band", flo=500, fhi=6000), aug_abs=True, pairs=True, alpha=1.0,
                                desc="ridge, band envelope 500-6000 Hz, target ln1.15*female+ln fs, aug + pair constraints"),
    "mlp_band500_h16": dict(model="mlp", feat=F("band", flo=500, fhi=6000), aug_abs=True, pairs=True,
                            mlp=dict(hidden=16, epochs=30, threads=2),
                            desc="tiny MLP (16 tanh) on band envelope 500-6000 Hz, target ln1.15*female+ln fs, aug + pair constraints"),
}
for _h in (16, 64):
    for _s in (0, 1, 2):
        _n = f"mlp_band500_h{_h}" + (f"_s{_s}" if _s else "")
        VARIANTS.setdefault(_n, dict(model="mlp", feat=F("band", flo=500, fhi=6000), aug_abs=True, pairs=True,
                                     mlp=dict(hidden=_h, epochs=30, threads=2, seed=_s),
                                     desc=f"tiny MLP ({_h} tanh, seed {_s}) on band envelope 500-6000 Hz, "
                                          "target ln1.15*female+ln fs, aug + pair constraints"))


def export(name, cfg, m):
    os.makedirs(MODELS, exist_ok=True)
    d = dict(name=name, cfg={k: v for k, v in cfg.items() if k != "desc"}, feat=m.feat.spec(),
             mu=m.feat.mu.tolist(), sd=m.feat.sd.tolist())
    if m.mlp is None:
        d.update(kind="linear", w=m.w.tolist(), b=float(m.b))
    else:
        d.update(kind="mlp", mlp=m.mlp.export())
    p = os.path.join(MODELS, name + ".json")
    json.dump(d, open(p, "w"))
    cp = os.path.join(HERE, f"le_{name}.py")
    open(cp, "w").write(
        f'"""Harness candidate: learned-envelope variant {name} (trained by train_models.py on dev-clean only)."""\n'
        "import os, sys\n"
        "sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))\n"
        "from le_cand import make  # noqa: E402\n\n"
        f"CANDIDATE = make({name!r}, version={cfg.get('version', '1')!r}, desc={cfg.get('desc', '')!r})\n")
    print("wrote", p, os.path.getsize(p), "bytes;", cp)


if __name__ == "__main__":
    D = T.Data()
    allspk = set(D.ti.speaker.unique())
    for name in sys.argv[1:]:
        cfg = VARIANTS[name]
        m = T.Model(cfg).fit(D, allspk)
        export(name, cfg, m)
