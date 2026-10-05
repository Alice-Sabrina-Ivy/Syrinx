# fetch_voice.py — corpus B: REAL held-voice material (+ the repo's speech
# corpora as voiced-speech references).
#
#   node scripts/notch-adversarial/realdata/export_refs.mjs     # once (refs)
#   python scripts/notch-adversarial/realdata/fetch_voice.py [--sources=vocalset,vocadito,hillenbrand,ptdb,fda] [--jobs=4]
#   (opt-in, local only: add `sessions` to --sources; see the source list)
#
# Writes build/notchvd/data/voice/<source>/<id>.wav (16 kHz mono float32,
# original level), <id>.f0.json sidecars ({hop, ref: {hopMs, f0} | null,
# praat: {t0, hop, f0}}) and data/manifests/voice.<source>.json. Each record
# carries `held`: [[t0, t1, f0_med, vib_cents, drift_cents, micro_cents], ...]
# (heldseg.py; from the corpus reference where one exists, else Praat AC).
#
# Sources:
#   vocalset    VocalSet (Wilkins et al. ISMIR 2018; zenodo 1193957, CC BY 4.0)
#               long_tones/{straight,forte,pp,messa}: 20 trained singers
#               (11 F / 9 M) x 5 vowels, sustained notes. Range-read from the
#               2.1 GB zip (only these ~400 files). 44.1 kHz -> 16 kHz.
#   vocadito    tests/dsp/data/vocadito (CC BY 4.0), 40 solo singing excerpts
#               with F0 annotations.
#   hillenbrand tests/dsp/data/{men,women} (Hillenbrand 1995) hVd vowels
#               (~0.3 s quasi-steady; short "sustained" vowels), vowdata F0.
#   ptdb        PTDB-TUG subset (ODbL), 180 read sentences, laryngograph REF.
#   fda         FDA (Bagshaw 1993), 100 read utterances, laryngograph pitchmarks.
#   pvqd        Perceptual Voice Qualities Database (Walden; Mendeley Data
#               9dz247gnyb v4, CC BY 4.0): 296 clinical recordings, each
#               sustained /a/ + /i/ (~3-5 s) then CAPE-V sentences, 44.1 kHz;
#               many dysphonic voices (capev_severity from the ratings sheet).
#   voiced      VOICED (Cesari et al. 2018; PhysioNet, ODC-By 1.0): 208 ~5 s
#               sustained /a/, 8 kHz (57 healthy, rest pathological;
#               `diagnosis` per record).
#   sessions    OPT-IN, never in the default --sources: the private session
#               recordings (local only; folder from SYRINX_SESSIONS_DIR or
#               --sessions-root, see CLAUDE.md "Private session data"). Voiced
#               runs of the user and of the second voice (speaker codes 1 / 2)
#               from the session label files (Praat AC 100-500 F0 + speaker
#               labels), cut with 0.5 s context: every run that contains a held
#               stretch >= 0.5 s, and every voiced run >= 1.5 s (glides /
#               sirens). "outside"-labelled steady runs >= 1 s are written to the
#               NOISE corpus (source sessions_outside; the census decides what
#               they are). Anything computed with this source stays out of
#               measurements/ in this repo.
import os, re, json, glob
from concurrent.futures import ThreadPoolExecutor
import numpy as np, soundfile as sf
from common import DL, DATA, REPO, SR, args, to16k_mono, write_clip, save_manifest, fetch
from heldseg import held_segments, praat_f0

A = args()
JOBS = int(A.get("jobs", 4))
SOURCES = A.get("sources", "vocalset,vocadito,hillenbrand,ptdb,fda").split(",")
TD = os.path.join(REPO, "tests/dsp/data")
REFS = os.path.join(DL, "corpora")

