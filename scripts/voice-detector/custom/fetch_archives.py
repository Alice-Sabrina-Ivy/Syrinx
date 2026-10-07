# fetch_archives.py — custom voice detector, data step (2026-10-06): download
# the WHOLE archives of the training sources listed in
# measurements/voice-detector-custom-preregistration-2026-10-06.md into
# build/vad-train/dl/ (gitignored). Resumable (HTTP Range), size- and
# checksum-verified where the host publishes one, at most --jobs (default 3)
# transfers at once inside this one process.
#
#   python scripts/voice-detector/custom/fetch_archives.py [--only=fsd50k,coswara,...] [--jobs=3] [--list]
#
# Members of large archives that are only partly used (VCTK, Dagstuhl
# ChoirSet) are range-read by prepare.py instead; the Freesound previews of
# the `fstrain` source are fetched by fetch_fstrain.py.
import hashlib
import json
import os
import sys
import threading
import time
from concurrent.futures import ThreadPoolExecutor

import requests

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.abspath(os.path.join(HERE, "../../.."))
ROOT = os.environ.get("VAD_TRAIN_ROOT", os.path.join(REPO, "build", "vad-train"))
DL = os.path.join(ROOT, "dl")
A = dict((a[2:].split("=", 1) + ["1"])[:2] for a in sys.argv[1:] if a.startswith("--"))
JOBS = int(A.get("jobs", "3"))
ONLY = set(A["only"].split(",")) if "only" in A else None

ZEN = "https://zenodo.org/api/records/{rec}/files/{name}/content"
COSWARA = "https://raw.githubusercontent.com/iiscleap/Coswara-Data/master/"
# Coswara date folders that were held-out VOICE sets of the notch work
# (build/notchvd-heldout: 20200814 + 20200820, build/notchvd-heldout2:
# 20200417) — never used here, so those sets stay clean
COSWARA_EXCLUDED_DATES = {"20200417", "20200814", "20200820"}
LIBRI = "https://openslr.elda.org/resources/12/"
LIBRI_MD5 = {"dev-clean.tar.gz": "42e2234ba48799c1f50f24a7926300a1", "dev-other.tar.gz": "c8d0bcc9cca99d4f8b62fcc847357931",
             "test-clean.tar.gz": "32fa31d27d2e1cad72775fee3f4849a9", "test-other.tar.gz": "fb5a50374b501bb3bac4815ee91d3135"}


def zenodo_files(rec, names=None):
    """(url, size, md5) of a Zenodo record's files, from its API record."""
    for k in range(6):
        try:
            r = requests.get(f"https://zenodo.org/api/records/{rec}", timeout=60)
            if r.status_code == 200:
                break
        except requests.RequestException:
            pass
        time.sleep(10 * (k + 1))
    else:
        raise IOError(f"zenodo record {rec}: unreachable")
    out = []
    for f in r.json()["files"]:
        if names is None or f["key"] in names:
            md5 = f.get("checksum", "").split(":", 1)[-1] if f.get("checksum", "").startswith("md5:") else None
            out.append((ZEN.format(rec=rec, name=f["key"]), f["size"], md5, f["key"]))
    return out


