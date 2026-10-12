# hval.py — custom voice detector, round 5 (pre-registration
# measurements/voice-detector-round5-preregistration-2026-10-12.md §2): the new
# VALIDATION ("practice") rows H1 (held phonation and hums next to steady
# machines) and H2 (long holds, clean and next to machines). VALIDATION SIDE
# ONLY: reads the rounds 1-2 val split (Coswara val vowels, SVD val
# sustained-vowel records, FSD50K eval / fstrain val / fsr4 val machine
# clips) and the validation-only generators (vsynth_val.py, vbeds.py). Every
# path read goes through c3.guard_not_conf (the sealed set is refused); the
# private session recordings, the old harness sets (VocalSet ...) and the
# round-4 review's streams are never read. No model runs here.
#
# Output (gitignored): build/vad-train/r5/hval/
#   beds.json     real-bed candidates (topic rule, S_stat / census, class) and the kept beds
#   voices.json   real voices: gated Praat track summary per record, the H1 lists and the H2 series per sex
#   plan.json     the synthetic holds per sex and family (grown by `grow`)
#   streams/h1.json, h2.json   valdump.mjs stream specs; audio/, refs/
#   dumps/        current-app dumps (ROOT=build/vad-train/r5/hval run-dumps.sh h1:2 h2:2)
#
#   beds      choose the real beds
#   voices    the real voices (Praat AC 60-1100 Hz, 10 ms, 30 dB level gate = round 3 §1.6, on the 16 kHz files)
#   build     render every stream of the plan that is not rendered yet; write the specs
#   counts    CORRECT hops per gating cell (H1) / bin (H2) and sex from the current-app dumps (aggregate; no model)
#             -> counts.json; `--grow` adds synthetic holds (next seeds) to every synthetic cell under 400
#   hash      sha256 of every H input (specs, audio, refs, dumps) -> build/vad-train/r5/sel/inputs.sha256
#
#   python scripts/voice-detector/r5/hval.py beds|voices|build|counts [--grow]|hash
import collections
import hashlib
import json
import os
import re
import sys
from math import gcd

import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
sys.path.insert(0, os.path.join(HERE, "..", "r3"))
sys.path.insert(0, os.path.join(HERE, "..", "r4"))
sys.path.insert(0, os.path.join(HERE, "..", "train"))
from c3 import DATA, ROOT, args, fnv1a, guard_not_conf, load_manifest, log, write_json  # noqa: E402

A = args()
R5 = os.path.join(ROOT, "r5")
HV = os.path.join(R5, "hval")
DATA4 = os.path.join(ROOT, "r4", "data")
SR16 = 16000
SEED = 20261012
BED_SEED = 20261013
SYN_SEED0 = 5_000_000_000
BED_SYN_SEED0 = 6_000_000_000
BANDS = {"m": (75.0, 130.0), "f": (160.0, 300.0)}
# The pre-registered topic pattern (§2.1), with a word-start boundary on every term and FSD50K's "_" read as a space
# (Addendum R5-B part 1): without them "hum" matched inside "Thump_and_thud" (waves, scissors), and any term could match
# inside a longer word. Terms still match as prefixes ("fans", "motorcycle", "engines"); "ac" stays a whole word.
TOPIC_RAW = r"(?i)(fan|air.?cond|\bac\b|hvac|ventil|blower|refrig|fridge|freezer|compressor|dehumid|hum|buzz|mains|transformer|generator|motor|idling|engine)"
TOPIC = re.compile(r"(?i)\b(fan|air.?cond|ac\b|hvac|ventil|blower|refrig|fridge|freezer|compressor|dehumid|hum|buzz|mains|transformer|generator|motor|idling|engine)")
CLASSES = [("air", re.compile(r"(?i)\b(fan|air.?cond|ac\b|hvac|ventil|blower)")),
           ("fridge", re.compile(r"(?i)\b(refrig|fridge|freezer|compressor|dehumid)")),
           ("mains", re.compile(r"(?i)\b(hum|buzz|mains|transformer)")),
           ("motor", re.compile(r"(?i)\b(motor|engine|idling|generator)"))]