def sidecar(source, cid, ref, x):
    t, f = praat_f0(x, SR)
    d = os.path.join(DATA, "voice", source); os.makedirs(d, exist_ok=True)
    json.dump(dict(ref=ref, praat=dict(t0=round(float(t[0]), 4) if len(t) else 0, hop=0.01, f0=[round(float(v), 2) for v in f])),
              open(os.path.join(d, cid + ".f0.json"), "w"))
    if ref is not None:
        hop = ref["hopMs"] / 1000; tr = np.arange(len(ref["f0"])) * hop
        held = held_segments(tr, ref["f0"]); basis = "ref"
    else:
        held = held_segments(t, f); basis = "praat"
    return held, basis, float(np.median(f[f > 0])) if (f > 0).any() else 0.0

def rec(source, cid, x, meta, ref=None):
    held, basis, f0med = sidecar(source, cid, ref, x)
    return write_clip("voice", source, cid, x, dict(**meta, held=held, held_basis=basis, f0_median=round(f0med, 1),
                                                     held_sec=round(sum(h[1] - h[0] for h in held), 2),
                                                     f0_path=f"voice/{source}/{cid}.f0.json"))

def refs(name): return {r["trackId"]: r for r in json.load(open(os.path.join(REFS, f"{name}.refs.json")))}

# --------------------------------------------------------------------------
def src_vocalset():
    from remotezip import RemoteZip
    url = "https://zenodo.org/api/records/1193957/files/VocalSet.zip/content"
    names = json.load(open(os.path.join(DL, "vocalset_names.json")))
    sel = [n for n in names if n.startswith("FULL/") and "/long_tones/" in n and n.endswith(".wav")
           and n.split("/")[-2] in ("straight", "forte", "pp", "messa")]
    todo = [n for n in sel if not os.path.exists(os.path.join(DL, "vocalset", n))]
    if todo:
        rz = RemoteZip(url)
        for i, n in enumerate(todo):
            dest = os.path.join(DL, "vocalset", n); os.makedirs(os.path.dirname(dest), exist_ok=True)
            open(dest + ".part", "wb").write(rz.read(n)); os.replace(dest + ".part", dest)
            if i % 50 == 0: print(f"vocalset {i}/{len(todo)}", flush=True)
    def one(n):
        x, sr = sf.read(os.path.join(DL, "vocalset", n), always_2d=True)
        singer, tech, fn = n.split("/")[1], n.split("/")[-2], os.path.basename(n)[:-4]
        return rec("vocalset", f"vocalset__{singer}_{tech}_{fn.split('_')[-1]}", to16k_mono(x, sr), dict(
            **{"class": f"long_tone_{tech}"}, singer=singer, gender=singer[0], url=url + f" ({n})", license="CC BY 4.0",
            attribution="Wilkins, Seetharaman, Wahl, Pardo: VocalSet, ISMIR 2018 (zenodo 1193957)",
            orig_sr=sr, orig_channels=x.shape[1], codec="pcm", notes=""))
    with ThreadPoolExecutor(JOBS) as ex: return list(ex.map(one, sel))

def src_vocadito():
    R = refs("vocadito")
    def one(p):
        x, sr = sf.read(p, always_2d=True); tid = os.path.basename(p)[:-4]
        r = R.get(tid)
        return rec("vocadito", f"vocadito__{tid}", to16k_mono(x, sr), dict(
            **{"class": "solo_singing"}, gender="unknown", url="tests/dsp/data/vocadito", license="CC BY 4.0",
            attribution="Bittner et al., vocadito (zenodo 5578807)", orig_sr=sr, orig_channels=x.shape[1], codec="pcm", notes=""),
            ref=dict(hopMs=r["hopMs"], f0=r["f0"]) if r else None)
    with ThreadPoolExecutor(JOBS) as ex: return list(ex.map(one, sorted(glob.glob(os.path.join(TD, "vocadito/Audio/*.wav")))))

