# vsynth_r5.py — custom voice detector, round 5 (pre-registration
# measurements/voice-detector-round5-preregistration-2026-10-12.md §3.3 D7b):
# the TRAINING synthesizer of held phonation and hums. Deliberately NOT the
# validation synthesizer (r5/vsynth_val.py, the review's KLGLOTT88 model with
# fixed tables): a different glottal source, drawn tracts, drawn hum tract,
# different jitter / wander / vibrato processes. It never imports the
# validation generators (r5/selftest_r5.py checks that statically).
#
# Model (parameters fixed here before any round-5 training; never tuned on
# validation data):
#   source   Rosenberg-type glottal flow per cycle: opening 0.5 (1 - cos(pi t / Tp)),
#            closing cos(pi (t - Tp) / (2 Tn)) down to a residual, then an
#            exponential return phase (time constant ta = 2-8 % of the period);
#            open quotient OQ = (Tp + Tn) / T in 0.4-0.8, speed quotient
#            Tp / Tn in 1.2-3; flow derivative (lip radiation, vowels) or flow
#            through a low-pass (hums)
#   jitter   0.2-1.5 % per cycle (Gaussian, period); shimmer 1-6 % (amplitude)
#   wander   3-40 cents rms: an Ornstein-Uhlenbeck process (tau 0.3-2 s, 8/9 of
#            the variance) plus one slow sinusoid (0.05-0.4 Hz, 2/9)
#   vibrato  p 0.3: 4.5-6.5 Hz, 20-80 cents peak, rate drift +-0.2 Hz
#   breath   aspiration noise (high-passed white, gated by the open phase with a
#            floor of 0.2) at -40 ... -15 dB re the voiced source
#   tract    vowels: parallel-cascade of F1-F5, each drawn within +-15 % of the
#            /a e i o u/ table (adult male), bandwidths +-20 %, times the tract
#            scale; hums: a nasal pole at 200-300 Hz (bw 40-120 Hz), a zero at
#            600-1500 Hz (bw 80-300 Hz), F2-F4 of a drawn /u/-like tract at -15
#            ... -30 dB, then a one-pole low-pass at 400-900 Hz (lips closed)
#   scale    men 0.92-1.05, women 1.10-1.25
#   f0       log-uniform within a mixture: 40 % 75-130 Hz (male tract), 40 %
#            160-300 Hz (female tract), 20 % 130-160 or 300-420 Hz (either tract)
#   kind     hum 40 %, vowel 60 %; hold U(5, 60) s; onset 0.05-0.4 s, offset
#            0.1-0.5 s (raised-cosine ramps)
#   truth    10 ms F0 track, voiced where the source envelope is >= -30 dB of its
#            maximum (the source is on); 0 elsewhere
# Seeds: training only, [4e9, 5e9): hold i = 4e9 + i.
#
#   python scripts/voice-detector/train/vsynth_r5.py pack [--n=2000]
#       -> <TRAIN>/vsynth_r5_train.i16 (16 kHz, active RMS 0.1, as synth_r4_train)
#          + vsynth_r5_train.npz (off, len, f0 truth (concatenated 10 ms tracks: f0off, f0len, f0), meta)
import json
import os

import numpy as np
from scipy.signal import butter, lfilter, sosfilt

SR = 16000
SEED0 = 4_000_000_000
SEED_END = 5_000_000_000
TABLE = {  # adult male F1-F5 (Hz) and bandwidths (Hz): a textbook average, drawn +-15 % / +-20 % per hold
    "a": ([710, 1100, 2540, 3400, 4300], [90, 110, 160, 220, 280]),
    "e": ([530, 1840, 2480, 3450, 4300], [70, 110, 150, 220, 280]),
    "i": ([280, 2250, 2900, 3500, 4300], [50, 110, 160, 220, 280]),
    "o": ([500, 850, 2500, 3350, 4300], [80, 100, 160, 220, 280]),
    "u": ([320, 800, 2300, 3300, 4300], [60, 100, 160, 220, 280]),
}


def _res(x, f, bw, sr):
    r = np.exp(-np.pi * bw / sr)
    c = 2 * r * np.cos(2 * np.pi * f / sr)
    return lfilter([1 - c + r * r], [1, -c, r * r], x)


def _zero(x, f, bw, sr):
    r = np.exp(-np.pi * bw / sr)
    c = 2 * r * np.cos(2 * np.pi * f / sr)
    b = np.array([1, -c, r * r])
    return lfilter(b / b.sum(), [1], x)


