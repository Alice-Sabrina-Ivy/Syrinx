"""pyworld_ref.py - pyworld side of the voice-preview parity check (§P3 of
measurements/voice-preview-spike-2026-10-12.md). Reads the exact inputs run-wasm.mjs wrote,
runs pyworld 0.3.5 on them, and scores Levels 1 and 2 against the WebAssembly outputs.

  python -I pyworld_ref.py --pyworld DIR --build simd [--level 1|2|all] [--rates 32000,44100,48000]

--rates (§ Addition 2026-10-12, A4): Level 1 only at these rates (folders l1/<rate>); the result
goes to parity-level1-<rates>.json.

Level 1 (identical inputs per stage)                         pass
  StoneMask   voicing identical on 100 % of frames and |12 log2(fw/fp)| <= 0.001 st on
              >= 99.9 % of voiced frames
  DIO/Harvest a frame agrees if both unvoiced, or both voiced within 0.001 st;
              >= 99.5 % of frames agree (every disagreeing frame is listed)
  CheapTrick  |10 log10(Sw/Sp)| <= 0.01 dB on >= 99.9 % of frame x bin elements
  D4C         |dA| <= 1e-4 on >= 99.9 % of elements
  Warp        |d ln S'| <= 1e-9 and |dA'| <= 1e-9 on 100 % of elements (pyworld side =
              the prototype's World._warp in numpy, on the WebAssembly S and A)
  Synthesis   SNR >= 60 dB per render (pyworld output as the reference)
Level 2 (16 kHz, end to end from the stored grid, the prototype's world_render.py code path):
  waveform SNR >= 40 dB on every render, before finish. The pyworld renders are finished
  (the prototype's finish) and written for the meters: parity/renders/pyworld/<clip>/<cell>.f32
Output: VP_CACHE/parity/<build>/parity-level<level>.json
"""
import argparse, json, os, site, sys

ap = argparse.ArgumentParser()
ap.add_argument("--pyworld", required=True)
ap.add_argument("--build", default="simd")
ap.add_argument("--level", default="all")
ap.add_argument("--rates", default="")
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
ROOT = os.path.join(CACHE, "parity", A.build)
CLIPS = os.path.join(CACHE, "clips", "proto16")
FP = 5.0
ST = [-6, -3, 0, 3, 6]
AL = [0.88, 0.94, 1.00, 1.06, 1.12]


def cells(sex):
    out = [(s, a) for s in ST for a in AL]
    out.append((9, 1.15) if sex == "m" else (-9, 0.87))
    return out


def cell_name(st, a):
    return f"p{st:+d}_a{a:.2f}"


def L(d, n):
    return np.fromfile(os.path.join(d, n), np.float64)


def st_diff(a, b):
    with np.errstate(divide="ignore", invalid="ignore"):
        return np.abs(12 * np.log2(a / b))


def snr(ref, test):
    e = np.sum((ref - test) ** 2)
    return float("inf") if e == 0 else float(10 * np.log10(np.sum(ref ** 2) / e))


def warp_np(M, a, log, freqs):  # the prototype's World._warp, verbatim in substance
    if a == 1.0:
        return M
    src = freqs / a
    Am = np.log(np.maximum(M, 1e-16)) if log else M
    Wm = np.empty_like(Am)
    for i in range(Am.shape[0]):
        Wm[i] = np.interp(src, freqs, Am[i])
    return np.exp(Wm) if log else np.clip(Wm, 0.0, 1.0)


def tracker(fw, fp):
    vw, vp = fw > 0, fp > 0
    both = vw & vp
    d = np.zeros(len(fw))
    d[both] = st_diff(fw[both], fp[both])
    agree = (~vw & ~vp) | (both & (d <= 0.001))
    bad = np.nonzero(~agree)[0]
    return dict(frames=len(fw), agree=float(np.mean(agree)), pass_=bool(np.mean(agree) >= 0.995),
                max_st_both_voiced=float(d[both].max()) if both.any() else 0.0,
                disagreements=[dict(frame=int(i), wasm=float(fw[i]), pyworld=float(fp[i])) for i in bad[:200]],
                n_disagree=int(len(bad)))


