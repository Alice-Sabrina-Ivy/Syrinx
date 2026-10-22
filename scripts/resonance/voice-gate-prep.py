"""voice-gate-prep.py — audio for scripts/resonance/voice-gate-resonance.mjs
(measurements/noise-detector-tryout-resonance-2026-10-21.md).

Writes every stream as 48 kHz float32 little-endian (scipy resample_poly,
level as is) plus a manifest streams.json:
  [{id, set, cls, sex, path, dur, holds: [[t0, t1], ...]}]

  python scripts/resonance/voice-gate-prep.py --vad-build=<voice-detector worktree>/build
      --ls=<resonance-lab cache root> --corpora=<tests/dsp/data with fda/ ptdb-tug/>
      [--out=build/resonance-voicegate]

Note 2026-10-21: branch voice-detector was deleted on 2026-10-21 by the owner's
decision; its worktree build/ data (the --vad-build input) were not kept.

Sets (the note's plan): N1 tuning-194 noise, N2 fresh confirmation noise,
S1 LibriSpeech r1_test readers, S2 PTDB-TUG, S3 FDA, H2 PVQD holds,
D1 speech then noise. H1 (synthetic holds) is made by the driver.
Public data only; no audio is committed.
"""
import argparse, glob, json, os, sys
from math import gcd
import numpy as np
import soundfile as sf
from scipy.signal import resample_poly

SR = 48000
ap = argparse.ArgumentParser()
ap.add_argument("--vad-build", required=True)
ap.add_argument("--ls", required=True)
ap.add_argument("--corpora", required=True)
ap.add_argument("--out", default="build/resonance-voicegate")
ap.add_argument("--only", default="", help="comma list of sets to (re)build; others kept from an existing streams.json")
a = ap.parse_args()
os.makedirs(os.path.join(a.out, "audio"), exist_ok=True)


