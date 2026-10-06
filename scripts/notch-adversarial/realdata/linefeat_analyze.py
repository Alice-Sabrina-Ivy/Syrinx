# linefeat_analyze.py — voice-line vs machine-line separability from
# linefeat.py's per-window features (DISCRIMINATE phase, 2026-10-05).
#
#   python scripts/notch-adversarial/realdata/linefeat_analyze.py [--voice=voice_deg] [--noise=noise]
#          [--mix=1] [--out=report]
#
# Reads build/notchvd/linefeat/<voice>.csv (clean + white-noise-degraded
# voice, column deg) and <noise>.csv; with --mix=1 also mix_{held_series,
# voice_in_noise,noise_gated}.csv. Writes build/notchvd/linefeat/<out>.md and
# lines_scored_<out>.csv. Positive class = VOICE (score high = voice-like).
# Operating point: the threshold that keeps >= 99 % of typical real held-voice
# LINES on the voice side; "machine recall" = fraction of machine lines then
# called machine (i.e. still allowed to be notched).
import os, sys, json, math
import numpy as np, pandas as pd
from sklearn.metrics import roc_auc_score
from sklearn.linear_model import LogisticRegression
from sklearn.model_selection import GroupKFold
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from common import DATA, BUILD, args

A = args()
D = os.path.join(BUILD, "linefeat")
VFILE, NFILE, OUTN = A.get("voice", "voice_deg"), A.get("noise", "noise"), A.get("out", "report")
OUT = []
P = lambda s="": (OUT.append(s), print(s))

# `sessions` / `sessions_outside` exist only in a build that opted into the
# private session recordings (fetch_voice.py; local only): results computed
# with them never go into measurements/ (CLAUDE.md, "Private session data")
REAL = ["vocalset", "pvqd", "voiced", "vocadito", "sessions", "hillenbrand", "ptdb", "fda"]
# per-window features (linefeat.feats) + derived
FEATS = ["corr_mid", "coh_mid", "fm_mid", "fm2_mid", "mid_fast", "corr_fast", "coh_fast", "fm_fast", "fm_d1", "fm_std",
         "fm_slope_abs", "am_fast", "am_mid", "am_std", "hr_fast", "hr_mid", "h21", "snr"]
# features whose voice-vs-machine difference is (mostly) a recording-quality
# artefact: clean studio / clinic voice sits 20-30 dB above typical machine
# lines in prominence, and estimation noise inflates every "fast" / AM measure
CONFOUNDED = {"snr", "fm_fast", "fm_d1", "am_fast", "am_std", "hr_fast", "fm_std", "corr_fast", "fm2_fast"}
POS_FEATS = {"fm_mid", "fm2_mid", "fm_fast", "fm_d1", "fm_std", "fm_slope_abs", "am_fast", "am_mid", "am_std", "hr_fast", "hr_mid", "mid_fast"}

GROUPS = {
    "mains/electrical": ["mains_hum", "transformer", "light_ballast", "electronics_whine", "projector", "server_room"],
    "fans/HVAC": ["electric_fan", "computer_fan", "exhaust_fan", "fan", "fan_anomaly", "hvac", "AirConditioner", "hair_dryer"],
    "motors/pumps/appliances": ["refrigerator", "pump", "pump_anomaly", "appliance_motor", "electric_motor", "washing_machine", "WasherDryer",
                                "dishwasher", "microwave", "dryer", "vacuum", "VacuumCleaner", "vacuum_cleaner", "CopyMachine", "generator",
                                "slider", "slider_anomaly", "valve", "valve_anomaly", "ToyCar", "ToyCar_anomaly", "ToyConveyor", "ToyConveyor_anomaly"],
    "vehicles/engines/saws": ["engine", "engine_idle", "airplane", "train", "helicopter", "TBUS", "TCAR", "TMETRO", "STRAFFIC", "chainsaw", "hand_saw"],
    "alarms/horns/bells/insects": ["siren", "car_horn", "church_bells", "clock_alarm", "clock_tick", "insects", "crickets"],
    "DEMAND rooms/outdoor": ["DKITCHEN", "DLIVING", "DWASHING", "NFIELD", "NRIVER", "OOFFICE"],
}
CLS2G = {c: g for g, cs in GROUPS.items() for c in cs}
VI = {r["id"]: r for r in json.load(open(os.path.join(DATA, "index_voice.json")))}
NI = {r["id"]: r for r in json.load(open(os.path.join(DATA, "index_noise.json")))}


