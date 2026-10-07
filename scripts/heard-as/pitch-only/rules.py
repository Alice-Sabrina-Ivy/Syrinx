"""Evaluate every pre-registered rule configuration (PREREG.md §3-5) on features.pkl.

python rules.py            -> rules_all.csv (every config x split), report.txt
"""
import math, pickle, itertools, json, sys
import numpy as np, pandas as pd

F = pickle.load(open("features.pkl", "rb"))
GAP, LN0 = 0.4451, 4.8035
B_F0, B_M = -3.5373482236362848, -0.349098302736368
ST = 12 / math.log(2)

# ---- listener two-way shares ("man + unsure/2") per pitch-only condition (PREREG §4)
HCS = dict(MUS=99.6, MPO=65.7, MPE=18.1, MEO=81.1, WUS=0.4, WPO=19.1, WPE=82.1, WEO=11.7)
HCC = dict(MUS=97.5, MPO=43.7, MPE=18.3, MEO=78.7, WUS=3.0, WPO=68.2, WPE=92.3, WEO=21.7)
PICKA = {"meyer": {(-6, 0.0): 6.3, (-12, 0.0): 54.8}, "jebens": {(-6, 0.0): 26.0, (-12, 0.0): 65.1}, "nagels": {(-6, 0.0): 6.7, (-12, 0.0): 45.0}}
RB = dict(google=89.5, s2_cleanmint=52.4, s2_mintyclean=52.4, s5_cleansoft=70.6, s5_softsoap=70.6)


def kind(m):
    st = m["set"]
    if st in ("nat", "ptdb"):
        return "natural"
    if st in ("hcs", "hcc"):
        return {"US": "control", "PO": "pitch", "PE": "together", "EO": "resonance"}[m["cond"]]
    if st == "picka":
        d = (m["df0"], m["dvtl"])
        if d == (0, 0.0):
            return "control"
        if d[1] == 0.0:
            return "pitch"
        if d[0] == 0:
            return "resonance"
        return "together"
    if st == "rb":
        return "pitch"


def listener(m, ref="meyer"):
    st = m["set"]
    if st == "hcs":
        return HCS[m["lcond"]]
    if st == "hcc":
        return HCC[m["lcond"]]
    if st == "picka":
        return PICKA[ref].get((m["df0"], m["dvtl"]))
    if st == "rb":
        return RB[m["spk"]]


def base_dir(m):
    """male base -> pitch raised; female base -> lowered."""
    return "male" if m["sex"] == "m" else "female"


# ---- expressive selection (pitch only; PREREG §4) -- written once, never changed afterwards
nat = [f for f in F.values() if f["meta"]["set"] == "nat"]
EXPR = set()
for sex in ("f", "m"):
    xs = sorted([f for f in nat if f["meta"]["sex"] == sex], key=lambda f: -f["spread"])[:5]
    EXPR |= {f["key"] for f in xs}


def condition(f, rule, p):
    P = f["P8"] if p.get("pitch", "P8") == "P8" else f["P5v"]
    dPl = P - f["P0"]
    dR = f["u"] - f["R0"]
    with np.errstate(invalid="ignore"):
        if rule == "a":
            c = (np.abs(dPl * ST) >= p["X"]) & (np.abs(dR) <= p["Y"])
        elif rule == "d":
            dPu = dPl / GAP
            c = (np.abs(dPu) >= p["Xu"]) & (np.sign(dPu) * (dPu - dR) >= p["T"])
        elif rule == "b":
            eF = B_F0 * (f["P8"] - f["P0"])
            eM = B_M * (f["M"] - f["M0"])
            c = (np.abs(eF) >= p["A"]) & (np.sign(eF) * eM <= p["B"] * np.abs(eF))
        elif rule == "c":
            uF = (f["P8"] - LN0) / GAP
            c = np.abs(uF - f["u"]) > p["C"]
    c = np.nan_to_num(c, nan=0).astype(bool) & f["elig"]
    # warning on at tick i iff condition at the last K ticks, all eligible & consecutive
    K = p["K"]
    on = np.zeros(len(c), bool)
    run = 0
    for i in range(len(c)):
        run = run + 1 if c[i] else 0
        on[i] = run >= K
    return on


def configs():
    for X, Y, pt, K in itertools.product([3, 4, 5, 6], [0.3, 0.45, 0.6], ["P8", "P5v"], [1, 2]):
        yield "a", dict(X=X, Y=Y, pitch=pt, K=K)
    for Xu, T, pt, K in itertools.product([0.4, 0.5, 0.65, 0.8], [0.4, 0.55, 0.7, 0.85], ["P8", "P5v"], [1, 2]):
        yield "d", dict(Xu=Xu, T=T, pitch=pt, K=K)
    for A, B, K in itertools.product([1.0, 1.5, 2.0, 2.5], [0, 0.25, 0.5], [1, 2]):
        yield "b", dict(A=A, B=B, K=K)
    for C, K in itertools.product([0.5, 0.75, 1.0, 1.25], [1, 2, 3]):
        yield "c", dict(C=C, K=K)


def shown_estimate(f):
    """Median panel s over visible ticks with t >= tshift + 10 s; None if < 3 such ticks."""
    m = f["vis"] & (f["t"] >= f["tshift"] + 10)
    return float(np.median(f["s"][m]) * 100) if m.sum() >= 3 else None


