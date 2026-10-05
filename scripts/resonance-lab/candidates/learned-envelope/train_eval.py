"""Train + speaker-wise-CV evaluate learned-envelope models (LibriSpeech dev-clean only).

Data: feats/train.npz (all train_dev utterances) and feats/aug.npz (dev-clean augmentation:
pitch-only / formant-only / combined variants with same-engine references).

CV: 5 folds by speaker (4 F + 4 M per fold), fixed split. For each fold the model is fit on
the other 32 speakers' rows and scored on the held-out 8 speakers' utterances + variants.
Metrics (harness-style, on held-out speakers only; each speaker's numbers come from a model
that never saw that speaker):
  auc5   speaker-balanced AUC women>men of mean bin score over consecutive ~5 s voiced chunks
  G      median women-speaker median utterance readout - same for men
  R2     |median over sources of the slope of d(readout) vs octaves| / G  (pitch-only variants)
  R3     median slope of d(readout) vs ln fs  x ln1.15 / G                 (formant-only variants)
  sign   share of formant variants with |ln fs| <= 0.07 whose d(readout) has the sign of ln fs
  flick  median within-utterance SD of bin scores / G
(all deltas vs the same-engine reference, bins matched).
"""
import os
import sys
import json
import itertools
import numpy as np
import pandas as pd

HERE = os.path.dirname(os.path.abspath(__file__))
LAB = os.path.dirname(os.path.dirname(HERE))
sys.path.insert(0, LAB)
sys.path.insert(0, HERE)
from rlab.paths import BUILD  # noqa: E402
from rlab.metrics import wauc  # noqa: E402
import lefeat as L  # noqa: E402

FE = os.path.join(BUILD, "learned-envelope", "feats")
LN115 = np.log(1.15)
EXTRA_TAGS = ("_x", "_hs")


# ------------------------------------------------------------------ data
class Data:
    def __init__(self):
        tr = dict(np.load(os.path.join(FE, "train.npz")))
        au0 = dict(np.load(os.path.join(FE, "aug.npz")))
        for tag in EXTRA_TAGS:
            for nm, dd in (("train", tr), ("aug", au0)):
                p = os.path.join(FE, f"{nm}{tag}.npz")
                if os.path.exists(p):
                    z = np.load(p)
                    assert np.array_equal(z["item"], dd["item"]) and np.array_equal(z["bin"], dd["bin"])
                    dd.update({k: z[k] for k in z.files if k.startswith("E_")})
        ti = pd.read_parquet(os.path.join(FE, "train_items.parquet"))
        self.tr = tr
        self.ti = ti
        self.tr_spk = ti.speaker.values[self.tr["item"]]
        self.tr_fem = (ti.sex.values[self.tr["item"]] == "f").astype(float)
        ai = pd.read_parquet(os.path.join(FE, "aug_items.parquet"))
        self.au = au0
        self.ai = ai
        it = self.au["item"]
        self.au_spk = ai.speaker.values[it]
        self.au_fem = (ai.sex.values[it] == "f").astype(float)
        self.au_lnfs = np.log(ai.fs.values[it])
        self.au_st = ai.st.values[it]
        self.au_kind = ai.kind.values[it]
        # pair index: for each aug row, the row of its reference (same src, same bin)
        key = {(s, c): i for i, (s, c) in enumerate(zip(ai.src, ai.cond))}
        refitem = np.array([key.get((s, r), -1) for s, r in zip(ai.src, ai.ref)])
        rowkey = {(a, b): j for j, (a, b) in enumerate(zip(it, self.au["bin"]))}
        ri = refitem[it]
        self.au_refrow = np.array([rowkey.get((a, b), -1) if a >= 0 else -1
                                   for a, b in zip(ri, self.au["bin"])])
        spk = sorted(ti.speaker.unique())
        sx = ti.groupby("speaker").sex.first()
        F = [s for s in spk if sx[s] == "f"]
        M = [s for s in spk if sx[s] == "m"]
        rng = np.random.default_rng(7)
        rng.shuffle(F)
        rng.shuffle(M)
        self.folds = [set(F[k::5]) | set(M[k::5]) for k in range(5)]


# ------------------------------------------------------------------ features
def dct_basis(nb, d):
    n = np.arange(nb)
    return np.stack([np.cos(np.pi * k * (n + 0.5) / nb) for k in range(1, d + 1)], 1) * np.sqrt(2.0 / nb)


