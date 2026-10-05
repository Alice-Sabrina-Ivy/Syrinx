# linefeat_rules.py — explicit, notch-implementable 2-D "confidently machine"
# rules from linefeat.py features (DISCRIMINATE phase, 2026-10-05).
#
#   python scripts/notch-adversarial/realdata/linefeat_rules.py [--voice=voice_deg] [--noise=noise] [--out=rules]
#
# Model: per window, the mid-band (0.5-8 Hz) frequency residual of the line
# and of its own 2nd harmonic are m1 = s + n1, m2 = s + n2 (cents): s the
# SHARED frequency modulation (a voice's F0 wander / vibrato / tremor moves
# every harmonic together), n1/n2 independent estimation noise. A machine
# line has s ~ 0 (or no harmonic at 2f at all). A line is called MACHINE
# only when (1) its shared modulation is small (pooled pcorr_mid < A or
# pcoh_mid < A cents) AND (2) its own estimation noise is low enough that a
# voice WOULD have shown its modulation (noise proxy < B: fm_fast — the > 8 Hz
# residual, which for a voice line is mostly noise — or fm2_mid). Lines that
# fail (2) are "undecided" -> the notch falls back to its timing rules.
# Thresholds are chosen to keep >= 99 % of typical voice lines over clean +
# every white-noise degradation (pooled), in-sample and with grouped 5-fold
# CV (thresholds picked on 4/5 of singers / clips, scored on the held-out 1/5).
import os, sys
import numpy as np, pandas as pd
from sklearn.model_selection import GroupKFold
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
sys.argv = [a for a in sys.argv]
import linefeat_analyze as LA

A = LA.A
OUTN = A.get("out", "rules")
LINES = []
P = lambda s="": (LINES.append(s), print(s))

RULES = [("pcorr_mid", "fm_fast"), ("pcoh_mid", "fm_fast"), ("pcorr_mid", "noise2"), ("pcoh_mid", "noise2"),
         ("pcorr_mid", "none"), ("pcoh_mid", "none"),
         ("pcorr_any", "noise_any"), ("pcoh_any", "noise_any"), ("pcorr_loud", "noise_loud"), ("pcoh_loud", "noise_loud")]
# 3-threshold family: machine iff (corr < A OR |shared FM| < C cents) AND noise < B
RULES3 = [("pcorr_mid", "pcoh_mid", "noise2"), ("pcorr_any", "pcoh_any", "noise_any"), ("pcorr_loud", "pcoh_loud", "noise_loud")]


def grid3(V, M, a_f, c_f, b_f, keep=0.99, voice_conditions=None):
    """3-threshold version (A on corr, C on shared-FM cents, B on noise)."""
    av, cv_, bv = V[a_f].values, V[c_f].values, V[b_f].values
    am, cm_, bm = M[a_f].values, M[c_f].values, M[b_f].values
    A_c = np.unique(np.quantile(am[np.isfinite(am)], np.linspace(0.02, 0.98, 25)))
    C_c = np.unique(np.r_[-np.inf, np.linspace(0.25, 3.0, 12)])
    B_c = np.unique(np.quantile(np.r_[bv, bm][np.isfinite(np.r_[bv, bm])], np.linspace(0.04, 1.0, 25)))
    best = (0.0, None, None, None)
    for a in A_c:
        for c in C_c:
            sv = (av < a) | (cv_ < c); sm = (am < a) | (cm_ < c)
            for b in B_c:
                x = sv & (bv < b)
                if np.mean(x) > 1 - keep: continue
                if voice_conditions is not None and any(np.mean(x[voice_conditions == q]) > 1 - keep + 0.01 for q in np.unique(voice_conditions)): continue
                rec = float(np.mean(sm & (bm < b)))
                if rec > best[0]: best = (rec, a, c, b)
    return best


def apply3(D, a_f, c_f, b_f, a, c, b):
    return ((D[a_f].values < a) | (D[c_f].values < c)) & (D[b_f].values < b)


def grid(V, M, a_f, b_f, keep=0.99, voice_conditions=None):
    """Best (A, B) maximising machine recall with voice kept >= keep (pooled
    and, if voice_conditions given, within every condition >= keep - 0.01)."""
    av = V[a_f].values; am = M[a_f].values
    bv = V[b_f].values if b_f != "none" else np.zeros(len(V)); bm = M[b_f].values if b_f != "none" else np.zeros(len(M))
    A_c = np.unique(np.quantile(am[np.isfinite(am)], np.linspace(0.02, 0.98, 49)))
    B_c = [np.inf] if b_f == "none" else np.unique(np.quantile(np.r_[bv, bm][np.isfinite(np.r_[bv, bm])], np.linspace(0.02, 1.0, 50)))
    best = (0.0, None, None)
    for a in A_c:
        for b in B_c:
            cv = (av < a) & (bv < b)        # voice called machine
            if np.mean(cv) > 1 - keep: continue
            if voice_conditions is not None and any(np.mean(cv[voice_conditions == c]) > 1 - keep + 0.01 for c in np.unique(voice_conditions)): continue
            rec = float(np.mean((am < a) & (bm < b)))
            if rec > best[0]: best = (rec, a, b)
    return best


