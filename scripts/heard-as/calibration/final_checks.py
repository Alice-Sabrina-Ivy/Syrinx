"""Step 6: checks at the chosen display constants (w, k, f, split rule)."""
import json, numpy as np, pandas as pd
from data import *
OUT = []
say = lambda *a: (print(*a), OUT.append(" ".join(str(x) for x in a)))
LO = pd.read_csv("units_loso.csv", index_col=0)
VU = pd.read_csv("units_val.csv", index_col=0)
# The width is SELECTED on licence-clean held-out data only: the fit sources
# leave-one-source-out (Palette, Skuk, Meyer: CC BY; RB695 listener data:
# CC BY; Hillenbrand & Clark published rates: facts) plus hc-syl (the H&C
# syllable condition, facts). The CC BY-NC-SA PICKA sets (Jebens, Nagels)
# and Mooshammer (no data licence) are reported separately as validation
# and can never enter the selection (licence rule: shipped constants only
# from CC BY / CC0 / MIT / facts).
CLEAN_VAL = ["hc-syl"]
NONCLEAN_VAL = ["picka-jebens-ls", "picka-jebens-vnt-sent", "picka-nagels-ls", "mooshammer"]
def stack(vsets):
    V = VU[VU.vset.isin(vsets)]
    X = pd.concat([LO.assign(set=LO.fset), V.assign(set=V.vset)]) if vsets is CLEAN_VAL else V.assign(set=V.vset)
    X = X.copy(); X["r"] = lg(X.y.values) - X.eta.values
    return X
A = stack(CLEAN_VAL)
assert not A.set.isin(NONCLEAN_VAL).any()
def cover(X, label):
    say(label)
    for w in [1.79, 2.0, 2.25, 2.5]:
        parts = []
        for sd in ["fem", "mid", "masc"]:
            d = X[X.side == sd]
            if not len(d): parts.append(f"{sd} - (n 0)"); continue
            wt = 1 / d.set.map(d.set.value_counts())
            parts.append(f"{sd} {np.average(np.abs(d.r) <= w, weights=wt):.2f} (n {len(d)})")
        say(f"   w {w}: " + ", ".join(parts))
cover(A, "== SELECTION: condition-level held-out coverage by side (source-balanced; licence-clean only: LOSO fit sources + hc-syl) ==")
say("")
cover(stack(NONCLEAN_VAL), "== VALIDATION ONLY (never used to choose w): PICKA Jebens / Nagels (CC BY-NC-SA) + Mooshammer (no data licence) ==")
say("\n== Three-way word on the same held-out listener data (w 2.25) vs what listeners did ==")
w = 2.25
A["word"] = np.where(sig(A.eta - w) > 50, "likely man", np.where(sig(A.eta + w) < 50, "likely woman", "split"))
A["obs"] = pd.cut(A.y, [-1, 30, 50, 70, 101], labels=["<30", "30-50", "50-70", ">70"])
say(pd.crosstab(A.word, A.obs, margins=True).to_string())
say(pd.crosstab(A[A.set != 'palette'].word, A[A.set != 'palette'].obs, margins=True).to_string())
# display table
k, f = 0.42, 0.02
def three(s):
    u = np.maximum(f, k * 4 * s * (1 - s)); u = np.minimum(u, 2 * np.minimum(s, 1 - s))
    return s - u / 2, u, 1 - s - u / 2
say("\n== Display table (w 2.25 on the two-way logit; unsure k 0.42, floor 0.02, even split) ==")
say("   estimate s | two-way range | man share at centre (range) | unsure (centre) | woman share at centre (range)")
for p in [3, 5, 10, 15, 30, 50, 70, 85, 90, 95, 97]:
    e = np.log(p / (100 - p)); lo, hi = sig(e - w) / 100, sig(e + w) / 100; s = p / 100
    mc, uc, wc = three(s); ml, _, wl = three(lo); mh, _, wh = three(hi)
    say(f"   {p:3d} % | {100*lo:4.1f}-{100*hi:4.1f} % | man {100*mc:4.1f} ({100*ml:4.1f}-{100*mh:4.1f}) | unsure {100*uc:4.1f} | woman {100*wc:4.1f} ({100*wh:4.1f}-{100*wl:4.1f})")
open("final_checks.txt", "w", encoding="utf-8").write("\n".join(OUT))
