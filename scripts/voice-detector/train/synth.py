# synth.py — custom voice detector, training step (2026-10-06): the synthetic
# interferers and room impulse responses of the pre-registration (§1.2,
# splits.json negatives.synthetic / reverb). Generated in process, seeded:
# training uses seeds [0, 1e9), validation seeds [1e9, 1e9 + 2000).
#
# Families (ported in spirit from scripts/noise-synth.js and the
# scripts/notch-adversarial int / r2int / vmach generators, with their
# parameters drawn at random instead of fixed grids):
#   hum1      single hum 40-460 Hz, optional slow wobble
#   hum       harmonic hum 40-460 Hz, 2-16 partials, random spectrum + wobble
#   mains     50 / 60 Hz complex, up to 10 harmonics (a prominent 3rd at times)
#   fan       harmonic hum over one-pole low-passed rumble (fan-hum, humGen)
#   vmach     voice-like machine: harmonic stack whose speed wobbles at
#             0.5-8 Hz by 3-10 c (sinusoid) or OU (tau 0.1-0.3 s), SHARED by
#             every partial (vmach.mjs)
#   beat      beating pair (two fans 0.2-3 Hz apart; 1:1 or 2:1)
#   am        amplitude-modulated hum (0.1-10 Hz, depth 0.2-0.9)
#   ramp      drift / step / spin-up of the hum frequency (and level)
#   intermit  a hum switched off for 0.15-1 s every 3-10 s (20 ms ramps)
#   noise     white / pink / brown / sleep (low-passed brown) / resonant
#             noise (band-pass 100-2000 Hz, Q 2-20)
#   crickets  pulsed 3-6 kHz chirp trains; cicadas: band noise with rough AM
#   birdies   sleep noise + faint stable lines (codec birdies)
#   combo     a hum family + a broadband family at -10..+15 dB
# Every clip is unit RMS (the mixer applies levels).
import numpy as np
from scipy.signal import lfilter

SR = 16000
FAMILIES = ["hum1", "hum", "mains", "fan", "vmach", "beat", "am", "ramp", "intermit", "noise", "crickets", "birdies", "combo"]
# draw weights (voice-like / tonal machine families emphasised)
WEIGHTS = np.array([0.05, 0.13, 0.07, 0.1, 0.14, 0.06, 0.06, 0.07, 0.06, 0.08, 0.04, 0.04, 0.10])
WEIGHTS = WEIGHTS / WEIGHTS.sum()
TONAL = {"hum1", "hum", "mains", "fan", "vmach", "beat", "am", "ramp", "intermit"}


def _unit(x):
    r = float(np.sqrt(np.mean(np.square(x, dtype=np.float64))))
    return (x / r if r > 0 else x).astype(np.float32)


def _ou(rng, n, tau, sd):
    """Ornstein-Uhlenbeck process at SR (cents), stationary sd."""
    a = np.exp(-1.0 / (tau * SR))
    w = rng.standard_normal(n) * sd * np.sqrt(1 - a * a)
    y = lfilter([1.0], [1.0, -a], w)
    return y


def _stack(rng, f_of_t, amps, phases=None):
    """Harmonic stack sharing one rotating phase: sum_k a_k sin((k+1) ph + phi_k)."""
    ph = 2 * np.pi * np.cumsum(f_of_t) / SR
    if phases is None:
        phases = rng.uniform(0, 2 * np.pi, len(amps))
    x = np.zeros(len(f_of_t))
    for k, a in enumerate(amps):
        if a <= 0:
            continue
        # partials above 7.8 kHz would alias
        fk = (k + 1) * f_of_t
        x += a * np.sin((k + 1) * ph + phases[k]) * (fk < 7800)
    return x


def _amps(rng, kmax):
    k = rng.integers(2, kmax + 1)
    shape = rng.choice(["decay", "flat", "rand", "odd"])
    i = np.arange(k)
    if shape == "decay":
        a = rng.uniform(0.5, 0.95) ** i
    elif shape == "flat":
        a = np.ones(k) * rng.uniform(0.6, 1.0, k)
    elif shape == "odd":
        a = np.where(i % 2 == 0, 1.0, rng.uniform(0.05, 0.3)) * rng.uniform(0.7, 0.95) ** i
    else:
        a = rng.uniform(0.05, 1.0, k)
    if rng.random() < 0.3:  # a missing / weak fundamental
        a[0] *= rng.uniform(0.0, 0.3)
    return a


