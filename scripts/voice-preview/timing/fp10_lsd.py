"""fp10_lsd.py - log-spectral distance between the 10 ms and 5 ms frame-period renders (§P5).

  python -I fp10_lsd.py [--clipset timing]

The scratch prototype's LSD (analyze.py lsd), scaled to each render rate: STFT with a Hann
window of 32 ms and a 10 ms hop; power floored at 80 dB below the reference's maximum; frames
with reference energy >= 35 dB below its 95th percentile are kept; per-frame RMS difference of the
dB spectra over all bins, averaged over kept frames. Reference = the 5 ms render.
Also the unchanged rebuild (0, 1.00) at 5 and at 10 ms against the clip itself (resampled to the
render rate), for scale. Reads fp10-renders.mjs output; writes VP_CACHE/timing/fp10/<clipset>/lsd.json.
"""
import argparse, json, os, site, sys

ap = argparse.ArgumentParser()
ap.add_argument("--clipset", default="timing")
A = ap.parse_args()
_us = site.getusersitepackages()
if _us not in sys.path:
    sys.path.append(_us)
import numpy as np  # noqa: E402
from scipy.signal import stft  # noqa: E402

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.abspath(os.path.join(HERE, "..", "..", ".."))
CACHE = os.environ.get("VP_CACHE") or os.path.join(REPO, "build", "voice-preview")
D = os.path.join(CACHE, "timing", "fp10", A.clipset)
idx = json.load(open(os.path.join(D, "index.json"), encoding="utf8"))


def lsd(x, y, sr):
    n = int(round(0.032 * sr)); h = int(round(0.010 * sr))
    _, _, X = stft(x, fs=sr, nperseg=n, noverlap=n - h, window="hann")
    _, _, Y = stft(y, fs=sr, nperseg=n, noverlap=n - h, window="hann")
    PX, PY = np.abs(X) ** 2, np.abs(Y) ** 2
    fl = PX.max() * 10 ** (-80 / 10)
    DX = 10 * np.log10(np.maximum(PX, fl)); DY = 10 * np.log10(np.maximum(PY, fl))
    fe = PX.sum(axis=0)
    keep = fe >= np.percentile(fe, 95) * 10 ** (-35 / 10)
    return float(np.mean(np.sqrt(np.mean((DX[:, keep] - DY[:, keep]) ** 2, axis=0))))


f = lambda r: np.fromfile(os.path.join(D, r["file"]), np.float32).astype(np.float64)  # noqa: E731
ref = {(r["clip"], r["rate"], r["st"], r["a"]): r for r in idx["files"] if r["fp"] == 5}
orig = {(r["clip"], r["rate"]): r for r in idx["files"] if r["fp"] == 0}
rows = []
for r in idx["files"]:
    if r["fp"] != 10:
        continue
    q = ref[(r["clip"], r["rate"], r["st"], r["a"])]
    rows.append(dict(clip=r["clip"], rate=r["rate"], st=r["st"], a=r["a"], lsd_db=lsd(f(q), f(r), r["rate"])))
out = {}
for rate in sorted({r["rate"] for r in rows}):
    v = np.array([r["lsd_db"] for r in rows if r["rate"] == rate])
    out[str(rate)] = dict(n=len(v), median=float(np.median(v)), p90=float(np.percentile(v, 90)), min=float(v.min()), max=float(v.max()))
    print(f"{rate} Hz: LSD(10 ms vs 5 ms) median {np.median(v):.2f} dB, p90 {np.percentile(v, 90):.2f}, range {v.min():.2f}-{v.max():.2f} (n {len(v)})")
    # the unchanged rebuild against the clip itself, at 5 and 10 ms
    o5 = [lsd(f(orig[(c, rate)]), f(ref[(c, rate, 0, 1.0)]), rate) for c in sorted({r["clip"] for r in rows})]
    o10 = [lsd(f(orig[(c, rate)]), f([r for r in idx["files"] if r["fp"] == 10 and r["clip"] == c and r["rate"] == rate and r["st"] == 0 and r["a"] == 1.0][0]), rate)
           for c in sorted({r["clip"] for r in rows})]
    out[str(rate)]["rebuild_vs_clip_fp5"] = [round(x, 3) for x in o5]
    out[str(rate)]["rebuild_vs_clip_fp10"] = [round(x, 3) for x in o10]
    print(f"   unchanged rebuild vs the clip: 5 ms {np.median(o5):.2f} dB ({min(o5):.2f}-{max(o5):.2f}), 10 ms {np.median(o10):.2f} dB ({min(o10):.2f}-{max(o10):.2f})")
json.dump(dict(clipset=A.clipset, by_rate=out, rows=rows), open(os.path.join(D, "lsd.json"), "w"), indent=1)
