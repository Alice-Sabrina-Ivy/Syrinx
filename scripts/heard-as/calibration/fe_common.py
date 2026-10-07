"""Shared loader for the feminine-side analysis.

* Palette (pov_stimuli.csv) + the Palette logistic calibrations, fitted EXACTLY as
  resonance-choice/measure/logit_cal.py does (share = 100*sigmoid(a + b.z), z standardised on
  the Palette fit set, least squares on the share, zero start), on all 240 stimuli, for two targets:
    man4 = ALL-Man (the Palette 4-option share: man / woman / other gender / "no")
    afc  = 100 * ALL-Man / (ALL-Man + ALL-Woman)   (2AFC-equivalent share, drops other/"no")
    half = ALL-Man + (ALL-OtherGender + ALL-no)/2   (2AFC-equivalent share, splits other/"no" evenly)
* G units (men->women spacing) and u-scale (0 = typical LibriSpeech man, 1 = typical woman),
  defined exactly as in resonance-choice/measure/analyze.py (reference.json for the 4 finalists,
  r1_utts.csv per-speaker medians for meter_logit and lnf0).
* load_all(): every feminine-eval source harmonised into one long frame.
  Each row = one measured stimulus.  Columns:
    src, subset, stim_id, talker (cluster id for leave-one-talker-out), unit (all rows sharing ONE
    listener datum, e.g. a PICKA cell, an H&C condition, a Skuk morph type x level, an RB695 voice
    condition; transfer errors are computed on unit means = one error per listener datum), side (fem / masc / mid /
    child-f / child-m), cond, cues (meter_logit lnf0 vtln pnml le fv), thin (too little material),
    y_raw  = the source's own "% heard as man" (task-specific, see README per source),
    y_afc  = 2AFC-equivalent "% man" = 100*man/(man+woman) where a third option exists,
    rating = rating target where the source has one (sign: + = more feminine),
    task   = '2afc' | '4afc-child' | '7pt' | '5pt' | 'likert5' | 'annot3' | 'rating'.
"""
import json, os, sys
import numpy as np, pandas as pd
from scipy.optimize import least_squares

# Data root (never committed): $SYRINX_HEARD_AS_DATA holds feminine-eval/<source>/stimuli.csv
# and resonance-choice/measure/{pov_stimuli.csv, r1_utts.csv, out_r1.jsonl} (scripts/heard-as/README.md).
SP = os.environ.get("SYRINX_HEARD_AS_DATA") or sys.exit("set SYRINX_HEARD_AS_DATA (see scripts/heard-as/README.md)")
FE = os.path.join(SP, "feminine-eval")
MEAS = os.path.join(SP, "resonance-choice", "measure")
REF = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..", "..", "public", "resonance-lab", "reference.json")
CUES = ["meter_logit", "lnf0", "vtln", "pnml", "le", "fv"]
FIN = ["vtln", "pnml", "le", "fv"]

# ------------------------------------------------------------------ G units (analyze.py)
_ref = json.load(open(REF))
_r1 = pd.read_csv(os.path.join(MEAS, "r1_utts.csv"))
_spk = _r1.groupby(["speaker", "sex"])[FIN + ["meter_logit", "lnf0"]].median().reset_index()
G, MEN, WOMEN = {}, {}, {}
for c in FIN:
    MEN[c], WOMEN[c] = _ref[c]["menMedian"], _ref[c]["womenMedian"]
for c in ["meter_logit", "lnf0"]:
    MEN[c], WOMEN[c] = _spk[_spk.sex == "m"][c].median(), _spk[_spk.sex == "f"][c].median()
for c in CUES:
    G[c] = WOMEN[c] - MEN[c]


def u(df, c):
    """u-scale: 0 = typical LibriSpeech man, 1 = typical LibriSpeech woman."""
    return (df[c] - MEN[c]) / G[c]


# ------------------------------------------------------------------ Palette + calibrations
def load_palette():
    m = pd.read_csv(os.path.join(MEAS, "pov_stimuli.csv"), dtype={"spk": str})
    m["afc"] = 100 * m["ALL-Man"] / (m["ALL-Man"] + m["ALL-Woman"])
    m["man4"] = m["ALL-Man"]
    # 2AFC-equivalent assuming listeners who chose "other gender" or "no" would split evenly
    m["half"] = m["ALL-Man"] + 0.5 * (m["ALL-OtherGender"] + m["ALL-no"])
    return m


