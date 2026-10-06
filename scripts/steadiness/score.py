# score.py — score steadiness-readout simulations (sim.mjs output) against
# references. Readout at message time T covers posted frames whose window
# centres lie in (T - W - 0.040, T - 0.040]; the reference SD is computed on
# the same span.
#
# Sessions (Praat AC reference, own-speaker windows >= 95 %, 0.25 s grid):
#   ref SD = population SD of 12 log2 f over AC-voiced frames, 3-st trimmed
#   (as in the precision pass); reference-disputed windows (Praat CC voiced
#   > 300 cents from AC on a joint frame) are excluded from agreement and
#   counted. Categories by AC voiced fraction: held >= 0.9, speech >= 0.6,
#   sparse 0.2-0.6. "silent": no frame within the span +-0.3 s that ANY
#   reference (AC, CC, session-label R1) voices — every reading there is false.
# Corpora (fda / ptdb / voc): annotated / laryngograph reference, same rules.
# Synthetic (synth / prec): truth = smooth contour (untrimmed).
#
# Usage: python scripts/steadiness/score.py CFG [CFG ...] [--sets=sessions,fda,ptdb,voc,synth,prec]
#          [--json=build/steady/score_TAG.json] [--sim=build/steady/sim]
import json, sys, os, glob
import numpy as np

A = dict(a[2:].split("=", 1) for a in sys.argv[1:] if a.startswith("--") and "=" in a)
CFGS = [a for a in sys.argv[1:] if not a.startswith("--")]
SIM = A.get("sim", "build/steady/sim")
SETS = A.get("sets", "sessions,fda,ptdb,voc,synth,prec").split(",")
REFS = "build/session-oracle/refs"
DATA = "build/pb/data"
ATTR = "build/session-oracle/attr/base"
SESS = ["2025-09-08", "2026-05-07", "2026-05-26", "2026-06-09"]
CONF = json.load(open(f"{SIM}/configs.json"))
GRID = 0.25
# session reference trim: 3 st (precision-pass convention) or "match" =
# the readout config's own trim width (Praat AC makes octave errors too).
REFTRIM = {"match": lambda cfg: min(CONF[cfg]["trimSemitones"], 50), "recipe": lambda cfg: cfg}.get(A.get("reftrim"), lambda cfg: 3.0)
LAT = 0.040


def st(f):
    return 12 * np.log2(f)


def recipe_sd(x, cfg):
    """Python replica of steadiness.js trimmedSpread (reference side)."""
    c = CONF[cfg]
    n = len(x)
    if n < 4: return np.nan
    med = np.median(x)
    mw = c.get("maxWideTrimFraction"); mw = c["maxTrimFraction"] if mw is None else mw
    for w, mf in ((c["trimSemitones"], c["maxTrimFraction"]), (c.get("wideTrimSemitones"), mw)):
        if not w or (w != c["trimSemitones"] and not w > c["trimSemitones"]): break
        k = np.abs(x - med) <= w
        if 1 - k.mean() <= mf and k.sum() >= 4: return float(np.std(x[k]))
    return np.nan


def tsd(x, trim=3.0):
    if isinstance(trim, str): return recipe_sd(x, trim)
    if len(x) < 4: return np.nan
    if trim:
        x = x[np.abs(x - np.median(x)) <= trim]
        if len(x) < 4: return np.nan
    return float(np.std(x))


def load_sim(cfg, s, tid):
    a = np.fromfile(f"{SIM}/{cfg}/{s}/{tid}.f32", dtype=np.float32).astype(float)
    n = len(a) // 2
    return a[:n], a[n:]


_refcache = {}


def ref_windows(key, t, f, T, W, extra=None, trim=3.0):
    """Per grid time T: (coverage, ref SD, n voiced, extra-mask stats)."""
    ck = (key, W, trim)
    if ck in _refcache: return _refcache[ck]
    lo = np.searchsorted(t, T - W - LAT, side="right"); hi = np.searchsorted(t, T - LAT, side="right")
    cov = np.full(len(T), np.nan); sd = np.full(len(T), np.nan); nv = np.zeros(len(T), int)
    for i, (a, b) in enumerate(zip(lo, hi)):
        if b - a < 5: continue
        v = f[a:b]; ok = v > 0
        cov[i] = ok.mean(); nv[i] = ok.sum()
        if ok.sum() >= 8: sd[i] = tsd(st(v[ok]), trim)
    _refcache[ck] = (cov, sd, nv, lo, hi)
    return _refcache[ck]


