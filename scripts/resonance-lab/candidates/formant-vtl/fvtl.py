"""formant-vtl candidate family: calibration-free apparent vocal-tract length (VTL) from
formants. Library shared by the harness candidates (cands.py) and the in-process lab
evaluator (lab.py).

Pipeline per item
  1. frames:   per-frame formant candidates from one of two sex-blind extractors
               (extract.py): the app's LPC (allpoles.mjs; orders 10/12/14, every pole +
               bandwidth, 25 ms hop) or Praat Burg (5 formants, ceiling 4500..6500 Hz).
  2. assign:   F1..F5 = the lowest poles that pass a plausibility filter
               (fmin < f < fmax, bandwidth < bwmax).
  3. estimate: a per-frame log-scale estimate (larger = shorter apparent tract):
               dF regression (Reby & McComb 2003) on a formant subset, geometric means,
               single formants, an odd-multiple comb fit over all poles, optionally
               minus a learned vowel/shape offset (ShapeCorrector) that depends only on
               scale-invariant formant RATIOS (so a pure formant scaling moves the
               estimate by exactly ln(scale)).
  4. gate:     voiced frames (pitch track) plus optional plausibility gates
               (F4/F3 ratio, bandwidths, formant-harmonic proximity, F0 limit).
  5. bin:      robust statistic (median / trimmed mean) of the frame estimates in each
               150 ms output bin -> the harness pools bins into readouts.
"""
import os
import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
K_ODD = np.array([0.5, 1.5, 2.5, 3.5, 4.5])

APP_ORDERS = (10, 12, 14)
NP = 7
ROW = 2 + len(APP_ORDERS) * (1 + 2 * NP)
CEILINGS = (4500, 5000, 5500, 6000, 6500)


# ----------------------------------------------------------------------------- frames
def app_formants(raw, order=12, fmin=90.0, fmax=5400.0, bwmax=600.0, nf=5):
    """raw: (n, ROW) app dump -> t_center (n,), F (n, nf), B (n, nf), rms_db (n,)."""
    q = APP_ORDERS.index(order)
    b = 2 + q * (1 + 2 * NP)
    f = raw[:, b + 1:b + 1 + NP].astype(np.float64)
    bw = raw[:, b + 1 + NP:b + 1 + 2 * NP].astype(np.float64)
    n = raw[:, b].astype(int)
    slot = np.arange(NP)[None, :]
    ok = (slot < n[:, None]) & (f > fmin) & (f < fmax) & (bw > 0) & (bw < bwmax)
    key = np.where(ok, f, np.inf)
    o = np.argsort(key, axis=1)[:, :nf]
    F = np.take_along_axis(key, o, 1)
    B = np.take_along_axis(bw, o, 1)
    F[~np.isfinite(F)] = np.nan
    B[np.isnan(F)] = np.nan
    t_end = np.round(raw[:, 0].astype(np.float64) * 48000) / 48000     # exact (s0 + WIN) / 48000
    return t_end - 0.025, F, B, raw[:, 1].astype(np.float64)


def praat_formants(t, Fc, Bc, ceiling=5500, bwmax=None):
    c = CEILINGS.index(ceiling)
    F = Fc[c].astype(np.float64).copy()
    B = Bc[c].astype(np.float64).copy()
    if bwmax is not None:
        bad = B > bwmax
        F[bad] = np.nan      # treat a too-broad Praat formant as missing (no re-ranking)
        B[bad] = np.nan
    return np.asarray(t, np.float64), F, B, None


# ----------------------------------------------------------------------------- estimators
def _reg(F, idx):
    k = K_ODD[list(idx)]
    X = F[:, list(idx)]
    return np.log((X @ k) / (k @ k))


