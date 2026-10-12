# model.py — custom voice detector (2026-10-06): the causal model.
#
# Input: the 16 kHz stream (the pitch worker's linear resampler output),
# PAD (316) zeros in front (tcommon.PAD). Frame i = the WIN (512) samples ending
# at (i + 1) * HOP - OFF, hop 12.5 ms. Features: power spectrum of a periodic
# Hann window (DFT as a fixed strided convolution, so the ONNX graph is
# self-contained), mel filterbank, log. Network: causal 2-D convolutions over
# (time, mel) — time kernels summing to a receptive field of `rf` frames,
# i.e. frame_ms = 32 + (rf - 1) * 12.5 ms (V3 limit 100 ms: rf <= 6) — then a
# GRU (longer memory only as recurrent state, as the pre-registration §5
# requires) and a linear head: one voice logit per frame.
#
# Streaming form (export): `Streaming` takes N * HOP new samples plus the
# carried state (audio context, each causal convolution's past input frames,
# GRU state) and returns N probabilities; zero initial state = the batch form.
#
# Round 3 (pre-registration 2026-10-07 §3.1, B-leak / B-sess-leak): cfg
# `leak_tau` > 0 gives the GRU a state DECAY: before every frame's GRU step the
# state is multiplied by lam = exp(-12.5 ms / leak_tau), in training and in
# streaming (h <- lam * h, then the unchanged GRU update). Training runs the
# recurrence as a TorchScript loop over frames on the GRU's own weights
# (`gru_leak_loop`, the nn.GRU equations); the streaming / export form runs
# nn.GRU one frame at a time on lam * h (exported as one ONNX GRU op per frame,
# so a leak model's ONNX file has a FIXED chunk of `Streaming.fixed_n` frames).
# The training recurrence has a hand-written backward (LeakGRUFn) replayed as
# CUDA graphs in blocks of 128 frames (LeakGRUGraphFn); outputs and gradients
# equal autograd through gru_leak_loop to float rounding.
# `skip` (body): convolution outputs of the first `skip` frames are dropped
# before the GRU (training with carried state: a chunk's lead-in frames only
# rebuild the convolutions' context).
#
# Round 4 (pre-registration 2026-10-11 §3.3 F1; Addendum R4-B part 2): cfg
# "f1" adds RECURSIVE STATIONARITY STATISTICS of the log-mel x_t (natural log,
# before batch normalisation): per band and tau in {1 s, 6 s}, alpha = 1 -
# exp(-12.5 ms / tau), mu <- mu + alpha (x - mu), then v <- v + alpha ((x -
# mu)^2 - v) (mu updated first); the first convolution reads 5 channels x, x -
# mu_1, x - mu_6, log(v_1 + eps), log(v_6 + eps) (one BatchNorm per channel x
# band); the recursive spectral flux f_t = mean over bands |x_t - x_{t-1}| and
# its two EMAs (tau 1 s, 6 s) join the GRU input (BatchNorm over the 2). At the
# stream start (state flag init = 0): mu = x_0, v = v0, x_{-1} = x_0, flux EMAs
# = fl0 (constants in cfg, fixed before training). The state (mu, v, x_prev,
# flux EMAs, init) is carried like the GRU state (streaming: extra ONNX state
# inputs / outputs; zeros = stream start). First-order recursive state only, no
# feed-forward window: frame_ms is unchanged. Without "f1" in cfg every code
# path below is the round-3 one.
import math
from typing import Tuple

import numpy as np
import torch
import torch.nn as nn
import torch.nn.functional as F

SR, HOP, WIN, OFF = 16000, 200, 512, 4
PAD = WIN - HOP + OFF


def mel_fb(n_mels, fmin, fmax, n_fft=WIN, sr=SR):
    def hz2mel(f):
        return 2595.0 * np.log10(1 + f / 700.0)

    def mel2hz(m):
        return 700.0 * (10 ** (m / 2595.0) - 1)
    nb = n_fft // 2 + 1
    freqs = np.arange(nb) * sr / n_fft
    pts = mel2hz(np.linspace(hz2mel(fmin), hz2mel(fmax), n_mels + 2))
    fb = np.zeros((n_mels, nb), np.float32)
    for m in range(n_mels):
        lo, c, hi = pts[m], pts[m + 1], pts[m + 2]
        up = (freqs - lo) / max(c - lo, 1e-9)
        dn = (hi - freqs) / max(hi - c, 1e-9)
        fb[m] = np.clip(np.minimum(up, dn), 0, None)
        if fb[m].sum() == 0:  # narrower than a bin: nearest bin
            fb[m, int(round(c * n_fft / sr))] = 1.0
    return fb


