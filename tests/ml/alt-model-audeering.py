"""
alt-model-audeering.py — Test the audeering wav2vec2-large-robust-{6,24}-ft-
age-gender models against the Hillenbrand per-speaker corpus. Audeering's
models have a custom dual-head (age regression + gender 3-class) wrapper
that doesn't load via AutoModelForAudioClassification, so we define their
AgeGenderModel class here per their published code:
https://github.com/audeering/w2v2-age-gender-how-to

Same Hillenbrand methodology and metrics as alt-model-investigation.py.

Usage:
  python tests/ml/alt-model-audeering.py --layers=6
  python tests/ml/alt-model-audeering.py --layers=24
"""

import argparse
import time
from pathlib import Path

import numpy as np
import soundfile as sf
import torch
import torch.nn as nn
from transformers import Wav2Vec2Processor
from transformers.models.wav2vec2.modeling_wav2vec2 import (
    Wav2Vec2Model,
    Wav2Vec2PreTrainedModel,
)

REPO_ROOT = Path(__file__).resolve().parents[2]
HILL_DIR = REPO_ROOT / "tests" / "dsp" / "data"
TARGET_SR = 16000
WINDOW_SEC = 0.75
WINDOW_SAMPLES = int(TARGET_SR * WINDOW_SEC)
HOP_MS = 150
VAD_PEAK = 0.05


# ---------------------------------------------------------------------------
#  Audeering custom model class (per their published code)
# ---------------------------------------------------------------------------

class ModelHead(nn.Module):
    """Classification head: dense → tanh → dense → logits."""
    def __init__(self, config, num_labels):
        super().__init__()
        self.dense = nn.Linear(config.hidden_size, config.hidden_size)
        self.dropout = nn.Dropout(config.final_dropout)
        self.out_proj = nn.Linear(config.hidden_size, num_labels)

    def forward(self, features):
        x = features
        x = self.dropout(x)
        x = self.dense(x)
        x = torch.tanh(x)
        x = self.dropout(x)
        x = self.out_proj(x)
        return x


class AgeGenderModel(Wav2Vec2PreTrainedModel):
    """Age regression + gender classification (3-class: female, male, child).

    Output: (hidden_states_pooled, logits_age, logits_gender_softmax)
    where logits_gender_softmax is a probability distribution over the
    3 gender classes. Per the audeering model card, the id ordering is
    determined by the trained head; we don't assume positional mapping,
    we'll inspect at runtime if available.

    Transformers 5.x compatibility: the base class's
    `_move_missing_keys_from_meta_to_device` looks for
    `self.all_tied_weights_keys.keys()` which doesn't exist on this
    custom subclass. Define both as empty so loading proceeds.
    Audeering's published code targets older Transformers; this is the
    minimal addition to make it load on 5.8+.
    """
    _tied_weights_keys = []
    all_tied_weights_keys = {}

    def __init__(self, config):
        super().__init__(config)
        self.config = config
        self.wav2vec2 = Wav2Vec2Model(config)
        self.age = ModelHead(config, 1)
        self.gender = ModelHead(config, 3)
        self.init_weights()

    def forward(self, input_values):
        outputs = self.wav2vec2(input_values)
        hidden_states = outputs[0]
        hidden_states = torch.mean(hidden_states, dim=1)
        logits_age = self.age(hidden_states)
        logits_gender = torch.softmax(self.gender(hidden_states), dim=1)
        return hidden_states, logits_age, logits_gender


# ---------------------------------------------------------------------------
#  Audio loading + pipeline (mirrors alt-model-investigation.py)
# ---------------------------------------------------------------------------

def load_resample(path):
    samples, sr = sf.read(str(path), dtype="float32", always_2d=False)
    if samples.ndim > 1:
        samples = samples.mean(axis=1)
    if sr != TARGET_SR:
        ratio = sr / TARGET_SR
        out_len = int(len(samples) / ratio)
        idx = np.arange(out_len) * ratio
        i0 = idx.astype(np.int32)
        i1 = np.minimum(i0 + 1, len(samples) - 1)
        frac = (idx - i0).astype(np.float32)
        samples = samples[i0] * (1 - frac) + samples[i1] * frac
    return samples.astype(np.float32)


def speakers_in(dir_path, gender):
    by_id = {}
    for f in sorted(dir_path.iterdir()):
        if f.suffix.lower() != ".wav":
            continue
        sid = f.name[:3]
        by_id.setdefault(sid, []).append(f)
    return [{"id": sid, "gender": gender, "paths": paths} for sid, paths in by_id.items()]


def concat_speaker(speaker):
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


