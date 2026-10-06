# run_silero.py — Silero VAD as a voice-detector benchmark candidate
# (scripts/voice-detector/README.md "Candidate interface"; 2026-10-06).
#
# Streams every benchmark stream through the official Silero VAD ONNX model
# exactly the way its reference streaming wrapper does (silero_vad/utils_vad.py
# OnnxWrapper.__call__): 16 kHz, 512-sample chunks, each prefixed with the
# previous chunk's last 64 samples (zeros before the first), LSTM state carried
# chunk to chunk, fresh state at stream time 0. One probability per 32 ms
# chunk, written as <out>/<set>/<id>.f32 (float32 LE).
#
# Causality: chunk i = 16 kHz samples [512 i, 512 (i + 1)) + its 64-sample
# past context; non-16 kHz streams are resampled with lib/streams.py
# load_audio_16k (scipy polyphase; its FIR reaches <= 0.7 ms ahead), so frame i
# is available at 32 (i + 1) + 1 ms -> candidate.json first_avail_ms 33, hop 32.
#
#   python scripts/voice-detector/silero/run_silero.py --model=PATH
#          [--root=build/vad] [--out=build/vad/cand/silero] [--sets=noise,fda,...]
#          [--shard=0/3] [--force]
#
# The model is NOT in the repo: download it from the official release
# (github.com/snakers4/silero-vad, tag v6.2.3, src/silero_vad/data/silero_vad.onnx,
# MIT) into build/vad/silero/ (gitignored).
import os
import sys
import time

import numpy as np

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "lib"))
from streams import SETS, list_streams, load_audio_16k  # noqa: E402

A = dict((a[2:].split("=", 1) + ["1"])[:2] for a in sys.argv[1:] if a.startswith("--"))
ROOT = A.get("root", "build/vad")
OUT = A.get("out", os.path.join(ROOT, "cand", "silero"))
MODEL = A.get("model", os.path.join(ROOT, "silero", "dl", "silero-vad-6.2.3", "src", "silero_vad", "data", "silero_vad.onnx"))
SEL = A.get("sets", ",".join(SETS)).split(",")
SH, NSH = (int(v) for v in A.get("shard", "0/1").split("/"))
CHUNK, CTX = 512, 64


def session(path):
    import onnxruntime as ort
    o = ort.SessionOptions()
    o.inter_op_num_threads = 1
    o.intra_op_num_threads = 1
    return ort.InferenceSession(path, providers=["CPUExecutionProvider"], sess_options=o)


def silero_probs(sess, x16):
    """One speech probability per full 512-sample chunk (reference streaming)."""
    n = len(x16) // CHUNK
    out = np.empty(n, np.float32)
    state = np.zeros((2, 1, 128), np.float32)
    sr = np.array(16000, dtype=np.int64)
    buf = np.zeros((1, CTX + CHUNK), np.float32)
    for i in range(n):
        buf[0, CTX:] = x16[i * CHUNK:(i + 1) * CHUNK]
        o, state = sess.run(None, {"input": buf, "state": state, "sr": sr})
        out[i] = o[0, 0]
        buf[0, :CTX] = buf[0, -CTX:]
    return out


def main():
    sess = session(MODEL)
    metas = [m for i, m in enumerate(list_streams(ROOT, SEL)) if i % NSH == SH]
    t0, done, aud = time.time(), 0, 0.0
    for m in metas:
        d = os.path.join(OUT, m["set"])
        fp = os.path.join(d, m["id"] + ".f32")
        if os.path.exists(fp) and "force" not in A:
            continue
        os.makedirs(d, exist_ok=True)
        x16 = load_audio_16k(m)
        p = silero_probs(sess, x16)
        tmp = fp + ".tmp"
        p.astype("<f4").tofile(tmp)
        os.replace(tmp, fp)
        done += 1
        aud += len(x16) / 16000
        if done % 100 == 0:
            el = time.time() - t0
            print(f"shard {SH}/{NSH}: {done} streams, {aud / 3600:.2f} h audio, {el:.0f} s ({el / max(aud, 1e-9) * 1000:.2f} ms per s of audio)", flush=True)
    print(f"shard {SH}/{NSH} done: {done} new streams, {aud / 3600:.2f} h audio, {time.time() - t0:.0f} s", flush=True)


if __name__ == "__main__":
    main()
