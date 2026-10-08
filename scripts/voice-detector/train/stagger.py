# stagger.py — custom voice detector, round 2 (pre-registration Addendum F):
# the staggered state reset. Two copies of the streaming model run on the same
# audio; each resets its GRU state to zero every 2T, copy B offset by T (copy A
# at 2T, 4T, ...; copy B at T, 3T, ...; both start from zero state). Only the
# GRU state is reset; the audio context and the convolutions' few past frames
# carry on. The gate's probability per frame is max(p_A, p_B): a frame counts
# as voice when either copy says so. Each copy therefore never carries more
# than 2T of history, inside the 4-32 s training crops for T <= 15 s.
# A deployed gate runs the model twice per capture chunk (twice the WASM cost).
#
# Round 3 (pre-registration 2026-10-07 §3.1): `combine` = "max" (round 2),
# "mean" (A-mean-T: p = (p_A + p_B) / 2) or "old" (A-old-T: p = the copy whose
# time since its last reset is >= T, i.e. the older history; before T both
# copies are the same run).
#
# Engines: Torch (training checkpoint, GPU, chunked through model.Streaming)
# and ONNX (the exported streaming model, onnxruntime CPU, the deployable file).
import numpy as np

import model as M
from infer import chunk_of
from tcommon import HOP, OFF


def reset_frames(n, T_frames, phase):
    """Frames at which a copy resets: phase 0 -> 2T, 4T, ...; phase 1 -> T, 3T, ..."""
    first = 2 * T_frames if phase == 0 else T_frames
    return list(range(first, n, 2 * T_frames))


class _Base:
    def run_copy(self, x16, resets):
        raise NotImplementedError

    combine = "max"

    def __call__(self, x16):
        n = (len(x16) + OFF) // HOP
        pa = self.run_copy(x16, reset_frames(n, self.T, 0))
        pb = self.run_copy(x16, reset_frames(n, self.T, 1))
        return combine(pa, pb, self.T, self.combine)


def combine(pa, pb, T_frames, how):
    if how == "max":
        return np.maximum(pa, pb)
    if how == "mean":
        return (0.5 * (pa.astype(np.float64) + pb)).astype(np.float32)
    if how == "old":
        i = np.arange(len(pa))
        age_a = i % (2 * T_frames)
        age_b = np.where(i < T_frames, i, (i - T_frames) % (2 * T_frames))
        return np.where(age_a >= age_b, pa, pb)
    raise ValueError(how)


class TorchStagger(_Base):
    def __init__(self, ckpt, T_sec, device="cuda", chunk=20000):
        import torch
        self.torch = torch
        self.dev = device if torch.cuda.is_available() else "cpu"
        self.net, self.ck = M.load_ckpt(ckpt)
        self.net.to(self.dev)
        self.frame_ms = self.net.frame_ms
        self.st = M.Streaming(self.net).to(self.dev).eval()
        self.T = int(round(T_sec * 1000 / 12.5))
        self.chunk = chunk

    def run_copy(self, x16, resets):
        torch = self.torch
        n = (len(x16) + OFF) // HOP
        ctx0 = self.net.ctx
        xp = np.concatenate([np.zeros(ctx0 + OFF, np.float32), np.asarray(x16, np.float32)])
        state = [t.to(self.dev) for t in self.st.init_state()]
        out = np.empty(n, np.float32)
        cuts = sorted(set([0, n] + [r for r in resets if 0 < r < n]))
        with torch.no_grad():
            for a0, b0 in zip(cuts[:-1], cuts[1:]):
                if a0 in resets:
                    state[-1] = torch.zeros_like(state[-1])
                i = a0
                while i < b0:
                    m = min(self.chunk, b0 - i)
                    a = ctx0 + i * HOP
                    r = self.st(torch.from_numpy(xp[a:a + m * HOP])[None].to(self.dev), *state)
                    out[i:i + m] = r[0][0].float().cpu().numpy()
                    state = list(r[1:])
                    i += m
        return out


class OnnxStagger(_Base):
    def __init__(self, path, T_sec, chunk=8, combine="max"):
        self.combine = combine
        import onnxruntime as ort
        o = ort.SessionOptions()
        o.inter_op_num_threads = 1
        o.intra_op_num_threads = 1
        self.s = ort.InferenceSession(path, providers=["CPUExecutionProvider"], sess_options=o)
        meta = self.s.get_modelmeta().custom_metadata_map
        self.frame_ms = float(meta.get("frame_ms", "nan"))
        self.inputs = [i.name for i in self.s.get_inputs()]
        self.shapes = {i.name: i.shape for i in self.s.get_inputs()}
        self.T = int(round(T_sec * 1000 / 12.5))
        self.chunk = chunk
        self.fixed = int(meta.get("fixed_frames", 0))
        if self.fixed:
            self.chunk = self.fixed

    def run_copy(self, x16, resets):
        n = (len(x16) + OFF) // HOP
        ctx0 = int(self.shapes["ctx"][1])
        xp = np.concatenate([np.zeros(ctx0 + OFF, np.float32), np.asarray(x16, np.float32)])
        names = [nm for nm in self.inputs if nm != "chunk"]
        st = {nm: np.zeros([d if isinstance(d, int) else 1 for d in self.shapes[nm]], np.float32) for nm in names}
        out = np.empty(n, np.float32)
        rs = set(resets)
        i = 0
        while i < n:
            if i in rs:
                st["h"] = np.zeros_like(st["h"])
            nxt = min([r for r in resets if r > i] + [n])
            m = min(self.chunk, nxt - i)
            a = ctx0 + i * HOP
            feed = dict(st)
            if self.fixed and m < self.fixed:     # fixed chunk: resets fall on even frames, so only the stream end is short
                assert nxt == n, "a reset inside a fixed chunk"
            feed["chunk"] = chunk_of(xp, a, m, self.fixed)
            r = self.s.run(None, feed)
            out[i:i + m] = r[0][0][:m]
            for k, nm in enumerate(names):
                st[nm] = r[k + 1]
            i += m
        return out
