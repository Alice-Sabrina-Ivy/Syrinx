# valtable.py — custom voice detector (2026-10-06): the current app's painted
# hops on the validation streams (valdump.mjs dumps) — the denominators of the
# selection rule, per val group / mix cell and gender (cf. the harness note's
# per-set table for the evaluation sets).
#
#   python valtable.py [--val=build/vad-train/val]
import collections
import os
import sys

import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, "..", "lib"))
from streams import list_streams, load_dump  # noqa: E402

A = dict((a[2:].split("=", 1) + ["1"])[:2] for a in sys.argv[1:] if a.startswith("--"))
VAL = A.get("val", "build/vad-train/val")


def main():
    rows = collections.OrderedDict()
    for m in list_streams(VAL, ["vvoice", "vmix20", "vmix0", "vneg"]):
        c = load_dump(VAL, m)
        lab = c["lab"].astype(int)
        if m["set"] == "vvoice":
            key = f"clean {m['group']}"
        elif m["set"] == "vneg":
            key = "val negatives"
        else:
            key = f"{m['set']} {'+' if m['snr_db'] > 0 else ''}{m['snr_db']} dB"
        r = rows.setdefault(key, {"streams": 0, "hours": 0.0, "hops": 0, "painted": 0, "c": collections.Counter(), "lab": np.zeros(5, int)})
        r["streams"] += 1
        r["hours"] += m["n"] * m["hop_s"] / 3600
        r["hops"] += m["n"]
        r["painted"] += int((c["paint"] > 0).sum())
        r["lab"] += np.bincount(lab, minlength=5)[:5]
        g = m.get("gender") if m.get("gender") in ("f", "m") else "unknown"
        r["c"][g] += int((lab == 1).sum())
    print("| set | streams | hours | hops | painted | CORRECT | FALSE | WRONG | EDGE | CORRECT f / m / unknown |")
    print("|---|---|---|---|---|---|---|---|---|---|")
    for k, r in rows.items():
        L = r["lab"]
        print(f"| {k} | {r['streams']} | {r['hours']:.2f} | {r['hops']:,} | {r['painted']:,} | {L[1]:,} | {L[2]:,} | {L[3]:,} | {L[4]:,} | "
              f"{r['c']['f']:,} / {r['c']['m']:,} / {r['c']['unknown']:,} |")


if __name__ == "__main__":
    main()