def derive(df):
    df["fm_slope_abs"] = df["fm_slope"].abs()
    df["mid_fast"] = df["fm_mid"] / df["fm_fast"].clip(lower=1e-3)
    # sufficient statistics for POOLED cross-harmonic coherence (mid band)
    df["s12"] = np.sign(df["coh_mid"]) * df["coh_mid"] ** 2
    df["s11"] = df["fm_mid"] ** 2
    df["s22"] = df["fm2_mid"] ** 2
    return df


def mgroup_of(i, cls):
    rec = NI.get(i, {})
    if rec.get("source") == "sessions_outside":
        return "reference tone (12-TET)" if "equal_tempered" in (rec.get("flags") or []) else "sessions outside (other)"
    return CLS2G.get(cls, "other")


def mains(f):
    return any(abs(f - k * b) <= 0.5 for b in (50, 60) for k in range(1, 9))


def load():
    v = derive(pd.read_csv(os.path.join(D, f"{VFILE}.csv")))
    if "deg" not in v: v["deg"] = np.inf
    n = derive(pd.read_csv(os.path.join(D, f"{NFILE}.csv")))

    def typical(i):
        r = VI[i]
        if r["source"] == "pvqd": return (r.get("capev_severity") is not None) and r["capev_severity"] < 20
        if r["source"] == "voiced": return r.get("diagnosis") == "healthy"
        return True
    v["typical"] = v["id"].map(typical)
    # clips listed in data/exclude_voice_ids.txt (local, gitignored; shared
    # with linecls.mjs) are not voice material, e.g. a tone mis-attributed to a
    # voice run
    xp = os.path.join(DATA, "exclude_voice_ids.txt")
    excl = set(open(xp, encoding="utf-8").read().split()) if os.path.exists(xp) else set()
    v = v[~v["id"].isin(excl)].copy()
    v["grp"] = v["id"].map(lambda i: f"vocalset:{VI[i].get('singer')}" if VI[i]["source"] == "vocalset" else i)
    n["mgroup"] = [mgroup_of(i, c) for i, c in zip(n["id"], n["cls"])]
    n["grp"] = n["id"]
    n["mains_locked"] = n["line_f"].map(mains)
    n["drifting"] = n["line_frange"] > 4.0
    return v, n


