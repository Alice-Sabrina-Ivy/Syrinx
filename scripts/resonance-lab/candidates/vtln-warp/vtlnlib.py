"""VTLN warp-factor estimation library (resonance-lab, label: vtln-warp).

Pipeline
  1. Per voiced 10 ms frame (F0 track > 0), a pitch-robust log-power spectral envelope:
       'ct'   WORLD CheapTrick (F0-adaptive smoothing; needs the F0 value)
       'lift' fixed-quefrency cepstral liftering of a 25 ms Hann frame (F0-blind)
       'ctl'  CheapTrick followed by an extra fixed lifter (smoother envelope)
     resampled onto a log-frequency grid (step LN_STEP nats, LN_LO..LN_HI).
  2. Linear frequency warping S'(f) = S(a f) is a pure SHIFT of ln a on this axis, so the
     warped feature for shift k is the canonical band [band_lo, band_hi] read k bins higher:
       feat_k = DCT-II(logenv[i0 + k : i0 + k + D])[1 : C + 1]       (c0 dropped = level-invariant)
     No Jacobian is needed: the window length and basis are fixed for every k.
  3. A gender-balanced, speaker-independent reference model over canonical features
     (diagonal GMM; optionally speaker-adaptively trained = classic VTLN SAT iterations, where
     each training speaker's own warp is estimated and removed before refitting).
  4. Readout: for a set of frames, ln a_hat = argmax_k sum_frames log p(feat_k) (window level) or
     the median of per-frame argmaxes (frame level). Larger ln a = formants higher = shorter
     apparent vocal tract = more feminine-typical.
"""
import numpy as np
from scipy.fft import dct