def src_hillenbrand():
    R = refs("hillenbrand")
    def one(tid):
        sub = "men" if tid[0] == "m" else "women"
        x, sr = sf.read(os.path.join(TD, sub, tid + ".wav"), always_2d=True); r = R[tid]
        return rec("hillenbrand", f"hillenbrand__{tid}", to16k_mono(x, sr), dict(
            **{"class": "hvd_vowel"}, gender=tid[0], url=f"tests/dsp/data/{sub}", license="Hillenbrand et al. 1995 (research use)",
            attribution="Hillenbrand, Getty, Clark, Wheeler 1995", orig_sr=sr, orig_channels=x.shape[1], codec="pcm",
            notes="ref = vowdata steady-state F0 over the central 70 %"),
            ref=dict(hopMs=r["hopMs"], f0=r["f0"]))
    with ThreadPoolExecutor(JOBS) as ex: return list(ex.map(one, sorted(R)))

def src_ptdb():
    R = refs("ptdb-tug")
    def one(tid):
        p = glob.glob(os.path.join(TD, "ptdb-tug/*/MIC/*", tid + ".wav"))[0]
        x, sr = sf.read(p, always_2d=True); r = R[tid]
        return rec("ptdb", f"ptdb__{tid}", to16k_mono(x, sr), dict(
            **{"class": "read_speech"}, gender=r["gender"], url="tests/dsp/data/ptdb-tug", license="ODbL 1.0",
            attribution="Pirker et al., PTDB-TUG (SPSC, TU Graz)", orig_sr=sr, orig_channels=x.shape[1], codec="pcm", notes=""),
            ref=dict(hopMs=r["hopMs"], f0=r["f0"]))
    with ThreadPoolExecutor(JOBS) as ex: return list(ex.map(one, sorted(R)))

def src_fda():
    R = refs("fda")
    def one(tid):
        sub = tid[:2]
        raw = np.fromfile(os.path.join(TD, "fda", sub, tid + ".sig"), dtype=">i2").astype(np.float32) / 32768
        r = R[tid]
        return rec("fda", f"fda__{tid}", to16k_mono(raw, 20000), dict(
            **{"class": "read_speech"}, gender=r["gender"], url="tests/dsp/data/fda", license="FDA (Bagshaw 1993; research use)",
            attribution="Bagshaw, Hiller, Jack 1993 (CSTR Edinburgh)", orig_sr=20000, orig_channels=1, codec="pcm", notes=""),
            ref=dict(hopMs=r["hopMs"], f0=r["f0"]))
    with ThreadPoolExecutor(JOBS) as ex: return list(ex.map(one, sorted(R)))

# --------------------------------------------------------------------------
# the private session recordings (opt-in source `sessions`; local only, see CLAUDE.md)
SESSIONS_DIR = A.get("sessions-root") or os.environ.get("SYRINX_SESSIONS_DIR")
SESSION_IDS = ["2025-09-08", "2026-05-07", "2026-05-26", "2026-06-09"]
PARQ = "acoustic/frames_enrollment-2026-05-07-v2.parquet"
# raw speaker labels -> codes: alice 1, outside 3, unknown / empty 0; the one
# remaining label in the files is the second voice in the recordings -> 2
SPK = {"alice": 1, "outside": 3}
SPK_KEY = {1: "alice", 2: "second"}

def spk_code(v):
    return SPK.get(v, 0 if not isinstance(v, str) or v in ("", "unknown") else 2)

