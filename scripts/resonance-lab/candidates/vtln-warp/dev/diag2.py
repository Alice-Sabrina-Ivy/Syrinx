"""Diagnostic: 'warp the model, not the data'. Spectral-domain diag GMM on a wide log-f band;
data = fixed central band (mean-normalised); score(k) = loglik under model sub-window."""
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
st = 2   # 0.02 nat grid
lo, hi = np.log(300), np.log(4500)
i0 = int(round((lo - V.LN_LO) / 0.01)); D = int(round((hi - lo) / 0.01))
km = 24  # in 0.01 units, multiple of st
cols_c = np.arange(i0, i0 + D, st)
cols_w = np.arange(i0 - km, i0 + D + km, st)
nk = 2 * km // st + 1
def wide(e, k=0):
    w = e[:, cols_w + k]
    c = e[:, cols_c + k]
    return w - c.mean(1, keepdims=True)
def data(e):
    c = e[:, cols_c]
    return c - c.mean(1, keepdims=True)
Dc = len(cols_c)
def curves(g, X):
    # X (n, Dc); model sub-window j = 0..nk-1 starting at col j in wide
    out = np.zeros((len(X), nk))
    for j in range(nk):
        mu = g.mu[:, j:j + Dc]; var = g.var[:, j:j + Dc]
        mu = mu - mu.mean(1, keepdims=True)
        prec = 1 / var
        const = np.log(g.w) - 0.5 * np.sum(np.log(2 * np.pi * var), 1)
        a = (X ** 2) @ prec.T - 2 * X @ (mu * prec).T + np.sum(mu ** 2 * prec, 1)
        lp = const - 0.5 * a
        m = lp.max(1, keepdims=True)
        out[:, j] = m[:, 0] + np.log(np.exp(lp - m).sum(1))
    return out   # column j <-> model offset (j - km/st) -> data ln a = -(j*st - km)*0.01
for K in (1, 8, 32):
    X = np.concatenate([wide(e) for e in E.values()])
    g = V.DiagGMM.fit(X, K)
    rows = []
    for s, e in E.items():
        LL = curves(g, data(e))
        tot = LL.sum(0)
        j = np.argmax(tot); fr = np.argmax(LL, 1)
        conv = lambda j: -(j * st - km)
        avg = LL.mean(0); p = np.exp(avg - avg.max()); p /= p.sum()
        rows.append(dict(spk=s, sex=sex[s], am=conv(j), frmed=np.median(conv(fr)), post=np.sum(p * conv(np.arange(nk))),
                         edge=((fr == 0) | (fr == nk - 1)).mean()))
    d = pd.DataFrame(rows)
    from sklearn.metrics import roc_auc_score
    print("K", K, {c: round(roc_auc_score(d.sex == "f", d[c]), 3) for c in ("am", "frmed", "post")})
    print(d.groupby("sex")[["am", "frmed", "post", "edge"]].agg(["mean", "std"]).round(2).to_string())
