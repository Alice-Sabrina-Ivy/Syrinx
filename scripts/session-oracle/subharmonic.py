# subharmonic.py — tracker-independent spectral odd-multiple arbiter for
# octave disputes (2026-10-03 investigation, phase 1). For a frame with
# reference F0 = f (high hypothesis) and the half-pitch hypothesis f/2,
# measure harmonic peak power at k*f/2 for k = 1..8 (k*f/2 < 3500 Hz) on a
# 100 ms Hann window. Each peak is taken relative to the spectral valleys
# half an (f/2)-spacing either side, so formant tilt does not dominate.
#   odd_rel  = mean peak-over-valley dB at ODD k (energy only f/2 explains)
#   even_rel = same at EVEN k (= harmonics of f)
# Verdict convention used by analyze.py / build_refs.py:
#   odd_rel <= 4 dB  -> odd multiples absent: f is the true F0 ("high")
#   odd_rel >= 8 dB  -> f/2 physically supported ("low")
#   otherwise ambiguous.
# The arbiter shares the detector's physical principle (odd multiples), so
# it is circular as a judge of the octave-arbitration change: it is used to
# characterise frames, never to relax a guard.
import numpy as np

NFFT, WIN, SR = 16384, 1600, 16000
_hann = np.hanning(WIN)


def shr(x, t, f):
    c = int(round(t * SR)); a = c - WIN // 2
    if a < 0 or a + WIN > len(x):
        return np.nan, np.nan, np.nan
    seg = x[a:a + WIN] - x[a:a + WIN].mean()
    P = np.abs(np.fft.rfft(seg * _hann, NFFT)) ** 2 + 1e-20
    binhz = SR / NFFT; h = f / 2

    def band(fc, w):
        lo, hi = int(fc * (1 - w) / binhz), int(np.ceil(fc * (1 + w) / binhz))
        return P[max(1, lo):hi + 1]

    def peak_rel(fc):
        pk = band(fc, 0.03).max()
        vl = 0.5 * (band(fc - h / 2, 0.02).mean() + band(fc + h / 2, 0.02).mean())
        return 10 * np.log10(pk / vl)

    ks = [k for k in range(1, 9) if k * h < 3500]
    odd = [peak_rel(k * h) for k in ks if k % 2 == 1]
    even = [peak_rel(k * h) for k in ks if k % 2 == 0]

    def peak_abs(fc):
        lo, hi = int(fc * 0.96 / binhz), int(np.ceil(fc * 1.04 / binhz))
        return 10 * np.log10(P[lo:hi + 1].max())

    oa = np.mean([peak_abs(k * h) for k in ks if k % 2 == 1])
    ea = np.mean([peak_abs(k * h) for k in ks if k % 2 == 0])
    return float(np.mean(odd)), float(np.mean(even)), float(oa - ea)