def level1():
    res = {}
    rates = [r for r in A.rates.split(",") if r]
    for fs in sorted(rates or os.listdir(os.path.join(ROOT, "l1")), key=int):
        for clip in sorted(os.listdir(os.path.join(ROOT, "l1", fs))):
            d = os.path.join(ROOT, "l1", fs, clip)
            fsi = int(fs)
            x = L(d, "x.f64")
            r = {}
            f0, t = pw.dio(x, fsi, f0_floor=71.0, f0_ceil=800.0, channels_in_octave=2.0, frame_period=FP, speed=1, allowed_range=0.1)
            r["dio"] = tracker(L(d, "dio_f0.f64"), f0)
            r["dio"]["t_identical"] = bool(np.array_equal(t, L(d, "dio_t.f64")))
            f0, t = pw.harvest(x, fsi, f0_floor=71.0, f0_ceil=800.0, frame_period=FP)
            r["harvest"] = tracker(L(d, "hv_f0.f64"), f0)
            r["harvest"]["t_identical"] = bool(np.array_equal(t, L(d, "hv_t.f64")))
            t = L(d, "sm_t.f64")
            sm_py = pw.stonemask(x, L(d, "sm_in.f64"), t, fsi)
            sm_w = L(d, "sm_out.f64")
            vw, vp = sm_w > 0, sm_py > 0
            dd = st_diff(sm_w[vp & vw], sm_py[vp & vw])
            r["stonemask"] = dict(frames=len(sm_w), voicing_identical=float(np.mean(vw == vp)),
                                  within=float(np.mean(dd <= 0.001)) if len(dd) else 1.0,
                                  max_st=float(dd.max()) if len(dd) else 0.0)
            r["stonemask"]["pass_"] = bool(r["stonemask"]["voicing_identical"] == 1.0 and r["stonemask"]["within"] >= 0.999)
            sp_py = pw.cheaptrick(x, sm_w, t, fsi, q1=-0.15, f0_floor=71.0)
            nb = sp_py.shape[1]
            sp_w = L(d, "sp.f64").reshape(-1, nb)
            db = np.abs(10 * np.log10(sp_w / sp_py))
            r["cheaptrick"] = dict(fft_size=2 * (nb - 1), elements=int(db.size), within=float(np.mean(db <= 0.01)), max_db=float(db.max()))
            r["cheaptrick"]["pass_"] = bool(r["cheaptrick"]["within"] >= 0.999)
            ap_py = pw.d4c(x, sm_w, t, fsi, threshold=0.85)
            ap_w = L(d, "ap.f64").reshape(-1, nb)
            da = np.abs(ap_w - ap_py)
            r["d4c"] = dict(elements=int(da.size), within=float(np.mean(da <= 1e-4)), max_abs=float(da.max()))
            r["d4c"]["pass_"] = bool(r["d4c"]["within"] >= 0.999)
            freqs = np.linspace(0, fsi / 2, nb)
            wr = {}
            names = [n for n in os.listdir(d) if n.startswith("y_")]
            cl = [(int(n[2:].split("_")[0][1:]), float(n.split("_a")[1][:-4])) for n in names]
            for a in sorted(set(a for _, a in cl)):
                if a == 1.0:
                    continue
                spw_py = warp_np(sp_w, a, True, freqs)
                apw_py = warp_np(ap_w, a, False, freqs)
                spw_w = L(d, f"warp_{a:.2f}_sp.f64").reshape(-1, nb)
                apw_w = L(d, f"warp_{a:.2f}_ap.f64").reshape(-1, nb)
                dl = np.abs(np.log(spw_w) - np.log(spw_py))
                dap = np.abs(apw_w - apw_py)
                wr[f"{a:.2f}"] = dict(max_dln=float(dl.max()), max_dap=float(dap.max()),
                                      pass_=bool(dl.max() <= 1e-9 and dap.max() <= 1e-9))
            r["warp"] = wr
            syn = {}
            for st, a in sorted(cl):
                cn = cell_name(st, a)
                f0c = L(d, f"f0_{cn}.f64")
                if a == 1.0:
                    spc, apc = sp_w, ap_w
                else:
                    spc = L(d, f"warp_{a:.2f}_sp.f64").reshape(-1, nb)
                    apc = L(d, f"warp_{a:.2f}_ap.f64").reshape(-1, nb)
                y_py = pw.synthesize(np.ascontiguousarray(f0c), np.ascontiguousarray(spc), np.ascontiguousarray(apc), fsi, FP)
                y_w = L(d, f"y_{cn}.f64")
                s = snr(y_py, y_w) if len(y_py) == len(y_w) else float("nan")
                syn[cn] = dict(snr_db=s, len_py=len(y_py), len_wasm=len(y_w), max_abs=float(np.max(np.abs(y_py - y_w))) if len(y_py) == len(y_w) else None,
                               pass_=bool(len(y_py) == len(y_w) and s >= 60))
            r["synthesis"] = syn
            res[f"{fs}/{clip}"] = r
            ok = all([r["dio"]["pass_"], r["harvest"]["pass_"], r["stonemask"]["pass_"], r["cheaptrick"]["pass_"], r["d4c"]["pass_"],
                      all(v["pass_"] for v in wr.values()), all(v["pass_"] for v in syn.values())])
            print(f"L1 {fs} {clip}: dio {r['dio']['agree'] * 100:.2f}% harvest {r['harvest']['agree'] * 100:.2f}% "
                  f"sm max {r['stonemask']['max_st']:.2e} st, ct max {r['cheaptrick']['max_db']:.2e} dB, d4c max {r['d4c']['max_abs']:.2e}, "
                  f"warp max dln {max([v['max_dln'] for v in wr.values()] or [0]):.1e}, synth min SNR "
                  f"{min(v['snr_db'] for v in syn.values()):.1f} dB -> {'PASS' if ok else 'FAIL'}", flush=True)
    return res


