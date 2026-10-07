# tcommon.py — custom voice detector, training step (2026-10-06): shared
# paths, the model's frame grid, the pitch worker's streaming linear
# resampler (src/ml/audio-utils.js createStreamingResampler, ported), and the
# frame labels of the pre-registration (§1.1 "Labels").
import json
import os
import sys

import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.abspath(os.path.join(HERE, "../../.."))
sys.path.insert(0, os.path.join(HERE, "..", "custom"))
sys.path.insert(0, os.path.join(HERE, "..", "lib"))
from common import DATA, ROOT, SPLITS, fnv1a, load_manifest  # noqa: E402,F401

SR = 16000
TRAIN = os.path.join(ROOT, "train")      # packed audio, banks, checkpoints
VAL = os.path.join(ROOT, "val")          # validation streams + their production-chain dumps
BENCH = os.environ.get("VAD_BENCH_ROOT", os.path.join(REPO, "build", "vad"))  # the benchmark harness root

# ---- the model's frame grid (fixed for every model of this step) ----------
# Frame i covers the 16 kHz samples [(i + 1) * HOP - OFF - WIN, (i + 1) * HOP - OFF)
# of the resampled stream (zeros before the stream start). With the linear
# resampler, its last input sample (any rate >= 16 kHz) lies before
# (i + 1) * 12.5 ms - 0.21 ms of stream time, so frame i is declared available
# at FIRST_AVAIL_MS + i * HOP_MS (candidate.json), a 0.09 ms margin.
HOP = 200          # 12.5 ms
WIN = 512          # 32 ms analysis window
OFF = 4            # frames end 4 samples (0.25 ms) before the 12.5 ms grid
PAD = WIN - HOP + OFF   # 316 zeros in front of the stream
HOP_MS = 12.5
FIRST_AVAIL_MS = (HOP - OFF) / 16.0 + 0.125   # 12.375


def n_frames(n16):
    """Frames whose window lies inside n16 resampled samples."""
    return max(0, (n16 + OFF) // HOP)


def frame_centres(n):
    """Centre time (s, stream time) of frames 0..n-1."""
    return ((np.arange(n) + 1) * HOP - OFF - WIN / 2) / SR


def resample_stream(x, sr):
    """The pitch worker's streaming linear resampler (createStreamingResampler)
    over a whole stream: output j = x[i0] (1 - frac) + x[i0 + 1] frac at input
    position j * sr / 16000; an output whose right neighbour has not arrived
    is deferred (here: dropped at the stream end, as no later chunk comes)."""
    x = np.asarray(x, np.float32)
    if sr == SR:
        return x.copy()
    step = sr / SR
    m = int(np.ceil((len(x) - 1) / step)) if len(x) >= 2 else 0   # outputs with pos < N - 1
    pos = np.arange(m, dtype=np.float64) * step
    i0 = np.floor(pos).astype(np.int64)
    fr = (pos - i0).astype(np.float32)
    return (x[i0] * (1 - fr) + x[i0 + 1] * fr).astype(np.float32)


def read_wav(path):
    import soundfile as sf
    x, sr = sf.read(path, dtype="float32", always_2d=True)
    return x[:, 0], sr


def praat_track(rec):
    z = np.load(os.path.join(DATA, rec["f0_path"]))
    return float(z["t0"]), float(z["hop"]), z["f0"].astype(np.float32)


def frame_levels_db(x, t0, hop, n):
    """RMS level (dB) of a 30 ms window centred on each Praat frame."""
    half = int(0.015 * SR)
    c = np.round((t0 + np.arange(n) * hop) * SR).astype(np.int64)
    cs = np.concatenate([[0.0], np.cumsum(np.square(x, dtype=np.float64))])
    a = np.clip(c - half, 0, len(x))
    b = np.clip(c + half, 0, len(x))
    e = (cs[b] - cs[a]) / np.maximum(b - a, 1)
    return 10 * np.log10(e + 1e-12)


def voice_labels(x, t0, hop, f0, margin=2):
    """Per-Praat-frame label codes (pre-registration §1.1):
    1 positive = voiced (Praat AC) and within 30 dB of the recording's
      95th-percentile voiced level;
    0 = every other frame (masked in a clean recording, negative in a mix);
    2 = within `margin` frames of a positive / non-positive boundary (masked
      everywhere: "the recipe may also mask a margin around voicing boundaries")."""
    n = len(f0)
    v = f0 > 0
    lab = np.zeros(n, np.uint8)
    if not v.any():
        return lab
    lev = frame_levels_db(x, t0, hop, n)
    ref = np.percentile(lev[v], 95)
    pos = v & (lev >= ref - 30.0)
    lab[pos] = 1
    if margin:
        d = np.nonzero(np.diff(pos.astype(np.int8)))[0]   # boundary between d and d + 1
        for b in d:
            lab[max(0, b + 1 - margin):min(n, b + 1 + margin)] = 2
    return lab


def write_json(path, obj):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    tmp = path + ".tmp"
    with open(tmp, "w", encoding="utf8") as f:
        json.dump(obj, f)
    os.replace(tmp, path)


def args():
    return dict((a[2:].split("=", 1) + ["1"])[:2] for a in sys.argv[1:] if a.startswith("--"))
