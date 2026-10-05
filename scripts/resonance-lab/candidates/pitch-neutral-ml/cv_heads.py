"""Speaker-disjoint dev evaluation of the embedding-head variants (pitch-neutral-ml).

The heads train on train_dev (= all LibriSpeech dev-clean). The dev scoring split
(r1_dev, manip_dev) is ALSO dev-clean, so scoring it with a head fitted on all of
train_dev would leak speakers. Here: 5 speaker folds; each dev item is scored by the
head fitted on the other 4 folds' train_dev windows only. Metrics then come from the
harness's own rlab.metrics (G, R1, manip_metrics) on the stitched scores.

  python cv_heads.py embed [--workers 6]     # cache TD-PSOLA-165 embeddings for r1_dev(quick) + manip_dev(full)
  python cv_heads.py eval                    # sweep head targets, print table, write cv_heads.json
  add --raw to either for the un-flattened ablation (cv_heads_raw.json)
"""
import os
import sys
import json
import numpy as np
import pandas as pd
from concurrent.futures import ProcessPoolExecutor
HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.dirname(os.path.dirname(HERE)))
sys.path.insert(0, HERE)
from rlab import audio, metrics as M  # noqa
from rlab.f0 import F0Track  # noqa
from rlab.runner import manifest, subsample  # noqa
import pnml_core as C  # noqa

OUT = os.path.dirname(C.CACHE)
RAW = "--raw" in sys.argv     # ablation: un-flattened embeddings + heads trained on head_train_raw.npz
ENG, FREF, SFX = ("none", 0.0, "_raw") if RAW else ("tdpsola", 165.0, "")
_E = None


def sets():
    r1 = subsample(manifest("r1_dev"), "r1_dev")
    mp = manifest("manip_dev")
    return r1, mp


def _init():
    global _E
    os.environ["OMP_NUM_THREADS"] = "1"
    _E = C.EcapaEmb()


def _job(a):
    iid, path, sr, f0p = a
    x = audio.load(path, sr)
    tr = F0Track.load(f0p)
    t, e = C.raw_embs(_E, x, tr, ENG, FREF, 0.75)
    return iid


def embed(workers):
    r1, mp = sets()
    m = pd.concat([r1, mp])
    jobs = list(zip(m.item_id, m.path, m.sr_src, m.f0_path))
    with ProcessPoolExecutor(workers, initializer=_init) as ex:
        for i, _ in enumerate(ex.map(_job, jobs, chunksize=4)):
            if (i + 1) % 250 == 0:
                print(i + 1, "/", len(jobs), flush=True)
    print("embed done", flush=True)


def load_embs(m):
    out = {}
    for iid, path, sr, f0p in zip(m.item_id, m.path, m.sr_src, m.f0_path):
        x = audio.load(path, sr)
        tr = F0Track.load(f0p)
        key = C.cache_key(x, tr)
        z = np.load(os.path.join(C.CACHE, f"emb_{ENG}_{int(FREF)}_w750", key[:2], key + ".npz"))
        out[iid] = (z["t"], z["e"].astype(np.float32))
    return out


def fit(X, y, kind, lam):
    from sklearn.linear_model import Ridge, LogisticRegression
    if kind == "logit":
        m = LogisticRegression(C=lam, max_iter=3000).fit(X, y > 0)
        return m.coef_[0], float(m.intercept_[0])
    m = Ridge(alpha=lam).fit(X, y)
    return m.coef_, float(m.intercept_)


