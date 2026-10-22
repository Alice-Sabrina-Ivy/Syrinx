"""Coefficient sensitivity to the fit-set composition and weighting."""
import numpy as np
from data import *
H = set_target(load(), "half"); H = H[H[CUE].notna().all(axis=1) & H.y.notna()]
MAIN = ["palette", "meyer-ls", "skuk", "hc-concat", "hc-sent", "rb695"]
OUT = []
ref = None
for lab, fs, wm in [("main (shipped)", MAIN, "sqrt"), ("equal source weights", MAIN, "equal"),
                    ("without Skuk (thin VCVs)", [s for s in MAIN if s != "skuk"], "sqrt"),
                    ("without H&C concat (H95-derived audio)", [s for s in MAIN if s != "hc-concat"], "sqrt"),
                    ("without both H&C sets", [s for s in MAIN if not s.startswith("hc")], "sqrt"),
                    ("without RB695 (vendor TTS audio)", [s for s in MAIN if s != "rb695"], "sqrt"),
                    ("without Meyer", [s for s in MAIN if s != "meyer-ls"], "sqrt")]:
    F = H[H.fset.isin(fs)]
    m = fitp(F, wmode=wm); a, b, c = raw_coefs(m.p)
    probe = [(-4, 110), (-1, 150), (1, 165), (3, 200)]
    e = [a + b * x + c * np.log(f) for x, f in probe]
    if ref is None: ref = e
    s = f"{lab:42s} a {a:+7.3f} b {b:+.4f} c {c:+.4f} | eta at probes " + " ".join(f"{v:+.2f}" for v in e) + \
        f" | max |d eta| vs shipped {max(abs(x - y) for x, y in zip(e, ref)):.2f}"
    print(s); OUT.append(s)
open("sens.txt", "w", encoding="utf-8").write("\n".join(OUT))
