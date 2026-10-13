"""meters_score.py - Level 3 of the voice-preview parity check (§P3): do Syrinx's meters read
the WebAssembly renders like the pyworld renders? Reads meters.mjs output for two render sets.

  python -I meters_score.py [--a wasm-simd] [--b pyworld] [--out level3.json]

Pass criteria (every render, 8 clips x 26 cells):
  pitch  clip median of the voiced posted pitch within 0.05 st; frame-wise posted-voicing
         agreement >= 98 %
  VTLN   clip reading (median of non-null 150 ms bins, missing if < 10) within 0.01 ln
  The prototype's four VTLN checks (its analyze.py a2, unchanged in substance), recomputed on
  each set: same pass/fail verdicts, each statistic within +-0.02.
Output: VP_CACHE/parity/level3.json (or --out)
"""
import argparse, json, os, site, sys

ap = argparse.ArgumentParser()
ap.add_argument("--a", default="wasm-simd")
ap.add_argument("--b", default="pyworld")
ap.add_argument("--out", default="level3.json")
A = ap.parse_args()
_us = site.getusersitepackages()
if _us not in sys.path:
    sys.path.append(_us)
import numpy as np  # noqa: E402

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.abspath(os.path.join(HERE, "..", "..", ".."))
CACHE = os.environ.get("VP_CACHE") or os.path.join(REPO, "build", "voice-preview")
PAR = os.path.join(CACHE, "parity")
clips = json.load(open(os.path.join(CACHE, "clips", "proto16", "clips.json"), encoding="utf8"))
ST = [-6, -3, 0, 3, 6]
AL = [0.88, 0.94, 1.00, 1.06, 1.12]
G = 0.111


def cells(sex):
    out = [(s, a) for s in ST for a in AL]
    out.append((9, 1.15) if sex == "m" else (-9, 0.87))
    return out


def cell_name(st, a):
    return f"p{st:+d}_a{a:.2f}"


def post(s, clip, cell):
    return np.fromfile(os.path.join(PAR, "meters", "pitch", s, clip, cell + ".f32"), np.float32).astype(np.float64)


def med_voiced(v):
    v = v[v > 0]
    return float(np.median(v)) if len(v) else np.nan


vt = {}
for s in (A.a, A.b):
    for line in open(os.path.join(PAR, "meters", "vtln", s + ".jsonl"), encoding="utf8"):
        d = json.loads(line)
        if "key" not in d:  # lab_live.mjs ends with a summary line
            continue
        v = [x for x in d["s"] if x is not None]
        vt[d["key"]] = float(np.median(v)) if len(v) >= 10 else np.nan

pitch_rows, vtln_rows = [], []
for c in clips:
    for st, a in cells(c["sex"]):
        cn = cell_name(st, a)
        pa, pb = post(A.a, c["name"], cn), post(A.b, c["name"], cn)
        ma, mb = med_voiced(pa), med_voiced(pb)
        n = min(len(pa), len(pb))
        dmed = abs(12 * np.log2(ma / mb)) if ma > 0 and mb > 0 else np.nan
        agree = float(np.mean((pa[:n] > 0) == (pb[:n] > 0)))
        pitch_rows.append(dict(clip=c["name"], cell=cn, med_a=ma, med_b=mb, dmed_st=dmed, voicing_agree=agree,
                               pass_=bool(np.isfinite(dmed) and dmed <= 0.05 and agree >= 0.98)))
        ra, rb = vt.get(f"{A.a}/{c['name']}/{cn}", np.nan), vt.get(f"{A.b}/{c['name']}/{cn}", np.nan)
        d = abs(ra - rb)
        vtln_rows.append(dict(clip=c["name"], cell=cn, a=ra, b=rb, d=d, pass_=bool(np.isfinite(d) and d <= 0.01)))