def line_level(df, maxwin=None, extra_keys=()):
    """One row per line (and condition): median of each window feature, plus
    POOLED coherence over the windows (pcorr_mid = sum s12 / sqrt(sum s11 sum s22),
    pcoh_mid = signed sqrt(mean s12)). Machine: first `maxwin` windows."""
    if maxwin: df = df[df["win"] < maxwin]
    keys = ["id", "line"] + [k for k in ("deg",) + tuple(extra_keys) if k in df.columns]
    g = df.groupby(keys, sort=False)
    agg = g.agg(**{f: (f, "median") for f in FEATS}, nwin=("win", "size"), S12=("s12", "sum"), S11=("s11", "sum"), S22=("s22", "sum"))
    agg["pcorr_mid"] = agg["S12"] / np.sqrt(agg["S11"] * agg["S22"]).clip(lower=1e-12)
    agg["pcoh_mid"] = np.sign(agg["S12"]) * np.sqrt(np.abs(agg["S12"]) / agg["nwin"])
    agg["noise2"] = np.sqrt(agg["S22"] / agg["nwin"])   # partner-2f mid-band rms (= fm2_mid pooled)
    # extra coherence partners (linefeat --partners): pooled corr per partner;
    # 'any' = the partner (incl. 2f) with the highest pooled corr, its noise =
    # that partner's mid-band rms; 'loud' = the a-priori loudest partner
    tags = sorted({c[3:] for c in df.columns if c.startswith("s1_")})
    if tags:
        cand_c, cand_h, cand_n, cand_l = [agg["pcorr_mid"].values], [agg["pcoh_mid"].values], [agg["noise2"].values], [g["h21"].median().values]
        for t in tags:
            s1 = g[f"s1_{t}"].sum(); ss = g[f"ss_{t}"].sum(); lv = g[f"lv_{t}"].median()
            pc = (s1 / np.sqrt(agg["S11"] * ss).clip(lower=1e-12)).values
            ok = np.isfinite(pc) & (g[f"s1_{t}"].count().values == agg["nwin"].values)
            cand_c.append(np.where(ok, pc, -np.inf)); cand_h.append(np.where(ok, (np.sign(s1) * np.sqrt(np.abs(s1) / agg["nwin"])).values, -np.inf))
            cand_n.append(np.where(ok, np.sqrt(ss / agg["nwin"]).values, np.inf)); cand_l.append(np.where(ok, lv.values, -np.inf))
            agg[f"pcorr_{t}"] = np.where(ok, pc, np.nan)
        C, H, N, Lv = map(np.stack, (cand_c, cand_h, cand_n, cand_l))
        ia = np.argmax(C, 0); il = np.argmax(Lv, 0); r = np.arange(C.shape[1])
        agg["pcorr_any"], agg["pcoh_any"], agg["noise_any"] = C[ia, r], H[ia, r], N[ia, r]
        agg["pcorr_loud"], agg["pcoh_loud"], agg["noise_loud"] = C[il, r], H[il, r], N[il, r]
    meta_cols = [c for c in ["source", "kind", "role", "cls", "label", "mgroup", "mains_locked", "drifting", "typical", "grp", "line_f",
                             "line_span", "line_duty", "line_frange", "k", "set", "noise_id", "noise_label", "snr_db", "voice_kind",
                             "gap_s", "period_s", "off_s"] if c in df.columns and c not in keys]
    meta = df.drop_duplicates(keys).set_index(keys)[meta_cols]
    return agg.join(meta).reset_index()


LFEATS = ["pcorr_mid", "pcoh_mid"] + FEATS
PFEATS = ["pcorr_any", "pcoh_any", "pcorr_loud", "pcoh_loud"]


def auc(vs, ms):
    vs = vs[np.isfinite(vs)]; ms = ms[np.isfinite(ms)]
    if len(vs) < 2 or len(ms) < 2: return float("nan")
    return roc_auc_score(np.r_[np.ones(len(vs)), np.zeros(len(ms))], np.r_[vs, ms])


def thr_keep(vs, keep=0.99):
    vs = vs[np.isfinite(vs)]
    return float(np.quantile(vs, 1 - keep))


def feature_table(V, M, title, feats, keep=0.99):
    P(f"\n### {title}\n")
    P(f"voice n = {len(V)}, machine n = {len(M)}. AUC in the voice-like direction; threshold keeps {keep:.0%} of these voice rows; "
      f"recall = machine rows then called machine. `*` = recording-quality-confounded (see text).\n")
    P("| feature | voice-like | AUC | thr | machine recall |")
    P("|---|---|---|---|---|")
    res = []
    for f in feats:
        a = auc(V[f].values, M[f].values)
        if not np.isfinite(a): continue
        sgn = 1 if a >= 0.5 else -1
        t = thr_keep(sgn * V[f].values, keep)
        rec = float(np.mean(sgn * M[f].values[np.isfinite(M[f].values)] < t))
        res.append((f, ">" if sgn > 0 else "<", max(a, 1 - a), sgn * t, rec))
    res.sort(key=lambda r: -r[2])
    for f, d, a, t, r in res:
        P(f"| {f}{' *' if f in CONFOUNDED else ''} | {d} | {a:.3f} | {t:.3g} | {r:.1%} |")
    return res