SYN_KINDS = {"air": ["fan", "hvac", "aircon", "pcfan"], "fridge": ["fridge", "dehum"], "mains": ["mains", "xfmr50"], "motor": ["vmotor"]}
SNRS = (0, 10, 20)
RATES = [48000, 44100, 16000]
# synthetic hold index offsets per (family, sex): seed = SYN_SEED0 + offset + k
SYN_OFF = {("h1", "m"): 0, ("h1", "f"): 100_000, ("h2", "m"): 200_000, ("h2", "f"): 300_000}
N0 = {"h1": 80, "h2": 40}


def P(*a):
    return os.path.join(HV, *a)


def rd(path):
    import soundfile as sf
    x, sr = sf.read(guard_not_conf(path), dtype="float64", always_2d=True)
    return x[:, 0], int(sr)


def rs(x, s0, s1):
    if s0 == s1:
        return np.asarray(x, np.float64)
    from scipy.signal import resample_poly
    g = gcd(s0, s1)
    return resample_poly(np.asarray(x, np.float64), s1 // g, s0 // g)


def active_rms(x):
    pk = np.max(np.abs(x)) if len(x) else 0
    m = np.abs(x) > 0.02 * pk
    return float(np.sqrt(np.mean(np.square(x[m], dtype=np.float64)))) if m.any() else 0.0


def loop_bed(x, n, sr, fade_s=1.0):
    """The bed looped with linear cross-fades of fade_s (sessions.loop_bed at any rate)."""
    x = np.asarray(x, np.float64)
    if len(x) >= n:
        return x[:n].copy()
    nf = min(int(round(fade_s * sr)), len(x) // 2)
    out = x.copy()
    while len(out) < n:
        w = np.linspace(0, 1, nf)
        out[-nf:] = out[-nf:] * (1 - w) + x[:nf] * w
        out = np.concatenate([out, x[nf:]])
    return out[:n]


def praat_gated(x16):
    """Round 3 §1.6 reference: Praat AC 60-1100 Hz, 10 ms, frames under the 95th-percentile voiced level - 30 dB unvoiced."""
    import parselmouth
    from tcommon import frame_levels_db
    p = parselmouth.Sound(np.asarray(x16, float), sampling_frequency=SR16).to_pitch_ac(time_step=0.01, pitch_floor=60, pitch_ceiling=1100)
    t0 = float(p.xs()[0]) if p.n_frames else 0.0
    f0 = np.nan_to_num(p.selected_array["frequency"]).astype(np.float32)
    v = f0 > 0
    if v.any():
        lev = frame_levels_db(np.asarray(x16, np.float64), t0, 0.01, len(f0))
        f0 = np.where(v & (lev >= np.percentile(lev[v], 95) - 30.0), f0, 0).astype(np.float32)
    return t0, f0


# ----------------------------------------------------------------------------- beds
def bed_records():
    man = load_manifest()
    f4 = [json.loads(line) for line in open(os.path.join(DATA4, "manifest.fsr4.jsonl"), encoding="utf8") if line.strip()]
    out = []
    for r in list(man.values()) + f4:
        if r.get("kind") != "nonvoice" or r.get("split") != "val" or r.get("drop") or r["source"] not in ("fsd50k", "fstrain", "fsr4"):
            continue
        text = " ".join([",".join(r.get("labels") or []), r.get("query") or "", r.get("title") or ""]).replace("_", " ")
        out.append((r, text, os.path.join(DATA4 if r["source"] == "fsr4" else DATA, r["path"])))
    return out


def beds():
    import train_side_r4 as T
    thr = json.load(open(os.path.join(ROOT, "r4", "stat.json"), encoding="utf8"))["s_stat_threshold_lowest_third"]
    cands, raw_only = [], []
    for r, text, path in bed_records():
        if (r.get("dur") or 0) < 20.0:
            continue
        m = TOPIC.search(text)
        if not m:
            if re.search(TOPIC_RAW, text):
                raw_only.append({"id": r["id"], "text": text, "match": re.search(TOPIC_RAW, text).group(0)})
            continue
        cls = next(c for c, rx in CLASSES if rx.search(text))
        cands.append((r, text, path, cls, m.group(0)))
    log(f"beds: {len(cands)} val machine-topic clips >= 20 s; S_stat / census ...")
    from concurrent.futures import ProcessPoolExecutor
    with ProcessPoolExecutor(2) as ex:
        res = list(ex.map(T.job, [(r["id"], guard_not_conf(p), r.get("dur")) for r, _, p, _, _ in cands], chunksize=4))
    out = []
    for (r, text, path, cls, mt), st in zip(cands, res):
        steady = bool((st["s_stat"] is not None and st["s_stat"] <= thr) or st.get("census") == "stationary-tonal")
        out.append({"id": r["id"], "source": r["source"], "group": r.get("group"), "path": path, "dur": r.get("dur"), "text": text, "topic": mt, "cls": cls,
                    "s_stat": st["s_stat"], "census": st.get("census"), "steady": steady, "licence": r.get("licence"),
                    "licence_where": r.get("licence_where"), "attribution": r.get("attribution"), "url": r.get("url")})
    kept = sorted([b for b in out if b["steady"]], key=lambda b: (fnv1a("r5:" + b["id"]), b["id"]))
    by = collections.Counter(b["cls"] for b in kept)
    J = {"what": "round-5 §2.1 real beds: val-split machine-topic clips >= 20 s, steady by round 4's D2 rule", "s_stat_threshold": thr,
         "candidates": len(out), "matched_only_without_word_boundaries": raw_only, "kept": len(kept), "kept_by_class": dict(by),
         "classes_filled_with_synthetic": [c for c, _ in CLASSES if by[c] < 3],
         "kept_by_source": dict(collections.Counter(b["source"] for b in kept)), "licences_kept": dict(collections.Counter(b["licence"] for b in kept)),
         "beds": kept, "rejected_not_steady": [{k: b[k] for k in ("id", "cls", "s_stat", "census")} for b in out if not b["steady"]]}
    write_json(P("beds.json"), J, indent=1)
    log("beds:", {k: J[k] for k in ("candidates", "kept", "kept_by_class", "classes_filled_with_synthetic", "kept_by_source", "licences_kept")})


# ----------------------------------------------------------------------------- voices
def voices():
    from concurrent.futures import ThreadPoolExecutor
    man = load_manifest()
    recs = [r for r in man.values() if not r.get("drop") and r.get("split") == "val" and r["kind"] == "voice" and r.get("gender") in ("f", "m")
            and ((r["source"] == "coswara" and r["recording"] in ("vowel-a", "vowel-e", "vowel-o")) or r["source"] == "svd")]
    old = {}
    if os.path.exists(P("voices.json")):
        old = {v["id"]: v for v in json.load(open(P("voices.json"), encoding="utf8"))["records"]}

    def one(r):
        if r["id"] in old:
            return old[r["id"]]
        x16, sr = rd(os.path.join(DATA, r["path"]))
        assert sr == SR16
        t0, g = praat_gated(x16)
        os.makedirs(P("praat"), exist_ok=True)
        np.savez(P("praat", r["id"] + ".npz"), t0=t0, f0=g)
        nat = os.path.join(DATA, r.get("native_path") or r["path"])
        h1 = g[: int(round((30.0 - t0) / 0.01))] if r["source"] == "svd" else g
        return {"id": r["id"], "source": r["source"], "sex": r["gender"], "person": r["group"], "recording": r.get("recording") or r.get("session"),
                "path16": r["path"], "native": os.path.relpath(nat, DATA), "native_sr": int(r.get("native_sr") or r["sr"]), "dur": r["dur"],
                "t0": t0, "voiced_sec": round(float((g > 0).sum()) * 0.01, 2),
                "median_f0_h1": float(np.median(h1[h1 > 0])) if (h1 > 0).any() else None, "licence": r["licence"],
                "session": int(r["session"]) if r["source"] == "svd" else None}

    with ThreadPoolExecutor(2) as ex:
        res = list(ex.map(one, recs))
    # H1: in-band records, <= 2 per person, <= 100 per sex, FNV-1a order of "r5:" + id
    h1 = {}
    for sx in ("m", "f"):
        lo, hi = BANDS[sx]
        cand = sorted([v for v in res if v["sex"] == sx and v["median_f0_h1"] and lo <= v["median_f0_h1"] <= hi], key=lambda v: (fnv1a("r5:" + v["id"]), v["id"]))
        per, out = collections.Counter(), []
        for v in cand:
            if per[v["person"]] >= 2:
                continue
            per[v["person"]] += 1
            out.append(v["id"])
            if len(out) == 100:
                break
        h1[sx] = out
    # H2: series per person (Coswara a, e, o; SVD sessions in order), >= 30 s Praat-voiced; <= 60 per sex, FNV-1a of "r5:" + person
    by = collections.defaultdict(list)
    for v in res:
        by[(v["sex"], v["person"])].append(v)
    h2 = {}
    for sx in ("m", "f"):
        ser = []
        for (s2, person), vs in by.items():
            if s2 != sx:
                continue
            vs = sorted(vs, key=lambda v: (v["recording"] if v["source"] == "coswara" else "", v["session"] or 0))
            if sum(v["voiced_sec"] for v in vs) < 30.0:
                continue
            ser.append((person, [v["id"] for v in vs]))
        ser.sort(key=lambda t: (fnv1a("r5:" + t[0]), t[0]))
        h2[sx] = [{"person": p, "items": ids} for p, ids in ser[:60]]
    J = {"what": "round-5 §2.3 / §2.4 real voices (val split): gated Praat reference summary; H1 lists; H2 series",
         "records": sorted(res, key=lambda v: v["id"]), "h1": h1, "h2": h2,
         "summary": {"records": len(res), "h1": {k: len(v) for k, v in h1.items()},
                     "h1_by_source": {k: dict(collections.Counter(i.split("__")[0] for i in v)) for k, v in h1.items()},
                     "h2": {k: len(v) for k, v in h2.items()},
                     "h2_by_source": {k: dict(collections.Counter(s["items"][0].split("__")[0] for s in v)) for k, v in h2.items()}}}
    write_json(P("voices.json"), J, indent=1)
    log("voices:", J["summary"])


# ----------------------------------------------------------------------------- the synthetic plan
def syn_params(fam, sx, k):
    """Hold k of (family, sex): deterministic from its seed (SYN_SEED0 + offset + k)."""
    seed = SYN_SEED0 + SYN_OFF[(fam, sx)] + k
    rng = np.random.default_rng(seed)
    kind = ["hum", "a", "hum", "o"][k % 4]
    qual = ["modal", "soft", "breathy"][k % 3]
    vib = k % 8 in (1, 6)                       # a quarter, hums and vowels alike
    if fam == "h1":
        lo, hi = BANDS[sx]
        dur = float(rng.uniform(10.0, 20.0))
        wander = float(rng.uniform(6.0, 40.0))
    else:
        lo, hi = ((75.0, 130.0) if k % 2 == 0 else (75.0, 160.0)) if sx == "m" else ((160.0, 300.0) if k % 2 == 0 else (160.0, 400.0))
        dur = [30.0, 45.0, 60.0][k % 3]
        wander = float(rng.uniform(3.0, 12.0))        # straight holds: wander <= 12 cents
    f0 = float(np.exp(rng.uniform(np.log(lo), np.log(hi))))
    v = (float(rng.uniform(5.0, 6.0)), float(rng.uniform(30.0, 60.0))) if vib else None
    return {"seed": seed, "k": k, "f0": round(f0, 3), "kind": kind, "qual": qual, "vib": v, "dur": round(dur, 3), "wander": round(wander, 3),
            "tract": 1.0 if sx == "m" else 1.17, "sr": RATES[k % 3]}


def plan():
    p = P("plan.json")
    if os.path.exists(p):
        return json.load(open(p, encoding="utf8"))
    J = {f"{fam}|{sx}": N0[fam] for fam in ("h1", "h2") for sx in ("m", "f")}
    write_json(p, J, indent=1)
    return J


# ----------------------------------------------------------------------------- streams
class Beds:
    """Bed choice (§2.2): the class rotates over air / fridge / mains / motor in a seeded order (seed 20261013), per family in
    construction order; within a class a real and a synthetic bed alternate (real first); a class with < 3 real clips is synthetic
    only. Real clips: FNV order, cycling. Synthetic kinds cycle within the class; seeds 6e9 + i."""

    def __init__(self, fam):
        B = json.load(open(P("beds.json"), encoding="utf8"))
        self.real = collections.defaultdict(list)
        for b in B["beds"]:
            self.real[b["cls"]].append(b)
        self.perm = [CLASSES[i][0] for i in np.random.default_rng(BED_SEED).permutation(len(CLASSES))]
        self.fam = fam
        self.j = 0
        self.kc = collections.Counter()
        self.rc = collections.Counter()
        self.sc = collections.Counter()
        self.si = 0
        self.cache = {}

    def next(self):
        cls = self.perm[self.j % len(self.perm)]
        self.j += 1
        k = self.kc[cls]
        self.kc[cls] += 1
        if len(self.real[cls]) >= 3 and k % 2 == 0:
            b = self.real[cls][self.rc[cls] % len(self.real[cls])]
            self.rc[cls] += 1
            return {"type": "real", "cls": cls, "id": b["id"], "path": b["path"], "source": b["source"], "licence": b["licence"]}
        kinds = SYN_KINDS[cls]
        kind = kinds[self.sc[cls] % len(kinds)]
        self.sc[cls] += 1
        seed = BED_SYN_SEED0 + (0 if self.fam == "h1" else 500_000) + self.si
        self.si += 1
        return {"type": "synthetic", "cls": cls, "kind": kind, "seed": seed}

    def render(self, b, n, sr):
        if b["type"] == "real":
            key = (b["path"], sr)
            if key not in self.cache:
                x, s0 = rd(b["path"])
                self.cache = {key: rs(x, s0, sr)}
            return loop_bed(self.cache[key], n, sr)
        from vbeds import bed
        return bed(b["kind"], sr, n / sr + 0.01, seed=b["seed"])[:n].astype(np.float64)


def phone_eq(x, sr):
    """The round-4 review's phone-microphone EQ (build_holds.py): 250 Hz high-pass, +8 dB at 3 kHz (Q 1.2), 7 kHz low-pass."""
    from scipy.signal import butter, lfilter, sosfilt
    y = sosfilt(butter(3, 250, "highpass", fs=sr, output="sos"), x)
    Ag = 10 ** (8 / 40)
    w = 2 * np.pi * 3000 / sr
    al = np.sin(w) / (2 * 1.2)
    b = [1 + al * Ag, -2 * np.cos(w), 1 - al * Ag]
    a = [1 + al / Ag, -2 * np.cos(w), 1 - al / Ag]
    y = lfilter(np.array(b) / a[0], np.array(a) / a[0], y)
    return sosfilt(butter(6, min(7000, 0.45 * sr), "lowpass", fs=sr, output="sos"), y)


def render_stream(sid, voice, ref, sr, lead, cond, bedsel, eq, meta, specs, fam, sex, episodes):
    """voice: float64 at sr (unit-free; scaled to the stream's level), placed after `lead`; ref: 10 ms F0 track of the voice (t0 0)."""
    import soundfile as sf
    rng = np.random.default_rng([SEED, fnv1a(sid)])
    lvl = -26.0 + float(rng.uniform(-6.0, 6.0))
    v = voice * (10 ** (lvl / 20) / max(active_rms(voice), 1e-12))
    n = int(round((lead + len(voice) / sr + 5.0) * sr))
    a = int(round(lead * sr))
    y = np.zeros(n)
    y[a:a + len(v)] += v[: n - a]
    bmeta = {}
    if cond == "clean":
        y += np.random.default_rng([SEED, fnv1a(sid), 1]).standard_normal(n) * 10 ** (-70 / 20)
    else:
        b = bedsel.next()
        nz = bedsel.render(b, n, sr)
        nr = float(np.sqrt(np.mean(np.square(nz))))
        y += nz * (10 ** (lvl / 20) / 10 ** (int(cond[3:]) / 20) / max(nr, 1e-12))
        bmeta = {"bed": b}
    if eq:
        y = phone_eq(y, sr)
    pk = float(np.max(np.abs(y)))
    sc = 1.0 if pk <= 0.999 else 0.999 / pk
    wp = P("audio", fam, sid + ".wav")
    os.makedirs(os.path.dirname(wp), exist_ok=True)
    sf.write(wp, (y * sc).astype(np.float32), sr, subtype="PCM_16")
    rf = np.zeros(int(np.ceil(n / sr / 0.01)) + 1, np.float32)
    j0 = int(round(lead / 0.01))
    m = min(len(ref), len(rf) - j0)
    rf[j0:j0 + m] = ref[:m]
    rp = P("refs", sid + ".f32")
    os.makedirs(os.path.dirname(rp), exist_ok=True)
    rf.astype("<f4").tofile(rp)
    eps = [{"start": round(lead + e["start"], 4), "dur": e["dur"]} for e in episodes]
    specs.append({"id": sid, "gender": sex, "audio": {"path": wp, "fmt": "wav", "sr": sr, "start": 0, "len": n},
                  "ref": {"kind": "praat", "path": rp, "t0": 0.0, "hop": 0.01},
                  "holds": [[e["start"], round(e["start"] + e["dur"], 4)] for e in eps],
                  "meta": dict(meta, family=fam, cond=cond, lead=lead, level_db=round(lvl, 2), eq="phone" if eq else "flat", gain_scale=sc,
                               voice_t0=lead, voice_t1=round(lead + len(voice) / sr, 4), episodes=eps, **bmeta)})


def lead_of(sid):
    return 60.0 if fnv1a("r5lead:" + sid) % 3 == 2 else 20.0


def build():
    V = json.load(open(P("voices.json"), encoding="utf8"))
    recs = {v["id"]: v for v in V["records"]}
    PL = plan()
    from vsynth_val import synth
    conds_h1 = ["clean"] + [f"snr{s:+d}" for s in SNRS]
    conds = {"h1_syn": conds_h1, "h1_real": conds_h1, "h2_syn": ["clean", "snr+20", "snr+10", "snr+0"], "h2_real": ["clean", "snr+10", "snr+0"]}
    for fam in ("h1", "h2"):
        sp = P("streams", f"{fam}.json")
        old = {s["id"]: s for s in (json.load(open(sp, encoding="utf8")) if os.path.exists(sp) else [])}
        specs = []
        bedsel = Beds(fam)
        nsyn = 0
        items = []                      # (sex, voicekind, voice id, builder)
        # construction order (fixes the bed rotation and the phone-EQ alternation): real voices (men, women), then the synthetic
        # holds interleaved by index k (men k, women k), so holds added by `counts --grow` come last and never move an earlier stream
        for sx in ("m", "f"):
            if fam == "h1":
                for rid in V["h1"][sx]:
                    items.append((sx, "real", rid, ("real", [rid])))
            else:
                for s in V["h2"][sx]:
                    items.append((sx, "real", "ser_" + re.sub(r"\W+", "_", s["person"]), ("real", s["items"])))
        for k in range(max(PL[f"{fam}|m"], PL[f"{fam}|f"])):
            for sx in ("m", "f"):
                if k < PL[f"{fam}|{sx}"]:
                    items.append((sx, "syn", f"syn{k:04d}", ("syn", syn_params(fam, sx, k))))
        for sx, vk, vid, (typ, what) in items:
            if typ == "real":
                parts, eps, t = [], [], 0.0
                sr = recs[what[0]]["native_sr"]
                refs = []
                for i, rid in enumerate(what):
                    v = recs[rid]
                    x, s0 = rd(os.path.join(DATA, v["native"]))
                    x = rs(x, s0, sr)
                    z = np.load(P("praat", rid + ".npz"))
                    g, t0 = z["f0"], float(z["t0"])
                    if fam == "h1" and v["source"] == "svd":
                        x = x[: int(30.0 * sr)]
                    dur = len(x) / sr
                    tr = np.zeros(int(np.ceil(dur / 0.01)) + 1, np.float32)
                    idx = np.round((t0 + np.arange(len(g)) * 0.01) / 0.01).astype(int)
                    ok = (idx >= 0) & (idx < len(tr))
                    tr[idx[ok]] = g[ok]
                    parts.append((t, x, tr))
                    eps.append({"start": round(t, 4), "dur": round(dur, 4), "rec": rid})
                    t += dur + (2.0 if fam == "h2" else 0.0)
                tot = t - (2.0 if fam == "h2" else 0.0)
                voice = np.zeros(int(round(tot * sr)) + 1)
                ref = np.zeros(int(np.ceil(tot / 0.01)) + 2, np.float32)
                fade = int(0.01 * sr)
                for t, x, tr in parts:
                    a = int(round(t * sr))
                    e = np.minimum(np.minimum(1.0, (np.arange(len(x)) + 1) / fade), (len(x) - np.arange(len(x))) / fade)
                    voice[a:a + len(x)] += (x * e)[: len(voice) - a]
                    j = int(round(t / 0.01))
                    m = min(len(tr), len(ref) - j)
                    ref[j:j + m] = np.maximum(ref[j:j + m], tr[:m])
                if fam == "h2":
                    eps_out = [{"start": 0.0, "dur": round(tot, 4)}]          # the series onset is the hold onset (§2.4)
                else:
                    eps_out = [{"start": e["start"], "dur": e["dur"]} for e in eps]
                meta = {"voice": vid, "voice_kind": "real", "records": what, "person": recs[what[0]]["person"], "source": recs[what[0]]["source"],
                        "licence": recs[what[0]]["licence"]}
                eq_flags = [False] * 4
            else:
                prm = what
                sr = prm["sr"]
                x, (t0, hop, ft) = synth(sr, prm["dur"], prm["f0"], vowel=prm["kind"], qual=prm["qual"], fscale=prm["tract"], vib=prm["vib"],
                                         seed=prm["seed"], lead=0.0, tail=0.0, wander_cents=prm["wander"])
                voice, ref = x.astype(np.float64), ft
                eps_out = [{"start": 0.0, "dur": prm["dur"]}]
                meta = {"voice": vid, "voice_kind": "syn_hum" if prm["kind"] == "hum" else "syn_vowel", "synth": prm}
                eq_flags = None
            for ci, cond in enumerate(conds[f"{fam}_{'real' if typ == 'real' else 'syn'}"]):
                sid = f"{fam}__{sx}__{vid}__{cond}"
                eq = (nsyn % 2 == 1) if typ == "syn" else False
                if typ == "syn":
                    nsyn += 1
                if sid in old and os.path.exists(old[sid]["audio"]["path"]):
                    specs.append(old[sid])
                    if cond != "clean":
                        bedsel.next()            # keep the rotation in step
                    continue
                vk2 = meta["voice_kind"]
                render_stream(sid, voice, ref, sr, lead_of(sid), cond, bedsel, eq, dict(meta, voice_kind=vk2), specs, fam, sx, eps_out)
            log(f"{fam} {sx} {vid}: {len(specs)} streams")
        write_json(sp, specs)
        log(f"{fam}: {len(specs)} streams, {sum(s['audio']['len'] / s['audio']['sr'] for s in specs) / 3600:.2f} h")


# ----------------------------------------------------------------------------- counts (current app, aggregate; no model)
def load_dump(fam, sid):
    jp = P("dumps", fam, sid + ".json")
    m = json.load(open(jp, encoding="utf8"))
    a = np.fromfile(jp[:-5] + ".f32", dtype="<f4").reshape(len(m["cols"]), m["n"])
    return m, {c: a[i] for i, c in enumerate(m["cols"])}


def cells(fam, m, col):
    """Yield (cell key, n CORRECT hops) of one stream (the gating cells of §2.3 / §2.4)."""
    lab, refd = col["lab"], col["refd"]
    ok = lab == 1
    sx = m["gender"]
    vk = {"real": "real", "syn_vowel": "syn_vowel", "syn_hum": "syn_hum"}[m["voice_kind"]]
    if fam == "h1":
        lo, hi = BANDS[sx]
        yield f"h1|{sx}|{m['cond']}|{vk}", int((ok & (refd >= lo) & (refd <= hi)).sum())
    else:
        tk = (np.arange(m["n"]) + 1) * m["hop_s"]
        td = tk - 0.040 - m["L"] * m["hop_s"] - 0.030
        ep = m["episodes"][0]
        t = td - ep["start"]
        kind = "real" if vk == "real" else "syn"
        nb = int(np.ceil(ep["dur"] / 10.0 - 1e-9))
        for b in range(nb):
            lo_t, hi_t = (b * 10.0, (b + 1) * 10.0) if b < nb - 1 else (max(0.0, ep["dur"] - 10.0), ep["dur"])
            sel = ok & (t >= lo_t) & (t < hi_t) if b < nb - 1 else ok & (t >= ep["dur"] - 10.0) & (t <= ep["dur"])
            yield f"h2|{sx}|{m['cond']}|{kind}|bin{b if b < nb - 1 else 'last'}", int(sel.sum())


def counts():
    C = collections.Counter()
    S = collections.Counter()
    miss = 0
    for fam in ("h1", "h2"):
        for s in json.load(open(P("streams", f"{fam}.json"), encoding="utf8")):
            if not os.path.exists(P("dumps", fam, s["id"] + ".json")):
                miss += 1
                continue
            m, col = load_dump(fam, s["id"])
            m = dict(m, voice_kind=s["meta"]["voice_kind"], cond=s["meta"]["cond"], episodes=s["meta"]["episodes"])
            S[f"{fam}|{s['gender']}|{s['meta']['cond']}|{m['voice_kind']}"] += 1
            for k, v in cells(fam, m, col):
                C[k] += v
    if miss:
        raise SystemExit(f"{miss} streams without a dump: run the dumps first")
    under = sorted(k for k, v in C.items() if v < 400)
    J = {"what": "round-5 H1 / H2 CORRECT hops per gating cell (H1: band-filtered) and per H2 10-s bin (no band filter); current app, aggregate",
         "streams": dict(sorted(S.items())), "correct_hops": dict(sorted(C.items())), "under_400": under}
    write_json(P("counts.json"), J, indent=1)
    log(json.dumps({"streams": J["streams"], "under_400": under}, indent=1))
    if "grow" in A:
        PL = plan()
        grow = set()
        for k in under:
            parts = k.split("|")
            fam, sx = parts[0], parts[1]
            if (fam == "h1" and parts[3].startswith("syn")) or (fam == "h2" and parts[3] == "syn" and parts[4] in ("bin0", "binlast")):
                grow.add((fam, sx))
        for fam, sx in sorted(grow):
            PL[f"{fam}|{sx}"] += 8
        write_json(P("plan.json"), PL, indent=1)
        log("grow:", sorted(grow), "->", PL)


def hash_inputs():
    lines = []
    for fam in ("h1", "h2"):
        sp = P("streams", f"{fam}.json")
        files = [sp]
        for s in json.load(open(sp, encoding="utf8")):
            files += [s["audio"]["path"], s["ref"]["path"], P("dumps", fam, s["id"] + ".json"), P("dumps", fam, s["id"] + ".f32")]
        for f in files:
            h = hashlib.sha256(open(f, "rb").read()).hexdigest()
            lines.append(f"{h}  {os.path.relpath(f, ROOT).replace(os.sep, '/')}")
    for f in (P("beds.json"), P("voices.json"), P("plan.json"), P("counts.json")):
        lines.append(f"{hashlib.sha256(open(f, 'rb').read()).hexdigest()}  {os.path.relpath(f, ROOT).replace(os.sep, '/')}")
    os.makedirs(os.path.join(R5, "sel"), exist_ok=True)
    open(os.path.join(R5, "sel", "inputs.sha256"), "w", encoding="utf8", newline="\n").write("\n".join(lines) + "\n")
    log(f"hashed {len(lines)} files -> r5/sel/inputs.sha256")


if __name__ == "__main__":
    {"beds": beds, "voices": voices, "build": build, "counts": counts, "hash": hash_inputs}[sys.argv[1]]()
