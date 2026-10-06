# fetch_heldout.py — HELD-OUT real data for the 2026-10-05 V14 follow-up:
# sources and speakers that no notch threshold, guard or rule was chosen on
# (measurements/noise-notch-voice-discrimination-2026-10-05.md, "Follow-up").
# Everything lands under build/notchvd-heldout/ (gitignored; NOTCHVD_ROOT
# overrides), in the same layout as the main corpora (common.py), so
# realdata.mjs / realeval.mjs / linecls.mjs read it with
# NOTCHVD_ROOT=build/notchvd-heldout (no index: the per-source manifests are
# the index). Nothing is redistributed; local research use only.
#
#   python scripts/notch-adversarial/realdata/fetch_heldout.py [--sources=dcaseeval,fsheld,coswara] [--jobs=3]
#        [--coswara-dates=20200820,20200814]
#
# Sources:
#   dcaseeval  DCASE 2020 Task 2 ADDITIONAL TRAINING dataset (zenodo 3727685,
#              CC BY-NC-SA 4.0): the machine ids the dev set (zenodo 3678171,
#              used in tuning) does not contain — other physical fans / pumps /
#              sliders / valves / toy cars / conveyors. Per id 4 consecutive
#              normal 10 s segments concatenated (40 s), range-read.
#   fsheld     Freesound HQ previews for search queries DISJOINT from
#              fetch_noise.py's (boilers, pool pumps, range hoods, shavers,
#              compressors, amplifiers, vehicle interiors ...), sounds already
#              in the main corpus skipped; per-sound license.
#   coswara    Coswara (github.com/iiscleap/Coswara-Data, CC BY 4.0;
#              Sharma et al., Interspeech 2020 / Sci. Data 2023): sustained
#              vowels /a/ /e/ /o/ recorded through web browsers on the
#              participants' own phones / laptops — speakers that appear in no
#              tuning corpus. Healthy participants, audio-quality label >= 1.
#              Praat AC F0 + held segments as fetch_voice.py.
import os, re, io, json, time, html, csv, tarfile, sys
HERE = os.path.dirname(os.path.abspath(__file__))
os.environ.setdefault("NOTCHVD_ROOT", os.path.abspath(os.path.join(HERE, "../../../build/notchvd-heldout")))
from concurrent.futures import ThreadPoolExecutor
import numpy as np, soundfile as sf, requests
from common import DL, DATA, SR, args, to16k_mono, write_clip, save_manifest, fetch
from remotezip import RemoteZip
from heldseg import held_segments, praat_f0

A = args()
JOBS = int(A.get("jobs", 3))
SOURCES = A.get("sources", "dcaseeval,fsheld,coswara").split(",")
MAIN_DATA = os.path.abspath(os.path.join(HERE, "../../../build/notchvd/data"))

# --------------------------------------------------------------------------
DCASE_MACHINES = ["fan", "pump", "slider", "valve", "ToyCar", "ToyConveyor"]
def src_dcaseeval():
    recs = []
    for mach in DCASE_MACHINES:
        url = f"https://zenodo.org/api/records/3727685/files/eval_data_train_{mach}.zip/content"
        cache = os.path.join(DL, "dcaseeval", f"{mach}_names.json")
        rz = None
        if os.path.exists(cache): names = json.load(open(cache))
        else:
            rz = RemoteZip(url); names = [n for n in rz.namelist() if n.endswith(".wav")]
            os.makedirs(os.path.dirname(cache), exist_ok=True); json.dump(names, open(cache, "w"))
        ids = sorted({re.search(r"id_(\d+)", n).group(1) for n in names if "normal_id_" in n})
        for mid in ids:
            norm = sorted(n for n in names if f"normal_id_{mid}_" in n)[:4]
            xs = []
            for n in norm:
                dest = os.path.join(DL, "dcaseeval", n)
                if not os.path.exists(dest):
                    if rz is None: rz = RemoteZip(url)
                    os.makedirs(os.path.dirname(dest), exist_ok=True); open(dest, "wb").write(rz.read(n))
                x, sr = sf.read(dest, always_2d=True); xs.append(to16k_mono(x, sr))
            recs.append(write_clip("noise", "dcaseeval", f"dcaseeval__{mach}_id{mid}_normal4", np.concatenate(xs), dict(
                **{"class": mach}, url=f"https://zenodo.org/records/3727685 (eval_data_train_{mach}.zip)", license="CC BY-NC-SA 4.0",
                attribution="Koizumi et al. DCASE 2020 Task 2 additional training data (MIMII: Purohit et al.; ToyADMOS: Koizumi et al.)",
                orig_sr=sr, orig_channels=x.shape[1], codec="pcm",
                notes=f"held-out machine id; 4 normal segments {[os.path.basename(n) for n in norm]} concatenated")))
        print(f"dcaseeval {mach}: ids {ids}", flush=True)
    return recs