def fit(X, y, w=None):
    """logit_cal.py fit (optionally weighted). Returns predictor and params."""
    X = np.asarray(X, float)
    y = np.asarray(y, float)
    mu, sd = X.mean(0), X.std(0)
    Z = (X - mu) / sd
    sw = np.ones(len(y)) if w is None else np.sqrt(np.asarray(w, float))
    f = lambda p: sw * (100 / (1 + np.exp(-(p[0] + Z @ p[1:]))) - y)
    p = least_squares(f, np.zeros(1 + X.shape[1])).x
    pred = lambda Xn: 100 / (1 + np.exp(-(p[0] + ((np.asarray(Xn, float) - mu) / sd) @ p[1:])))
    pred.params = p
    pred.mu, pred.sd = mu, sd
    return pred


MODELS = {"lnF0": ["lnf0"],
          "meter+lnF0": ["meter_logit", "lnf0"],
          "vtln+lnF0": ["vtln", "lnf0"],
          "pnml+lnF0": ["pnml", "lnf0"],
          "meter+vtln+lnF0": ["meter_logit", "vtln", "lnf0"]}
EXTRA_MODELS = {"meter": ["meter_logit"], "le+lnF0": ["le", "lnf0"], "fv+lnF0": ["fv", "lnf0"],
                "meter+pnml+lnF0": ["meter_logit", "pnml", "lnf0"]}

PAL = load_palette()
CAL = {}
for tgt in ["man4", "afc", "half"]:
    for name, cols in {**MODELS, **EXTRA_MODELS}.items():
        CAL[(tgt, name)] = fit(PAL[cols].values, PAL[tgt].values)
PAL_RANGE = {c: (PAL[c].min(), PAL[c].max()) for c in CUES}


def predict(df, tgt, name):
    cols = {**MODELS, **EXTRA_MODELS}[name]
    X = df[cols].values.astype(float)
    out = np.full(len(df), np.nan)
    ok = np.isfinite(X).all(1)
    out[ok] = CAL[(tgt, name)](X[ok])
    return out


# ------------------------------------------------------------------ sources
def _afc(man, woman):
    man, woman = np.asarray(man, float), np.asarray(woman, float)
    den = man + woman
    return np.where(den > 0, 100 * man / np.where(den > 0, den, 1), np.nan)


def _base(d, src, subset):
    o = pd.DataFrame({"src": src, "subset": subset, "stim_id": d.stim_id.values})
    for c in CUES:
        o[c] = d[c].values.astype(float)
    o["n_voiced_frames"] = d["n_voiced_frames"].values if "n_voiced_frames" in d else np.nan
    o["n_meter_windows"] = d["n_meter_windows"].values if "n_meter_windows" in d else np.nan
    return o


def load_palette_h():
    m = PAL
    o = pd.DataFrame({"src": "palette", "subset": "palette", "stim_id": m.key})
    for c in CUES:
        o[c] = m[c].values
    o["talker"] = "pal_" + m.spk
    o["unit"] = o.stim_id
    o["side"] = "masc"            # all 20 talkers are masculine-presenting (trans + cis men)
    o["cond"] = m.cond.values
    o["y_raw"] = m["man4"].values
    o["y_afc"] = m["afc"].values
    o["y_unsure"] = (m["ALL-OtherGender"] + m["ALL-no"]).values
    o["rating"] = np.nan
    o["task"] = "4opt"
    o["thin"] = False
    o["n_voiced_frames"] = m.voiced_prod.values * 100
    o["n_meter_windows"] = m.meter_nwin.values
    o["f0_shift_st"] = np.nan
    o["vtl_shift_st"] = np.nan
    return o


