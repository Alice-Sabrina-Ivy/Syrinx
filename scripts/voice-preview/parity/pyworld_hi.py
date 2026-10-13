"""pyworld_hi.py - Level 2 of the parity check at 32 000, 44 100 and 48 000 Hz (§ Addition 2026-10-12,
A4, of measurements/voice-preview-spike-2026-10-12.md): end to end with the gate's front end F-S.

  python -I pyworld_hi.py --pyworld DIR [--rates 32000,44100,48000] [--dir rate-hi]

Inputs: fe/<dir>/wasm/<rate>/<clip>/ from rate-check.mjs --l2=1: x.f32 (the waveform at the rate,
as WebAssembly WORLD analysed it), posted.f32 (the real pitch chain's posted track, the F-S input)
and y_<cell>.f64 (the WebAssembly render before finish). Per clip and rate, pyworld 0.3.5 runs the
same pipeline from the same waveform and track, with the F-S mapping rewritten here in numpy (as
in pyworld_fe.py): posted hop k at (k + 1) * 25 ms - 40 ms, the prototype's grid_to_frames rule
(origin -0.015 s, step 0.025 s) onto 5 ms frames, then pw.stonemask, pw.cheaptrick, pw.d4c, the
prototype's warp, pw.synthesize (trimmed or zero-padded to the input length). 8 clips (speech-dense
5 s, pre-registered 8 s) x 26 cells = 208 renders per rate.
  Level 2   SNR of the WebAssembly render against the pyworld render, before finish: >= 40 dB on
            every render (the median is reported too)
Also writes the finished pyworld renders (the prototype's finish) to fe/<dir>/pyworld/<rate>/<clip>/
<cell>.f32 for the meters (Level 3, hirate-meters.mjs + hirate_score.py), and CheapTrick's FFT size
per rate. Output: fe/<dir>/level2-hi.json
"""
import argparse, json, os, site, sys

ap = argparse.ArgumentParser()
ap.add_argument("--pyworld", required=True)
ap.add_argument("--rates", default="32000,44100,48000")
ap.add_argument("--dir", default="rate-hi")
A = ap.parse_args()
sys.path.insert(0, A.pyworld)
_us = site.getusersitepackages()
if _us not in sys.path:
    sys.path.append(_us)
import numpy as np  # noqa: E402
import pyworld as pw  # noqa: E402

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.abspath(os.path.join(HERE, "..", "..", ".."))
CACHE = os.environ.get("VP_CACHE") or os.path.join(REPO, "build", "voice-preview")
D = os.path.join(CACHE, "fe", A.dir)
FP = 5.0
ST = [-6, -3, 0, 3, 6]
AL = [0.88, 0.94, 1.00, 1.06, 1.12]


def cells(sex):
    out = [(s, a) for s in ST for a in AL]
    out.append((9, 1.15) if sex == "m" else (-9, 0.87))
    return out


def cell_name(st, a):
    return f"p{st:+d}_a{a:.2f}"


def map_track(track, n_frames, origin, step):  # the prototype's grid_to_frames, origin / step as parameters
    t = np.arange(n_frames) * FP / 1000.0
    p = (t - origin) / step
    j0 = np.floor(p).astype(int); j1 = j0 + 1
    G = np.concatenate([track, [0.0]]).astype(np.float64)

    def g(j):
        ok = (j >= 0) & (j < len(track))
        out = np.zeros(len(j)); out[ok] = G[j[ok]]; return out
    g0, g1 = g(j0), g(j1)
    w = p - j0
    f0 = np.zeros(n_frames)
    both = (g0 > 0) & (g1 > 0)
    f0[both] = np.exp((1 - w[both]) * np.log(g0[both]) + w[both] * np.log(g1[both]))
    jn = np.round(p).astype(int)
    gn = g(jn)
    near = (~both) & (np.abs(p - jn) <= 0.75)
    f0[near] = gn[near]
    return f0, t