class Frontend(nn.Module):
    def __init__(self, n_mels=64, fmin=50.0, fmax=7800.0, win=WIN):
        super().__init__()
        n = np.arange(win)
        w = 0.5 - 0.5 * np.cos(2 * np.pi * n / win)      # periodic Hann
        k = np.arange(win // 2 + 1)[:, None]
        ang = 2 * np.pi * k * n[None, :] / win
        basis = np.concatenate([np.cos(ang) * w, -np.sin(ang) * w], 0).astype(np.float32)[:, None, :]
        self.register_buffer("basis", torch.from_numpy(basis))          # [514, 1, 512]
        self.register_buffer("fb", torch.from_numpy(mel_fb(n_mels, fmin, fmax, n_fft=win)))  # [M, win/2+1]
        self.nb = win // 2 + 1

    def forward(self, xpad):
        """xpad [B, S] (stream with PAD zeros in front) -> log-mel [B, T, M], T = (S - WIN) // HOP + 1."""
        y = F.conv1d(xpad[:, None, :], self.basis, stride=HOP)          # [B, 514, T]
        re, im = y[:, :self.nb], y[:, self.nb:]
        p = re * re + im * im                                            # [B, 257, T]
        m = torch.matmul(self.fb, p)                                     # [B, M, T]
        return torch.log(m + 1e-9).transpose(1, 2)                       # [B, T, M]


class CausalConv(nn.Module):
    def __init__(self, cin, cout, kt, kf=3, sf=2):
        super().__init__()
        self.kt = kt
        self.conv = nn.Conv2d(cin, cout, (kt, kf), stride=(1, sf), padding=(0, kf // 2), bias=False)
        self.bn = nn.BatchNorm2d(cout)

    def forward(self, x, state=None):
        """x [B, C, T, F]; state [B, C, kt-1, F] (past input frames) or None (zeros)."""
        if self.kt > 1:
            if state is None:
                state = x.new_zeros(x.shape[0], x.shape[1], self.kt - 1, x.shape[3])
            xc = torch.cat([state, x], 2)
            new = xc[:, :, -(self.kt - 1):]
        else:
            xc, new = x, None
        return F.relu(self.bn(self.conv(xc))), new


@torch.jit.script
def gru_leak_loop(gi: torch.Tensor, h: torch.Tensor, w_hh: torch.Tensor, b_hh: torch.Tensor, lam: float) -> Tuple[torch.Tensor, torch.Tensor]:
    """gi [B, T, 3H] = x W_ih^T + b_ih (gate order r, z, n as nn.GRU); h [B, H].
    Per frame: h <- lam * h, then the nn.GRU update. Returns outputs [B, T, H] and the last state."""
    H = h.shape[1]
    outs = []
    for t in range(gi.shape[1]):
        h = h * lam
        gh = torch.addmm(b_hh, h, w_hh.t())
        g = gi[:, t]
        r = torch.sigmoid(g[:, :H] + gh[:, :H])
        z = torch.sigmoid(g[:, H:2 * H] + gh[:, H:2 * H])
        n = torch.tanh(g[:, 2 * H:] + r * gh[:, 2 * H:])
        h = (1 - z) * n + z * h
        outs.append(h)
    return torch.stack(outs, 1), h


class LeakGRUFn(torch.autograd.Function):
    """The leak recurrence (gru_leak_loop's equations) with a hand-written backward: far fewer
    kernel launches than autograd through a Python loop (training only; same outputs)."""

    @staticmethod
    def forward(ctx, gi, h0, w, b, lam):
        # gi [B, T, 3H], h0 [B, H], w [3H, H], b [3H]
        B, T, H3 = gi.shape
        H = H3 // 3
        git = gi.transpose(0, 1).contiguous()                  # [T, B, 3H]
        RZ = gi.new_empty(T, B, 2 * H)
        Nn = gi.new_empty(T, B, H)
        GHN = gi.new_empty(T, B, H)
        HP = gi.new_empty(T, B, H)                             # state before the frame (undecayed)
        O = gi.new_empty(T, B, H)
        wt = w.t()
        h = h0
        for t in range(T):
            HP[t] = h
            gh = torch.addmm(b, h, wt, alpha=lam)
            g = git[t]
            torch.sigmoid(g[:, :2 * H] + gh[:, :2 * H], out=RZ[t])
            GHN[t] = gh[:, 2 * H:]
            torch.tanh(torch.addcmul(g[:, 2 * H:], RZ[t, :, :H], GHN[t]), out=Nn[t])
            tmp = torch.add(Nn[t], h, alpha=-lam)               # n - lam h
            torch.addcmul(Nn[t], RZ[t, :, H:], tmp, value=-1.0, out=O[t])
            h = O[t]
        ctx.save_for_backward(RZ, Nn, GHN, HP, w)
        ctx.lam = lam
        return O.transpose(0, 1), O[-1].clone()

    @staticmethod
    def backward(ctx, dO, dhT):
        RZ, Nn, GHN, HP, w = ctx.saved_tensors
        lam = ctx.lam
        T, B, H = Nn.shape
        dOt = dO.transpose(0, 1) if dO is not None else None
        dh = dhT.clone() if dhT is not None else Nn.new_zeros(B, H)
        DGH = Nn.new_empty(T, B, 3 * H)
        DPN = Nn.new_empty(T, B, H)
        for t in range(T - 1, -1, -1):
            if dOt is not None:
                dh = dh + dOt[t]
            r, z, n = RZ[t, :, :H], RZ[t, :, H:], Nn[t]
            hd_n = torch.add(n, HP[t], alpha=-lam)               # n - lam h
            dn = dh - dh * z
            torch.mul(dn, 1 - n * n, out=DPN[t])                  # d pre-activation of n
            DGH[t, :, 2 * H:] = DPN[t] * r                        # d ghn
            DGH[t, :, :H] = DPN[t] * GHN[t] * r * (1 - r)         # d pre r
            DGH[t, :, H:2 * H] = -dh * hd_n * z * (1 - z)          # d pre z (dz = dh * (lam h - n))
            dh = lam * torch.addmm(dh * z, DGH[t], w)
        HPf = HP.reshape(T * B, H)
        dw = lam * DGH.reshape(T * B, 3 * H).t().mm(HPf)
        db = DGH.sum((0, 1))
        DGI = DGH.clone()
        DGI[:, :, 2 * H:] = DPN
        return DGI.transpose(0, 1), dh, dw, db, None


_LEAK_BLOCK = 128
_LEAK_GRAPHS = {}
_LEAK_POOL = None


def _leak_fwd_steps(git, h, wt, b, lam, RZ, Nn, GHN, HP, O, H):
    for t in range(git.shape[0]):
        HP[t].copy_(h)
        gh = torch.addmm(b, h, wt, alpha=lam)
        g = git[t]
        torch.sigmoid(g[:, :2 * H] + gh[:, :2 * H], out=RZ[t])
        GHN[t].copy_(gh[:, 2 * H:])
        torch.tanh(torch.addcmul(g[:, 2 * H:], RZ[t, :, :H], GHN[t]), out=Nn[t])
        tmp = torch.add(Nn[t], h, alpha=-lam)
        torch.addcmul(Nn[t], RZ[t, :, H:], tmp, value=-1.0, out=O[t])
        h = O[t]


def _leak_bwd_steps(dO, dh_in, dh_out, RZ, Nn, GHN, HP, w, lam, DGH, DPN, H):
    dh = dh_in
    for t in range(RZ.shape[0] - 1, -1, -1):
        dh = dh + dO[t]
        r, z, n = RZ[t, :, :H], RZ[t, :, H:], Nn[t]
        hd_n = torch.add(n, HP[t], alpha=-lam)
        dn = dh - dh * z
        torch.mul(dn, 1 - n * n, out=DPN[t])
        DGH[t, :, 2 * H:] = DPN[t] * r
        DGH[t, :, :H] = DPN[t] * GHN[t] * r * (1 - r)
        DGH[t, :, H:2 * H] = -dh * hd_n * z * (1 - z)
        dh = lam * torch.addmm(dh * z, DGH[t], w)
    dh_out.copy_(dh)


class _LeakGraph:
    """CUDA graphs of S forward / backward steps of the leak recurrence for one batch size (static buffers)."""

    def __init__(self, B, S, H, w, b, lam):
        global _LEAK_POOL
        dev, dt = w.device, w.dtype
        e = lambda *sh: torch.zeros(*sh, device=dev, dtype=dt)  # noqa: E731
        self.git, self.h = e(S, B, 3 * H), e(B, H)
        self.RZ, self.Nn, self.GHN, self.HP, self.O = e(S, B, 2 * H), e(S, B, H), e(S, B, H), e(S, B, H), e(S, B, H)
        self.dO, self.dh_in, self.dh_out = e(S, B, H), e(B, H), e(B, H)
        self.DGH, self.DPN = e(S, B, 3 * H), e(S, B, H)
        wt = w.t()
        f = lambda: _leak_fwd_steps(self.git, self.h, wt, b, lam, self.RZ, self.Nn, self.GHN, self.HP, self.O, H)  # noqa: E731
        g = lambda: _leak_bwd_steps(self.dO, self.dh_in, self.dh_out, self.RZ, self.Nn, self.GHN, self.HP, w, lam, self.DGH, self.DPN, H)  # noqa: E731
        if _LEAK_POOL is None:
            _LEAK_POOL = torch.cuda.graph_pool_handle()
        s = torch.cuda.Stream()
        s.wait_stream(torch.cuda.current_stream())
        with torch.cuda.stream(s):
            for _ in range(2):
                f()
                g()
        torch.cuda.current_stream().wait_stream(s)
        self.gf, self.gb = torch.cuda.CUDAGraph(), torch.cuda.CUDAGraph()
        with torch.cuda.graph(self.gf, pool=_LEAK_POOL):
            f()
        with torch.cuda.graph(self.gb, pool=_LEAK_POOL):
            g()


def leak_graphs_reset():
    """Free every captured leak graph and their memory pool (inference with many batch sizes)."""
    global _LEAK_POOL
    _LEAK_GRAPHS.clear()
    _LEAK_POOL = None
    import gc
    gc.collect()
    torch.cuda.empty_cache()


def _leak_graph(B, S, H, w, b, lam):
    k = (B, S, H, w.data_ptr(), b.data_ptr(), lam)
    if k not in _LEAK_GRAPHS:
        _LEAK_GRAPHS[k] = _LeakGraph(B, S, H, w, b, lam)
    return _LEAK_GRAPHS[k]


class LeakGRUGraphFn(torch.autograd.Function):
    """LeakGRUFn's arithmetic, replayed as CUDA graphs in blocks of _LEAK_BLOCK frames (training speed)."""

    @staticmethod
    def forward(ctx, gi, h0, w, b, lam):
        B, T, H3 = gi.shape
        H = H3 // 3
        git = gi.transpose(0, 1).contiguous()
        RZ, Nn, GHN, HP, O = (gi.new_empty(T, B, k) for k in (2 * H, H, H, H, H))
        blocks = []
        h = h0
        for a in range(0, T, _LEAK_BLOCK):
            S = min(_LEAK_BLOCK, T - a)
            G = _leak_graph(B, S, H, w, b, lam)
            G.git.copy_(git[a:a + S])
            G.h.copy_(h)
            G.gf.replay()
            for big, st in ((RZ, G.RZ), (Nn, G.Nn), (GHN, G.GHN), (HP, G.HP), (O, G.O)):
                big[a:a + S].copy_(st)
            h = O[a + S - 1]
            blocks.append((a, S))
        ctx.save_for_backward(RZ, Nn, GHN, HP, w, b)
        ctx.lam, ctx.blocks = lam, blocks
        return O.transpose(0, 1), O[-1].clone()

    @staticmethod
    def backward(ctx, dO, dhT):
        RZ, Nn, GHN, HP, w, b = ctx.saved_tensors
        lam = ctx.lam
        T, B, H = Nn.shape
        dOt = dO.transpose(0, 1) if dO is not None else None
        dh = dhT.clone() if dhT is not None else Nn.new_zeros(B, H)
        DGH = Nn.new_empty(T, B, 3 * H)
        DPN = Nn.new_empty(T, B, H)
        for a, S in reversed(ctx.blocks):
            G = _leak_graph(B, S, H, w, b, lam)
            if dOt is not None:
                G.dO.copy_(dOt[a:a + S])
            else:
                G.dO.zero_()
            for big, st in ((RZ, G.RZ), (Nn, G.Nn), (GHN, G.GHN), (HP, G.HP)):
                st.copy_(big[a:a + S])
            G.dh_in.copy_(dh)
            G.gb.replay()
            DGH[a:a + S].copy_(G.DGH)
            DPN[a:a + S].copy_(G.DPN)
            dh = G.dh_out.clone()
        dw = lam * DGH.reshape(T * B, 3 * H).t().mm(HP.reshape(T * B, H))
        db = DGH.sum((0, 1))
        DGI = DGH.clone()
        DGI[:, :, 2 * H:] = DPN
        return DGI.transpose(0, 1), dh, dw, db, None


def ema_block(u, y0, beta: float):
    """y_t = beta y_{t-1} + (1 - beta) u_t along the last axis, y_{-1} = y0 (u [..., N], y0 [...]):
    one lower-triangular block of any N (streaming / ONNX export; float32)."""
    N = u.shape[-1]
    idx = torch.arange(N, device=u.device).to(u.dtype)
    d = idx[:, None] - idx[None, :]
    lb = math.log(beta)
    L = torch.where(d >= 0, (1.0 - beta) * torch.exp(torch.clamp(d, min=0.0) * lb), torch.zeros_like(d))
    return torch.matmul(u, L.t()) + y0[..., None] * torch.exp((idx + 1.0) * lb)


def ema_scan(u, y0, beta: float, block: int = 256):
    """ema_block's recursion over long T in float64 blocks of `block` frames (training / batch inference)."""
    T = u.shape[-1]
    K = max(1, min(block, T))
    idx = torch.arange(K, device=u.device, dtype=torch.float64)
    d = idx[:, None] - idx[None, :]
    lb = math.log(beta)
    L = torch.where(d >= 0, (1.0 - beta) * torch.exp(torch.clamp(d, min=0.0) * lb), torch.zeros_like(d))
    pw = torch.exp((idx + 1.0) * lb)
    u64, y = u.double(), y0.double()
    outs = []
    for a in range(0, T, K):
        ub = u64[..., a:a + K]
        k = ub.shape[-1]
        yb = torch.matmul(ub, L[:k, :k].t()) + y[..., None] * pw[:k]
        outs.append(yb)
        y = yb[..., -1]
    return torch.cat(outs, -1).to(u.dtype)


F1_DEFAULT = {"taus": [1.0, 6.0], "eps": 1e-3, "v0": 1.0, "fl0": 1.0}

# ---------------------------------------------------------------------------- round 5 (pre-registration 2026-10-12 §3.5)
# F1m: F1's tau = 6 s per-band statistics are replaced by a FLOOR m_t = min(x_t, m_{t-1} + rho) (rho = 0.05 dB/s in log-mel nat,
# m_0 = x_0) and w = the tau = 1 s EMA of (x - m)^2; the tau = 1 s mean / variance and F1's flux EMAs (tau 1 s, 6 s) stay.
# Constants fixed in Addendum R5-B part 2 before any round-5 model was scored.
F1M_DEFAULT = {"tau": 1.0, "rho_db_s": 0.05, "eps": 1e-3, "v0": 1.0, "w0": 1.0, "fl_taus": [1.0, 6.0], "fl0": 1.0}
# F5: harmonic structure of a 64 ms (1,024-point) periodic-Hann window per hop (cepstral peak prominence over quefrencies
# qlo..qhi samples = 2.5-13.3 ms, its quefrency), micro-variation EMAs (|d ln q| on periodic frames, |d ln E| in 50-1,000 Hz),
# DCT 1..12 of the log-mel, onset history (decaying maxima of the positive flux). cpp_thr / dq0 / de0: Addendum R5-B part 2.
F5_DEFAULT = {"win": 1024, "qlo": 40, "qhi": 213, "cpp_thr": None, "dq0": None, "de0": None, "taus_mv": [0.25, 1.0], "taus_on": [3.0, 30.0],
              "eps_dq": 1e-4, "eps_de": 1e-3, "eps_on": 1e-3, "n_dct": 12, "ebins": [4, 64], "p_floor": 1e-10}
BOUND_DEFAULT = {"B": 4.0, "hidden": 32, "aux_w": 0.5}
BIGF = 1.0e4      # "no floor yet" (the first frame's floor is x_0)


class Spec1024(nn.Module):
    """Power spectrum |DFT(w * frame)|^2, k = 0..N/2, of a periodic-Hann N-point window (N = 1024) per hop, frames ending where
    the mel frames end. Computed exactly, radix-4 polyphase: the stream is split into its 4 sample phases (frame starts are
    multiples of HOP = 200, so of 4), each phase gets the same un-windowed N/4-point DFT (one strided convolution, stride HOP / 4),
    the twiddle combination X[k] = sum_r W^(rk) D_r[k mod N/4], then the Hann window in frequency (0.5 X[k] - 0.25 X[k-1] -
    0.25 X[k+1]). Input xpad [B, S] with N - HOP + OFF zeros (or the carried context) in front; S = T * HOP + N - HOP."""

    R = 4

    def __init__(self, N=1024):
        super().__init__()
        R = self.R
        H = N // R
        n = np.arange(H)
        k = np.arange(H // 2 + 1)[:, None]
        ang = 2 * np.pi * k * n[None, :] / H
        basis = np.concatenate([np.cos(ang), -np.sin(ang)], 0).astype(np.float32)[:, None, :]      # [H + 2, 1, H]
        self.register_buffer("basis", torch.from_numpy(basis))
        ks = np.arange(-1, N // 2 + 2)                  # k = -1 .. N/2 + 1 (the window's neighbours of 0 .. N/2)
        km = ks % H
        src = np.where(km <= H // 2, km, H - km)
        sgn = np.where(km <= H // 2, 1.0, -1.0)         # conjugate symmetry of the N/R-point DFTs
        self.register_buffer("src", torch.from_numpy(src.astype(np.int64)))
        self.register_buffer("sgn", torch.from_numpy(sgn.astype(np.float32))[None, None, :, None])
        tw = np.exp(-2j * np.pi * np.arange(R)[:, None] * ks[None, :] / N)                          # [R, K]
        self.register_buffer("twr", torch.from_numpy(tw.real.astype(np.float32))[None, :, :, None])
        self.register_buffer("twi", torch.from_numpy(tw.imag.astype(np.float32))[None, :, :, None])
        self.N, self.H, self.nb = N, H, H // 2 + 1

    def forward(self, xpad):
        R, nb = self.R, self.nb
        B = xpad.shape[0]
        ph = xpad.reshape(B, -1, R).transpose(1, 2).reshape(B * R, 1, -1)                 # [B R, 1, S / R]
        D = F.conv1d(ph, self.basis, stride=HOP // R)                                     # [B R, H + 2, T]
        D = D.reshape(B, R, 2 * nb, -1)
        Dr = D[:, :, :nb].index_select(2, self.src)                                       # [B, R, K, T]
        Di = D[:, :, nb:].index_select(2, self.src) * self.sgn
        Xr = (self.twr * Dr - self.twi * Di).sum(1)                                       # [B, K, T], k = -1 .. N/2 + 1
        Xi = (self.twr * Di + self.twi * Dr).sum(1)
        Wr = 0.5 * Xr[:, 1:-1] - 0.25 * Xr[:, :-2] - 0.25 * Xr[:, 2:]
        Wi = 0.5 * Xi[:, 1:-1] - 0.25 * Xi[:, :-2] - 0.25 * Xi[:, 2:]
        return Wr * Wr + Wi * Wi                                                         # [B, N/2 + 1, T]


def cep_matrix(N, qlo, qhi):
    """Real cepstrum of a dB power spectrum (k = 0..N/2) at quefrencies qlo..qhi (samples): c[q] = sum_k a_k L[k] cos(2 pi k q / N) / N."""
    k = np.arange(N // 2 + 1)[:, None]
    q = np.arange(qlo, qhi + 1)[None, :]
    a = np.where((k == 0) | (k == N // 2), 1.0, 2.0)
    return (a * np.cos(2 * np.pi * k * q / N) / N).astype(np.float32)                 # [N/2 + 1, Q]


def dct_matrix(M, n):
    """Orthonormal DCT-II coefficients 1..n of M bands: [M, n]."""
    b = np.arange(M)[:, None]
    j = np.arange(1, n + 1)[None, :]
    return (np.sqrt(2.0 / M) * np.cos(np.pi * j * (b + 0.5) / M)).astype(np.float32)


def floor_track(x, m_prev, rho):
    """m_t = min(x_t, m_{t-1} + rho) over the last axis of x [..., T] from m_prev [...] (closed form: m_t = min(m_prev + (t + 1) rho,
    min_{s <= t} x_s + (t - s) rho)). Tracing / short chunks: a lower-triangular min (ONNX has no CumMin); else cummin in float64."""
    T = x.shape[-1]
    if torch.jit.is_tracing() or T <= 64:
        idx = torch.arange(T, device=x.device).to(x.dtype)
        d = idx[:, None] - idx[None, :]                                        # t - s
        D = torch.where(d >= 0, d * rho, torch.full_like(d, BIGF))
        m = (x[..., None, :] + D).amin(-1)
        return torch.minimum(m, m_prev[..., None] + (idx + 1.0) * rho)
    s = torch.arange(T, device=x.device, dtype=torch.float64)
    cm = torch.cummin(x.double() - s * rho, -1).values + s * rho
    return torch.minimum(cm, m_prev.double()[..., None] + (s + 1.0) * rho).to(x.dtype)


def decay_max(u, o_prev, beta):
    """o_t = max(u_t, beta * o_{t-1}) over the last axis (u >= 0) from o_prev: o_t = max(o_prev beta^(t+1), max_{s<=t} u_s beta^(t-s)).
    Tracing / short chunks: a lower-triangular max; else a log-domain cummax in float64."""
    T = u.shape[-1]
    lb = math.log(beta)
    if torch.jit.is_tracing() or T <= 64:
        idx = torch.arange(T, device=u.device).to(u.dtype)
        d = idx[:, None] - idx[None, :]
        D = torch.where(d >= 0, torch.exp(torch.clamp(d, min=0.0) * lb), torch.zeros_like(d))
        o = (u[..., None, :] * D).amax(-1)
        return torch.maximum(o, o_prev[..., None] * torch.exp((idx + 1.0) * lb))
    s = torch.arange(T, device=u.device, dtype=torch.float64)
    lu = torch.log(u.double().clamp(min=0.0) + 1e-300)
    lo = torch.cummax(lu - s * lb, -1).values + s * lb
    o = torch.exp(lo)
    return torch.maximum(o, o_prev.double()[..., None] * torch.exp((s + 1.0) * lb)).to(u.dtype)


def ema_any(u, y0, beta):
    """ema_block (tracing / short) or ema_scan (float64 blocks)."""
    return ema_block(u, y0, beta) if (torch.jit.is_tracing() or u.shape[-1] <= 64) else ema_scan(u, y0, beta)


class VoiceNet(nn.Module):
    def __init__(self, n_mels=64, convs=((16, 3), (32, 3), (32, 1)), gru=64, gru_layers=1, fc=64, fmin=50.0, fmax=7800.0, win=WIN, leak_tau=0.0, f1=None,
                 f1m=None, f5=None, bound=None):
        super().__init__()
        self.cfg = dict(n_mels=n_mels, convs=[list(c) for c in convs], gru=gru, gru_layers=gru_layers, fc=fc, fmin=fmin, fmax=fmax, win=win)
        if leak_tau:
            assert gru_layers == 1
            self.cfg["leak_tau"] = float(leak_tau)
        self.has_f1 = bool(f1)
        if self.has_f1:                  # round 4 F1 (constants fixed in cfg)
            f1 = dict(F1_DEFAULT, **(f1 if isinstance(f1, dict) else {}))
            assert not leak_tau
            self.cfg["f1"] = f1
            self.f1c = f1
            self.betas = [math.exp(-HOP / SR / float(t)) for t in f1["taus"]]
        # round 5 (pre-registration 2026-10-12 §3.5; Addendum R5-B part 2): F1m (floor reference) replaces F1, F5 (voice-likeness
        # features to the GRU), Bound (local head caps the memory's veto). Without "f1m" in cfg every path below is round 3's / 4's.
        on = lambda v: v is not None and v is not False  # noqa: E731  ({} = the defaults)
        self.r5 = on(f1m)
        self.has_f5 = on(f5)
        self.has_bound = on(bound)
        assert not (self.has_f5 or self.has_bound) or self.r5, "F5 / Bound need F1m"
        assert not self.has_bound or self.has_f5, "Bound reads F5"
        win5 = win
        if self.r5:
            assert not leak_tau and not f1
            self.f1mc = dict(F1M_DEFAULT, **(f1m if isinstance(f1m, dict) else {}))
            self.cfg["f1m"] = self.f1mc
            self.beta_mu = math.exp(-HOP / SR / float(self.f1mc["tau"]))
            self.fl_betas = [math.exp(-HOP / SR / float(t)) for t in self.f1mc["fl_taus"]]
            self.rho = float(self.f1mc["rho_db_s"]) * math.log(10.0) / 10.0 * HOP / SR   # nat (log-mel units) per frame
            self.n_aux = len(self.fl_betas)
            if self.has_f5:
                self.f5c = dict(F5_DEFAULT, **(f5 if isinstance(f5, dict) else {}))
                self.cfg["f5"] = self.f5c
                win5 = int(self.f5c["win"])
                self.spec = Spec1024(win5)
                self.register_buffer("cepm", torch.from_numpy(cep_matrix(win5, int(self.f5c["qlo"]), int(self.f5c["qhi"]))))
                self.register_buffer("dctm", torch.from_numpy(dct_matrix(n_mels, int(self.f5c["n_dct"]))))
                nq = int(self.f5c["qhi"]) - int(self.f5c["qlo"]) + 1
                self.register_buffer("qc", torch.from_numpy((np.arange(nq) - (nq - 1) / 2.0).astype(np.float32))[None, :, None])
                self.mv_betas = [math.exp(-HOP / SR / float(t)) for t in self.f5c["taus_mv"]]
                self.on_betas = [math.exp(-HOP / SR / float(t)) for t in self.f5c["taus_on"]]
                self.n_f5 = 2 + 2 * len(self.mv_betas) + int(self.f5c["n_dct"]) + len(self.on_betas)
                self.n_aux += self.n_f5
            if self.has_bound:
                self.bc = dict(BOUND_DEFAULT, **(bound if isinstance(bound, dict) else {}))
                self.cfg["bound"] = self.bc
        self.lam = math.exp(-HOP / SR / float(leak_tau)) if leak_tau else 1.0
        self.unrolled = False    # True: run the leak recurrence frame by frame through nn.GRU (export / streaming)
        self.win = win
        self.win5 = win5                 # round 5 F5: the 64 ms window (frames end where the mel frames end)
        self.mel_off = win5 - win        # the mel frame's start inside the longer window
        self.pad = win5 - HOP + OFF      # zeros in front of the stream
        self.ctx = win5 - HOP            # streaming audio context
        self.front = Frontend(n_mels, fmin, fmax, win)
        if self.has_f1 or self.r5:
            self.inorm5 = nn.BatchNorm1d(5 * n_mels)
        if self.has_f1:
            self.flnorm = nn.BatchNorm1d(2)
        elif self.r5:
            self.auxnorm = nn.BatchNorm1d(self.n_aux)
        else:
            self.inorm = nn.BatchNorm1d(n_mels)
        layers, cin, f = [], (5 if (self.has_f1 or self.r5) else 1), n_mels
        for c, kt in convs:
            layers.append(CausalConv(cin, c, kt))
            cin, f = c, (f + 1) // 2
        self.convs = nn.ModuleList(layers)
        self.flat = cin * f
        self.fc = nn.Linear(self.flat, fc)
        n_extra = 2 if self.has_f1 else (self.n_aux if self.r5 else 0)
        self.gru = nn.GRU(fc + n_extra, gru, num_layers=gru_layers, batch_first=True)
        self.head = nn.Linear(gru, 1)
        if self.has_bound:
            self.loc1 = nn.Linear(fc + self.n_f5, int(self.bc["hidden"]))
            self.loc2 = nn.Linear(int(self.bc["hidden"]), 1)

    @property
    def rf(self):
        return 1 + sum(kt - 1 for _, kt in self.cfg["convs"])

    @property
    def frame_ms(self):
        return max(self.win / 16.0 + (self.rf - 1) * HOP / 16.0, self.win5 / 16.0)

    def recur(self, z, h=None):
        """GRU over z [B, T, fc] from state h [1, B, H] (None = zeros) -> outputs [B, T, H], last state [1, B, H]."""
        if self.lam == 1.0:
            return self.gru(z, h)
        if h is None:
            h = z.new_zeros(1, z.shape[0], self.cfg["gru"])
        if self.unrolled:
            outs = []
            for t in range(z.shape[1]):
                o, h = self.gru(z[:, t:t + 1], h * self.lam)
                outs.append(o)
            return torch.cat(outs, 1), h
        gi = F.linear(z, self.gru.weight_ih_l0, self.gru.bias_ih_l0)
        if gi.is_cuda:          # training and GPU inference: the block-graphed recurrence (same arithmetic)
            o, hl = LeakGRUGraphFn.apply(gi.contiguous(), h[0].contiguous(), self.gru.weight_hh_l0, self.gru.bias_hh_l0, self.lam)
        else:
            o, hl = gru_leak_loop(gi, h[0], self.gru.weight_hh_l0, self.gru.bias_hh_l0, self.lam)
        return o, hl[None]

    def f1_prep(self, feats, st=None):
        """Round 4 F1. feats [B, T, M] log-mel; st None (stream start) or (mu [B, 2, M], v [B, 2, M],
        xprev [B, M], fl [B, 2], init [B, 1]; init 0 = stream start, so all-zero state = stream start).
        Returns raw (pre-normalisation) inputs X [B, 5, M, T], flux EMAs FL [B, 2, T] and the new state."""
        B, T, M = feats.shape
        c = self.f1c
        xt = feats.transpose(1, 2)                                       # [B, M, T]
        x0 = xt[:, :, 0]                                                 # [B, M]
        if st is None:
            mu_p = x0[:, None, :].expand(B, 2, M)
            v_p = torch.full((B, 2, M), float(c["v0"]), device=feats.device, dtype=feats.dtype)
            xp_p = x0
            fl_p = torch.full((B, 2), float(c["fl0"]), device=feats.device, dtype=feats.dtype)
        else:
            mu_s, v_s, xp_s, fl_s, g = st
            g3 = g[:, :, None]
            mu_p = g3 * mu_s + (1.0 - g3) * x0[:, None, :]
            v_p = g3 * v_s + (1.0 - g3) * float(c["v0"])
            xp_p = g * xp_s + (1.0 - g) * x0
            fl_p = g * fl_s + (1.0 - g) * float(c["fl0"])
        scan = ema_block if (torch.jit.is_tracing() or T <= 64) else ema_scan
        mus, vs, fls = [], [], []
        prev = torch.cat([xp_p[:, :, None], xt[:, :, :-1]], 2)
        flux = (xt - prev).abs().mean(1)                                 # [B, T]
        for k, beta in enumerate(self.betas):
            mu = scan(xt, mu_p[:, k], beta)
            v = scan((xt - mu) ** 2, v_p[:, k], beta)
            mus.append(mu)
            vs.append(v)
            fls.append(scan(flux, fl_p[:, k], beta))
        eps = float(c["eps"])
        X = torch.stack([xt, xt - mus[0], xt - mus[1], torch.log(vs[0] + eps), torch.log(vs[1] + eps)], 1)   # [B, 5, M, T]
        FL = torch.stack(fls, 1)                                         # [B, 2, T]
        new = (torch.stack([m[:, :, -1] for m in mus], 1), torch.stack([v[:, :, -1] for v in vs], 1), xt[:, :, -1],
               FL[:, :, -1], torch.ones(B, 1, device=feats.device, dtype=feats.dtype))
        return X, FL, new

    def body_x(self, X, FL, conv_states=None, h=None, skip=0):
        """Round 4 F1: raw inputs X [B, 5, M, T], FL [B, 2, T] -> logits [B, T - skip], new conv states, new h."""
        B, C5, M, T = X.shape
        x = self.inorm5(X.reshape(B, C5 * M, T)).reshape(B, C5, M, T).transpose(2, 3)   # [B, 5, T, M]
        fl = self.flnorm(FL).transpose(1, 2)                             # [B, T, 2]
        news = []
        for i, c in enumerate(self.convs):
            x, s = c(x, None if conv_states is None else conv_states[i])
            news.append(s)
        if skip:
            x = x[:, :, skip:]
            fl = fl[:, skip:]
        B, C, T, Fq = x.shape
        z = F.relu(self.fc(x.permute(0, 2, 1, 3).reshape(B, T, C * Fq)))
        o, h = self.recur(torch.cat([z, fl], 2), h)
        return self.head(o)[..., 0], news, h

    # ------------------------------------------------------------------------- round 5
    def prep5(self, xpad, st=None):
        """Round 5 inputs. xpad [B, S]: the stream with self.pad zeros (or the carried ctx) in front; st None (stream start) or
        (mv [B, 4, M] = mu_1, v_1, floor m, w; xprev [B, M]; fl [B, n_fl]; init [B, 1]; [f5s [B, 9]]) - all zero = stream start.
        Returns X [B, 5, M, T] (x, x - mu_1, log(v_1 + eps), x - m, log(w + eps)), AUX [B, n_aux, T] (flux EMAs, then F5) raw
        (before normalisation), and the new state."""
        c = self.f1mc
        feats = self.front(xpad[:, self.mel_off:])                       # [B, T, M]
        B, T, M = feats.shape
        xt = feats.transpose(1, 2)                                       # [B, M, T]
        x0 = xt[:, :, 0]
        dev, dt = feats.device, feats.dtype
        if st is None:
            g = torch.zeros(B, 1, device=dev, dtype=dt)
            mv_s = torch.zeros(B, 4, M, device=dev, dtype=dt)
            xp_s = torch.zeros(B, M, device=dev, dtype=dt)
            fl_s = torch.zeros(B, len(self.fl_betas), device=dev, dtype=dt)
            f5_s = torch.zeros(B, 9, device=dev, dtype=dt) if self.has_f5 else None
        else:
            mv_s, xp_s, fl_s, g = st[:4]
            f5_s = st[4] if self.has_f5 else None
        mu_p = g * mv_s[:, 0] + (1.0 - g) * x0
        v_p = g * mv_s[:, 1] + (1.0 - g) * float(c["v0"])
        m_p = g * mv_s[:, 2] + (1.0 - g) * BIGF
        w_p = g * mv_s[:, 3] + (1.0 - g) * float(c["w0"])
        xp_p = g * xp_s + (1.0 - g) * x0
        fl_p = g * fl_s + (1.0 - g) * float(c["fl0"])
        mu = ema_any(xt, mu_p, self.beta_mu)
        v = ema_any((xt - mu) ** 2, v_p, self.beta_mu)
        m = floor_track(xt, m_p, self.rho)
        w = ema_any((xt - m) ** 2, w_p, self.beta_mu)
        eps = float(c["eps"])
        X = torch.stack([xt, xt - mu, torch.log(v + eps), xt - m, torch.log(w + eps)], 1)          # [B, 5, M, T]
        prev = torch.cat([xp_p[:, :, None], xt[:, :, :-1]], 2)
        d = xt - prev
        flux = d.abs().mean(1)                                                                  # [B, T]
        FL = torch.stack([ema_any(flux, fl_p[:, k], b) for k, b in enumerate(self.fl_betas)], 1)   # [B, n_fl, T]
        aux = [FL]
        new = [torch.stack([mu[:, :, -1], v[:, :, -1], m[:, :, -1], w[:, :, -1]], 1), xt[:, :, -1], FL[:, :, -1],
               torch.ones(B, 1, device=dev, dtype=dt)]
        if self.has_f5:
            F5, f5n = self.f5_feats(xpad, xt, d, f5_s, g)
            aux.append(F5)
            new.append(f5n)
        return X, torch.cat(aux, 1), tuple(new)

    def f5_raw(self, xpad):
        """Per frame: cepstral peak prominence (dB) over qlo..qhi, ln of the peak quefrency (s, parabolic), ln energy in 50-1,000 Hz."""
        c = self.f5c
        P = self.spec(xpad)                                                  # [B, 513, T]
        B, _, T = P.shape
        L = 10.0 * torch.log10(P + float(c["p_floor"]))
        cep = torch.matmul(L.transpose(1, 2), self.cepm).transpose(1, 2)   # [B, Q, T]
        Q = int(c["qhi"]) - int(c["qlo"]) + 1                                # static (export)
        qc_np = np.arange(Q, dtype=np.float64) - (Q - 1) / 2.0
        qc = self.qc
        slope = (cep * qc).sum(1, keepdim=True) * float(1.0 / (qc_np ** 2).sum())
        r = cep - (cep.mean(1, keepdim=True) + slope * qc)                   # above the regression line over the range
        i = torch.argmax(r, 1, keepdim=True)                                 # [B, 1, T]
        r0 = torch.gather(r, 1, i)
        rm = torch.gather(r, 1, torch.clamp(i - 1, min=0))
        rp = torch.gather(r, 1, torch.clamp(i + 1, max=Q - 1))
        den = rm - 2.0 * r0 + rp
        ok = (i > 0) & (i < Q - 1) & (den < -1e-9)
        dl = torch.where(ok, 0.5 * (rm - rp) / torch.where(ok, den, -torch.ones_like(den)), torch.zeros_like(den))
        dl = torch.clamp(dl, -0.5, 0.5)
        cpp = r0[:, 0]                                                       # [B, T] dB
        lnq = torch.log((float(c["qlo"]) + i[:, 0].to(P.dtype) + dl[:, 0]) / float(SR))
        e0, e1 = c["ebins"]
        E = torch.log(P[:, e0:e1 + 1].sum(1) + 1e-9)                         # [B, T]
        return cpp, lnq, E

    def f5_feats(self, xpad, xt, d, f5_s, g):
        """F5 raw features [B, n_f5, T] and the new F5 state [B, 9] = (ln q, periodic, E, dq EMAs (2), dE EMAs (2), onset maxima (2))."""
        c = self.f5c
        cpp, lnq, E = self.f5_raw(xpad)
        B, T = cpp.shape
        P = cpp
        per = (cpp >= float(c["cpp_thr"])).to(P.dtype)
        if f5_s is None:
            f5_s = torch.zeros(B, 9, device=P.device, dtype=P.dtype)
        g1 = g[:, 0]
        lq_p = g1 * f5_s[:, 0] + (1.0 - g1) * lnq[:, 0]
        pe_p = g1 * f5_s[:, 1]
        E_p = g1 * f5_s[:, 2] + (1.0 - g1) * E[:, 0]
        lq_prev = torch.cat([lq_p[:, None], lnq[:, :-1]], 1)
        pe_prev = torch.cat([pe_p[:, None], per[:, :-1]], 1)
        E_prev = torch.cat([E_p[:, None], E[:, :-1]], 1)
        dq = (lnq - lq_prev).abs() * per * pe_prev
        dE = (E - E_prev).abs()
        outs, st_out = [cpp, lnq], [lnq[:, -1], per[:, -1], E[:, -1]]
        dqe, dee = [], []
        for k, b in enumerate(self.mv_betas):
            dqe.append(ema_any(dq, g1 * f5_s[:, 3 + k] + (1.0 - g1) * float(c["dq0"]), b))
        for k, b in enumerate(self.mv_betas):
            dee.append(ema_any(dE, g1 * f5_s[:, 5 + k] + (1.0 - g1) * float(c["de0"]), b))
        outs += [torch.log(z + float(c["eps_dq"])) for z in dqe] + [torch.log(z + float(c["eps_de"])) for z in dee]
        st_out += [z[:, -1] for z in dqe] + [z[:, -1] for z in dee]
        dct = torch.matmul(xt.transpose(1, 2), self.dctm).transpose(1, 2)   # [B, n_dct, T]
        fp = torch.relu(d).mean(1)                                           # positive spectral flux [B, T]
        ons = []
        for k, b in enumerate(self.on_betas):
            o = decay_max(fp, g1 * f5_s[:, 7 + k], b)
            ons.append(o)
            st_out.append(o[:, -1])
        F5 = torch.cat([torch.stack(outs, 1), dct, torch.stack([torch.log(o + float(c["eps_on"])) for o in ons], 1)], 1)
        return F5, torch.stack(st_out, 1)

    def body5(self, X, AUX, conv_states=None, h=None, skip=0):
        """Round 5: raw X [B, 5, M, T], AUX [B, n_aux, T] -> logits [B, T - skip], new conv states, new h, local logits (Bound) or None."""
        B, C5, M, T = X.shape
        x = self.inorm5(X.reshape(B, C5 * M, T)).reshape(B, C5, M, T).transpose(2, 3)   # [B, 5, T, M]
        au = self.auxnorm(AUX).transpose(1, 2)                           # [B, T, n_aux]
        news = []
        for i, cv in enumerate(self.convs):
            x, s = cv(x, None if conv_states is None else conv_states[i])
            news.append(s)
        if skip:
            x = x[:, :, skip:]
            au = au[:, skip:]
        B, C, T, Fq = x.shape
        z = F.relu(self.fc(x.permute(0, 2, 1, 3).reshape(B, T, C * Fq)))
        o, h = self.recur(torch.cat([z, au], 2), h)
        lg = self.head(o)[..., 0]
        lloc = None
        if self.has_bound:
            lloc = self.loc2(F.relu(self.loc1(torch.cat([z, au[..., self.n_aux - self.n_f5:]], 2))))[..., 0]
            lg = torch.maximum(lg, lloc - float(self.bc["B"]))
        return lg, news, h, lloc

    def body(self, feats, conv_states=None, h=None, skip=0, f1_state=None):
        """feats [B, T, M] log-mel -> logits [B, T - skip], new conv states, new h (F1 nets: + the new F1 state)."""
        if self.has_f1:
            X, FL, st = self.f1_prep(feats, f1_state)
            lg, news, h = self.body_x(X, FL, conv_states, h, skip)
            return lg, news, h, st
        x = self.inorm(feats.transpose(1, 2)).transpose(1, 2)[:, None]   # [B, 1, T, M]
        news = []
        for i, c in enumerate(self.convs):
            x, s = c(x, None if conv_states is None else conv_states[i])
            news.append(s)
        if skip:
            x = x[:, :, skip:]
        B, C, T, Fq = x.shape
        z = F.relu(self.fc(x.permute(0, 2, 1, 3).reshape(B, T, C * Fq)))
        o, h = self.recur(z, h)
        return self.head(o)[..., 0], news, h

    def forward(self, xpad):
        if self.r5:
            X, AUX, _ = self.prep5(xpad)
            return self.body5(X, AUX)[0]
        return self.body(self.front(xpad))[0]

    def n_params(self, trainable=True):
        return sum(p.numel() for p in self.parameters() if p.requires_grad or not trainable)


class Streaming(nn.Module):
    """ONNX streaming form: (chunk [1, N*HOP], ctx [1, WIN-HOP], conv states..., h) -> (p [1, N], ctx', states..., h')."""

    def __init__(self, net: VoiceNet):
        super().__init__()
        self.net = net.eval()
        self.ks = [c.kt for c in net.convs]
        self.fixed_n = 2 if net.lam != 1.0 else None   # leak models export a fixed chunk of 2 frames (one 25 ms capture chunk)

    def forward(self, chunk, ctx, s0, s1, s2, h, *f1):
        """F1 nets (round 4) take and return 5 more states after h: mu, v, xprev, fl, init.
        Round 5 nets: mv, xprev, fl, init (+ f5s with F5)."""
        x = torch.cat([ctx, chunk], 1)
        states = []
        it = iter([s0, s1, s2])
        for k in self.ks:
            states.append(next(it) if k > 1 else None)
        if self.net.r5:
            X, AUX, f1n = self.net.prep5(x, tuple(f1))
            logits, news, h2, _ = self.net.body5(X, AUX, states, h)
            outs = [n if n is not None else s for n, s in zip(news, [s0, s1, s2])]
            return (torch.sigmoid(logits), x[:, -self.net.ctx:], outs[0], outs[1], outs[2], h2) + tuple(f1n)
        feats = self.net.front(x)
        if self.net.has_f1:
            logits, news, h2, f1n = self.net.body(feats, states, h, f1_state=tuple(f1))
        else:
            logits, news, h2 = self.net.body(feats, states, h)
            f1n = ()
        outs = [n if n is not None else s for n, s in zip(news, [s0, s1, s2])]
        return (torch.sigmoid(logits), x[:, -self.net.ctx:], outs[0], outs[1], outs[2], h2) + tuple(f1n)

    def init_state(self, B=1):
        net = self.net
        st = []
        f = net.cfg["n_mels"]
        cin = 5 if (net.has_f1 or net.r5) else 1
        for (c, kt) in net.cfg["convs"]:
            st.append(torch.zeros(B, cin, max(kt - 1, 1), f))
            cin, f = c, (f + 1) // 2
        while len(st) < 3:
            st.append(torch.zeros(B, 1, 1, 1))
        out = [torch.zeros(B, net.ctx)] + st + [torch.zeros(net.cfg["gru_layers"], B, net.cfg["gru"])]
        if net.has_f1:      # round 4: mu, v, xprev, fl, init (all zero = stream start)
            M_ = net.cfg["n_mels"]
            out += [torch.zeros(B, 2, M_), torch.zeros(B, 2, M_), torch.zeros(B, M_), torch.zeros(B, 2), torch.zeros(B, 1)]
        if net.r5:          # round 5: mv (mu_1, v_1, floor, w), xprev, fl, init (+ f5s) (all zero = stream start)
            M_ = net.cfg["n_mels"]
            out += [torch.zeros(B, 4, M_), torch.zeros(B, M_), torch.zeros(B, len(net.fl_betas)), torch.zeros(B, 1)]
            if net.has_f5:
                out.append(torch.zeros(B, 9))
        return out

    def extra_names(self):
        if self.net.has_f1:
            return ["mu", "v", "xprev", "fl", "init"]
        if self.net.r5:
            return ["mv", "xprev", "fl", "init"] + (["f5s"] if self.net.has_f5 else [])
        return []


def build(cfg):
    return VoiceNet(**cfg)


def load_ckpt(path, map_location="cpu"):
    ck = torch.load(path, map_location=map_location, weights_only=False)
    net = build(ck["cfg"])
    net.load_state_dict(ck["model"])
    return net.eval(), ck


def run_stream(net, x16, device="cpu"):
    """Batch (whole-stream) inference: probabilities of every complete frame of a 16 kHz stream."""
    with torch.no_grad():
        xp = torch.from_numpy(np.concatenate([np.zeros(net.pad, np.float32), np.asarray(x16, np.float32)]))[None].to(device)
        n = (len(x16) + OFF) // HOP
        if n <= 0:
            return np.zeros(0, np.float32)
        xp = xp[:, :net.pad + n * HOP - OFF]
        return torch.sigmoid(net(xp))[0, :n].float().cpu().numpy()
