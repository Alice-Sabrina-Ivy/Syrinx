# stability.py CFG [CFG...] [--sim=build/steady/sim] — display stability of
# the readout: sampled at the hook's ~200 ms state cadence (every 8th
# message), the step between consecutive FRESH readings (both fresh), how
# the one-decimal display string changes, and how often the display flips
# between a number (fresh or held) and "—" (per minute of audio).
import sys, json, glob, os
import numpy as np
A = dict(a[2:].split("=", 1) for a in sys.argv[1:] if a.startswith("--") and "=" in a)
SIM = A.get("sim", "build/steady/sim")
for cfg in [a for a in sys.argv[1:] if not a.startswith("--")]:
    for s in ("sessions", "voc", "fda", "ptdb"):
        d = []; chg = 0; tot = 0; flips = 0; nsamp = 0
        for f in glob.glob(f"{SIM}/{cfg}/{s}/*.f32"):
            a = np.fromfile(f, dtype=np.float32); n = len(a) // 2
            v, h = a[:n][7::8], a[n:][7::8]
            fr = np.isfinite(v) & (h == 0)
            sh = np.isfinite(v)
            flips += int((sh[1:] != sh[:-1]).sum()); nsamp += len(v)
            both = fr[1:] & fr[:-1]
            d += list(np.abs(np.diff(v))[both])
            sv = np.round(v, 1)
            chg += int((both & (sv[1:] != sv[:-1])).sum()); tot += int(both.sum())
        d = np.array(d)
        print(f"{cfg:8s} {s:8s} consecutive 200-ms fresh steps n {len(d)}: median |d| {np.median(d):.3f} st, p90 {np.quantile(d,.9):.3f}; displayed digit changes {100*chg/max(tot,1):.0f}% of updates; number<->dash flips {flips/max(nsamp*0.2/60,1e-9):.1f}/min")
