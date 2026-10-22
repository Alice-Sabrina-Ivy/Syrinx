"""Data + fit machinery for the shippable "Likely heard as" calibration (2026-10-07).

Inputs are the frozen per-source stimulus tables of the feminine-side evaluation
($SYRINX_HEARD_AS_DATA/feminine-eval/*/stimuli.csv) and the Palette table
($SYRINX_HEARD_AS_DATA/resonance-choice/measure/pov_stimuli.csv), loaded through fe_common.py
(a snapshot of feminine-eval/analysis/common.py; only its FE path line differs).
Every cue was measured with resonance-choice/measure/run_lab.mjs and pooled with
assemble.py load():
  meter_logit = arithmetic mean over the item's scored 0.75 s classifier windows of the
                fc7 logit difference (female - male) of voice-gender-classifier-onnx-q8-v2;
                a window ending at t is scored when the production pitch replica has >= 1
                voiced 10 ms frame in (t - 0.5 s, t]; windows end every 0.15 s.
  lnf0        = ln(median of the voiced 10 ms production-pitch-replica F0 values of the item).

Licence classes (decide what may set a shipped constant):
  FIT (CC BY / CC0 / MIT / facts): palette (Munson & Dolquist 2025, CC BY 4.0),
      meyer-ls (Meyer et al. 2023 cells: data CC0, figure CC BY 4.0; on the rebuilt
      LibriSpeech CC BY 4.0 PICKA-grid stimuli), skuk (OSF f85tj, CC BY 4.0),
      hc-concat / hc-sent (Hillenbrand & Clark 2009 printed condition rates = facts;
      stimuli rebuilt from H95 audio / LibriSpeech CC BY 4.0), rb695 (ResearchBox 695
      data CC BY 4.0; TTS audio never redistributed), bmmb (MIT; tested as an optional
      fit source, see calibrate.py).
  VALIDATION ONLY: picka-jebens / picka-nagels (CC BY-NC-SA), kong (NC + copyrighted
      audio), neuenswander, mooshammer (no licence), libritts-p (validation by
      instruction), hc-syl (licence-clean but thin and the same listener data as
      hc-concat)."""
import os, sys
import numpy as np, pandas as pd
from scipy.optimize import least_squares

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import fe_common as C  # noqa: E402

G, MEN = C.G, C.MEN
CUE = ["meter_logit", "lnf0"]


def load():
    H = C.load_all()
    H["licence"] = "val"
    # ---- Meyer et al. 2023 cells on the rebuilt PICKA LibriSpeech grid (F0-matched talkers),
    #      mean of the laptop (STRAIGHT) and robot-Sam (pyWORLD) panels = one listener group
    pk = pd.read_csv(os.path.join(C.FE, "picka", "stimuli.csv"))
    pk = pk[pk.material == "ls_sentence"]
    mey = ((pk.p_man_meyer_laptop_digitised + pk.p_man_meyer_sam_digitised) / 2).values
    mmap = dict(zip(pk.stim_id, mey))
    nmap = dict(zip(pk.stim_id, pk.p_man_nagels2020))
    ls = H[(H.src == "picka") & (H.subset == "ls")].copy()
    M = ls[ls.f0match == True].copy()
    M["src"] = "meyer"
    M["unit"] = "mey_" + M.cell
    M["y_raw"] = M["y_afc"] = M["y_half"] = M.stim_id.map(mmap)
    N = ls.copy()                          # Nagels 2020 cells (NC-SA) on all 20 talkers: validation
    N["src"] = "nagels"
    N["unit"] = "nag_" + N.cell
    N["y_raw"] = N["y_afc"] = N["y_half"] = N.stim_id.map(nmap)
    H = pd.concat([H, M, N], ignore_index=True)

    H["fset"] = ""
    H.loc[H.src == "palette", "fset"] = "palette"
    H.loc[H.src == "meyer", "fset"] = "meyer-ls"
    H.loc[H.src == "skuk", "fset"] = "skuk"
    H.loc[(H.src == "hc") & (H.subset == "concat"), "fset"] = "hc-concat"
    H.loc[(H.src == "hc") & (H.subset == "sent"), "fset"] = "hc-sent"
    H.loc[H.src == "rb695", "fset"] = "rb695"
    H.loc[(H.src == "bmmb") & H.side.isin(["fem", "masc"]), "fset"] = "bmmb"   # optional fit source
    H.loc[H.fset != "", "licence"] = "fit"
    # validation-set labels
    H["vset"] = ""
    H.loc[(H.src == "picka") & (H.subset == "ls"), "vset"] = "picka-jebens-ls"
    H.loc[(H.src == "picka") & (H.subset == "vnt-sent"), "vset"] = "picka-jebens-vnt-sent"
    H.loc[H.src == "nagels", "vset"] = "picka-nagels-ls"
    H.loc[(H.src == "hc") & (H.subset == "syl"), "vset"] = "hc-syl"
    H.loc[H.src == "libritts-p", "vset"] = "libritts-p"
    H.loc[(H.src == "mooshammer") & H.y_half.notna(), "vset"] = "mooshammer"
    H.loc[(H.src == "kong") & ~H.thin, "vset"] = "kong-singing"
    for c in CUE:
        H["z_" + c] = (H[c] - MEN[c]) / G[c] - 0.5
    return H


