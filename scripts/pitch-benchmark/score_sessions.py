# score_sessions.py — every detector on the user's practice sessions, scored
# against reference conventions that avoid scoring a detector against itself.
#
# Usage: python scripts/pitch-benchmark/score_sessions.py [--dets=...] [--no-sweep]
#          [--runs-main=DIR] [--runs-new=DIR] [--runs-new600=DIR]
# Writes <WORK>/out/scores_sessions.json, prints one line per detector.
# Syrinx rows read session-oracle run dirs (scripts/session-oracle/run.mjs);
# defaults build/session-oracle/runs/base (origin/main), .../disp (the
# 2026-10-03 branch src) and <WORK>/out/sess_runs/new600.
#
# References (private-session 10 ms parquet grid, $SO_REFS/<s>.npz, default build/session-oracle/refs):
#   ac   Praat AC 50-600 (cached, build_refs.py)      } reference voters
#   shs  Praat SHS ceiling 600 (cached)                }
#   penn PENN FCNF0++ raw pitch (no voicing gate), recomputed by sess_detect.py
#        on every alice/second span with the 2026-10-03 setup (the cached
#        refs only cover Alice >= 140 Hz spans + ~150 s of second voice); agreement
#        with the cached PENN on the overlap is printed as a sanity check.
#   UNANIMOUS  ac, shs, penn all > 0 and pairwise within 5 %; ref = geometric mean.
#              One frame set for every detector.
#   LOFO       AC family (Syrinx, Praat AC/CC, pYIN): frames where shs & penn agree
#              within 5 %, ref = their geometric mean (no AC voter).
#              neural (PENN, CREPE, SwiftF0): frames where ac & shs agree, ref =
#              their geometric mean (PENN excluded from its own reference).
#   Only frames labelled alice / second (private-session enrollment-v2 speaker labels)
#   and refs >= 75 Hz are scored.
# Detector time conventions as in score_corpora.py; Syrinx from the
# session-oracle runs (post: window centre (k+1)*hop - 40 ms; paint: minus
# L*hop + 30 ms more). Offset sweep -100..+100 ms (5 ms) on the unanimous
# Alice+second voice frames, pooled over the four sessions, maximising RPA.
import sys, os, json
import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__)); sys.path.insert(0, HERE)
from paths import OUT, SO_REFS as REFS, SO_RUNS
A = dict((a[2:].split("=", 1) + ["1"])[:2] for a in sys.argv[1:] if a.startswith("--"))
SESSIONS = ["2025-09-08", "2026-05-07", "2026-05-26", "2026-06-09"]
HELD_OUT = "2026-06-09"
OFFSETS = np.arange(-100, 101, 5) / 1000.0 if "no-sweep" not in A else np.array([0.0])
BANDS = [("75-160", 75, 160), ("160-260", 160, 260), ("260-400", 260, 400), (">=400", 400, 1e9), ("160-400", 160, 400), ("all", 75, 1e9)]
PENN_THR = float(A.get("penn-thr", "0.1"))  # see score_corpora.py

RUN_MAIN = A.get("runs-main", os.path.join(SO_RUNS, "base"))
RUN_NEW = A.get("runs-new", os.path.join(SO_RUNS, "disp"))
RUN_600 = A.get("runs-new600", os.path.join(OUT, "sess_runs", "new600"))
SYR_RUNS = {"syrinx_main": (RUN_MAIN, "post"), "syrinx_new": (RUN_NEW, "post"), "syrinx_new600": (RUN_600, "post"),
            "syrinx_main_disp": (RUN_MAIN, "paint"), "syrinx_new_disp": (RUN_NEW, "paint"), "syrinx_new600_disp": (RUN_600, "paint")}
FAMILY = {"praat_ac": "ac", "praat_ac_cal": "ac", "praat_cc": "ac", "pyin": "ac",
          "penn": "nn", "crepe_full": "nn", "crepe_tiny": "nn", "swift_offline": "nn", "swift_stream": "nn", "swift_offline_g09": "nn"}
