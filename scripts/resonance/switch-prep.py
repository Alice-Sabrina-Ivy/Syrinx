"""switch-prep.py -- source clips for the resonance switch-asymmetry runs
(measurements/resonance-switch-asymmetry-2026-10-21.md).

  python scripts/resonance/switch-prep.py --ls=<resonance-lab cache root> [--out=build/resonance-switch]

Per LibriSpeech reader of the r1 manifests (dev = r1_dev / dev-clean,
held-out = r1_test / test-clean; 20 men + 20 women each), the reader's
utterances in manifest order, concatenated, first 54.0 s (3 segments of
18 s), written as 16 kHz float32 (src/<split>__<speaker>.f32) and listed in
src.json with sex and split. Public data only.
"""
import argparse, json, os
import numpy as np, pandas as pd, soundfile as sf

ap = argparse.ArgumentParser()
ap.add_argument("--ls", required=True)
ap.add_argument("--out", default="build/resonance-switch")
ap.add_argument("--seconds", type=float, default=54.0)
a = ap.parse_args()
SR = 16000
os.makedirs(os.path.join(a.out, "src"), exist_ok=True)
rows = []
for split, man in (("dev", "r1_dev"), ("held", "r1_test")):
    m = pd.read_parquet(os.path.join(a.ls, "bench", "manifests", f"{man}.parquet"))
    for (spk, sex), g in m.sort_values(["speaker", "order"]).groupby(["speaker", "sex"]):
        parts, dur = [], 0.0
        for p in g["path"]:
            rel = p.replace("\\", "/").split("/data/", 1)[1]
            y, sr = sf.read(os.path.join(a.ls, "data", rel), dtype="float32")
            assert sr == SR
            parts.append(y); dur += len(y) / SR
            if dur >= a.seconds:
                break
        if dur < a.seconds:
            print(f"skip {split} {spk}: {dur:.1f} s"); continue
        y = np.concatenate(parts)[: int(a.seconds * SR)].astype(np.float32)
        f = os.path.join(a.out, "src", f"{split}__{spk}.f32")
        y.tofile(f)
        rows.append({"id": f"{split}__{spk}", "split": split, "speaker": spk, "sex": sex, "path": os.path.abspath(f)})
json.dump(rows, open(os.path.join(a.out, "src.json"), "w"), indent=1)
print({s: sum(r["split"] == s for r in rows) for s in ("dev", "held")}, "readers")
