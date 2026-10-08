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


class VoiceNet(nn.Module):
    def __init__(self, n_mels=64, convs=((16, 3), (32, 3), (32, 1)), gru=64, gru_layers=1, fc=64, fmin=50.0, fmax=7800.0, win=WIN, leak_tau=0.0):
        super().__init__()
        self.cfg = dict(n_mels=n_mels, convs=[list(c) for c in convs], gru=gru, gru_layers=gru_layers, fc=fc, fmin=fmin, fmax=fmax, win=win)
        if leak_tau:
            assert gru_layers == 1
            self.cfg["leak_tau"] = float(leak_tau)
        self.lam = math.exp(-HOP / SR / float(leak_tau)) if leak_tau else 1.0
        self.unrolled = False    # True: run the leak recurrence frame by frame through nn.GRU (export / streaming)
        self.win = win
        self.pad = win - HOP + OFF       # zeros in front of the stream
        self.ctx = win - HOP             # streaming audio context
        self.front = Frontend(n_mels, fmin, fmax, win)
        self.inorm = nn.BatchNorm1d(n_mels)
        layers, cin, f = [], 1, n_mels
        for c, kt in convs:
            layers.append(CausalConv(cin, c, kt))
            cin, f = c, (f + 1) // 2
        self.convs = nn.ModuleList(layers)
        self.flat = cin * f
        self.fc = nn.Linear(self.flat, fc)
        self.gru = nn.GRU(fc, gru, num_layers=gru_layers, batch_first=True)
        self.head = nn.Linear(gru, 1)

    @property
    def rf(self):
        return 1 + sum(kt - 1 for _, kt in self.cfg["convs"])

    @property
    def frame_ms(self):
        return self.win / 16.0 + (self.rf - 1) * HOP / 16.0

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

    def body(self, feats, conv_states=None, h=None, skip=0):
        """feats [B, T, M] log-mel -> logits [B, T - skip], new conv states, new h."""
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
        logits, _, _ = self.body(self.front(xpad))
        return logits

    def n_params(self, trainable=True):
        return sum(p.numel() for p in self.parameters() if p.requires_grad or not trainable)


class Streaming(nn.Module):
    """ONNX streaming form: (chunk [1, N*HOP], ctx [1, WIN-HOP], conv states..., h) -> (p [1, N], ctx', states..., h')."""

    def __init__(self, net: VoiceNet):
        super().__init__()
        self.net = net.eval()
        self.ks = [c.kt for c in net.convs]
        self.fixed_n = 2 if net.lam != 1.0 else None   # leak models export a fixed chunk of 2 frames (one 25 ms capture chunk)

    def forward(self, chunk, ctx, s0, s1, s2, h):
        x = torch.cat([ctx, chunk], 1)
        feats = self.net.front(x)
        states = []
        it = iter([s0, s1, s2])
        for k in self.ks:
            states.append(next(it) if k > 1 else None)
        logits, news, h2 = self.net.body(feats, states, h)
        outs = [n if n is not None else s for n, s in zip(news, [s0, s1, s2])]
        return torch.sigmoid(logits), x[:, -self.net.ctx:], outs[0], outs[1], outs[2], h2

    def init_state(self, B=1):
        net = self.net
        st = []
        f = net.cfg["n_mels"]
        cin = 1
        for (c, kt) in net.cfg["convs"]:
            st.append(torch.zeros(B, cin, max(kt - 1, 1), f))
            cin, f = c, (f + 1) // 2
        while len(st) < 3:
            st.append(torch.zeros(B, 1, 1, 1))
        return [torch.zeros(B, net.ctx)] + st + [torch.zeros(net.cfg["gru_layers"], B, net.cfg["gru"])]


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
