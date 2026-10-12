"""make_fixture.py - reference values for tests/resonance-lab/weight-test.js.

For each committed LibriSpeech fixture (tests/resonance-lab/fixtures/ls_*.wav, CC BY 4.0,
16 kHz int16), takes the Praat AC pitch frames the research feats.py used (25 ms
step, 75-800 Hz, frames above 400 Hz dropped), keeps every 3rd voiced frame, and
stores t, the frame start, f0, the 53 features and the v5 (weight, clarity) outputs
of v5_ref.py.

  python scripts/resonance-lab/weight/make_fixture.py
(any Python with numpy, librosa 0.11, soundfile and praat-parselmouth)
"""
import json
import sys
from pathlib import Path
import numpy as np
import soundfile as sf
import parselmouth

sys.path.insert(0, str(Path(__file__).resolve().parent))
import v5_ref as R  # noqa: E402

ROOT = Path(__file__).resolve().parents[3]
FIX = ROOT / "tests" / "resonance-lab" / "fixtures"
out = {"note": "v5_ref.py frame features + v5 outputs at Praat AC frames (every 3rd voiced frame); "
               "regenerate with scripts/resonance-lab/weight/make_fixture.py", "names": R.NAMES, "items": {}}
for wav in sorted(FIX.glob("ls_*.wav")):
    x, sr = sf.read(wav, dtype="float64")
    assert sr == R.SR
    p = parselmouth.Sound(x, R.SR).to_pitch_ac(time_step=0.025, pitch_floor=75.0, pitch_ceiling=800.0)
    f0s = p.selected_array["frequency"]
    rows = []
    for t, f in zip(p.xs(), f0s):
        if f <= 0 or f > 400:
            continue
        i0 = int(round(t * R.SR)) - R.N // 2
        if i0 < 0 or i0 + R.N > len(x):
            continue
        v = R.frame_feats(x[i0:i0 + R.N], f)
        if v is not None:
            rows.append((float(t), i0, v))
    rows = rows[::3]
    F = np.array([r[2] for r in rows])
    w, c = R.v5_from_feats(F)
    out["items"][wav.name] = [
        {"t": round(t, 6), "i0": i0, "f0": float(v[0]),
         "feats": [None if not np.isfinite(a) else float(a) for a in v],
         "w": float(wi), "c": float(ci)}
        for (t, i0, v), wi, ci in zip(rows, w, c)]
    print(wav.name, len(rows), "frames")
(FIX / "weight_v5.expected.json").write_text(json.dumps(out, separators=(",", ":")))
