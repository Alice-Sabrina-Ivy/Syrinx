"""formant-vtl in-process lab evaluator.

Scores a Config over the benchmark item sets straight from the frame dumps (no audio
reload) and computes the SAME metrics as bench.py (it calls rlab.metrics with the same
arguments). Used for fast variant sweeps; headline numbers are re-run through
bench.py with the candidate files in cands.py (which must reproduce these numbers).

Speaker-disjoint protocol for learned parts (shape correction):
  * --split test: the corrector is fit on ALL of train_dev (LibriSpeech dev-clean);
    test speakers are disjoint by construction.
  * --split dev:  r1_dev / manip_dev share speakers with train_dev, so the corrector is
    fit in 5 speaker folds and each dev item is scored by the fold that never saw its
    speaker.
"""
import os
import sys
import json
import pickle
import numpy as np
import pandas as pd

HERE = os.path.dirname(os.path.abspath(__file__))
LAB = os.path.dirname(os.path.dirname(HERE))
sys.path.insert(0, LAB)
sys.path.insert(0, HERE)
from rlab import metrics as M  # noqa: E402
from rlab.f0 import F0Track  # noqa: E402
from rlab.paths import MANIFESTS, BUILD  # noqa: E402
import fvtl  # noqa: E402
import extract as X  # noqa: E402

OUT = os.path.join(BUILD, "formant-vtl")
PACK = os.path.join(OUT, "packed")
os.makedirs(PACK, exist_ok=True)
TEST_SETS = ["r1_test", "ptdb", "fda", "hill", "manip_test", "manip_hill", "synth", "sessions"]
DEV_SETS = ["r1_dev", "manip_dev"]
_CACHE = {}


def manifest(s):
    return pd.read_parquet(os.path.join(MANIFESTS, f"{s}.parquet"))


def packed(s, ext="app"):
    """item_id -> dict(app=raw | praat=(t, F, B), f0=F0Track, dur) for ONE extractor (memory)."""
    key = (s, ext)
    if key in _CACHE:
        return _CACHE[key]
    if len(_CACHE) > 3:
        _CACHE.clear()
    p = os.path.join(PACK, f"{s}.{ext}.pkl")
    if os.path.exists(p):
        _CACHE[key] = pickle.load(open(p, "rb"))
        return _CACHE[key]
    idx = pd.read_parquet(os.path.join(OUT, "index.parquet"))
    hm = dict(zip(idx[idx.set == s].item_id, idx[idx.set == s].hash))
    m = manifest(s)
    d = {}
    for iid, fp, dur in zip(m.item_id, m.f0_path, m.dur_s):
        h = hm[iid]
        fr = X.load_app(h) if ext == "app" else X.load_praat(h)
        d[iid] = {ext: fr, "f0": F0Track.load(fp), "dur": float(dur), "hash": h}
    pickle.dump(d, open(p, "wb"), protocol=5)
    _CACHE[key] = d
    return d


_PROD = None
PROD_DIR = os.path.join(BUILD, "pitch-neutral-ml", "prodf0")   # read-only: production pitch-worker tracks


def prod_f0(h, f0):
    """Production-detector (Boersma-AC pitch-worker emulation, precomputed by the
    pitch-neutral-ml agent from each item's own audio) track on the bench 10 ms grid."""
    global _PROD
    if _PROD is None:
        _PROD = {}
        for d in os.listdir(PROD_DIR):
            for f in os.listdir(os.path.join(PROD_DIR, d)):
                _PROD[f[:20]] = os.path.join(PROD_DIR, d, f)
    p = _PROD.get(h)
    if p is None:
        return None
    return F0Track(f0.t, np.load(p)[:len(f0.t)])