def comb_fit(F, lo=700.0, hi=1700.0, n=201, first=1, sigma=0.12):
    """Odd-multiple comb fit: dF maximising sum_j exp(-d_j^2 / 2 sigma^2) where d_j is
    the distance of pole j (from index `first`) to the nearest (i - 1/2) dF, in units
    of dF. Robust to a missing or spurious pole (no fixed index assignment)."""
    grid = np.exp(np.linspace(np.log(lo), np.log(hi), n))
    P = F[:, first:]
    out = np.full(len(F), np.nan)
    ok = np.isfinite(P).sum(1) >= 2
    if not ok.any():
        return out
    Pk = P[ok][:, None, :] / grid[None, :, None]          # (m, n, k) in dF units
    d = np.abs(Pk - 0.5 - np.round(Pk - 0.5))
    sc = np.nansum(np.exp(-0.5 * (d / sigma) ** 2), axis=2)
    out[ok] = np.log(grid[np.argmax(sc, axis=1)])
    return out


def estimate(F, kind):
    """Per-frame log-scale estimate (NaN when the needed formants are missing)."""
    L = np.log(F)
    if kind == "dF1234":
        return _reg(F, (0, 1, 2, 3))
    if kind == "dF123":
        return _reg(F, (0, 1, 2))
    if kind == "dF234":
        return _reg(F, (1, 2, 3))
    if kind == "dF34":
        return _reg(F, (2, 3))
    if kind == "dF345":
        return _reg(F, (2, 3, 4))
    if kind == "dF12345":
        return _reg(F, (0, 1, 2, 3, 4))
    if kind == "gm1234":
        return L[:, :4].mean(1)
    if kind == "gm123":
        return L[:, :3].mean(1)
    if kind == "gm34":
        return L[:, 2:4].mean(1)
    if kind == "f3":
        return L[:, 2]
    if kind == "f4":
        return L[:, 3]
    if kind == "comb":
        return comb_fit(F, first=1)
    if kind == "comb0":
        return comb_fit(F, first=0)
    raise ValueError(kind)


def shape_features(F, idx=(0, 1, 2, 3)):
    """Scale-invariant formant-ratio features: ln F_i - mean_i ln F_i (drop the last, which
    is linearly dependent)."""
    L = np.log(F[:, list(idx)])
    S = L - L.mean(1, keepdims=True)
    return S[:, :-1]


class ShapeCorrector:
    """Vowel-class correction learned WITHOUT vowel labels: k-means clusters of the
    scale-invariant shape vector stand in for vowel classes; each cluster's offset is
    the mean within-speaker deviation of the estimate (estimate minus its speaker's
    median) over the training frames assigned to it. At run time
    corrected = estimate - offset[nearest cluster]. A pure formant scaling leaves the
    shape vector unchanged, so it moves the corrected estimate by exactly ln(scale)."""

    def __init__(self, K=16, idx=(0, 1, 2, 3), soft=0.0, seed=0):
        self.K, self.idx, self.soft, self.seed = K, tuple(idx), soft, seed
        self.C = None
        self.off = None

    def fit(self, F, est, spk):
        from sklearn.cluster import KMeans
        X = shape_features(F, self.idx)
        ok = np.isfinite(X).all(1) & np.isfinite(est)
        X, e, s = X[ok], est[ok], np.asarray(spk)[ok]
        dev = e - _group_median(e, s)
        km = KMeans(self.K, n_init=4, random_state=self.seed).fit(X)
        self.C = km.cluster_centers_
        lab = km.labels_
        self.off = np.array([np.mean(dev[lab == k]) if np.any(lab == k) else 0.0 for k in range(self.K)])
        self.counts = np.bincount(lab, minlength=self.K)
        return self

    def offset(self, F):
        X = shape_features(F, self.idx)
        out = np.full(len(F), np.nan)
        ok = np.isfinite(X).all(1)
        if not ok.any():
            return out
        d2 = ((X[ok][:, None, :] - self.C[None]) ** 2).sum(2)
        if self.soft > 0:
            w = np.exp(-(d2 - d2.min(1, keepdims=True)) / (2 * self.soft ** 2))
            out[ok] = (w @ self.off) / w.sum(1)
        else:
            out[ok] = self.off[np.argmin(d2, 1)]
        return out

    def to_dict(self):
        return dict(K=self.K, idx=list(self.idx), soft=self.soft, C=self.C.tolist(), off=self.off.tolist())

    @staticmethod
    def from_dict(d):
        s = ShapeCorrector(d["K"], d["idx"], d["soft"])
        s.C, s.off = np.array(d["C"]), np.array(d["off"])
        return s


