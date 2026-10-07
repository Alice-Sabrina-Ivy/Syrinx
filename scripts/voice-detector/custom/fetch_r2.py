# fetch_r2.py — custom voice detector, round 2 (pre-registration Addendum D,
# splits.json key `round2`): download the added voice positives into
# build/vad-train/dl/ (gitignored). At most three transfers at once: `svd`
# uses --svd-threads (default 2), everything else runs one transfer at a time.
#
#   svd         Saarbruecken Voice Database (zenodo 16874898): overview.csv of
#               every category zip (metadata), then <session>-iau.nsp of every
#               session, range-read out of data.zip -> dl/svd/
#   imitations  zenodo 57468 ImitationsForPlos.zip -> dl/imitations/
#   kids        zenodo 200495 english_children.zip -> dl/kids/
#   singbap     zenodo 20744738 VOICE_DATA.zip members inexperienced.zip and
#               professional.zip (deflated inside the outer zip): range-read the
#               compressed bytes, inflate -> dl/singbap/<name>.zip
#   fsvoice     Freesound HQ previews of the round2.fsvoice queries (licence,
#               keyword, exclusion and split rules of splits.json) -> dl/fsvoice/
#
#   python scripts/voice-detector/custom/fetch_r2.py --what=svd,imitations,kids,fsvoice,singbap [--svd-threads=2] [--sb-par=1]
import html
import json
import os
import re
import struct
import sys
import threading
import time
import zlib
from concurrent.futures import ThreadPoolExecutor

import requests

from common import DL, SPLITS, args, benchmark_freesound, fnv1a, norm_cc

sys.path.append(os.path.abspath(os.path.join(os.path.dirname(__file__), "../../notch-adversarial/realdata")))
from remotezip import RemoteZip  # noqa: E402

A = args()
R2 = SPLITS["round2"]
UA = {"User-Agent": "Mozilla/5.0 (research data fetch; Syrinx voice-detector)"}
ZEN = "https://zenodo.org/api/records/{rec}/files/{fn}/content"


def log(*a):
    print(time.strftime("%H:%M:%S"), *a, flush=True)


def fetch_file(url, dest, session=None):
    """Whole-file download with resume (Range), size-checked against the HEAD."""
    s = session or requests.Session()
    s.headers.update(UA)
    if os.path.exists(dest + ".ok"):
        return dest
    os.makedirs(os.path.dirname(dest), exist_ok=True)
    for k in range(10):
        try:
            h = s.head(url, allow_redirects=True, timeout=60)
            size = int(h.headers.get("content-length", 0))
            have = os.path.getsize(dest + ".part") if os.path.exists(dest + ".part") else 0
            if size and have >= size:
                break
            r = s.get(url, headers={"Range": f"bytes={have}-"} if have else {}, stream=True, timeout=300)
            if r.status_code == 416 and have:          # nothing left to read: the part is complete
                break
            if r.status_code not in (200, 206):
                raise IOError(f"HTTP {r.status_code}")
            mode = "ab" if (have and r.status_code == 206) else "wb"
            with open(dest + ".part", mode) as f:
                for chunk in r.iter_content(1 << 20):
                    f.write(chunk)
            if not size or os.path.getsize(dest + ".part") >= size:   # no length announced: one full GET is the file
                break
        except (requests.RequestException, IOError) as e:
            log("retry", os.path.basename(dest), e)
            time.sleep(20 * (k + 1))
    os.replace(dest + ".part", dest)
    open(dest + ".ok", "w").write("ok")
    return dest