for k in SYR_RUNS: FAMILY[k] = "ac"
for k in ["penn", "crepe_full", "crepe_tiny", "swift_offline", "pyin"]: FAMILY[k + "_ungated"] = FAMILY[k]
DETS = A["dets"].split(",") if "dets" in A else list(SYR_RUNS) + ["praat_ac", "praat_ac_cal", "praat_cc", "pyin", "penn", "crepe_full", "crepe_tiny", "swift_offline", "swift_stream", "swift_offline_g09"]


def agree(x, y, tol=0.05):
    return (x > 0) & (y > 0) & (np.abs(x / np.where(y > 0, y, 1) - 1) < tol)


def on_grid(t, te, fe, tol):
    o = np.argsort(te); te, fe = te[o], fe[o]
    j = np.clip(np.searchsorted(te, t), 1, len(te) - 1)
    jj = np.where(np.abs(te[j - 1] - t) <= np.abs(te[j] - t), j - 1, j)
    return np.where(np.abs(te[jj] - t) <= tol, fe[jj], 0.0)


def load_ref(s):
    z = np.load(os.path.join(REFS, f"{s}.npz"))
    t, spk, ac, shs, pc = z["t"], z["spk"], z["ac"], z["shs"], z["penn"]
    p = np.load(os.path.join(OUT, "sess", "penn", f"{s}.npz"))
    pf = on_grid(t, p["t"], p["r"], 0.006)
    ov = (pc > 0) & (pf > 0)
    sanity = dict(overlap=int(ov.sum()), agree5=float(np.mean(agree(pc[ov], pf[ov]))) if ov.any() else None)
    lab = (spk == 1) | (spk == 2)
    gm = lambda *v: np.exp(np.mean([np.log(np.where(x > 0, x, 1)) for x in v], axis=0))
    U = lab & agree(ac, shs) & agree(ac, pf) & agree(shs, pf)
    Lac = lab & agree(shs, pf)
    Lnn = lab & agree(ac, shs)
    refs = {"U": np.where(U, gm(ac, shs, pf), 0), "Lac": np.where(Lac, gm(shs, pf), 0), "Lnn": np.where(Lnn, gm(ac, shs), 0)}
    for k in refs: refs[k] = np.where(refs[k] >= 75, refs[k], 0)
    return dict(t=t, spk=spk, refs=refs, sanity=sanity)


def load_est(det, s):
    if det in SYR_RUNS:
        d, stage = SYR_RUNS[det]
        m = json.load(open(os.path.join(d, f"{s}.meta.json"))); n = m["nHops"]
        tab = np.fromfile(os.path.join(d, f"{s}.hops.f32"), dtype=np.float32).reshape(len(m["cols"]), n)
        h = m["hopS"]; k = np.arange(n)
        if stage == "post": return (k + 1) * h - 0.040, tab[m["cols"].index("post")].astype(float)
        return (k + 1) * h - 0.040 - m["lookback"] * h - 0.030, tab[m["cols"].index("paint")].astype(float)
    gate = None; ungated = False
    if det.endswith("_g09"): det, gate = det[:-4], 0.9
    if det.endswith("_ungated"): det, ungated = det[:-8], True   # raw pitch on every frame, voicing decision removed
    if det == "swift_stream": p = os.path.join(OUT, "swift_stream", f"sess_{s}.npz")
    else: p = os.path.join(OUT, "sess", det, f"{s}.npz")
    if not os.path.exists(p): return None
    z = np.load(p)
    t, f = z["t"], z["f"]
    if det == "penn": f = np.where(z["p"] >= PENN_THR, z["r"], 0.0)
    if gate is not None: f = np.where(z["p"] >= gate, z["r"], 0.0)
    if ungated: f = z["r"]
    return t, f


def est_at(te, fe, t, d, nearest=False):
    """mir_eval-style resampling (score_corpora.align); nearest=True gives the
    session oracle's nearest-hop mapping (used by sanity_sessions.py)."""
    if len(te) < 2: return np.zeros(len(t))
    o = np.argsort(te); te, fe = te[o], fe[o]
    if nearest: return on_grid(t, te + d, fe, float(np.median(np.diff(te))))
    import score_corpora
    return score_corpora.align(te, fe, t, d)


