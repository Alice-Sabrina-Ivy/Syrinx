# webrtc_point.py — emit one WebRTC VAD operating point as a candidate
# directory from the decision cache of webrtc/run_py.py (voice-detector
# benchmark, 2026-10-06), so score.py can check a point the WebRTC sweep
# reported without trusting the sweep's own vectorised scorer.
#
#   python scripts/voice-detector/judge/webrtc_point.py --mode=3 --fl=10 --w=10 --k=10 --hang=0
#          [--root=build/vad] [--out=build/vad/judge/cand/webrtc-m3-f10-w100k10-h0]
# p_i = share of speech decisions over frames i-w+1..i (divided by w);
# threshold (k - 0.5) / w = at least k of the last w frames; first_avail
# = frame + 1 ms (the 16 kHz resampler), as the sweep declared.
import json
import os
import sys

import numpy as np

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "lib"))
from streams import list_streams  # noqa: E402

A = dict((a[2:].split("=", 1) + ["1"])[:2] for a in sys.argv[1:] if a.startswith("--"))
ROOT = A.get("root", "build/vad")
mode, fl, w, k, hang = int(A["mode"]), int(A["fl"]), int(A["w"]), int(A["k"]), float(A["hang"])
name = f"webrtc-m{mode}-f{fl}-w{w * fl}k{k}-h{int(hang)}"
OUT = A.get("out", os.path.join(ROOT, "judge", "cand", name))
os.makedirs(OUT, exist_ok=True)
spec = {"name": name, "hop_ms": fl, "first_avail_ms": fl + 1.0, "frame_ms": fl * w, "lookahead_ms": 0,
        "threshold": (k - 0.5) / w, "hangover_ms": hang, "agg": "last", "p_before_first": 0.0,
        "v4": json.load(open(os.path.join(ROOT, "webrtc", "cand", "webrtc-m2-f30-w90k1-h1250", "candidate.json"), encoding="utf8"))["v4"],
        "notes": "judge re-emission from the run_py.py decision cache (post-hoc check of a reported sweep point)"}
with open(os.path.join(OUT, "candidate.json"), "w", encoding="utf8") as f:
    json.dump(spec, f, indent=1)
for m in list_streams(ROOT):
    d = np.load(os.path.join(ROOT, "webrtc", "cache", m["set"], m["id"] + ".npz"))[f"d{mode}_{fl}"].astype(np.float64)
    cs = np.concatenate([[0.0], np.cumsum(d)])
    i = np.arange(len(d))
    p = ((cs[i + 1] - cs[np.maximum(i + 1 - w, 0)]) / w).astype("<f4")
    os.makedirs(os.path.join(OUT, m["set"]), exist_ok=True)
    p.tofile(os.path.join(OUT, m["set"], m["id"] + ".f32"))
print(OUT)
