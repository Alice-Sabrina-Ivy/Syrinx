"""Cache voiced-frame log envelopes per item for dev-side experiments.

  python extract.py <method> <set> [workers]
Writes cache/<method>/<set>.npz : ids, off (n+1), t, f0, edb, env(float16 n_frames x GRID).
"""
import os
import sys
import numpy as np
import pandas as pd
from concurrent.futures import ProcessPoolExecutor

HERE = os.path.dirname(os.path.abspath(__file__))
LAB = os.path.join(HERE, "..", "..", "..", "scripts", "resonance-lab")
sys.path.insert(0, os.path.abspath(LAB))
sys.path.insert(0, os.path.abspath(os.path.join(LAB, "candidates", "vtln-warp")))
import warnings  # noqa: E402
warnings.filterwarnings("ignore")
from rlab import audio  # noqa: E402
from rlab.f0 import F0Track  # noqa: E402
import vtlnlib as V  # noqa: E402

METHOD = None


def _init(m):
    global METHOD
    for k in ("OMP_NUM_THREADS", "MKL_NUM_THREADS", "OPENBLAS_NUM_THREADS"):
        os.environ[k] = "1"
    METHOD = m


def job(a):
    iid, path, sr, f0p = a
    x = audio.load(path, sr)
    f = F0Track.load(f0p)
    v = f.f0 > 0
    t, f0 = f.t[v], f.f0[v]
    ok = (t * V.SR > 200) & (t * V.SR < len(x) - 200)
    t, f0 = t[ok], f0[ok]
    E = V.envelopes(x, t, f0, METHOD)
    e = V.frame_energy_db(x, t) if len(t) else np.zeros(0)
    return iid, t.astype(np.float32), f0.astype(np.float32), e.astype(np.float32), E.astype(np.float16)


def main():
    method, setname = sys.argv[1], sys.argv[2]
    nw = int(sys.argv[3]) if len(sys.argv) > 3 else 6
    man = pd.read_parquet(os.path.join(HERE, "..", "bench", "manifests", f"{setname}.parquet"))
    jobs = list(zip(man.item_id, man.path, man.sr_src, man.f0_path))
    ids, T, F, ED, E = [], [], [], [], []
    with ProcessPoolExecutor(nw, initializer=_init, initargs=(method,)) as ex:
        for i, r in enumerate(ex.map(job, jobs, chunksize=8)):
            ids.append(r[0]); T.append(r[1]); F.append(r[2]); ED.append(r[3]); E.append(r[4])
            if (i + 1) % 500 == 0:
                print(setname, method, i + 1, len(jobs), flush=True)
    off = np.r_[0, np.cumsum([len(t) for t in T])]
    od = os.path.join(HERE, "cache", method)
    os.makedirs(od, exist_ok=True)
    np.savez(os.path.join(od, f"{setname}.npz"), ids=np.array(ids), off=off, t=np.concatenate(T),
             f0=np.concatenate(F), edb=np.concatenate(ED), env=np.concatenate(E))
    print("done", setname, method, off[-1], "frames")


if __name__ == "__main__":
    main()