def failure_sessions(ref="meyer"):
    out = []
    for f in F.values():
        m = f["meta"]
        if m["set"] == "nat" or m["set"] == "ptdb" or kind(m) != "pitch":
            continue
        L = listener(m, ref)
        e = shown_estimate(f)
        if L is None or e is None:
            continue
        err = e - L
        if abs(err) >= 20:
            # optimistic = panel shows MORE change toward the target than listeners heard
            opt = (err < 0) if m["sex"] == "m" else (err > 0)
            out.append((f["key"], base_dir(m), err, "optimistic" if opt else "pessimistic"))
    return out


def eval_config(rule, p, split, ref="meyer"):
    def insplit(f):
        return split == "all" or f["meta"]["split"] == split
    R = {}
    # hits
    fails = failure_sessions(ref)
    for d in ("male", "female"):
        ks = [k for k, dd, _, _ in fails if dd == d and insplit(F[k])]
        h = h8 = 0
        pers = []
        for k in ks:
            f = F[k]; on = condition(f, rule, p); t = f["t"]; ts = f["tshift"]
            pre = np.where(f["elig"] & (t <= ts))[0]
            fresh = len(pre) == 0 or not on[pre[-1]]
            w = (t > ts) & (t <= ts + 10)
            h += bool(fresh and on[w].any())
            h8 += bool(fresh and on[(t > ts) & (t <= ts + 8)].any())
            post = f["elig"] & (t >= ts + 10)
            if post.any():
                pers.append(on[post].mean())
        R[f"hit_{d}"] = h / len(ks) if ks else np.nan
        R[f"hit8_{d}"] = h8 / len(ks) if ks else np.nan
        R[f"n_{d}"] = len(ks)
        R[f"pers_{d}"] = float(np.mean(pers)) if pers else np.nan
    # natural FA (nat set, reader-balanced, per sex)
    for sex in ("f", "m"):
        v, va, ve = [], [], []
        for f in F.values():
            m = f["meta"]
            if m["set"] != "nat" or m["sex"] != sex or not insplit(f):
                continue
            on = condition(f, rule, p)
            if f["elig"].any():
                v.append(on[f["elig"]].mean())
            if f["vis"].any():
                va.append(on[f["vis"]].mean())
        R[f"fa_{sex}"] = float(np.mean(v)) if v else np.nan
        R[f"fa_max_{sex}"] = float(np.max(v)) if v else np.nan
        R[f"fa_vis_{sex}"] = float(np.mean(va)) if va else np.nan
        # expressive: dev + test pooled always
        ex = []
        for k in EXPR:
            f = F.get(k)
            if f is None or f["meta"]["sex"] != sex:
                continue
            on = condition(f, rule, p)
            if f["elig"].any():
                ex.append(on[f["elig"]].mean())
        R[f"ex_{sex}"] = float(np.mean(ex)) if ex else np.nan
    # together / resonance-only guards, per base sex; shift sessions' baseline FA (reported)
    for kd in ("together", "resonance", "control"):
        for sex in ("f", "m"):
            v = []
            for f in F.values():
                m = f["meta"]
                if m["set"] in ("nat", "ptdb") or kind(m) != kd or m["sex"] != sex or not insplit(f):
                    continue
                on = condition(f, rule, p)
                post = f["elig"] & (f["t"] >= f["tshift"] + 10)
                if post.any():
                    v.append(on[post].mean())
            R[f"{kd}_{sex}"] = float(np.mean(v)) if v else np.nan
    for sex in ("f", "m"):
        v = []
        for f in F.values():
            m = f["meta"]
            if m["set"] not in ("hcs", "picka") or m["sex"] != sex or not insplit(f):
                continue
            on = condition(f, rule, p)
            pre = f["elig"] & (f["t"] <= f["tshift"])
            if pre.any():
                v.append(on[pre].mean())
        R[f"basefa_{sex}"] = float(np.mean(v)) if v else np.nan
    v = []
    for f in F.values():
        if f["meta"]["set"] == "ptdb" and f["elig"].any():
            v.append(condition(f, rule, p)[f["elig"]].mean())
    R["ptdb_fa"] = float(np.mean(v)) if v else np.nan
    return R


def passes(R, pooled_dirs=None):
    c1 = all((R[f"hit_{d}"] >= 0.6) if not (pooled_dirs and d in pooled_dirs) else True for d in ("male", "female"))
    c2 = R["fa_f"] <= 0.05 and R["fa_m"] <= 0.05
    c3 = R["ex_f"] <= 0.10 and R["ex_m"] <= 0.10
    c4 = all((np.isnan(R[f"together_{s}"]) or R[f"together_{s}"] <= 0.15) for s in ("f", "m"))
    c5 = all((np.isnan(R[f"resonance_{s}"]) or R[f"resonance_{s}"] <= 0.10) for s in ("f", "m"))
    return dict(c1=c1, c2=c2, c3=c3, c4=c4, c5=c5, all=c1 and c2 and c3 and c4 and c5)


if __name__ == "__main__":
    rows = []
    for rule, p in configs():
        for split in ("dev", "test", "all"):
            R = eval_config(rule, p, split)
            P = passes(R)
            rows.append(dict(rule=rule, params=json.dumps(p), split=split, **R, **{f"pass_{k}": v for k, v in P.items()}))
    df = pd.DataFrame(rows)
    df.to_csv("rules_all.csv", index=False)
    print(len(df), "rows")