# ----------------------------------------------------------------------------- svd
def svd():
    out = os.path.join(DL, "svd")
    os.makedirs(os.path.join(out, "iau"), exist_ok=True)
    rec = json.loads(requests.get("https://zenodo.org/api/records/16874898", timeout=60).content)
    json.dump(rec, open(os.path.join(out, "zenodo_record.json"), "w", encoding="utf8"), indent=1)
    assert rec["metadata"]["license"]["id"] == "cc-by-4.0", rec["metadata"]["license"]
    zips = sorted(f["key"] for f in rec["files"] if f["key"].endswith(".zip") and f["key"] != "data.zip")
    meta_p = os.path.join(out, "overview_all.json")
    meta = json.load(open(meta_p, encoding="utf8")) if os.path.exists(meta_p) else {}
    for fn in zips:
        if fn in meta:
            continue
        rz = RemoteZip(ZEN.format(rec=16874898, fn=requests.utils.quote(fn)))
        names = [n for n in rz.namelist() if n.endswith("overview.csv")]
        meta[fn] = rz.read(names[0]).decode("utf8", "replace") if names else ""
        json.dump(meta, open(meta_p, "w", encoding="utf8"), ensure_ascii=False)
        log("svd overview", fn, len(meta[fn].splitlines()))
    rz = RemoteZip(ZEN.format(rec=16874898, fn="data.zip"))
    want = sorted(n for n in rz.namelist() if n.endswith("-iau.nsp"))
    json.dump(want, open(os.path.join(out, "iau_members.json"), "w"), indent=0)
    todo = [n for n in want if not os.path.exists(os.path.join(out, "iau", os.path.basename(n)))]
    log(f"svd: {len(want)} iau takes, {len(todo)} to fetch")
    local = threading.local()
    done = [0]

    def one(n):
        if not hasattr(local, "rz"):
            local.rz = RemoteZip(ZEN.format(rec=16874898, fn="data.zip"))
        dest = os.path.join(out, "iau", os.path.basename(n))
        for k in range(6):
            try:
                b = local.rz.read(n)
                open(dest + ".tmp", "wb").write(b)
                os.replace(dest + ".tmp", dest)
                done[0] += 1
                if done[0] % 100 == 0:
                    log(f"svd {done[0]}/{len(todo)}")
                return
            except Exception as e:  # noqa: BLE001
                log("svd retry", n, e)
                time.sleep(20 * (k + 1))
                local.rz = RemoteZip(ZEN.format(rec=16874898, fn="data.zip"))
        log("svd FAILED", n)
    with ThreadPoolExecutor(int(A.get("svd-threads", "2"))) as ex:
        list(ex.map(one, todo))
    open(os.path.join(out, "iau.ok"), "w").write(str(len(want)))
    log("svd done")


# ----------------------------------------------------------------------------- zenodo whole files
def whole(rec, fn, sub):
    r = json.loads(requests.get(f"https://zenodo.org/api/records/{rec}", timeout=60).content)
    os.makedirs(os.path.join(DL, sub), exist_ok=True)
    json.dump(r, open(os.path.join(DL, sub, "zenodo_record.json"), "w", encoding="utf8"), indent=1)
    log(sub, "licence", r["metadata"]["license"]["id"])
    fetch_file(ZEN.format(rec=rec, fn=fn), os.path.join(DL, sub, fn))
    log(sub, "done")


