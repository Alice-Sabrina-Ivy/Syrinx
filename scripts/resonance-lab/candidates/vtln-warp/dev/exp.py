"""Dev-side VTLN experiments with strict 2-fold speaker-disjoint CV on LibriSpeech dev-clean.

Model for fold f is trained on train_dev utterances of the OTHER fold's speakers only, and scores
r1_dev + manip_dev items of fold f's speakers. The two folds' scores are pooled and run through the
shared rlab.metrics code (R1 2 s / 5 s, G, R2/R3 Praat + WORLD, toward-class, R3@+8 st, flicker).

  python exp.py <config-json> [tag]
"""
import os
import sys
import json
import time
import hashlib
import numpy as np
import pandas as pd
from concurrent.futures import ProcessPoolExecutor

HERE = os.path.dirname(os.path.abspath(__file__))
LAB = os.path.abspath(os.path.join(HERE, "..", "..", "..", "scripts", "resonance-lab"))
sys.path.insert(0, LAB)
sys.path.insert(0, os.path.join(LAB, "candidates", "vtln-warp"))
import warnings  # noqa: E402
warnings.filterwarnings("ignore")
from rlab import metrics as M  # noqa: E402
import functools  # noqa: E402
M._voiced_times = functools.lru_cache(maxsize=None)(M._voiced_times)   # metrics reload F0 files per call otherwise
import vtlnlib as V  # noqa: E402

MAN = os.path.join(HERE, "..", "bench", "manifests")
BIN = 0.15
DEFAULT = dict(arch="mw", method="ct", band=[300, 4500], ncep=20, drop_c1=False, kmax=24, st=2, K=32, sat=2,
               train_step=4, edb_rel=None, seed=0, reg=1e-3)
DW_DEFAULT = dict(kmax=25, K=64, sat=3)
ESTIMATORS = ["frame", "w0.15", "w0.5", "w1", "w2", "w4", "post1"]


def load_cache(method, setname):
    z = np.load(os.path.join(HERE, "cache", method, f"{setname}.npz"))
    return {k: z[k] for k in z.files}


def item_slices(c):
    return {iid: (c["off"][i], c["off"][i + 1]) for i, iid in enumerate(c["ids"])}


def frame_mask(c, a, b, cfg):
    """Voiced frames (already) + optional energy floor relative to the causal running max (2 s)."""
    m = np.ones(b - a, bool)
    if cfg.get("edb_rel") is not None and b > a:
        e = c["edb"][a:b].astype(float)
        t = c["t"][a:b]
        run = np.array([e[(t > t[i] - 2.0) & (t <= t[i])].max() for i in range(len(e))])
        m &= e >= run - cfg["edb_rel"]
    return m


def train(cfg, c, slices, train_items_by_spk, log=print, aug=()):
    E_spk, F_spk = {}, {}
    srcs = [(c, slices)] + [(ac, item_slices(ac)) for ac in aug]
    for spk, items in train_items_by_spk.items():
        Es, Fs = [], []
        for cc, sl in srcs:
            for iid in items:
                a, b = sl[iid]
                m = frame_mask(cc, a, b, cfg)
                Es.append(cc["env"][a:b][m][::cfg["train_step"]].astype(np.float32))
                Fs.append(cc["f0"][a:b][m][::cfg["train_step"]])
        E_spk[spk] = np.concatenate(Es)
        F_spk[spk] = np.concatenate(Fs)
    if cfg["arch"] == "mwf0":
        MW, gmms, ks = V.train_mwf0(E_spk, F_spk, tuple(cfg["band"]), cfg["kmax"], cfg["st"], cfg["K"], cfg["sat"],
                                    cfg["seed"], log, cfg["reg"], tuple(cfg.get("f0_edges", (150.0, 210.0))))
        return MW, None, ks
    if cfg["arch"] == "mw":
        MW, gmm, ks = V.train_mw(E_spk, tuple(cfg["band"]), cfg["kmax"], cfg["st"], cfg["K"], cfg["sat"], cfg["seed"],
                                 log, cfg["reg"])
        return MW, None, ks
    return V.train_sat(E_spk, tuple(cfg["band"]), cfg["ncep"], cfg["kmax"], cfg["drop_c1"], cfg["K"], cfg["sat"],
                       cfg["seed"], log)