class Feat:
    """phi(E): band-limit the grid, optional tilt removal, optional DCT, standardisation."""

    def __init__(self, method="band", flo=150.0, fhi=6000.0, dct=0, tilt=False):
        self.method, self.flo, self.fhi, self.dct, self.tilt = method, flo, fhi, dct, tilt
        self.sel = (L.GRID >= flo * 0.999) & (L.GRID <= fhi * 1.001)
        nb = int(self.sel.sum())
        self.B = dct_basis(nb, dct) if dct else None
        lx = np.log(L.GRID[self.sel])
        self.lx = lx - lx.mean()

    def raw(self, E):
        X = E[:, self.sel].astype(np.float64)
        X = X - X.mean(1, keepdims=True)
        if self.tilt:
            b = X @ self.lx / (self.lx @ self.lx)
            X = X - b[:, None] * self.lx[None, :]
        if self.B is not None:
            X = X @ self.B
        return X

    def fit_std(self, X):
        self.mu = X.mean(0)
        self.sd = X.std(0) + 1e-6

    def __call__(self, E):
        return (self.raw(E) - self.mu) / self.sd

    def spec(self):
        return dict(method=self.method, flo=self.flo, fhi=self.fhi, dct=self.dct, tilt=self.tilt)


# ------------------------------------------------------------------ models
def within_scatter(X, groups):
    """Mean within-group (utterance) scatter matrix of rows X."""
    g = pd.Series(groups)
    codes, uniq = pd.factorize(g)
    sums = np.zeros((len(uniq), X.shape[1]))
    np.add.at(sums, codes, X)
    cnt = np.bincount(codes)
    Xc = X - (sums / cnt[:, None])[codes]
    return Xc.T @ Xc / len(X)


def fit_linear(Xa, ya, wa, Xd=None, yd=None, wd=None, alpha=1.0, Sw=None, lam_v=0.0):
    """Weighted ridge with intercept on absolute rows + intercept-free difference rows."""
    d = Xa.shape[1]
    A = np.hstack([Xa, np.ones((len(Xa), 1))])
    H = (A * wa[:, None]).T @ A
    g = (A * wa[:, None]).T @ ya
    if Xd is not None and len(Xd):
        D = np.hstack([Xd, np.zeros((len(Xd), 1))])
        H += (D * wd[:, None]).T @ D
        g += (D * wd[:, None]).T @ yd
    R = alpha * np.eye(d + 1)
    R[-1, -1] = 0
    if Sw is not None and lam_v > 0:
        R[:-1, :-1] += lam_v * wa.sum() * Sw
    w = np.linalg.solve(H + R, g)
    return w[:-1], w[-1]


def fit_logreg(X, y, w, alpha=1.0, iters=50):
    """Weighted L2 logistic regression via Newton (IRLS)."""
    A = np.hstack([X, np.ones((len(X), 1))])
    b = np.zeros(A.shape[1])
    R = alpha * np.eye(A.shape[1])
    R[-1, -1] = 0
    for _ in range(iters):
        p = 1 / (1 + np.exp(-(A @ b)))
        gr = A.T @ (w * (p - y)) + R @ b
        Hs = (A * (w * p * (1 - p))[:, None]).T @ A + R
        st = np.linalg.solve(Hs, gr)
        b -= st
        if np.max(np.abs(st)) < 1e-6:
            break
    return b[:-1], b[-1]


class _Gated:
    """Mixture of K linear experts with a softmax gate (soft, unsupervised 'vowel-class' correction)."""

    @staticmethod
    def build(d, K):
        import torch

        class G(torch.nn.Module):
            def __init__(self):
                super().__init__()
                self.gate = torch.nn.Linear(d, K)
                self.expert = torch.nn.Linear(d, K)

            def forward(self, x):
                g = torch.softmax(self.gate(x), dim=1)
                return (g * self.expert(x)).sum(1, keepdim=True)
        return G()


