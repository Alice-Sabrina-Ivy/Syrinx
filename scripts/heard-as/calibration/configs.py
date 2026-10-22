"""Step 1: choose target convention and fit set. Form A (meter_logit + lnF0) only.
For each config: coefficients, LOSO MAE per fit source (offset 0 for the held-out source),
and validation MAE (full fit, offset 0) on the held-out-by-licence sources. Writes configs.txt."""
import numpy as np, pandas as pd
from data import *

OUT = []
say = lambda *a: (print(*a), OUT.append(" ".join(str(x) for x in a)))
H0 = load()
SETS = {
    "main": ["palette", "meyer-ls", "skuk", "hc-concat", "hc-sent", "rb695"],
    "no-skuk": ["palette", "meyer-ls", "hc-concat", "hc-sent", "rb695"],
    "+bmmb": ["palette", "meyer-ls", "skuk", "hc-concat", "hc-sent", "rb695", "bmmb"],
    "palette-only": ["palette"],
}
VAL = ["picka-jebens-ls", "picka-jebens-vnt-sent", "picka-nagels-ls", "hc-syl", "libritts-p", "mooshammer"]
rows = []
for tgt in ["half", "afc"]:
    H = set_target(H0, tgt)
    for name, fs in SETS.items():
        F = H[H.fset.isin(fs) & H[CUE].notna().all(axis=1) & H.y.notna()].reset_index(drop=True)
        full = fitp(F)
        a, bm, bf = raw_coefs(full.p)
        say(f"\n== target {tgt} | fit set {name} ({len(F)} stimuli, {F.unit.nunique()} listener data) ==")
        say(f"  eta = {a:+.3f} {bm:+.4f}*meter_logit {bf:+.4f}*lnF0 ; offsets " +
            ", ".join(f"{k} {v:+.2f}" for k, v in full.off.items()))
        lo = []
        for s in fs if len(fs) > 1 else []:
            m = fitp(F[F.fset != s])
            U = ustats(F[F.fset == s], m(F[F.fset == s]))
            o = summ(U)
            lo.append(U)
            say(f"   LOSO {s:10s} {fmt(o)}")
            rows.append(dict(tgt=tgt, set=name, eval="LOSO " + s, **{f"{k}_mae": v[0] for k, v in o.items()}))
        if lo:
            U = pd.concat(lo)
            sm = U.groupby("fset").apply(lambda u: np.abs(u.pred - u.y).mean())
            o = summ(U)
            say(f"   LOSO pooled   {fmt(o)} | mean of source MAEs {sm.mean():.1f}")
            rows.append(dict(tgt=tgt, set=name, eval="LOSO mean", all_mae=sm.mean(),
                             fem_mae=o.get('fem', [np.nan])[0], masc_mae=o.get('masc', [np.nan])[0]))
        V = H[(H.vset != "") & H[CUE].notna().all(axis=1)].copy()
        vm = []
        for v in VAL:
            d = V[V.vset == v]
            yc = "y_half" if tgt == "half" else "y_afc"
            U = ustats(d.assign(fset=""), full(d), yc)
            o = summ(U)
            vm.append(o["all"][0])
            say(f"   VAL  {v:22s} {fmt(o)}")
            rows.append(dict(tgt=tgt, set=name, eval="VAL " + v, **{f"{k}_mae": vv[0] for k, vv in o.items()}))
        say(f"   VAL mean of source MAEs {np.mean(vm):.1f}")
pd.DataFrame(rows).to_csv("configs.csv", index=False)
open("configs.txt", "w", encoding="utf-8").write("\n".join(OUT))
