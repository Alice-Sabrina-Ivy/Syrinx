# table2.py — trim-selection table: corpora / vocadito against their clean
# (untrimmed) references, synthetic truth, sessions (report rates; agreement
# vs Praat AC trimmed as configured by score.py --reftrim).
# Column prefixes: A = alice, S = second voice (speaker code 2).
import json, sys
import numpy as np
D = json.load(open(sys.argv[1]))
print("cfg | A sp rep | S sp rep | A held rep | S held rep | A sp MAE | S sp MAE | held MAE | corpora raw MAE (rep) | voc raw MAE r (rep) | prec MAE | silent")
for c in (sys.argv[2:] or list(D)):
    if c not in D: continue
    R = D[c]
    S, C, P = R.get("sessions", {}), R.get("corpora", {}), R.get("prec", {})
    m = lambda d, k, a="agree": d.get(k, {}).get(a, {}).get("mae", np.nan)
    cs = [k for k in C if k.endswith("|speech") and not k.startswith("voc")]
    craw = np.mean([m(C, k, "agree_raw") for k in cs]); crep = np.mean([C[k]["fresh"] for k in cs])
    v = C.get("voc|speech", {})
    pf = [k for k in P if k.endswith("|full")]
    pm = np.mean([m(P, k) for k in pf]) if pf else np.nan
    print(f"{c:8s} | {100*S['alice|speech']['fresh']:5.1f} | {100*S['second|speech']['fresh']:5.1f} | {100*S['alice|held']['fresh']:5.1f} | {100*S['second|held']['fresh']:5.1f} | "
          f"{m(S,'alice|speech'):.3f} | {m(S,'second|speech'):.3f} | {np.mean([m(S,'alice|held'), m(S,'second|held')]):.3f} | {craw:.3f} ({100*crep:4.1f}) | "
          f"{v['agree_raw']['mae']:.3f} {v['agree_raw'].get('r',0):.2f} ({100*v['fresh']:4.1f}) | {pm:.3f} | {100*S['all|silent']['shown']:.2f}")
