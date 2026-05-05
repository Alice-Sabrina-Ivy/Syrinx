"""
alt-model-investigation.py — Test alternative gender-classification models
against the same Hillenbrand per-speaker corpus the JS investigation used,
measuring the load-bearing metric: per-window prediction std on female
voices.

Mirrors tests/ml/perceived-voice-hillenbrand-test.js's methodology exactly:
- Per-speaker concat (each Hillenbrand speaker's 12 vowels + 50ms silences)
- Rolling 0.75s window, 150ms hop, peak-VAD ≥ 0.05
- EMA smoothing at user-supplied α (default 0.2 to match production)
- Reports per-window raw std (female + male), accuracy, inference time

Candidates tested:
  - prithivMLmods/Common-Voice-Gender-Detection-ONNX (current production
    baseline — rerun here for apples-to-apples Python reference)
  - alefiury/wav2vec2-large-xlsr-53-gender-recognition-librispeech
  - norwoodsystems/norwood-maleVSfemale
  - audeering/wav2vec2-large-robust-{6,24}-ft-age-gender (custom loader,
    see notes below — handled in the dedicated audeering branch when
    a candidate's standard-loader cousins don't beat current).

Audeering's models have multi-head output (age regression + gender
3-class child/female/male) and custom Wav2Vec2 wrapper code (see
github.com/audeering/w2v2-age-gender-how-to). For MVP investigation
we test the standard-loader candidates first; if none beat current,
we'll set up the custom wrapper for audeering. Per the user's brief:
"if the audeering candidates don't pan out — the conversion cost is
real" applies symmetrically.

Usage:
  python tests/ml/alt-model-investigation.py [--alpha=N] [--model=ID]
  python tests/ml/alt-model-investigation.py --all
"""

import argparse
import os
import sys
import time
from pathlib import Path

import numpy as np
import soundfile as sf
import torch
from transformers import AutoFeatureExtractor, AutoModelForAudioClassification

REPO_ROOT = Path(__file__).resolve().parents[2]
HILL_DIR = REPO_ROOT / "tests" / "dsp" / "data"
TARGET_SR = 16000
WINDOW_SEC = 0.75
WINDOW_SAMPLES = int(TARGET_SR * WINDOW_SEC)
HOP_MS = 150
VAD_PEAK = 0.05

CANDIDATES = [
    {
        "id": "prithivMLmods/Common-Voice-Gender-Detection-ONNX",
        "loader": "standard",
        "label_map": "auto",  # parse by name
        "label": "current production",
    },
    {
        "id": "alefiury/wav2vec2-large-xlsr-53-gender-recognition-librispeech",
        "loader": "standard",
        "label_map": "auto",
        "label": "XLSR-53 / LibriSpeech",
    },
    {
        "id": "norwoodsystems/norwood-maleVSfemale",
        "loader": "standard",
        "label_map": "auto",
        "label": "Norwood (wav2vec2-base, unknown training)",
    },
]


# ---------------------------------------------------------------------------
#  Audio loading: same per-speaker concat as JS test
# ---------------------------------------------------------------------------

def load_resample(path):
    """Load a WAV, return float32 samples at TARGET_SR (mono)."""
    samples, sr = sf.read(str(path), dtype="float32", always_2d=False)
    if samples.ndim > 1:
        samples = samples.mean(axis=1)
    if sr != TARGET_SR:
        # Linear resample matching the JS resampleLinear helper.
        ratio = sr / TARGET_SR
        out_len = int(len(samples) / ratio)
        idx = np.arange(out_len) * ratio
        i0 = idx.astype(np.int32)
        i1 = np.minimum(i0 + 1, len(samples) - 1)
        frac = (idx - i0).astype(np.float32)
        samples = samples[i0] * (1 - frac) + samples[i1] * frac
    return samples.astype(np.float32)


def speakers_in(dir_path, gender):
    """Group Hillenbrand WAVs by speaker id (first 3 chars of filename)."""
    by_id = {}
    for f in sorted(dir_path.iterdir()):
        if f.suffix.lower() != ".wav":
            continue
        sid = f.name[:3]
        by_id.setdefault(sid, []).append(f)
    return [{"id": sid, "gender": gender, "paths": paths} for sid, paths in by_id.items()]


def concat_speaker(speaker):
    """Concatenate one speaker's vowels with 50ms silences between."""
    silence = np.zeros(int(TARGET_SR * 0.05), dtype=np.float32)
    parts = []
    for p in speaker["paths"]:
        parts.append(load_resample(p))
        parts.append(silence)
    return np.concatenate(parts) if parts else np.zeros(0, dtype=np.float32)


