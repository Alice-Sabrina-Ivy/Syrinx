"""Validity manipulations: pitch-only, formant-only, raised-pitch formant, combined.

Two engines, so engine artifacts can be separated from candidate behaviour:
  praat  pitch-only  : To Manipulation -> pitch tier x 2^(st/12) -> overlap-add (PSOLA)
         formant/both: "Change gender" (formant shift ratio = fs; new pitch median =
                       0 [keep] or source median x 2^(st/12); range factor 1; duration 1)
  world  pyworld harvest / cheaptrick / d4c -> f0 x 2^(st/12); spectral envelope AND
         aperiodicity warped on the frequency axis: S'(f) = S(f / fs) -> synthesize.

Every condition is compared against a same-engine reference, never the raw original:
  praat pitch            vs ref_psola (PSOLA at x1.0)
  praat formant/combo    vs ref_cg    (Change gender at ratio 1.0, pitch kept)
  praat hi8_f*           vs hi8_f1.00 (Change gender +8 st, ratio 1.0)
  world *                vs ref       (WORLD analysis/synthesis, no change)
  world hi8_f*           vs hi8_f1.00
Outputs are RMS-matched to the source crop, then peak-limited (gain recorded).
"""
import numpy as np
import parselmouth
from parselmouth.praat import call
from .paths import SR
from .audio import rms

PITCH_ST = [-12, -8, -4, 4, 8, 12]
FSCALES = [0.85, 0.90, 0.95, 1.05, 1.10, 1.15]
HI_ST = 8
HI_FS = [0.95, 1.00, 1.05, 1.10]
COMBO = {"m": [(4, 1.05), (8, 1.10), (12, 1.15)],      # male -> female-like
         "f": [(-4, 0.95), (-8, 0.90), (-12, 0.85)]}   # female -> male-like


def conditions(sex):
    """List of condition dicts for a source of the given adult sex ('m'/'f')."""
    out = [dict(engine="none", cond="orig", kind="orig", st=0, fs=1.0, ref="")]
    for eng in ("praat", "world"):
        pref = "ref_psola" if eng == "praat" else "ref"
        fref = "ref_cg" if eng == "praat" else "ref"
        if eng == "praat":
            out.append(dict(engine=eng, cond="ref_psola", kind="ref", st=0, fs=1.0, ref="orig"))
            out.append(dict(engine=eng, cond="ref_cg", kind="ref", st=0, fs=1.0, ref="orig"))
        else:
            out.append(dict(engine=eng, cond="ref", kind="ref", st=0, fs=1.0, ref="orig"))
        for st in PITCH_ST:
            out.append(dict(engine=eng, cond=f"p{st:+d}", kind="pitch", st=st, fs=1.0, ref=pref))
        for fs in FSCALES:
            out.append(dict(engine=eng, cond=f"f{fs:.2f}", kind="formant", st=0, fs=fs, ref=fref))
        for fs in HI_FS:
            if fs == 1.0:
                out.append(dict(engine=eng, cond=f"hi{HI_ST}_f1.00", kind="hiref", st=HI_ST, fs=1.0, ref=fref))
            else:
                out.append(dict(engine=eng, cond=f"hi{HI_ST}_f{fs:.2f}", kind="hi", st=HI_ST, fs=fs,
                                ref=f"hi{HI_ST}_f1.00"))
        for st, fs in COMBO[sex]:
            out.append(dict(engine=eng, cond=f"{'mf' if sex == 'm' else 'fm'}{st:+d}_f{fs:.2f}", kind="combo",
                            st=st, fs=fs, ref=fref))
    return out


def _fit_len(y, n):
    y = np.asarray(y, np.float64)
    return y[:n] if len(y) >= n else np.pad(y, (0, n - len(y)))


def praat_variant(x, c, floor, ceil, med):
    snd = parselmouth.Sound(np.asarray(x, np.float64), SR)
    if c["kind"] == "pitch" or c["cond"] == "ref_psola":
        man = call(snd, "To Manipulation", 0.01, floor, ceil)
        pt = call(man, "Extract pitch tier")
        call(pt, "Multiply frequencies", snd.xmin, snd.xmax, 2.0 ** (c["st"] / 12.0))
        call([pt, man], "Replace pitch tier")
        out = call(man, "Get resynthesis (overlap-add)")
    else:
        newmed = 0.0 if c["st"] == 0 else med * 2.0 ** (c["st"] / 12.0)
        out = call(snd, "Change gender", floor, ceil, float(c["fs"]), float(newmed), 1.0, 1.0)
    return _fit_len(out.values[0], len(x))


class WorldAnalysis:
    def __init__(self, x, floor, ceil):
        import pyworld as pw
        self.pw = pw
        x = np.asarray(x, np.float64)
        self.n = len(x)
        self.f0, self.t = pw.harvest(x, SR, f0_floor=max(40.0, floor), f0_ceil=min(ceil, 1000.0), frame_period=5.0)
        self.sp = pw.cheaptrick(x, self.f0, self.t, SR)
        self.ap = pw.d4c(x, self.f0, self.t, SR)
        self.freqs = np.linspace(0, SR / 2, self.sp.shape[1])

    def _warp(self, M, fs, log=True):
        if fs == 1.0:
            return M
        src = self.freqs / fs
        A = np.log(np.maximum(M, 1e-16)) if log else M
        W = np.empty_like(A)
        for i in range(A.shape[0]):
            W[i] = np.interp(src, self.freqs, A[i])
        return np.exp(W) if log else np.clip(W, 0.0, 1.0)

    def variant(self, c):
        f0 = self.f0 * 2.0 ** (c["st"] / 12.0)
        sp = self._warp(self.sp, c["fs"], log=True)
        ap = self._warp(self.ap, c["fs"], log=False)
        y = self.pw.synthesize(np.ascontiguousarray(f0), np.ascontiguousarray(sp), np.ascontiguousarray(ap), SR, 5.0)
        return _fit_len(y, self.n)


def make_variants(x, sex, f0_src):
    """Yield (cond_dict, audio) for every condition of one source clip.
    f0_src: the source's F0Track (sets per-item analysis ranges; sex-blind)."""
    v = f0_src.f0[f0_src.f0 > 0]
    if len(v) < 5:
        v = np.array([120.0, 220.0])
    floor = float(max(50.0, 0.7 * np.percentile(v, 10)))
    ceil = float(min(800.0, max(1.6 * np.percentile(v, 90), floor * 2.5)))
    med = float(np.median(v))
    r0 = rms(x)
    world = None
    for c in conditions(sex):
        if c["engine"] == "none":
            y = np.asarray(x, np.float64)
        elif c["engine"] == "praat":
            y = praat_variant(x, c, floor, ceil, med)
        else:
            if world is None:
                world = WorldAnalysis(x, floor, ceil)
            y = world.variant(c)
        r = rms(y)
        if r > 0:
            y = y * (r0 / r)
        yield c, y
