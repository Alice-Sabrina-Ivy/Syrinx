"""Training data for the pitch-neutral resonance HEAD variant (train_dev only).

For every LibriSpeech dev-clean utterance in train_dev (never a test speaker):
  crop <= 4 s; draw K (alpha, st) pairs: alpha log-uniform in [0.85, 1.15] (formant scale),
  st uniform in [-7, +7] semitones (pitch); WORLD analysis on the supplied F0 track ->
  envelope + aperiodicity warped S'(f) = S(f/alpha), F0 x 2^(st/12) -> synthesise ->
  RMS-match -> TD-PSOLA flatten to 165 Hz using the scaled F0 track (exactly the candidate's
  inference path) -> ECAPA fc6 embedding (192-d, relu_33) + logits on non-overlapping
  0.75 s windows with >= 0.3 s voiced.
Saves build/resonance-lab/pitch-neutral-ml/head_train.npz (head_train_raw.npz with --raw: same
pipeline without the flattening step, for the "is the flattening needed?" ablation).
  python gen_head_train.py [N_WORKERS] [--raw]
"""
import os, sys
import numpy as np
import pandas as pd
from concurrent.futures import ProcessPoolExecutor
HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.dirname(os.path.dirname(HERE)))
sys.path.insert(0, HERE)
from rlab import audio  # noqa
from rlab.f0 import F0Track  # noqa
from rlab.paths import MANIFESTS  # noqa
import pnml_core as C  # noqa

OUTD = os.path.dirname(C.CACHE)
EMB = os.path.join(OUTD, "ecapa_q8v2_emb.onnx")
K, CROP, FREF = 3, 4.0, 165.0
MODE = "raw" if "--raw" in __import__("sys").argv else "flat"   # --raw: no TD-PSOLA flattening (ablation)
_S = None


def _init():
    global _S
    os.environ["OMP_NUM_THREADS"] = "1"
    import onnxruntime as ort
    so = ort.SessionOptions(); so.intra_op_num_threads = 1; so.inter_op_num_threads = 1
    _S = ort.InferenceSession(EMB, so, providers=["CPUExecutionProvider"])


def world_manip(x, tr, alpha, st):
    import pyworld as pw
    x = np.asarray(x, np.float64); n = len(x)
    t5 = np.arange(int(n / C.SR / 0.005) + 1) * 0.005
    idx = np.clip(np.round((t5 - tr.t[0]) / 0.01).astype(int), 0, len(tr.t) - 1)
    f0 = np.where(tr.f0[idx] > 0, np.maximum(np.interp(t5, tr.t, tr.f0), 40.0), 0.0)
    sp = pw.cheaptrick(x, f0, t5, C.SR); ap = pw.d4c(x, f0, t5, C.SR)
    fr = np.linspace(0, C.SR / 2, sp.shape[1]); src = fr / alpha
    ls = np.log(np.maximum(sp, 1e-16))
    sp2 = np.exp(np.stack([np.interp(src, fr, r) for r in ls]))
    ap2 = np.clip(np.stack([np.interp(src, fr, r) for r in ap]), 0, 1)
    y = pw.synthesize(np.ascontiguousarray(f0 * 2 ** (st / 12)), np.ascontiguousarray(sp2), np.ascontiguousarray(ap2), C.SR, 5.0)
    y = y[:n] if len(y) >= n else np.pad(y, (0, n - len(y)))
    return y * (np.sqrt(np.mean(x ** 2)) / (np.sqrt(np.mean(y ** 2)) + 1e-12))


def job(args):
    i, path, sr_src, f0p, spk, sex = args
    rng = np.random.default_rng(1000 + i)
    x = audio.load(path, sr_src); tr = F0Track.load(f0p)
    n = len(x); L = int(CROP * C.SR)
    a0 = int(rng.integers(0, max(1, n - L)))
    x = x[a0:a0 + L]
    k0, k1 = int(a0 / C.SR / 0.01), int((a0 + len(x)) / C.SR / 0.01)
    tr = F0Track(tr.t[k0:k1] - a0 / C.SR, tr.f0[k0:k1])
    if (tr.f0 > 0).sum() < 50:
        return []
    out = []
    for k in range(K):
        alpha = float(np.exp(rng.uniform(np.log(0.85), np.log(1.15))))
        st = float(rng.uniform(-7, 7))
        y = world_manip(x, tr, alpha, st)
        trs = F0Track(tr.t, tr.f0 * 2 ** (st / 12))
        yf = C.tdpsola(y, trs, FREF) if MODE == "flat" else y.astype(np.float64)
        for w0 in range(0, len(yf) - 12000 + 1, 12000):
            tv = (tr.t >= w0 / C.SR) & (tr.t < (w0 + 12000) / C.SR) & (tr.f0 > 0)
            if tv.sum() < 30:
                continue
            lg, e = _S.run(None, {_S.get_inputs()[0].name: yf[None, w0:w0 + 12000].astype(np.float32)})
            out.append((e[0].astype(np.float32), float(lg[0][1] - lg[0][0]), alpha, st, spk, sex, i))
    return out


if __name__ == "__main__":
    m = pd.read_parquet(os.path.join(MANIFESTS, "train_dev.parquet"))
    jobs = list(zip(range(len(m)), m.path, m.sr_src, m.f0_path, m.speaker, m.sex))
    rows = []
    nw = int([a for a in sys.argv[1:] if a.isdigit()][0]) if any(a.isdigit() for a in sys.argv[1:]) else 6
    with ProcessPoolExecutor(nw, initializer=_init) as ex:
        for j, r in enumerate(ex.map(job, jobs, chunksize=4)):
            rows += r
            if (j + 1) % 300 == 0:
                print(j + 1, len(rows), flush=True)
    E = np.stack([r[0] for r in rows])
    np.savez(os.path.join(OUTD, "head_train.npz" if MODE == "flat" else "head_train_raw.npz"), emb=E, logit=np.array([r[1] for r in rows]),
             alpha=np.array([r[2] for r in rows]), st=np.array([r[3] for r in rows]),
             speaker=np.array([r[4] for r in rows]), sex=np.array([r[5] for r in rows]),
             utt=np.array([r[6] for r in rows]))
    print("saved", E.shape)
