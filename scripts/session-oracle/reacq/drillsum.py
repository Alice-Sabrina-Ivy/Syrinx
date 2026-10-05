# drillsum.py V1 V2 ... — compact guard view of frame-level drills
import sys, json
V = sys.argv[1:]
D = {v: {r["sc"]: r for r in json.load(open(f"build/reacq/drills/{v}.json"))} for v in V}
G = {}
for sc, r in D[V[0]].items(): G.setdefault(r["group"], []).append(sc)
def agg(v, scs, tag):
    n = cor = bl = up = hf = bn = bp = 0; lat = []
    for sc in scs:
        b = D[v][sc]["acc"].get(tag)
        if not b: continue
        n += b["n"]; cor += b["cor"]; bl += b["blank"]; up += b["up"]; hf += b["half"]; bn += b["burstN"]; bp += b["burstPaint"]
        lat += D[v][sc]["acc"]["lat"].get(tag, [])
    if not n: return None
    s = sorted(x if x >= 0 else 1e9 for x in lat); m = s[len(s) // 2] if s else -1
    return f"cor {100*cor/n:5.1f} bl {100*bl/n:5.1f} up {100*up/n:4.1f} hf {100*hf/n:4.1f} burstP {100*bp/bn if bn else 0:5.1f} lat {('inf' if m>=1e9 else int(m)):>3} nev {100*sum(1 for x in lat if x<0)/max(len(lat),1):4.1f}"
for g, scs in G.items():
    if g.startswith("alt") and g != "altdown":
        for sub in ("clean", "err"):
            ss = [s for s in scs if s.endswith(sub)]
            print(f"\n## {g} {sub} (pooled {len(ss)} scenarios)")
            for v in V: print(f"  {v:12s} T: {agg(v, ss, 'T')} | L: {agg(v, ss, 'L')}")
        continue
    for sc in scs:
        print(f"\n## {sc}")
        for v in V:
            parts = [f"{t}: {agg(v, [sc], t)}" for t in ("T", "L", "siren", "glide", "hold") if agg(v, [sc], t)]
            a = D[v][sc]["acc"]
            print(f"  {v:12s} c12 {a['conn12']} brk {a['brk']:3d} | " + " | ".join(parts))
