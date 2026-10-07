"""Details for the chosen configuration (and the shipped conflict note) -> details.txt"""
import json, math
import numpy as np, pandas as pd
import rules as R

F = R.F
CH = ("a", dict(X=4, Y=0.6, pitch="P8", K=1))
df = pd.read_csv("rules_all.csv")
r = df[(df.split == "all") & (df.rule == "c") & (df.params == json.dumps(dict(C=1.0, K=1)))].iloc[0]
print("shipped conflict note (c, C 1.0, K 1), all data:")
for k in ["hit_male", "hit_female", "n_male", "n_female", "fa_f", "fa_m", "ex_f", "ex_m", "together_f", "together_m", "resonance_f", "resonance_m"]:
    print(f"  {k} {r[k]:.3f}")


def first_on(f, on):
    t, ts = f["t"], f["tshift"]
    w = np.where(on & (t > ts))[0]
    return t[w[0]] - ts if len(w) else None


rule, p = CH
print(f"\n=== chosen {rule} {p} ===")
for ref in ("meyer", "jebens", "nagels"):
    fs = R.failure_sessions(ref)
    rows = []
    for k, d, err, o in fs:
        f = F[k]; on = R.condition(f, rule, p); t, ts = f["t"], f["tshift"]
        pre = np.where(f["elig"] & (t <= ts))[0]
        fresh = len(pre) == 0 or not on[pre[-1]]
        hit = fresh and on[(t > ts) & (t <= ts + 10)].any()
        rows.append(dict(key=k, set=f["meta"]["set"], split=f["meta"]["split"], dir=d, err=err, o=o, hit=hit, first=first_on(f, on)))
    D = pd.DataFrame(rows)
    print(f"\nfailure set with {ref} PICKA reference: n {len(D)}")
    print(D.groupby(["set", "dir", "o"]).agg(n=("hit", "size"), hit=("hit", "mean"), first_med=("first", "median")).round(2).to_string())
    print("  caught: optimistic %d, pessimistic %d (optimistic share %.2f)" % ((D.hit & (D.o == "optimistic")).sum(), (D.hit & (D.o == "pessimistic")).sum(),
          (D.hit & (D.o == "optimistic")).sum() / max(1, D.hit.sum())))
    for sp in ("dev", "test", "all"):
        S = D if sp == "all" else D[D.split == sp]
        print(f"  {sp}: hit male {S[S.dir == 'male'].hit.mean():.2f} (n {(S.dir == 'male').sum()}), female {S[S.dir == 'female'].hit.mean():.2f} (n {(S.dir == 'female').sum()})")
    if ref == "meyer":
        print("  misses:", D[~D.hit][["key", "err", "o", "first"]].to_string(index=False))
        print("  time to first warning after the shift (s): median %.0f, q90 %.0f, max %.0f" % (D["first"].median(), D["first"].quantile(0.9), D["first"].max()))

# all pitch-only sessions (incl. non-failures) and every kind: share of sessions warned within 10 s, transient in first 10 s
print("\n=== by session kind: warned within 10 s of the shift (fresh), post-shift on-share (t >= shift+10), first-10-s on-share ===")
rows = []
for f in F.values():
    m = f["meta"]
    if m["set"] in ("nat", "ptdb"):
        continue
    on = R.condition(f, rule, p); t, ts = f["t"], f["tshift"]
    pre = np.where(f["elig"] & (t <= ts))[0]
    fresh = len(pre) == 0 or not on[pre[-1]]
    early = f["elig"] & (t > ts) & (t <= ts + 10)
    post = f["elig"] & (t >= ts + 10)
    cond = m.get("lcond") or (f"{m.get('df0')}/{m.get('dvtl')}" if m["set"] == "picka" else m["spk"])
    rows.append(dict(set=m["set"], cond=cond, kind=R.kind(m), sex=m["sex"], warned10=bool(fresh and on[(t > ts) & (t <= ts + 10)].any()),
                     early=on[early].mean() if early.any() else np.nan, post=on[post].mean() if post.any() else np.nan))
