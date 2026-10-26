"""score.py — Voice Shaper noise study, step 4 (measurements/voice-shaper-noise-2026-10-25.md).

For every row of <data>/res/<set>/<tag>-*.jsonl: PESQ-WB (ITU-T P.862.2, `pesq`) and ESTOI (`pystoi`)
of the candidate's 16 kHz render against the reference render of the same clip and cell, and
DNSMOS P.835 (SIG / BAK / OVRL; microsoft/DNS-Challenge DNSMOS/sig_bak_ovr.onnx, the polynomial
mapping of its dnsmos_local.py, non-personalised) of the render itself. Writes
<data>/res/<set>/<tag>.scored.jsonl (cached per render; reruns only score what is new).

  python -I score.py <data> <set> <tag> <dnsmos dir> [workers]
"""
import json
import sys
from concurrent.futures import ProcessPoolExecutor
from pathlib import Path

import numpy as np
import soundfile as sf

DATA, SET, TAG, DNS = Path(sys.argv[1]), sys.argv[2], sys.argv[3], Path(sys.argv[4])
WORKERS = int(sys.argv[5]) if len(sys.argv) > 5 else 12
SR = 16000
_sess = None


def slug(s):
    import re
    return re.sub(r"[^A-Za-z0-9_.+-]", "", re.sub(r"[|:]", "_", s))


def dnsmos(x):
    global _sess
    import onnxruntime as ort
    if _sess is None:
        so = ort.SessionOptions()
        so.intra_op_num_threads = 1
        _sess = ort.InferenceSession(str(DNS / "sig_bak_ovr.onnx"), so, providers=["CPUExecutionProvider"])
    L = int(9.01 * SR)
    a = x.astype(np.float32)
    while len(a) < L:
        a = np.append(a, a)
    hops = int(np.floor(len(a) / SR) - 9.01) + 1
    out = []
    for i in range(hops):
        seg = a[i * SR: i * SR + L]
        if len(seg) < L:
            continue
        sig, bak, ovr = _sess.run(None, {"input_1": seg[None, :]})[0][0]
        out.append((np.poly1d([-0.08397278, 1.22083953, 0.0052439])(sig),
                    np.poly1d([-0.13166888, 1.60915514, -0.39604546])(bak),
                    np.poly1d([-0.06766283, 1.11546468, 0.04602535])(ovr)))
    m = np.mean(out, axis=0)
    return float(m[0]), float(m[1]), float(m[2])


def work(job):
    from pesq import pesq
    from pystoi import stoi
    ref_p, deg_p = job
    ref, _ = sf.read(ref_p, dtype="float32")
    deg, _ = sf.read(deg_p, dtype="float32")
    n = min(len(ref), len(deg))
    ref, deg = ref[:n], deg[:n]
    try:
        p = float(pesq(SR, ref, deg, "wb"))
    except Exception:
        p = None
    e = float(stoi(ref, deg, SR, extended=True))
    s, b, o = dnsmos(deg)
    return deg_p, {"pesq": p, "estoi": e, "sig": s, "bak": b, "ovrl": o}


def main():
    rows = []
    for tag in TAG.split(","):
        for f in sorted((DATA / "res" / SET).glob(f"{tag}-*.jsonl")):
            rows += [json.loads(l) for l in f.read_text().splitlines() if l]
    out = DATA / "res" / SET / f"{TAG.split(',')[0]}.scored.jsonl"
    cache = {}
    cache_f = DATA / "res" / SET / "score-cache.jsonl"
    if cache_f.exists():
        for l in cache_f.read_text().splitlines():
            if l:
                d = json.loads(l)
                cache[d["path"]] = d["m"]
    jobs = {}
    for r in rows:
        deg = DATA / "render" / SET / slug(r["cand"]) / f"{r['mix']}.{r['cell']}.wav"
        ref = DATA / "render" / SET / "ref" / f"{r['speech']}.{r['cell']}.wav"
        r["_deg"] = str(deg)
        if str(deg) not in cache and str(deg) not in jobs:
            jobs[str(deg)] = (str(ref), str(deg))
    # the reference renders' own DNSMOS (context)
    for r in rows:
        ref = str(DATA / "render" / SET / "ref" / f"{r['speech']}.{r['cell']}.wav")
        r["_ref"] = ref
        if ref not in cache and ref not in jobs:
            jobs[ref] = (ref, ref)
    print(f"{len(rows)} rows, {len(jobs)} renders to score", flush=True)
    with open(cache_f, "a") as cf, ProcessPoolExecutor(WORKERS) as ex:
        for i, (p, m) in enumerate(ex.map(work, jobs.values(), chunksize=8)):
            cache[p] = m
            cf.write(json.dumps({"path": p, "m": m}) + "\n")
            if i % 500 == 0:
                print(f"  {i}/{len(jobs)}", flush=True)
    with open(out, "w") as fo:
        for r in rows:
            m = cache[r.pop("_deg")]
            ref = cache[r.pop("_ref")]
            r.update(m)
            r["refOvrl"], r["refSig"], r["refBak"] = ref["ovrl"], ref["sig"], ref["bak"]
            fo.write(json.dumps(r) + "\n")
    print("wrote", out)


if __name__ == "__main__":
    main()