def xform(df, feats):
    cols = []
    for f in feats:
        x = df[f].values.astype(float)
        cols.append(np.log(np.maximum(x, 1e-3)) if f in POS_FEATS else x)
    return np.nan_to_num(np.stack(cols, 1), nan=0.0, posinf=0.0, neginf=0.0)


def combo(V, M, feats, folds=5, keep=0.99):
    """Grouped-CV logistic regression (groups: singer / clip); out-of-fold scores."""
    df = pd.concat([V.assign(y=1), M.assign(y=0)], ignore_index=True)
    X = xform(df, feats); y = df["y"].values; g = df["grp"].values
    oof = np.zeros(len(df))
    for tr, te in GroupKFold(folds).split(X, y, g):
        mu, sd = X[tr].mean(0), X[tr].std(0) + 1e-9
        m = LogisticRegression(C=1.0, class_weight="balanced", max_iter=3000).fit((X[tr] - mu) / sd, y[tr])
        oof[te] = m.decision_function((X[te] - mu) / sd)
    df["score"] = oof
    return df


def class_table(dm, called, col):
    P(f"| {col} | lines | clips | called machine |"); P("|---|---|---|---|")
    for gname, sub in sorted(dm.groupby(col), key=lambda kv: -len(kv[1])):
        P(f"| {gname} | {len(sub)} | {sub['id'].nunique()} | {np.mean(called[sub.index.values]):.1%} |")
    P()