def evaluate():
    z = np.load(os.path.join(OUT, f"head_train{SFX}.npz"))
    E = z["emb"].astype(np.float64)
    la, spk, sex, st = np.log(z["alpha"]), z["speaker"], z["sex"], z["st"]
    sgn = np.where(sex == "f", 1.0, -1.0)
    mu, sd = E.mean(0), E.std(0) + 1e-6
    X = (E - mu) / sd
    r1, mp = sets()
    cache = os.path.join(OUT, f"cv_embs{SFX}.npz")
    allm = pd.concat([r1, mp])
    if os.path.exists(cache):
        zz = np.load(cache, allow_pickle=True)
        embs = zz["embs"].item()
    else:
        embs = load_embs(allm)
        np.savez(cache, embs=np.array(embs, dtype=object))
    spks = sorted(set(spk))
    fold = {s: i % 5 for i, s in enumerate(spks)}
    assert set(allm.speaker.astype(str)) <= set(map(str, spks)), "dev speakers must be train_dev speakers"
    fold = {str(k): v for k, v in fold.items()}
    trf = np.array([fold[str(s)] for s in spk])
    # targets: ridge on ln(alpha) + c * sex sign; logistic on sex
    targets = [("scale+c0", "ridge", 0.0, 1000), ("scale+c0.02", "ridge", 0.02, 1000),
               ("scale+c0.035", "ridge", 0.035, 1000), ("scale+c0.05", "ridge", 0.05, 1000),
               ("scale+c0.07", "ridge", 0.07, 3000), ("scale+c0.10", "ridge", 0.10, 3000),
               ("scale+c0.14", "ridge", 0.14, 3000), ("sex-logistic", "logit", None, 0.001)]
    rows, res_all = [], {}
    for name, kind, c, lam in targets:
        y = sgn if kind == "logit" else la + c * sgn
        heads = []
        for k in range(5):
            tr = trf != k
            w, b = fit(X[tr], y[tr], kind, lam)
            heads.append((w / sd, b - float(np.dot(mu, w / sd))))
        recs = []
        for iid, sp in zip(allm.item_id, allm.speaker.astype(str)):
            w, b = heads[fold[sp]]
            t, e = embs[iid]
            s = e.astype(np.float64) @ w + b
            s = C.ema_gated(s)
            recs.append(pd.DataFrame(dict(item_id=iid, t=t, s=s)))
        sc = pd.concat(recs, ignore_index=True)
        res_all[name] = score_metrics(sc, r1, mp)
        rows.append((name, res_all[name]))
    # reference: the model's own logit after TD-PSOLA flattening (no head), from the logit cache via the harness scores
    print_table(rows)
    json.dump(res_all, open(os.path.join(OUT, f"cv_heads{SFX}.json"), "w"), indent=1, default=float)


def score_metrics(sc, r1, mp):
    w = M.windows(sc)
    r1res, ru = M.r1(w, r1, "median")
    G = M.gap(ru, r1)
    sp = r1.assign(r=r1.item_id.map(ru).values).groupby(["speaker", "sex"]).r.median().reset_index()
    mid = float((sp[sp.sex == "f"].r.median() + sp[sp.sex == "m"].r.median()) / 2)
    mm = M.manip_metrics(w, mp, "median", G, mid)
    r5 = M.r5(w, r1, None, None, "median", G)
    return dict(G=G, auc5=r1res["auc_5s"], auc_utt=r1res["auc_utt"], flicker=r5.get("flicker"), **{k: v for k, v in mm.items() if not isinstance(v, dict)})


def print_table(rows):
    cols = [("G", "G", 4), ("AUC5", "auc5", 2), ("R2", "praat_R2", 2), ("R2m", "praat_R2_m", 2), ("R2f", "praat_R2_f", 2),
            ("M+12tow", "praat_toward_m_p+12", 2), ("R3", "praat_R3", 2), ("R3m", "praat_R3_m", 2), ("R3f", "praat_R3_f", 2),
            ("sign5", "praat_sign5", 2), ("R3hi", "praat_R3hi", 2), ("signhi", "praat_sign5hi", 2),
            ("W R2", "world_R2", 2), ("W R3", "world_R3", 2), ("W sign", "world_sign5", 2), ("flick", "flicker", 2)]
    print("| head | " + " | ".join(c[0] for c in cols) + " |")
    print("|---" * (len(cols) + 1) + "|")
    for n, r in rows:
        print(f"| {n} | " + " | ".join("–" if r.get(k) is None or not np.isfinite(r.get(k)) else f"{r[k]:.{d}f}" for _, k, d in cols) + " |")


if __name__ == "__main__":
    if sys.argv[1] == "embed":
        embed(int(sys.argv[sys.argv.index("--workers") + 1]) if "--workers" in sys.argv else 6)
    else:
        evaluate()
