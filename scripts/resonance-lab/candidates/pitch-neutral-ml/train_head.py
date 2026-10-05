"""Fit linear heads on pitch-flattened ECAPA fc6 embeddings (train_dev only).

Targets:
  scale    y = ln(alpha)                                  (sex-blind: only the augmentation scale)
  scalesex y = ln(alpha) + 0.07 * (+1 women / -1 men)     (adds the natural ~ln 1.15 men/women gap)
  sex      logistic women vs men (a plain re-head, for reference)
Ridge strength chosen by 5-fold speaker-grouped CV. Reports CV diagnostics and writes
build/resonance-lab/pitch-neutral-ml/head_<target>.json (mu, sd, w, b).
"""
import os, sys, json
import numpy as np
from sklearn.linear_model import Ridge, LogisticRegression
from sklearn.model_selection import GroupKFold
HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import pnml_core as C  # noqa
D = os.path.dirname(C.CACHE)
RAW = "--raw" in sys.argv          # ablation: heads on un-flattened embeddings (head_train_raw.npz -> head_raw_<t>.json)
z = np.load(os.path.join(D, "head_train_raw.npz" if RAW else "head_train.npz"))
E, la, st, spk, sex = z["emb"].astype(np.float64), np.log(z["alpha"]), z["st"], z["speaker"], z["sex"]
mu, sd = E.mean(0), E.std(0) + 1e-6
X = (E - mu) / sd
sgn = np.where(sex == "f", 1.0, -1.0)
gkf = GroupKFold(5)
print("n windows", len(X), "speakers", len(set(spk)))


def diag(pred, name):
    # per-speaker-held-out diagnostics
    A = np.c_[la, st / 12.0, sgn, np.ones(len(la))]
    coef, *_ = np.linalg.lstsq(A, pred, rcond=None)
    gap = coef[2] * 2
    print(f"  {name}: d/dln(alpha) {coef[0]:.3f}  d/doctave {coef[1]:+.4f}  women-men gap {gap:+.4f}  "
          f"=> R3-like {coef[0] * np.log(1.15) / gap if gap else np.nan:.2f}  R2-like {abs(coef[1]) / gap if gap else np.nan:.3f}  "
          f"corr(pred, ln a) {np.corrcoef(pred, la)[0, 1]:.3f}")


# sex-weight sweep: "scalesexNNN" = ln(alpha) + NNN/1000 * sign  ("scalesex" = 0.070, chosen a priori as ~ln(1.15)/2)
CW = {"scale": 0.0, "scalesex": 0.07, "scalesex035": 0.035, "scalesex100": 0.10, "scalesex140": 0.14}
TARGETS = [a for a in sys.argv[1:] if not a.startswith("--")] or ["scale", "scalesex", "sex"]
for target in TARGETS:
    print("target", target)
    best = None
    for lam in ([100, 1000, 3000] if target != "sex" else [0.001, 0.01, 0.1, 1.0]):
        pred = np.zeros(len(X))
        for tr, te in gkf.split(X, groups=spk):
            if target == "sex":
                m = LogisticRegression(C=lam, max_iter=2000).fit(X[tr], sex[tr] == "f")
                pred[te] = m.decision_function(X[te])
            else:
                y = la + CW[target] * sgn
                pred[te] = Ridge(alpha=lam).fit(X[tr], y[tr]).predict(X[te])
        if target == "sex":
            score = np.mean((pred > 0) == (sex == "f"))
        else:
            y = la + CW[target] * sgn
            score = -np.mean((pred - y) ** 2)
        print(f" lam {lam}: cv score {score:.5f}")
        diag(pred, f"lam {lam}")
        if best is None or score > best[0]:
            best = (score, lam)
    lam = best[1]
    if target == "sex":
        m = LogisticRegression(C=lam, max_iter=2000).fit(X, sex == "f")
        w, b = m.coef_[0], float(m.intercept_[0])
    else:
        y = la + CW[target] * sgn
        m = Ridge(alpha=lam).fit(X, y)
        w, b = m.coef_, float(m.intercept_)
    json.dump(dict(target=target, lam=lam, mu=mu.tolist(), sd=sd.tolist(), w=np.asarray(w).tolist(), b=b),
              open(os.path.join(D, f"head_{'raw_' if RAW else ''}{target}.json"), "w"))
    print(" chosen lam", lam)
