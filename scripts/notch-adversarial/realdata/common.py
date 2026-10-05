# common.py — shared helpers for the real-data corpora (notch voice-vs-machine
# discrimination, 2026-10-05). Layout under build/notchvd/ (gitignored):
#   dl/<source>/...            raw download cache (originals, never edited)
#   data/noise/<source>/<id>.wav   16 kHz mono float32, ORIGINAL level
#   data/voice/<source>/<id>.wav   16 kHz mono float32, original level
#   data/mix/<set>/<id>.wav        16 kHz mono float32
#   data/manifests/<kind>.<source>.json    one record per clip (see README)
import os, json, sys, time, threading
import numpy as np, soundfile as sf
from math import gcd
from scipy.signal import resample_poly

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.abspath(os.path.join(HERE, "../../.."))
BUILD = os.environ.get("NOTCHVD_ROOT", os.path.join(REPO, "build/notchvd"))
DL = os.path.join(BUILD, "dl")
DATA = os.path.join(BUILD, "data")
SR = 16000
_lock = threading.Lock()

def args():
    return dict((a[2:].split("=", 1) + ["1"])[:2] for a in sys.argv[1:] if a.startswith("--"))

def to16k_mono(x, sr, channel=0):
    """First channel (a real single microphone; averaging a stereo pair can
    comb-filter a hum), polyphase-resampled to 16 kHz, float32."""
    x = np.asarray(x, dtype=np.float64)
    if x.ndim == 2: x = x[:, channel]
    if sr != SR:
        g = gcd(int(sr), SR)
        x = resample_poly(x, SR // g, int(sr) // g)
    return x.astype(np.float32)

def write_clip(kind, source, cid, x, meta):
    d = os.path.join(DATA, kind, source); os.makedirs(d, exist_ok=True)
    p = os.path.join(d, cid + ".wav")
    sf.write(p, x, SR, subtype="FLOAT")
    rec = dict(id=cid, kind=kind, source=source, path=os.path.relpath(p, DATA).replace("\\", "/"),
               sr=SR, dur=round(len(x) / SR, 3),
               rms_dbfs=round(float(20 * np.log10(np.sqrt(np.mean(np.square(x, dtype=np.float64))) + 1e-12)), 2),
               peak=round(float(np.max(np.abs(x))) if len(x) else 0.0, 4), **meta)
    return rec

def load_manifest(kind, sources=None):
    """Per-source manifests of a kind, merged (data/manifests/<kind>.<source>.json)."""
    d = os.path.join(DATA, "manifests"); out = []
    if os.path.isdir(d):
        for f in sorted(os.listdir(d)):
            if not (f.startswith(kind + ".") and f.endswith(".json")): continue
            if sources and f[len(kind) + 1:-5] not in sources: continue
            out += json.load(open(os.path.join(d, f)))
    return out

def save_manifest(kind, recs, source):
    """One manifest file per (kind, source): parallel fetchers never collide."""
    d = os.path.join(DATA, "manifests"); os.makedirs(d, exist_ok=True)
    recs = sorted(recs, key=lambda r: r["id"])
    p = os.path.join(d, f"{kind}.{source}.json")
    json.dump(recs, open(p + ".tmp", "w"), indent=1); os.replace(p + ".tmp", p)
    return recs

def fetch(url, dest, session=None, tries=6, min_bytes=1000):
    """Download url -> dest (cached). Returns dest."""
    import requests
    if os.path.exists(dest) and os.path.getsize(dest) >= min_bytes: return dest
    os.makedirs(os.path.dirname(dest), exist_ok=True)
    s = session or requests
    for k in range(tries):
        try:
            r = s.get(url, timeout=120, headers={"User-Agent": "Mozilla/5.0 (research corpus fetch)"})
            if r.status_code == 200 and len(r.content) >= min_bytes:
                tmp = dest + ".part"; open(tmp, "wb").write(r.content); os.replace(tmp, dest); return dest
            if r.status_code in (429, 503): time.sleep(20 * (k + 1)); continue
            if r.status_code == 403:  # some hosts (Mendeley) block python-requests' TLS fingerprint: use curl
                import subprocess
                tmp = dest + ".part"
                subprocess.run(["curl", "-sSL", "-A", "Mozilla/5.0", "--retry", "3", "-o", tmp, url], check=True)
                if os.path.getsize(tmp) >= min_bytes: os.replace(tmp, dest); return dest
            raise IOError(f"{url}: HTTP {r.status_code} ({len(r.content)} B)")
        except Exception as e:
            if k == tries - 1: raise
            time.sleep(5 * (k + 1))
    return dest
