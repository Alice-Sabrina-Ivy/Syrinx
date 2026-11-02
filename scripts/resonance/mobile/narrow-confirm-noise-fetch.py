# narrow-confirm-noise-fetch.py — the fresh real-noise CONFIRMATION set of the
# narrower resonance-row hold round (measurements/resonance-row-hold-narrow-2026-11-01.md
# §5.3; the plan's `narrow-noise-fetch.py`), built from hold-noise-fetch.py.
#
#   python -P scripts/resonance/mobile/narrow-confirm-noise-fetch.py
#          [--root=C:/Coding Projects/Syrinx-cache/noise-real-narrow]
#          [--list=scripts/resonance/mobile/narrow-confirm-noise-list.json] [--rate=60]
#          [--ext1=talker|speech-free|both] [--ext2=talker|speech-free|both]
#
# (-P, not -I: -I hides the user site-packages that hold numpy, soundfile and
# requests.) Downloads (untrusted) go to <root>/dl/; the 60 s clips are
# written as mono PCM16 WAV at the source rate to <root>/clips/<id>.wav; the
# list to --list. No audio is committed. One connection at a time, a token
# bucket at --rate MB/s.
#
# The selection is a pure function of the cached search pages, sound pages and
# previews (fetched once, at first use, and reused), so a re-run with an
# extension flag recomputes the whole set (plan §5.3 "Size rule"):
#   base:   speech-free family (11 subclasses, 102) then talker family
#           (4 subclasses, 56), pages 1–3 per query; DEMAND OMEETING (5).
#   --ext1: the named family's subclass caps x 1.5 (rounded up) and its
#           selection redone from the start with pages 1–5 per query; sounds
#           and uploader slots of a family not redone stay taken.
#   --ext2: the named family's reserve subclass (cap 20, pages 1–5), after its
#           other subclasses.
# Which family is short is decided from the screen (screen-silero.mjs) by the
# operator, as the plan says; this script only applies the flags.
#
# Search URL (pinned): https://freesound.org/search/? + urlencode([q, f, s, g])
# (+ &page=N for N >= 2). Pin check: every page must show "Automatic by
# relevance" selected and the group-by-pack box checked, else the script
# stops (plan: STOP before confirmation). A page N+1 is fetched only if page
# N links to it (data-page="N+1").
#
# Filters per sound and query, in hold-noise-fetch.py's order (plan §5.3):
#   1 card: already accepted / no preview URL / card duration < 60 s
#   2 dev-disjoint: id in the dev list, or an uploader of any dev Freesound clip
#   3 speech-free family only: a voice word (voice_hits) in the card title / tags
#   4 the uploader already has 2 accepted sounds in the fresh set
#   5 licence on the sound's own page: CC0 1.0, CC BY 3.0 or CC BY 4.0 only
#   6 speech-free family only: a voice word in the page's tags
#   7 the HQ preview downloads and decodes and is >= 60 s (first 60 s, channel 1)
# A rejected sound is not marked: a later query or subclass checks it again.
#
# Deviation (2026-11-01, found by the screen's level check, before any
# confirmation replay): filter 7 also skips a preview whose first 60 s of
# channel 1 are digital silence (every sample 0). Its noise-alone DSP median
# is the -300 dBFS floor, so the level rule (plan §5.4) cannot set it to L1 /
# L2 and its streams would be all zeros. The plan did not foresee it; one
# sound hit it (fs__583249, "BG SaSc Old Washing Machine Full Cycle Noisy.wav",
# washing machine, page 1 rank 10), and the selection then took the next
# sound of its subclass under the unchanged rules.
import ast, os, re, sys, io, json, time, html, hashlib, zipfile, math
import numpy as np, soundfile as sf, requests

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.abspath(os.path.join(HERE, "../../.."))
A = dict((a[2:].split("=", 1) + ["1"])[:2] for a in sys.argv[1:] if a.startswith("--"))
ROOT = A.get("root", "C:/Coding Projects/Syrinx-cache/noise-real-narrow")
LIST = os.path.join(REPO, A.get("list", "scripts/resonance/mobile/narrow-confirm-noise-list.json"))
DEV_LIST = os.path.join(REPO, "scripts/resonance/mobile/hold-noise-list.json")
RATE = float(A.get("rate", "60")) * 1e6
EXT1 = A.get("ext1", "")
EXT2 = A.get("ext2", "")
for e in (EXT1, EXT2):
    if e not in ("", "talker", "speech-free", "both"):
        raise SystemExit(f"bad extension flag {e}")
