"""hum_score.py - scores the hum and noise tests (§P7 of measurements/voice-preview-spike-2026-10-12.md).

  python -I hum_score.py [--threshold-db 25]

Reads hum-run.mjs output (VP_CACHE/hum). Per condition clip, engine and cell:
  pauses   25 ms hops whose clean-clip energy (25 ms centred on the hop's window centre,
           (k + 1) * 25 ms - 40 ms) is >= 35 dB below the clean clip's 95th-percentile 20 ms-frame
           energy; defined on the clean clip, so added noise does not move them
  m1       pause voiced share: share of pause hops the real pitch chain posts voiced
  m2       Welch spectrum of the pause samples (maximal runs of consecutive pause hops, joined in
           order; 8192-point Hann, 50 % overlap; >= 0.5 s needed). Peak = local maximum in 75-400 Hz;
           prominence = its power over the median power in 50-460 Hz (dB). A render adds a tonal
           peak if it has a peak >= 9 dB with no >= 9 dB peak in the original-with-noise within
           +-3 Hz. Added peaks are labelled (k = 1..8, +-3 Hz) "hum" at k * mains, "hum x pitch step"
           at k * mains * 2^(st/12), "hum x formant scale" at k * mains * a, else "other"
  m3       speech hops (not pauses, voiced in the same cell rendered from the clean clip): voicing
           loss, median |pitch difference| and share > 2 st against that clean render; VTLN clip
           reading shift (median of non-null 150 ms bins, >= 10) against it
Recording-check candidates (d1 notch "rec" / "live", d2 level margin < threshold), judged as
pre-registered: adequate if it flags every condition in which any WORLD render raises the pause
voiced share by > 5 pp over the same cell rendered from the clean clip, or adds a tonal peak, and
flags none of the clean set (4 clean base clips, ls_f2, the 4 timing clips at 5 s).
Output: VP_CACHE/hum/scores.json and a printed summary.
"""
import argparse, json, os, site, sys

ap = argparse.ArgumentParser()
ap.add_argument("--threshold-db", type=float, default=25.0)
A = ap.parse_args()
_us = site.getusersitepackages()
if _us not in sys.path:
    sys.path.append(_us)
import numpy as np  # noqa: E402
from scipy.signal import welch  # noqa: E402

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.abspath(os.path.join(HERE, "..", "..", ".."))
CACHE = os.environ.get("VP_CACHE") or os.path.join(REPO, "build", "voice-preview")
H = os.path.join(CACHE, "hum")
idx = json.load(open(os.path.join(H, "clips", "index.json"), encoding="utf8"))
det = json.load(open(os.path.join(H, "detect.json"), encoding="utf8"))
CELLS = [tuple(c) for c in det["cells"]]
ENG = ["world", "psola"]


def cn(st, a):
    return f"p{st:+d}_a{a:.2f}"


def f32(p):
    return np.fromfile(p, np.float32).astype(np.float64)


vt = {}
vp = os.path.join(H, "vtln.jsonl")
if os.path.exists(vp):
    for line in open(vp, encoding="utf8"):
        d = json.loads(line)
        if "key" not in d:
            continue
        v = [x for x in d["s"] if x is not None]
        vt[d["key"]] = float(np.median(v)) if len(v) >= 10 else np.nan


def hop_segments(n_hops, sr, n):
    """[start, end) sample spans of 25 ms centred on each hop's window centre."""
    c = (np.arange(n_hops) + 1) * 0.025 - 0.040
    s = np.round((c - 0.0125) * sr).astype(int)
    return s, s + int(round(0.025 * sr)), (s >= 0) & (s + int(round(0.025 * sr)) <= n)


