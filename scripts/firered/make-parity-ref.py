# make-parity-ref.py — the Python reference for tests/dsp/firered-vad-parity-test.js
# (noise-detector try-out, 2026-10-20).
#
# Builds the parity fixture from committed public clips (CC0 air-conditioner
# noise + CC BY 4.0 LibriSpeech speech, see FIXTURE below), runs the screen's
# own FireRedVAD runner on it and writes, per 10 ms frame, the raw voice
# probability, the log-mel fbank (before CMVN: the model's cmvn.ark is not
# committed) of every 20th frame, and per 25 ms hop the
# R1 h gate decision computed with the screen's own definitions:
#   runner      scripts/voice-detector/offtheshelf/firered/firered.py  (fbank + CMVN + ONNX with cache, 100 frames per call)
#   smoothing   scripts/voice-detector/offtheshelf/common.py smooth(P, 5)
#   threshold   scripts/voice-detector/score.py hop_probs + voice_flags (agg last, p >= 0.55)
#   hangover    the same voice_flags (2000 ms)
# Those files are read from a checkout of the voice-detector branch (--vd);
# their git blob ids are recorded in the output.
#
# Frame availability: score.py takes a candidate's first_avail_ms. The screen
# declared 26 ms for every stream (+1 ms for its resampled streams); the app
# uses the same rule (src/dsp/firered-vad.js framesAvailableAt, since the
# 2026-10-20 review; before it, 25 + 10 i ms, when frame i's samples are in).
# The gate decisions are written for 26 (the comparison) and 25 (information:
# the parity test checks that the old timing fails the comparison).
#
#   python -I scripts/firered/make-parity-ref.py --vd=<voice-detector checkout>/scripts/voice-detector
#          [--model-dir=build/models/firered] [--out=tests/dsp/fixtures/firered-parity.json]
import base64
import hashlib
import importlib.util
import json
import os
import subprocess
import sys
import wave

import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.abspath(os.path.join(HERE, "..", ".."))
A = dict((a[2:].split("=", 1) + ["1"])[:2] for a in sys.argv[1:] if a.startswith("--"))
if "vd" not in A:
    raise SystemExit("usage: make-parity-ref.py --vd=<voice-detector checkout>/scripts/voice-detector [--model-dir=..] [--out=..]")
VD = os.path.abspath(A["vd"])
MODEL_DIR = os.path.abspath(os.path.join(REPO, A.get("model-dir", "build/models/firered")))
OUT = os.path.abspath(os.path.join(REPO, A.get("out", "tests/dsp/fixtures/firered-parity.json")))

# (file, start s, end s): noise lead, woman's speech, noise long enough for the
# 2 s hangover to run out, man's speech, noise tail.
NOISE = "tests/dsp/data/notch-real/ac114.wav"
FIXTURE = [
    [NOISE, 0.0, 2.0],
    ["tests/resonance-lab/fixtures/ls_woman_high.wav", 0.0, 5.0],
    [NOISE, 2.0, 6.0],
    ["tests/resonance-lab/fixtures/ls_man_low.wav", 0.0, 5.0],
    [NOISE, 6.0, 8.0],
]
SR, CHUNK, FEAT_EVERY = 16000, 400, 20
POINT = {"smooth": 5, "threshold": 0.55, "hangover_ms": 2000}


def read_int16(path):
    with wave.open(os.path.join(REPO, path), "rb") as w:
        if w.getframerate() != SR or w.getnchannels() != 1 or w.getsampwidth() != 2:
            raise SystemExit(f"{path}: expected 16 kHz mono 16-bit")
        return np.frombuffer(w.readframes(w.getnframes()), dtype="<i2")


def load(name, path):
    spec = importlib.util.spec_from_file_location(name, path)
    mod = importlib.util.module_from_spec(spec)
    sys.modules[name] = mod
    spec.loader.exec_module(mod)
    return mod


def blob(path):
    try:
        return subprocess.check_output(["git", "hash-object", path], text=True).strip()
    except Exception:  # noqa: BLE001
        return None


