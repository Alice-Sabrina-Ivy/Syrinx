"""prep.py — data for the Voice Shaper noise study (measurements/voice-shaper-noise-2026-10-25.md).

Reads the downloaded public archives (never executes anything from them) and writes, under OUT:
  speech/<set>/<id>.f32   mono float32 at the capture rate (48 kHz; vocadito 44.1 kHz), the clip's
                          own leading / trailing silence trimmed to 0.15 s
  noise/<set>/<id>.f32    mono float32 at 48 kHz (44.1 kHz copies for vocadito mixes: *_44k.f32),
                          at least 20 s (shorter sources looped with a 50 ms crossfade)
  manifest.json           every item with set, sex, speaker, class, source, rate, seconds

Run with the study venv, isolated:  python -I prep.py <dl dir> <vocadito dir> <out dir>
"""
import io
import json
import random
import sys
import zipfile
from pathlib import Path

import numpy as np
import soundfile as sf
from scipy.signal import resample_poly

DL, VOC, OUT = (Path(a) for a in sys.argv[1:4])
rng = random.Random(20261025)
SR = 48000


def mono(x):
    return x if x.ndim == 1 else x[:, 0]


def to_rate(x, sr, r):
    if sr == r:
        return x.astype(np.float32)
    from math import gcd
    g = gcd(sr, r)
    return resample_poly(x, r // g, sr // g).astype(np.float32)


def trim(x, sr, margin=0.15, floor_db=-40):
    f = int(0.02 * sr)
    n = len(x) // f
    e = np.sqrt(np.mean(x[: n * f].reshape(n, f) ** 2, axis=1) + 1e-20)
    on = np.nonzero(20 * np.log10(e / e.max()) > floor_db)[0]
    a = max(0, on[0] * f - int(margin * sr))
    b = min(len(x), (on[-1] + 1) * f + int(margin * sr))
    return x[a:b]


manifest = {"speech": [], "noise": []}


def put_speech(set_, id_, x, sr, sex, speaker, source):
    x = trim(x, sr)
    dur = len(x) / sr
    if not (2.0 <= dur <= 6.5):
        return False
    p = OUT / "speech" / set_ / f"{id_}.f32"
    p.parent.mkdir(parents=True, exist_ok=True)
    x.astype("<f4").tofile(p)
    manifest["speech"].append({"set": set_, "id": id_, "sex": sex, "speaker": speaker, "source": source,
                               "rate": sr, "seconds": round(dur, 3), "path": str(p.relative_to(OUT))})
    return True


def slr83(zipname, set_, sex, n):
    z = zipfile.ZipFile(DL / "slr83" / zipname)
    names = sorted(m for m in z.namelist() if m.endswith(".wav"))
    by_spk = {}
    for m in names:
        by_spk.setdefault(m.split("_")[1], []).append(m)
    for v in by_spk.values():
        rng.shuffle(v)
    spk = sorted(by_spk)
    got, i = 0, 0
    while got < n and any(by_spk.values()):
        s = spk[i % len(spk)]
        i += 1
        if not by_spk[s]:
            continue
        m = by_spk[s].pop()
        x, sr = sf.read(io.BytesIO(z.read(m)), dtype="float32")
        if put_speech(set_, Path(m).stem, to_rate(mono(x), sr, SR), SR, sex, f"{zipname[:3]}{s}", "openslr83"):
            got += 1
    print(set_, zipname, got, "clips from", len(spk), "speakers")


slr83("midlands_english_female.zip", "dev", "f", 30)
slr83("midlands_english_male.zip", "dev", "m", 30)
slr83("northern_english_female.zip", "test", "f", 30)
slr83("irish_english_male.zip", "test", "m", 30)

# RAVDESS speech: modality 03, channel 01, emotion 01 neutral / 02 calm, intensity 01 normal;
# two clips per actor (one per statement), odd actor = male.
z = zipfile.ZipFile(DL / "ravdess" / "Audio_Speech_Actors_01-24.zip")
rav = {}
for m in z.namelist():
    if not m.endswith(".wav"):
        continue
    f = Path(m).stem.split("-")
    if f[2] in ("01", "02") and f[3] == "01":
        rav.setdefault((int(f[6]), f[4]), []).append(m)
for (actor, stmt), ms in sorted(rav.items()):
    m = rng.choice(sorted(ms))
    x, sr = sf.read(io.BytesIO(z.read(m)), dtype="float32")
    put_speech("test", f"rav{actor:02d}_{Path(m).stem}", to_rate(mono(x), sr, SR), SR,
               "m" if actor % 2 else "f", f"rav{actor:02d}", "ravdess")
print("test ravdess", sum(1 for s in manifest["speech"] if s["source"] == "ravdess"))

# vocadito (44.1 kHz, sung): the middle 6 s of each track, kept at 44.1 kHz.
for p in sorted((VOC / "Audio").glob("vocadito_*.wav")):
    x, sr = sf.read(p, dtype="float32")
    x = mono(x)
    mid = len(x) // 2
    seg = x[max(0, mid - 3 * sr): mid + 3 * sr]
    q = OUT / "speech" / "sung" / f"{p.stem}.f32"
    q.parent.mkdir(parents=True, exist_ok=True)
    seg.astype("<f4").tofile(q)
    manifest["speech"].append({"set": "sung", "id": p.stem, "sex": "u", "speaker": p.stem, "source": "vocadito",
                               "rate": sr, "seconds": round(len(seg) / sr, 3), "path": str(q.relative_to(OUT))})
print("sung vocadito", sum(1 for s in manifest["speech"] if s["set"] == "sung"))


def loop_to(x, sr, secs=20.0):
    need = int(secs * sr)
    if len(x) >= need:
        return x
    xf = int(0.05 * sr)
    out = x.copy()
    ramp = np.linspace(0, 1, xf, dtype=np.float32)
    while len(out) < need:
        out = np.concatenate([out[:-xf], out[-xf:] * (1 - ramp) + x[:xf] * ramp, x[xf:]])
    return out


def put_noise(set_, cls, id_, x, sr, source):
    if np.sqrt(np.mean(x ** 2)) < 1e-5:
        return
    x48 = loop_to(to_rate(x, sr, SR), SR)
    p = OUT / "noise" / set_ / f"{id_}.f32"
    p.parent.mkdir(parents=True, exist_ok=True)
    x48.astype("<f4").tofile(p)
    x44 = to_rate(x48, SR, 44100)
    x44.astype("<f4").tofile(p.with_name(f"{id_}_44k.f32"))
    manifest["noise"].append({"set": set_, "class": cls, "id": id_, "source": source, "srcRate": sr,
                              "seconds": round(len(x48) / SR, 2), "path": str(p.relative_to(OUT))})


DEMAND = {"dev": ["DLIVING", "DKITCHEN", "DWASHING", "OOFFICE", "STRAFFIC", "PCAFETER"],
          "test": ["OMEETING", "PRESTO", "TCAR", "NPARK", "OHALLWAY"]}
for set_, envs in DEMAND.items():
    for e in envs:
        z = zipfile.ZipFile(DL / "demand" / f"{e}_48k.zip")
        ch = [m for m in z.namelist() if m.lower().endswith("ch01.wav")][0]
        x, sr = sf.read(io.BytesIO(z.read(ch)), dtype="float32")
        x = mono(x)
        # four 60 s pieces per environment, each its own noise item
        for k in range(4):
            put_noise(set_, f"demand-{e}", f"{e}_{k}", x[k * 60 * sr:(k + 1) * 60 * sr], sr, "demand")

# MS-SNSD: home / appliance / talk classes only (its outdoor and room classes overlap DEMAND).
KEEP = ["AirConditioner", "CopyMachine", "Munching", "NeighborSpeaking", "ShuttingDoor", "SqueakyChair",
        "Typing", "VacuumCleaner", "WasherDryer", "Babble", "AirportAnnouncements"]
for set_, part in (("dev", "noise_train"), ("test", "noise_test")):
    for p in sorted((DL / "mssnsd" / part).glob("*.wav")):
        cls = p.stem.rsplit("_", 1)[0]
        if cls not in KEEP:
            continue
        x, sr = sf.read(p, dtype="float32")
        put_noise(set_, f"mssnsd-{cls}", f"ms_{p.stem}", mono(x), sr, "ms-snsd")

(OUT / "manifest.json").write_text(json.dumps(manifest, indent=1))
for set_ in ("dev", "test"):
    cl = sorted({n["class"] for n in manifest["noise"] if n["set"] == set_})
    print(set_, "noise items", sum(1 for n in manifest["noise"] if n["set"] == set_), "classes", len(cl))
