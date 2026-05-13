"""Praat CPPS computation across the four test corpora.
P2 of WS2 (Praat comparison validation).

Walks each corpus, loads each track, computes CPPS via parselmouth
+ Praat's Sound → To PowerCepstrogram → Get CPPS, writes per-track
results to JSON for comparison with Syrinx CPP (P3 / P4).

Subsets each corpus to a reasonable cap so the run completes in a
sane time. The cap is per-corpus to maintain balanced coverage —
overall Praat-Syrinx correlation analysis doesn't need every track.

Praat parameters: explicit defaults documented per
measurements/vocal-weight-cpps-audit-2026-05-09.md §1.1. The
comparison is "does Syrinx CPP correlate with Praat CPPS on the
same audio," not "do we produce identical numbers" — Praat uses
Theil-robust regression + smoothing while Syrinx uses linear-LSQ
without smoothing. Bias and absolute values are expected to
differ; correlation direction is the load-bearing finding.

Usage: python -u scripts/praat-cpps-corpus.py  (-u for unbuffered
       output so progress is visible during the run)
Output: measurements/praat-cpps-corpus-2026-05-10.json
"""
import json
import random
import struct
import sys
from datetime import datetime, timezone
from pathlib import Path

import numpy as np
import parselmouth

# Per-corpus track cap. Prior run timed out at ~17 minutes with the
# full 1450-track set; capping at 200 keeps wall-clock under ~10 min
# while still giving statistical resolution per corpus.
PER_CORPUS_CAP = 200
random.seed(42)  # deterministic subset across runs

ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / "tests" / "dsp" / "data"

# Praat PowerCepstrogram parameters
PITCH_FLOOR_HZ = 60
TIME_STEP_S = 0.002
MAX_FREQ_HZ = 5000
PRE_EMPHASIS_FROM_HZ = 50

# Praat Get CPPS parameters
SUBTRACT_TREND_BEFORE_SMOOTHING = "no"
TIME_AVG_WIN_S = 0.001
QUEFRENCY_AVG_WIN_S = 0.00005
PITCH_FLOOR_FOR_PEAK_HZ = 60
PITCH_CEILING_FOR_PEAK_HZ = 330
TOLERANCE = 0.05
INTERPOLATION = "Parabolic"
TREND_LINE_QSTART_S = 0.001
TREND_LINE_QEND_S = 0.05
TREND_TYPE = "Exponential decay"
FIT_METHOD = "Robust slow"


def compute_cpps(snd: parselmouth.Sound) -> float:
    cepstrogram = parselmouth.praat.call(
        snd,
        "To PowerCepstrogram",
        PITCH_FLOOR_HZ,
        TIME_STEP_S,
        MAX_FREQ_HZ,
        PRE_EMPHASIS_FROM_HZ,
    )
    return parselmouth.praat.call(
        cepstrogram,
        "Get CPPS",
        SUBTRACT_TREND_BEFORE_SMOOTHING,
        TIME_AVG_WIN_S,
        QUEFRENCY_AVG_WIN_S,
        PITCH_FLOOR_FOR_PEAK_HZ,
        PITCH_CEILING_FOR_PEAK_HZ,
        TOLERANCE,
        INTERPOLATION,
        TREND_LINE_QSTART_S,
        TREND_LINE_QEND_S,
        TREND_TYPE,
        FIT_METHOD,
    )


def load_sig(path: Path, sample_rate: int = 20000) -> parselmouth.Sound:
    """Load FDA .sig (16-bit big-endian raw PCM mono)."""
    raw = path.read_bytes()
    n = len(raw) // 2
    samples = np.array(struct.unpack(f">{n}h", raw), dtype=np.float64) / 32768.0
    return parselmouth.Sound(samples, sampling_frequency=sample_rate)


def hillenbrand_tracks():
    """Hillenbrand corpus: tests/dsp/data/{men,women}/*.wav."""
    out = []
    for sub, gender in [("men", "m"), ("women", "w")]:
        sub_dir = DATA / sub
        if not sub_dir.exists():
            continue
        for wav in sub_dir.glob("*.wav"):
            out.append({"corpus": "hillenbrand", "track_id": wav.stem, "gender": gender, "path": wav, "loader": "wav"})
    return out