class MLP:
    def __init__(self, hidden=32, epochs=30, lr=3e-3, wd=1e-4, lam_p=1.0, lam_f=1.0, seed=0, experts=0, threads=4):
        self.h, self.ep, self.lr, self.wd, self.lp, self.lf, self.seed = hidden, epochs, lr, wd, lam_p, lam_f, seed
        self.K, self.threads = experts, threads

    def fit(self, Xa, ya, wa, Xv=None, Xr=None, yd=None, wdif=None):
        import torch
        torch.manual_seed(self.seed)
        torch.set_num_threads(self.threads)
        d = Xa.shape[1]
        if self.K:
            net = _Gated.build(d, self.K)
        else:
            net = torch.nn.Sequential(torch.nn.Linear(d, self.h), torch.nn.Tanh(), torch.nn.Linear(self.h, 1))
        opt = torch.optim.Adam(net.parameters(), lr=self.lr, weight_decay=self.wd)
        T = lambda a: torch.tensor(a, dtype=torch.float32)
        Xa_, ya_, wa_ = T(Xa), T(ya), T(wa / wa.mean())
        has = Xv is not None and len(Xv)
        if has:
            Xv_, Xr_, yd_, wd_ = T(Xv), T(Xr), T(yd), T(wdif / wdif.mean())
        bs = 4096
        n = len(Xa)
        rng = np.random.default_rng(self.seed)
        for ep in range(self.ep):
            perm = rng.permutation(n)
            permd = rng.permutation(len(Xv)) if has else None
            nbt = int(np.ceil(n / bs))
            for k in range(nbt):
                ii = perm[k * bs:(k + 1) * bs]
                out = net(Xa_[ii]).squeeze(1)
                loss = (wa_[ii] * (out - ya_[ii]) ** 2).mean()
                if has:
                    m = len(Xv) // nbt
                    jj = permd[k * m:(k + 1) * m]
                    dd = net(Xv_[jj]).squeeze(1) - net(Xr_[jj]).squeeze(1)
                    loss = loss + self.lf * (wd_[jj] * (dd - yd_[jj]) ** 2).mean()
                opt.zero_grad()
                loss.backward()
                opt.step()
        self.net = net
        return self

    def predict(self, X):
        import torch
        with torch.no_grad():
            return self.net(torch.tensor(X, dtype=torch.float32)).squeeze(1).numpy().astype(np.float64)

    def export(self):
        sd = self.net.state_dict()
        d = {k: v.numpy().tolist() for k, v in sd.items()}
        d["_kind"] = "gated" if self.K else "mlp"
        return d


# ------------------------------------------------------------------ training recipes
def speaker_weights(spk):
    s = pd.Series(spk)
    return (1.0 / s.map(s.value_counts())).values * len(np.unique(spk)) / 1.0


def build_rows(D, feat, mask_tr, mask_au, cfg):
    """Absolute + difference rows for the training speakers."""
    gap = cfg.get("anchor", LN115)
    Xs, ys, ws = [], [], []
    Xt = feat(D.tr["E_" + feat.method][mask_tr])
    Xs.append(Xt)
    ys.append(gap * D.tr_fem[mask_tr])
    ws.append(speaker_weights(D.tr_spk[mask_tr]))
    out = dict()
    if cfg.get("aug_abs", False) or cfg.get("pairs", False):
        Ea = D.au["E_" + feat.method]
        Xau = feat(Ea[mask_au])
        if cfg.get("aug_abs", False):
            kinds = D.au_kind[mask_au]
            use = np.isin(kinds, cfg.get("abs_kinds", ["orig", "ref", "pitch", "formant", "combo"]))
            if cfg.get("engines"):
                eng = D.ai.engine.values[D.au["item"][mask_au]]
                use &= np.isin(eng, cfg["engines"] + ["none"])
            Xs.append(Xau[use])
            ys.append(gap * D.au_fem[mask_au][use] + D.au_lnfs[mask_au][use])
            ws.append(speaker_weights(D.au_spk[mask_au][use]) * cfg.get("w_aug", 1.0))
        if cfg.get("pairs", False):
            rows = np.flatnonzero(mask_au)
            rr = D.au_refrow[rows]
            kinds = D.au_kind[rows]
            ok = (rr >= 0) & np.isin(kinds, ["pitch", "formant", "combo"])
            if cfg.get("engines"):
                eng = D.ai.engine.values[D.au["item"][rows]]
                ok &= np.isin(eng, cfg["engines"])
            r_v, r_r = rows[ok], rr[ok]
            Xv, Xr = feat(Ea[r_v]), feat(Ea[r_r])
            yd = D.au_lnfs[r_v]
            k = D.au_kind[r_v]
            wd = np.where(k == "pitch", cfg.get("lam_p", 1.0), cfg.get("lam_f", 1.0)) * speaker_weights(D.au_spk[r_v])
            out.update(Xv=Xv, Xr=Xr, yd=yd, wd=wd)
    if cfg.get("lam_v", 0) > 0:
        out["Sw"] = within_scatter(Xt, D.tr["item"][mask_tr])
    Xa, ya, wa = np.vstack(Xs), np.concatenate(ys), np.concatenate(ws)
    wa = wa / wa.mean()
    if "wd" in out:
        out["wd"] = out["wd"] / out["wd"].mean() * cfg.get("pair_scale", 1.0) * len(out["wd"]) / len(wa)
    return Xa, ya, wa, out


