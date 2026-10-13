"""hirate_score.py - Level 3 of the parity check at 32 000, 44 100 and 48 000 Hz (§ Addition 2026-10-12,
A4, of measurements/voice-preview-spike-2026-10-12.md): do Syrinx's meters read the WebAssembly
renders like the pyworld renders, at each new rate?

  python -I hirate_score.py [--dir rate-hi] [--rates 32000,44100,48000]

WebAssembly side: fe/<dir>/post/<rate>/... and fe/<dir>/vtln.jsonl (rate-check.mjs); pyworld side:
fe/<dir>/meters-pyworld/post/<rate>/... and .../vtln.jsonl (hirate-meters.mjs). Per rate, 208
finished renders per engine (8 clips x 26 cells). Pass criteria, §P3 Level 3 unchanged:
  pitch  the real pitch chain at the render's own rate: clip median of the voiced posted pitch
         within 0.05 st, and frame-wise posted-voicing agreement >= 98 %, on every render
  VTLN   clip reading (median of non-null 150 ms bins; missing if < 10) within 0.01 ln
  the prototype's four VTLN checks (as fe/rate_score.py, on the 8-clip x 25-cell grid), on each
  engine's renders: same verdicts, each statistic within +-0.02
A render whose VTLN reading is missing for both engines (fewer than 10 readable bins in both) is
counted and listed separately; a reading missing for one engine only fails.
Output: fe/<dir>/level3-hi.json and a printed summary.
"""
import argparse, json, os, site, sys

ap = argparse.ArgumentParser()
ap.add_argument("--dir", default="rate-hi")
ap.add_argument("--rates", default="32000,44100,48000")
A = ap.parse_args()
_us = site.getusersitepackages()
if _us not in sys.path:
    sys.path.append(_us)
import numpy as np  # noqa: E402

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.abspath(os.path.join(HERE, "..", "..", ".."))
CACHE = os.environ.get("VP_CACHE") or os.path.join(REPO, "build", "voice-preview")
D = os.path.join(CACHE, "fe", A.dir)
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


def load_vtln(p):
    out = {}
    for line in open(p, encoding="utf8"):
        d = json.loads(line)
        if "key" in d:
            v = [x for x in d["s"] if x is not None]
            out[d["key"]] = float(np.median(v)) if len(v) >= 10 else np.nan
    return out


VT = {"wasm": load_vtln(os.path.join(D, "vtln.jsonl")), "pyworld": load_vtln(os.path.join(D, "meters-pyworld", "vtln.jsonl"))}
POST = {"wasm": os.path.join(D, "post"), "pyworld": os.path.join(D, "meters-pyworld", "post")}


def a2(vt, rate):  # the prototype's four VTLN checks, as fe/rate_score.py
    def rd(clip, st, a):
        return vt.get(f"{rate}/{clip}/{cn(st, a)}", np.nan)
    slopes, signs, mono, leaks, missing = [], [], [], [], 0
    for c in clips:
        for st in ST:
            r = np.array([rd(c["name"], st, a) for a in AL])
            if np.any(~np.isfinite(r)):
                missing += 1
                continue
            slopes.append(np.polyfit(np.log(AL), r, 1)[0] * np.log(1.15) / G)
            mono.append(bool(np.all(np.diff(r) > 0)))
            for a, sgn in [(0.94, -1), (1.06, 1)]:
                signs.append(np.sign(r[AL.index(a)] - r[AL.index(1.0)]) == sgn)
        r = np.array([rd(c["name"], st, 1.0) for st in ST])
        ok = np.isfinite(r)
        if ok.sum() >= 3:
            leaks.append(np.polyfit(np.array(ST)[ok] / 12, r[ok], 1)[0])
    v = dict(norm_slope=float(np.median(slopes)), sign_acc=float(np.mean(signs)), monotonic=float(np.mean(mono)),
             leak=abs(float(np.median(leaks))) / G, rows=len(slopes), rows_missing=missing)
    v["verdicts"] = dict(norm_slope=bool(0.5 <= v["norm_slope"] <= 1.5), sign_acc=bool(v["sign_acc"] >= 0.9),
                         monotonic=bool(v["monotonic"] >= 0.8), leak=bool(v["leak"] <= 0.2))
    return v