class RatioRegressor:
    """Alternative correction: ridge regression of the within-speaker deviation on a
    degree-2 polynomial of the shape vector (scale-invariant)."""

    def __init__(self, idx=(0, 1, 2, 3), alpha=1.0, deg=2):
        self.idx, self.alpha, self.deg = tuple(idx), alpha, deg

    def _phi(self, X):
        cols = [np.ones(len(X))] + [X[:, i] for i in range(X.shape[1])]
        if self.deg >= 2:
            for i in range(X.shape[1]):
                for j in range(i, X.shape[1]):
                    cols.append(X[:, i] * X[:, j])
        if self.deg >= 3:
            for i in range(X.shape[1]):
                cols.append(X[:, i] ** 3)
        return np.stack(cols, 1)

    def fit(self, F, est, spk):
        X = shape_features(F, self.idx)
        ok = np.isfinite(X).all(1) & np.isfinite(est)
        dev = est[ok] - _group_median(est[ok], np.asarray(spk)[ok])
        P = self._phi(X[ok])
        A = P.T @ P + self.alpha * np.eye(P.shape[1])
        self.w = np.linalg.solve(A, P.T @ dev)
        return self

    def offset(self, F):
        X = shape_features(F, self.idx)
        out = np.full(len(F), np.nan)
        ok = np.isfinite(X).all(1)
        out[ok] = self._phi(X[ok]) @ self.w
        return out


def _group_median(v, g):
    import pandas as pd
    return pd.Series(v).groupby(pd.Series(g).values).transform("median").values


# ----------------------------------------------------------------------------- gates
def harmonic_proximity(F, f0, idx=(2, 3)):
    """max over the chosen formants of 1 - 2*|F/f0 - round(F/f0)| (1 = on a harmonic,
    0 = midway between two harmonics); NaN where unvoiced/missing."""
    r = F[:, list(idx)] / f0[:, None]
    p = 1 - 2 * np.abs(r - np.round(r))
    return np.nanmax(p, 1) if p.size else np.full(len(F), np.nan)


def gate(F, B, f0, cfg):
    ok = f0 > 0
    if cfg.get("f43") is not None:
        lo, hi = cfg["f43"]
        r = F[:, 3] / F[:, 2]
        ok &= (r > lo) & (r < hi)
    if cfg.get("f32min") is not None:
        ok &= F[:, 2] / F[:, 1] > cfg["f32min"]
    if cfg.get("bw34max") is not None:
        ok &= (B[:, 2] < cfg["bw34max"]) & (B[:, 3] < cfg["bw34max"])
    if cfg.get("f0max") is not None:
        ok &= f0 < cfg["f0max"]
    if cfg.get("hprox") is not None:
        hp = harmonic_proximity(F, np.where(f0 > 0, f0, np.nan), cfg.get("hprox_idx", (2, 3)))
        ok &= ~(hp > cfg["hprox"])
    if cfg.get("rms_rel") is not None and cfg.get("_rms") is not None:
        rms = cfg["_rms"]
        ok &= rms > np.nanmax(rms) + cfg["rms_rel"]
    return ok


# ----------------------------------------------------------------------------- binning
def bin_scores(t_out, v, dur, binw=0.15, stat="median", min_n=3, trim=0.2):
    nb = int(np.ceil(dur / binw))
    ts = (np.arange(nb) + 1) * binw
    ss = np.full(nb, np.nan)
    m = np.isfinite(v)
    if not m.any():
        return ts, ss
    b = np.floor(t_out[m] / binw).astype(int)
    vv = v[m]
    o = np.argsort(b, kind="stable")
    b, vv = b[o], vv[o]
    cut = np.flatnonzero(np.diff(b)) + 1
    for s0, s1 in zip(np.r_[0, cut], np.r_[cut, len(b)]):
        k = b[s0]
        if k >= nb or s1 - s0 < min_n:
            continue
        x = vv[s0:s1]
        if stat == "median":
            ss[k] = np.median(x)
        elif stat == "mean":
            ss[k] = np.mean(x)
        else:                               # trimmed mean
            x = np.sort(x)
            c = int(np.floor(trim * len(x)))
            ss[k] = np.mean(x[c:len(x) - c]) if len(x) - 2 * c > 0 else np.median(x)
    return ts, ss


