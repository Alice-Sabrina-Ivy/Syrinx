"""Train a vtln-warp reference model on ALL train_dev speakers (LibriSpeech dev-clean, 20 F + 20 M).

  python train_model.py '<cfg json>' <model-name>
cfg keys: method (ct|lift|ctl), lifter_q, band [lo, hi], ncep, drop_c1, kmax, K, sat, train_step, seed.
Uses the dev envelope cache (build/resonance-lab/vtln-warp/cache/<method>/train_dev.npz) when present,
otherwise extracts envelopes itself. Writes models/<model-name>.npz (w, mu, var, cfg, train shifts).
"""
import os
import sys
import json
import numpy as np
import pandas as pd

HERE = os.path.dirname(os.path.abspath(__file__))
LAB = os.path.dirname(os.path.dirname(HERE))
sys.path.insert(0, LAB)
sys.path.insert(0, HERE)
import warnings  # noqa: E402
warnings.filterwarnings("ignore")
import vtlnlib as V  # noqa: E402
from rlab.paths import MANIFESTS, BUILD  # noqa: E402

DEFAULT = dict(arch="mw", method="ct", lifter_q=24, band=[300, 4500], ncep=20, drop_c1=False, kmax=24, st=2, K=32,
               sat=2, train_step=4, seed=0, reg=1e-3)


def main():
    cfg = {**DEFAULT, **json.loads(sys.argv[1])}
    name = sys.argv[2]
    tr = pd.read_parquet(os.path.join(MANIFESTS, "train_dev.parquet"))
    cp = os.path.join(BUILD, "vtln-warp", "cache", cfg["method"], "train_dev.npz")
    E_by, F_by = {}, {}
    if os.path.exists(cp) and cfg["lifter_q"] == 24:
        z = np.load(cp)
        idx = {iid: i for i, iid in enumerate(z["ids"])}
        env, off, f0 = z["env"], z["off"], z["f0"]
        srcs = [(idx, env, off, f0)]
        for a in cfg.get("aug", []):     # pitch-augmented copies of the same train_dev utterances (aug_extract.py)
            za = np.load(cp.replace("train_dev.npz", f"train_dev_{a}.npz"))
            srcs.append(({iid: i for i, iid in enumerate(za["ids"])}, za["env"], za["off"], za["f0"]))
        for spk, d in tr.groupby("speaker"):
            E_by[spk] = np.concatenate([e_[o_[ix[i]]:o_[ix[i] + 1]][::cfg["train_step"]] for ix, e_, o_, _ in srcs
                                        for i in d.item_id]).astype(np.float32)
            F_by[spk] = np.concatenate([f_[o_[ix[i]]:o_[ix[i] + 1]][::cfg["train_step"]] for ix, _, o_, f_ in srcs
                                        for i in d.item_id])
    else:
        from rlab import audio
        from rlab.f0 import F0Track
        for spk, d in tr.groupby("speaker"):
            Es = []
            for p, sr, fp in zip(d.path, d.sr_src, d.f0_path):
                x = audio.load(p, sr)
                f = F0Track.load(fp)
                v = (f.f0 > 0) & (f.t * V.SR > 200) & (f.t * V.SR < len(x) - 200)
                Es.append(V.envelopes(x, f.t[v], f.f0[v], cfg["method"], lifter_q=cfg["lifter_q"])[::cfg["train_step"]])
            E_by[spk] = np.concatenate(Es)
    if cfg["arch"] == "mwf0":
        W, gmms, ks = V.train_mwf0(E_by, F_by, tuple(cfg["band"]), cfg["kmax"], cfg["st"], cfg["K"], cfg["sat"],
                                   cfg["seed"], reg=cfg["reg"], f0_edges=tuple(cfg["f0_edges"]))
        arr = (np.stack([g.w for g in gmms]), np.stack([g.mu for g in gmms]), np.stack([g.var for g in gmms]))
    elif cfg["arch"] == "mw":
        W, gmm, ks = V.train_mw(E_by, tuple(cfg["band"]), cfg["kmax"], cfg["st"], cfg["K"], cfg["sat"], cfg["seed"],
                                reg=cfg["reg"])
        arr = (gmm.w, gmm.mu, gmm.var)
    else:
        W, gmm, ks = V.train_sat(E_by, tuple(cfg["band"]), cfg["ncep"], cfg["kmax"], cfg["drop_c1"], cfg["K"],
                                 cfg["sat"], cfg["seed"])
        arr = (gmm.w, gmm.mu, gmm.var)
    sex = tr.groupby("speaker").sex.first()
    for sx in ("f", "m"):
        v = [ks[s] * V.LN_STEP for s in ks if sex[s] == sx]
        print(f"train speakers {sx}: mean ln-alpha {np.mean(v):+.3f}  sd {np.std(v):.3f}")
    os.makedirs(os.path.join(HERE, "models"), exist_ok=True)
    np.savez(os.path.join(HERE, "models", name + ".npz"), w=arr[0].astype(np.float32), mu=arr[1].astype(np.float32),
             var=arr[2].astype(np.float32), cfg=json.dumps(cfg), train_shifts=json.dumps(ks))
    print("wrote", name)


if __name__ == "__main__":
    main()