def window_peak(samples):
    if len(samples) == 0:
        return 0.0
    return float(np.max(np.abs(samples)))


# ---------------------------------------------------------------------------
#  Inference: standard loader
# ---------------------------------------------------------------------------

def load_standard_model(model_id):
    print(f"  loading {model_id}…", flush=True)
    t0 = time.time()
    extractor = AutoFeatureExtractor.from_pretrained(model_id)
    model = AutoModelForAudioClassification.from_pretrained(model_id)
    model.eval()
    print(f"    loaded in {time.time() - t0:.1f}s", flush=True)
    return extractor, model


def female_score_from_logits(logits, id2label):
    """Mirror the JS femaleScoreFromResult: parse by label name, no positional
    guessing. Returns float in [0, 1] or None if no female/male label found.
    For 3-class (child/female/male), normalize over female + male (drop child)
    so the score remains a comparable-with-binary metric.
    """
    probs = torch.softmax(logits, dim=-1).cpu().numpy()
    if probs.ndim > 1:
        probs = probs[0]
    female_p = None
    male_p = None
    for idx, label in id2label.items():
        idx = int(idx)
        ll = label.lower()
        if "female" in ll or ll == "f":
            female_p = float(probs[idx])
        elif "male" in ll or ll == "m":
            male_p = float(probs[idx])
    if female_p is None and male_p is None:
        return None
    if female_p is None:
        female_p = 1 - male_p
    elif male_p is None:
        male_p = 1 - female_p
    # Renormalize: female / (female + male). For binary models this is
    # identity; for multi-class (e.g. audeering's 3-class) it drops the
    # child probability and rescales.
    s = female_p + male_p
    if s <= 0:
        return None
    return float(np.clip(female_p / s, 0.0, 1.0))


def run_pipeline(extractor, model, samples, alpha):
    """Stream samples through the rolling-window pipeline, mirroring the JS
    simulatePipeline. Returns (raw_scores, smoothed_scores, infer_times_ms).
    """
    raw = []
    smooth = []
    times = []
    smoothed = None
    last_infer_at = -1
    id2label = model.config.id2label
    pos = 0
    chunk = 400  # 25 ms at 16 kHz
    ring = np.zeros(WINDOW_SAMPLES, dtype=np.float32)
    filled = 0
    while pos < len(samples):
        end = min(len(samples), pos + chunk)
        seg = samples[pos:end]
        n = len(seg)
        if filled + n >= WINDOW_SAMPLES:
            keep = WINDOW_SAMPLES - n
            ring[:keep] = ring[filled - keep:filled] if filled > keep else ring[:keep]
            ring[keep:keep + n] = seg
            filled = WINDOW_SAMPLES
        else:
            ring[filled:filled + n] = seg
            filled += n
        pos = end

        if filled < WINDOW_SAMPLES:
            continue
        t_ms = end / TARGET_SR * 1000
        if t_ms - last_infer_at < HOP_MS:
            continue
        last_infer_at = t_ms
        if window_peak(ring) < VAD_PEAK:
            continue

        # Inference
        inputs = extractor(ring, sampling_rate=TARGET_SR, return_tensors="pt", padding=True)
        t0 = time.time()
        with torch.no_grad():
            logits = model(**inputs).logits
        infer_ms = (time.time() - t0) * 1000
        female = female_score_from_logits(logits, id2label)
        if female is None:
            continue
        smoothed = female if smoothed is None else (smoothed * (1 - alpha) + female * alpha)
        raw.append(female)
        smooth.append(smoothed)
        times.append(infer_ms)
    return raw, smooth, times


# ---------------------------------------------------------------------------
#  Aggregation + reporting
# ---------------------------------------------------------------------------

def stats(arr):
    if not arr:
        return {"n": 0}
    a = np.array(arr, dtype=np.float64)
    diffs = np.diff(a) if len(a) >= 2 else np.array([0.0])
    return {
        "n": len(a),
        "mean": float(a.mean()),
        "std": float(a.std(ddof=1)) if len(a) >= 2 else 0.0,
        "delta_std": float(diffs.std(ddof=1)) if len(diffs) >= 2 else 0.0,
    }


