# spot.py — judge's independent spot check of a candidate's probability files
# (voice-detector benchmark, 2026-10-06). Re-runs the detector from scratch
# (own streaming loop, own p derivation) on a seeded sample of streams per
# set and compares with the candidate's .f32 files; then checks causality by
# cutting the audio at a random sample: every frame the candidate declared
# available before the cut must be unchanged.
#
#   python scripts/voice-detector/judge/spot.py --det=silero|webrtc
#          [--per=2] [--seed=20261006] [--root=build/vad] [--out=build/vad/judge]
#
# silero: the official model of the Silero runner (build/vad/silero/dl/...),
#   onnxruntime CPU, 512-sample chunks + the previous chunk's last 64 samples,
#   state carried from stream time 0; compared with build/vad/cand/silero.
# webrtc: py-webrtcvad (webrtcvad-wheels in a scratch venv), mode 2, 30 ms
#   frames, p = share of speech over the last 3 frames; compared with
#   build/vad/webrtc/cand/webrtc-m2-f30-w90k1-h1250. Also writes the int16
#   input to <out>/i16/<set>/<id>.i16 for spot-wasm.mjs (the browser port).
# Non-16 kHz streams: scipy resample_poly, as lib/streams.py load_audio_16k.
import json
import os
import sys
from math import gcd

import numpy as np

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "lib"))
from streams import SETS, list_streams, load_audio  # noqa: E402

A = dict((a[2:].split("=", 1) + ["1"])[:2] for a in sys.argv[1:] if a.startswith("--"))
DET = A["det"]
PER = int(A.get("per", "2"))
ROOT = A.get("root", "build/vad")
OUT = A.get("out", os.path.join(ROOT, "judge"))
rng = np.random.default_rng(int(A.get("seed", "20261006")))


def to16k(x, sr):
    if sr == 16000:
        return x.astype(np.float32)
    from scipy.signal import resample_poly
    g = gcd(16000, sr)
    return resample_poly(x, 16000 // g, sr // g).astype(np.float32)


if DET == "silero":
    import onnxruntime as ort
    CDIR = os.path.join(ROOT, "cand", "silero")
    MODEL = os.path.join(ROOT, "silero", "dl", "silero-vad-6.2.3", "src", "silero_vad", "data", "silero_vad.onnx")
    so = ort.SessionOptions()
    so.intra_op_num_threads = 1
    so.inter_op_num_threads = 1
    SESS = ort.InferenceSession(MODEL, sess_options=so, providers=["CPUExecutionProvider"])
    HOP, FA = 32.0, 33.0

    def probs(x16, save=None):
        st = np.zeros((2, 1, 128), np.float32)
        ctx = np.zeros(64, np.float32)
        out = []
        for i in range(len(x16) // 512):
            ch = x16[i * 512:(i + 1) * 512]
            inp = np.concatenate([ctx, ch])[None, :].astype(np.float32)
            o, st = SESS.run(None, {"input": inp, "state": st, "sr": np.array(16000, np.int64)})
            out.append(float(o.reshape(-1)[0]))
            ctx = ch[-64:].copy()
        return np.array(out, np.float32)
elif DET == "webrtc":
    import webrtcvad
    CDIR = os.path.join(ROOT, "webrtc", "cand", "webrtc-m2-f30-w90k1-h1250")
    HOP, FA = 30.0, 31.0

    def probs(x16, save=None):
        pcm = np.clip(np.floor(x16.astype(np.float64) * 32768.0 + 0.5), -32768, 32767).astype("<i2")
        if save:
            os.makedirs(os.path.dirname(save), exist_ok=True)
            pcm.tofile(save)
        v = webrtcvad.Vad(2)
        n = 480
        b = pcm.tobytes()
        d = np.array([v.is_speech(b[i * 2 * n:(i + 1) * 2 * n], 16000) for i in range(len(pcm) // n)], np.float64)
        cs = np.concatenate([[0.0], np.cumsum(d)])
        i = np.arange(len(d))
        return ((cs[i + 1] - cs[np.maximum(i - 2, 0)]) / 3).astype(np.float32)
else:
    raise SystemExit("--det=silero|webrtc")

spec = json.load(open(os.path.join(CDIR, "candidate.json"), encoding="utf8"))
assert spec["hop_ms"] == HOP and spec["first_avail_ms"] == FA, spec
res = {"det": DET, "cand": CDIR, "streams": [], "trunc": []}
worst, frames = 0.0, 0
for s in SETS:
    ms = list_streams(ROOT, [s])
    for j in rng.choice(len(ms), size=min(PER, len(ms)), replace=False):
        m = ms[j]
        x, sr = load_audio(m)
        save = os.path.join(OUT, "i16", m["set"], m["id"] + ".i16") if DET == "webrtc" else None
        p = probs(to16k(x, sr), save)
        P = np.fromfile(os.path.join(CDIR, m["set"], m["id"] + ".f32"), dtype="<f4")
        k = min(len(p), len(P))
        d = float(np.max(np.abs(p[:k] - P[:k]))) if k else 0.0
        worst, frames = max(worst, d), frames + k
        res["streams"].append({"set": s, "id": m["id"], "sr": sr, "frames_mine": len(p), "frames_file": len(P), "maxdiff": d})
        print(f"{s:9s} {m['id'][:70]:70s} sr {sr:6d} frames {len(p)}/{len(P)} max|dp| {d:.3g}", flush=True)
seen = set()
for s in ["noise", "fda", "voc", "ptdb", "vocalset"]:
    ms = list_streams(ROOT, [s])
    m = ms[int(rng.integers(len(ms)))]
    x, sr = load_audio(m)
    if sr in seen:
        continue
    seen.add(sr)
    full = probs(to16k(x, sr))
    cut = int(rng.integers(len(x) // 3, len(x) - 1))
    T = cut / sr * 1000.0
    part = probs(to16k(x[:cut], sr))
    avail = FA + HOP * np.arange(len(full))
    ok = np.nonzero(avail <= T)[0]
    ok = ok[ok < len(part)]
    d = float(np.max(np.abs(full[ok] - part[ok]))) if len(ok) else 0.0
    res["trunc"].append({"set": s, "id": m["id"], "sr": sr, "cut_ms": T, "frames_checked": int(len(ok)), "maxdiff": d})
    print(f"causality {s} sr {sr}: cut at {T:.1f} ms, {len(ok)} frames available before the cut, max|dp| {d:.3g}", flush=True)
res["worst"], res["frames"] = worst, frames
os.makedirs(OUT, exist_ok=True)
with open(os.path.join(OUT, f"spot-{DET}.json"), "w", encoding="utf8") as f:
    json.dump(res, f, indent=1)
print(f"{DET}: {len(res['streams'])} streams, {frames} frames, worst max|dp| {worst}; causality worst {max(t['maxdiff'] for t in res['trunc'])}")
