# export.py — custom voice detector (2026-10-06): export a checkpoint to the
# streaming ONNX model (model.Streaming) and check it against the batch model.
#
# Inputs : chunk [1, N*200] (new 16 kHz samples, N >= 1 frames), ctx [1, 312]
#          (the previous 312 samples), s0 / s1 / s2 (each causal convolution's
#          past input frames; a dummy [1,1,1,1] for a layer without one),
#          h [layers, 1, H] (GRU state). Zero state = stream start (the runner
#          prepends PAD - 312 = 4 zeros to the stream, tcommon.PAD).
# Outputs: p [1, N] (voice probability per frame), then the new states in the
#          same order (ctx_out, s0_out, s1_out, s2_out, h_out).
# Metadata: hop_ms, first_avail_ms, frame_ms, training run / step, sha256 of
# the checkpoint's state dict.
# Round 3: a model with a GRU state decay (cfg leak_tau, model.py) is exported
# with the recurrence unrolled per frame (one ONNX GRU op per frame on lam * h),
# so its chunk is FIXED at 2 frames (400 samples = one 25 ms capture chunk;
# metadata fixed_frames = 2); the check runs it with chunk 2 only.
#
#   <venv>/python export.py --ckpt=PATH --out=FILE.onnx [--check=8]
import hashlib
import io
import json
import os
import sys

import numpy as np
import torch

import model as M
from tcommon import FIRST_AVAIL_MS, HOP_MS, args

A = args()


def export(ckpt, out):
    net, ck = M.load_ckpt(ckpt)
    fixed = net.lam != 1.0
    net.unrolled = fixed
    st = M.Streaming(net).eval()
    init = st.init_state()
    chunk = torch.zeros(1, 2 * M.HOP)
    names_in = ["chunk", "ctx", "s0", "s1", "s2", "h"]
    names_out = ["p", "ctx_out", "s0_out", "s1_out", "s2_out", "h_out"]
    torch.onnx.export(st, (chunk, *init), out, input_names=names_in, output_names=names_out, opset_version=17,
                      dynamic_axes=None if fixed else {"chunk": {1: "S"}, "p": {1: "N"}}, do_constant_folding=True, dynamo=False)
    import onnx
    m = onnx.load(out)
    buf = io.BytesIO()
    torch.save(net.state_dict(), buf)
    meta = {"hop_ms": str(HOP_MS), "first_avail_ms": str(FIRST_AVAIL_MS), "frame_ms": str(net.frame_ms), "cfg": json.dumps(net.cfg),
            "run": str(ck.get("args", {}).get("name")), "step": str(ck.get("step")), "state_sha256": hashlib.sha256(buf.getvalue()).hexdigest(),
            "licence": "MIT", "what": "Syrinx custom voice-vs-machine detector (scripts/voice-detector/train)"}
    if fixed:
        meta["fixed_frames"] = "2"
        meta["leak_tau"] = str(net.cfg["leak_tau"])
    for k, v in meta.items():
        e = m.metadata_props.add()
        e.key, e.value = k, v
    onnx.save(m, out)
    return net


def check(net, onnx_path, n_streams=8):
    """Batch torch vs streaming ONNX (chunks of 1, 2, 8 frames) on val streams."""
    sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "lib"))
    from streams import list_streams, load_audio
    from infer import OnnxEngine
    from tcommon import VAL, resample_stream
    ms = list_streams(VAL, ["vvoice", "vneg"])
    pick = [ms[int(k * len(ms) / n_streams)] for k in range(n_streams)]
    worst = 0.0
    net.unrolled = False
    for chunk in ((2,) if net.lam != 1.0 else (1, 2, 8)):
        eng = OnnxEngine(onnx_path, chunk)
        for m in pick:
            x, sr = load_audio(m)
            x16 = resample_stream(x, sr)[: 16000 * 20]
            a = M.run_stream(net, x16)
            b = eng(x16)
            assert len(a) == len(b), (len(a), len(b))
            worst = max(worst, float(np.abs(a - b).max()))
    return worst


def main():
    out = A["out"]
    os.makedirs(os.path.dirname(os.path.abspath(out)), exist_ok=True)
    net = export(A["ckpt"], out)
    size = os.path.getsize(out)
    sha = hashlib.sha256(open(out, "rb").read()).hexdigest()
    print(json.dumps({"onnx": out, "bytes": size, "sha256": sha, "params": net.n_params(), "frame_ms": net.frame_ms}))
    if A.get("check", "8") != "0":
        print(json.dumps({"max_abs_diff_torch_batch_vs_onnx_streaming": check(net, out, int(A.get("check", "8")))}))


if __name__ == "__main__":
    main()
