"""Build the resonance-validity benchmark item sets (idempotent).

  python scripts/resonance-lab/build_bench.py [--sets r1_test,manip_test,...] [--workers 14] [--force]

Item sets (manifests in build/resonance-lab/bench/manifests/<set>.parquet):
  r1_test     LibriSpeech test-clean, 25 utts/speaker x 40 held-out speakers (20 F / 20 M)   R1, R2/R3 gap, R5
  r1_dev      same recipe on dev-clean (tuning split; learned candidates must speaker-CV)
  train_dev   ALL dev-clean utterances (training pool for learned candidates; never scored)
  ptdb        PTDB-TUG subset (2 F + 2 M speakers, MIC channel, 48 k -> 16 k)               R1 per-corpus
  fda         CSTR FDA (1 M + 1 F, 20 k -> 16 k)                                             R1 per-corpus
  hill        Hillenbrand men + women hVd tokens (all with audio)                            R1 per-corpus, R4
  manip_test  5 utts/speaker test-clean (200 = 100 F + 100 M), cropped to <= 5 s,
              x (orig + 20 Praat + 19 WORLD conditions; see rlab/manip.py)                   R2, R3, R7
  manip_dev   2 utts/speaker dev-clean (80), same conditions (tuning split)
  manip_hill  Hillenbrand 10 men + 10 women x 12 vowels (240 tokens), same conditions     R2, R3 on vowels
  synth       formant-synthesized vowdata tokens, men/women/boys/girls, 2.0 s held        R5 held, R7 children
  sessions    private session clips ($SYRINX_SESSIONS_DIR), second / alice_low / alice_mid / alice_raised  R6
"""
import os
import sys
import argparse
import zlib
import numpy as np
import pandas as pd
from concurrent.futures import ProcessPoolExecutor

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from rlab import loaders, audio, manip, synth as SY, practice_sessions  # noqa: E402
from rlab.f0 import praat_track, F0Track  # noqa: E402
from rlab.paths import AUDIO, F0DIR, MANIFESTS, SR, SEED  # noqa: E402

ALL_SETS = ["r1_test", "r1_dev", "train_dev", "ptdb", "fda", "hill", "manip_test", "manip_dev", "manip_hill",
            "synth", "sessions"]
MANIP_CROP_S = 5.0


def f0_path(iid):
    return os.path.join(F0DIR, iid + ".npy").replace("\\", "/")


# ------------------------------------------------------------------ workers
def job_plain(args):
    """Original-audio item: optional 16 k conversion + two-pass Praat F0."""
    row, setname, convert = args
    x = audio.load(row["path"], row.get("sr_src"))
    if convert:
        p = os.path.join(AUDIO, setname, row["item_id"] + ".wav").replace("\\", "/")
        if not os.path.exists(p):
            audio.write16(p, x)
        row["path"], row["sr_src"] = p, SR
    fp = f0_path(row["item_id"])
    if os.path.exists(fp):
        tr = F0Track.load(fp)
    else:
        tr = praat_track(x)
        tr.save(fp)
    row.update(f0_path=fp, f0_median=tr.median(), voiced_s=tr.voiced_seconds(), dur_s=len(x) / SR)
    return row


ENV_GRID = np.geomspace(200, 6000, 480)


def mean_env(y, times):
    """Mean LPC log-envelope (dB) over 40 ms frames at the given (voiced) times."""
    import librosa
    W = int(0.04 * SR)
    acc, n = np.zeros(len(ENV_GRID)), 0
    w = np.exp(-2j * np.pi * np.outer(ENV_GRID / SR, np.arange(19)))
    for t in times[::2]:
        s = int(round(t * SR)) - W // 2
        if s < 0 or s + W > len(y):
            continue
        fr = np.asarray(y[s:s + W], np.float64)
        fr = np.append(fr[0], fr[1:] - 0.97 * fr[:-1]) * np.hamming(W)
        if np.max(np.abs(fr)) < 1e-5:
            continue
        a = librosa.lpc(fr, order=18)
        acc += -20 * np.log10(np.abs(w @ a) + 1e-12)
        n += 1
    return acc / n if n else None


