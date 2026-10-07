"""Metrics for the Perceived Voice gate measurement (measurements/perceived-voice-gate-2026-10-07.md).

  python scripts/perceived-voice-gate/analyze.py <variant|before> <analysis> [<analysis> ...]

<variant> = a replay.mjs output (build/perceived-voice-gate/replay/<set>.<variant>.jsonl);
`before` = the retired chain (chain.mjs old-gate codes + score.py logits + the old EMA and
meter replays in common.py). The same metric code runs on both.

Analyses:
  noise     noise-only clips: time with a number / with any non-blank state, by noise label
  chan      running speech: speaking-time coverage by condition group and sex, the
            not-shown decomposition, babble lead, per-speaker breakdown by F0
  onset     first number after the voice onset, first-value error, settle time
  dyn       speaker changes: lag to 90 % of the new value, first value after a pause
  held      held vowels / long tones (VOICED, VocalSet, PVQD) + PVQD speech portions
  adv       flat-intonation / slowed speech (ls, pv) and vocadito singing (vo): states over
            Praat-voiced speaking time (verdict-only replays; `before` not available)
  sweep     noise + speaking-time coverage for each listed variant (--variants=a,b,...)

Speaking time = 25 ms hops at which the Praat F0 track of the clean recording (chan: the
resonance lab's track; adv: Praat AC on the stream) was voiced in the last 300 ms.
"""
import sys, os, json
import numpy as np
import pandas as pd

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
sys.path.insert(0, os.path.join(HERE, "..", "resonance-lab"))
from common import (SETS, RUNS, REPLAY, RESULTS, REPO, OLD_SCORED, read_prefixed, read_jsonl,  # noqa: E402
                    old_ema_replay, old_display_replay, f32_read, SR)

pd.set_option("display.width", 250); pd.set_option("display.max_rows", 300); pd.set_option("display.max_columns", 40)
RLAB_BUILD = os.environ.get("SYRINX_RLAB_BUILD", os.path.join(REPO, "build", "resonance-lab"))
CLEANISH = ("clean", "quiet20", "laptop", "phone", "reverb05")
NOISY = ("pink0", "real10", "real0")


def meta(set_):
    return pd.read_json(f"{SETS}/meta_{set_}.json").set_index("id")


def load(set_, variant):
    """{id: dict(ks, g, lg, sm, disp, stat, n, gate, pitch, paint)}; stat is None for `before`."""
    vad = read_prefixed(RUNS, f"vad_{set_}.")
    sc = read_prefixed(RUNS, f"sc_{set_}.")
    res = {}
    if variant == "before":
        for iid, s in sc.items():
            v = vad[iid]
            ks = np.array(s["ks"]); g = np.array(s["g"]); lg = np.array([np.nan if a is None else a for a in s["lg"]], float)
            sm = old_ema_replay(g, lg)
            disp = old_display_replay(v["n"], ks, 100 * sm, v["gate"])
            res[iid] = dict(ks=ks, g=g, lg=lg, sm=100 * sm, disp=disp, n=v["n"], gate=v["gate"],
                            pitch=np.array(v["pitch"]), paint=np.array(v["paint"]), stat=None)
        return res
    new = read_jsonl(os.path.join(REPLAY, f"{set_}.{variant}.jsonl"))
    for iid, r in new.items():
        v = vad[iid]
        s = sc.get(iid)
        lgmap = {k: (np.nan if a is None else a) for k, a in zip(s["ks"], s["lg"])} if s else {}
        ks = np.array(r["ks"]); g = np.array(r["vc"])
        lg = np.array([lgmap.get(k, np.nan) if gg == 1 else np.nan for k, gg in zip(ks, g)], float)
        sm = np.array([np.nan if x is None else x for x in r["sm"]], float)
        disp = np.array(r["disp"], float); disp[disp < 0] = np.nan
        res[iid] = dict(ks=ks, g=g, lg=lg, sm=sm, disp=disp, n=v["n"], gate=v["gate"],
                        pitch=np.array(v["pitch"]), paint=np.array(v["paint"]), stat=r["stat"])
    return res


