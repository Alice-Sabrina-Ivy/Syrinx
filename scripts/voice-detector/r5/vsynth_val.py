# vsynth_val.py — custom voice detector, round 5 (pre-registration
# measurements/voice-detector-round5-preregistration-2026-10-12.md §2.1): the
# VALIDATION-ONLY voice synthesizer of the H1 / H2 rows, ported UNCHANGED from
# the round-1 voice-safety review (vsynth.py: KLGLOTT88 flow derivative,
# per-cycle jitter / shimmer, slow F0 wander, open-phase aspiration, tilt,
# cascade formants, hum antiformant, lip radiation; its per-sample synth() is
# kept as synth_loop) and the round-4 review's per-cycle form (vsynth2.py
# synth(), same parameters and truth format). Only the module header and the
# import line differ from the review files.
#
# NEVER used for training: r5/selftest_r5.py fails if any training or packing
# script imports this module (the training synthesizer is train/vsynth_r5.py).
#
# ---------------------------------------------------------------- vsynth.py (round-1 review), verbatim below
# vsynth.py — review (voice safety): a source-filter singing/speaking voice
# synthesizer with truth F0, for probing the detector. KLGLOTT88-style glottal
# flow derivative with per-cycle jitter / shimmer, slow F0 wander, aspiration
# noise gated by the open phase, spectral tilt, cascade formant resonators
# (+ optional nasal anti-resonance for a hum), lip radiation.
import numpy as np
from scipy.signal import lfilter

VOWELS = {  # adult male formants / bandwidths (Peterson-Barney-ish)
    "a": ([730, 1090, 2440, 3400, 4500], [80, 90, 120, 150, 200], [0, -3, -12, -18, -24]),
    "i": ([270, 2290, 3010, 3400, 4500], [60, 100, 120, 150, 200], [0, -12, -15, -20, -26]),
    "u": ([300, 870, 2240, 3400, 4500], [60, 90, 120, 150, 200], [0, -6, -24, -30, -34]),
    "e": ([530, 1840, 2480, 3400, 4500], [70, 100, 120, 150, 200], [0, -6, -14, -20, -26]),
    "o": ([570, 840, 2410, 3400, 4500], [70, 90, 120, 150, 200], [0, -3, -20, -26, -30]),
}
HUM = ([260, 1000, 2200, 2900, 3800], [60, 200, 300, 400, 500], [0, -18, -24, -30, -36], (1100, 250))  # /m/ murmur + antiformant
QUAL = {  # open quotient, tilt pole, aspiration rel. level (dB re source rms), jitter, shimmer
    "modal": (0.6, 0.0, -35, 0.006, 0.03),
    "breathy": (0.85, 0.55, -14, 0.010, 0.06),
    "pressed": (0.4, 0.0, -45, 0.005, 0.02),
    "falsetto": (0.9, 0.75, -24, 0.006, 0.04),
    "soft": (0.75, 0.45, -24, 0.008, 0.05),
}


def reson(x, f, bw, sr):
    r = np.exp(-np.pi * bw / sr)
    th = 2 * np.pi * f / sr
    a = [1, -2 * r * np.cos(th), r * r]
    b = [1 - 2 * r * np.cos(th) + r * r]   # unity gain at DC
    return lfilter(b, a, x)


def antireson(x, f, bw, sr):
    r = np.exp(-np.pi * bw / sr)
    th = 2 * np.pi * f / sr
    b = np.array([1, -2 * r * np.cos(th), r * r])
    return lfilter(b / b.sum(), [1], x)


