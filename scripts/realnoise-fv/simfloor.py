# simfloor.py — offline simulation of a NOISE-FLOOR voicing veto on attr.mjs
# dumps (2026-10-05, exploration). Sequential, causal, with the veto's own
# feedback (a vetoed frame becomes a background frame):
#
#   per chunk k: P_k = power spectrum of the analysis frame (last 1280 samples,
#     Hann, 2048-point FFT), S_k = mean of P over frames k-2..k
#   background reference R: running mean of P over the last RM frames the
#     worker did NOT post voiced (after this veto) — the noise as heard
#     between voicing; N_k = min of R over the last W frames (minimum
#     statistics; R holds its value while frames are voiced)
#   ex_h(k) = max over +-min(3 % h f0, 0.2 f0) of 10 log10(S_k / N_k), h = 1..8
#   a posted frame is vetoed after D consecutive posted frames with fewer
#     than M harmonics at ex_h >= X dB; fail-open while R has seen fewer than
#     MINBG background frames
#
#   python scripts/realnoise-fv/simfloor.py FROMTAG SET NEWTAG W:RM:X:M:D:MINBG [--shard=i/n]
#   ... NEWTAG U:W:FSM:X:M:D:WARM:G   (ungated, segment-frozen floor; see the code)
import sys, os, glob, json
import numpy as np

A = dict((a[2:].split("=", 1) + ["1"])[:2] for a in sys.argv[1:] if a.startswith("--"))
FROM, SET, NEW, RULE = [a for a in sys.argv[1:] if not a.startswith("--")][:4]
UNG = RULE.startswith("U:")
if UNG:
    # "U:W:FSM:X:M:D:WARM:G" — UNGATED floor: N_k = min over the W frames before k
    # of the FSM-frame causal moving average of P (all frames), FROZEN at the
    # start of each voiced segment (posted frames with gaps <= G frames); a
    # segment starting before WARM s fails open for its whole length
    W, RM, X, M, D, WARMS, G = [float(v) for v in RULE[2:].split(":")]
    W, RM, M, D, G = int(W), int(RM), int(M), int(D), int(G)
    MINBG = 0
else:
    W, RM, X, M, D, MINBG = [float(v) for v in RULE.split(":")]
    W, RM, M, D, MINBG = int(W), int(RM), int(M), int(D), int(MINBG)
ROOT = os.path.join(A.get("data-root", os.environ.get("NOTCHVD_ROOT", "build/notchvd")), "data")
CORP = A.get("corpora", os.environ.get("SYRINX_CORPORA_DIR", "tests/dsp/data"))
ATTR = "build/realnoise-fv/attr"
src, dst = os.path.join(ATTR, FROM, SET), os.path.join(ATTR, NEW, SET)
os.makedirs(dst, exist_ok=True)
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import harmfeat_audio as HA  # noqa: E402