class Model:
    """feature spec + fitted predictor; predict(E) -> bin scores (larger = more feminine-typical)."""

    def __init__(self, cfg):
        self.cfg = cfg
        self.feat = Feat(**cfg["feat"])

    def fit(self, D, spk_train):
        mtr = np.isin(D.tr_spk, list(spk_train))
        mau = np.isin(D.au_spk, list(spk_train))
        self.feat.fit_std(self.feat.raw(D.tr["E_" + self.feat.method][mtr]))
        Xa, ya, wa, P = build_rows(D, self.feat, mtr, mau, self.cfg)
        kind = self.cfg["model"]
        if kind == "logreg":
            self.w, self.b = fit_logreg(Xa, (ya > 0).astype(float), wa, alpha=self.cfg.get("alpha", 1.0) * len(Xa) / 1e4)
            self.mlp = None
        elif kind == "ridge":
            Xd = P["Xv"] - P["Xr"] if "Xv" in P else None
            self.w, self.b = fit_linear(Xa, ya, wa, Xd, P.get("yd"), P.get("wd"),
                                        alpha=self.cfg.get("alpha", 1.0) * len(Xa) / 1e4,
                                        Sw=P.get("Sw"), lam_v=self.cfg.get("lam_v", 0.0))
            self.mlp = None
        else:
            self.mlp = MLP(**self.cfg.get("mlp", {})).fit(Xa, ya, wa, P.get("Xv"), P.get("Xr"), P.get("yd"), P.get("wd"))
        return self

    def predict(self, E):
        X = self.feat(E)
        return self.mlp.predict(X) if self.mlp is not None else X @ self.w + self.b


# ------------------------------------------------------------------ CV evaluation
def chunk_readouts(scores, cnt, items, spk, H=5.0):
    """Walk each speaker's bins in item order; readout = mean bin score per H s of voiced frames."""
    rows = []
    df = pd.DataFrame(dict(s=scores, c=cnt * 0.01, it=items, spk=spk))
    for sp, g in df.groupby("spk", sort=False):
        g = g.sort_values("it", kind="stable")
        cum = np.cumsum(g.c.values)
        b = np.floor((cum - 1e-9) / H).astype(int)
        nfull = int(np.floor(cum[-1] / H))
        for k in range(nfull):
            v = g.s.values[b == k]
            if len(v):
                rows.append((sp, v.mean()))
    return pd.DataFrame(rows, columns=["speaker", "r"])


