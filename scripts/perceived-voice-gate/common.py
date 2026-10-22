"""Shared helpers for the Perceived Voice gate measurement
(measurements/perceived-voice-gate-2026-10-07.md). Public data only.

Layout (gitignored build/, override with SYRINX_PVG_OUT):
  build/perceived-voice-gate/sets/<set>/<id>.f32   16 kHz float32 streams
  build/perceived-voice-gate/sets/jobs_<set>.json  [{ id, f32 }]
  build/perceived-voice-gate/sets/meta_<set>.json  one record per stream
  build/perceived-voice-gate/runs/vad_<set>.<i>.jsonl   chain.mjs output
  build/perceived-voice-gate/runs/sc_<set>.<i>.jsonl    score.py output
  build/perceived-voice-gate/replay/<set>.<variant>.jsonl  replay.mjs output
"""
import os, json
import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.abspath(os.path.join(HERE, "..", ".."))
OUT = os.environ.get("SYRINX_PVG_OUT", os.path.join(REPO, "build", "perceived-voice-gate"))
SETS = os.path.join(OUT, "sets")
RUNS = os.path.join(OUT, "runs")
REPLAY = os.path.join(OUT, "replay")
RESULTS = os.path.join(OUT, "results")

SR, C, WIN, HOPK = 16000, 400, 12000, 6     # 16 kHz, 25 ms chunks, 0.75 s window, 150 ms hop
ALPHA = 0.2                                  # gender-worker EMA_ALPHA
OLD_RESET = 14                               # SilenceTracker: gated windows before the EMA resets
OLD_SCORED = (1, 2, 3)                       # chain.mjs old-gate codes that ran inference


def onnx_path():
    """The deployed classifier (same ONNX file Transformers.js loads; parity 6e-8)."""
    p = os.environ.get("SYRINX_GENDER_ONNX")
    if p:
        return p
    return os.path.join(REPO, "node_modules", "@huggingface", "transformers", ".cache", "Alice-Sabrina-Ivy",
                        "voice-gender-classifier-onnx-q8-v2", "onnx", "model_quantized.onnx")


def f32_write(path, x):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    np.asarray(x, np.float32).tofile(path)


def f32_read(path):
    return np.fromfile(path, dtype=np.float32)


def read_jsonl(path):
    out = {}
    if os.path.exists(path):
        with open(path) as f:
            for line in f:
                if line.strip():
                    d = json.loads(line)
                    out[d["id"]] = d
    return out


def read_prefixed(folder, prefix):
    out = {}
    if os.path.isdir(folder):
        for f in sorted(os.listdir(folder)):
            if f.startswith(prefix) and f.endswith(".jsonl"):
                out.update(read_jsonl(os.path.join(folder, f)))
    return out


_sess = None


def session(threads=1):
    global _sess
    if _sess is None:
        import onnxruntime as ort
        so = ort.SessionOptions()
        so.intra_op_num_threads = threads
        so.inter_op_num_threads = 1
        _sess = ort.InferenceSession(onnx_path(), so, providers=["CPUExecutionProvider"])
    return _sess


def window_logits(x, ks):
    """logit(female) - logit(male) for production windows ending at chunk k ((k+1)*C samples)."""
    s = session()
    name = s.get_inputs()[0].name
    out = np.full(len(ks), np.nan)
    for i, k in enumerate(ks):
        end = (k + 1) * C
        if end < WIN or end > len(x):
            continue
        w = np.ascontiguousarray(x[end - WIN:end], np.float32)[None, :]
        lg = s.run(None, {name: w})[0][0]
        out[i] = float(lg[1] - lg[0])
    return out


# ---------------------------------------------------------------------------
# The retired (2026-07-19 .. 2026-10-07) chain, for the "before" columns.

def old_ema_replay(codes, lgt, alpha=ALPHA, reset=OLD_RESET):
    """Old gender-worker EMA over ticks: codes per tick (chain.mjs), logits per tick
    (NaN where not run). Returns the smoothed female probability per tick (NaN = nothing posted)."""
    sm = np.full(len(codes), np.nan)
    ema, silent = None, 0
    for i, (g, lg) in enumerate(zip(codes, lgt)):
        if g not in OLD_SCORED:
            silent += 1
            if silent == reset:
                ema = None
            continue
        silent = 0
        p = 1.0 / (1.0 + np.exp(-lg))
        ema = p if ema is None else ema * (1 - alpha) + p * alpha
        sm[i] = ema
    return sm


def old_display_replay(n, tick_ks, posted, gate, stale_ms=1500, max_age_ms=6000):
    """Old ResonanceMeter target score per 25 ms hop (before the rAF tween): NaN = blank.
    posted: smoothed score (0-100) per tick or NaN; gate: '0' idle / '1' holding / '2' voiced / '9' none."""
    disp = np.full(n, np.nan)
    post_at = {}
    for k, v in zip(tick_ks, posted):
        if not np.isnan(v):
            post_at[k] = v
    newest_k, newest_v = None, None
    opened_at, was_voiced = 0.0, False
    for k in range(n):
        if k in post_at:
            newest_k, newest_v = k, post_at[k]
        g = gate[k]
        voiced, holding = g == "2", g == "1"
        now = (k + 1) * 25.0
        if voiced and not was_voiced:
            opened_at = now
        was_voiced = voiced
        if not voiced and not holding:
            continue
        if newest_k is None:
            continue
        nt = (newest_k + 1) * 25.0
        unscored_open = voiced and nt < opened_at and now - opened_at > stale_ms
        if unscored_open or now - nt > max_age_ms:
            continue
        disp[k] = newest_v
    return disp
