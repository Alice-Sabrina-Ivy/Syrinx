# fetch_noise.py — corpus A: REAL appliance / machine / environment noise.
#
#   python scripts/notch-adversarial/realdata/fetch_noise.py [--sources=mssnsd,demand,esc50,dcase,freesound] [--jobs=4]
#
# Writes build/notchvd/data/noise/<source>/<id>.wav (16 kHz mono float32, the
# recording's ORIGINAL level — mixes set SNR, noise-only streams need the real
# level) and writes build/notchvd/data/manifests/noise.<source>.json. Raw downloads are
# cached in build/notchvd/dl/<source>/ (re-runs skip them). Each record:
#   id, source, path, dur, rms_dbfs, peak, class, url, license, attribution,
#   orig_sr, orig_channels, codec, notes  (+ label/census fields from census.py)
#
# Sources (license per clip in the manifest; nothing here is redistributed —
# local research use only, nothing committed):
#   mssnsd    MS-SNSD noise_train/noise_test (github.com/microsoft/MS-SNSD):
#             AirConditioner, CopyMachine, VacuumCleaner, WasherDryer. Freesound
#             CC0 clips selected by Microsoft; 16 kHz mono.
#   demand    DEMAND (zenodo 1227121, CC BY 4.0) 16 kHz zips, channel 1 only
#             (range-read: ~10 MB per environment instead of ~100 MB), all 17
#             environments (domestic / office / public / street / transport /
#             nature) — broadband & mixed references incl. kitchen/washing/car.
#   esc50     ESC-50 (github.com/karolpiczak/ESC-50, CC BY-NC 3.0; ESC-10
#             subset CC BY 3.0) 5 s clips, 44.1 kHz: machine / tonal classes.
#   dcase     DCASE 2020 Task 2 dev (zenodo 3678171, CC BY-NC-SA 4.0; MIMII +
#             ToyADMOS): real industrial fan / pump / slider / valve and toy
#             car / conveyor, 10 s 16 kHz. Per machine id: 4 consecutive normal
#             train segments concatenated (40 s; contiguity NOT guaranteed —
#             seams at 10 s marks listed) + 2 anomaly test clips.
#   freesound Freesound (freesound.org) HQ ogg previews of fans / fridges /
#             HVAC / transformer & mains hum / motors / pumps / computer fans
#             found by search-page queries (no API key); per-sound license
#             (CC0 / CC BY / CC BY-NC) + author recorded. Lossy (Vorbis ~192
#             kb/s): fine for 50-460 Hz line analysis, noted in `codec`.
import os, re, io, json, time, html, csv
from concurrent.futures import ThreadPoolExecutor
import numpy as np, soundfile as sf, requests
from common import DL, args, to16k_mono, write_clip, save_manifest, fetch
from remotezip import RemoteZip

A = args()
JOBS = int(A.get("jobs", 4))
SOURCES = A.get("sources", "mssnsd,demand,esc50,dcase,freesound").split(",")

# --------------------------------------------------------------------------
def src_mssnsd():
    base = "https://raw.githubusercontent.com/microsoft/MS-SNSD/master/"
    cache = os.path.join(DL, "mssnsd_tree.json")
    fetch("https://api.github.com/repos/microsoft/MS-SNSD/git/trees/master?recursive=1", cache)
    tree = json.load(open(cache))
    keep = ("AirConditioner", "CopyMachine", "VacuumCleaner", "WasherDryer")
    files = [x["path"] for x in tree["tree"] if x["path"].startswith(("noise_train/", "noise_test/"))
             and x["path"].split("/")[1].startswith(keep) and x["path"].endswith(".wav")]
    def one(p):
        dest = fetch(base + p, os.path.join(DL, "mssnsd", p))
        x, sr = sf.read(dest, always_2d=True)
        split, fn = p.split("/"); cls = re.sub(r"_\d+\.wav$", "", fn)
        cid = f"mssnsd__{split.replace('noise_', '')}_{fn[:-4]}"
        return write_clip("noise", "mssnsd", cid, to16k_mono(x, sr), dict(
            **{"class": cls}, url=base + p, license="CC0 (Freesound clips selected by MS-SNSD; MS-SNSD README)",
            attribution="Reddy et al., MS-SNSD, Interspeech 2019", orig_sr=sr, orig_channels=x.shape[1], codec="pcm", notes=""))
    with ThreadPoolExecutor(JOBS) as ex: recs = list(ex.map(one, files))
    return recs

# --------------------------------------------------------------------------
DEMAND_ENVS = ["DKITCHEN", "DLIVING", "DWASHING", "NFIELD", "NPARK", "NRIVER", "OHALLWAY", "OMEETING", "OOFFICE",
               "PCAFETER", "PRESTO", "PSTATION", "SPSQUARE", "STRAFFIC", "TBUS", "TCAR", "TMETRO", "SCAFE"]
