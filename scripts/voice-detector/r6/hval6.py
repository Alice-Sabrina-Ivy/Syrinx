# hval6.py — custom voice detector, round 6 (pre-registration
# measurements/voice-detector-round6-preregistration-2026-10-13.md §2.2-2.10):
# the new VALIDATION ("practice") rows H4-H8 and the round-5 voice-safety
# review's probe streams as validation rows. VALIDATION SIDE ONLY: reads the
# rounds 1-2 val split (through r5/hval's voices.json and beds.json and the
# manifests), the round-4 review's unseen Freesound clips (fsnew, after the
# §1.2 item 5 check), the validation-only generators (r5/vsynth_val, r5/vbeds,
# r6/lfsynth_val, r6/mach5_val, r6/micsim_val, r6/probes5_val) and the review
# session builders' outputs (r6/sess5_val, r6/sess3_val). Every audio path read
# goes through c3.guard_not_conf (the sealed set is refused). The private
# session recordings, the old harness sets and every training generator are
# never read. No model runs here. Reads earlier downloads: run with `python -I`.
#
# Output (gitignored): build/vad-train/r6/hval/
#   beds.json            the bed lists per class (round 5's real val beds; buzz = round 5's mains class + fsnew buzz clips)
#   plan.json            synthetic item counts per row / sex / synthesizer (grown by `counts --grow`)
#   items/<set>/<id>.json   one spec sidecar per rendered stream (resumable); audio/<set>/, refs/<set>/
#   streams/<set>.json   valdump.mjs specs (`specs`), dumps/<set>/ (run-dumps.sh, ROOT=build/vad-train/r6/hval)
#   counts.json          CORRECT hops per gating cell and sex (current app, aggregate; r6/hcells.py)
#
#   build --set=h4|h5|h6a|h6b|h6c|h8|s1|s1b|s2|s2b|s3|s4 [--shard=i/n]   render what is not rendered yet
#   probes --set=sess5|sess3   specs for the review sessions rendered by sess5_val.py / sess3_val.py (+ masks)
#   specs [--set=...]          collect the sidecars in canonical order -> streams/<set>.json
#   counts [--grow]            -> counts.json (+ plan growth for synthetic cells under 400)
#   hash                       -> build/vad-train/r6/sel/inputs.sha256
#
#   <venv python> -I scripts/voice-detector/r6/hval6.py beds|build|probes|specs|counts|hash ...
import collections
import glob
import hashlib
import json
import os
import re
import sys

import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
for p in (HERE, os.path.join(HERE, "..", "r5"), os.path.join(HERE, "..", "r3"), os.path.join(HERE, "..", "r4"), os.path.join(HERE, "..", "train")):
    sys.path.insert(0, os.path.abspath(p))
from c3 import DATA, ROOT, args, fnv1a, guard_not_conf, load_manifest, log, write_json  # noqa: E402

A = args()
R6 = os.path.join(ROOT, "r6")
HV = os.environ.get("VAD_R6_HVAL") or os.path.join(R6, "hval")      # (override for dry runs only)
R5HV = os.path.join(ROOT, "r5", "hval")
SEED = 20261013                     # construction seed (§2.3)
BED_SEED = 20261014                 # bed-class rotation seed (§2.3)
VSYN0 = 5_000_000_000 + 1_000_000   # vsynth_val voice seeds (§2.3)
LSYN0 = 5_000_000_000 + 2_000_000   # lfsynth_val voice seeds (§2.3)
BSYN0 = 6_000_000_000 + 1_000_000   # synthetic bed seeds (§2.3)
# per-row seed offsets (fixed here, before any rendering; recorded in Addendum R6-A)
VOFF = {("h4", "m"): 0, ("h4", "f"): 10_000, ("h5", "m"): 20_000, ("h5", "f"): 30_000, ("h6a", "m"): 40_000, ("h6a", "f"): 50_000,
        ("h6b", "m"): 60_000, ("h6b", "f"): 70_000, ("h6c", "m"): 80_000, ("h6c", "f"): 90_000}
BOFF = {"h4": 0, "h5": 100_000, "h6a": 200_000, "h6b": 300_000, "h6c": 400_000, "h8": 600_000}
SEXOFF = {"m": 0, "f": 50_000}
SRCOFF = {"real": 0, "vsynth": 10_000, "lfsynth": 20_000}
RATES = [48000, 44100, 16000]
BANDS = {"m": (75.0, 130.0), "f": (160.0, 300.0)}
LOWB = {"m": (75.0, 100.0), "f": (160.0, 200.0)}
S3LOHI = {"m": (85.0, 260.0), "f": (170.0, 380.0)}      # the review's S3 recipe (screen5.make)
CLASSES5 = ["air", "fridge", "mains", "motor", "buzz"]
SYN_KINDS = {"air": [("vbeds", "fan"), ("vbeds", "hvac"), ("vbeds", "aircon"), ("vbeds", "pcfan")],
             "fridge": [("vbeds", "fridge"), ("vbeds", "dehum")], "mains": [("vbeds", "mains"), ("vbeds", "xfmr50")],
             "motor": [("vbeds", "vmotor")],
             "buzz": [("vbeds", "mains"), ("vbeds", "xfmr50"), ("mach5", "microwave"), ("mach5", "ballast"), ("mach5", "aqpump"),
                      ("mach5", "twofan"), ("mach5", "washer")]}
BUZZ = re.compile(r"(?i)\b(hum|buzz|mains|transformer|ballast|pump|aquarium|fish ?tank|microwave|fluorescent|electric|air ?handler)")
N0 = {"h4": 60, "h5": 24, "h6a": 8, "h6b": 12, "h6c_syn": 6, "h6c_real": 6, "h8": 40}
CONDS = {"h4": ["snr+0", "snr+10"], "h5": ["clean", "snr+10", "snr+0"], "h6a": ["clean", "snr+10", "snr+0"], "h6b": ["clean", "snr+10", "snr+0"],
         "h6c": ["clean", "snr+10", "snr+0"]}
EX = ["liptrill", "tongtrill", "straw", "humsiren", "vslide"]
H6C_TYPES = ["hold", "hum", "rep", "liptrill", "tongtrill", "straw", "siren", "slide"]
H6C_P = [0.2, 0.2, 0.15, 0.1, 0.1, 0.1, 0.1, 0.05]
H6C_PAUSE = ([1.0, 3.0, 8.0, 20.0], [0.3, 0.3, 0.2, 0.2])
PROBE_SETS = ("s1", "s1b", "s2", "s2b", "s3", "s4")
HARNESS_LONG = ("forte", "pp", "straight", "messa")


def P(*a):
    return os.path.join(HV, *a)


# ----------------------------------------------------------------------------- helpers (r5/hval conventions)
def rd(path):
    import soundfile as sf
    x, sr = sf.read(guard_not_conf(path), dtype="float64", always_2d=True)
    return x[:, 0], int(sr)