def main():
    v, n = load()
    real = v[v["source"].isin(REAL)]
    syn = v[v["source"] == "synthetic"]
    mach = n[n["mgroup"] != "sessions outside (other)"]
    nx = int((n["mgroup"] == "sessions outside (other)").sum())
    clean = real[np.isinf(real["deg"])]
    rt = clean[clean["typical"]]
    P(f"# Voice line vs machine line — micro-variation features ({VFILE} / {NFILE})\n")
    P(f"Windows (1 s): real voice {len(clean)} ({clean['id'].nunique()} clips; typical {len(rt)}), synthetic {int(np.isinf(syn['deg']).sum())}, "
      f"machine {len(mach)} ({mach['id'].nunique()} clips)" + (f"; excluded 'sessions outside (other)' {nx}" if nx else "") + ".")
    P("Typical voice windows by source: " + ", ".join(f"{k} {c}" for k, c in rt["source"].value_counts().items()))
    P("Machine windows by group: " + ", ".join(f"{k} {c}" for k, c in mach["mgroup"].value_counts().items()))

    VL = line_level(rt); ML = line_level(mach, maxwin=5)
    P("Typical voice lines by harmonic k: " + ", ".join(f"k={k}: {c}" for k, c in VL["k"].value_counts().sort_index().items()))
    q = lambda s: "/".join(f"{x:.0f}" for x in np.nanpercentile(s, [10, 50, 90]))
    P(f"\nLine prominence (dB over the band median, p10/p50/p90): typical voice {q(VL['snr'])}, machine {q(ML['snr'])}, "
      f"promotable machine {q(ML.loc[(ML.line_span>=5)&(ML.line_duty>=0.9),'snr'])}")

    # ---- A. clean, window + line level --------------------------------------
    feature_table(rt, mach, "A1. Window level (1 s): typical clean voice vs machine", FEATS)
    feature_table(VL, ML, "A2. Line level: typical clean voice lines (all hold windows) vs machine lines (first <= 5 windows)",
                  LFEATS + [f for f in PFEATS if f in VL.columns])
    MLp = ML[(ML["line_span"] >= 5) & (ML["line_duty"] >= 0.9)].copy()
    feature_table(VL, MLp, "A3. Line level, PROMOTABLE machine lines only (span >= 5 s, duty >= 0.9)", LFEATS)
    P("\n### A4. Machine noise floor vs line prominence (window level; p10/p50/p90)\n")
    P("| prominence dB | machine windows | fm_mid c | coh_mid c | corr_mid | voice windows | voice fm_mid | voice corr_mid |")
    P("|---|---|---|---|---|---|---|---|")
    for lo, hi in [(0, 15), (15, 20), (20, 25), (25, 30), (30, 40), (40, 50), (50, 99)]:
        a_ = mach[(mach.snr >= lo) & (mach.snr < hi)]; b_ = rt[(rt.snr >= lo) & (rt.snr < hi)]
        f3 = lambda s: "/".join(f"{x:.2g}" for x in np.nanpercentile(s, [10, 50, 90])) if len(s) else "-"
        P(f"| {lo}-{hi} | {len(a_)} | {f3(a_.fm_mid)} | {f3(a_.coh_mid)} | {f3(a_.corr_mid)} | {len(b_)} | {f3(b_.fm_mid)} | {f3(b_.corr_mid)} |")

    # ---- B. voice under added noise --------------------------------------------
    degs = sorted(d for d in real["deg"].unique() if np.isfinite(d))
    if degs:
        P("\n### B. Typical voice lines with white noise added (SNR vs the held-segment RMS) — matched-prominence check\n")
        P("Thresholds from A2 (clean voice, 99 % kept). Voice kept = fraction of voice lines still on the voice side.\n")
        P("| condition | voice lines | prominence p10/p50/p90 | pcorr_mid kept | corr_mid kept | pcoh_mid kept | AUC pcorr vs machine | AUC pcoh |")
        P("|---|---|---|---|---|---|---|---|")
        t_pc = thr_keep(VL["pcorr_mid"].values); t_c = thr_keep(VL["corr_mid"].values); t_h = thr_keep(VL["pcoh_mid"].values)
        for d in [np.inf] + list(reversed(degs)):
            sub = line_level(real[(real["deg"] == d) & real["typical"]])
            P(f"| {'clean' if np.isinf(d) else f'{d:+.0f} dB'} | {len(sub)} | {q(sub['snr'])} | {np.mean(sub['pcorr_mid'] >= t_pc):.1%} | "
              f"{np.mean(sub['corr_mid'] >= t_c):.1%} | {np.mean(sub['pcoh_mid'] >= t_h):.1%} | {auc(sub['pcorr_mid'].values, ML['pcorr_mid'].values):.3f} | "
              f"{auc(sub['pcoh_mid'].values, ML['pcoh_mid'].values):.3f} |")
        # robust operating point: keep 99 % of voice lines pooled over clean + all degradations
        VLall = line_level(real[real["typical"]])
        P("\n#### B2. Operating point keeping 99 % of typical voice lines over clean + every degradation (pooled)\n")
        P("| feature | thr | voice kept clean / " + " / ".join(f"{d:+.0f}" for d in reversed(degs)) + " | machine recall | promotable machine recall |")
        P("|---|---|---|---|---|")
        for f in ["pcorr_mid", "corr_mid", "pcoh_mid", "coh_mid", "mid_fast"]:
            t = thr_keep(VLall[f].values)
            kept = [np.mean(VLall.loc[VLall.deg == d, f] >= t) for d in [np.inf] + list(reversed(degs))]
            P(f"| {f} | {t:.3g} | {' / '.join(f'{x:.1%}' for x in kept)} | {np.mean(ML[f] < t):.1%} | {np.mean(MLp[f] < t):.1%} |")

    # ---- C. combinations (non-confounded features; voice incl. degraded) -----
    P("\n### C. Small combinations — grouped 5-fold CV logistic regression on line-level features, out-of-fold scores\n")
    P("Voice training/eval set = typical voice lines, clean + white-noise-degraded (so the model cannot learn 'clean = voice'); "
      "operating point keeps 99 % of those voice lines. Confounded features excluded except in the last row (shown for reference).\n")
    P("| features | AUC | machine recall | promotable recall | voice kept clean / degraded |")
    P("|---|---|---|---|---|")
    VLall = line_level(real[real["typical"]])
    combos = [["pcorr_mid"], ["pcorr_mid", "pcoh_mid"], ["pcorr_mid", "fm_mid", "fm2_mid"], ["pcorr_mid", "pcoh_mid", "mid_fast"],
              ["pcorr_mid", "pcoh_mid", "fm_mid", "fm2_mid", "mid_fast"],
              ["pcorr_mid", "pcoh_mid", "fm_mid", "fm2_mid", "mid_fast", "am_mid", "hr_mid", "h21", "fm_slope_abs"],
              ["pcorr_mid", "pcoh_mid", "fm_mid", "fm2_mid", "mid_fast", "am_mid", "hr_mid", "h21", "fm_slope_abs", "snr", "am_fast", "fm_fast", "corr_fast", "hr_fast"]]
    best = None
    for c in combos:
        df = combo(VLall, ML, c)
        y = df["y"].values; s = df["score"].values
        thr = np.quantile(s[y == 1], 0.01)
        dm = df[df.y == 0]; dv = df[df.y == 1]
        prom = (dm.line_span >= 5) & (dm.line_duty >= 0.9)
        kc = np.mean(dv.loc[np.isinf(dv.deg), "score"] >= thr); kd = np.mean(dv.loc[~np.isinf(dv.deg), "score"] >= thr)
        conf = any(f in CONFOUNDED for f in c)
        P(f"| {'+'.join(c)}{' (confounded)' if conf else ''} | {roc_auc_score(y, s):.3f} | {np.mean(dm.score < thr):.1%} | {np.mean(dm.loc[prom, 'score'] < thr):.1%} | {kc:.1%} / {kd:.1%} |")
        if not conf and (best is None or np.mean(dm.score < thr) > best[1]): best = (c, np.mean(dm.score < thr), thr, df)

    # ---- D. per class for the best single feature and the best combination ----
    t = thr_keep(VLall["pcorr_mid"].values)
    for name, called_fn, dm in [("pcorr_mid alone (threshold keeps 99 % of clean+degraded typical voice lines)", None, ML.reset_index(drop=True)),
                                (f"best non-confounded combination ({'+'.join(best[0])})", None, best[3][best[3].y == 0].reset_index(drop=True))]:
        called = (dm["pcorr_mid"] < t).values if "score" not in dm else (dm["score"] < best[2]).values
        P(f"\n### D. Machine recall by class — {name}\n")
        class_table(dm, called, "mgroup"); class_table(dm, called, "label")
        for nm, mask in [("mains-locked lines (k x 50/60 Hz +-0.5 Hz)", dm["mains_locked"].values.astype(bool)),
                         ("drifting lines (p5-p95 > 4 Hz)", dm["drifting"].values.astype(bool)),
                         ("promotable lines (span >= 5 s, duty >= 0.9)", ((dm.line_span >= 5) & (dm.line_duty >= 0.9)).values)]:
            P(f"- {nm}: {int(mask.sum())} lines, {np.mean(called[mask]):.1%} called machine")
    best[3].to_csv(os.path.join(D, f"lines_scored_{OUTN}.csv"), index=False)

    # ---- E. supplements ---------------------------------------------------------
    for name, sub in [("synthetic held notes (suite synth.mjs, clean)", syn[np.isinf(syn.deg)]),
                      ("clinical / atypical real voice (PVQD severity >= 20, VOICED pathological), clean", clean[~clean["typical"]])]:
        if not len(sub): continue
        SL = line_level(sub)
        P(f"\n### E. {name}: lines on the voice side of the B2 thresholds\n")
        P("| feature | thr | lines kept as voice |"); P("|---|---|---|")
        for f in ["pcorr_mid", "corr_mid", "pcoh_mid"]:
            P(f"| {f} | {thr_keep(VLall[f].values):.3g} | {np.mean(SL[f] >= thr_keep(VLall[f].values)):.1%} (n={len(SL)}) |")
        if "cls" in SL and name.startswith("synthetic"):
            P("\nsynthetic by scenario family (pcorr_mid kept): " + ", ".join(
                f"{c} {np.mean(s_['pcorr_mid'] >= t):.0%} (n={len(s_)})" for c, s_ in SL.groupby("cls")))

    # ---- F. end-to-end mixes -------------------------------------------------------
    if A.get("mix"):
        mix_section(t, VLall)
    open(os.path.join(D, f"{OUTN}.md"), "w", encoding="utf-8").write("\n".join(OUT) + "\n")


