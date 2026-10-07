"""analyze_palette.py -- the "Likely heard as" constants on PRODUCTION-chain
inputs (measurements/heard-as-calibration-2026-10-07.md, section "Production
chain check"). Standard library only.

  python scripts/heard-as/analyze_palette.py <pov_stimuli.csv> <chain.jsonl> [<chain_burst.jsonl>]

pov_stimuli.csv: the calibration's Palette table (Munson & Dolquist 2025,
CC BY 4.0): listener shares ALL-Man / ALL-Woman / ALL-OtherGender / ALL-no and
the lab-chain inputs meter_logit / lnf0 the constants were fitted on.
chain.jsonl: run_chain.mjs on the same 240 stimuli (production chain).
Target: "half" = man + (other + no)/2, in percent; offset 0 (as the app shows).
"""
import csv
import json
import math
import statistics
import sys

A, B, C = 17.67240817107044, -0.349098302736368, -3.5373482236362848
W, K, F = 2.25, 0.42, 0.02
sig = lambda x: 1 / (1 + math.exp(-x))
eta = lambda m, l: A + B * m + C * l


def unsure(s):
    return min(max(F, K * 4 * s * (1 - s)), 2 * min(s, 1 - s))


rows = {r["key"]: r for r in csv.DictReader(open(sys.argv[1], encoding="utf-8"))}
prod = {d["key"]: d for d in (json.loads(l) for l in open(sys.argv[2], encoding="utf-8") if l.strip())}
burst = {d["key"]: d for d in (json.loads(l) for l in open(sys.argv[3], encoding="utf-8") if l.strip())} if len(sys.argv) > 3 else {}

q = lambda a, p: sorted(a)[min(len(a) - 1, int(round(p * (len(a) - 1))))]
dm, dl, de, err_lab, err_prod, err_prod_known = [], [], [], [], [], []
nwin_prod, voiced_prod, fails = [], [], 0
no_win = 0
for k, r in rows.items():
    p = prod.get(k)
    if p is None:
        continue
    if not p["nWindows"] or p["lnF0"] is None:
        no_win += 1
        continue
    y = float(r["ALL-Man"]) + 0.5 * (float(r["ALL-OtherGender"]) + float(r["ALL-no"]))
    m0, l0 = float(r["meter_logit"]), float(r["lnf0"])
    m1, l1 = p["meterLogit"], p["lnF0"]
    dm.append(m1 - m0)
    dl.append(l1 - l0)
    de.append(eta(m1, l1) - eta(m0, l0))
    err_lab.append(abs(100 * sig(eta(m0, l0)) - y))
    err_prod.append(abs(100 * sig(eta(m1, l1)) - y))
    nwin_prod.append(p["nWindows"])
    voiced_prod.append(p["voicedMs"] / 1000)
    if p["voicedMs"] < 3000 or p["nWindows"] < 10:
        fails += 1

n = len(dm)
print(f"Palette stimuli: {len(rows)}; production chain scored >= 1 window on {n} ({no_win} none)")
print(f"scored windows per stimulus (production): median {statistics.median(nwin_prod):.0f} (min {min(nwin_prod)}); "
      f"voiced s inside them: median {statistics.median(voiced_prod):.2f}")
print(f"meter_logit production - lab: mean {statistics.mean(dm):+.3f}, SD {statistics.stdev(dm):.3f}, |d| q90 {q([abs(x) for x in dm], .9):.3f}")
print(f"ln F0 production - lab:       mean {statistics.mean(dl):+.4f} ({100 * (math.exp(statistics.mean(dl)) - 1):+.1f} % in Hz), "
      f"SD {statistics.stdev(dl):.4f}, |d| q90 {q([abs(x) for x in dl], .9):.4f}")
print(f"eta production - lab:         mean {statistics.mean(de):+.3f} logit, |d| q90 {q([abs(x) for x in de], .9):.3f}, max {max(abs(x) for x in de):.3f}")
print(f"MAE vs Palette listeners, offset 0 (points of 'man' share, 'half' target): lab inputs {statistics.mean(err_lab):.2f}, "
      f"production inputs {statistics.mean(err_prod):.2f}")
print(f"stimuli that would fail the live minimums (3 s voiced, 10 windows): {fails} / {n}")

if burst:
    bm, bs, bmax = [], [], 0
    for k, p in prod.items():
        b = burst.get(k)
        if not b or not p["nWindows"] or not b["nWindows"] or p["lnF0"] is None or b["lnF0"] is None:
            continue
        bm.append(b["meterLogit"] - p["meterLogit"])
        s0, s1 = sig(eta(p["meterLogit"], p["lnF0"])), sig(eta(b["meterLogit"], b["lnF0"]))
        bs.append(100 * (s1 - s0))
    print(f"40 ms bursts + 0-5 ms jitter vs audio-clock hop ({len(bm)} stimuli): meter_logit d mean {statistics.mean(bm):+.3f}, "
          f"SD {statistics.stdev(bm):.3f}, |d| q90 {q([abs(x) for x in bm], .9):.3f}; share 'man' d mean {statistics.mean(bs):+.2f} points, "
          f"|d| q90 {q([abs(x) for x in bs], .9):.2f}, max {max(abs(x) for x in bs):.2f}")