DL = os.path.join(ROOT, "dl")
CLIPS = os.path.join(ROOT, "clips")
CLIP_S = 60
UA = {"User-Agent": "Mozilla/5.0 (Syrinx research corpus fetch)"}
S = requests.Session()
S.headers.update(UA)

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

sha = lambda b: hashlib.sha256(b).hexdigest()
now_iso = lambda: time.strftime("%Y-%m-%dT%H:%M:%S%z")

# fetch log (first fetch time of every cached file; kept with the cache)
FETCH_LOG = os.path.join(DL, "fetch-log.json")
_flog = json.load(open(FETCH_LOG, encoding="utf8")) if os.path.exists(FETCH_LOG) else {}
def _save_flog():
    os.makedirs(DL, exist_ok=True)
    json.dump(_flog, open(FETCH_LOG + ".part", "w", encoding="utf8"), indent=0); os.replace(FETCH_LOG + ".part", FETCH_LOG)

def cached(url, dest, polite=0.0, **kw):
    key = os.path.relpath(dest, DL).replace("\\", "/")
    if os.path.exists(dest) and os.path.getsize(dest) > 0:
        return open(dest, "rb").read()
    data, _ = get(url, **kw)
    os.makedirs(os.path.dirname(dest), exist_ok=True)
    open(dest + ".part", "wb").write(data); os.replace(dest + ".part", dest)
    _flog[key] = {"url": url, "fetchedAt": now_iso(), "sha256": sha(data)}
    _save_flog()
    if polite: time.sleep(polite)
    return data

def write_clip(cid, x, sr):
    os.makedirs(CLIPS, exist_ok=True)
    p = os.path.join(CLIPS, cid + ".wav")
    sf.write(p, np.clip(x, -1, 1).astype(np.float64), sr, subtype="PCM_16")
    return p, sha(open(p, "rb").read())

# ---- the dev word rule, verbatim from hold-noise-fetch.py (checked below)
VOICE_WORDS = ["voice", "vocal", "speech", "speak", "talk", "sing", "song", "music", "radio", "tv", "television", "people",
               "crowd", "chatter", "conversation", "child", "kid", "baby", "laugh", "bird", "birds"]
VOICE_SUFFIXES = ("", "s", "es", "ed", "ing", "ings", "er", "ers", "ian", "ians", "al", "ally", "ter", "ren", "y", "ie", "ies")
VOICE_IRREGULAR = {"babies", "sang", "sung", "spoke", "spoken"}
def voice_hits(text):
    """The words of text that are a voice word, inflections included (talking, musical, children, singers)."""
    return [w for w in re.findall(r"[a-z]+", text.lower())
            if w in VOICE_IRREGULAR or any(w == stem + end for stem in VOICE_WORDS for end in VOICE_SUFFIXES)]
def voice_word(text):
    return bool(voice_hits(text))
def _check_word_rule():
    src = open(os.path.join(HERE, "hold-noise-fetch.py"), encoding="utf8").read()
    tree = ast.parse(src)
    got = {}
    for node in tree.body:
        if isinstance(node, ast.Assign) and len(node.targets) == 1 and isinstance(node.targets[0], ast.Name) \
                and node.targets[0].id in ("VOICE_WORDS", "VOICE_SUFFIXES", "VOICE_IRREGULAR"):
            got[node.targets[0].id] = ast.literal_eval(node.value)
    fn = [n for n in tree.body if isinstance(n, ast.FunctionDef) and n.name == "voice_hits"]
    mine = [n for n in ast.parse(open(os.path.abspath(__file__), encoding="utf8").read()).body if isinstance(n, ast.FunctionDef) and n.name == "voice_hits"]
    if got != {"VOICE_WORDS": VOICE_WORDS, "VOICE_SUFFIXES": VOICE_SUFFIXES, "VOICE_IRREGULAR": VOICE_IRREGULAR} \
            or len(fn) != 1 or len(mine) != 1 or ast.dump(fn[0]) != ast.dump(mine[0]):
        raise SystemExit("word rule differs from hold-noise-fetch.py")
_check_word_rule()

# data-quality marks (information only; plan §5.3): the same stem-and-ending matching
QUALITY_WORDS = ["synth", "synthesizer", "synthesiser", "synthesized", "synthetic", "glitch", "remix", "game", "designed"]
def quality_hits(text):
    return [w for w in re.findall(r"[a-z]+", text.lower()) if any(w == stem + end for stem in QUALITY_WORDS for end in VOICE_SUFFIXES)]
