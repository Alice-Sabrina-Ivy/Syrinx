"""Pitch-augmented training envelopes (train_dev only): Praat PSOLA pitch shift by ST semitones (same
'To Manipulation' -> multiply pitch tier -> overlap-add recipe as rlab.manip), then CheapTrick envelopes at
the ORIGINAL voiced frame times with F0 x 2^(ST/12). Speaker identity (and so its tract length) is kept.

  python aug_extract.py <st> [workers]   -> cache/ct/train_dev_p<st>.npz  (same layout as extract.py)
"""
import os
import sys
import numpy as np
import pandas as pd
from concurrent.futures import ProcessPoolExecutor

HERE = os.path.dirname(os.path.abspath(__file__))
LAB = os.path.abspath(os.path.join(HERE, "..", "..", "..", "scripts", "resonance-lab"))
sys.path.insert(0, LAB)
sys.path.insert(0, os.path.join(LAB, "candidates", "vtln-warp"))
import warnings  # noqa: E402
warnings.filterwarnings("ignore")
ST = None


def _init(st):
    global ST
    for k in ("OMP_NUM_THREADS", "MKL_NUM_THREADS", "OPENBLAS_NUM_THREADS"):
        os.environ[k] = "1"
    ST = st


def job(a):
    from rlab import audio
    from rlab.f0 import F0Track
    from rlab import manip
    import vtlnlib as V
    iid, path, sr, f0p = a
    x = audio.load(path, sr)
    f = F0Track.load(f0p)
    v = f.f0[f.f0 > 0]
    if len(v) < 5:
        v = np.array([120.0, 220.0])
    floor = float(max(50.0, 0.7 * np.percentile(v, 10)))
    ceil = float(min(800.0, max(1.6 * np.percentile(v, 90), floor * 2.5)))
    y = manip.praat_variant(x, dict(kind="pitch", cond="p", st=ST), floor, ceil, float(np.median(v)))
    y = y * (audio.rms(x) / max(audio.rms(y), 1e-12))
    m = f.f0 > 0
    t, f0 = f.t[m], f.f0[m] * 2.0 ** (ST / 12.0)
    ok = (t * V.SR > 200) & (t * V.SR < len(y) - 200)
    t, f0 = t[ok], f0[ok]
    E = V.envelopes(y, t, f0, "ct")
    e = V.frame_energy_db(y, t) if len(t) else np.zeros(0)
    return iid, t.astype(np.float32), f0.astype(np.float32), e.astype(np.float32), E.astype(np.float16)


def main():
    st = float(sys.argv[1])
    nw = int(sys.argv[2]) if len(sys.argv) > 2 else 4
    man = pd.read_parquet(os.path.join(HERE, "..", "bench", "manifests", "train_dev.parquet"))
    jobs = list(zip(man.item_id, man.path, man.sr_src, man.f0_path))
    ids, T, F, ED, E = [], [], [], [], []
    with ProcessPoolExecutor(nw, initializer=_init, initargs=(st,)) as ex:
        for i, r in enumerate(ex.map(job, jobs, chunksize=8)):
            ids.append(r[0]); T.append(r[1]); F.append(r[2]); ED.append(r[3]); E.append(r[4])
            if (i + 1) % 500 == 0:
                print("p", st, i + 1, len(jobs), flush=True)
    off = np.r_[0, np.cumsum([len(t) for t in T])]
    tag = f"p{st:+g}"
    np.savez(os.path.join(HERE, "cache", "ct", f"train_dev_{tag}.npz"), ids=np.array(ids), off=off,
             t=np.concatenate(T), f0=np.concatenate(F), edb=np.concatenate(ED), env=np.concatenate(E))
    print("done", tag, off[-1], "frames")


if __name__ == "__main__":
    main()
