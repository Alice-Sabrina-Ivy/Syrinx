"""Cascade formant synthesizer for the vowdata.dat steady-state tables.

Hillenbrand ships audio only for men/women; boys/girls exist only as formant
tables. To test candidates on child-like (high F0, short tract) voices we
synthesize every vowdata token (men/women/boys/girls) with ONE synthesizer, so
the men-women gap measured on the synthetic men/women calibrates the synthetic
domain and children are read relative to it (never against real-speech gaps).

Source: KLGLOTT88 flow-derivative pulses (OQ 0.6) at 4x oversampling with 0.5 %
period jitter, 3 % amplitude shimmer, slow F0 drift (+-1 %) and a 4 % declination,
plus pulse-gated aspiration noise (-28 dB), then a one-pole spectral-tilt
low-pass at 1 kHz (Klatt TL; ~-10 dB at 3 kHz). Tract: Klatt cascade resonators at
F1..F5 (F4 filled from the group-median F4-F3 spacing when missing; F5 = F4 +
group-median F4-F3), bandwidths 80/100/150/220/300 Hz scaled by F_k / adult-male
reference so short tracts keep comparable Q.
Static formants by design (a held vowel): this is a lower bound on readout jitter.
"""
import numpy as np
from scipy.signal import resample_poly, lfilter
from .paths import SR

OS = 4
FS = SR * OS
BW0 = np.array([80, 100, 150, 220, 300], float)
REF_F = np.array([500, 1500, 2500, 3500, 4500], float)
TILT_HZ = 1000.0


def _source(f0, dur, rng):
    n = int(dur * FS)
    t_nominal = np.arange(n) / FS
    drift = np.cumsum(rng.normal(0, 1, n // 400 + 2))
    drift = np.interp(np.arange(n), np.arange(len(drift)) * 400, drift)
    drift = 0.01 * drift / (np.max(np.abs(drift)) + 1e-9)
    decl = 0.02 - 0.04 * t_nominal / dur
    f0c = f0 * (1 + drift + decl)
    g = np.zeros(n)
    t = 0
    while t < n:
        T0 = FS / f0c[min(t, n - 1)] * (1 + rng.normal(0, 0.005))
        Te = int(0.6 * T0)
        if Te < 4:
            break
        k = np.arange(Te)
        a = 1.0 * (1 + rng.normal(0, 0.03))
        pulse = a * (2 * k / Te - 3 * (k / Te) ** 2)          # d/dt of t^2 - t^3 shape
        end = min(n, t + Te)
        g[t:end] += pulse[: end - t]
        t += int(round(T0))
    open_gate = (g != 0).astype(float)
    g += 10 ** (-28 / 20) * rng.normal(0, 1, n) * (0.3 + 0.7 * open_gate)
    a = np.exp(-2 * np.pi * TILT_HZ / FS)                    # Klatt-style TL: ~-10 dB at 3 kHz
    return lfilter([1 - a], [1, -a], g)


def _resonator(x, F, B):
    T = 1.0 / FS
    C = -np.exp(-2 * np.pi * B * T)
    Bc = 2 * np.exp(-np.pi * B * T) * np.cos(2 * np.pi * F * T)
    A = 1 - Bc - C
    return lfilter([A], [1, -Bc, -C], x)


def synth_vowel(f0, formants, dur=2.0, seed=0):
    """formants: F1..F5 (Hz). Returns float32 @ 16 kHz, peak ~0.5."""
    rng = np.random.default_rng(seed)
    x = _source(f0, dur, rng)
    for F, bw0, rf in zip(formants, BW0, REF_F):
        if F is None or not np.isfinite(F) or F >= FS / 2 * 0.9:
            continue
        x = _resonator(x, F, bw0 * max(0.7, F / rf) ** 0.5)
    y = resample_poly(x, 1, OS)
    ramp = int(0.02 * SR)
    w = np.ones(len(y))
    w[:ramp] = np.linspace(0, 1, ramp)
    w[-ramp:] = np.linspace(1, 0, ramp)
    y = y * w
    return (0.5 * y / (np.max(np.abs(y)) + 1e-12)).astype(np.float32)


def fill_formants(vd):
    """Add F4f / F5f columns (group-median spacing fill)."""
    vd = vd.copy()
    sp = (vd.F4 - vd.F3).groupby(vd.g).median()
    vd["F4f"] = np.where(np.isfinite(vd.F4), vd.F4, vd.F3 + vd.g.map(sp))
    vd["F5f"] = vd.F4f + vd.g.map(sp)
    return vd
