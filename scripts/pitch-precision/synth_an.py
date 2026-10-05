# synth_an.py TAG — 1-s SD agreement (truth = smooth synthetic contour) of the
# posted and painted values from synth-chain.mjs dumps build/prec/sc_TAG_*.json,
# overall, by truth-SD bin, by register x contour kind and by SNR.
import json, sys, glob
import numpy as np
sys.path.insert(0, __import__("os").path.dirname(__import__("os").path.abspath(__file__)))
from steady_lib import *

tag = sys.argv[1] if len(sys.argv) > 1 else "base"
items = []
for f in sorted(glob.glob(f"build/prec/sc_{tag}_*.json")):
    items += json.load(open(f))
rows = {s: [] for s in ("post", "paint")}
rows_b = {}
for it in items:
    tr, fr = np.array(it["tTruth"]), np.array(it["fTruth"])
    for s in ("post", "paint"):
        v = np.array(it[s], float)
        t = det_times(len(v), it["hop"], it["L"], s)
        w = windows(tr, fr, t, v, it["pre"] + 0.5, it["pre"] + it["dur"] - 0.1)
        for r in w:
            rows[s].append(r)
            band = "lo" if it["f0"] < 160 else "hi"
            rows_b.setdefault((s, band, it["kind"]), []).append(r)
            rows_b.setdefault((s, "snr", it["snrDb"]), []).append(r)
for s in ("post", "paint"):
    print(f"== {s}")
    print("  all          ", fmt(agree(rows[s])))
    for lo, hi in ((0, 0.15), (0.15, 0.3), (0.3, 0.5), (0.5, 0.8), (0.8, 1.2), (1.2, 9)):
        print(f"  ref {lo}-{hi}".ljust(15), fmt(agree(rows[s], lo, hi)))
    for k in sorted(rows_b, key=str):
        if k[0] == s:
            print("  ", k, fmt(agree(rows_b[k])))