def quality_mark(title, tags):
    return sorted(set(quality_hits(title) + [w for t in tags for w in quality_hits(t)]))

# ---- plan §5.3 tables
SF = "speech-free"; TK = "talker"
FAMILIES = {
    SF: [
        ("fans / PC / coil whine", 14, ["computer fan noise", "pc fan", "desk fan", "box fan", "laptop fan", "coil whine", "server room"]),
        ("HVAC", 14, ["air conditioner", "hvac", "ventilation", "air handler", "heat pump", "furnace"]),
        ("fridge / freezer", 12, ["refrigerator hum", "fridge", "freezer hum"]),
        ("mains hum / transformer / ballast", 14, ["electrical hum", "mains hum", "transformer hum", "fluorescent light hum", "ballast buzz"]),
        ("washing machine / kitchen appliance", 10, ["washing machine", "dishwasher", "tumble dryer", "kitchen extractor", "microwave running"]),
        ("traffic", 8, ["traffic", "road traffic distant", "city traffic"]),
        ("room and home appliances", 8, ["room tone", "air purifier", "dehumidifier", "space heater", "electric fan", "ceiling fan", "humidifier"]),
        ("household machines", 6, ["vacuum cleaner", "hair dryer", "clothes dryer", "dishwasher running", "boiler room", "water heater"]),
        ("rain, wind, water", 6, ["rain on window", "rain on roof", "heavy rain", "wind howling", "stream water", "fountain"]),
        ("vehicle interior", 5, ["car interior", "driving car interior", "train interior", "airplane cabin", "bus interior"]),
        ("distant street and road", 5, ["distant traffic", "highway", "city ambience night", "road noise", "motorway"]),
    ],
    TK: [
        ("café, restaurant, bar", 16, ["cafe ambience", "restaurant ambience", "coffee shop ambience", "bar ambience", "pub ambience", "food court"]),
        ("station, airport, mall", 14, ["train station ambience", "airport terminal", "shopping mall ambience", "subway station", "hotel lobby", "bus station"]),
        ("TV or radio in the room", 12, ["tv in background", "television background", "tv in another room", "radio in background", "radio talk show", "news broadcast tv"]),
        ("people nearby", 14, ["people talking", "office ambience", "classroom ambience", "party ambience", "conversation background", "waiting room"]),
    ],
}
RESERVES = {
    SF: ("speech-free reserve", 20, ["white noise machine", "aquarium filter", "air compressor", "generator hum", "engine idle", "printer"]),
    TK: ("talker reserve", 20, ["crowd talking", "market ambience", "lecture hall", "conference room ambience", "library ambience", "playground"]),
}
assert sum(c for _, c, _ in FAMILIES[SF]) == 102 and sum(c for _, c, _ in FAMILIES[TK]) == 56

# ---- dev exclusions
DEV = json.load(open(DEV_LIST, encoding="utf8"))["clips"]
DEV_FS = [c for c in DEV if c["source"] == "freesound"]
if len(DEV_FS) != 72: raise SystemExit(f"dev Freesound clips: {len(DEV_FS)}, plan says 72")
DEV_IDS, DEV_USERS = set(), set()
for c in DEV_FS:
    m = re.match(r"^https://freesound\.org/people/(.+)/sounds/(\d+)/$", c["url"])
    if not m or c["id"] != f"fs__{m.group(2)}": raise SystemExit(f"dev url {c['url']}")
    DEV_IDS.add(m.group(2)); DEV_USERS.add(m.group(1).lower())

# ---- Freesound search pages
def search_url(q, page):
    u = "https://freesound.org/search/?" + requests.compat.urlencode([("q", q), ("f", "duration:[60 TO 900]"), ("s", "Automatic by relevance"), ("g", "1")])
    return u + (f"&page={page}" if page >= 2 else "")

PAGES = {}   # (q, page) -> record
def pin_ok(h):
    sel = re.search(r'<select id="id_sort_by" name="s"\s*>(.*?)</select>', h, re.S)
    sort_ok = bool(sel) and [m.group(1) for m in re.finditer(r'<option value="([^"]*)"\s*selected', sel.group(1))] == ["Automatic by relevance"]
    g = re.search(r'<input id="id_group_by_pack" name="g" type="checkbox"[^>]*>', h)
    return sort_ok and bool(g) and re.search(r"\schecked\b", g.group(0)) is not None