def draw(seed):
    """The parameters of hold `seed` (training seeds only)."""
    assert SEED0 <= seed < SEED_END
    g = np.random.default_rng(seed)
    u = g.random()
    if u < 0.4:
        band, tract = (75.0, 130.0), "m"
    elif u < 0.8:
        band, tract = (160.0, 300.0), "f"
    else:
        band = (130.0, 160.0) if g.random() < 0.5 else (300.0, 420.0)
        tract = "m" if g.random() < 0.5 else "f"
    f0 = float(np.exp(g.uniform(np.log(band[0]), np.log(band[1]))))
    scale = float(g.uniform(0.92, 1.05) if tract == "m" else g.uniform(1.10, 1.25))
    kind = "hum" if g.random() < 0.4 else str(g.choice(list(TABLE)))
    P = {"seed": seed, "f0": f0, "band": list(band), "tract": tract, "scale": scale, "kind": kind,
         "dur": float(g.uniform(5.0, 60.0)), "onset": float(g.uniform(0.05, 0.4)), "offset": float(g.uniform(0.1, 0.5)),
         "oq": float(g.uniform(0.4, 0.8)), "sq": float(g.uniform(1.2, 3.0)), "ta": float(g.uniform(0.02, 0.08)),
         "jitter": float(g.uniform(0.002, 0.015)), "shimmer": float(g.uniform(0.01, 0.06)),
         "wander": float(g.uniform(3.0, 40.0)), "wander_tau": float(g.uniform(0.3, 2.0)),
         "slow_hz": float(g.uniform(0.05, 0.4)), "asp_db": float(g.uniform(-40.0, -15.0)),
         "vib": [float(g.uniform(4.5, 6.5)), float(g.uniform(20.0, 80.0))] if g.random() < 0.3 else None}
    if kind == "hum":
        P["nasal"] = {"pole": float(g.uniform(200, 300)), "pole_bw": float(g.uniform(40, 120)), "zero": float(g.uniform(600, 1500)),
                      "zero_bw": float(g.uniform(80, 300)), "upper_db": [float(g.uniform(-30, -15)) for _ in range(3)],
                      "upper": [float(f * g.uniform(0.85, 1.15)) for f in TABLE["u"][0][1:4]], "lp": float(g.uniform(400, 900))}
    else:
        F, B = TABLE[kind]
        P["formants"] = [float(f * g.uniform(0.85, 1.15)) for f in F]
        P["bws"] = [float(b * g.uniform(0.8, 1.2)) for b in B]
    return P


def f0_contour(P, n, sr, g):
    t = np.arange(n) / sr
    # OU wander at 100 Hz control rate, plus a slow sinusoid (a third of the rms)
    m = n // (sr // 100) + 2
    a = np.exp(-0.01 / P["wander_tau"])
    w = lfilter([np.sqrt(1 - a * a)], [1, -a], g.standard_normal(m))
    w = np.interp(t, np.arange(m) * 0.01, w)
    w = w / (w.std() + 1e-9)
    cents = P["wander"] * (np.sqrt(8 / 9) * w + np.sqrt(2 / 9) * np.sqrt(2) * np.sin(2 * np.pi * P["slow_hz"] * t + g.uniform(0, 2 * np.pi)))
    if P["vib"]:
        rate = P["vib"][0] + 0.2 * np.sin(2 * np.pi * 0.15 * t + g.uniform(0, 2 * np.pi))
        cents = cents + P["vib"][1] * np.sin(2 * np.pi * np.cumsum(rate) / sr + g.uniform(0, 2 * np.pi))
    return P["f0"] * 2 ** (cents / 1200)


