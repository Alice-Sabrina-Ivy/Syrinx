"""prep_clips.py - public clips for the voice-preview spike (measurements/voice-preview-spike-2026-10-12.md §P1).

Writes, under <VP_CACHE>/clips (nothing inside the repository):
  proto16/   the scratch prototype's 8 clips (16 kHz mono float32 + clips.json), rebuilt by the
             prototype's own selection rules (its prep_clips.py, unchanged in substance)
  timing/    the 48 kHz timing clips: PTDB-TUG M01, M02, F01, F02; each speaker's mic_*_sx*.wav
             joined in sorted order (each file's own leading / trailing silence kept) until the
             total is >= 8.0 s, then the first 3.0, 5.0 and 8.0 s; float32 + index.json

  python -I prep_clips.py --pyworld DIR --librispeech DIR [--ptdb DIR] [--proto-data DIR]

--pyworld      directory that contains the pyworld 0.3.5 package (only the breathy-clip choice uses it)
--librispeech  LibriSpeech root (with SPEAKERS.TXT and test-clean/)
--ptdb         PTDB-TUG subset root (default <repo>/tests/dsp/data/ptdb-tug; see its README)
--proto-data   the prototype's data folder: its stored F0 grids (*.f0grid.f32, the front end the user
               listened to) are copied into proto16/, and every rebuilt clip must be bit-identical to
               the prototype's (*.f32), or the script stops.

Corpora: LibriSpeech (Panayotov et al., ICASSP 2015), CC BY 4.0. PTDB-TUG (Pirker et al.,
Interspeech 2011), licence as stated in tests/dsp/data/ptdb-tug/README.md.
"""
import argparse, glob, hashlib, json, os, shutil, site, sys

ap = argparse.ArgumentParser()
ap.add_argument("--pyworld", required=True)
ap.add_argument("--librispeech", required=True)
ap.add_argument("--ptdb", default=None)
ap.add_argument("--proto-data", default=None)
A = ap.parse_args()

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.abspath(os.path.join(HERE, "..", "..", ".."))
CACHE = os.environ.get("VP_CACHE") or os.path.join(REPO, "build", "voice-preview")
PTDB = A.ptdb or os.path.join(REPO, "tests", "dsp", "data", "ptdb-tug")
LS = A.librispeech
sys.path.insert(0, A.pyworld)
_us = site.getusersitepackages()
if _us not in sys.path:
    sys.path.append(_us)
import numpy as np  # noqa: E402
import soundfile as sf  # noqa: E402
from scipy.signal import resample_poly  # noqa: E402
import pyworld as pw  # noqa: E402

SR = 16000
OUT16 = os.path.join(CACHE, "clips", "proto16")
OUT48 = os.path.join(CACHE, "clips", "timing")
os.makedirs(OUT16, exist_ok=True)
os.makedirs(OUT48, exist_ok=True)


def sha(path):
    with open(path, "rb") as f:
        return hashlib.sha256(f.read()).hexdigest()


# ---------------------------------------------------------------- prototype set (16 kHz)
spk = {}
with open(os.path.join(LS, "SPEAKERS.TXT"), encoding="utf8") as f:
    for line in f:
        if line.startswith(";"):
            continue
        p = [s.strip() for s in line.split("|")]
        if len(p) >= 3 and p[2] == "test-clean":
            spk[int(p[0])] = p[1].lower()
men = sorted(k for k, v in spk.items() if v == "m")
women = sorted(k for k, v in spk.items() if v == "f")


def first_utt(sid, lo=5.0, hi=8.0):
    files = sorted(glob.glob(os.path.join(LS, "test-clean", str(sid), "*", "*.flac")), key=lambda p: os.path.basename(p))
    for p in files:
        info = sf.info(p)
        d = info.frames / info.samplerate
        if lo <= d <= hi:
            return p, d
    return None, None


def load_ls(p):
    x, sr = sf.read(p, dtype="float64")
    assert sr == SR
    return x


clips = []


def add(name, sex, src, x, note=""):
    np.asarray(x, np.float32).tofile(os.path.join(OUT16, name + ".f32"))
    clips.append(dict(name=name, sex=sex, src=src, dur=len(x) / SR, note=note))


for name, sid in [("ls_m1", men[0]), ("ls_m2", men[1])]:
    p, d = first_utt(sid)
    add(name, "m", f"LibriSpeech test-clean {os.path.basename(p)}", load_ls(p))
for name, sid in [("ls_f1", women[0]), ("ls_f2", women[1])]:
    p, d = first_utt(sid)
    add(name, "f", f"LibriSpeech test-clean {os.path.basename(p)}", load_ls(p))

