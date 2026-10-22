"""Build the Perceived Voice gate measurement's audio sets as 16 kHz float32 streams
(public data only) — measurements/perceived-voice-gate-2026-10-07.md.

  python scripts/perceived-voice-gate/prep.py <set> [<set> ...] [--pvqd-demographics=<Demographics.xlsx>]

Sets (each built in its own process run for reproducible random streams):
  chan      16 LibriSpeech test-clean speakers (8 women, 8 men) x 9 channel conditions
            (clean, -20 dB, phone band, laptop mic, 0.5 s reverb, pink 0 dB, real noise
            10 / 0 dB, 6-talker babble 10 dB), 2 s of the condition's background before
            (jobs_chan.full.json: all 38 speakers x 12 conditions, incl. pink 10 dB, babble 0 dB,
            1.0 s reverb — the 38-speaker set of measurements/low-voice-noise-2026-10-07.md)
  chandev   the same builder over LibriSpeech dev-clean (39 speakers x 12 conditions, all
            measured): held-out set of measurements/low-voice-noise-2026-10-07.md
  noise     100 noise-only clips (<= 30 s): Freesound, DCASE, MS-SNSD, DEMAND, ESC-50
  voiced    VOICED sustained /a/ (healthy + 40 clinical)
  vocalset  VocalSet long tones (/a/, /i/)
  pvqd      PVQD CAPE-V recordings (sentences, then sustained vowels)
  dyn       LibriSpeech woman <-> man changes: swaps, pauses 0.6-4 s, same-speaker moves
  ls        the chan speakers' clean utterances: orig / slow15 / slow20 (Praat overlap-add
            lengthening, pitch kept) / mono (F0 flattened at the median) / mono_slow15
  pv        PVQD sentence portions (before the first held vowel), the 20 women + 20 men with
            the lowest CAPE-V severity: orig / mono / slow15
  vo        vocadito solo singing (40 clips)

Sources (no private data is ever read):
  - LibriSpeech + Praat F0 tracks: the resonance lab's benchmark manifests
    (r1_test, r1_dev, manip_test) under $SYRINX_RLAB_BUILD (default build/resonance-lab;
    built by scripts/resonance-lab/build_bench.py).
  - Noise / voice corpora: the notch real-data build under $NOTCHVD_ROOT (default
    build/notchvd; scripts/notch-adversarial/realdata/fetch_noise.py, fetch_voice.py,
    build_index.py). Only the public sources named above are used.
  - PVQD speaker sex: the database's Demographics.xlsx (--pvqd-demographics or
    $SYRINX_PVQD_DEMOGRAPHICS), needed for pvqd and pv.
Outputs go to build/perceived-voice-gate/sets/ (jobs_<set>.json = the measured subset,
jobs_<set>.full.json = everything built, meta_<set>.json).
"""
import sys, os, json, re
import numpy as np
import pandas as pd
from scipy.signal import butter, sosfilt, fftconvolve, lfilter

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
sys.path.insert(0, os.path.join(HERE, "..", "resonance-lab"))
from common import SR, SETS, REPO, f32_write  # noqa: E402
from rlab import audio as A  # noqa: E402
from rlab.f0 import F0Track  # noqa: E402

ARGS = dict((a[2:].split("=", 1) + ["1"])[:2] for a in sys.argv[1:] if a.startswith("--"))
RLAB_BUILD = os.environ.get("SYRINX_RLAB_BUILD", os.path.join(REPO, "build", "resonance-lab"))
NV = os.environ.get("NOTCHVD_ROOT", os.path.join(REPO, "build", "notchvd"))
PVQD_DEMO = ARGS.get("pvqd-demographics", os.environ.get("SYRINX_PVQD_DEMOGRAPHICS", ""))
PUBLIC_NOISE = ["freesound", "dcase", "mssnsd", "demand", "esc50"]
rng = np.random.default_rng(20261006)


def fixpath(p):
    """Manifest paths may name another checkout's build/ or tests/dsp/data."""
    if os.path.exists(p):
        return p
    q = p.replace("\\", "/")
    if "/build/resonance-lab/" in q:
        return os.path.join(RLAB_BUILD, q.split("/build/resonance-lab/", 1)[1])
    if "/tests/dsp/data/" in q:
        from rlab.paths import corpus_dir
        sub, rest = q.split("/tests/dsp/data/", 1)[1].split("/", 1)
        return os.path.join(corpus_dir(sub), rest)
    return p


def manifest(name):
    m = pd.read_parquet(os.path.join(RLAB_BUILD, "bench", "manifests", f"{name}.parquet"))
    m["path"] = m["path"].map(fixpath)
    if "f0_path" in m:
        m["f0_path"] = m["f0_path"].map(fixpath)
    return m


