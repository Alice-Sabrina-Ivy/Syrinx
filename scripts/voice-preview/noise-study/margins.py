"""margins.py — the Voice Shaper recording check (src/voice-preview/checks.js levelMargin / humFlag,
ported) for every mixture of a set: <data>/margins/<set>.json {mix id: {margin, hum}}.

  python -I margins.py <data> <set> <floor percentile>
"""
import json
import sys
from pathlib import Path

import numpy as np

DATA, SET, FLOOR = Path(sys.argv[1]), sys.argv[2], float(sys.argv[3])
out = {}
for p in sorted((DATA / "mix" / SET).glob("*.json")):
    if p.name == "margins.json":
        continue
    m = json.loads(p.read_text())
    x = np.fromfile(p.with_suffix(".f32"), dtype="<f4").astype(np.float64)
    n = round(m["rate"] * 0.02)
    k = len(x) // n
    e = np.sort(10 * np.log10(np.mean(x[: k * n].reshape(k, n) ** 2, axis=1) + 1e-20))

    def q(pp):
        h = (len(e) - 1) * pp
        lo, hi = int(np.floor(h)), int(np.ceil(h))
        return e[lo] + (e[hi] - e[lo]) * (h - lo)

    out[m["id"]] = {"margin": float(q(0.95) - q(FLOOR)), "hum": any(v for v in m["notched"] if v)}
(DATA / "margins").mkdir(exist_ok=True)
(DATA / "margins" / f"{SET}.json").write_text(json.dumps(out))
print(SET, len(out))
