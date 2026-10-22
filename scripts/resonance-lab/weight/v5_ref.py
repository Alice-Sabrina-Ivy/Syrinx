"""v5_ref.py - Python reference of the weight x clarity lab's v5 frame path.

The learned "v5" vocal-weight candidate of the 2026-10-08 vocal-weight research
(scratch research, not in this repo): per voiced frame, 50 ms Hann frame at
16 kHz centred on the pitch frame, 4096-point FFT, harmonic amplitudes raw and
Iseli-Alwan formant-corrected (Iseli et al. 2007, https://doi.org/10.1121/1.2697522;
order-16 Burg LPC poles 90-5500 Hz, bandwidth < 700 Hz, lowest 5), corrected
source-spectrum slopes, CPP, harmonic-to-interharmonic ratios in three bands,
16 mean-removed log-mel bands, frame level; then the frozen model
public/resonance-lab/weight_v5.json (45-input tanh MLP -> weight w; 5-input linear
clarity head -> clarity c).

frame_feats / formants / correction_db are copied verbatim from the research
feats.py; v5_from_feats is the research forward pass (train.py derive + predict).
src/resonance-lab/weight-features.js is the JS port; tests/resonance-lab/weight-test.js
checks it against fixtures made by make_fixture.py with this file.
"""
import json, math
from pathlib import Path
import numpy as np
import librosa

SR = 16000
N = 800
NF = 4096
DF = SR / NF
WIN = np.hanning(N)
HAM = np.hamming(N)
MEL = librosa.filters.mel(sr=SR, n_fft=NF, n_mels=16, fmin=80, fmax=7000, norm=None)
TARGETS = [1000, 2000, 3000, 4000, 5000]

NAMES = (["f0", "level"] +
         [f"H{k}" for k in (1, 2, 3, 4)] + [f"Hk{f}" for f in TARGETS] +
         [f"H{k}c" for k in (1, 2, 3, 4)] + [f"Hk{f}c" for f in TARGETS] +
         ["slope_lo_c", "slope_hi_c", "slope_lo", "slope_hi",
          "cpp", "hir_lo", "hir_mid", "hir_hi", "nform"] +
         [f"F{i}" for i in range(1, 5)] + [f"B{i}" for i in range(1, 5)] +
         [f"mel{i}" for i in range(16)])
IX = {n: i for i, n in enumerate(NAMES)}

MODEL = json.load(open(Path(__file__).resolve().parents[3] / "public" / "resonance-lab" / "weight_v5.json"))


def formants(fr):
    y = np.append(fr[0], fr[1:] - 0.97 * fr[:-1]) * HAM
    if not np.any(y):
        return []
    try:
        a = librosa.lpc(y, order=16)
    except Exception:
        return []
    if not np.all(np.isfinite(a)):
        return []
    r = np.roots(a)
    r = r[np.imag(r) > 0]
    f = np.angle(r) * SR / (2 * np.pi)
    b = -np.log(np.abs(r) + 1e-12) * SR / np.pi
    m = (f > 90) & (f < 5500) & (b < 700) & (b > 0)
    o = np.argsort(f[m])
    return list(zip(f[m][o][:5], b[m][o][:5]))


def correction_db(freqs, fm):
    """Iseli-Alwan: sum over formants of 10log10 |H_i(f)|^2, H_i normalised to 0 dB at DC."""
    g = np.zeros_like(freqs, dtype=float)
    w = 2 * np.pi * freqs / SR
    for F, Bw in fm:
        r = math.exp(-math.pi * Bw / SR)
        th = 2 * math.pi * F / SR
        num = (1 - 2 * r * math.cos(th) + r * r) ** 2
        den = (1 - 2 * r * np.cos(th - w) + r * r) * (1 - 2 * r * np.cos(th + w) + r * r)
        g += 10 * np.log10(num / den)
    return g