def floor_noise(n, dbfs=-70):
    return rng.standard_normal(n) * 10 ** (dbfs / 20)


def pink(n):
    X = np.fft.rfft(rng.standard_normal(n)); f = np.arange(len(X)); f[0] = 1
    y = np.fft.irfft(X / np.sqrt(f), n); return y / A.rms(y)


def voiced_level(x, f0_path):
    tr = F0Track.load(f0_path); v = np.zeros(len(x), bool)
    for tt in tr.t[tr.f0 > 0]:
        v[int(max(0, (tt - 0.005) * SR)):int(min(len(x), (tt + 0.005) * SR))] = True
    return A.rms(x[v]) if v.any() else A.rms(x)


def peaking(x, f0, gain_db, q):
    Aa = 10 ** (gain_db / 40); w0 = 2 * np.pi * f0 / SR; al = np.sin(w0) / (2 * q)
    b = [1 + al * Aa, -2 * np.cos(w0), 1 - al * Aa]; a = [1 + al / Aa, -2 * np.cos(w0), 1 - al / Aa]
    return lfilter(np.array(b) / a[0], np.array(a) / a[0], x)


def laptop(x):
    y = sosfilt(butter(2, 200, "high", fs=SR, output="sos"), x)
    y = peaking(y, 4000, 6.0, 1.0)
    return sosfilt(butter(4, 7000, "low", fs=SR, output="sos"), y)


def reverb(x, rt60):
    n = int(1.2 * rt60 * SR); t = np.arange(n) / SR
    h = rng.standard_normal(n) * np.exp(-6.91 * t / rt60); h[:40] = 0
    h = h / np.sqrt(np.sum(h ** 2)); h[0] = 1.0
    return fftconvolve(x, h)[:len(x)]


def noise_index():
    d = json.load(open(f"{NV}/data/index_noise.json"))
    return [r for r in d if r["source"] in PUBLIC_NOISE and r.get("label") not in (None, "floor") and r["dur"] >= 10]


def load_nv(rel):
    x, sr = A.read_any(f"{NV}/data/{rel}"); return A.to16k(x, sr).astype(np.float64)


def pvqd_sex():
    if not PVQD_DEMO:
        raise SystemExit("pvqd / pv need the PVQD Demographics.xlsx: --pvqd-demographics=<path> "
                         "or $SYRINX_PVQD_DEMOGRAPHICS")
    demo = pd.read_excel(PVQD_DEMO); demo.columns = [str(c).strip() for c in demo.columns]
    demo["pid"] = demo["Participant ID"].astype(str).str.strip().str.upper()
    return {r.pid: {"FEMALE": "f", "MALE": "m", "F": "f", "M": "m"}.get(str(r.Gender).strip().upper(), "?")
            for r in demo.itertuples()}


def pvqd_pid(iid):
    return re.sub(r"_?ENSS.*$", "", iid.split("__")[1], flags=re.I).split("_")[0].upper()


def save(set_, jobs, meta, keep=None):
    os.makedirs(SETS, exist_ok=True)
    json.dump(jobs, open(f"{SETS}/jobs_{set_}.full.json", "w"))
    sub = jobs if keep is None else [j for j in jobs if j["id"] in set(keep)]
    json.dump(sub, open(f"{SETS}/jobs_{set_}.json", "w"))
    pd.DataFrame(meta).to_json(f"{SETS}/meta_{set_}.json", orient="records")
    print(set_, len(jobs), "built,", len(sub), "measured,",
          f"{sum(os.path.getsize(j['f32']) for j in sub) / 4 / SR / 60:.1f} min")


# ---------------------------------------------------------------------------