def score_set(s, cfg, corr=None, corr_by_item=None):
    ext = cfg.get("extractor", "app")
    P = packed(s, ext)
    ids, ts, ss = [], [], []
    miss = 0
    for iid, it in P.items():
        fr = (ext, it["app"] if ext == "app" else it["praat"])
        if fr[1] is None:
            continue
        c = corr_by_item(iid) if corr_by_item is not None else corr
        f0 = it["f0"]
        if cfg.get("f0src") == "prod":
            f0 = prod_f0(it["hash"], f0)
            if f0 is None:
                miss += 1
                continue
        t, v = fvtl.score_frames(fr, f0, it["dur"], cfg, c)
        ids.append(iid); ts.append(t); ss.append(v)
    if miss:
        print(f"  {s}: {miss} items without a production pitch track (skipped)", flush=True)
    n = [len(t) for t in ts]
    return pd.DataFrame(dict(item_id=np.repeat(ids, n), t=np.concatenate(ts), s=np.concatenate(ss)))


# ------------------------------------------------------------------ training frames
_TF = {}


def train_frames(cfg, sets=("train_dev",), corr=None):
    """All voiced, gate-passing frames of the training pool: F (n,5), est (n,), spk (n,), item."""
    key = json.dumps([cfg, sets, id(corr) if corr is not None else None], sort_keys=True, default=str)
    if key not in _TF:
        if len(_TF) > 2:
            _TF.clear()
        _TF[key] = _train_frames(cfg, sets, corr)
    return _TF[key]


def _train_frames(cfg, sets, corr=None):
    Fs, Es, Ss, Is = [], [], [], []
    ext = cfg.get("extractor", "app")
    for s in sets:
        m = manifest(s).set_index("item_id")
        for iid, it in packed(s, ext).items():
            fr = (ext, it[ext])
            _, v, info = fvtl.frame_estimates(fr, it["f0"], cfg, corr)
            ok = np.isfinite(v)
            Fs.append(info["F"][ok]); Es.append(v[ok])
            Ss.append(np.repeat(m.loc[iid, "speaker"], ok.sum())); Is.append(np.repeat(iid, ok.sum()))
    return np.concatenate(Fs), np.concatenate(Es), np.concatenate(Ss), np.concatenate(Is)


def make_corrector(spec):
    kind = spec.get("kind", "kmeans")
    if kind == "kmeans":
        return fvtl.ShapeCorrector(spec.get("K", 16), spec.get("idx", (0, 1, 2, 3)), spec.get("soft", 0.0))
    if kind == "tmatch":
        return fvtl.TemplateMatcher(spec.get("K", 16), spec.get("lam", 1.0), spec.get("mu", 2.0), spec.get("cmax"),
                                    spec.get("sig_floor", 0.02), spec.get("iters", 2), use3=spec.get("use3", True))
    if kind == "ridge":
        return fvtl.RatioRegressor(spec.get("idx", (0, 1, 2, 3)), spec.get("alpha", 1.0), spec.get("deg", 2))
    raise ValueError(kind)


def fit_corrector(cfg, spec, exclude_speakers=()):
    if spec.get("gmm"):
        base = dict(extractor="app", order=cfg.get("order", 12), est="gm1234")
        Fb, _, Sb, _ = train_frames(base)
        keep = ~np.isin(Sb, list(exclude_speakers)) & np.isfinite(Fb[:, :4]).all(1)
        gmm = fvtl.ShapeGMM(spec["gmm"]).fit(Fb[keep])
        comp = fvtl.Composite(None, gmm)
        if spec.get("kind", "ridge") == "none":
            return comp
        F, E, S, _ = train_frames(cfg, corr=comp)
        keep = ~np.isin(S, list(exclude_speakers))
        idx = list(spec.get("idx", (0, 1, 2, 3)))
        ok = keep & np.isfinite(F[:, idx]).all(1)
        comp.corr = make_corrector(spec).fit(F[ok], E[ok], S[ok])
        return comp
    if spec.get("kind") == "tmatch":
        F, E, S, _ = train_frames(dict(cfg, est="gm1234"))
        keep = ~np.isin(S, list(exclude_speakers)) & np.isfinite(F[:, :4]).all(1)
        return make_corrector(spec).fit(F[keep], S[keep])
    F, E, S, _ = train_frames(cfg)
    keep = ~np.isin(S, list(exclude_speakers))
    idx = list(spec.get("idx", (0, 1, 2, 3)))
    ok = keep & np.isfinite(F[:, idx]).all(1)
    return make_corrector(spec).fit(F[ok], E[ok], S[ok])


