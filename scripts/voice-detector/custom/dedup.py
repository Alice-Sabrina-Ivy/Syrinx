# dedup.py — custom voice detector, data step (2026-10-06): the two audio
# checks of the negatives (splits.json dedup_vs_benchmark), after prepare.py.
#
# 1. Fingerprint vs the benchmark noise. A Haitsma-Kalker robust hash (8 kHz,
#    256 ms Hann frames every 16 ms, 33 log-spaced bands 100-3500 Hz, 32 bits
#    per frame = signs of the band-energy differences across bands and time)
#    of every clip of the benchmark noise manifests (freesound, fsheld,
#    MS-SNSD, DEMAND, ESC-50, DCASE, dcaseeval; read in place) is indexed.
#    Candidate offsets: >= 4 exactly equal 16-bit halves of sub-fingerprints
#    at one offset with one benchmark clip (a 32-bit word rarely survives the
#    BER ~0.2 of a channel-0 vs mono-mix copy). A negative is a duplicate when
#    the bit error rate over an aligned 3 s block (188 frames; the whole
#    overlap when shorter; all-zero = silent words ignored, >= 80 % of the
#    block non-silent) is <= 0.35.
# 2. Speech screen: Silero VAD v6.2.3 (reference streaming, 32 ms chunks);
#    a negative with >= 1.0 s (32 chunks) at p >= 0.9 is dropped.
#
# Drops are appended to data/manifest.jsonl (the record repeated with `drop`);
# meta/dedup_report.json has every match and the per-class counts.
#
#   NOTCHVD_ROOT=<checkout>/build/notchvd python scripts/voice-detector/custom/dedup.py [--jobs=3] [--selftest]
import collections
import json
import os
import sys
import time
from concurrent.futures import ProcessPoolExecutor

import numpy as np

from common import DATA, META, REPO, Manifest, args, benchmark_noise_manifests

A = args()
JOBS = int(A.get("jobs", "3"))
SILERO = A.get("silero", os.path.join(REPO, "build", "vad", "silero", "dl", "silero-vad-6.2.3", "src", "silero_vad", "data", "silero_vad.onnx"))
FR, HOP, BLOCK, BER_MAX, MIN_VOTES = 2048, 128, 188, 0.35, 4
EDGES = np.geomspace(100, 3500, 34)
SPEECH_P, SPEECH_CHUNKS = 0.9, 32


