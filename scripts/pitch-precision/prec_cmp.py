# prec_cmp.py BASE TAG... — precision of several src trees on a COMMON
# frame set: corpora (FDA / PTDB / vocadito, laryngograph / annotated refs)
# FPE std / median |err| cents, overall and on slow segments (< 1 st/s
# smoothed glide rate), posted + painted; sessions: 1-s SD agreement
# (Praat AC ref, steady_sess2 conventions) — joint_t / own_t MAE in the
# ref-SD < 0.5 and 0.5-1 st bins.
import json, sys, os
import numpy as np
sys.path.insert(0, __import__("os").path.dirname(__import__("os").path.abspath(__file__)))
from steady_real import load, DATA
import steady_sess as S2

tags = [a for a in sys.argv[1:] if not a.startswith("--")]
idx = json.load(open(f"{DATA}/index.json"))
lim = 1200 * np.log2(1.2)
print("corpora: FPE / med|e| (cents), all common frames | slow (<1 st/s) frames")
for cp in ("fda", "ptdb", "voc"):
    E = {(t, s): [] for t in tags for s in ("post", "paint")}; SL = []
    for tr in idx:
        if tr["corpus"] != cp: continue
        r = np.fromfile(f"{DATA}/{cp}/{tr['trackId']}.ref.f32", dtype=np.float32).astype(float); r[r < 50] = 0
        dt = tr["refHopMs"] / 1000; t = np.arange(len(r)) * dt + tr["refOffsetMs"] / 1000
        lr = np.where(r > 0, np.log2(np.where(r > 0, r, 1)), np.nan)
        h = max(2, int(round(0.025 / dt))); sl = np.full(len(r), np.nan)
        for i in range(h, len(r) - h):
            seg = lr[i - h:i + h + 1]; ok = ~np.isnan(seg)
            if ok.sum() >= 0.8 * len(seg): sl[i] = abs(np.polyfit(np.arange(-h, h + 1)[ok] * dt, seg[ok], 1)[0]) * 12
        SL.append(sl)
        for tg in tags:
            m, c = load(tg, cp, tr["trackId"]); hop, L, n = m["hopS"], m["L"], m["n"]
            kw = np.clip(np.round((t + 0.040) / hop - 1).astype(int), 0, n - 1)
            kd = np.clip(np.round((t + 0.040 + L * hop + float(os.environ.get("PAINT_LAG", "0.030"))) / hop - 1).astype(int), 0, n - 1)
            for s, k in (("post", kw), ("paint", kd)):
                v = c[s][k]
                E[(tg, s)].append(np.where(v > 0, 1200 * (np.log2(np.where(v > 0, v, 1)) - lr), np.nan))
    sl = np.concatenate(SL)
    for s in ("post", "paint"):
        A = {tg: np.concatenate(E[(tg, s)]) for tg in tags}
        com = ~np.isnan(sl)
        for tg in tags: com &= np.abs(np.nan_to_num(A[tg], nan=1e9)) < lim
        slow = com & (sl < 1)
        print(f"  {cp:4s} {s:5s} n={com.sum():6d} slow={slow.sum():5d} | " + " | ".join(
            f"{tg}: {np.std(A[tg][com]):5.2f}/{np.median(np.abs(A[tg][com])):5.2f} slow {np.std(A[tg][slow]):5.2f}/{np.median(np.abs(A[tg][slow])):4.2f}" for tg in tags))

print("\nsessions (minref 0.6): 1-s SD MAE (st) vs Praat AC — joint_t / own_t, bins ref<0.5 | 0.5-1")
for tg in tags:
    rows = S2.run(tg)
    for spk in ("alice", "second"):
        out = []
        for kind in ("joint_t", "own_t"):
            for st_ in ("post", "paint"):
                R = [r for r in rows if r["spk"] == spk and not r["disputed"]]
                refk = {"joint_t": f"{st_}|jointref_t", "own_t": "ref_t"}[kind]
                cells = []
                for lo, hi in ((0, 0.5), (0.5, 1.0)):
                    H = [r for r in R if f"{st_}|{kind}" in r and np.isfinite(r[f"{st_}|{kind}"]) and np.isfinite(r.get(refk, np.nan)) and lo <= r[refk] < hi]
                    d = np.array([r[f"{st_}|{kind}"] - r[refk] for r in H])
                    cells.append(f"{np.mean(np.abs(d)):.3f}(n{len(d)})" if len(d) else "-")
                out.append(f"{kind} {st_} " + "/".join(cells))
        print(f"  {tg:6s} {spk:5s} " + " ; ".join(out))
