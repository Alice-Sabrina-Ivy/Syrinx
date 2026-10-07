"""Step 3: the 'unsure' share and how man / unsure / woman are split from the two-way share s.
Model: P_unsure = max(f, k * 4 s (1 - s)). Fitted per source on the observed shares, then the
three-way display is reconstructed from the model's own (held-out) s and compared with what listeners
answered. Writes unsure.txt."""
import json
import numpy as np, pandas as pd
from scipy.optimize import least_squares
from data import *

OUT = []
say = lambda *a: (print(*a), OUT.append(" ".join(str(x) for x in a)))
H = set_target(load(), "half")
H = H[H[CUE].notna().all(axis=1)].reset_index(drop=True)
FIT = json.load(open("fit.json"))
eta_full = lambda d: FIT["a"] + FIT["b_meter"] * d.meter_logit.values + FIT["c_lnf0"] * d.lnf0.values


def obs_table(d, man, woman, uns, src):
    t = pd.DataFrame({"src": src, "man": np.asarray(man, float) / 100, "woman": np.asarray(woman, float) / 100,
                      "uns": np.asarray(uns, float) / 100})
    t["s_half"] = t.man + t.uns / 2
    t["s_afc"] = t.man / (t.man + t.woman)
    return t


P = C.PAL
pal = obs_table(P, P["ALL-Man"], P["ALL-Woman"], P["ALL-OtherGender"] + P["ALL-no"], "palette")
pal_oth = obs_table(P, P["ALL-Man"], P["ALL-Woman"] + P["ALL-no"], P["ALL-OtherGender"], "palette 'other gender' only")
grp = []
for g in ["CHF", "CHM", "GSE"]:
    grp.append(obs_table(P, P[f"{g}-Man"], P[f"{g}-Woman"], P[f"{g}-OtherGender"] + P[f"{g}-no"], f"palette {g}"))
rb = H[H.src == "rb695"].drop_duplicates("unit")
rbt = obs_table(rb, rb.y_raw, 100 - rb.y_raw - rb.y_unsure, rb.y_unsure, "rb695 (7-pt midpoint)")
mo = H[(H.src == "mooshammer") & H.y_raw.notna()].drop_duplicates("unit")
mot = obs_table(mo, mo.y_raw, 100 - mo.y_raw - mo.y_unsure, mo.y_unsure, "mooshammer (5-pt midpoint) [val]")
lt = H[H.src == "libritts-p"].drop_duplicates("talker")
ltt = obs_table(lt, lt.y_raw, 100 - lt.y_raw - lt.y_unsure, lt.y_unsure, "libritts-p (neutral word, 3 annot.) [val]")
ko = H[(H.src == "kong") & ~H.thin]
kot = obs_table(ko, ko.y_raw, 100 - ko.y_raw - ko.y_unsure, ko.y_unsure, "kong singing ('I don't know') [val]")


def fit_kf(t, scol):
    s = t[scol].values
    u = t.uns.values
    ok = np.isfinite(s) & np.isfinite(u)
    s, u = s[ok], u[ok]
    f = lambda p: np.maximum(p[1], p[0] * 4 * s * (1 - s)) - u
    r = least_squares(f, [0.3, 0.04], bounds=([0, 0], [1, 0.5]))
    k, fl = r.x
    mae = np.abs(f(r.x)).mean()
    mae_prior = np.abs(np.maximum(0.04, 0.28 * 4 * s * (1 - s)) - u).mean()
    return k, fl, mae, mae_prior, len(s)


say("== P_unsure = max(f, k*4s(1-s)) fitted on OBSERVED shares (least squares on the unsure share) ==")
say("   source                                      s = man+unsure/2            s = man/(man+woman)     | MAE of the sweep prior (k .28, f .04)")
KF = {}
for t in [pal, pal_oth] + grp + [rbt, mot, ltt, kot]:
    kh, fh, mh, ph, n = fit_kf(t, "s_half")
    ka, fa, ma, pa, _ = fit_kf(t, "s_afc")
    KF[t.src.iloc[0]] = (kh, fh)
    say(f"   {t.src.iloc[0]:42s} n={n:4d}  k {kh:.2f} f {fh:.3f} MAE {100*mh:4.1f} | k {ka:.2f} f {fa:.3f} MAE {100*ma:4.1f} | prior MAE {100*ph:4.1f}")
