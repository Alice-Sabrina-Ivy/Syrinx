# freeze_r3.py — custom voice detector, round 3 (pre-registration 2026-10-07
# §3.5; Addendum R3-B.4): write the frozen candidate file
# (scripts/voice-detector/train/frozen/candidate-r3.json) from the rule's pick
# on the DEPLOYABLE files (the ONNX re-check), with the sha256 of the
# checkpoint, its state dict and the ONNX file, the deployment rule, the
# operating point, the validation readings and the V4 facts.
#
#   python freeze_r3.py --sel=ONNX_SEL.json --name=NAME --ckpt=PATH --onnx=PATH --rule=plain|meanT|oldT
#          --wasm=WASM.json[,CHROME.json] --torch-sel=SEL.json [--out=frozen/candidate-r3.json]
import hashlib
import io
import json
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.abspath(os.path.join(HERE, "../../.."))
MY = dict((a[2:].split("=", 1) + ["1"])[:2] for a in sys.argv[1:] if a.startswith("--"))


def sha(p):
    h = hashlib.sha256()
    with open(p, "rb") as f:
        for b in iter(lambda: f.read(1 << 22), b""):
            h.update(b)
    return h.hexdigest()


def rel(p):
    return os.path.relpath(os.path.abspath(p), REPO).replace(os.sep, "/")


def main():
    import torch
    sel = json.load(open(MY["sel"], encoding="utf8"))
    assert len(sel) == 1, "one deployable re-check entry expected"
    ent = next(iter(sel.values()))
    best = ent["best"]
    if best is None:
        raise SystemExit("the deployable files have no feasible point: no freeze (§3.4)")
    ck = torch.load(MY["ckpt"], map_location="cpu", weights_only=False)
    buf = io.BytesIO()
    import model as M
    net = M.build(ck["cfg"])
    net.load_state_dict(ck["model"])
    torch.save(net.state_dict(), buf)
    rule = MY["rule"]
    wasm = [json.load(open(p, encoding="utf8")) for p in MY["wasm"].split(",")]
    tsel = json.load(open(MY["torch_sel"] if "torch_sel" in MY else MY["torch-sel"], encoding="utf8"))
    spec = {
        "name": MY["name"], "hop_ms": 12.5, "first_avail_ms": 12.375, "frame_ms": net.frame_ms, "lookahead_ms": 0,
        "threshold": best["thr"], "hangover_ms": best["hang"], "agg": best["agg"], "p_before_first": 0.0,
        "v4": {
            "license": "MIT", "runtime": "onnxruntime-web-wasm", "model_bytes": os.path.getsize(MY["onnx"]),
            "wasm_ms_per_25ms": max(w["ms_per_25ms"] for w in wasm),
            "wasm_measured_on": "; ".join(f"{w['mode']}: {w['ms_per_25ms']:.3f} ms per 25 ms (wall {w['ms_per_25ms_wall']:.3f}), {w['copies']} run(s) per 25 ms, {w['runtime']}, {w['cpu']}" for w in wasm),
        },
        "deployment_rule": {
            "rule": rule,
            "text": {"plain": "one model, GRU state carried from the stream start, never reset",
                     "mean": "two copies; copy a resets its GRU state at 2T, 4T, ..., copy b at T, 3T, ...; p = (p_a + p_b) / 2",
                     "old": "two copies; copy a resets its GRU state at 2T, 4T, ..., copy b at T, 3T, ...; p = the copy whose time since its reset is >= T"}[rule.rstrip("0123456789")],
            "T_s": float(rule.lstrip("meanold")) if rule != "plain" else None,
            "code": "scripts/voice-detector/train/stagger.py (combine), infer.py --onnx [--stagger=T --combine=mean|old]",
        },
        "model": {
            "onnx": rel(MY["onnx"]), "onnx_sha256": sha(MY["onnx"]), "checkpoint": rel(MY["ckpt"]), "checkpoint_sha256": sha(MY["ckpt"]),
            "state_sha256": hashlib.sha256(buf.getvalue()).hexdigest(), "params": net.n_params(), "run": ck.get("args", {}).get("name"),
            "step": ck.get("step"), "weights": f"EMA (decay {ck.get('ema')})" if ck.get("ema") else "raw", "cfg": net.cfg,
        },
        "selection_deployable": {"O": best["O"], "agg": best["agg"], "thr": best["thr"], "hang": best["hang"], "fresh": best["fresh"], "vsess": best["vsess"], "spl": best.get("spl")},
        "selection_torch": {k: (v["best"] and {kk: v["best"][kk] for kk in ("agg", "thr", "hang", "O")}) for k, v in tsel.items() if k == f"{MY['torch_net']}:{rule}"} if "torch_net" in MY else None,
        "go": bool(best["feasible"] and best["O"] >= 60.0 and max(w["ms_per_25ms"] for w in wasm) <= 2.0),
        "notes": "Round 3 custom voice-vs-machine detector (pre-registration 2026-10-07 §3, Addenda R3-A/R3-B). Frozen before any harness or "
                 "confirmatory stream was read by it; operating point = the pre-registered rule's pick on the validation data with the "
                 "deployable streaming ONNX files. Go / no-go: feasible and O >= 60 % (§3.5).",
    }
    out = MY.get("out", os.path.join(HERE, "frozen", "candidate-r3.json"))
    with open(out, "w", encoding="utf8", newline="\n") as f:
        json.dump(spec, f, indent=1)
    print(json.dumps({k: spec[k] for k in ("name", "threshold", "hangover_ms", "agg", "go")}))


if __name__ == "__main__":
    main()