def apply(D, a_f, b_f, a, b):
    bb = D[b_f].values if b_f != "none" else np.zeros(len(D))
    return (D[a_f].values < a) & (bb < b)


def main():
    v, n = LA.load()
    real = v[v["source"].isin(LA.REAL) & v["typical"]]
    mach = n[n["mgroup"] != "sessions outside (other)"]
    VL = LA.line_level(real); ML = LA.line_level(mach, maxwin=5)
    MINWIN = int(A.get("minwin", 1))   # evidence floor: lines with fewer 1 s windows stay undecided
    nv0, nm0 = len(VL), len(ML)
    VL = VL[VL.nwin >= MINWIN].reset_index(drop=True); ML = ML[ML.nwin >= MINWIN].reset_index(drop=True)
    P(f"evidence floor: >= {MINWIN} window(s) per line (dropped {nv0 - len(VL)} voice / {nm0 - len(ML)} machine lines)\n")
    cond = np.where(np.isinf(VL["deg"].values), 99.0, VL["deg"].values)
    prom = ((ML.line_span >= 5) & (ML.line_duty >= 0.9)).values
    P(f"# Explicit 'confidently machine' rules ({LA.VFILE} / {LA.NFILE})\n")
    P(f"voice lines (typical, clean + degradations) {len(VL)}; machine lines {len(ML)} (promotable {int(prom.sum())})\n")
    P("| rule: machine iff A-feature < A AND noise < B | A | B | in-sample machine recall | promotable | voice called machine clean / +20 / +10 / +0 | CV machine recall | CV voice called machine |")
    P("|---|---|---|---|---|---|---|---|")
    results = {}
    for a_f, b_f in RULES:
        if a_f not in VL.columns: continue
        rec, a, b = grid(VL, ML, a_f, b_f, voice_conditions=cond)
        if a is None:
            P(f"| {a_f} / {b_f} | - | - | 0 | - | - | - | - |"); continue
        cvv = apply(VL, a_f, b_f, a, b); cm = apply(ML, a_f, b_f, a, b)
        per = " / ".join(f"{np.mean(cvv[cond == c]):.1%}" for c in [99.0, 20.0, 10.0, 0.0] if (cond == c).any())
        # grouped CV: pick thresholds on train groups, score held-out
        gv = VL["grp"].values; gm = ML["grp"].values
        allg = np.unique(np.r_[gv, gm]); rng = np.random.default_rng(7); fold_of = dict(zip(allg, rng.integers(0, 5, len(allg))))
        fv = np.array([fold_of[g] for g in gv]); fm = np.array([fold_of[g] for g in gm])
        hv, hm = np.zeros(len(VL), bool), np.zeros(len(ML), bool)
        for k in range(5):
            _, a_k, b_k = grid(VL[fv != k], ML[fm != k], a_f, b_f, voice_conditions=cond[fv != k])
            if a_k is None: continue
            hv[fv == k] = apply(VL[fv == k], a_f, b_f, a_k, b_k); hm[fm == k] = apply(ML[fm == k], a_f, b_f, a_k, b_k)
        P(f"| {a_f} / {b_f} | {a:.3g} | {b:.3g} | {np.mean(cm):.1%} | {np.mean(cm[prom]):.1%} | {per} | {np.mean(hm):.1%} | {np.mean(hv):.2%} |")
        results[(a_f, b_f)] = (a, b, cm, None)
    for a_f, c_f, b_f in RULES3:
        if a_f not in VL.columns: continue
        rec, a, c, b = grid3(VL, ML, a_f, c_f, b_f, voice_conditions=cond)
        if a is None: continue
        cvv = apply3(VL, a_f, c_f, b_f, a, c, b); cm = apply3(ML, a_f, c_f, b_f, a, c, b)
        per = " / ".join(f"{np.mean(cvv[cond == q]):.1%}" for q in [99.0, 20.0, 10.0, 0.0] if (cond == q).any())
        gv = VL["grp"].values; gm = ML["grp"].values
        allg = np.unique(np.r_[gv, gm]); rng = np.random.default_rng(7); fold_of = dict(zip(allg, rng.integers(0, 5, len(allg))))
        fv = np.array([fold_of[g] for g in gv]); fm = np.array([fold_of[g] for g in gm])
        hv, hm = np.zeros(len(VL), bool), np.zeros(len(ML), bool)
        for k in range(5):
            _, a_k, c_k, b_k = grid3(VL[fv != k], ML[fm != k], a_f, c_f, b_f, voice_conditions=cond[fv != k])
            if a_k is None: continue
            hv[fv == k] = apply3(VL[fv == k], a_f, c_f, b_f, a_k, c_k, b_k); hm[fm == k] = apply3(ML[fm == k], a_f, c_f, b_f, a_k, c_k, b_k)
        P(f"| ({a_f} < A OR {c_f} < {c:.2g} c) / {b_f} | {a:.3g} | {b:.3g} | {np.mean(cm):.1%} | {np.mean(cm[prom]):.1%} | {per} | {np.mean(hm):.1%} | {np.mean(hv):.2%} |")
        results[(a_f, c_f, b_f)] = (a, b, cm, c)
    # per-class table for the best in-sample rule
    key = tuple(A["force"].split(",")) if "force" in A else max(results, key=lambda k: np.mean(results[k][2]))
    if "fixed" in A:   # --force=a_f,c_f,noise_f --fixed=A,C,B: fixed thresholds (no grid)
        fa, fc, fb = (float(x) for x in A["fixed"].split(","))
        cmf = apply3(ML, key[0], key[1], key[2], fa, fc, fb); cvf = apply3(VL, key[0], key[1], key[2], fa, fc, fb)
        per = " / ".join(f"{np.mean(cvf[cond == q]):.1%}" for q in [99.0, 20.0, 10.0, 0.0] if (cond == q).any())
        P(f"| FIXED ({key[0]} < {fa:g} OR {key[1]} < {fc:g} c) / {key[2]} < {fb:g} | {fa:g} | {fb:g} | {np.mean(cmf):.1%} | {np.mean(cmf[prom]):.1%} | {per} "
          f"({int(cvf.sum())} of {len(cvf)}) | - | - |")
        results[key] = (fa, fb, cmf, fc)
    a, b, cm, c = results[key]
    nf = key[-1]
    desc = f"({key[0]} < {a:.3g} OR {key[1]} < {c:.2g} c) AND {nf} < {b:.3g}" if c is not None else f"{key[0]} < {a:.3g} AND {nf} < {b:.3g}"
    P(f"\n## Machine lines called machine by class — {desc}\n")
    dm = ML.reset_index(drop=True)
    LA.OUT.clear()
    LA.class_table(dm, cm, "mgroup"); LA.class_table(dm, cm, "label")
    for s in LA.OUT: LINES.append(s)
    for nm, mask in [("mains-locked lines (k x 50/60 Hz +-0.5 Hz)", dm["mains_locked"].values.astype(bool)),
                     ("drifting lines (p5-p95 > 4 Hz)", dm["drifting"].values.astype(bool)),
                     ("promotable lines (span >= 5 s, duty >= 0.9)", prom),
                     ("promotable stationary-tonal", prom & (dm["label"] == "stationary-tonal").values),
                     ("promotable intermittent-tonal", prom & (dm["label"] == "intermittent-tonal").values)]:
        P(f"- {nm}: {int(mask.sum())} lines, {np.mean(cm[mask]) if mask.any() else float('nan'):.1%} called machine")
    # why machine lines stay undecided: noise above B, or real shared FM
    noisy = dm[nf].values >= b if nf != "none" else np.zeros(len(dm), bool)
    coh = ~cm & ~noisy
    P(f"\nmachine lines NOT called machine: {int((~cm).sum())} — noise proxy >= B (undecided, falls back to timing): {int((noisy).sum())}; "
      f"shared modulation >= A at low noise (machine looks voice-like): {int((coh & ~noisy).sum())}")
    sub = dm[coh & ~noisy]
    if len(sub):
        P("voice-like machine lines by group: " + ", ".join(f"{g} {c}" for g, c in sub["mgroup"].value_counts().items()))
    VL.assign(called_machine=(apply3(VL, key[0], key[1], nf, a, c, b) if c is not None else apply(VL, key[0], nf, a, b))).to_csv(os.path.join(LA.D, f"rules_voice_{OUTN}.csv"), index=False)
    dm.assign(called_machine=cm).to_csv(os.path.join(LA.D, f"rules_machine_{OUTN}.csv"), index=False)
    # supplements: synthetic suite holds and clinical / atypical voice (clean)
    P("\n## Supplements (clean): voice lines called machine by the rule\n")
    for name, sub in [("synthetic suite holds (synth.mjs)", v[(v.source == "synthetic") & np.isinf(v.deg)]),
                      ("clinical / atypical real voice (PVQD severity >= 20, VOICED pathological)",
                       v[v["source"].isin(LA.REAL) & ~v["typical"] & np.isinf(v.deg)])]:
        SL = LA.line_level(sub); SL = SL[SL.nwin >= MINWIN]
        x = apply3(SL, key[0], key[1], nf, a, c, b) if c is not None else apply(SL, key[0], nf, a, b)
        P(f"- {name}: {int(x.sum())} of {len(SL)} lines ({np.mean(x):.1%})" + (
            "; by family " + ", ".join(f"{k_} {int(x[(SL.cls == k_).values].sum())}/{int((SL.cls == k_).sum())}" for k_ in sorted(SL.cls.unique()))
            if name.startswith("synthetic") else ""))
    mix_eval(key, a, b, c, A.get("mixtag", ""))
    open(os.path.join(LA.D, f"{OUTN}.md"), "w", encoding="utf-8").write("\n".join(LINES) + "\n")


