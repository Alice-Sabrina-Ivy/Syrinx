# hold-noise-fetch.py — the fresh public REAL-NOISE set for the resonance row
# hold's noise-only guard (measurements/resonance-row-hold-2026-10-28.md, G1).
#
#   python -I scripts/resonance/mobile/hold-noise-fetch.py [--root=C:/Coding Projects/Syrinx-cache/noise-real]
#          [--list=scripts/resonance/mobile/hold-noise-list.json] [--only=demand|freesound] [--rate=60]
#
# Downloads (treated as untrusted) go to <root>/dl/<source>/; the 60 s clips
# are written as mono PCM16 WAV at the source's own rate to <root>/clips/;
# the committed list (id, source, class, URL, licence, sha256 of the
# downloaded file and of the clip, offset) to --list. No audio is committed.
# Downloads are rate-limited to --rate MB/s (token bucket, one connection at a
# time; default 60 MB/s, under the PC's 900 Mbps budget).
#
# Selection (pre-registered in the note's plan, fixed before any result):
#   DEMAND (zenodo 1227121; record licence CC BY 4.0, the dataset document's
#     CC BY-SA 3.0 Unported), the 48 kHz zips, channel 1 only (ch01.wav, by
#     HTTP range reads), 17 environments (all but OMEETING: a conversation),
#     each 300 s recording cut into five consecutive 60 s clips.
#   Freesound HQ previews (Vorbis), search-page queries (no API key),
#     duration 60–900 s, results in the site's order, query by query until
#     the class cap; licence read on the sound's own page: CC0 or CC BY only;
#     title / tags must not contain a voice word (VOICE_WORDS); at most 2
#     sounds per uploader; the first 60 s.
import os, re, sys, io, json, time, html, hashlib, zipfile
import numpy as np, soundfile as sf, requests

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.abspath(os.path.join(HERE, "../../.."))
A = dict((a[2:].split("=", 1) + ["1"])[:2] for a in sys.argv[1:] if a.startswith("--"))
ROOT = A.get("root", "C:/Coding Projects/Syrinx-cache/noise-real")
LIST = os.path.join(REPO, A.get("list", "scripts/resonance/mobile/hold-noise-list.json"))
RATE = float(A.get("rate", "60")) * 1e6  # bytes / s
ONLY = A.get("only", "")
DL = os.path.join(ROOT, "dl")
CLIPS = os.path.join(ROOT, "clips")
CLIP_S = 60
UA = {"User-Agent": "Mozilla/5.0 (Syrinx research corpus fetch)"}
S = requests.Session()
S.headers.update(UA)

# ---- rate-limited downloads (token bucket)
_bucket = {"t": time.time(), "tok": RATE}
def _throttle(n):
    b = _bucket
    now = time.time()
    b["tok"] = min(RATE, b["tok"] + (now - b["t"]) * RATE)
    b["t"] = now
    b["tok"] -= n
    if b["tok"] < 0:
        time.sleep(-b["tok"] / RATE)

def get(url, headers=None, tries=6, expect=(200,)):
    for k in range(tries):
        try:
            r = S.get(url, headers=headers or {}, timeout=120, stream=True)
            if r.status_code in expect:
                out = bytearray()
                for c in r.iter_content(1 << 16):
                    _throttle(len(c)); out += c
                return bytes(out), r
            if r.status_code in (429, 503):
                time.sleep(20 * (k + 1)); continue
            raise IOError(f"{url}: HTTP {r.status_code}")
        except requests.RequestException:
            time.sleep(5 * (k + 1))
    raise IOError(f"{url}: retries exhausted")

def cached(url, dest, **kw):
    if os.path.exists(dest) and os.path.getsize(dest) > 0:
        return open(dest, "rb").read()
    data, _ = get(url, **kw)
    os.makedirs(os.path.dirname(dest), exist_ok=True)
    open(dest + ".part", "wb").write(data); os.replace(dest + ".part", dest)
    return data

sha = lambda b: hashlib.sha256(b).hexdigest()

def write_clip(cid, x, sr):
    os.makedirs(CLIPS, exist_ok=True)
    p = os.path.join(CLIPS, cid + ".wav")
    sf.write(p, np.clip(x, -1, 1).astype(np.float64), sr, subtype="PCM_16")
    return p, sha(open(p, "rb").read())

# ---- DEMAND: one member of a remote zip by HTTP range reads
class RangeFile(io.RawIOBase):
    def __init__(self, url, size):
        self.url, self.size, self.pos = url, size, 0
    def seekable(self): return True
    def readable(self): return True
    def tell(self): return self.pos
    def seek(self, off, whence=0):
        self.pos = off if whence == 0 else (self.pos + off if whence == 1 else self.size + off)
        return self.pos
    def read(self, n=-1):
        if n is None or n < 0: n = self.size - self.pos
        n = max(0, min(n, self.size - self.pos))
        if n == 0: return b""
        data, _ = get(self.url, headers={"Range": f"bytes={self.pos}-{self.pos + n - 1}"}, expect=(206,))
        self.pos += len(data)
        return data
    def readinto(self, b):
        d = self.read(len(b)); b[:len(d)] = d; return len(d)

