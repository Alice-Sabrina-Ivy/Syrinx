"""Dev-legal vowel-robustness proxy for R4 (Hillenbrand is test-only).

Peterson & Barney (1952) mean F1-F3 / F0 for men and women (10 vowels; NOT the Hillenbrand
table), F4/F5 filled at group-typical spacing. 12 synthetic "speakers" per sex = the means
scaled by a speaker factor ~ logN(0, 0.04) plus per-vowel jitter ~ logN(0, 0.02), F0 jittered
+-8 %; rendered with the harness's own cascade synthesizer (rlab.synth.synth_vowel, 1 s).
Proxy R4 = median within-speaker SD over the 10 vowels / (women - men median readout).
Caveat: static synthetic vowels are a domain shift; this ranks variants, it is not R4.
"""
import os
import sys
import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.dirname(os.path.dirname(HERE)))
sys.path.insert(0, HERE)
from rlab.synth import synth_vowel  # noqa: E402
from rlab.f0 import F0Track  # noqa: E402
from rlab.paths import BUILD  # noqa: E402
import lefeat as L  # noqa: E402

PB = {  # vowel: (men F0, F1, F2, F3), (women F0, F1, F2, F3)
    "i": ((136, 270, 2290, 3010), (235, 310, 2790, 3310)),
    "I": ((135, 390, 1990, 2550), (232, 430, 2480, 3070)),
    "E": ((130, 530, 1840, 2480), (223, 610, 2330, 2990)),
    "ae": ((127, 660, 1720, 2410), (210, 860, 2050, 2850)),
    "a": ((124, 730, 1090, 2440), (212, 850, 1220, 2810)),
    "c": ((129, 570, 840, 2410), (216, 590, 920, 2710)),
    "U": ((137, 440, 1020, 2240), (232, 470, 1160, 2680)),
    "u": ((141, 300, 870, 2240), (231, 370, 950, 2670)),
    "A": ((130, 640, 1190, 2390), (221, 760, 1400, 2780)),
    "3r": ((133, 490, 1350, 1690), (218, 500, 1640, 1960)),
}
F45 = {"m": (3500, 4500), "f": (4200, 5300)}
CACHE = os.path.join(BUILD, "learned-envelope", "feats", "r4proxy.npz")


def build(methods):
    rng = np.random.default_rng(1952)
    rows = {m: [] for m in methods}
    spk, sex, tok = [], [], []
    ntok = 0
    for s in ("m", "f"):
        for k in range(12):
            sf_ = np.exp(rng.normal(0, 0.04))
            for v, (mv, fv) in PB.items():
                f0, f1, f2, f3 = mv if s == "m" else fv
                j = sf_ * np.exp(rng.normal(0, 0.02))
                F = [f1 * j, f2 * j, f3 * j, F45[s][0] * j, F45[s][1] * j]
                f0 = f0 * np.exp(rng.normal(0, 0.08))
                x = synth_vowel(f0, F, dur=1.0, seed=int(rng.integers(1 << 30)))
                t = np.arange(int(len(x) / 160)) * 0.01 + 0.005
                v_ = ((t > 0.1) & (t < 0.9)).astype(float) * f0
                tt, ff, E = L.frame_envelopes(x, F0Track(t, v_), methods)
                tend, cnt, B = L.bin_pool(tt, len(x) / 16000, E)
                ok = cnt >= L.MIN_FR
                for m in methods:
                    rows[m].append(B[m][ok])
                n = int(ok.sum())
                spk += [f"{s}{k}"] * n
                sex += [s] * n
                tok += [ntok] * n
                ntok += 1
    out = {"E_" + m: np.vstack(rows[m]).astype(np.float32) for m in methods}
    out.update(spk=np.array(spk), sex=np.array(sex), tok=np.array(tok))
    return out


def load(methods):
    if os.path.exists(CACHE):
        z = dict(np.load(CACHE))
        if all("E_" + m in z for m in methods):
            return z
    z = build(sorted(set(methods) | set(L.METHODS) | set(L.EXTRA)))
    np.savez(CACHE, **z)
    return z


def proxy_r4(scores, z):
    import pandas as pd
    d = pd.DataFrame(dict(s=scores, spk=z["spk"], sex=z["sex"], tok=z["tok"])).groupby(["tok", "spk", "sex"]).s.mean().reset_index()
    med = d.groupby(["spk", "sex"]).s.mean().reset_index()
    gap = med[med.sex == "f"].s.median() - med[med.sex == "m"].s.median()
    sd = d.groupby("spk").s.std().median()
    return float(sd / gap), float(gap)
