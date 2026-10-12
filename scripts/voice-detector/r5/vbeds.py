# vbeds.py — custom voice detector, round 5 (pre-registration §2.1): the
# VALIDATION-ONLY synthetic machine beds of the H1 / H2 rows, ported UNCHANGED
# from the round-3 voice-safety review (beds.py: fan, mains, fridge, hvac,
# vmotor, room; its bed() is kept as bed3) and the round-4 review (beds4.py
# bed(): + pcfan, xfmr50, dehum, aircon). Only the headers, the beds.py import
# (now in-module: `B.` prefixes dropped) and bed -> bed3 differ.
#
# NEVER used for training: r5/selftest_r5.py fails if any training or packing
# script imports this module.
#
# ---------------------------------------------------------------- beds.py (round-3 review), verbatim below
# beds.py — round-3 review: machine-noise beds written for this review (not the
# training generator synth.py): parameters chosen as a room would have them,
# fixed per bed. Unit RMS at any rate.
import numpy as np
from scipy.signal import butter, sosfilt, lfilter


def _pink(rng, n):
    w = rng.standard_normal(n)
    b = [0.049922035, -0.095993537, 0.050612699, -0.004408786]
    a = [1, -2.494956002, 2.017265875, -0.522189400]
    return lfilter(b, a, w)


def _wob(rng, n, sr, cents, tau):
    a = np.exp(-1.0 / (tau * sr))
    y = lfilter([1.0], [1.0, -a], rng.standard_normal(n) * np.sqrt(1 - a * a))
    return 2 ** (cents * y / 1200)


def _stack(f, amps, sr, rng):
    ph = 2 * np.pi * np.cumsum(f) / sr
    x = np.zeros(len(f))
    for k, a in enumerate(amps):
        x += a * np.sin((k + 1) * ph + rng.uniform(0, 6.28))
    return x


def _u(x):
    return (x / np.sqrt(np.mean(x ** 2))).astype(np.float32)


def bed3(kind, sr, dur, seed=0):
    rng = np.random.default_rng(seed)
    n = int(sr * dur)
    t = np.arange(n) / sr
    if kind == "fan":            # box fan: blade pass 43 Hz harmonics + low-passed rumble
        f = 43.0 * _wob(rng, n, sr, 6, 0.8)
        h = _stack(f, [1, .7, .5, .35, .25, .15, .1], sr, rng)
        r = sosfilt(butter(2, 900, "lowpass", fs=sr, output="sos"), _pink(rng, n))
        x = 0.6 * h / h.std() + r / r.std()
    elif kind == "mains":        # 60 Hz transformer / ballast complex, strong 3rd
        f = np.full(n, 60.0)
        h = _stack(f, [1, .5, .9, .3, .4, .15, .2, .1], sr, rng)
        x = h / h.std() + 0.15 * _pink(rng, n) / _pink(rng, n).std()
    elif kind == "fridge":       # compressor ~ 100 Hz with slow drift + rattle bursts + broadband
        f = 98.0 * _wob(rng, n, sr, 15, 2.0)
        h = _stack(f, [1, .6, .45, .3, .2, .12], sr, rng)
        bb = sosfilt(butter(2, [200, 3000], "bandpass", fs=sr, output="sos"), rng.standard_normal(n))
        x = h / h.std() + 0.35 * bb / bb.std()
    elif kind == "hvac":         # air handler: low rumble + 120 Hz motor line + hiss
        r = sosfilt(butter(2, 300, "lowpass", fs=sr, output="sos"), _pink(rng, n))
        hiss = sosfilt(butter(2, 2000, "highpass", fs=sr, output="sos"), rng.standard_normal(n))
        h = _stack(120.0 * _wob(rng, n, sr, 4, 1.0), [1, .3, .2], sr, rng)
        x = r / r.std() + 0.4 * h / h.std() + 0.25 * hiss / hiss.std()
    elif kind == "vmotor":       # 'voice-like' motor: 150 Hz stack, speed wobble 8 c at ~5 Hz (vibrato-like), rich harmonics
        f = 150.0 * 2 ** (8 * np.sin(2 * np.pi * 5.2 * t) / 1200) * _wob(rng, n, sr, 5, 0.3)
        h = _stack(f, [1 / (k + 1) ** 0.8 for k in range(20) if (k + 1) * 150 < sr / 2.2], sr, rng)
        x = h / h.std() + 0.2 * _pink(rng, n) / _pink(rng, n).std()
    elif kind == "room":         # quiet broadband room tone (pink, -6 dB/oct above 2 kHz)
        x = sosfilt(butter(1, 2000, "lowpass", fs=sr, output="sos"), _pink(rng, n))
    else:
        raise ValueError(kind)
    return _u(x)


# ---------------------------------------------------------------- beds4.py (round-4 review) bed(), verbatim
def bed(kind, sr, dur, seed=0):
    if kind in ("fan", "mains", "fridge", "hvac", "vmotor", "room"):
        return bed3(kind, sr, dur, seed)
    rng = np.random.default_rng(seed)
    n = int(sr * dur)
    if kind == "pcfan":        # PC / laptop fan: blade-pass whine 235 Hz (7 blades x ~2000 rpm) + harmonics + airflow hiss
        f = 235.0 * _wob(rng, n, sr, 10, 1.5)
        h = _stack(f, [1, .5, .35, .2, .1], sr, rng)
        air = sosfilt(butter(2, [300, 6000], "bandpass", fs=sr, output="sos"), _pink(rng, n))
        x = 0.7 * h / h.std() + air / air.std()
    elif kind == "xfmr50":     # 50 Hz mains transformer: 100 Hz magnetostriction + even/odd harmonics, near-constant
        h = _stack(np.full(n, 100.0), [1, .6, .45, .3, .2, .15, .1, .08], sr, rng)
        x = h / h.std() + 0.05 * _pink(rng, n) / _pink(rng, n).std()
    elif kind == "dehum":      # dehumidifier: compressor 58 Hz (3480 rpm) + fan 140 Hz blade pass + broadband
        h1 = _stack(58.0 * _wob(rng, n, sr, 5, 2.0), [1, .7, .5, .3, .2], sr, rng)
        h2 = _stack(140.0 * _wob(rng, n, sr, 8, 1.0), [1, .4, .2], sr, rng)
        bb = sosfilt(butter(2, [150, 4000], "bandpass", fs=sr, output="sos"), _pink(rng, n))
        x = h1 / h1.std() + 0.6 * h2 / h2.std() + 0.7 * bb / bb.std()
    elif kind == "aircon":     # window AC: 120 Hz compressor hum + 30 Hz fan rumble + strong broadband airflow
        h = _stack(120.0 * _wob(rng, n, sr, 3, 3.0), [1, .5, .4, .2], sr, rng)
        r = sosfilt(butter(2, 200, "lowpass", fs=sr, output="sos"), _pink(rng, n))
        air = sosfilt(butter(2, [200, 5000], "bandpass", fs=sr, output="sos"), _pink(rng, n))
        x = 0.5 * h / h.std() + 0.6 * r / r.std() + air / air.std()
    else:
        raise ValueError(kind)
    return _u(x)