DEMAND_CLASSES = {
    "NFIELD": "outdoor", "NPARK": "outdoor", "NRIVER": "outdoor",
    "STRAFFIC": "traffic",
    "TMETRO": "transport", "TBUS": "transport", "TCAR": "transport",
    "PSTATION": "public / cafe", "PCAFETER": "public / cafe", "PRESTO": "public / cafe", "SPSQUARE": "public / cafe", "SCAFE": "public / cafe",
    "OOFFICE": "office", "OHALLWAY": "office",
    "DKITCHEN": "kitchen / washing", "DWASHING": "kitchen / washing",
    "DLIVING": "living room",
}
def demand():
    recs = []
    meta = json.loads(cached("https://zenodo.org/api/records/1227121", os.path.join(DL, "demand", "record.json")))
    lic = meta["metadata"].get("license", {}).get("id")
    for env, cls in DEMAND_CLASSES.items():
        dest = os.path.join(DL, "demand", f"{env}_48k_ch01.wav")
        url = f"https://zenodo.org/api/records/1227121/files/{env}_48k.zip/content"
        if not (os.path.exists(dest) and os.path.getsize(dest) > 0):
            h = S.head(url, allow_redirects=True, timeout=60)
            size = int(h.headers.get("content-length", 0))
            z = zipfile.ZipFile(io.BufferedReader(RangeFile(h.url, size), buffer_size=1 << 20))
            data = z.read(f"{env}/ch01.wav")
            os.makedirs(os.path.dirname(dest), exist_ok=True)
            open(dest + ".part", "wb").write(data); os.replace(dest + ".part", dest)
            print(f"demand {env}: {len(data) / 1e6:.1f} MB", flush=True)
        raw = open(dest, "rb").read()
        x, sr = sf.read(io.BytesIO(raw), always_2d=True)
        x = x[:, 0]
        for i in range(5):
            seg = x[i * CLIP_S * sr:(i + 1) * CLIP_S * sr]
            if len(seg) < CLIP_S * sr: raise IOError(f"{env}: only {len(x) / sr:.1f} s")
            cid = f"demand__{env}__{i}"
            p, csha = write_clip(cid, seg, sr)
            recs.append(dict(id=cid, source="demand", cls=cls, sub=env, url=f"https://zenodo.org/records/1227121 ({env}_48k.zip, {env}/ch01.wav)",
                             licence=f"CC BY 4.0 (Zenodo record: {lic}); CC BY-SA 3.0 Unported (DEMAND.pdf)",
                             attribution="J. Thiemann, N. Ito, E. Vincent: DEMAND, zenodo 1227121",
                             sourceSha256=sha(raw), clipSha256=csha, offsetS=i * CLIP_S, durS=CLIP_S, sr=sr, codec="pcm"))
    return recs

# ---- Freesound
VOICE_WORDS = ["voice", "vocal", "speech", "speak", "talk", "sing", "song", "music", "radio", "tv", "television", "people",
               "crowd", "chatter", "conversation", "child", "kid", "baby", "laugh", "bird", "birds"]
FS_CLASSES = [  # class, cap, queries (in order)
    ("fans / PC / coil whine", 14, ["computer fan noise", "pc fan", "desk fan", "box fan", "laptop fan", "coil whine", "server room"]),
    ("HVAC", 14, ["air conditioner", "hvac", "ventilation", "air handler", "heat pump", "furnace"]),
    ("fridge / freezer", 12, ["refrigerator hum", "fridge", "freezer hum"]),
    ("mains hum / transformer / ballast", 14, ["electrical hum", "mains hum", "transformer hum", "fluorescent light hum", "ballast buzz"]),
    ("washing machine / kitchen appliance", 10, ["washing machine", "dishwasher", "tumble dryer", "kitchen extractor", "microwave running"]),
    ("traffic", 8, ["traffic", "road traffic distant", "city traffic"]),
]
def voice_word(text):
    words = re.findall(r"[a-z]+", text.lower())
    return any(w in VOICE_WORDS for w in words)