# ----------------------------------------------------------------------------- singbap
def singbap():
    out = os.path.join(DL, "singbap")
    os.makedirs(out, exist_ok=True)
    r = json.loads(requests.get("https://zenodo.org/api/records/20744738", timeout=60).content)
    json.dump(r, open(os.path.join(out, "zenodo_record.json"), "w", encoding="utf8"), indent=1)
    for small in ("LICENSE.md", "README.md", "METHODS.md", "metadata.csv", "FILE_FORMATS.md"):
        fetch_file(ZEN.format(rec=20744738, fn=small), os.path.join(out, small))
    url = ZEN.format(rec=20744738, fn="VOICE_DATA.zip")
    rz = RemoteZip(url)
    s = requests.Session()
    s.headers.update(UA)
    for name in ("VOICE_DATA/inexperienced.zip", "VOICE_DATA/professional.zip"):
        info = rz.z.getinfo(name)
        dest = os.path.join(out, os.path.basename(name))
        if os.path.exists(dest + ".ok"):
            continue
        # local header -> start of the compressed data
        hdr = rz.f._get(info.header_offset, info.header_offset + 29)
        n, e = struct.unpack("<HH", hdr[26:30])
        a = info.header_offset + 30 + n + e
        b = a + info.compress_size - 1
        part = dest + ".deflate"
        npar = int(A.get("sb-par", "1"))            # parallel ranges (counted against the 3-transfer limit)
        edges = [a + (info.compress_size * k) // npar for k in range(npar + 1)]
        log(f"singbap {name}: {info.compress_size / 1e9:.2f} GB compressed, {npar} range(s)")

        def piece(k):
            pp, lo, hi = f"{part}.{k}", edges[k], edges[k + 1] - 1
            ss = requests.Session()
            ss.headers.update(UA)
            have = os.path.getsize(pp) if os.path.exists(pp) else 0
            while have < hi - lo + 1:
                try:
                    rr = ss.get(rz.url, headers={"Range": f"bytes={lo + have}-{hi}"}, stream=True, timeout=300)
                    if rr.status_code != 206:
                        raise IOError(f"HTTP {rr.status_code}")
                    with open(pp, "ab") as f:
                        for chunk in rr.iter_content(1 << 20):
                            f.write(chunk)
                except (requests.RequestException, IOError) as ex:
                    log("singbap retry", k, ex)
                    time.sleep(30)
                have = os.path.getsize(pp)
                log(f"singbap {name} range {k}: {have / 1e9:.2f} GB")
        with ThreadPoolExecutor(npar) as ex:
            list(ex.map(piece, range(npar)))
        with open(part, "wb") as fo:
            for k in range(npar):
                with open(f"{part}.{k}", "rb") as fi:
                    while True:
                        c = fi.read(1 << 24)
                        if not c:
                            break
                        fo.write(c)
        assert os.path.getsize(part) == info.compress_size
        d = zlib.decompressobj(-15)
        crc = 0
        with open(part, "rb") as fi, open(dest + ".tmp", "wb") as fo:
            while True:
                c = fi.read(1 << 22)
                if not c:
                    break
                y = d.decompress(c)
                crc = zlib.crc32(y, crc)
                fo.write(y)
            y = d.flush()
            crc = zlib.crc32(y, crc)
            fo.write(y)
        if os.path.getsize(dest + ".tmp") != info.file_size or (crc & 0xFFFFFFFF) != info.CRC:
            raise SystemExit(f"{name}: size / crc mismatch")
        os.replace(dest + ".tmp", dest)
        os.remove(part)
        for k in range(npar):
            os.remove(f"{part}.{k}")
        open(dest + ".ok", "w").write("ok")
        log("singbap", name, "ok")


# ----------------------------------------------------------------------------- fsvoice
FV = R2["fsvoice"]
EXCL = re.compile(FV["keyword_exclude"], re.I)


def fs_get(s, url, dest, min_bytes=1000, pause=1.5):
    if os.path.exists(dest) and os.path.getsize(dest) >= min_bytes:
        return dest
    os.makedirs(os.path.dirname(dest), exist_ok=True)
    for k in range(8):
        try:
            r = s.get(url, timeout=120)
            if r.status_code == 200 and len(r.content) >= min_bytes:
                open(dest + ".tmp", "wb").write(r.content)
                os.replace(dest + ".tmp", dest)
                time.sleep(pause)
                return dest
            if r.status_code == 404:
                raise FileNotFoundError(url)
            time.sleep(20 * (k + 1))
        except requests.RequestException:
            time.sleep(20 * (k + 1))
    raise IOError(f"{url}: retries exhausted")


def fsvoice():
    out = os.path.join(DL, "fsvoice")
    s = requests.Session()
    s.headers.update(UA)
    _, bench_ups, _ = benchmark_freesound()
    ex_ids, ex_ups = set(FV["excluded_ids"]), set(FV["excluded_uploaders"])
    idx_path = os.path.join(out, "index.json")
    index = json.load(open(idx_path, encoding="utf8")) if os.path.exists(idx_path) else {"kept": [], "skipped": []}
    kept_ids = {r["id"] for r in index["kept"]}
    done_q = {r.get("query") for r in index["skipped"] if r.get("why") == "query done"}
    lo, hi = FV["duration_s"]
    for q in FV["queries"]:
        if q in done_q:
            continue
        n = 0
        for page in range(1, FV["pages"] + 1):
            if n >= FV["per_query"]:
                break
            url = "https://freesound.org/search/?" + requests.compat.urlencode({"q": q, "f": f"duration:[{lo} TO {hi}]", "page": page})
            try:
                h = open(fs_get(s, url, os.path.join(out, "search", re.sub(r"\W+", "_", q) + f"__p{page}.html")), encoding="utf8").read()
            except (IOError, FileNotFoundError) as e:
                log("search", q, page, e)
                break
            for blk in h.split('class="bw-search__result"')[1:]:
                if n >= FV["per_query"]:
                    break
                g = lambda pat: (re.search(pat, blk) or [None, None])[1]  # noqa: E731
                sid = g(r'data-sound-id="(\d+)"')
                if not sid:
                    continue
                r = dict(id=int(sid), user=html.unescape(g(r'data-username="([^"]*)"') or ""), title=html.unescape(g(r'data-title="([^"]*)"') or ""),
                         dur=float(g(r'data-duration="([^"]*)"') or 0), ogg=g(r'data-ogg="([^"]*)"'), license_label=g(r'title="License: ([^"]*)"') or "unknown")
                why = None
                if r["id"] in kept_ids:
                    continue
                if r["id"] in ex_ids or r["user"] in ex_ups:
                    why = "round-1 review probe clip / uploader"
                elif r["user"] in bench_ups:
                    why = "benchmark uploader"
                elif not r["ogg"]:
                    why = "no preview"
                elif not re.search(r"(?i)creative commons 0|^attribution$|attribution \d", r["license_label"]) or "noncommercial" in r["license_label"].lower():
                    why = f"licence {r['license_label']}"
                elif EXCL.search(r["title"]):
                    why = "keyword (title)"
                if why is None:
                    try:
                        p = fs_get(s, f"https://freesound.org/people/{r['user']}/sounds/{r['id']}/", os.path.join(out, "pages", f"{r['id']}.html"))
                    except (IOError, FileNotFoundError) as e:
                        why = f"sound page: {e}"
                    else:
                        ph = open(p, encoding="utf8").read()
                        lic = sorted(set(re.findall(r"creativecommons\.org/(?:licenses|publicdomain)/[a-z\-+]+/[\d.]+", ph)))
                        tags = re.findall(r'href="/browse/tags/([^/"]+)/?"', ph)
                        m = re.search(r'<div id="soundDescriptionSection">(.*?)</div>', ph, re.S)
                        desc = html.unescape(re.sub(r"<[^>]+>", " ", m.group(1))).strip() if m else ""
                        L = [norm_cc(u) for u in lic]
                        if len(L) != 1 or L[0] not in R2["allowed_licences"]:
                            why = f"licence page {L}"
                        elif EXCL.search(" ".join([desc] + tags)):
                            why = "keyword (description / tags)"
                if why:
                    index["skipped"].append(dict(id=r["id"], user=r["user"], query=q, why=why))
                    continue
                hq = r["ogg"].replace("-lq.ogg", "-hq.ogg")
                dest = os.path.join(out, "audio", os.path.basename(hq))
                try:
                    fs_get(s, hq, dest, 1000, 0.5)
                except (IOError, FileNotFoundError) as e:
                    index["skipped"].append(dict(id=r["id"], user=r["user"], query=q, why=f"preview: {e}"))
                    continue
                up = r["user"]
                index["kept"].append(dict(id=r["id"], user=up, query=q, title=r["title"], dur=r["dur"], licence=L[0], licence_url="https://" + lic[0] + "/",
                                          tags=tags, description=desc[:2000], url=f"https://freesound.org/people/{up}/sounds/{r['id']}/", preview=hq,
                                          path=os.path.relpath(dest, DL).replace("\\", "/"), split="val" if fnv1a(up) % 5 == 0 else "train"))
                kept_ids.add(r["id"])
                n += 1
            json.dump(index, open(idx_path, "w", encoding="utf8"), indent=1, ensure_ascii=False)
        index["skipped"].append(dict(query=q, why="query done", kept=n))
        json.dump(index, open(idx_path, "w", encoding="utf8"), indent=1, ensure_ascii=False)
        log(f"fsvoice {q}: {n} kept (total {len(index['kept'])})")
    log(f"fsvoice: {len(index['kept'])} kept, {sum(r['dur'] for r in index['kept']) / 3600:.2f} h, val {sum(r['split'] == 'val' for r in index['kept'])}")


if __name__ == "__main__":
    what = A.get("what", "svd,imitations,kids,fsvoice,singbap").split(",")
    ths = []
    if "svd" in what:
        t = threading.Thread(target=svd)
        t.start()
        ths.append(t)
    for w in what:
        if w == "imitations":
            whole(57468, "ImitationsForPlos.zip", "imitations")
        elif w == "kids":
            whole(200495, "english_children.zip", "kids")
        elif w == "fsvoice":
            fsvoice()
        elif w == "singbap":
            singbap()
    for t in ths:
        t.join()
    log("all done")
