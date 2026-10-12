# parity_r5.py — custom voice detector, round 5 (pre-registration
# measurements/voice-detector-round5-preregistration-2026-10-12.md §3.5, §3.7;
# Addendum R5-B part 2): parity checks of the round-5 features (F1m, F5, Bound)
# on RANDOM-WEIGHT networks and generated / training audio only (no validation,
# H, sealed or private data):
#   1. Spec1024 (radix-2 dilated DFT + Hann in frequency) vs numpy rfft of the
#      periodic-Hann 1,024-sample frames
#   2. floor_track / decay_max / ema: the ONNX (lower-triangular) forms vs the
#      batch (float64 cummin / cummax / block scan) forms vs a naive per-frame loop
#   3. prep5: whole stream vs chunks with the state carried (chunks 1, 2, 37, 700)
#   4. probabilities: torch streaming (chunks 1, 2, 8, 700) vs the batch model,
#      and (--onnx) the exported streaming ONNX (dynamic chunk 1, 2, 8) vs batch
# Run for each round-5 architecture (F1m; F1m + F5; F1m + F5 + Bound).
#
#   <venv>/python parity_r5.py [--onnx] [--json=OUT]
import json
import math
import os
import tempfile

import numpy as np
import torch

import model as M
from tcommon import args

A = args()
torch.manual_seed(0)
RNG = np.random.default_rng(20261012)
F5C = json.load(open(os.path.join(os.path.dirname(os.path.abspath(__file__)), "f5const_r5.json"), encoding="utf8"))["f5"]
NETS = {
    "f1m": {"convs": [[24, 3], [48, 3], [48, 1]], "gru": 96, "f1m": {}},
    "f1m+f5": {"convs": [[24, 3], [48, 3], [48, 1]], "gru": 96, "f1m": {}, "f5": F5C},
    "f1m+f5+bound": {"convs": [[24, 3], [48, 3], [48, 1]], "gru": 96, "f1m": {}, "f5": F5C, "bound": {}},
}
res = {}


def signal(sec, seed):
    """A test stream: a hummed harmonic stack with jitter, a pause, a steady machine-like stack and noise (generated)."""
    g = np.random.default_rng(seed)
    n = int(sec * 16000)
    t = np.arange(n) / 16000
    f0 = 110 * (1 + 0.01 * np.sin(2 * np.pi * 0.7 * t)) * (1 + 0.003 * g.standard_normal(n).cumsum() / np.sqrt(n))
    ph = 2 * np.pi * np.cumsum(f0) / 16000
    v = sum(np.sin(k * ph) / k for k in range(1, 15)) * (t % 6 < 4)
    m = 0.3 * sum(np.sin(2 * np.pi * 60 * k * t) / k for k in (1, 2, 3, 5))
    return (0.05 * v + 0.02 * m + 0.003 * g.standard_normal(n)).astype(np.float32)


def worst(a, b):
    return float(np.max(np.abs(np.asarray(a, np.float64) - np.asarray(b, np.float64))))


# 1. spectrum
sp = M.Spec1024(1024)
x = RNG.standard_normal(16000).astype(np.float32)
xp = np.concatenate([np.zeros(1024 - 200 + 4, np.float32), x])
T = (len(x) + 4) // 200
xpt = torch.from_numpy(xp[: 1024 - 200 + 4 + T * 200 - 4])[None]
P = sp(xpt)[0].numpy()
w = 0.5 - 0.5 * np.cos(2 * np.pi * np.arange(1024) / 1024)
ref = np.stack([np.abs(np.fft.rfft(xp[t * 200:t * 200 + 1024] * w)) ** 2 for t in range(T)], 1)
res["spec1024_rel_max"] = float(np.max(np.abs(P - ref)) / np.max(ref))
assert P.shape == ref.shape and res["spec1024_rel_max"] < 1e-5, res

# 2. recursions
xs = torch.from_numpy(RNG.standard_normal((3, 64, 300)).astype(np.float32))
m0 = torch.from_numpy(RNG.standard_normal((3, 64)).astype(np.float32))
rho = 0.05 * math.log(10) / 10 * 200 / 16000
naive = np.empty((3, 64, 300))
mp = m0.numpy().astype(np.float64)
for t in range(300):
    mp = np.minimum(xs[:, :, t].numpy(), mp + rho)
    naive[:, :, t] = mp