res = {}
for rate in [int(r) for r in A.rates.split(",")]:
    prow, vrow = [], []
    for c in clips:
        for st, a in cells(c["sex"]):
            n_ = cn(st, a)
            pa = f32(os.path.join(POST["wasm"], str(rate), c["name"], n_ + ".f32"))
            pb = f32(os.path.join(POST["pyworld"], str(rate), c["name"], n_ + ".f32"))
            ma, mb = med_voiced(pa), med_voiced(pb)
            n = min(len(pa), len(pb))
            dmed = abs(12 * np.log2(ma / mb)) if ma > 0 and mb > 0 else np.nan
            agree = float(np.mean((pa[:n] > 0) == (pb[:n] > 0)))
            prow.append(dict(clip=c["name"], cell=n_, dmed_st=dmed, voicing_agree=agree, pass_=bool(np.isfinite(dmed) and dmed <= 0.05 and agree >= 0.98)))
            k = f"{rate}/{c['name']}/{n_}"
            ra, rb = VT["wasm"].get(k, np.nan), VT["pyworld"].get(k, np.nan)
            both_missing = not np.isfinite(ra) and not np.isfinite(rb)
            d = abs(ra - rb)
            vrow.append(dict(clip=c["name"], cell=n_, wasm=ra, pyworld=rb, d=d, both_missing=both_missing,
                             pass_=bool(both_missing or (np.isfinite(d) and d <= 0.01))))
    chk = {e: a2(VT[e], rate) for e in ("wasm", "pyworld")}
    same = chk["wasm"]["verdicts"] == chk["pyworld"]["verdicts"]
    sd = {k: abs(chk["wasm"][k] - chk["pyworld"][k]) for k in ("norm_slope", "sign_acc", "monotonic", "leak")}
    dm = np.array([r["dmed_st"] for r in prow]); va = np.array([r["voicing_agree"] for r in prow]); dv = np.array([r["d"] for r in vrow])
    r = dict(renders=len(prow),
             pitch=dict(pass_=all(x["pass_"] for x in prow), max_dmed_st=float(np.nanmax(dm)), median_dmed_st=float(np.nanmedian(dm)),
                        n_nan=int(np.sum(~np.isfinite(dm))), min_voicing_agree=float(va.min()), median_voicing_agree=float(np.median(va)),
                        failing=[x for x in prow if not x["pass_"]]),
             vtln=dict(pass_=all(x["pass_"] for x in vrow), max_d=float(np.nanmax(dv)), median_d=float(np.nanmedian(dv)),
                       both_missing=[x["clip"] + "/" + x["cell"] for x in vrow if x["both_missing"]],
                       one_missing=[x["clip"] + "/" + x["cell"] for x in vrow if not x["both_missing"] and not np.isfinite(x["d"])],
                       failing=[x for x in vrow if not x["pass_"]]),
             vtln_checks=dict(pass_=bool(same and max(sd.values()) <= 0.02), same_verdicts=same, stat_abs_diff=sd, **chk))
    r["pass_"] = bool(r["pitch"]["pass_"] and r["vtln"]["pass_"] and r["vtln_checks"]["pass_"])
    res[str(rate)] = r
    print(f"{rate}: pitch max |d median| {r['pitch']['max_dmed_st']:.4f} st, voicing agreement min {r['pitch']['min_voicing_agree'] * 100:.2f} % "
          f"-> {'PASS' if r['pitch']['pass_'] else 'FAIL'}; VTLN max |d| {r['vtln']['max_d']:.2e} ln, both missing {len(r['vtln']['both_missing'])}, "
          f"one missing {len(r['vtln']['one_missing'])} -> {'PASS' if r['vtln']['pass_'] else 'FAIL'}; checks same verdicts {same}, "
          f"max stat diff {max(sd.values()):.2e} -> {'PASS' if r['vtln_checks']['pass_'] else 'FAIL'}; Level 3 {'PASS' if r['pass_'] else 'FAIL'}")
    for e in ("wasm", "pyworld"):
        c = chk[e]
        print(f"   {e:8s} slope {c['norm_slope']:.3f} sign {c['sign_acc']:.3f} mono {c['monotonic']:.3f} leak {c['leak']:.3f} rows {c['rows']}/{c['rows'] + c['rows_missing']}")
with open(os.path.join(D, "level3-hi.json"), "w") as f:
    json.dump(res, f, indent=1, default=lambda o: None if (isinstance(o, float) and not np.isfinite(o)) else str(o))