def set_target(H, tgt):
    """tgt 'half': man + unsure/2 (2AFC sources as published); 'afc': man/(man+woman)."""
    H = H.copy()
    H["y"] = H.y_half if tgt == "half" else H.y_afc
    return H


def weights(d, mode="sqrt"):
    nu = d.groupby("fset").unit.nunique()
    sw = np.sqrt(nu) if mode == "sqrt" else nu * 0 + 1
    per_unit_rows = d.groupby("unit").unit.transform("size")
    w = d.fset.map(sw / nu).values / per_unit_rows.values
    return w / w.mean()


ZC = ["z_meter_logit", "z_lnf0"]


def fitp(d, cols=ZC, offsets=True, wmode="sqrt"):
    """Logistic link, least squares on the share (logit_cal.py / pooled.py), sqrt source weights,
    sum-to-zero per-source intercept offsets. Prediction with use_offset=False = offset 0
    (the average listener group) = what the app shows."""
    srcs = sorted(d.fset.unique())
    X = d[cols].values.astype(float)
    y = d.y.values.astype(float)
    sw = np.sqrt(weights(d, wmode))
    S = np.zeros((len(d), max(0, len(srcs) - 1)))
    if offsets and len(srcs) > 1:
        for j, s in enumerate(srcs[:-1]):
            S[:, j] = (d.fset == s).values.astype(float)
        S[(d.fset == srcs[-1]).values, :] = -1.0
    k = X.shape[1]

    def f(p):
        eta = p[0] + X @ p[1:1 + k] + (S @ p[1 + k:] if S.shape[1] and offsets else 0)
        return sw * (100 / (1 + np.exp(-eta)) - y)
    npar = 1 + k + (S.shape[1] if offsets else 0)
    p = least_squares(f, np.zeros(npar)).x
    off = {}
    if offsets and len(srcs) > 1:
        o = list(p[1 + k:])
        off = dict(zip(srcs, o + [-sum(o)]))

    def eta(dn, use_offset=False):
        e = p[0] + dn[cols].values.astype(float) @ p[1:1 + k]
        if use_offset:
            e = e + dn.fset.map(off).fillna(0).values
        return e

    def pred(dn, use_offset=False):
        return 100 / (1 + np.exp(-eta(dn, use_offset)))
    pred.p, pred.off, pred.eta = p, off, eta
    return pred


def raw_coefs(p):
    """u-unit params (icpt at u=0.5, b_meter, b_lnf0) -> eta = a + b*meter_logit + c*lnF0."""
    bm, bf = p[1] / G["meter_logit"], p[2] / G["lnf0"]
    a = p[0] - p[1] * (MEN["meter_logit"] / G["meter_logit"] + 0.5) - p[2] * (MEN["lnf0"] / G["lnf0"] + 0.5)
    return a, bm, bf


def ustats(d, pred, ycol="y"):
    d = d.assign(pred=pred)
    U = d.groupby("unit").agg(pred=("pred", "mean"), y=(ycol, "first"), side=("side", "first"),
                              fset=("fset", "first"), vset=("vset", "first"), src=("src", "first"),
                              talker=("talker", "first"), cond=("cond", "first"),
                              meter=("meter_logit", "mean"), lnf0=("lnf0", "mean"))
    return U[U.y.notna() & U.pred.notna()]


def summ(U):
    o = {}
    for side in ["all", "fem", "mid", "masc"]:
        u_ = U if side == "all" else U[U.side == side]
        if len(u_):
            o[side] = (np.abs(u_.pred - u_.y).mean(), (u_.pred - u_.y).mean(), len(u_))
    return o


def fmt(o):
    return " | ".join(f"{k} {v[0]:5.1f} ({v[1]:+5.1f}) n={v[2]}" for k, v in o.items())


lg = lambda p: np.log(np.clip(p, 0.5, 99.5) / (100 - np.clip(p, 0.5, 99.5)))
sig = lambda e: 100 / (1 + np.exp(-e))
