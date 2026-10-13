"""prep_speech_clips.py - speech-dense variant of the 48 kHz timing clips (voice-preview spike,
measurements/voice-preview-spike-2026-10-12.md, Measure step; a sensitivity set beside the
pre-registered clips, whose first seconds are mostly silence).

Same speakers and files as prep_clips.py's timing set (PTDB-TUG M01, M02, F01, F02; each
speaker's mic_*_sx*.wav in sorted order), but each file is first trimmed to its speech: from
0.3 s before its first to 0.3 s after its last voiced frame of the PTDB-TUG laryngograph
reference (column 1 > 0; frame j taken at j * 10 ms + 20 ms, the reference's measured lag).
Trimmed files are joined until the total is >= 8.0 s, then the first 3.0, 5.0 and 8.0 s are
cut. Writes <VP_CACHE>/clips/timing-speech/<who>_<L>s.f32 + index.json (same layout as
clips/timing). Nothing is written inside the repository.

  python -I prep_speech_clips.py [--ptdb DIR]

Corpus: PTDB-TUG (Pirker et al., Interspeech 2011), licence as stated in
tests/dsp/data/ptdb-tug/README.md.
"""
import argparse, glob, hashlib, json, os, site, sys

ap = argparse.ArgumentParser()
ap.add_argument("--ptdb", default=None)
A = ap.parse_args()
HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.abspath(os.path.join(HERE, "..", "..", ".."))
CACHE = os.environ.get("VP_CACHE") or os.path.join(REPO, "build", "voice-preview")
PTDB = A.ptdb or os.path.join(REPO, "tests", "dsp", "data", "ptdb-tug")
_us = site.getusersitepackages()
if _us not in sys.path:
    sys.path.append(_us)
import numpy as np  # noqa: E402
import soundfile as sf  # noqa: E402

OUT = os.path.join(CACHE, "clips", "timing-speech")
os.makedirs(OUT, exist_ok=True)
MARGIN, REF_LAG, SR = 0.3, 0.02, 48000


def sha(path):
    with open(path, "rb") as f:
        return hashlib.sha256(f.read()).hexdigest()


timing = []
for sub, who, sex in [("MALE", "M01", "m"), ("MALE", "M02", "m"), ("FEMALE", "F01", "f"), ("FEMALE", "F02", "f")]:
    files = sorted(glob.glob(os.path.join(PTDB, sub, "MIC", who, f"mic_{who}_sx*.wav")), key=lambda q: os.path.basename(q))
    parts, used, total = [], [], 0
    for q in files:
        y, sr = sf.read(q, dtype="float64")
        assert sr == SR and y.ndim == 1
        sx = os.path.basename(q).split("_")[2].replace(".wav", "")
        r = np.loadtxt(os.path.join(PTDB, sub, "REF", who, f"ref_{who}_{sx}.f0"))[:, 0]
        v = np.nonzero(r > 0)[0]
        if not len(v):
            continue
        a = max(0, int(round((v[0] * 0.01 + REF_LAG - MARGIN) * SR)))
        b = min(len(y), int(round((v[-1] * 0.01 + REF_LAG + MARGIN) * SR)))
        parts.append(y[a:b])
        used.append(dict(file=os.path.basename(q), fromSample=a, toSample=b, samples=b - a))
        total += b - a
        if total >= 8.0 * SR:
            break
    full = np.concatenate(parts)
    rec = dict(name=who, sex=sex, sr=SR, variant="speech", files=used, lengths={})
    for L in (3, 5, 8):
        fn = f"{who}_{L}s.f32"
        np.asarray(full[:int(L * SR)], np.float32).tofile(os.path.join(OUT, fn))
        rec["lengths"][str(L)] = dict(pcm=fn, samples=int(L * SR), sha256=sha(os.path.join(OUT, fn)))
    timing.append(rec)
    print(who, sex, [(u["file"], round(u["samples"] / SR, 2)) for u in used], f"{total / SR:.2f} s joined")
with open(os.path.join(OUT, "index.json"), "w", encoding="utf8") as f:
    json.dump(dict(clips=timing, rule="each file trimmed to its reference-voiced span +-0.3 s, joined, cut"), f, indent=1)