NF, FL, SR = 2048, 1280, 16000
HANN = 0.5 - 0.5 * np.cos(2 * np.pi * np.arange(FL) / (FL - 1))
BIN = SR / NF
NB = int(4000 / BIN) + 2
BLK = 40                      # min-statistics sub-window (frames)
NBLK = max(1, W // BLK)

names = sorted(os.path.basename(p)[:-5] for p in glob.glob(os.path.join(src, "*.json")))
shI, shN = map(int, A.get("shard", "0/1").split("/"))
stats = [0, 0]
for nm in names[shI::shN]:
    m = json.load(open(os.path.join(src, nm + ".json")))
    a = np.fromfile(os.path.join(src, nm + ".f32"), dtype=np.float32).reshape(len(m["cols"]), m["n"])
    c = {k: a[i] for i, k in enumerate(m["cols"])}
    x, sr = HA.audio(SET, m, ROOT, CORP)
    Cn = m.get("C") or round(sr * 0.025)
    n = m["n"]
    P = np.full((n, NB), 1e-20)
    ends = np.array([int(round((k + 1) * Cn / sr * SR)) for k in range(n)])
    idx = np.nonzero((ends >= FL) & (ends <= len(x)))[0]
    for s in range(0, len(idx), 512):
        ks = idx[s:s + 512]
        X_ = np.fft.rfft(np.stack([x[e - FL:e] for e in ends[ks]]) * HANN, NF, axis=1)[:, :NB]
        P[ks] = X_.real ** 2 + X_.imag ** 2 + 1e-20
    bad = ~((ends >= FL) & (ends <= len(x)))   # frames before the 80 ms buffer fills
    P[bad] = P[~bad].max() if (~bad).any() else 1.0   # never a floor minimum
    S = P.copy()
    S[2:] = (P[2:] + P[1:-1] + P[:-2]) / 3
    post, conf = c["post"], c["conf"]
    if UNG:
        cs = np.cumsum(np.vstack([np.zeros((1, NB)), P]), axis=0)
        kk = np.arange(n); lo_ = np.maximum(0, kk - RM + 1)
        SF = (cs[kk + 1] - cs[lo_]) / (kk - lo_ + 1)[:, None]
        hop = m["hopS"]
        Nseg = None; last = -10**9; streak = 0
        bm = np.full((NBLK, NB), np.inf); bi = 0; bc = 0   # min of SF over the last ~W frames, before k
        for k in range(n):
            if post[k] > 0:
                if k - last > G + 1:
                    Nseg = bm.min(0) if ((k + 1) * hop - 0.04 >= WARMS and np.isfinite(bm.min())) else None
                    streak = 0
                ok = True
                if Nseg is not None:
                    f0 = c["dec"][k] if c["dec"][k] > 0 else post[k]
                    cnt = 0
                    for h in range(1, 9):
                        f = h * f0
                        if f > 3800:
                            break
                        half = min(0.03 * f, 0.2 * f0)
                        lo, hi = max(1, int(np.floor((f - half) / BIN))), min(NB - 1, int(np.ceil((f + half) / BIN)))
                        if 10 * np.log10((S[k, lo:hi + 1] / Nseg[lo:hi + 1]).max()) >= X:
                            cnt += 1
                    ok = cnt >= M
                streak = 0 if ok else streak + 1
                if streak >= D:
                    post[k] = 0.0
                    d = c["s0"][k] - c["uv"][k]
                    conf[k] = max(0, min(0.499, 0.5 + d))
                    stats[0] += 1
                else:
                    stats[1] += 1
                    last = k
            if ends[k] >= FL:
                bm[bi] = np.minimum(bm[bi], SF[k])
            bc += 1
            if bc >= BLK:
                bc = 0; bi = (bi + 1) % NBLK; bm[bi] = np.inf
        a.tofile(os.path.join(dst, nm + ".f32"))
        json.dump({**m, "simfloor": RULE, "simFrom": FROM}, open(os.path.join(dst, nm + ".json"), "w"))
        continue
    ring = np.zeros((RM, NB)); rn = 0; rpos = 0; nbg = 0
    R = None
    blkmin = np.full((NBLK, NB), np.inf); bi = 0; bcount = 0
    streak = 0
    for k in range(n):
        if post[k] > 0:
            ok = True
            if nbg >= MINBG:
                Nk = blkmin.min(0)
                f0 = c["dec"][k] if c["dec"][k] > 0 else post[k]
                cnt = 0
                for h in range(1, 9):
                    f = h * f0
                    if f > 3800:
                        break
                    half = min(0.03 * f, 0.2 * f0)
                    lo, hi = max(1, int(np.floor((f - half) / BIN))), min(NB - 1, int(np.ceil((f + half) / BIN)))
                    if 10 * np.log10((S[k, lo:hi + 1] / Nk[lo:hi + 1]).max()) >= X:
                        cnt += 1
                ok = cnt >= M
            streak = 0 if ok else streak + 1
            if streak >= D:
                post[k] = 0.0
                d = c["s0"][k] - c["uv"][k]
                conf[k] = max(0, min(0.499, 0.5 + d))
                stats[0] += 1
            else:
                stats[1] += 1
        if not post[k] > 0 and np.isfinite(P[k, 0]) and ends[k] >= FL:
            ring[rpos] = P[k]; rpos = (rpos + 1) % RM; rn = min(RM, rn + 1); nbg += 1
            R = ring[:rn].mean(0)
        if R is not None:
            blkmin[bi] = np.minimum(blkmin[bi], R)
        bcount += 1
        if bcount >= BLK:
            bcount = 0; bi = (bi + 1) % NBLK; blkmin[bi] = np.inf if R is None else R.copy()
    a.tofile(os.path.join(dst, nm + ".f32"))
    json.dump({**m, "simfloor": RULE, "simFrom": FROM}, open(os.path.join(dst, nm + ".json"), "w"))
print(f"{FROM} -> {NEW} {SET} {RULE} {shI}/{shN}: vetoed {stats[0]} of {sum(stats)} posted frames")
