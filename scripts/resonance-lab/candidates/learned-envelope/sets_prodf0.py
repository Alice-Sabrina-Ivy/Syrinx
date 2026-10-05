"""Full-set R4 (Hillenbrand) and R6 (private sessions) for a candidate, scored through the harness runner
(used for the production-F0 variant, whose tracks exist for hill + sessions + the quick subsets).
  python sets_prodf0.py <candidate.py>
"""
import os, sys, json
import numpy as np
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", ".."))
from rlab import metrics as M  # noqa
from rlab.runner import score_set, manifest  # noqa
from rlab.candidate import load_candidate  # noqa
if __name__ == "__main__":
    spec = sys.argv[1]
    cand = load_candidate(spec)
    sc, _ = score_set(spec, cand, "hill", quick=False, workers=2, force=False)
    man = manifest("hill")
    win = M.windows(sc)
    hr1, hru = M.r1(win, man, cand.aggregate, horizons=())
    Gh = M.gap(hru, man)
    print(cand.name, "hill token AUC", round(hr1["auc_utt"], 3), "R4", json.dumps(M.r4(win, man, cand.aggregate, Gh)))