def targets():
    T = []  # (source, url, dest, size or None, md5 or None)
    if ONLY is None or "fsd50k" in ONLY:
        for url, size, md5, key in zenodo_files(4060432):
            T.append(("fsd50k", url, os.path.join(DL, "fsd50k", key), size, md5))
    if ONLY is None or "coswara" in ONLY:
        lst = json.load(open(os.path.join(ROOT, "meta", "coswara_files.json"), encoding="utf8"))
        for p, size in lst["parts"]:
            if p.split("/")[0] in COSWARA_EXCLUDED_DATES:
                continue
            T.append(("coswara", COSWARA + p, os.path.join(DL, "coswara", p.replace("/", "__")), size, None))
        for p in lst["csvs"]:
            if p.split("/")[0] not in COSWARA_EXCLUDED_DATES:
                T.append(("coswara", COSWARA + p, os.path.join(DL, "coswara", p.replace("/", "__")), None, None))
    if ONLY is None or "librispeech" in ONLY:
        for n, md5 in LIBRI_MD5.items():
            T.append(("librispeech", LIBRI + n, os.path.join(DL, "librispeech", n), None, md5))
    for src, rec, names in (("mdvr", 2867216, None), ("cantoria", 5878677, None), ("csd", 1286570, None), ("esmuc", 5848990, None)):
        if ONLY is None or src in ONLY:
            for url, size, md5, key in zenodo_files(rec, names):
                T.append((src, url, os.path.join(DL, "choir" if src != "mdvr" else "mdvr", key), size, md5))
    return T


LOCK = threading.Lock()


def log(*a):
    with LOCK:
        print(time.strftime("%H:%M:%S"), *a, flush=True)


def md5_of(p):
    h = hashlib.md5()
    with open(p, "rb") as f:
        for b in iter(lambda: f.read(1 << 22), b""):
            h.update(b)
    return h.hexdigest()


def get(t):
    src, url, dest, size, md5 = t
    os.makedirs(os.path.dirname(dest), exist_ok=True)
    done = dest + ".ok"
    if os.path.exists(done):
        return "cached"
    part = dest + ".part"
    s = requests.Session()
    for attempt in range(20):
        have = os.path.getsize(part) if os.path.exists(part) else 0
        if size and have >= size:
            break
        hdr = {"Range": f"bytes={have}-"} if have else {}
        try:
            with s.get(url, headers=hdr, stream=True, timeout=120, allow_redirects=True) as r:
                if r.status_code == 416:
                    break
                if r.status_code == 429:
                    time.sleep(60 * (attempt + 1)); continue
                if r.status_code not in (200, 206):
                    raise IOError(f"HTTP {r.status_code}")
                if have and r.status_code == 200:  # server ignored Range: restart
                    have = 0
                with open(part, "ab" if have else "wb") as f:
                    for b in r.iter_content(1 << 20):
                        f.write(b)
            if size is None or os.path.getsize(part) >= size:
                break
        except (requests.RequestException, IOError) as e:
            log(f"{src} {os.path.basename(dest)}: {e}; retry {attempt + 1}")
            time.sleep(min(300, 15 * (attempt + 1)))
    got = os.path.getsize(part)
    if size and got != size:
        raise IOError(f"{dest}: {got} bytes, expected {size}")
    if md5 and md5_of(part) != md5:
        os.remove(part)
        raise IOError(f"{dest}: md5 mismatch (removed, re-run)")
    os.replace(part, dest)
    open(done, "w").write(json.dumps({"url": url, "bytes": got, "md5": md5, "t": time.strftime("%Y-%m-%dT%H:%M:%S")}))
    return f"{got / 1e9:.2f} GB"


def main():
    T = targets()
    tot = sum(t[3] or 0 for t in T)
    log(f"{len(T)} files, {tot / 1e9:.1f} GB declared")
    if "list" in A:
        for t in T:
            print(t[0], t[3], t[1])
        return
    # big files first so the long transfers overlap
    T.sort(key=lambda t: -(t[3] or 0))

    def one(t):
        t0 = time.time()
        try:
            r = get(t)
            log(f"{t[0]} {os.path.basename(t[2])}: {r} ({time.time() - t0:.0f} s)")
            return True
        except Exception as e:  # noqa: BLE001
            log(f"FAILED {t[0]} {os.path.basename(t[2])}: {e}")
            return False
    with ThreadPoolExecutor(JOBS) as ex:
        ok = list(ex.map(one, T))
    log(f"done: {sum(ok)} / {len(ok)} files")
    if not all(ok):
        sys.exit(1)


if __name__ == "__main__":
    main()