def to48(x, sr):
    x = np.asarray(x, dtype=np.float64)
    if x.ndim > 1:
        x = x.mean(axis=1)
    if sr != SR:
        g = gcd(SR, sr)
        x = resample_poly(x, SR // g, sr // g)
    return x.astype(np.float32)


def read(path):
    x, sr = sf.read(path, dtype="float64", always_2d=False)
    return to48(x, sr)


ONLY = set(x for x in a.only.split(",") if x)
want = lambda k: not ONLY or k in ONLY
streams = []
if ONLY and os.path.exists(os.path.join(a.out, "streams.json")):
    streams = [s for s in json.load(open(os.path.join(a.out, "streams.json"))) if s["set"] not in ONLY]


def emit(sid, set_, cls, sex, y, holds=None):
    p = os.path.join(a.out, "audio", f"{sid}.f32")
    y.astype("<f4").tofile(p)
    streams.append({"id": sid, "set": set_, "cls": cls, "sex": sex, "path": os.path.abspath(p),
                    "dur": round(len(y) / SR, 3), "holds": holds or []})


def join_short(items, set_, min_join=20.0, target=30.0):
    """items: [(id, cls, y)] in id order. Clips < min_join s joined within
    their class into streams of >= target s (a short remainder joins the
    previous stream)."""
    by = {}
    for cid, cls, y in items:
        if len(y) / SR >= min_join:
            emit(cid, set_, cls, "na", y)
        else:
            by.setdefault(cls, []).append((cid, y))
    for cls, lst in by.items():
        groups, cur, dur = [], [], 0.0
        for cid, y in lst:
            cur.append((cid, y)); dur += len(y) / SR
            if dur >= target:
                groups.append(cur); cur, dur = [], 0.0
        if cur:
            if groups and dur < target:
                groups[-1].extend(cur)
            else:
                groups.append(cur)
        for gi, g in enumerate(groups):
            emit(f"{set_}__{cls}__join{gi:02d}", set_, cls, "na", np.concatenate([y for _, y in g]))


if want("N1"):
    # ---- N1: tuning-194 noise (split "tune" in the benchmark dumps)
    dumps = os.path.join(a.vad_build, "vad", "dumps", "noise")
    n1 = []
    for f in sorted(glob.glob(os.path.join(dumps, "*.json"))):
        m = json.load(open(f))
        if m.get("split") != "tune":
            continue
        src = os.path.join(a.vad_build, "notchvd", "data", "noise", m["source"], m["id"] + ".wav")
        n1.append((m["id"], m["label"], read(src)))
    join_short(n1, "N1")
    print(f"N1: {len(n1)} clips", file=sys.stderr)

n2_all = []
if want("N2") or want("D1"):
    # ---- N2: fresh confirmation noise
    nf = json.load(open(os.path.join(a.vad_build, "vad", "confirm", "streams", "nfresh.json")))
    n2 = []
    for it in sorted(nf, key=lambda s: s["id"]):
        cls = it["meta"]["cls"] if it["meta"]["part"] == "freesound" else "dcase25-" + it["meta"]["cls"]
        p = os.path.join(a.vad_build, "vad", "confirm", "data", "nfresh", it["id"] + ".wav")
        n2.append((it["id"], cls, read(p)))
    n2_all = n2
    if want("N2"):
        join_short(n2, "N2")
        print(f"N2: {len(n2)} clips", file=sys.stderr)

ls_first30 = {}
if want("S1") or want("D1"):
    # ---- S1: LibriSpeech r1_test readers
    import pandas as pd
    man = pd.read_parquet(os.path.join(a.ls, "bench", "manifests", "r1_test.parquet"))
    ls_root = os.path.join(a.ls, "data")
    ls_first30 = {}
    for (spk, sex), g in man.sort_values(["speaker", "order"]).groupby(["speaker", "sex"]):
        parts, dur = [], 0.0
        for p in g["path"]:
            rel = p.replace("\\", "/").split("/data/", 1)[1]
            y = read(os.path.join(ls_root, rel)); parts.append(y); dur += len(y) / SR
            if dur >= 60:
                break
        y = np.concatenate(parts)
        if want("S1"):
            emit(f"S1__{spk}", "S1", "librispeech", sex, y)
        ls_first30[(spk, sex)] = y[: 30 * SR]
    print("S1 done", file=sys.stderr)

# ---- S2 / S3: each speaker's sentences in order, split at sentence
# boundaries into streams of >= 60 s (the local PTDB-TUG copy has 4
# speakers, FDA 2; a short remainder joins the previous stream).
def split_streams(prefix, set_, cls, sex, parts, target=60.0):
    groups, cur, dur = [], [], 0.0
    for y in parts:
        cur.append(y); dur += len(y) / SR
        if dur >= target:
            groups.append(cur); cur, dur = [], 0.0
    if cur:
        if groups:
            groups[-1].extend(cur)
        else:
            groups.append(cur)
    for gi, g in enumerate(groups):
        emit(f"{prefix}__{gi:02d}", set_, cls, sex, np.concatenate(g))


if want("S2"):
    for sexdir, sex in (("FEMALE", "f"), ("MALE", "m")):
        for spkdir in sorted(glob.glob(os.path.join(a.corpora, "ptdb-tug", sexdir, "MIC", "*"))):
            files = sorted(glob.glob(os.path.join(spkdir, "*.wav")))
            if files:
                split_streams(f"S2__{os.path.basename(spkdir)}", "S2", "ptdb", sex, [read(f) for f in files])

if want("S3"):
    # ---- S3: FDA (.sig: 16-bit big-endian raw, 20 kHz)
    for spk, sex in (("rl", "m"), ("sb", "f")):
        parts = []
        for f in sorted(glob.glob(os.path.join(a.corpora, "fda", spk, "*.sig"))):
            x = np.fromfile(f, dtype=">i2").astype(np.float64) / 32768.0
            parts.append(to48(x, 20000))
        split_streams(f"S3__{spk}", "S3", "fda", sex, parts)
print("S2/S3 done", file=sys.stderr)

if want("H2"):
    # ---- H2: PVQD holds, CAPE-V severity <= 15
    pv = json.load(open(os.path.join(a.vad_build, "notchvd", "data", "manifests", "voice.pvqd.json")))
    pv = pv if isinstance(pv, list) else pv["items"]
    nh = 0
    for it in sorted(pv, key=lambda s: s["id"]):
        sev = it.get("capev_severity")
        if sev is None or sev > 15 or not it.get("held"):
            continue
        y = read(os.path.join(a.vad_build, "notchvd", "data", it["path"]))
        emit(f"H2__{it['id']}", "H2", "pvqd", it.get("gender", "unknown"), y, [[h[0], h[1]] for h in it["held"]])
        nh += 1
    print(f"H2: {nh} clips", file=sys.stderr)

if want("D1"):
    # ---- D1: 10 readers' first 30 s, then 30 s of a fan / computer / hvac clip
    noise = [(cid, y) for cid, cls, y in n2_all if cls in ("fans", "computer", "hvac") and len(y) / SR >= 30]
    readers = sorted(ls_first30)
    pick = [r for r in readers if r[1] == "f"][:5] + [r for r in readers if r[1] == "m"][:5]
    for i, (spk, sex) in enumerate(pick):
        cid, yn = noise[i % len(noise)]
        emit(f"D1__{spk}__{cid}", "D1", cid.split("__")[1], sex, np.concatenate([ls_first30[(spk, sex)], yn[: 30 * SR]]),
             [[30.0, 60.0]])

json.dump(streams, open(os.path.join(a.out, "streams.json"), "w"), indent=0)
tot = {}
for s in streams:
    tot[s["set"]] = tot.get(s["set"], [0, 0.0]); tot[s["set"]][0] += 1; tot[s["set"]][1] += s["dur"]
print(json.dumps(tot), file=sys.stderr)
