"""formant-vtl JS candidates: the shipping-path implementation (fvtl_js.mjs: the app's LPC
pipeline with all poles at 48 kHz emulation -> formant assignment -> log-scale estimate ->
learned shape correction -> 150 ms bin median) run through the harness's Node bridge.
Learned parts come from models/<name>.json (fit_models.py, train_dev only).

  bench.py score scripts/resonance-lab/candidates/formant-vtl/fv_js.py:<Class>
"""
import os
import json
from rlab.candidate import NodeBridgeCandidate

HERE = os.path.dirname(os.path.abspath(__file__))


def _make(model_name, version="1"):
    mp = os.path.join(HERE, "models", model_name + ".json")
    md = json.load(open(mp))
    nbytes = len(json.dumps(md["corr"])) if md.get("corr") else 0

    class C(NodeBridgeCandidate):
        name = model_name
        description = (f"formant-vtl JS: cfg {json.dumps(md['cfg'])}, correction "
                       f"{json.dumps(md['corr_spec'])} (train_dev only), 150 ms bin median")
        cadence_s = 0.15
        uses_f0 = True
        aggregate = "median"
        model_bytes = nbytes
        js_portability = ("pure JS, this exact file: the app's Burg LPC every 25 ms chunk (orders "
                          f"{md['cfg'].get('orders', [md['cfg'].get('order', 12)])} = snapshots of one Burg "
                          "recursion + one root-finding per order) + a 10-weight polynomial correction; no model fetch")
        node_script = os.path.join(HERE, "fvtl_js.mjs")
        node_args = (mp,)
        shards = int(os.environ.get("FVTL_SHARDS", "4"))   # <= 6 heavy processes (shared machine)
    C.version = version
    C.__name__ = model_name
    return C


FV_APP12_GM1234_RIDGE2 = _make("fv_app12_gm1234_ridge2")
FV_APP101214_GM1234_RIDGE2 = _make("fv_app101214_gm1234_ridge2")
FV_APP101214_GM1234_RIDGE2_BW800 = _make("fv_app101214_gm1234_ridge2_bw800")
CANDIDATE = FV_APP101214_GM1234_RIDGE2_BW800
