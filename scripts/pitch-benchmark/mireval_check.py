# mireval_check.py — cross-check score_corpora.py's RPA/RCA/VDE against
# mir_eval 0.8.2 (venv python), pooled frame-weighted over a corpus, at the
# offset score_corpora chose. mir_eval resamples the reference to its own
# 10 ms grid, so denominators differ slightly.
import os, sys, numpy as np, json, warnings, mir_eval
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import score_corpora as S
from paths import OUT
warnings.filterwarnings("ignore")
SC = json.load(open(os.path.join(OUT, "scores_corpora.json")))
for det, c in [("praat_ac", "ptdb"), ("crepe_tiny", "fda"), ("syrinx_new", "fda")]:
    refs = S.load_refs(c); est = S.load_est(det, c); off = SC[det][c]["offset_ms"] / 1000
    rpa = rca = vx = nv = nt = 0
    for k, (g, t, r) in refs.items():
        te, f, raw = est[k]; o = np.argsort(te)
        rv, rc, ev, ec = mir_eval.melody.to_cent_voicing(t, r, te[o] + off, f[o], kind="linear")
        n = (rv > 0).sum()
        if n == 0: continue
        rpa += mir_eval.melody.raw_pitch_accuracy(rv, rc, ev, ec) * n; rca += mir_eval.melody.raw_chroma_accuracy(rv, rc, ev, ec) * n
        nv += n; vx += np.sum((rv > 0) != (ev > 0)); nt += len(rv)
    a = SC[det][c]["groups"]["all|all"]
    print(f"{det} {c}: mir_eval RPA {100*rpa/nv:.2f} RCA {100*rca/nv:.2f} VDE {100*vx/nt:.2f} | score_corpora RPA {a['RPA']:.2f} RCA {a['RCA']:.2f} VDE {a['VDE']:.2f}")
