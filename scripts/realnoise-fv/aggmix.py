# aggmix.py — compare evalmix.mjs outputs of two src trees (2026-10-05).
#
#   python scripts/realnoise-fv/aggmix.py BASE TAG --set=gated|held|vin [--mix=build/realnoise-fv/mix]
# gated: painted FV from switch-on + 1 s (pfvAll) and + 21 s (pfv), worker FV
#        (fvAll), notch promotion (s after switch-on, never = none): means,
#        streams worse than BASE by > 2 pp painted, identical streams.
# held:  hold frames at pitch, worker (ok) / painted (pok), painted gap FV.
import sys, os, glob, json
import numpy as np

A = dict((a[2:].split("=", 1) + ["1"])[:2] for a in sys.argv[1:] if a.startswith("--"))
BASE, TAG = [a for a in sys.argv[1:] if not a.startswith("--")][:2]
SET = A.get("set", "gated")
MIX = A.get("mix", "build/realnoise-fv/mix")


def rows(tag):
    out = {}
    for p in glob.glob(f"{MIX}/{tag}/{SET}.*of*.json"):
        for r in json.load(open(p)):
            out[r["id"]] = r
    return out


a, b = rows(BASE), rows(TAG)
ids = sorted(set(a) & set(b))
pct = lambda r, k: 100 * r[k] / r[k + "_n"] if r.get(k + "_n") else np.nan
keys = {"gated": ["pfvAll", "pfv", "fvAll"], "held": ["ok", "pok", "pfvGap"]}[SET]
print(f"{SET}: {len(ids)} streams ({BASE} vs {TAG})")
for k in keys:
    va = np.array([pct(a[i], k) for i in ids]); vb = np.array([pct(b[i], k) for i in ids])
    m = np.isfinite(va) & np.isfinite(vb)
    d = vb[m] - va[m]
    worse = (d > 2).sum() if k.startswith("pfv") or k.startswith("fv") else (d < -1).sum()
    print(f"  {k:7s} mean {va[m].mean():6.2f} -> {vb[m].mean():6.2f}   identical {int((d == 0).sum())}/{int(m.sum())}   "
          f"{'worse > 2 pp' if k.startswith(('pfv', 'fv')) else 'worse > 1 pp'}: {int(worse)}   better: {int(((d < 0) if k.startswith(('pfv', 'fv')) else (d > 0)).sum())}")
if SET == "gated":
    pa = np.array([a[i]["promo"] if a[i]["promo"] is not None else np.inf for i in ids])
    pb = np.array([b[i]["promo"] if b[i]["promo"] is not None else np.inf for i in ids])
    print(f"  promo identical {int((pa == pb).sum())}/{len(ids)}, never {int(np.isinf(pa).sum())} -> {int(np.isinf(pb).sum())}")
