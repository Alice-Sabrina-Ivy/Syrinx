# choose_r3.py — custom voice detector, round 3 (pre-registration 2026-10-07
# §3.4; Addendum R3-B.4): the choice BETWEEN candidates from opselect_r3.py's
# JSON, and the selection table.
#
# Between candidates: the largest O; within 1 pp a single-copy candidate wins
# over a two-copy one, then the lower measured WASM cost (per architecture x
# copies, --costs), then the larger val-negatives V2. A candidate without a
# feasible point is not eligible. V4: a candidate whose deployment rule costs
# more than 2 ms per 25 ms (desktop WASM, Node, 1 thread) is not feasible.
#
#   python choose_r3.py --sel=SEL.json[,SEL2.json] --costs='{"plain:1":0.6,"plain:2":1.2,"leak:1":..,"leak:2":..}' [--md=OUT.md] [--json=OUT]
import json
import sys

MY = dict((a[2:].split("=", 1) + ["1"])[:2] for a in sys.argv[1:] if a.startswith("--"))


def main():
    sel = {}
    for f in MY["sel"].split(","):
        sel.update(json.load(open(f, encoding="utf8")))
    costs = json.loads(MY.get("costs", "{}"))
    rows = []
    for name, c in sel.items():
        b = c["best"]
        lk = "leak" if c.get("leak") or c["net"].startswith(("r9-leak", "r9-sessleak")) else "plain"
        cost = costs.get(f"{lk}:{c['copies']}")
        r = {"name": name, "net": c["net"], "rule": c["rule"], "copies": c["copies"], "arch": lk, "cost": cost, "best": b, "fallback": c["fallback"]}
        if b and cost is not None and cost > 2.0:
            r["v4_fail"] = True
        rows.append(r)
    elig = [r for r in rows if r["best"] and not r.get("v4_fail")]
    choice = None
    if elig:
        top = max(r["best"]["O"] for r in elig)
        near = [r for r in elig if r["best"]["O"] >= top - 1.0]
        singles = [r for r in near if r["copies"] == 1]
        pool = singles if singles else near
        cmin = min((r["cost"] if r["cost"] is not None else float("inf")) for r in pool)
        pool = [r for r in pool if (r["cost"] if r["cost"] is not None else float("inf")) <= cmin + 1e-12]
        choice = max(pool, key=lambda r: (r["best"]["fresh"]["vneg_v2"], r["best"]["O"]))
    out = {"choice": choice and {k: v for k, v in choice.items()}, "rows": [{k: v for k, v in r.items()} for r in rows]}
    if MY.get("json"):
        json.dump(out, open(MY["json"], "w", encoding="utf8"), indent=1)
    lines = ["| candidate | copies | pick (agg / p / hangover) | O % | tune-194 V2 % | vneg V2 % | vsess V2 % | fresh worst clean / mix % | vsess worst clean / mix % | onset median fresh / vsess ms | spliced worst clean / mix %, tune V2 % |",
             "|---|---|---|---|---|---|---|---|---|---|---|"]
    for r in sorted(rows, key=lambda r: (0 if r["best"] else 1, -(r["best"] or r["fallback"])["O"])):
        p = r["best"] or r["fallback"]
        f, v, s = p["fresh"], p["vsess"], p.get("spl")
        tag = "PICK" if r["best"] else "fallback (no feasible point)"
        sp = f"{s['worst_clean']:.2f} / {s['worst_mix']:.2f}, {s['tune_v2']:.2f}" if s else "—"
        mark = "**" if choice and r["name"] == choice["name"] else ""
        lines.append(f"| {mark}{r['name']}{mark} | {r['copies']} | {tag}: {p['agg']} / {p['thr']} / {p['hang']:.0f} ms | {p['O']:.2f} | {f['tune_v2']:.2f} | {f['vneg_v2']:.2f} | {v['vs_v2']:.2f} | "
                     f"{f['worst_clean']:.2f} / {f['worst_mix']:.2f} | {v['worst_clean']:.2f} / {v['worst_mix']:.2f} | {f['onset_median_worst']:.0f} / {v['onset_median_worst']:.0f} | {sp} |")
    txt = "\n".join(lines)
    if MY.get("md"):
        open(MY["md"], "w", encoding="utf8").write(txt + "\n")
    print(txt)
    if choice:
        b = choice["best"]
        print(f"\nCHOICE: {choice['name']} ({choice['copies']} copies, cost {choice['cost']}) at {b['agg']} p>={b['thr']} {b['hang']} ms: O {b['O']:.2f} %"
              f" (tune {b['fresh']['tune_v2']:.2f}, vneg {b['fresh']['vneg_v2']:.2f}, vsess {b['vsess']['vs_v2']:.2f})")
    else:
        print("\nNO candidate has a feasible point: no freeze, no look (§3.4).")


if __name__ == "__main__":
    main()
