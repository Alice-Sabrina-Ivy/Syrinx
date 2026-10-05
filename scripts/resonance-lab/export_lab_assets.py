"""Export the four resonance-lab finalists' parameters + population reference bands to
public/resonance-lab/ (lab-only static assets; fetched only with ?resonance=lab).

  le_ens_h64.json   3-seed MLP ensemble (learned-envelope/models/mlp_band500_h64{,_s1,_s2}.json)
  vtln_warp.json    model-warp GMM (vtln-warp/models/mw_ct_k32_sat2_s4_b800.npz), float32 values
  fv_model.json     formant-vtl config + 10-weight ridge correction (formant-vtl/models/...bw800.json)
  pnml_head.json    192 -> 1 head (build/resonance-lab/pitch-neutral-ml/head_raw_scalesex.json), folded
                    standardisation: score = w . relu_33 + b
  reference.json    per finalist: LibriSpeech test-clean 5 s-voiced readouts (benchmark score cache,
                    harness F0), per-speaker medians -> men / women quantiles; the lab's display axis

  build/resonance-lab/venv/Scripts/python scripts/resonance-lab/export_lab_assets.py
"""
import os
import sys
import json
import numpy as np

LAB = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, LAB)
from rlab import metrics as M  # noqa: E402
from rlab.paths import REPO, SCORES, BUILD  # noqa: E402
from rlab.runner import manifest  # noqa: E402
import pandas as pd  # noqa: E402

OUT = os.path.join(REPO, "public", "resonance-lab")
C = os.path.join(LAB, "candidates")


def f32(a):
    return [float("%.9g" % v) for v in np.asarray(a, np.float32).ravel()]


def main():
    os.makedirs(OUT, exist_ok=True)
    # learned-envelope ensemble
    mem = []
    feat = None
    for nm in ("mlp_band500_h64", "mlp_band500_h64_s1", "mlp_band500_h64_s2"):
        m = json.load(open(os.path.join(C, "learned-envelope", "models", nm + ".json")))
        feat = feat or m["feat"]
        assert m["feat"] == feat
        mem.append({k: m[k] for k in ("mu", "sd", "kind", "mlp")})
    json.dump({"name": "le_ens_h64", "feat": feat, "members": mem}, open(os.path.join(OUT, "le_ens_h64.json"), "w"))
    # vtln
    z = np.load(os.path.join(C, "vtln-warp", "models", "mw_ct_k32_sat2_s4_b800.npz"))
    cfg = json.loads(str(z["cfg"]))
    json.dump({"name": "vtln_warp", "cfg": cfg, "w": f32(z["w"]),
               "mu": [f32(r) for r in z["mu"]], "var": [f32(r) for r in z["var"]]},
              open(os.path.join(OUT, "vtln_warp.json"), "w"))
    # fv
    fv = json.load(open(os.path.join(C, "formant-vtl", "models", "fv_app101214_gm1234_ridge2_bw800.json")))
    json.dump(fv, open(os.path.join(OUT, "fv_model.json"), "w"))
    # pnml head
    h = json.load(open(os.path.join(BUILD, "pitch-neutral-ml", "head_raw_scalesex.json")))
    w = np.array(h["w"]) / np.array(h["sd"])
    b = h["b"] - float(np.dot(np.array(h["mu"]), w))
    json.dump({"name": "pnml_head_scalesex_none0", "target": "ln(formant scale) + 0.07 * (+1 women / -1 men)",
               "lam": h["lam"], "w": [float(v) for v in w], "b": b,
               "model": "Alice-Sabrina-Ivy/voice-gender-classifier-onnx-q8-v2 (relu_33 embedding)"},
              open(os.path.join(OUT, "pnml_head.json"), "w"))
    # reference bands
    cands = {"vtln": ("vtln_warp", "median"), "pnml": ("pnml_head_scalesex_none0", "median"),
             "le": ("le_ens_h64", "mean"), "fv": ("fv_app101214_gm1234_ridge2_bw800", "median")}
    man = manifest("r1_test")
    ref = {"source": "LibriSpeech test-clean, 20 adult men + 20 adult women (held out from all training); "
                     "5 s-voiced readouts from the benchmark score cache (harness F0); per-speaker medians",
           "horizon_s": 5.0}
    for key, (name, agg) in cands.items():
        sc = pd.read_parquet(os.path.join(SCORES, name, "r1_test.parquet"))
        win = M.windows(sc)
        hz = M.horizon(win, man, 5.0, agg)
        sp = hz.groupby(["speaker", "sex"]).r.median().reset_index()
        q = lambda s: {f"q{p}": float(np.percentile(s, p)) for p in (10, 25, 50, 75, 90)}  # noqa: E731
        men, women = sp[sp.sex == "m"].r.values, sp[sp.sex == "f"].r.values
        ref[key] = {"candidate": name, "aggregate": agg,
                    "menMedian": float(np.median(men)), "womenMedian": float(np.median(women)),
                    "men": q(men), "women": q(women),
                    "readouts": {"men": int((hz.sex == "m").sum()), "women": int((hz.sex == "f").sum())},
                    "speakers": {"men": int(len(men)), "women": int(len(women))}}
        print(key, json.dumps({k: ref[key][k] for k in ("menMedian", "womenMedian")}))
    json.dump(ref, open(os.path.join(OUT, "reference.json"), "w"), indent=1)
    for f in sorted(os.listdir(OUT)):
        print(f, os.path.getsize(os.path.join(OUT, f)))


if __name__ == "__main__":
    main()