def cls(e, r):
    ev = e > 0
    q = np.where(ev, e / np.where(r > 0, r, 1), 0)
    cents = np.where(ev, 1200 * np.log2(np.where(ev, e, 1) / np.where(r > 0, r, 1)), np.inf)
    return dict(C5=ev & (np.abs(q - 1) < 0.05), RPA=ev & (np.abs(cents) < 50),
                down=ev & ((np.abs(q - 0.5) <= 0.05) | (np.abs(q - 1 / 3) <= 0.0333)),
                up=ev & ((np.abs(q - 2) <= 0.2) | (np.abs(q - 3) <= 0.3) | (np.abs(q - 4) <= 0.4)),
                null=~ev, gpe_num=ev & (np.abs(q - 1) > 0.2), both=ev)


def table(E, R, spk, sess):
    out = {}
    for who, code in (("alice", 1), ("second", 2)):
        for scope in ("pooled", "HO"):
            sm = (spk == code) & ((sess == HELD_OUT) if scope == "HO" else np.ones(len(sess), bool))
            for bn, lo, hi in BANDS:
                if who == "second" and bn not in ("all", "75-160", "160-260", "260-400"): continue
                m = sm & (R >= lo) & (R < hi) & (R > 0)
                n = int(m.sum())
                if n == 0: continue
                K = cls(E[m], R[m])
                nb = int(K["both"].sum())
                out[f"{who}|{scope}|{bn}"] = dict(n=n, C5=100 * K["C5"].mean(), RPA=100 * K["RPA"].mean(), down=100 * K["down"].mean(),
                                                 up=100 * K["up"].mean(), null=100 * K["null"].mean(),
                                                 GPE=100 * K["gpe_num"].sum() / nb if nb else float("nan"))
    return out


if __name__ == "__main__":
    RF = {s: load_ref(s) for s in SESSIONS}
    for s in SESSIONS: print(s, "fresh-vs-cached PENN", RF[s]["sanity"], {k: int((RF[s]["refs"][k] > 0).sum()) for k in RF[s]["refs"]})
    spk = np.concatenate([RF[s]["spk"] for s in SESSIONS]); sess = np.concatenate([np.full(len(RF[s]["t"]), s) for s in SESSIONS])
    path = os.path.join(OUT, "scores_sessions.json")
    allres = json.load(open(path)) if os.path.exists(path) and "dets" in A else {}
    for det in DETS:
        ests = {s: load_est(det, s) for s in SESSIONS}
        if any(v is None for v in ests.values()): print(det, "missing"); continue
        RU = np.concatenate([RF[s]["refs"]["U"] for s in SESSIONS])
        best = None
        for d in OFFSETS:
            E = np.concatenate([est_at(*ests[s], RF[s]["t"], d) for s in SESSIONS])
            v = RU > 0
            rpa = float(np.mean(cls(E[v], RU[v])["RPA"]))
            if best is None or rpa > best[1] + 1e-12: best = (d, rpa, E)
        d, _, E = best
        res = {"offset_ms": round(d * 1000), "family": FAMILY[det]}
        res["U"] = table(E, RU, spk, sess)
        lk = "Lac" if FAMILY[det] == "ac" else "Lnn"
        RL = np.concatenate([RF[s]["refs"][lk] for s in SESSIONS])
        res["LOFO"] = table(E, RL, spk, sess); res["LOFO_conv"] = lk
        # cross view: every detector against BOTH two-voter references
        for kk in ("Lac", "Lnn"):
            res["X_" + kk] = table(E, np.concatenate([RF[s]["refs"][kk] for s in SESSIONS]), spk, sess)
        allres[det] = res
        a = res["U"].get("alice|pooled|160-400", {}); l = res["LOFO"].get("alice|pooled|160-400", {}); sa = res["U"].get("second|pooled|all", {})
        print(f"{det:20s} off {res['offset_ms']:+4d}  U alice160-400 C5 {a.get('C5',0):6.2f} dn {a.get('down',0):5.2f} null {a.get('null',0):5.2f} | LOFO({lk}) C5 {l.get('C5',0):6.2f} | U second C5 {sa.get('C5',0):6.2f}", flush=True)
    json.dump(allres, open(path, "w"), indent=0)
