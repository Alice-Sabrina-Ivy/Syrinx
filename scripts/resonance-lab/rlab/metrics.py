"""R1-R8 validity metrics from cached candidate scores.

Readouts. A candidate emits window scores (t, s). The harness pools them:
  utterance readout   agg(s) over an item's finite windows (agg = candidate.aggregate)
  horizon readout     a speaker's items are walked in stream order; every window is
                      stamped with the speaker's cumulative VOICED time (from the F0
                      track) at its output time; readout k = agg of windows whose
                      cumulative voiced time lies in [kH, (k+1)H) (complete bins only)
  speaker readout     agg over all of a speaker's windows
Gap G (the normaliser for R2-R6): median over women speakers of their median
utterance readout minus the same for men, on r1_test (LibriSpeech test-clean);
G_hill likewise on Hillenbrand tokens (for manip_hill and R4).
AUCs are speaker-balanced (each speaker's readouts weighted 1/n) and oriented
women > men; 0.5 = chance, < 0.5 = backwards.
"""
import numpy as np
import pandas as pd
from .f0 import F0Track

LN115 = np.log(1.15)


def _agg(name):
    return {"median": np.median, "mean": np.mean}[name]


def windows(scores):
    """item_id -> (t, s) with only finite scores."""
    d = scores[np.isfinite(scores.s)]
    out = {}
    if len(d) == 0:
        return out
    ids = d.item_id.values
    cut = np.flatnonzero(ids[1:] != ids[:-1]) + 1
    for a, b in zip(np.r_[0, cut], np.r_[cut, len(d)]):
        out[ids[a]] = (d.t.values[a:b], d.s.values[a:b])
    return out


def utt_readouts(win, ids, agg):
    f = _agg(agg)
    return pd.Series({i: (f(win[i][1]) if i in win else np.nan) for i in ids}, dtype=float)


def wauc(pos, neg, wp=None, wn=None):
    pos, neg = np.asarray(pos, float), np.asarray(neg, float)
    wp = np.ones(len(pos)) if wp is None else np.asarray(wp, float)
    wn = np.ones(len(neg)) if wn is None else np.asarray(wn, float)
    mp, mn = np.isfinite(pos), np.isfinite(neg)
    pos, wp, neg, wn = pos[mp], wp[mp], neg[mn], wn[mn]
    if len(pos) == 0 or len(neg) == 0:
        return np.nan
    o = np.argsort(neg)
    ns, cw = neg[o], np.r_[0, np.cumsum(wn[o])]
    lo = np.searchsorted(ns, pos, "left")
    hi = np.searchsorted(ns, pos, "right")
    below = cw[lo] + 0.5 * (cw[hi] - cw[lo])
    return float(np.sum(wp * below) / (wp.sum() * wn.sum()))


def spk_auc(df, val="r", pos="f", neg="m", key="sex"):
    """Speaker-balanced AUC over readout rows (columns speaker, key, val)."""
    df = df[np.isfinite(df[val])]
    w = 1.0 / df.groupby("speaker")[val].transform("size")
    P, N = df[key] == pos, df[key] == neg
    return wauc(df[val][P], df[val][N], w[P], w[N])


def gap(readouts, man, key="sex", hi="f", lo="m"):
    d = man[["item_id", "speaker", key]].copy()
    d["r"] = d.item_id.map(readouts)
    sp = d.groupby(["speaker", key]).r.median().reset_index()
    return float(sp[sp[key] == hi].r.median() - sp[sp[key] == lo].r.median())


def _voiced_times(f0_path):
    tr = F0Track.load(f0_path)
    return tr.t[tr.f0 > 0]


def stamped(win, man, speaker_col="speaker"):
    """speaker -> (cumulative voiced time per window, scores, total voiced)."""
    out = {}
    for spk, d in man.sort_values([speaker_col, "order"]).groupby(speaker_col, sort=False):
        cs, ss, off = [], [], 0.0
        for iid, fp in zip(d.item_id, d.f0_path):
            vt = _voiced_times(fp)
            if iid in win:
                t, s = win[iid]
                cs.append(off + np.searchsorted(vt, t, "right") * 0.01)
                ss.append(s)
            off += len(vt) * 0.01
        out[spk] = (np.concatenate(cs) if cs else np.array([]), np.concatenate(ss) if ss else np.array([]), off)
    return out


