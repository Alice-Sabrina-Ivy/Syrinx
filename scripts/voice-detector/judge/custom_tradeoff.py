# custom_tradeoff.py — custom voice detector, judge step (2026-10-07):
# POST-HOC V1 / V2 trade-off of the frozen candidate over a threshold x
# hangover grid (agg as frozen), taken after the one pre-registered evaluation
# look (score.py), plus the failure breakdowns at the frozen point (mixes by
# voice source / noise class / noise split / time since voice start; clean
# worst streams; noise classes and clips left). First checks that
# custom_fastscore reproduces score.py's JSON of the evaluation look exactly.
# A point found here is never a pre-registered selection.
#   python scripts/voice-detector/judge/custom_tradeoff.py --out=build/vad/judge/custom-tradeoff.json
# (needs build/vad/scores/custom-vd.json from the evaluation look)
import json
import os
import sys
import time
from collections import defaultdict

import numpy as np

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
OUT = [a.split("=", 1)[1] for a in sys.argv[1:] if a.startswith("--out=")][0]
import custom_fastscore as F  # noqa: E402

t0 = time.time()
C = F.Cache("build/vad/cand/custom-vd")
print(f"cache {time.time() - t0:.0f} s", flush=True)

# ---- 1. parity with the evaluation look (score.py json) ----
with open("build/vad/scores/custom-vd.json", encoding="utf8") as f:
    ref = json.load(f)["candidates"]["custom-vd"]
spec, rows, res = C.score()
bad = 0
for sec in ("V1", "V2"):
    for k, x in ref[sec].items():
        y = res[sec][k]
        for kk in ("worse_pct", "pct", "vetoed", "false"):
            if kk in x and not (x[kk] == y[kk] or (isinstance(x[kk], float) and abs(x[kk] - y[kk]) < 1e-9)):
                bad += 1
                print("MISMATCH", sec, k, kk, x[kk], y[kk])
for g, st in ref["V3"]["by_gender"].items():
    if abs(st["median"] - res["V3"]["by_gender"][g]["median"]) > 1e-9 or abs(st["over100"] - res["V3"]["by_gender"][g]["over100"]) > 1e-9:
        bad += 1
print(f"parity with score.py json: {bad} mismatches", flush=True)
out = {"parity_mismatches": bad}

# ---- 2. breakdowns at the frozen point ----
mixrows = [r for r in rows if r["set"] in ("vin20", "vin0")]
br = {}
# by voice source x gender, per cell
d = defaultdict(lambda: [0, 0])
for r in mixrows:
    m = r["_meta"]
    key = f"{r['set']} {r['snr']:+d} | {m.get('voice_source')} | {r['gender']}"
    d[key][0] += r["correct"]
    d[key][1] += r["correct_v"]
br["mix_by_voice_source"] = {k: (a, v, 100 * v / a if a else None) for k, (a, v) in sorted(d.items())}
# by noise class (pooled cells)
d = defaultdict(lambda: [0, 0, set()])
for r in mixrows:
    m = r["_meta"]
    key = f"{m.get('noise_label')} | {m.get('noise_class')}"
    d[key][0] += r["correct"]
    d[key][1] += r["correct_v"]
    d[key][2].add(m.get("noise_id"))
br["mix_by_noise_class"] = sorted([(k, a, v, 100 * v / a if a else 0, len(ids)) for k, (a, v, ids) in d.items()], key=lambda x: -x[2])
# by noise split (tune / held) — the mixes' noise comes from the 279
d = defaultdict(lambda: [0, 0])
for r in mixrows:
    key = f"{r['set']} {r['snr']:+d} | noise split {r['_meta'].get('split')} | {r['gender']}"
    d[key][0] += r["correct"]
    d[key][1] += r["correct_v"]
br["mix_by_noise_split"] = {k: (a, v, 100 * v / a if a else None) for k, (a, v) in sorted(d.items())}
# concentration: share of vetoed correct hops in the worst streams, per cell
conc = {}
for s in ("vin20", "vin0"):
    for snr in (10, 0):
        rr = [r for r in mixrows if r["set"] == s and r["snr"] == snr]
        tot = sum(r["correct_v"] for r in rr)
        srt = sorted(rr, key=lambda r: -r["correct_v"])
        cum = np.cumsum([r["correct_v"] for r in srt])
        conc[f"{s} {snr:+d}"] = {"vetoed": tot, "streams_with_veto": sum(1 for r in rr if r["correct_v"]),
                                 "streams": len(rr), "top5_share": float(cum[4] / tot * 100) if tot else 0,
                                 "top10_share": float(cum[9] / tot * 100) if tot else 0,
                                 "streams_over_10pct": sum(1 for r in rr if r["correct"] >= 20 and r["correct_v"] / r["correct"] > 0.10)}
