"""make_conditions.py - hum and noise condition clips for the voice-preview spike (§P7 of
measurements/voice-preview-spike-2026-10-12.md). Synthetic additions to public clips.

  python -I make_conditions.py [--ptdb DIR]

Base clips (16 kHz, clips/proto16): ls_m2, pt_m1 (men), ls_f1, pt_f1 (women). Conditions:
clean; mains hum at 50 and 60 Hz, each at -40, -30 and -20 dB; pink noise at +20 and +10 dB SNR.
  hum   sum_{k=1..6} (1/k) sin(2 pi k f t + phi_k), phi_k = numpy default_rng(2).uniform(0, 2 pi, 6),
        continuous over the clip (and over its 10 s pre-roll, t from -10 s); RMS = clean RMS * 10^(level/20)
  pink  the prototype's recipe (default_rng(1) white noise + 4096, 1/f power by FFT shaping, first
        len(x) samples), scaled to the SNR re the clean clip RMS; the pre-roll is the same recipe with
        default_rng(3), scaled by the same factor
Each condition also gets a 10 s pre-roll of the hum or noise alone (for the "live" run of the tonal-noise
detector, as if the app had been listening before the recording; zeros for clean).
Spot check at 24 kHz: pt_m1 / pt_f1 rebuilt from their 48 kHz PTDB-TUG sources, clean and 60 Hz hum at -20 dB.
Writes <VP_CACHE>/hum/clips/<name>.f32 (+ .pre.f32) and index.json. Nothing inside the repository.
"""
import argparse, json, os, site, sys

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

OUT = os.path.join(CACHE, "hum", "clips")
os.makedirs(OUT, exist_ok=True)
PRE = 10.0
PHI = np.random.default_rng(2).uniform(0, 2 * np.pi, 6)


def rms(x):
    return float(np.sqrt(np.mean(np.asarray(x, np.float64) ** 2)))


def hum(n_pre, n, sr, f, level_db, ref_rms):
    t = (np.arange(-n_pre, n) / sr).astype(np.float64)
    h = sum((1.0 / k) * np.sin(2 * np.pi * k * f * t + PHI[k - 1]) for k in range(1, 7))
    h *= ref_rms * 10 ** (level_db / 20) / rms(h[n_pre:])
    return h[:n_pre], h[n_pre:]


def pink(n, sr, seed):
    rng = np.random.default_rng(seed)
    w = rng.standard_normal(n + 4096)
    W = np.fft.rfft(w)
    fr = np.fft.rfftfreq(len(w), 1 / sr)
    W[1:] /= np.sqrt(fr[1:])
    W[0] = 0
    return np.fft.irfft(W, len(w))[:n]


def conditions(x, sr):
    """yield (cond name, noisy clip, pre-roll, info)"""
    n, r0 = len(x), rms(x)
    npre = int(PRE * sr)
    yield "clean", x, np.zeros(npre), dict(kind="clean")
    for f in (50, 60):
        for lv in (-40, -30, -20):
            pre, h = hum(npre, n, sr, f, lv, r0)
            yield f"hum{f}_m{-lv}", x + h, pre, dict(kind="hum", mains=f, level_db=lv)
    for snr in (20, 10):
        nz = pink(n, sr, 1)
        k = r0 / rms(nz) / 10 ** (snr / 20)
        yield f"pink_p{snr}", x + nz * k, pink(npre, sr, 3) * k, dict(kind="pink", snr_db=snr)


index = []
proto = {c["name"]: c for c in json.load(open(os.path.join(CACHE, "clips", "proto16", "clips.json"), encoding="utf8"))}
for base in ("ls_m2", "pt_m1", "ls_f1", "pt_f1"):
    x = np.fromfile(os.path.join(CACHE, "clips", "proto16", base + ".f32"), np.float32).astype(np.float64)
    for cond, y, pre, info in conditions(x, 16000):
        nm = f"{base}__{cond}"
        np.asarray(y, np.float32).tofile(os.path.join(OUT, nm + ".f32"))
        np.asarray(pre, np.float32).tofile(os.path.join(OUT, nm + ".pre.f32"))
        peak = float(np.max(np.abs(y)))
        index.append(dict(name=nm, base=base, sex=proto[base]["sex"], cond=cond, sr=16000, n=len(y), peak=peak, **info))
# the natural-hum clip, as it is (no pre-roll: there is no hum-alone source)
x = np.fromfile(os.path.join(CACHE, "clips", "proto16", "ls_m1.f32"), np.float32)
x.tofile(os.path.join(OUT, "ls_m1__natural.f32"))
index.append(dict(name="ls_m1__natural", base="ls_m1", sex="m", cond="natural", sr=16000, n=len(x), kind="natural"))
# the 24 kHz spot check: 48 kHz sources, clean and 60 Hz hum at -20 dB
for base, sub, who in (("pt_m1", "MALE", "M01"), ("pt_f1", "FEMALE", "F01")):
    src = proto[base]["src"].split()[1]
    x, sr = sf.read(os.path.join(PTDB, sub, "MIC", who, src), dtype="float64")
    assert sr == 48000 and x.ndim == 1
    npre = int(PRE * sr)
    pre, h = hum(npre, len(x), sr, 60, -20, rms(x))
    for cond, y, p in (("clean", x, np.zeros(npre)), ("hum60_m20", x + h, pre)):
        nm = f"{base}48__{cond}"
        np.asarray(y, np.float32).tofile(os.path.join(OUT, nm + ".f32"))
        np.asarray(p, np.float32).tofile(os.path.join(OUT, nm + ".pre.f32"))
        index.append(dict(name=nm, base=base, sex=proto[base]["sex"], cond=cond, sr=48000, n=len(y),
                          kind="clean" if cond == "clean" else "hum", mains=60 if cond != "clean" else None,
                          level_db=-20 if cond != "clean" else None, spot24k=True))
with open(os.path.join(OUT, "index.json"), "w", encoding="utf8") as f:
    json.dump(dict(phi=PHI.tolist(), pre_s=PRE, clips=index), f, indent=1)
print(f"{len(index)} clips; max peak {max(c.get('peak', 0) for c in index):.3f}")
