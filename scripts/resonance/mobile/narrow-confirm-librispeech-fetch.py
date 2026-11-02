# narrow-confirm-librispeech-fetch.py — the confirmation readers of the
# narrower resonance-row hold round (measurements/resonance-row-hold-narrow-2026-11-01.md
# §5.2; the plan's `librispeech-fetch.py`).
#
#   python -P scripts/resonance/mobile/narrow-confirm-librispeech-fetch.py
#          [--data=<folder; default ../Syrinx-cache/resonance-lab/data beside the repo>] [--rate=60]
#          [--extra=<id,id,...>]   (more readers from the kept archive, plan §5.2)
#          [--prefer=elda]         (try the openslr.elda.org mirror first)
#
# (-P, not -I: -I hides the user site-packages that hold requests.)
#
# What it does (plan §5.2, fixed before any result):
#   1. Downloads https://www.openslr.org/resources/12/train-clean-100.tar.gz
#      (LibriSpeech, OpenSLR SLR12, CC BY 4.0; 6.39 GB; mirror
#      openslr.elda.org if the primary fails) in full, one connection, a token
#      bucket at --rate MB/s, to <data>/train-clean-100.tar.gz (resumable by
#      HTTP range into a .part file).
#   2. Checks its MD5 against the same folder's md5sum.txt
#      (https://www.openslr.org/resources/12/md5sum.txt, kept beside it)
#      BEFORE any member is extracted; a mismatch deletes the download and
#      stops.
#   3. Extracts, in one pass, only LibriSpeech/train-clean-100/<id>/ for the
#      first 8 readers of each sex — men 26, 27, 60, 78, 118, 163, 196, 201;
#      women 19, 32, 39, 40, 83, 87, 89, 103 — (plus --extra ids) into
#      <data>/LibriSpeech/ (regular files and directories only, no path
#      outside that folder). The archive is kept.
import hashlib, os, re, sys, tarfile, time
import requests

A = dict((a[2:].split("=", 1) + ["1"])[:2] for a in sys.argv[1:] if a.startswith("--"))
REPO = os.path.abspath(os.path.join(os.path.dirname(os.path.abspath(__file__)), "../../.."))
CACHE = os.path.normpath(os.path.join(REPO, "..", "Syrinx-cache"))  # the local data cache beside the repo (outside it; not published)
DATA = A.get("data", os.path.join(CACHE, "resonance-lab", "data"))
RATE = float(A.get("rate", "60")) * 1e6
NAME = "train-clean-100.tar.gz"
URLS = [f"https://www.openslr.org/resources/12/{NAME}", f"https://openslr.elda.org/resources/12/{NAME}"]
if A.get("prefer") == "elda":   # the mirror first (resumes the same .part by HTTP range; the MD5 check is unchanged)
    URLS.reverse()
MD5_URL = "https://www.openslr.org/resources/12/md5sum.txt"
MEN = ["26", "27", "60", "78", "118", "163", "196", "201"]
WOMEN = ["19", "32", "39", "40", "83", "87", "89", "103"]
IDS = MEN + WOMEN + [x for x in A.get("extra", "").split(",") if x and x != "1"]
UA = {"User-Agent": "Mozilla/5.0 (Syrinx research corpus fetch)"}
S = requests.Session()
S.headers.update(UA)

_bucket = {"t": time.time(), "tok": RATE}
def throttle(n):
    b = _bucket
    now = time.time()
    b["tok"] = min(RATE, b["tok"] + (now - b["t"]) * RATE)
    b["t"] = now
    b["tok"] -= n
    if b["tok"] < 0:
        time.sleep(-b["tok"] / RATE)

def download(dest):
    if os.path.exists(dest):
        return
    part = dest + ".part"
    for url in URLS:
        for attempt in range(8):
            try:
                have = os.path.getsize(part) if os.path.exists(part) else 0
                h = S.head(url, allow_redirects=True, timeout=60)
                size = int(h.headers.get("content-length", 0))
                if size <= 0:
                    raise IOError(f"{url}: no content-length")
                if have > size:
                    os.remove(part); have = 0
                if have < size:
                    r = S.get(url, headers={"Range": f"bytes={have}-"} if have else {}, stream=True, timeout=120)
                    if have and r.status_code != 206:
                        raise IOError(f"{url}: range not honoured (HTTP {r.status_code})")
                    if not have and r.status_code != 200:
                        raise IOError(f"{url}: HTTP {r.status_code}")
                    t0, got = time.time(), have
                    with open(part, "ab") as f:
                        for c in r.iter_content(1 << 20):
                            throttle(len(c)); f.write(c); got += len(c)
                            if time.time() - t0 > 30:
                                print(f"  {got / 1e9:.2f} / {size / 1e9:.2f} GB", flush=True); t0 = time.time()
                if os.path.getsize(part) == size:
                    os.replace(part, dest)
                    print(f"downloaded {dest} ({size} bytes) from {url}", flush=True)
                    return
            except (requests.RequestException, IOError) as e:
                print(f"  {url}: {e}; retry {attempt + 1}", flush=True)
                time.sleep(10 * (attempt + 1))
    raise SystemExit("download failed on every mirror")

def md5_of(p):
    h = hashlib.md5()
    with open(p, "rb") as f:
        for c in iter(lambda: f.read(1 << 22), b""):
            h.update(c)
    return h.hexdigest()

os.makedirs(DATA, exist_ok=True)
arch = os.path.join(DATA, NAME)
md5txt = os.path.join(DATA, "md5sum.txt")
if not os.path.exists(md5txt):
    r = S.get(MD5_URL, timeout=60); r.raise_for_status()
    open(md5txt, "wb").write(r.content)
want = None
for line in open(md5txt, encoding="utf8"):
    f = line.split()
    if len(f) == 2 and f[1] == NAME:
        want = f[0].lower()
if not want:
    raise SystemExit(f"{md5txt}: no line for {NAME}")
download(arch)
got = md5_of(arch)
if got != want:
    os.remove(arch)
    raise SystemExit(f"MD5 mismatch: {got} vs {want} (md5sum.txt); download deleted")
print(f"MD5 ok: {got}", flush=True)

out = os.path.join(DATA, "LibriSpeech")
outabs = os.path.abspath(out)
prefixes = tuple(f"LibriSpeech/train-clean-100/{i}/" for i in IDS)
dirs = tuple(f"LibriSpeech/train-clean-100/{i}" for i in IDS)
n = 0
with tarfile.open(arch, "r|gz") as tf:
    for m in tf:
        name = m.name.replace("\\", "/")
        if not (name.startswith(prefixes) or name in dirs):
            continue
        rel = name[len("LibriSpeech/"):]
        target = os.path.abspath(os.path.join(out, rel))
        if not target.startswith(outabs + os.sep) or ".." in rel.split("/") or re.match(r"^[A-Za-z]:|^/", rel):
            raise SystemExit(f"unsafe member {m.name}")
        if m.isdir():
            os.makedirs(target, exist_ok=True); continue
        if not m.isfile():
            raise SystemExit(f"unexpected member type {m.name}")
        os.makedirs(os.path.dirname(target), exist_ok=True)
        src = tf.extractfile(m)
        with open(target + ".part", "wb") as f:
            f.write(src.read())
        os.replace(target + ".part", target)
        n += 1
print(f"extracted {n} files for readers {','.join(IDS)} into {out}", flush=True)
for i in IDS:
    d = os.path.join(out, "train-clean-100", i)
    k = sum(len(fs) for _, _, fs in os.walk(d)) if os.path.isdir(d) else 0
    print(f"  {i}: {k} files", flush=True)