def grid_to_frames(grid, n_frames):  # the prototype's world_render.py, verbatim
    t = np.arange(n_frames) * FP / 1000.0
    p = (t - 0.005) / 0.01
    j0 = np.floor(p).astype(int); j1 = j0 + 1
    G = np.concatenate([grid, [0.0]]).astype(np.float64)

    def g(j):
        ok = (j >= 0) & (j < len(grid))
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


def finish(y, x):  # the prototype's common.finish
    y = np.asarray(y, np.float64)
    ry = np.sqrt(np.mean(y ** 2)); rx = np.sqrt(np.mean(np.asarray(x, np.float64) ** 2))
    if ry > 0:
        y = y * (rx / ry)
    pk = np.max(np.abs(y))
    if pk > 0.99:
        y = y * (0.99 / pk)
    return y.astype(np.float32)


def level2():
    clips = json.load(open(os.path.join(CLIPS, "clips.json"), encoding="utf8"))
    res = {}
    for c in clips:
        x = np.fromfile(os.path.join(CLIPS, c["name"] + ".f32"), np.float32).astype(np.float64)
        grid = np.fromfile(os.path.join(CLIPS, c["name"] + ".protogrid.f32"), np.float32).astype(np.float64)
        n_frames = int(len(x) / 16000 * 1000 / FP) + 1
        f0i, t = grid_to_frames(grid, n_frames)
        f0 = pw.stonemask(x, f0i, t, 16000)
        sp = pw.cheaptrick(x, f0, t, 16000)
        apm = pw.d4c(x, f0, t, 16000)
        freqs = np.linspace(0, 16000 / 2, sp.shape[1])
        rdir = os.path.join(CACHE, "parity", "renders", "pyworld", c["name"])
        os.makedirs(rdir, exist_ok=True)
        rr = {}
        for st, a in cells(c["sex"]):
            cn = cell_name(st, a)
            y = pw.synthesize(np.ascontiguousarray(f0 * 2.0 ** (st / 12.0)), np.ascontiguousarray(warp_np(sp, a, True, freqs)),
                              np.ascontiguousarray(warp_np(apm, a, False, freqs)), 16000, FP)
            n = len(x)
            y = y[:n] if len(y) >= n else np.pad(y, (0, n - len(y)))
            yw = L(os.path.join(ROOT, "l2", c["name"]), f"y_{cn}.f64")
            rr[cn] = snr(y, yw)
            finish(y, x).tofile(os.path.join(rdir, cn + ".f32"))
        v = np.array(list(rr.values()))
        res[c["name"]] = dict(snr_db=rr, min=float(v.min()), median=float(np.median(v)), pass_=bool(v.min() >= 40))
        print(f"L2 {c['name']}: SNR min {v.min():.1f} dB median {np.median(v):.1f} dB -> {'PASS' if v.min() >= 40 else 'FAIL'}", flush=True)
    allv = np.array([s for r in res.values() for s in r["snr_db"].values()])
    summary = dict(renders=int(len(allv)), min=float(allv.min()), median=float(np.median(allv)), pass_=bool(allv.min() >= 40))
    print(f"L2 all {len(allv)} renders: SNR min {allv.min():.1f} dB, median {np.median(allv):.1f} dB -> {'PASS' if summary['pass_'] else 'FAIL'}")
    return dict(clips=res, summary=summary)


out = dict(build=A.build, pyworld=getattr(pw, "__version__", "?"), numpy=np.__version__, python=sys.version.split()[0])
if A.level in ("1", "all"):
    out["level1"] = level1()
if A.level in ("2", "all"):
    out["level2"] = level2()
with open(os.path.join(ROOT, f"parity-level{A.level}{'-' + A.rates.replace(',', '-') if A.rates else ''}.json"), "w") as f:
    json.dump(out, f, indent=1)
