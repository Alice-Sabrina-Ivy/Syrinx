"""Step 2: the shipped fit (form A, target 'half', licence-clean fit set 'main') and its evaluation.
Writes calibrate.txt, fit.json (coefficients + offsets + bootstrap), units_loso.csv, voices.csv."""
import json
import numpy as np, pandas as pd
from data import *

OUT = []
say = lambda *a: (print(*a), OUT.append(" ".join(str(x) for x in a)))
FS = ["palette", "meyer-ls", "skuk", "hc-concat", "hc-sent", "rb695"]
H = set_target(load(), "half")
H = H[H[CUE].notna().all(axis=1)].reset_index(drop=True)
F = H[H.fset.isin(FS) & H.y.notna()].reset_index(drop=True)
full = fitp(F)
a, bm, bf = raw_coefs(full.p)
say(f"Fit set: " + ", ".join(f"{s} {len(F[F.fset == s])} stimuli / {F[F.fset == s].unit.nunique()} listener data / "
                             f"{F[F.fset == s].talker.nunique()} talkers" for s in FS))
say(f"SHIPPED: eta = logit P(man, two-way) = {a:+.4f} {bm:+.5f}*meter_logit {bf:+.5f}*lnF0")
say(f"  u-units: icpt(u=0.5) {full.p[0]:+.3f}, meter {full.p[1]:+.3f}/G, lnF0 {full.p[2]:+.3f}/G")
say("  source offsets (logit, sum to zero; the app uses 0): " + ", ".join(f"{k} {v:+.2f}" for k, v in full.off.items()))
offs = np.array(list(full.off.values()))
say(f"  SD of source offsets {offs.std(ddof=1):.2f} logit (range {offs.min():+.2f} .. {offs.max():+.2f})")
# 50 % boundary
for m in [-4, -2, 0, 2, 4]:
    say(f"  50 % 'man' boundary at meter_logit {m:+d}: F0 = {np.exp((a + bm * m) / -bf):.0f} Hz")

# ---------------------------------------------------------------- bootstrap (talkers resampled within source)
rng = np.random.default_rng(7)
B = []
groups = {s: F[F.fset == s].talker.unique() for s in FS}
for b in range(300):
    parts = []
    for s in FS:
        tk = rng.choice(groups[s], len(groups[s]))
        for i, t in enumerate(tk):
            d = F[(F.fset == s) & (F.talker == t)].copy()
            d["unit"] = d.unit + f"#{i}"
            parts.append(d)
    Fb = pd.concat(parts, ignore_index=True)
    B.append(raw_coefs(fitp(Fb).p))
B = np.array(B)
ci = np.percentile(B, [2.5, 97.5], axis=0)
say(f"  talker-cluster bootstrap 95 % CI (300 reps): a [{ci[0,0]:+.2f}, {ci[1,0]:+.2f}], "
    f"b [{ci[0,1]:+.4f}, {ci[1,1]:+.4f}], c [{ci[0,2]:+.3f}, {ci[1,2]:+.3f}]")
# prediction SE at representative points from the bootstrap
for m, f0 in [(-4, 110), (-1, 150), (1, 165), (3, 200)]:
    e = B[:, 0] + B[:, 1] * m + B[:, 2] * np.log(f0)
    say(f"    eta at meter {m:+d}, {f0} Hz: {a + bm * m + bf * np.log(f0):+.2f} (bootstrap SD {e.std():.2f})")

# ---------------------------------------------------------------- in-sample, LOSO
say("\n== In-sample (with source offsets) per fit source, MAE points (bias) per listener datum ==")
for s in FS:
    U = ustats(F[F.fset == s], full(F[F.fset == s], use_offset=True))
    say(f"  {s:10s} {fmt(summ(U))}")
say("\n== Leave-one-source-out (held-out source predicted with offset 0 = the app) ==")
LO = []
for s in FS:
    m = fitp(F[F.fset != s])
    d = F[F.fset == s]
    U = ustats(d, m(d))
    U["eta"] = lg(U.pred)
    LO.append(U)
    say(f"  {s:10s} {fmt(summ(U))}")
LO = pd.concat(LO)
sm = LO.groupby("fset").apply(lambda u: np.abs(u.pred - u.y).mean())
o = summ(LO)
say(f"  pooled     {fmt(o)} | mean of source MAEs {sm.mean():.1f}")
fs_ = LO[LO.fset != "palette"]
o2 = summ(fs_)
say(f"  non-Palette sources pooled: {fmt(o2)}  -> gender-symmetric max(fem, masc) = {max(o2['fem'][0], o2['masc'][0]):.1f}")
LO.to_csv("units_loso.csv")

# ---------------------------------------------------------------- LOTO within source
say("\n== Leave-one-talker-out within each fit source (MAE per listener datum; 'known' = the source's own offset, "
    "'app' = offset 0) ==")
