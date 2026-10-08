# fpindex.py — custom voice detector, round 3 (pre-registration §1.1
# "Duplicate check"): fingerprints of EVERY earlier clip, voice and noise, and
# the matcher the confirmatory set is checked with.
#
# Earlier audio = every prepared file of rounds 1-2 (build/vad-train/data,
# kept and dropped records that have audio: training + validation, voice +
# non-voice), every clip of the benchmark's public voice and noise manifests
# (NOTCHVD_ROOT, -heldout, -heldout2; FDA, PTDB-TUG, vocadito, VocalSet, PVQD,
# VOICED, Hillenbrand, Coswara held-out; Freesound, fsheld, MS-SNSD, DEMAND,
# ESC-50, DCASE 2020 T2), and the review probes' audio (--probes: directories
# of the round-1 / round-2 review scratch: Freesound voice previews, VocalSet
# techniques and their derived probe files, the notch review's interferers).
#
# Fingerprint and candidate search = custom/dedup.py (Haitsma-Kalker, 8 kHz,
# 16 ms hop, 32 bits; candidates from exact 16-bit half hits). Round-3 rule:
# a match needs an aligned overlap of >= 3 s (188 frames) whose block BER over
# non-silent words is <= 0.35 (>= 80 % of the block non-silent); a shorter
# overlap never matches (Addendum D.1: sub-second clips gave spurious matches).
#
#   NOTCHVD_ROOT=... python scripts/voice-detector/r3/fpindex.py build --probes="dir;dir" [--jobs=2]
import json
import os
import sys
from concurrent.futures import ProcessPoolExecutor

import numpy as np

from c3 import DATA, FP, args, load_manifest, log

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "custom"))
from dedup import BER_MAX, BLOCK, MIN_VOTES, fingerprint, popcount, read16  # noqa: E402

A = args()
PUBLIC = ("fda", "ptdb", "vocadito", "vocalset", "pvqd", "voiced", "hillenbrand", "coswara",
          "freesound", "fsheld", "mssnsd", "demand", "esc50", "dcase", "dcaseeval")
AUDIO_EXT = (".wav", ".ogg", ".flac", ".mp3", ".oga")


def inventory():
    items = []
    man = load_manifest()
    for r in sorted(man.values(), key=lambda r: r["id"]):
        if r.get("path"):
            p = os.path.join(DATA, r["path"])
            if os.path.exists(p):
                items.append(("data:" + r["id"], p))
    nv = os.environ["NOTCHVD_ROOT"]
    for root in (nv, os.environ.get("NOTCHVD_HELDOUT_ROOT", nv + "-heldout"), os.environ.get("NOTCHVD_HELDOUT2_ROOT", nv + "-heldout2")):
        d = os.path.join(root, "data", "manifests")
        if not os.path.isdir(d):
            continue
        for fn in sorted(os.listdir(d)):
            kind, src = fn.split(".")[:2]
            if kind in ("voice", "noise") and src in PUBLIC:
                for r in json.load(open(os.path.join(d, fn), encoding="utf8")):
                    items.append((f"bench:{os.path.basename(root)}:{r['id']}", os.path.join(root, "data", r["path"])))
    for d in [x for x in A.get("probes", "").split(";") if x]:
        for rt, _, fns in os.walk(d):
            for fn in sorted(fns):
                if fn.lower().endswith(AUDIO_EXT):
                    p = os.path.join(rt, fn)
                    items.append(("probe:" + os.path.relpath(p, d).replace("\\", "/") + "@" + os.path.basename(d.rstrip("/\\")), p))
    return items


def job(it):
    name, p = it
    try:
        return name, fingerprint(read16(p))
    except Exception as e:  # noqa: BLE001
        return name, str(e)


