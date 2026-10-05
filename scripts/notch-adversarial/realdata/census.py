# census.py — tonal-line census of the real-noise corpus + data-driven labels.
#
#   python scripts/notch-adversarial/realdata/census.py [--sources=a,b] [--jobs=4] [--png=tonal|intermittent|all|none]
#
# For every noise clip (data/manifests/noise.*.json):
#  1. LINES — the shipped notch's own peak finder (src/dsp/noise-notch.js
#     observe(), ported 1:1: 512 ms Hann window, 16384-pt FFT, 50-460 Hz,
#     >= 8x band median, >= band max - 26 dB, narrow at +-5 Hz < 0.15x, 10 Hz
#     min separation, top 12) every 100 ms, tracked with 3 Hz association;
#     a census track survives 3 s of absence (the notch: 2 s) so a line that
#     cuts out is one track with gaps, not two tracks.
#  2. SOURCE CUTS — the 512 ms observation window cannot see a 0.15 s cut,
#     so up to 3 strong lines (span >= min(5 s, half the clip), duty >= 0.3)
#     are demodulated along their tracked frequency (complex heterodyne, 8 Hz
#     low-pass -> +-8 Hz band, 10 ms grid). A line is DOWN when >= 10 dB under
#     its 70th-percentile level (hysteresis: back after 0.15 s within 5 dB);
#     only lines with >= 13 dB SNR vs the +-20..40 Hz neighbourhood are
#     measured (at 10 dB a 10 dB noise-flicker dip happens every few seconds).
#     A CUT = every measured line down at once for >= 0.15 s; with one
#     measured line >= 0.3 s plus a >= 3 dB 50-4000 Hz band-level dip vs the
#     surrounding +-1 s. A line dropping alone is beating (two components a
#     few Hz apart, e.g. a compressor line next to a mains harmonic) or FM out
#     of the demodulation band (fan blade-pass) — not a source switching off.
#     (Two earlier per-line rules counted 20-180 spurious "cuts" per minute on
#     visibly steady fridge / AC / exhaust-fan lines — checked by spectrogram.)
#  3. LABEL — stationary-tonal | intermittent-tonal | broadband | mixed
#     (+ flags short / drifting / single_line / cuts_unmeasurable / cuts/min /
#     r8_pattern / equal_tempered), rules in label() below and in README.md.
# Writes data/census/noise_census.json (per clip: lines, per-line gaps, cuts,
# label, flags) and spectrogram PNGs (data/census/png/; --png=tonal: tonal
# labels, intermittent: intermittent only); build_index.py merges the labels
# into data/index_noise.json.
import os, json, glob, math
from concurrent.futures import ProcessPoolExecutor
import numpy as np, soundfile as sf
from scipy.signal import butter, sosfiltfilt
from common import DATA, SR, args, load_manifest

A = args()
JOBS = int(A.get("jobs", 4))
PNG = A.get("png", "intermittent")
OUT = os.path.join(DATA, "census"); os.makedirs(OUT, exist_ok=True)

# ---- notch peak finder (NOTCH_DEFAULTS of bc42ad0 / 7ebec37) ---------------
CFG = dict(bandLo=50, bandHi=460, obsLen=8192, fft=16384, prom=8, relFloorDb=26, narrowOffHz=5, narrowRatio=0.15, minSepHz=10, matchHz=3)
HOP_OBS = 1600  # 100 ms at 16 kHz (4 x 25 ms chunks)

