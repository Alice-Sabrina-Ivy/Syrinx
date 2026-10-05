"""Pitch-removed spectral-envelope features (FFT-only, so they port 1:1 to JS).

Per VOICED 10 ms frame (voicing from the supplied F0 track; production = pitch worker):
  method "cep"  fixed 32 ms Hann window, 1024-pt FFT, log power, real cepstrum, keep
                quefrencies <= LIFT_Q (fixed, F0-blind lifter), back to a log envelope.
  method "band" fixed 32 ms Hann window, power spectrum averaged in triangular bands on a
                log-frequency grid whose width is max(BW_MIN Hz, constant-Q) -> each band
                spans >= one harmonic spacing up to F0 = BW_MIN, so the band power tracks
                the envelope rather than individual harmonics; log.
  method "ct"   CheapTrick-style F0-adaptive envelope (Morise 2015): Hann window of 3 T0,
                power spectrum, rectangular smoothing over 2/3 F0, log, cepstral lifter
                sinc(pi F0 q) * [(1 - 2 q1) + 2 q1 cos(2 pi F0 q)], q1 = -0.15.
Each frame's log envelope is sampled on a log-frequency grid GRID (NB points FLO..FHI) and
level-normalised (mean over the grid removed). Frames are pooled into 150 ms output bins
(mean of >= MIN_FR voiced frames), emitted at the bin's END time (causal).
"""
import numpy as np