def a2(s):  # the prototype's analyze.py a2, on one render set
    def rd(cn, st, a):
        return vt.get(f"{s}/{cn}/{cell_name(st, a)}", np.nan)
    slopes, signs, mono, leaks, leak_sex = [], [], [], [], {"m": [], "f": []}
    rows_missing = 0
    for c in clips:
        cn = c["name"]
        for st in ST:
            r = np.array([rd(cn, st, a) for a in AL])
            if np.any(~np.isfinite(r)):
                rows_missing += 1
                continue
            la = np.log(AL)
            slopes.append(np.polyfit(la, r, 1)[0] * np.log(1.15) / G)
            mono.append(bool(np.all(np.diff(r) > 0)))
            for a, sgn in [(0.94, -1), (1.06, 1)]:
                signs.append(np.sign(r[AL.index(a)] - r[AL.index(1.0)]) == sgn)
        r = np.array([rd(cn, st, 1.0) for st in ST])
        ok = np.isfinite(r)
        if ok.sum() >= 3:
            sl = np.polyfit(np.array(ST)[ok] / 12, r[ok], 1)[0]
            leaks.append(sl); leak_sex[c["sex"]].append(sl)
    ms = float(np.median(slopes)); sa = float(np.mean(signs)); mo = float(np.mean(mono))
    leak = abs(float(np.median(leaks))) / G
    return dict(norm_slope=ms, sign_acc=sa, monotonic=mo, leak=leak, rows=len(slopes), rows_missing=rows_missing,
                verdicts=dict(norm_slope=bool(0.5 <= ms <= 1.5), sign_acc=bool(sa >= 0.9), monotonic=bool(mo >= 0.8), leak=bool(leak <= 0.2)))


chk = {A.a: a2(A.a), A.b: a2(A.b)}
same_verdicts = chk[A.a]["verdicts"] == chk[A.b]["verdicts"]
stat_d = {k: abs(chk[A.a][k] - chk[A.b][k]) for k in ("norm_slope", "sign_acc", "monotonic", "leak")}
checks_pass = bool(same_verdicts and max(stat_d.values()) <= 0.02)

dm = np.array([r["dmed_st"] for r in pitch_rows]); va = np.array([r["voicing_agree"] for r in pitch_rows])
dv = np.array([r["d"] for r in vtln_rows])
out = dict(
    sets=[A.a, A.b], renders=len(pitch_rows),
    pitch=dict(pass_=all(r["pass_"] for r in pitch_rows), max_dmed_st=float(np.nanmax(dm)), median_dmed_st=float(np.nanmedian(dm)),
               min_voicing_agree=float(va.min()), median_voicing_agree=float(np.median(va)),
               failing=[r for r in pitch_rows if not r["pass_"]]),
    vtln=dict(pass_=all(r["pass_"] for r in vtln_rows), max_d=float(np.nanmax(dv)), median_d=float(np.nanmedian(dv)),
              missing=int(np.sum(~np.isfinite(dv))), failing=[r for r in vtln_rows if not r["pass_"]]),
    vtln_checks=dict(pass_=checks_pass, same_verdicts=same_verdicts, stat_abs_diff=stat_d, **chk),
)
out["pass_"] = bool(out["pitch"]["pass_"] and out["vtln"]["pass_"] and checks_pass)
with open(os.path.join(PAR, A.out), "w") as f:
    json.dump(out, f, indent=1, default=lambda o: None if (isinstance(o, float) and not np.isfinite(o)) else str(o))
print(f"pitch: max |d median| {out['pitch']['max_dmed_st']:.4f} st (median {out['pitch']['median_dmed_st']:.4f}), "
      f"voicing agreement min {out['pitch']['min_voicing_agree'] * 100:.2f} % -> {'PASS' if out['pitch']['pass_'] else 'FAIL'}")
print(f"VTLN: max |d| {out['vtln']['max_d']:.4f} ln (median {out['vtln']['median_d']:.5f}), missing {out['vtln']['missing']} "
      f"-> {'PASS' if out['vtln']['pass_'] else 'FAIL'}")
for s in (A.a, A.b):
    c = chk[s]
    print(f"  {s:10s} norm slope {c['norm_slope']:.3f} sign {c['sign_acc']:.3f} monotonic {c['monotonic']:.3f} leak {c['leak']:.3f} "
          f"verdicts {c['verdicts']}")
print(f"VTLN checks: same verdicts {same_verdicts}, max stat diff {max(stat_d.values()):.4f} -> {'PASS' if checks_pass else 'FAIL'}")
print(f"Level 3 -> {'PASS' if out['pass_'] else 'FAIL'}")
