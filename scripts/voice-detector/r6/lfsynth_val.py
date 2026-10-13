# lfsynth_val.py — custom voice detector, round 6 (pre-registration
# measurements/voice-detector-round6-preregistration-2026-10-13.md §2.2): the
# VALIDATION-ONLY LF-model voice synthesizer of the H4-H7 rows, ported
# UNCHANGED from the round-5 voice-safety review (lfsynth.py, sha256
# 3993f148e8fe5a0faa066af76e6e6fb39a0e7d2551ed8445174e5a4cded0a684; the
# output digests are pinned in selftest_r6.py). Only this header differs.
#
# NEVER used for training: r6/selftest_r6.py fails if any training or packing
# script imports this module or names the round-6 validation folder.
#
# ---------------------------------------------------------------- lfsynth.py (round-5 review), verbatim below
# lfsynth.py — round-5 voice-safety review: a THIRD voice synthesizer, written
# for this review only (not the validation KLGLOTT88 model vsynth/vsynth_val,
# not the training Rosenberg model vsynth_r5). Source: Liljencrants-Fant
# flow derivative from the Rd parameterisation (Fant 1995), one normalised
# pulse per Rd tabulated and time-stretched per cycle; AR(1) jitter / shimmer;
# F0 wander = sum of three random slow sinusoids; optional vibrato with AM;
# aspiration = pink noise gated by the open phase. Tracts: Peterson & Barney
# (1952) male / female formant averages (NOT a scaled male table), bandwidths
# 50 + F/18. Hum: /m/ murmur (nasal pole 260 Hz, zero 1100 Hz, poles 1350 /
# 2300 Hz), nostril radiation. Truth: 10 ms instantaneous F0 where the
# envelope >= -30 dB.
import numpy as np
from scipy.signal import lfilter

PB = {  # Peterson & Barney 1952 averages: F1, F2, F3 (+ F4, F5 fixed)
    "m": {"a": [730, 1090, 2440, 3400, 4300], "u": [300, 870, 2240, 3300, 4300], "i": [270, 2290, 3010, 3600, 4400],
          "o": [570, 840, 2410, 3350, 4300]},
    "f": {"a": [850, 1220, 2810, 3900, 4900], "u": [370, 950, 2670, 3800, 4900], "i": [310, 2790, 3310, 4100, 5000],
          "o": [590, 920, 2710, 3850, 4900]},
}
HUMT = {"m": ([260, 1350, 2300, 3300], 1100), "f": ([300, 1550, 2600, 3700], 1250)}
QUAL = {"modal": (1.0, -32.0), "pressed": (0.6, -40.0), "breathy": (2.0, -16.0), "soft": (1.4, -24.0)}  # Rd, aspiration dB


def lf_pulse(Rd, N=4096):
    Ra = (-1 + 4.8 * Rd) / 100
    Rk = (22.4 + 11.8 * Rd) / 100
    Rg = Rk / (4 * (0.11 * Rd / (0.5 + 1.2 * Rk) - Ra))
    tp = 1 / (2 * Rg); te = tp * (1 + Rk); ta = Ra
    te = min(te, 0.97)
    wg = np.pi / tp
    eps = 1 / ta
    for _ in range(50):
        eps = (1 - np.exp(-eps * (1 - te))) / ta
    t = (np.arange(N) + 0.5) / N
    def shape(alpha):
        e = np.where(t <= te, np.exp(alpha * t) * np.sin(wg * t), 0.0)
        Ee = -np.exp(alpha * te) * np.sin(wg * te)
        r = np.where(t > te, -(Ee / (eps * ta)) * (np.exp(-eps * (t - te)) - np.exp(-eps * (1 - te))), 0.0)
        return e + r
    lo, hi = -50.0, 200.0           # zero net flow: integral of the derivative = 0
    for _ in range(80):
        m = 0.5 * (lo + hi)
        if shape(m).sum() > 0:
            lo = m
        else:
            hi = m
    y = shape(0.5 * (lo + hi))
    return y / np.abs(y).max(), te


def res2(x, F, B, sr):
    r = np.exp(-np.pi * B / sr); c = 2 * r * np.cos(2 * np.pi * F / sr)
    return lfilter([1 - c + r * r], [1, -c, r * r], x)


def zero2(x, F, B, sr):
    r = np.exp(-np.pi * B / sr); c = 2 * r * np.cos(2 * np.pi * F / sr)
    g = 1 - c + r * r
    return lfilter(np.array([1, -c, r * r]) / g, [1], x)