def fs_search(q):
    url = "https://freesound.org/search/?" + requests.compat.urlencode({"q": q, "f": "duration:[60 TO 900]"})
    dest = os.path.join(DL, "freesound", "search", re.sub(r"\W+", "_", q) + ".html")
    fresh = not os.path.exists(dest)
    h = cached(url, dest).decode("utf8")
    if fresh: time.sleep(1.5)
    out = []
    for blk in h.split('class="bw-search__result"')[1:]:
        g = lambda pat: (re.search(pat, blk) or [None, None])[1]
        sid = g(r'data-sound-id="(\d+)"')
        if not sid: continue
        out.append(dict(id=sid, user=html.unescape(g(r'data-username="([^"]*)"') or ""), title=html.unescape(g(r'data-title="([^"]*)"') or ""),
                        dur=float(g(r'data-duration="([^"]*)"') or 0), ogg=g(r'data-ogg="([^"]*)"'),
                        tags=sorted(set(re.findall(r'/browse/tags/([^/"]+)/', blk)))))
    return out

def fs_page(r):
    url = f"https://freesound.org/people/{r['user']}/sounds/{r['id']}/"
    dest = os.path.join(DL, "freesound", "pages", f"{r['id']}.html")
    fresh = not os.path.exists(dest)
    h = cached(url, dest).decode("utf8")
    if fresh: time.sleep(1.5)
    m = re.search(r'license text" href="(https?://creativecommons\.org/[^"]+)"', h)
    tags = sorted(set(re.findall(r'/browse/tags/([^/"]+)/', h)))
    return url, (m.group(1) if m else None), tags

def licence_name(u):
    if u is None: return None
    if "/publicdomain/zero/" in u: return "CC0 1.0"
    m = re.search(r"/licenses/([a-z-]+)/([0-9.]+)/", u)
    if not m: return None
    kind, ver = m.groups()
    return f"CC {kind.upper()} {ver}"

def freesound():
    recs, seen, users = [], set(), {}
    for cls, cap, queries in FS_CLASSES:
        n = 0
        for q in queries:
            if n >= cap: break
            try: res = fs_search(q)
            except Exception as e: print("search", q, e, flush=True); continue
            for r in res:
                if n >= cap: break
                if r["id"] in seen or not r["ogg"] or r["dur"] < CLIP_S: continue
                if voice_word(r["title"]) or any(voice_word(t) for t in r["tags"]): continue
                if users.get(r["user"], 0) >= 2: continue
                page, lic_url, tags = fs_page(r)
                lic = licence_name(lic_url)
                if lic is None or not (lic == "CC0 1.0" or lic.startswith("CC BY ")): continue  # CC0 or CC BY only (BY-NC etc. dropped)
                if any(voice_word(t) for t in tags): continue
                hq = r["ogg"].replace("-lq.ogg", "-hq.ogg")
                try: raw = cached(hq, os.path.join(DL, "freesound", "previews", os.path.basename(hq)))
                except Exception as e: print("preview", r["id"], e, flush=True); continue
                try: x, sr = sf.read(io.BytesIO(raw), always_2d=True)
                except Exception as e: print("decode", r["id"], e, flush=True); continue
                if len(x) < CLIP_S * sr: continue
                seen.add(r["id"]); users[r["user"]] = users.get(r["user"], 0) + 1; n += 1
                cid = f"fs__{r['id']}"
                p, csha = write_clip(cid, x[:CLIP_S * sr, 0], sr)
                recs.append(dict(id=cid, source="freesound", cls=cls, sub=q, url=page, licence=lic, licenceUrl=lic_url,
                                 attribution=f"\"{r['title']}\" by {r['user']} (freesound.org)", title=r["title"], tags=tags,
                                 sourceSha256=sha(raw), clipSha256=csha, offsetS=0, durS=CLIP_S, sr=sr,
                                 codec="Freesound HQ preview (Vorbis)", origDurS=r["dur"]))
                print(f"freesound {cls}: {r['id']} {lic} {r['title'][:50]}", flush=True)
        if n < cap: print(f"freesound {cls}: only {n} of {cap}", flush=True)
    return recs

old = json.load(open(LIST)) if os.path.exists(LIST) else {"clips": []}
recs = [r for r in old["clips"] if ONLY and r["source"] != ONLY]
if ONLY in ("", "demand"): recs += demand()
if ONLY in ("", "freesound"): recs += freesound()
recs.sort(key=lambda r: (r["source"], r["cls"], r["id"]))
out = {
    "note": "measurements/resonance-row-hold-2026-10-28.md (G1). Clips: 60 s, mono PCM16 WAV at the source rate, under the --root folder "
            "(outside the repo); no audio is committed. Made by scripts/resonance/mobile/hold-noise-fetch.py.",
    "fetched": time.strftime("%Y-%m-%d"),
    "counts": {c: sum(1 for r in recs if r["cls"] == c) for c in sorted(set(r["cls"] for r in recs))},
    "clips": recs,
}
json.dump(out, open(LIST, "w"), indent=1)
print(f"{len(recs)} clips -> {LIST}", flush=True)
