# linefeat.py — per-line micro-variation features, voice lines vs machine
# lines (notch voice-vs-machine DISCRIMINATE phase, 2026-10-05).
#
#   python scripts/notch-adversarial/realdata/linefeat.py --kind=noise|voice|mix [--jobs=5]
#          [--win=1024] [--wch=40] [--sources=a,b] [--set=held_series|voice_in_noise|noise_gated]
#          [--degrade=white:20,10,0] [--partners=0.5,1.5,3] [--out=TAG]
#
#   --kind=mix   lines in the pre-rendered mixes: held_series (all held-matched
#                lines = voice), voice_in_noise (lines born >= 0.5 s before the
#                voice program = machine, windows tagged phase lead / voice /
#                tail; lines born later on a held harmonic = voice), noise_gated
#                (all lines = machine, windows overlapping an off-gate tagged).
#   --partners   extra coherence partners h x f (besides 2f): per window
#                s1_<p> = mean(m1 m_h), ss_<p> = mean(m_h^2), lv_<p> (dB re line)
#   --degrade    voice only: also measure each clip with white Gaussian noise
#                added at these SNRs (dB, vs the RMS over its held segments;
#                seeded per clip) -> column deg (inf = clean).
#
# LINES are found exactly where the notch would find them: the shipped
# observe() peak finder (census.py's 1:1 port: 512 ms Hann, 16384-pt FFT,
# 50-460 Hz, 8x median, -26 dB rel floor, narrow at +-5 Hz, 10 Hz min-sep)
# every 100 ms, tracked with the notch's 3 Hz association and 2 s miss
# tolerance. A voice line is a track that sits on k x the held segment's F0
# (k = 1..8, +-3 %) inside a held segment; a machine line is any track in a
# non-speech noise clip. Only lines in 80-400 Hz are kept.
#
# PER-LINE MEASUREMENT (online-computable: per 25 ms chunk, per tracked line,
# two windowed DFT coefficients — cheap):
#   the line's complex DFT coefficient at the track's CAUSAL frequency
#   estimate f_ref (the notch's 0.9/0.1 EMA as of the last observation), on a
#   WIN-sample (default 1024 = 64 ms) Hann window ending at each 25 ms chunk
#   boundary and on the window one chunk earlier; the phase advance gives the
#   instantaneous frequency (phase-vocoder IF, unambiguous within +-20 Hz),
#   |X| the line amplitude. The same at 2 f_ref (the line's own 2nd
#   harmonic) for cross-harmonic coherence.
#
# PER-WINDOW FEATURES (1 s = 40 chunks, non-overlapping) — see feats().
# Output: build/notchvd/linefeat/<kind>[_TAG].csv, one row per (line, window).
import os, sys, json, math, zlib
from concurrent.futures import ProcessPoolExecutor
import numpy as np, soundfile as sf
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from common import DATA, BUILD, SR, args
from census import observe_all, track

A = args()
KIND = A.get("kind", "noise")
JOBS = int(A.get("jobs", 5))
WIN = int(A.get("win", 1024))
CH = 400                     # 25 ms chunk
WCH = int(A.get("wch", 40))  # chunks per feature window (40 = 1 s)
FLO, FHI = 80.0, 400.0
MAXSEC = 90.0                # first 90 s of a clip (as probe.mjs)
OUTD = os.path.join(BUILD, "linefeat"); os.makedirs(OUTD, exist_ok=True)
HANN = 0.5 - 0.5 * np.cos(2 * np.pi * np.arange(WIN) / (WIN - 1))

# DEMAND environments with people talking: their lines may be voices.
SPEECHY = {"OMEETING", "PCAFETER", "PRESTO", "PSTATION", "SPSQUARE", "OHALLWAY", "NPARK"}


def ema_of(fs):
    e = np.empty(len(fs)); v = fs[0]
    for i, f in enumerate(fs):
        v = f if i == 0 else 0.9 * v + 0.1 * f
        e[i] = v
    return e