def read16(path):
    import soundfile as sf
    x, sr = sf.read(path, dtype="float32", always_2d=True)
    x = x[:, 0]
    if sr != 16000:
        from scipy.signal import resample_poly
        from math import gcd
        g = gcd(16000, sr)
        x = resample_poly(x, 16000 // g, sr // g).astype(np.float32)
    return x


def fingerprint(x16):
    from scipy.signal import resample_poly
    x = resample_poly(x16.astype(np.float64), 1, 2)
    if len(x) < FR + 2 * HOP:
        return np.zeros(0, np.uint32)
    win = np.hanning(FR)
    freqs = np.fft.rfftfreq(FR, 1 / 8000)
    band = np.searchsorted(EDGES, freqs) - 1
    ok = (band >= 0) & (band < 33)
    out = []
    n = 1 + (len(x) - FR) // HOP
    for a in range(0, n, 2048):  # frames in blocks (memory)
        b = min(n, a + 2048 + 1)
        idx = (np.arange(a, b) * HOP)[:, None] + np.arange(FR)[None, :]
        P = np.abs(np.fft.rfft(x[idx] * win, axis=1)) ** 2
        E = np.zeros((b - a, 33))
        for k in range(33):
            E[:, k] = P[:, ok & (band == k)].sum(axis=1)
        out.append(E if a == 0 else E[1:])
    E = np.concatenate(out)
    D = (E[1:, :-1] - E[1:, 1:]) - (E[:-1, :-1] - E[:-1, 1:])
    bits = (D > 0).astype(np.uint32)
    return (bits << np.arange(32, dtype=np.uint32)[None, :]).sum(axis=1).astype(np.uint32)


def popcount(v):
    v = v - ((v >> 1) & 0x55555555)
    v = (v & 0x33333333) + ((v >> 2) & 0x33333333)
    return (((v + (v >> 4)) & 0x0F0F0F0F) * 0x01010101 & 0xFFFFFFFF) >> 24


def bench_job(r):
    p = os.path.join(r["_root"], "data", r["path"])
    return r["id"], fingerprint(read16(p))


_SESS = None


def neg_job(rec):
    global _SESS
    x = read16(rec["_file"] if "_file" in rec else os.path.join(DATA, rec["path"]))
    fp = fingerprint(x)
    if _SESS is None:
        import onnxruntime as ort
        o = ort.SessionOptions()
        o.inter_op_num_threads = o.intra_op_num_threads = 1
        _SESS = ort.InferenceSession(SILERO, providers=["CPUExecutionProvider"], sess_options=o)
    n = len(x) // 512
    state = np.zeros((2, 1, 128), np.float32)
    sr = np.array(16000, dtype=np.int64)
    buf = np.zeros((1, 576), np.float32)
    hi = 0
    for i in range(n):
        buf[0, 64:] = x[i * 512:(i + 1) * 512]
        o, state = _SESS.run(None, {"input": buf, "state": state, "sr": sr})
        hi += o[0, 0] >= SPEECH_P
        buf[0, :64] = buf[0, -64:]
    return rec["id"], fp, int(hi)


class Index:
    """Candidate offsets from exact 16-bit HALF sub-fingerprint hits (a 32-bit word
    survives a BER of 0.2 with p = 0.8**32 = 0.1 %, a 16-bit half with 2.8 %),
    then verification by the bit error rate over non-silent aligned frames."""

    def __init__(self, fps):
        self.names = [k for k, _ in fps]
        self.fps = [v for _, v in fps]
        h = np.concatenate(self.fps)
        c = np.concatenate([np.full(len(v), i, np.int32) for i, v in enumerate(self.fps)])
        f = np.concatenate([np.arange(len(v), dtype=np.int32) for v in self.fps])
        self.tabs = []
        for half in (h & 0xFFFF, h >> 16):
            half = half.astype(np.uint32)
            vals, cnt = np.unique(half, return_counts=True)
            keep = ~np.isin(half, vals[cnt > 2000]) & (h != 0)
            o = np.argsort(half[keep], kind="stable")
            self.tabs.append((half[keep][o], c[keep][o], f[keep][o]))

    def match(self, q):
        """(benchmark clip or None, offset, ber, votes) of the best verified candidate, or None."""
        if not len(q):
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
            keys.append((C[pos].astype(np.int64) << 22) | (off + (1 << 21)))
        if not keys:
            return None
        uk, cnt = np.unique(np.concatenate(keys), return_counts=True)
        top = np.argsort(-cnt, kind="stable")[:10]
        best = None
        for k_, v in zip(uk[top].tolist(), cnt[top].tolist()):
            c, off = k_ >> 22, (k_ & ((1 << 22) - 1)) - (1 << 21)
            if v < MIN_VOTES:
                break
            b = self.fps[c]
            a0, a1 = max(0, -off), min(len(q), len(b) - off)
            if a1 - a0 < 8:
                continue
            qa, ba = q[a0:a1], b[a0 + off:a1 + off]
            valid = ((qa != 0) & (ba != 0)).astype(np.float64)  # all-zero words = silence: never evidence
            x = popcount(qa ^ ba).astype(np.float64) / 32 * valid
            L = min(BLOCK, len(x))
            nv = np.convolve(valid, np.ones(L), "valid")
            ber_b = np.where(nv >= 0.8 * L, np.convolve(x, np.ones(L), "valid") / np.maximum(nv, 1), 1.0)
            ber = float(np.min(ber_b))
            if best is None or ber < best[2]:
                best = (self.names[c], off, ber, v)
        if best is None:
            return None
        return best if best[2] <= BER_MAX else (None,) + best[1:]


def main():
    t0 = time.time()
    bench = [r for r in benchmark_noise_manifests() if not r.get("dup_of")]
    cache = os.path.join(META, "bench_fingerprints.npz")
    if os.path.exists(cache):
        z = np.load(cache, allow_pickle=True)
        fps = list(zip(z["names"].tolist(), z["fps"]))
    else:
        with ProcessPoolExecutor(JOBS) as ex:
            fps = list(ex.map(bench_job, bench, chunksize=4))
        np.savez(cache, names=np.array([k for k, _ in fps], dtype=object), fps=np.array([v for _, v in fps], dtype=object))
    idx = Index(fps)
    print(f"benchmark: {len(fps)} clips, {sum(len(t[0]) for t in idx.tabs)} indexed half-words ({time.time() - t0:.0f} s)", flush=True)
    man = Manifest(os.path.join(DATA, "manifest.dedup.jsonl"))
    negs = [r for r in man.have.values() if r["kind"] == "nonvoice" and "drop" not in r]
    if "selftest" in A:  # known duplicates: FSD50K clips whose Freesound id is a benchmark preview / ESC-50 source
        from common import DL
        negs = [dict(r, _file=os.path.join(DL, "fsd50k", "extract", r["member"])) for r in man.have.values()
                if r["source"] == "fsd50k" and r.get("drop") in ("benchmark Freesound id", "ESC-50 source id")]
    done = {}
    rep_p = os.path.join(META, "dedup_report.json" if "selftest" not in A else "dedup_selftest.json")
    if os.path.exists(rep_p) and "selftest" not in A:
        done = json.load(open(rep_p, encoding="utf8"))["clips"]
    todo = [r for r in negs if r["id"] not in done]
    print(f"negatives: {len(negs)} ({len(todo)} to check)", flush=True)
    with ProcessPoolExecutor(JOBS) as ex:
        for k, (cid, fp, hi) in enumerate(ex.map(neg_job, todo, chunksize=8)):
            m = idx.match(fp)
            done[cid] = {"match": m[0] if m else None, "offset": m[1] if m else None, "ber": round(m[2], 3) if m else None,
                         "votes": m[3] if m else 0, "speech_chunks": hi}
            if k % 1000 == 999:
                json.dump({"clips": done}, open(rep_p, "w", encoding="utf8"))
                print(f"  {k + 1} / {len(todo)} ({time.time() - t0:.0f} s)", flush=True)
    json.dump({"clips": done}, open(rep_p, "w", encoding="utf8"))
    if "selftest" in A:
        hit = sum(1 for v in done.values() if v["match"])
        print(f"selftest: {hit} / {len(done)} known duplicates matched; BERs {sorted(v['ber'] for v in done.values() if v['ber'] is not None)[:20]}")
        return
    byid = {r["id"]: r for r in negs}
    for cid, v in done.items():
        r = byid.get(cid)
        if r is None:
            continue
        if v["match"]:
            man.add(dict(r, drop=f"fingerprint match with benchmark clip {v['match']} (BER {v['ber']})"))
        elif v["speech_chunks"] >= SPEECH_CHUNKS:
            man.add(dict(r, drop=f"speech screen: {v['speech_chunks']} Silero chunks (32 ms) at p >= {SPEECH_P}"))
    # an uploader with a clip that matched benchmark audio is treated like a benchmark uploader
    # (splits.json rule 2's reason: the same people, devices, rooms and machines; addendum A)
    matched_up = {man.have[c].get("uploader") for c, v in done.items() if v["match"] and c in man.have} - {None}
    for r in list(man.have.values()):
        if r["kind"] == "nonvoice" and "drop" not in r and r.get("uploader") in matched_up:
            man.add(dict(r, drop=f"uploader of a clip that fingerprint-matched benchmark audio ({r['uploader']})"))
    cls = collections.Counter()
    for cid in done:
        r = man.have.get(cid)
        if r is None:
            continue
        key = r["source"] + (":machine" if r.get("machine_room") else ":other")
        cls[key + ":n"] += 1
        d = r.get("drop", "")
        if d.startswith("fingerprint match"):
            cls[key + ":fingerprint"] += 1
        elif d.startswith("speech screen"):
            cls[key + ":speech"] += 1
        elif d.startswith("uploader of a clip"):
            cls[key + ":matched-uploader"] += 1
    rep = json.load(open(rep_p, encoding="utf8"))
    rep["summary"] = dict(cls)
    rep["matched_uploaders"] = sorted(matched_up)
    json.dump(rep, open(rep_p, "w", encoding="utf8"))
    print(json.dumps(dict(cls), indent=1))


if __name__ == "__main__":
    sys.exit(main())
