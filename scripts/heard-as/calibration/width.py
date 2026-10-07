"""Step 4: trainee-direction bias and the width of the displayed 80 % range.
Uses fit.json, units_loso.csv, units_val.csv and palette_loto.csv from calibrate.py. Writes width.txt."""
import json
import numpy as np, pandas as pd
from scipy.special import betainc
from data import *

OUT = []
say = lambda *a: (print(*a), OUT.append(" ".join(str(x) for x in a)))
FIT = json.load(open("fit.json"))
H = set_target(load(), "half")
H = H[H[CUE].notna().all(axis=1)].reset_index(drop=True)
eta_of = lambda d: FIT["a"] + FIT["b_meter"] * d.meter_logit.values + FIT["c_lnf0"] * d.lnf0.values
LO = pd.read_csv("units_loso.csv", index_col=0)
VU = pd.read_csv("units_val.csv", index_col=0)

# ================================================================ trainee direction
say("== Trainee-direction cases: pitch moved away from the voice's own sex, predicted (offset 0, held out) vs heard ==")
say("   'held out' = the source was left out of the fit (LOSO) or never in it (validation). % heard as man (two-way).")
rows = []


def add(group, label, d, how):
    for u, r in d.iterrows():
        rows.append(dict(group=group, case=label, unit=u, heard=r.y, pred=r.pred, how=how))


# male base, F0 raised
for fs, how in [("hc-concat", "LOSO"), ("hc-sent", "LOSO")]:
    for c, lab in [("MPO", "pitch raised x1.70 (+9.2 st), formants unchanged"), ("MPE", "pitch +9.2 st AND formants +2.7 st")]:
        add("male base, pitch raised", f"H&C {fs[3:]} {c}: {lab}", LO[(LO.fset == fs) & (LO.cond == c)], how)
for c, lab in [("MPO", "pitch raised x1.70 (+9.2 st), formants unchanged"), ("MPE", "pitch +9.2 st AND formants +2.7 st")]:
    add("male base, pitch raised", f"H&C syllables {c}: {lab}", VU[(VU.vset == "hc-syl") & (VU.cond == c)], "validation")
add("male base, pitch raised", "RB695 Google male TTS, pitch raised (to ~161 Hz)", LO[(LO.fset == "rb695") & (LO.cond == "tts-m-raised")], "LOSO")
sk = LO[(LO.fset == "skuk")]
for lvl in [40, 60, 80, 100]:
    add("androgynous timbre, pitch varied (Skuk F0 continuum)", f"Skuk F0 morph {lvl} % female (timbre at 50 %)", sk[sk.index == f"sk_F0_{lvl}"], "LOSO")
# female base, F0 lowered (the mirror case, for gender symmetry)
for fs, how in [("hc-concat", "LOSO"), ("hc-sent", "LOSO")]:
    for c, lab in [("WPO", "pitch lowered x0.59 (-9.2 st), formants unchanged"), ("WPE", "pitch -9.2 st AND formants -2.7 st")]:
        add("female base, pitch lowered", f"H&C {fs[3:]} {c}: {lab}", LO[(LO.fset == fs) & (LO.cond == c)], how)
for c, lab in [("WPO", "pitch lowered x0.59 (-9.2 st), formants unchanged"), ("WPE", "pitch -9.2 st AND formants -2.7 st")]:
    add("female base, pitch lowered", f"H&C syllables {c}: {lab}", VU[(VU.vset == "hc-syl") & (VU.cond == c)], "validation")
for cell, lab in [("-6.0/0.0", "pitch -6 st, VTL unchanged"), ("-12.0/0.0", "pitch -12 st, VTL unchanged"),
                  ("-6.0/1.8", "pitch -6 st, VTL +1.8 st"), ("-12.0/1.8", "pitch -12 st, VTL +1.8 st")]:
    add("female base, pitch lowered", f"Meyer cells (LibriSpeech rebuild) {lab}", LO[LO.index == f"mey_{cell}"], "LOSO")
    add("female base, pitch lowered", f"Jebens cells (LibriSpeech rebuild) {lab}", VU[VU.index == f"pk_ls_{cell}"], "validation")
    add("female base, pitch lowered", f"Nagels cells (LibriSpeech rebuild) {lab}", VU[VU.index == f"nag_{cell}"], "validation")
add("female base, pitch lowered", "RB695 female TTS, pitch lowered (~137 Hz)", LO[(LO.fset == "rb695") & (LO.cond == "tts-f-lowered")], "LOSO")
T = pd.DataFrame(rows)
T["err"] = T.pred - T.heard
for g, d in T.groupby("group", sort=False):
    say(f"\n  -- {g} --")
    for _, r in d.iterrows():
        say(f"   {r.case:68s} [{r.how:10s}] heard {r.heard:5.1f}  predicted {r.pred:5.1f}  error {r.err:+6.1f}")
po = T[T.case.str.contains("formants unchanged|Google male|VTL unchanged|female TTS")]
for g, d in po.groupby("group", sort=False):
    say(f"  SUMMARY pitch moved, resonance NOT moved, {g}: n={len(d)} data, error (pred - heard) median {d.err.median():+.1f}, "
        f"range {d.err.min():+.1f} .. {d.err.max():+.1f} points")
pe = T[T.case.str.contains("AND formants|VTL \\+1.8")]
for g, d in pe.groupby("group", sort=False):
    say(f"  SUMMARY pitch AND resonance moved, {g}: n={len(d)}, error median {d.err.median():+.1f}, range {d.err.min():+.1f} .. {d.err.max():+.1f}")
T.to_csv("trainee_direction.csv", index=False)