def tt(ks):
    return (np.asarray(ks) + 1) * 0.025


def hop_t(n):
    return (np.arange(n) + 1) * 0.025


def stat_arr(r):
    return np.array(list(r["stat"])) if r["stat"] is not None else None


def share(mask, sel):
    return float(np.mean(mask[sel])) if sel.any() else np.nan


# ---------------------------------------------------------------------------
# Speaking-time masks

_tracks = {}


def _manifest_f0_paths():
    m = pd.read_parquet(os.path.join(RLAB_BUILD, "bench", "manifests", "r1_test.parquet"))
    out = {}
    for iid, p in zip(m.item_id, m.f0_path):
        q = p.replace("\\", "/")
        if not os.path.exists(q) and "/build/resonance-lab/" in q:
            q = os.path.join(RLAB_BUILD, q.split("/build/resonance-lab/", 1)[1])
        out[iid] = q
    return out


_f0paths = None


def chan_speaking(mm, n):
    """Hops at which the clean recording's Praat F0 track was voiced in the last 300 ms."""
    global _f0paths
    from rlab.f0 import F0Track
    p = mm.get("f0_path") if "f0_path" in mm and isinstance(mm.get("f0_path"), str) else None
    if p is None:
        if _f0paths is None:
            _f0paths = _manifest_f0_paths()
        p = _f0paths[mm.src]
    if p not in _tracks:
        _tracks[p] = F0Track.load(p)
    tr = _tracks[p]
    t = hop_t(n)
    out = np.zeros(n, bool)
    for dt in np.arange(0, 0.3001, 0.01):
        out |= tr.at(t - dt - mm.lead_s) > 0
    return out


def praat_speaking(f32, n, sex, lead_s):
    import parselmouth
    x = f32_read(f32).astype(np.float64)
    lo, hi = (60, 300) if sex == "m" else ((100, 500) if sex == "f" else (75, 600))
    p = parselmouth.Sound(x, SR).to_pitch_ac(time_step=0.01, pitch_floor=lo, pitch_ceiling=hi)
    f = p.selected_array["frequency"]; tx = p.xs()
    t = hop_t(n)
    v = np.zeros(n, bool)
    for dt in np.arange(0, 0.3001, 0.01):
        v |= np.interp(t - dt, tx, f > 0, left=0, right=0) > 0.5
    return v & (t > lead_s + 0.3)


# ---------------------------------------------------------------------------

def noise(variant):
    res = load("noise", variant); m = meta("noise")
    rows = []
    for iid, r in res.items():
        disp = r["disp"]; shown = ~np.isnan(disp); st = stat_arr(r)
        anyst = shown | (np.isin(st, ["U", "S"]) if st is not None else False)
        rows.append(dict(id=iid, label=m.loc[iid, "label"], shown=shown.mean(), any=anyst.mean(),
                         note=float(np.mean(st == "S")) if st is not None else np.nan,
                         upd=float(np.mean(st == "U")) if st is not None else np.nan,
                         disp_med=float(np.nanmedian(disp)) if shown.any() else np.nan,
                         disp_inM=float(np.mean(disp[shown] <= 30)) if shown.any() else np.nan,
                         paint=float(np.mean(r["paint"] > 0))))
    t = pd.DataFrame(rows)
    alld = np.concatenate([r["disp"][~np.isnan(r["disp"])] for r in res.values()])
    print(f"clips {len(t)}: number on screen mean {t.shown.mean():.3f}, median clip {t.shown.median():.3f}, "
          f"never {np.mean(t.shown == 0):.2f}, >50% {np.mean(t.shown > 0.5):.2f}, >10% {np.mean(t.shown > 0.1):.2f}")
    print(f"  any non-blank state {t['any'].mean():.3f} (number {t.shown.mean():.3f} + 'needs running speech' "
          f"{t.note.mean():.3f} + 'updating' {t.upd.mean():.3f}); note: worst clip {t.note.max():.3f} "
          f"({t.loc[t.note.idxmax(), 'label'] if t.note.notna().any() else '-'}), clips > 10 % {int((t.note > 0.1).sum())}")
    print(f"  shown values: median {np.median(alld):.1f}, share <= 30 {np.mean(alld <= 30):.3f}; pitch trace painted {t.paint.mean():.3f}")
    print(t.groupby("label").agg(clips=("id", "size"), shown=("shown", "mean"), any=("any", "mean"), note=("note", "mean"),
                                 paint=("paint", "mean")).round(3).to_string())
    from scipy.stats import spearmanr
    print("  spearman(shown, painted) per clip:", round(spearmanr(t.shown, t.paint)[0], 2))
    t.to_csv(f"{RESULTS}/noise.{variant}.csv", index=False)


