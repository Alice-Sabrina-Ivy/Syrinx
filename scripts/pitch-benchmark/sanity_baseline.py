# sanity_baseline.py — re-score the dumped Syrinx corpus series with the
# committed corpus.mjs convention (one sample per 25 ms hop, reference index
# round((t_ms - off)/refHop), PTDB off +20 ms, posted stage window centre
# (k+1)*hop - 40 ms; painted adds L*hop + 30 ms) and print the groups the
# 2026-10-03 measurement files report, to prove the dumps reproduce them.
import os, sys, json, numpy as np
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from paths import DATA, OUT
INDEX = json.load(open(os.path.join(DATA, "index.json")))


def cls_correct(f, r):
    return (f > 0) & (np.abs(f / r - 1) < 0.05)


for tag in ["main", "new", "new600"]:
    d = os.path.join(OUT, "syrinx", tag)
    acc = {}
    for c in ["fda", "ptdb", "hil", "voc"]:
        meta = {}
        for fn in os.listdir(d):
            if fn.startswith(c + ".") and fn.endswith(".json"): meta.update(json.load(open(os.path.join(d, fn))))
        for tr in [t for t in INDEX if t["corpus"] == c]:
            m = meta[tr["trackId"]]; n = m["n"]; h = m["hopS"]
            a = np.fromfile(os.path.join(d, c, tr["trackId"] + ".f32"), dtype=np.float32).reshape(4, n).astype(float)
            ref = np.fromfile(os.path.join(DATA, c, tr["trackId"] + ".ref.f32"), dtype=np.float32).astype(float)
            k = np.arange(n)
            g = f"{c}_{tr['gender']}" if c != "voc" else "voc"
            for st, row, tt in (("post", 0, (k + 1) * h - 0.040), ("paint", 1, (k + 1) * h - 0.040 - m["L"] * h - 0.030)):
                i = np.floor((tt * 1000 - tr["refOffsetMs"]) / tr["refHopMs"] + 0.5).astype(int)  # JS Math.round (half up)
                ok = (i >= 0) & (i < len(ref))
                r = np.zeros(n); r[ok] = ref[i[ok]]
                v = r > 0
                if c == "voc" and st == "paint": v = v & (r < 400)  # combined file's "vocadito < 400" row
                if c == "voc" and st == "post": key2 = "post|voc_all"; B = acc.setdefault(key2, [0, 0]); B[0] += int(v.sum()); B[1] += int(cls_correct(a[row][v], r[v]).sum()); v = v & (r < 400)
                key = f"{st}|{g}"
                A = acc.setdefault(key, [0, 0]); A[0] += int(v.sum()); A[1] += int(cls_correct(a[row][v], r[v]).sum())
    print(tag, "  ".join(f"{k}={100*v[1]/v[0]:.2f}(n{v[0]})" for k, v in sorted(acc.items())))