LOTO = {}
for s in FS:
    d = F[F.fset == s]
    pk, p0 = np.full(len(d), np.nan), np.full(len(d), np.nan)
    for t in d.talker.unique():
        te = (F.fset == s) & (F.talker == t)
        m = fitp(F[~te])
        pk[(d.talker == t).values] = m(F[te], use_offset=True)
        p0[(d.talker == t).values] = m(F[te])
    Uk, U0 = ustats(d, pk), ustats(d, p0)
    LOTO[s] = (d.assign(pk=pk, p0=p0))
    say(f"  {s:10s} known: {fmt(summ(Uk))}")
    say(f"  {'':10s} app:   {fmt(summ(U0))}")

# ---------------------------------------------------------------- validation (licence: validation only)
say("\n== Validation sources (full fit, offset 0; never used to set a constant) ==")
V = H[H.vset != ""]
VU = []
for v in ["picka-jebens-ls", "picka-jebens-vnt-sent", "picka-nagels-ls", "hc-syl", "libritts-p", "mooshammer", "kong-singing"]:
    d = V[V.vset == v]
    U = ustats(d.assign(fset=""), full(d), "y_half")
    U["eta"] = lg(U.pred)
    VU.append(U)
    say(f"  {v:22s} {fmt(summ(U))}")
bm_ = H[(H.src == "bmmb") & H.side.isin(["fem", "masc"])]
for lab, yc in [("bmmb adults, man-or-boy (4AFC)", "y_afc"), ("bmmb adults, adult man (4AFC)", "y_raw")]:
    U = ustats(bm_.assign(fset="", vset="bmmb"), full(bm_), yc)
    say(f"  {lab:32s} {fmt(summ(U))}")
ch = H[(H.src == "bmmb") & H.side.str.startswith("child")]
pc = full(ch)
say(f"  bmmb CHILDREN (out of scope): predicted % man median girls {np.median(pc[ch.side == 'child-f']):.0f}, boys "
    f"{np.median(pc[ch.side == 'child-m']):.0f}; heard as male (boy or man) girls {ch[ch.side == 'child-f'].y_afc.mean():.0f}, "
    f"boys {ch[ch.side == 'child-m'].y_afc.mean():.0f}")
ne = H[H.src == "neuenswander"]
pn = full(ne)
from scipy.stats import spearmanr
w = ne.side == "fem"
say(f"  Neuenswander (ratings only): women predicted {pn[w].min():.0f}-{pn[w].max():.0f} % man, Spearman with femininity "
    f"{spearmanr(pn[w], ne.rating[w]).correlation:+.2f}; men predicted {pn[~w].min():.0f}-{pn[~w].max():.0f} %")

# clear natural / unmodified voices
say("\n== Clear voices (offset 0): predicted vs heard '% man' ==")
clear = []
for lab, d, yc in [
        ("H&C US women (concat, LOSO)", LO[(LO.fset == "hc-concat") & (LO.cond == "WUS")], None),
        ("H&C US men (concat, LOSO)", LO[(LO.fset == "hc-concat") & (LO.cond == "MUS")], None),
        ("H&C US women (sent, LOSO)", LO[(LO.fset == "hc-sent") & (LO.cond == "WUS")], None),
        ("H&C US men (sent, LOSO)", LO[(LO.fset == "hc-sent") & (LO.cond == "MUS")], None)]:
    say(f"  {lab:34s} heard {d.y.mean():5.1f}  predicted {d.pred.mean():5.1f}")
for lab, d, yc in [("bmmb women, actual (adult man)", bm_[(bm_.side == 'fem') & (bm_.cond == 'a')], "y_raw"),
                   ("bmmb men, actual (adult man)", bm_[(bm_.side == 'masc') & (bm_.cond == 'a')], "y_raw"),
                   ("LibriTTS-P women", H[(H.src == 'libritts-p') & (H.side == 'fem')], "y_half"),
                   ("LibriTTS-P men", H[(H.src == 'libritts-p') & (H.side == 'masc')], "y_half"),
                   ("PICKA LS 0/0 women (Jebens)", H[(H.vset == 'picka-jebens-ls') & (H.cell == '0.0/0.0')], "y_half"),
                   ("Meyer 0/0 women (LOSO)", None, None)]:
    if d is None:
        dd = LO[(LO.fset == "meyer-ls") & (LO.index.str.endswith("0.0/0.0"))]
        say(f"  {lab:34s} heard {dd.y.mean():5.1f}  predicted {dd.pred.mean():5.1f}")
        continue
    p = full(d)
    say(f"  {lab:34s} heard {d[yc].mean():5.1f}  predicted median {np.median(p):5.1f} (q10 {np.percentile(p, 10):.1f}, q90 {np.percentile(p, 90):.1f})")

json.dump(dict(a=a, b_meter=bm, c_lnf0=bf, u_params=list(full.p[:3]), offsets=full.off,
               offset_sd=float(offs.std(ddof=1)), boot_ci=ci.tolist()), open("fit.json", "w"), indent=1)
pd.concat(VU).to_csv("units_val.csv")
# per-voice frames for the width analysis
LOTO["palette"].to_csv("palette_loto.csv", index=False)
open("calibrate.txt", "w", encoding="utf-8").write("\n".join(OUT))
