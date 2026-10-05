"""formant-vtl: per-frame formant dumps for every benchmark item (memoisation for the
candidate family; the candidates recompute from audio when a dump is missing).

Two extractors, both sex-blind (no pitch hint, fixed settings):
  app    — the app's LPC pipeline (scratch copy, allpoles.mjs) at production capture
           conditions: 16 k -> 48 k upsampling, 50 ms window, 25 ms hop, analysis at
           12 kHz, Burg orders 10/12/14, every pole with its bandwidth.
  praat  — Praat Burg, 5 formants, 25 ms (Gaussian ~50 ms) window, 10 ms step,
           pre-emphasis from 50 Hz, ceilings 4500/5000/5500/6000/6500 Hz.

Dumps are keyed by a hash of the 16 kHz float32 audio (what score() receives), so a
candidate's lookup is a pure function of its input.

  python extract.py [--sets a,b,...] [--workers N]
"""
import os
import sys
import json
import shutil
import hashlib
import argparse
import subprocess
import numpy as np
import pandas as pd
from concurrent.futures import ProcessPoolExecutor
from concurrent.futures.process import BrokenProcessPool

HERE = os.path.dirname(os.path.abspath(__file__))
LAB = os.path.dirname(os.path.dirname(HERE))
sys.path.insert(0, LAB)
from rlab import audio  # noqa: E402
from rlab.paths import MANIFESTS, BUILD  # noqa: E402

OUT = os.path.join(BUILD, "formant-vtl")
FR_APP = os.path.join(OUT, "frames", "app")
FR_PRAAT = os.path.join(OUT, "frames", "praat")
TMPD = os.path.join(OUT, "tmp_f32")
CEILINGS = (4500, 5000, 5500, 6000, 6500)
APP_ORDERS = (10, 12, 14)
NP = 7
ROW = 2 + len(APP_ORDERS) * (1 + 2 * NP)
ALL_SETS = ["r1_test", "ptdb", "fda", "hill", "manip_test", "manip_hill", "synth", "sessions",
            "r1_dev", "manip_dev", "train_dev"]
for d in (FR_APP, FR_PRAAT, TMPD):
    os.makedirs(d, exist_ok=True)


def audio_hash(x):
    return hashlib.sha1(np.ascontiguousarray(x, dtype="<f4").tobytes()).hexdigest()[:20]


def praat_frames(x, sr=16000):
    """-> t (n,), F (C, n, 5), B (C, n, 5) for the CEILINGS (NaN where undefined)."""
    import parselmouth
    snd = parselmouth.Sound(np.asarray(x, np.float64), sr)
    Fs, Bs, t = [], [], None
    for c in CEILINGS:
        fm = snd.to_formant_burg(time_step=0.01, max_number_of_formants=5, maximum_formant=c,
                                 window_length=0.025, pre_emphasis_from=50)
        ts = np.asarray(fm.xs())
        if t is None:
            t = ts
        F = np.array([[fm.get_value_at_time(k, tt) for k in range(1, 6)] for tt in t], float).reshape(len(t), 5)
        B = np.array([[fm.get_bandwidth_at_time(k, tt) for k in range(1, 6)] for tt in t], float).reshape(len(t), 5)
        Fs.append(F)
        Bs.append(B)
    return t, np.array(Fs, np.float32), np.array(Bs, np.float32)


def praat_path(h):
    return os.path.join(FR_PRAAT, h[:2], h + ".npz")


def app_path(h):
    return os.path.join(FR_APP, h[:2], h + ".f32")


def load_praat(h):
    p = praat_path(h)
    if not os.path.exists(p):
        return None
    z = np.load(p)
    return z["t"], z["F"], z["B"]


def load_app(h):
    p = app_path(h)
    if not os.path.exists(p):
        return None
    return np.fromfile(p, dtype="<f4").reshape(-1, ROW)


def _prep(args):
    path, sr_src = args
    x = audio.load(path, sr_src)
    h = audio_hash(x)
    pp = praat_path(h)
    if not os.path.exists(pp):
        os.makedirs(os.path.dirname(pp), exist_ok=True)
        import time
        for attempt in range(8):            # Praat raises 'Out of memory' under host memory pressure
            try:
                t, F, B = praat_frames(x)
                break
            except Exception:
                if attempt == 7:
                    raise
                time.sleep(5 * (attempt + 1))
        tmp = pp + f".{os.getpid()}.tmp.npz"
        np.savez(tmp, t=t, F=F, B=B)
        try:
            os.replace(tmp, pp)
        except OSError:                      # the same audio is being written by another worker
            if os.path.exists(tmp):
                os.remove(tmp)
    ap = app_path(h)
    job = None
    if not os.path.exists(ap):
        os.makedirs(os.path.dirname(ap), exist_ok=True)
        fp = os.path.join(TMPD, h + ".f32")
        x.astype("<f4").tofile(fp)
        job = dict(audio=fp.replace("\\", "/"), out=ap.replace("\\", "/"))
    return h, job


def run_node(jobs, shards):
    procs = []
    try:
        for i in range(shards):
            part = jobs[i::shards]
            if not part:
                continue
            jp = os.path.join(TMPD, f"jobs.{i}.json")
            json.dump(part, open(jp, "w"))
            procs.append(subprocess.Popen(["node", os.path.join(HERE, "extract_app.mjs"), jp]))
        for p in procs:
            if p.wait() != 0:
                raise RuntimeError("node shard failed")
    finally:
        for p in procs:
            if p.poll() is None:
                p.kill()        # this child's PID only


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--sets", default=",".join(ALL_SETS))
    ap.add_argument("--workers", type=int, default=14)
    a = ap.parse_args()
    idx_path = os.path.join(OUT, "index.parquet")
    idx = pd.read_parquet(idx_path) if os.path.exists(idx_path) else pd.DataFrame(columns=["set", "item_id", "hash"])
    for s in a.sets.split(","):
        m = pd.read_parquet(os.path.join(MANIFESTS, f"{s}.parquet"))
        rows = []
        CH = 2000
        for c0 in range(0, len(m), CH):
            mm = m.iloc[c0:c0 + CH]
            for attempt in range(4):
                try:
                    with ProcessPoolExecutor(a.workers) as ex:
                        res = list(ex.map(_prep, zip(mm.path, mm.sr_src), chunksize=4))
                    break
                except (BrokenProcessPool, Exception) as e:      # finished items are on disk; retry the rest
                    print(f"  pool broke ({e}); retry {attempt + 1}", flush=True)
            else:
                raise RuntimeError("process pool kept breaking")
            jobs = list({j["audio"]: j for _, j in res if j is not None}.values())   # identical audio -> one job
            if jobs:
                run_node(jobs, a.workers)
                for j in jobs:
                    if os.path.exists(j["audio"]):
                        os.remove(j["audio"])
            rows += [dict(set=s, item_id=i, hash=h) for i, (h, _) in zip(mm.item_id, res)]
            print(f"{s}: {min(c0 + CH, len(m))}/{len(m)} (node jobs {len(jobs)})", flush=True)
        idx = pd.concat([idx[idx.set != s], pd.DataFrame(rows)], ignore_index=True)
        idx.to_parquet(idx_path)
    shutil.rmtree(TMPD, ignore_errors=True)


if __name__ == "__main__":
    main()
