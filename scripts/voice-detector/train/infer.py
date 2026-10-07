# infer.py — custom voice detector (2026-10-06): run a model over streams
# and write candidate probability files (scripts/voice-detector/README.md
# "Candidate interface"): one float32 per 12.5 ms frame of every stream.
#
# Input = the stream's own samples at its own rate (lib/streams.py load_audio,
# exactly what the app got), resampled to 16 kHz by the pitch worker's
# streaming linear resampler (tcommon.resample_stream), then the causal model
# (model.py). Two engines:
#   --engine=torch  a training checkpoint (selection; GPU if available)
#   --engine=onnx   the exported streaming ONNX model, fed chunk by chunk with
#                   its carried state exactly as a deployed gate would run it
#                   (onnxruntime CPU EP, 1 thread) — the frozen candidate's files
#
#   python infer.py --ckpt=PATH|--onnx=PATH --out=DIR [--root=build/vad-train/val] [--sets=vvoice,vmix20,vmix0,vneg]
#          [--split=tune] [--shard=i/n] [--force] [--chunk=8]
# --split=tune keeps only the noise streams whose dump says split == "tune"
# (selection on the 194-clip tuning split; nothing else of the benchmark).
import json
import os
import sys
import time

import numpy as np

import model as M
from tcommon import FIRST_AVAIL_MS, HOP_MS, OFF, HOP, args, resample_stream

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "lib"))
from streams import list_streams, load_audio  # noqa: E402

A = args()


class TorchEngine:
    def __init__(self, ckpt):
        import torch
        self.torch = torch
        self.dev = "cuda" if torch.cuda.is_available() and A.get("device", "cuda") == "cuda" else "cpu"
        self.net, self.ck = M.load_ckpt(ckpt)
        self.net.to(self.dev)
        self.frame_ms = self.net.frame_ms

    def __call__(self, x16):
        return M.run_stream(self.net, x16, self.dev)


class OnnxEngine:
    def __init__(self, path, chunk=8):
        import onnxruntime as ort
        o = ort.SessionOptions()
        o.inter_op_num_threads = 1
        o.intra_op_num_threads = 1
        self.s = ort.InferenceSession(path, providers=["CPUExecutionProvider"], sess_options=o)
        self.chunk = chunk
        meta = self.s.get_modelmeta().custom_metadata_map
        self.frame_ms = float(meta.get("frame_ms", "nan"))
        self.inputs = [i.name for i in self.s.get_inputs()]
        self.shapes = {i.name: i.shape for i in self.s.get_inputs()}

    def __call__(self, x16):
        n = (len(x16) + OFF) // HOP
        ctx0 = int(self.shapes["ctx"][1])          # WIN - HOP of this model
        xp = np.concatenate([np.zeros(ctx0 + OFF, np.float32), np.asarray(x16, np.float32)])
        st = {}
        for name in self.inputs:
            if name == "chunk":
                continue
            st[name] = np.zeros([d if isinstance(d, int) else 1 for d in self.shapes[name]], np.float32)
        out = np.empty(n, np.float32)
        i = 0
        while i < n:
            m = min(self.chunk, n - i)
            a = ctx0 + i * HOP
            feed = dict(st)
            feed["chunk"] = xp[a:a + m * HOP][None]
            r = self.s.run(None, feed)
            out[i:i + m] = r[0][0]
            for k, name in enumerate([nm for nm in self.inputs if nm != "chunk"]):
                st[name] = r[k + 1]
            i += m
        return out


def cand_json(out_dir, name, frame_ms, threshold=0.5, hangover_ms=0.0, agg="last", v4=None, notes=""):
    spec = {"name": name, "hop_ms": HOP_MS, "first_avail_ms": FIRST_AVAIL_MS, "frame_ms": frame_ms, "lookahead_ms": 0,
            "threshold": threshold, "hangover_ms": hangover_ms, "agg": agg, "p_before_first": 0.0, "v4": v4 or {}, "notes": notes}
    os.makedirs(out_dir, exist_ok=True)
    with open(os.path.join(out_dir, "candidate.json"), "w", encoding="utf8") as f:
        json.dump(spec, f, indent=1)
    return spec


def main():
    root = A.get("root", "build/vad-train/val")
    sets = A.get("sets", "vvoice,vmix20,vmix0,vneg").split(",")
    outs = A["out"].split(",")
    sh, nsh = (int(v) for v in A.get("shard", "0/1").split("/"))
    if "onnx" in A:
        engs = [OnnxEngine(A["onnx"], int(A.get("chunk", "8")))]
    else:
        engs = [TorchEngine(c) for c in A["ckpt"].split(",")]   # several checkpoints share one pass over the audio
    assert len(engs) == len(outs)
    metas = list_streams(root, sets)
    if A.get("split"):
        metas = [m for m in metas if m["set"] != "noise" or m.get("split") == A["split"]]
    metas = [m for i, m in enumerate(metas) if i % nsh == sh]
    t0, done, aud = time.time(), 0, 0.0
    for m in metas:
        todo = [(e, o) for e, o in zip(engs, outs) if "force" in A or not os.path.exists(os.path.join(o, m["set"], m["id"] + ".f32"))]
        if not todo:
            continue
        x, sr = load_audio(m)
        x16 = resample_stream(x, sr)
        for eng, out in todo:
            d = os.path.join(out, m["set"])
            fp = os.path.join(d, m["id"] + ".f32")
            os.makedirs(d, exist_ok=True)
            p = eng(x16)
            p.astype("<f4").tofile(fp + ".tmp")
            os.replace(fp + ".tmp", fp)
        done += 1
        aud += len(x) / sr
    for eng, out in zip(engs, outs):
        if not os.path.exists(os.path.join(out, "candidate.json")):
            cand_json(out, os.path.basename(os.path.normpath(out)), eng.frame_ms)
    print(f"{','.join(outs)}: {done} streams, {aud / 3600:.2f} h, {time.time() - t0:.0f} s", flush=True)


if __name__ == "__main__":
    main()
