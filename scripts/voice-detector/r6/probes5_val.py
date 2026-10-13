# probes5_val.py — custom voice detector, round 6 (pre-registration
# measurements/voice-detector-round6-preregistration-2026-10-13.md §2.2,
# §2.3): the round-5 voice-safety review's probe screens S1, S1b, S2, S2b, S3
# and S4 as VALIDATION rows. specs() and make() are the review's screen5.py
# (sha256 026c3c1d060466ae06c1803cf81731c60e0910248d0cf595e3038fb71a5db34d,
# lines 35-37 and 89-171) ported UNCHANGED, except that specs() takes the
# screen's name as an argument instead of reading it from the command line
# (`S_ = A["set"]` -> `S_ = set_name`). The model-scoring code of screen5.py
# (run, export) is not ported: this module only renders.
#
# NEVER used for training (r6/selftest_r6.py).
import itertools

import numpy as np
from scipy.signal import butter, sosfilt

from lfsynth_val import synth
from mach5_val import bed
from micsim_val import agc_only, phone2, phone_eq

REAL6 = ["144046", "530917", "830089", "201788", "848181", "785127"]
SYN6 = ["twofan", "aqpump", "microwave", "caridle", "washer", "ballast"]
VM = [("m", f) for f in (82, 92, 102, 112, 125)] + [("f", f) for f in (175, 215, 255, 290)]


