# run_py.py — WebRTC VAD candidate, step 1 (voice-detector benchmark,
# 2026-10-06): run the classic WebRTC GMM VAD (py-webrtcvad, the reference
# implementation for evaluation) on every benchmark stream, every
# aggressiveness mode (0-3) and every native frame length (10 / 20 / 30 ms),
# and cache the raw per-frame decisions. sweep.py turns the cache into
# operating points and probability files.
#
#   <venv>/python scripts/voice-detector/webrtc/run_py.py [--root=build/vad]
#       [--out=build/vad/webrtc] [--sets=noise,...] [--procs=3]
#
# Needs `webrtcvad` (py-webrtcvad 2.0.10 API; on Windows / Python 3.14 the
# prebuilt `webrtcvad-wheels` 2.0.14.post1, same C sources) in a scratch venv.
#
# Input to the VAD: the stream exactly as the app got it (lib/streams.py),
# resampled to 16 kHz with lib/streams.py load_audio_16k (polyphase, ~0.6 ms
# half-length; 16 kHz streams untouched), quantised to int16 as
# floor(x * 32768 + 0.5) clipped. Frame i of length F ms covers 16 kHz samples
# [i * 16F, (i + 1) * 16F) of stream time and is available at (i + 1) * F ms.
# VAD state runs from the stream's first sample (a fresh session per stream).
#
# Out: <out>/cache/<set>/<id>.npz with uint8 arrays d<mode>_<F> (1 = speech).
# For the streams not natively at 16 kHz (FDA 20 kHz, PTDB 48 kHz, vocadito
# 44.1 kHz) it also writes the exact int16 input to <out>/pcm16/<set>/<id>.i16
# so run_wasm.mjs can feed the WASM port bit-identical samples.
import os
import sys
import time
from multiprocessing import Pool

import numpy as np

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "lib"))
from streams import SETS, list_streams, load_audio_16k  # noqa: E402

A = dict((a[2:].split("=", 1) + ["1"])[:2] for a in sys.argv[1:] if a.startswith("--"))
ROOT = A.get("root", "build/vad")
OUT = A.get("out", os.path.join(ROOT, "webrtc"))
SEL = A.get("sets", ",".join(SETS)).split(",")
PROCS = int(A.get("procs", "3"))
MODES = (0, 1, 2, 3)
FRAMES_MS = (10, 20, 30)


def to_i16(x):
    return np.clip(np.floor(x.astype(np.float64) * 32768.0 + 0.5), -32768, 32767).astype("<i2")


def decide(pcm, mode, fms):
    import webrtcvad
    n = 16 * fms
    nfr = len(pcm) // n
    v = webrtcvad.Vad(mode)
    mv = memoryview(pcm.tobytes())
    out = np.zeros(nfr, np.uint8)
    step = 2 * n
    for i in range(nfr):
        out[i] = v.is_speech(mv[i * step:(i + 1) * step], 16000)
    return out


def job(meta):
    dst = os.path.join(OUT, "cache", meta["set"], meta["id"] + ".npz")
    if os.path.exists(dst):
        return meta["set"], 0.0, 0.0
    t0 = time.perf_counter()
    pcm = to_i16(load_audio_16k(meta))
    if meta["audio"]["sr"] != 16000:
        p = os.path.join(OUT, "pcm16", meta["set"], meta["id"] + ".i16")
        os.makedirs(os.path.dirname(p), exist_ok=True)
        pcm.tofile(p)
    t1 = time.perf_counter()
    arrs = {f"d{m}_{f}": decide(pcm, m, f) for m in MODES for f in FRAMES_MS}
    t2 = time.perf_counter()
    os.makedirs(os.path.dirname(dst), exist_ok=True)
    tmp = dst[:-4] + ".tmp.npz"
    np.savez_compressed(tmp, **arrs)
    os.replace(tmp, dst)
    return meta["set"], t1 - t0, t2 - t1


def main():
    metas = list_streams(ROOT, SEL)
    t0 = time.perf_counter()
    done = 0
    tl = tv = 0.0
    with Pool(PROCS) as pool:
        for s, a, b in pool.imap_unordered(job, metas, chunksize=4):
            done += 1
            tl += a
            tv += b
            if done % 200 == 0 or done == len(metas):
                print(f"{done}/{len(metas)} streams, {time.perf_counter() - t0:.0f} s wall (load {tl:.0f} s, vad {tv:.0f} s cpu)", flush=True)


if __name__ == "__main__":
    main()
