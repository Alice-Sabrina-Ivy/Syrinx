# fvwin.py — painted false voicing on the real noise-only clips in fixed
# windows (review fix, 2026-10-05). A clip-mean improvement can hide windows
# that get WORSE: removing sparse worker frames can let the 400 ms pitch-hold
# bridge (pitchGate.js PITCH_HOLD_MAX_MS) join the remaining ones into longer
# painted runs. Per clip and per W-second window of display time (hop k shows
# the frame centred at (k+1) hop - 40 ms - L hop - 30 ms), painted share of
# displayed hops, candidate vs base.
#
#   python scripts/realnoise-fv/fvwin.py BASE TAG [--win=5] [--split=all|tune|held] [--top=10]
import sys, os, glob
import numpy as np

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import attr as AT  # noqa: E402

A = AT.A
BASE, TAG = AT.TAGS[:2]
WIN = float(A.get("win", 5))
SPLIT = A.get("split", "all")
TOP = int(A.get("top", 10))


def windows(tag, nm):
    m, c = AT.load(tag, nm)
    n, hop, L = m["n"], m["hopS"], m["L"]
    td = (np.arange(n) + 1) * hop - 0.040 - L * hop - 0.030
    disp = np.isfinite(c["inten"]) & (td >= 0)
    paint = (c["paint"] > 0) & disp
    w = np.floor(np.maximum(td, 0) / WIN).astype(int)
    nw = int(w[disp].max()) + 1 if disp.any() else 0
    hops = np.bincount(w[disp], minlength=nw)
    pv = np.bincount(w[paint], minlength=nw)
    return m, hops, pv


rows = []
for p in sorted(glob.glob(f"{AT.ATTR}/{BASE}/noise/*.json")):
    nm = os.path.basename(p)[:-5]
    m, hb, pb = windows(BASE, nm)
    if SPLIT != "all" and m.get("split") != SPLIT:
        continue
    _, hc, pc = windows(TAG, nm)
    for j in range(min(len(hb), len(hc))):
        if hb[j] < 0.8 * WIN / m["hopS"]:  # partial last window
            continue
        rows.append((nm, m.get("split"), m.get("label"), j, hb[j], pb[j], pc[j]))
d = np.array([100 * (r[6] - r[5]) / r[4] for r in rows])
print(f"split={SPLIT}, {BASE} vs {TAG}: {len(rows)} windows of {WIN:g} s in {len(set(r[0] for r in rows))} clips")
for thr in (2, 10, 20):
    w = d > thr
    print(f"  windows > base + {thr} pp: {int(w.sum())} (held-out {sum(1 for r, x in zip(rows, w) if x and r[1] == 'held')}, "
          f"clips {len(set(r[0] for r, x in zip(rows, w) if x))});  < base - {thr} pp: {int((d < -thr).sum())}")
print(f"  pooled painted: {100 * sum(r[5] for r in rows) / sum(r[4] for r in rows):.2f} -> {100 * sum(r[6] for r in rows) / sum(r[4] for r in rows):.2f} %")
for i in np.argsort(-d)[:TOP]:
    nm, sp, lb, j, h, a, b = rows[i]
    print(f"    {d[i]:+.1f} pp  {nm} [{sp}, {lb}] {j * WIN:g}-{(j + 1) * WIN:g} s: {100 * a / h:.1f} -> {100 * b / h:.1f} %")
