"""POST-HOC (not pre-registered): the transient right after a together shift."""
import json, numpy as np, pandas as pd, rules as R
F = R.F
df = pd.read_csv("rules_all.csv")
fails = {k for k, *_ in R.failure_sessions("meyer")}
for pt in ("P8", "P5v"):
    for K in (1, 2, 3):
        p = dict(X=4, Y=0.6, pitch=pt, K=K)
        out = {}
        for kd in ("together", "pitch"):
            n = w = 0; early = []
            for f in F.values():
                m = f["meta"]
                if m["set"] not in ("hcs", "picka", "hcc") or R.kind(m) != kd: continue
                on = R.condition(f, "a", p) if K <= 2 else None
                if K == 3:
                    c = R.condition(f, "a", dict(p, K=1)); on = np.zeros(len(c), bool); run = 0
                    for i in range(len(c)):
                        run = run + 1 if c[i] else 0; on[i] = run >= 3
                t, ts = f["t"], f["tshift"]
                ww = (t > ts) & (t <= ts + 10)
                n += 1; w += on[ww].any(); early.append(on[ww & f["elig"]].mean() if (ww & f["elig"]).any() else 0)
            out[kd] = (w / n, np.mean(early))
        # hits on failure set within 12 s for K3
        hit = []
        for k in fails:
            f = F[k]
            c = R.condition(f, "a", dict(p, K=1)); on = np.zeros(len(c), bool); run = 0
            for i in range(len(c)):
                run = run + 1 if c[i] else 0; on[i] = run >= K
            t, ts = f["t"], f["tshift"]
            hit.append((on[(t > ts) & (t <= ts + 10)].any(), on[(t > ts) & (t <= ts + 14)].any(), f["meta"]["sex"]))
        hm = np.mean([h[0] for h in hit if h[2] == "m"]); hf = np.mean([h[0] for h in hit if h[2] == "f"])
        hm14 = np.mean([h[1] for h in hit if h[2] == "m"]); hf14 = np.mean([h[1] for h in hit if h[2] == "f"])
        r = df[(df.split == "all") & (df.rule == "a") & (df.params == json.dumps(p))]
        fa = f"FA W {r.fa_f.iloc[0]:.3f} M {r.fa_m.iloc[0]:.3f} expr {r.ex_f.iloc[0]:.3f}/{r.ex_m.iloc[0]:.3f}" if len(r) else ""
        print(f"{pt} K{K}: together sessions warned in first 10 s {out['together'][0]:.2f} (on-share {out['together'][1]:.2f}); "
              f"failure hits <=10 s M {hm:.2f} F {hf:.2f}, <=14 s M {hm14:.2f} F {hf14:.2f}; {fa}")