# ================================================================ per-voice coverage of candidate widths
say("\n== Per-voice coverage of an 80 % range eta +/- w (logit), held-out voices, offset 0 ==")
say("   naive: observed share inside [sig(eta-w), sig(eta+w)].  consistent: also counted as covered when the observed")
say("   count is not significantly outside the range at the 10 % one-sided binomial level for that panel size (small")
say("   panels cannot show 0 % or 100 % as a contradiction of a 2 % or 98 % edge).")


def cdf_le(k, n, p):  # P(X <= k), k may be fractional
    k = np.clip(k, 0, n)
    return np.where(k >= n, 1.0, betainc(np.maximum(n - k, 1e-9), k + 1, 1 - p))


def covered(y, eta, n, w):
    lo, hi = sig(eta - w) / 100, sig(eta + w) / 100
    y = np.asarray(y, float) / 100
    naive = (y >= lo) & (y <= hi)
    k = y * n
    below = (y < lo) & (cdf_le(k, n, lo) >= 0.10)
    above = (y > hi) & ((1 - cdf_le(k - 1, n, hi)) >= 0.10)
    return naive, naive | below | above


pal = pd.read_csv("palette_loto.csv")
bm = H[(H.src == "bmmb") & H.side.isin(["fem", "masc"])]
lt = H[H.src == "libritts-p"].groupby("talker").agg(eta=("meter_logit", "size"), y=("y_half", "first"), side=("side", "first"))
lt["eta"] = [eta_of(H[(H.src == "libritts-p") & (H.talker == t)]).mean() for t in lt.index]
pal_loso = LO[LO.fset == "palette"]
SETS = {
    "Palette, leave-one-TALKER-out (n~49 listeners)": (lg(pal.y), lg(pal.p0), np.full(len(pal), 49), pal.side.values, pal.y.values),
    "Palette, leave-one-SOURCE-out": (None, pal_loso.eta.values, np.full(len(pal_loso), 49), pal_loso.side.values, pal_loso.y.values),
    "bmmb natural adults /hid/, man-or-boy (n=15)": (None, eta_of(bm[bm.cond == "a"]), np.full((bm.cond == "a").sum(), 15),
                                                      bm[bm.cond == "a"].side.values, bm[bm.cond == "a"].y_afc.values),
    "bmmb natural adults /hid/, adult man (n=15)": (None, eta_of(bm[bm.cond == "a"]), np.full((bm.cond == "a").sum(), 15),
                                                     bm[bm.cond == "a"].side.values, bm[bm.cond == "a"].y_raw.values),
    "LibriTTS-P natural readers (n=3 annotators) [val]": (None, lt.eta.values, np.full(len(lt), 3), lt.side.values, lt.y.values),
}
WS = [1.0, 1.28, 1.5, 1.79, 2.0, 2.25, 2.5, 2.75, 3.0]
NEED = {}
for name, (_, eta, n, side, y) in SETS.items():
    say(f"\n  {name}: {len(y)} voices")
    for sd in ["all", "fem", "masc"]:
        m = np.ones(len(y), bool) if sd == "all" else (side == sd)
        if m.sum() == 0:
            continue
        cells = []
        for w in WS:
            nv, cs = covered(y[m], eta[m], n[m], w)
            cells.append(f"{w:.2f}: {nv.mean():.2f}/{cs.mean():.2f}")
        grid = np.arange(0.5, 6.01, 0.05)
        need_n = next((w for w in grid if covered(y[m], eta[m], n[m], w)[0].mean() >= 0.8), np.nan)
        need_c = next((w for w in grid if covered(y[m], eta[m], n[m], w)[1].mean() >= 0.8), np.nan)
        NEED[(name, sd)] = (need_n, need_c)
        say(f"    {sd:4s} (n={m.sum():3d}) naive/consistent  " + " ".join(cells) +
            f"   | width for 80 %: naive {need_n:.2f}, consistent {need_c:.2f}")

say("\n== Condition-level coverage (listener data = condition means) per source, LOSO / validation, offset 0 ==")
for lab, d in list(LO.groupby("fset")) + list(VU.groupby("vset")):
    cells = []
    for w in WS:
        nv, _ = covered(d.y.values, d.eta.values, np.full(len(d), 1000), w)
        cells.append(f"{w:.2f}: {nv.mean():.2f}")
    say(f"   {lab:22s} n={len(d):4d}  " + " ".join(cells))

# ================================================================ three-way word per width on natural voices
say("\n== Three-way word ('likely heard as a man' if the whole range > 50 %, '... a woman' if < 50 %, else 'listeners would"
    " split'), per width, natural held-out voices ==")
for name in ["Palette, leave-one-TALKER-out (n~49 listeners)", "bmmb natural adults /hid/, adult man (n=15)",
             "LibriTTS-P natural readers (n=3 annotators) [val]"]:
    _, eta, n, side, y = SETS[name]
    for w in [1.28, 1.79, 2.25, 2.5]:
        lo, hi = sig(eta - w), sig(eta + w)
        word = np.where(lo > 50, "man", np.where(hi < 50, "woman", "split"))
        wrong = ((word == "man") & (y < 50)) | ((word == "woman") & (y > 50))
        say(f"   {name[:40]:40s} w {w:.2f}: man {np.mean(word == 'man'):.2f} woman {np.mean(word == 'woman'):.2f} "
            f"split {np.mean(word == 'split'):.2f} | wrong side {wrong.sum()} of {len(y)}"
            f" | women called 'woman' {np.mean(word[side == 'fem'] == 'woman') if (side == 'fem').any() else float('nan'):.2f}"
            f", men called 'man' {np.mean(word[side == 'masc'] == 'man'):.2f}")
json.dump({f"{k[0]} | {k[1]}": v for k, v in NEED.items()}, open("width_need.json", "w"), indent=1)
open("width.txt", "w", encoding="utf-8").write("\n".join(OUT))
