"""fe_score.py - scores the F0 front ends (§P4 of measurements/voice-preview-spike-2026-10-12.md).

  python -I fe_score.py --ptdb <PTDB-TUG subset root> [--fes H,D,S,L]

Inputs (VP_CACHE): fe-run.mjs renders measured by parity/meters.mjs (pitch: the real pitch
chain's posted pitch per 25 ms hop; vtln: the lab's live path), the originals' posted pitch
(parity/meters/pitch/orig), the front ends' 5 ms F0 tracks (fe/f0) and the PTDB-TUG
laryngograph reference (<ptdb>/<SEX>/REF/<who>/ref_<who>_<sx>.f0, column 1 = F0, 10 ms).

Checks, each against F-L (the baseline) as pre-registered:
  1 voicing loss P1 at (0, 1.00): share of hops voiced on the original and unvoiced on the
    render; median over the 8 clips <= F-L's + 2 pp
  2 gross pitch errors P2 on the prototype's eligible cells (95 <= orig median * 2^(st/12)
    <= 320 Hz): share of hops voiced in both with |12 log2(render/orig) - st| > 2 st;
    median over renders <= F-L's + 1 pp
  3 PTDB-TUG reference (pt_m1, pt_f1 and the 4 timing clips at 8 s, 16 kHz), 10 ms reference
    frames, each front end at its own best lag in -30..+30 ms (5 ms steps; best = most
    reference-voiced frames within 20 %): gross error (|d| > 20 %, voiced in both)
    <= F-L's + 1 pp; voicing recall >= F-L's - 3 pp; false voicing <= F-L's + 3 pp
  4 the prototype's four VTLN checks on the 8-clip x 25-cell grid all pass
Also: the F-S alignment check (lag that best aligns the mapped F-S track with the mapped
F-L track on the 8 clips, 1 ms steps; pass |lag| <= 5 ms) and the prototype's a1
(realised vs requested pitch within 0.5 st on eligible cells), for information.
Output: VP_CACHE/fe/scores.json
"""
import argparse, json, os, site, sys

ap = argparse.ArgumentParser()
ap.add_argument("--ptdb", required=True)
ap.add_argument("--fes", default="H,D,S,L")
A = ap.parse_args()
_us = site.getusersitepackages()
if _us not in sys.path:
    sys.path.append(_us)
import numpy as np  # noqa: E402

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.abspath(os.path.join(HERE, "..", "..", ".."))
CACHE = os.environ.get("VP_CACHE") or os.path.join(REPO, "build", "voice-preview")
PAR = os.path.join(CACHE, "parity")
FE = os.path.join(CACHE, "fe")
CL = os.path.join(CACHE, "clips")
clips = json.load(open(os.path.join(CL, "proto16", "clips.json"), encoding="utf8"))
FES = A.fes.split(",")
ST = [-6, -3, 0, 3, 6]
AL = [0.88, 0.94, 1.00, 1.06, 1.12]
G = 0.111


def cells(sex):
    out = [(s, a) for s in ST for a in AL]
    out.append((9, 1.15) if sex == "m" else (-9, 0.87))
    return out


def cell_name(st, a):
    return f"p{st:+d}_a{a:.2f}"


def f32(p):
    return np.fromfile(p, np.float32).astype(np.float64)


def post(s, clip, cell):
    return f32(os.path.join(PAR, "meters", "pitch", s, clip, cell + ".f32"))


def med_voiced(v):
    v = v[v > 0]
    return float(np.median(v)) if len(v) else np.nan


res = {}
# ---------------------------------------------------------------- checks 1 and 2 (+ a1)
for fe in FES:
    s = f"fe-{fe}"
    p1_0, p2, a1ok, rows = [], [], [], []
    for c in clips:
        po = post("orig", c["name"], "orig")
        mo = med_voiced(po)
        for st, a in cells(c["sex"]):
            pr = post(s, c["name"], cell_name(st, a))
            n = min(len(po), len(pr))
            vo, vr = po[:n] > 0, pr[:n] > 0
            p1 = float(np.mean(~vr[vo])) if vo.sum() else np.nan
            both = vo & vr
            d = 12 * np.log2(pr[:n][both] / po[:n][both]) - st
            g = float(np.mean(np.abs(d) > 2)) if both.sum() else np.nan
            elig = 95 <= mo * 2 ** (st / 12) <= 320
            mr = med_voiced(pr)
            err = 12 * np.log2(mr / mo) - st if mr > 0 else np.nan
            rows.append(dict(clip=c["name"], st=st, a=a, P1=p1, P2=g, eligible=bool(elig), err=err))
            if st == 0 and a == 1.0:
                p1_0.append(p1)
            if elig:
                p2.append(g)
                a1ok.append(bool(np.isfinite(err) and abs(err) <= 0.5))
    res[fe] = dict(
        P1_at_0_median=float(np.median(p1_0)), P1_at_0_per_clip={c["name"]: v for c, v in zip(clips, p1_0)},
        P2_eligible_median=float(np.median(p2)), P2_eligible_p90=float(np.percentile(p2, 90)), eligible=len(p2),
        a1_within_half_st=float(np.mean(a1ok)), rows=rows)