long_ = M.floor_track(xs, m0, rho).numpy()
short = np.concatenate([M.floor_track(xs[..., a:a + 50], torch.from_numpy(naive[..., a - 1].astype(np.float32)) if a else m0, rho).numpy()
                        for a in range(0, 300, 50)], -1)
res["floor_long_vs_naive"], res["floor_tri_vs_naive"] = worst(long_, naive), worst(short, naive)
u = torch.from_numpy(np.abs(RNG.standard_normal((3, 300))).astype(np.float32)) * (torch.rand(3, 300) < 0.3)
o0 = torch.tensor([0.0, 0.5, 2.0])
beta = math.exp(-200 / 16000 / 3.0)
naive = np.empty((3, 300))
op = o0.numpy().astype(np.float64)
for t in range(300):
    op = np.maximum(u[:, t].numpy(), op * beta)
    naive[:, t] = op
long_ = M.decay_max(u, o0, beta).numpy()
short = np.concatenate([M.decay_max(u[:, a:a + 50], torch.from_numpy(naive[:, a - 1].astype(np.float32)) if a else o0, beta).numpy()
                        for a in range(0, 300, 50)], -1)
res["onset_long_vs_naive"], res["onset_tri_vs_naive"] = worst(long_, naive), worst(short, naive)
assert max(res["floor_long_vs_naive"], res["floor_tri_vs_naive"], res["onset_long_vs_naive"], res["onset_tri_vs_naive"]) < 1e-5, res

# 3-4. networks
for name, cfg in NETS.items():
    net = M.build(cfg).eval()
    with torch.no_grad():         # random BatchNorm statistics so normalisation is exercised
        for mod in net.modules():
            if isinstance(mod, (torch.nn.BatchNorm1d, torch.nn.BatchNorm2d)):
                mod.running_mean.normal_(0, 1)
                mod.running_var.uniform_(0.5, 3)
    r = {"params": net.n_params(), "frame_ms": net.frame_ms, "ctx": net.ctx}
    x16 = signal(40.0, 7)
    n = (len(x16) + M.OFF) // M.HOP
    xpad = torch.from_numpy(np.concatenate([np.zeros(net.pad, np.float32), x16])[: net.pad + n * M.HOP - M.OFF])[None]
    with torch.no_grad():
        Xw, Aw, _ = net.prep5(xpad)
        wd = 0.0
        for ch in (1, 2, 37, 700):
            st, Xs, As, i = None, [], [], 0
            while i < n:
                m = min(ch, n - i)
                seg = xpad[:, i * M.HOP:i * M.HOP + net.ctx + m * M.HOP]
                Xc, Ac, st = net.prep5(seg, st)
                Xs.append(Xc)
                As.append(Ac)
                i += m
            wd = max(wd, worst(torch.cat(Xs, 3), Xw), worst(torch.cat(As, 2), Aw))
        r["prep5_chunked_vs_whole"] = wd
        pb = M.run_stream(net, x16)
        stm = M.Streaming(net).eval()
        sd = 0.0
        for ch in (1, 2, 8, 700):
            state = stm.init_state()
            xs_ = np.concatenate([np.zeros(net.ctx + M.OFF, np.float32), x16])
            out, i = np.empty(n, np.float32), 0
            while i < n:
                m = min(ch, n - i)
                a = net.ctx + i * M.HOP
                o = stm(torch.from_numpy(xs_[a:a + m * M.HOP])[None], *state)
                out[i:i + m] = o[0][0].numpy()
                state = list(o[1:])
                i += m
            sd = max(sd, worst(out, pb))
        r["torch_streaming_vs_batch"] = sd
    if "onnx" in A:
        from export import export_net
        d = tempfile.mkdtemp()
        path = os.path.join(d, name.replace("+", "_") + ".onnx")
        export_net(net, {"args": {"name": "parity"}, "step": 0}, path)
        r["onnx_bytes"] = os.path.getsize(path)
        from infer import OnnxEngine
        od = 0.0
        for ch in (1, 2, 8):
            od = max(od, worst(OnnxEngine(path, ch)(x16), pb))
        r["onnx_streaming_vs_batch"] = od
    res[name] = r
    print(name, json.dumps(r), flush=True)
    assert r["prep5_chunked_vs_whole"] < 5e-4 and r["torch_streaming_vs_batch"] < 1e-4 and r.get("onnx_streaming_vs_batch", 0) < 1e-4, r
print(json.dumps(res, indent=1))
if A.get("json"):
    json.dump(res, open(A["json"], "w"), indent=1)
print("parity_r5: PASS")