def coeffs(x, ncs, fref, h):
    """Windowed DFT coefficient at h*fref (absolute-time phase) for windows
    ending at ncs and ncs-CH. Returns (X, Xprev)."""
    out, outp = np.empty(len(ncs), complex), np.empty(len(ncs), complex)
    ar = np.arange(WIN)
    for b in range(0, len(ncs), 256):
        nc = ncs[b:b + 256]; f = fref[b:b + 256] * h
        idx = nc[:, None] - WIN + ar[None, :]
        ph = np.exp(-2j * np.pi * f[:, None] * (idx / SR))
        out[b:b + 256] = np.sum(x[idx] * HANN * ph, axis=1)
        idp = idx - CH
        php = ph * np.exp(2j * np.pi * f[:, None] * (CH / SR))  # same f, one chunk earlier
        outp[b:b + 256] = np.sum(x[idp] * HANN * php, axis=1)
    return out, outp


def ma(v, k=5):
    return np.convolve(v, np.ones(k) / k, mode="valid")


def rms(v):
    return float(np.sqrt(np.mean(np.square(v)))) if len(v) else float("nan")


def rmad(v):
    return float(1.4826 * np.median(np.abs(v - np.median(v)))) if len(v) else float("nan")


def detrend(v):
    t = np.arange(len(v)); p = np.polyfit(t, v, 1)
    return v - np.polyval(p, t), p[0]


def scov(a, b):
    c = float(np.mean(a * b)); return math.copysign(math.sqrt(abs(c)), c)


def corr(a, b):
    sa, sb = np.std(a), np.std(b)
    return float(np.mean((a - a.mean()) * (b - b.mean())) / (sa * sb)) if sa > 0 and sb > 0 else float("nan")


PARTNERS = [float(v) for v in A["partners"].split(",")] if "partners" in A else []
PTAG = {h: "p" + str(h).replace(".", "_").replace("_0", "") for h in PARTNERS}


def mid_of(fi):
    c = 1200 * np.log2(np.maximum(fi, 1e-3) / np.median(fi))
    m, _ = detrend(ma(c))
    return m


def partner_stats(fi1, a1, fih, ah, tag):
    """Sufficient stats for pooled mid-band coherence of the line with a
    partner component at h x f (h = 0.5 / 1.5 / 3 ...): s1 = mean(m1 mh),
    ss = mean(mh^2), lv = median partner level re the line (dB)."""
    m1, mh = mid_of(fi1), mid_of(fih)
    return {f"s1_{tag}": float(np.mean(m1 * mh)), f"ss_{tag}": float(np.mean(mh * mh)),
            f"lv_{tag}": float(np.median(20 * np.log10((ah + 1e-12) / (a1 + 1e-12))))}


def feats(fi1, a1, fi2, a2):
    """Features of one window. fi*: IF (Hz), a*: |X| per chunk."""
    c1 = 1200 * np.log2(np.maximum(fi1, 1e-3) / np.median(fi1))
    c2 = 1200 * np.log2(np.maximum(fi2, 1e-3) / np.median(fi2))
    d1 = 20 * np.log10(a1 + 1e-12); d2 = 20 * np.log10(a2 + 1e-12)
    s1, s2 = ma(c1), ma(c2)
    r1, r2 = c1[2:-2] - s1, c2[2:-2] - s2            # fast: > ~8 Hz (5-pt MA = 125 ms)
    m1, slope1 = detrend(s1); m2, _ = detrend(s2)     # mid: ~0.5-8 Hz (vibrato / tremor / wander)
    ds = ma(d1); ar_ = d1[2:-2] - ds; am_, _ = detrend(ds)
    hr = d2 - d1; hs = ma(hr); hm, _ = detrend(hs)
    return dict(
        f=float(np.median(fi1)),
        fm_fast=rms(r1), fm_fast_r=rmad(r1), fm_d1=rms(np.diff(c1)) / math.sqrt(2),
        fm_mid=rms(m1), fm_mid_r=rmad(m1), fm_std=float(np.std(c1)), fm_slope=float(slope1 * 40),  # cents/s
        fm2_fast=rms(r2), fm2_mid=rms(m2),
        coh_fast=scov(r1, r2), corr_fast=corr(r1, r2),
        coh_mid=scov(m1, m2), corr_mid=corr(m1, m2),
        am_fast=rms(ar_), am_mid=rms(am_), am_std=float(np.std(d1)),
        hr_mid=rms(hm), hr_fast=rms(hr[2:-2] - hs), h21=float(np.median(hr)),
        lvl=float(np.median(d1)),
    )