def horizon(win, man, H, agg, speaker_col="speaker", label_cols=("sex", "group")):
    f = _agg(agg)
    lab = man.groupby(speaker_col)[list(label_cols)].first()
    rows = []
    for spk, (c, s, tot) in stamped(win, man, speaker_col).items():
        nfull = int(np.floor(tot / H))
        if nfull == 0 or len(c) == 0:
            continue
        b = np.floor(c / H).astype(int)
        for k in range(nfull):
            v = s[b == k]
            if len(v):
                rows.append(dict(speaker=spk, bin=k, r=f(v), **lab.loc[spk].to_dict()))
    return pd.DataFrame(rows)


def speaker_readouts(win, man, agg):
    f = _agg(agg)
    rows = []
    for spk, d in man.groupby("speaker"):
        v = [win[i][1] for i in d.item_id if i in win]
        if v:
            rows.append(dict(speaker=spk, sex=d.sex.iloc[0], group=d.group.iloc[0], r=f(np.concatenate(v))))
    return pd.DataFrame(rows)


# ------------------------------------------------------------------ R1
def r1(win, man, agg, horizons=(2.0, 5.0)):
    out = {}
    for H in horizons:
        h = horizon(win, man, H, agg)
        out[f"auc_{H:g}s"] = spk_auc(h) if len(h) else np.nan
        out[f"n_{H:g}s"] = len(h)
    ru = utt_readouts(win, man.item_id, agg)
    d = man[["item_id", "speaker", "sex"]].assign(r=man.item_id.map(ru).values)
    out["auc_utt"] = spk_auc(d)
    sp = speaker_readouts(win, man, agg)
    out["auc_spk"] = wauc(sp[sp.sex == "f"].r, sp[sp.sex == "m"].r) if len(sp) else np.nan
    out["n_spk"] = len(sp)
    out["coverage"] = float(np.isfinite(d.r).mean())
    return out, ru


# ------------------------------------------------------------------ R2 / R3 / combos
def _slope0(x, y):
    m = np.isfinite(x) & np.isfinite(y)
    x, y = x[m], y[m]
    return float(np.sum(x * y) / np.sum(x * x)) if len(x) and np.sum(x * x) > 0 else np.nan