for name, sex, sub, who in [("pt_m1", "m", "MALE", "M01"), ("pt_f1", "f", "FEMALE", "F01")]:
    files = sorted(glob.glob(os.path.join(PTDB, sub, "MIC", who, f"mic_{who}_sx*.wav")))
    for p in files:
        info = sf.info(p)
        if info.frames / info.samplerate >= 2.5:
            break
    x, sr = sf.read(p, dtype="float64")
    if x.ndim > 1:
        x = x[:, 0]
    assert sr == 48000
    add(name, sex, f"PTDB-TUG {os.path.basename(p)} (48 kHz -> 16 kHz)", resample_poly(x, 1, 3))

cand = []
for sid in women[2:]:
    p, d = first_utt(sid)
    if p is None:
        continue
    x = load_ls(p)
    f0, t = pw.dio(x, SR, f0_floor=71.0, f0_ceil=800.0, frame_period=5.0)
    f0 = pw.stonemask(x, f0, t, SR)
    apr = pw.d4c(x, f0, t, SR)
    freqs = np.linspace(0, SR / 2, apr.shape[1])
    band = freqs <= 4000
    v = f0 > 0
    if v.sum() < 50:
        continue
    cand.append((float(np.median(apr[v][:, band].mean(axis=1))), sid, p))
cand.sort(reverse=True)
prox, sid, p = cand[0]
add("ls_fb", "f", f"LibriSpeech test-clean {os.path.basename(p)}", load_ls(p),
    note=f"breathiest of {len(cand)} candidates by D4C aperiodicity proxy ({prox:.3f}; "
         f"median of candidates {np.median([c[0] for c in cand]):.3f})")

p, d = first_utt(men[2])
x = load_ls(p)
rng = np.random.default_rng(1)
w = rng.standard_normal(len(x) + 4096)
W = np.fft.rfft(w)
fr = np.fft.rfftfreq(len(w), 1 / SR)
W[1:] /= np.sqrt(fr[1:])
W[0] = 0
n = np.fft.irfft(W, len(w))[:len(x)]
n = n / np.sqrt(np.mean(n ** 2)) * np.sqrt(np.mean(x ** 2)) / 10 ** (10 / 20)
add("ls_mn", "m", f"LibriSpeech test-clean {os.path.basename(p)} + synthetic pink noise", x + n,
    note="pink noise (seed 1) at +10 dB SNR re the clean clip RMS")

for c in clips:
    c["sha256"] = sha(os.path.join(OUT16, c["name"] + ".f32"))
if A.proto_data:
    for c in clips:
        theirs = sha(os.path.join(A.proto_data, c["name"] + ".f32"))
        if theirs != c["sha256"]:
            sys.exit(f"{c['name']}: rebuilt clip differs from the prototype's ({c['sha256']} vs {theirs})")
        g = os.path.join(A.proto_data, c["name"] + ".f0grid.f32")
        shutil.copyfile(g, os.path.join(OUT16, c["name"] + ".protogrid.f32"))
        c["protogrid_sha256"] = sha(g)
    print("proto16: all 8 clips bit-identical to the prototype's; stored F0 grids copied")
with open(os.path.join(OUT16, "clips.json"), "w", encoding="utf8") as f:
    json.dump(clips, f, indent=1)
for c in clips:
    print(c["name"], c["sex"], f"{c['dur']:.3f}s", c["src"], c["note"])

# ---------------------------------------------------------------- timing set (48 kHz)
timing = []
for sub, who, sex in [("MALE", "M01", "m"), ("MALE", "M02", "m"), ("FEMALE", "F01", "f"), ("FEMALE", "F02", "f")]:
    files = sorted(glob.glob(os.path.join(PTDB, sub, "MIC", who, f"mic_{who}_sx*.wav")), key=lambda q: os.path.basename(q))
    parts, used, total = [], [], 0
    for q in files:
        y, sr = sf.read(q, dtype="float64")
        assert sr == 48000 and y.ndim == 1
        parts.append(y)
        used.append(dict(file=os.path.basename(q), samples=len(y)))
        total += len(y)
        if total >= 8.0 * 48000:
            break
    full = np.concatenate(parts)
    rec = dict(name=who, sex=sex, sr=48000, files=used, lengths={})
    for L in (3, 5, 8):
        fn = f"{who}_{L}s.f32"
        np.asarray(full[:int(L * 48000)], np.float32).tofile(os.path.join(OUT48, fn))
        rec["lengths"][str(L)] = dict(pcm=fn, samples=int(L * 48000), sha256=sha(os.path.join(OUT48, fn)))
    timing.append(rec)
    print(who, sex, [u["file"] for u in used], f"{total / 48000:.2f} s joined")
with open(os.path.join(OUT48, "index.json"), "w", encoding="utf8") as f:
    json.dump(dict(clips=timing), f, indent=1)
