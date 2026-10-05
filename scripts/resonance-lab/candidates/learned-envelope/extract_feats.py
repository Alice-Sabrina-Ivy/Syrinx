"""Extract 150 ms bin envelope features for training (dev-clean only).

  python extract_feats.py aug     -> build/resonance-lab/learned-envelope/feats/aug.npz
  python extract_feats.py train   -> .../feats/train.npz   (all train_dev utterances, unaugmented)

Rows = (item, bin) with >= MIN_FR voiced frames. Columns: item index, bin index, voiced-frame
count, mean F0 in the bin, and per method a (rows, NB) float32 envelope matrix.
"""
import os
import sys
import numpy as np
import pandas as pd
from concurrent.futures import ProcessPoolExecutor

HERE = os.path.dirname(os.path.abspath(__file__))
LAB = os.path.dirname(os.path.dirname(HERE))
sys.path.insert(0, LAB)
sys.path.insert(0, HERE)
from rlab import audio  # noqa: E402
from rlab.f0 import F0Track  # noqa: E402
from rlab.paths import BUILD, MANIFESTS, SR  # noqa: E402
import lefeat as L  # noqa: E402

METH = tuple(os.environ.get("METH", ",".join(L.METHODS)).split(","))
TAG = os.environ.get("TAG", "")

OUT = os.path.join(BUILD, "learned-envelope", "feats")


def job(a):
    k, path, f0p, factor, crop = a
    x = audio.load(path)
    tr = F0Track.load(f0p)
    if crop:
        n = int(round(crop * SR))
        x = x[:n]
        m = tr.t < len(x) / SR
        tr = F0Track(tr.t[m], tr.f0[m])
    tr = F0Track(tr.t, tr.f0 * factor)
    t, f, E = L.frame_envelopes(x, tr, METH)
    tend, cnt, B = L.bin_pool(t, len(x) / SR, E)
    b = np.floor(t / L.BIN).astype(int)
    fsum = np.bincount(b, weights=f, minlength=len(tend))[:len(tend)] if len(b) else np.zeros(len(tend))
    ok = cnt >= L.MIN_FR
    idx = np.flatnonzero(ok)
    return k, idx, cnt[ok], (fsum[ok] / cnt[ok]), {m: B[m][ok].astype(np.float32) for m in METH}


def main(which):
    os.makedirs(OUT, exist_ok=True)
    if which == "aug":
        man = pd.read_parquet(os.path.join(BUILD, "learned-envelope", "aug", "manifest.parquet")).reset_index(drop=True)
        jobs = [(i, r.path, r.f0_src, 2.0 ** (r.st / 12.0), r.crop_s) for i, r in enumerate(man.itertuples())]
    else:
        man = pd.read_parquet(os.path.join(MANIFESTS, "train_dev.parquet")).reset_index(drop=True)
        jobs = [(i, r.path, r.f0_path, 1.0, None) for i, r in enumerate(man.itertuples())]
    res = [None] * len(jobs)
    with ProcessPoolExecutor(int(os.environ.get("NW", "10"))) as ex:
        for j, r in enumerate(ex.map(job, jobs, chunksize=8)):
            res[r[0]] = r
            if (j + 1) % 2000 == 0:
                print(j + 1, flush=True)
    item = np.concatenate([np.full(len(r[1]), r[0]) for r in res])
    out = dict(item=item.astype(np.int32), bin=np.concatenate([r[1] for r in res]).astype(np.int32),
               cnt=np.concatenate([r[2] for r in res]).astype(np.int16),
               f0=np.concatenate([r[3] for r in res]).astype(np.float32))
    for m in METH:
        out["E_" + m] = np.concatenate([r[4][m] for r in res])
    np.savez(os.path.join(OUT, f"{which}{TAG}.npz"), **out)
    man.to_parquet(os.path.join(OUT, f"{which}_items.parquet"))
    print(which, len(item), "bins")


if __name__ == "__main__":
    main(sys.argv[1])
