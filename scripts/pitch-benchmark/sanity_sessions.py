# sanity_sessions.py — score_sessions.py's loader + nearest-hop mapping, scored
# against the session oracle's own `cons` reference at the oracle's alignment
# (offset 0, worker stage), must reproduce the committed 2026-10-03 table:
# Alice 160-400 Hz, pooled, posted: base 88.01 / 8.59 half / 1.14 null,
# combined 91.37 / 5.14 / 1.39.
import os, sys, numpy as np
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import score_sessions as S
for det in ["syrinx_main", "syrinx_new", "syrinx_new600"]:
    n = c = h = nu = 0
    for s in S.SESSIONS:
        z = np.load(os.path.join(S.REFS, f"{s}.npz")); t, spk, cons = z["t"], z["spk"], z["cons"]
        cons = np.where(cons >= 75, cons, 0)
        te, fe = S.load_est(det, s); E = S.est_at(te, fe, t, 0.0, nearest=True)
        m = (spk == 1) & (cons >= 160) & (cons < 400)
        q = np.where(E[m] > 0, E[m] / cons[m], 0)
        n += m.sum(); c += (np.abs(q - 1) < 0.05).sum(); h += (np.abs(q - 0.5) <= 0.05).sum(); nu += (E[m] <= 0).sum()
    print(f"{det}: alice 160-400 cons posted n={n} correct {100*c/n:.2f} half {100*h/n:.2f} null {100*nu/n:.2f}")