def agree(ref, det):
    ok = np.isfinite(ref) & np.isfinite(det)
    ref, det = ref[ok], det[ok]
    if len(ref) < 3: return {"n": int(len(ref))}
    d = det - ref
    o = {"n": int(len(ref)), "ref_med": float(np.median(ref)), "det_med": float(np.median(det)),
         "med_err": float(np.median(d)), "bias": float(np.mean(d)), "mae": float(np.mean(np.abs(d))),
         "p90": float(np.quantile(np.abs(d), 0.9)), "within01": float(np.mean(np.abs(d) < 0.1)),
         "ratio": float(np.median(det / np.maximum(ref, 1e-3)))}
    o["bins"] = {}
    for lo_, hi_ in ((0, 0.5), (0.5, 1), (1, 2), (2, 99)):
        b = (ref >= lo_) & (ref < hi_)
        if b.sum() >= 3:
            o["bins"][f"{lo_}-{hi_}"] = {"n": int(b.sum()), "mae": float(np.mean(np.abs(d[b]))), "med": float(np.median(d[b]))}
    m = ref < 2
    if m.sum() > 3 and np.std(ref[m]) > 0 and np.std(det[m]) > 0: o["r"] = float(np.corrcoef(ref[m], det[m])[0, 1])
    return o


def fa(o):
    if o.get("n", 0) < 3: return f"n={o.get('n', 0)}"
    return (f"n {o['n']:5d} ref~{o['ref_med']:.2f} det~{o['det_med']:.2f} med {o['med_err']:+.3f} MAE {o['mae']:.3f} "
            f"p90 {o['p90']:.3f} <0.1 {100 * o['within01']:3.0f}% ratio {o['ratio']:.2f} r {o.get('r', float('nan')):.3f}")


def sessions(cfg):
    W = CONF[cfg]["windowSec"]
    R = {}
    for ss in SESS:
        z = np.load(f"{REFS}/{ss}.npz"); t = z["t"]
        m = json.load(open(f"{ATTR}/sessions/{ss}.json")); hop = m["hopS"]
        v, h = load_sim(cfg, "sessions", ss)
        n = len(v)
        kk = np.arange(int(round(GRID / hop)) - 1, n, int(round(GRID / hop)))
        T = (kk + 1) * hop - CONF[cfg].get("lagSec", 0)
        anyv = (z["ac"] > 0) | (z["cc"] > 0) | (z["cal"] > 0)
        tv = t[anyv]
        # silent: no reference voicing within the span +- 0.3 s
        a0 = np.searchsorted(tv, T - W - LAT - 0.3); a1 = np.searchsorted(tv, T - LAT + 0.3)
        silent = a1 == a0
        val, held = v[kk], h[kk]
        fresh = np.isfinite(val) & (held == 0); shown = np.isfinite(val)
        for spk, code in (("alice", 1), ("second", 2)):
            own = z["spk"] == code
            ac = np.where(own & (z["ac"] >= 60), z["ac"], 0.0)
            cc = np.where(own & (z["cc"] >= 60), z["cc"], 0.0)
            cov, sd, nv, lo, hi = ref_windows((ss, spk), t, ac, T, W, trim=REFTRIM(cfg))
            sdraw = ref_windows((ss, spk), t, ac, T, W, trim=0)[1]
            ownf = np.array([own[a:b].mean() if b > a else 0 for a, b in zip(lo, hi)])
            disp = np.zeros(len(T), bool)
            for i, (a, b) in enumerate(zip(lo, hi)):
                if ownf[i] < 0.95 or b <= a: continue
                x, y = ac[a:b], cc[a:b]; j = (x > 0) & (y > 0)
                if j.any() and np.max(np.abs(1200 * np.log2(y[j] / x[j]))) > 300: disp[i] = True
            mine = ownf >= 0.95
            for cat, mk in (("held", cov >= 0.9), ("speech", cov >= 0.6), ("sparse", (cov >= 0.2) & (cov < 0.6)), ("lt0.2", cov < 0.2)):
                sel = mine & mk & ~disp
                d = R.setdefault((spk, cat), {"N": 0, "fresh": 0, "shown": 0, "ref": [], "det": [], "raw": [], "disp": 0, "ss": []})
                d["N"] += int(sel.sum()); d["fresh"] += int((sel & fresh).sum()); d["shown"] += int((sel & shown).sum())
                d["disp"] += int((mine & mk & disp).sum())
                e = sel & fresh & np.isfinite(sd)
                d["ref"] += list(sd[e]); d["det"] += list(val[e]); d["ss"] += [ss] * int(e.sum()); d["raw"] += list(sdraw[e])
            # best windows: speech-like non-disputed windows
            sel = mine & (cov >= 0.6) & ~disp
            rr = sd[sel & np.isfinite(sd)]; dd = val[sel & fresh]
            R.setdefault(("best", spk), {})[ss] = (
                [float(np.quantile(rr, q)) for q in (0.05, 0.1)] if len(rr) > 20 else None,
                [float(np.quantile(dd, q)) for q in (0.05, 0.1)] if len(dd) > 20 else None, int(len(rr)), int(len(dd)))
        d = R.setdefault(("all", "silent"), {"N": 0, "fresh": 0, "shown": 0})
        d["N"] += int(silent.sum()); d["fresh"] += int((silent & fresh).sum()); d["shown"] += int((silent & shown).sum())
    return R


