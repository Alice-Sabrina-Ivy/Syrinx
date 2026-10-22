"""Apply the robustness study's conditions (+ one narrowband one) and extract the
narrowband detector's band energies on the real resonance path.

measurements/resonance-narrowband-2026-10-19.md §3. Copied from
scripts/resonance-robustness/run_all.py at 99ff7fc: levelling, every condition and
its realisation (seeds, noise segments, room responses, ffmpeg arguments) are
unchanged; added the narrowband-Bluetooth-like condition "btnb", the dev /
held-out speaker split, a version subset option, and extract.mjs instead of
run_cue.mjs (one Node process per job, all versions in it). Lab venv, -I:
  PY -I scripts/resonance-narrowband/conditions.py --cache <Syrinx-cache/resonance-robustness>
        --half dev|held [--conds all|clean,hp100,...] [--versions all|k088,k100,k112] [--workers 2] [--r3]
--r3 (round 3): extract.mjs --subbands, output under build/resonance-narrowband/feat3/.

Per (condition, speaker) job: the speaker's 5 WORLD versions (+ the clean
original on "clean") are levelled to -26 dBFS active speech level, put through
the condition (identical realisation for every version: same noise segment, same
room response), written as float32 temp files and run through extract.mjs.
Output: build/resonance-narrowband/feat/<cond>/<spk>.{f64,json}.

Order inside a combination is physical: room -> noise -> device filters -> input
level -> gain control -> codec. Noise RMS over the stream = -26 dBFS - SNR (speech
is at -26 dBFS active level at that point in every condition).
"""
import argparse
import json
import os
import subprocess
import sys
import tempfile
import time
import zlib
from multiprocessing import Pool

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.dirname(os.path.dirname(HERE))
import site  # noqa: E402
sys.path.append(site.getusersitepackages())  # -I turns the user site off; numpy / scipy live there

import numpy as np  # noqa: E402
from scipy.signal import butter, sosfilt, firwin2, fftconvolve, resample_poly  # noqa: E402
import soundfile as sf  # noqa: E402

OUT = os.path.join(REPO, "build", "resonance-narrowband")
S48 = os.path.join(OUT, "streams48")
FEAT = os.path.join(OUT, "feat")
FEAT3 = os.path.join(OUT, "feat3")  # round 3: sub-band powers
SR = 48000
TARGET_DB = -26.0
VERSIONS = ["k088", "k094", "k100", "k106", "k112"]
POSITIVE = ["tel", "amrnb", "g711u", "opus8nb", "lp4k", "btnb"]  # narrowband (plan §3)
CACHE = None
FFMPEG = "ffmpeg"


# ------------------------------------------------------------------ levels
def active_db(x, sr=SR):
    """RMS (dBFS) over 30 ms frames whose energy is within 30 dB of the peak frame."""
    n = int(0.03 * sr)
    m = len(x) // n
    e = np.mean(np.asarray(x[: m * n], np.float64).reshape(m, n) ** 2, axis=1)
    e = e[e > 0]
    keep = e[10 * np.log10(e) >= 10 * np.log10(e.max()) - 30]
    return 10 * np.log10(np.mean(keep))


def level_to(x, db=TARGET_DB, limit=True):
    g = 10 ** ((db - active_db(x)) / 20)
    y = x * g
    pk = np.max(np.abs(y))
    lim = 10 ** (-1 / 20)
    limited = bool(limit and pk > lim)
    if limited:
        y = y * (lim / pk)
    return y, limited


CUT48 = {}  # speaker -> 48 kHz samples at the 40 s cut (plan §7 budget switch; see the note's Deviations)


def load_stream(spk, ver):
    x = np.fromfile(os.path.join(S48, f"{spk}_{ver}.f32"), np.float32).astype(np.float64)
    return level_to(x[: CUT48[spk]])


# ------------------------------------------------------------------ device
def hp(fc):
    sos = butter(4, fc, "highpass", fs=SR, output="sos")
    return lambda x, ctx: sosfilt(sos, x)


def lp(fc):
    sos = butter(8, fc, "lowpass", fs=SR, output="sos")
    return lambda x, ctx: sosfilt(sos, x)


