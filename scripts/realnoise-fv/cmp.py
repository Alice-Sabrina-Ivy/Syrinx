# cmp.py — compact candidate comparison on the real noise-only set
# (2026-10-05): painted false voicing (clip mean, p90) per class, fresh vs
# held, posted, and the gender-VAD scored share, for several dump tags.
# Ship-rule check per class: candidate mean <= base mean, and per clip
# candidate <= base + 2 pp (the notch work's per-stream tolerance).
#
#   python scripts/realnoise-fv/cmp.py BASE TAG [TAG ...] [--split=all|tune|held]
import sys, os, glob
import numpy as np

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import attr as AT

A = AT.A
TAGS = AT.TAGS
SPLIT = A.get("split", "all")


def stats(tag):
    out = {}
    for p in sorted(glob.glob(f"{AT.ATTR}/{tag}/noise/*.json")):
        nm = os.path.basename(p)[:-5]
        m, c = AT.load(tag, nm)
        if SPLIT != "all" and m.get("split") != SPLIT:
            continue
        disp = np.isfinite(c["inten"])
        paint = (c["paint"] > 0) & disp
        held = paint & (c["msg"] <= 0)
        det = c["uv"] > 0
        gv = c["gv"]
        out[nm] = dict(label=m["label"], paint=paint.sum() / max(disp.sum(), 1), held=held.sum() / max(disp.sum(), 1),
                       post=(c["post"] > 0).sum() / max(det.sum(), 1), g=(gv >= 1).sum() / max((gv >= 0).sum(), 1))
    return out


S = {t: stats(t) for t in TAGS}
base = TAGS[0]
print(f"split={SPLIT}, {len(S[base])} clips")
print("| tag | class | painted mean | p90 | fresh | held | posted | gender scored | clips > base + 2 pp |")
print("|---|---|---|---|---|---|---|---|---|")
for lb in AT.LABELS + ["all"]:
    for t in TAGS:
        ids = [i for i in S[base] if lb == "all" or S[base][i]["label"] == lb]
        if not ids:
            continue
        p = np.array([S[t][i]["paint"] for i in ids]); h = np.array([S[t][i]["held"] for i in ids])
        po = np.array([S[t][i]["post"] for i in ids]); g = np.array([S[t][i]["g"] for i in ids])
        worse = sum(S[t][i]["paint"] > S[base][i]["paint"] + 0.02 for i in ids)
        print(f"| {t} | {lb} | {100*p.mean():.2f} | {100*np.percentile(p,90):.1f} | {100*(p-h).mean():.2f} | {100*h.mean():.2f} | {100*po.mean():.2f} | {100*g.mean():.1f} | {worse if t != base else '-'} |")