def chan(man="r1_test", set_="chan"):
    """`chan`: LibriSpeech test-clean (r1_test). `chandev`: the same builder over dev-clean (r1_dev),
    every speaker x all 12 conditions measured — the held-out set of
    measurements/low-voice-noise-2026-10-07.md (built in its own run, own seed)."""
    m = manifest(man)
    m = m[(m.order < 8) & (m.dur_s >= 6) & (m.dur_s <= 14)]
    src = m.groupby("speaker").head(1)
    bab_pool = manifest(man); bab_pool = bab_pool[bab_pool.order >= 20]
    nz = [r for r in noise_index() if r["label"] in ("stationary-tonal", "mixed", "broadband")]
    jobs, meta = [], []
    LEAD, TAIL = 2.0, 1.0
    for _, r in src.iterrows():
        x = A.load(r.path).astype(np.float64); lev = voiced_level(x, r.f0_path)
        nl, nt = int(LEAD * SR), int(TAIL * SR)
        xs = np.concatenate([np.zeros(nl), x, np.zeros(nt)]); N = len(xs)
        others = bab_pool[bab_pool.speaker != r.speaker].sample(6, random_state=int(rng.integers(1e9)))
        bab = np.zeros(N)
        for _, o in others.iterrows():
            z = A.load(o.path).astype(np.float64); z = np.resize(z, N); bab += z / A.rms(z)
        bab /= A.rms(bab)
        rn = nz[int(rng.integers(len(nz)))]; z = load_nv(rn["path"]); z = np.resize(z, N); z /= A.rms(z)
        pk = pink(N)
        conds = {
            "clean": xs + floor_noise(N),
            "pink10": xs + pk * lev * 10 ** (-10 / 20), "pink0": xs + pk * lev,
            "babble10": xs + bab * lev * 10 ** (-10 / 20), "babble0": xs + bab * lev,
            "real10": xs + z * lev * 10 ** (-10 / 20), "real0": xs + z * lev,
            "phone": sosfilt(butter(4, [300, 3400], "band", fs=SR, output="sos"), xs) + floor_noise(N),
            "laptop": laptop(xs) + floor_noise(N),
            "reverb05": reverb(xs, 0.5) + floor_noise(N), "reverb10": reverb(xs, 1.0) + floor_noise(N),
            "quiet20": xs * 0.1 + floor_noise(N),
        }
        for c, y in conds.items():
            iid = f"{r.item_id}.{c}"; p = f"{SETS}/{set_}/{iid}.f32"; f32_write(p, y)
            jobs.append(dict(id=iid, f32=p))
            meta.append(dict(id=iid, src=r.item_id, cond=c, speaker=r.speaker, sex=r.sex, f0_median=r.f0_median,
                             lead_s=LEAD, voice_s=len(x) / SR, noise_id=rn["id"] if c.startswith("real") else "",
                             noise_label=rn["label"] if c.startswith("real") else "", f0_path=r.f0_path))
    if set_ != "chan":
        save(set_, jobs, meta)
        return
    mm = pd.DataFrame(meta)
    spk = mm.drop_duplicates("speaker")
    sel = list(spk[spk.sex == "m"].speaker[:8]) + list(spk[spk.sex == "f"].speaker[:8])
    conds = ["clean", "pink0", "babble10", "real10", "real0", "phone", "laptop", "reverb05", "quiet20"]
    save("chan", jobs, meta, mm[mm.speaker.isin(sel) & mm.cond.isin(conds)].id)


def chandev():
    global rng
    rng = np.random.default_rng(20261007)
    chan("r1_dev", "chandev")


def noise():
    jobs, meta = [], []
    for r in sorted(noise_index(), key=lambda r: r["id"]):
        x = load_nv(r["path"])[:30 * SR]
        p = f"{SETS}/noise/{r['id']}.f32"; f32_write(p, x); jobs.append(dict(id=r["id"], f32=p))
        meta.append(dict(id=r["id"], source=r["source"], label=r["label"], dur=len(x) / SR,
                         rms_dbfs=20 * np.log10(A.rms(x) + 1e-12)))
    mm = pd.DataFrame(meta); ids = []
    for lab, q in mm.groupby("label"):
        k = {"stationary-tonal": 35, "mixed": 35, "broadband": 20, "intermittent-tonal": 10}.get(lab, 0)
        ids += list(q.sample(min(k, len(q)), random_state=3).id)
    save("noise", jobs, meta, ids)