def tilt(db_per_oct):
    f = np.linspace(0, SR / 2, 4097)
    fc = np.clip(f, 100, 8000)
    g = 10 ** (db_per_oct * np.log2(fc / 1000) / 20)
    h = firwin2(2049, f, g, fs=SR)

    def apply(x, ctx):
        return fftconvolve(x, h)[1024: 1024 + len(x)]
    return apply


def band_through(rate, lo, hi):
    """Resample to `rate`, 4th-order Butterworth band-pass lo-hi, back to 48 kHz."""
    sos = butter(4, [lo, hi], "bandpass", fs=rate, output="sos")
    d = SR // rate

    def apply(x, ctx):
        y = sosfilt(sos, resample_poly(x, 1, d))
        return resample_poly(y, d, 1)[: len(x)]
    return apply


# ------------------------------------------------------------------ codecs / gain (ffmpeg)
def ffmpeg_roundtrip(x, enc_args, ext, tmpdir):
    src = os.path.join(tmpdir, "in.wav")
    mid = os.path.join(tmpdir, f"mid.{ext}")
    sf.write(src, x.astype(np.float32), SR, subtype="FLOAT")
    q = ["-hide_banner", "-loglevel", "error", "-y"]
    subprocess.run([FFMPEG, *q, "-i", src, *enc_args, mid], check=True)
    r = subprocess.run([FFMPEG, *q, "-i", mid, "-ac", "1", "-ar", str(SR), "-f", "f32le", "-"], check=True,
                       capture_output=True)
    y = np.frombuffer(r.stdout, np.float32).astype(np.float64)
    return y[: len(x)] if len(y) >= len(x) else np.pad(y, (0, len(x) - len(y)))


def codec(enc_args, ext):
    return lambda x, ctx: ffmpeg_roundtrip(x, enc_args, ext, ctx["tmp"])


def ffilter(af, renorm=False):
    def apply(x, ctx):
        y = ffmpeg_roundtrip(x, ["-af", af, "-c:a", "pcm_f32le"], "wav", ctx["tmp"])
        return level_to(y, limit=False)[0] if renorm else y
    return apply


CODECS = {
    "opus24wb": codec(["-c:a", "libopus", "-b:a", "24k", "-application", "voip", "-cutoff", "8000"], "ogg"),
    "opus12wb": codec(["-c:a", "libopus", "-b:a", "12k", "-application", "voip", "-cutoff", "8000"], "ogg"),
    "opus8nb": codec(["-c:a", "libopus", "-b:a", "8k", "-application", "voip", "-cutoff", "4000"], "ogg"),
    "amrwb": codec(["-ar", "16000", "-c:a", "libvo_amrwbenc", "-b:a", "12.65k"], "amr"),
    "amrnb": codec(["-ar", "8000", "-c:a", "libopencore_amrnb", "-b:a", "7.4k"], "amr"),
    "msbc": codec(["-ar", "16000", "-c:a", "sbc", "-msbc", "1", "-f", "sbc"], "sbc"),
    "g711u": codec(["-ar", "8000", "-c:a", "pcm_mulaw"], "wav"),
}
GAIN = {
    "comp": ffilter("acompressor=threshold=0.031623:ratio=4:attack=5:release=100", renorm=True),
    "agcfast": ffilter("dynaudnorm=f=150:g=5"),
    "agcslow": ffilter("dynaudnorm=f=500:g=31"),
}


# ------------------------------------------------------------------ rooms / noise / level
_RIRS = None


def rirs():
    global _RIRS
    if _RIRS is None:
        _RIRS = json.load(open(os.path.join(OUT, "rirs.json")))
    return _RIRS


