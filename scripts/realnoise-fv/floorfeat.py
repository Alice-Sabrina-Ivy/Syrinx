# floorfeat.py — offline "harmonic excess over the learned noise spectrum"
# feature of every decoded frame that reached the harmonic guard in an attr.mjs
# dump (2026-10-05, exploration for a real-noise voicing guard).
#
# Per stream (raw audio resampled to 16 kHz, 25 ms hop, the analysis frame of
# each chunk = its last 1280 samples, Hann, 2048-point FFT, 7.8 Hz bins):
#   S_k(b)  = mean power of frames k-2..k (3-frame smoothing)
#   N_k(b)  = min of SF over the W frames BEFORE frame k, SF = the --fsmooth-
#             frame causal moving average of P (causal minimum
#             statistics; the history available when < W frames have passed)
#   ex_h    = max over the bins within +-min(3 % h f0, 0.2 f0) of h f0 of
#             10 log10(P_k(b) / N_k(b)), h = 1..8 (h f0 <= 3.8 kHz; P_k = the
#             frame's own power spectrum)
# for W in WINS (frames). Output build/realnoise-fv/floor/<tag>/<set>/<id>.npy,
# shape (n, len(WINS) * 8), NaN rows where the guard was not called.
#
#   python scripts/realnoise-fv/floorfeat.py TAG SET [--shard=i/n] [--wins=200,400,800]
#          [--fsmooth=3] [--suffix=] (output build/realnoise-fv/floor<suffix>/...)
#          [--pct=P --decim=10]  (P-th percentile of SF snapshots every 10 frames
#          over the window instead of the minimum) [--valleys] (+ ev_1..ev_8: the
#          mean excess of the inter-harmonic valleys at (h -+ 0.5) f0, 16 columns
#          per window) [--fdil=K] (max over +-K bins of SF before the time minimum)
import sys, os, glob, json
from math import gcd
import numpy as np
import soundfile as sf
from scipy.signal import resample_poly
from scipy.ndimage import minimum_filter1d, maximum_filter1d

A = dict((a[2:].split("=", 1) + ["1"])[:2] for a in sys.argv[1:] if a.startswith("--"))
TAG, SET = [a for a in sys.argv[1:] if not a.startswith("--")][:2]
ROOT = os.path.join(A.get("data-root", os.environ.get("NOTCHVD_ROOT", "build/notchvd")), "data")
CORP = A.get("corpora", os.environ.get("SYRINX_CORPORA_DIR", "tests/dsp/data"))
ATTR = A.get("attr", "build/realnoise-fv/attr")
WINS = [int(w) for w in A.get("wins", "200,400,800").split(",")]
FSM = int(A.get("fsmooth", "3"))   # frames averaged for the floor reference
PCT = float(A["pct"]) if "pct" in A else None   # percentile floor instead of the minimum
DEC = int(A.get("decim", "10"))
VAL = "valleys" in A                # + 8 valley-excess columns per window
FDIL = int(A.get("fdil", "0"))      # frequency dilation of the floor reference (bins)
OUT = os.path.join(f"build/realnoise-fv/floor{A.get('suffix', '')}", TAG, SET)
os.makedirs(OUT, exist_ok=True)
NF, FL, SR, HOP = 2048, 1280, 16000, 400
HANN = 0.5 - 0.5 * np.cos(2 * np.pi * np.arange(FL) / (FL - 1))
BIN = SR / NF

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import harmfeat_audio as HA  # noqa: E402  (audio loader shared with harmfeat.py)


def load(p):
    m = json.load(open(p + ".json"))
    a = np.fromfile(p + ".f32", dtype=np.float32).reshape(len(m["cols"]), m["n"]).astype(float)
    return m, {c: a[i] for i, c in enumerate(m["cols"])}