def evaluate(D, scores_tr, scores_au):
    sx = D.ti.groupby("speaker").sex.first()
    # utterance readouts
    ut = pd.DataFrame(dict(it=D.tr["item"], s=scores_tr)).groupby("it").s.mean()
    um = D.ti.loc[ut.index]
    spm = pd.DataFrame(dict(spk=um.speaker.values, sex=um.sex.values, r=ut.values)).groupby(["spk", "sex"]).r.median().reset_index()
    G = spm[spm.sex == "f"].r.median() - spm[spm.sex == "m"].r.median()
    c = chunk_readouts(scores_tr, D.tr["cnt"], D.tr["item"], D.tr_spk)
    c["sex"] = c.speaker.map(sx)
    w = 1.0 / c.groupby("speaker").r.transform("size")
    auc5 = wauc(c.r[c.sex == "f"], c.r[c.sex == "m"], w[c.sex == "f"], w[c.sex == "m"])
    auc_spk = wauc(spm[spm.sex == "f"].r, spm[spm.sex == "m"].r)
    # flicker
    fl = pd.DataFrame(dict(it=D.tr["item"], s=scores_tr)).groupby("it").s.std().median() / G
    # manipulation deltas (bin-matched mean over bins)
    ok = D.au_refrow >= 0
    dl = np.full(len(scores_au), np.nan)
    dl[ok] = scores_au[ok] - scores_au[D.au_refrow[ok]]
    it = D.au["item"]
    dd = pd.DataFrame(dict(it=it, d=dl)).groupby("it").d.mean()
    ai = D.ai.loc[dd.index].assign(d=dd.values)
    out = dict(G=G, auc5=auc5, auc_spk=auc_spk, flick=fl)
    for eng in ("praat", "world"):
        e = ai[ai.engine == eng]
        p = e[e.kind == "pitch"]
        sl = p.groupby("src").apply(lambda g: np.sum(g.st / 12 * g.d) / np.sum((g.st / 12) ** 2), include_groups=False)
        out[f"R2_{eng}"] = abs(np.nanmedian(sl)) / G
        f = e[e.kind == "formant"]
        lf = np.log(f.fs)
        sl = f.assign(l=lf).groupby("src").apply(lambda g: np.sum(g.l * g.d) / np.sum(g.l ** 2), include_groups=False)
        out[f"R3_{eng}"] = np.nanmedian(sl) * LN115 / G
        sm = np.abs(lf) <= 0.07
        out[f"sign_{eng}"] = float(np.mean(np.sign(f.d[sm]) == np.sign(lf[sm])))
        # per-sex leak slopes (a median over both sexes can cancel opposite-signed leaks)
        for sx in ("m", "f"):
            ps = p[p.sex == sx]
            sl = ps.groupby("src").apply(lambda g: np.sum(g.st / 12 * g.d) / np.sum((g.st / 12) ** 2), include_groups=False)
            out[f"R2{sx}_{eng}"] = float(np.nanmedian(sl)) / G
            fs_ = f[f.sex == sx]
            sl = fs_.assign(l=np.log(fs_.fs)).groupby("src").apply(lambda g: np.sum(g.l * g.d) / np.sum(g.l ** 2), include_groups=False)
            out[f"R3{sx}_{eng}"] = float(np.nanmedian(sl)) * LN115 / G
        pm = p[p.sex == "m"]
        out[f"pitch_up_men_{eng}"] = float(np.nanmedian((pm.d / (pm.st / 12))[pm.st > 0])) / G
        pw = p[p.sex == "f"]
        out[f"pitch_down_women_{eng}"] = float(np.nanmedian((pw.d / (pw.st / 12))[pw.st < 0])) / G
    return out


def cv(D, cfg, verbose=False):
    import r4proxy
    z = r4proxy.load([cfg["feat"]["method"]])
    pr = []
    s_tr = np.full(len(D.tr["item"]), np.nan)
    s_au = np.full(len(D.au["item"]), np.nan)
    allspk = set(D.ti.speaker.unique())
    for k, test in enumerate(D.folds):
        m = Model(cfg).fit(D, allspk - test)
        mt = np.isin(D.tr_spk, list(test))
        ma = np.isin(D.au_spk, list(test))
        s_tr[mt] = m.predict(D.tr["E_" + m.feat.method][mt])
        s_au[ma] = m.predict(D.au["E_" + m.feat.method][ma])
        pr.append(r4proxy.proxy_r4(m.predict(z["E_" + m.feat.method]), z)[0])
    r = evaluate(D, s_tr, s_au)
    r["R4proxy"] = float(np.mean(pr))
    vp = os.path.join(FE, "vowelproxy.npz")
    if os.path.exists(vp):
        import vowelproxy
        r["vowelSD"] = vowelproxy.proxy(s_tr, D.tr_spk, r["G"], np.load(vp)["reg"])
    return r, s_tr, s_au


def fmt(r):
    return (f"auc5 {r['auc5']:.3f} spk {r['auc_spk']:.3f} | R2 p {r['R2_praat']:.3f} w {r['R2_world']:.3f} | "
            f"R3 p {r['R3_praat']:.2f} w {r['R3_world']:.2f} | sign p {r['sign_praat']:.2f} w {r['sign_world']:.2f} | "
            f"leak/oct M {r['R2m_praat']:+.2f} F {r['R2f_praat']:+.2f} (M up {r['pitch_up_men_praat']:+.2f} F dn {r['pitch_down_women_praat']:+.2f}) | "
            f"R3 M {r['R3m_praat']:.2f} F {r['R3f_praat']:.2f} | flick {r['flick']:.2f} | R4px {r.get('R4proxy', float('nan')):.2f} | vowelSD {r.get('vowelSD', float('nan')):.2f}")
