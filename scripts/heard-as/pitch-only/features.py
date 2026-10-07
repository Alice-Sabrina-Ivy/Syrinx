"""Per-tick causal features for every session (PREREG.md §2) -> features.pkl.

python features.py out/*.jsonl
"""
import sys, json, glob, math, pickle
import numpy as np

LN2 = math.log(2)
GAP = 0.4451
LN0 = 4.8035


def ticks_of(r):
    pitch = np.array(r["pitch"], dtype=float).reshape(-1, 2)
    win = np.array(r["windows"], dtype=float).reshape(-1, 2)
    pt, pf = pitch[:, 0] / 1000.0, pitch[:, 1]
    vt, vf = pt[pf > 0], pf[pf > 0]
    wt, wl = win[:, 0] / 1000.0, win[:, 1]
    T = r["ticks"]
    t = np.array([x["t"] for x in T])
    fill = np.array([x["r"]["fill"] for x in T])
    su = np.array([np.nan if x["r"]["su"] is None else x["r"]["su"] for x in T])
    u = np.array([np.nan if x["r"]["u"] is None else x["r"]["u"] for x in T])
    vd = [x["r"]["vd"] for x in T]
    sr = np.array([x["r"]["sr"] for x in T])
    vis = np.array(["hidden" not in x["e"] for x in T])
    P8 = np.array([x["e"]["f"] if "f" in x["e"] else np.nan for x in T])
    M = np.array([x["e"]["m"] if "m" in x["e"] else np.nan for x in T])
    s = np.array([x["e"]["s"] if "s" in x["e"] else np.nan for x in T])
    # P5v: last 200 posted voiced frames at or before the tick
    P5v = np.full(len(t), np.nan)
    idx = np.searchsorted(vt, t, side="right")
    for i, k in enumerate(idx):
        if k >= 50:
            P5v[i] = math.log(np.median(vf[max(0, k - 200):k]))
    # start window
    i_fill = np.argmax(fill >= 1) if np.any(fill >= 1) else None
    i_start = np.argmax(~np.isnan(su)) if np.any(~np.isnan(su)) else None
    P0 = M0 = np.nan
    t_fill = t_start = np.nan
    if i_fill is not None and i_start is not None:
        t_fill, t_start = t[i_fill], t[i_start]
        m = (vt >= t_fill) & (vt <= t_start)
        if m.sum() >= 20:
            P0 = math.log(np.median(vf[m]))
        mw = (wt >= t_fill) & (wt <= t_start)
        if mw.sum() >= 3:
            M0 = float(np.mean(wl[mw]))
    known = np.zeros(len(t), bool)
    if i_start is not None:
        known[i_start:] = True
    elig = vis & known & ~np.isnan(u) & (fill >= 1) & np.array([v != "sustained" for v in vd]) & (sr >= 2) & ~np.isnan(P0)
    tshift = None
    for b in r["bounds"]:
        if b["phase"] == "shift":
            tshift = b["t0"]
    return dict(key=r["key"], meta=r["meta"], dur=r["dur"], tshift=tshift, t=t, vis=vis, elig=elig, u=u, R0=su,
                P8=P8, P5v=P5v, P0=P0, M=M, M0=M0, s=s, t_fill=t_fill, t_start=t_start,
                spread=(12 * math.log2(np.quantile(vf, 0.9) / np.quantile(vf, 0.1)) if len(vf) > 100 else np.nan),
                medf0=float(np.median(vf)) if len(vf) else np.nan)


if __name__ == "__main__":
    out = {}
    for p in sys.argv[1:]:
        for g in glob.glob(p):
            for line in open(g):
                if line.strip():
                    r = json.loads(line)
                    out[r["key"]] = ticks_of(r)
    pickle.dump(out, open("features.pkl", "wb"))
    print(len(out), "sessions")