def _wobble(rng, n, f0, depth_frac=None):
    t = np.arange(n) / SR
    d = depth_frac if depth_frac is not None else rng.uniform(0, 0.006)
    r1, r2 = rng.uniform(0.02, 0.3), rng.uniform(0.05, 0.5)
    return f0 * (1 + d * np.sin(2 * np.pi * r1 * t + rng.uniform(0, 6.3)) + 0.3 * d * np.sin(2 * np.pi * r2 * t + rng.uniform(0, 6.3)))


def _white(rng, n):
    return rng.standard_normal(n)


def _pink(rng, n):
    w = rng.standard_normal(n)
    b = [0.049922035, -0.095993537, 0.050612699, -0.004408786]
    a = [1, -2.494956002, 2.017265875, -0.522189400]
    return lfilter(b, a, w)


def _brown(rng, n):
    return lfilter([1.0], [1.0, -0.999], rng.standard_normal(n))


def _rumble(rng, n, fc=None):
    fc = fc or rng.uniform(80, 300)
    a = 1 - np.exp(-2 * np.pi * fc / SR)
    return lfilter([a], [1, -(1 - a)], rng.standard_normal(n))


def _resonant(rng, n):
    f = rng.uniform(100, 2000)
    q = rng.uniform(2, 20)
    w0 = 2 * np.pi * f / SR
    al = np.sin(w0) / (2 * q)
    b = [al, 0, -al]
    a = [1 + al, -2 * np.cos(w0), 1 - al]
    w = rng.standard_normal(n)
    return _unit(lfilter(b, a, w)) + rng.uniform(0, 0.3) * w


def _broadband(rng, n):
    kind = rng.choice(["white", "pink", "brown", "sleep", "resonant"], p=[0.15, 0.3, 0.2, 0.15, 0.2])
    if kind == "white":
        x = _white(rng, n)
    elif kind == "pink":
        x = _pink(rng, n)
    elif kind == "brown":
        x = _brown(rng, n)
    elif kind == "sleep":
        x = _brown(rng, n)
        a = 1 - np.exp(-2 * np.pi * rng.uniform(150, 600) / SR)
        x = lfilter([a], [1, -(1 - a)], x)
    else:
        x = _resonant(rng, n)
    return _unit(x), str(kind)


def _f0(rng, lo=40.0, hi=460.0):
    # log-uniform, with 1/3 of the draws inside the 75-400 Hz display band's
    # densest machine region (80-250 Hz)
    if rng.random() < 0.35:
        return float(np.exp(rng.uniform(np.log(80), np.log(250))))
    return float(np.exp(rng.uniform(np.log(lo), np.log(hi))))


def _gate(rng, n, on_lo=3.0, on_hi=10.0, off_lo=0.15, off_hi=1.0):
    g = np.ones(n)
    t = rng.uniform(0.5, on_hi)
    fade = int(0.02 * SR)
    while t * SR < n:
        a = int(t * SR)
        b = min(n, int((t + rng.uniform(off_lo, off_hi)) * SR))
        g[a:b] = 0
        for i in range(fade):
            if a - i - 1 >= 0:
                g[a - i - 1] = min(g[a - i - 1], (i + 1) / fade)
            if b + i < n:
                g[b + i] = min(g[b + i], (i + 1) / fade)
        t = b / SR + rng.uniform(on_lo, on_hi)
    return g