def specs(set_name):
    S_ = set_name
    out = []
    if S_ == "S1":     # low hums / held vowels next to unseen machines, 0 / +10 / +20 dB, 48 kHz flat, 20 s lead, 15 s hold
        for (sex, f0), kind, q in itertools.product(VM, ("hum", "a"), ("modal", "breathy")):
            for b, snr in [("clean", None)] + [(b, s) for b in SYN6 + REAL6 for s in (0, 10, 20)]:
                out.append(dict(sex=sex, f0=f0, kind=kind, q=q, bed=b, snr=snr, sr=48000, eq="flat", dur=15.0, lead=20.0))
    elif S_ == "S1b":  # device variants at +10 dB (modal only, to bound run time)
        for (sex, f0), kind, q in itertools.product(VM, ("hum", "a"), ("modal",)):
            for b, (sr, eq) in itertools.product(["twofan", "aqpump", "microwave", "144046", "530917", "201788"],
                                                 [(48000, "phone"), (48000, "phone2agc"), (16000, "flat")]):
                out.append(dict(sex=sex, f0=f0, kind=kind, q=q, bed=b, snr=10, sr=sr, eq=eq, dur=15.0, lead=20.0))
    elif S_ in ("S2", "S2b"):   # long holds 90 / 120 s (S2) or 6 x 18 s with 2.5 s breaths (S2b)
        vs = [("m", 85), ("m", 100), ("m", 118), ("f", 195), ("f", 250)]
        conds = ([("clean", None), ("twofan", 10), ("aqpump", 10), ("144046", 10), ("848181", 10), ("microwave", 20), ("washer", 0), ("530917", 0)]
                 if S_ == "S2" else [("clean", None), ("twofan", 10), ("144046", 10), ("aqpump", 0)])
        i = 0
        for (sex, f0), kind, vib in itertools.product(vs, ("hum", "a"), (False, True)):
            for b, snr in conds:
                d = (90.0 if i % 2 == 0 else 120.0) if S_ == "S2" else 6 * 18 + 5 * 2.5
                out.append(dict(sex=sex, f0=f0, kind=kind, q="modal" if (i // 2) % 2 == 0 else "soft", vib=vib, bed=b, snr=snr,
                                sr=[48000, 44100][i % 2], eq="flat" if i % 3 else "phone2agc", dur=d, lead=20.0, rep=S_ == "S2b",
                                wander=8.0))
            i += 1
    elif S_ == "S4":   # targeted follow-up of the S2 decay case: 120 s holds, +10 dB, mic EQ / AGC factors, both sexes
        vs = [("m", 85), ("m", 100), ("f", 195), ("f", 250)]
        kinds = [("a", "soft", True), ("a", "soft", False), ("hum", "modal", False)]
        for (sex, f0), (kind, q, vib), (b, snr), eq in itertools.product(vs, kinds, [("clean", None), ("aqpump", 10), ("twofan", 10), ("144046", 10)],
                                                                          ["flat", "phone2", "agc", "phone2agc"]):
            out.append(dict(sex=sex, f0=f0, kind=kind, q=q, vib=vib, bed=b, snr=snr, sr=44100, eq=eq, dur=120.0, lead=20.0, wander=8.0,
                            seed=90000 + 100 * f0 + 10 * kinds.index((kind, q, vib)) + ["clean", "aqpump", "twofan", "144046"].index(b)))
    elif S_ == "S3":   # SOVT warm-ups
        conds = [("clean", None), ("twofan", 10), ("microwave", 10), ("530917", 10), ("144046", 0), ("aqpump", 0)]
        for sex, ex, seed in itertools.product(("m", "f"), ("liptrill", "tongtrill", "straw", "humsiren", "ngslide"), (1, 2)):
            for b, snr in conds:
                out.append(dict(sex=sex, ex=ex, seed=seed, bed=b, snr=snr, sr=48000, eq="flat", dur=16.0, lead=20.0))
    for i, s in enumerate(out):
        s["i"] = i
    return out


def make(s):
    sr = s["sr"]
    seed = s.get("seed", 1000 + s["i"] * 7)
    segs = None
    if s.get("ex"):
        sex = s["sex"]; lo, hi = (85.0, 260.0) if sex == "m" else (170.0, 380.0)
        ex = s["ex"]; f0 = lo * 1.25 if ex in ("liptrill", "tongtrill", "straw") else lo
        kw = dict(sex=sex, seed=seed, lead=s["lead"], wander_cents=10.0)
        if ex == "liptrill":
            x, tr = synth(sr, s["dur"], f0, vowel="hum", qual="breathy", am=(25.0, 0.85), **kw)
        elif ex == "tongtrill":
            x, tr = synth(sr, s["dur"], f0, vowel="a", qual="modal", am=(30.0, 0.6), **kw)
        elif ex == "straw":
            x, tr = synth(sr, s["dur"], f0, vowel="u", qual="soft", **kw)
            x = (sosfilt(butter(4, 700, "lowpass", fs=sr, output="sos"), x.astype(np.float64))).astype(np.float32)
            x = x * np.float32(10 ** (-6 / 20))
        else:   # sirens: up and down 1.5 octaves over 4 s, three times with 1 s gaps
            per = 5.0
            g = lambda tt: (hi / lo) ** (0.5 - 0.5 * np.cos(2 * np.pi * np.clip(tt % per, 0, 4.0) / 4.0))
            segs = [(k * per, 4.0) for k in range(3)]
            x, tr = synth(sr, s["dur"], lo, vowel="hum" if ex == "humsiren" else "u", qual="modal", glide=g, segs=segs, **kw)
        f0v = f0
    else:
        if s.get("rep"):
            segs = [(k * 20.5, 18.0) for k in range(6)]
        x, tr = synth(sr, s["dur"], s["f0"], sex=s["sex"], vowel=s["kind"], qual=s["q"], seed=seed, lead=s["lead"],
                      wander_cents=s.get("wander", 15.0), vib=(5.4, 45.0) if s.get("vib") else None, segs=segs)
        f0v = s["f0"]
    x = x.astype(np.float64)
    n = len(x)
    if s["bed"] != "clean":
        nz = bed(s["bed"], sr, n / sr + 0.01, seed=seed + 1)[:n]
        x = x + nz * 10 ** ((-26 - s["snr"]) / 20)
    if s["eq"] == "phone":
        x = phone_eq(x, sr)
    elif s["eq"] == "phone2agc":
        x = phone2(x, sr)
    elif s["eq"] == "phone2":
        x = phone2(x, sr, agc=False)
    elif s["eq"] == "agc":
        x = phone2(x, sr, agc=True) if False else agc_only(x, sr)
    return np.clip(x, -1, 1).astype(np.float32), tr, segs, f0v