# --------------------------------------------------------------------------
FS_HELD = {
    "boiler hum": ("boiler", 4), "water heater": ("boiler", 3), "pool pump": ("pump", 4), "pond pump": ("pump", 3),
    "range hood fan": ("exhaust_fan", 4), "kitchen hood": ("exhaust_fan", 3), "electric shaver": ("small_motor", 3),
    "electric toothbrush": ("small_motor", 3), "treadmill": ("appliance_motor", 3), "blender": ("appliance_motor", 3),
    "air compressor": ("compressor", 4), "factory hum": ("industrial", 4), "machine room": ("industrial", 4),
    "printer running": ("office", 3), "3d printer": ("office", 3), "aquarium filter": ("pump", 3), "humidifier": ("appliance_motor", 3),
    "space heater": ("hvac", 3), "fan heater": ("hvac", 3), "graphics card fan": ("computer_fan", 3), "amplifier hum": ("mains_hum", 4),
    "guitar amp hum": ("mains_hum", 3), "speaker buzz": ("mains_hum", 3), "elevator hum": ("building", 3), "escalator": ("building", 3),
    "boat engine idle": ("engine_idle", 3), "tractor idle": ("engine_idle", 3), "bus interior": ("vehicle_interior", 3),
    "train interior": ("vehicle_interior", 3), "airplane cabin": ("vehicle_interior", 3), "battery charger whine": ("electronics_whine", 3),
    "crt whine": ("electronics_whine", 3), "transformer buzz substation": ("transformer", 3), "wind turbine": ("industrial", 3),
}
def main_freesound_ids():
    p = os.path.join(MAIN_DATA, "manifests", "noise.freesound.json")
    if not os.path.exists(p): return set()
    return {r["id"].split("__")[-1] for r in json.load(open(p))}
def fs_search(q):
    url = "https://freesound.org/search/?" + requests.compat.urlencode({"q": q, "f": "duration:[12 TO 900]"})
    cache = os.path.join(DL, "freesound", "search", re.sub(r"\W+", "_", q) + ".html")
    fetch(url, cache, min_bytes=1000); time.sleep(1.5)
    h = open(cache, encoding="utf8").read()
    out = []
    for blk in h.split('class="bw-search__result"')[1:]:
        g = lambda pat: (re.search(pat, blk) or [None, None])[1]
        sid = g(r'data-sound-id="(\d+)"')
        if not sid: continue
        out.append(dict(id=sid, user=html.unescape(g(r'data-username="([^"]*)"') or ""), title=html.unescape(g(r'data-title="([^"]*)"') or ""),
                        dur=float(g(r'data-duration="([^"]*)"') or 0), sr=float(g(r'data-samplerate="([^"]*)"') or 0),
                        ogg=g(r'data-ogg="([^"]*)"'), license=g(r'title="License: ([^"]*)"') or "unknown"))
    return out
def src_fsheld():
    used = main_freesound_ids()
    sel, seen = [], set()
    for q, (cls, k) in FS_HELD.items():
        try: res = fs_search(q)
        except Exception as e: print("freesound search", q, e); continue
        n = 0
        for r in res:
            if r["id"] in seen or r["id"] in used or not r["ogg"] or n >= k: continue
            if "sampling plus" in r["license"].lower(): continue
            seen.add(r["id"]); n += 1; sel.append((q, cls, r))
    def one(item):
        q, cls, r = item
        hq = r["ogg"].replace("-lq.ogg", "-hq.ogg")
        try: dest = fetch(hq, os.path.join(DL, "freesound", os.path.basename(hq)))
        except Exception as e: print("freesound dl", r["id"], e); return None
        x, sr = sf.read(dest, always_2d=True)
        x = x[: int(sr * 300)]
        return write_clip("noise", "fsheld", f"fsheld__{cls}__{r['id']}", to16k_mono(x, sr), dict(
            **{"class": cls}, url=f"https://freesound.org/people/{r['user']}/sounds/{r['id']}/", license=r["license"],
            attribution=f"\"{r['title']}\" by {r['user']} (freesound.org)", orig_sr=int(r["sr"]) or sr, orig_channels=x.shape[1],
            codec="vorbis HQ preview (~192 kb/s)", notes=f"held-out query '{q}'; original {r['dur']:.1f} s"))
    with ThreadPoolExecutor(JOBS) as ex: return [r for r in ex.map(one, sel) if r]

