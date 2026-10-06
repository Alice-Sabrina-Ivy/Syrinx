# baselines.py — the harness's two validation detectors (voice-detector
# benchmark, 2026-10-06), written through the candidate interface (README):
#
#   always   p = 1 on every frame. Must score 0 % vetoed / 0 % removed and a
#            0 ms onset delay — checks the alignment / hangover plumbing.
#   energy   p = 1 when a 25 ms frame's energy is >= the stream's 20th
#            percentile + 6 dB, else 0 (threshold 0.5, no hangover). A
#            sanity baseline, NOT causal: the percentile is taken over the
#            whole stream. Frames are fixed 25 ms of stream time,
#            samples [round(i * 0.025 * sr), round((i + 1) * 0.025 * sr)),
#            each available when its last sample has arrived.
#
#   python scripts/voice-detector/baselines.py [--root=build/vad] [--sets=noise,fda,...] [--only=always|energy]
import os
import sys
import json

import numpy as np

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "lib"))
from streams import SETS, list_streams, load_audio  # noqa: E402

A = dict((a[2:].split("=", 1) + ["1"])[:2] for a in sys.argv[1:] if a.startswith("--"))
ROOT = A.get("root", "build/vad")
SEL = A.get("sets", ",".join(SETS)).split(",")
ONLY = A.get("only")

SPECS = {
    "always": {
        "name": "always", "hop_ms": 25, "first_avail_ms": 0, "frame_ms": 0, "lookahead_ms": 0,
        "threshold": 0.5, "hangover_ms": 0, "agg": "last", "p_before_first": 1.0,
        "v4": {"license": "n/a (harness check)", "model_bytes": 0, "runtime": "js", "wasm_ms_per_25ms": 0.0},
        "notes": "harness validation: says voice on every frame",
    },
    "energy": {
        "name": "energy", "hop_ms": 25, "first_avail_ms": 25, "frame_ms": 25, "lookahead_ms": 0,
        "threshold": 0.5, "hangover_ms": 0, "agg": "last", "p_before_first": 0.0,
        "v4": {"license": "n/a (harness baseline)", "model_bytes": 0, "runtime": "js", "wasm_ms_per_25ms": None},
        "notes": "sanity baseline: 25 ms frame energy >= stream P20 + 6 dB (non-causal percentile)",
    },
}


def energy_probs(x, sr):
    nfr = int(np.floor(len(x) / (0.025 * sr) + 1e-9))
    edges = np.round(np.arange(nfr + 1) * 0.025 * sr).astype(np.int64)
    edges = edges[edges <= len(x)]
    nfr = len(edges) - 1
    sq = np.concatenate([[0.0], np.cumsum(x.astype(np.float64) ** 2)])
    e = (sq[edges[1:]] - sq[edges[:-1]]) / np.maximum(edges[1:] - edges[:-1], 1)
    db = 10 * np.log10(e + 1e-12)
    thr = np.percentile(db, 20) + 6.0
    return (db >= thr).astype(np.float32)


def main():
    names = [ONLY] if ONLY else list(SPECS)
    for nm in names:
        d = os.path.join(ROOT, "cand", nm)
        os.makedirs(d, exist_ok=True)
        with open(os.path.join(d, "candidate.json"), "w", encoding="utf8") as f:
            json.dump(SPECS[nm], f, indent=1)
    cnt = 0
    for meta in list_streams(ROOT, SEL):
        x, sr = load_audio(meta)
        for nm in names:
            d = os.path.join(ROOT, "cand", nm, meta["set"])
            os.makedirs(d, exist_ok=True)
            if nm == "always":
                p = np.ones(int(len(x) / (0.025 * sr)) + 2, np.float32)
            else:
                p = energy_probs(x, sr)
            p.astype("<f4").tofile(os.path.join(d, meta["id"] + ".f32"))
        cnt += 1
    print(f"baselines {names}: {cnt} streams")


if __name__ == "__main__":
    main()
