"""golden_check.py -- the "Likely heard as" aggregate and shares, computed
independently of src/ml/heard-as.js (plain Python, standard library only),
for tests/ml/fixtures/heard-as-golden.json (called by make_golden.mjs).

Definition (measurements/heard-as-calibration-2026-10-07.md):
  scored     = the gated windows: [end, logit, mode, classified]; a classified
               window needs a finite logit, a skipped one (classified 0, the
               classifier runs every 450 ms since 2026-10-07) has none
  meterLogit = arithmetic mean of the classified windows' logits
  lnF0       = ln(median of the voiced posted pitch values whose time lies in
               at least one scored window [end - 750 ms, end])
  eta        = a + bMeter * meterLogit + bLnF0 * lnF0;  s = sigmoid(eta) ("man")
  range      = sigmoid(eta -/+ halfWidth)
  unsure(s)  = min(max(f, k*4*s*(1-s)), 2*min(s, 1-s))
  man(s)     = s - unsure/2,  woman(s) = 1 - s - unsure/2
  man range  = [man(sLow), man(sHigh)], woman range = [woman(sHigh), woman(sLow)],
  unsure range = [min(unsure(sLow), unsure(sHigh)), unsure(clamp(0.5, sLow, sHigh))]

usage: python golden_check.py <golden.json>   (rewrites the file with the values)
"""
import json
import math
import statistics
import sys

path = sys.argv[1]
g = json.load(open(path, encoding="utf-8"))
C = g["constants"]
W = g["mlWindowMs"]


def sig(x):
    return 1.0 / (1.0 + math.exp(-x))


def unsure(s):
    return min(max(C["unsureFloor"], C["unsureK"] * 4 * s * (1 - s)), 2 * min(s, 1 - s))


for name, fx in g["fixtures"].items():
    wins = [(t, l if c else None) for t, l, mode, c in fx["windows"]
            if mode == "gated" and (not c or (l is not None and math.isfinite(l)))]
    logits = [l for _, l in wins if l is not None]
    meter = sum(logits) / len(logits)
    f0s = [f for t, f in fx["pitch"] if f > 0 and any(e - W <= t <= e for e, _ in wins)]
    lnf0 = math.log(statistics.median(f0s))
    eta = C["a"] + C["bMeter"] * meter + C["bLnF0"] * lnf0
    s, lo, hi = sig(eta), sig(eta - C["halfWidth"]), sig(eta + C["halfWidth"])
    man = lambda x: x - unsure(x) / 2
    woman = lambda x: 1 - x - unsure(x) / 2
    fx["python"] = {
        "nWindows": len(wins),
        "nClassified": len(logits),
        "nVoicedFrames": len(f0s),
        "meterLogit": meter,
        "lnF0": lnf0,
        "eta": eta,
        "s": s,
        "man": [man(lo), man(hi)],
        "unsure": [min(unsure(lo), unsure(hi)), unsure(min(max(0.5, lo), hi))],
        "woman": [woman(hi), woman(lo)],
    }
    print(f"{name}: {len(wins)} windows ({len(logits)} classified), {len(f0s)} voiced frames, meterLogit {meter:.4f}, F0 {math.exp(lnf0):.1f} Hz, s(man) {s:.3f}")
json.dump(g, open(path, "w", encoding="utf-8"))