def chan(variant):
    res = load("chan", variant); m = meta("chan")
    rows = []
    for iid, r in res.items():
        mm = m.loc[iid]; mm = mm.copy(); mm["id"] = iid
        sp = chan_speaking(mm, r["n"])
        t = hop_t(r["n"])
        d = r["disp"]; st = stat_arr(r)
        lead = t < mm.lead_s
        num = ~np.isnan(d)
        rows.append(dict(id=iid, src=mm.src, speaker=mm.speaker, cond=mm.cond, sex=mm.sex, f0=mm.f0_median,
                         cov=share(num, sp), lead_num=share(num, lead),
                         upd=share(st == "U", sp) if st is not None else np.nan,
                         note=share(st == "S", sp) if st is not None else np.nan,
                         none=share(~num & (st != "U") & (st != "S"), sp) if st is not None else np.nan))
    t = pd.DataFrame(rows)
    t["grp"] = np.where(t.cond.isin(CLEANISH), "clean-ish", np.where(t.cond.isin(NOISY), "noisy", t.cond))
    print("speaking-time coverage (share of speaking time with a number), mean of clips:")
    print(t.groupby(["grp", "sex"]).agg(n=("id", "size"), cov=("cov", "mean"), upd=("upd", "mean"), none=("none", "mean"),
                                        note=("note", "mean")).round(3).unstack().to_string())
    print(t.groupby(["cond", "sex"]).agg(cov=("cov", "mean"), lead_num=("lead_num", "mean"), note=("note", "mean"))
          .round(3).unstack().to_string())
    re = t[t.cond.isin(["real10", "real0"])]
    print(f"real-noise lead with a number (2 s before speech): {re.lead_num.mean():.3f}")
    print("per speaker (sorted by median F0): coverage clean-ish / noisy / pink0 / real0")
    ps = t.pivot_table(index=["sex", "speaker"], columns="grp", values="cov", aggfunc="mean")
    ps2 = t[t.cond.isin(["pink0", "real0"])].pivot_table(index=["sex", "speaker"], columns="cond", values="cov")
    f0 = t.groupby(["sex", "speaker"]).f0.first()
    out = pd.concat([f0, ps[["clean-ish", "noisy"]], ps2], axis=1).sort_values("f0")
    print(out.round(3).to_string())
    t.to_csv(f"{RESULTS}/chan.{variant}.csv", index=False)


def onset(variant):
    from rlab.f0 import F0Track
    global _f0paths
    res = load("chan", variant); m = meta("chan")
    if _f0paths is None and "f0_path" not in m.columns:
        _f0paths = _manifest_f0_paths()
    rows = []
    for iid, r in res.items():
        mm = m.loc[iid]
        p = mm.f0_path if "f0_path" in m.columns else _f0paths[mm.src]
        tr = F0Track.load(p)
        vt = tr.t[tr.f0 > 0]
        if len(vt) == 0:
            continue
        t_on = mm.lead_s + vt[0]; t_end = mm.lead_s + mm.voice_s
        k_t = tt(r["ks"]); sm = r["sm"]
        post = (k_t >= t_on) & ~np.isnan(sm)
        if not post.any():
            continue
        steady = np.nanmedian(sm[(k_t >= t_on + 2.5) & (k_t <= t_end)])
        tf = k_t[post][0] - t_on; first = sm[post][0]
        far = post & (np.abs(sm - steady) > 10) & (k_t <= t_on + 6)
        settle = (k_t[far][-1] - t_on + 0.15) if far.any() else tf
        wrong = (first <= 30) != (steady <= 30) or (first >= 70) != (steady >= 70)
        rows.append(dict(id=iid, cond=mm.cond, sex=mm.sex, t_first=tf, err=abs(first - steady), settle10=settle, wrong=bool(wrong)))
    t = pd.DataFrame(rows)
    t["grp"] = np.where(t.cond.isin(CLEANISH), "clean-ish", np.where(t.cond.isin(NOISY), "noisy", t.cond))
    print(t.groupby(["grp", "sex"]).agg(n=("id", "size"), t_first=("t_first", "median"), err=("err", "median"),
                                        err90=("err", lambda x: np.percentile(x, 90)), wrong=("wrong", "mean"),
                                        settle10=("settle10", "median")).round(2).to_string())
    t.to_csv(f"{RESULTS}/onset.{variant}.csv", index=False)


