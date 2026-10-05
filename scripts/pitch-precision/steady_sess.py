# steady_sess2.py TAG [TAG2 ...] [--minref=0.6] — session 1-s SD agreement,
# speech-like windows (the readout computes SD over the voiced frames of a
# 1-s window). Windows: 1 s, 0.25 s grid, >= 95 % own-speaker frames, Praat
# AC voiced on >= minref of frames, not reference-disputed (Praat CC voiced
# > 300 cents from AC on any joint frame). Per estimator (Praat CC, Syrinx
# post / paint / ro): own-voicing SD (its own voiced values, >= 8) and
# joint SD (its values at AC-voiced reference times); robust "trim" = drop
# values > 3 st from the window median before the SD.
import json, sys
import numpy as np
sys.path.insert(0, __import__("os").path.dirname(__import__("os").path.abspath(__file__)))
from steady_real import load, REFS, SESS
from steady_lib import det_times, st

args = [a for a in sys.argv[1:] if not a.startswith("--")]
O = dict(a[2:].split("=", 1) for a in sys.argv[1:] if a.startswith("--") and "=" in a)
MINREF = float(O.get("minref", "0.6")); MINN = int(O.get("minn", "8"))
STAGES = O.get("stages", "post,paint,ro").split(",")
BINS = [(0, 0.5), (0.5, 1.0), (1.0, 2.0), (2.0, 99)]


def sd(x, trim=False):
    if len(x) < 4: return np.nan
    if trim:
        x = x[np.abs(x - np.median(x)) <= 3]
        if len(x) < 4: return np.nan
    return float(np.std(x))


def run(tag):
    rows = []
    for ss in SESS:
        z = np.load(f"{REFS}/{ss}.npz")
        m, c = load(tag, "sessions", ss)
        t = z["t"]
        for spk, code in (("alice", 1), ("second", 2)):
            own = z["spk"] == code
            ac = np.where(own & (z["ac"] >= 60), z["ac"], 0)
            cc = np.where(own & (z["cc"] >= 60), z["cc"], 0)
            D = {}
            for s in STAGES:
                v = c[s]; D[s] = (det_times(len(v), m["hopS"], m["L"], s), v)
            starts = np.arange(0, t[-1] - 1, 0.25)
            i0 = np.searchsorted(t, starts); i1 = np.searchsorted(t, starts + 1.0)
            for a, lo, hi in zip(starts, i0, i1):
                if hi - lo < 50 or own[lo:hi].mean() < 0.95: continue
                vr = ac[lo:hi]; tr = t[lo:hi]
                if (vr > 0).mean() < MINREF: continue
                vc = cc[lo:hi]
                j = (vr > 0) & (vc > 0)
                if j.any() and np.max(np.abs(1200 * np.log2(vc[j] / vr[j]))) > 300:
                    rows.append({"ss": ss, "spk": spk, "disputed": 1}); continue
                xr = st(vr[vr > 0])
                row = {"ss": ss, "spk": spk, "a": float(a), "disputed": 0, "ref": sd(xr), "ref_t": sd(xr, True), "ref_hz": float(np.median(vr[vr > 0]))}
                ests = {"cc": (tr, vc)}
                ests.update({s: D[s] for s in STAGES})
                for s, (td, v) in ests.items():
                    j0, j1 = np.searchsorted(td, a), np.searchsorted(td, a + 1.0)
                    tt, vd = td[j0:j1], v[j0:j1]
                    ok = vd > 0
                    if ok.sum() >= MINN:
                        x = st(vd[ok])
                        row[f"{s}|own"] = sd(x); row[f"{s}|own_t"] = sd(x, True)
                        # edge-trimmed: drop values within E hops of a voicing boundary of the estimator's own stream
                        E = 2 if s != "cc" else 5
                        vv = v > 0
                        idx = np.arange(j0, j1)[ok]
                        keep = np.array([vv[max(0, i - E):i + E + 1].all() for i in idx])
                        if keep.sum() >= MINN:
                            row[f"{s}|own_e"] = sd(st(vd[ok][keep]), True)
                        rr = np.interp(tt[ok], tr[vr > 0], vr[vr > 0])
                        e = 1200 * np.log2(vd[ok] / rr)
                        row[f"{s}|gross"] = float(np.mean(np.abs(e) > 300))
                    # joint: estimator value nearest each AC-voiced ref frame
                    if len(tt):
                        k = np.clip(np.searchsorted(tt, tr[vr > 0]), 0, len(tt) - 1)
                        kk = np.where((k > 0) & (np.abs(tt[np.maximum(k - 1, 0)] - tr[vr > 0]) < np.abs(tt[k] - tr[vr > 0])), k - 1, k)
                        vj = vd[kk]
                        okj = vj > 0
                        if okj.sum() >= MINN:
                            row[f"{s}|joint"] = sd(st(vj[okj])); row[f"{s}|joint_t"] = sd(st(vj[okj]), True)
                            row[f"{s}|jointref"] = sd(st(vr[vr > 0][okj])); row[f"{s}|jointref_t"] = sd(st(vr[vr > 0][okj]), True)
                rows.append(row)
    return rows


def summ(rows, spk, est, kind, ho=False):
    R = [r for r in rows if r["spk"] == spk and (not ho or r["ss"] == "2026-06-09")]
    nd = sum(r["disputed"] for r in R)
    R = [r for r in R if not r["disputed"]]
    refk = {"own": "ref", "own_t": "ref_t", "own_e": "ref_t", "joint": f"{est}|jointref", "joint_t": f"{est}|jointref_t"}[kind]
    out = [f"win {len(R):5d} (+{nd} disputed)"]
    have = [r for r in R if f"{est}|{kind}" in r and np.isfinite(r[f"{est}|{kind}"]) and np.isfinite(r.get(refk, np.nan))]
    out.append(f"cov {100*len(have)/max(1,len(R)):5.1f}%")
    for lo, hi in BINS:
        H = [r for r in have if lo <= r[refk] < hi]
        if len(H) < 3: out.append(f"[{lo}-{hi}) n<3"); continue
        ref = np.array([r[refk] for r in H]); det = np.array([r[f"{est}|{kind}"] for r in H]); d = det - ref
        g = np.mean([r.get(f"{est}|gross", 0) > 0 for r in H])
        out.append(f"[{lo}-{hi}) n {len(H):4d} med {np.median(d):+.3f} MAE {np.mean(np.abs(d)):.3f} p90 {np.quantile(np.abs(d), .9):.3f} <.1 {100*np.mean(np.abs(d)<.1):3.0f}% ratio {np.median(det/ref):.2f} gross {100*g:3.0f}%")
    H = [r for r in have if r[refk] < 2]
    if len(H) > 3:
        ref = np.array([r[refk] for r in H]); det = np.array([r[f"{est}|{kind}"] for r in H])
        out.append(f"r(<2st) {np.corrcoef(ref, det)[0,1]:.3f}")
    return " | ".join(out)


if __name__ == "__main__":
    for tag in args:
        rows = run(tag)
        if "json" in O: json.dump(rows, open(O["json"].replace("TAG", tag), "w"))
        for spk in ("alice", "second"):
            for ho in (False, True):
                print(f"\n#### {tag} {spk} {'HELD-OUT 2026-06-09' if ho else '4 sessions'}; minref {MINREF}")
                for kind in ("own", "own_t", "own_e", "joint", "joint_t"):
                    for est in ["cc"] + STAGES:
                        print(f"  {kind:6s} {est:5s} {summ(rows, spk, est, kind, ho)}")
