"""Copied from scripts/resonance-robustness/ at 99ff7fc (output folder moved to build/resonance-narrowband/). Pre-registered budget switch (plan §7): cut every stream at the first utterance
end >= 40 s. Adds n16_40 (16 kHz samples) to build/resonance-narrowband/streams.json.
  PY -I scripts/resonance-narrowband/cut40.py --libri <cache>/librispeech/LibriSpeech
"""
import argparse
import json
import os
import sys
import site

sys.path.append(site.getusersitepackages())  # -I turns the user site off
import numpy as np  # noqa: E402
import soundfile as sf  # noqa: E402

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(os.path.dirname(os.path.dirname(HERE)), "build", "resonance-narrowband")
ap = argparse.ArgumentParser()
ap.add_argument("--libri", required=True)
a = ap.parse_args()
p = os.path.join(OUT, "streams.json")
J = json.load(open(p))
for s in J["streams"]:
    cum = 0
    for it in s["items"]:
        spk, chap, _ = it[3:].split("-")
        cum += sf.info(os.path.join(a.libri, "test-clean", spk, chap, it[3:] + ".flac")).frames
        if cum >= 40 * 16000:
            break
    n = len(np.fromfile(os.path.join(OUT, "streams16", f"{s['speaker']}_orig.f32"), np.float32))
    assert cum <= n
    s["n16_40"] = int(cum)
json.dump(J, open(p, "w"), indent=1)
d = [s["n16_40"] / 16000 for s in J["streams"]]
print(f"40 s cut: min {min(d):.1f} median {np.median(d):.1f} max {max(d):.1f} s, total {sum(d) / 60:.1f} min")
