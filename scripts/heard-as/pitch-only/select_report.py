"""PREREG §5 selection + report.  python select_report.py > report.txt"""
import json, math
import numpy as np, pandas as pd
import rules as R

df = pd.read_csv("rules_all.csv")
F = R.F
FAM = {"a": 0, "d": 1, "c": 2, "b": 3}
pd.set_option("display.width", 250)
pd.set_option("display.max_columns", 60)
pd.set_option("display.max_colwidth", 60)

print("=== sessions ===")
cnt = pd.Series([f["meta"]["set"] + ":" + str(R.kind(f["meta"])) + ":" + f["meta"]["sex"] for f in F.values()]).value_counts().sort_index()
print(cnt.to_string())
print("\nexpressive readers (widest posted-F0 q90-q10 spread):",
      sorted([(k, round(F[k]["spread"], 1)) for k in R.EXPR], key=lambda x: x[0]))
sp = {s: [f["spread"] for f in F.values() if f["meta"]["set"] == "nat" and f["meta"]["sex"] == s] for s in "fm"}
print("nat F0 spread q90-q10 st median: women %.1f men %.1f" % (np.median(sp["f"]), np.median(sp["m"])))

print("\n=== start references / eligibility ===")
for st in ("nat", "hcs", "picka", "hcc", "rb", "ptdb"):
    xs = [f for f in F.values() if f["meta"]["set"] == st]
    ok = [f for f in xs if not math.isnan(f["P0"])]
    ts = [f["t_start"] for f in ok]
    before = [f for f in ok if f["tshift"] is None or f["t_start"] <= f["tshift"]]
    el = [f["elig"].mean() for f in xs]
    vis = [f["vis"].mean() for f in xs]
    print(f"{st:6s} n {len(xs):3d}  start known {len(ok):3d} (before shift {len(before):3d})  t_start median {np.median(ts) if ts else float('nan'):.0f} s  "
          f"visible ticks {np.mean(vis):.2f}  eligible ticks {np.mean(el):.2f}")

print("\n=== panel estimate in the shifted phase vs listeners (pitch-only sessions; meyer for PICKA) ===")
rows = []
for f in F.values():
    m = f["meta"]
    if m["set"] in ("nat", "ptdb"):
        continue
    e = R.shown_estimate(f)
    L = R.listener(m) if R.kind(m) == "pitch" or m["set"] in ("hcs", "hcc") else None
    rows.append(dict(key=f["key"], set=m["set"], kind=R.kind(m), sex=m["sex"], split=m["split"], cond=m.get("lcond") or f"{m.get('df0')}/{m.get('dvtl')}" if m["set"] != "rb" else m["spk"],
                     shown=e, listener=L, err=None if (e is None or L is None) else e - L))
E = pd.DataFrame(rows)
g = E.groupby(["set", "cond"]).agg(n=("key", "size"), n_shown=("shown", lambda x: x.notna().sum()), shown=("shown", "median"), listener=("listener", "first"),
                                   err=("err", "median"), n_fail=("err", lambda x: (x.abs() >= 20).sum()))
print(g.round(1).to_string())
for ref in ("meyer", "jebens", "nagels"):
    fs = R.failure_sessions(ref)
    print(f"failure set ({ref} for PICKA): {len(fs)} sessions; male-base {sum(d == 'male' for _, d, _, _ in fs)}, female-base {sum(d == 'female' for _, d, _, _ in fs)}; "
          f"optimistic {sum(o == 'optimistic' for *_, o in fs)}, pessimistic {sum(o == 'pessimistic' for *_, o in fs)}; "
          f"by set {pd.Series([k.split('_')[0] for k, *_ in fs]).value_counts().to_dict()}")
fs = R.failure_sessions("meyer")
for sp_ in ("dev", "test"):
    print(f"  {sp_}: male-base {sum(1 for k, d, *_ in fs if d == 'male' and F[k]['meta']['split'] == sp_)}, female-base {sum(1 for k, d, *_ in fs if d == 'female' and F[k]['meta']['split'] == sp_)}")

cols = ["rule", "params", "hit_male", "hit_female", "n_male", "n_female", "hit8_male", "hit8_female", "pers_male", "pers_female",
        "fa_f", "fa_m", "fa_max_f", "fa_max_m", "ex_f", "ex_m", "together_f", "together_m", "resonance_f", "resonance_m", "control_f", "control_m",
        "basefa_f", "basefa_m", "ptdb_fa", "pass_c1", "pass_c2", "pass_c3", "pass_c4", "pass_c5", "pass_all"]


def margin(r):
    return min(r.hit_male, r.hit_female)


