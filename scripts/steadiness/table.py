# table.py — one-line-per-config summary of score.py JSON output.
# Usage: python scripts/steadiness/table.py build/steady/score_X.json [cfg ...]
# Column prefixes: A = alice, S = second voice (speaker code 2).
import json, sys
import numpy as np
D = json.load(open(sys.argv[1]))
cfgs = sys.argv[2:] or list(D)


def g(d, k, f="fresh"):
    o = d.get(k)
    return o[f] if o else float("nan")


RAW = "--raw" in sys.argv
cfgs = [c for c in cfgs if c != "--raw"] or list(D)


def mae(d, k):
    o = d.get(k, {}).get("agree_raw" if RAW and "agree_raw" in d.get(k, {}) else "agree", {})
    return o.get("mae", float("nan")), o.get("r", float("nan")), o.get("med_err", float("nan"))


hdr = ("cfg", "A sp rep", "A sp MAE", "A sp r", "S sp rep", "S sp MAE", "S sp r", "A+S held MAE", "A sparse rep/MAE", "S sparse rep/MAE",
       "silent rep", "corp sp rep", "corp sp MAE", "voc sp rep/MAE", "prec full MAE", "synth")
print(" | ".join(hdr))
for c in cfgs:
    if c not in D: continue
    S = D[c].get("sessions", {}); C = D[c].get("corpora", {}); P = D[c].get("prec", {}); Y = D[c].get("synth", {})
    am, ar, _ = mae(S, "alice|speech"); sm, sr, _ = mae(S, "second|speech")
    hm = np.nanmean([mae(S, "alice|held")[0], mae(S, "second|held")[0]])
    a2, _, _ = mae(S, "alice|sparse"); s2, _, _ = mae(S, "second|sparse")
    cs = [k for k in C if k.endswith("|speech") and not k.startswith("voc")]
    crep = np.mean([C[k]["fresh"] for k in cs]) if cs else float("nan")
    cmae = np.mean([C[k]["agree"].get("mae", np.nan) for k in cs]) if cs else float("nan")
    vm, _, _ = mae(C, "voc|speech")
    pf = [k for k in P if k.endswith("|full")]
    pm = np.mean([P[k]["agree"].get("mae", np.nan) for k in pf]) if pf else float("nan")
    ys = ""
    if Y:
        ys = f"flat {mae(Y,'flat|full')[0]:.3f} vib {mae(Y,'vib|full')[0]:.3f} drift {mae(Y,'drift|full')[0]:.3f} noise-rep {np.mean([v['shown'] for k,v in Y.items() if k.startswith('noise|')])*100:.2f}%"
    print(f"{c:10s} | {100*g(S,'alice|speech'):5.1f}% | {am:.3f} | {ar:.3f} | {100*g(S,'second|speech'):5.1f}% | {sm:.3f} | {sr:.3f} | {hm:.3f} | "
          f"{100*g(S,'alice|sparse'):4.1f}%/{a2:.3f} | {100*g(S,'second|sparse'):4.1f}%/{s2:.3f} | {100*g(S,'all|silent','shown'):4.2f}% | {100*crep:5.1f}% | {cmae:.3f} | "
          f"{100*g(C,'voc|speech'):5.1f}%/{vm:.3f} | {pm:.3f} | {ys}")
