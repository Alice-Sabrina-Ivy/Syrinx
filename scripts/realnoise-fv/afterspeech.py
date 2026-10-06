# afterspeech.py — summary of afterspeech.mjs outputs (shards are merged):
# painted false voicing on noise-only hops by the time since the last
# sentence ended, per condition and hook tree; relative change vs the first
# tree.
#
#   python scripts/realnoise-fv/afterspeech.py OUT0.json [OUT1.json ...]
import sys, json

rows, trees = [], None
for p in sys.argv[1:]:
    d = json.load(open(p))
    trees = trees or d["trees"]
    rows += d["rows"]
base = trees[0]
print(f"{len(rows)} clips; trees {trees}")
for cn, what in (("C0", "noise only"), ("C1", "one sentence at t = 1 s, then noise"), ("C2", "a sentence every 15 s")):
    print(f"\n{cn} ({what}): painted false voicing on noise-only hops, by time since the last sentence ended")
    print("| since | hops | " + " | ".join(trees) + " |")
    print("|---|---|" + "---|" * len(trees))
    for key in ("pre", "0-5", "5-10", "10-20", "20-40", "40+"):
        n = sum(r["c"][cn]["bins"].get(key, {}).get("n", 0) for r in rows)
        if not n:
            continue
        v = {t: sum(r["c"][cn]["bins"].get(key, {}).get(t, 0) for r in rows) for t in trees}
        cells = [f"{100 * v[t] / n:.2f} %" + ("" if t == base or not v[base] else f" ({100 * (v[t] / v[base] - 1):+.1f} %)") for t in trees]
        print(f"| {key} | {n} | " + " | ".join(cells) + " |")
    if cn != "C0":
        n = sum(x["n"] for r in rows for k, x in r["c"][cn]["bins"].items() if k != "pre")
        v = {t: sum(x.get(t, 0) for r in rows for k, x in r["c"][cn]["bins"].items() if k != "pre") for t in trees}
        print(f"after the first sentence, pooled: " + "; ".join(f"{t} {100 * v[t] / n:.2f} %" + ("" if t == base else f" ({100 * (v[t] / v[base] - 1):+.1f} %)") for t in trees))
    vn = sum(r["c"][cn]["voice"]["n"] for r in rows)
    if vn:
        print("sentence hops painted: " + "; ".join(f"{t} {100 * sum(r['c'][cn]['voice'][t] for r in rows) / vn:.2f} %" for t in trees))