# ---------------------------------------------------------------- check 4: the prototype's VTLN checks
vt = {}
for fe in FES:
    for line in open(os.path.join(PAR, "meters", "vtln", f"fe-{fe}.jsonl"), encoding="utf8"):
        d = json.loads(line)
        if "key" not in d:
            continue
        v = [x for x in d["s"] if x is not None]
        vt[d["key"]] = float(np.median(v)) if len(v) >= 10 else np.nan


def a2(s):
    def rd(cn, st, a):
        return vt.get(f"{s}/{cn}/{cell_name(st, a)}", np.nan)
    slopes, signs, mono, leaks = [], [], [], []
    rows_missing = 0
    for c in clips:
        cn = c["name"]
        for st in ST:
            r = np.array([rd(cn, st, a) for a in AL])
            if np.any(~np.isfinite(r)):
                rows_missing += 1
                continue
            slopes.append(np.polyfit(np.log(AL), r, 1)[0] * np.log(1.15) / G)
            mono.append(bool(np.all(np.diff(r) > 0)))
            for a, sgn in [(0.94, -1), (1.06, 1)]:
                signs.append(np.sign(r[AL.index(a)] - r[AL.index(1.0)]) == sgn)
        r = np.array([rd(cn, st, 1.0) for st in ST])
        ok = np.isfinite(r)
        if ok.sum() >= 3:
            leaks.append(np.polyfit(np.array(ST)[ok] / 12, r[ok], 1)[0])
    ms = float(np.median(slopes)); sa = float(np.mean(signs)); mo = float(np.mean(mono))
    leak = abs(float(np.median(leaks))) / G
    v = dict(norm_slope=bool(0.5 <= ms <= 1.5), sign_acc=bool(sa >= 0.9), monotonic=bool(mo >= 0.8), leak=bool(leak <= 0.2))
    return dict(norm_slope=ms, sign_acc=sa, monotonic=mo, leak=leak, rows=len(slopes), rows_missing=rows_missing,
                verdicts=v, all_pass=all(v.values()))


for fe in FES:
    res[fe]["vtln"] = a2(f"fe-{fe}")

# ---------------------------------------------------------------- check 3: PTDB-TUG reference
idx = json.load(open(os.path.join(FE, "f0", "index.json"), encoding="utf8"))
FP = idx["framePeriodMs"] / 1000.0


def ref_frames(clip):
    """(time of each 10 ms reference frame in clip time, reference F0) over the clip's files."""
    ts, fs = [], []
    for f in clip["files"]:
        who = f["file"].split("_")[1]
        sx = f["file"].split("_")[2].replace(".wav", "")
        sub = "MALE" if who.startswith("M") else "FEMALE"
        r = np.loadtxt(os.path.join(A.ptdb, sub, "REF", who, f"ref_{who}_{sx}.f0"))[:, 0]
        t = f["startSec"] + np.arange(len(r)) * 0.01
        keep = t < clip["durSec"]
        ts.append(t[keep]); fs.append(r[keep])
    return np.concatenate(ts), np.concatenate(fs)


refs = {c["name"]: ref_frames(c) for c in idx["clips"]}
LAGS = np.arange(-30, 31, 5) / 1000.0
for fe in FES:
    tracks = {c["name"]: np.fromfile(os.path.join(FE, "f0", fe, c["name"] + ".f64"), np.float64) for c in idx["clips"]}

    def score(lag, names):
        ok = vb = rv = fv = un = 0
        for nm in names:
            t, r = refs[nm]
            f = tracks[nm]
            i = np.rint((t + lag) / FP).astype(int)
            m = (i >= 0) & (i < len(f))
            rr, ff = r[m], f[i[m]]
            both = (rr > 0) & (ff > 0)
            good = both & (np.abs(ff / np.where(rr > 0, rr, 1) - 1) <= 0.2)
            ok += int(good.sum()); vb += int(both.sum()); rv += int((rr > 0).sum())
            fv += int(((ff > 0) & (rr <= 0)).sum()); un += int((rr <= 0).sum())
        return dict(rpa=ok / rv, gross=1 - ok / vb if vb else np.nan, recall=vb / rv, false_voicing=fv / un,
                    ref_voiced=rv, ref_unvoiced=un, both=vb)
    names = [c["name"] for c in idx["clips"]]
    best = max(LAGS, key=lambda L: score(L, names)["rpa"])
    s = score(best, names)
    s["lag_ms"] = float(best * 1000)
    s["per_clip"] = {nm: score(best, [nm]) for nm in names}
    res[fe]["ptdb"] = s