def voice_set(name, source, keep=lambda r: True, subset=None):
    d = [r for r in json.load(open(f"{NV}/data/index_voice.json")) if r["source"] == source and keep(r)]
    sexmap = pvqd_sex() if source == "pvqd" else None
    jobs, meta = [], []
    for r in sorted(d, key=lambda r: r["id"]):
        x = load_nv(r["path"]); x = np.concatenate([floor_noise(SR), x, floor_noise(SR // 2)])  # 1 s room lead, 0.5 s tail
        p = f"{SETS}/{name}/{r['id']}.f32"; f32_write(p, x); jobs.append(dict(id=r["id"], f32=p))
        sex = sexmap.get(pvqd_pid(r["id"]), "?") if sexmap else r.get("gender")
        meta.append(dict(id=r["id"], lead_s=1.0, gender=r.get("gender"), sex=sex, singer=r.get("singer"),
                         cls=r.get("class"), diagnosis=r.get("diagnosis"), f0_median=r.get("f0_median"),
                         held=json.dumps(r.get("held", [])), dur=r["dur"]))
    save(name, jobs, meta, subset(pd.DataFrame(meta)) if subset else None)


def dyn():
    m = manifest("r1_test"); m = m[(m.dur_s >= 6) & (m.dur_s <= 12)]
    men = m[m.sex == "m"].groupby("speaker").tail(1).reset_index(drop=True)
    women = m[m.sex == "f"].groupby("speaker").tail(1).reset_index(drop=True)
    jobs, meta = [], []

    def add(iid, parts, info):
        y = np.concatenate([np.zeros(int(1.0 * SR))] + parts + [np.zeros(int(1.0 * SR))]); y = y + floor_noise(len(y))
        p = f"{SETS}/dyn/{iid}.f32"; f32_write(p, y); jobs.append(dict(id=iid, f32=p)); meta.append(dict(id=iid, **info))

    def ld(r, maxs=6.0):
        x = A.load(r.path).astype(np.float64)[: int(maxs * SR)]; return x / A.rms(x) * 0.05
    for i in range(20):  # speaker swaps, no gap
        a, b = men.iloc[i], women.iloc[i]
        xa, xb = ld(a), ld(b)
        add(f"swap_mf_{i:02d}", [xa, xb], dict(kind="swap", dir="m2f", a=a.item_id, b=b.item_id, t_change=1.0 + len(xa) / SR, gap=0.0))
        add(f"swap_fm_{i:02d}", [xb, xa], dict(kind="swap", dir="f2m", a=b.item_id, b=a.item_id, t_change=1.0 + len(xb) / SR, gap=0.0))
    for i in range(8):  # pauses between different-sex speakers
        a, b = men.iloc[i], women.iloc[i]; xa, xb = ld(a, 5), ld(b, 5)
        for gap in (0.3, 0.6, 1.0, 1.5, 2.5, 4.0):
            g = np.zeros(int(gap * SR))
            add(f"pause_mf_{i:02d}_{gap}", [xa, g, xb], dict(kind="pause", dir="m2f", a=a.item_id, b=b.item_id, t_change=1.0 + len(xa) / SR + gap, gap=gap))
            add(f"pause_fm_{i:02d}_{gap}", [xb, g, xa], dict(kind="pause", dir="f2m", a=b.item_id, b=a.item_id, t_change=1.0 + len(xb) / SR + gap, gap=gap))
    mt = manifest("manip_test")  # same speaker: natural -> Praat-manipulated, different utterances
    for spk, g in mt.groupby("speaker"):
        sex = g.sex.iloc[0]; utts = sorted(g.src_item.unique())
        orig = g[(g.src_item == utts[0]) & (g.cond == "orig")].iloc[0]
        tgt = g[(g.src_item == utts[1]) & (g.cond == ("mf+8_f1.10" if sex == "m" else "fm-8_f0.90"))]
        if len(tgt) == 0:
            continue
        tgt = tgt.iloc[0]
        xa = A.load(orig.path).astype(np.float64); xb = A.load(tgt.path).astype(np.float64)
        s = 0.05 / A.rms(xa); xa, xb = xa * s, xb * (0.05 / A.rms(xb))
        add(f"move_{spk}", [xa, xb], dict(kind="move", dir="m2f" if sex == "m" else "f2m", a=orig.item_id, b=tgt.item_id, t_change=1.0 + len(xa) / SR, gap=0.0))
    mm = pd.DataFrame(meta)
    keep = mm[((mm.kind == "swap") & (mm.id.str.extract(r"_([0-9][0-9])$")[0].astype(float) < 12)) |
              ((mm.kind == "pause") & mm.gap.isin([0.6, 1.5, 2.5, 4.0]) & mm.id.str.contains(r"_0[0-3]_")) |
              (mm.kind == "move")]
    mv = keep[keep.kind == "move"]
    drop = set(mv[mv.dir == "m2f"].id[10:]) | set(mv[mv.dir == "f2m"].id[10:])
    save("dyn", jobs, meta, [i for i in keep.id if i not in drop])


# ---------------------------------------------------------------------------
# Held-phonation adversarial sets (flat intonation, slow speech, singing).

ADV_RNG = np.random.default_rng(1007)


def adv_floor(n):
    return ADV_RNG.standard_normal(n) * 10 ** (-70 / 20)


def praat_median(snd, lo, hi):
    p = snd.to_pitch_ac(time_step=0.01, pitch_floor=lo, pitch_ceiling=hi)
    f = p.selected_array["frequency"]; f = f[f > 0]
    return float(np.median(f)) if len(f) else 150.0


def mono(x, lo, hi):
    import parselmouth
    from parselmouth.praat import call
    snd = parselmouth.Sound(x, SR)
    med = praat_median(snd, lo, hi)
    man = call(snd, "To Manipulation", 0.01, lo, hi)
    pt = call("Create PitchTier", "flat", 0, snd.duration)
    call(pt, "Add point", snd.duration / 2, med)
    call([pt, man], "Replace pitch tier")
    return call(man, "Get resynthesis (overlap-add)").values[0].astype(np.float64)


def slow(x, lo, hi, k):
    import parselmouth
    from parselmouth.praat import call
    return call(parselmouth.Sound(x, SR), "Lengthen (overlap-add)", lo, hi, k).values[0].astype(np.float64)


def adv_write(set_, iid, y, info, jobs, meta):
    y = y / (np.sqrt(np.mean(y ** 2)) + 1e-12) * 0.05
    ys = np.concatenate([adv_floor(SR), y + adv_floor(len(y)), adv_floor(SR)])
    p = f"{SETS}/{set_}/{iid}.f32"; f32_write(p, ys)
    jobs.append(dict(id=iid, f32=p)); meta.append(dict(id=iid, lead_s=1.0, voice_s=len(y) / SR, **info))


def ls():
    src = pd.read_json(f"{SETS}/meta_chan.json")
    keep = {j["id"] for j in json.load(open(f"{SETS}/jobs_chan.json"))}
    src = src[(src.cond == "clean") & src.id.isin(keep)]
    man = manifest("r1_test").set_index("item_id")
    jobs, meta = [], []
    for _, r in src.iterrows():
        x = A.load(man.loc[r.src, "path"]).astype(np.float64)
        lo, hi = (60, 300) if r.sex == "m" else (100, 500)
        vs = {"orig": x, "slow15": slow(x, lo, hi, 1.5), "slow20": slow(x, lo, hi, 2.0), "mono": mono(x, lo, hi)}
        vs["mono_slow15"] = slow(vs["mono"], lo, hi, 1.5)
        for v, y in vs.items():
            adv_write("ls", f"{r.src}.{v}", y, dict(src=r.src, var=v, sex=r.sex), jobs, meta)
    save("ls", jobs, meta)


def pv():
    d = [r for r in json.load(open(f"{NV}/data/index_voice.json")) if r["source"] == "pvqd"]
    sexmap = pvqd_sex()
    rows = []
    for r in d:
        sex = sexmap.get(pvqd_pid(r["id"]), "?")
        held = r.get("held") or []
        if sex not in ("f", "m") or not held:
            continue
        end = min(h[0] for h in held) - 0.5
        if end < 6:
            continue
        rows.append((r.get("capev_severity") or 999, r["id"], r["path"], sex, end))
    rows.sort()
    pick = [x for x in rows if x[3] == "f"][:20] + [x for x in rows if x[3] == "m"][:20]
    jobs, meta = [], []
    for sev, iid, path, sex, end in pick:
        x = load_nv(path)[: int(end * SR)]
        lo, hi = (60, 300) if sex == "m" else (100, 500)
        vs = {"orig": x, "mono": mono(x, lo, hi), "slow15": slow(x, lo, hi, 1.5)}
        for v, y in vs.items():
            adv_write("pv", f"{iid}.{v}", y, dict(src=iid, var=v, sex=sex, sev=sev), jobs, meta)
    save("pv", jobs, meta)


def vo():
    d = [r for r in json.load(open(f"{NV}/data/index_voice.json")) if r["source"] == "vocadito"]
    jobs, meta = [], []
    for r in sorted(d, key=lambda r: r["id"]):
        adv_write("vo", r["id"], load_nv(r["path"]), dict(src=r["id"], var="orig", sex="?", f0_median=r.get("f0_median"),
                                                          held=json.dumps(r.get("held", []))), jobs, meta)
    save("vo", jobs, meta)


BUILDERS = {
    "chan": chan, "chandev": chandev, "noise": noise, "dyn": dyn, "ls": ls, "pv": pv, "vo": vo,
    "voiced": lambda: voice_set("voiced", "voiced", subset=lambda m: list(m[m.diagnosis == "healthy"].id)
                                + list(m[m.diagnosis != "healthy"].sample(40, random_state=2).id)),
    "vocalset": lambda: voice_set("vocalset", "vocalset", lambda r: r["class"] in ("long_tone_forte", "long_tone_pp"),
                                  subset=lambda m: m[m.id.str.endswith("_a") | m.id.str.endswith("_i")].id),
    "pvqd": lambda: voice_set("pvqd", "pvqd"),
}

if __name__ == "__main__":
    for s in [a for a in sys.argv[1:] if not a.startswith("--")]:
        BUILDERS[s]()