def frame_feats(fr, f0):
    spec = np.abs(np.fft.rfft(fr * WIN, NF)) ** 2
    X = 10 * np.log10(spec + 1e-14)
    K = int(min(7000, SR / 2 - f0) // f0)
    if K < 4:
        return None
    k = np.arange(1, K + 1)
    hw = max(1, int(round(0.3 * f0 / DF)))
    c = np.round(k * f0 / DF).astype(int)
    idx = c[:, None] + np.arange(-hw, hw + 1)[None, :]
    idx = np.clip(idx, 0, len(X) - 1)
    H = X[idx].max(axis=1)
    cm = np.round((k + 0.5) * f0 / DF).astype(int)
    hw2 = max(1, int(round(0.1 * f0 / DF)))
    idm = np.clip(cm[:, None] + np.arange(-hw2, hw2 + 1)[None, :], 0, len(X) - 1)
    V = X[idm].mean(axis=1)
    fm = formants(fr)
    hf = k * f0
    Hc = H - correction_db(hf, fm)
    tk = [int(np.argmin(np.abs(hf - T))) for T in TARGETS]
    lo = hf <= 1500
    hi = (hf >= 1000) & (hf <= 5000)
    lf = np.log2(hf)

    def slope(v, m):
        return float(np.polyfit(lf[m], v[m], 1)[0]) if m.sum() >= 3 else float("nan")
    cep = np.fft.irfft(X)
    q = np.arange(len(cep)) / SR
    qa, qb = int(SR / 400), int(SR / 60)
    qq, cc = q[qa:qb], cep[qa:qb]
    p = np.polyfit(qq, cc, 1)
    q0 = 1 / f0
    m = (qq > q0 * 0.85) & (qq < q0 * 1.15)
    if m.any():
        j = np.argmax(cc[m])
        cpp = float(cc[m][j] - np.polyval(p, qq[m][j]))
    else:
        cpp = float("nan")
    hir = H - V

    def band(a, b):
        mm = (hf >= a) & (hf < b)
        return float(hir[mm].mean()) if mm.any() else float("nan")
    mel = np.log10(MEL @ spec + 1e-14) * 10
    mel = mel - mel.mean()
    F = [f for f, _ in fm[:4]] + [float("nan")] * (4 - min(4, len(fm)))
    Bw = [b for _, b in fm[:4]] + [float("nan")] * (4 - min(4, len(fm)))
    level = 10 * np.log10(np.mean(fr ** 2) + 1e-14)
    return np.array([f0, level] + list(H[:4]) + [H[t] for t in tk] + list(Hc[:4]) + [Hc[t] for t in tk] +
                    [slope(Hc, lo), slope(Hc, hi), slope(H, lo), slope(H, hi), cpp,
                     band(0, 1500), band(1500, 3500), band(3500, 6000), float(len(fm))] + F + Bw + list(mel), float)


def v5_from_feats(F):
    """F: n x len(NAMES) feature rows -> (weight, clarity), exactly the research train.py derive/predict."""
    M = MODEL
    W1 = np.array(M["state"]["f.0.weight"]); B1 = np.array(M["state"]["f.0.bias"])
    W2 = np.array(M["state"]["f.2.weight"]); B2 = np.array(M["state"]["f.2.bias"])
    MED = np.array(M["median"]); SC = np.array(M["scale"])
    CW = np.array(M["clarity"]["w"]).reshape(-1); CB = float(np.array(M["clarity"]["b"]).reshape(-1)[0])
    CMED = np.array(M["clarity"]["median"]); CSC = np.array(M["clarity"]["scale"])
    g = lambda n: F[:, IX[n]].astype(np.float64)
    z = np.log2(g("f0") / 150.0)
    cols, names = [], []

    def add(n, v):
        names.append(n); cols.append(v)
    add("H1c-H2c", g("H1c") - g("H2c")); add("H2c-H4c", g("H2c") - g("H4c")); add("H4c-H2kc", g("H4c") - g("Hk2000c"))
    add("H2kc-H5kc", g("Hk2000c") - g("Hk5000c")); add("H1-H2", g("H1") - g("H2")); add("H1c-H1kc", g("H1c") - g("Hk1000c"))
    add("H1c-H3kc", g("H1c") - g("Hk3000c")); add("H1-H2k", g("H1") - g("Hk2000")); add("slope_lo_c", g("slope_lo_c"))
    add("slope_hi_c", g("slope_hi_c"))
    for n in ("cpp", "hir_lo", "hir_mid", "hir_hi"):
        add(n, g(n))
    add("z", z)
    base = list(cols)
    for n, v in zip(list(names), base):
        if n != "z":
            add(n + "*z", v * z)
    for i in range(16):
        add(f"mel{i}", g(f"mel{i}"))
    assert names == M["inputs"], "derive mismatch"
    D = np.column_stack(cols)
    with np.errstate(invalid="ignore"):
        Z = np.clip(np.where(np.isfinite((D - MED) / SC), (D - MED) / SC, 0.0), -5, 5)
    y = (np.tanh(Z @ W1.T + B1) @ W2.T + B2).reshape(-1)
    C = np.column_stack([g("cpp"), g("hir_lo"), g("hir_mid"), g("hir_hi"), z])
    with np.errstate(invalid="ignore"):
        ZC = np.clip(np.where(np.isfinite((C - CMED) / CSC), (C - CMED) / CSC, 0.0), -5, 5)
    yc = ZC @ CW + CB
    return y, yc
