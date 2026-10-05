# jumps.py CFG [CFG...] — readout behaviour on the synthetic jump / siren
# cases: windows whose truth contains both notes (truth SD > 1 st) are
# classified as refused ("—" or held) / large reading (>= 1 st) / small
# "steady-looking" reading (< 1 st, the misleading case).
import json, glob, sys
import numpy as np
LAT = 0.040
cases = [c for f in sorted(glob.glob("build/steady/synth/cases_*.json")) for c in json.load(open(f)) if c["fam"] in ("jump", "siren")]
for cfg in sys.argv[1:]:
    W = json.load(open("build/steady/sim/configs.json"))[cfg]["windowSec"]
    acc = {}
    for c in cases:
        a = np.fromfile(f"build/steady/sim/{cfg}/synth/c{c['id']}.f32", dtype=np.float32); n = len(a) // 2
        v, h = a[:n], a[n:]
        tt, ff = np.array(c["tTruth"]), np.array(c["fTruth"])
        key = (c["fam"], c["contour"]["k"], c["contour"].get("st", c["contour"].get("amp")), "glide" if c["contour"].get("glide") else "")
        d = acc.setdefault(key, [0, 0, 0, 0])
        for k in range(n):
            T = (k + 1) * c["hop"]
            m = (tt > T - W - LAT) & (tt <= T - LAT)
            if m.sum() < 0.95 * W / 0.005: continue
            x = 12 * np.log2(ff[m][ff[m] > 0])
            if len(x) < 10 or np.std(x) <= 1: continue
            d[0] += 1
            if not np.isfinite(v[k]) or h[k]: d[1] += 1
            elif v[k] >= 1: d[2] += 1
            else: d[3] += 1
    print(f"== {cfg}: windows spanning both notes / a wide sweep (truth SD > 1 st)")
    for k, d in sorted(acc.items(), key=str):
        print(f"  {str(k):34s} n {d[0]:4d}  refused {100*d[1]/max(d[0],1):5.1f}%  large {100*d[2]/max(d[0],1):5.1f}%  small(<1 st) {100*d[3]/max(d[0],1):5.1f}%")
