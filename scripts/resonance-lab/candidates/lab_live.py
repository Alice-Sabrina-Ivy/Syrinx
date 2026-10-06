"""The four finalists as the IN-APP resonance lab runs them (src/resonance-lab/), scored by the
benchmark: node/lab_live.mjs feeds each item to lab-engine.js as 48 kHz / 25 ms capture chunks,
so voicing and F0 come from the engine's production pitch-worker replica (not the harness
track), the analysis stream from its anti-aliased resampler, and pnml from the deployed q8-v2
model patched in memory. Same readout pooling as each finalist's prototype.

  bench.py score scripts/resonance-lab/candidates/lab_live.py:<Class> --quick
"""
import os
from rlab.candidate import NodeBridgeCandidate

HERE = os.path.dirname(os.path.abspath(__file__))
SCRIPT = os.path.join(os.path.dirname(HERE), "node", "lab_live.mjs")


def _mk(fin, proto, agg):
    class C(NodeBridgeCandidate):
        name = f"lab_live_{fin}"
        version = "1"
        description = f"{proto} through the in-app lab engine (48 k chunks, production pitch replica, lab resampler)"
        cadence_s = 0.15
        uses_f0 = True          # harness voicing still stamps horizons; the engine ignores the track
        aggregate = agg
        model_bytes = 0
        js_portability = "this is the shipped lab code (src/resonance-lab/lab-engine.js)"
        node_script = SCRIPT
        node_args = (fin,)
        shards = int(os.environ.get("LAB_LIVE_SHARDS", "4"))   # <= 6 heavy processes (shared machine)
    C.__name__ = f"LabLive_{fin}"
    return C


LabLiveVtln = _mk("vtln", "vtln_warp v3", "median")
LabLivePnml = _mk("pnml", "pnml_head_scalesex_none0", "median")
LabLiveLe = _mk("le", "le_ens_h64", "mean")
LabLiveFv = _mk("fv", "fv_app101214_gm1234_ridge2_bw800", "median")
CANDIDATE = LabLiveVtln
