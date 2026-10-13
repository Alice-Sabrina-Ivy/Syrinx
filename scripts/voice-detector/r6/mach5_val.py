# mach5_val.py — custom voice detector, round 6 (pre-registration §2.2): the
# VALIDATION-ONLY machine beds of the round-5 voice-safety review (two
# beating fans, aquarium pump, microwave, car idle, washer, lamp ballast; the
# round-4 review's unseen Freesound clips `fsnew` as real beds), ported
# UNCHANGED from the review's mach5.py (sha256
# e11e766a7d244b5e109f464a8f71bb469014e6b6dfa4a35967855c691f9e3703; output
# digests pinned in selftest_r6.py). Only this header differs.
#
# NEVER used for training: r6/selftest_r6.py fails if any training or packing
# script imports this module. Reads Freesound previews: run with `python -I`.
#
# ---------------------------------------------------------------- mach5.py (round-5 review), verbatim below
# mach5.py — round-5 voice-safety review: machine beds NOT in beds.py / beds4.py
# / synth_r4.py / vbeds.py families as written (new kinds, parameters fixed
# here), several with lines inside the men's 80-130 Hz humming range, plus the
# round-4 review's 20 unseen CC0/CC BY Freesound steady clips (fsnew, never in
# any round's training or selection) as real beds. Unit RMS.
import glob, os
import numpy as np
import soundfile as sf
from scipy.signal import butter, sosfilt, resample_poly
from math import gcd

FSNEW = "C:/Coding Projects/Syrinx-vad/build/vad-train/review-r4/fsnew/audio"
SYN = ["twofan", "aqpump", "microwave", "caridle", "washer", "ballast"]


def _pink(rng, n):
    from scipy.signal import lfilter
    return lfilter([0.049922035, -0.095993537, 0.050612699, -0.004408786], [1, -2.494956002, 2.017265875, -0.522189400], rng.standard_normal(n))


def _ou(rng, n, sr, cents, tau):
    from scipy.signal import lfilter
    a = np.exp(-1.0 / (tau * sr))
    y = lfilter([1.0], [1.0, -a], rng.standard_normal(n) * np.sqrt(1 - a * a))
    return 2 ** (cents * y / 1200)


def _stack(f, amps, sr, rng):
    ph = 2 * np.pi * np.cumsum(f) / sr
    x = np.zeros(len(f))
    for k, a in enumerate(amps):
        if (k + 1) * f.mean() < 0.45 * sr:
            x += a * np.sin((k + 1) * ph + rng.uniform(0, 6.28))
    return x


def _u(x):
    return (x / np.sqrt(np.mean(x ** 2))).astype(np.float64)


def _bp(x, lo, hi, sr):
    return sosfilt(butter(2, [lo, min(hi, 0.45 * sr)], "bandpass", fs=sr, output="sos"), x)


def synbed(kind, sr, dur, seed=0):
    rng = np.random.default_rng(seed)
    n = int(sr * dur)
    t = np.arange(n) / sr
    if kind == "twofan":       # two PC / server fans, blade pass 104 and 107.5 Hz (beating), + airflow
        h1 = _stack(104.0 * _ou(rng, n, sr, 2, 1.0), [1, .45, .25, .12], sr, rng)
        h2 = _stack(107.5 * _ou(rng, n, sr, 2, 1.0), [1, .4, .2, .1], sr, rng)
        air = _bp(_pink(rng, n), 200, 6000, sr)
        x = 0.6 * _u(h1) + 0.5 * _u(h2) + _u(air)
    elif kind == "aqpump":     # aquarium air pump: 100 Hz diaphragm buzz (rich, rattly) + soft bubbling
        f = np.full(n, 100.0) * _ou(rng, n, sr, 1, 2.0)
        h = _stack(f, [1 / (k + 1) ** 0.7 for k in range(30)], sr, rng)
        h = np.tanh(1.5 * h / h.std())
        bub = np.zeros(n)
        for s in rng.uniform(0, dur, int(4 * dur)):
            a = int(s * sr); m = min(n - a, int(0.02 * sr))
            bub[a:a + m] += rng.standard_normal(m) * np.hanning(m)
        x = _u(h) + 0.25 * _u(_bp(bub, 300, 3000, sr) + 1e-9)
    elif kind == "microwave":  # 60 Hz mains magnetron transformer: 120 Hz buzz + 60 Hz + cooling fan
        h = _stack(np.full(n, 60.0), [.4, 1, .3, .6, .2, .35, .15, .2, .1, .1], sr, rng)
        fan = _bp(_pink(rng, n), 150, 5000, sr)
        x = _u(h) + 0.8 * _u(fan)
    elif kind == "caridle":    # 4-cylinder idle ~780 rpm: firing 26 Hz, cycle-to-cycle irregularity, 2nd/4th emphasis, cabin rumble
        f = 26.0 * _ou(rng, n, sr, 25, 0.15)
        h = _stack(f, [.5, 1, .4, .8, .3, .4, .2, .25, .1, .1, .05, .05], sr, rng)
        rum = sosfilt(butter(2, 150, "lowpass", fs=sr, output="sos"), _pink(rng, n))
        x = _u(h) + 0.7 * _u(rum)
    elif kind == "washer":     # washing machine wash cycle: motor whine 88 Hz + drum AM 0.6 Hz + water swish
        h = _stack(88.0 * _ou(rng, n, sr, 6, 0.5), [1, .5, .3, .2, .1], sr, rng)
        am = 1 - 0.3 * (0.5 + 0.5 * np.sin(2 * np.pi * 0.6 * t))
        sw = _bp(rng.standard_normal(n), 300, 2000, sr) * (1 - 0.6 * (0.5 + 0.5 * np.sin(2 * np.pi * 0.6 * t + 1.0)))
        x = _u(h) * am + 0.8 * _u(sw)
    elif kind == "ballast":    # magnetic ballast / buzzing lamp: 120 Hz, near-square harmonic series to 4 kHz
        h = _stack(np.full(n, 120.0), [1 / (k + 1) ** 0.5 for k in range(33)], sr, rng)
        x = _u(h) + 0.1 * _u(_pink(rng, n))
    else:
        raise ValueError(kind)
    return _u(x)


_FS = {}


def fsnew_ids():
    return sorted(os.path.basename(p).split("_")[0] for p in glob.glob(FSNEW + "/*.ogg"))


def realbed(fid, sr, dur, seed=0):
    if fid not in _FS:
        p = glob.glob(f"{FSNEW}/{fid}_*.ogg")[0]
        x, s0 = sf.read(p, dtype="float64", always_2d=True)
        _FS[fid] = (x.mean(axis=1), s0)
    x, s0 = _FS[fid]
    if s0 != sr:
        g = gcd(s0, sr)
        x = resample_poly(x, sr // g, s0 // g)
    n = int(sr * dur)
    rng = np.random.default_rng(seed)
    off = int(rng.integers(0, max(1, len(x) - 1)))
    x = np.roll(x, -off)
    cf = int(sr)
    out = x.copy()
    while len(out) < n:
        r = np.linspace(0, 1, cf)
        out = np.concatenate([out[:-cf], out[-cf:] * (1 - r) + x[:cf] * r, x[cf:]])
    return _u(out[:n])


def bed(name, sr, dur, seed=0):
    return synbed(name, sr, dur, seed) if name in SYN else realbed(name, sr, dur, seed)