SR = 16000
LN_STEP = 0.01
LN_LO = np.log(100.0)
LN_HI = np.log(7600.0)
GRID_LN = np.arange(LN_LO, LN_HI, LN_STEP)
GRID_F = np.exp(GRID_LN)
NFFT = 1024
FFT_F = np.arange(NFFT // 2 + 1) * SR / NFFT


# ----------------------------------------------------------------- envelopes
def _to_grid(logspec):
    """logspec (n, NFFT/2+1) natural-log power -> (n, len(GRID)) by linear interpolation."""
    pos = GRID_F / (SR / NFFT)
    i = np.floor(pos).astype(int)
    w = pos - i
    return logspec[:, i] * (1 - w) + logspec[:, i + 1] * w


def _lifter(logspec, nq):
    """Keep cepstral coefficients |q| < nq (samples) of a natural-log power spectrum."""
    c = np.fft.irfft(logspec, n=NFFT, axis=1)
    c[:, nq:NFFT - nq + 1] = 0.0
    return np.fft.rfft(c, n=NFFT, axis=1).real


def envelopes(x, f0t, f0v, method="ct", lifter_q=24, win_s=0.025):
    """Voiced-frame log envelopes on GRID. f0t/f0v: frame times + F0 (>0) of voiced frames only."""
    x = np.asarray(x, np.float64)
    if len(f0t) == 0:
        return np.zeros((0, len(GRID_F)), np.float32)
    if method in ("ct", "ctl"):
        import pyworld
        sp = pyworld.cheaptrick(x, np.ascontiguousarray(f0v, np.float64), np.ascontiguousarray(f0t, np.float64),
                                SR, fft_size=NFFT)
        L = np.log(sp + 1e-12)
        if method == "ctl":
            L = _lifter(L, lifter_q)
    elif method == "lift":
        n = int(win_s * SR)
        h = np.hanning(n)
        xp = np.pad(x, (n, n))
        c = (np.round(np.asarray(f0t) * SR).astype(int) + n - n // 2)
        idx = c[:, None] + np.arange(n)[None, :]
        fr = xp[idx] * h
        P = np.abs(np.fft.rfft(fr, NFFT, axis=1)) ** 2
        L = np.log(P + 1e-10 * (P.max(axis=1, keepdims=True) + 1e-20))
        L = _lifter(L, lifter_q)
    else:
        raise ValueError(method)
    return _to_grid(L).astype(np.float32)


def frame_energy_db(x, f0t, win_s=0.025):
    x = np.asarray(x, np.float64)
    n = int(win_s * SR)
    xp = np.pad(x, (n, n))
    c = (np.round(np.asarray(f0t) * SR).astype(int) + n - n // 2)
    idx = c[:, None] + np.arange(n)[None, :]
    return 10 * np.log10(np.mean(xp[idx] ** 2, axis=1) + 1e-12)


# ----------------------------------------------------------------- warped features
class Warper:
    def __init__(self, band=(300.0, 4500.0), ncep=20, kmax=25, drop_c1=False):
        self.i0 = int(round((np.log(band[0]) - LN_LO) / LN_STEP))
        self.D = int(round((np.log(band[1]) - np.log(band[0])) / LN_STEP))
        self.kmax = kmax
        assert self.i0 - kmax >= 0 and self.i0 + self.D + kmax <= len(GRID_F), "band +- shift outside the grid"
        B = dct(np.eye(self.D), type=2, norm="ortho", axis=0)       # (D, D): column j = basis? -> use rows
        first = 2 if drop_c1 else 1
        self.basis = B[first:first + ncep].T.astype(np.float32)     # (D, C)
        self.shifts = np.arange(-kmax, kmax + 1)
        self.C = ncep
        self.lna0, self.dlna = -kmax * LN_STEP, LN_STEP

    def feats(self, E, k):
        """E (n, G) -> features at integer shift k (scalar or per-row array)."""
        k = np.broadcast_to(np.asarray(k, int), (len(E),))
        idx = self.i0 + k[:, None] + np.arange(self.D)[None, :]
        return np.take_along_axis(E, idx, axis=1) @ self.basis

    def all_feats(self, E):
        """(n, S, C) features for every shift."""
        from numpy.lib.stride_tricks import sliding_window_view
        sub = E[:, self.i0 - self.kmax: self.i0 + self.D + self.kmax]          # (n, D + 2kmax)
        win = sliding_window_view(sub, self.D, axis=1)                         # (n, S, D)
        return win @ self.basis


# ----------------------------------------------------------------- reference model
class DiagGMM:
    def __init__(self, w, mu, var):
        self.w, self.mu, self.var = np.asarray(w), np.asarray(mu), np.asarray(var)
        self._prep()

    def _prep(self):
        self.prec = 1.0 / self.var
        self.const = np.log(self.w) - 0.5 * np.sum(np.log(2 * np.pi * self.var), axis=1)

    def loglik(self, X):
        """X (..., C) -> (...) log-likelihood."""
        sh = X.shape[:-1]
        X = X.reshape(-1, X.shape[-1]).astype(np.float64)
        # -0.5 sum (x-mu)^2 prec = -0.5 (x^2 prec - 2 x mu prec + mu^2 prec)
        a = (X ** 2) @ self.prec.T - 2 * X @ (self.mu * self.prec).T + np.sum(self.mu ** 2 * self.prec, axis=1)
        lp = self.const - 0.5 * a
        m = lp.max(axis=1, keepdims=True)
        return (m[:, 0] + np.log(np.exp(lp - m).sum(axis=1))).reshape(sh)

    @staticmethod
    def fit(X, K, seed=0, max_iter=200, reg=1e-3):
        from sklearn.mixture import GaussianMixture
        if K == 1:
            return DiagGMM(np.ones(1), X.mean(0, keepdims=True), X.var(0, keepdims=True) + reg)
        g = GaussianMixture(K, covariance_type="diag", random_state=seed, max_iter=max_iter, reg_covar=reg,
                            init_params="k-means++")
        g.fit(X)
        return DiagGMM(g.weights_, g.means_, g.covariances_)

    def to_dict(self):
        return dict(w=self.w, mu=self.mu, var=self.var)


def loglik_curves(model, warper, E):
    """(n, S) per-frame log-likelihood over shifts."""
    return model.loglik(warper.all_feats(E))


def refine_peak(curve):
    """argmax with parabolic interpolation, returns fractional shift index offset from centre."""
    j = int(np.argmax(curve))
    if 0 < j < len(curve) - 1:
        a, b, c = curve[j - 1], curve[j], curve[j + 1]
        den = a - 2 * b + c
        d = 0.5 * (a - c) / den if den < 0 else 0.0
        return j + float(np.clip(d, -0.5, 0.5))
    return float(j)


# ----------------------------------------------------------------- SAT training
def train_sat(E_spk, band=(300.0, 4500.0), ncep=20, kmax=25, drop_c1=False, K=64, sat=3, seed=0, log=print):
    """Gender-balanced reference model with speaker-adaptive (VTLN) training.

    E_spk: {speaker: (n, GRID) log envelopes}. Iteration 0 fits a GMM to unwarped features; each SAT
    iteration estimates every training speaker's own shift (ML over all their frames), re-centres the
    shifts to mean 0 (so the canonical model sits at the speaker-average tract length of a balanced
    pool) and refits on de-warped features. Returns (Warper, DiagGMM, {speaker: shift}).
    """
    W = Warper(tuple(band), ncep, kmax, drop_c1)
    k_spk = {s: 0 for s in E_spk}
    model = None
    for it in range(sat + 1):
        X = np.concatenate([W.feats(E, k_spk[s]) for s, E in E_spk.items()])
        model = DiagGMM.fit(X, K, seed=seed)
        if it == sat:
            break
        new = {}
        for s, E in E_spk.items():
            ll = np.zeros(len(W.shifts))
            for a in range(0, len(E), 3000):
                ll += loglik_curves(model, W, E[a:a + 3000]).sum(0)
            new[s] = int(W.shifts[np.argmax(ll)])
        mu = int(round(np.mean(list(new.values()))))
        k_spk = {s: int(np.clip(v - mu, -W.kmax + 5, W.kmax - 5)) for s, v in new.items()}
        log(f"   SAT it{it}: spk shifts {sorted(k_spk.values())}")
    return W, model, k_spk


# ----------------------------------------------------------------- streaming readout
BIN = 0.15
ESTIMATORS = {"frame": None, "w0.15": 0, "w0.5": 50, "w1": 100, "w2": 200, "w4": 400, "post1": -100}


def bin_estimates(LL, t, dur, W, which=tuple(ESTIMATORS), min_frames=3):
    """W: any object with .lna0, .dlna (ln alpha = lna0 + j * dlna for curve column j)."""
    """Causal 150 ms output bins. LL (n, S) per-frame curves at voiced frame times t.

    frame : median of per-frame refined argmaxes inside the bin
    wX    : refined argmax of the log-likelihood summed over the trailing N voiced frames (N = X s / 10 ms;
            w0.15 = just this bin's frames)
    post1 : posterior-mean shift over the trailing 1 s, likelihood averaged per frame (temperature = 1 frame)
    Output in ln(alpha) units; NaN when the bin has < min_frames voiced frames.
    """
    nb = int(np.ceil(dur / BIN))
    te = (np.arange(nb) + 1) * BIN
    res = {k: np.full(nb, np.nan) for k in which}
    if len(t) == 0:
        return te, res
    fr = np.array([refine_peak(r) for r in LL]) if "frame" in which else None
    js = np.arange(LL.shape[1])
    cs = np.vstack([np.zeros(LL.shape[1]), np.cumsum(LL.astype(np.float64), 0)])
    b = np.floor((np.asarray(t) - 1e-9) / BIN).astype(int)
    for i in range(nb):
        sel = np.flatnonzero(b == i)
        if len(sel) < min_frames:
            continue
        hi = sel[-1] + 1
        for k in which:
            N = ESTIMATORS[k]
            if k == "frame":
                res[k][i] = np.median(fr[sel])
            elif N is not None and N < 0:
                lo = max(0, hi + N)
                cur = (cs[hi] - cs[lo]) / (hi - lo)
                p = np.exp(cur - cur.max())
                res[k][i] = float(np.sum(p * js) / p.sum())
            else:
                lo = sel[0] if N == 0 else max(0, hi - N)
                res[k][i] = refine_peak(cs[hi] - cs[lo])
    return te, {k: W.lna0 + v * W.dlna for k, v in res.items()}


# ----------------------------------------------------------------- model warping ("warp the model, not the data")
class ModelWarp:
    """Data features are FIXED: the input's mean-normalised log envelope over the canonical band on a
    coarse log-f grid (step = st * LN_STEP). The reference is a diagonal GMM over a WIDE band (canonical
    band +- kmax); hypothesis j evaluates the input against the model's sub-window starting j grid steps
    into the wide band (sub-window mean re-normalised). Because the data never changes across hypotheses,
    the likelihoods are comparable (warping the DATA lets the window content change with the shift and
    biases ML toward whichever band is 'easiest' - measured: estimates pile up at the low-shift edge).
    Column j <-> ln alpha = lna0 + j * dlna (dlna < 0: a model sub-window further up = data formants lower).
    """

    def __init__(self, band=(300.0, 4500.0), kmax=24, st=2):
        assert kmax % st == 0
        self.st, self.kmax = st, kmax
        self.i0 = int(round((np.log(band[0]) - LN_LO) / LN_STEP))
        self.D = int(round((np.log(band[1]) - np.log(band[0])) / LN_STEP))
        self.cols_c = np.arange(self.i0, self.i0 + self.D, st)
        self.cols_w = np.arange(self.i0 - kmax, self.i0 + self.D + kmax, st)
        self.Dc = len(self.cols_c)
        self.nk = 2 * kmax // st + 1
        self.lna0, self.dlna = kmax * LN_STEP, -st * LN_STEP

    def data(self, E):
        c = E[:, self.cols_c]
        return c - c.mean(1, keepdims=True)

    def wide(self, E, k=0):
        """Training features over the wide band, read k fine bins up (= de-warping a speaker with ln a = k*LN_STEP)."""
        k = np.broadcast_to(np.asarray(k, int), (len(E),))[:, None]
        w = np.take_along_axis(E, self.cols_w[None, :] + k, axis=1)
        c = np.take_along_axis(E, self.cols_c[None, :] + k, axis=1)
        return w - c.mean(1, keepdims=True)

    def prepare(self, gmm):
        """Per-hypothesis sub-models (mean re-normalised)."""
        self.sub = []
        for j in range(self.nk):
            mu = gmm.mu[:, j:j + self.Dc]
            var = gmm.var[:, j:j + self.Dc]
            mu = mu - mu.mean(1, keepdims=True)
            prec = 1.0 / var
            const = np.log(gmm.w) - 0.5 * np.sum(np.log(2 * np.pi * var), 1)
            self.sub.append(((prec.T).astype(np.float32), ((mu * prec).T).astype(np.float32),
                             (const - 0.5 * np.sum(mu ** 2 * prec, 1)).astype(np.float32)))
        return self

    def curves(self, E):
        X = self.data(E).astype(np.float32)
        X2 = X ** 2
        out = np.empty((len(X), self.nk), np.float32)
        for j, (pT, mpT, c) in enumerate(self.sub):
            lp = c - 0.5 * (X2 @ pT) + X @ mpT
            m = lp.max(1, keepdims=True)
            out[:, j] = m[:, 0] + np.log(np.exp(lp - m).sum(1))
        return out


def train_mw(E_spk, band=(300.0, 4500.0), kmax=24, st=2, K=32, sat=2, seed=0, log=print, reg=1e-3):
    """Model-warp reference: diag GMM on wide-band features of a balanced pool, optional SAT (each training
    speaker's ln alpha estimated by ML over all their frames, shifts re-centred to mean 0, de-warped, refit)."""
    MW = ModelWarp(band, kmax, st)
    k_spk = {s: 0 for s in E_spk}
    gmm = None
    for it in range(sat + 1):
        X = np.concatenate([MW.wide(E, k_spk[s]) for s, E in E_spk.items()])
        gmm = DiagGMM.fit(X, K, seed=seed, reg=reg)
        MW.prepare(gmm)
        if it == sat:
            break
        new = {}
        for s, E in E_spk.items():
            ll = np.zeros(MW.nk)
            for a in range(0, len(E), 4000):
                ll += MW.curves(E[a:a + 4000]).sum(0)
            new[s] = MW.lna0 + refine_peak(ll) * MW.dlna
        mu = np.mean(list(new.values()))
        lo_ok, hi_ok = -int(MW.cols_w[0]), len(GRID_F) - 1 - int(MW.cols_w[-1])   # keep de-warped reads on the grid
        k_spk = {s: int(np.clip(round((v - mu) / LN_STEP), lo_ok, hi_ok)) for s, v in new.items()}
        log(f"   SAT it{it}: spk shifts {sorted(k_spk.values())}")
    return MW, gmm, k_spk


# ----------------------------------------------------------------- F0-conditioned model warping
class ModelWarpF0(ModelWarp):
    """ModelWarp with one canonical reference GMM per F0 band (edges in Hz). After SAT de-warping, every
    band's model describes the SAME canonical tract, but as the envelope estimator sees it at that F0
    (harmonic sampling, F1/H1 interaction). A high-F0 frame is therefore compared with high-F0 canonical
    frames instead of low-F0 ones, so F0-driven envelope changes are not read as a warp. Bands are tied
    to one alignment through speakers whose frames span several bands."""

    def __init__(self, band=(300.0, 4500.0), kmax=24, st=2, f0_edges=(150.0, 210.0)):
        super().__init__(band, kmax, st)
        self.f0_edges = np.asarray(f0_edges, float)

    def fbin(self, f0):
        return np.searchsorted(self.f0_edges, np.asarray(f0, float))

    def prepare_all(self, gmms):
        self.subs = []
        for g in gmms:
            ModelWarp.prepare(self, g)
            self.subs.append(self.sub)
        return self

    def curves(self, E, f0=None):
        out = np.empty((len(E), self.nk), np.float32)
        b = self.fbin(f0)
        for i, sub in enumerate(self.subs):
            m = b == i
            if m.any():
                self.sub = sub
                out[m] = ModelWarp.curves(self, E[m])
        return out


def train_mwf0(E_spk, F_spk, band=(300.0, 4500.0), kmax=24, st=2, K=32, sat=2, seed=0, log=print, reg=1e-3,
               f0_edges=(150.0, 210.0), init_from=None):
    """F_spk: {speaker: per-frame F0}. Iteration 0 uses one pooled GMM (as train_mw) to get the first SAT
    shifts; then per-F0-band GMMs are fitted on de-warped frames and the shifts re-estimated with them."""
    MW = ModelWarpF0(band, kmax, st, f0_edges)
    nb = len(f0_edges) + 1
    k_spk = {s: 0 for s in E_spk}
    gmms = None
    for it in range(sat + 1):
        Xs = {s: MW.wide(E, k_spk[s]) for s, E in E_spk.items()}
        if it == 0:
            g = DiagGMM.fit(np.concatenate(list(Xs.values())), K, seed=seed, reg=reg)
            gmms = [g] * nb
        else:
            gmms = []
            for i in range(nb):
                X = np.concatenate([Xs[s][MW.fbin(F_spk[s]) == i] for s in Xs])
                gmms.append(DiagGMM.fit(X, K, seed=seed, reg=reg))
                log(f"   F0 band {i}: {len(X)} frames")
        MW.prepare_all(gmms)
        if it == sat and it > 0:
            break
        new = {}
        for s, E in E_spk.items():
            ll = np.zeros(MW.nk)
            for a in range(0, len(E), 4000):
                ll += MW.curves(E[a:a + 4000], F_spk[s][a:a + 4000]).sum(0)
            new[s] = MW.lna0 + refine_peak(ll) * MW.dlna
        mu = np.mean(list(new.values()))
        k_spk = {s: int(round((v - mu) / LN_STEP)) for s, v in new.items()}
        log(f"   SAT it{it}: spk shifts {sorted(k_spk.values())}")
    return MW, gmms, k_spk
