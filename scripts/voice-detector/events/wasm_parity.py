# wasm_parity.py — parity of the browser-runtime YAMNet detector
# (wasm_bench.mjs --dump-probs: JS log-mel + onnxruntime-web WASM) with the
# reference probabilities run_yamnet.py wrote (numpy log-mel + onnxruntime CPU
# EP) for the same streams and grid (voice-detector benchmark, 2026-10-06).
#
#   python scripts/voice-detector/events/wasm_parity.py PROBS.json --scores=build/vad/events/scores/pw8d16
import json
import os
import sys

import numpy as np

A = dict((a[2:].split("=", 1) + ["1"])[:2] for a in sys.argv[1:] if a.startswith("--"))
F = [a for a in sys.argv[1:] if not a.startswith("--")][0]
SC = A["scores"]
with open(F, encoding="utf8") as f:
    P = json.load(f)
worst = 0.0
worst_c = 0.0
n = 0
for key, probs in P.items():
    H, sid = key.split("|")
    H = int(H)
    z = np.load(os.path.join(SC, sid + ".npz"))
    m = H // int(z["hop_frames"])
    ref = z["voice"][::m]
    w = np.array(probs, np.float64)
    k = min(len(ref), len(w))
    d = np.abs(ref[:k] - w[:k])
    dc = np.abs(np.clip(ref[:k], 0, 1) - np.clip(w[:k], 0, 1))
    worst, worst_c = max(worst, float(d.max())), max(worst_c, float(dc.max()))
    n += k
    print(f"{key}: frames ref {len(ref)} wasm {len(w)}; max |dp| {d.max():.2e} (clipped {dc.max():.2e})")
print(f"ALL: {len(P)} stream x hop runs, {n} frames, max |p_wasm - p_ref| = {worst:.2e} (clipped to [0,1]: {worst_c:.2e})")