def manip_metrics(win, man, agg, G, mid, ref_sexes=("m", "f")):
    """man: a manip_* manifest. G: gap for normalisation; mid: men/women midpoint."""
    r = utt_readouts(win, man.item_id, agg)
    d = man.copy()
    d["r"] = d.item_id.map(r)
    d["r_ref"] = d.ref_item.map(r)
    d["delta"] = d.r - d.r_ref
    out = {"coverage": float(np.isfinite(d.r).mean())}
    o = d[d.kind == "orig"]
    # base rates for the *_cross figures below (unmanipulated crops on the wrong side of mid)
    out["men_orig_cross"] = float((o[o.sex == "m"].r > mid).mean()) if len(o) else np.nan
    out["women_orig_cross"] = float((o[o.sex == "f"].r < mid).mean()) if len(o) else np.nan
    curves =(d[d.kind.isin(["pitch", "formant", "hi", "hiref", "combo", "ref"])]
              .groupby(["engine", "cond"]).delta.median() / G).round(4)
    out["curve_delta_over_G"] = {f"{e}:{c}": v for (e, c), v in curves.items()}
    for eng in ("praat", "world"):
        e = d[d.engine == eng]
        for sx in ("all", "m", "f"):
            es = e if sx == "all" else e[e.sex == sx]
            sfx = "" if sx == "all" else f"_{sx}"
            p = es[es.kind == "pitch"]
            sl = p.groupby("src_item").apply(lambda g: _slope0(g.st.values / 12.0, g.delta.values), include_groups=False)
            out[f"{eng}_leak_per_oct{sfx}"] = float(np.nanmedian(sl)) if len(sl) else np.nan
            out[f"{eng}_R2{sfx}"] = abs(out[f"{eng}_leak_per_oct{sfx}"]) / G
            fo = es[es.kind == "formant"]
            sl = fo.groupby("src_item").apply(lambda g: _slope0(np.log(g.fs.values), g.delta.values),
                                              include_groups=False)
            out[f"{eng}_R3{sfx}"] = float(np.nanmedian(sl)) * LN115 / G if len(sl) else np.nan
            s5 = fo[np.isclose(fo.fs, 1.05)].delta.values
            s95 = fo[np.isclose(fo.fs, 0.95)].delta.values
            sg = np.r_[s5 > 0, s95 < 0][np.isfinite(np.r_[s5, s95])]
            out[f"{eng}_sign5{sfx}"] = float(sg.mean()) if len(sg) else np.nan
            hi = es[es.kind == "hi"]
            sl = hi.groupby("src_item").apply(lambda g: _slope0(np.log(g.fs.values), g.delta.values),
                                              include_groups=False)
            out[f"{eng}_R3hi{sfx}"] = float(np.nanmedian(sl)) * LN115 / G if len(sl) else np.nan
            h5 = hi[np.isclose(hi.fs, 1.05)].delta.values
            h95 = hi[np.isclose(hi.fs, 0.95)].delta.values
            sg = np.r_[h5 > 0, h95 < 0][np.isfinite(np.r_[h5, h95])]
            out[f"{eng}_sign5hi{sfx}"] = float(sg.mean()) if len(sg) else np.nan
        # pitch-alone flips and combined-move crossings relative to the corpus midpoint
        men, wom = e[e.sex == "m"], e[e.sex == "f"]
        p12 = men[men.cond == "p+12"].r
        out[f"{eng}_men_p+12_cross"] = float((p12 > mid).mean()) if len(p12) else np.nan
        w12 = wom[wom.cond == "p-12"].r
        out[f"{eng}_women_p-12_cross"] = float((w12 < mid).mean()) if len(w12) else np.nan
        for cond, sub, fs, gt in (("mf+12_f1.15", men, 1.15, True), ("fm-12_f0.85", wom, 0.85, False)):
            c = sub[sub.cond == cond]
            if len(c):
                out[f"{eng}_{cond}_cross"] = float(((c.r > mid) if gt else (c.r < mid)).mean())
                fo = sub[(sub.kind == "formant") & np.isclose(sub.fs, fs)].set_index("src_item").delta
                cd = c.set_index("src_item").delta
                share = (fo / cd).replace([np.inf, -np.inf], np.nan)
                out[f"{eng}_{cond}_resonance_share"] = float(np.nanmedian(share)) if len(share) else np.nan
                out[f"{eng}_{cond}_delta_over_G"] = float(np.nanmedian(cd)) / G
    return out


# ------------------------------------------------------------------ R4
def r4(win, man, agg, G_hill):
    r = utt_readouts(win, man.item_id, agg)
    d = man.assign(r=man.item_id.map(r).values)
    d = d[np.isfinite(d.r)]
    sds = d.groupby("speaker").r.agg(lambda v: np.std(v, ddof=1) if len(v) >= 8 else np.nan)
    d["dev"] = d.r - d.groupby("speaker").r.transform("mean")
    vo = d.groupby("vowel").dev.mean() / G_hill
    return {"R4": float(np.nanmedian(sds)) / G_hill, "vowel_offset_range": float(vo.max() - vo.min()),
            "vowel_offsets": vo.round(3).to_dict(), "n_spk": int(np.isfinite(sds).sum())}


# ------------------------------------------------------------------ R5
def r5(win_test, man_test, win_syn, man_syn, agg, G, band=0.25, cap=60.0):
    sd = [np.std(s, ddof=1) for i, (t, s) in win_test.items() if len(s) >= 5]
    out = {"flicker": float(np.median(sd)) / G if sd else np.nan}
    held = []
    if win_syn is not None:
        for iid in man_syn[man_syn.group.isin(["men", "women"])].item_id:
            if iid in win_syn:
                t, s = win_syn[iid]
                s = s[(t >= 0.75) & (t <= 2.0)]
                if len(s) >= 3:
                    held.append(np.std(s, ddof=1))
    out["held_sd"] = float(np.median(held)) / G if held else np.nan
    f = _agg(agg)
    tts = []
    for spk, (c, s, tot) in stamped(win_test, man_test).items():
        end = min(cap, tot)
        if len(c) == 0 or end < 5:
            continue
        cps = np.arange(0.5, end + 1e-9, 0.5)
        vals = np.array([f(s[c <= cp]) if np.any(c <= cp) else np.nan for cp in cps])
        fin = vals[-1]
        bad = ~(np.abs(vals - fin) <= band * abs(G))
        tts.append(cps[np.flatnonzero(bad)[-1] + 1] if bad.any() and np.flatnonzero(bad)[-1] + 1 < len(cps)
                   else (cps[0] if not bad.any() else end))
    out["time_to_stable_s"] = float(np.median(tts)) if tts else np.nan
    return out


