"""start-reference-report.py — the pre-registered table of
measurements/resonance-start-prereg-2026-10-26.md from the rows of
scripts/resonance/start-reference.mjs cue (one JSON line per stream).

  python scripts/resonance/start-reference-report.py <rows.jsonl>[,<rows.jsonl>...] [--base=S0]
"""
import json
import sys
import statistics as st

CANDS = ["S0", "P0", "P2", "P4", "P6", "C6"]
TARGET_S = 20.0


def q(v, p):
    v = sorted(v)
    if not v:
        return None
    i = (len(v) - 1) * p
    lo = int(i)
    hi = min(lo + 1, len(v) - 1)
    return v[lo] + (v[hi] - v[lo]) * (i - lo)


def main():
    files = sys.argv[1].split(",")
    rows = [json.loads(l) for f in files for l in open(f) if l.strip()]
    res = {}
    for sex in ("f", "m"):
        rs = [r for r in rows if r["sex"] == sex]
        out = {}
        for c in CANDS:
            first = [r["cands"][c]["first"] if r["cands"][c]["first"] is not None else float("inf") for r in rs]
            err = [abs(r["cands"][c]["final"] - r["longRunU"]) for r in rs if r["cands"][c]["final"] is not None]
            n = f = 0
            ne = fe = 0
            for r in rs:
                s0 = r["cands"]["S0"]["first"]
                for t, bad in r["cands"][c]["posts"]:
                    n += 1
                    f += bad
                    if s0 is None or t < s0:
                        ne += 1
                        fe += bad
            jumps = [r["cands"][c]["jump"] for r in rs if r["cands"][c].get("jump") is not None]
            same = all(r["cands"][c]["final"] == r["cands"]["S0"]["final"] for r in rs)
            out[c] = dict(first50=q(first, 0.5), first90=q(first, 0.9), err90=q(err, 0.9), err50=q(err, 0.5),
                          false=f / n if n else None, falseEarly=fe / ne if ne else None, nEarly=ne,
                          jump90=q(jumps, 0.9) if jumps else None, sameStart=same, never=sum(x == float("inf") for x in first))
        res[sex] = out
    hdr = "| cand | sex | first word q50 / q90 s | never | |start − long-run| q50 / q90 u | false words (whole span) | false words (early span, posts) | switch jump q90 u | startU = S0 |"
    print(hdr)
    print("|" + "---|" * 9)
    for c in CANDS:
        for sex in ("f", "m"):
            o = res[sex][c]
            fe = "—" if o["falseEarly"] is None else f"{100 * o['falseEarly']:.1f} % ({o['nEarly']})"
            jp = "—" if o["jump90"] is None else f"{o['jump90']:.2f}"
            print(f"| {c} | {'women' if sex == 'f' else 'men'} | {o['first50']:.1f} / {o['first90']:.1f} | {o['never']} | {o['err50']:.2f} / {o['err90']:.2f} | {100 * o['false']:.1f} % | {fe} | {jp} | {'yes' if o['sameStart'] else 'no'} |")
    print()
    # the pre-registered verdicts
    for c in CANDS[1:]:
        verdict = []
        for sex in ("f", "m"):
            o, b = res[sex][c], res[sex]["S0"]
            g = {
                "T": o["first50"] <= TARGET_S,
                "G1": o["err90"] <= b["err90"] + 0.05 + 1e-9,
                "G2": o["false"] <= b["false"] + 0.02 + 1e-9,
                "G3": o["falseEarly"] is None or o["falseEarly"] <= b["false"] + 0.05 + 1e-9,
                "G4": o["jump90"] is None or o["jump90"] <= 0.30 + 1e-9,
                "G5": o["sameStart"],
            }
            verdict.append((sex, g))
        ok = all(all(g.values()) for _, g in verdict)
        fails = [f"{k} ({'women' if s == 'f' else 'men'})" for s, g in verdict for k, v in g.items() if not v]
        mx = max(res[s][c]["first50"] for s in ("f", "m"))
        print(f"{c}: {'QUALIFIES' if ok else 'fails ' + ', '.join(fails)}; max-over-sexes median first word {mx:.1f} s")


if __name__ == "__main__":
    main()
