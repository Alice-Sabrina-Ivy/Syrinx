# custom_v5_infer.py — V5 (reported, not a gate; pre-registration §4): the
# FROZEN streaming ONNX model over the private session recordings
# ($SYRINX_SESSIONS_DIR/<date>/session.wav), exactly as infer.py --onnx runs a
# harness stream (own samples from t = 0, the pitch worker's resampler, state
# carried). Evaluation only — never training, selection or tuning. Output stays
# in the gitignored build/vad/v5/probs/; results go to the private project, never
# to measurements/ (CLAUDE.md "Private session data").
#   SYRINX_SESSIONS_DIR=... build/vad-train/venv/Scripts/python.exe scripts/voice-detector/judge/custom_v5_infer.py
import hashlib
import os
import sys

import soundfile as sf

REPO = os.getcwd()
sys.path.insert(0, os.path.join(REPO, "scripts", "voice-detector", "train"))
sys.argv = [sys.argv[0]]
from infer import OnnxEngine  # noqa: E402
from tcommon import resample_stream  # noqa: E402

ONNX = "build/vad-train/model/custom-vd.onnx"
assert hashlib.sha256(open(ONNX, "rb").read()).hexdigest() == "4230d27a8dc336dccc7b30afb53941998471f8b1fb5a444b66bc96869ca8c23d"
ROOT = os.environ["SYRINX_SESSIONS_DIR"]
OUT = "build/vad/v5/probs"
os.makedirs(OUT, exist_ok=True)
eng = OnnxEngine(ONNX, 8)
for s in ["2025-09-08", "2026-05-07", "2026-05-26", "2026-06-09"]:
    x, sr = sf.read(f"{ROOT}/{s}/session.wav", dtype="float32", always_2d=True)
    x = x[:, 0]
    p = eng(resample_stream(x, sr))
    p.astype("<f4").tofile(f"{OUT}/{s}.f32")
    print(s, sr, len(x) / sr, "s", len(p), "frames", flush=True)