def pauses(clean, sr, n_hops):
    m = int(round(0.02 * sr))
    fr = clean[: len(clean) // m * m].reshape(-1, m)
    p95 = np.percentile(np.mean(fr ** 2, axis=1), 95)
    s, e, ok = hop_segments(n_hops, sr, len(clean))
    out = np.zeros(n_hops, bool)
    for k in np.nonzero(ok)[0]:
        out[k] = np.mean(clean[s[k]:e[k]] ** 2) <= p95 * 10 ** (-35 / 10)
    return out


def pause_samples(x, sr, pz):
    s, e, _ = hop_segments(len(pz), sr, len(x))
    runs, k = [], 0
    while k < len(pz):
        if pz[k]:
            j = k
            while j + 1 < len(pz) and pz[j + 1]:
                j += 1
            runs.append(x[max(0, s[k]):min(len(x), e[j])])
            k = j + 1
        else:
            k += 1
    return np.concatenate(runs) if runs else np.zeros(0)


def spectrum_peaks(xp, sr):
    if len(xp) < 0.5 * sr:
        return None
    f, P = welch(xp, fs=sr, window="hann", nperseg=min(8192, len(xp)), noverlap=min(8192, len(xp)) // 2)
    med = np.median(P[(f >= 50) & (f <= 460)])
    band = np.nonzero((f >= 75) & (f <= 400))[0]
    peaks = []
    for i in band:
        if P[i] > P[i - 1] and P[i] >= P[i + 1]:
            pr = 10 * np.log10(P[i] / med)
            if pr >= 9:
                peaks.append((float(f[i]), float(pr)))
    mx = float(10 * np.log10(P[band].max() / med))
    return dict(peaks=peaks, max_prom=mx, max_freq=float(f[band][np.argmax(P[band])]), pause_s=len(xp) / sr)


def label(fr, mains, st, a):
    if not mains:
        return "other"
    for k in range(1, 9):
        if abs(fr - k * mains) <= 3:
            return "hum"
        if st != 0 and abs(fr - k * mains * 2 ** (st / 12)) <= 3:
            return "hum x pitch step"
        if a != 1 and abs(fr - k * mains * a) <= 3:
            return "hum x formant scale"
    return "other"


rows, by_name = [], {c["name"]: c for c in idx["clips"]}
for c in idx["clips"]:
    nm, sr = c["name"], c["sr"]
    rate = 24000 if sr == 48000 else 16000
    if c["cond"] == "natural":
        clean_nm = nm
    else:
        clean_nm = nm.split("__")[0] + "__clean"
    clean = f32(os.path.join(H, "clips", clean_nm + ".f32"))
    x = f32(os.path.join(H, "clips", nm + ".f32"))
    po = f32(os.path.join(H, "post", "orig", nm + ".f32"))
    pz = pauses(clean, sr, len(po))
    orig_sp = spectrum_peaks(pause_samples(x, sr, pz), sr)
    orig_m1 = float(np.mean(po[pz] > 0)) if pz.sum() else np.nan
    for e in ENG:
        for st, a in CELLS:
            pr = f32(os.path.join(H, "post", e, nm, cn(st, a) + ".f32"))
            y = f32(os.path.join(H, "renders", e, nm, cn(st, a) + ".f32"))
            n = min(len(pr), len(pz))
            m1 = float(np.mean(pr[:n][pz[:n]] > 0)) if pz[:n].sum() else np.nan
            # m1 of the same cell rendered from the clean clip
            pc = f32(os.path.join(H, "post", e, clean_nm, cn(st, a) + ".f32"))
            nc = min(len(pc), len(pz))
            m1_clean = float(np.mean(pc[:nc][pz[:nc]] > 0)) if pz[:nc].sum() else np.nan
            # pause hops the render rate maps to: the render is at `rate`; hops are 25 ms either way
            sp = spectrum_peaks(pause_samples(y, rate, pz[:n]), rate)
            added = []
            if sp is not None and orig_sp is not None:
                for fr, prom in sp["peaks"]:
                    if not any(abs(fr - f2) <= 3 for f2, _ in orig_sp["peaks"]):
                        added.append(dict(freq=fr, prom=prom, label=label(fr, c.get("mains"), st, a)))
            # m3: speech hops vs the clean render of the same cell
            sp_h = (~pz[:min(n, nc)]) & (pc[:min(n, nc)] > 0)
            nn = min(n, nc)
            both = sp_h & (pr[:nn] > 0)
            d = np.abs(12 * np.log2(pr[:nn][both] / pc[:nn][both])) if both.sum() else np.array([])
            vk = f"{e}/{nm}/{cn(st, a)}"
            vck = f"{e}/{clean_nm}/{cn(st, a)}"
            rows.append(dict(
                name=nm, base=c["base"], cond=c["cond"], kind=c["kind"], sr=sr, rate=rate, engine=e, st=st, a=a,
                pause_hops=int(pz.sum()), m1_orig=orig_m1, m1=m1, m1_clean_cell=m1_clean, m1_rise_pp=(m1 - m1_clean) * 100,
                m2_orig_max=None if orig_sp is None else orig_sp["max_prom"], m2_max=None if sp is None else sp["max_prom"],
                m2_pause_s=None if sp is None else sp["pause_s"], added_peaks=added,
                pause_post_median_hz=float(np.median(pr[:n][pz[:n] & (pr[:n] > 0)])) if (pz[:n] & (pr[:n] > 0)).sum() else None,
                pause_post_orig_median_hz=float(np.median(po[pz & (po > 0)])) if (pz & (po > 0)).sum() else None,
                m3_voicing_loss=float(np.mean(~(pr[:nn][sp_h] > 0))) if sp_h.sum() else np.nan,
                m3_median_abs_st=float(np.median(d)) if len(d) else np.nan,
                m3_gross2=float(np.mean(d > 2)) if len(d) else np.nan,
                m3_vtln_shift=(vt.get(vk, np.nan) - vt.get(vck, np.nan)) if rate == 16000 else np.nan,
            ))

# ---------------------------------------------------------------- triggers and detectors
conds = sorted({(r["name"]) for r in rows if r["cond"] not in ("clean", "natural")})
trig = {}
for nm in conds + sorted({r["name"] for r in rows if r["cond"] == "clean"}):
    W = [r for r in rows if r["name"] == nm and r["engine"] == "world"]
    rise = max(r["m1_rise_pp"] for r in W)
    addp = [p for r in W for p in r["added_peaks"]]
    trig[nm] = dict(max_rise_pp=rise, added=len(addp), added_hum_related=sum(p["label"] != "other" for p in addp),
                    trigger=bool(rise > 5 or len(addp) > 0), trigger_hum_related=bool(rise > 5 or any(p["label"] != "other" for p in addp)))

TH = A.threshold_db
def flags(d):
    d1r = bool(d["d1rec"]["flagged"])
    d1l = bool(d["d1live"]["flagged"]) if d.get("d1live") else None
    d2 = bool(d["d2"]["margin"] < TH)
    return {"d1rec": d1r, "d1live": d1l, "d2": d2, "d1rec|d2": d1r or d2, "d1live|d2": (d1l or d2) if d1l is not None else None}


cond_flags = {nm: flags(det["conditions"][nm]) for nm in det["conditions"]}
clean_set = {f"{b}__clean": cond_flags[f"{b}__clean"] for b in ("ls_m2", "pt_m1", "ls_f1", "pt_f1")}
for k, d in det["clean"].items():
    if d["set"] in ("proto16", "timing"):
        clean_set[k] = flags(d)
extra_clean = {k: flags(d) for k, d in det["clean"].items() if d["set"] == "timing-speech"}
VAR = ["d1rec", "d1live", "d2", "d1rec|d2", "d1live|d2"]
adequacy = {}
for v in VAR:
    for tk in ("trigger", "trigger_hum_related"):
        need = [nm for nm in conds if trig[nm][tk] and not by_name[nm].get("spot24k")]
        missed = [nm for nm in need if not cond_flags[nm][v]]
        false = [k for k, f in clean_set.items() if f[v]]
        adequacy[f"{v} / {tk}"] = dict(adequate=bool(not missed and not false), triggers=len(need), missed=missed, false_flags=false)

margins = {nm: det["conditions"][nm]["d2"]["margin"] for nm in det["conditions"]}
margins.update({k: d["d2"]["margin"] for k, d in det["clean"].items()})
out = dict(rows=rows, triggers=trig, flags=cond_flags, clean_set_flags=clean_set, extra_clean_flags=extra_clean,
           adequacy=adequacy, margins=margins, threshold_db=TH,
           notch={nm: dict(rec=det["conditions"][nm]["d1rec"], live=det["conditions"][nm]["d1live"], worker_share=det["conditions"][nm]["workerNotchShare"]) for nm in det["conditions"]},
           clean_notch={k: dict(rec=d["d1rec"], live=d["d1live"]) for k, d in det["clean"].items()})
with open(os.path.join(H, "scores.json"), "w") as f:
    json.dump(out, f, indent=1, default=lambda o: None if (isinstance(o, float) and not np.isfinite(o)) else (bool(o) if isinstance(o, np.bool_) else float(o)))

# ---------------------------------------------------------------- printed summary
def agg(sel, key, fn=np.nanmax):
    v = [r[key] for r in rows if sel(r) and r[key] is not None]
    return fn(v) if v else np.nan


print("== per condition (16 kHz base clips; WORLD / PSOLA over the 5 cells)")
print(f"{'condition':24s} pause s  m1 orig  m1 rise max W/P (pp)  m2 max prom orig/W/P (dB)  added peaks W/P (hum-rel)  "
      f"m3 vloss med W/P  m3 |d| med W/P  VTLN shift |max| W/P  d1rec d1live d2(margin)")
for c in idx["clips"]:
    nm = c["name"]
    R = [r for r in rows if r["name"] == nm]
    if not R:
        continue
    w = [r for r in R if r["engine"] == "world"]; p = [r for r in R if r["engine"] == "psola"]
    def mx(L, k): v = [r[k] for r in L if r[k] is not None and np.isfinite(r[k])]; return max(v) if v else np.nan  # noqa: E301,E702
    def md(L, k): v = [r[k] for r in L if r[k] is not None and np.isfinite(r[k])]; return float(np.median(v)) if v else np.nan  # noqa: E301,E702
    aw = sum(len(r["added_peaks"]) for r in w); ap_ = sum(len(r["added_peaks"]) for r in p)
    hw = sum(sum(q["label"] != "other" for q in r["added_peaks"]) for r in w); hp = sum(sum(q["label"] != "other" for q in r["added_peaks"]) for r in p)
    vs = lambda L: max((abs(r["m3_vtln_shift"]) for r in L if np.isfinite(r["m3_vtln_shift"])), default=np.nan)  # noqa: E731
    d = det["conditions"][nm]
    fl = cond_flags[nm]
    print(f"{nm:24s} {R[0]['m2_pause_s'] or 0:5.2f}  {R[0]['m1_orig'] * 100:6.1f}   {mx(w, 'm1_rise_pp'):+6.1f} / {mx(p, 'm1_rise_pp'):+6.1f}        "
          f"{R[0]['m2_orig_max'] or np.nan:5.1f} / {mx(w, 'm2_max'):5.1f} / {mx(p, 'm2_max'):5.1f}         {aw:2d} / {ap_:2d} ({hw}/{hp})          "
          f"{md(w, 'm3_voicing_loss') * 100:5.1f} / {md(p, 'm3_voicing_loss') * 100:5.1f}    {md(w, 'm3_median_abs_st'):.3f} / {md(p, 'm3_median_abs_st'):.3f}    "
          f"{vs(w):.3f} / {vs(p):.3f}    {'Y' if fl['d1rec'] else '.'}     {'Y' if fl['d1live'] else ('.' if fl['d1live'] is not None else '-')}     "
          f"{'Y' if fl['d2'] else '.'} ({d['d2']['margin']:.1f})")
print("\n== triggers (WORLD: pause voiced share +> 5 pp over the clean-clip cell, or an added tonal peak)")
for nm in conds:
    if trig[nm]["trigger"] or trig[nm]["trigger_hum_related"]:
        print(f"  {nm}: rise {trig[nm]['max_rise_pp']:+.1f} pp, added peaks {trig[nm]['added']} (hum-related {trig[nm]['added_hum_related']})")
print("  clean conditions (calibration of the peak metric):", {nm: (round(t["max_rise_pp"], 1), t["added"]) for nm, t in trig.items() if nm.endswith("__clean")})
print("\n== clean set flags:", {k: [v for v in VAR if f[v]] for k, f in clean_set.items()})
print("   extra (speech-dense timing clips):", {k: [v for v in VAR if f[v]] for k, f in extra_clean.items()})
print("\n== adequacy")
for k, v in adequacy.items():
    print(f"  {k:36s} {'ADEQUATE' if v['adequate'] else 'not adequate'}: triggers {v['triggers']}, missed {len(v['missed'])} {v['missed'][:6]}, false flags {v['false_flags']}")
print("\n== by noise kind (16 kHz conditions, excluding clean): median over renders")
for kind in ("hum", "pink"):
    for e in ENG:
        R = [r for r in rows if r["kind"] == kind and r["engine"] == e and r["rate"] == 16000]
        lab = {}
        for r in R:
            for q in r["added_peaks"]:
                lab[q["label"]] = lab.get(q["label"], 0) + 1
        f = lambda k: float(np.nanmedian([r[k] for r in R]))  # noqa: E731
        g = lambda k, q: float(np.nanpercentile([r[k] for r in R], q))  # noqa: E731
        print(f"  {kind:5s} {e:6s} renders {len(R)}: m1 rise med {f('m1_rise_pp'):+.1f} pp (max {max(r['m1_rise_pp'] for r in R):+.1f}); "
              f"m2 max prom med {f('m2_max'):.1f} dB (orig {f('m2_orig_max'):.1f}); renders with an added peak {sum(bool(r['added_peaks']) for r in R)} {lab}; "
              f"speech vloss med {f('m3_voicing_loss') * 100:.1f} % p90 {g('m3_voicing_loss', 90) * 100:.1f} %; |d| med {f('m3_median_abs_st'):.3f} st; "
              f"VTLN |shift| med {float(np.nanmedian([abs(r['m3_vtln_shift']) for r in R])):.3f} p90 {float(np.nanpercentile([abs(r['m3_vtln_shift']) for r in R], 90)):.3f}")
print("\n== d2 margins (dB):", {k: round(v, 1) for k, v in sorted(margins.items(), key=lambda kv: kv[1])})
