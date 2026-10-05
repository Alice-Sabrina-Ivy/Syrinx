import sys, os, numpy as np, pandas as pd, warnings
warnings.filterwarnings("ignore")
sys.path.insert(0, "../../../scripts/resonance-lab/candidates/vtln-warp")
import vtlnlib as V
meth = sys.argv[1] if len(sys.argv) > 1 else "ct"
z = np.load(f"cache/{meth}/train_dev.npz")
tr = pd.read_parquet("../bench/manifests/train_dev.parquet")
idx = {iid: i for i, iid in enumerate(z["ids"])}
off, env = z["off"], z["env"]
sex = tr.groupby("speaker").sex.first()
E = {s: np.concatenate([env[off[idx[i]]:off[idx[i]+1]][::8] for i in d.item_id]).astype(np.float32) for s, d in tr.groupby("speaker")}
W = V.Warper()
for K in (1, 8, 64):
    X = np.concatenate([W.feats(e, 0) for e in E.values()])
    g = V.DiagGMM.fit(X, K)
    rows = []
    for s, e in E.items():
        LL = V.loglik_curves(g, W, e)
        tot = LL.sum(0)
        avg = LL.mean(0)
        fr = np.argmax(LL, 1) - W.kmax
        rows.append(dict(spk=s, sex=sex[s], am=W.shifts[np.argmax(tot)], frmed=np.median(fr), frmean=fr.mean(),
                         edge_lo=(fr == -W.kmax).mean(), edge_hi=(fr == W.kmax).mean(), curv=avg[W.kmax] - avg.max()))
    d = pd.DataFrame(rows)
    print("K", K)
    print(d.groupby("sex")[["am", "frmed", "frmean", "edge_lo", "edge_hi"]].agg(["mean", "std"]).round(2).to_string())