def gen(seed, n, family=None):
    """One unit-RMS interferer clip of n samples at 16 kHz. Returns (x, meta)."""
    rng = np.random.default_rng(seed)
    fam = family or str(rng.choice(FAMILIES, p=WEIGHTS))
    t = np.arange(n) / SR
    meta = {"family": fam, "seed": int(seed)}
    if fam == "hum1":
        f = _f0(rng)
        x = np.sin(2 * np.pi * np.cumsum(_wobble(rng, n, f)) / SR + rng.uniform(0, 6.3))
        meta["f0"] = f
    elif fam == "hum":
        f = _f0(rng)
        x = _stack(rng, _wobble(rng, n, f), _amps(rng, 16))
        meta["f0"] = f
    elif fam == "mains":
        f = float(rng.choice([50.0, 60.0])) * (1 + rng.uniform(-0.003, 0.003))
        k = rng.integers(3, 11)
        a = rng.uniform(0.1, 1.0, k)
        if rng.random() < 0.5:
            a[2] = max(a) * rng.uniform(1.0, 1.5)
        x = _stack(rng, np.full(n, f), a)
        meta["f0"] = f
    elif fam == "fan":
        f = _f0(rng, 60, 300)
        x = _unit(_stack(rng, _wobble(rng, n, f), _amps(rng, 6))) + rng.uniform(0.3, 3.0) * _unit(_rumble(rng, n))
        meta["f0"] = f
    elif fam == "vmach":
        f = _f0(rng, 70, 420)
        if rng.random() < 0.6:
            rate, dc = rng.uniform(0.5, 8.0), rng.uniform(3, 10)
            cents = dc * np.sin(2 * np.pi * rate * t + rng.uniform(0, 6.3))
            meta.update(fm="sin", rate=rate, cents=dc)
        else:
            sd = rng.uniform(3, 10)
            cents = _ou(rng, n, rng.uniform(0.1, 0.3), sd)
            meta.update(fm="ou", cents=sd)
        amps = _amps(rng, 8) if rng.random() < 0.6 else np.array([1, 0.5, 0.3])
        x = _stack(rng, f * 2 ** (cents / 1200), amps)
        if rng.random() < 0.5:
            x = _unit(x) + rng.uniform(0.02, 0.4) * _white(rng, n)
        meta["f0"] = f
    elif fam == "beat":
        f = _f0(rng, 60, 300)
        d = rng.uniform(0.2, 3.0)
        r = 2.0 if rng.random() < 0.4 else 1.0
        x = _stack(rng, np.full(n, f), _amps(rng, 4)) + rng.uniform(0.4, 1.0) * _stack(rng, np.full(n, r * f + d), _amps(rng, 4))
        if rng.random() < 0.5:
            x = _unit(x) + rng.uniform(0.2, 2.0) * _unit(_rumble(rng, n))
        meta["f0"] = f
    elif fam == "am":
        f = _f0(rng)
        rate, depth = float(np.exp(rng.uniform(np.log(0.1), np.log(10)))), rng.uniform(0.2, 0.9)
        x = _stack(rng, _wobble(rng, n, f), _amps(rng, 8)) * (1 - depth * (0.5 + 0.5 * np.sin(2 * np.pi * rate * t)))
        meta.update(f0=f, am_rate=rate)
    elif fam == "ramp":
        f = _f0(rng, 60, 380)
        kind = rng.choice(["drift", "step", "spinup"])
        if kind == "drift":
            ff = f * (1 + rng.uniform(-0.05, 0.05) * t / max(t[-1], 1e-9))
            g = np.ones(n)
        elif kind == "step":
            ff = np.full(n, f)
            tt = rng.uniform(0.5, 4)
            while tt < t[-1]:
                ff[int(tt * SR):] *= 1 + rng.uniform(-0.06, 0.06)
                tt += rng.uniform(1, 8)
            g = np.ones(n)
        else:
            t1, R = rng.uniform(0, 3), rng.uniform(1, 5)
            u = np.clip((t - t1) / R, 0, 1)
            ff = f * (0.3 + 0.7 * (1 - np.exp(-4 * u)) / (1 - np.exp(-4)))
            g = 10 ** (-rng.uniform(6, 14) * (1 - u) / 20)
        x = _stack(rng, ff, _amps(rng, 8)) * g
        meta.update(f0=f, ramp=str(kind))
    elif fam == "intermit":
        f = _f0(rng, 60, 300)
        x = _stack(rng, _wobble(rng, n, f), _amps(rng, 8)) * _gate(rng, n)
        x = x + 1e-3 * rng.standard_normal(n)
        meta["f0"] = f
    elif fam == "noise":
        x, k = _broadband(rng, n)
        meta["kind"] = k
    elif fam == "crickets":
        if rng.random() < 0.5:
            fc, gp, pr, npul = rng.uniform(3000, 6000), SR / rng.uniform(1.5, 4), SR / rng.uniform(30, 80), rng.integers(4, 12)
            i = np.arange(n) + rng.integers(0, int(gp))
            g_pos = i % gp
            p_pos = g_pos % pr
            on = (g_pos < pr * npul) & (p_pos < 0.55 * pr)
            env = np.sin(np.pi * np.clip(p_pos / (0.55 * pr), 0, 1)) * on
            x = env * np.sin(2 * np.pi * (fc + 40 * np.sin(2 * np.pi * 6 * t)) * t)
            meta["kind"] = "crickets"
        else:
            w = rng.standard_normal(n)
            hi = lfilter([0.88], [1, -0.12], w)
            lo = lfilter([0.55], [1, -0.45], w)
            x = (hi - lo) * (0.55 + 0.45 * np.maximum(0, np.sin(2 * np.pi * rng.uniform(60, 140) * t))) * (0.75 + 0.25 * np.sin(2 * np.pi * rng.uniform(0.3, 1.5) * t))
            meta["kind"] = "cicadas"
    elif fam == "birdies":
        x = _brown(rng, n)
        a = 1 - np.exp(-2 * np.pi * 300 / SR)
        x = _unit(lfilter([a], [1, -(1 - a)], x))
        for _ in range(rng.integers(1, 4)):
            x = x + rng.uniform(0.04, 0.2) * np.sin(2 * np.pi * rng.uniform(70, 600) * t + rng.uniform(0, 6.3))
    else:  # combo
        sub = str(rng.choice(["hum", "fan", "vmach", "mains", "beat", "am"]))
        h, m1 = gen(int(rng.integers(0, 2**31)) + seed % 7, n, sub)
        b, k = _broadband(rng, n)
        snr = rng.uniform(-10, 15)
        x = h + 10 ** (-snr / 20) * b
        meta.update(sub=sub, f0=m1.get("f0"), bb=k, tonal_snr=snr)
    return _unit(np.asarray(x, np.float64)), meta