def main():
    pcm = np.concatenate([read_int16(f)[int(a * SR):int(b * SR)] for f, a, b in FIXTURE])
    x16 = pcm.astype(np.float32) / 32768.0
    # the screen's modules (score.py and common.py parse argv / paths at import)
    argv = sys.argv
    sys.argv = [argv[0]]
    sys.path.insert(0, os.path.join(VD, "lib"))
    sys.path.insert(0, os.path.join(VD, "offtheshelf"))
    S = load("vd_score", os.path.join(VD, "score.py"))
    C = load("common", os.path.join(VD, "offtheshelf", "common.py"))
    F = load("vd_firered", os.path.join(VD, "offtheshelf", "firered", "firered.py"))
    sys.argv = argv

    onnx = os.path.join(MODEL_DIR, "fireredvad_stream_vad_with_cache.onnx")
    cmvn_p = os.path.join(MODEL_DIR, "cmvn.ark")
    cmvn = F.read_kaldi_cmvn(cmvn_p)
    sess = F.session(onnx)
    logmel = F.fbank(x16)                              # (T, 80) float64, before CMVN
    feats = F.features(x16, cmvn)                      # (T, 80) float32
    P = F.probs(sess, feats)                           # the runner's path: 100 frames per call, caches carried
    T = len(P)
    Ps = C.smooth(P, POINT["smooth"])                  # float32
    n = len(x16) // CHUNK
    meta = {"set": "fixture", "id": "firered-parity", "n": n, "hop_s": CHUNK / SR}
    gates = {}
    for fa in (25, 26):
        spec = {"name": "firered", "hop_ms": 10, "first_avail_ms": fa, "frame_ms": 25, "lookahead_ms": 0, "agg": "last",
                "p_before_first": 0.0, "threshold": POINT["threshold"], "hangover_ms": POINT["hangover_ms"]}
        p = S.hop_probs(spec, meta, Ps.astype(np.float64))
        v = S.voice_flags(spec, meta, p)
        gates[str(fa)] = {"hop_p": [float(np.float32(q)) for q in p], "voice": "".join("1" if b else "0" for b in v)}
    idx = list(range(0, T, FEAT_EVERY))
    out = {
        "what": "FireRedVAD parity fixture (noise-detector try-out, 2026-10-20): the screen's Python runner on the fixture below",
        "generator": "scripts/firered/make-parity-ref.py",
        "fixture": [{"file": f, "start_s": a, "end_s": b} for f, a, b in FIXTURE],
        "fixture_note": "16 kHz int16 clips concatenated; samples = int16 / 32768; fed to the gate in 400-sample (25 ms) hops",
        "pcm_sha256": hashlib.sha256(pcm.astype("<i2").tobytes()).hexdigest(),
        "samples": int(len(pcm)),
        "model": {"onnx_sha256": hashlib.sha256(open(onnx, "rb").read()).hexdigest(),
                  "cmvn_sha256": hashlib.sha256(open(cmvn_p, "rb").read()).hexdigest()},
        "screen_code": {"branch": "voice-detector",
                        "firered.py": blob(os.path.join(VD, "offtheshelf", "firered", "firered.py")),
                        "score.py": blob(os.path.join(VD, "score.py")),
                        "common.py": blob(os.path.join(VD, "offtheshelf", "common.py"))},
        "runtime": {"python": sys.version.split()[0], "numpy": np.__version__, "onnxruntime": __import__("onnxruntime").__version__},
        "point": POINT,
        "frames": T,
        "probs": [float(q) for q in P],
        "feat_every": FEAT_EVERY,
        "feat_frames": idx,
        "logmel_f32_b64": base64.b64encode(np.ascontiguousarray(logmel[idx]).astype("<f4").tobytes()).decode(),
        "hops": n,
        "gate": gates,
    }
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    with open(OUT, "w", encoding="utf8", newline="\n") as f:
        json.dump(out, f, separators=(",", ":"))
        f.write("\n")
    v25 = gates["25"]["voice"]
    print(f"{OUT}: {T} frames, {n} hops, voice hops {v25.count('1')} / {n}; "
          f"first_avail 25 vs 26 differ on {sum(a != b for a, b in zip(v25, gates['26']['voice']))} hops")


if __name__ == "__main__":
    main()
