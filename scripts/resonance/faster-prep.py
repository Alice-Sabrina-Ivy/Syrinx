"""faster-prep.py -- source clips for the resonance responsiveness study
(measurements/resonance-faster-2026-10-26.md).

  python -I scripts/resonance/faster-prep.py --libri=<dir holding LibriSpeech/> --split=dev-clean --tag=dev \
      [--n=10] [--out=build/resonance-faster]

Per LibriSpeech reader of the split (the first n men and n women by numeric
speaker id; sex from SPEAKERS.TXT), the reader's utterances in (chapter,
utterance) order:
  src/<tag>__<spk>.f32   the first 54.0 s, concatenated (16 kHz float32) --
                         the switch streams' material (as switch-prep.py)
  long/<tag>__<spk>.f32  the first 150.0 s of utterances with 0.3 s gaps
                         between them (16 kHz float32) -- the unchanged-voice
                         guard streams
listed in src-<tag>.json. Public data only (LibriSpeech, CC BY 4.0).
"""
import argparse, glob, json, os
import numpy as np, soundfile as sf

ap = argparse.ArgumentParser()
ap.add_argument("--libri", required=True)
ap.add_argument("--split", required=True)
ap.add_argument("--tag", required=True)
ap.add_argument("--n", type=int, default=10)
ap.add_argument("--out", default="build/resonance-faster")
ap.add_argument("--src-s", type=float, default=54.0)
ap.add_argument("--long-s", type=float, default=150.0)
a = ap.parse_args()
SR = 16000
root = os.path.join(a.libri, "LibriSpeech")
sex = {}
for line in open(os.path.join(root, "SPEAKERS.TXT"), encoding="utf8"):
    if line.startswith(";"):
        continue
    f = [x.strip() for x in line.split("|")]
    if len(f) >= 3 and f[2] == a.split:
        sex[f[0]] = "f" if f[1] == "F" else "m"
spk_dirs = sorted(os.listdir(os.path.join(root, a.split)), key=int)
for d in ("src", "long"):
    os.makedirs(os.path.join(a.out, d), exist_ok=True)
rows = []
for want in ("m", "f"):
    picked = [s for s in spk_dirs if sex.get(s) == want][: a.n]
    for spk in picked:
        files = sorted(glob.glob(os.path.join(root, a.split, spk, "*", "*.flac")),
                       key=lambda p: tuple(int(x) for x in os.path.basename(p)[:-5].split("-")[1:]))
        src, long_, d_src, d_long = [], [], 0.0, 0.0
        gap = np.zeros(int(0.3 * SR), np.float32)
        for p in files:
            y, sr = sf.read(p, dtype="float32")
            assert sr == SR
            if d_src < a.src_s:
                src.append(y); d_src += len(y) / SR
            if d_long < a.long_s:
                long_ += [y, gap]; d_long += len(y) / SR + 0.3
            if d_src >= a.src_s and d_long >= a.long_s:
                break
        if d_src < a.src_s or d_long < a.long_s:
            print(f"skip {spk}: {d_src:.1f} / {d_long:.1f} s"); continue
        rid = f"{a.tag}__{spk}"
        np.concatenate(src)[: int(a.src_s * SR)].astype(np.float32).tofile(os.path.join(a.out, "src", rid + ".f32"))
        np.concatenate(long_)[: int(a.long_s * SR)].astype(np.float32).tofile(os.path.join(a.out, "long", rid + ".f32"))
        rows.append({"id": rid, "split": a.split, "tag": a.tag, "speaker": spk, "sex": want,
                     "src": os.path.abspath(os.path.join(a.out, "src", rid + ".f32")),
                     "long": os.path.abspath(os.path.join(a.out, "long", rid + ".f32"))})
json.dump(rows, open(os.path.join(a.out, f"src-{a.tag}.json"), "w"), indent=1)
print(a.tag, {s: sum(r["sex"] == s for r in rows) for s in ("m", "f")}, "readers")
