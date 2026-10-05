# score_corpora.py — mir_eval-style scoring of every detector on the four
# ground-truth corpora, with a per-detector x corpus time-offset sweep.
#
# Usage: python scripts/pitch-benchmark/score_corpora.py [--dets=a,b,...] [--penn-thr=X]
# Writes <WORK>/out/scores_corpora.json, prints one line per detector x corpus.
#
# Conventions
#   Reference frame i of a track describes t = i*refHop + refOffset
#   (PTDB-TUG +20 ms; CLAUDE.md binding rule). Refs < 50 Hz are treated as
#   unvoiced (none exist in practice).
#   Each detector's frames carry the detector's own centre-time convention
#   (detectors.py / swift.py / syrinx_corpus.mjs). For offset d the
#   detector's frames are placed at (time + d) and resampled to the reference
#   times mir_eval-style: log-linear interpolation between two voiced frames,
#   nearest frame otherwise (so a 25 ms-hop detector is not penalised for
#   holding a value between hops); unvoiced beyond one detector hop. d is swept -100..+100 ms in 5 ms steps, pooled per corpus; the best
#   d maximises RPA. Positive d = the detector's own timestamps were early
#   (the value appears later than claimed).
#   Metrics over reference-voiced frames (ref > 0):
#     RPA   est voiced and |cents| < 50          RCA  same, octave-wrapped
#     C5    est voiced and |est/ref - 1| < 0.05  (the project's "± 5 % correct")
#     down  est/ref within the project's x1/2 (|q-.5|<=.05) or x1/3 (|q-1/3|<=.0333) classes
#     up    x2 (|q-2|<=.2) or x3/x4 (|q-3|<=.3, |q-4|<=.4)
#     null  est unvoiced
#   GPE  among frames voiced in both: |est/ref - 1| > 0.2
#   FPE  std of the cents error among frames voiced in both with |q-1| <= 0.2
#   VDE  over ALL reference frames of the track set: voicing disagreement
#   RPAraw  pitch-only (published-paper convention): the detector's raw pitch
#           (its best guess even on frames it calls unvoiced) within 50 cents,
#           for detectors that expose one (pYIN, PENN, CREPE, SwiftF0); else = RPA.
import sys, os, json
import numpy as np

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from paths import DATA, OUT
A = dict((a[2:].split("=", 1) + ["1"])[:2] for a in sys.argv[1:] if a.startswith("--"))
CORPORA = ["fda", "ptdb", "voc", "hil"]
INDEX = json.load(open(os.path.join(DATA, "index.json")))
OFFSETS = np.arange(-100, 101, 5) / 1000.0
BANDS = [("<75", 0, 75), ("75-160", 75, 160), ("160-300", 160, 300), ("300-400", 300, 400), (">=400", 400, 1e9), ("all", 0, 1e9)]
PENN_THR = float(A.get("penn-thr", "0.1"))  # chosen on FDA+vocadito VDE (PENN not trained on them); README .065 sits below this version's 0.071 periodicity floor

SYRINX = {  # name -> (tag, stage)
    "syrinx_main": ("main", "post"), "syrinx_new": ("new", "post"), "syrinx_new600": ("new600", "post"),
    "syrinx_main_disp": ("main", "paint"), "syrinx_new_disp": ("new", "paint"), "syrinx_new600_disp": ("new600", "paint"),
}
PY = ["praat_ac", "praat_ac_cal", "praat_cc", "pyin", "penn", "crepe_full", "crepe_tiny", "swift_offline", "swift_stream", "swift_offline_g09"]
DETS = A["dets"].split(",") if "dets" in A else list(SYRINX) + PY


def load_refs(c):
    out = {}
    for tr in INDEX:
        if tr["corpus"] != c: continue
        r = np.fromfile(os.path.join(DATA, c, tr["trackId"] + ".ref.f32"), dtype=np.float32).astype(float)
        r[r < 50] = 0
        t = np.arange(len(r)) * tr["refHopMs"] / 1000 + tr["refOffsetMs"] / 1000
        out[tr["trackId"]] = (tr["gender"], t, r)
    return out


def load_est(det, c):
    """-> {trackId: (t, f_gated, f_raw_or_None)}"""
    out = {}
    if det in SYRINX:
        tag, stage = SYRINX[det]
        d = os.path.join(OUT, "syrinx", tag)
        meta = {}
        for fn in os.listdir(d):
            if fn.startswith(c + ".") and fn.endswith(".json"): meta.update(json.load(open(os.path.join(d, fn))))
        for tid, m in meta.items():
            a = np.fromfile(os.path.join(d, c, tid + ".f32"), dtype=np.float32).reshape(4, m["n"]).astype(float)
            k = np.arange(m["n"]); h = m["hopS"]
            if stage == "post": t, f = (k + 1) * h - 0.040, a[0]
            else: t, f = (k + 1) * h - 0.040 - m["L"] * h - 0.030, a[1]
            out[tid] = (t, f, None)
        return out
    gate = None
    if det.endswith("_g09"): det, gate = det[:-4], 0.9   # SwiftF0 at the upstream default gate
    p = os.path.join(OUT, det, f"{c}.npz")
    if not os.path.exists(p): return None
    z = np.load(p)
    for k in z.files:
        if not k.endswith("|t"): continue
        tid = k[:-2]
        f = z[tid + "|f"]; raw = z[tid + "|r"] if tid + "|r" in z.files else None
        if det == "penn" and np.isfinite(PENN_THR): f = np.where(z[tid + "|p"] >= PENN_THR, raw, 0.0)
        if gate is not None: f = np.where(z[tid + "|p"] >= gate, raw, 0.0)
        out[tid] = (z[k], f, raw)
    return out


