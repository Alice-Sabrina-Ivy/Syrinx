# attr.py — attribute Alice target-voice blanks / wrong paints and every
# L->T / T->L switch to the paint-gate branch that blocked it, from replay.mjs
# runs (gate trace columns g_* / gA_*). Conventions = analyze.py.
# Usage: python scripts/session-oracle/reacq/attr.py TAG [--conv=cons,strict] [--json=out.json]
import sys, os, json, numpy as np
sys.argv_backup = list(sys.argv)
A = dict((a[2:].split("=", 1) + ["1"])[:2] for a in sys.argv[1:] if a.startswith("--"))
TAGS = [a for a in sys.argv[1:] if not a.startswith("--")]
sys.argv = [sys.argv[0]] + TAGS + ["--quiet"]
sys.path.insert(0, "scripts/session-oracle")
import analyze as an

CODES = {0: "none", 1: "paint-on", 2: "paint-accept", 3: "onset-confirm", 4: "offlevel-armed(reacq pending)",
         5: "offlevel-unarmed", 6: "hold-paint", 7: "hold-blocked", 8: "no-pitch(worker null/hold expired)",
         9: "quiet(silence gate)", 10: "reset"}
GAPC = {6, 7, 8, 9, 10}


def unarmed_split(code, psg, j, win=8):
    """split OFF_UNARMED at hop j: 1-frame gap just before the run vs window expired."""
    # walk back over the off-level run
    i = j
    while i > 0 and code[i] in (4, 5): i -= 1
    # i = hop before the run; count consecutive gap events ending at i
    g = 0
    while i - g >= 0 and code[i - g] in GAPC: g += 1
    if g == 1: return "offlevel-unarmed:1-frame gap (not armed)"
    if g == 0 and psg[j] >= win: return "offlevel-unarmed:in-word switch (window expired)"
    if g == 0: return "offlevel-unarmed:in-word switch (never armed)"
    return "offlevel-unarmed:other"


def reason(cols, st, j, ref):
    pre = "gA_" if st == "paintA" else "g_"
    code = cols[pre + "code"]; psg = cols[pre + "psg"]
    p = cols[st][j]; m = cols["msg"][j]
    q = p / ref if p > 0 else 0
    if p > 0:
        if abs(q - 1) < 0.05: return "correct"
        mq = m / ref if m > 0 else 0
        tag = "half" if abs(q - 0.5) <= 0.05 else "other-wrong"
        if abs(mq - 1) < 0.05: return f"painted {tag}: median lag (msg correct)"
        if code[j] == 6: return f"painted {tag}: held value"
        return f"painted {tag}: worker value"
    c = int(code[j])
    if c == 5: return unarmed_split(code, psg, j)
    if st == "paintA" and c in (8, 9):
        pass
    r = CODES.get(c, str(c))
    if c in (3, 4, 5, 7):
        mq = m / ref if m > 0 else 0
        if not (abs(mq - 1) < 0.05) and m > 0: r += " [msg wrong-octave]"
    return "blank: " + r