br["mix_concentration"] = conc
# where in the stream: time since the voice start (vin0: stream start) of vetoed CORRECT hops
tb = defaultdict(lambda: [0, 0])
edges = [0, 1, 2, 3, 5, 10, 20, 1e9]
for r in mixrows:
    m = r["_meta"]
    hop = m["hop_s"]
    t = (np.arange(m["n"]) + 1) * hop - (m.get("lead", 0) or 0)
    lab, veto = r["_lab"], r["_veto"]
    for a, b in zip(edges[:-1], edges[1:]):
        sel = (lab == 1) & (t >= a) & (t < b)
        tb[(r["set"], a)][0] += int(sel.sum())
        tb[(r["set"], a)][1] += int((sel & veto).sum())
br["mix_by_time_since_voice_start"] = {f"{s} {a}-{b if b < 1e8 else 'end'} s": (tb[(s, a)][0], tb[(s, a)][1], 100 * tb[(s, a)][1] / tb[(s, a)][0] if tb[(s, a)][0] else None)
                                       for s in ("vin20", "vin0") for a, b in zip(edges[:-1], edges[1:])}
# clean voice: worst streams per V1 set
cw = {}
for s in ("fda", "ptdb", "voc", "vocalset", "pvqd", "voiced", "hil"):
    rr = [r for r in rows if r["set"] == s and r["correct"] >= 1]
    tot = sum(r["correct_v"] for r in rr)
    srt = sorted(rr, key=lambda r: -r["correct_v"])[:6]
    cw[s] = {"vetoed": tot, "correct": sum(r["correct"] for r in rr), "streams_with_veto": sum(1 for r in rr if r["correct_v"]),
             "top": [(r["id"], r["gender"], r["correct_v"], r["correct"]) for r in srt if r["correct_v"]]}
br["clean_worst"] = cw
# noise: per class on held-out B, and clips with < 50 % removed
nz = [r for r in rows if r["set"] in ("noise", "noiseho")]
d = defaultdict(lambda: [0, 0, 0])
for r in nz:
    key = f"{r['set']} {r['cls']}"
    d[key][0] += r["false"]
    d[key][1] += r["false_v"]
    d[key][2] += 1
br["noise_by_cls"] = sorted([(k, a, v, 100 * v / a if a else None, n) for k, (a, v, n) in d.items() if a], key=lambda x: (x[3] if x[3] is not None else 999))
br["noise_clips_under_50"] = {s: sum(1 for r in nz if r["set"] == s and r["false"] >= 40 and r["false_v"] / r["false"] < 0.5) for s in ("noise", "noiseho")}
br["noise_clips_with_false"] = {s: sum(1 for r in nz if r["set"] == s and r["false"] >= 40) for s in ("noise", "noiseho")}
# false hops left: share held by the 10 least-removed clips
for s in ("noise", "noiseho"):
    rr = sorted([r for r in nz if r["set"] == s], key=lambda r: -(r["false"] - r["false_v"]))
    left = sum(r["false"] - r["false_v"] for r in rr)
    br[f"{s}_left_top10"] = (left, sum(r["false"] - r["false_v"] for r in rr[:10]), [(r["id"], r["cls"], r["false"] - r["false_v"], r["false"]) for r in rr[:10]])
out["breakdowns"] = br
print("breakdowns done", flush=True)

# ---- 3. trade-off grid (post-hoc; agg mean as frozen) ----
TH = [0.01, 0.02, 0.03, 0.05, 0.07, 0.1, 0.13, 0.16, 0.2, 0.25, 0.3, 0.35, 0.4, 0.45, 0.5, 0.6, 0.7, 0.8, 0.9]
HG = [0, 100, 200, 500, 1000, 2000, 3000, 5000, 10000]
grid = []
for h in HG:
    for th in TH:
        _, _, r = C.score(th, h)
        s = F.summary(r)
        s.update({"thr": th, "hang": h})
        grid.append(s)
    print(f"hang {h} done {time.time() - t0:.0f} s", flush=True)
out["grid"] = grid
with open(OUT, "w", encoding="utf8") as f:
    json.dump(out, f, indent=1, default=lambda o: o.item() if isinstance(o, np.generic) else str(o))
print("wrote", OUT)