def align(te, fe, tr, d):
    """est value at each ref time tr for offset d (frames at te+d). mir_eval-
    style resampling: between two voiced frames the pitch is interpolated
    linearly in log-frequency; otherwise the nearest frame's value (voicing
    by nearest frame). Unvoiced beyond one detector hop of the last frame."""
    n = len(te)
    if n == 0: return np.zeros(len(tr))
    ts = te + d
    if n == 1: return np.where(np.abs(ts[0] - tr) <= 0.05, fe[0], 0.0)
    hop = float(np.median(np.diff(te)))
    j = np.clip(np.searchsorted(ts, tr), 1, n - 1)
    a, b = ts[j - 1], ts[j]
    fa, fb = fe[j - 1], fe[j]
    w = np.clip((tr - a) / np.where(b > a, b - a, 1), 0, 1)
    near = np.where(w <= 0.5, fa, fb)
    both = (fa > 0) & (fb > 0)
    interp = np.exp(np.log(np.where(fa > 0, fa, 1)) * (1 - w) + np.log(np.where(fb > 0, fb, 1)) * w)
    v = np.where(both, interp, near)
    dist = np.minimum(np.abs(tr - a), np.abs(tr - b))
    return np.where(dist <= hop, v, 0.0)


def classes(e, r):
    ev = e > 0
    q = np.where(ev, e / np.where(r > 0, r, 1), 0)
    cents = np.where(ev, 1200 * np.log2(np.where(ev, e, 1) / r), np.inf)
    wrapped = np.abs(cents - 1200 * np.round(cents / 1200))
    return dict(
        rpa=ev & (np.abs(cents) < 50), rca=ev & (wrapped < 50), c5=ev & (np.abs(q - 1) < 0.05),
        down=ev & ((np.abs(q - 0.5) <= 0.05) | (np.abs(q - 1 / 3) <= 0.0333)),
        up=ev & ((np.abs(q - 2) <= 0.2) | (np.abs(q - 3) <= 0.3) | (np.abs(q - 4) <= 0.4)),
        null=~ev, cents=cents, q=q)


def score_det_corpus(det, c, refs):
    est = load_est(det, c)
    if est is None: return None
    keys = [k for k in refs if k in est]
    missing = len(refs) - len(keys)
    R = np.concatenate([refs[k][2] for k in keys])
    G = np.concatenate([np.full(len(refs[k][2]), refs[k][0]) for k in keys])
    # offset sweep (RPA over ref-voiced, pooled)
    best = None; sweep = []
    for d in OFFSETS:
        E = np.concatenate([align(est[k][0], est[k][1], refs[k][1], d) for k in keys])
        v = R > 0
        rpa = float(np.mean(classes(E[v], R[v])["rpa"]))
        sweep.append(rpa)
        if best is None or rpa > best[1] + 1e-12: best = (d, rpa, E)
    d, _, E = best
    has_raw = all(est[k][2] is not None for k in keys)
    Eraw = np.concatenate([align(est[k][0], est[k][2], refs[k][1], d) for k in keys]) if has_raw else E
    res = {"offset_ms": round(d * 1000), "sweep": sweep, "tracks": len(keys), "missing": missing, "groups": {}}
    for g in sorted(set(G)) + ["all"]:
        gm = (G == g) if g != "all" else np.ones(len(G), bool)
        vde = float(np.mean((E[gm] > 0) != (R[gm] > 0)))
        for bn, lo, hi in BANDS:
            m = gm & (R > 0) & (R >= lo) & (R < hi)
            n = int(m.sum())
            if n == 0: continue
            K = classes(E[m], R[m]); Kr = classes(Eraw[m], R[m])
            both = E[m] > 0
            q = K["q"][both]; ce = K["cents"][both]
            gpe = float(np.mean(np.abs(q - 1) > 0.2)) if both.any() else float("nan")
            fine = np.abs(q - 1) <= 0.2
            fpe = float(np.std(ce[fine])) if fine.sum() > 1 else float("nan")
            res["groups"][f"{g}|{bn}"] = dict(n=n, RPA=100 * K["rpa"].mean(), RCA=100 * K["rca"].mean(), C5=100 * K["c5"].mean(),
                                            down=100 * K["down"].mean(), up=100 * K["up"].mean(), null=100 * K["null"].mean(),
                                            GPE=100 * gpe, FPE=fpe, RPAraw=100 * Kr["rpa"].mean(),
                                            VDE=100 * vde if bn == "all" else None)
    return res


if __name__ == "__main__":
    REFS = {c: load_refs(c) for c in CORPORA}
    path = os.path.join(OUT, "scores_corpora.json")
    allres = json.load(open(path)) if os.path.exists(path) and "dets" in A else {}
    for det in DETS:
        allres[det] = {}
        for c in CORPORA:
            r = score_det_corpus(det, c, REFS[c])
            if r is None: continue
            allres[det][c] = r
            a = r["groups"].get("all|all")
            print(f"{det:20s} {c:5s} off {r['offset_ms']:+4d} ms  RPA {a['RPA']:6.2f} C5 {a['C5']:6.2f} RCA {a['RCA']:6.2f} GPE {a['GPE']:5.2f} FPE {a['FPE']:5.1f} VDE {a['VDE']:5.2f} dn {a['down']:4.2f} up {a['up']:4.2f} null {a['null']:5.2f} raw {a['RPAraw']:6.2f} (tracks {r['tracks']}, missing {r['missing']})", flush=True)
    json.dump(allres, open(path, "w"), indent=0)