def build():
    items = inventory()
    os.makedirs(FP, exist_ok=True)
    part = os.path.join(FP, "parts")
    os.makedirs(part, exist_ok=True)
    CH = 2000
    log(f"inventory: {len(items)} clips")
    json.dump([n for n, _ in items], open(os.path.join(FP, "inventory.json"), "w", encoding="utf8"))
    errs = []
    with ProcessPoolExecutor(int(A.get("jobs", "2"))) as ex:
        for c0 in range(0, len(items), CH):
            pp = os.path.join(part, f"{c0 // CH:04d}.npz")
            if os.path.exists(pp):
                continue
            res = list(ex.map(job, items[c0:c0 + CH], chunksize=16))
            ok = [(n, v) for n, v in res if not isinstance(v, str)]
            errs += [(n, v) for n, v in res if isinstance(v, str)]
            lens = np.array([len(v) for _, v in ok], np.int64)
            np.savez(pp, names=np.array([n for n, _ in ok]), lens=lens,
                     words=np.concatenate([v for _, v in ok]) if ok else np.zeros(0, np.uint32))
            log(f"  {min(c0 + CH, len(items))} / {len(items)}; {lens.sum() * 0.016 / 3600:.1f} h in this part; errors {len(errs)}")
    names, lens, words = [], [], []
    for fn in sorted(os.listdir(part)):
        z = np.load(os.path.join(part, fn))
        names += z["names"].tolist()
        lens.append(z["lens"])
        words.append(z["words"])
    lens = np.concatenate(lens)
    np.savez(os.path.join(FP, "earlier.npz"), names=np.array(names), lens=lens, words=np.concatenate(words))
    json.dump({"clips": len(names), "hours": float(lens.sum() * 0.016 / 3600), "errors": errs}, open(os.path.join(FP, "earlier.json"), "w"), indent=1)
    log(f"earlier audio: {len(names)} clips, {lens.sum() * 0.016 / 3600:.1f} h fingerprinted; {len(errs)} unreadable")


class Index:
    """dedup.Index over a concatenated word array (memory: no per-clip arrays), round-3 >= 3 s rule."""

    def __init__(self, path=os.path.join(FP, "earlier.npz")):
        z = np.load(path)
        self.names = z["names"].tolist()
        self.lens = z["lens"]
        self.words = z["words"]
        self.starts = np.concatenate([[0], np.cumsum(self.lens)[:-1]])
        h = self.words
        c = np.repeat(np.arange(len(self.lens), dtype=np.int32), self.lens)
        f = (np.arange(len(h), dtype=np.int64) - np.repeat(self.starts, self.lens)).astype(np.int32)
        self.tabs = []
        for half in (h & 0xFFFF, h >> 16):
            half = half.astype(np.uint32)
            cnt = np.bincount(half, minlength=1 << 16)
            keep = (cnt[half] <= 20000) & (h != 0)
            o = np.argsort(half[keep], kind="stable")
            self.tabs.append((half[keep][o], c[keep][o], f[keep][o]))
        del c, f

    def clip(self, c):
        a = self.starts[c]
        return self.words[a:a + self.lens[c]]

    def match(self, q, top_n=20, skip=()):
        """(name or None, offset, ber, votes, overlap_frames) of the best verified candidate; None if no candidate."""
        if len(q) < BLOCK:
            return None
        keys = []
        for (H, C, F), qh in zip(self.tabs, ((q & 0xFFFF).astype(np.uint32), (q >> 16).astype(np.uint32))):
            lo = np.searchsorted(H, qh, "left")
            hi = np.searchsorted(H, qh, "right")
            sel = np.nonzero((hi > lo) & (q != 0))[0]
            if not len(sel):
                continue
            L = (hi - lo)[sel]
            pos = np.repeat(lo[sel], L) + (np.arange(L.sum()) - np.repeat(np.cumsum(L) - L, L))
            off = F[pos].astype(np.int64) - np.repeat(sel, L).astype(np.int64)
            keys.append((C[pos].astype(np.int64) << 24) | (off + (1 << 23)))
        if not keys:
            return None
        uk, cnt = np.unique(np.concatenate(keys), return_counts=True)
        top = np.argsort(-cnt, kind="stable")[:top_n]
        best = None
        for k_, v in zip(uk[top].tolist(), cnt[top].tolist()):
            c, off = k_ >> 24, (k_ & ((1 << 24) - 1)) - (1 << 23)
            if v < MIN_VOTES:
                break
            if self.names[c] in skip:
                continue
            b = self.clip(c)
            a0, a1 = max(0, -off), min(len(q), len(b) - off)
            if a1 - a0 < BLOCK:                      # round 3: >= 3 s of aligned overlap
                continue
            qa, ba = q[a0:a1], b[a0 + off:a1 + off]
            valid = ((qa != 0) & (ba != 0)).astype(np.float64)
            x = popcount(qa ^ ba).astype(np.float64) / 32 * valid
            nv = np.convolve(valid, np.ones(BLOCK), "valid")
            ber_b = np.where(nv >= 0.8 * BLOCK, np.convolve(x, np.ones(BLOCK), "valid") / np.maximum(nv, 1), 1.0)
            ber = float(np.min(ber_b))
            if best is None or ber < best[2]:
                best = (self.names[c], off, ber, v, a1 - a0)
        if best is None:
            return None
        return best if best[2] <= BER_MAX else (None,) + best[1:]


if __name__ == "__main__":
    if sys.argv[1] == "build":
        build()