# ----------------------------------------------------------------------------- RIRs
def rir(seed, max_len=SR):
    """Shoebox room impulse response: image method for the early part (order
    <= 6) + an exponentially decaying noise tail matched to the RT60.
    Normalised to a unit direct path. Returns (h float32, meta)."""
    rng = np.random.default_rng(seed)
    L = np.array([rng.uniform(2.5, 10), rng.uniform(2.5, 8), rng.uniform(2.3, 4)])
    rt60 = float(rng.uniform(0.12, 0.9))
    V, S = L.prod(), 2 * (L[0] * L[1] + L[0] * L[2] + L[1] * L[2])
    alpha = min(0.95, 0.161 * V / (S * rt60))
    beta = np.sqrt(1 - alpha)
    src = rng.uniform(0.3, 1, 3) * (L - 0.6) + 0.3
    mic = rng.uniform(0.3, 1, 3) * (L - 0.6) + 0.3
    if rng.random() < 0.5:  # close-talking: mic 0.1-1 m from the source
        d = rng.normal(size=3)
        d /= np.linalg.norm(d)
        mic = np.clip(src + d * rng.uniform(0.1, 1.0), 0.1, L - 0.1)
    c = 343.0
    N = 6
    j = np.arange(-N, N + 1)
    pts, nref = [], []
    for ax in range(3):
        J, P = np.meshgrid(j, [0, 1], indexing="ij")
        pts.append(((1 - 2 * P) * src[ax] + 2 * J * L[ax]).ravel())
        nref.append(np.abs(2 * J - P).ravel())
    X, Y, Z = np.meshgrid(pts[0], pts[1], pts[2], indexing="ij")
    NX, NY, NZ = np.meshgrid(nref[0], nref[1], nref[2], indexing="ij")
    nr = (NX + NY + NZ).ravel()
    keep = nr <= 2 * N
    dist = np.sqrt((X.ravel() - mic[0]) ** 2 + (Y.ravel() - mic[1]) ** 2 + (Z.ravel() - mic[2]) ** 2)[keep]
    amp = beta ** nr[keep] / np.maximum(dist, 0.05)
    k = np.round(dist / c * SR).astype(np.int64)
    ok = k < max_len
    h = np.zeros(max_len)
    np.add.at(h, k[ok], amp[ok])
    d0 = np.linalg.norm(src - mic)
    k0 = int(round(d0 / c * SR))
    h /= 1.0 / max(d0, 0.05)
    # late tail: decaying noise from the end of the early part
    kt = int(min(max_len - 1, k0 + 0.03 * SR))
    tt = np.arange(max_len - kt) / SR
    env = np.exp(-6.9078 * tt / rt60)
    e_early = float(np.sum(h[k0 + 1:kt] ** 2)) / max(kt - k0 - 1, 1)
    tail = rng.standard_normal(max_len - kt) * env * np.sqrt(max(e_early, 1e-6)) * rng.uniform(0.5, 1.5)
    h[kt:] += tail
    # air absorption-ish: gentle low-pass of the tail
    h[kt:] = lfilter([0.6], [1, -0.4], h[kt:])
    # trim where the envelope is 60 dB down
    end = min(max_len, k0 + int(rt60 * SR) + 1)
    h = h[:end]
    h = np.concatenate([h[k0:], np.zeros(0)])  # start at the direct path (no pre-delay)
    return h.astype(np.float32), {"rt60": rt60, "room": L.round(2).tolist(), "dist": float(d0)}