def warp_np(M, a, log, freqs):  # the prototype's World._warp
    if a == 1.0:
        return M.copy()
    src = freqs / a
    out = np.empty_like(M)
    for i in range(M.shape[0]):
        if log:
            out[i] = np.exp(np.interp(src, freqs, np.log(np.maximum(M[i], 1e-16))))
        else:
            out[i] = np.clip(np.interp(src, freqs, M[i]), 0, 1)
    return out


def finish(y, x):  # the prototype's common.finish
    y = np.asarray(y, np.float64)
    ry = np.sqrt(np.mean(y ** 2)); rx = np.sqrt(np.mean(np.asarray(x, np.float64) ** 2))
    if ry > 0:
        y = y * (rx / ry)
    pk = np.max(np.abs(y))
    if pk > 0.99:
        y = y * (0.99 / pk)
    return y.astype(np.float32)


def snr(ref, test):
    e = np.sum((ref - test) ** 2)
    return float("inf") if e == 0 else float(10 * np.log10(np.sum(ref ** 2) / e))


clips = json.load(open(os.path.join(D, "clips.json"), encoding="utf8"))
res = {}
for rate in [int(r) for r in A.rates.split(",")]:
    per, allv, fft = {}, [], set()
    for c in clips:
        wd = os.path.join(D, "wasm", str(rate), c["name"])
        x = np.fromfile(os.path.join(wd, "x.f32"), np.float32).astype(np.float64)
        post = np.fromfile(os.path.join(wd, "posted.f32"), np.float32).astype(np.float64)
        n_frames = int(len(x) / rate * 1000 / FP) + 1
        f0i, t = map_track(post, n_frames, -0.015, 0.025)
        f0 = pw.stonemask(x, f0i, t, rate)
        sp = pw.cheaptrick(x, f0, t, rate)
        apm = pw.d4c(x, f0, t, rate)
        fft.add(2 * (sp.shape[1] - 1))
        freqs = np.linspace(0, rate / 2, sp.shape[1])
        rdir = os.path.join(D, "pyworld", str(rate), c["name"])
        os.makedirs(rdir, exist_ok=True)
        rr = {}
        for st, a in cells(c["sex"]):
            cn = cell_name(st, a)
            y = pw.synthesize(np.ascontiguousarray(f0 * 2.0 ** (st / 12.0)), np.ascontiguousarray(warp_np(sp, a, True, freqs)),
                              np.ascontiguousarray(warp_np(apm, a, False, freqs)), rate, FP)
            y = y[:len(x)] if len(y) >= len(x) else np.pad(y, (0, len(x) - len(y)))
            yw = np.fromfile(os.path.join(wd, f"y_{cn}.f64"), np.float64)
            rr[cn] = snr(y, yw) if len(yw) == len(y) else float("nan")
            finish(y, x).tofile(os.path.join(rdir, cn + ".f32"))
        per[c["name"]] = rr
        allv += list(rr.values())
        print(f"{rate} {c['name']}: SNR min {min(rr.values()):.1f} dB", flush=True)
    v = np.array(allv)
    res[str(rate)] = dict(renders=len(v), min_snr_db=float(np.nanmin(v)), median_snr_db=float(np.nanmedian(v)),
                          pass_=bool(np.all(np.isfinite(v)) and v.min() >= 40), cheaptrick_fft=sorted(fft), per_clip=per)
    print(f"L2 {rate}: {len(v)} renders, SNR before finish min {np.nanmin(v):.1f} dB, median {np.nanmedian(v):.1f} dB, "
          f"CheapTrick FFT {sorted(fft)} -> {'PASS' if res[str(rate)]['pass_'] else 'FAIL'}", flush=True)
with open(os.path.join(D, "level2-hi.json"), "w") as f:
    json.dump(dict(pyworld=getattr(pw, "__version__", "?"), numpy=np.__version__, python=sys.version.split()[0], rates=res), f, indent=1,
              default=lambda o: None if (isinstance(o, float) and not np.isfinite(o)) else float(o))
