"""Diagnostic (no tuning): sensitivity of the final vtln_warp readout to F0-track errors, on 200 r1_test items.
Perturbations of the harness F0 track: production range clamp (drop frames outside 75-400 Hz), 10 % random
frames octave-up, 10 % octave-down, whole track x2, whole track x0.5. Reports median |delta| of utterance
readouts in units of the test-clean gap G (0.1114, final b800 model)."""
import sys, os, numpy as np, pandas as pd, warnings, copy
warnings.filterwarnings("ignore")
LAB = os.path.abspath("../../../scripts/resonance-lab"); sys.path.insert(0, LAB); os.chdir(LAB)
from threadpoolctl import threadpool_limits; threadpool_limits(1)
from rlab.candidate import load_candidate
from rlab import audio
from rlab.f0 import F0Track
c = load_candidate("candidates/vtln_warp.py"); c.setup()
G = 0.1114
m = pd.read_parquet("../../build/resonance-lab/bench/manifests/r1_test.parquet").groupby("speaker").head(5)
rng = np.random.default_rng(0)
def pert(f, kind):
    g = copy.deepcopy(f); v = g.f0 > 0
    if kind == "clamp": g.f0[(g.f0 < 75) | (g.f0 > 400)] = 0
    elif kind == "oct_up10": i = v & (rng.random(len(v)) < .1); g.f0[i] *= 2
    elif kind == "oct_dn10": i = v & (rng.random(len(v)) < .1); g.f0[i] *= .5
    elif kind == "x2": g.f0[v] *= 2
    elif kind == "x0.5": g.f0[v] *= .5
    return g
kinds = ["clamp", "oct_up10", "oct_dn10", "x2", "x0.5"]
rows = []
for r in m.itertuples():
    x = audio.load(r.path, r.sr_src); f = F0Track.load(r.f0_path)
    base = np.nanmedian(c.score(x, 16000, f)[1])
    row = dict(sex=r.sex)
    for k in kinds:
        row[k] = (np.nanmedian(c.score(x, 16000, pert(f, k))[1]) - base) / G
    rows.append(row)
d = pd.DataFrame(rows)
print("median signed delta (gaps):"); print(d.groupby("sex")[kinds].median().round(3).to_string())
print("median |delta| (gaps):"); print(d[kinds].abs().median().round(3).to_string())