def fs_search(q, page):
    url = search_url(q, page)
    dest = os.path.join(DL, "freesound", "search", re.sub(r"\W+", "_", q) + f"__p{page}.html")
    raw = cached(url, dest, polite=1.5)
    h = raw.decode("utf8")
    ok = pin_ok(h)
    key = os.path.relpath(dest, DL).replace("\\", "/")
    out = []
    for blk in h.split('class="bw-search__result"')[1:]:
        g = lambda pat: (re.search(pat, blk) or [None, None])[1]
        sid = g(r'data-sound-id="(\d+)"')
        if not sid: continue
        out.append(dict(id=sid, user=html.unescape(g(r'data-username="([^"]*)"') or ""), title=html.unescape(g(r'data-title="([^"]*)"') or ""),
                        dur=float(g(r'data-duration="([^"]*)"') or 0), ogg=g(r'data-ogg="([^"]*)"'),
                        tags=sorted(set(re.findall(r'/browse/tags/([^/"]+)/', blk)))))
    nxt = re.search(rf'data-page="{page + 1}"', h) is not None
    PAGES[(q, page)] = dict(query=q, page=page, url=url, sha256=sha(raw), fetchedAt=_flog.get(key, {}).get("fetchedAt"),
                            pinOk=ok, results=len(out), nextPage=nxt)
    if not ok:
        print(f"PIN CHECK FAILED: {url}", flush=True)
        raise SystemExit("STOP: a search page does not show 'Automatic by relevance' selected and group-by-pack checked")
    return out, nxt

def fs_page(r):
    url = f"https://freesound.org/people/{r['user']}/sounds/{r['id']}/"
    dest = os.path.join(DL, "freesound", "pages", f"{r['id']}.html")
    h = cached(url, dest, polite=1.5).decode("utf8")
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
LICENCES_OK = ("CC0 1.0", "CC BY 3.0", "CC BY 4.0")

_previews = {}
def preview(r):
    hq = r["ogg"].replace("-lq.ogg", "-hq.ogg")
    if hq in _previews: return _previews[hq]
    try:
        raw = cached(hq, os.path.join(DL, "freesound", "previews", os.path.basename(hq)))
    except Exception as e:
        _previews[hq] = (None, None, f"download: {e}"); return _previews[hq]
    try:
        x, sr = sf.read(io.BytesIO(raw), always_2d=True)   # the whole preview decodes (as hold-noise-fetch.py)
    except Exception as e:
        _previews[hq] = (None, None, f"decode: {e}"); return _previews[hq]
    n = len(x)
    x = np.ascontiguousarray(x[:CLIP_S * sr, 0])          # keep only what a clip uses: the first 60 s, channel 1
    _previews[hq] = ((sha(raw), n, x, sr), hq, None)
    return _previews[hq]

DECISIONS = []
def select_family(fam, subclasses, pages, accepted, users):
    """Run the per-subclass selection; mutates accepted (id -> rec) and users."""
    for cls, cap, queries in subclasses:
        n = 0
        for q in queries:
            if n >= cap: break
            for page in range(1, pages + 1):
                if n >= cap: break
                res, nxt = fs_search(q, page)
                for rank, r in enumerate(res):
                    if n >= cap: break
                    why = None
                    if r["id"] in accepted: why = "1 accepted"
                    elif not r["ogg"]: why = "1 no preview"
                    elif r["dur"] < CLIP_S: why = "1 short card"
                    elif r["id"] in DEV_IDS or r["user"].lower() in DEV_USERS: why = "2 dev"
                    elif fam == SF and (voice_word(r["title"]) or any(voice_word(t) for t in r["tags"])): why = "3 voice word (card)"
                    elif users.get(r["user"], 0) >= 2: why = "4 uploader cap"
                    if why is None:
                        page_url, lic_url, tags = fs_page(r)
                        lic = licence_name(lic_url)
                        if lic not in LICENCES_OK: why = f"5 licence {lic}"
                        elif fam == SF and any(voice_word(t) for t in tags): why = "6 voice word (page tags)"
                        else:
                            got, hq, err = preview(r)
                            if got is None: why = f"7 {err}"
                            else:
                                raw_sha, n_frames, x, sr = got
                                if n_frames < CLIP_S * sr: why = "7 preview under 60 s"
                                elif not np.any(x): why = "7 first 60 s digital silence"   # deviation, see the header
                    DECISIONS.append(dict(family=fam, cls=cls, query=q, page=page, rank=rank, id=r["id"], user=r["user"], decision=why or "accepted"))
                    if why: continue
                    users[r["user"]] = users.get(r["user"], 0) + 1; n += 1
                    accepted[r["id"]] = dict(id=f"fs__{r['id']}", source="freesound", family=fam, cls=cls, sub=q, query=q, page=page, rank=rank,
                                             url=page_url, uploader=r["user"], licence=lic, licenceUrl=lic_url,
                                             attribution=f"\"{r['title']}\" by {r['user']} (freesound.org)", title=r["title"], cardTags=r["tags"], tags=tags,
                                             previewUrl=hq, sourceSha256=raw_sha, offsetS=0, durS=CLIP_S, sr=sr,
                                             codec="Freesound HQ preview (Vorbis)", origDurS=r["dur"], qualityMark=quality_mark(r["title"], tags),
                                             _x=(x, sr))
                    print(f"{fam} | {cls}: {r['id']} {lic} {r['title'][:50]}", flush=True)
                if not nxt: break
        if n < cap: print(f"SHORT {fam} | {cls}: {n} of {cap}", flush=True)

