"""hop_study_report.py -- summary of scripts/heard-as/hop-study.mjs output
(measurements/heard-as-cpu-2026-10-07.md guards 3, 4 and the live-estimate
change). Standard library only.

  python scripts/heard-as/hop_study_report.py build/heard-as/hop-study.json
"""
import json
import statistics
import sys

R = json.load(open(sys.argv[1], encoding="utf-8"))
hops = R["hops"]
base = hops[0]
S = R["streams"]
q = lambda a, p: sorted(a)[min(len(a) - 1, int(round(p * (len(a) - 1))))] if a else float("nan")


def first_shown(seq):
    for x in seq:
        if "hidden" not in x:
            return x["t"] / 1000
    return None


def state(x):
    return ("hidden", x["hidden"]) if "hidden" in x else ("shown",)


print(f"streams: {sum(s['kind'] == 'reader' for s in S)} readers, {sum(s['kind'] == 'short' for s in S)} short, "
      f"{[s['name'] for s in S if s['kind'] not in ('reader', 'short')]}")
for hop in hops:
    print(f"\n== classifier hop {hop} ms ==")
    for sex in ("f", "m"):
        rd = [s for s in S if s["kind"] == "reader" and s["sex"] == sex]
        if not rd:
            continue
        b = [first_shown(s["runs"][str(base)]["shipped"]) for s in rd]
        v = [first_shown(s["runs"][str(hop)]["shipped"]) for s in rd]
        d = [y - x for x, y in zip(b, v) if x is not None and y is not None]
        never = sum(y is None for y in v) - sum(x is None for x in b)
        cls = sum(s["runs"][str(hop)]["classified"] for s in rd)
        sc = sum(s["runs"][str(hop)]["scored"] for s in rd)
        dur = sum(s["durS"] for s in rd)
        # shown-estimate change on ticks shown in both
        ds, rows_diff, word_diff, state_diff, n = [], 0, 0, 0, 0
        shown_b = shown_v = ticks = 0
        for s in rd:
            A = {x["t"]: x for x in s["runs"][str(base)]["shipped"] if x["update"]}
            B = {x["t"]: x for x in s["runs"][str(hop)]["shipped"] if x["update"]}
            for t, a in A.items():
                bb = B.get(t)
                if bb is None:
                    continue
                ticks += 1
                shown_b += "hidden" not in a
                shown_v += "hidden" not in bb
                if state(a) != state(bb):
                    state_diff += 1
                if "hidden" in a or "hidden" in bb:
                    continue
                n += 1
                ds.append(abs(bb["s"] - a["s"]) * 100)
                rows_diff += a["tenths"] != bb["tenths"]
                word_diff += a["word"] != bb["word"]
        lab = "women" if sex == "f" else "men"
        print(f"  {lab:5s} ({len(rd)} readers, {dur:.0f} s): classifier runs {cls / dur:.2f}/s (of {sc / dur:.2f} scored windows/s); "
              f"first estimate median {statistics.median([x for x in v if x is not None]):.1f} s (base {statistics.median([x for x in b if x is not None]):.1f}), "
              f"later by median {statistics.median(d):+.2f} s, max {max(d):+.1f} s; never shown {never:+d}")
        print(f"        2 s ticks: shown {shown_v}/{ticks} (base {shown_b}); hidden/shown state differs on {state_diff}; "
              f"on {n} ticks shown in both: share 'man' |d| mean {statistics.mean(ds):.2f} q90 {q(ds, .9):.2f} max {max(ds):.2f} points; "
              f"'x in 10' rows differ {rows_diff} ({100 * rows_diff / max(n, 1):.1f} %), word {word_diff}")
    for kind in ("short", "held", "noise", "silence"):
        ss = [s for s in S if s["kind"] == kind]
        if not ss:
            continue
        same = sum(json.dumps([state(x) + (x["t"],) for x in s["runs"][str(hop)]["shipped"]]) ==
                   json.dumps([state(x) + (x["t"],) for x in s["runs"][str(base)]["shipped"]]) for s in ss)
        shown = sum(any("hidden" not in x for x in s["runs"][str(hop)]["shipped"]) for s in ss)
        reasons = sorted({x.get("hidden", "SHOWN") for s in ss for x in s["runs"][str(hop)]["shipped"]})
        print(f"  {kind:7s} {len(ss):2d} streams: tick-by-tick state + reason identical to base in {same}/{len(ss)}; "
              f"streams ever shown {shown}; reasons {reasons}")
