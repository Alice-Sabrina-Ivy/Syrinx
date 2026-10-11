# sealfp.py — custom voice detector, round 4 (pre-registration
# measurements/voice-detector-round4-preregistration-2026-10-11.md §2.2
# "Duplicates", §3.2 D3 "Fingerprints"): fingerprints of the SEALED
# confirmatory set, for the duplicate checks of the round-4 data steps.
#
# DATA-STEP SCRIPT. It reads the kept confirmatory records' prepared 16 kHz
# audio (conf/audio/voice16, conf/audio/noise) only to fingerprint it (custom/
# dedup.py, as r3/fpindex.py), and writes the fingerprints INSIDE the sealed
# root (build/vad-train/r3/conf/fp-r4/), where training, validation and
# selection code cannot read them (c3.guard_not_conf). The only output that
# leaves r3/conf/ is a matcher's keep / drop decision (match()).
#
#   python scripts/voice-detector/r4/sealfp.py build [--jobs=2]     # incremental: new kept records only
#   from sealfp import SealedIndex; SealedIndex().match(fingerprint(x16)) -> (name or None, ...) | None
import json
import os
import sys
from concurrent.futures import ProcessPoolExecutor

import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, "..", "r3"))
sys.path.insert(0, os.path.join(HERE, "..", "custom"))
from c3 import CAUDIO, CONF, CManifest, args, log  # noqa: E402
from dedup import fingerprint, read16  # noqa: E402

A = args()
D = os.path.join(CONF, "fp-r4")
PART = os.path.join(D, "parts")


def job(it):
    name, p = it
    try:
        return name, fingerprint(read16(p))
    except Exception as e:  # noqa: BLE001
        return name, str(e)


def done_names():
    out = set()
    for fn in sorted(os.listdir(PART)) if os.path.isdir(PART) else []:
        if fn.endswith(".npz"):
            out |= set(np.load(os.path.join(PART, fn))["names"].tolist())
    return out


def build():
    man = CManifest()
    os.makedirs(PART, exist_ok=True)
    have = done_names()
    items = sorted(("conf:" + r["id"], os.path.join(CAUDIO, r["path16"])) for r in man.kept() if r.get("path16"))
    todo = [it for it in items if it[0] not in have]
    log(f"sealed fingerprints: {len(items)} kept records with 16 kHz audio, {len(todo)} to do")
    CH, errs = 1000, []
    k0 = len([f for f in os.listdir(PART) if f.endswith(".npz")])
    with ProcessPoolExecutor(int(A.get("jobs", "2"))) as ex:
        for c0 in range(0, len(todo), CH):
            res = list(ex.map(job, todo[c0:c0 + CH], chunksize=8))
            ok = [(n, v) for n, v in res if not isinstance(v, str)]
            errs += [(n, v) for n, v in res if isinstance(v, str)]
            lens = np.array([len(v) for _, v in ok], np.int64)
            np.savez(os.path.join(PART, f"{k0 + c0 // CH:04d}.npz"), names=np.array([n for n, _ in ok]), lens=lens,
                     words=np.concatenate([v for _, v in ok]) if ok else np.zeros(0, np.uint32))
            log(f"  {min(c0 + CH, len(todo))} / {len(todo)}; errors {len(errs)}")
    names, lens, words = [], [], []
    for fn in sorted(os.listdir(PART)):
        if fn.endswith(".npz"):
            z = np.load(os.path.join(PART, fn))
            names += z["names"].tolist()
            lens.append(z["lens"])
            words.append(z["words"])
    lens = np.concatenate(lens) if lens else np.zeros(0, np.int64)
    np.savez(os.path.join(D, "sealed.npz"), names=np.array(names), lens=lens, words=np.concatenate(words) if words else np.zeros(0, np.uint32))
    json.dump({"clips": len(names), "hours": float(lens.sum() * 0.016 / 3600), "errors": errs}, open(os.path.join(D, "sealed.json"), "w"), indent=1)
    log(f"sealed index: {len(names)} clips, {lens.sum() * 0.016 / 3600:.1f} h; {len(errs)} unreadable")


def SealedIndex():
    from fpindex import Index
    return Index(os.path.join(D, "sealed.npz"))


if __name__ == "__main__":
    {"build": build}[sys.argv[1]]()