DEGRADE = [float(v) for v in A["degrade"].split(":")[1].split(",")] if "degrade" in A else []


def process(rec):
    try:
        x0, sr = sf.read(os.path.join(DATA, rec["path"]), dtype="float64")
        if x0.ndim == 2: x0 = x0[:, 0]
        x0 = x0[: int(MAXSEC * SR)]
        if len(x0) < 8192 + 3 * SR // 2: return []
        out = []
        for deg in [math.inf] + DEGRADE:
            x = x0
            if deg != math.inf:
                held = rec.get("held") or []
                m = np.zeros(len(x0), bool)
                for h in held: m[int(h[0] * SR):int(h[1] * SR)] = True
                pr = float(np.mean(x0[m] ** 2)) if m.any() else float(np.mean(x0 ** 2))
                rng = np.random.default_rng(zlib.crc32(rec["id"].encode()) + int(deg * 10) + 1000)
                x = x0 + rng.standard_normal(len(x0)) * math.sqrt(pr / 10 ** (deg / 10))
            for r in process_x(rec, x): r["deg"] = deg; out.append(r)
        return out
    except Exception as e:
        print("ERR", rec["id"], repr(e), file=sys.stderr)
        return []


def role_of(rec, t_first):
    """mix line role: machine (pre-existing) / voice (held-matched) / None."""
    st = rec.get("set")
    if st == "noise_gated": return "machine"
    if st == "voice_in_noise" and t_first < rec["voice_t0"] - 0.5: return "machine"
    return "voice"


def process_x(rec, x):
    if True:
        t_obs, peaks = observe_all(x)
        trs = track(peaks, keep_sec=2.0)
        rows = []
        held = rec.get("held") or []
        if rec["kind"] == "mix": held = rec.get("holds") or []
        for li, tr in enumerate(trs):
            if not (FLO <= tr["f_med"] <= FHI): continue
            span_s = tr["span_s"]
            if span_s < 1.0 or tr["duty"] < 0.5: continue
            obs = np.array(tr["obs"]); fs = np.array(tr["fs"]); ema = ema_of(fs)
            n_o = np.round(t_obs[obs] * SR).astype(int)
            ncs = np.arange(n_o[0], n_o[-1] + 1, CH)
            ncs = ncs[ncs - CH - WIN >= 0]
            if len(ncs) < WCH: continue
            j = np.searchsorted(n_o, ncs, side="right") - 1
            fref = ema[j]
            # global obs index at each chunk; chunk valid if its latest obs saw the line (1 miss allowed)
            g = np.floor((ncs - 8192) / 1600 + 1e-9).astype(int)
            valid = (g - obs[j]) <= 1
            tcen = (ncs - WIN / 2) / SR  # window centre time
            # voice: restrict to held segments where the line is a harmonic of F0
            kk = 0
            role = rec["kind"] if rec["kind"] != "mix" else role_of(rec, t_obs[obs[0]] - 0.512)
            if role == "noise": role = "machine"
            if role == "voice":
                seg_ok = np.zeros(len(ncs), bool)
                for (t0, t1, f0, *_r) in held:
                    if not f0: continue
                    inn = ((ncs - WIN - CH) / SR >= t0) & (ncs / SR <= t1)
                    if inn.sum() < WCH: continue
                    fm = float(np.median(fref[inn]))
                    k = round(fm / f0)
                    if 1 <= k <= 8 and abs(fm / (k * f0) - 1) < 0.03:
                        seg_ok |= inn; kk = k
                valid &= seg_ok
                if valid.sum() < WCH: continue
            X1, X1p = coeffs(x, ncs, fref, 1)
            X2, X2p = coeffs(x, ncs, fref, 2)
            dt = CH / SR
            fi1 = fref + np.angle(X1 * np.conj(X1p)) / (2 * np.pi * dt)
            fi2 = 2 * fref + np.angle(X2 * np.conj(X2p)) / (2 * np.pi * dt)
            a1, a2 = np.abs(X1), np.abs(X2)
            part = {}
            for h in PARTNERS:
                if h * float(np.min(fref)) < 40: continue
                Xh, Xhp = coeffs(x, ncs, fref, h)
                part[h] = (h * fref + np.angle(Xh * np.conj(Xhp)) / (2 * np.pi * dt), np.abs(Xh))
            prom_by_obs = dict(zip(tr["obs"], 10 * np.log10(np.maximum(1e-9, np.array(peaks_prom(peaks, tr))))))
            # non-overlapping windows over runs of valid chunks
            w = 0; i = 0
            while i + WCH <= len(ncs):
                if not valid[i:i + WCH].all():
                    i += 1; continue
                sl = slice(i, i + WCH)
                fd = feats(fi1[sl], a1[sl], fi2[sl], a2[sl])
                for h, (fih, ah) in part.items():
                    fd.update(partner_stats(fi1[sl], a1[sl], fih[sl], ah[sl], PTAG[h]))
                ob = [o for o in range(g[i] - 4, g[i + WCH - 1] + 1) if o in prom_by_obs]
                fd["snr"] = float(np.median([prom_by_obs[o] for o in ob])) if ob else float("nan")
                t_a, t_b = (ncs[i] - WIN - CH) / SR, ncs[i + WCH - 1] / SR
                extra = {}
                if rec["kind"] == "mix":
                    extra = dict(set=rec["set"], noise_id=rec.get("noise_id", ""), noise_label=rec.get("noise_label", ""),
                                 snr_db=rec.get("snr_db", ""), voice_kind=rec.get("voice_kind", ""), gap_s=rec.get("gap_s", ""),
                                 period_s=rec.get("period_s", ""), off_s=rec.get("off_s", ""))
                    if rec["set"] == "voice_in_noise":
                        extra["phase"] = "lead" if t_b < rec["voice_t0"] else ("voice" if t_a < rec["voice_t1"] else "tail")
                    if rec["set"] == "noise_gated":
                        extra["gated"] = any(t_a < b and t_b > a for a, b in rec["gates_abs"])
                rows.append(dict(id=rec["id"], source=rec["source"], kind=rec["kind"], role=role, cls=rec.get("class", ""),
                                 label=rec.get("label", ""), line=li, line_f=round(tr["f_med"], 2),
                                 line_span=span_s, line_duty=round(tr["duty"], 3),
                                 line_frange=round(tr["f_hi"] - tr["f_lo"], 2), k=kk, win=w,
                                 t0=round(float(tcen[i]), 3), **extra, **{k_: (round(v, 4) if isinstance(v, float) else v) for k_, v in fd.items()}))
                w += 1; i += WCH
        return rows


