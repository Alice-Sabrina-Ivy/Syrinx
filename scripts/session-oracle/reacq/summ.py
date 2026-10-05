# summ.py — one-line-per-variant headline table from analyze.py score JSONs
# (build/session-oracle/scores/<tag>.json) + corpus outputs.
# Usage: python scripts/session-oracle/reacq/summ.py BASE TAG [TAG...] [--corpus] [--brief]
import sys, json, os, numpy as np
A = dict((a[2:].split("=", 1) + ["1"])[:2] for a in sys.argv[1:] if a.startswith("--"))
TAGS = [a for a in sys.argv[1:] if not a.startswith("--")]
CATS = ["cor", "half", "up", "up3", "null", "other"]
INF = float("inf")


def pct(T, k, cat):
    v = T.get(k)
    if not v or not v[0]: return float("nan")
    return 100 * v[1 + CATS.index(cat)] / v[0]


def sw(S, k, d="L->T"):
    x = S.get(k)
    if not x: return (0, float("nan"), float("nan"), float("nan"))
    lat = sorted(x["lat"][d]); n = len(lat)
    q = lambda p: lat[min(n - 1, int(p * n))]
    return n, q(.5) * 1000, q(.9) * 1000, 100 * sum(1 for v in lat if v == INF) / n


def brks(tag):
    tot = [0, 0]
    for s in ["2025-09-08", "2026-05-07", "2026-05-26", "2026-06-09"]:
        d = f"build/session-oracle/runs/{tag}"
        m = json.load(open(f"{d}/{s}.meta.json")); n = m["nHops"]
        t = np.fromfile(f"{d}/{s}.hops.f32", dtype=np.float32).reshape(len(m["cols"]), n)
        c = {k: t[i] for i, k in enumerate(m["cols"])}
        tot[0] += int(c["brk"].sum()); tot[1] += int(c["brkA"].sum()) if "brkA" in c else 0
    return tot


f = lambda x: " inf" if x == INF else ("  - " if x != x else f"{x:5.2f}")
g = lambda x: " inf" if x == INF else ("  - " if x != x else f"{x:4.0f}")
R = {t: json.load(open(f"build/session-oracle/scores/{t}.json")) for t in TAGS}
for conv in ("cons", "strict"):
    print(f"\n#### {conv}  (T = Alice 160-400 painted cor/half/blank; A = alice-only pass; L = Alice 75-160 painted cor / x2 up / x3-4 up; "
          f"sw = L->T n med p90 never%; TL = T->L med never%; ev = Alice up/down events per voiced min; S = second voice 160-400 painted cor, second voice up/dn ev)")
    for t in TAGS:
        T = R[t]["tables"]; S = R[t]["switch"]; E = R[t]["events"]
        P = "POOLED"
        tp = [pct(T, f"{P}|{conv}|alice|paint|160-400", c) for c in ("cor", "half", "null")]
        ta = [pct(T, f"{P}|{conv}|alice|paintA|160-400", c) for c in ("cor", "half", "null")]
        ho = [pct(T, f"2026-06-09|{conv}|alice|paint|160-400", c) for c in ("cor", "null")]
        hoA = pct(T, f"2026-06-09|{conv}|alice|paintA|160-400", "cor")
        lo = [pct(T, f"{P}|{conv}|alice|paint|75-160", c) for c in ("cor", "up", "up3")]
        loA = [pct(T, f"{P}|{conv}|alice|paintA|75-160", c) for c in ("cor", "up", "up3")]
        s1 = sw(S, f"{P}|{conv}|paint"); s2 = sw(S, f"{P}|{conv}|paintA")
        tl = sw(S, f"{P}|{conv}|paint", "T->L"); tlA = sw(S, f"{P}|{conv}|paintA", "T->L")
        e = E.get(f"{P}|{conv}|alice|paint"); eA = E.get(f"{P}|{conv}|alice|paintA"); es = E.get(f"{P}|{conv}|second|paint")
        sc = pct(T, f"{P}|{conv}|second|paint|160-400", "cor")
        print(f"{t:14s} T {f(tp[0])}/{f(tp[1])}/{f(tp[2])} HO {f(ho[0])}/{f(ho[1])} | A {f(ta[0])}/{f(ta[1])}/{f(ta[2])} HO {f(hoA)} | "
              f"L {f(lo[0])}/{f(lo[1])}/{f(lo[2])} A {f(loA[0])}/{f(loA[1])}/{f(loA[2])} | sw {s1[0]} {g(s1[1])} {g(s1[2])} {f(s1[3])} A {g(s2[1])} {g(s2[2])} {f(s2[3])} | "
              f"TL {g(tl[1])} {f(tl[3])} A {g(tlA[1])} {f(tlA[3])} | ev {f(e['up'] / e['vmin'])}/{f(e['down'] / e['vmin'])} A {f(eA['up'] / eA['vmin'])}/{f(eA['down'] / eA['vmin'])} | "
              f"S {f(sc)} {f(es['up'] / es['vmin'])}/{f(es['down'] / es['vmin'])}")
if "brief" not in A:
    print("\nline breaks drawn (mix / alice-only), conn12:")
    for t in TAGS:
        b = brks(t); c12 = sum(R[t]["events"][f"{s}|conn|paint"]["conn12"] for s in ["2025-09-08", "2026-05-07", "2026-05-26", "2026-06-09"])
        print(f"  {t:14s} {b[0]} / {b[1]}  conn12 {c12}")

if "corpus" in A:
    CC = ["correct", "down2", "down3", "up2", "up3", "null", "other"]
    print("\n#### corpora, displayed (paint): correct / up2 / up3 / down / null ; events up/dn per voiced min ; brk per painted min")
    for grp, band in [("ptdb_m", "<160"), ("ptdb_m", "75-125"), ("fda_m", "all"), ("hil_m", "all"), ("ptdb_f", "all"), ("fda_f", "all"), ("hil_f", "all"), ("voc", "all<400")]:
        row = []
        for t in TAGS:
            agg = {}; ev = {}
            d = f"build/session-oracle/corpus/{t}"
            if not os.path.isdir(d): row.append(f"{t}: -"); continue
            for fn in os.listdir(d):
                if fn.endswith(".json"):
                    for k, v in json.load(open(f"{d}/{fn}")).items():
                        a = agg.setdefault(k, {c: 0 for c in ["n"] + CC})
                        for c in v: a[c] += v[c]
                if fn.endswith(".ev"):
                    for k, v in json.load(open(f"{d}/{fn}")).items(): ev[k] = v
            a = agg.get(f"paint|{grp}|{band}")
            if not a or not a["n"]: row.append(f"{t}: -"); continue
            p = lambda c: 100 * a[c] / a["n"]
            e = ev.get(grp)
            es = f" ev {e['upRuns'] / e['vmin']:.2f}/{e['dnRuns'] / e['vmin']:.2f} brk {e['brk'] / max(e['paintMin'], 1e-9):.2f}" if e and band in ("all", "<160", "all<400") else ""
            row.append(f"{t}: {p('correct'):5.2f}/{p('up2'):4.2f}/{p('up3'):4.2f}/{p('down2') + p('down3'):4.2f}/{p('null'):5.2f}{es}")
        print(f"  {grp:7s} {band:8s} " + " | ".join(row))