def curves_for(W, model, E, f0=None):
    if isinstance(W, V.ModelWarpF0):
        out = np.zeros((len(E), W.nk), np.float32)
        for a in range(0, len(E), 4000):
            out[a:a + 4000] = W.curves(E[a:a + 4000], f0[a:a + 4000])
        return out
    if model is None:
        out = np.zeros((len(E), W.nk), np.float32)
        for a in range(0, len(E), 4000):
            out[a:a + 4000] = W.curves(E[a:a + 4000])
        return out
    out = np.zeros((len(E), len(W.shifts)), np.float32)
    for a in range(0, len(E), 2000):
        out[a:a + 2000] = V.loglik_curves(model, W, E[a:a + 2000])
    return out


def _winit():
    from threadpoolctl import threadpool_limits
    globals()["_TPL"] = threadpool_limits(1)


def _score_chunk(args):
    cfg, W, model, items = args
    for k in ("OMP_NUM_THREADS", "MKL_NUM_THREADS", "OPENBLAS_NUM_THREADS"):
        os.environ[k] = "1"
    out = {}
    for iid, env, t, dur, mask, f0 in items:
        E = env[mask].astype(np.float32)
        LL = curves_for(W, model, E, f0[mask]) if len(E) else np.zeros((0, 1))
        out[iid] = V.bin_estimates(LL, t[mask], dur, W, ESTIMATORS)
    return out


def run(cfg, tag, workers=2, log=print):
    base = {**DEFAULT, **(DW_DEFAULT if cfg.get("arch") == "dw" else {})}
    cfg = {**base, **cfg}
    t0 = time.time()
    tr = pd.read_parquet(os.path.join(MAN, "train_dev.parquet"))
    r1 = pd.read_parquet(os.path.join(MAN, "r1_dev.parquet"))
    mp = pd.read_parquet(os.path.join(MAN, "manip_dev.parquet"))
    spk = tr.groupby("speaker").sex.first()
    fold = {}
    for sx in ("f", "m"):
        for i, s in enumerate(sorted(spk[spk == sx].index)):
            fold[s] = i % 2
    ctr = load_cache(cfg["method"], "train_dev")
    str_ = item_slices(ctr)
    augc = [load_cache(cfg["method"], "train_dev_" + a) for a in cfg.get("aug", [])]
    if cfg.get("r1only"):
        mp = mp.iloc[:0]
    else:
        cmp_ = load_cache(cfg["method"], "manip_dev")
        smp = item_slices(cmp_)
    win = {e: {} for e in ESTIMATORS}
    info = {}
    for f in (0, 1):
        by = {s: list(tr[tr.speaker == s].item_id) for s in spk.index if fold[s] != f}
        tt = time.time()
        W, model, kspk = train(cfg, ctr, str_, by, log, augc)
        log(f"  fold {f} trained in {time.time() - tt:.0f} s")
        info[f"fold{f}_train_shifts"] = kspk
        for sx in ("f", "m"):
            v = [kspk[q] * V.LN_STEP for q in kspk if spk[q] == sx]
            info[f"fold{f}_train_lna_{sx}"] = (float(np.mean(v)), float(np.std(v)))
        log(f"  fold {f} train ln-alpha by sex: " + str({k: v for k, v in info.items() if k.startswith(f"fold{f}_train_lna")}))
        items = []
        r1f = r1[r1.speaker.map(fold) == f]
        for iid, d in zip(r1f.item_id, r1f.dur_s):
            a, b = str_[iid]
            items.append((iid, ctr["env"][a:b], ctr["t"][a:b], d, frame_mask(ctr, a, b, cfg), ctr["f0"][a:b]))
        mpf = mp[mp.speaker.map(fold) == f]
        for iid, d in zip(mpf.item_id, mpf.dur_s):
            a, b = smp[iid]
            items.append((iid, cmp_["env"][a:b], cmp_["t"][a:b], d, frame_mask(cmp_, a, b, cfg), cmp_["f0"][a:b]))
        chunks = [items[i::workers * 4] for i in range(workers * 4)]
        with ProcessPoolExecutor(workers, initializer=_winit) as ex:
            for o in ex.map(_score_chunk, [(cfg, W, model, ch) for ch in chunks]):
                for iid, (te, res) in o.items():
                    for e in ESTIMATORS:
                        s = res[e]
                        ok = np.isfinite(s)
                        if ok.any():
                            win[e][iid] = (te[ok], s[ok])
        log(f"  fold {f} done ({time.time() - t0:.0f} s)")
    rows = {}
    for e in ESTIMATORS:
        rows[e] = metrics(win[e], r1, mp, spk, fold)
    return dict(cfg=cfg, tag=tag, res=rows, info=info, wall_s=time.time() - t0), win


