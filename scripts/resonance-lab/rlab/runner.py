"""Score a candidate over benchmark item sets, with on-disk caching."""
import os
import json
import time
import shutil
import numpy as np
import pandas as pd
from concurrent.futures import ProcessPoolExecutor
from .paths import MANIFESTS, SCORES, TMP, SR
from . import audio
from .f0 import F0Track
from .candidate import load_candidate

_CAND = None


def manifest(setname):
    return pd.read_parquet(os.path.join(MANIFESTS, f"{setname}.parquet"))


def subsample(m, setname):
    """Deterministic --quick subset (results are NOT comparable with full runs)."""
    if setname in ("r1_test", "r1_dev"):
        return m[m.order < 8]
    if setname.startswith("manip"):
        src = sorted(m.src_item.unique())
        return m[m.src_item.isin(src[::4])]
    if setname == "hill":
        spk = sorted(m.speaker.unique())
        return m[m.speaker.isin(spk[::3])]
    if setname in ("ptdb", "fda", "synth"):
        return m.iloc[::3]
    if setname == "sessions":
        return m.iloc[::2]
    return m


def _init(spec):
    global _CAND
    for k in ("OMP_NUM_THREADS", "MKL_NUM_THREADS", "OPENBLAS_NUM_THREADS"):
        os.environ[k] = "1"
    _CAND = load_candidate(spec)
    try:
        import torch
        torch.set_num_threads(1)
    except Exception:
        pass
    _CAND.setup()


def _job(args):
    iid, path, sr_src, f0p = args
    x = audio.load(path, sr_src)
    f0 = F0Track.load(f0p) if _CAND.uses_f0 else None
    c0 = time.process_time()
    t, s = _CAND.score(x, SR, f0)
    cpu = time.process_time() - c0
    t = np.asarray(t, float).ravel()
    s = np.asarray(s, float).ravel()
    assert len(t) == len(s), "score() must return equal-length t and s"
    return iid, t, s, cpu, len(x) / SR


def _paths(name, setname, quick):
    d = os.path.join(SCORES, name)
    os.makedirs(d, exist_ok=True)
    tag = f"{setname}{'.quick' if quick else ''}"
    return os.path.join(d, tag + ".parquet"), os.path.join(d, tag + ".meta.json")


def load_scores(name, setname, quick=False):
    sp, mp = _paths(name, setname, quick)
    if not os.path.exists(sp):
        return None, None
    return pd.read_parquet(sp), json.load(open(mp))


def score_set(spec, cand, setname, quick=False, workers=8, force=False, log=print):
    sp, mp = _paths(cand.name, setname, quick)
    if os.path.exists(sp) and os.path.exists(mp) and not force:
        meta = json.load(open(mp))
        if meta.get("version") == str(cand.version):
            log(f"  {setname}: cached ({meta['n_items']} items)")
            return pd.read_parquet(sp), meta
    m = manifest(setname)
    if quick:
        m = subsample(m, setname)
    jobs = list(zip(m.item_id, m.path, m.sr_src, m.f0_path))
    w0 = time.time()
    ids, ts, ss = [], [], []
    cpu_tot, aud_tot = 0.0, 0.0
    if getattr(cand, "batch", False):
        work = os.path.join(TMP, cand.name, setname)
        CH = 3000
        for c0 in range(0, len(jobs), CH):
            shutil.rmtree(work, ignore_errors=True)
            os.makedirs(work, exist_ok=True)
            bj, keymap = [], {}
            for k, (iid, path, sr_src, f0p) in enumerate(jobs[c0:c0 + CH]):
                x = audio.load(path, sr_src)
                ap, fp = os.path.join(work, f"{k}.f32"), os.path.join(work, f"{k}.f0.f32")
                x.astype("<f4").tofile(ap)
                F0Track.load(f0p).f0.astype("<f4").tofile(fp)
                bj.append(dict(key=str(k), audio=ap.replace("\\", "/"), f0=fp.replace("\\", "/"), dur=len(x) / SR))
                keymap[str(k)] = iid
                aud_tot += len(x) / SR
            res = cand.score_batch(bj, work)
            cpu_tot += float(res.pop("__cpu_s", (np.nan, None))[0]) if "__cpu_s" in res else np.nan
            for k, (t, s) in res.items():
                ids.append(keymap[k]); ts.append(t); ss.append(s)
            log(f"  {setname}: {min(c0 + CH, len(jobs))}/{len(jobs)}")
        shutil.rmtree(work, ignore_errors=True)
    else:
        with ProcessPoolExecutor(workers, initializer=_init, initargs=(spec,)) as ex:
            for i, (iid, t, s, cpu, dur) in enumerate(ex.map(_job, jobs, chunksize=4)):
                ids.append(iid); ts.append(t); ss.append(s)
                cpu_tot += cpu; aud_tot += dur
                if (i + 1) % 1000 == 0:
                    log(f"  {setname}: {i + 1}/{len(jobs)}")
    n = [len(t) for t in ts]
    df = pd.DataFrame(dict(item_id=np.repeat(ids, n),
                           t=np.concatenate(ts) if ts else [], s=np.concatenate(ss) if ss else []))
    meta = dict(version=str(cand.version), n_items=len(jobs), n_scored=len(ids), cpu_s=cpu_tot, audio_s=aud_tot,
                wall_s=time.time() - w0, quick=quick)
    df.to_parquet(sp)
    json.dump(meta, open(mp, "w"))
    log(f"  {setname}: {len(jobs)} items, {meta['wall_s']:.0f} s wall, "
        f"{1000 * cpu_tot / max(aud_tot, 1e-9):.2f} ms CPU / s audio")
    return df, meta