# ------------------------------------------------------------------ R6
R6_GROUPS = ("second", "alice_raised", "alice_low")


def r6(win, man, agg, G, leak_per_oct):
    r = utt_readouts(win, man.item_id, agg)
    d = man.assign(r=man.item_id.map(r).values)
    out = {"coverage": float(np.isfinite(d.r).mean())}
    med = d.groupby("group").r.median()
    out["clip_median_over_G"] = (med / G).round(3).to_dict()
    S, R, L = (med.get(g, np.nan) for g in R6_GROUPS)
    out["S_minus_L"], out["R_minus_L"], out["S_minus_R"] = (S - L) / G, (R - L) / G, (S - R) / G
    for a, b in (("second", "alice_low"), ("alice_raised", "alice_low"), ("second", "alice_raised")):
        out[f"auc_clip_{a}_vs_{b}"] = wauc(d[d.group == a].r, d[d.group == b].r)
    m5 = man.assign(stream=man.session + "|" + man.group, order=man.t_start.rank(method="first"))
    h = horizon(win, m5, 5.0, agg, speaker_col="stream", label_cols=("group",))
    if len(h):
        hm = h.groupby("group").r.median()
        out["h5_n"] = h.group.value_counts().to_dict()
        for a, b in (("second", "alice_low"), ("alice_raised", "alice_low"), ("second", "alice_raised")):
            out[f"auc_5s_{a}_vs_{b}"] = wauc(h[h.group == a].r, h[h.group == b].r)
        S5, R5, L5 = (hm.get(g, np.nan) for g in R6_GROUPS)
    else:
        S5 = R5 = L5 = np.nan
    five = bool(np.all(np.isfinite([S5, R5, L5])))
    use = (S5, R5, L5) if five else (S, R, L)
    out["ordering_basis"] = "5s" if five else "clip"
    out["ordering_ok"] = bool(use[0] > use[1] > use[2])
    f0 = d.groupby("group").f0_median.median()
    doct = np.log2(f0.get("alice_raised", np.nan) / f0.get("alice_low", np.nan))
    out["R_minus_L_pitch_corrected"] = ((R - L) - leak_per_oct * doct) / G if np.isfinite(leak_per_oct) else np.nan
    out["raised_minus_low_octaves"] = float(doct)
    return out


# ------------------------------------------------------------------ R7
def r7(win_syn, man_syn, win_test, man_test, agg):
    out = {}
    if win_syn is not None:
        r = utt_readouts(win_syn, man_syn.item_id, agg)
        d = man_syn.assign(r=man_syn.item_id.map(r).values)
        m = d.groupby("group").r.median()
        Gs = m.get("women", np.nan) - m.get("men", np.nan)
        out["synth_gap_sign_ok"] = bool(Gs > 0)
        out["synth_auc_women_vs_men"] = wauc(d[d.group == "women"].r, d[d.group == "men"].r)
        for g in ("boys", "girls"):
            out[f"synth_{g}_position"] = float((m.get(g, np.nan) - m.get("men", np.nan)) / Gs) if Gs else np.nan
            out[f"synth_auc_{g}_vs_men"] = wauc(d[d.group == g].r, d[d.group == "men"].r)
        out["synth_coverage"] = float(np.isfinite(d.r).mean())
    r = utt_readouts(win_test, man_test.item_id, agg)
    d = man_test.assign(r=man_test.item_id.map(r).values)
    w = d[d.sex == "f"]
    q75, q25 = np.nanpercentile(w.f0_median, 75), np.nanpercentile(w.f0_median, 25)
    men = d[d.sex == "m"].r
    out["auc_highF0women_vs_men"] = wauc(w[w.f0_median >= q75].r, men)
    out["auc_lowF0women_vs_men"] = wauc(w[w.f0_median <= q25].r, men)
    out["women_f0_q25_q75"] = [float(q25), float(q75)]
    return out