def env_shift(e_ref, e):
    """Log-frequency shift (as a multiplicative scale) aligning e to e_ref over 300-4500 Hz."""
    if e_ref is None or e is None:
        return np.nan
    step = np.log(ENV_GRID[1] / ENV_GRID[0])
    sel = np.where((ENV_GRID >= 300) & (ENV_GRID <= 4500))[0]
    r = e_ref[sel] - e_ref[sel].mean()
    best, bs, cs = -2, 0, {}
    for s in range(-25, 26):
        if (sel + s).min() < 0 or (sel + s).max() >= len(ENV_GRID):
            continue
        x = e[sel + s] - e[sel + s].mean()
        c = float(x @ r / (np.linalg.norm(x) * np.linalg.norm(r) + 1e-12))
        cs[s] = c
        if c > best:
            best, bs = c, s
    if bs - 1 in cs and bs + 1 in cs:
        a, b, c = cs[bs - 1], cs[bs], cs[bs + 1]
        den = a - 2 * b + c
        bs = bs + (0.5 * (a - c) / den if den != 0 else 0)
    return float(np.exp(bs * step))


def job_manip(args):
    row, setname, crop = args
    x = audio.load(row["path"], row.get("sr_src"))
    if crop:
        x = x[: int(crop * SR)]
    src_tr = praat_track(x)
    vt = src_tr.t[src_tr.voiced]
    out, envs = [], {}
    sex = row["sex"]
    variants = list(manip.make_variants(x, sex, src_tr))
    # ONE gain for every variant of this source (all are RMS-matched to the source
    # crop), so a condition and its reference never differ in level.
    pk = max(float(np.max(np.abs(y))) for _, y in variants)
    gain = 1.0 if pk <= 0.99 else 0.99 / pk
    for c, y in variants:
        y = y * gain
        suffix = "orig" if c["engine"] == "none" else f"{c['engine']}.{c['cond']}"
        iid = f"{row['item_id']}.{suffix}"
        p = os.path.join(AUDIO, setname, iid + ".wav").replace("\\", "/")
        g = audio.write16(p, y) * gain
        fac = 2.0 ** (c["st"] / 12.0)
        tr = F0Track(src_tr.t, src_tr.f0 * fac)          # intended track (timing preserved)
        fp = f0_path(iid)
        tr.save(fp)
        # QA: realized F0 (expectation-centred Praat range) + envelope scale vs the same-engine ref
        exp_med = src_tr.median() * fac
        q = praat_track(y.astype(np.float32), floor=max(35.0, exp_med / 2.2), ceil=min(1200.0, exp_med * 2.2),
                        two_pass=False)
        envs[c["cond"] if c["engine"] != "world" else "w:" + c["cond"]] = mean_env(y, vt)
        ref_key = ("w:" + c["ref"] if c["engine"] == "world" and c["ref"] != "orig" else c["ref"])
        ref_iid = "" if not c["ref"] else (f"{row['item_id']}.orig" if c["ref"] == "orig"
                                            else f"{row['item_id']}.{c['engine']}.{c['ref']}")
        r = {k: row[k] for k in ("speaker", "sex", "group", "vowel", "corpus") if k in row}
        r.update(item_id=iid, src_item=row["item_id"], path=p, sr_src=SR, dur_s=len(y) / SR, engine=c["engine"],
                 cond=c["cond"], kind=c["kind"], st=c["st"], fs=c["fs"], ref_item=ref_iid, gain=g,
                 f0_path=fp, f0_median=tr.median(), voiced_s=tr.voiced_seconds(),
                 qa_f0_ratio=q.median() / exp_med if exp_med > 0 else np.nan,
                 _ref_key=ref_key, _key=c["cond"] if c["engine"] != "world" else "w:" + c["cond"])
        out.append(r)
    for r in out:
        # realized envelope scale relative to the condition's own reference; for refs, vs orig
        r["qa_env_scale"] = env_shift(envs.get(r["_ref_key"]), envs.get(r["_key"])) if r["_ref_key"] else np.nan
        r.pop("_ref_key"), r.pop("_key")
    return out


def job_synth(args):
    r, = args
    iid = f"sy-{r['file']}"
    p = os.path.join(AUDIO, "synth", iid + ".wav").replace("\\", "/")
    y = SY.synth_vowel(r["f0"], [r["F1"], r["F2"], r["F3"], r["F4f"], r["F5f"]], dur=2.0,
                       seed=zlib.crc32(r["file"].encode()))
    audio.write16(p, y)
    tr = praat_track(y)
    fp = f0_path(iid)
    tr.save(fp)
    return dict(item_id=iid, corpus="synth", path=p, sr_src=SR, dur_s=len(y) / SR, speaker="sy" + r["spk"],
                sex=loaders.HILL_SEX[r["g"]], group=loaders.HILL_GROUP[r["g"]], vowel=r["vowel"],
                f0_true=r["f0"], F1=r["F1"], F2=r["F2"], F3=r["F3"], F4=r["F4f"], f0_path=fp,
                f0_median=tr.median(), voiced_s=tr.voiced_seconds())