def metrics(win, r1, mp, spk, fold):
    out = {}
    r1m, ru = M.r1(win, r1, "median")
    G = M.gap(ru, r1)
    sp = r1.assign(r=r1.item_id.map(ru).values).groupby(["speaker", "sex"]).r.median().reset_index()
    mid = float((sp[sp.sex == "f"].r.median() + sp[sp.sex == "m"].r.median()) / 2)
    mm = M.manip_metrics(win, mp, "median", G, mid) if len(mp) else {}
    mm = __import__("collections").defaultdict(lambda: np.nan, mm)
    r5 = M.r5(win, r1, None, None, "median", G)
    out.update(G=G, G_ratio=float(np.exp(G)), auc2=r1m["auc_2s"], auc5=r1m["auc_5s"], auc_utt=r1m["auc_utt"],
               auc_spk=r1m["auc_spk"], cov=r1m["coverage"],
               R2=mm["praat_R2"], R2w=mm["world_R2"], leak_oct=mm["praat_leak_per_oct"],
               R2_m=mm["praat_R2_m"], R2_f=mm["praat_R2_f"],
               R3=mm["praat_R3"], R3w=mm["world_R3"], sign=mm["praat_sign5"], signw=mm["world_sign5"],
               R3hi=mm["praat_R3hi"], signhi=mm["praat_sign5hi"],
               tw_p_m12=mm["praat_toward_m_p+12"], tw_p_f12=mm["praat_toward_f_p-12"],
               tw_f_m115=mm["praat_toward_m_f1.15"], tw_f_f085=mm["praat_toward_f_f0.85"],
               flip_m=mm["praat_men_p+12_cross"], base_m=mm["men_orig_cross"],
               flicker=r5["flicker"], tstable=r5["time_to_stable_s"])
    # per-fold 5 s AUC (checks that fold offsets do not inflate/deflate the pooled AUC)
    for f in (0, 1):
        sub = r1[r1.speaker.map(fold) == f]
        out[f"auc5_fold{f}"] = M.r1({k: v for k, v in win.items() if k in set(sub.item_id)}, sub, "median")[0]["auc_5s"]
    return out


if __name__ == "__main__":
    cfg = json.loads(sys.argv[1])
    tag = sys.argv[2] if len(sys.argv) > 2 else hashlib.md5(sys.argv[1].encode()).hexdigest()[:8]
    res, win = run(cfg, tag)
    os.makedirs(os.path.join(HERE, "dev_results"), exist_ok=True)

    def cl(o):
        if isinstance(o, dict):
            return {str(k): cl(v) for k, v in o.items()}
        if isinstance(o, (list, tuple)):
            return [cl(v) for v in o]
        if isinstance(o, (np.floating, float)):
            return None if not np.isfinite(o) else round(float(o), 4)
        if isinstance(o, np.integer):
            return int(o)
        return o
    json.dump(cl(res), open(os.path.join(HERE, "dev_results", tag + ".json"), "w"), indent=1)
    df = pd.DataFrame(res["res"]).T
    pd.set_option("display.width", 250)
    print(tag, json.dumps(cfg))
    print(df[["G_ratio", "auc2", "auc5", "auc5_fold0", "auc5_fold1", "R2", "R2w", "R3", "R3w", "sign", "signw",
              "R3hi", "signhi", "tw_p_m12", "tw_p_f12", "tw_f_m115", "tw_f_f085", "flicker", "tstable"]].round(3).to_string())