def mix_eval(key, a, b, c, tag):
    """The chosen rule on the end-to-end mixes (mix_<set><tag>.csv)."""
    nf = key[-1]
    mw = int(A.get("minwin", 1))
    call0 = (lambda D: apply3(D, key[0], key[1], nf, a, c, b)) if c is not None else (lambda D: apply(D, key[0], nf, a, b))
    call = lambda D: call0(D) & (D["nwin"].values >= mw)

    def fr(D):
        e = D["nwin"].values >= mw
        return f"{np.mean(call(D)):.1%} ({np.mean(call(D)[e]) if e.any() else float('nan'):.1%} of {int(e.sum())} with >= {mw} win)"
    und = lambda D: (D[nf].values >= b) if nf != "none" else np.zeros(len(D), bool)
    P("\n## The rule on the mixes\n")
    p = os.path.join(LA.D, f"mix_held_series{tag}.csv")
    if os.path.exists(p):
        h = LA.derive(pd.read_csv(p)); h = h[h.role == "voice"]
        L = LA.line_level(h)
        if key[0] in L.columns:
            cm = call(L); five = L.nwin.values >= 5
            P(f"- **held_series** (real VocalSet same-pitch hold series, gaps 0.15-1 s): {len(L)} voice lines / {L['id'].nunique()} streams, "
              f"median {L['nwin'].median():.0f} windows per line: **{np.mean(cm):.1%} called machine** "
              f"(lines with >= 5 windows: {np.mean(cm[five]) if five.any() else float('nan'):.1%} of {int(five.sum())})")
    p = os.path.join(LA.D, f"mix_voice_in_noise{tag}.csv")
    if os.path.exists(p):
        m = LA.derive(pd.read_csv(p))
        P("\n| voice_in_noise | lines | prominence p50 | called machine | undecided (noise >= B) |"); P("|---|---|---|---|---|")
        for snr, ms in m.groupby("snr_db"):
            V = LA.line_level(ms[ms.role == "voice"])
            if key[0] in V.columns and len(V):
                P(f"| SNR {snr:+d}: voice lines (held-program harmonics) | {len(V)} | {V['snr'].median():.0f} | {fr(V)} | {np.mean(und(V)):.1%} |")
                for vk, vs in V.groupby("voice_kind"):
                    P(f"| - program {vk} | {len(vs)} | {vs['snr'].median():.0f} | {fr(vs)} | {np.mean(und(vs)):.1%} |")
            mm = ms[ms.role == "machine"]
            for ph in ["lead", "voice"]:
                sub = mm[mm.phase == ph].copy()
                if not len(sub): continue
                sub["win"] = sub.groupby(["id", "line"]).cumcount()
                Lm = LA.line_level(sub, maxwin=5)
                if key[0] in Lm.columns:
                    P(f"| SNR {snr:+d}: machine lines, first <= 5 {ph}-phase windows | {len(Lm)} | {Lm['snr'].median():.0f} | {fr(Lm)} | {np.mean(und(Lm)):.1%} |")
    p = os.path.join(LA.D, f"mix_noise_gated{tag}.csv")
    if os.path.exists(p):
        g = LA.derive(pd.read_csv(p))
        P("\n| noise_gated (R8 adversary on real sources) | lines | called machine (first 5 windows) | called machine (on-windows only) |"); P("|---|---|---|---|")
        for (off, per), s_ in g.groupby(["off_s", "period_s"]):
            La = LA.line_level(s_, maxwin=5)
            on = s_[~s_.gated.astype(bool)].copy(); on["win"] = on.groupby(["id", "line"]).cumcount()
            Lo = LA.line_level(on, maxwin=5)
            if key[0] in La.columns:
                P(f"| off {off} s every {per} s | {len(La)} | {fr(La)} | {fr(Lo)} |")


if __name__ == "__main__":
    main()
