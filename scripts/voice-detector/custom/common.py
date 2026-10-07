# common.py — shared helpers of the custom voice detector's data step
# (2026-10-06): paths, the FNV-1a split hash, the voice / music keyword rule,
# the benchmark exclusion lists (Freesound ids + uploaders, ESC-50 source ids),
# licence normalisation, 16 kHz conversion and the clip writer.
import json
import os
import re
import sys
import threading
from math import gcd

import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.abspath(os.path.join(HERE, "../../.."))
ROOT = os.environ.get("VAD_TRAIN_ROOT", os.path.join(REPO, "build", "vad-train"))
DL = os.path.join(ROOT, "dl")
DATA = os.path.join(ROOT, "data")
META = os.path.join(ROOT, "meta")
SPLITS = json.load(open(os.path.join(HERE, "splits.json"), encoding="utf8"))
SR = 16000


def args():
    return dict((a[2:].split("=", 1) + ["1"])[:2] for a in sys.argv[1:] if a.startswith("--"))


def fnv1a(s):
    """32-bit FNV-1a over the UTF-8 bytes (= scripts/realnoise-fv/lib/sets.mjs for ASCII ids)."""
    h = 0x811C9DC5
    for b in s.encode("utf8"):
        h ^= b
        h = (h * 0x01000193) & 0xFFFFFFFF
    return h


# Voice / music words in a Freesound title, description or tags: the clip may
# hold a voice its labels do not name (splits.json keyword_rule).
KEYWORDS = re.compile(
    r"\b(voices?|vocals?|vocali[sz]\w*|speech|speak(s|ing|er|ers)?|spoken|talk(s|ing|ed)?|conversations?|"
    r"sing(s|ing|er|ers)?|sung|songs?|choirs?|chant(s|ing)?|man|woman|men|women|people|persons?|child(ren)?|kids?|"
    r"bab(y|ies)|crowds?|chatter(ing)?|laugh(s|ing|ter)?|shout(s|ing)?|yell(s|ing)?|scream(s|ing)?|whisper(s|ing)?|"
    r"narrat(ion|or|ed)|announce(s|d|ment|ments|r)?|radio|tv|television|podcast|interview|dialog(ue)?|babble|"
    r"restaurant|caf[eé]|party|pub|musics?|musical|melod(y|ies)|humming|hums? a tune)\b", re.I)

LICENCE_OK = {"CC0 1.0", "CC BY 3.0", "CC BY 4.0", "ODC-By 1.0", "Apache-2.0", "MIT", "BSD"}


def norm_cc(url_or_text):
    """Creative Commons URL / Freesound label -> short id ('CC0 1.0', 'CC BY 3.0', ...) or the input."""
    t = (url_or_text or "").lower()
    m = re.search(r"creativecommons\.org/(licenses|publicdomain)/([a-z\-+]+)/([\d.]+)", t)
    if m:
        kind, ver = m.group(2), m.group(3)
        return {"zero": f"CC0 {ver}", "by": f"CC BY {ver}", "by-nc": f"CC BY-NC {ver}", "by-sa": f"CC BY-SA {ver}",
                "sampling+": f"Sampling+ {ver}", "by-nd": f"CC BY-ND {ver}", "by-nc-sa": f"CC BY-NC-SA {ver}"}.get(kind, url_or_text)
    return url_or_text


def notchvd_roots():
    r = os.environ.get("NOTCHVD_ROOT")
    if not r:
        raise SystemExit("set NOTCHVD_ROOT to the benchmark's real-data corpora root (build/notchvd of the checkout that built them)")
    return os.path.abspath(r), os.path.abspath(os.environ.get("NOTCHVD_HELDOUT_ROOT", r + "-heldout"))


def benchmark_noise_manifests():
    """Every record of the benchmark's noise manifests (both roots; private sources skipped)."""
    out = []
    for root in notchvd_roots():
        d = os.path.join(root, "data", "manifests")
        for fn in sorted(os.listdir(d)):
            if fn.startswith("noise.") and fn.endswith(".json") and fn.split(".")[1] in (
                    "freesound", "fsheld", "mssnsd", "demand", "esc50", "dcase", "dcaseeval"):
                for r in json.load(open(os.path.join(d, fn), encoding="utf8")):
                    r["_root"] = root
                    out.append(r)
    return out


def benchmark_freesound():
    """(ids, uploaders) of the benchmark's Freesound previews + every ESC-50 source id."""
    ids, ups = set(), set()
    for r in benchmark_noise_manifests():
        if r["source"] in ("freesound", "fsheld"):
            ids.add(int(re.search(r"/sounds/(\d+)", r["url"]).group(1)))
            ups.add(re.search(r"/people/([^/]+)/", r["url"]).group(1))
    esc = os.path.join(META, "esc50.csv")
    if not os.path.exists(esc):
        import requests
        open(esc, "wb").write(requests.get("https://raw.githubusercontent.com/karolpiczak/ESC-50/master/meta/esc50.csv", timeout=60).content)
    import csv
    esc_ids = {int(r["src_file"]) for r in csv.DictReader(open(esc, encoding="utf8"))}
    return ids, ups, esc_ids


def to16k_mono(x, sr, channel=0):
    """First channel (stereo pairs are not averaged: it can comb-filter a hum), polyphase to 16 kHz."""
    from scipy.signal import resample_poly
    x = np.asarray(x, np.float64)
    if x.ndim == 2:
        x = x[:, channel]
    if sr != SR:
        g = gcd(int(sr), SR)
        x = resample_poly(x, SR // g, int(sr) // g)
    return x.astype(np.float32)


def write_wav16(path, x, sr=SR):
    import soundfile as sf
    os.makedirs(os.path.dirname(path), exist_ok=True)
    peak = float(np.max(np.abs(x))) if len(x) else 0.0
    scale = 1.0 if peak <= 0.999 else 0.999 / peak
    sf.write(path, np.clip(x * scale, -1, 1), sr, subtype="PCM_16")
    return scale


_MLOCK = threading.Lock()


class Manifest:
    """Append-only JSONL manifest, one record per file (dropped ones carry `drop`).

    Each process writes its own data/manifest[.<part>].jsonl (concurrent runs
    never share a file); readers load every data/manifest*.jsonl and keep, per
    id, the record with the latest `t`."""

    def __init__(self, path):
        self.path = path
        os.makedirs(os.path.dirname(path), exist_ok=True)
        self.have = load_manifest(os.path.dirname(path))

    def add(self, rec):
        import time
        rec = dict(rec, t=round(time.time(), 3))
        with _MLOCK:
            self.have[rec["id"]] = rec
            with open(self.path, "a", encoding="utf8") as f:
                f.write(json.dumps(rec, ensure_ascii=False) + "\n")

    def __contains__(self, cid):
        return cid in self.have


def load_manifest(data_dir=DATA):
    have = {}
    for fn in sorted(os.listdir(data_dir)) if os.path.isdir(data_dir) else []:
        if fn.startswith("manifest") and fn.endswith(".jsonl"):
            for line in open(os.path.join(data_dir, fn), encoding="utf8"):
                line = line.strip()
                if not line:
                    continue
                r = json.loads(line)
                if r["id"] not in have or r.get("t", 0) >= have[r["id"]].get("t", 0):
                    have[r["id"]] = r
    return have