names = sorted(os.path.basename(p)[:-5] for p in glob.glob(f"{ATTR}/{TAG}/{SET}/*.json"))
shI, shN = map(int, A.get("shard", "0/1").split("/"))
for nm in names[shI::shN]:
    if os.path.exists(os.path.join(OUT, nm + ".npy")):
        continue
    m, c = load(f"{ATTR}/{TAG}/{SET}/{nm}")
    x, sr = HA.audio(SET, m, ROOT, CORP)
    Cn = m.get("C") or round(sr * 0.025)
    n = m["n"]
    ends = np.array([int(round((k + 1) * Cn / sr * SR)) for k in range(n)])
    ok = (ends >= FL) & (ends <= len(x))
    P = np.full((n, NF // 2 + 1), np.nan, np.float32)
    idx = np.nonzero(ok)[0]
    for s in range(0, len(idx), 512):
        ks = idx[s:s + 512]
        fr = np.stack([x[e - FL:e] for e in ends[ks]]) * HANN
        X = np.fft.rfft(fr, NF, axis=1)
        P[ks] = (X.real ** 2 + X.imag ** 2).astype(np.float32)
    P = np.where(np.isfinite(P), P, np.nanmax(P) if np.isfinite(P).any() else 1.0) + 1e-20
    S = np.copy(P)
    S[2:] = (P[2:] + P[1:-1] + P[:-2]) / 3
    # floor reference: FSM-frame moving average of P (causal) before the minimum
    cs = np.cumsum(np.vstack([np.zeros((1, P.shape[1])), P.astype(np.float64)]), axis=0)
    SF = np.empty(P.shape, np.float64)
    for k0 in range(0, n, 4096):
        k1 = min(n, k0 + 4096); ks = np.arange(k0, k1); lo = np.maximum(0, ks - FSM + 1)
        SF[ks] = np.maximum((cs[ks + 1] - cs[lo]) / (ks - lo + 1)[:, None], 1e-20)
    if FDIL > 0:
        # frequency dilation BEFORE the time minimum: a line that wanders within
        # +-FDIL bins (wobble, drift) stays in the floor at every bin it visits
        SF = maximum_filter1d(SF, size=2 * FDIL + 1, axis=1, mode="nearest")
    NC = 16 if VAL else 8
    out = np.full((n, len(WINS) * NC), np.nan, np.float32)
    calls = np.nonzero(c["gk"] >= 0)[0]
    for wi, W in enumerate(WINS):
        # causal min over the W frames before k: minimum_filter over [k-W, k-1]
        if PCT is None:
            Nf = minimum_filter1d(SF, size=W, axis=0, origin=(W - 1) // 2, mode="nearest")  # covers [k-W+1, k]
            Nf = np.vstack([SF[:1], Nf[:-1]])  # shift: frames [k-W, k-1]
        else:
            # PCT-th percentile of SF snapshots taken every DEC frames over the
            # last W frames (decimated history), refreshed every DEC frames
            Nf = np.empty_like(SF)
            snaps = SF[::DEC]
            for k0 in range(0, n, DEC):
                j1 = k0 // DEC                      # snapshots strictly before k0
                j0 = max(0, j1 - W // DEC)
                Nf[k0:k0 + DEC] = np.percentile(snaps[j0:j1], PCT, axis=0) if j1 > j0 else SF[0]
        # frames with < W history: min over what exists (mode=nearest pads with frame 0)
        for k in calls:
            f0 = c["dec"][k]
            for h in range(1, 9):
                f = h * f0
                if f > 3800:
                    break
                half = min(0.03 * f, 0.2 * f0)
                lo, hi = max(1, int(np.floor((f - half) / BIN))), int(np.ceil((f + half) / BIN))
                out[k, wi * NC + h - 1] = 10 * np.log10((P[k, lo:hi + 1] / Nf[k, lo:hi + 1]).max())
                if VAL:
                    # valley excess: mean power over the floor at (h -+ 0.5) f0 (+-0.1 f0)
                    vs = vn = 0.0
                    for vc in (f - 0.5 * f0, f + 0.5 * f0):
                        a_, b_ = max(1, int(np.floor((vc - 0.1 * f0) / BIN))), int(np.ceil((vc + 0.1 * f0) / BIN))
                        vs += P[k, a_:b_ + 1].sum(); vn += Nf[k, a_:b_ + 1].sum()
                    out[k, wi * NC + 8 + h - 1] = 10 * np.log10(vs / vn)
    np.save(os.path.join(OUT, nm + ".npy"), out)
print(f"{TAG} {SET} {shI}/{shN}: {len(names[shI::shN])} streams")
