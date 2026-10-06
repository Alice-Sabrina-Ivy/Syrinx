"""B2 — the deployed 'Perceived voice' ML score (ECAPA-TDNN q8-v2), windowed like
src/ml/gender-worker.js:

  * 0.75 s window (12000 samples @ 16 kHz), inference every 150 ms, causal
    (window ends at the output time); the ring starts zero-filled, so the clip is
    zero-padded 0.75 s in front, and 0.5 s of zeros are appended so a short token
    keeps being scored while it is still inside the ring (as in the live app);
  * voicing-recency VAD arm (audio-utils createVoicedRecencyGate): a window is
    scored only if the F0 track has a voiced frame in the trailing 500 ms
    (the peak-amplitude arm is not emulated);
  * EMA alpha = 0.2 on the female probability; reset after 14 consecutive gated
    windows (RESET_AFTER_SILENT_INFERENCES);
  * output = 100 x smoothed female probability (what the meter shows); NaN on
    gated windows.

Runs the same ONNX file transformers.js loads (do_normalize=false -> raw samples in)
through onnxruntime CPU; parity vs transformers.js is checked by
node/ecapa_parity.mjs.
"""
import os
import numpy as np
from rlab.candidate import Candidate
from rlab.paths import ECAPA_ONNX

WIN, HOP, PAD_TAIL = 12000, 2400, 8000
ALPHA, RESET_AFTER, RECENCY_S = 0.2, 14, 0.5


class B2Ecapa(Candidate):
    name = "b2_ecapa"
    version = "1"
    description = "Deployed ML 'Perceived voice' meter: ECAPA-TDNN q8-v2, 0.75 s / 150 ms, voicing VAD, EMA 0.2"
    cadence_s = 0.15
    uses_f0 = True
    aggregate = "mean"
    model_bytes = os.path.getsize(ECAPA_ONNX) if os.path.exists(ECAPA_ONNX) else 0
    js_portability = "deployed (transformers.js / ORT-WASM, ~52 ms per inference desktop)"

    def setup(self):
        import onnxruntime as ort
        so = ort.SessionOptions()
        so.intra_op_num_threads = 1
        so.inter_op_num_threads = 1
        self.sess = ort.InferenceSession(ECAPA_ONNX, so, providers=["CPUExecutionProvider"])
        self.inp = self.sess.get_inputs()[0].name

    def prob(self, w):
        lg = self.sess.run(None, {self.inp: w[None, :].astype(np.float32)})[0][0]
        e = np.exp(lg - lg.max())
        return float(e[1] / e.sum())          # id2label {0: male, 1: female}

    def score(self, x, sr, f0=None):
        xp = np.concatenate([np.zeros(WIN, np.float32), x.astype(np.float32), np.zeros(PAD_TAIL, np.float32)])
        vt = f0.t[f0.f0 > 0] if f0 is not None else np.array([])
        ts, ss = [], []
        ema, silent = None, 0
        for end in range(WIN + HOP, len(xp) + 1, HOP):
            te = (end - WIN) / sr                       # output time in clip coordinates
            if te <= 0:
                continue
            voiced = len(vt) and np.any((vt > te - RECENCY_S) & (vt <= te))
            ts.append(te)
            if not voiced:
                silent += 1
                if silent >= RESET_AFTER:
                    ema = None
                ss.append(np.nan)
                continue
            silent = 0
            p = self.prob(xp[end - WIN:end])
            ema = p if ema is None else ema + ALPHA * (p - ema)
            ss.append(100.0 * ema)
        return np.array(ts), np.array(ss)


CANDIDATE = B2Ecapa