def peaks_prom(peaks, tr):
    """prominence (peak / band median) of the track's own peak at each obs."""
    out = []
    for o, f in zip(tr["obs"], tr["fs"]):
        pr = [p[2] for p in peaks[o] if abs(p[0] - f) < 1e-6]
        out.append(pr[0] if pr else 1.0)
    return out


def select():
    idx = json.load(open(os.path.join(DATA, f"index_{KIND}.json")))
    if KIND == "mix": return [r for r in idx if r["set"] == A.get("set", "held_series")]
    srcs = A["sources"].split(",") if "sources" in A else None
    out = []
    for r in idx:
        if r.get("dup_of") or r["source"] == "synthfloor": continue
        if srcs and r["source"] not in srcs: continue
        if KIND == "noise" and r["source"] == "demand" and r["class"] in SPEECHY: continue
        if KIND == "voice" and not any((h[1] - h[0]) >= WCH * CH / SR + 0.1 for h in (r.get("held") or [])): continue
        out.append(r)
    return out


if __name__ == "__main__":
    import pandas as pd
    recs = select()
    recs.sort(key=lambda r: -r["dur"])  # long first for load balance
    print(f"{KIND}: {len(recs)} clips", flush=True)
    rows = []
    with ProcessPoolExecutor(JOBS) as ex:
        for n, rr in enumerate(ex.map(process, recs, chunksize=2)):
            rows += rr
            if n % 100 == 0: print(n, len(rows), flush=True)
    tag = ("_" + A["out"]) if "out" in A else ""
    p = os.path.join(OUTD, f"{KIND}{'_' + A.get('set', 'held_series') if KIND == 'mix' else ''}{tag}.csv")
    pd.DataFrame(rows).to_csv(p, index=False)
    print("wrote", p, len(rows))
