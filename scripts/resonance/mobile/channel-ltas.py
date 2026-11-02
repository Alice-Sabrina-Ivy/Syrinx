"""channel-ltas.py - long-term spectra of the clean N / U10 / D10 streams on
vtln's band (800-5000 Hz, log grid 0.02 nat, mean removed as vtln removes each
frame's mean) and the projection of each channel condition's response onto the
resonance-change direction (mobile resonance diagnosis, channel area, 2026-10-28).

  python -I channel-ltas.py <repo root> <out dir>

Voiced 25 ms chunks only (the clean pitch cache's posted voiced hops), Hann,
2048-point FFT at 48 kHz, power averaged over chunks, then interpolated onto
ln f = ln 800 ... ln 5000 in 0.02-nat steps (92 points, vtln's scoring band).

Per sex: R = mean over readers of L(U10) - L(D10) (the +-12 % formant step,
~2 u in the clean chain), S = mean women L(N) - mean men L(N); both mean-removed.
For a channel H (dB, mean-removed on the same grid): a = <H,R>/<R,R> (the share
of a U10-D10 step that the channel looks like), cos(H,R), and the fraction of
||R||^2, ||S||^2 and ||H||^2 in the span of {ln f, (ln f)^2} (a "low-order"
equaliser would remove that part).
"""
import json, os, sys
import numpy as np

root, out = sys.argv[1], sys.argv[2]
SR, CH = 48000, 1200
streams = os.path.join(root, "build/resonance-mobile/streams")
pitchdir = os.path.join(root, "build/resonance-mobile/runs/clean/pitch")
L = json.load(open(os.path.join(streams, "readers-dev.json")))
grid = np.exp(np.arange(np.log(800), np.log(5000) + 1e-9, 0.02))
NF = 2048
fb = np.fft.rfftfreq(NF, 1 / SR)
win = np.hanning(CH)


def ltas(path, pitchfile):
    x = np.fromfile(path, dtype=np.float32).astype(np.float64)
    pc = json.load(open(pitchfile))["byChunk"]
    acc = np.zeros(len(fb)); n = 0
    for c in pc:
        for m in c:
            if not m[0] or not isinstance(m[2], (int, float)):
                continue
            e = int(round(m[2] * SR)); b = e - CH
            if b < 0 or e > len(x):
                continue
            X = np.fft.rfft(x[b:e] * win, NF)
            acc += np.abs(X) ** 2; n += 1
    p = acc / max(n, 1)
    return 10 * np.log10(np.interp(grid, fb, p) + 1e-30), n


def demean(v):
    return v - v.mean()


res = {}
for r in L["readers"]:
    res[r["id"]] = {"sex": r["sex"]}
    for V in ["N", "U10", "D10"]:
        db, n = ltas(r["variants"][V], os.path.join(pitchdir, f"{r['id']}__{V}.json"))
        res[r["id"]][V] = db
        res[r["id"]][V + "_n"] = n

lnf = np.log(grid)
B = np.stack([demean(lnf), demean(lnf ** 2)], 1)
Q, _ = np.linalg.qr(B)


def low_frac(v):
    v = demean(v)
    p = Q @ (Q.T @ v)
    return float(p @ p / (v @ v)) if v @ v > 0 else None


R = {}; slopes = {}
for sex in ["m", "f"]:
    ids = [k for k in res if res[k]["sex"] == sex]
    R[sex] = demean(np.mean([res[k]["U10"] - res[k]["D10"] for k in ids], 0))
    # per-reader N spectral slope on vtln's band (dB per octave)
    slopes[sex] = [float(np.polyfit(np.log2(grid), demean(res[k]["N"]), 1)[0]) for k in ids]
mN = np.mean([res[k]["N"] for k in res if res[k]["sex"] == "m"], 0)
fN = np.mean([res[k]["N"] for k in res if res[k]["sex"] == "f"], 0)
S = demean(fN - mN)

resp = json.load(open(os.path.join(out, "responses.json")))
rf = np.array(resp["freqs"])
rows = []
for name, g in resp["conds"].items():
    H = demean(np.interp(np.log(grid), np.log(rf), np.array(g)))
    row = {"cond": name, "Hrms": float(np.sqrt((H ** 2).mean())), "Hslope_dB_oct": float(np.polyfit(np.log2(grid), H, 1)[0]), "lowfracH": low_frac(H)}
    for sex in ["m", "f"]:
        r_ = R[sex]
        row[f"a_{sex}"] = float(H @ r_ / (r_ @ r_))
        row[f"cos_{sex}"] = float(H @ r_ / np.sqrt((H @ H) * (r_ @ r_)))
    rows.append(row)

summary = {
    "grid_hz": [float(grid[0]), float(grid[-1]), len(grid)],
    "R_rms_dB": {s: float(np.sqrt((R[s] ** 2).mean())) for s in R},
    "S_rms_dB": float(np.sqrt((S ** 2).mean())),
    "R_slope_dB_oct": {s: float(np.polyfit(np.log2(grid), R[s], 1)[0]) for s in R},
    "S_slope_dB_oct": float(np.polyfit(np.log2(grid), S, 1)[0]),
    "lowfrac_R": {s: low_frac(R[s]) for s in R},
    "lowfrac_S": low_frac(S),
    "cos_R_S": {s: float(R[s] @ S / np.sqrt((R[s] @ R[s]) * (S @ S))) for s in R},
    "N_slope_dB_oct_per_reader": slopes,
    "chunks": {k: [res[k]["N_n"], res[k]["U10_n"], res[k]["D10_n"]] for k in res},
    "conds": rows,
    "R_curve": {s: R[s].round(3).tolist() for s in R}, "S_curve": S.round(3).tolist(),
}
json.dump(summary, open(os.path.join(out, "ltas.json"), "w"), indent=1)
print(json.dumps({k: v for k, v in summary.items() if k not in ("conds", "R_curve", "S_curve", "chunks")}, indent=1))
print("cond\tHrms\tHslope\tlowfracH\ta_m\ta_f\tcos_m\tcos_f")
for r in rows:
    print(f"{r['cond']}\t{r['Hrms']:.2f}\t{r['Hslope_dB_oct']:.2f}\t{r['lowfracH']:.2f}\t{r['a_m']:+.3f}\t{r['a_f']:+.3f}\t{r['cos_m']:+.2f}\t{r['cos_f']:+.2f}")