def caps_x(subclasses, k):
    return [(c, math.ceil(cap * k) if k != 1 else cap, qs) for c, cap, qs in subclasses]

def freesound():
    accepted, users = {}, {}
    # base: speech-free then talker, pages 1–3
    for fam in (SF, TK):
        select_family(fam, FAMILIES[fam], 3, accepted, users)
    if EXT1 == "both":                                  # extension 1, both short: the whole selection redone from the start
        accepted.clear(); users.clear()
        for fam in (SF, TK):
            select_family(fam, caps_x(FAMILIES[fam], 1.5), 5, accepted, users)
    elif EXT1:                                          # extension 1, one family: redone from the start, the other's sounds and slots stay taken
        for sid in [k for k, v in accepted.items() if v["family"] == EXT1]:
            users[accepted[sid]["uploader"]] -= 1; del accepted[sid]
        select_family(EXT1, caps_x(FAMILIES[EXT1], 1.5), 5, accepted, users)
    for fam in ([SF, TK] if EXT2 == "both" else ([EXT2] if EXT2 else [])):   # extension 2: the reserve
        select_family(fam, [RESERVES[fam]], 5, accepted, users)
    recs = []
    for v in accepted.values():
        x, sr = v.pop("_x")
        p, csha = write_clip(v["id"], x[:CLIP_S * sr], sr)
        v["clipSha256"] = csha
        recs.append(v)
    return recs

# ---- DEMAND OMEETING (zenodo 1227121), channel 1 by HTTP range reads
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

def demand_omeeting():
    env = "OMEETING"
    meta_raw = cached("https://zenodo.org/api/records/1227121", os.path.join(DL, "demand", "record.json"))
    meta = json.loads(meta_raw)
    lic = meta["metadata"].get("license", {}).get("id")
    if lic != "cc-by-4.0": raise SystemExit(f"DEMAND record licence {lic}")
    dest = os.path.join(DL, "demand", f"{env}_48k_ch01.wav")
    url = f"https://zenodo.org/api/records/1227121/files/{env}_48k.zip/content"
    if not (os.path.exists(dest) and os.path.getsize(dest) > 0):
        h = S.head(url, allow_redirects=True, timeout=60)
        size = int(h.headers.get("content-length", 0))
        z = zipfile.ZipFile(io.BufferedReader(RangeFile(h.url, size), buffer_size=1 << 20))
        data = z.read(f"{env}/ch01.wav")
        os.makedirs(os.path.dirname(dest), exist_ok=True)
        open(dest + ".part", "wb").write(data); os.replace(dest + ".part", dest)
        _flog[os.path.relpath(dest, DL).replace("\\", "/")] = {"url": url + f" ({env}/ch01.wav)", "fetchedAt": now_iso(), "sha256": sha(data)}
        _save_flog()
        print(f"demand {env}: {len(data) / 1e6:.1f} MB", flush=True)
    raw = open(dest, "rb").read()
    x, sr = sf.read(io.BytesIO(raw), always_2d=True)
    x = x[:, 0]
    recs = []
    for i in range(5):
        seg = x[i * CLIP_S * sr:(i + 1) * CLIP_S * sr]
        if len(seg) < CLIP_S * sr: raise IOError(f"{env}: only {len(x) / sr:.1f} s")
        cid = f"demand__{env}__{i}"
        p, csha = write_clip(cid, seg, sr)
        recs.append(dict(id=cid, source="demand", family=TK, cls="meeting room (DEMAND OMEETING)", sub=env, query=None,
                         url=f"https://zenodo.org/records/1227121 ({env}_48k.zip, {env}/ch01.wav)", uploader=None,
                         licence=f"CC BY 4.0 (Zenodo record: {lic}); CC BY-SA 3.0 Unported (DEMAND.pdf)",
                         attribution="J. Thiemann, N. Ito, E. Vincent: DEMAND, zenodo 1227121",
                         sourceSha256=sha(raw), clipSha256=csha, offsetS=i * CLIP_S, durS=CLIP_S, sr=sr, codec="pcm", qualityMark=[]))
    return recs, {"zenodoRecord": "https://zenodo.org/api/records/1227121", "licenceId": lic, "recordSha256": sha(meta_raw)}

