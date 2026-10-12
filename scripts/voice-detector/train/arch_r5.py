# arch_r5.py — custom voice detector, round 5 (pre-registration
# measurements/voice-detector-round5-preregistration-2026-10-12.md §3.6, §3.7,
# §4): the four round-5 architectures (cfg JSON for train_r5.py) and, with
# `export DIR`, one random-weight streaming ONNX file of each, for the WASM cost
# per architecture (wasm_bench.mjs, Node, 1 thread, one session) that feeds the
# between-candidate tie-break. The cost of a graph does not depend on its weights.
#
#   <venv>/python arch_r5.py cfg NAME          -> the cfg JSON of run NAME
#   <venv>/python arch_r5.py export DIR        -> DIR/<arch>.onnx (+ shapes JSON for chrome mode)
import json
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
F5C = json.load(open(os.path.join(HERE, "f5const_r5.json"), encoding="utf8"))["f5"]
BASE = {"convs": [[24, 3], [48, 3], [48, 1]], "gru": 96}
ARCH = {
    "F1": dict(BASE, f1={"taus": [1.0, 6.0], "eps": 0.001, "v0": 1.0, "fl0": 1.0}),
    "F1m": dict(BASE, f1m={}),
    "F1m+F5": dict(BASE, f1m={}, f5=F5C),
    "F1m+F5+Bound": dict(BASE, f1m={}, f5=F5C, bound={}),
}
RUNS = {"r11-data": "F1", "r11-floor": "F1m", "r11-harm": "F1m+F5", "r11-bound": "F1m+F5+Bound"}


def main():
    if sys.argv[1] == "cfg":
        print(json.dumps(ARCH[RUNS.get(sys.argv[2], sys.argv[2])]))
        return
    import torch
    import model as M
    from export import export_net
    d = sys.argv[2]
    os.makedirs(d, exist_ok=True)
    torch.manual_seed(0)
    for name, cfg in ARCH.items():
        net = M.build(cfg).eval()
        path = os.path.join(d, name.replace("+", "_") + ".onnx")
        export_net(net, {"args": {"name": "arch-" + name}, "step": 0}, path)
        st = M.Streaming(net).init_state()
        names = ["ctx", "s0", "s1", "s2", "h"] + M.Streaming(net).extra_names()
        json.dump({k: list(t.shape) for k, t in zip(names, st)}, open(path[:-5] + ".shapes.json", "w"))
        print(name, os.path.getsize(path), net.n_params(), flush=True)


if __name__ == "__main__":
    main()
