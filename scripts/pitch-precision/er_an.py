# er_an.py [TAG] — corpus fine-error decomposition on a COMMON frame set.
import json, sys
import numpy as np
sys.path.insert(0, __import__("os").path.dirname(__import__("os").path.abspath(__file__)))
from steady_real import load, DATA
tag = sys.argv[1] if len(sys.argv) > 1 else "base"
CONF = [(1280, 400), (1280, 160), (640, 400), (640, 160)]
METH = ["par", "logpar", "sinc", "spec"]
bins = [0, 1, 3, 6, 12, 1e9]
idx = json.load(open(f"{DATA}/index.json"))
S = {}
for cp in ("fda", "ptdb", "voc"):
    ER = {c: json.load(open(f"build/prec/er/{cp}_{c[0]}_{c[1]}.json")) for c in CONF}
    PR = np.load(f"build/prec/er/praat_{cp}.npz")
    for tr in idx:
        if tr["corpus"] != cp: continue
        tid = tr["trackId"]
        r = np.fromfile(f"{DATA}/{cp}/{tid}.ref.f32", dtype=np.float32).astype(float)
        r[r < 50] = 0
        dt = tr["refHopMs"] / 1000
        t = np.arange(len(r)) * dt + tr["refOffsetMs"] / 1000
        lr = np.where(r > 0, np.log2(np.where(r > 0, r, 1)), np.nan)
        # smoothed glide rate: linear fit over +-25 ms
        h = max(2, int(round(0.025 / dt)))
        sl = np.full(len(r), np.nan)
        for i in range(h, len(r) - h):
            seg = lr[i - h:i + h + 1]
            ok = ~np.isnan(seg)
            if ok.sum() >= 0.8 * len(seg):
                x = np.arange(-h, h + 1)[ok] * dt
                sl[i] = abs(np.polyfit(x, seg[ok], 1)[0]) * 12
        est = {}
        m, c = load(tag, cp, tid)
        hop, L, n = m["hopS"], m["L"], m["n"]
        kw = np.clip(np.round((t + 0.040) / hop - 1).astype(int), 0, n - 1)
        kd = np.clip(np.round((t + 0.040 + L * hop + 0.030) / hop - 1).astype(int), 0, n - 1)
        lg = lambda v: np.where(v > 0, np.log2(np.where(v > 0, v, 1)), np.nan)
        est["syrinx post"] = lg(c["post"])[kw]
        est["syrinx paint"] = lg(c["paint"])[kd]
        for (N, H) in CONF:
            o = ER[(N, H)][tid]
            te = np.array(o["t"])
            for me in METH:
                v = np.log2(np.array(o[me])) if len(te) else np.array([])
                near = np.full(len(r), np.nan)
                if len(te):
                    j = np.clip(np.searchsorted(te, t), 1, max(1, len(te) - 1))
                    j0 = np.where(np.abs(te[j - 1] - t) <= np.abs(te[np.minimum(j, len(te) - 1)] - t), j - 1, np.minimum(j, len(te) - 1))
                    ok = np.abs(te[j0] - t) <= H / 16000 / 2 + 1e-6
                    near[ok] = v[j0[ok]]
                    if me in ("par", "sinc"):
                        # linear interpolation between neighbouring estimates (both within H)
                        jl = np.clip(np.searchsorted(te, t) - 1, 0, len(te) - 1); jr = np.minimum(jl + 1, len(te) - 1)
                        okk = (te[jl] <= t) & (te[jr] >= t) & (te[jr] - te[jl] <= H / 16000 + 1e-6) & (jr > jl)
                        w = np.where(okk, (t - te[jl]) / np.where(jr > jl, te[jr] - te[jl], 1), 0)
                        it = np.full(len(r), np.nan); it[okk] = (v[jl] * (1 - w) + v[jr] * w)[okk]
                        est[f"or{N//16}ms/{H//16}ms {me} interp"] = it
                est[f"or{N//16}ms/{H//16}ms {me}"] = near
        for pm in ("ac", "cc"):
            pt, pf = PR[f"{tid}|{pm}|t"], PR[f"{tid}|{pm}|f"]
            lp = np.where(pf > 0, np.log2(np.where(pf > 0, pf, 1)), np.nan)
            jl = np.clip(np.searchsorted(pt, t) - 1, 0, len(pt) - 1); jr = np.minimum(jl + 1, len(pt) - 1)
            w = np.clip((t - pt[jl]) / np.maximum(pt[jr] - pt[jl], 1e-9), 0, 1)
            est[f"praat {pm} interp"] = lp[jl] * (1 - w) + lp[jr] * w
        # ideal ref-derived
        tc = (np.arange(n) + 1) * hop - 0.040
        ir = np.clip(np.round((tc - t[0]) / dt).astype(int), 0, len(r) - 1)
        half = int(round(0.040 / dt)); wts = np.hanning(2 * half + 3)[1:-1] ** 2
        win = np.full(n, np.nan)
        for k in range(n):
            i = ir[k]; lo, hi = i - half, i + half + 1
            if lo < 0 or hi > len(r): continue
            seg = lr[lo:hi]; ok = ~np.isnan(seg)
            if ok.sum() >= 0.5 * len(seg): win[k] = np.sum(seg[ok] * wts[ok]) / np.sum(wts[ok])
        est["ideal ref@hop"] = lr[ir][kw]
        est["ideal ref*hann80@hop"] = win[kw]
        for k, v in est.items():
            S.setdefault((cp, k), []).append(1200 * (v - lr))
        S.setdefault((cp, "_slope"), []).append(sl)
        S.setdefault((cp, "_rv"), []).append(r > 0)

for cp in ("fda", "ptdb", "voc"):
    keys = [k for (c, k) in S if c == cp and not k.startswith("_")]
    E = {k: np.concatenate(S[(cp, k)]) for k in keys}
    sl = np.concatenate(S[(cp, "_slope")]); rv = np.concatenate(S[(cp, "_rv")])
    lim = 1200 * np.log2(1.2)
    common = rv & ~np.isnan(sl)
    for k in keys:
        common &= ~np.isnan(E[k]) & (np.abs(np.nan_to_num(E[k], nan=1e9)) < lim)
    print(f"\n#### {cp}: common set n={common.sum()} of {rv.sum()} ref-voiced; cells FPE std / median|e| / p90|e| (cents); glide bins st/s {bins[:-1]}")
    print("   glide-bin share: " + " ".join(f"{100*np.mean((sl[common]>=lo)&(sl[common]<hi)):.0f}%" for lo, hi in zip(bins[:-1], bins[1:])))
    for k in sorted(keys):
        e = E[k][common]; s = sl[common]
        parts = []
        for lo, hi in zip(bins[:-1], bins[1:]):
            b = (s >= lo) & (s < hi)
            parts.append(f"{np.std(e[b]):5.1f}/{np.median(np.abs(e[b])):4.1f}" if b.sum() > 20 else "   -   ")
        print(f"  {k:32s} {np.std(e):5.1f} / {np.median(np.abs(e)):5.2f} / {np.quantile(np.abs(e), .9):5.1f} | " + " | ".join(parts))