def src_sessions():
    import pandas as pd
    if not SESSIONS_DIR:
        raise SystemExit("set SYRINX_SESSIONS_DIR to the folder holding the private session recordings (see CLAUDE.md)")
    root = SESSIONS_DIR.replace("\\", "/").rstrip("/")
    voice, noise = [], []
    for s in SESSION_IDS:
        d = pd.read_parquet(f"{root}/{s}/{PARQ}", columns=["timestamp_s", "speaker", "f0_hz"])
        t = d.timestamp_s.values; f = np.nan_to_num(d.f0_hz.values); sp = np.array([spk_code(v) for v in d.speaker.values])
        x, sr = sf.read(f"{root}/{s}/session.wav", always_2d=True); x = to16k_mono(x, sr)
        v = f > 0; runs = []; k = 0; n = len(f)
        while k < n:
            if not v[k]: k += 1; continue
            j = k
            while j < n and v[j] and sp[j] == sp[k]: j += 1
            runs.append((k, j)); k = j
        for a, b in runs:
            dur = t[b - 1] - t[a] + 0.01; who = sp[a]
            held = held_segments(t[a:b], f[a:b])
            if who in (1, 2) and (held or dur >= 1.5):
                c0, c1 = max(0.0, t[a] - 0.5), min(len(x) / SR, t[b - 1] + 0.51)
                seg = x[int(c0 * SR):int(c1 * SR)]
                cid = f"sessions__{s}_{SPK_KEY[who]}_{t[a]:08.2f}"
                # held / ref times relative to the cut
                hs = [[round(h[0] - c0, 3), round(h[1] - c0, 3), *h[2:]] for h in held]
                d0 = os.path.join(DATA, "voice", "sessions"); os.makedirs(d0, exist_ok=True)
                json.dump(dict(ref=dict(hopMs=10, t0=round(float(t[a] - c0), 4), f0=[round(float(q), 2) for q in f[a:b]], basis="session label f0_hz (Praat AC 100-500)"), praat=None),
                          open(os.path.join(d0, cid + ".f0.json"), "w"))
                voice.append(write_clip("voice", "sessions", cid, seg, dict(
                    **{"class": "session_held" if held else "session_long_voiced"}, gender="unknown", speaker=SPK_KEY[who], session=s,
                    session_t0=round(float(c0), 3), url=f"$SYRINX_SESSIONS_DIR/{s}/session.wav", license="private (local only)",
                    attribution="the private session recordings", orig_sr=sr, orig_channels=1, codec="pcm", notes=f"voiced run {t[a]:.2f}-{t[b-1]+0.01:.2f} s, 0.5 s context",
                    held=hs, held_basis="session_labels", f0_median=round(float(np.median(f[a:b])), 1),
                    held_sec=round(sum(h[1] - h[0] for h in held), 2), f0_path=f"voice/sessions/{cid}.f0.json")))
            elif who == 3 and held and max(h[1] - h[0] for h in held) >= 1.0:
                c0, c1 = max(0.0, t[a] - 1.0), min(len(x) / SR, t[b - 1] + 1.01)
                noise.append(write_clip("noise", "sessions_outside", f"sessions_outside__{s}_{t[a]:08.2f}", x[int(c0 * SR):int(c1 * SR)], dict(
                    **{"class": "session_outside_steady"}, session=s, session_t0=round(float(c0), 3), url=f"$SYRINX_SESSIONS_DIR/{s}/session.wav",
                    license="private (local only)", attribution="the private session recordings", orig_sr=sr, orig_channels=1, codec="pcm",
                    notes=f"'outside'-labelled steady voiced run {t[a]:.2f}-{t[b-1]+0.01:.2f} s (median {np.median(f[a:b]):.1f} Hz), 1 s context; unknown provenance",
                    held=held)))
        print(f"sessions {s}: voice {len(voice)} outside {len(noise)}", flush=True)
    save_manifest("noise", noise, "sessions_outside")
    return voice

