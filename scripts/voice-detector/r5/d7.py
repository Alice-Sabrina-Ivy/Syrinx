# d7.py — custom voice detector, round 5 (pre-registration
# measurements/voice-detector-round5-preregistration-2026-10-12.md §3.3 D7a):
# real held-phonation series for TRAINING, from training-split records only
# (round 4's D1 list r4/d1.json `train_ids`, re-filtered against the round-5
# seal with train_side.filter_records). No new person: every record is already
# on the rounds 1-2 training side. Never reads validation, the H rows, the
# sealed set (guard_not_conf on every path) or the private recordings.
#
#   lists   -> build/vad-train/r5/d7a.json
#           Coswara train sustained vowels joined per participant in the order
#           vowel-a, vowel-e, vowel-o (the breath gaps U(0.5, 3) s are drawn by the
#           sampler at training time); SVD train sustained-vowel records (the
#           i-a-u files) joined per speaker in session order; DCS and ESMUC choir
#           recordings as they are (one series each). Sex balance: the per-sex
#           durations are capped at the smaller sex's total (series in FNV-1a
#           order of "r5:" + series id; a series that would pass the cap is
#           skipped). Reported: hours per sex and source, and the share of
#           Praat-voiced frames (the data step's tracks) in 75-130 Hz (men) and
#           160-300 Hz (women).
#
#   python scripts/voice-detector/r5/d7.py lists
import collections
import json
import os
import sys

import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, "..", "r3"))
from c3 import DATA, ROOT, fnv1a, guard_not_conf, load_manifest, log, write_json  # noqa: E402
import train_side  # noqa: E402

R5 = os.path.join(ROOT, "r5")


def lists():
    man = load_manifest()
    d1 = json.load(open(os.path.join(ROOT, "r4", "d1.json"), encoding="utf8"))
    recs = [man[i] for i in d1["train_ids"] if i in man and man[i]["source"] in ("coswara", "svd", "dcs", "esmuc")]
    recs = train_side.filter_records(recs)
    for r in recs:
        assert r["split"] == "train" and not r.get("drop")
        guard_not_conf(os.path.join(DATA, r["path"]))
    S = []
    by = collections.defaultdict(list)
    for r in recs:
        if r["source"] == "coswara" and r["recording"] in ("vowel-a", "vowel-e", "vowel-o"):
            by[("coswara", r["participant"])].append(r)
        elif r["source"] == "svd" and r["member"].endswith("-iau.nsp"):
            by[("svd", r["speaker"])].append(r)
        elif r["source"] in ("dcs", "esmuc"):
            S.append({"id": f"{r['source']}:{r['id']}", "source": r["source"], "sex": r.get("gender"), "items": [r["id"]], "dur": r["dur"]})
    for (src, who), rs in by.items():
        rs = sorted(rs, key=(lambda r: r["recording"]) if src == "coswara" else (lambda r: int(r["session"])))
        sx = collections.Counter(r.get("gender") for r in rs).most_common(1)[0][0]
        S.append({"id": f"{src}:{who}", "source": src, "sex": sx, "items": [r["id"] for r in rs], "dur": round(sum(r["dur"] for r in rs), 3)})
    S = [s for s in S if s["sex"] in ("f", "m")]
    tot = {sx: sum(s["dur"] for s in S if s["sex"] == sx) for sx in ("f", "m")}
    cap = min(tot.values())
    keep = []
    for sx in ("f", "m"):
        acc = 0.0
        for s in sorted([s for s in S if s["sex"] == sx], key=lambda s: (fnv1a("r5:" + s["id"]), s["id"])):
            if acc + s["dur"] > cap + 1e-6:
                continue
            acc += s["dur"]
            keep.append(s)
    # band shares from the data step's Praat tracks
    band = {"m": (75.0, 130.0), "f": (160.0, 300.0)}
    vf = collections.Counter()
    inb = collections.Counter()
    for s in keep:
        for i in s["items"]:
            z = np.load(os.path.join(DATA, man[i]["f0_path"]))
            f = z["f0"][z["f0"] > 0]
            vf[s["sex"]] += len(f)
            for sx, (lo, hi) in band.items():
                inb[(s["sex"], sx)] += int(((f >= lo) & (f <= hi)).sum())
    summ = {"series_before_cap": dict(collections.Counter(s["sex"] for s in S)), "hours_before_cap": {k: round(v / 3600, 2) for k, v in tot.items()},
            "cap_hours": round(cap / 3600, 2), "series": dict(collections.Counter(s["sex"] for s in keep)),
            "hours": {sx: round(sum(s["dur"] for s in keep if s["sex"] == sx) / 3600, 2) for sx in ("f", "m")},
            "hours_by_sex_source": {f"{sx}|{src}": round(sum(s["dur"] for s in keep if s["sex"] == sx and s["source"] == src) / 3600, 2)
                                    for sx in ("f", "m") for src in ("coswara", "svd", "dcs", "esmuc")},
            "records": sum(len(s["items"]) for s in keep),
            "voiced_share_in_band": {f"{sx} in {band[b][0]:.0f}-{band[b][1]:.0f} Hz": round(inb[(sx, b)] / max(vf[sx], 1), 4) for sx in ("f", "m") for b in ("m", "f")},
            "licences": dict(collections.Counter(man[i]["licence"] for s in keep for i in s["items"]))}
    write_json(os.path.join(R5, "d7a.json"), {"what": "round-5 D7a: real held-phonation series for training (training-split records only)",
                                              "train_exclude_sha256": __import__("hashlib").sha256(open(train_side.P, "rb").read()).hexdigest(),
                                              "summary": summ, "series": sorted(keep, key=lambda s: s["id"])}, indent=1)
    log("D7a:", json.dumps(summ, indent=1))


if __name__ == "__main__":
    {"lists": lists}[sys.argv[1]]()