def _cross(tv, v, t_from, target, up):
    m = tv >= t_from
    for t, x in zip(tv[m], v[m]):
        if np.isnan(x):
            continue
        if (up and x >= target) or ((not up) and x <= target):
            return t - t_from
    return np.nan


def dyn(variant):
    res = load("dyn", variant); m = meta("dyn")
    rows = []
    for iid, r in res.items():
        mm = m.loc[iid]; tc = mm.t_change
        k_t = tt(r["ks"]); sm = r["sm"]
        pre = np.nanmedian(sm[(k_t >= tc - mm.gap - 2.5) & (k_t <= tc - mm.gap - 0.1)])
        end_t = k_t[~np.isnan(sm)][-1] if np.any(~np.isnan(sm)) else tc
        postv = np.nanmedian(sm[(k_t >= tc + 3.0) & (k_t <= end_t)])
        after = (k_t >= tc) & ~np.isnan(sm)
        rows.append(dict(id=iid, kind=mm.kind, dir=mm.dir, gap=mm.gap,
                         lag90=_cross(k_t, sm, tc, pre + 0.9 * (postv - pre), postv > pre),
                         first_after=float(sm[after][0]) if after.any() else np.nan, pre=pre, post=postv))
    t = pd.DataFrame(rows)
    print(t.groupby(["kind", "dir", "gap"]).agg(n=("id", "size"), pre=("pre", "median"), post=("post", "median"),
                                                lag90=("lag90", "median"), first_after=("first_after", "median"))
          .round(2).to_string())
    t.to_csv(f"{RESULTS}/dyn.{variant}.csv", index=False)


def held(variant):
    rows = []
    for set_ in ["voiced", "vocalset", "pvqd"]:
        res = load(set_, variant); m = meta(set_)
        for iid, r in res.items():
            mm = m.loc[iid]; sex = mm.sex
            t = hop_t(r["n"]); d = r["disp"]; num = ~np.isnan(d); st = stat_arr(r)
            for s in json.loads(mm.held):
                if s[1] - s[0] < 1.0:
                    continue
                a, b = s[0] + mm.lead_s, s[1] + mm.lead_s
                sel = (t >= a) & (t <= b); late = sel & (t >= a + 1.25)
                rows.append(dict(set=set_, id=iid, sex=sex, f0=s[2], kind="held", num=share(num, sel),
                                 note_late=share(st == "S", late) if st is not None else np.nan,
                                 shown_med=float(np.nanmedian(d[sel])) if num[sel].any() else np.nan))
            if set_ == "pvqd":
                sp = (t >= mm.lead_s + 0.5) & (t <= mm.lead_s + mm.dur)
                near = np.zeros(r["n"], bool)
                for s in json.loads(mm.held):
                    near |= (t >= s[0] + mm.lead_s - 0.5) & (t <= s[1] + mm.lead_s + 1.5)
                sp &= ~near
                if (sp & (r["pitch"] > 0)).any():
                    rows.append(dict(set="pvqd_speech", id=iid, sex=sex, kind="speech", num=share(num, sp),
                                     note=share(st == "S", sp) if st is not None else np.nan))
    t = pd.DataFrame(rows)
    h = t[t.kind == "held"].copy()
    h["band"] = np.where(h.f0 > 400, ">400 Hz", "<=400 Hz")
    print(h.groupby(["set", "band", "sex"]).agg(n=("id", "size"), num=("num", "mean"), note_late=("note_late", "mean"),
                                                shown_med=("shown_med", "median")).round(3).to_string())
    s = t[t.kind == "speech"]
    print("PVQD speech portions:", s.groupby("sex").agg(n=("id", "size"), num=("num", "mean"), note=("note", "mean"))
          .round(4).to_dict())
    t.to_csv(f"{RESULTS}/held.{variant}.csv", index=False)


