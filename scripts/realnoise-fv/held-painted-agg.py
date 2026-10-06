# held-painted-agg.py — summary of held-painted.mjs outputs (shards merged):
# per hook tree, the suite mean of the painted hold-frame accuracy, the runs
# more than 0.5 pp below the first tree (G6 per-scenario reading), the worst
# run, and per family / F0; --detail lists the runs that lose.
#
#   python scripts/realnoise-fv/held-painted-agg.py OUT0.json [OUT1.json ...] [--detail] [--by=family|f0]
import sys, json
from collections import defaultdict

args = [a for a in sys.argv[1:] if not a.startswith("--")]
opts = dict((a[2:].split("=", 1) + ["1"])[:2] for a in sys.argv[1:] if a.startswith("--"))
rows = []
for p in args:
    rows += json.load(open(p))
trees = list(rows[0]["v"].keys())
base = trees[0]
rows = [r for r in rows if r["v"][base]["painted"] is not None]
print(f"{len(rows)} runs (scenario x rate); trees {trees}; worker mean {sum(r['worker'] for r in rows) / len(rows):.2f} %")
print("\n| tree | painted mean | change | runs > 0.5 pp below base | worst run (pp) |")
print("|---|---|---|---|---|")
for t in trees:
    m = sum(r["v"][t]["painted"] for r in rows) / len(rows)
    d = [r["v"][t]["painted"] - r["v"][base]["painted"] for r in rows]
    mb = sum(r["v"][base]["painted"] for r in rows) / len(rows)
    print(f"| {t} | {m:.2f} % | {m - mb:+.2f} pp | {sum(x < -0.5 for x in d)} | {min(d):+.1f} |")
by = opts.get("by", "family")


def key(r):
    if by == "f0":
        parts = r["name"].split("/")
        f = next((p for p in parts[1:] if p.isdigit()), "?")
        return f"{r['family']} {f} Hz"
    return r["family"]


g = defaultdict(list)
for r in rows:
    g[key(r)].append(r)
print(f"\n| {by} | runs | worker | " + " | ".join(trees) + " |")
print("|---|---|---|" + "---|" * len(trees))
for k in sorted(g):
    v = g[k]
    cells = [f"{sum(r['v'][t]['painted'] for r in v) / len(v):.2f}" for t in trees]
    print(f"| {k} | {len(v)} | {sum(r['worker'] for r in v) / len(v):.2f} | " + " | ".join(cells) + " |")
if "detail" in opts:
    for t in trees[1:]:
        bad = sorted([r for r in rows if r["v"][t]["painted"] - r["v"][base]["painted"] < -0.5],
                     key=lambda r: r["v"][t]["painted"] - r["v"][base]["painted"])
        if not bad:
            continue
        print(f"\n{t}: runs > 0.5 pp below {base}: name @ sr | worker | {base} | {t}")
        for r in bad:
            print(f"  {r['name']} @ {r['sr']} | {r['worker']:.1f} | {r['v'][base]['painted']:.1f} | {r['v'][t]['painted']:.1f}")