def observe_all(x):
    N, L = CFG["fft"], CFG["obsLen"]
    binHz = SR / N
    lo = max(2, int(math.floor(CFG["bandLo"] / binHz))); hi = min(N // 2 - 2, int(math.ceil(CFG["bandHi"] / binHz)))
    w = 0.5 - 0.5 * np.cos(2 * np.pi * np.arange(L) / (L - 1))
    starts = np.arange(L, len(x) + 1, HOP_OBS) - L  # observation = buffer ending at chunk boundary
    peaks_all = []; t_obs = (starts + L) / SR
    off = max(2, round(CFG["narrowOffHz"] / binHz))
    for b0 in range(0, len(starts), 256):
        st = starts[b0:b0 + 256]
        fr = np.stack([x[s:s + L] for s in st]) * w
        P = np.abs(np.fft.rfft(fr, N, axis=1)[:, lo:hi + 1]) ** 2
        for p in P:
            srt = np.sort(p); med = srt[len(srt) // 2] or 1e-12; mx = srt[-1] or 1e-12
            rel = mx * 10 ** (-CFG["relFloorDb"] / 10)
            k = np.arange(off, len(p) - off)
            c = (p[k] > p[k - 1]) & (p[k] >= p[k + 1]) & (p[k] >= CFG["prom"] * med) & (p[k] >= rel) \
                & (p[k - off] <= CFG["narrowRatio"] * p[k]) & (p[k + off] <= CFG["narrowRatio"] * p[k])
            raw = []
            for kk in k[c]:
                a_, b_, c_ = p[kk - 1], p[kk], p[kk + 1]; den = a_ - 2 * b_ + c_
                dt = max(-0.5, min(0.5, 0.5 * (a_ - c_) / den)) if den != 0 else 0
                raw.append(((lo + kk + dt) * binHz, b_, b_ / med))
            raw.sort(key=lambda q: -q[1])
            acc = []
            for q in raw:
                if all(abs(q[0] - r[0]) >= CFG["minSepHz"] for r in acc): acc.append(q)
            peaks_all.append(acc[:12])
    return t_obs, peaks_all

def track(peaks_all, keep_sec=3.0):
    keep = int(keep_sec * 10)
    tracks, live = [], []
    for i, pk in enumerate(peaks_all):
        seen = set()
        for f, pw, prom in pk:
            best, bd = None, CFG["matchHz"]
            for t in live:
                d = abs(t["f"] - f)
                if d < bd and id(t) not in seen: best, bd = t, d
            if best is None:
                best = dict(f=f, first=i, obs=[], fs=[], pw=[], prom=[]); tracks.append(best); live.append(best)
            best["f"] = 0.9 * best["f"] + 0.1 * f if best["obs"] else f
            best["obs"].append(i); best["fs"].append(f); best["pw"].append(pw); best["prom"].append(prom); seen.add(id(best))
        live = [t for t in live if i - t["obs"][-1] <= keep]
    out = []
    for t in tracks:
        span = t["obs"][-1] - t["obs"][0] + 1
        out.append(dict(first=t["obs"][0], last=t["obs"][-1], span_s=span / 10, duty=len(t["obs"]) / span,
                        f_med=float(np.median(t["fs"])), f_lo=float(np.percentile(t["fs"], 5)), f_hi=float(np.percentile(t["fs"], 95)),
                        pw_med=float(np.median(t["pw"])), prom_med_db=float(10 * np.log10(np.median(t["prom"]))),
                        obs=t["obs"], fs=t["fs"]))
    return out

def runs(mask, hop):
    """[(start_s, len_s)] of True runs."""
    out = []; k = 0; n = len(mask)
    while k < n:
        if mask[k]:
            j = k
            while j < n and mask[j]: j += 1
            out.append((k * hop, (j - k) * hop)); k = j
        else: k += 1
    return out

SOS = butter(4, 8, fs=SR, output="sos")
def line_env(x, t_obs, tr):
    """10 ms envelope (dB) of a line demodulated along its tracked frequency, plus a neighbourhood floor."""
    n = len(x); tt = np.arange(n) / SR
    # frequency trajectory: tracked obs freqs, held at the ends, interpolated
    to = t_obs[np.array(tr["obs"])] - CFG["obsLen"] / SR / 2
    fi = np.interp(tt, to, np.array(tr["fs"]))
    ph = 2 * np.pi * np.cumsum(fi) / SR
    def env(dfo):
        z = x * np.exp(-1j * (ph + 2 * np.pi * dfo * tt))
        e = np.abs(sosfiltfilt(SOS, z.real) + 1j * sosfiltfilt(SOS, z.imag))
        m = len(e) // 160 * 160
        return 10 * np.log10(np.mean(e[:m].reshape(-1, 160) ** 2, axis=1) + 1e-20)
    e = env(0.0)
    nb = np.median(np.stack([env(d) for d in (-40, -25, 25, 40)]), axis=0)
    return e, nb

def band_env(x):
    sos = butter(4, [50, 4000], btype="band", fs=SR, output="sos")
    y = sosfiltfilt(sos, x); m = len(y) // 160 * 160
    return 10 * np.log10(np.mean(y[:m].reshape(-1, 160) ** 2, axis=1) + 1e-20)

def gaps_of(e, ref, drop, valid=None):
    """Hysteresis gaps: enter below ref-drop, leave only after >= 0.15 s back
    above ref-drop/2 (envelope flicker inside an off period does not split it);
    gaps >= 0.1 s that END before the clip does (the line came back)."""
    lo, hi = ref - drop, ref - drop / 2
    out = []; k = 0; n = len(e); hold = 15
    while k < n:
        if e[k] < lo and (valid is None or valid[k]):
            j = k; back = 0
            while j < n:
                if e[j] >= hi: back += 1
                else: back = 0
                if back >= hold: break
                j += 1
            end = j - back + 1 if j < n else n
            L = (end - k) * 0.01
            if L >= 0.1 and j < n: out.append((round(k * 0.01, 2), round(L, 2)))
            k = j + 1
        else: k += 1
    return out

def classify_gaps(g):
    d = dict(g01_015=sum(l < 0.15 for _, l in g), g015_1=sum(0.15 <= l <= 1.0 for _, l in g),
             g1_3=sum(1.0 < l <= 3.0 for _, l in g), g3_10=sum(3.0 < l <= 10.0 for _, l in g), g10p=sum(l > 10.0 for _, l in g))
    # the R8 adversary's signature: >= 3 cuts of 0.15-1 s recurring every 2-15 s
    st = [s for s, l in g if 0.15 <= l <= 1.0]
    iv = np.diff(st) if len(st) >= 3 else np.array([])
    d["short_cut_interval_med"] = round(float(np.median(iv)), 2) if len(iv) else None
    d["r8_pattern"] = bool(len(iv) >= 2 and 2.0 <= np.median(iv) <= 15.0)
    return d

def analyse(rec):
    x, sr = sf.read(os.path.join(DATA, rec["path"]), dtype="float64")
    dur = len(x) / SR
    if dur < 1.0: return dict(id=rec["id"], dur=dur, label="short", flags=["too_short"], lines=[])
    t_obs, pk = observe_all(x)
    nobs = len(pk)
    trs = track(pk)
    min_span = min(5.0, 0.5 * max(0.1, nobs / 10))
    cand = sorted([t for t in trs if t["span_s"] >= min_span and t["duty"] >= 0.3], key=lambda t: -t["pw_med"] * t["duty"])
    strong = []
    for t in cand:  # a tracker split leaves two tracks on one line: keep the stronger
        if all(abs(t["f_med"] - u["f_med"]) >= CFG["matchHz"] for u in strong): strong.append(t)
    be = band_env(x); bref = np.median(be)
    band_gaps = gaps_of(be, float(np.percentile(be, 60)), 10)
    lines = []
    masks = []  # per measured line: 10 ms "down" mask on the clip grid
    for t in strong[:3]:
        e, nb = line_env(x, t_obs, t)
        lo_i = max(0, int((t_obs[t["first"]] - 0.512) * 100)); hi_i = min(len(e), int(t_obs[t["last"]] * 100) + 1)
        e_l, nb_l = e[lo_i:hi_i], nb[lo_i:hi_i]
        ref = float(np.percentile(e_l, 70))  # "on" level (robust to a line off <= 60 % of its span)
        snr = float(ref - np.median(nb_l))
        # gaps only where a 10 dB dip cannot be in-band noise flicker: at >= 13 dB
        # line SNR a 10 dB dip needs a noise phasor >= 0.68x the line (p ~ 1e-4
        # per 60 ms), at 10 dB it happens every few seconds (measured: ~20
        # spurious 0.15-1 s "cuts" per minute on steady AC lines)
        drop = 10.0
        g = gaps_of(e_l, ref, drop) if snr >= 13 else None
        measured = g is not None
        g = [(round(s + lo_i / 100, 2), l) for s, l in (g or [])]
        if measured:
            mk = np.zeros(len(e), bool)
            for s0, l0 in g: mk[int(round(s0 * 100)):int(round((s0 + l0) * 100))] = True
            masks.append(mk)
        lines.append(dict(f_med=round(t["f_med"], 2), f_range=round(t["f_hi"] - t["f_lo"], 2), span_s=t["span_s"], duty=round(t["duty"], 3),
                          prom_db=round(t["prom_med_db"], 1), snr_db=round(snr, 1), gaps_measured=measured, gaps=g, **classify_gaps(g),
                          obs_presence=round(t["duty"], 3)))
    # SOURCE CUTS: every measured line down at once (a device switching off
    # silences all its lines; one line alone dropping is beating / FM between
    # close components — seen on fridge / fan lines next to a mains harmonic).
    # With a single measured line a cut must last >= 0.3 s (a two-component
    # beat null at >= 1 Hz spacing is shorter).
    cuts = []
    if masks:
        both = np.logical_and.reduce(masks)
        minlen = 0.15 if len(masks) >= 2 else 0.3
        cuts = [(round(s0, 2), round(l0, 2)) for s0, l0 in runs(both, 0.01) if l0 >= minlen and s0 + l0 < dur - 0.05]
        if len(masks) == 1:
            # one measured line: a lone line also "drops" when it wobbles out of
            # the +-8 Hz demodulation band (fan blade-pass FM, seen by eye on
            # freesound exhaust/fan clips), so a single-line cut also needs the
            # 50-4000 Hz band level >= 3 dB under its +-1 s surroundings
            keep = []
            for s0, l0 in cuts:
                a, b = int(s0 * 100), int((s0 + l0) * 100)
                ctx = np.concatenate([be[max(0, a - 100):a], be[b:b + 100]])
                if len(ctx) and np.median(ctx) - np.median(be[a:b]) >= 3: keep.append((s0, l0))
            cuts = keep
    meas = [l for l in lines if l["snr_db"] >= 13]
    et = [l for l in meas if l["f_med"] >= 130 and abs((1200 * math.log2(l["f_med"] / 440) + 6000) % 100 - 50) >= 45]
    # census label
    lab, flags = label(dur, lines, cuts, len(masks))
    if et and len(et) == len(meas): flags.append("equal_tempered")  # every measured line within 5 c of 12-TET (A440): music / reference tones
    return dict(id=rec["id"], source=rec["source"], cls=rec.get("class"), dur=round(dur, 2), n_tracks=len(trs),
                n_lines=len(lines), n_measured=len(masks), lines=lines, cuts=cuts, cut_stats=classify_gaps(cuts),
                band_gaps=band_gaps, band=classify_gaps(band_gaps), label=lab, flags=flags)

def label(dur, lines, cuts, n_measured):
    flags = []
    if dur < 15: flags.append("short")
    tonal = [l for l in lines if l["duty"] >= 0.5 and l["snr_db"] >= 6]
    if not tonal:
        if any(l["duty"] >= 0.3 for l in lines): return "mixed", flags + ["weak_lines"]
        return "broadband", flags
    main = max(tonal, key=lambda l: l["span_s"] * l["duty"])
    if main["f_range"] > 10: flags.append("drifting")
    if n_measured == 0: flags.append("cuts_unmeasurable")
    elif n_measured == 1: flags.append("single_line")
    per_min = 60.0 / max(dur, 1)
    c = [l for _, l in cuts if 0.15 <= l <= 10.0]
    need = 1 if dur < 15 else 2
    if len(c) >= need and len(c) * per_min >= 1.0:
        flags.append(f"cuts/min={len(c) * per_min:.1f}")
        if classify_gaps(cuts)["r8_pattern"]: flags.append("r8_pattern")
        return "intermittent-tonal", flags
    if main["duty"] >= 0.8 and main["snr_db"] >= 10: return "stationary-tonal", flags
    return "mixed", flags + (["weak"] if main["snr_db"] < 10 else []) + (["low_duty"] if main["duty"] < 0.8 else [])

def spectro_png(rec, res, path):
    import matplotlib; matplotlib.use("Agg"); import matplotlib.pyplot as plt
    from scipy.signal import spectrogram
    x, _ = sf.read(os.path.join(DATA, rec["path"]), dtype="float64")
    f, t, S = spectrogram(x, SR, nperseg=4096, noverlap=4096 - 400)
    k = f <= 600
    fig, ax = plt.subplots(2, 1, figsize=(12, 6), sharex=True, gridspec_kw=dict(height_ratios=[3, 1]))
    ax[0].pcolormesh(t, f[k], 10 * np.log10(S[k] + 1e-14), shading="auto", cmap="magma")
    for l in res["lines"]:
        for s, d in l["gaps"]: ax[0].hlines(l["f_med"], s, s + d, color="cyan", lw=5, alpha=0.8)
    for s, d in res["cuts"]: ax[0].axvspan(s, s + d, color="lime", alpha=0.3)
    ax[0].set_ylabel("Hz"); ax[0].set_title(f"{res['id']}  [{res['label']}] {' '.join(res['flags'])}")
    be = band_env(x); ax[1].plot(np.arange(len(be)) * 0.01, be, lw=0.6); ax[1].set_ylabel("50-4k dB"); ax[1].set_xlabel("s")
    fig.tight_layout(); fig.savefig(path, dpi=70); plt.close(fig)

if __name__ == "__main__":
    recs = load_manifest("noise", A["sources"].split(",") if "sources" in A else None)
    with ProcessPoolExecutor(JOBS) as ex: res = list(ex.map(analyse, recs, chunksize=4))
    prev = {}
    pth = os.path.join(OUT, "noise_census.json")
    if "sources" in A and os.path.exists(pth): prev = {r["id"]: r for r in json.load(open(pth))}
    for r in res: prev[r["id"]] = r
    allres = sorted(prev.values(), key=lambda r: r["id"])
    json.dump(allres, open(pth, "w"), indent=1)
    if PNG != "none":
        os.makedirs(os.path.join(OUT, "png"), exist_ok=True)
        byid = {r["id"]: r for r in recs}
        for r in res:
            if PNG == "all" or r["label"] in ("intermittent-tonal",) or (PNG == "tonal" and "tonal" in r["label"]):
                spectro_png(byid[r["id"]], r, os.path.join(OUT, "png", r["id"] + ".png"))
    import collections
    c = collections.Counter((r.get("source"), r["label"]) for r in res)
    for k, v in sorted(c.items(), key=str): print(k, v)