# ---------------------------------------------------------------- F-S alignment vs F-L
def map_track(track, t, origin, step):
    n = len(track)
    p = (t - origin) / step
    j0 = np.floor(p).astype(int)
    g = lambda j: np.where((j >= 0) & (j < n), track[np.clip(j, 0, n - 1)], 0.0)  # noqa: E731
    g0, g1 = g(j0), g(j0 + 1)
    w = p - j0
    with np.errstate(divide="ignore", invalid="ignore"):
        interp = np.exp((1 - w) * np.log(np.where(g0 > 0, g0, 1)) + w * np.log(np.where(g1 > 0, g1, 1)))
    jn = np.rint(p).astype(int)
    near = np.where(np.abs(p - jn) <= 0.75, g(jn), 0.0)
    return np.where((g0 > 0) & (g1 > 0), interp, near)


if "S" in FES:
    errs = {}
    for dl in range(-20, 21):
        tot, cnt = 0.0, 0
        for c in clips:
            D = os.path.join(CL, "proto16")
            x_n = os.path.getsize(os.path.join(D, c["name"] + ".f32")) // 4
            nf = int(x_n / 16000 * 1000 / 5) + 1
            t = np.arange(nf) * 0.005
            fl = map_track(f32(os.path.join(D, c["name"] + ".grid.f32")), t, 0.005, 0.01)
            fs = map_track(f32(os.path.join(D, c["name"] + ".post.f32")), t, -0.015 + dl / 1000.0, 0.025)
            both = (fl > 0) & (fs > 0)
            d = np.abs(12 * np.log2(fs[both] / fl[both]))
            d = d[d < 2]  # ignore octave-class disagreements; alignment is about timing
            tot += float(np.sum(d)); cnt += len(d)
        errs[dl] = tot / cnt
    best = min(errs, key=errs.get)
    res["S_alignment"] = dict(best_lag_ms=best, pass_=abs(best) <= 5, mean_abs_st=errs)

# ---------------------------------------------------------------- verdicts
L = res["L"]
for fe in FES:
    r = res[fe]
    c1 = r["P1_at_0_median"] <= L["P1_at_0_median"] + 0.02
    c2 = r["P2_eligible_median"] <= L["P2_eligible_median"] + 0.01
    pt, pl = r["ptdb"], L["ptdb"]
    c3 = dict(gross=pt["gross"] <= pl["gross"] + 0.01, recall=pt["recall"] >= pl["recall"] - 0.03,
              false_voicing=pt["false_voicing"] <= pl["false_voicing"] + 0.03)
    c4 = r["vtln"]["all_pass"]
    r["checks"] = dict(c1=bool(c1), c2=bool(c2), c3=bool(all(c3.values())), c3_parts={k: bool(v) for k, v in c3.items()}, c4=bool(c4))
    r["meets_1_to_4"] = bool(c1 and c2 and all(c3.values()) and c4)

with open(os.path.join(FE, "scores.json"), "w") as f:
    json.dump(res, f, indent=1, default=lambda o: None if (isinstance(o, float) and not np.isfinite(o)) else (bool(o) if isinstance(o, np.bool_) else float(o)))

pc = lambda v: f"{v * 100:5.1f}"  # noqa: E731
print("fe  P1@0 med  P2 elig med (p90)  a1<=0.5st  PTDB lag  gross  recall  falseV   VTLN slope sign mono leak  c1 c2 c3 c4  meets")
for fe in FES:
    r = res[fe]; p = r["ptdb"]; v = r["vtln"]; k = r["checks"]
    print(f"{fe:3s} {pc(r['P1_at_0_median'])} %   {pc(r['P2_eligible_median'])} % ({pc(r['P2_eligible_p90'])})    {pc(r['a1_within_half_st'])} %  "
          f"{p['lag_ms']:+5.0f} ms {pc(p['gross'])} {pc(p['recall'])} {pc(p['false_voicing'])}   "
          f"{v['norm_slope']:.3f} {v['sign_acc']:.3f} {v['monotonic']:.3f} {v['leak']:.3f}  "
          f"{'Y' if k['c1'] else 'n'}  {'Y' if k['c2'] else 'n'}  {'Y' if k['c3'] else 'n'}  {'Y' if k['c4'] else 'n'}   {r['meets_1_to_4']}")
if "S_alignment" in res:
    print(f"F-S alignment vs F-L: best lag {res['S_alignment']['best_lag_ms']:+d} ms -> {'PASS' if res['S_alignment']['pass_'] else 'FAIL'}")
for fe in FES:
    print(fe, "PTDB per clip:", {k: (round(v["gross"] * 100, 1), round(v["recall"] * 100, 1), round(v["false_voicing"] * 100, 1)) for k, v in res[fe]["ptdb"]["per_clip"].items()})
    print(fe, "P1@0 per clip:", {k: round(v * 100, 1) for k, v in res[fe]["P1_at_0_per_clip"].items()})
