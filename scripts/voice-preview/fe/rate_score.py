"""rate_score.py - scores rate-check.mjs (render quality at 16 / 22.05 / 24 kHz with F-S), a
labelled addition to §P4 of measurements/voice-preview-spike-2026-10-12.md (review, 2026-10-12).

  python -I rate_score.py

Per rate, on 8 clips (speech-dense 5 s and pre-registered 8 s timing clips, 48 kHz sources):
  check 1  voicing loss at (0, 1.00): share of hops the real chain posts voiced on the original
           (the 48 kHz clip's posted track, the F-S input) and unvoiced on the render; median of 8
  check 2  gross pitch errors on the prototype's eligible cells (95 <= orig median * 2^(st/12)
           <= 320 Hz): share of hops voiced in both with |12 log2(render/orig) - st| > 2 st; median
  check 4  the prototype's four VTLN checks on the 8-clip x 25-cell grid (renders brought to 16 kHz)
Judged against 16 kHz on the same clips with §P4's margins (post hoc: 16 kHz is the baseline here):
check 1 <= 16 kHz + 2 pp, check 2 <= 16 kHz + 1 pp, check 4 all four pass.
Output: VP_CACHE/fe/rate/scores.json and a printed table.

§ Addition 2026-10-12 (A4): --dir rate-hi --rates 16000,32000,44100,48000 scores rate-check.mjs's
run at the new rates (the first rate is the baseline). At 44 100 Hz the original is the clip's
44.1 kHz copy, so checks 1 and 2 read against that copy's posted track (clips.json byRate).
"""
import argparse, json, os, site, sys

_us = site.getusersitepackages()
if _us not in sys.path:
    sys.path.append(_us)
import numpy as np  # noqa: E402

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.abspath(os.path.join(HERE, "..", "..", ".."))
CACHE = os.environ.get("VP_CACHE") or os.path.join(REPO, "build", "voice-preview")
ap = argparse.ArgumentParser()
ap.add_argument("--dir", default="rate")
ap.add_argument("--rates", default="16000,22050,24000")
A = ap.parse_args()
D = os.path.join(CACHE, "fe", A.dir)
RATES = [int(r) for r in A.rates.split(",")]
ST = [-6, -3, 0, 3, 6]
AL = [0.88, 0.94, 1.00, 1.06, 1.12]
G = 0.111
clips = json.load(open(os.path.join(D, "clips.json"), encoding="utf8"))


def cells(sex):
    out = [(s, a) for s in ST for a in AL]
    out.append((9, 1.15) if sex == "m" else (-9, 0.87))
    return out


def cn(st, a):
    return f"p{st:+d}_a{a:.2f}"


def f32(p):
    return np.fromfile(p, np.float32).astype(np.float64)


def med_voiced(v):
    v = v[v > 0]
    return float(np.median(v)) if len(v) else np.nan


vt = {}
for line in open(os.path.join(D, "vtln.jsonl"), encoding="utf8"):
    d = json.loads(line)
    if "key" in d:
        v = [x for x in d["s"] if x is not None]
        vt[d["key"]] = float(np.median(v)) if len(v) >= 10 else np.nan

res = {}
for rate in RATES:
    p1, p2, rows = [], [], []
    for c in clips:
        po = f32(c.get("byRate", {}).get(str(rate), {}).get("posted") or c["posted"])
        mo = med_voiced(po)
        for st, a in cells(c["sex"]):
            pr = f32(os.path.join(D, "post", str(rate), c["name"], cn(st, a) + ".f32"))
            n = min(len(po), len(pr))
            vo, vr = po[:n] > 0, pr[:n] > 0
            both = vo & vr
            d = 12 * np.log2(pr[:n][both] / po[:n][both]) - st
            g = float(np.mean(np.abs(d) > 2)) if both.sum() else np.nan
            if st == 0 and a == 1.0:
                p1.append(float(np.mean(~vr[vo])))
            if 95 <= mo * 2 ** (st / 12) <= 320:
                p2.append(g)
            rows.append(dict(clip=c["name"], st=st, a=a, P2=g))
    slopes, signs, mono, leaks, missing = [], [], [], [], 0
    for c in clips:
        def rd(st, a):
            return vt.get(f"{rate}/{c['name']}/{cn(st, a)}", np.nan)
        for st in ST:
            r = np.array([rd(st, a) for a in AL])
            if np.any(~np.isfinite(r)):
                missing += 1
                continue
            slopes.append(np.polyfit(np.log(AL), r, 1)[0] * np.log(1.15) / G)
            mono.append(bool(np.all(np.diff(r) > 0)))
            for a, sgn in [(0.94, -1), (1.06, 1)]:
                signs.append(np.sign(r[AL.index(a)] - r[AL.index(1.0)]) == sgn)
        r = np.array([rd(st, 1.0) for st in ST])
        ok = np.isfinite(r)
        if ok.sum() >= 3:
            leaks.append(np.polyfit(np.array(ST)[ok] / 12, r[ok], 1)[0])
    vt4 = dict(norm_slope=float(np.median(slopes)), sign_acc=float(np.mean(signs)), monotonic=float(np.mean(mono)),
               leak=abs(float(np.median(leaks))) / G, rows=len(slopes), rows_missing=missing)
    vt4["verdicts"] = dict(norm_slope=bool(0.5 <= vt4["norm_slope"] <= 1.5), sign_acc=bool(vt4["sign_acc"] >= 0.9),
                           monotonic=bool(vt4["monotonic"] >= 0.8), leak=bool(vt4["leak"] <= 0.2))
    res[rate] = dict(P1_median=float(np.median(p1)), P1_per_clip=dict(zip([c["name"] for c in clips], p1)),
                     P2_median=float(np.nanmedian(p2)), P2_p90=float(np.nanpercentile(p2, 90)), eligible=len(p2), vtln=vt4)
b = res[RATES[0]]
for rate in RATES:
    r = res[rate]
    r["checks"] = dict(c1=bool(r["P1_median"] <= b["P1_median"] + 0.02), c2=bool(r["P2_median"] <= b["P2_median"] + 0.01),
                       c4=bool(all(r["vtln"]["verdicts"].values())))
    r["holds"] = all(r["checks"].values())
with open(os.path.join(D, "scores.json"), "w") as f:
    json.dump({str(k): v for k, v in res.items()}, f, indent=1)
print("rate    P1@0 med   P2 elig med (p90, n)    VTLN slope sign  mono  leak (rows)   c1 c2 c4  holds")
for rate in RATES:
    r = res[rate]; v = r["vtln"]; k = r["checks"]
    print(f"{rate:5d}   {r['P1_median'] * 100:5.1f} %    {r['P2_median'] * 100:5.1f} % ({r['P2_p90'] * 100:4.1f}, {r['eligible']})       "
          f"{v['norm_slope']:.3f} {v['sign_acc']:.3f} {v['monotonic']:.3f} {v['leak']:.3f} ({v['rows']}/{v['rows'] + v['rows_missing']})   "
          f"{'Y' if k['c1'] else 'n'}  {'Y' if k['c2'] else 'n'}  {'Y' if k['c4'] else 'n'}   {r['holds']}")
for rate in RATES:
    print(rate, "P1@0 per clip:", {k: round(v * 100, 1) for k, v in res[rate]["P1_per_clip"].items()})