def synth(sr, dur, f0, sex="m", vowel="a", qual="modal", seed=0, lead=20.0, tail=1.0, level_db=-26.0, wander_cents=15.0,
          jit=0.006, shim=0.04, vib=None, glide=None, am=None, onset=0.2, offset=0.3, floor_db=-85.0, segs=None):
    """segs: optional list of (start_s, dur_s) voiced segments inside dur (repeated holds); default one hold."""
    rng = np.random.default_rng(seed)
    nv = int(dur * sr)
    tt = np.arange(nv) / sr
    cents = np.zeros(nv)
    for _ in range(3):
        fr = rng.uniform(0.08, 1.5)
        cents += np.sin(2 * np.pi * fr * tt + rng.uniform(0, 6.3))
    cents *= wander_cents / np.sqrt(1.5)
    if vib:
        rate, depth = vib
        cents += depth * np.sin(2 * np.pi * rate * tt + rng.uniform(0, 6.3))
    f = f0 * 2 ** (cents / 1200)
    if glide is not None:
        f = f * glide(tt)
    Rd, asp_db = QUAL[qual]
    pulse, te = lf_pulse(Rd)
    starts, facs, amps = [], [], []
    t = 0.0; jj = 0.0; ss = 0.0
    while t < nv:
        i = min(int(t), nv - 1)
        jj = 0.5 * jj + np.sqrt(0.75) * jit * rng.standard_normal()
        ss = 0.6 * ss + np.sqrt(0.64) * shim * rng.standard_normal()
        T = sr / (f[i] * (1 + jj))
        starts.append(t); facs.append(1 + jj); amps.append(1 + ss)
        t += T
    starts = np.array(starts + [t]); facs = np.array(facs); amps = np.array(amps)
    idx = np.arange(nv, dtype=np.float64)
    c = np.searchsorted(starts, idx, side="right") - 1
    ph = (idx - starts[c]) / (starts[c + 1] - starts[c])
    src = amps[c] * np.interp(ph, (np.arange(len(pulse)) + 0.5) / len(pulse), pulse)
    src = src / (np.sqrt(np.mean(src ** 2)) + 1e-12)
    w = rng.standard_normal(nv)
    pk = lfilter([0.049922035, -0.095993537, 0.050612699, -0.004408786], [1, -2.494956002, 2.017265875, -0.522189400], w)
    pk = np.diff(pk, prepend=0.0)              # pink -> roughly white-ish tilt for aspiration through the tract
    pk /= pk.std() + 1e-12
    gate = np.where(ph < te, 1.0, 0.25)
    exc = src + pk * gate * 10 ** (asp_db / 20)
    if vowel == "hum":
        poles, z = HUMT[sex]
        y = zero2(exc, z, 220, sr)
        for k, F in enumerate(poles):
            if F < 0.45 * sr:
                y = res2(y, F, 70 + F / 12, sr) * (1.0 if k == 0 else 0.6)
        y = np.diff(y, prepend=0.0)
        y = lfilter([1.0], [1, -0.7], y)       # closed lips: soft high cut
    else:
        y = exc
        for F in PB[sex][vowel]:
            if F < 0.45 * sr:
                y = res2(y, F, 50 + F / 18, sr)
        y = np.diff(y, prepend=0.0)            # lip radiation
    env = np.zeros(nv)
    for (s0, d0) in (segs or [(0.0, dur)]):
        a = int(s0 * sr); b = min(nv, int((s0 + d0) * sr))
        e = np.ones(b - a)
        no, nf = int(onset * sr), int(offset * sr)
        if no and len(e) > no + nf:
            e[:no] = np.linspace(0, 1, no) ** 2
            e[-nf:] = np.linspace(1, 0, nf) ** 2
        env[a:b] = e
    if am is not None:
        rate, depth = am
        env *= 1 - depth * (0.5 + 0.5 * np.cos(2 * np.pi * rate * tt))
    out = y * env
    act = np.abs(out) > 0.02 * np.abs(out).max()
    out = out / np.sqrt(np.mean(out[act] ** 2)) * 10 ** (level_db / 20)
    nl, nt = int(lead * sr), int(tail * sr)
    x = np.concatenate([np.zeros(nl), out, np.zeros(nt)])
    x = x + rng.standard_normal(len(x)) * 10 ** (floor_db / 20)
    hop = 0.01
    tg = np.arange(0, len(x) / sr, hop)
    ii = np.round(tg * sr).astype(int) - nl
    ok = (ii >= 0) & (ii < nv)
    ft = np.zeros(len(tg))
    ev = env / max(env.max(), 1e-12)
    good = ok.copy()
    good[ok] = ev[ii[ok]] >= 10 ** (-30 / 20)
    ft[good] = (f * facs[c])[ii[good]]
    return x.astype(np.float32), (0.0, hop, ft.astype(np.float32))
