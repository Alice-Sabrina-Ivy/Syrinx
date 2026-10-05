# lowband_score.py — guard metrics for the low-register voicing pass
# (2026-10-04; private measurement, kept outside this repo), from
# lowband-attr.mjs dumps: per group x band x stage (post = worker-posted,
# paint = live trace) the ±5 % correct (C5), 50-cent RPA, null, octave-down
# (x1/2, x1/3), octave-up (x2, x3/x4) and other shares, plus VDE on the
# corpora (all reference frames, ref-voiced vs value > 0) and the
# gender-symmetric max(F_err, M_err) on FDA / PTDB.
#
# Usage: python scripts/session-oracle/lowband_score.py BASE TAG [TAG...]
#          [--attr=...] [--refs=...] [--data=...] [--json=PATH] [--full]
# Alignment = lowband_attr.py (session-oracle conventions, nearest hop).
import sys, os, json
import numpy as np

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import lowband_attr as la

A = la.A
TAGS = la.TAGS
BANDS = [("75-110", 75, 110), ("110-160", 110, 160), ("75-160", 75, 160), ("160-400", 160, 400), ("400+", 400, 1e9), ("all", 0, 1e9)]
STAGES = ("post", "paint")


def cls(v, r):
    ev = v > 0
    q = np.where(ev, v / np.where(r > 0, r, 1), 0)
    cents = np.where(ev, 1200 * np.log2(np.where(ev, v, 1) / np.where(r > 0, r, 1)), np.inf)
    c5 = ev & (np.abs(q - 1) < 0.05)
    dn = ev & ((np.abs(q - 0.5) <= 0.05) | (np.abs(q - 1 / 3) <= 0.0333))
    up = ev & ((np.abs(q - 2) <= 0.2) | (np.abs(q - 3) <= 0.3) | (np.abs(q - 4) <= 0.4))
    return dict(C5=c5, RPA=ev & (np.abs(cents) < 50), null=~ev, down=dn, up=up, other=ev & ~(c5 | dn | up))


def values(m, c, t):
    hop, L = m["hopS"], m["L"]
    kw = np.round((t + 0.040) / hop - 1).astype(int)
    kd = np.round((t + 0.040 + L * hop + 0.030) / hop - 1).astype(int)
    return {"post": la.take(c["post"], kw), "paint": la.take(c["paint"], kd)}


def collect(tag):
    G = {}  # group -> list of (r_all, {stage: v_all})  (r_all includes 0 = ref-unvoiced)
    for s in la.SESSIONS:
        z = np.load(f"{la.REFS}/{s}.npz")
        m, c = la.load(tag, "sessions", s)
        for conv in ("cons", "strict"):
            ref = np.where(z[conv] >= 75, z[conv], 0)
            for spk, code in (("alice", 1), ("second", 2)):
                if conv == "strict" and spk == "second": continue
                msk = (z["spk"] == code) & (ref > 0)
                v = values(m, c, z["t"][msk])
                G.setdefault(f"{spk}_{conv}", []).append((ref[msk], v))
                if s == "2026-06-09": G.setdefault(f"{spk}_{conv}_HO", []).append((ref[msk], v))
    idx = json.load(open(f"{la.DATA}/index.json"))
    for tr in idx:
        cp = tr["corpus"]
        r = np.fromfile(f"{la.DATA}/{cp}/{tr['trackId']}.ref.f32", dtype=np.float32).astype(float)
        r[r < 50] = 0
        t = np.arange(len(r)) * tr["refHopMs"] / 1000 + tr["refOffsetMs"] / 1000
        m, c = la.load(tag, cp, tr["trackId"])
        v = values(m, c, t)
        g = f"{cp}_{tr['gender']}" if cp != "voc" else "voc"
        G.setdefault(g, []).append((r, v))
    return G


def summarize(G):
    out = {}
    for g, parts in G.items():
        r = np.concatenate([p[0] for p in parts])
        for st in STAGES:
            v = np.concatenate([p[1][st] for p in parts])
            K = cls(v, r)
            vde = 100 * float(np.mean((v > 0) != (r > 0))) if (r == 0).any() else None
            fv = 100 * float(np.mean(v[r == 0] > 0)) if (r == 0).any() else None
            for bn, lo, hi in BANDS:
                b = (r > 0) & (r >= lo) & (r < hi)
                n = int(b.sum())
                if not n: continue
                row = {"n": n, **{k: 100 * float(K[k][b].mean()) for k in K}}
                if bn == "all": row["VDE"], row["FV"] = vde, fv
                out[f"{g}|{st}|{bn}"] = row
    for st in STAGES:
        for cp in ("fda", "ptdb", "hil"):
            f, mm = out.get(f"{cp}_f|{st}|all"), out.get(f"{cp}_m|{st}|all")
            if f and mm: out[f"{cp}|{st}|maxerr"] = {"n": f["n"] + mm["n"], "C5": max(100 - f["C5"], 100 - mm["C5"])}
    return out


if __name__ == "__main__":
    R = {t: summarize(collect(t)) for t in TAGS}
    if "json" in A: json.dump(R, open(A["json"], "w"), indent=1)
    base = TAGS[0]
    full = "full" in A
    show = [k for k in R[base] if full or any(s in k for s in (
        "|75-160", "|160-400", "|all", "maxerr"))]
    print(f"{'group|stage|band':30s} {'n':>6s} | " + " | ".join(f"{t[:14]:>14s} C5  RPA  null  dn   up   VDE " for t in TAGS))
    for k in show:
        cells = []
        for t in TAGS:
            x = R[t].get(k)
            if not x: cells.append(" " * 40); continue
            d = (lambda key: x.get(key, float("nan")) - R[base][k].get(key, float("nan"))) if t != base else None
            if t == base:
                cells.append(f"{x['C5']:6.2f} {x.get('RPA', float('nan')):6.2f} {x.get('null', float('nan')):5.2f} {x.get('down', float('nan')):4.2f} {x.get('up', float('nan')):4.2f} {x['VDE'] if x.get('VDE') is not None else float('nan'):5.2f}")
            else:
                cells.append(f"{d('C5'):+6.2f} {d('RPA'):+6.2f} {d('null'):+5.2f} {d('down'):+4.2f} {d('up'):+4.2f} {(x['VDE'] - R[base][k]['VDE']) if x.get('VDE') is not None else float('nan'):+5.2f}")
        print(f"{k:30s} {R[base][k]['n']:6d} | " + " | ".join(cells))