def run(tag):
    out = {}
    for conv in A.get("conv", "cons,strict").split(","):
        for st in ("paint", "paintA"):
            cnt = {}; per_s = {}
            sw_rows = []
            for s in an.SESSIONS:
                R = an.load_refs(s); m, cols = an.load_run(tag, s)
                L, hop = m["lookback"], m["hopS"]
                ref = R[conv]; msk = (R["spk"] == 1) & (ref > 0)
                t, r = R["t"][msk], ref[msk]
                idx = an.stage_index(t, st, L, hop)
                ok = (idx >= 0) & (idx < m["nHops"])
                tb = (r >= 160) & (r < 400) & ok
                for jj, rr in zip(idx[tb], r[tb]):
                    k = reason(cols, st, jj, rr)
                    cnt[k] = cnt.get(k, 0) + 1
                    per_s.setdefault(s, {}); per_s[s][k] = per_s[s].get(k, 0) + 1
                # switches
                pv = an.sample(cols[st], idx); c = an.classify(pv, r)
                reg = np.where(r >= 160, 1, np.where(r < 140, 0, 2))
                j, n = 0, len(t)
                pre = "gA_" if st == "paintA" else "g_"
                code = cols[pre + "code"]; lev = cols[pre + "level"]
                while j < n:
                    e = j
                    while e + 1 < n and reg[e + 1] == reg[j] and t[e + 1] - t[e] <= 0.1: e += 1
                    if reg[j] != 2 and t[e] - t[j] >= 0.2 and j > 0 and t[j] - t[j - 1] <= 1.0 and reg[j - 1] != 2 and reg[j - 1] != reg[j]:
                        key = "L->T" if reg[j] == 1 else "T->L"
                        w = np.nonzero(c["cor"][j:e + 1])[0]
                        lat = float(t[j + w[0]] - t[j]) if len(w) else float("inf")
                        wall = float((idx[j + w[0]] + 1) * hop - t[j]) if len(w) else float("inf")
                        stop = j + w[0] if len(w) else e + 1
                        blk = {}
                        for q in range(j, stop):
                            if not ok[q]: continue
                            rs = reason(cols, st, idx[q], r[q])
                            blk[rs] = blk.get(rs, 0) + 1
                        # gap before the run (display hops between prev ref frame and run start)
                        i0 = max(0, int(idx[j]) - 1)
                        g = 0
                        while i0 - g >= 0 and code[i0 - g] in GAPC: g += 1
                        sw_rows.append(dict(s=s, dir=key, t=float(t[j]), dur=float(t[e] - t[j]), lat=lat, wall=wall,
                                            gap_before=g, level_at_start=float(lev[max(0, int(idx[j]) - 1)]),
                                            prev_gap_s=float(t[j] - t[j - 1]), blk=blk))
                    j = e + 1
            out[f"{conv}|{st}"] = dict(counts=cnt, per_session=per_s, switches=sw_rows)
    return out


def summarize(res):
    for key, v in res.items():
        tot = sum(v["counts"].values())
        print(f"\n=== {key}: Alice target 160-400 frames n={tot}")
        for k, x in sorted(v["counts"].items(), key=lambda kv: -kv[1]):
            print(f"  {100 * x / tot:6.2f}%  {x:6d}  {k}")
        for d in ("L->T", "T->L"):
            rows = [r for r in v["switches"] if r["dir"] == d]
            if not rows: continue
            lat = sorted(r["lat"] for r in rows); wall = sorted(r["wall"] for r in rows)
            nn = len(rows); q = lambda a, p: a[min(nn - 1, int(p * nn))]
            never = sum(1 for x in lat if x == float("inf"))
            print(f"  {d}: n={nn} content med {q(lat, .5) * 1000:.0f} p75 {q(lat, .75) * 1000:.0f} p90 {q(lat, .9) * 1000:.0f} ms | "
                  f"wall med {q(wall, .5) * 1000:.0f} p75 {q(wall, .75) * 1000:.0f} p90 {q(wall, .9) * 1000:.0f} ms | never {100 * never / nn:.1f}%")
            # primary blocker per switch (most frames before first correct)
            prim = {}
            for r in rows:
                b = {k: x for k, x in r["blk"].items() if k != "correct"}
                pk = max(b, key=b.get) if b else "(immediate)"
                if r["lat"] == float("inf"): pk = "NEVER<- " + pk
                prim[pk] = prim.get(pk, 0) + 1
            for k, x in sorted(prim.items(), key=lambda kv: -kv[1]):
                print(f"      {x:3d}  {k}")
            # frames blocked summed across switches
            agg = {}
            for r in rows:
                for k, x in r["blk"].items(): agg[k] = agg.get(k, 0) + x
            tb = sum(agg.values())
            print(f"    blocked ref frames before first correct (sum over switches, n={tb}):")
            for k, x in sorted(agg.items(), key=lambda kv: -kv[1])[:10]:
                print(f"      {100 * x / max(tb, 1):5.1f}%  {k}")
            gb = {}
            for r in rows:
                kk = "gap>=2 before" if r["gap_before"] >= 2 else ("gap=1" if r["gap_before"] == 1 else "no gap")
                gb.setdefault(kk, []).append(r["lat"])
            print("    by gap before run: " + "; ".join(f"{k}: n={len(x)} med {sorted(x)[len(x) // 2] * 1000:.0f} ms never {sum(1 for y in x if y == float('inf'))}" for k, x in gb.items()))


if __name__ == "__main__":
    for tg in TAGS:
        res = run(tg)
        print(f"\n##### {tg}")
        summarize(res)
        if "json" in A: json.dump(res, open(A["json"], "w"), default=float)
