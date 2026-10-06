# streams.py — read the benchmark's streams and dumps (voice-detector
# benchmark, 2026-10-06). A candidate detector uses list_streams() +
# load_audio() to get, for every stream, EXACTLY the samples the app's
# production chain received (read in place from the corpora; nothing is
# copied), then writes its probability file (README "Candidate interface").
#
#   import sys; sys.path.insert(0, "scripts/voice-detector/lib")
#   from streams import list_streams, load_audio, load_audio_16k
#   for meta in list_streams("build/vad", ["noise", "fda"]):
#       x, sr = load_audio(meta)          # float32 mono at the stream's own rate
#       x16 = load_audio_16k(meta)        # the same, resampled to 16 kHz
#
# meta = the dump's JSON: set, id, n (hops), hop_s (= C / sr, 25 ms), sr,
# gender, audio {path, fmt, sr, start, len}, set-specific fields.
import glob
import json
import os
import struct
from math import gcd

import numpy as np

SETS = ["noise", "noiseho", "vin20", "vin0", "fda", "ptdb", "voc", "hil", "vocalset", "pvqd", "voiced"]


def list_streams(root, sets=None):
    out = []
    for s in sets or SETS:
        for p in sorted(glob.glob(os.path.join(root, "dumps", s, "*.json"))):
            with open(p, encoding="utf8") as f:
                out.append(json.load(f))
    return out


def load_dump(root, meta):
    """Per-hop columns of a stream's dump: dict col -> float32 array (n)."""
    p = os.path.join(root, "dumps", meta["set"], meta["id"] + ".f32")
    a = np.fromfile(p, dtype="<f4").reshape(len(meta["cols"]), meta["n"])
    return {c: a[i] for i, c in enumerate(meta["cols"])}


def _read_wav(path):
    with open(path, "rb") as f:
        b = f.read()
    off, fmt, ch, sr, bps, ds, dz = 12, 0, 1, 0, 0, 0, 0
    while off < len(b) - 8:
        cid = b[off:off + 4]
        sz = struct.unpack_from("<I", b, off + 4)[0]
        if cid == b"fmt ":
            fmt, ch, sr = struct.unpack_from("<HHI", b, off + 8)
            bps = struct.unpack_from("<H", b, off + 22)[0]
            if fmt == 0xFFFE:
                fmt = struct.unpack_from("<H", b, off + 32)[0]
        elif cid == b"data":
            ds, dz = off + 8, min(sz, len(b) - off - 8)
            break
        off += 8 + sz + (sz & 1)
    bpS = bps // 8
    n = dz // (bpS * ch)
    raw = b[ds:ds + n * bpS * ch]
    if fmt == 3:
        x = np.frombuffer(raw, dtype="<f8" if bps == 64 else "<f4")
    elif bps == 16:
        x = np.frombuffer(raw, dtype="<i2").astype(np.float32) / 32768
    elif bps == 24:
        u = np.frombuffer(raw, dtype=np.uint8).reshape(-1, 3).astype(np.int32)
        v = u[:, 0] | (u[:, 1] << 8) | (u[:, 2] << 16)
        x = (np.where(v >= 1 << 23, v - (1 << 24), v)).astype(np.float32) / 8388608
    else:
        x = np.frombuffer(raw, dtype="<i4").astype(np.float32) / 2147483648
    return x.reshape(-1, ch)[:, 0].astype(np.float32), sr


def load_audio(meta):
    """(samples float32, sr): the stream exactly as the app chain got it."""
    a = meta["audio"]
    if a["fmt"] == "sig16be":
        x = np.fromfile(a["path"], dtype=">i2").astype(np.float32) / 32768
        sr = a["sr"]
    else:
        x, sr = _read_wav(a["path"])
    if sr != a["sr"]:
        raise ValueError(f"{a['path']}: {sr} Hz, manifest says {a['sr']}")
    x = x[a["start"]:a["start"] + a["len"]]
    if len(x) != a["len"]:
        raise ValueError(f"{a['path']}: stream shorter than its manifest length")
    return x, sr


def load_audio_16k(meta):
    """The stream resampled to 16 kHz (polyphase, scipy) — a convenience; a
    candidate may resample however its browser implementation would."""
    x, sr = load_audio(meta)
    if sr == 16000:
        return x
    from scipy.signal import resample_poly
    g = gcd(16000, sr)
    return resample_poly(x, 16000 // g, sr // g).astype(np.float32)
