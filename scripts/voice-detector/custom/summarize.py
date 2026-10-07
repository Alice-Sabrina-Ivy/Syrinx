# summarize.py — custom voice detector, data step: per source x split counts of
# the training corpus (build/vad-train/data/manifest.jsonl, latest record per
# id wins) and the drop reasons. Markdown on stdout (the pre-registration's
# data addendum); --json=PATH also writes the numbers.
import collections
import json
import os

from common import DATA, args, load_manifest

A = args()
recs = load_manifest(DATA)
kept = [r for r in recs.values() if "drop" not in r]
drop = [r for r in recs.values() if "drop" in r]
ORDER = ["librispeech", "vctk", "coswara", "mdvr", "dcs", "esmuc", "csd", "cantoria", "fsd50k", "fstrain"]
out = {"sources": {}, "drops": {}}
print("| kind | source | split | files | hours | groups (speakers / singers / uploaders) | f / m / unknown groups | voiced h | machine / room files |")
print("|---|---|---|---|---|---|---|---|---|")
for kind in ("voice", "nonvoice"):
    for s in ORDER:
        for sp in ("train", "val"):
            rr = [r for r in kept if r["kind"] == kind and r["source"] == s and r["split"] == sp]
            if not rr:
                continue
            grp = {}
            for r in rr:
                grp[r["group"]] = r.get("gender") or "unknown"
            g = collections.Counter(v if v in ("f", "m") else "unknown" for v in grp.values())
            h = sum(r["dur"] for r in rr) / 3600
            vh = sum(r.get("voiced_sec", 0) for r in rr) / 3600
            mach = sum(1 for r in rr if r.get("machine_room"))
            row = dict(files=len(rr), hours=round(h, 2), groups=len(grp), gender_groups=dict(g), voiced_h=round(vh, 2), machine=mach)
            out["sources"][f"{kind}/{s}/{sp}"] = row
            gs = f"{g['f']} / {g['m']} / {g['unknown']}" if kind == "voice" else "—"
            print(f"| {kind} | {s} | {sp} | {len(rr)} | {h:.2f} | {len(grp)} | {gs} | {vh:.2f} | {mach if kind == 'nonvoice' else '—'} |")
tot = collections.Counter()
for r in kept:
    tot[(r["kind"], r["split"])] += r["dur"] / 3600
print()
print("Totals (h): " + ", ".join(f"{k} {sp} {v:.1f}" for (k, sp), v in sorted(tot.items())))
print()
print("| source | drop reason | files |")
print("|---|---|---|")
dc = collections.Counter()
for r in drop:
    reason = r["drop"]
    if reason.startswith("fingerprint match"):
        reason = "fingerprint match with a benchmark noise clip"
    elif reason.startswith("speech screen"):
        reason = "speech screen (Silero p >= 0.9 for >= 1 s)"
    elif reason.startswith("uploader of a clip"):
        reason = "uploader of a clip that fingerprint-matched benchmark audio"
    dc[(r["source"], reason)] += 1
for (s, reason), n in sorted(dc.items(), key=lambda kv: (ORDER.index(kv[0][0]) if kv[0][0] in ORDER else 99, -kv[1])):
    print(f"| {s} | {reason} | {n} |")
    out["drops"][f"{s}: {reason}"] = n
if A.get("json"):
    json.dump(out, open(A["json"], "w", encoding="utf8"), indent=1)