def mix_section(t, VLall):
    P("\n### F. Mixes (real voice in real noise, real repeated holds, real gated sources) — pcorr_mid at the B2 threshold "
      f"({t:.3g})\n")
    p = os.path.join(D, "mix_held_series.csv")
    if os.path.exists(p):
        h = derive(pd.read_csv(p)); h = h[h.role == "voice"]
        L = line_level(h)
        P(f"**held_series** (VocalSet same-pitch hold series, gaps 0.15-1 s): {len(L)} voice lines in {L['id'].nunique()} streams; "
          f"median windows/line {L['nwin'].median():.0f}. Called machine: {np.mean(L['pcorr_mid'] < t):.1%} "
          f"(lines with >= 5 windows: {np.mean(L.loc[L.nwin >= 5, 'pcorr_mid'] < t):.1%}, n={int((L.nwin >= 5).sum())}).")
        P("by gap: " + ", ".join(f"{g} s {np.mean(s_['pcorr_mid'] < t):.1%} (n={len(s_)})" for g, s_ in L.groupby("gap_s")))
    p = os.path.join(D, "mix_voice_in_noise.csv")
    if os.path.exists(p):
        m = derive(pd.read_csv(p))
        P("\n**voice_in_noise** (real noise lead 20 s, then a real voice program; SNR = voice active RMS / noise RMS):\n")
        P("| SNR | role / phase | lines | prominence p50 | called machine (pcorr_mid < thr) |"); P("|---|---|---|---|---|")
        for snr, ms in m.groupby("snr_db"):
            V = line_level(ms[ms.role == "voice"])
            P(f"| {snr:+d} | voice lines (held program harmonics) | {len(V)} | {V['snr'].median():.0f} | {np.mean(V['pcorr_mid'] < t):.1%} |")
            for vk, vs in V.groupby("voice_kind"):
                P(f"| {snr:+d} | - voice program {vk} | {len(vs)} | {vs['snr'].median():.0f} | {np.mean(vs['pcorr_mid'] < t):.1%} |")
            mm = ms[ms.role == "machine"]
            for ph in ["lead", "voice"]:
                Lm = line_level(mm[mm.phase == ph], extra_keys=("phase",))
                if len(Lm): P(f"| {snr:+d} | machine lines, {ph} windows | {len(Lm)} | {Lm['snr'].median():.0f} | {np.mean(Lm['pcorr_mid'] < t):.1%} |")
    p = os.path.join(D, "mix_noise_gated.csv")
    if os.path.exists(p):
        g = derive(pd.read_csv(p))
        P("\n**noise_gated** (84 real stationary-tonal sources switched off 0.15-1 s every 5 / 8 s — the R8 adversary):\n")
        P("| off / period | lines | called machine (all windows) | called machine (on-windows only) |"); P("|---|---|---|---|")
        for (off, per), s_ in g.groupby(["off_s", "period_s"]):
            La = line_level(s_); Lo = line_level(s_[~s_.gated.astype(bool)])
            P(f"| {off} s / {per} s | {len(La)} | {np.mean(La['pcorr_mid'] < t):.1%} | {np.mean(Lo['pcorr_mid'] < t):.1%} |")


if __name__ == "__main__":
    main()