# ------------------------------------------------------------------ metrics (as bench.run)
def metrics(sc, split, agg="median", name="lab"):
    sets = TEST_SETS if split == "test" else DEV_SETS
    man = {s: manifest(s) for s in sets}
    win = {s: M.windows(sc[s]) for s in sets}
    res = dict(name=name, split=split, quick=False, aggregate=agg)
    r1s = "r1_test" if split == "test" else "r1_dev"
    ms = "manip_test" if split == "test" else "manip_dev"
    r1, ru = M.r1(win[r1s], man[r1s], agg)
    G = M.gap(ru, man[r1s])
    sp = man[r1s].assign(r=man[r1s].item_id.map(ru).values).groupby(["speaker", "sex"]).r.median().reset_index()
    mid = float((sp[sp.sex == "f"].r.median() + sp[sp.sex == "m"].r.median()) / 2)
    res["G"], res["midpoint"] = G, mid
    res["R1"] = {r1s: r1}
    res["R2R3"] = {ms: M.manip_metrics(win[ms], man[ms], agg, G, mid)}
    res["R5"] = M.r5(win[r1s], man[r1s], win.get("synth"), man.get("synth"), agg, G)
    if split == "test":
        for s in ("ptdb", "fda"):
            res["R1"][s], _ = M.r1(win[s], man[s], agg)
        hr1, hru = M.r1(win["hill"], man["hill"], agg, horizons=())
        res["R1"]["hill"] = hr1
        G_hill = M.gap(hru, man["hill"])
        sph = man["hill"].assign(r=man["hill"].item_id.map(hru).values).groupby(["speaker", "sex"]).r.median().reset_index()
        mid_h = float((sph[sph.sex == "f"].r.median() + sph[sph.sex == "m"].r.median()) / 2)
        res["G_hill"] = G_hill
        res["R2R3"]["manip_hill"] = M.manip_metrics(win["manip_hill"], man["manip_hill"], agg, G_hill, mid_h)
        res["R4"] = M.r4(win["hill"], man["hill"], agg, G_hill)
        leak = res["R2R3"][ms]["praat_leak_per_oct"]
        res["R6"] = M.r6(win["sessions"], man["sessions"], agg, G, leak)
        res["R7"] = M.r7(win["synth"], man["synth"], win[r1s], man[r1s], agg)
    return res


def summary(res):
    split = res["split"]
    r1s = "r1_test" if split == "test" else "r1_dev"
    ms = "manip_test" if split == "test" else "manip_dev"
    a = res["R1"][r1s]
    m = res["R2R3"][ms]
    o = dict(G=res["G"], auc2=a.get("auc_2s"), auc5=a.get("auc_5s"), auc_utt=a.get("auc_utt"), auc_spk=a.get("auc_spk"),
             cov=a.get("coverage"), R2=m["praat_R2"], R2w=m["world_R2"], R3=m["praat_R3"], R3w=m["world_R3"],
             sign=m["praat_sign5"], signw=m["world_sign5"], R3hi=m["praat_R3hi"], signhi=m["praat_sign5hi"],
             tow_m12=m.get("praat_toward_m_p+12"), tow_f12=m.get("praat_toward_f_p-12"),
             flick=res["R5"]["flicker"], tstab=res["R5"]["time_to_stable_s"])
    if split == "test":
        mh = res["R2R3"]["manip_hill"]
        r6, r7 = res["R6"], res["R7"]
        o.update(R4=res["R4"]["R4"], hillR2=mh["praat_R2"], hillR3=mh["praat_R3"], hillsign=mh["praat_sign5"],
                 ptdb5=res["R1"]["ptdb"].get("auc_5s"), fda5=res["R1"]["fda"].get("auc_5s"),
                 hill_tok=res["R1"]["hill"]["auc_utt"], SL=r6["S_minus_L"], RL=r6["R_minus_L"], SR=r6["S_minus_R"],
                 order=r6["ordering_ok"], boys=r7.get("synth_boys_position"), girls=r7.get("synth_girls_position"),
                 hiF0w=r7.get("auc_highF0women_vs_men"), held=res["R5"]["held_sd"])
    return {k: (round(float(v), 3) if isinstance(v, (float, np.floating)) and np.isfinite(v) else v) for k, v in o.items()}