D = pd.DataFrame(rows)
print(D.groupby(["set", "cond"]).agg(n=("warned10", "size"), warned10=("warned10", "mean"), early=("early", "mean"), post=("post", "mean")).round(2).to_string())

print("\n=== natural readers: per-reader FA (eligible ticks) ===")
for sex in "fm":
    v = sorted([(f["key"], round(float(R.condition(f, rule, p)[f["elig"]].mean()), 3), round(f["spread"], 1)) for f in F.values()
                if f["meta"]["set"] == "nat" and f["meta"]["sex"] == sex], key=lambda x: -x[1])
    print(sex, v[:6], " readers with any warning:", sum(1 for x in v if x[1] > 0), "/", len(v))
# pooled time-weighted
for sex in "fm":
    on = el = 0
    for f in F.values():
        if f["meta"]["set"] == "nat" and f["meta"]["sex"] == sex:
            c = R.condition(f, rule, p); on += c[f["elig"]].sum(); el += f["elig"].sum()
    print(f"pooled nat {sex}: {on}/{el} = {on / el:.3f}")
# episodes: number of distinct warning episodes per natural minute
for sex in "fm":
    ep = mins = 0
    for f in F.values():
        if f["meta"]["set"] == "nat" and f["meta"]["sex"] == sex:
            c = R.condition(f, rule, p).astype(int)
            ep += int(np.sum(np.diff(np.r_[0, c]) == 1)); mins += f["dur"] / 60
    print(f"nat {sex}: {ep} warning episodes in {mins:.0f} min of reading")

# the inputs on failure / natural ticks, to show the margins
print("\n=== |dP| st and |dR| on eligible ticks ===")
def stats(sel, lab):
    a, b = [], []
    for f in sel:
        e = f["elig"] & ((f["t"] >= f["tshift"] + 10) if f["tshift"] else True)
        a += list(np.abs((f["P8"] - f["P0"]) * R.ST)[e]); b += list(np.abs(f["u"] - f["R0"])[e])
    a, b = np.array(a), np.array(b)
    print(f"  {lab}: |dP| st q50 {np.nanquantile(a, .5):.2f} q90 {np.nanquantile(a, .9):.2f} q99 {np.nanquantile(a, .99):.2f} | |dR| u q50 {np.nanquantile(b, .5):.2f} q90 {np.nanquantile(b, .9):.2f}")
for sex in "fm":
    stats([f for f in F.values() if f["meta"]["set"] == "nat" and f["meta"]["sex"] == sex], f"natural {sex}")
for k in ("pitch", "together", "resonance", "control"):
    stats([f for f in F.values() if f["meta"]["set"] in ("hcs", "picka") and R.kind(f["meta"]) == k], f"hcs+picka {k} (post-shift)")
g = F["rb_google"]
e = g["elig"] & (g["t"] >= g["tshift"] + 10)
print("rb_google post-shift: dP st %.2f, dR %.2f" % (np.nanmedian(((g["P8"] - g["P0"]) * R.ST)[e]), np.nanmedian((g["u"] - g["R0"])[e])))

# neighbours of the chosen config on all data (robustness)
print("\n=== neighbours (all data) ===")
A = df[(df.split == "all") & (df.rule == "a")]
for _, r in A.iterrows():
    q = json.loads(r.params)
    if q["pitch"] == "P8" and q["K"] in (1, 2):
        print(f"  X {q['X']} Y {q['Y']} K {q['K']}: hit M {r.hit_male:.2f} F {r.hit_female:.2f} | FA W {r.fa_f:.3f} M {r.fa_m:.3f} | expr {r.ex_f:.3f}/{r.ex_m:.3f} | together {r.together_f:.2f}/{r.together_m:.2f} | res {r.resonance_f:.2f}/{r.resonance_m:.2f} | pass {r.pass_all}")
