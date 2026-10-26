"""den_ext.py — Voice Shaper noise study: the external denoisers (measurements/voice-shaper-noise-2026-10-25.md).

  python -I den_ext.py <data> <set> gtcrn <gtcrn dir> [shard i/N]
  python -I den_ext.py <data> <set> dfn3[aNN] <deep-filter exe> [shard i/N]

gtcrn  GTCRN (Xiaobin-Rong/gtcrn, DNS3 checkpoint, MIT) offline at 16 kHz (512-point STFT, hop 256,
       sqrt-Hann, as its repo); the result is upsampled to the capture rate and keeps the input's
       band above 8 kHz scaled per frame by the model's 4-8 kHz amplitude gain (crossfade 7.5-8 kHz).
dfn3   DeepFilterNet 3 (Rikorose/DeepFilterNet v0.5.6 deep-filter CLI, embedded DFN3 model) at
       48 kHz, delay compensated (-D); dfn3aNN = attenuation limit NN dB (-a NN).
Writes <data>/den/<name>/<set>/<mix id>.f32 at the recording's rate and length.
"""
import json
import subprocess
import sys
import tempfile
from math import gcd
from pathlib import Path

import numpy as np
import soundfile as sf
from scipy.signal import resample_poly

DATA, SET, NAME, TOOL = Path(sys.argv[1]), sys.argv[2], sys.argv[3], Path(sys.argv[4])
SH, NSH = (int(v) for v in (sys.argv[5] if len(sys.argv) > 5 else "0/1").split("/"))
mix_dir = DATA / "mix" / SET
out_dir = DATA / "den" / NAME / SET
out_dir.mkdir(parents=True, exist_ok=True)
mixes = sorted(p for p in mix_dir.glob("*.json"))[SH::NSH]
todo = [p for p in mixes if not (out_dir / (p.stem + ".f32")).exists()]


def rs(x, a, b):
    if a == b:
        return x.astype(np.float32)
    g = gcd(a, b)
    return resample_poly(x, b // g, a // g).astype(np.float32)


def fit(y, n):
    out = np.zeros(n, np.float32)
    out[: min(n, len(y))] = y[:n]
    return out


def load(p):
    meta = json.loads(p.read_text())
    x = np.fromfile(mix_dir / (p.stem + ".f32"), dtype="<f4")
    return meta, x


if NAME == "gtcrn":
    import importlib.util
    import torch
    torch.set_num_threads(1)
    spec = importlib.util.spec_from_file_location("gtcrn_model", TOOL / "gtcrn.py")
    gm = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(gm)
    model = gm.GTCRN().eval()
    ck = torch.load(TOOL / "model_trained_on_dns3.tar", map_location="cpu", weights_only=True)
    model.load_state_dict(ck["model"])
    win16 = torch.hann_window(512).pow(0.5)

    def stft(x, n, h, w):
        return torch.stft(torch.from_numpy(x), n, h, n, w, return_complex=True)

    for p in todo:
        meta, x = load(p)
        sr = meta["rate"]
        x16 = rs(x, sr, 16000)
        with torch.no_grad():
            X = torch.stft(torch.from_numpy(x16)[None], 512, 256, 512, win16, return_complex=False)
            Y = model(X)[0]
            y16 = torch.istft(Y[..., 0] + 1j * Y[..., 1], 512, 256, 512, win16, length=len(x16)).numpy()
        e = fit(rs(y16, 16000, sr), len(x))
        N, H = 1024, 256
        w = torch.hann_window(N).pow(0.5)
        XE, XX = stft(e, N, H, w), stft(x, N, H, w)
        f = np.arange(N // 2 + 1) * sr / N
        band = (f >= 4000) & (f < 8000)
        ge = (XE[band].abs() ** 2).sum(0)
        gx = (XX[band].abs() ** 2).sum(0)
        g = torch.clamp(torch.sqrt(ge / (gx + 1e-12)), max=1.0)
        lo = torch.from_numpy(np.clip((8000 - f) / 500, 0, 1)).float()[:, None]  # 1 below 7.5 kHz, 0 above 8 kHz
        Z = XE * lo + XX * g[None, :] * (1 - lo)
        y = torch.istft(Z, N, H, N, w, length=len(x)).numpy().astype(np.float32)
        y.astype("<f4").tofile(out_dir / (p.stem + ".f32"))
    print(NAME, SET, len(todo), "done")

elif NAME.startswith("dfn3"):
    atten = NAME[5:] if NAME.startswith("dfn3a") else None
    B = 40
    for i in range(0, len(todo), B):
        batch = todo[i:i + B]
        with tempfile.TemporaryDirectory() as td:
            td = Path(td)
            (td / "in").mkdir()
            metas = {}
            for p in batch:
                meta, x = load(p)
                metas[p.stem] = (meta["rate"], len(x))
                sf.write(td / "in" / (p.stem + ".wav"), rs(x, meta["rate"], 48000), 48000, subtype="FLOAT")
            cmd = [str(TOOL), "-D", "-o", str(td / "out")] + (["-a", atten] if atten else []) + [str(td / "in" / (p.stem + ".wav")) for p in batch]
            subprocess.run(cmd, check=True, capture_output=True)
            for p in batch:
                y, ysr = sf.read(td / "out" / (p.stem + ".wav"), dtype="float32")
                sr, n = metas[p.stem]
                fit(rs(y, ysr, sr), n).astype("<f4").tofile(out_dir / (p.stem + ".f32"))
    print(NAME, SET, len(todo), "done")
else:
    raise SystemExit(f"unknown denoiser {NAME}")
