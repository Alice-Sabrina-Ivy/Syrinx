"""Dev-legal R4 proxy on REAL speech (LibriSpeech dev-clean; Hillenbrand stays test-only).

Per train_dev utterance: Praat Burg formants (10 ms, ceiling 5000 Hz men / 5500 Hz women -
dev labels are allowed here), median F1/F2 over the voiced frames of each 150 ms feature bin
(same bins as feats/train.npz). Per speaker, Lobanov z-scores of F1 and F2 remove vocal-tract
size, so bins are assigned to K fixed vowel-space regions (k-means on pooled z(F1,F2), K = 8)
independently of size. Proxy = median over speakers of the SD across regions of that
speaker's region-mean score, / G (CV gap). It asks: does the score depend on vowel quality
within one speaker? Caveats: running-speech bins mix phones; regions are coarse.
  python vowelproxy.py build        -> feats/vowelproxy.npz (region per train bin, -1 = none)
"""
import os, sys
import numpy as np, pandas as pd
from concurrent.futures import ProcessPoolExecutor
HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.dirname(os.path.dirname(HERE)))
sys.path.insert(0, HERE)
from rlab.paths import BUILD  # noqa
FE = os.path.join(BUILD, "learned-envelope", "feats")
OUT = os.path.join(FE, "vowelproxy.npz")
K = 8


def job(a):
    i, path, sex = a
    import parselmouth
    from rlab import audio
    x = audio.load(path)
    snd = parselmouth.Sound(x.astype(np.float64), 16000)
    fm = snd.to_formant_burg(time_step=0.01, max_number_of_formants=5, maximum_formant=5000 if sex == "m" else 5500)
    pt = snd.to_pitch(time_step=0.01, pitch_floor=60, pitch_ceiling=500)
    ts = np.arange(0.005, len(x) / 16000, 0.01)
    f1 = np.array([fm.get_value_at_time(1, t) for t in ts])
    f2 = np.array([fm.get_value_at_time(2, t) for t in ts])
    v = np.array([pt.get_value_at_time(t) for t in ts])
    ok = np.isfinite(f1) & np.isfinite(f2) & np.isfinite(v) & (v > 0)
    b = np.floor(ts / 0.15).astype(int)
    rows = []
    for bb in np.unique(b[ok]):
        m = ok & (b == bb)
        if m.sum() >= 3:
            rows.append((i, bb, np.median(f1[m]), np.median(f2[m])))
    return rows


def build():
    ti = pd.read_parquet(os.path.join(FE, "train_items.parquet")).reset_index(drop=True)
    jobs = [(i, r.path, r.sex) for i, r in enumerate(ti.itertuples())]
    rows = []
    with ProcessPoolExecutor(int(os.environ.get("NW", "2"))) as ex:
        for k, r in enumerate(ex.map(job, jobs, chunksize=8)):
            rows += r
            if (k + 1) % 500 == 0:
                print(k + 1, flush=True)
    d = pd.DataFrame(rows, columns=["item", "bin", "f1", "f2"])
    d["spk"] = ti.speaker.values[d.item]
    for c in ("f1", "f2"):
        lc = np.log(d[c])
        d["z" + c] = (lc - lc.groupby(d.spk).transform("mean")) / lc.groupby(d.spk).transform("std")
    from sklearn.cluster import KMeans
    Z = d[["zf1", "zf2"]].values
    km = KMeans(K, n_init=10, random_state=0).fit(Z)
    d["reg"] = km.labels_
    tr = np.load(os.path.join(FE, "train.npz"))
    key = pd.Series(d.reg.values, index=pd.MultiIndex.from_arrays([d.item.values, d.bin.values]))
    idx = pd.MultiIndex.from_arrays([tr["item"], tr["bin"]])
    reg = key.reindex(idx).fillna(-1).astype(int).values
    np.savez(OUT, reg=reg, centers=km.cluster_centers_)
    print("regions:", np.bincount(reg[reg >= 0]), "unassigned", int((reg < 0).sum()), "of", len(reg))
    print("centers z(F1,F2):", np.round(km.cluster_centers_, 2).tolist())


def proxy(scores, spk, G, reg=None):
    if reg is None:
        reg = np.load(OUT)["reg"]
    d = pd.DataFrame(dict(s=scores, spk=spk, r=reg))
    d = d[(d.r >= 0) & np.isfinite(d.s)]
    m = d.groupby(["spk", "r"]).s.agg(["mean", "size"]).reset_index()
    m = m[m["size"] >= 10]
    sd = m.groupby("spk")["mean"].agg(lambda v: np.std(v, ddof=1) if len(v) >= 6 else np.nan)
    return float(np.nanmedian(sd)) / G


if __name__ == "__main__":
    build()
