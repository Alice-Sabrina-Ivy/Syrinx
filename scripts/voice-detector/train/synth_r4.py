# synth_r4.py — custom voice detector, round 4 (pre-registration
# measurements/voice-detector-round4-preregistration-2026-10-11.md §3.2 D4):
# synthetic STEADY machine interferers for training. A new generator: the
# rounds 1-3 synth.py (and every validation stream it made) is untouched, so
# an old seed still produces the same clip. Training seeds [2e9, 3e9); no
# validation seeds (the validation sets are round 3's, unchanged).
#
# Families (parameter ranges fixed here before any round-4 training and never
# tuned on validation data):
#   steady_hum    harmonic stack, f0 40-460 Hz (log-uniform; 35 % in 80-250 Hz),
#                 2-16 partials (synth._amps spectra), slow wobble <= 3 cents
#                 (two sinusoids 0.02-0.3 / 0.05-0.5 Hz), no gating
#   steady_mains  50 / 60 Hz (+-0.3 %) complexes of 3-12 harmonics, odd-heavy
#                 (even partials x 0.05-0.3) or even-heavy (odd partials above the
#                 fundamental x 0.05-0.3), level drift <= 1 dB (sinusoid 0.01-0.1 Hz)
#   bbfan         broadband noise (white / pink / brown mix) through a fixed random
#                 envelope of 2-6 resonances (100-4000 Hz, Q 1-8, gains 0-15 dB),
#                 with p 0.6 blade-pass lines: f0 20-300 Hz, 1-6 partials, wobble
#                 0.5-2 Hz of 1-5 cents, at -20..+5 dB vs the noise
#   fridge        compressor stack (f0 30-200 Hz, 3-12 partials, wobble <= 3 cents)
#                 + hiss (pink / white, -25..-5 dB vs the stack); at most one on /
#                 off switch per 60 s (p 0.5 per clip: the stack ramps off or on over
#                 0.05-0.5 s at a random time; the hiss stays)
#   hvac          rumble (one-pole low-pass at 40-200 Hz) + broadband noise (pink /
#                 white, high-shelved by -12..0 dB) + 1-3 tonal lines 40-460 Hz
#                 (each 1-4 partials, wobble <= 3 cents) at -25..0 dB
#   steady_combo  two of the five families above (distinct), the second at
#                 -10..+10 dB
# Every clip is unit RMS (the mixer applies levels).
#
#   python scripts/voice-detector/train/synth_r4.py pack [--n=2000]   # -> <TRAIN>/synth_r4_train.i16 + .npz
import os

import numpy as np
from scipy.signal import lfilter

import synth
from synth import SR, _amps, _brown, _f0, _pink, _stack, _unit, _white

FAMILIES = ["steady_hum", "steady_mains", "bbfan", "fridge", "hvac", "steady_combo"]
WEIGHTS = np.array([0.2, 0.15, 0.2, 0.15, 0.15, 0.15])
SEED0, SEED_END = 2_000_000_000, 3_000_000_000


def _wob(rng, n, f0, max_cents=3.0):
    t = np.arange(n) / SR
    d = rng.uniform(0, max_cents) / 1200 * np.log(2)
    r1, r2 = rng.uniform(0.02, 0.3), rng.uniform(0.05, 0.5)
    return f0 * (1 + d * (np.sin(2 * np.pi * r1 * t + rng.uniform(0, 6.3)) + 0.3 * np.sin(2 * np.pi * r2 * t + rng.uniform(0, 6.3))) / 1.3)


def _biquad_peak(f, q, gain_db):
    A = 10 ** (gain_db / 40)
    w0 = 2 * np.pi * f / SR
    al = np.sin(w0) / (2 * q)
    b = [1 + al * A, -2 * np.cos(w0), 1 - al * A]
    a = [1 + al / A, -2 * np.cos(w0), 1 - al / A]
    return np.array(b) / a[0], np.array(a) / a[0]


def _noise_mix(rng, n):
    w = rng.dirichlet([1, 1, 1])
    return w[0] * _unit(_white(rng, n)) + w[1] * _unit(_pink(rng, n)) + w[2] * _unit(_brown(rng, n))


def _hiss(rng, n):
    return _unit(_pink(rng, n)) if rng.random() < 0.6 else _unit(_white(rng, n))