# binned view
for t in [pal, rbt]:
    b = pd.cut(t.s_half, [-.01, .05, .2, .4, .6, .8, .95, 1.01])
    say(f"   {t.src.iloc[0]}: mean unsure by observed s(half) bin: " + ", ".join(
        f"{iv.left:.2f}-{iv.right:.2f}: {g.uns.mean():.2f} (n {len(g)})" for iv, g in t.groupby(b, observed=True)))

# pooled licence-clean fit: Palette and RB695 with equal source weight
s_all = np.concatenate([pal.s_half.values, rbt.s_half.values])
u_all = np.concatenate([pal.uns.values, rbt.uns.values])
w_all = np.concatenate([np.full(len(pal), 1 / len(pal)), np.full(len(rbt), 1 / len(rbt))])
r = least_squares(lambda p: np.sqrt(w_all) * (np.maximum(p[1], p[0] * 4 * s_all * (1 - s_all)) - u_all), [0.3, 0.04],
                  bounds=([0, 0], [1, 0.5]))
say(f"   pooled licence-clean (Palette + RB695, equal source weight): k {r.x[0]:.2f}, f {r.x[1]:.3f}")

# ---------------------------------------------------------------- three-way reconstruction from the MODEL's s
say("\n== Three-way display reconstructed from the model's own s (held out), MAE in points per response ==")
say("   split 'even'  : man = s - u/2, woman = 1 - s - u/2 (u capped at 2*min(s, 1-s)) -- the inverse of the 'half' target")
say("   split 'prop'  : man = s(1-u), woman = (1-s)(1-u)")
lo = pd.read_csv("palette_loto.csv")
s_pal = lo.p0.values / 100                       # Palette LOTO, offset 0 (app)
units = pd.read_csv("units_loso.csv")
rbl = units[units.fset == "rb695"].set_index("unit")
s_rb = rbl.loc[rb.unit, "pred"].values / 100     # RB695 LOSO, offset 0
s_mo = 1 / (1 + np.exp(-eta_full(mo)))
s_lt = 1 / (1 + np.exp(-np.array([eta_full(H[(H.src == 'libritts-p') & (H.talker == t)]).mean() for t in lt.talker])))


def three(s, k, f, rule):
    u = np.maximum(f, k * 4 * s * (1 - s))
    if rule == "prop":
        return s * (1 - u), (1 - s) * (1 - u), u
    u = np.minimum(u, 2 * np.minimum(s, 1 - s))
    return s - u / 2, 1 - s - u / 2, u


for lab, s, t in [("palette (LOTO, offset 0)", s_pal, pal), ("rb695 (LOSO, offset 0)", s_rb, rbt),
                  ("mooshammer [val]", s_mo, mot), ("libritts-p per speaker [val]", s_lt, ltt)]:
    for (kk, ff, kl) in [(KF[t.src.iloc[0]][0], KF[t.src.iloc[0]][1], "own k,f"), (0.28, 0.04, "k .28 f .04"),
                         (0.30, 0.04, "k .30 f .04")]:
        res = []
        for rule in ["even", "prop"]:
            m, w, u = three(s, kk, ff, rule)
            res.append(f"{rule}: man {100*np.abs(m - t.man.values).mean():4.1f} woman {100*np.abs(w - t.woman.values).mean():4.1f} "
                       f"unsure {100*np.abs(u - t.uns.values).mean():4.1f}")
        say(f"   {lab:30s} [{kl:11s}] " + " | ".join(res))

# how the observed unsure share compares between groups of listeners on the same Palette stimuli
say("\n   Palette listener groups, peak unsure k (s=man+unsure/2): " + ", ".join(f"{g.src.iloc[0]} {fit_kf(g, 's_half')[0]:.2f}" for g in grp))
json.dump({k: list(v) for k, v in KF.items()} | {"pooled_clean": list(r.x)}, open("unsure.json", "w"), indent=1)
open("unsure.txt", "w", encoding="utf-8").write("\n".join(OUT))