def src_demand():
    def one(env):
        dest = os.path.join(DL, "demand", f"{env}_ch01.wav")
        if not os.path.exists(dest):
            url = f"https://zenodo.org/api/records/1227121/files/{env}_16k.zip/content"
            try: rz = RemoteZip(url)
            except Exception as e:
                print(f"demand {env}: {e}"); return None
            os.makedirs(os.path.dirname(dest), exist_ok=True)
            open(dest, "wb").write(rz.read(f"{env}/ch01.wav"))
        x, sr = sf.read(dest, always_2d=True)
        return write_clip("noise", "demand", f"demand__{env}", to16k_mono(x, sr), dict(
            **{"class": env}, url=f"https://zenodo.org/records/1227121 ({env}_16k.zip, ch01.wav)", license="CC BY 4.0",
            attribution="Thiemann, Ito, Vincent: DEMAND, zenodo 1227121", orig_sr=sr, orig_channels=1, codec="pcm",
            notes="channel 1 of the 16-mic array"))
    with ThreadPoolExecutor(min(JOBS, 3)) as ex: recs = [r for r in ex.map(one, DEMAND_ENVS) if r]
    return recs

# --------------------------------------------------------------------------
ESC_CLASSES = ["vacuum_cleaner", "washing_machine", "engine", "airplane", "train", "helicopter", "chainsaw", "hand_saw",
               "clock_tick", "clock_alarm", "siren", "church_bells", "car_horn", "insects", "crickets"]
def src_esc50():
    base = "https://raw.githubusercontent.com/karolpiczak/ESC-50/master/"
    meta = list(csv.DictReader(io.StringIO(requests.get(base + "meta/esc50.csv", timeout=60).text)))
    lic = requests.get(base + "LICENSE", timeout=60).text
    rows = [m for m in meta if m["category"] in ESC_CLASSES]
    def one(m):
        dest = fetch(base + "audio/" + m["filename"], os.path.join(DL, "esc50", m["filename"]))
        x, sr = sf.read(dest, always_2d=True)
        stem = m["filename"][:-4]
        mm = re.search(r"\[" + re.escape(stem) + r"\.ogg\]: clip derived from (.*?) \((http[^)]*)\) by (.*?) \[(.*?)\]", lic)
        return write_clip("noise", "esc50", f"esc50__{m['category']}__{stem}", to16k_mono(x, sr), dict(
            **{"class": m["category"]}, url=base + "audio/" + m["filename"],
            license=("CC " + mm.group(4) if mm else "CC BY-NC 3.0 (ESC-50)") + ("; ESC-10" if m["esc10"] == "True" else ""),
            attribution=(f"{mm.group(3)} — {mm.group(2)}" if mm else "Piczak, ESC-50"), orig_sr=sr, orig_channels=x.shape[1],
            codec="pcm (from Freesound originals)", notes=f"fold {m['fold']}, 5 s"))
    with ThreadPoolExecutor(JOBS) as ex: recs = list(ex.map(one, rows))
    return recs

# --------------------------------------------------------------------------
DCASE_MACHINES = ["fan", "pump", "slider", "valve", "ToyCar", "ToyConveyor"]
def src_dcase():
    recs = []
    for mach in DCASE_MACHINES:
        url = f"https://zenodo.org/api/records/3678171/files/dev_data_{mach}.zip/content"
        rz = None
        names = None
        cache = os.path.join(DL, "dcase", f"{mach}_names.json")
        if os.path.exists(cache): names = json.load(open(cache))
        else:
            rz = RemoteZip(url); names = [n for n in rz.namelist() if n.endswith(".wav")]
            os.makedirs(os.path.dirname(cache), exist_ok=True); json.dump(names, open(cache, "w"))
        ids = sorted({re.search(r"id_(\d+)", n).group(1) for n in names if "/train/normal_id_" in n})[:4]
        for mid in ids:
            norm = sorted(n for n in names if f"/train/normal_id_{mid}_" in n)[:4]
            anom = sorted(n for n in names if f"/test/anomaly_id_{mid}_" in n)[:2]
            parts = []
            for n in norm + anom:
                dest = os.path.join(DL, "dcase", n)
                if not os.path.exists(dest):
                    if rz is None: rz = RemoteZip(url)
                    os.makedirs(os.path.dirname(dest), exist_ok=True); open(dest, "wb").write(rz.read(n))
                parts.append((n, dest))
            base = dict(url=f"https://zenodo.org/records/3678171 (dev_data_{mach}.zip)", license="CC BY-NC-SA 4.0",
                        attribution="Koizumi et al. DCASE 2020 Task 2 (MIMII: Purohit et al.; ToyADMOS: Koizumi et al.)",
                        codec="pcm")
            xs = []
            for n, dest in parts[:len(norm)]:
                x, sr = sf.read(dest, always_2d=True); xs.append(to16k_mono(x, sr))
            seams = list(np.cumsum([len(v) / 16000 for v in xs])[:-1].round(3))
            recs.append(write_clip("noise", "dcase", f"dcase__{mach}_id{mid}_normal4", np.concatenate(xs), dict(
                **{"class": mach}, **base, orig_sr=sr, orig_channels=x.shape[1],
                notes=f"4 consecutive normal train segments {[os.path.basename(n) for n, _ in parts[:len(norm)]]} concatenated; contiguity not guaranteed; seams at {seams} s")))
            for n, dest in parts[len(norm):]:
                x, sr = sf.read(dest, always_2d=True)
                recs.append(write_clip("noise", "dcase", f"dcase__{mach}_id{mid}_{os.path.basename(n)[:-4]}", to16k_mono(x, sr), dict(
                    **{"class": mach + "_anomaly"}, **base, orig_sr=sr, orig_channels=x.shape[1], notes="anomalous-condition test clip")))
        print(f"dcase {mach}: {len(ids)} ids")
    return recs