def synth(seed, sr=SR):
    """(x float64 at sr, active RMS 1; truth (t0 0, hop 0.01, f0[]); params)."""
    P = draw(seed)
    g = np.random.default_rng(seed + 1)
    n = int(P["dur"] * sr)
    f = f0_contour(P, n, sr, g)
    # cycle boundaries with jitter / shimmer
    st, per, amp = [], [], []
    t = 0.0
    while t < n:
        T = sr / f[min(int(t), n - 1)] * (1 + P["jitter"] * g.standard_normal())
        st.append(t); per.append(T); amp.append(1 + P["shimmer"] * g.standard_normal())
        t += T
    st, per, amp = np.array(st), np.array(per), np.array(amp)
    i = np.arange(n, dtype=np.float64)
    c = np.searchsorted(st, i, side="right") - 1
    ph = (i - st[c]) / per[c]                               # 0..1 within the cycle
    oq, sq, ta = P["oq"], P["sq"], P["ta"]
    tp, tn = oq * sq / (1 + sq), oq / (1 + sq)
    flow = np.where(ph < tp, 0.5 * (1 - np.cos(np.pi * ph / tp)),
                    np.where(ph < tp + tn, np.cos(np.pi * (ph - tp) / (2 * tn)) * 0.97 + 0.03, 0.03 * np.exp(-(ph - tp - tn) / ta)))
    flow = flow * amp[c]
    opn = (ph < tp + tn).astype(np.float64)
    src = np.diff(flow, prepend=flow[0]) * sr / P["f0"]    # flow derivative, roughly unit scale
    src /= np.sqrt(np.mean(src ** 2)) + 1e-12
    asp = sosfilt(butter(2, 500, "highpass", fs=sr, output="sos"), g.standard_normal(n)) * (0.2 + 0.8 * opn)
    asp *= 10 ** (P["asp_db"] / 20) / (np.sqrt(np.mean(asp ** 2)) + 1e-12)
    s = P["scale"]
    if P["kind"] == "hum":
        N = P["nasal"]
        e = flow / (np.sqrt(np.mean(flow ** 2)) + 1e-12) + asp
        y = _res(e, N["pole"] * s, N["pole_bw"], sr)
        y = _zero(y, N["zero"] * s, N["zero_bw"], sr)
        up = np.zeros(n)
        for F, db in zip(N["upper"], N["upper_db"]):
            if F * s < 0.45 * sr:
                up += 10 ** (db / 20) * _res(e, F * s, 0.12 * F * s, sr)
        y = y + up
        a = np.exp(-2 * np.pi * N["lp"] / sr)
        y = lfilter([1 - a], [1, -a], y)
    else:
        y = src + asp
        for F, B in zip(P["formants"], P["bws"]):
            if F * s < 0.45 * sr:
                y = _res(y, F * s, B * np.sqrt(s), sr)
    # raised-cosine onset / offset
    env = np.ones(n)
    no, nf = int(P["onset"] * sr), int(P["offset"] * sr)
    if no:
        env[:no] = 0.5 - 0.5 * np.cos(np.pi * np.arange(no) / no)
    if nf:
        env[-nf:] = 0.5 + 0.5 * np.cos(np.pi * np.arange(nf) / nf)
    y = y * env
    act = np.abs(y) > 0.02 * np.abs(y).max()
    y = y / (np.sqrt(np.mean(y[act] ** 2)) + 1e-12)
    tt = np.arange(0, n / sr, 0.01)
    k = np.minimum(np.round(tt * sr).astype(int), n - 1)
    ft = np.where(env[k] >= 10 ** (-30 / 20), f[k] , 0.0).astype(np.float32)
    return y, (0.0, 0.01, ft), P


def pack(n=2000):
    """<TRAIN>/vsynth_r5_train.i16 + .npz: holds seeds SEED0 + i (int16 at active RMS 0.1, 16 kHz)."""
    from tcommon import TRAIN
    path = os.path.join(TRAIN, "vsynth_r5_train.i16")
    off, ln, f0off, f0len, f0s, meta = [], [], [], [], [], []
    pos = fpos = 0
    with open(path + ".tmp", "wb") as fh:
        for i in range(n):
            x, (_, _, ft), P = synth(SEED0 + i)
            q = np.clip(np.round(x * 0.1 * 32767), -32767, 32767).astype(np.int16)
            fh.write(q.tobytes())
            off.append(pos); ln.append(len(q)); pos += len(q)
            f0off.append(fpos); f0len.append(len(ft)); fpos += len(ft); f0s.append(ft)
            meta.append({k: P[k] for k in ("seed", "f0", "band", "tract", "scale", "kind", "dur", "vib")})
            if (i + 1) % 250 == 0:
                print(f"vsynth_r5: {i + 1}/{n}", flush=True)
    os.replace(path + ".tmp", path)
    np.savez(os.path.join(TRAIN, "vsynth_r5_train.npz"), off=np.array(off, np.int64), len=np.array(ln, np.int64),
             f0off=np.array(f0off, np.int64), f0len=np.array(f0len, np.int64), f0=np.concatenate(f0s).astype(np.float32),
             meta=np.array(json.dumps(meta)), seed0=SEED0)
    import collections
    S = {"holds": n, "hours": round(pos / SR / 3600, 2),
         "by_tract": dict(collections.Counter(m["tract"] for m in meta)), "by_kind": dict(collections.Counter("hum" if m["kind"] == "hum" else "vowel" for m in meta)),
         "by_band": dict(collections.Counter(f"{m['band'][0]:.0f}-{m['band'][1]:.0f}" for m in meta)),
         "vibrato": sum(m["vib"] is not None for m in meta)}
    print("vsynth_r5:", json.dumps(S), flush=True)
    return S


if __name__ == "__main__":
    import sys
    from tcommon import args
    A = args()
    {"pack": lambda: pack(int(A.get("n", "2000")))}[sys.argv[1]]()