_REFK = None


def ref_clusters():
    """Fixed reference 'vowel-class' clusterer for the dev vowel-robustness proxy: KMeans(12)
    on F1-F4 shape vectors of app order-12 train_dev frames (independent of any variant)."""
    global _REFK
    if _REFK is None:
        p = os.path.join(OUT, "ref_clusters.pkl")
        if os.path.exists(p):
            _REFK = pickle.load(open(p, "rb"))
        else:
            from sklearn.cluster import KMeans
            F, _, _, _ = train_frames(dict(extractor="app", order=12, est="gm1234"))
            Xs = fvtl.shape_features(F)
            Xs = Xs[np.isfinite(Xs).all(1)]
            _REFK = KMeans(12, n_init=4, random_state=0).fit(Xs[::3])
            pickle.dump(_REFK, open(p, "wb"))
    return _REFK


def vowel_proxy(cfg, split, G, corr=None, corr_by_item=None):
    """Dev proxy for R4: per r1 speaker, median frame estimate within each reference shape
    class (>= 20 frames), SD across classes; median over speakers / G."""
    km = ref_clusters()
    s = "r1_test" if split == "test" else "r1_dev"
    m = manifest(s).set_index("item_id")
    ref_cfg = dict(extractor="app", order=12)
    rows = []
    ext = cfg.get("extractor", "app")
    Papp = packed(s, "app")
    for iid, it in packed(s, ext).items():
        fr = (ext, it[ext])
        c = corr_by_item(iid) if corr_by_item is not None else corr
        t_out, v, info = fvtl.frame_estimates(fr, it["f0"], cfg, c)
        # reference class from the app order-12 frames nearest in time
        t2, F2, _, _ = fvtl.app_formants(Papp[iid]["app"], 12)
        Xs = fvtl.shape_features(F2)
        ok2 = np.isfinite(Xs).all(1)
        lab_ = np.full(len(t2), -1)
        if ok2.any():
            lab_[ok2] = km.predict(Xs[ok2])
        j = np.clip(np.searchsorted(t2, info["t"]), 0, len(t2) - 1) if len(t2) else np.zeros(len(v), int)
        cl = lab_[j] if len(t2) else np.full(len(v), -1)
        ok = np.isfinite(v) & (cl >= 0)
        rows.append(pd.DataFrame(dict(spk=m.loc[iid, "speaker"], cl=cl[ok], v=v[ok])))
    d = pd.concat(rows)
    g = d.groupby(["spk", "cl"]).v.agg(["median", "size"]).reset_index()
    g = g[g["size"] >= 20]
    sd = g.groupby("spk")["median"].std()
    return float(sd.median() / G)


def run(cfg, split="dev", corr_spec=None, name="lab", agg="median", verbose=True, proxy=True):
    sets = TEST_SETS if split == "test" else DEV_SETS
    corr, cbi = None, None
    if corr_spec is not None:
        if split == "test":
            corr = fit_corrector(cfg, corr_spec)
        else:
            tr = manifest("train_dev")
            spk = sorted(tr.speaker.unique())
            folds = {sp: i % 5 for i, sp in enumerate(spk)}
            cors = [fit_corrector(cfg, corr_spec, exclude_speakers=[s for s in spk if folds[s] == f]) for f in range(5)]
            maps = {}
            for s in sets:
                mm = manifest(s)
                maps.update(dict(zip(mm.item_id, mm.speaker.map(folds))))
            cbi = lambda iid: cors[maps[iid]]  # noqa: E731
    sc = {s: score_set(s, cfg, corr, cbi) for s in sets}
    res = metrics(sc, split, agg, name)
    res["cfg"] = {k: v for k, v in cfg.items()}
    res["corr_spec"] = corr_spec
    sm = summary(res)
    if proxy:
        sm["vproxy"] = round(vowel_proxy(cfg, split, res["G"], corr, cbi), 3)
    if verbose:
        print(name, json.dumps(sm))
    return res, sm, corr