# --------------------------------------------------------------------------
# query -> (class, max results). Duration filter >= 12 s (the notch needs >= 5 s
# of stability to promote, 20 s when onset-born).
FS_QUERIES = {
    "refrigerator hum": ("refrigerator", 6), "fridge compressor": ("refrigerator", 5), "fridge buzz": ("refrigerator", 3),
    "transformer hum": ("transformer", 5), "mains hum": ("mains_hum", 5), "electrical hum 60hz": ("mains_hum", 4),
    "electrical hum 50hz": ("mains_hum", 4), "ground loop hum": ("mains_hum", 3), "fluorescent light hum": ("light_ballast", 4),
    "computer fan": ("computer_fan", 5), "laptop fan": ("computer_fan", 3), "server room": ("server_room", 4),
    "desk fan": ("electric_fan", 5), "ceiling fan": ("electric_fan", 4), "box fan": ("electric_fan", 3), "bathroom fan": ("exhaust_fan", 4),
    "extractor fan": ("exhaust_fan", 4), "air conditioner": ("hvac", 5), "hvac hum": ("hvac", 4), "ventilation hum": ("hvac", 4),
    "heat pump": ("hvac", 3), "dehumidifier": ("appliance_motor", 4), "air purifier": ("appliance_motor", 3),
    "aquarium pump": ("pump", 4), "water pump hum": ("pump", 3), "electric motor hum": ("electric_motor", 5),
    "microwave oven running": ("microwave", 4), "dishwasher": ("dishwasher", 4), "washing machine": ("washing_machine", 5),
    "tumble dryer": ("dryer", 3), "coil whine": ("electronics_whine", 3), "power supply buzz": ("electronics_whine", 3),
    "projector fan": ("projector", 3), "hair dryer": ("hair_dryer", 3), "vacuum cleaner": ("vacuum", 3),
    "idling engine": ("engine_idle", 3), "generator hum": ("generator", 3), "neon sign buzz": ("light_ballast", 3),
}
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
def src_freesound():
    sel, seen = [], set()
    for q, (cls, k) in FS_QUERIES.items():
        try: res = fs_search(q)
        except Exception as e: print("freesound search", q, e); continue
        n = 0
        for r in res:
            if r["id"] in seen or not r["ogg"] or n >= k: continue
            if "sampling plus" in r["license"].lower(): continue
            seen.add(r["id"]); n += 1; sel.append((q, cls, r))
    def one(item):
        q, cls, r = item
        hq = r["ogg"].replace("-lq.ogg", "-hq.ogg")
        try: dest = fetch(hq, os.path.join(DL, "freesound", os.path.basename(hq)))
        except Exception as e: print("freesound dl", r["id"], e); return None
        x, sr = sf.read(dest, always_2d=True)
        x = x[: int(sr * 300)]  # cap 5 min
        return write_clip("noise", "freesound", f"freesound__{cls}__{r['id']}", to16k_mono(x, sr), dict(
            **{"class": cls}, url=f"https://freesound.org/people/{r['user']}/sounds/{r['id']}/", license=r["license"],
            attribution=f"\"{r['title']}\" by {r['user']} (freesound.org)", orig_sr=int(r["sr"]) or sr, orig_channels=x.shape[1],
            codec="vorbis HQ preview (~192 kb/s)", notes=f"query '{q}'; original {r['dur']:.1f} s"))
    with ThreadPoolExecutor(JOBS) as ex: recs = [r for r in ex.map(one, sel) if r]
    return recs

FN = dict(mssnsd=src_mssnsd, demand=src_demand, esc50=src_esc50, dcase=src_dcase, freesound=src_freesound)
for s in SOURCES:
    t = time.time(); recs = FN[s]()
    save_manifest("noise", recs, s)
    print(f"{s}: {len(recs)} clips, {sum(r['dur'] for r in recs) / 60:.1f} min ({time.time() - t:.0f} s)", flush=True)