def room(bin_name):
    def apply(x, ctx):
        r = rirs()["chosen"][bin_name][ctx["sex_index"] % 3]
        h, hsr = sf.read(os.path.join(CACHE, r["path"]), dtype="float64", always_2d=True)
        h = h[:, 0]
        if hsr != SR:
            from math import gcd
            g = gcd(SR, hsr)
            h = resample_poly(h, SR // g, hsr // g)
        h = h[max(0, int(np.argmax(np.abs(h))) - int(0.001 * SR)):]   # start ~1 ms before the direct path
        y = fftconvolve(x, h)[: len(x)]
        return level_to(y, limit=False)[0]
    return apply


_NOISE = {}


def noise_src(kind):
    if kind not in _NOISE:
        if kind == "street":
            n, nsr = sf.read(os.path.join(CACHE, "demand", "STRAFFIC", "ch01.wav"), dtype="float64")
            assert nsr == SR
        else:
            n = np.fromfile(os.path.join(S48, f"_{kind}.f32"), np.float32).astype(np.float64)
        _NOISE[kind] = n
    return _NOISE[kind]


def noise(kind, snr):
    def apply(x, ctx):
        src = noise_src(kind)
        rng = np.random.default_rng(zlib.crc32(f"{ctx['spk']}|{kind}".encode()))
        if len(src) < len(x) + 1:
            src = np.tile(src, int(np.ceil((len(x) + 1) / len(src))) + 1)
        s0 = int(rng.integers(0, len(src) - len(x)))
        seg = src[s0: s0 + len(x)]
        seg = seg / np.sqrt(np.mean(seg ** 2)) * 10 ** ((TARGET_DB - snr) / 20)
        return x + seg
    return apply


def gain_db(db, clip=False):
    def apply(x, ctx):
        y = x * 10 ** (db / 20)
        return np.clip(y, -1, 1) if clip else y
    return apply


def nb8k(x, ctx):
    """48 -> 8 -> 48 kHz (scipy resample_poly), the narrowband link of "btnb"."""
    return resample_poly(resample_poly(x, 1, 6), 6, 1)[: len(x)]


def chain(*fs):
    def apply(x, ctx):
        for f in fs:
            x = f(x, ctx)
        return x
    return apply


CONDS = {
    "clean": ("clean", chain()),
    "hp100": ("device", hp(100)), "hp200": ("device", hp(200)), "hp300": ("device", hp(300)),
    "lp4k": ("device", lp(4000)), "lp7k": ("device", lp(7000)),
    "tilt+6": ("device", tilt(6)), "tilt-6": ("device", tilt(-6)),
    "tel": ("device", band_through(8000, 300, 3400)), "wb": ("device", band_through(16000, 100, 7000)),
    **{k: ("codec", f) for k, f in CODECS.items()},
    **{k: ("gain", f) for k, f in GAIN.items()},
    "room_s": ("room", room("short")), "room_m": ("room", room("mid")), "room_l": ("room", room("long")),
    **{f"{k}{s:+d}": ("noise", noise(k, s)) for k in ("babble", "fan", "street") for s in (20, 10)},
    "lev-20": ("level", gain_db(-20)), "lev-10": ("level", gain_db(-10)), "lev+20clip": ("level", gain_db(20, clip=True)),
    "sr44k": ("rate", chain()),
    "laptop": ("combo", chain(room("mid"), noise("fan", 20), hp(200), tilt(6), GAIN["agcfast"])),
    "headset": ("combo", chain(room("short"), noise("babble", 20), hp(100), tilt(-6))),
    "bt": ("combo", chain(noise("babble", 20), GAIN["comp"], CODECS["msbc"])),
    "phone": ("combo", chain(room("long"), noise("street", 10), hp(300), gain_db(-20))),
    "videocall": ("combo", chain(room("mid"), noise("babble", 10), GAIN["agcslow"], CODECS["opus12wb"])),
    # new (plan §3): the Bluetooth headset combination with mSBC replaced by an 8 kHz path
    "btnb": ("combo", chain(noise("babble", 20), GAIN["comp"], nb8k)),
}


def run_extract(items, sr, out_f64, r3=False):
    cmd = (["node", os.path.join(HERE, "extract.mjs"), out_f64, str(sr)] + (["--subbands"] if r3 else [])
           + [f"{n}={p}" for n, p in items])
    r = subprocess.run(cmd, check=True, capture_output=True, text=True, cwd=REPO)
    return json.loads(r.stdout)


def job(args):
    cond, spk, sex, sex_index, versions, r3 = args
    feat = FEAT3 if r3 else FEAT
    out = os.path.join(feat, cond, f"{spk}.json")
    if os.path.exists(out):
        return cond, spk, None
    cls, f = CONDS[cond]
    sr = 44100 if cond == "sr44k" else SR
    rec = dict(cond=cond, cls=cls, positive=cond in POSITIVE, spk=spk, sex=sex, sr=sr, versions={})
    os.makedirs(os.path.join(feat, cond), exist_ok=True)
    t0 = time.time()
    with tempfile.TemporaryDirectory(dir=os.path.join(OUT, "tmp")) as tmp:
        ctx = dict(spk=spk, sex=sex, sex_index=sex_index, tmp=tmp)
        items = []
        py_cpu = 0.0
        for ver in (["orig"] if cond == "clean" else []) + versions:
            c0 = time.process_time()
            x, limited = load_stream(spk, ver)
            y = f(x, ctx)
            if sr != SR:
                y = resample_poly(y, 147, 160)
            py_cpu += time.process_time() - c0
            p = os.path.join(tmp, f"{ver}.f32")
            np.asarray(y, np.float32).tofile(p)
            items.append((ver, p))
            rec["versions"][ver] = dict(peak_limited=limited, out_peak=float(np.max(np.abs(y))))
        res = run_extract(items, sr, os.path.join(feat, cond, f"{spk}.f64"), r3)
    for m in res["streams"]:
        rec["versions"][m["name"]].update(m)
    rec.update(order=[n for n, _ in items], py_cpu_s=round(py_cpu, 3), node_cpu_ms=res["cpuMs"],
               wall_s=round(time.time() - t0, 2))
    with open(out + ".part", "w") as fh:
        json.dump(rec, fh)
    os.replace(out + ".part", out)
    return cond, spk, rec["wall_s"]


def split(streams):
    """Within each sex, readers sorted by numeric LibriSpeech id; even ranks (0, 2, ...) = dev."""
    half = {}
    for sx in ("f", "m"):
        for i, s in enumerate(sorted((s for s in streams if s["sex"] == sx), key=lambda s: int(s["speaker"][2:]))):
            half[s["speaker"]] = "dev" if i % 2 == 0 else "held"
    return half


def main():
    global CACHE
    ap = argparse.ArgumentParser()
    ap.add_argument("--cache", required=True)
    ap.add_argument("--half", required=True, choices=["dev", "held"])
    ap.add_argument("--conds", default="all")
    ap.add_argument("--versions", default="all")
    ap.add_argument("--workers", type=int, default=2)
    ap.add_argument("--r3", action="store_true")
    a = ap.parse_args()
    CACHE = a.cache
    os.makedirs(os.path.join(OUT, "tmp"), exist_ok=True)
    streams = json.load(open(os.path.join(OUT, "streams.json")))["streams"]
    idx = {}  # room-response assignment exactly as the robustness study (string order within sex)
    for sx in ("f", "m"):
        for i, s in enumerate(sorted((s for s in streams if s["sex"] == sx), key=lambda s: s["speaker"])):
            idx[s["speaker"]] = i
    half = split(streams)
    versions = VERSIONS if a.versions == "all" else a.versions.split(",")
    conds = list(CONDS) if a.conds == "all" else a.conds.split(",")
    jobs = [(c, s["speaker"], s["sex"], idx[s["speaker"]], versions, a.r3) for c in conds for s in streams
            if half[s["speaker"]] == a.half]
    t0 = time.time()
    with Pool(a.workers, initializer=_init, initargs=(CACHE,)) as p:
        for i, (c, spk, w) in enumerate(p.imap(job, jobs)):
            el = time.time() - t0
            print(f"{i + 1}/{len(jobs)} {c} {spk} {'skip' if w is None else f'{w:.1f} s'} "
                  f"(elapsed {el / 60:.1f} min)", flush=True)


def _init(cache):
    global CACHE
    CACHE = cache
    for s in json.load(open(os.path.join(OUT, "streams.json")))["streams"]:
        CUT48[s["speaker"]] = 3 * s["n16_40"]


if __name__ == "__main__":
    main()
