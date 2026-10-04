"""Audio I/O. Every item is handed to candidates as float32 mono at 16 kHz."""
import os
import numpy as np
import soundfile as sf
from scipy.signal import resample_poly
from math import gcd
from .paths import SR


def read_any(path, sr_hint=None):
    """Read wav/flac (soundfile) or FDA .sig (16-bit big-endian raw, 20 kHz)."""
    if path.endswith(".sig"):
        x = np.fromfile(path, dtype=">i2").astype(np.float32) / 32768.0
        return x, sr_hint or 20000
    x, sr = sf.read(path, dtype="float32", always_2d=False)
    if x.ndim > 1:
        x = x.mean(axis=1)
    return x.astype(np.float32), sr


def to16k(x, sr):
    if sr == SR:
        return np.asarray(x, np.float32)
    g = gcd(int(sr), SR)
    return resample_poly(np.asarray(x, np.float64), SR // g, int(sr) // g).astype(np.float32)


def load(path, sr_hint=None):
    """Load an item's audio as float32 @ 16 kHz."""
    x, sr = read_any(path, sr_hint)
    return to16k(x, sr)


def write16(path, x, subtype="PCM_16"):
    """Write a 16 kHz item. Peak-limits to 0.99 (returns the applied gain)."""
    os.makedirs(os.path.dirname(path), exist_ok=True)
    x = np.asarray(x, np.float64)
    pk = float(np.max(np.abs(x))) if len(x) else 0.0
    g = 1.0 if pk <= 0.99 else 0.99 / pk
    sf.write(path, (x * g).astype(np.float32), SR, subtype=subtype)
    return g


def rms(x):
    x = np.asarray(x, np.float64)
    return float(np.sqrt(np.mean(x * x) + 1e-20))
