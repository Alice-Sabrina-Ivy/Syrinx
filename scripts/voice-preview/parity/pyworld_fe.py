"""pyworld_fe.py - pyworld 0.3.5 renders for every F0 front end (§P3 Levels 2-3 extended to §P4's
front ends; the Build step's Level 2-3 covered the prototype's stored grid only).

  python -I pyworld_fe.py --pyworld DIR [--fes H,D,S,L]

The 8 prototype clips (16 kHz) x 26 cells, the prototype's world_render.py code path, with
  H  pw.harvest (71-800 Hz, 5 ms), used directly
  D  pw.dio (71-800 Hz, 5 ms) + pw.stonemask
  S  the real pitch worker's posted track (proto16/<clip>.post.f32, 25 ms hops, hop k at
     (k + 1) * 25 ms - 40 ms) mapped to 5 ms frames by the prototype's rule scaled to 25 ms,
     + pw.stonemask
  L  this branch's lab replica grid (proto16/<clip>.grid.f32, 10 ms) by the prototype's
     grid_to_frames, + pw.stonemask
then pw.cheaptrick, pw.d4c, the prototype's warp, pw.synthesize and finish. The mappings are
written independently here in numpy (not taken from the JavaScript), so a mapping error would
show. Writes parity/renders/pyworld-fe-<X>/<clip>/<cell>.f32 (finished float32, for meters.mjs)
and parity/fe-level2.json: SNR of each finished pyworld render against the finished
WebAssembly render of fe-run.mjs (parity/renders/fe-<X>), pass >= 40 dB as Level 2.
"""
import argparse, json, os, site, sys

ap = argparse.ArgumentParser()
ap.add_argument("--pyworld", required=True)
ap.add_argument("--fes", default="H,D,S,L")
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
PAR = os.path.join(CACHE, "parity")
CLIPS = os.path.join(CACHE, "clips", "proto16")
FP = 5.0
SR = 16000
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


clips = json.load(open(os.path.join(CLIPS, "clips.json"), encoding="utf8"))
res = {}
for fe in A.fes.split(","):
    allv, per = [], {}
    for c in clips:
        x = np.fromfile(os.path.join(CLIPS, c["name"] + ".f32"), np.float32).astype(np.float64)
        n_frames = int(len(x) / SR * 1000 / FP) + 1
        if fe == "H":
            f0, t = pw.harvest(x, SR, f0_floor=71.0, f0_ceil=800.0, frame_period=FP)
        else:
            if fe == "D":
                f0i, t = pw.dio(x, SR, f0_floor=71.0, f0_ceil=800.0, channels_in_octave=2.0, frame_period=FP, speed=1, allowed_range=0.1)
            elif fe == "S":
                post = np.fromfile(os.path.join(CLIPS, c["name"] + ".post.f32"), np.float32).astype(np.float64)
                f0i, t = map_track(post, n_frames, -0.015, 0.025)
            else:
                grid = np.fromfile(os.path.join(CLIPS, c["name"] + ".grid.f32"), np.float32).astype(np.float64)
                f0i, t = map_track(grid, n_frames, 0.005, 0.01)
            f0 = pw.stonemask(x, f0i, t, SR)
        sp = pw.cheaptrick(x, f0, t, SR)
        apm = pw.d4c(x, f0, t, SR)
        freqs = np.linspace(0, SR / 2, sp.shape[1])
        rdir = os.path.join(PAR, "renders", f"pyworld-fe-{fe}", c["name"])
        os.makedirs(rdir, exist_ok=True)
        rr = {}
        for st, a in cells(c["sex"]):
            cn = cell_name(st, a)
            y = pw.synthesize(np.ascontiguousarray(f0 * 2.0 ** (st / 12.0)), np.ascontiguousarray(warp_np(sp, a, True, freqs)),
                              np.ascontiguousarray(warp_np(apm, a, False, freqs)), SR, FP)
            y = y[:len(x)] if len(y) >= len(x) else np.pad(y, (0, len(x) - len(y)))
            yf = finish(y, x)
            yf.tofile(os.path.join(rdir, cn + ".f32"))
            yw = np.fromfile(os.path.join(PAR, "renders", f"fe-{fe}", c["name"], cn + ".f32"), np.float32).astype(np.float64)
            rr[cn] = snr(yf.astype(np.float64), yw)
        per[c["name"]] = rr
        allv += list(rr.values())
    v = np.array(allv)
    res[fe] = dict(renders=len(v), min_snr_db=float(v.min()), median_snr_db=float(np.median(v)), pass_=bool(v.min() >= 40), per_clip=per)
    print(f"fe {fe}: {len(v)} renders, finished-render SNR min {v.min():.1f} dB, median {np.median(v):.1f} dB -> {'PASS' if v.min() >= 40 else 'FAIL'}", flush=True)
with open(os.path.join(PAR, "fe-level2.json"), "w") as f:
    json.dump(dict(pyworld=getattr(pw, "__version__", "?"), numpy=np.__version__, python=sys.version.split()[0], fes=res), f, indent=1,
              default=lambda o: None if (isinstance(o, float) and not np.isfinite(o)) else float(o))