def load_all():
    parts = [load_palette_h()]

    # ---- Barreda bmmb (4AFC man/woman/boy/girl, /hid/, 15 listeners)
    d = pd.read_csv(os.path.join(FE, "barreda-bmmb", "stimuli.csv"))
    o = _base(d, "bmmb", "heed")
    o["talker"] = "bmmb_" + d.base_talker
    o["unit"] = o.stim_id
    o["side"] = d.talker_sex.map({"f": "fem", "m": "masc", "child-f": "child-f", "child-m": "child-m"}).values
    o["cond"] = d.cond.values                       # a = actual, b = big
    o["y_raw"] = d.p_man.values                     # adult man (18+) share
    o["y_afc"] = d.p_male.values                    # man OR boy (the 4 answers are all gendered)
    o["y_woman_adult"] = d.p_cat_w.values
    o["rating"] = np.nan
    o["task"] = "4afc-child"
    o["thin"] = (d.data_flag == "low").values
    o["f0_shift_st"] = 0.0
    o["vtl_shift_st"] = np.where(d.cond == "b", -12 * np.log2(0.92), 0.0)
    parts.append(o)

    # ---- PICKA rebuilt grid (2AFC, Jebens 2022 listeners)
    d = pd.read_csv(os.path.join(FE, "picka", "stimuli.csv"))
    sub = d.material.map({"ls_sentence": "ls", "predsent": "vnt-sent", "words": "vnt-word", "nonwords": "vnt-word"})
    o = _base(d, "picka", sub.values)
    o["talker"] = "picka_" + d.base_talker
    cellkey = d.f0_shift_st.astype(str) + "/" + d.vtl_shift_st.astype(str)
    # LibriSpeech: one listener number per cell (pooled Jebens talkers) -> unit = cell x talker for
    # talker-level prediction, aggregated to cell in the transfer table
    o["unit"] = np.where(sub == "ls", "pk_ls_" + cellkey,
                         "pk_" + sub + "_" + d.base_talker + "_" + cellkey + "_" + d.material)
    o["cell"] = cellkey.values
    o["side"] = np.select([d.f0_shift_st == 0, d.f0_shift_st == -12], ["fem", "masc"], "mid")
    o["cond"] = d.condition.values
    o["y_raw"] = d.p_man.values
    o["y_afc"] = d.p_man.values
    o["y_unsure"] = 0.0
    o["rating"] = np.nan
    o["task"] = "2afc"
    o["thin"] = d.thin.values.astype(bool)
    o["f0_shift_st"] = d.f0_shift_st.values
    o["vtl_shift_st"] = d.vtl_shift_st.values
    o["item"] = d["item"].values
    # F0-matched subset (README: base talkers >= 185 Hz at 0/0, production replica)
    f00 = d[(d.f0_shift_st == 0) & (d.vtl_shift_st == 0)].groupby("base_talker").lnf0.median()
    o["f0match"] = d.base_talker.map(np.exp(f00) >= 185).values
    parts.append(o)

    # ---- Skuk 2020 morphs (2AFC; level means over 4 pairs x 2 VCVs)
    d = pd.read_csv(os.path.join(FE, "skuk", "stimuli.csv"))
    o = _base(d, "skuk", "vcv")
    o["talker"] = "skuk_" + d.base_talker.str.slice(0, 3)
    o["unit"] = "sk_" + d.mtype.where(d.ml != 50, "ML50") + "_" + d.ml.astype(str)  # shared listener value
    o["side"] = np.where(d.ml >= 50, "fem", "masc")
    o["cond"] = (d.mtype + "-" + d.ml.astype(str)).values
    o["mtype"], o["ml"] = d.mtype.values, d.ml.values
    o["y_raw"] = d.p_man.values
    o["y_afc"] = d.p_man.values
    o["y_unsure"] = 0.0
    o["rating"] = np.nan
    o["task"] = "2afc"
    o["thin"] = False          # all are 0.65 s VCVs: outside the validated domain, flagged per source
    o["f0_shift_st"] = d.f0_shift_st.values
    o["vtl_shift_st"] = d.vtl_shift_st.values
    parts.append(o)

    # ---- Hillenbrand & Clark 2009 rebuilt (2AFC; condition-level rates)
    for fn, sub in [("stimuli.csv", "syl"), ("stimuli_concat.csv", "concat"), ("stimuli_sentproxy.csv", "sent")]:
        d = pd.read_csv(os.path.join(FE, "hillenbrand-clark-2009", fn))
        d = d[d.p_man.notna()].reset_index(drop=True)                                  # NAT rows carry no listener data
        o = _base(d, "hc", sub)
        o["talker"] = "hc_" + sub + "_" + d.base_talker
        o["unit"] = "hc_" + sub + "_" + d.hc_condition       # condition-level listener rate
        o["hc_condition"] = d.hc_condition.values
        o["side"] = np.where(d.talker_sex == "f", "fem", "masc")
        o["cond"] = d.hc_condition.values
        o["y_raw"] = d.p_man.values
        o["y_afc"] = d.p_man.values
        o["y_unsure"] = 0.0
        o["rating"] = np.nan
        o["task"] = "2afc"
        o["thin"] = d.low_material.values.astype(bool) | d.meter_logit.isna().values
        o["f0_shift_st"] = d.f0_shift_st.values
        o["vtl_shift_st"] = d.vtl_shift_st.values
        parts.append(o)

    # ---- Kong STraDa singing (Likert femininity; p_man = rather/definitely masculine)
    d = pd.read_csv(os.path.join(FE, "kong-strada", "stimuli.csv"), low_memory=False)
    d = d[d.audio_ok == True].reset_index(drop=True)
    o = _base(d, "kong", "singing")
    o["talker"] = "kong_" + d.base_talker
    o["unit"] = o.stim_id
    o["side"] = np.where(d.talker_sex == "f", "fem", "masc")
    o["cond"] = "singing"
    o["y_raw"] = d.p_man.values
    o["y_afc"] = _afc(d.p_man, d.p_woman)
    o["y_unsure"] = d.p_unsure.values
    o["rating"] = d.mean_rating.values
    o["task"] = "likert5"
    o["thin"] = (d.n_voiced_frames < 100).values | (d.n_meter_windows < 5).values | d[CUES].isna().any(axis=1).values
    o["f0_shift_st"] = np.nan
    o["vtl_shift_st"] = np.nan
    parts.append(o)

    # ---- natural/: LibriTTS-P (annotators' audio = LibriTTS-R), Neuenswander, RB695, Mooshammer
    d = pd.read_csv(os.path.join(FE, "natural", "stimuli.csv"))
    lt = d[d.source == "libritts-p_x_libritts-r"].reset_index(drop=True)
    o = _base(lt, "libritts-p", "ttsr")
    o["talker"] = "ltp_" + lt.base_talker
    o["unit"] = o.talker
    o["side"] = np.where(lt.talker_sex == "f", "fem", "masc")
    o["cond"] = "natural read"
    o["y_raw"] = lt.p_man.values
    o["y_afc"] = _afc(lt.p_man, lt.p_woman)
    o["y_unsure"] = lt.p_unsure.values
    o["rating"] = lt.mean_rating.values
    o["task"] = "annot3"
    o["thin"] = (lt.n_voiced_frames < 100).values
    parts.append(o)

    ne = d[d.source == "neuenswander2024"].reset_index(drop=True)
    o = _base(ne, "neuenswander", "ucla")
    o["talker"] = "neu_" + ne.base_talker
    o["unit"] = o.talker
    o["side"] = np.where(ne.talker_sex == "f", "fem", "masc")
    o["cond"] = ne.condition.values
    o["y_raw"] = np.nan
    o["y_afc"] = np.nan
    # femininity (women) and masculinity (men) on separate 1-9 scales: keep as is; sign handled per side
    o["rating"] = ne.mean_rating.values
    o["task"] = "rating"
    o["thin"] = (ne.n_voiced_frames < 100).values
    parts.append(o)

    rb = d[d.source == "munz_mohsenin_rb695"].reset_index(drop=True)
    o = _base(rb, "rb695", "tts")
    o["talker"] = "rb_" + rb.base_talker
    o["unit"] = "rb_" + rb.stim_id.str.extract(r"rb_(s\d)_")[0].values + "_" + rb.talker_sex.values
    o["side"] = np.where(rb.talker_sex.str.startswith("tts-m"), "masc", "fem")
    o["cond"] = rb.talker_sex.values
    o["y_raw"] = rb.p_man.values
    o["y_afc"] = _afc(rb.p_man, rb.p_woman)
    o["y_unsure"] = rb.p_unsure.values
    o["rating"] = rb.mean_rating.values
    o["task"] = "7pt"
    o["thin"] = False
    parts.append(o)

    mo = d[(d.source == "mooshammer_etzrodt2022") & ~d.stim_id.str.contains("greeting")].reset_index(drop=True)
    o = _base(mo, "mooshammer", "tts")
    o["talker"] = "moo"
    o["unit"] = "moo_" + mo.talker_sex.values
    o["side"] = np.where(mo.talker_sex == "tts-m", "masc", "fem")
    o["cond"] = mo.talker_sex.values
    o["y_raw"] = mo.p_man.values
    o["y_afc"] = _afc(mo.p_man, mo.p_woman)
    o["y_unsure"] = mo.p_unsure.values
    o["rating"] = mo.mean_rating.values
    o["task"] = "5pt"
    o["thin"] = False
    parts.append(o)

    H = pd.concat(parts, ignore_index=True)
    # two-way equivalent "% man": 2AFC share as is; where a third option exists, man + unsure/2
    H["y_half"] = np.where(H.task == "2afc", H.y_afc, H.y_raw + 0.5 * H.y_unsure)
    H.loc[H.src == "bmmb", "y_half"] = H.loc[H.src == "bmmb", "y_afc"]   # 4AFC, no unsure option: man-or-boy
    for c in CUES:
        H["u_" + c] = u(H, c)
    return H


def unit_agg(df, cols):
    """Average rows to the listener unit (one listener datum per unit)."""
    keep = ["src", "subset", "unit", "side", "talker", "cond"]
    agg = df.groupby("unit").agg({**{c: "first" for c in keep if c != "unit"}, **{c: "mean" for c in cols}})
    return agg.reset_index()