def adv(variant):
    for set_ in ["ls", "pv", "vo"]:
        res = load(set_, variant)
        if not res:
            continue
        m = meta(set_); jobs = {j["id"]: j["f32"] for j in json.load(open(f"{SETS}/jobs_{set_}.json"))}
        rows, notes = [], []
        for iid, r in res.items():
            mm = m.loc[iid]; st = stat_arr(r)
            sp = praat_speaking(jobs[iid], r["n"], mm.sex, mm.lead_s)
            rows.append(dict(id=iid, var=mm["var"], sex=mm.sex, N=share(st == "N", sp), S=share(st == "S", sp),
                             U=share(st == "U", sp), L=share(st == "L", sp)))
            if set_ == "vo" and isinstance(mm.get("held"), str):
                t = hop_t(r["n"])
                for s in json.loads(mm.held):
                    if s[1] - s[0] >= 1.0:
                        sel = (t >= s[0] + mm.lead_s) & (t <= s[1] + mm.lead_s)
                        notes.append(dict(id=iid, N=share(st == "N", sel), S=share(st == "S", sel)))
        t = pd.DataFrame(rows); t["S_over5"] = t.S > 0.05
        print(f"== {set_}: share of speaking time: N number, S needs running speech, U updating, L nothing")
        print(t.groupby(["var", "sex"]).agg(n=("id", "size"), N=("N", "mean"), S=("S", "mean"), U=("U", "mean"),
                                            L=("L", "mean"), clips_S_over5=("S_over5", "sum")).round(3).to_string())
        if set_ == "vo":
            print(f"   median clip number share {t.N.median():.3f}; clips with a number > 50 % of sung time: {int((t.N > 0.5).sum())}/{len(t)}")
            if notes:
                q = pd.DataFrame(notes)
                print(f"   held notes >= 1 s inside the melodies (n={len(q)}): number {q.N.mean():.3f}, note {q.S.mean():.3f}")
        t.to_csv(f"{RESULTS}/adv_{set_}.{variant}.csv", index=False)


def sweep(_variant):
    variants = [a.split("=", 1)[1] for a in sys.argv if a.startswith("--variants=")][0].split(",")
    m = meta("chan")
    sp_cache = {}
    for v in variants:
        N = load("noise", v); Cn = load("chan", v)
        noise_shown = np.mean([np.mean(~np.isnan(r["disp"])) for r in N.values()])
        acc = {}
        for iid, r in Cn.items():
            mm = m.loc[iid]
            if mm.cond == "babble10":
                continue
            if iid not in sp_cache:
                q = mm.copy(); q["id"] = iid; sp_cache[iid] = chan_speaking(q, r["n"])
            grp = "clean" if mm.cond in CLEANISH else "noisy"
            acc.setdefault((grp, mm.sex), []).append(share(~np.isnan(r["disp"]), sp_cache[iid]))
        f = lambda k: np.mean(acc[k])  # noqa: E731
        print(f"{v:24s} noise {noise_shown:.3f} | clean f {f(('clean', 'f')):.3f} m {f(('clean', 'm')):.3f} | "
              f"noisy f {f(('noisy', 'f')):.3f} m {f(('noisy', 'm')):.3f}", flush=True)


if __name__ == "__main__":
    os.makedirs(RESULTS, exist_ok=True)
    variant = sys.argv[1]
    for a in [x for x in sys.argv[2:] if not x.startswith("--")]:
        print(f"===== {variant}: {a}", flush=True)
        globals()[a](variant)