# --------------------------------------------------------------------------
class Cat(io.RawIOBase):
    """Read several files back to back (Coswara's split tar.gz parts)."""
    def __init__(self, paths): self.fs = [open(p, "rb") for p in paths]; self.i = 0
    def readable(self): return True
    def readinto(self, b):
        while self.i < len(self.fs):
            n = self.fs[self.i].readinto(b)
            if n: return n
            self.i += 1
        return 0
def src_coswara():
    base = "https://raw.githubusercontent.com/iiscleap/Coswara-Data/master/"
    api = "https://api.github.com/repos/iiscleap/Coswara-Data/contents/"
    q = {}
    for v in ["a", "e", "o"]:
        p = fetch(base + f"annotations/vowel-{v}_labels.csv", os.path.join(DL, "coswara", f"vowel-{v}_labels.csv"))
        for row in csv.DictReader(open(p, encoding="utf8")):
            k = (row.get("FILENAME") or row.get("filename") or "").strip()
            lab = (row.get(" QUALITY") or row.get("QUALITY") or row.get("quality") or "").strip()
            if k: q[k] = lab
    recs = []
    for date in A.get("coswara-dates", "20200820,20200814").split(","):
        listing = json.load(open(fetch(api + date, os.path.join(DL, "coswara", f"{date}.listing.json"), min_bytes=50)))
        parts = sorted(x["name"] for x in listing if ".tar.gz." in x["name"])
        meta = {r["id"]: r for r in csv.DictReader(open(fetch(base + f"{date}/{date}.csv", os.path.join(DL, "coswara", f"{date}.csv"), min_bytes=50), encoding="utf8"))}
        paths = [fetch(base + f"{date}/{p}", os.path.join(DL, "coswara", p), min_bytes=1000) for p in parts]
        todo = []
        with tarfile.open(fileobj=io.BufferedReader(Cat(paths), 1 << 20), mode="r|gz") as tf:
            for m in tf:
                mm = re.search(r"([^/]+)/vowel-([aeo])\.wav$", m.name)
                if not (m.isfile() and mm): continue
                pid, v = mm.group(1), mm.group(2)
                md = meta.get(pid, {})
                if md.get("covid_status") != "healthy": continue
                lab = q.get(f"{pid}_vowel-{v}", q.get(pid, ""))
                if lab not in ("1", "2", "1.0", "2.0"): continue
                todo.append((pid, v, md, tf.extractfile(m).read()))
        def one(item):
            pid, v, md, raw = item
            try: x, sr = sf.read(io.BytesIO(raw), always_2d=True)
            except Exception as e: print("coswara read", pid, v, e); return None
            if len(x) < sr * 3: return None
            y = to16k_mono(x, sr)
            cid = f"coswara__{date}_{pid[:10]}_{v}"
            t, f = praat_f0(y, SR)
            d = os.path.join(DATA, "voice", "coswara"); os.makedirs(d, exist_ok=True)
            json.dump(dict(ref=None, praat=dict(t0=round(float(t[0]), 4) if len(t) else 0, hop=0.01, f0=[round(float(u), 2) for u in f])), open(os.path.join(d, cid + ".f0.json"), "w"))
            held = held_segments(t, f)
            return write_clip("voice", "coswara", cid, y, dict(
                **{"class": "sustained_vowel"}, gender={"male": "m", "female": "f"}.get(md.get("g"), "other"), age=md.get("a"),
                url=f"https://github.com/iiscleap/Coswara-Data ({date}/{pid}/vowel-{v}.wav)", license="CC BY 4.0",
                attribution="Sharma et al., Coswara (IISc Bangalore), CC BY 4.0", orig_sr=sr, orig_channels=x.shape[1], codec="pcm/web capture",
                held=held, held_basis="praat", f0_median=round(float(np.median(f[f > 0])), 1) if (f > 0).any() else 0.0,
                held_sec=round(sum(h[1] - h[0] for h in held), 2), f0_path=f"voice/coswara/{cid}.f0.json",
                notes=f"held-out speaker; sustained /{v}/; quality label {q.get(f'{pid}_vowel-{v}', '?')}"))
        with ThreadPoolExecutor(JOBS) as ex: recs += [r for r in ex.map(one, todo) if r]
        print(f"coswara {date}: {len(todo)} vowels kept of the tar", flush=True)
    return recs

FN = dict(dcaseeval=src_dcaseeval, fsheld=src_fsheld, coswara=src_coswara)
for s in SOURCES:
    t = time.time(); recs = FN[s]()
    kind = "voice" if s == "coswara" else "noise"
    save_manifest(kind, recs, s)
    print(f"{s}: {len(recs)} clips, {sum(r['dur'] for r in recs) / 60:.1f} min ({time.time() - t:.0f} s)", flush=True)