# --------------------------------------------------------------------------
def src_pvqd():
    import requests
    d = json.load(open(fetch("https://data.mendeley.com/public-api/datasets/9dz247gnyb", os.path.join(DL, "pvqd", "meta.json"))))
    files = d["files"]; ver = d.get("version")
    sev = {}
    try:
        import pandas as pd
        f = next(f for f in files if f["filename"] == "cape_v_severity_only.xlsx")
        p = fetch(f["content_details"]["download_url"], os.path.join(DL, "pvqd", f["filename"]))
        t = pd.read_excel(p)
        rcols = [c for c in t.columns if str(c).lower().startswith("rater")]
        for _, row in t.iterrows():
            sev[str(row["File"]).strip().upper()] = round(float(np.nanmean(row[rcols].values.astype(float))), 1)
    except Exception as e:
        print("pvqd ratings:", e)
    wavs = [f for f in files if f["filename"].lower().endswith(".wav")]
    def one(f):
        fn = f["filename"]; stem = fn[:-4].replace(" ", "_")
        p = fetch(f["content_details"]["download_url"], os.path.join(DL, "pvqd", fn))
        x, sr = sf.read(p, always_2d=True)
        return rec("pvqd", f"pvqd__{stem}", to16k_mono(x, sr), dict(
            **{"class": "clinical_sustained_vowels+capev"}, gender="unknown", url=f"https://data.mendeley.com/datasets/9dz247gnyb/{ver} ({fn})",
            license="CC BY 4.0", attribution="Walden, P. R. Perceptual Voice Qualities Database (PVQD), Mendeley Data v4, doi 10.17632/9dz247gnyb.4",
            orig_sr=sr, orig_channels=x.shape[1], codec="pcm", capev_severity=sev.get(re.split(r"[ _]", fn)[0].upper()),
            notes="sustained /a/ and /i/ then CAPE-V sentences; clinical population (many dysphonic) — use capev_severity to restrict to typical voices"))
    with ThreadPoolExecutor(JOBS) as ex: return list(ex.map(one, wavs))

def src_voiced():
    base = "https://physionet.org/files/voiced/1.0.0/"
    import requests
    ids = [l.strip() for l in requests.get(base + "RECORDS", timeout=60).text.split() if l.strip()]
    def one(rid):
        hea = open(fetch(base + rid + ".hea", os.path.join(DL, "voiced", rid + ".hea"), min_bytes=20)).read().splitlines()
        info = open(fetch(base + rid + "-info.txt", os.path.join(DL, "voiced", rid + "-info.txt"), min_bytes=20), encoding="latin-1").read()
        h0 = hea[0].split(); sr = int(float(h0[2])); h1 = hea[1].split()
        gain = float(h1[2].split("(")[0].split("/")[0]); base_ = int(h1[2].split("(")[1].split(")")[0]) if "(" in h1[2] else 0
        raw = np.fromfile(fetch(base + rid + ".dat", os.path.join(DL, "voiced", rid + ".dat")), dtype="<i4").astype(np.float64)
        x = (raw - base_) / gain; x = (0.5 * x / (np.max(np.abs(x)) + 1e-12)).astype(np.float32)
        diag = re.search(r"Diagnosis:\s*(.*)", info); sex = re.search(r"Gender:\s*(\w)", info)
        return rec("voiced", f"voiced__{rid}", to16k_mono(x, sr), dict(
            **{"class": "sustained_a"}, gender=(sex.group(1).lower() if sex else "unknown"), diagnosis=(diag.group(1).strip() if diag else ""),
            url=base + rid, license="ODC-By 1.0", attribution="Cesari et al., VOICED database (PhysioNet), 2018",
            orig_sr=sr, orig_channels=1, codec="pcm (8 kHz)", notes="~5 s sustained /a/, 8 kHz (band-limited at 4 kHz); peak-normalised to 0.5"))
    with ThreadPoolExecutor(JOBS) as ex: return list(ex.map(one, ids))

FN = dict(pvqd=src_pvqd, voiced=src_voiced, vocalset=src_vocalset, vocadito=src_vocadito, hillenbrand=src_hillenbrand, ptdb=src_ptdb, fda=src_fda, sessions=src_sessions)
for s in SOURCES:
    recs = FN[s]()
    save_manifest("voice", recs, s)
    hs = sum(r["held_sec"] for r in recs)
    print(f"{s}: {len(recs)} clips, {sum(r['dur'] for r in recs) / 60:.1f} min, held {hs / 60:.1f} min in {sum(len(r['held']) for r in recs)} segments", flush=True)
