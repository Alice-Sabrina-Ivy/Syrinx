"""compare_hop.py -- the "Likely heard as" estimate on the Palette at a longer
classifier hop vs the 150 ms schedule (measurements/heard-as-cpu-2026-10-07.md
guard 1). Standard library only.

  python scripts/heard-as/compare_hop.py <pov_stimuli.csv> <base.jsonl> <variant.jsonl> [...]

base / variant: run_chain.mjs outputs on the same 240 Palette stimuli
(Munson & Dolquist 2025, CC BY 4.0), e.g. --hop=150 and --hop=450. Per
stimulus, the panel's two-way share "man" (unsure counted half; the centre of
the shown range) over the whole stimulus; reports MAE |variant - base| in
points, q90, max, the change in meter_logit / ln F0, the error vs the Palette
listeners ("half" target, offset 0) for both, and how often the shown
"x in 10" rows or the hidden word change.
"""
import csv
import json
import math
import statistics
import sys

A, B, C = 17.67240817107044, -0.349098302736368, -3.5373482236362848
W, K, F = 2.25, 0.42, 0.02
sig = lambda x: 1 / (1 + math.exp(-x))
eta = lambda m, l: A + B * m + C * l


def unsure(s):
    return min(max(F, K * 4 * s * (1 - s)), 2 * min(s, 1 - s))


def tenths(m, l):
    e = eta(m, l)
    lo, hi = sig(e - W), sig(e + W)
    man = (lo - unsure(lo) / 2, hi - unsure(hi) / 2)
    wom = (1 - hi - unsure(hi) / 2, 1 - lo - unsure(lo) / 2)
    pk = min(max(0.5, lo), hi)
    uns = (min(unsure(lo), unsure(hi)), unsure(pk))
    r = lambda a: (math.floor(10 * a[0] + 1e-9), math.ceil(10 * a[1] - 1e-9))
    word = "man" if lo > 0.5 else "woman" if hi < 0.5 else "split"
    return (r(man), r(uns), r(wom)), word


rows = {r["key"]: r for r in csv.DictReader(open(sys.argv[1], encoding="utf-8"))}
load = lambda p: {d["key"]: d for d in (json.loads(l) for l in open(p, encoding="utf-8") if l.strip())}
base = load(sys.argv[2])
q = lambda a, p: sorted(a)[min(len(a) - 1, int(round(p * (len(a) - 1))))]
for vp in sys.argv[3:]:
    var = load(vp)
    ds, dm, dl, eb, ev, nb, nv, rowdiff, worddiff = [], [], [], [], [], [], [], 0, 0
    missing = 0
    for k, b in base.items():
        v = var.get(k)
        if not b["nWindows"] or b["lnF0"] is None:
            continue
        if not v or not v["nWindows"] or v["lnF0"] is None:
            missing += 1
            continue
        r = rows[k]
        y = float(r["ALL-Man"]) + 0.5 * (float(r["ALL-OtherGender"]) + float(r["ALL-no"]))
        sb, sv = 100 * sig(eta(b["meterLogit"], b["lnF0"])), 100 * sig(eta(v["meterLogit"], v["lnF0"]))
        ds.append(abs(sv - sb))
        dm.append(v["meterLogit"] - b["meterLogit"])
        dl.append(v["lnF0"] - b["lnF0"])
        eb.append(abs(sb - y))
        ev.append(abs(sv - y))
        nb.append(b.get("nClassified", b["nWindows"]))
        nv.append(v.get("nClassified", v["nWindows"]))
        tb, wb = tenths(b["meterLogit"], b["lnF0"])
        tv, wv = tenths(v["meterLogit"], v["lnF0"])
        rowdiff += tb != tv
        worddiff += wb != wv
    n = len(ds)
    print(f"{vp}: {n} stimuli ({missing} lost every window)")
    print(f"  classified windows per stimulus: median {statistics.median(nv):.0f} (base {statistics.median(nb):.0f})")
    print(f"  share 'man' |variant - base|: MAE {statistics.mean(ds):.2f} points, q90 {q(ds, .9):.2f}, max {max(ds):.2f}")
    print(f"  meter_logit d: mean {statistics.mean(dm):+.3f}, |d| q90 {q([abs(x) for x in dm], .9):.3f}; "
          f"ln F0 d: mean {statistics.mean(dl):+.4f}, |d| q90 {q([abs(x) for x in dl], .9):.4f}")
    print(f"  MAE vs Palette listeners: base {statistics.mean(eb):.2f}, variant {statistics.mean(ev):.2f} points")
    print(f"  shown 'x in 10' rows differ on {rowdiff} / {n}; the (never shown) word on {worddiff} / {n}")