def run_audeering_pipeline(processor, model, samples, alpha):
    """Stream samples through the rolling-window pipeline. Audeering's
    gender output is 3-class softmax — we extract female / (female + male)
    so the score remains comparable with binary-gender models (drops the
    child probability and renormalizes)."""
    raw = []
    smooth = []
    times = []
    smoothed = None
    last_infer_at = -1
    pos = 0
    chunk = 400
    ring = np.zeros(WINDOW_SAMPLES, dtype=np.float32)
    filled = 0

    # Audeering's model card example shows gender output indexed
    # [female, male, child] in a row vector. We treat index 0 as female,
    # 1 as male; child (index 2) is dropped from the female-vs-male score.
    # If empirical results suggest this ordering is wrong (e.g., 100%
    # accuracy flips to 0%), we'll re-check the model card / test on a
    # known-male sample.
    GENDER_FEMALE_IDX = 0
    GENDER_MALE_IDX = 1

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

        # processor returns input_values
        input_values = processor(ring, sampling_rate=TARGET_SR, return_tensors="pt", padding=True).input_values
        t0 = time.time()
        with torch.no_grad():
            _, _, gender_probs = model(input_values)
        infer_ms = (time.time() - t0) * 1000

        probs = gender_probs.cpu().numpy()[0]  # shape (3,)
        female_p = float(probs[GENDER_FEMALE_IDX])
        male_p = float(probs[GENDER_MALE_IDX])
        s = female_p + male_p
        if s <= 0:
            continue
        score = female_p / s

        smoothed = score if smoothed is None else (smoothed * (1 - alpha) + score * alpha)
        raw.append(score)
        smooth.append(smoothed)
        times.append(infer_ms)

    return raw, smooth, times


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


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--layers", type=int, default=6, choices=[6, 24],
                        help="6 or 24 transformer layers")
    parser.add_argument("--alpha", type=float, default=0.2)
    args = parser.parse_args()

    model_id = f"audeering/wav2vec2-large-robust-{args.layers}-ft-age-gender"
    print(f"Config: window={WINDOW_SEC}s, hop={HOP_MS}ms, EMA alpha={args.alpha}")
    print(f"Loading {model_id}...")
    t0 = time.time()
    processor = Wav2Vec2Processor.from_pretrained(model_id)
    model = AgeGenderModel.from_pretrained(model_id)
    model.eval()
    print(f"  loaded in {time.time() - t0:.1f}s\n")

    speakers = speakers_in(HILL_DIR / "men", "male") + speakers_in(HILL_DIR / "women", "female")
    print(f"Speakers: {sum(1 for s in speakers if s['gender'] == 'male')} men, "
          f"{sum(1 for s in speakers if s['gender'] == 'female')} women, {len(speakers)} total\n")

    per_speaker = []
    for i, sp in enumerate(speakers):
        samples = concat_speaker(sp)
        raw, smooth, times = run_audeering_pipeline(processor, model, samples, args.alpha)
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
            "raw_mean": stats(raw)["mean"] if raw else None,
        })
        if (i + 1) % 20 == 0:
            print(f"    {i + 1}/{len(speakers)}...", flush=True)

    male = [r for r in per_speaker if r["gender"] == "male"]
    female = [r for r in per_speaker if r["gender"] == "female"]
    male_acc = sum(1 for r in male if r["correct"]) / max(1, len(male))
    female_acc = sum(1 for r in female if r["correct"]) / max(1, len(female))
    male_raw_stds = [r["raw_stats"]["std"] for r in male if r["raw_stats"]["n"] >= 2]
    female_raw_stds = [r["raw_stats"]["std"] for r in female if r["raw_stats"]["n"] >= 2]
    smooth_delta = [r["smooth_stats"]["delta_std"] for r in per_speaker if r["smooth_stats"]["n"] >= 2]
    all_times = [r["infer_ms_median"] for r in per_speaker if r["infer_ms_median"] is not None]
    median_infer = float(np.median(all_times)) if all_times else None

    print(f"\n=== Audeering {args.layers}L (alpha={args.alpha}) ===")
    print(f"  male    n={len(male)}  acc={male_acc * 100:.1f}%  raw_std median={np.median(male_raw_stds):.3f}  p95={np.percentile(male_raw_stds, 95):.3f}")
    print(f"  female  n={len(female)}  acc={female_acc * 100:.1f}%  raw_std median={np.median(female_raw_stds):.3f}  p95={np.percentile(female_raw_stds, 95):.3f}")
    print(f"  smooth Δstd median: {np.median(smooth_delta):.4f}  | inference median: {median_infer:.1f}ms")

    # Sanity check: if both genders are 0% accuracy, the female-male index
    # mapping is probably reversed. Flag this.
    if male_acc < 0.2 and female_acc < 0.2:
        print("  ⚠ Both accuracies < 20% — gender index mapping may be inverted. "
              "Try swapping GENDER_FEMALE_IDX / GENDER_MALE_IDX.")

    # Misclassification snapshot
    wrong = [r for r in per_speaker if r["correct"] is False and r["final"] is not None]
    if wrong:
        print(f"\n  Misclassified ({len(wrong)}):")
        for r in wrong[:8]:
            print(f"    {r['id']} ({r['gender']}): final={r['final']:.3f}, rawMean={r['raw_mean']:.3f}, rawStd={r['raw_stats']['std']:.3f}")


if __name__ == "__main__":
    main()
