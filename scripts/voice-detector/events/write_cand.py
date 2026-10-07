# write_cand.py — write a YAMNet candidate directory for the voice-detector
# benchmark harness (README "Candidate interface") from run_yamnet.py scores
# (voice-detector benchmark, 2026-10-06, audio-event candidate).
#
#   python scripts/voice-detector/events/write_cand.py --scores=build/vad/events/scores/pw8d16
#          --name=yamnet-frame --hop-ms=140 --threshold=0.1 --hangover=240 [--lookahead=0]
#          [--frame-ms=975] [--model=build/vad/events/model/yamnet_core_pw8d16.onnx]
#          [--wasm-json=build/vad/events/wasm_node.json,build/vad/events/wasm_chrome.json] [--notes=...] [--root=build/vad]
#
# Probability = sum of the human-vocal class scores (yamnet_lib.VOCAL),
# clipped to [0, 1]. The grid is a subsample of the scores' grid (hop a
# multiple of it); frame 0 is available at 25 ms (the first STFT frame, with
# 95 rows of silence history before it). frame_ms: 975 for the full 96-row
# patch, (R - 1) * 10 + 25 for a --real=R run.
import json
import os
import sys

import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, "..", "lib"))
from streams import list_streams  # noqa: E402

A = dict((a[2:].split("=", 1) + ["1"])[:2] for a in sys.argv[1:] if a.startswith("--"))
ROOT = A.get("root", "build/vad")
SC = A["scores"]
NAME = A["name"]
OUT = os.path.join(ROOT, "cand", NAME)
MODEL = A.get("model", os.path.join(ROOT, "events", "model", "yamnet_core_pw8d16.onnx"))


def main():
    with open(os.path.join(SC, "run.json"), encoding="utf8") as f:
        run = json.load(f)
    base_ms = 10 * run["hop_frames"]
    hop_ms = int(A["hop-ms"])
    if hop_ms % base_ms:
        raise SystemExit(f"hop {hop_ms} ms is not a multiple of the scores' grid ({base_ms} ms)")
    m = hop_ms // base_ms
    real = run.get("real") or run["T"]
    frame_ms = float(A.get("frame-ms", (real - 1) * 10 + 25))
    v4 = {
        "license": "Apache-2.0",
        "license_file": os.path.join(ROOT, "events", "model", "LICENSE").replace("\\", "/"),
        "license_text_checked": True,
        "model_bytes": os.path.getsize(MODEL),
        "runtime": "onnxruntime-web-wasm",
        "wasm_ms_per_25ms": None,
        "wasm_measured_on": None,
    }
    if A.get("wasm-json"):
        # one or more wasm_bench.mjs results (comma-separated); the LARGEST cost is declared
        meas = []
        for fp in A["wasm-json"].split(","):
            with open(fp, encoding="utf8") as f:
                w = json.load(f)
            H = str(hop_ms // 10)
            if H not in w["hops"]:
                raise SystemExit(f"{fp} has no measurement at hop {hop_ms} ms")
            if os.path.basename(w["model"]) != os.path.basename(MODEL):
                raise SystemExit(f"WASM measurement is for {w['model']}, not {MODEL}")
            meas.append((w["hops"][H]["ms_per_25ms"], f"{w['mode']}: {w['hops'][H]['ms_per_25ms']:.3f} ms ({w['runtime']})", w))
        v4["wasm_ms_per_25ms"] = round(max(m[0] for m in meas), 3)
        w = meas[0][2]
        v4["wasm_measured_on"] = (f"{w['cpu']} (shared desktop, other jobs running); JS log-mel + one 96-row patch every {hop_ms} ms; "
                                  f"{w['hops'][H]['audio_s']:.0f} s of real benchmark audio; the larger of: " + "; ".join(m[1] for m in meas))
    spec = {
        "name": NAME, "hop_ms": hop_ms, "first_avail_ms": 25.0, "frame_ms": frame_ms,
        "lookahead_ms": float(A.get("lookahead", 0)), "threshold": float(A["threshold"]),
        "hangover_ms": float(A["hangover"]), "agg": A.get("agg", "last"), "p_before_first": 0.0,
        "v4": v4,
        "notes": A.get("notes", "") + f" | YAMNet (TF Model Garden yamnet.h5) ONNX core {os.path.basename(MODEL)}, "
                 f"p = clip(sum of {len(run['vocal'])} human-vocal class scores), patch {run['T']} rows ({real} with audio), "
                 f"scores from {SC}",
    }
    os.makedirs(OUT, exist_ok=True)
    with open(os.path.join(OUT, "candidate.json"), "w", encoding="utf8") as f:
        json.dump(spec, f, indent=1)
    n = 0
    for meta in list_streams(ROOT):
        z = np.load(os.path.join(SC, meta["set"], meta["id"] + ".npz"))
        p = np.clip(z["voice"][::m], 0, 1).astype("<f4")
        d = os.path.join(OUT, meta["set"])
        os.makedirs(d, exist_ok=True)
        p.tofile(os.path.join(d, meta["id"] + ".f32"))
        n += 1
    print(f"{NAME}: {n} streams, hop {hop_ms} ms, frame {frame_ms} ms, thr {spec['threshold']}, hang {spec['hangover_ms']} ms -> {OUT}")


if __name__ == "__main__":
    main()