# ----------------------------------------------------------------------------- the scorer
class Config(dict):
    """extractor: 'app' | 'praat'; order (app); ceiling (praat); fmax / bwmax (app filter);
    est: estimator kind (or a list -> mean of available); corr: None | path to a correction
    JSON | an object with .offset(F); gate keys (see gate()); binw, stat, min_n."""


def frame_estimates(fr, f0track, cfg, corr=None):
    """fr: ('app', raw) or ('praat', (t, Fc, Bc)). -> t_out (causal), v (per frame)."""
    kind, data = fr
    tm = cfg["est"] == "tmatch"
    gmm = getattr(corr, "gmm", None)
    ll = None
    if kind == "app" and cfg.get("sel_orders") and gmm is not None:
        t, F, B, rms, ll = select_order_formants(data, cfg, gmm)
        lag = 0.025
    elif kind == "app":
        t, F, B, rms = app_formants(data, cfg.get("order", 12), cfg.get("fmin", 90.0),
                                    cfg.get("fmax", 5400.0), cfg.get("bwmax", 600.0), nf=7 if tm else 5)
        lag = 0.025
    else:
        t, F, B, rms = praat_formants(*data, ceiling=cfg.get("ceiling", 5500), bwmax=cfg.get("bwmax"))
        lag = 0.025
    f0 = f0track.at(t) if f0track is not None else np.full(len(t), 100.0)
    if tm:
        v, cost, _ = corr.match(F)
        F, B = F[:, :5], B[:, :5]
    else:
        ests = cfg["est"] if isinstance(cfg["est"], (list, tuple)) else [cfg["est"]]
        v = np.nanmean(np.stack([estimate(F, e) for e in ests]), 0) if len(ests) > 1 else estimate(F, ests[0])
        if corr is not None:
            v = v - corr.offset(F)
    g = dict(cfg)
    g["_rms"] = rms
    ok = gate(F, B, f0, g)
    if cfg.get("gmm_q") is not None and gmm is not None:
        if ll is None:
            ll = gmm.loglik(F)
        ok &= ll > gmm.q[str(cfg["gmm_q"])]
    v = np.where(ok, v, np.nan)
    t_out = np.round((t + lag) * 48000) / 48000 if kind == "app" else t + lag
    return t_out, v, dict(t=t, F=F, B=B, f0=f0)


def score_frames(fr, f0track, dur, cfg, corr=None):
    if cfg.get("orders"):                  # pool frame estimates from several LPC orders
        parts = [frame_estimates(fr, f0track, dict(cfg, order=o), corr) for o in cfg["orders"]]
        t_out = np.concatenate([p[0] for p in parts])
        v = np.concatenate([p[1] for p in parts])
    else:
        t_out, v, _ = frame_estimates(fr, f0track, cfg, corr)
    return bin_scores(t_out, v, dur, cfg.get("binw", 0.15), cfg.get("stat", "median"),
                      cfg.get("min_n", 3 if fr[0] == "praat" else 2), cfg.get("trim", 0.2))


# ----------------------------------------------------------------------------- template matching
from itertools import combinations as _comb

_SUB4 = {n: np.array(list(_comb(range(n), 4))) for n in range(4, 8)}
_SUB3 = {n: np.array(list(_comb(range(n), 3))) for n in range(3, 8)}