def gen(seed, n, family=None):
    """One unit-RMS steady interferer clip of n samples at 16 kHz. Returns (x, meta)."""
    assert SEED0 <= seed < SEED_END or family is not None
    rng = np.random.default_rng(seed)
    fam = family or str(rng.choice(FAMILIES, p=WEIGHTS))
    t = np.arange(n) / SR
    meta = {"family": fam, "seed": int(seed)}
    if fam == "steady_hum":
        f = _f0(rng)
        x = _stack(rng, _wob(rng, n, f), _amps(rng, 16))
        meta["f0"] = f
    elif fam == "steady_mains":
        f = float(rng.choice([50.0, 60.0])) * (1 + rng.uniform(-0.003, 0.003))
        k = int(rng.integers(3, 13))
        a = rng.uniform(0.2, 1.0, k)
        i = np.arange(k)
        if rng.random() < 0.5:
            a = np.where(i % 2 == 1, a * rng.uniform(0.05, 0.3), a)                      # odd-heavy (harmonics 1, 3, 5, ...)
            meta["mains"] = "odd"
        else:
            a = np.where((i % 2 == 0) & (i > 0), a * rng.uniform(0.05, 0.3), a)        # even-heavy (2, 4, 6, ... over the fundamental)
            meta["mains"] = "even"
        drift = 10 ** (rng.uniform(0, 1.0) * np.sin(2 * np.pi * rng.uniform(0.01, 0.1) * t + rng.uniform(0, 6.3)) / 20)
        x = _stack(rng, np.full(n, f), a) * drift
        meta["f0"] = f
    elif fam == "bbfan":
        x = _noise_mix(rng, n)
        nres = int(rng.integers(2, 7))
        for _ in range(nres):
            b, a = _biquad_peak(float(np.exp(rng.uniform(np.log(100), np.log(4000)))), rng.uniform(1, 8), rng.uniform(0, 15))
            x = lfilter(b, a, x)
        x = _unit(x)
        meta["resonances"] = nres
        if rng.random() < 0.6:
            f = float(np.exp(rng.uniform(np.log(20), np.log(300))))
            rate, cents = rng.uniform(0.5, 2.0), rng.uniform(1, 5)
            ff = f * 2 ** (cents * np.sin(2 * np.pi * rate * t + rng.uniform(0, 6.3)) / 1200)
            lines = _unit(_stack(rng, ff, rng.uniform(0.2, 1.0, int(rng.integers(1, 7)))))
            lvl = rng.uniform(-20, 5)
            x = x + 10 ** (lvl / 20) * lines
            meta.update(blade_f0=f, blade_db=lvl)
    elif fam == "fridge":
        f = float(np.exp(rng.uniform(np.log(30), np.log(200))))
        st = _unit(_stack(rng, _wob(rng, n, f), _amps(rng, 12)))
        g = np.ones(n)
        if rng.random() < 0.5 and n > SR:
            ts = rng.uniform(0.1, 0.9) * n / SR
            ramp = rng.uniform(0.05, 0.5)
            u = np.clip((t - ts) / ramp, 0, 1)
            g = 1 - u if rng.random() < 0.5 else u                                      # switches off, or on, once (<= 1 per clip <= 60 s)
            g = np.maximum(g, 1e-3)
            meta["switch_s"] = round(ts, 2)
        x = st * g + 10 ** (rng.uniform(-25, -5) / 20) * _hiss(rng, n)
        meta["f0"] = f
    elif fam == "hvac":
        a = 1 - np.exp(-2 * np.pi * rng.uniform(40, 200) / SR)
        rum = _unit(lfilter([a], [1, -(1 - a)], rng.standard_normal(n)))
        bb = _hiss(rng, n)
        hs = rng.uniform(-12, 0)                                                         # high shelf ~ 1 kHz
        b0, a0 = _biquad_peak(3000.0, 0.5, hs)
        bb = _unit(lfilter(b0, a0, bb))
        x = rum + rng.uniform(0.3, 1.5) * bb
        fl = []
        for _ in range(int(rng.integers(1, 4))):
            f = _f0(rng)
            fl.append(f)
            x = x + 10 ** (rng.uniform(-25, 0) / 20) * _unit(_stack(rng, _wob(rng, n, f), rng.uniform(0.2, 1.0, int(rng.integers(1, 5)))))
        meta["lines"] = fl
    else:  # steady_combo
        a_, b_ = rng.choice(FAMILIES[:5], 2, replace=False)
        x1, m1 = gen(int(rng.integers(SEED0, SEED_END)), n, str(a_))
        x2, m2 = gen(int(rng.integers(SEED0, SEED_END)), n, str(b_))
        lvl = rng.uniform(-10, 10)
        x = x1 + 10 ** (lvl / 20) * x2
        meta.update(parts=[str(a_), str(b_)], second_db=lvl)
    return _unit(np.asarray(x, np.float64)), meta


def pack(n=2000):
    """<TRAIN>/synth_r4_train.i16 + .npz: n clips of U(15, 45) s, seeds SEED0 + i (int16 at 0.1 RMS, as pack.py)."""
    from tcommon import TRAIN
    path = os.path.join(TRAIN, "synth_r4_train.i16")
    off, ln, fam = [], [], []
    pos = 0
    with open(path + ".tmp", "wb") as f:
        for i in range(n):
            seed = SEED0 + i
            dur = float(np.random.default_rng(seed + 7_777_777).uniform(15, 45))
            x, m = gen(seed, int(dur * SR))
            q = np.clip(np.round(x * 0.1 * 32767), -32767, 32767).astype(np.int16)
            f.write(q.tobytes())
            off.append(pos); ln.append(len(q)); pos += len(q)
            fam.append(FAMILIES.index(m["family"]))
            if (i + 1) % 250 == 0:
                print(f"synth_r4: {i + 1}/{n}", flush=True)
    os.replace(path + ".tmp", path)
    np.savez(os.path.join(TRAIN, "synth_r4_train.npz"), off=np.array(off, np.int64), len=np.array(ln, np.int64), family=np.array(fam, np.int8),
             seed0=SEED0, families=np.array(FAMILIES))
    import collections
    print(f"synth_r4: {n} clips, {pos / SR / 3600:.2f} h; families {dict(collections.Counter(FAMILIES[k] for k in fam))}", flush=True)


if __name__ == "__main__":
    import sys
    from tcommon import args
    A = args()
    assert synth.SR == SR
    {"pack": lambda: pack(int(A.get("n", "2000")))}[sys.argv[1]]()
