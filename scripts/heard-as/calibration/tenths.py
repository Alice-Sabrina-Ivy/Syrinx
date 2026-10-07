"""Coverage of the TRUE per-voice share (latent model of width_latent.py) when the range is shown in
'x in 10 listeners' with the lower bound rounded down and the upper bound rounded up."""
import json, numpy as np, pandas as pd
from data import *
FIT = json.load(open("fit.json")); RES = json.load(open("width_latent.json"))
H = set_target(load(), "half"); H = H[H[CUE].notna().all(axis=1)].reset_index(drop=True)
eta_of = lambda d: FIT["a"] + FIT["b_meter"] * d.meter_logit.values + FIT["c_lnf0"] * d.lnf0.values
z, wq = np.polynomial.hermite_e.hermegauss(40); wq = wq / wq.sum()
pal = pd.read_csv("palette_loto.csv"); bm = H[(H.src == "bmmb") & H.side.isin(["fem", "masc"]) & (H.cond == "a")]
ltg = H[H.src == "libritts-p"].groupby("talker")
lt = pd.DataFrame({"eta": ltg.apply(lambda d: eta_of(d).mean()), "side": ltg.side.first()})
SETS = {"Palette natural masc.-presenting talkers, leave-one-talker-out (~49 listeners/voice)": (lg(pal.p0.values), pal.side.values),
        "bmmb natural adults /hid/, 'adult man' (15 listeners, 4AFC)": (eta_of(bm), bm.side.values),
        "bmmb natural adults /hid/, 'man or boy' (15 listeners, 4AFC)": (eta_of(bm), bm.side.values),
        "LibriTTS-P natural readers (3 annotators) [validation only]": (lt.eta.values, lt.side.values)}
OUT = []
for name, (eta, side) in SETS.items():
    for sd in ["fem", "masc"]:
        key = f"{name} | {sd}"
        if key not in RES or not np.isfinite(RES[key]["sigma"]) or RES[key]["sigma"] > 10: continue
        mu, s = RES[key]["mu"], RES[key]["sigma"]
        e = eta[side == sd]
        row = []
        for w in [2.0, 2.25]:
            lo = np.floor(10 * sig(e - w) / 100) / 10; hi = np.ceil(10 * sig(e + w) / 100) / 10
            p = 1 / (1 + np.exp(-(e[:, None] + mu + s * z[None, :])))
            c = (((p >= lo[:, None]) & (p <= hi[:, None])) * wq[None, :]).sum(1).mean()
            c0 = ((np.abs(mu + s * z) <= w) * wq).sum()
            row.append(f"w {w}: exact {c0:.2f}, tenths-rounded {c:.2f}")
        line = f"{key}: mu {mu:+.2f} sigma {s:.2f} | " + " | ".join(row)
        print(line); OUT.append(line)
open("tenths.txt", "w", encoding="utf-8").write("\n".join(OUT))
