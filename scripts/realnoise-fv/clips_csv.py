# clips_csv.py — per-clip attribution + candidate table for the noise-only set
# (2026-10-05): one row per public noise clip, base vs candidate dumps.
#
#   python scripts/realnoise-fv/clips_csv.py BASE CAND OUT.csv
import sys, os, glob, csv
import numpy as np

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import attr as AT

BASE, CAND, OUT = [a for a in sys.argv[1:] if not a.startswith("--")][:3]
rows = []
for p in sorted(glob.glob(f"{AT.ATTR}/{BASE}/noise/*.json")):
    nm = os.path.basename(p)[:-5]
    m, c = AT.load(BASE, nm)
    s = AT.clip_stats(m, c)
    cov = s["cov"]; tot = max(1, sum(cov.values()))
    share = {cat: 100 * sum(v for k, v in cov.items() if k.startswith(cat + "|")) / tot for cat in ("N0", "N1", "N2", "N3", "N4")}
    m2, c2 = AT.load(CAND, nm)
    s2 = AT.clip_stats(m2, c2)
    rows.append({"id": nm, "source": m.get("source"), "label": s["label"], "class": s["cls"], "split": s["split"],
                 "probed_s": round(s["dur"], 1),
                 "painted_pct": round(100 * s["paint"], 2), "fresh_pct": round(100 * s["fresh"], 2), "held_pct": round(100 * s["held"], 2),
                 "posted_pct": round(100 * s["post"], 2), "gender_scored_pct": round(100 * s["gpass"], 1),
                 **{f"{k}_pct_of_posted": round(v, 1) for k, v in share.items()},
                 "cand_painted_pct": round(100 * s2["paint"], 2), "cand_posted_pct": round(100 * s2["post"], 2),
                 "cand_gender_scored_pct": round(100 * s2["gpass"], 1)})
with open(OUT, "w", newline="") as f:
    w = csv.DictWriter(f, fieldnames=list(rows[0].keys()))
    w.writeheader()
    w.writerows(rows)
print(f"{len(rows)} clips -> {OUT}")
