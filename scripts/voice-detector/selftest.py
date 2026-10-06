# selftest.py — contract checks of score.py's alignment, hangover and onset
# logic on synthetic input (no corpora needed). Exit 1 on any failure.
#   python scripts/voice-detector/selftest.py
import os
import sys

import numpy as np

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import score  # noqa: E402

fails = []


def check(name, got, want):
    if not np.array_equal(np.asarray(got), np.asarray(want)):
        fails.append(f"{name}: got {list(np.asarray(got))}, want {list(np.asarray(want))}")


def spec(**kw):
    s = {"name": "t", "hop_ms": 25, "first_avail_ms": 25, "frame_ms": 25, "lookahead_ms": 0, "threshold": 0.5,
         "hangover_ms": 0, "agg": "last", "p_before_first": -1.0}
    s.update(kw)
    return s


meta = {"n": 8, "hop_s": 0.025, "set": "x", "id": "y"}
P = np.arange(10, dtype=float)
# frame i available at 25 + 25 i ms; hop k at 25 (k + 1) ms -> frame k
check("last, no lookahead", score.hop_probs(spec(), meta, P), np.arange(8))
# 50 ms lookahead -> frame k + 2 (clipped to the last frame)
check("lookahead 50 ms", score.hop_probs(spec(lookahead_ms=50), meta, P), [2, 3, 4, 5, 6, 7, 8, 9])
# 32 ms grid: frame i at 32 (i + 1) ms
check("32 ms grid", score.hop_probs(spec(hop_ms=32, first_avail_ms=32), meta, P), [-1, 0, 1, 2, 2, 3, 4, 5])
# 10 ms grid, max / mean over the frames that arrived since the previous hop
P10 = np.array([0, 0, 1, 0, 0, 0, 0, 0.6, 0.2, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0], float)
s10 = spec(hop_ms=10, first_avail_ms=10)
check("10 ms grid last", score.hop_probs(s10, meta, P10)[:4], [0, 0, 0, 0])  # hop 0 -> frame 1, hop 1 -> 4, hop 2 -> 6, hop 3 -> 9
check("10 ms grid max", score.hop_probs({**s10, "agg": "max"}, meta, P10)[:4], [0, 1, 0, 0.6])  # frames 0-1, 2-4, 5-6, 7-9
check("10 ms grid mean", np.round(score.hop_probs({**s10, "agg": "mean"}, meta, P10)[:4], 6), [0, 0.333333, 0, 0.266667])
# hangover 50 ms: on at hop 3 only -> voice at hops 3, 4, 5
p = np.array([0, 0, 0, 1, 0, 0, 0, 0], float)
check("hangover 50 ms", score.voice_flags(spec(hangover_ms=50), meta, p), [0, 0, 0, 1, 1, 1, 0, 0])
check("hangover 0", score.voice_flags(spec(), meta, p), [0, 0, 0, 1, 0, 0, 0, 0])
# onsets: a run after >= 8 unpainted hops with >= 2 of its first 4 hops CORRECT
paint = np.array([0] * 10 + [100] * 6 + [0] * 3 + [100] * 4 + [0] * 9 + [100] * 3, float)
lab = np.where(paint > 0, 1, 0)
lab[32:35] = 2  # the last run is false painting: not a voice onset
check("onsets", [s for s, _ in score.onsets(paint, lab)], [10])
check("onset run end", [e for _, e in score.onsets(paint, lab)], [22])
# a file too short for the stream is refused
try:
    score.hop_probs(spec(), meta, P[:5])
    fails.append("short file accepted")
except SystemExit:
    pass

if fails:
    print("FAIL\n" + "\n".join(fails))
    sys.exit(1)
print("selftest: all checks pass")
