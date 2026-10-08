# c3.py — custom voice detector, round 3 (pre-registration
# measurements/voice-detector-round3-preregistration-2026-10-07.md): shared
# paths and helpers of the round-3 data step.
#
# Layout (all gitignored, under build/vad-train/):
#   r3/exclude.json            the collected exclusion list (§1.1)
#   r3/fp/                     fingerprints of every earlier clip (rounds 1-2
#                              training / validation, benchmark voice + noise,
#                              review probes) for the duplicate check
#   r3/conf/                   THE SEALED CONFIRMATORY SET: downloads (dl/),
#                              prepared audio (audio/), references (refs/),
#                              stream specs (streams/), current-app dumps
#                              (dumps/), manifest.jsonl. Training, validation
#                              and selection scripts refuse every path here
#                              (guard_not_conf).
#   r3/vsess/                  validation-side one-room carried sessions (§2)
import json
import os
import sys
import threading
import time

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, "..", "custom"))
from common import DATA, DL, META, REPO, ROOT, SPLITS, KEYWORDS, args, fnv1a, load_manifest, norm_cc  # noqa: E402,F401

R3 = os.path.join(ROOT, "r3")
CONF = os.path.join(R3, "conf")
CDL = os.path.join(CONF, "dl")
CAUDIO = os.path.join(CONF, "audio")
CREFS = os.path.join(CONF, "refs")
VSESS = os.path.join(R3, "vsess")
FP = os.path.join(R3, "fp")
SR = 16000
UA = {"User-Agent": "Mozilla/5.0 (research data fetch; Syrinx voice-detector)"}
ZEN = "https://zenodo.org/api/records/{rec}/files/{fn}/content"


def guard_not_conf(path):
    """Round 3 §1.6: training, validation and selection never read the sealed set."""
    p = os.path.normcase(os.path.abspath(path))
    if p.startswith(os.path.normcase(os.path.abspath(CONF))):
        raise SystemExit(f"refused: {path} is inside the sealed confirmatory set ({CONF})")
    return path


def log(*a):
    print(time.strftime("%H:%M:%S"), *a, flush=True)


def write_json(path, obj, indent=None):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    tmp = path + ".tmp"
    with open(tmp, "w", encoding="utf8") as f:
        json.dump(obj, f, indent=indent, ensure_ascii=False)
    os.replace(tmp, path)


_LOCK = threading.Lock()


class CManifest:
    """Append-only JSONL manifest of the confirmatory set (latest record per id wins)."""

    def __init__(self, path=os.path.join(CONF, "manifest.jsonl")):
        self.path = path
        self.have = {}
        if os.path.exists(path):
            for line in open(path, encoding="utf8"):
                line = line.strip()
                if line:
                    r = json.loads(line)
                    self.have[r["id"]] = r

    def add(self, rec):
        rec = dict(rec, t=round(time.time(), 3))
        with _LOCK:
            self.have[rec["id"]] = rec
            os.makedirs(os.path.dirname(self.path), exist_ok=True)
            with open(self.path, "a", encoding="utf8") as f:
                f.write(json.dumps(rec, ensure_ascii=False) + "\n")

    def kept(self):
        return [r for r in self.have.values() if not r.get("drop")]


def anon(g):
    """Public form of a group key: Wikimedia Commons contributors (c_ipa groups) appear in ids, file names and the
    committed manifest only as a hash of the key; ordering and seeds still use the key itself."""
    return f"c_ipa:a{fnv1a(g):08x}" if g and g.startswith("c_ipa:") else g


def load_exclude():
    return json.load(open(os.path.join(R3, "exclude.json"), encoding="utf8"))