recs_d, demand_meta = demand_omeeting()
recs_f = freesound()
recs = recs_d + recs_f
# disjointness checks (F3): by source id and by Freesound uploader + id
dev_all = {c["id"] for c in DEV}
assert not (dev_all & {r["id"] for r in recs}), "a fresh id is in the dev list"
assert not any(r["uploader"] and r["uploader"].lower() in DEV_USERS for r in recs_f)
assert len({r["id"] for r in recs}) == len(recs)
per_user = {}
for r in recs_f: per_user[r["uploader"]] = per_user.get(r["uploader"], 0) + 1
assert max(per_user.values()) <= 2
order = {**{c: (0, i) for i, (c, _, _) in enumerate(FAMILIES[SF] + [RESERVES[SF]])}, **{c: (1, i) for i, (c, _, _) in enumerate(FAMILIES[TK] + [RESERVES[TK]])}}
recs.sort(key=lambda r: (order.get(r["cls"], (1, 99)), r["source"], r["id"]))
caps = {}
for fam in (SF, TK):
    k = 1.5 if EXT1 in (fam, "both") else 1
    for c, cap, _ in caps_x(FAMILIES[fam], k): caps[c] = cap
    if EXT2 in (fam, "both"): caps[RESERVES[fam][0]] = RESERVES[fam][1]
caps["meeting room (DEMAND OMEETING)"] = 5
counts = {c: sum(1 for r in recs if r["cls"] == c) for c in caps}
dev_quality = {c["id"]: m for c in DEV_FS if (m := quality_mark(c["title"], c["tags"]))}
out = {
    "note": "Fresh real-noise confirmation set of measurements/resonance-row-hold-narrow-2026-11-01.md §5.3 (the plan's narrow-noise-list.json). "
            "Clips: 60 s, mono PCM16 WAV at the source rate, under --root (outside the repo); no audio is committed. "
            "Made by scripts/resonance/mobile/narrow-confirm-noise-fetch.py. Classes from screen-silero.mjs --set=fresh (screen*).",
    "fetched": time.strftime("%Y-%m-%d"),
    "root": ROOT.replace("\\", "/"),
    "extensions": {"ext1": EXT1 or None, "ext2": EXT2 or None},
    "devExclusions": {"list": "scripts/resonance/mobile/hold-noise-list.json", "freesoundIds": len(DEV_IDS), "uploaders": len(DEV_USERS)},
    "demand": demand_meta,
    "caps": caps,
    "counts": counts,
    "short": {c: [counts[c], caps[c]] for c in caps if counts[c] < caps[c]},
    "byFamily": {fam: sum(1 for r in recs if r["family"] == fam) for fam in (SF, TK)},
    "decisions": {k: sum(1 for d in DECISIONS if d["decision"].split(" ")[0] == k) for k in sorted(set(d["decision"].split(" ")[0] for d in DECISIONS))},
    "searchPages": [PAGES[k] for k in PAGES],
    "devQualityMarks": dev_quality,
    "clips": recs,
}
json.dump(out, open(LIST, "w", encoding="utf8"), indent=1, ensure_ascii=False)
json.dump(DECISIONS, open(os.path.join(ROOT, "decisions.json"), "w", encoding="utf8"), indent=0, ensure_ascii=False)
print(f"{len(recs)} clips ({out['byFamily']}) -> {LIST}; short: {out['short']}", flush=True)