def corpora(cfg, sets):
    W = CONF[cfg]["windowSec"]
    idx = json.load(open(f"{DATA}/index.json"))
    R = {}
    for tr in idx:
        cp = tr["corpus"]
        if cp not in sets: continue
        r = np.fromfile(f"{DATA}/{cp}/{tr['trackId']}.ref.f32", dtype=np.float32).astype(float)
        r[r < 50] = 0
        t = np.arange(len(r)) * tr["refHopMs"] / 1000 + tr["refOffsetMs"] / 1000
        m = json.load(open(f"{ATTR}/{cp}/{tr['trackId']}.json")); hop = m["hopS"]
        v, h = load_sim(cfg, cp, tr["trackId"])
        kk = np.arange(int(round(GRID / hop)) - 1, len(v), int(round(GRID / hop)))
        T = (kk + 1) * hop - CONF[cfg].get("lagSec", 0)
        cov, sd, nv, lo, hi = ref_windows((cp, tr["trackId"]), t, r, T, W)
        sdraw = ref_windows((cp, tr["trackId"]), t, r, T, W, trim=0)[1]
        val, held = v[kk], h[kk]
        fresh = np.isfinite(val) & (held == 0); shown = np.isfinite(val)
        g = f"{cp}_{tr['gender']}" if cp != "voc" else "voc"
        for cat, mk in (("speech", cov >= 0.6), ("sparse", (cov >= 0.2) & (cov < 0.6)), ("lt0.2", cov < 0.2)):
            sel = mk
            d = R.setdefault((g, cat), {"N": 0, "fresh": 0, "shown": 0, "ref": [], "det": [], "raw": []})
            d["N"] += int(sel.sum()); d["fresh"] += int((sel & fresh).sum()); d["shown"] += int((sel & shown).sum())
            e = sel & fresh & np.isfinite(sd)
            d["ref"] += list(sd[e]); d["det"] += list(val[e]); d["raw"] += list(sdraw[e])
    return R