def rs(x, s0, s1):
    if s0 == s1:
        return np.asarray(x, np.float64)
    from math import gcd
    from scipy.signal import resample_poly
    g = gcd(s0, s1)
    return resample_poly(np.asarray(x, np.float64), s1 // g, s0 // g)


def active_rms(x):
    pk = np.max(np.abs(x)) if len(x) else 0
    m = np.abs(x) > 0.02 * pk
    return float(np.sqrt(np.mean(np.square(x[m], dtype=np.float64)))) if m.any() else 0.0


def loop_bed(x, n, sr, fade_s=1.0):
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


def lead_of(sid):
    return 60.0 if fnv1a("r6lead:" + sid) % 3 == 2 else 20.0


def mic(x, sr, kind):
    import micsim_val as M
    if kind == "flat":
        return x
    if kind == "phone":
        return M.phone_eq(x, sr)
    if kind == "phone2agc":
        return M.phone2(x, sr, agc=True)
    if kind == "agc":
        return M.agc_only(x, sr)
    raise ValueError(kind)


def loguni(rng, lo, hi):
    return float(np.exp(rng.uniform(np.log(lo), np.log(hi))))


# ----------------------------------------------------------------------------- beds
def beds():
    """Bed lists per class: round 5's 109 real val beds by class; the buzz class = round 5's mains-class beds plus the fsnew clips
    that passed the §1.2 item 5 check and match the buzz rule (title, query or tags)."""
    B5 = json.load(open(os.path.join(R5HV, "beds.json"), encoding="utf8"))
    D = json.load(open(os.path.join(R6, "checks", "disjoint.json"), encoding="utf8"))
    removed = set(D["item5"]["removed"])
    S = json.load(open(os.path.join(ROOT, "review-r4", "fsnew", "selection.json"), encoding="utf8"))
    real = collections.defaultdict(list)
    for b in B5["beds"]:
        real[b["cls"]].append({"id": b["id"], "source": b["source"], "path": b["path"], "licence": b["licence"], "cls5": b["cls"]})
    real["buzz"] = [dict(b) for b in real["mains"]]
    fs = []
    for v in sorted(S["checked"].values(), key=lambda v: v["id"]):
        if v.get("drop"):
            continue
        text = " ".join([v.get("title") or "", v.get("query") or "", " ".join(v.get("tags") or [])])
        m = BUZZ.search(text)
        rec = {"id": f"fsnew__{v['id']}", "source": "fsnew", "path": v["path"], "licence": (v.get("licence") or ["?"])[0], "title": v["title"],
               "query": v["query"], "buzz_match": m.group(0) if m else None, "removed_by_item5": f"fsnew:{v['id']}" in removed}
        fs.append(rec)
        if m and not rec["removed_by_item5"]:
            real["buzz"].append({k: rec[k] for k in ("id", "source", "path", "licence")} | {"cls5": "buzz"})
    for c in real:
        real[c].sort(key=lambda b: (fnv1a("r6:" + b["id"]), b["id"]))
    J = {"what": "round-6 bed lists (§2.2): real val beds per class (round 5) + buzz (round 5 mains class + fsnew buzz-rule clips); synthetic kinds",
         "buzz_rule": BUZZ.pattern, "real": dict(real), "real_counts": {c: len(v) for c, v in real.items()},
         "synthetic_kinds": {c: [f"{g}:{k}" for g, k in v] for c, v in SYN_KINDS.items()}, "fsnew": fs}
    write_json(P("beds.json"), J, indent=1)
    log("beds:", J["real_counts"], "fsnew buzz:", [f["id"] for f in fs if f["buzz_match"]])


_BEDS = None


def bedlists():
    global _BEDS
    if _BEDS is None:
        _BEDS = json.load(open(P("beds.json"), encoding="utf8"))
    return _BEDS


def pick_bed(row, gid, idx, classes):
    """Deterministic per stream (growth never moves an earlier stream): class = a seeded permutation of `classes` (seed 20261014,
    FNV-1a of the group) cycled by the stream's index in its group; within a class real and synthetic alternate (real first; a
    class with < 3 real clips is synthetic only); clips and kinds cycle from an offset given by the group's hash."""
    B = bedlists()
    perm = [classes[i] for i in np.random.default_rng([BED_SEED, fnv1a(row + ":" + gid)]).permutation(len(classes))]
    c = perm[idx % len(perm)]
    j = idx // len(perm)
    off = fnv1a("r6bed:" + row + ":" + gid)
    real = B["real"].get(c, [])
    if len(real) >= 3 and j % 2 == 0:
        b = real[(j // 2 + off) % len(real)]
        return {"type": "real", "cls": c, "kind": b["id"], "id": b["id"], "path": b["path"], "source": b["source"], "licence": b["licence"]}
    gen, kind = SYN_KINDS[c][(j // 2 + off) % len(SYN_KINDS[c])]
    return {"type": "synthetic", "cls": c, "kind": kind, "gen": gen}


_BEDCACHE = {}


def render_bed(b, n, sr, seed):
    if b["type"] == "real":
        key = (b["path"], sr)
        if key not in _BEDCACHE:
            x, s0 = rd(b["path"])
            _BEDCACHE.clear()
            _BEDCACHE[key] = rs(x, s0, sr)
        return loop_bed(_BEDCACHE[key], n, sr)
    if b["gen"] == "vbeds":
        from vbeds import bed
    else:
        from mach5_val import bed
    return np.asarray(bed(b["kind"], sr, n / sr + 0.01, seed=seed)[:n], np.float64)


# ----------------------------------------------------------------------------- stream writer (r5 render_stream conventions)
def write_stream(sset, sid, sex, sr, y, ref_track, meta, holds, episodes, voice_t0, voice_t1):
    import soundfile as sf
    pk = float(np.max(np.abs(y))) if len(y) else 0.0
    sc = 1.0 if pk <= 0.999 else 0.999 / pk
    wp = P("audio", sset, sid + ".wav")
    os.makedirs(os.path.dirname(wp), exist_ok=True)
    sf.write(wp, (y * sc).astype(np.float32), sr, subtype="PCM_16")
    rp = P("refs", sset, sid + ".f32")
    os.makedirs(os.path.dirname(rp), exist_ok=True)
    np.asarray(ref_track, "<f4").tofile(rp)
    spec = {"id": sid, "gender": sex, "audio": {"path": wp, "fmt": "wav", "sr": sr, "start": 0, "len": len(y)},
            "ref": {"kind": "praat", "path": rp, "t0": 0.0, "hop": 0.01}, "holds": holds,
            "meta": dict(meta, set=sset, gain_scale=sc, voice_t0=voice_t0, voice_t1=voice_t1, episodes=episodes)}
    write_json(P("items", sset, sid + ".json"), spec)


def mix_stream(row, sset, sid, sex, sr, voice, ref, lead, cond, bed, bed_seed, mic_kind, meta, episodes, tail=5.0, holds=None):
    """voice: float64 at sr placed after `lead`; ref: 10 ms F0 track of the voice (t0 0). As r5 render_stream: level -26 dBFS +- 6 dB
    (seed (20261013, FNV-1a(id))), SNR on the voice's active RMS, clean = -70 dBFS seeded white floor, mic after the mix,
    whole-stream gain <= 1 against clipping."""
    rng = np.random.default_rng([SEED, fnv1a(sid)])
    lvl = -26.0 + float(rng.uniform(-6.0, 6.0))
    v = voice * (10 ** (lvl / 20) / max(active_rms(voice), 1e-12))
    n = int(round((lead + len(voice) / sr + tail) * sr))
    a = int(round(lead * sr))
    y = np.zeros(n)
    y[a:a + len(v)] += v[: n - a]
    bmeta = {}
    if cond == "clean":
        y += np.random.default_rng([SEED, fnv1a(sid), 1]).standard_normal(n) * 10 ** (-70 / 20)
    else:
        nz = render_bed(bed, n, sr, bed_seed)
        nr = float(np.sqrt(np.mean(np.square(nz))))
        y += nz * (10 ** (lvl / 20) / 10 ** (int(cond[3:]) / 20) / max(nr, 1e-12))
        bmeta = {"bed": dict(bed, seed=bed_seed if bed["type"] == "synthetic" else None)}
    y = mic(y, sr, mic_kind)
    rf = np.zeros(int(np.ceil(n / sr / 0.01)) + 1, np.float32)
    j0 = int(round(lead / 0.01))
    m = min(len(ref), len(rf) - j0)
    rf[j0:j0 + m] = ref[:m]
    eps = [dict(e, start=round(lead + e["start"], 4)) for e in episodes]
    hl = holds if holds is not None else [[e["start"], round(e["start"] + e["dur"], 4)] for e in eps]
    write_stream(sset, sid, sex, sr, y, rf, dict(meta, row=row, cond=cond, lead=lead, level_db=round(lvl, 2), mic=mic_kind, **bmeta),
                 hl, eps, lead, round(lead + len(voice) / sr, 4))


# ----------------------------------------------------------------------------- synthetic voices
def vs_call(sr, dur, f0, sex, kind, qual, seed, wander, vib=None, glide=None, am=None):
    from vsynth_val import synth
    x, (_, _, ft) = synth(sr, dur, f0, vowel=kind, qual=qual, fscale=1.0 if sex == "m" else 1.17, vib=vib, glide=glide, am=am, seed=seed,
                          lead=0.0, tail=0.0, wander_cents=wander)
    return np.asarray(x, np.float64), np.asarray(ft, np.float32)


def lf_call(sr, dur, f0, sex, kind, qual, seed, wander, vib=None, glide=None, am=None, segs=None):
    from lfsynth_val import synth
    x, (_, _, ft) = synth(sr, dur, f0, sex=sex, vowel=kind, qual=qual, seed=seed, lead=0.0, tail=0.0, wander_cents=wander, vib=vib,
                          glide=glide, am=am, segs=segs)
    return np.asarray(x, np.float64), np.asarray(ft, np.float32)


def place(parts, total, sr):
    """parts: [(start_s, x, ft)] -> (voice, ref) on one timeline (ref = max of the parts' tracks)."""
    v = np.zeros(int(round(total * sr)) + 1)
    ref = np.zeros(int(np.ceil(total / 0.01)) + 2, np.float32)
    for t, x, ft in parts:
        a = int(round(t * sr))
        m = min(len(x), len(v) - a)
        v[a:a + m] += x[:m]
        j = int(round(t / 0.01))
        mm = min(len(ft), len(ref) - j)
        ref[j:j + mm] = np.maximum(ref[j:j + mm], ft[:mm])
    return v, ref


def s3_glide(lo, hi):
    """The review's S3 siren contour (screen5.make): up and down over 4 s, raised cosine in log frequency."""
    per = 5.0
    return lambda tt: (hi / lo) ** (0.5 - 0.5 * np.cos(2 * np.pi * np.clip(tt % per, 0, 4.0) / 4.0))


def exercise(syn, ex, sr, sex, lo, seed, dur=16.0):
    """One H6a exercise by the review's S3 recipe (lfsynth_val) or the same AM / low-pass / glide recipe on vsynth_val.
    Returns (voice, ref, segs)."""
    from scipy.signal import butter, sosfilt
    hi = S3LOHI[sex][1]
    f0 = lo * 1.25
    if ex in ("liptrill", "tongtrill", "straw"):
        kind, qual, am = {"liptrill": ("hum", "breathy", (25.0, 0.85)), "tongtrill": ("a", "modal", (30.0, 0.6)), "straw": ("u", "soft", None)}[ex]
        if syn == "lfsynth":
            x, ft = lf_call(sr, dur, f0, sex, kind, qual, seed, 10.0, am=am)
        else:
            x, ft = vs_call(sr, dur, f0, sex, kind, qual, seed, 10.0, am=am)
        if ex == "straw":
            x = sosfilt(butter(4, 700, "lowpass", fs=sr, output="sos"), x) * 10 ** (-6 / 20)
        return x, ft, None
    kind = "hum" if ex == "humsiren" else "u"
    segs = [(k * 5.0, 4.0) for k in range(3)]
    if syn == "lfsynth":
        x, ft = lf_call(sr, dur, lo, sex, kind, "modal", seed, 10.0, glide=s3_glide(lo, hi), segs=segs)
        return x, ft, segs
    parts = []
    for j, (t, d) in enumerate(segs):
        sj = (list(seed) if isinstance(seed, (list, tuple)) else [seed]) + [j]
        x, ft = vs_call(sr, d, lo, sex, kind, "modal", sj, 10.0, glide=(lo, hi, 4.0))
        parts.append((t, x, ft))
    v, ref = place(parts, dur, sr)
    return v[: int(round(dur * sr))], ref, segs


# ----------------------------------------------------------------------------- the plan
def plan():
    p = P("plan.json")
    if os.path.exists(p):
        return json.load(open(p, encoding="utf8"))
    J = {}
    for sx in ("m", "f"):
        for syn in ("vsynth", "lfsynth"):
            J[f"h4|{sx}|{syn}"] = N0["h4"]
            J[f"h5|{sx}|{syn}"] = N0["h5"]
            J[f"h6b|{sx}|{syn}"] = N0["h6b"]
            for ex in EX:
                J[f"h6a|{sx}|{syn}|{ex}"] = N0["h6a"]
        J[f"h6c|{sx}|syn"] = N0["h6c_syn"]
    write_json(p, J, indent=1)
    return J


def voices5():
    return json.load(open(os.path.join(R5HV, "voices.json"), encoding="utf8"))


def real_voice(recs, ids, gap, svd_cut):
    """Real voice from r5's voices.json records (native rate of the first; gated Praat tracks of r5/hval/praat)."""
    sr = recs[ids[0]]["native_sr"]
    parts, eps, t = [], [], 0.0
    for rid in ids:
        v = recs[rid]
        x, s0 = rd(os.path.join(DATA, v["native"]))
        x = rs(x, s0, sr)
        z = np.load(guard_not_conf(os.path.join(R5HV, "praat", rid + ".npz")))
        g, t0 = z["f0"], float(z["t0"])
        if svd_cut and v["source"] == "svd":
            x = x[: int(30.0 * sr)]
        dur = len(x) / sr
        tr = np.zeros(int(np.ceil(dur / 0.01)) + 1, np.float32)
        idx = np.round((t0 + np.arange(len(g)) * 0.01) / 0.01).astype(int)
        ok = (idx >= 0) & (idx < len(tr))
        tr[idx[ok]] = g[ok]
        parts.append((t, x, tr))
        eps.append({"start": round(t, 4), "dur": round(dur, 4), "rec": rid})
        t += dur + gap
    tot = t - gap
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
    return voice, ref, sr, eps, tot


# ----------------------------------------------------------------------------- item lists per row (canonical order)
def items(sset):
    """[(sid, builder)] in canonical order; builder() renders the stream."""
    PL = plan()
    out = []
    if sset in ("h4", "h5"):
        row = sset
        V = voices5()
        recs = {v["id"]: v for v in V["records"]}
        conds = CONDS[row]
        nb = len([c for c in conds if c != "clean"])
        for sx in ("m", "f"):
            if row == "h4":
                reals = [(rid, [rid]) for rid in V["h1"][sx]]
            else:
                reals = [("ser_" + re.sub(r"\W+", "_", s["person"]), s["items"]) for s in V["h2"][sx]]
            for k, (vid, ids) in enumerate(reals):
                for ci, cond in enumerate(conds):
                    sid = f"{row}__{sx}__real__{vid}__{cond}"
                    out.append((sid, ("real", row, sx, k, vid, ids, ci, cond, nb)))
            for syn in ("vsynth", "lfsynth"):
                for k in range(PL[f"{row}|{sx}|{syn}"]):
                    for ci, cond in enumerate(conds):
                        sid = f"{row}__{sx}__{syn}__k{k:04d}__{cond}"
                        out.append((sid, ("syn", row, sx, k, syn, ci, cond, nb)))
    elif sset == "h6a":
        for sx in ("m", "f"):
            for syn in ("vsynth", "lfsynth"):
                for ei, ex in enumerate(EX):
                    for k in range(PL[f"h6a|{sx}|{syn}|{ex}"]):
                        for ci, cond in enumerate(CONDS["h6a"]):
                            out.append((f"h6a__{sx}__{syn}__{ex}__k{k:04d}__{cond}", ("h6a", sx, syn, ei, ex, k, ci, cond)))
    elif sset == "h6b":
        for sx in ("m", "f"):
            for syn in ("vsynth", "lfsynth"):
                for k in range(PL[f"h6b|{sx}|{syn}"]):
                    for ci, cond in enumerate(CONDS["h6b"]):
                        out.append((f"h6b__{sx}__{syn}__k{k:04d}__{cond}", ("h6b", sx, syn, k, ci, cond)))
    elif sset == "h6c":
        V = voices5()
        for sx in ("m", "f"):
            per = sorted(V["h2"][sx], key=lambda s: (fnv1a("r6h6c:" + s["person"]), s["person"]))[: N0["h6c_real"]]
            for k, s in enumerate(per):
                for ci, cond in enumerate(CONDS["h6c"]):
                    out.append((f"h6c__{sx}__real__k{k:04d}__{cond}", ("h6c_real", sx, k, s, ci, cond)))
            for k in range(PL[f"h6c|{sx}|syn"]):
                for ci, cond in enumerate(CONDS["h6c"]):
                    out.append((f"h6c__{sx}__syn__k{k:04d}__{cond}", ("h6c_syn", sx, k, ci, cond)))
    elif sset == "h8":
        for k, (sx, vg) in enumerate(h8_groups()):
            out.append((f"h8__{sx}__{re.sub(r'[^A-Za-z0-9]+', '_', vg)}", ("h8", sx, vg)))
    elif sset in PROBE_SETS:
        import probes5_val
        for s in probes5_val.specs({"s1": "S1", "s1b": "S1b", "s2": "S2", "s2b": "S2b", "s3": "S3", "s4": "S4"}[sset]):
            out.append((f"{sset.upper().replace('B', 'b')}_{s['i']:05d}", ("probe", sset, s)))
    else:
        raise SystemExit(f"unknown set {sset}")
    return out


# ----------------------------------------------------------------------------- builders
def bseed(row, sx, src, k, ci, sub=0):
    return BSYN0 + BOFF[row] + SEXOFF[sx] + SRCOFF.get(src, 30_000) + sub * 2_000 + 4 * k + ci


def build_h45(sid, spec):
    if spec[0] == "real":
        _, row, sx, k, vid, ids, ci, cond, nb = spec
        V = voices5()
        recs = {v["id"]: v for v in V["records"]}
        voice, ref, sr, eps, tot = real_voice(recs, ids, gap=(2.0 if row == "h5" else 0.0), svd_cut=(row == "h4"))
        episodes = ([{"start": 0.0, "dur": round(tot, 4), "kind": "series"}] if row == "h5" else [dict(e, kind="real") for e in eps])
        meta = {"voice": vid, "voice_kind": "real", "source_kind": "real", "records": ids, "person": recs[ids[0]]["person"],
                "source": recs[ids[0]]["source"], "licence": recs[ids[0]]["licence"]}
        src = "real"
    else:
        _, row, sx, k, syn, ci, cond, nb = spec
        seed = (VSYN0 if syn == "vsynth" else LSYN0) + VOFF[(row, sx)] + k
        rng = np.random.default_rng(seed)
        sr = RATES[k % 3]
        if row == "h4":
            kind = ["hum", "a", "hum", "o"][k % 4]
            quals = ["modal", "soft", "breathy"] if syn == "vsynth" else ["modal", "soft", "breathy", "pressed"]
            qual = quals[(k + k // 4) % len(quals)]
            vib = (float(rng.uniform(5.0, 6.0)), float(rng.uniform(30.0, 60.0))) if k % 8 in (1, 6) else None
            lo, hi = LOWB[sx] if k % 2 == 0 else BANDS[sx]
            dur, wander = 15.0, float(rng.uniform(6.0, 40.0))
        else:
            dur = [90.0, 120.0][k % 2]
            kind = ["hum", "a"][(k // 2) % 2]
            qual = ["modal", "soft"][(k // 4) % 2]
            low = ((k % 2) ^ ((k // 2) % 2) ^ ((k // 4) % 2)) == 0
            lo, hi = LOWB[sx] if low else BANDS[sx]
            vib = (float(rng.uniform(5.0, 6.0)), float(rng.uniform(30.0, 60.0))) if k % 8 in (1, 6) else None
            wander = float(rng.uniform(3.0, 12.0))
        f0 = loguni(rng, lo, hi)
        if syn == "vsynth":
            voice, ref = vs_call(sr, dur, f0, sx, kind, qual, seed, wander, vib=vib)
        else:
            voice, ref = lf_call(sr, dur, f0, sx, kind, qual, seed, wander, vib=vib)
        episodes = [{"start": 0.0, "dur": dur, "kind": kind}]
        meta = {"voice": f"{syn}_k{k:04d}", "voice_kind": "syn_hum" if kind == "hum" else "syn_vowel", "source_kind": syn,
                "synth": {"gen": syn, "seed": seed, "k": k, "f0": round(f0, 3), "kind": kind, "qual": qual, "vib": vib, "dur": dur,
                          "wander": round(wander, 3), "sr": sr, "f0_band": [lo, hi]}}
        src = syn
    if row == "h4":
        mk = ["flat", "phone"][(k + ci) % 2]
    else:
        mk = ["agc", "phone2agc"][(k + ci) % 2]
    noisy = [c for c in CONDS[row] if c != "clean"]
    bed = bs = None
    if cond != "clean":
        gid = f"{sx}|{src}"
        bed = pick_bed(row, gid, k * nb + noisy.index(cond), ["buzz"])
        bs = bseed(row, sx, src, k, ci)
    mix_stream(row, row, sid, sx, sr, voice, ref, lead_of(sid), cond, bed, bs, mk, meta, episodes)


def build_h6a(sid, spec):
    _, sx, syn, ei, ex, k, ci, cond = spec
    seed = (VSYN0 if syn == "vsynth" else LSYN0) + VOFF[("h6a", sx)] + 1_000 * ei + k
    rng = np.random.default_rng(seed)
    sr = RATES[k % 3]
    lo = loguni(rng, *LOWB[sx])
    voice, ref, segs = exercise(syn, ex, sr, sx, lo, seed)
    episodes = [{"start": a, "dur": d, "kind": ex} for a, d in (segs or [(0.0, 16.0)])]
    meta = {"voice": f"{syn}_{ex}_k{k:04d}", "voice_kind": "syn_exercise", "source_kind": syn, "exercise": ex,
            "synth": {"gen": syn, "seed": seed, "k": k, "lo": round(lo, 3), "hi": S3LOHI[sx][1], "sr": sr, "recipe": "S3"}}
    bed = bs = None
    if cond != "clean":
        gid = f"{sx}|{syn}|{ex}"
        bed = pick_bed("h6a", gid, k * 2 + ["snr+10", "snr+0"].index(cond), CLASSES5)
        bs = bseed("h6a", sx, syn, k, ci, sub=ei)
    mix_stream("h6a", "h6a", sid, sx, sr, voice, ref, lead_of(sid), cond, bed, bs, "flat", meta, episodes)


def build_h6b(sid, spec):
    _, sx, syn, k, ci, cond = spec
    seed = (VSYN0 if syn == "vsynth" else LSYN0) + VOFF[("h6b", sx)] + k
    rng = np.random.default_rng(seed)
    sr = RATES[k % 3]
    lo, hi = LOWB[sx] if k % 2 == 0 else BANDS[sx]
    f0 = loguni(rng, lo, hi)
    kind = ["hum", "a"][(k // 2) % 2]
    qual = ["modal", "soft"][(k // 4) % 2]
    vib = (5.4, 45.0) if k % 8 in (1, 6) else None
    segs = [(j * 20.5, 18.0) for j in range(6)]
    dur = 6 * 18 + 5 * 2.5
    if syn == "lfsynth":
        voice, ref = lf_call(sr, dur, f0, sx, kind, qual, seed, 8.0, vib=vib, segs=segs)
    else:
        parts = []
        for j, (t, d) in enumerate(segs):
            x, ft = vs_call(sr, d, f0, sx, kind, qual, [seed, j], 8.0, vib=vib)
            parts.append((t, x, ft))
        voice, ref = place(parts, dur, sr)
        voice = voice[: int(round(dur * sr))]
    episodes = [{"start": a, "dur": d, "kind": "rephold", "hold": j} for j, (a, d) in enumerate(segs)]
    meta = {"voice": f"{syn}_k{k:04d}", "voice_kind": "syn_rephold", "source_kind": syn, "series_dur": dur,
            "synth": {"gen": syn, "seed": seed, "k": k, "f0": round(f0, 3), "kind": kind, "qual": qual, "vib": vib, "sr": sr, "recipe": "S2b"}}
    bed = bs = None
    if cond != "clean":
        bed = pick_bed("h6b", f"{sx}|{syn}", k * 2 + ["snr+10", "snr+0"].index(cond), CLASSES5)
        bs = bseed("h6b", sx, syn, k, ci)
    mix_stream("h6b", "h6b", sid, sx, sr, voice, ref, lead_of(sid), cond, bed, bs, "flat", meta, episodes)


def h6c_timeline(durs_fn, seed, total=600.0, lead=30.0):
    """Episodes and pauses ({1, 3, 8, 20} s, p .3 .3 .2 .2) after a 30 s lead until the session end; accepted when the voice
    fraction (voice time / 600 s) is 35-65 %; up to 400 sub-seeds, else the draw closest to 50 % (recorded as forced).
    durs_fn(rng, i) -> the duration of episode i (s)."""
    best = None
    for sub in range(400):
        rng = np.random.default_rng([seed, sub])
        t, eps, i = lead, [], 0
        while True:
            d = durs_fn(rng, i)
            if t + d > total - 1.0:
                break
            eps.append((t, d, i))
            t += d + float(rng.choice(H6C_PAUSE[0], p=H6C_PAUSE[1]))
            i += 1
        vf = sum(d for _, d, _ in eps) / total
        if 0.35 <= vf <= 0.65:
            return eps, {"sub_seed": sub, "voice_fraction": round(vf, 4), "forced": False}
        if best is None or abs(vf - 0.5) < abs(best[1] - 0.5):
            best = (eps, vf, sub)
    return best[0], {"sub_seed": best[2], "voice_fraction": round(best[1], 4), "forced": True}


def build_h6c(sid, spec):
    total, lead = 600.0, 30.0
    if spec[0] == "h6c_real":
        _, sx, k, s, ci, cond = spec
        V = voices5()
        recs = {v["id"]: v for v in V["records"]}
        ids = s["items"]
        sr = recs[ids[0]]["native_sr"]
        clips = []
        for rid in ids:
            x, s0 = rd(os.path.join(DATA, recs[rid]["native"]))
            x = rs(x, s0, sr)
            z = np.load(guard_not_conf(os.path.join(R5HV, "praat", rid + ".npz")))
            dur = len(x) / sr
            tr = np.zeros(int(np.ceil(dur / 0.01)) + 1, np.float32)
            idx = np.round((float(z["t0"]) + np.arange(len(z["f0"])) * 0.01) / 0.01).astype(int)
            ok = (idx >= 0) & (idx < len(tr))
            tr[idx[ok]] = z["f0"][ok]
            fade = int(0.01 * sr)
            e = np.minimum(np.minimum(1.0, (np.arange(len(x)) + 1) / fade), (len(x) - np.arange(len(x))) / fade)
            clips.append((rid, x * e, tr, dur))
        seed = SEED * 1000 + 100 + (0 if sx == "m" else 50) + k
        eps, info = h6c_timeline(lambda rng, i: clips[i % len(clips)][3], seed, total, lead)
        parts, episodes = [], []
        for t, d, i in eps:
            rid, x, tr, _ = clips[i % len(clips)]
            parts.append((t, x, tr))
            episodes.append({"start": round(t, 4), "dur": round(d, 4), "kind": "real_vowel", "rec": rid})
        meta = {"voice": f"real_{s['person']}", "voice_kind": "real", "source_kind": "real", "person": s["person"], "records": ids,
                "source": recs[ids[0]]["source"], "licence": recs[ids[0]]["licence"], "timeline": info}
        src = "real"
        mk = ["flat", "phone", "phone2agc"][k % 3]
    else:
        _, sx, k, ci, cond = spec
        syn = ["vsynth", "lfsynth"][k % 2]
        seed = (VSYN0 if syn == "vsynth" else LSYN0) + VOFF[("h6c", sx)] + k
        rng0 = np.random.default_rng(seed)
        sr = RATES[k % 3]
        c = loguni(rng0, *(LOWB[sx] if (k // 2) % 2 == 0 else BANDS[sx]))      # the session's f0 centre (half the sessions in the low band)
        types = []
        rng_t = np.random.default_rng([seed, 999])                              # episode types / params: independent of the timeline draws

        def durs(_rng, i):
            rng = rng_t
            while len(types) <= i:
                ty = H6C_TYPES[int(rng.choice(len(H6C_TYPES), p=H6C_P))]
                if ty in ("hold", "hum"):
                    d = float(rng.uniform(6.0, 20.0))
                    prm = {"dur": d}
                elif ty == "rep":
                    nh = int(rng.integers(3, 7))
                    hl = [float(rng.uniform(6.0, 15.0)) for _ in range(nh)]
                    br = [float(rng.uniform(1.5, 3.0)) for _ in range(nh - 1)]
                    d = sum(hl) + sum(br)
                    prm = {"dur": d, "holds": hl, "breaths": br}
                elif ty in ("liptrill", "tongtrill", "straw"):
                    d = float(rng.uniform(6.0, 16.0))
                    prm = {"dur": d}
                else:
                    ng = int(rng.integers(2, 4))
                    d = ng * 5.0 - 1.0
                    prm = {"dur": d, "glides": ng}
                prm["vowel"] = ["a", "o", "u", "i"][int(rng.integers(0, 4))]
                quals = ["modal", "soft", "breathy"] + (["pressed"] if syn == "lfsynth" else [])
                prm["qual"] = quals[int(rng.integers(0, len(quals)))]
                prm["semi"] = float(rng.uniform(-2.0, 4.0))
                types.append((ty, prm))
            return types[i][1]["dur"]

        eps, info = h6c_timeline(durs, seed, total, lead)
        parts, episodes = [], []
        for t, d, i in eps:
            ty, prm = types[i]
            es = [seed, 1000 + i]
            f0 = c * 2 ** (prm["semi"] / 12)
            if ty in ("hold", "hum"):
                kind = "hum" if ty == "hum" else prm["vowel"]
                x, ft = (vs_call if syn == "vsynth" else lf_call)(sr, d, f0, sx, kind, prm["qual"], es, 10.0)
                eplist = [{"start": round(t, 4), "dur": round(d, 4), "kind": ty}]
            elif ty == "rep":
                kind = prm["vowel"]
                segs, tt = [], 0.0
                for j, h in enumerate(prm["holds"]):
                    segs.append((tt, h))
                    tt += h + (prm["breaths"][j] if j < len(prm["breaths"]) else 0.0)
                if syn == "lfsynth":
                    x, ft = lf_call(sr, d, f0, sx, kind, prm["qual"], es, 8.0, segs=segs)
                else:
                    pp = []
                    for j, (a, h) in enumerate(segs):
                        xx, ff = vs_call(sr, h, f0, sx, kind, prm["qual"], es + [j], 8.0)
                        pp.append((a, xx, ff))
                    x, ft = place(pp, d, sr)
                eplist = [{"start": round(t + a, 4), "dur": round(h, 4), "kind": "rep", "hold": j} for j, (a, h) in enumerate(segs)]
            else:
                ex = {"siren": "humsiren", "slide": "vslide"}.get(ty, ty)
                lo = c if ty in ("siren", "slide") else c / 1.25 * 2 ** (prm["semi"] / 12)
                if ty in ("siren", "slide"):
                    ng = prm["glides"]
                    full, fref, segs = exercise(syn, ex, sr, sx, lo, es, dur=15.0)
                    x, ft = full[: int(round(d * sr))], fref[: int(np.ceil(d / 0.01)) + 1]
                    segs = segs[:ng]
                    eplist = [{"start": round(t + a, 4), "dur": dd, "kind": ty} for a, dd in segs]
                else:
                    x, ft, _ = exercise(syn, ex, sr, sx, lo, es, dur=d)
                    eplist = [{"start": round(t, 4), "dur": round(d, 4), "kind": ty}]
            parts.append((t, np.asarray(x, np.float64), np.asarray(ft, np.float32)))
            episodes += eplist
        meta = {"voice": f"{syn}_k{k:04d}", "voice_kind": "syn_session", "source_kind": syn, "timeline": info,
                "synth": {"gen": syn, "seed": seed, "k": k, "centre_f0": round(c, 3), "sr": sr,
                          "episode_types": dict(collections.Counter(types[i][0] for _, _, i in eps))}}
        src = syn
        mk = ["flat", "phone", "phone2agc"][(k // 2) % 3]
    # the voice layer on the session timeline (0 = session start), level / bed / mic as mix_stream with lead = 0
    voice, ref = place([(t, x, ft) for t, x, ft in parts], total, sr)
    voice = voice[: int(round(total * sr))]
    rng = np.random.default_rng([SEED, fnv1a(sid)])
    lvl = -26.0 + float(rng.uniform(-6.0, 6.0))
    n = len(voice)
    y = voice * (10 ** (lvl / 20) / max(active_rms(voice), 1e-12))
    bmeta = {}
    if cond == "clean":
        y = y + np.random.default_rng([SEED, fnv1a(sid), 1]).standard_normal(n) * 10 ** (-70 / 20)
    else:
        bed = pick_bed("h6c", f"{sx}|{src}", k * 2 + ["snr+10", "snr+0"].index(cond), CLASSES5)
        bs = bseed("h6c", sx, src, k, ci)
        nz = render_bed(bed, n, sr, bs)
        nr = float(np.sqrt(np.mean(np.square(nz))))
        y = y + nz * (10 ** (lvl / 20) / 10 ** (int(cond[3:]) / 20) / max(nr, 1e-12))
        bmeta = {"bed": dict(bed, seed=bs if bed["type"] == "synthetic" else None)}
    y = mic(y, sr, mk)
    rf = np.zeros(int(np.ceil(total / 0.01)) + 1, np.float32)
    m = min(len(ref), len(rf))
    rf[:m] = ref[:m]
    holds = [[e["start"], round(e["start"] + e["dur"], 4)] for e in episodes]
    write_stream("h6c", sid, sx, sr, y, rf, dict(meta, row="h6c", cond=cond, lead=lead, level_db=round(lvl, 2), mic=mk, session_len=total, **bmeta),
                 holds, episodes, lead, total)


# ----------------------------------------------------------------------------- H8 (machine switching on / off; r3/vsess construction)
_H8 = {}


def _vsess_groups():
    if "G" not in _H8:
        import build_vsess
        _H8["G"] = build_vsess.groups(load_manifest())
    return _H8["G"]


def h8_groups():
    """40 voice groups per sex from the rounds 1-2 val split (LibriSpeech test, VCTK val, Coswara val, SVD val), as r3/build_vsess
    groups; sex = the group's records' stated gender (all records must agree); groups in FNV-1a order of "r6h8:" + key per source,
    the sources in turn, until 40 per sex."""
    if "order" in _H8:
        return _H8["order"]
    G = _vsess_groups()
    by = {"m": collections.defaultdict(list), "f": collections.defaultdict(list)}
    for (s, k), rs_ in G.items():
        if s not in ("librispeech", "vctk", "coswara", "svd"):
            continue
        gs = {r.get("gender") for r in rs_}
        if len(gs) != 1 or list(gs)[0] not in ("m", "f"):
            continue
        by[list(gs)[0]][s].append(k)
    out = []
    for sx in ("m", "f"):
        srcs = sorted(by[sx])
        for s in srcs:
            by[sx][s].sort(key=lambda k: (fnv1a(f"r6h8:{s}:{k}"), k))
        got, i = [], 0
        while len(got) < N0["h8"] and any(by[sx].values()):
            s = srcs[i % len(srcs)]
            i += 1
            if by[sx][s]:
                got.append(f"{s}:{by[sx][s].pop(0)}")
        out += [(sx, g) for g in got]
    _H8["order"] = out
    return out


def build_h8(sid, spec):
    import sessions as S
    from tcommon import frame_levels_db, read_wav
    _, sx, vg = spec
    G = _vsess_groups()
    s, k = vg.split(":", 1)
    rs_ = G[(s, k)]
    groups_sx = [g for x, g in h8_groups() if x == sx]
    j = groups_sx.index(vg)
    snr = 10 if j % 2 == 0 else 0
    switch_off = (j // 2) % 2 == 1
    recs = [{"dur": float(r["dur"])} for r in rs_]
    audio = [read_wav(os.path.join(DATA, guard_not_conf(r["path"])))[0] for r in rs_]
    refs = []
    for r in rs_:
        p = P("refs", "h8", r["id"] + ".f32")
        z = np.load(os.path.join(DATA, r["f0_path"]))
        t0, hop, f0 = float(z["t0"]), float(z["hop"]), z["f0"].astype(np.float32)
        if not os.path.exists(p):
            x = read_wav(os.path.join(DATA, r["path"]))[0]
            v = f0 > 0
            g = f0.copy()
            if v.any():
                lev = frame_levels_db(x, t0, hop, len(f0))
                g = np.where(v & (lev >= np.percentile(lev[v], 95) - 30.0), f0, 0).astype(np.float32)
            os.makedirs(os.path.dirname(p), exist_ok=True)
            g.astype("<f4").tofile(p)
        refs.append({"path": p, "t0": t0, "hop": hop})
    seed = SEED * 1000 + 600 + (0 if sx == "m" else 100) + j
    pl, stretches, info = S.timeline(recs, seed)
    # the voice layer and its level exactly as sessions.render (bed = None -> the -70 dBFS floor throughout)
    mix, vg_, ng_, sc_, lev = S.render(recs, audio, pl, seed, None, None)
    y = mix.astype(np.float64) / sc_                      # undo render's anti-clip scale; applied again after the bed
    n = len(y)
    rng = np.random.default_rng([SEED, fnv1a(sid)])
    t_on = float(rng.uniform(60.0, 150.0))
    t_off = t_on + 120.0 if switch_off else None
    bed = pick_bed("h8", sx, j, CLASSES5)
    bs = BSYN0 + BOFF["h8"] + SEXOFF[sx] + j
    a = int(round(t_on * S.SR))
    b_ = n if t_off is None else int(round(t_off * S.SR))
    seg = render_bed(bed, n - a, S.SR, bs)
    nr = float(np.sqrt(np.mean(np.square(seg))))
    g = 10 ** (lev / 20) / 10 ** (snr / 20) / max(nr, 1e-12)
    env = np.zeros(n)
    nf = int(0.5 * S.SR)
    env[a:b_] = 1.0
    env[a:a + nf] = np.linspace(0, 1, nf)
    if t_off is not None:
        env[b_ - nf:b_] = np.linspace(1, 0, nf)
    bl = np.zeros(n)
    bl[a:] = seg[: n - a]
    y = y + g * bl * env
    layers = [{"at": q["at"], "len": q["len"], "from": q["from"], "ref": refs[q["rec"]]} for q in pl]
    import soundfile as sf
    pk = float(np.max(np.abs(y)))
    sc = 1.0 if pk <= 0.999 else 0.999 / pk
    wp = P("audio", "h8", sid + ".wav")
    os.makedirs(os.path.dirname(wp), exist_ok=True)
    sf.write(wp, (y * sc).astype(np.float32), S.SR, subtype="PCM_16")
    lmeta = [{"rec": rs_[q["rec"]]["id"], "gender": rs_[q["rec"]].get("gender"), "at": q["at"], "len": q["len"], "from": q["from"]} for q in pl]
    spec_ = {"id": sid, "gender": sx, "audio": {"path": wp, "fmt": "wav", "sr": S.SR, "start": 0, "len": n}, "ref": {"kind": "mix", "layers": layers},
             "holds": [], "meta": {"set": "h8", "row": "h8", "snr_db": snr, "cond": f"snr{snr:+d}", "source": s, "vgroup": vg, "stretches": stretches,
                                   "layers": lmeta, "voice_gain": vg_, "noise_gain": g, "gain_scale": sc, "voice_level_db": round(lev, 2), "seed": seed,
                                   "switch_on": round(t_on, 4), "switch_off": None if t_off is None else round(t_off, 4), "fade_s": 0.5,
                                   "bed": dict(bed, seed=bs if bed["type"] == "synthetic" else None), **info}}
    write_json(P("items", "h8", sid + ".json"), spec_)


# ----------------------------------------------------------------------------- the review's probe screens (S1 ... S4)
def build_probe(sid, spec):
    import soundfile as sf
    import probes5_val
    _, sset, s = spec
    x, (t0, hop, ft), segs, f0v = probes5_val.make(s)
    wp = P("audio", sset, sid + ".wav")
    os.makedirs(os.path.dirname(wp), exist_ok=True)
    sf.write(wp, x, s["sr"], subtype="FLOAT")                 # as the review's export (FLOAT): bit-exact with its saved WAVs
    rp = P("refs", sset, sid + ".f32")
    os.makedirs(os.path.dirname(rp), exist_ok=True)
    np.asarray(ft, "<f4").tofile(rp)
    eps = [{"start": s["lead"] + a, "dur": d, "kind": str(s.get("kind", s.get("ex")))} for a, d in (segs or [(0.0, s["dur"])])]
    spec_ = {"id": sid, "gender": s.get("sex"), "audio": {"path": wp, "fmt": "wav", "sr": s["sr"], "start": 0, "len": len(x)},
             "ref": {"kind": "praat", "path": rp, "t0": 0.0, "hop": 0.01}, "holds": [[e["start"], e["start"] + e["dur"]] for e in eps],
             "meta": dict(review_spec=s, set=sset, row="probe", cond="clean" if s["bed"] == "clean" else f"{s['bed']}|{s['snr']}",
                          voice_t0=s["lead"], voice_t1=s["lead"] + s["dur"], episodes=eps)}
    write_json(P("items", sset, sid + ".json"), spec_)


BUILDERS = {"h4": build_h45, "h5": build_h45, "h6a": build_h6a, "h6b": build_h6b, "h6c": build_h6c, "h8": build_h8}


def build():
    sset = A["set"]
    i0, n0 = map(int, A.get("shard", "0/1").split("/"))
    todo = [(sid, sp) for j, (sid, sp) in enumerate(items(sset)) if j % n0 == i0]
    done = 0
    for sid, sp in todo:
        if os.path.exists(P("items", sset, sid + ".json")):
            continue
        (build_probe if sset in PROBE_SETS else BUILDERS[sset])(sid, sp)
        done += 1
        if done % 20 == 0:
            log(f"{sset} {i0}/{n0}: {done} rendered")
    log(f"{sset} {i0}/{n0}: {done} rendered, {len(todo)} in shard")


# ----------------------------------------------------------------------------- the review sessions (rendered by sess5_val / sess3_val)
def harness_takes():
    """(singer, tech, vowel) of the old harness's 399 VocalSet long tones (r3/fp inventory names bench:...:vocalset__<singer>_<tech>_<v>)."""
    inv = json.load(open(os.path.join(ROOT, "r3", "fp", "inventory.json"), encoding="utf8"))
    out = set()
    for n in inv:
        m = re.match(r"^bench:[^:]+:vocalset__([a-z]+\d+)_([a-z]+)_([aeiou])$", n)
        if m:
            out.add(m.groups())
    return out


def probes():
    """valdump specs for the review sessions: sess5 (round-5 review) / sess3 (round-3 review), from the builders' probe lists.
    Masks: hops inside a take of the old harness's 399 files (§2.2) or a take the §1.2 item 5 check removed are never read.
    A session whose real bed the check removed leaves validation."""
    sset = A["set"]
    D = json.load(open(os.path.join(R6, "checks", "disjoint.json"), encoding="utf8"))
    removed = set(D["item5"]["removed"])
    H = harness_takes()
    if sset == "sess5":
        import sess5_val as SB
        L = json.load(open(os.path.join(SB.HV, "probes-sess5.json"), encoding="utf8"))
        root, order = SB.VS, SB.ORDER
        tech_files = {}
        for singer in sorted(os.listdir(root)):
            blocks = []
            for o, chained in order:
                fs_ = sorted(glob.glob(os.path.join(root, singer, *o.split("/"), "*.wav")))
                tk = [(o, os.path.basename(f)) for f in fs_]
                blocks += [tk] if chained else [[t] for t in tk]
            tech_files[singer] = blocks
    else:
        import sess3_val as SB
        L = json.load(open(os.path.join(SB.HV, "probes-sess3.json"), encoding="utf8"))
        root = SB.VS
        tech_files = {}
        for singer in sorted(os.listdir(root)):
            files = []
            for o in SB.ORDER:
                fs_ = sorted(glob.glob(os.path.join(root, singer, *o.split("/"), "*.wav")))
                if fs_:
                    files.append((o, os.path.basename(fs_[0])))
            tech_files[singer] = files
    out, dropped = [], []
    for it in L:
        m = it["meta"]
        singer = m["singer"]
        if m.get("bed") and f"tuning:{m['bed']}" in removed:
            dropped.append({"id": it["id"], "why": f"real bed {m['bed']} removed by the §1.2 item 5 check"})
            continue
        sid = it["id"] if sset == "sess5" else it["id"].replace("sess__", "sess3__")
        rp = P("refs", sset, sid + ".f32")
        os.makedirs(os.path.dirname(rp), exist_ok=True)
        R = json.load(open(it["refPath"], encoding="utf8"))
        assert R["t0"] == 0.0 and R["hop"] == 0.01
        np.asarray(R["f0"], "<f4").tofile(rp)
        eps, mask = [], []
        for e in m["episodes"]:
            if sset == "sess5":
                tech, fn = tech_files[singer][e["bi"]][e["j"]]
            else:
                tech, fn = tech_files[singer][e["idx"]]
            vowel = fn[-5] if fn[-6] == "_" else None
            harness = tech.startswith("long_tones/") and (singer, tech.split("/")[1], vowel) in H
            rem = f"vocalset:{singer}/{tech}/{fn}" in removed
            ee = dict(e, tech=tech, file=fn, harness=harness, removed_by_item5=rem, liptrill=tech.endswith("lip_trill"))
            eps.append(ee)
            if harness or rem:
                mask.append([round(e["start"] - 0.5, 4), round(e["start"] + e["dur"] + 0.5, 4)])
        import soundfile as sf
        info = sf.info(it["wav"])
        out.append({"id": sid, "gender": it["gender"], "audio": {"path": it["wav"], "fmt": "wav", "sr": int(info.samplerate), "start": 0, "len": int(info.frames)},
                    "ref": {"kind": "praat", "path": rp, "t0": 0.0, "hop": 0.01},
                    "holds": [[e["start"], round(e["start"] + e["dur"], 4)] for e in eps],
                    "meta": dict({k: v for k, v in m.items() if k != "episodes"}, set=sset, row="h7a", episodes=eps, mask=mask,
                                 voice_t0=30.0, voice_t1=600.0)})
    write_json(P("streams", f"{sset}.json"), out)
    write_json(P("streams", f"{sset}.dropped.json"), dropped, indent=1)
    log(f"{sset}: {len(out)} sessions ({len(dropped)} left validation: {[d['id'] for d in dropped]}); masked takes "
        f"{sum(len(o['meta']['mask']) for o in out)}")


# ----------------------------------------------------------------------------- specs, counts, hash
def specs():
    sets = A["set"].split(",") if A.get("set") else ["h4", "h5", "h6a", "h6b", "h6c", "h8"] + list(PROBE_SETS)
    for sset in sets:
        out, miss = [], []
        for sid, _ in items(sset):
            p = P("items", sset, sid + ".json")
            if not os.path.exists(p):
                miss.append(sid)
                continue
            out.append(json.load(open(p, encoding="utf8")))
        if miss:
            raise SystemExit(f"{sset}: {len(miss)} streams not rendered (e.g. {miss[:3]})")
        write_json(P("streams", f"{sset}.json"), out)
        log(f"{sset}: {len(out)} streams, {sum(s['audio']['len'] / s['audio']['sr'] for s in out) / 3600:.2f} h")


ALL_SETS = ["h4", "h5", "h6a", "h6b", "h6c", "h8", "s1", "s1b", "s2", "s2b", "s3", "s4", "sess5", "sess3"]


def counts():
    import hcells
    C, S, miss = collections.Counter(), collections.Counter(), 0
    for sset in ALL_SETS:
        for s in json.load(open(P("streams", f"{sset}.json"), encoding="utf8")):
            jp = P("dumps", sset, s["id"] + ".json")
            if not os.path.exists(jp):
                miss += 1
                continue
            m = json.load(open(jp, encoding="utf8"))
            a = np.fromfile(jp[:-5] + ".f32", dtype="<f4").reshape(len(m["cols"]), m["n"])
            col = {c: a[i] for i, c in enumerate(m["cols"])}
            S[f"{sset}|{s['gender']}"] += 1
            ok = col["lab"] == 1
            for key, sel in hcells.cells(sset, s, m, col):
                C[key] += int((ok & sel).sum())
    if miss:
        raise SystemExit(f"{miss} streams without a dump: run the dumps first")
    rep = hcells.size_report(C)
    J = {"what": "round-6 H4-H8 CORRECT hops per gating cell / bin and sex (current app, aggregate; r6/hcells.py)", "streams": dict(sorted(S.items())),
         "correct_hops": dict(sorted(C.items())), **rep}
    write_json(P("counts.json"), J, indent=1)
    log(json.dumps({"streams": J["streams"], "grow": rep["grow"], "cannot_be_evaluated": rep["cannot_be_evaluated"][:40]}, indent=1))
    if "grow" in A and rep["grow"]:
        PL = plan()
        for k in rep["grow"]:
            PL[k] += hcells.GROW_STEP[k.split("|")[0]]
        write_json(P("plan.json"), PL, indent=1)
        log("grow ->", {k: PL[k] for k in rep["grow"]})


def sha(p):
    h = hashlib.sha256()
    with open(p, "rb") as f:
        for b in iter(lambda: f.read(1 << 20), b""):
            h.update(b)
    return h.hexdigest()


def hash_inputs():
    lines = []
    for sset in ALL_SETS:
        sp = P("streams", f"{sset}.json")
        files = [sp]
        for s in json.load(open(sp, encoding="utf8")):
            files.append(s["audio"]["path"])
            if s["ref"]["kind"] == "praat":
                files.append(s["ref"]["path"])
            else:
                files += sorted({L["ref"]["path"] for L in s["ref"]["layers"]})
            files += [P("dumps", sset, s["id"] + ".json"), P("dumps", sset, s["id"] + ".f32")]
        seen = set()
        for f in files:
            if f in seen:
                continue
            seen.add(f)
            r = os.path.relpath(f, ROOT).replace(os.sep, "/")
            lines.append(f"{sha(f)}  {r if not r.startswith('..') else f.replace(os.sep, '/')}")
    for f in (P("beds.json"), P("plan.json"), P("counts.json"), P("streams", "sess5.dropped.json"), P("streams", "sess3.dropped.json"),
              os.path.join(R6, "checks", "disjoint.json")):
        lines.append(f"{sha(f)}  {os.path.relpath(f, ROOT).replace(os.sep, '/')}")
    os.makedirs(os.path.join(R6, "sel"), exist_ok=True)
    open(os.path.join(R6, "sel", "inputs.sha256"), "w", encoding="utf8", newline="\n").write("\n".join(lines) + "\n")
    log(f"hashed {len(lines)} files -> r6/sel/inputs.sha256")


if __name__ == "__main__":
    {"beds": beds, "build": build, "probes": probes, "specs": specs, "counts": counts, "hash": hash_inputs}[sys.argv[1]]()
