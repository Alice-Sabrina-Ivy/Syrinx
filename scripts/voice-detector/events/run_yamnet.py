# run_yamnet.py — run YAMNet (ONNX core, onnxruntime CPU EP) over the
# voice-detector benchmark's streams (voice-detector benchmark, 2026-10-06,
# audio-event candidate). Per stream it stores the scores of the stored
# classes (yamnet_lib.STORED: the human-vocal set + a few diagnostics) on a
# causal grid: frame i = the T-frame log-mel patch ending at mel frame
# hop_frames * i, available at 25 + 10 * hop_frames * i ms (yamnet_lib
# header). write_cand.py turns these into candidate directories.
#
#   python scripts/voice-detector/events/run_yamnet.py --model=build/vad/events/model/yamnet_core_fp32.onnx
#          --tag=fp32 [--root=build/vad] [--out=build/vad/events/scores] [--sets=noise,fda,...]
#          [--hop-frames=2] [--T=96] [--real=R] [--threads=8] [--pick=N (N streams per set, spread)] [--force]
# --real=R: short-window variant, only the last R of the T patch rows carry
# audio (the rest digital silence): the frame depends on (R-1)*10+25 ms.
#
# Output: <out>/<tag>/<set>/<id>.npz with
#   cls  float16 (frames, len(STORED))   class scores
#   voice float32 (frames,)              sum of the human-vocal scores (unclipped)
#   top  int16 (frames,), topv float16   arg-max class over all 521 and its score
#   meta: hop_frames, T, first_avail_ms
import json
import os
import sys
import time

import numpy as np
import onnxruntime as ort

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
sys.path.insert(0, os.path.join(HERE, "..", "lib"))
from streams import SETS, list_streams, load_audio_16k  # noqa: E402
from yamnet_lib import STORED, VOCAL, log_mel, patch_iter, n_frames  # noqa: E402

A = dict((a[2:].split("=", 1) + ["1"])[:2] for a in sys.argv[1:] if a.startswith("--"))
ROOT = A.get("root", "build/vad")
OUT = os.path.join(A.get("out", os.path.join(ROOT, "events", "scores")), A["tag"])
SEL = A.get("sets", ",".join(SETS)).split(",")
HOPF = int(A.get("hop-frames", "2"))
T = int(A.get("T", "96"))
REAL = int(A["real"]) if "real" in A else None  # short-window variant: only the last REAL rows carry audio
PICK = int(A.get("pick", "0"))
MEL = np.load(A.get("mel", os.path.join(ROOT, "events", "model", "mel_257x64.npy")))


def main():
    so = ort.SessionOptions()
    so.intra_op_num_threads = int(A.get("threads", "8"))
    so.add_session_config_entry("session.disable_quant_qdq", "1")  # fold weight DequantizeLinear once (same math)
    sess = ort.InferenceSession(A["model"], so, providers=["CPUExecutionProvider"])
    vidx = np.array(STORED)
    nv = len(VOCAL)
    done = 0
    t0 = time.time()
    audio_s = 0.0
    for s in SEL:
        ms = list_streams(ROOT, [s])
        if PICK:
            ms = [ms[(k * len(ms)) // PICK] for k in range(min(PICK, len(ms)))]
        os.makedirs(os.path.join(OUT, s), exist_ok=True)
        for meta in ms:
            fp = os.path.join(OUT, s, meta["id"] + ".npz")
            if os.path.exists(fp) and "force" not in A:
                continue
            x = load_audio_16k(meta)
            lm = log_mel(x, MEL)
            nf = n_frames(len(lm), HOPF)
            cls = np.zeros((nf, len(STORED)), np.float16)
            voice = np.zeros(nf, np.float32)
            top = np.zeros(nf, np.int16)
            topv = np.zeros(nf, np.float16)
            a = 0
            for b in patch_iter(lm, HOPF, T, real=REAL):
                sc = sess.run(None, {"patches": b})[0]
                k = len(sc)
                cls[a:a + k] = sc[:, vidx]
                voice[a:a + k] = sc[:, vidx[:nv]].sum(axis=1)
                top[a:a + k] = sc.argmax(axis=1)
                topv[a:a + k] = sc.max(axis=1)
                a += k
            assert a == nf
            tmp = fp + ".tmp.npz"
            np.savez(tmp, cls=cls, voice=voice, top=top, topv=topv,
                     hop_frames=HOPF, T=T, real=REAL if REAL else T, first_avail_ms=25.0)
            os.replace(tmp, fp)
            done += 1
            audio_s += len(x) / 16000
            if done % 50 == 0:
                el = time.time() - t0
                print(f"[{A['tag']}] {s}: {done} streams, {audio_s / 3600:.2f} h audio, {el:.0f} s ({audio_s / max(el, 1e-9):.0f}x real time)", flush=True)
    print(f"[{A['tag']}] done: {done} streams, {audio_s / 3600:.2f} h audio in {time.time() - t0:.0f} s", flush=True)
    with open(os.path.join(OUT, "run.json"), "w", encoding="utf8") as f:
        json.dump({"model": A["model"], "hop_frames": HOPF, "T": T, "real": REAL, "stored": STORED, "vocal": VOCAL,
                   "ort": ort.__version__, "threads": so.intra_op_num_threads}, f, indent=1)


if __name__ == "__main__":
    main()
