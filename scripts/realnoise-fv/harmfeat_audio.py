# harmfeat_audio.py — audio of an attr.mjs dump's stream, 16 kHz mono float32
# (shared by harmfeat.py / floorfeat.py). Real-data corpora from
# <ROOT> (= $NOTCHVD_ROOT/data), ground-truth corpora from CORP (tests/dsp/data
# layout). Polyphase resampling to 16 kHz (the worker resamples linearly —
# an approximation these offline features accept).
import os, glob, json
from math import gcd
import numpy as np
import soundfile as sf
from scipy.signal import resample_poly

_IDX = {}


def _index(root, kind):
    if kind not in _IDX:
        _IDX[kind] = {r["id"]: r for r in json.load(open(os.path.join(root, f"index_{kind}.json")))}
    return _IDX[kind]


def audio(SET, m, root, corp):
    if SET == "noise":
        x, sr = sf.read(os.path.join(root, _index(root, "noise")[m["id"]]["path"]), dtype="float32")
    elif SET in ("vin", "gated"):
        x, sr = sf.read(os.path.join(root, _index(root, "mix")[m["id"]]["path"]), dtype="float32")
    elif SET == "ptdb":
        g = "MALE" if m["id"].split("_")[1].startswith("M") else "FEMALE"
        x, sr = sf.read(glob.glob(os.path.join(corp, "ptdb-tug", g, "MIC", "*", m["id"] + ".wav"))[0], dtype="float32")
    elif SET == "fda":
        x = np.fromfile(glob.glob(os.path.join(corp, "fda", "*", m["id"] + ".sig"))[0], dtype=">i2").astype(np.float32) / 32768
        sr = 20000
    elif SET == "hil":
        x, sr = sf.read(glob.glob(os.path.join(corp, "*", m["id"] + ".wav"))[0], dtype="float32")
    elif SET == "voc":
        x, sr = sf.read(glob.glob(os.path.join(corp, "vocadito", "**", m["id"] + ".wav"), recursive=True)[0], dtype="float32")
    else:
        raise ValueError(SET)
    if x.ndim > 1:
        x = x[:, 0]
    if sr != 16000:
        g = gcd(sr, 16000)
        x = resample_poly(x, 16000 // g, sr // g).astype(np.float32)
    return x, sr