SR = 16000
NFFT = 1024
WIN = 512                      # 32 ms fixed window for cep / band
HOP = 0.01
BIN = 0.15
MIN_FR = 3
FLO, FHI, NB = 150.0, 6000.0, 64
GRID = np.exp(np.linspace(np.log(FLO), np.log(FHI), NB))
FREQS = np.arange(NFFT // 2 + 1) * SR / NFFT
LIFT_Q = 0.0016                # s; cep lifter cut (passes envelope detail >= 625 Hz wide)
BW_MIN = 450.0                 # Hz; band method minimum bandwidth
BW_Q = 0.25                    # band width as a fraction of centre frequency (if larger)
METHODS = ("cep", "band", "ct")
# extra variants: "band7" = BW_MIN 700 Hz; a trailing "p" = power-domain pooling within the 150 ms bin
EXTRA = ("band7", "bandp", "band7p", "ctp")
# "hs" = harmonic-sampled envelope: per frame, the log-power peak near each harmonic h*F0
# (search +-0.35 F0, parabolic refinement) is interpolated linearly in log-frequency onto GRID
# (held flat outside the harmonic range). F0-consistent by construction: PSOLA pitch shifts
# resample the same envelope at new points instead of changing band-to-harmonic coverage.
HS_SEARCH = 0.35


def _hann(n):
    return 0.5 - 0.5 * np.cos(2 * np.pi * (np.arange(n) + 0.5) / n)


_HW = _hann(WIN)


def _band_matrix(bwmin=BW_MIN):
    M = np.zeros((NB, len(FREQS)))
    for i, c in enumerate(GRID):
        bw = max(bwmin, BW_Q * c)
        w = np.clip(1 - np.abs(FREQS - c) / bw, 0, None)
        M[i] = w / w.sum()
    return M


_BM = _band_matrix()
_BM7 = _band_matrix(700.0)


def _interp_rows(Y, fx=FREQS, grid=GRID):
    # linear interpolation of each row of Y (defined on fx) at grid
    j = np.clip(np.searchsorted(fx, grid) - 1, 0, len(fx) - 2)
    a = (grid - fx[j]) / (fx[j + 1] - fx[j])
    return Y[:, j] * (1 - a) + Y[:, j + 1] * a


def _frames(x, centers, L):
    """(n, L) matrix of samples centred on `centers` (sample idx), zero-padded at edges."""
    off = centers[:, None] - L // 2 + np.arange(L)[None, :]
    ok = (off >= 0) & (off < len(x))
    F = np.zeros(off.shape, np.float64)
    F[ok] = x[off[ok]]
    return F


def env_cep(x, cs):
    F = _frames(x, cs, WIN) * _HW
    P = np.abs(np.fft.rfft(F, NFFT, axis=1)) ** 2 + 1e-12
    C = np.fft.irfft(np.log(P), NFFT, axis=1)
    L = int(round(LIFT_Q * SR))
    C[:, L + 1:NFFT - L] = 0
    E = np.fft.rfft(C, NFFT, axis=1).real
    return _interp_rows(E)


def env_band(x, cs, BM=None):
    F = _frames(x, cs, WIN) * _HW
    P = np.abs(np.fft.rfft(F, NFFT, axis=1)) ** 2 + 1e-12
    return np.log(P @ (_BM if BM is None else BM).T + 1e-12)


def env_ct(x, cs, f0):
    n = len(cs)
    f0 = np.clip(f0, 60.0, 900.0)
    Lw = np.minimum((3.0 * SR / f0).astype(int) // 2 * 2 + 1, NFFT - 1)   # odd, <= 1023
    half = Lw // 2
    k = np.arange(NFFT)[None, :] - NFFT // 2
    inside = np.abs(k) <= half[:, None]
    w = np.where(inside, 0.5 + 0.5 * np.cos(np.pi * k / (half[:, None] + 1)), 0.0)
    w /= np.sqrt(np.sum(w ** 2, 1, keepdims=True))
    F = _frames(x, cs, NFFT) * w
    P = np.abs(np.fft.rfft(F, NFFT, axis=1)) ** 2 + 1e-12
    # rectangular smoothing over width 2/3 F0 (linear frequency, power domain)
    df = SR / NFFT
    cum = np.concatenate([np.zeros((n, 1)), np.cumsum(P, 1)], 1)
    wb = (2.0 / 3.0) * f0 / df / 2.0                         # half width in bins
    idx = np.arange(P.shape[1])[None, :]
    lo = idx - wb[:, None]
    hi = idx + wb[:, None]
    def cumat(pos):
        pos = np.clip(pos, 0, P.shape[1])
        i0 = np.floor(pos).astype(int)
        i1 = np.minimum(i0 + 1, P.shape[1])
        fr = pos - i0
        r = np.arange(n)[:, None]
        return cum[r, i0] * (1 - fr) + cum[r, i1] * fr
    Ps = (cumat(hi + 0.5) - cumat(lo + 0.5)) / (hi - lo)
    Ps = np.maximum(Ps, 1e-12)
    C = np.fft.irfft(np.log(Ps), NFFT, axis=1)
    q = np.fft.fftfreq(NFFT, 1.0 / NFFT)[None, :] / SR         # quefrency (s), symmetric
    q1 = -0.15
    arg = np.pi * f0[:, None] * q
    sm = np.where(np.abs(q) > 0, np.sin(arg) / np.where(arg == 0, 1, arg), 1.0)
    comp = (1 - 2 * q1) + 2 * q1 * np.cos(2 * np.pi * f0[:, None] * q)
    E = np.fft.rfft(C * sm * comp, NFFT, axis=1).real
    return _interp_rows(E)


def env_hs(x, cs, f0):
    F = _frames(x, cs, WIN) * _HW
    LP = np.log(np.abs(np.fft.rfft(F, NFFT, axis=1)) ** 2 + 1e-12)
    df = SR / NFFT
    lg = np.log(GRID)
    nk = LP.shape[1]
    out = np.empty((len(cs), NB))
    for i in range(len(cs)):
        F0 = float(np.clip(f0[i], 50.0, 1000.0))
        H = max(1, int(FHI * 1.05 / F0))
        hb = np.arange(1, H + 1) * F0 / df
        w = int(np.ceil(HS_SEARCH * F0 / df))
        idx = np.clip(np.round(hb).astype(int)[:, None] + np.arange(-w, w + 1)[None, :], 1, nk - 2)
        row = LP[i]
        j = idx[np.arange(H), np.argmax(row[idx], 1)]
        a, b, c = row[j - 1], row[j], row[j + 1]
        den = a - 2 * b + c
        dlt = np.where(np.abs(den) > 1e-9, 0.5 * (a - c) / np.where(np.abs(den) > 1e-9, den, 1), 0.0)
        dlt = np.clip(dlt, -0.5, 0.5)
        pk = b - 0.25 * (a - c) * dlt
        fr = np.maximum((j + dlt) * df, 1.0)
        o = np.argsort(fr)
        out[i] = np.interp(lg, np.log(fr[o]), pk[o])
    return out


def frame_envelopes(x, f0track, methods=METHODS):
    """Voiced frame times + {method: (n, NB) level-normalised log envelopes}."""
    x = np.asarray(x, np.float64)
    m = f0track.f0 > 0
    t = f0track.t[m]
    f = f0track.f0[m]
    keep = (t * SR >= 0) & (t * SR < len(x))
    t, f = t[keep], f[keep]
    cs = np.round(t * SR).astype(int)
    out = {}
    for me in methods:
        if len(cs) == 0:
            out[me] = np.zeros((0, NB))
            continue
        base = {"bandp": "band", "band7p": "band7", "ctp": "ct"}.get(me, me)
        if base == "cep":
            E = env_cep(x, cs)
        elif base == "band":
            E = env_band(x, cs)
        elif base == "hs":
            E = env_hs(x, cs, f)
        elif base == "band7":
            E = env_band(x, cs, _BM7)
        else:
            E = env_ct(x, cs, f)
        out[me] = E - E.mean(1, keepdims=True)
    return t, f, out


def bin_pool(t, dur_s, E_by_method):
    """Mean envelope per 150 ms output bin with >= MIN_FR voiced frames.
    Returns end times (all bins), count per bin, {method: (nbins, NB) with NaN rows}."""
    nb = int(np.ceil(dur_s / BIN)) if dur_s > 0 else 0
    tend = (np.arange(nb) + 1) * BIN
    b = np.floor(t / BIN).astype(int)
    cnt = np.bincount(b, minlength=nb)[:nb] if len(b) else np.zeros(nb, int)
    out = {}
    for me, E in E_by_method.items():
        pw = me.endswith("p")
        S = np.zeros((nb, NB))
        if len(b):
            np.add.at(S, b[b < nb], np.exp(E[b < nb]) if pw else E[b < nb])
        with np.errstate(invalid="ignore", divide="ignore"):
            S = S / cnt[:, None]
            if pw:
                S = np.log(S)
                S = S - S.mean(1, keepdims=True)
        S[cnt < MIN_FR] = np.nan
        out[me] = S
    return tend, cnt, out