def ptdb_tracks():
    """PTDB-TUG: tests/dsp/data/ptdb-tug/{FEMALE,MALE}/MIC/<speaker>/mic_*.wav."""
    out = []
    base = DATA / "ptdb-tug"
    if not base.exists():
        return out
    for gdir, gender in [("FEMALE", "f"), ("MALE", "m")]:
        mic_root = base / gdir / "MIC"
        if not mic_root.exists():
            continue
        for spk_dir in mic_root.iterdir():
            if not spk_dir.is_dir():
                continue
            for wav in spk_dir.glob("mic_*.wav"):
                out.append({"corpus": "ptdb-tug", "track_id": wav.stem, "gender": gender, "path": wav, "loader": "wav"})
    return out


def vocadito_tracks():
    """Vocadito: tests/dsp/data/vocadito/Audio/vocadito_*.wav."""
    out = []
    base = DATA / "vocadito" / "Audio"
    if not base.exists():
        return out
    for wav in base.glob("vocadito_*.wav"):
        out.append({"corpus": "vocadito", "track_id": wav.stem, "gender": "unknown", "path": wav, "loader": "wav"})
    return out


def fda_tracks():
    """FDA: tests/dsp/data/fda/{rl,sb}/*.sig (16-bit BE raw PCM, 20 kHz)."""
    out = []
    base = DATA / "fda"
    if not base.exists():
        return out
    for sub, gender in [("rl", "m"), ("sb", "f")]:
        sub_dir = base / sub
        if not sub_dir.exists():
            continue
        for sig in sub_dir.glob("*.sig"):
            out.append({"corpus": "fda", "track_id": sig.stem, "gender": gender, "path": sig, "loader": "sig"})
    return out


def main():
    all_tracks_full = {
        "hillenbrand": hillenbrand_tracks(),
        "ptdb-tug": ptdb_tracks(),
        "vocadito": vocadito_tracks(),
        "fda": fda_tracks(),
    }
    print(f"Loaded track inventory:")
    for c, ts in all_tracks_full.items():
        print(f"  {c}: {len(ts)} tracks")
    sys.stdout.flush()

    # Random per-corpus subset to keep wall-clock reasonable.
    all_tracks = []
    for c, ts in all_tracks_full.items():
        if len(ts) <= PER_CORPUS_CAP:
            all_tracks.extend(ts)
        else:
            all_tracks.extend(random.sample(ts, PER_CORPUS_CAP))
    print(f"Subset to {len(all_tracks)} tracks (cap {PER_CORPUS_CAP}/corpus)\n")
    sys.stdout.flush()

    results = []
    failed = 0
    for i, t in enumerate(all_tracks):
        if i % 25 == 0:
            print(f"  [{i}/{len(all_tracks)}] processing {t['corpus']}/{t['track_id']}")
            sys.stdout.flush()
        try:
            if t["loader"] == "wav":
                snd = parselmouth.Sound(str(t["path"]))
            elif t["loader"] == "sig":
                snd = load_sig(t["path"])
            else:
                continue
            cpps = compute_cpps(snd)
            results.append({
                "corpus": t["corpus"],
                "track_id": t["track_id"],
                "gender": t["gender"],
                "duration_s": snd.duration,
                "sample_rate": snd.sampling_frequency,
                "cpps_db": float(cpps),
            })
        except Exception as e:
            failed += 1
            results.append({
                "corpus": t["corpus"],
                "track_id": t["track_id"],
                "gender": t["gender"],
                "error": str(e),
            })

    print(f"\nProcessed {len(all_tracks)}, failed {failed}")
    out_path = ROOT / "measurements" / "praat-cpps-corpus-2026-05-10.json"
    out_path.parent.mkdir(parents=True, exist_ok=True)
    out_path.write_text(json.dumps({
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "praat_params": {
            "pitch_floor_hz": PITCH_FLOOR_HZ,
            "time_step_s": TIME_STEP_S,
            "max_freq_hz": MAX_FREQ_HZ,
            "pre_emphasis_from_hz": PRE_EMPHASIS_FROM_HZ,
            "cpps_pitch_floor_hz": PITCH_FLOOR_FOR_PEAK_HZ,
            "cpps_pitch_ceiling_hz": PITCH_CEILING_FOR_PEAK_HZ,
            "trend_type": TREND_TYPE,
            "fit_method": FIT_METHOD,
        },
        "results": results,
    }, indent=2))
    print(f"Wrote {out_path}")


if __name__ == "__main__":
    main()