def evaluate_model(cand, alpha, speakers):
    print(f"\n=== {cand['label']} ===", flush=True)
    extractor, model = load_standard_model(cand["id"])

    per_speaker = []
    for i, sp in enumerate(speakers):
        samples = concat_speaker(sp)
        raw, smooth, times = run_pipeline(extractor, model, samples, alpha)
        if smooth:
            final = smooth[-1]
            predicted = "female" if final >= 0.5 else "male"
            correct = predicted == sp["gender"]
        else:
            final = None
            predicted = None
            correct = False
        per_speaker.append({
            "id": sp["id"],
            "gender": sp["gender"],
            "windows": len(raw),
            "raw_stats": stats(raw),
            "smooth_stats": stats(smooth),
            "infer_ms_median": float(np.median(times)) if times else None,
            "final": final,
            "predicted": predicted,
            "correct": correct,
        })
        if (i + 1) % 20 == 0:
            print(f"    {i + 1}/{len(speakers)}…", flush=True)

    # Aggregate metrics
    male = [r for r in per_speaker if r["gender"] == "male"]
    female = [r for r in per_speaker if r["gender"] == "female"]
    male_acc = sum(1 for r in male if r["correct"]) / max(1, len(male))
    female_acc = sum(1 for r in female if r["correct"]) / max(1, len(female))

    male_raw_stds = [r["raw_stats"]["std"] for r in male if r["raw_stats"]["n"] >= 2]
    female_raw_stds = [r["raw_stats"]["std"] for r in female if r["raw_stats"]["n"] >= 2]
    smooth_delta = [r["smooth_stats"]["delta_std"] for r in per_speaker if r["smooth_stats"]["n"] >= 2]

    all_times = [r["infer_ms_median"] for r in per_speaker if r["infer_ms_median"] is not None]
    median_infer = float(np.median(all_times)) if all_times else None

    print(f"  male    n={len(male)}  acc={male_acc * 100:.1f}%  raw_std median={np.median(male_raw_stds):.3f}  p95={np.percentile(male_raw_stds, 95):.3f}")
    print(f"  female  n={len(female)}  acc={female_acc * 100:.1f}%  raw_std median={np.median(female_raw_stds):.3f}  p95={np.percentile(female_raw_stds, 95):.3f}")
    print(f"  smooth Δstd median: {np.median(smooth_delta):.4f}  | inference median: {median_infer:.1f}ms")
    return {
        "model": cand["id"],
        "label": cand["label"],
        "alpha": alpha,
        "male_acc": male_acc,
        "female_acc": female_acc,
        "female_raw_std_median": float(np.median(female_raw_stds)) if female_raw_stds else None,
        "female_raw_std_p95": float(np.percentile(female_raw_stds, 95)) if female_raw_stds else None,
        "male_raw_std_median": float(np.median(male_raw_stds)) if male_raw_stds else None,
        "smooth_delta_median": float(np.median(smooth_delta)) if smooth_delta else None,
        "infer_ms_median": median_infer,
    }


# ---------------------------------------------------------------------------
#  Main
# ---------------------------------------------------------------------------

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--alpha", type=float, default=0.2)
    parser.add_argument("--model", type=str, default=None,
                        help="Specific model id to test; default tests all CANDIDATES")
    args = parser.parse_args()

    print(f"Config: window={WINDOW_SEC}s, hop={HOP_MS}ms, EMA α={args.alpha}, VAD peak={VAD_PEAK}")
    print(f"Hillenbrand corpus: {HILL_DIR}")

    speakers = speakers_in(HILL_DIR / "men", "male") + speakers_in(HILL_DIR / "women", "female")
    print(f"Speakers: {sum(1 for s in speakers if s['gender'] == 'male')} men, "
          f"{sum(1 for s in speakers if s['gender'] == 'female')} women, {len(speakers)} total\n")

    results = []
    for cand in CANDIDATES:
        if args.model is not None and cand["id"] != args.model:
            continue
        try:
            results.append(evaluate_model(cand, args.alpha, speakers))
        except Exception as e:
            print(f"  ✗ FAILED: {e}", flush=True)
            import traceback; traceback.print_exc()

    print("\n" + "=" * 80)
    print(f" SUMMARY (α={args.alpha})")
    print("=" * 80)
    print(f"{'Model':<60} {'F acc':>6} {'M acc':>6} {'F raw std':>10} {'Inf ms':>8}")
    print("-" * 100)
    for r in results:
        f_std = f"{r['female_raw_std_median']:.3f}" if r['female_raw_std_median'] is not None else "—"
        inf = f"{r['infer_ms_median']:.0f}" if r['infer_ms_median'] is not None else "—"
        print(f"{r['label'][:60]:<60} {r['female_acc'] * 100:>5.1f}% {r['male_acc'] * 100:>5.1f}% {f_std:>10} {inf:>8}")


if __name__ == "__main__":
    main()