def job_sessions(args):
    s, = args
    ad = os.path.join(AUDIO, "sessions")
    os.makedirs(ad, exist_ok=True)
    return practice_sessions.build_clips(s, ad, F0DIR)


# ------------------------------------------------------------------ set builders
def manip_hill_sources():
    h = loaders.hillenbrand()
    h = h[np.isfinite(h.vd_f0)]
    cnt = h.groupby("speaker").vowel.nunique()
    full = cnt[cnt == 12].index
    rng = np.random.default_rng(SEED + 2)
    pick = []
    for grp in ("men", "women"):
        spk = sorted(set(h[(h.group == grp) & h.speaker.isin(full)].speaker))
        pick += list(rng.choice(spk, 10, replace=False))
    return h[h.speaker.isin(pick)].reset_index(drop=True)


def build(setname, workers):
    if setname in ("r1_test", "r1_dev"):
        df = loaders.libri_pool("test-clean" if setname == "r1_test" else "dev-clean", 25)
        jobs, fn = [(r, setname, False) for r in df.to_dict("records")], job_plain
    elif setname == "train_dev":
        df = loaders.libri_utts("dev-clean")
        jobs, fn = [(r, setname, False) for r in df.to_dict("records")], job_plain
    elif setname in ("ptdb", "fda"):
        df = loaders.ptdb() if setname == "ptdb" else loaders.fda()
        jobs, fn = [(r, setname, True) for r in df.to_dict("records")], job_plain
    elif setname == "hill":
        df = loaders.hillenbrand()
        jobs, fn = [(r, setname, False) for r in df.to_dict("records")], job_plain
    elif setname in ("manip_test", "manip_dev"):
        df = loaders.libri_manip_sources("test-clean" if setname == "manip_test" else "dev-clean",
                                         5 if setname == "manip_test" else 2)
        jobs, fn = [(r, setname, MANIP_CROP_S) for r in df.to_dict("records")], job_manip
    elif setname == "manip_hill":
        df = manip_hill_sources()
        jobs, fn = [(r, setname, None) for r in df.to_dict("records")], job_manip
    elif setname == "synth":
        vd = SY.fill_formants(loaders.vowdata())
        vd = vd[np.isfinite(vd.F1) & np.isfinite(vd.F2) & np.isfinite(vd.F3) & np.isfinite(vd.f0)]
        jobs, fn = [(r,) for r in vd.to_dict("records")], job_synth
    elif setname == "sessions":
        from rlab.paths import SESSION_IDS, sessions_dir
        sessions_dir()  # fail fast with a clear message when SYRINX_SESSIONS_DIR is unset
        jobs, fn = [(s,) for s in SESSION_IDS], job_sessions
    else:
        raise SystemExit(f"unknown set {setname}")
    os.makedirs(os.path.join(AUDIO, setname), exist_ok=True)
    rows = []
    with ProcessPoolExecutor(workers) as ex:
        for i, r in enumerate(ex.map(fn, jobs, chunksize=1 if fn in (job_manip, job_sessions) else 8)):
            rows += r if isinstance(r, list) else [r]
            if (i + 1) % 200 == 0:
                print(f"  {setname}: {i + 1}/{len(jobs)}", flush=True)
    m = pd.DataFrame(rows)
    m["set"] = setname
    if "order" not in m.columns:
        m["order"] = m.groupby("speaker").cumcount()
    m.to_parquet(os.path.join(MANIFESTS, f"{setname}.parquet"))
    return m


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--sets", default=",".join(ALL_SETS))
    ap.add_argument("--workers", type=int, default=max(1, (os.cpu_count() or 4) - 2))
    ap.add_argument("--force", action="store_true")
    a = ap.parse_args()
    for s in a.sets.split(","):
        mp = os.path.join(MANIFESTS, f"{s}.parquet")
        if os.path.exists(mp) and not a.force:
            print(f"{s}: exists ({len(pd.read_parquet(mp))} items) — skip (use --force)")
            continue
        m = build(s, a.workers)
        print(f"{s}: {len(m)} items, {m.dur_s.sum() / 3600:.2f} h audio, "
              f"{m.voiced_s.sum() / 3600:.2f} h voiced; groups {m.group.value_counts().to_dict()}", flush=True)


if __name__ == "__main__":
    main()
