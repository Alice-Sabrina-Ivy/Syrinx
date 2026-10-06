# harmfeat.py — offline harmonicity features of every decoded frame that reached
# the harmonic guard in an attr.mjs dump (2026-10-05, exploration for a
# real-noise-tuned voicing guard). Computed on the RAW stream (resampled to
# 16 kHz; the worker's guard sees the post-notch buffer — the difference is
# confined to actively notched tonal lines), on the analysis frame of the
# decoded frame (the last 1280 samples of its chunk), 4096-point Hann FFT:
#   hc       harmonicStructureCount (k = 1..4, peak >= 10 x the +-35 % band median)
#   vp1..vp8 prominence (dB) of harmonic k: peak within +-min(3 % k f, 0.2 f)
#            over the mean level of the valleys at (k -+ 0.5) f (+-0.1 f) — the
#            odd/even arbitration's prominence (boersma-ac.js oddEvenProminenceDb)
# Output: build/realnoise-fv/feat/<tag>/<set>/<id>.npy, shape (n, 9), NaN rows
# where the guard was not called.
#
#   python scripts/realnoise-fv/harmfeat.py TAG SET [--shard=i/n] [--data-root=...] [--corpora=<tests/dsp/data dir>]
import sys, os, glob, json
from math import gcd
import numpy as np
import soundfile as sf
from scipy.signal import resample_poly

A = dict((a[2:].split("=", 1) + ["1"])[:2] for a in sys.argv[1:] if a.startswith("--"))
TAG, SET = [a for a in sys.argv[1:] if not a.startswith("--")][:2]
ROOT = os.path.join(A.get("data-root", os.environ.get("NOTCHVD_ROOT", "build/notchvd")), "data")
CORP = A.get("corpora", os.environ.get("SYRINX_CORPORA_DIR", "tests/dsp/data"))
ATTR = A.get("attr", "build/realnoise-fv/attr")
OUT = os.path.join("build/realnoise-fv/feat", TAG, SET)
os.makedirs(OUT, exist_ok=True)
N, FL, SR = 4096, 1280, 16000
HANN = 0.5 - 0.5 * np.cos(2 * np.pi * np.arange(FL) / (FL - 1))
BIN = SR / N


def load(p):
    m = json.load(open(p + ".json"))
    a = np.fromfile(p + ".f32", dtype=np.float32).reshape(len(m["cols"]), m["n"]).astype(float)
    return m, {c: a[i] for i, c in enumerate(m["cols"])}


def audio(m):
    if SET == "noise":
        idx = audio.noise
        x, sr = sf.read(os.path.join(ROOT, idx[m["id"]]["path"]), dtype="float32")
    elif SET in ("vin", "gated"):
        x, sr = sf.read(os.path.join(ROOT, audio.mix[m["id"]]["path"]), dtype="float32")
    elif SET == "ptdb":
        g = "MALE" if m["id"].split("_")[1].startswith("M") else "FEMALE"
        x, sr = sf.read(glob.glob(os.path.join(CORP, "ptdb-tug", g, "MIC", "*", m["id"] + ".wav"))[0], dtype="float32")
    elif SET == "fda":
        x = np.fromfile(glob.glob(os.path.join(CORP, "fda", "*", m["id"] + ".sig"))[0], dtype=">i2").astype(np.float32) / 32768
        sr = 20000
    elif SET == "hil":
        x, sr = sf.read(glob.glob(os.path.join(CORP, "*", m["id"] + ".wav"))[0], dtype="float32")
    elif SET == "voc":
        x, sr = sf.read(glob.glob(os.path.join(CORP, "vocadito", "**", m["id"] + ".wav"), recursive=True)[0], dtype="float32")
    if x.ndim > 1:
        x = x[:, 0]
    if sr != SR:
        g = gcd(sr, SR)
        x = resample_poly(x, SR // g, sr // g).astype(np.float32)
    return x, sr


if SET == "noise":
    audio.noise = {r["id"]: r for r in json.load(open(os.path.join(ROOT, "index_noise.json")))}
if SET in ("vin", "gated"):
    audio.mix = {r["id"]: r for r in json.load(open(os.path.join(ROOT, "index_mix.json")))}


def features(P, f0):
    hc = 0
    for k in range(1, 5):
        f = k * f0
        lo, hi = max(1, int(np.floor(f * 0.96 / BIN))), min(N // 2 - 1, int(np.ceil(f * 1.04 / BIN)))
        flo, fhi = max(1, int(np.floor(f * 0.65 / BIN))), min(N // 2 - 1, int(np.ceil(f * 1.35 / BIN)))
        if P[lo:hi + 1].max() >= 10 * np.median(P[flo:fhi + 1]):
            hc += 1
    vp = np.full(8, np.nan)
    for k in range(1, 9):
        f = k * f0
        if f > 3800:
            break
        half = min(0.03 * f, 0.2 * f0)
        pk = P[max(1, int(np.floor((f - half) / BIN))):int(np.ceil((f + half) / BIN)) + 1].max()
        v = 0.5 * sum(P[max(1, int(np.floor((vc - 0.1 * f0) / BIN))):int(np.ceil((vc + 0.1 * f0) / BIN)) + 1].mean()
                      for vc in (f - 0.5 * f0, f + 0.5 * f0))
        vp[k - 1] = 10 * np.log10(pk / (v + 1e-30) + 1e-30)
    return hc, vp


names = sorted(os.path.basename(p)[:-5] for p in glob.glob(f"{ATTR}/{TAG}/{SET}/*.json"))
shI, shN = map(int, A.get("shard", "0/1").split("/"))
names = names[shI::shN]
for nm in names:
    if os.path.exists(os.path.join(OUT, nm + ".npy")):
        continue
    m, c = load(f"{ATTR}/{TAG}/{SET}/{nm}")
    x, sr = audio(m)
    Cn = m.get("C") or round(sr * 0.025)
    out = np.full((m["n"], 9), np.nan, np.float32)
    for k in np.nonzero(c["gk"] >= 0)[0]:
        end = int(round((k + 1) * Cn / sr * SR))
        if end < FL or end > len(x):
            continue
        X = np.fft.rfft(x[end - FL:end] * HANN, N)
        hc, vp = features(X.real ** 2 + X.imag ** 2, c["dec"][k])
        out[k, 0] = hc
        out[k, 1:] = vp
    np.save(os.path.join(OUT, nm + ".npy"), out)
print(f"{TAG} {SET} {shI}/{shN}: {len(names)} streams")
