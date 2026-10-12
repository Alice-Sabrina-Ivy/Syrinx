# calib_r5.py — custom voice detector, round 5 (pre-registration
# measurements/voice-detector-round5-preregistration-2026-10-12.md §3.7;
# Addendum R5-B part 2): the three F5 constants left open by §3.5, fixed from
# GENERATED noise and TRAINING-split voice only, before any round-5 model is
# trained or scored (no validation, H, sealed or private data):
#   cpp_thr  the cepstral periodicity threshold = the 99th percentile of the
#            cepstral peak prominence (F5's definition) over 400 s of Gaussian
#            white noise (seed 4_999_000_001): a frame is "periodic" when its
#            CPP is above what aperiodic noise reaches 1 % of the time
#   dq0      initial value of the |d ln q| EMAs = the mean |d ln q| over frame
#            pairs periodic at t and t - 1 in training voice ("not yet known to
#            be steady", as F1's v0)
#   de0      initial value of the |d ln E| EMAs = the mean |d ln E| (50-1,000 Hz)
#            over Praat-positive frames of the same training voice
# Training voice: 300 D7a series (r5/d7a.json, FNV-1a order of "calib:" + id,
# 150 per sex), their records read from the packed training voice bank
# (voice_train_r2), each record a fresh stream.
#
#   <venv>/python calib_r5.py  -> f5const_r5.json (next to this file; committed)
import json
import os

import numpy as np
import torch

import model as M
from tcommon import ROOT, SR, TRAIN, fnv1a


def main():
    cfg = {"convs": [[24, 3], [48, 3], [48, 1]], "gru": 96, "f1m": {}, "f5": {"cpp_thr": 0.0, "dq0": 0.0, "de0": 0.0}}
    net = M.build(cfg).eval()
    g = np.random.default_rng(4_999_000_001)
    cpps = []
    with torch.no_grad():
        for k in range(40):
            x = g.standard_normal(10 * SR).astype(np.float32) * 0.05
            xp = torch.from_numpy(np.concatenate([np.zeros(net.pad, np.float32), x])[: net.pad + ((len(x) + 4) // 200) * 200 - 4])[None]
            cpp, _, _ = net.f5_raw(xp)
            cpps.append(cpp[0, 8:].numpy())          # frames whose 64 ms window lies inside the noise
    cpps = np.concatenate(cpps)
    thr = float(np.percentile(cpps, 99))
    d7 = json.load(open(os.path.join(ROOT, "r5", "d7a.json"), encoding="utf8"))["series"]
    pick = []
    for sx in ("f", "m"):
        ss = sorted([s for s in d7 if s["sex"] == sx], key=lambda s: (fnv1a("calib:" + s["id"]), s["id"]))
        pick += ss[:150]
    vj = json.load(open(os.path.join(TRAIN, "voice_train_r2.json"), encoding="utf8"))
    idx = {i: k for k, i in enumerate(vj["ids"])}
    V = np.memmap(os.path.join(TRAIN, "voice_train_r2.i16"), dtype=np.int16, mode="r")
    ix = dict(np.load(os.path.join(TRAIN, "voice_train_r2.npz")))
    dqs, des, nrec = [], [], 0
    with torch.no_grad():
        for s in pick:
            for rid in s["items"]:
                k = idx[rid]
                o, ln = int(ix["off"][k]), int(ix["len"][k])
                x = np.asarray(V[o:o + min(ln, 60 * SR)], np.float32) / 32768
                n = (len(x) + 4) // 200
                if n < 20:
                    continue
                xp = torch.from_numpy(np.concatenate([np.zeros(net.pad, np.float32), x])[: net.pad + n * 200 - 4])[None]
                cpp, lnq, E = (z[0].numpy().astype(np.float64) for z in net.f5_raw(xp))
                per = cpp >= thr
                both = per[1:] & per[:-1]
                dqs.append(np.abs(np.diff(lnq))[both])
                lab = ix["lab"][ix["loff"][k]:ix["loff"][k] + ix["llen"][k]]
                t0 = float(ix["t0"][k])
                cen = ((np.arange(n) + 1) * 200 - 4 - 256) / SR
                j = np.round((cen - t0) / 0.01).astype(np.int64)
                ok = (j >= 0) & (j < len(lab))
                pos = np.zeros(n, bool)
                pos[ok] = lab[j[ok]] == 1
                des.append(np.abs(np.diff(E))[pos[1:] & pos[:-1]])
                nrec += 1
    dq0 = float(np.mean(np.concatenate(dqs)))
    de0 = float(np.mean(np.concatenate(des)))
    out = {"what": "round-5 F5 constants (Addendum R5-B part 2): cpp_thr from generated white noise, dq0 / de0 from training voice (D7a)",
           "f5": {"cpp_thr": round(thr, 4), "dq0": round(dq0, 6), "de0": round(de0, 6)},
           "detail": {"noise_frames": int(len(cpps)), "noise_cpp_median": float(np.median(cpps)), "voice_series": len(pick), "voice_records": nrec,
                      "dq_pairs": int(sum(len(a) for a in dqs)), "de_frames": int(sum(len(a) for a in des)),
                      "dq_median": float(np.median(np.concatenate(dqs))), "de_median": float(np.median(np.concatenate(des)))}}
    p = os.path.join(os.path.dirname(os.path.abspath(__file__)), "f5const_r5.json")
    json.dump(out, open(p, "w", encoding="utf8"), indent=1)
    print(json.dumps(out, indent=1))


if __name__ == "__main__":
    main()
