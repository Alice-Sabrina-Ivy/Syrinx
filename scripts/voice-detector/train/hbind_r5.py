# hbind_r5.py — custom voice detector, round 5: a REPORTED diagnostic (not in
# the rule, never used for a choice): which H readings bind. For each candidate,
# over the grid points feasible on the round-4 rows (opselect_r3.py), the best O
# when a family of H readings is set aside, e.g. "every 0 dB reading". Families
# are fixed here: all H rows; H1 only; H2 only; without 0 dB; without 0 and
# +10 dB; without the synthetic cells; men's readings only; women's only.
#
#   python hbind_r5.py --root=DIR --cands=NET:rule[,..] [--json=OUT]
import json
import sys

import opselect_r5 as O5

O3 = O5.O3
MY = O5.MY

FAM = {
    "all H rows": lambda k: True,
    "H1 only": lambda k: k.startswith("h1|"),
    "H2 only": lambda k: k.startswith("h2|"),
    "all but 0 dB": lambda k: k.split("|")[2] != "snr+0",
    "all but 0 / +10 dB": lambda k: k.split("|")[2] not in ("snr+0", "snr+10"),
    "real-voice cells only": lambda k: k.split("|")[3] == "real",
    "men's readings only": lambda k: k.split("|")[1] == "m",
    "women's readings only": lambda k: k.split("|")[1] == "f",
}


def main():
    hb, _, _ = O5.h_items()
    blocks, spl_off = O3.build_blocks(False)
    out = {}
    for c in MY["cands"].split(","):
        net, rule = c.rsplit(":", 1)
        grid, _ = O3.score_candidate(blocks, net, rule, spl_off, False)
        hp = O5.score_h(hb, net, rule)
        row = {}
        for fam, keep in FAM.items():
            best = None
            for g in grid:
                if not g["feasible"]:
                    continue
                fails = [k for k in hp[(g["agg"], g["thr"], g["hang"])]["fail"] if keep(k)]
                if not fails and (best is None or g["O"] > best[0]):
                    best = (g["O"], g["agg"], g["thr"], g["hang"])
            row[fam] = best
        r4 = O3.pick(grid)
        row["round-4 rows only"] = r4 and (r4["O"], r4["agg"], r4["thr"], r4["hang"])
        row["H fails at the round-4-rows pick"] = r4 and hp[(r4["agg"], r4["thr"], r4["hang"])]["fail"]
        out[c] = row
        print(c, json.dumps({k: (round(v[0], 2) if isinstance(v, tuple) else v) for k, v in row.items() if k != "H fails at the round-4-rows pick"}), flush=True)
    if MY.get("json"):
        json.dump(out, open(MY["json"], "w", encoding="utf8"), indent=1)


if __name__ == "__main__":
    sys.exit(main())