def f0_track(n, sr, f0, rng, vib=None, glide=None, wander_cents=8.0):
    t = np.arange(n) / sr
    if glide is not None:      # (f_lo, f_hi, period_s): exponential up-down siren
        lo, hi, per = glide
        ph = (t % per) / per
        tri = np.where(ph < 0.5, ph * 2, 2 - ph * 2)
        f = lo * (hi / lo) ** tri
    else:
        f = np.full(n, float(f0))
    # slow wander: low-passed noise, ~wander_cents rms
    w = rng.standard_normal(n // 400 + 4)
    w = np.convolve(w, np.ones(8) / 8, "same")
    w = np.interp(np.arange(n) / 400.0, np.arange(len(w)), w)
    w = w / (w.std() + 1e-9) * wander_cents
    f = f * 2 ** (w / 1200)
    if vib is not None:        # (rate Hz, extent cents)
        rate, ext = vib
        f = f * 2 ** (ext * np.sin(2 * np.pi * rate * t + rng.uniform(0, 6.28)) / 1200)
    return f


def synth_loop(sr, dur, f0, vowel="a", qual="modal", fscale=1.0, vib=None, glide=None, env=None, am=None, seed=0,
          level_db=-26.0, onset=0.25, offset=0.25, floor_db=-85.0, lead=0.5, tail=0.5):
    """Returns (x, truth (t0, hop, f0[])) — x at sr, truth F0 at 10 ms (0 where unvoiced)."""
    rng = np.random.default_rng(seed)
    nv = int(dur * sr)
    oq, tiltp, asp_db, jit, shim = QUAL[qual]
    f = f0_track(nv, sr, f0, rng, vib, glide)
    # per-cycle jitter: piecewise-constant multiplicative factor per cycle
    phase = np.zeros(nv)
    src = np.zeros(nv)
    opn = np.zeros(nv)
    ph, cyc_fac, amp = 0.0, 1.0, 1.0
    finst = f.copy()
    for i in range(nv):
        ph += f[i] * cyc_fac / sr
        if ph >= 1.0:
            ph -= 1.0
            cyc_fac = 1 + jit * rng.standard_normal()
            amp = 1 + shim * rng.standard_normal()
        finst[i] = f[i] * cyc_fac
        phase[i] = ph
        if ph < oq:
            u = ph / oq
            # KLGLOTT88 flow derivative: d/du (u^2 - u^3) = 2u - 3u^2
            src[i] = amp * (2 * u - 3 * u * u)
            opn[i] = 1.0
    if tiltp > 0:
        src = lfilter([1 - tiltp], [1, -tiltp], src)
    src = src / (np.sqrt(np.mean(src ** 2)) + 1e-12)
    asp = rng.standard_normal(nv) * (0.3 + 0.7 * opn) * 10 ** (asp_db / 20)
    exc = src + asp
    if vowel == "hum":
        fs, bws, gains, (za, zbw) = HUM
        y = antireson(exc, za, zbw, sr)
    else:
        fs, bws, gains = VOWELS[vowel]
        y = exc
    out = y
    for F, B, G in zip(fs, bws, gains):   # Klatt-style cascade: natural relative formant levels
        Fs = F * fscale
        if Fs >= sr / 2 * 0.9:
            continue
        out = reson(out, Fs, B * fscale ** 0.5, sr)
    if vowel == "hum":
        # lips closed: little radiated HF; the murmur is low-passed
        out = lfilter([0.35], [1, -0.65], out)
    else:
        out = np.diff(out, prepend=0.0)   # lip radiation
    # envelope
    e = np.ones(nv)
    no, nf = int(onset * sr), int(offset * sr)
    if no:
        e[:no] = np.linspace(0, 1, no) ** 2
    if nf:
        e[-nf:] = np.linspace(1, 0, nf) ** 2
    if env is not None:   # (db_start, db_end) linear-in-dB ramp (crescendo / decrescendo)
        e *= 10 ** (np.linspace(env[0], env[1], nv) / 20)
    if am is not None:    # (rate Hz, depth 0..1) e.g. lip trill
        rate, depth = am
        t = np.arange(nv) / sr
        e *= 1 - depth * (0.5 + 0.5 * np.cos(2 * np.pi * rate * t))
    out = out * e
    # level: active rms (2 % of peak rule like the benchmark) -> level_db
    act = np.abs(out) > 0.02 * np.abs(out).max()
    out = out / np.sqrt(np.mean(out[act] ** 2)) * 10 ** (level_db / 20)
    nl, nt = int(lead * sr), int(tail * sr)
    x = np.concatenate([np.zeros(nl), out, np.zeros(nt)])
    x = x + rng.standard_normal(len(x)) * 10 ** (floor_db / 20)
    # truth F0 at 10 ms: voiced where the envelope is >= -30 dB re its max and inside the note
    hop = 0.01
    tt = np.arange(0, len(x) / sr, hop)
    idx = np.round(tt * sr).astype(int) - nl
    ok = (idx >= 0) & (idx < nv)
    ft = np.zeros(len(tt))
    ev = np.abs(e) / np.abs(e).max()
    good = ok.copy()
    good[ok] = ev[idx[ok]] >= 10 ** (-30 / 20)
    ft[good] = finst[idx[good]]
    return x.astype(np.float32), (0.0, hop, ft.astype(np.float32))


# ---------------------------------------------------------------- vsynth2.py (round-4 review) synth(), verbatim
def synth(sr, dur, f0, vowel="a", qual="modal", fscale=1.0, vib=None, glide=None, env=None, am=None, seed=0,
          level_db=-26.0, onset=0.25, offset=0.25, floor_db=-85.0, lead=0.5, tail=0.5, wander_cents=8.0, jit=None, shim=None):
    rng = np.random.default_rng(seed)
    nv = int(dur * sr)
    oq, tiltp, asp_db, jit0, shim0 = QUAL[qual]
    jit = jit0 if jit is None else jit
    shim = shim0 if shim is None else shim
    f = f0_track(nv, sr, f0, rng, vib, glide, wander_cents)
    # cycle boundaries
    starts, facs, amps = [], [], []
    t = 0.0
    while t < nv:
        i = min(int(t), nv - 1)
        fac = 1 + jit * rng.standard_normal()
        T = sr / (f[i] * fac)
        starts.append(t); facs.append(fac); amps.append(1 + shim * rng.standard_normal())
        t += T
    starts = np.array(starts + [t]); facs = np.array(facs); amps = np.array(amps)
    idx = np.arange(nv, dtype=np.float64)
    c = np.searchsorted(starts, idx, side="right") - 1
    ph = (idx - starts[c]) / (starts[c + 1] - starts[c])
    opn = (ph < oq).astype(np.float64)
    u = ph / oq
    src = np.where(opn > 0, amps[c] * (2 * u - 3 * u * u), 0.0)
    finst = f * facs[c]
    if tiltp > 0:
        src = lfilter([1 - tiltp], [1, -tiltp], src)
    src = src / (np.sqrt(np.mean(src ** 2)) + 1e-12)
    asp = rng.standard_normal(nv) * (0.3 + 0.7 * opn) * 10 ** (asp_db / 20)
    exc = src + asp
    if vowel == "hum":
        fs, bws, gains, (za, zbw) = HUM
        y = antireson(exc, za, zbw, sr)
    else:
        fs, bws, gains = VOWELS[vowel]
        y = exc
    out = y
    for F, B, G in zip(fs, bws, gains):
        Fs = F * fscale
        if Fs >= sr / 2 * 0.9:
            continue
        out = reson(out, Fs, B * fscale ** 0.5, sr)
    if vowel == "hum":
        out = lfilter([0.35], [1, -0.65], out)
    else:
        out = np.diff(out, prepend=0.0)
    e = np.ones(nv)
    no, nf = int(onset * sr), int(offset * sr)
    if no:
        e[:no] = np.linspace(0, 1, no) ** 2
    if nf:
        e[-nf:] = np.linspace(1, 0, nf) ** 2
    if env is not None:
        e *= 10 ** (np.linspace(env[0], env[1], nv) / 20)
    if am is not None:
        rate, depth = am
        tt = np.arange(nv) / sr
        e *= 1 - depth * (0.5 + 0.5 * np.cos(2 * np.pi * rate * tt))
    out = out * e
    act = np.abs(out) > 0.02 * np.abs(out).max()
    out = out / np.sqrt(np.mean(out[act] ** 2)) * 10 ** (level_db / 20)
    nl, nt = int(lead * sr), int(tail * sr)
    x = np.concatenate([np.zeros(nl), out, np.zeros(nt)])
    x = x + rng.standard_normal(len(x)) * 10 ** (floor_db / 20)
    hop = 0.01
    tt = np.arange(0, len(x) / sr, hop)
    ii = np.round(tt * sr).astype(int) - nl
    ok = (ii >= 0) & (ii < nv)
    ft = np.zeros(len(tt))
    ev = np.abs(e) / np.abs(e).max()
    good = ok.copy()
    good[ok] = ev[ii[ok]] >= 10 ** (-30 / 20)
    ft[good] = finst[ii[good]]
    return x.astype(np.float32), (0.0, hop, ft.astype(np.float32))