def synth(cfg, s):
    W = CONF[cfg]["windowSec"]
    files = sorted(glob.glob("build/steady/synth/cases_*.json" if s == "synth" else "build/prec/sc_base_*.json"))
    R = {}
    for fn in files:
        for c in json.load(open(fn)):
            v, h = load_sim(cfg, s, f"c{c['id']}")
            hop = c["hop"]
            kk = np.arange(int(round(GRID / hop)) - 1, len(v), int(round(GRID / hop)))
            T = (kk + 1) * hop - CONF[cfg].get("lagSec", 0)
            val, held = v[kk], h[kk]
            fresh = np.isfinite(val) & (held == 0); shown = np.isfinite(val)
            fam = c.get("fam", c.get("kind", "prec"))
            if s == "prec": fam = "prec_" + c["kind"]
            if fam == "noise":
                d = R.setdefault(("noise", c["noise"]), {"N": 0, "fresh": 0, "shown": 0})
                d["N"] += len(T); d["fresh"] += int(fresh.sum()); d["shown"] += int(shown.sum())
                continue
            tt, ff = np.array(c["tTruth"]), np.array(c["fTruth"])
            # truth is silent outside the note: pad with zeros so windows
            # reaching into the padding see partial coverage
            dt = tt[1] - tt[0]
            pre = np.arange(tt[0] - dt, -1e-9, -dt)[::-1]
            postt = np.arange(tt[-1] + dt, len(v) * hop + 1.5, dt)
            tt = np.concatenate([pre, tt, postt]); ff = np.concatenate([np.zeros(len(pre)), ff, np.zeros(len(postt))])
            cov, sd, nv, lo, hi = ref_windows((s, c["id"]), tt, ff, T, W, trim=0)
            sub = fam
            if fam == "vib": sub = f"vib_ext{c['contour']['ext']}"
            if fam == "drift": sub = f"drift_{c['contour']['rate']}st/s"
            if fam == "noisy": sub = f"noisy_{c['noise']}_{c['noiseSnr']}dB"
            if fam == "jump": sub = f"jump_{c['contour']['st']:+d}st" + ("_glide" if c["contour"]["glide"] else "")
            if fam == "siren": sub = f"siren_{c['contour']['k']}_{c['contour'].get('amp', c['contour'].get('st'))}"
            for key in {fam, sub}:
                full = cov >= 0.95
                d = R.setdefault((key, "full"), {"N": 0, "fresh": 0, "shown": 0, "ref": [], "det": []})
                d["N"] += int(full.sum()); d["fresh"] += int((full & fresh).sum()); d["shown"] += int((full & shown).sum())
                e = full & fresh & np.isfinite(sd)
                d["ref"] += list(sd[e]); d["det"] += list(val[e])
                part = (cov < 0.95) & (cov > 0)
                d = R.setdefault((key, "partial"), {"N": 0, "fresh": 0, "shown": 0, "ref": [], "det": []})
                d["N"] += int(part.sum()); d["fresh"] += int((part & fresh).sum()); d["shown"] += int((part & shown).sum())
                e = part & fresh & np.isfinite(sd)
                d["ref"] += list(sd[e]); d["det"] += list(val[e])
    return R


def summarize(R):
    out = {}
    for k, d in R.items():
        if k[0] == "best":
            out["|".join(k)] = d; continue
        o = {"N": d["N"], "fresh": d["fresh"] / max(d["N"], 1), "shown": d["shown"] / max(d["N"], 1)}
        if "disp" in d: o["disputed"] = d["disp"]
        if "ref" in d: o["agree"] = agree(np.array(d["ref"]), np.array(d["det"]))
        if "raw" in d: o["agree_raw"] = agree(np.array(d["raw"]), np.array(d["det"]))
        out["|".join(map(str, k))] = o
    return out


if __name__ == "__main__":
    allout = {}
    for cfg in CFGS:
        _refcache.clear()
        res = {}
        if "sessions" in SETS: res["sessions"] = summarize(sessions(cfg))
        cs = [s for s in SETS if s in ("fda", "ptdb", "voc")]
        if cs: res["corpora"] = summarize(corpora(cfg, cs))
        for s in ("synth", "prec"):
            if s in SETS and os.path.isdir(f"{SIM}/{cfg}/{s}"): res[s] = summarize(synth(cfg, s))
        allout[cfg] = res
        print(f"\n######## {cfg}  {json.dumps({k: v for k, v in CONF[cfg].items()})}")
        for grp, D in res.items():
            print(f"  --- {grp}")
            for k in sorted(D):
                o = D[k]
                if k.startswith("best"):
                    print(f"    {k:28s} " + "  ".join(f"{ss}: ref {('%.2f/%.2f' % tuple(v[0])) if v[0] else '-'} det {('%.2f/%.2f' % tuple(v[1])) if v[1] else '-'}" for ss, v in o.items()))
                    continue
                print(f"    {k:28s} N {o['N']:6d} fresh {100 * o['fresh']:5.1f}% shown {100 * o['shown']:5.1f}%"
                      + (f" disp {o['disputed']}" if "disputed" in o else "") + ("  " + fa(o["agree"]) if "agree" in o else ""))
    if "json" in A: json.dump(allout, open(A["json"], "w"), indent=1)
