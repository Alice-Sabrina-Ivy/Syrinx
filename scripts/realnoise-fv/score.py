# score.py — ground-truth corpora scored from attr.mjs dumps (2026-10-05),
# same conventions as scripts/session-oracle/corpus.mjs: worker stage = the
# POSTED pitch at the analysis-window centre (refw), display stage = the
# PAINTED value of the real hook at display alignment (refd); correct =
# |q - 1| < 0.05 on reference-voiced frames; bands < 160 Hz (low register)
# and >= 160 Hz by reference F0. Gender-symmetric summary: per corpus the
# error (100 - correct) of the worse gender, max(F_err, M_err).
#
# Usage: python scripts/realnoise-fv/score.py BASE [TAG ...] [--attr=build/realnoise-fv/attr]
#          [--corpora=fda,ptdb,hil,voc] [--json=PATH]
import sys, os, json, glob
import numpy as np

A = dict((a[2:].split("=", 1) + ["1"])[:2] for a in sys.argv[1:] if a.startswith("--"))
TAGS = [a for a in sys.argv[1:] if not a.startswith("--")]
ATTR = A.get("attr", "build/realnoise-fv/attr")
CORP = A.get("corpora", "fda,ptdb,hil,voc").split(",")


def load(path):
    m = json.load(open(path + ".json"))
    a = np.fromfile(path + ".f32", dtype=np.float32).reshape(len(m["cols"]), m["n"]).astype(float)
    return m, {c: a[i] for i, c in enumerate(m["cols"])}


def score(tag, corpus):
    acc = {}
    for p in sorted(glob.glob(f"{ATTR}/{tag}/{corpus}/*.json")):
        m, c = load(p[:-5])
        g = "voc" if corpus == "voc" else f"{corpus}_{m['gender']}"
        for st, val, ref in (("post", c["post"], c["refw"]), ("paint", np.where(np.isfinite(c["inten"]), c["paint"], 0), c["refd"])):
            v = ref > 0
            q = np.where(v, val / np.where(v, ref, 1), 0)
            ok = v & (np.abs(q - 1) < 0.05)
            nul = v & ~(val > 0)
            for band, bm in (("all", v), ("<160", v & (ref < 160)), (">=160", v & (ref >= 160))):
                d = acc.setdefault((st, g, band), [0, 0, 0])
                d[0] += int(bm.sum()); d[1] += int((ok & bm).sum()); d[2] += int((nul & bm).sum())
    return acc


def main():
    res = {t: {} for t in TAGS}
    for t in TAGS:
        for cp in CORP:
            res[t].update(score(t, cp))
    keys = sorted(res[TAGS[0]].keys())
    print("| stage | group | band | n | " + " | ".join(f"{t} correct / null" for t in TAGS) + " |")
    print("|---|---|---|---|" + "---|" * len(TAGS))
    for k in keys:
        n = res[TAGS[0]][k][0]
        if not n:
            continue
        cells = []
        for t in TAGS:
            d = res[t].get(k, [0, 0, 0])
            cells.append(f"{100*d[1]/max(d[0],1):.2f} / {100*d[2]/max(d[0],1):.2f}")
        print(f"| {k[0]} | {k[1]} | {k[2]} | {n} | " + " | ".join(cells) + " |")
    print("\nerror %: gender-symmetric max(F_err, M_err) over all frames / low register (< 160 Hz reference, genders pooled):")
    for st in ("post", "paint"):
        for cp in CORP:
            row = []
            for t in TAGS:
                gs = ["voc"] if cp == "voc" else [f"{cp}_m", f"{cp}_f"]
                errs = [100 - 100 * res[t][(st, g, "all")][1] / res[t][(st, g, "all")][0]
                        for g in gs if res[t].get((st, g, "all"), [0])[0]]
                lo = [res[t].get((st, g, "<160"), [0, 0, 0]) for g in gs]
                n, ok = sum(x[0] for x in lo), sum(x[1] for x in lo)
                row.append(f"{t}: {max(errs):.2f} / {100 - 100 * ok / max(n, 1):.2f}")
            print(f"  {st:5s} {cp:5s} " + "  ".join(row))
    if A.get("json"):
        json.dump({t: {"|".join(k): v for k, v in r.items()} for t, r in res.items()}, open(A["json"], "w"))


if __name__ == "__main__":
    main()
