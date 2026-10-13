# micsim_val.py — custom voice detector, round 6 (pre-registration
# measurements/voice-detector-round6-preregistration-2026-10-13.md §2.2): the
# VALIDATION-ONLY microphone models of the round-5 voice-safety review, ported
# UNCHANGED from its screen5.py (sha256
# 026c3c1d060466ae06c1803cf81731c60e0910248d0cf595e3038fb71a5db34d; lines
# 40-87: peak_eq, phone_eq = the round-3/4 reviews' phone EQ, phone2 = a 300 Hz
# high-pass phone with or without AGC, agc_only = the AGC alone). The review's
# screen5_eq.py (used by its sess5 builder) holds the same peak_eq / phone_eq
# and phone2 with the AGC always on: phone2(x, sr) here is that function.
# Only this header and the import lines differ.
#
# NEVER used for training: r6/selftest_r6.py fails if any training or packing
# script imports this module (the training microphone simulator is
# train/micsim_r6.py, written by the Train steps).
import numpy as np
from scipy.signal import butter, sosfilt, lfilter


def peak_eq(x, sr, f0, gain_db, q):
    Ag = 10 ** (gain_db / 40); w = 2 * np.pi * f0 / sr; al = np.sin(w) / (2 * q)
    b = [1 + al * Ag, -2 * np.cos(w), 1 - al * Ag]; a = [1 + al / Ag, -2 * np.cos(w), 1 - al / Ag]
    return lfilter(np.array(b) / a[0], np.array(a) / a[0], x)


def phone_eq(x, sr):       # the round-3/4 reviews' phone mic (HP 250, +8 dB @ 3 kHz, LP 7 kHz)
    y = sosfilt(butter(3, 250, "highpass", fs=sr, output="sos"), x)
    y = peak_eq(y, sr, 3000, 8, 1.2)
    return sosfilt(butter(6, min(7000, 0.45 * sr), "lowpass", fs=sr, output="sos"), y)


def phone2(x, sr, agc=True):         # NEW: phone with a steeper 300 Hz high-pass (removes a low hum's F0), +6 dB @ 2 kHz, LP 8 kHz, then AGC
    y = sosfilt(butter(4, 300, "highpass", fs=sr, output="sos"), x)
    y = peak_eq(y, sr, 2000, 6, 1.0)
    y = sosfilt(butter(6, min(8000, 0.45 * sr), "lowpass", fs=sr, output="sos"), y)
    if not agc:
        return y
    # AGC: RMS follower (attack 20 ms, release 1.5 s), target -20 dBFS, gain limited to [-10, +24] dB
    n = len(y); blk = int(0.005 * sr)
    e = np.sqrt(np.convolve(y ** 2, np.ones(blk) / blk, "same") + 1e-12)[::blk]
    aa, ar = np.exp(-0.005 / 0.02), np.exp(-0.005 / 1.5)
    env = np.empty(len(e)); v = e[0]
    for i, z in enumerate(e):
        v = aa * v + (1 - aa) * z if z > v else ar * v + (1 - ar) * z
        env[i] = v
    gdb = np.clip(-20 - 20 * np.log10(env + 1e-9), -10, 24)
    g = 10 ** (np.repeat(gdb, blk)[:n] / 20)
    if len(g) < n:
        g = np.concatenate([g, np.full(n - len(g), g[-1])])
    return y * g


def agc_only(x, sr):
    y = x
    n = len(y); blk = int(0.005 * sr)
    e = np.sqrt(np.convolve(y ** 2, np.ones(blk) / blk, "same") + 1e-12)[::blk]
    aa, ar = np.exp(-0.005 / 0.02), np.exp(-0.005 / 1.5)
    env = np.empty(len(e)); v = e[0]
    for i, z in enumerate(e):
        v = aa * v + (1 - aa) * z if z > v else ar * v + (1 - ar) * z
        env[i] = v
    gdb = np.clip(-20 - 20 * np.log10(env + 1e-9), -10, 24)
    g = 10 ** (np.repeat(gdb, blk)[:n] / 20)
    if len(g) < n:
        g = np.concatenate([g, np.full(n - len(g), g[-1])])
    return y * g