dev = df[df.split == "dev"].copy()
dev["minhit"] = dev[["hit_male", "hit_female"]].min(axis=1)
dev["maxfa"] = dev[["fa_f", "fa_m"]].max(axis=1)
dev["fam"] = dev.rule.map(FAM)
print("\n=== DEV: configs passing all five criteria:", int(dev.pass_all.sum()), "of", len(dev))
for c in ("c1", "c2", "c3", "c4", "c5"):
    print(f"  pass {c}: {int(dev['pass_' + c].sum())}")
print("  pass c1 and c2:", int((dev.pass_c1 & dev.pass_c2).sum()), " c1,c2,c3:", int((dev.pass_c1 & dev.pass_c2 & dev.pass_c3).sum()))
chosen = None
P = dev[dev.pass_all].sort_values(["minhit", "maxfa", "fam"], ascending=[False, True, True])
if len(P):
    chosen = P.iloc[0]
    print("CHOSEN on dev:", chosen.rule, chosen.params)
    t = df[(df.split == "test") & (df.rule == chosen.rule) & (df.params == chosen.params)]
    print(t[cols].round(3).T.to_string())
else:
    print("No configuration passes all criteria on dev -> nothing ships.")

print("\n=== best per family (dev ordering: pass count of c2..c5 first, then min hit, then max FA) ===")
dev["npass_guard"] = dev[["pass_c2", "pass_c3", "pass_c4", "pass_c5"]].sum(axis=1)
for fam in ("a", "d", "c", "b"):
    D = dev[dev.rule == fam]
    # best by min hit among configs meeting all FA guards; else best by guards passed
    G = D[D.npass_guard == 4].sort_values(["minhit", "maxfa"], ascending=[False, True])
    best = G.iloc[0] if len(G) else D.sort_values(["npass_guard", "minhit", "maxfa"], ascending=[False, False, True]).iloc[0]
    print(f"\n-- family {fam}: {best.params}  (meets all four FA guards on dev: {len(G) > 0})")
    for sp_ in ("dev", "test", "all"):
        r = df[(df.split == sp_) & (df.rule == fam) & (df.params == best.params)].iloc[0]
        print(f"  {sp_:4s} hit M {r.hit_male:.2f} (n {r.n_male:.0f}) F {r.hit_female:.2f} (n {r.n_female:.0f}) | hit8 {r.hit8_male:.2f}/{r.hit8_female:.2f} | persist {r.pers_male:.2f}/{r.pers_female:.2f} | "
              f"FA nat W {r.fa_f:.3f} M {r.fa_m:.3f} (max {r.fa_max_f:.2f}/{r.fa_max_m:.2f}) | expr W {r.ex_f:.3f} M {r.ex_m:.3f} | together W {r.together_f:.2f} M {r.together_m:.2f} | "
              f"res-only W {r.resonance_f:.2f} M {r.resonance_m:.2f} | vocoder ctl W {r.control_f:.2f} M {r.control_m:.2f} | base FA W {r.basefa_f:.3f} M {r.basefa_m:.3f} | ptdb {r.ptdb_fa:.3f} | pass {r.pass_all}")

print("\n=== frontier: on ALL data, max min-hit subject to natural FA <= 5 % both sexes (ignoring the other guards) ===")
A = df[df.split == "all"].copy()
A["minhit"] = A[["hit_male", "hit_female"]].min(axis=1)
for fam in ("a", "d", "c", "b"):
    D = A[(A.rule == fam) & (A.fa_f <= 0.05) & (A.fa_m <= 0.05)].sort_values("minhit", ascending=False)
    if len(D):
        r = D.iloc[0]
        print(f"  {fam} {r.params}: hit M {r.hit_male:.2f} F {r.hit_female:.2f}; FA W {r.fa_f:.3f} M {r.fa_m:.3f}; expr {r.ex_f:.3f}/{r.ex_m:.3f}; together {r.together_f:.2f}/{r.together_m:.2f}; res-only {r.resonance_f:.2f}/{r.resonance_m:.2f}")
print("\n=== frontier: on ALL data, min natural FA (max of sexes) subject to min hit >= 0.6 ===")
for fam in ("a", "d", "c", "b"):
    D = A[(A.rule == fam) & (A.minhit >= 0.6)].copy()
    D["maxfa"] = D[["fa_f", "fa_m"]].max(axis=1)
    D = D.sort_values("maxfa")
    if len(D):
        r = D.iloc[0]
        print(f"  {fam} {r.params}: hit M {r.hit_male:.2f} F {r.hit_female:.2f}; FA W {r.fa_f:.3f} M {r.fa_m:.3f}; expr {r.ex_f:.3f}/{r.ex_m:.3f}; together {r.together_f:.2f}/{r.together_m:.2f}; res-only {r.resonance_f:.2f}/{r.resonance_m:.2f}")
    else:
        print(f"  {fam}: none reaches min hit 0.6")
print("\nshipped conflict note (c, C 1.0, K 1), all data:")
r = A[(A.rule == "c") & (A.params == json.dumps(dict(C=1.0, K=1)))].iloc[0]
print(r[cols].round(3).to_string())
