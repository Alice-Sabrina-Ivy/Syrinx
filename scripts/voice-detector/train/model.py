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
import math

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


class VoiceNet(nn.Module):
    def __init__(self, n_mels=64, convs=((16, 3), (32, 3), (32, 1)), gru=64, gru_layers=1, fc=64, fmin=50.0, fmax=7800.0, win=WIN):
        super().__init__()
        self.cfg = dict(n_mels=n_mels, convs=[list(c) for c in convs], gru=gru, gru_layers=gru_layers, fc=fc, fmin=fmin, fmax=fmax, win=win)
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

    def body(self, feats, conv_states=None, h=None):
        """feats [B, T, M] log-mel -> logits [B, T], new conv states, new h."""
        x = self.inorm(feats.transpose(1, 2)).transpose(1, 2)[:, None]   # [B, 1, T, M]
        news = []
        for i, c in enumerate(self.convs):
            x, s = c(x, None if conv_states is None else conv_states[i])
            news.append(s)
        B, C, T, Fq = x.shape
        z = F.relu(self.fc(x.permute(0, 2, 1, 3).reshape(B, T, C * Fq)))
        o, h = self.gru(z, h)
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

    def init_state(self):
        net = self.net
        st = []
        f = net.cfg["n_mels"]
        cin = 1
        for (c, kt) in net.cfg["convs"]:
            st.append(torch.zeros(1, cin, max(kt - 1, 1), f))
            cin, f = c, (f + 1) // 2
        while len(st) < 3:
            st.append(torch.zeros(1, 1, 1, 1))
        return [torch.zeros(1, net.ctx)] + st + [torch.zeros(net.cfg["gru_layers"], 1, net.cfg["gru"])]


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
