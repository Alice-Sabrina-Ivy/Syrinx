# stability.py CFG [CFG...] — display stability of the readout: sampled at
# the hook's ~200 ms state cadence (every 8th message), the step between
# consecutive FRESH readings (both fresh), and how the one-decimal display
# string changes; plus run lengths of fresh / held / "—" states.
import sys, json, glob, os
import numpy as np
SIM = "build/steady/sim"
for cfg in sys.argv[1:]:
    for s in ("sessions", "voc", "fda", "ptdb"):
        d = []; chg = 0; tot = 0
        for f in glob.glob(f"{SIM}/{cfg}/{s}/*.f32"):
            a = np.fromfile(f, dtype=np.float32); n = len(a) // 2
            v, h = a[:n][7::8], a[n:][7::8]
            fr = np.isfinite(v) & (h == 0)
            both = fr[1:] & fr[:-1]
            d += list(np.abs(np.diff(v))[both])
            sv = np.round(v, 1)
            chg += int((both & (sv[1:] != sv[:-1])).sum()); tot += int(both.sum())
        d = np.array(d)
        print(f"{cfg:8s} {s:8s} consecutive 200-ms fresh steps n {len(d)}: median |d| {np.median(d):.3f} st, p90 {np.quantile(d,.9):.3f}; displayed digit changes {100*chg/max(tot,1):.0f}% of updates")
