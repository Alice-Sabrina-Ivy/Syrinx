"""analyze.py — Voice Shaper noise study, summaries (measurements/voice-shaper-noise-2026-10-25.md).

  python -I analyze.py <scored.jsonl> [--cell=p0_p0|all] [--base="none|posted"] [--by=snr|noise|source]
                       [--snr=0,5,clean,...] [--auto="candA;candB" --rules=n28,n28h]

Paired against the base candidate on the same (mixture, cell): mean PESQ-WB, ESTOI, DNSMOS, LSD,
pause residual and track errors per candidate, for women / men / all, on clean recordings and on
noisy ones (0-20 dB) and quiet rooms (30 / 40 dB), plus the plan's guards: G1 (clean PESQ change >= -0.10 for each sex), G2
(noisy DNSMOS OVRL not below the base), and the decision score = the worse sex's noisy PESQ gain.
"""
import json
import sys
from collections import defaultdict

import numpy as np

path = sys.argv[1]
opt = dict(a[2:].split("=", 1) for a in sys.argv[2:] if a.startswith("--") and "=" in a)
CELL = opt.get("cell", "p0_p0")
BASE = opt.get("base", "none|posted")
BY = opt.get("by")
rows = [json.loads(l) for l in open(path) if l.strip()]
if CELL != "all":
    rows = [r for r in rows if r["cell"] == CELL]
if "snr" in opt:
    keep = set(opt["snr"].split(","))
    rows = [r for r in rows if ("clean" if r["snr"] is None else str(r["snr"])) in keep]
# Automatic mode: --auto="candA;candB" --rules="n28,n28h" builds, per inner candidate and trigger
# rule, rows that take the inner candidate where the recording check fires and the base elsewhere.
# Rules: nT = level margin below T dB (checks.js: 28); nTh = that or a hum line (notched).
if "auto" in opt:
    import os
    resdir = os.path.dirname(os.path.abspath(path))
    margins = json.load(open(os.path.join(resdir, "..", "..", "margins", os.path.basename(resdir) + ".json")))
    idx = {(r["mix"], r["cell"], r["cand"]): r for r in rows}
    extra = []
    for inner in opt["auto"].split(";"):
        for rule in opt.get("rules", "n28").split(","):
            hum = rule.endswith("h")
            T = float(rule[1:].rstrip("h"))
            for r in rows:
                if r["cand"] != BASE:
                    continue
                mg = margins[r["mix"]]
                fire = mg["margin"] < T or (hum and mg["hum"])
                src = idx.get((r["mix"], r["cell"], inner)) if fire else r
                if src is None:
                    continue
                v = dict(src)
                v["cand"] = f"auto[{rule}]~{inner}"
                v["fired"] = fire
                extra.append(v)
    rows += extra
base = {(r["mix"], r["cell"]): r for r in rows if r["cand"] == BASE}
cands = sorted({r["cand"] for r in rows}, key=lambda c: (c != BASE, c))
M = ["pesq", "estoi", "ovrl", "sig", "bak", "lsd", "pauseDb", "fa", "miss", "gross"]


def agg(sel):
    out = {}
    for m in M:
        v = [r[m] for r in sel if r.get(m) is not None]
        d = [r[m] - base[(r["mix"], r["cell"])][m] for r in sel
             if r.get(m) is not None and base.get((r["mix"], r["cell"]), {}).get(m) is not None]
        out[m] = (np.mean(v) if v else np.nan, np.mean(d) if d else np.nan, len(d))
    return out


groups = defaultdict(list)
for r in rows:
    band = "clean" if r["snr"] is None else "quiet" if r["snr"] >= 30 else "noisy"
    for sx in (r["sex"], "all"):
        groups[(r["cand"], band, sx)].append(r)
        if BY and r["snr"] is not None:
            groups[(r["cand"], f"{BY}={r[BY]}", sx)].append(r)

print(f"{path}  cell={CELL}  base={BASE}  rows={len(rows)}")
hdr = f"{'candidate':42s} {'band':7s} {'sex':3s} {'n':>4s} | {'PESQ':>5s} {'dPESQ':>6s} | {'ESTOI':>5s} {'dEST':>6s} | {'OVRL':>4s} {'dOVR':>5s} {'dSIG':>5s} {'dBAK':>5s} | {'dLSD':>5s} {'pause':>6s} | {'FA':>4s} {'miss':>4s} {'gross':>5s}"
print(hdr)
summary = []
for c in cands:
    for band in ("clean", "quiet", "noisy"):
        for sx in ("f", "m", "all"):
            sel = groups.get((c, band, sx))
            if not sel:
                continue
            a = agg(sel)
            print(f"{c[:42]:42s} {band:7s} {sx:3s} {a['pesq'][2]:4d} | {a['pesq'][0]:5.2f} {a['pesq'][1]:+6.3f} | {a['estoi'][0]:5.3f} {a['estoi'][1]:+6.3f} | "
                  f"{a['ovrl'][0]:4.2f} {a['ovrl'][1]:+5.2f} {a['sig'][1]:+5.2f} {a['bak'][1]:+5.2f} | {a['lsd'][1]:+5.2f} {a['pauseDb'][0]:6.1f} | "
                  f"{a['fa'][0]:4.2f} {a['miss'][0]:4.2f} {a['gross'][0]:5.2f}")
    g = {(band, sx): agg(groups[(c, band, sx)]) for band in ("clean", "quiet", "noisy") for sx in ("f", "m") if groups.get((c, band, sx))}
    if ("clean", "f") in g and ("noisy", "f") in g:
        w = lambda band: min(g[(band, "f")]["pesq"][1], g[(band, "m")]["pesq"][1]) if (band, "m") in g else float("nan")
        g2 = agg(groups[(c, "noisy", "all")])["ovrl"][1]
        summary.append((w("noisy"), c, w("clean"), w("quiet") if ("quiet", "f") in g else float("nan"), g2))
    print()
if BY:
    keys = sorted({k[1] for k in groups if k[1].startswith(BY + "=")})
    print(f"\ndPESQ vs base by {BY} (all sexes)")
    print(f"{'candidate':42s} " + " ".join(f"{k.split('=')[1][:14]:>14s}" for k in keys))
    for c in cands:
        print(f"{c[:42]:42s} " + " ".join(f"{agg(groups[(c, k, 'all')])['pesq'][1]:+14.3f}" if groups.get((c, k, 'all')) else f"{'':>14s}" for k in keys))
print("\nranking (decision score = worse sex's noisy (0-20 dB) dPESQ; G1 = worse sex's clean dPESQ >= -0.10; quiet = worse sex's 30/40 dB dPESQ; G2 = noisy dOVRL >= 0)")
for score, c, g1, gq, g2 in sorted(summary, reverse=True):
    print(f"  {score:+.3f}  {c:56s} G1 {g1:+.3f} {'ok ' if g1 >= -0.10 else 'FAIL'}  quiet {gq:+.3f}  G2 {g2:+.2f} {'ok' if g2 >= 0 else 'FAIL'}")