class TemplateMatcher:
    """Joint formant labelling + vowel-class correction by scale-invariant template matching.

    Templates T_k (K vowel-shape classes, learned unsupervised on train_dev) hold the
    expected ln F1..F4 of class k RELATIVE TO THE SPEAKER'S SCALE (so they carry the
    per-class apparent-VTL offset). For a frame with sorted candidate poles p_1 < ... < p_n
    every class k and every ordered 4-subset of poles is scored:
        s      = sum_i w_ki (ln p_ji - T_ki) / sum_i w_ki          (closed-form shift)
        cost   = sum_i w_ki (ln p_ji - s - T_ki)^2 + lam * (#poles skipped below the top one)
                 - 2 ln pi_k
    plus 3-subsets matched to T_k1..3 with an extra penalty mu (F4 missing / above the band).
    The frame's estimate is s of the cheapest match; frames whose best cost exceeds cmax are
    rejected. A pure formant scaling shifts every ln p by the same amount, which shifts s
    by exactly that amount and leaves every cost unchanged (until a pole crosses the band
    edge), so the estimate is scale-equivariant by construction."""

    def __init__(self, K=16, lam=1.0, mu=2.0, cmax=None, sig_floor=0.02, iters=2, seed=0, use3=True):
        self.K, self.lam, self.mu, self.cmax, self.sig_floor = K, lam, mu, cmax, sig_floor
        self.iters, self.seed, self.use3 = iters, seed, use3

    def fit(self, F, spk, frame_mask=None):
        """F: (n, >=4) rank-assigned formants of clean training frames; spk: speaker per frame."""
        from sklearn.cluster import KMeans
        L = np.log(F[:, :4])
        ok = np.isfinite(L).all(1)
        L, spk = L[ok], np.asarray(spk)[ok]
        S = _group_median(L.mean(1), spk)                      # initial speaker scale: median ln GM
        X = L - L.mean(1, keepdims=True)
        step = max(1, len(X) // 120000)
        km = KMeans(self.K, n_init=3, random_state=self.seed).fit(X[::step, :3])
        lab = km.predict(X[:, :3])
        for _ in range(self.iters + 1):
            R = L - S[:, None]
            self.T = np.array([R[lab == k].mean(0) for k in range(self.K)])
            sd = np.array([R[lab == k].std(0) for k in range(self.K)])
            self.W = 1.0 / np.maximum(sd, self.sig_floor) ** 2
            self.logpi = np.log(np.bincount(lab, minlength=self.K) / len(lab))
            # re-label + re-estimate speaker scales with the matcher itself (EM-style)
            s, k = self._match_assigned(L)
            lab = k
            S = _group_median(s, spk)
        return self

    def _match_assigned(self, L):
        """Rank-assigned 4-formant match (training): best class and its shift."""
        Wk = self.W[None]                                      # (1, K, 4)
        D = L[:, None, :] - self.T[None]                       # (n, K, 4)
        s = (Wk * D).sum(2) / Wk.sum(2)
        c = (Wk * (D - s[..., None]) ** 2).sum(2) - 2 * self.logpi[None]
        k = np.argmin(c, 1)
        return s[np.arange(len(L)), k], k

    def match(self, P):
        """P: (n, m) sorted candidate poles (NaN padded). -> s (n,), cost (n,), k (n,)."""
        n, m = P.shape
        m = min(m, 7)
        P = P[:, :m]
        LP = np.log(P)
        best_c = np.full(n, np.inf)
        best_s = np.full(n, np.nan)
        best_k = np.full(n, -1)
        opts = []
        if m >= 4:
            opts.append((_SUB4[m], 4, 0.0))
        if self.use3 and m >= 3:
            opts.append((_SUB3[m], 3, self.mu))
        for sub, q, pen in opts:
            X = LP[:, sub]                                     # (n, S, q)
            valid = np.isfinite(X).all(2)                      # (n, S)
            skip = (sub[:, -1] + 1 - q)[None, :]               # poles skipped below the top chosen
            T = self.T[:, :q][None, None]                      # (1, 1, K, q)
            W = self.W[:, :q][None, None]
            D = X[:, :, None, :] - T                           # (n, S, K, q)
            s = (W * D).sum(3) / W.sum(3)                      # (n, S, K)
            c = (W * (D - s[..., None]) ** 2).sum(3) + self.lam * skip[..., None] + pen - 2 * self.logpi[None, None]
            c = np.where(valid[..., None], c, np.inf)
            flat = c.reshape(n, -1)
            j = np.argmin(flat, 1)
            cj = flat[np.arange(n), j]
            better = cj < best_c
            best_c[better] = cj[better]
            best_s[better] = s.reshape(n, -1)[np.arange(n), j][better]
            best_k[better] = (j % self.K)[better]
        if self.cmax is not None:
            best_s[best_c > self.cmax] = np.nan
        best_s[~np.isfinite(best_c)] = np.nan
        return best_s, best_c, best_k

    def to_dict(self):
        return dict(type="tmatch", K=self.K, lam=self.lam, mu=self.mu, cmax=self.cmax, use3=self.use3,
                    T=self.T.tolist(), W=self.W.tolist(), logpi=self.logpi.tolist())

    @staticmethod
    def from_dict(d):
        t = TemplateMatcher(d["K"], d["lam"], d["mu"], d["cmax"], use3=d.get("use3", True))
        t.T, t.W, t.logpi = np.array(d["T"]), np.array(d["W"]), np.array(d["logpi"])
        return t


# ----------------------------------------------------------------------------- shape GMM (plausibility / order selection)
class ShapeGMM:
    """Gaussian mixture on the scale-invariant shape vector (shape_features of F1..F4) of
    voiced train_dev frames. loglik(F) is a plausibility score for a frame's formant
    assignment that is invariant to pure formant scaling (so it cannot move R3) and does
    not see F0. Used (a) as a gate (reject frames below the q-th training-loglik quantile)
    and (b) to pick, per frame, the LPC order whose formant set looks most like speech."""

    def __init__(self, K=8, seed=0):
        self.K, self.seed = K, seed

    def fit(self, F):
        from sklearn.mixture import GaussianMixture
        X = shape_features(F)
        X = X[np.isfinite(X).all(1)]
        step = max(1, len(X) // 200000)
        g = GaussianMixture(self.K, covariance_type="full", random_state=self.seed, n_init=2).fit(X[::step])
        self.w, self.mu, self.cov = g.weights_, g.means_, g.covariances_
        self._prep()
        ll = self.loglik_X(X[::step])
        self.q = {str(q): float(np.quantile(ll, q)) for q in (0.01, 0.02, 0.05, 0.1, 0.2, 0.3)}
        return self

    def _prep(self):
        self.icov = np.linalg.inv(self.cov)
        self.lnorm = np.log(self.w) - 0.5 * np.linalg.slogdet(self.cov)[1] - 0.5 * self.mu.shape[1] * np.log(2 * np.pi)

    def loglik_X(self, X):
        D = X[:, None, :] - self.mu[None]
        m = np.einsum("nki,kij,nkj->nk", D, self.icov, D)
        a = self.lnorm[None] - 0.5 * m
        mx = a.max(1, keepdims=True)
        return (mx + np.log(np.exp(a - mx).sum(1, keepdims=True)))[:, 0]

    def loglik(self, F):
        X = shape_features(F)
        out = np.full(len(F), -np.inf)
        ok = np.isfinite(X).all(1)
        if ok.any():
            out[ok] = self.loglik_X(X[ok])
        return out

    def to_dict(self):
        return dict(K=self.K, w=self.w.tolist(), mu=self.mu.tolist(), cov=self.cov.tolist(), q=self.q)

    @staticmethod
    def from_dict(d):
        g = ShapeGMM(d["K"])
        g.w, g.mu, g.cov, g.q = np.array(d["w"]), np.array(d["mu"]), np.array(d["cov"]), d["q"]
        g._prep()
        return g


class Composite:
    """corrector (offset) + optional ShapeGMM (gate / order selection)."""

    def __init__(self, corr=None, gmm=None):
        self.corr, self.gmm = corr, gmm

    def offset(self, F):
        return self.corr.offset(F) if self.corr is not None else np.zeros(len(F))


def select_order_formants(raw, cfg, gmm):
    """Per frame, the order (of cfg['sel_orders']) whose F1..F5 set has the highest shape
    log-likelihood. -> t, F, B, rms, ll."""
    parts = [app_formants(raw, o, cfg.get("fmin", 90.0), cfg.get("fmax", 5400.0), cfg.get("bwmax", 600.0))
             for o in cfg["sel_orders"]]
    LL = np.stack([gmm.loglik(p[1]) for p in parts])          # (O, n)
    j = np.argmax(LL, 0)
    F = np.stack([p[1] for p in parts])[j, np.arange(LL.shape[1])]
    B = np.stack([p[2] for p in parts])[j, np.arange(LL.shape[1])]
    return parts[0][0], F, B, parts[0][3], LL[j, np.arange(LL.shape[1])]
