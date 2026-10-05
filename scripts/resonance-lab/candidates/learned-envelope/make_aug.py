"""Training augmentation for the learned-envelope family (LibriSpeech dev-clean ONLY).

For each of N_PER_SPK train_dev utterances per speaker (cropped to <= CROP_S), render
random pitch-only, formant-only and combined variants with BOTH harness engines
(Praat PSOLA / Change gender, WORLD) using rlab.manip's own rendering functions, but
with CONTINUOUS random shift amounts (not the benchmark's fixed grid):
  pitch st ~ U(+-[2, 12]),  formant scale fs ~ logU[0.80, 1.25] (|ln fs| >= 0.02)
Each variant records its same-engine reference (ref_psola / ref_cg / world ref), so
training can use within-pair differences (invariance / equivariance constraints).

Outputs (gitignored): build/resonance-lab/learned-envelope/aug/{audio/<src>/<cond>.flac, manifest.parquet}
F0 for a variant = the source's two-pass Praat track x 2^(st/12) (same convention as the
harness's manipulated items).
"""
import os
import sys
import numpy as np
import pandas as pd
import soundfile as sf
from concurrent.futures import ProcessPoolExecutor

LAB = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
sys.path.insert(0, LAB)
from rlab import audio, manip  # noqa: E402
from rlab.f0 import F0Track  # noqa: E402
from rlab.paths import BUILD, MANIFESTS, SR  # noqa: E402

OUT = os.path.join(BUILD, "learned-envelope", "aug")
N_PER_SPK = 30
CROP_S = 6.0


def _rand_st(rng):
    return float(rng.choice([-1, 1]) * rng.uniform(2, 12))


def _rand_fs(rng):
    while True:
        l = rng.uniform(np.log(0.80), np.log(1.25))
        if abs(l) >= 0.02:
            return float(np.exp(l))


def plan(seed):
    rng = np.random.default_rng(seed)
    P = [dict(engine="praat", cond="ref_psola", kind="ref", st=0.0, fs=1.0, ref="orig"),
         dict(engine="praat", cond="ref_cg", kind="ref", st=0.0, fs=1.0, ref="orig")]
    for i in range(2):
        P.append(dict(engine="praat", cond=f"p{i}", kind="pitch", st=_rand_st(rng), fs=1.0, ref="ref_psola"))
    for i in range(2):
        P.append(dict(engine="praat", cond=f"f{i}", kind="formant", st=0.0, fs=_rand_fs(rng), ref="ref_cg"))
    P.append(dict(engine="praat", cond="c0", kind="combo", st=_rand_st(rng), fs=_rand_fs(rng), ref="ref_cg"))
    P.append(dict(engine="world", cond="wref", kind="ref", st=0.0, fs=1.0, ref="orig"))
    P.append(dict(engine="world", cond="wp0", kind="pitch", st=_rand_st(rng), fs=1.0, ref="wref"))
    for i in range(2):
        P.append(dict(engine="world", cond=f"wf{i}", kind="formant", st=0.0, fs=_rand_fs(rng), ref="wref"))
    P.append(dict(engine="world", cond="wc0", kind="combo", st=_rand_st(rng), fs=_rand_fs(rng), ref="wref"))
    return P


def job(row):
    src, path, f0p, seed = row
    d = os.path.join(OUT, "audio", src)
    os.makedirs(d, exist_ok=True)
    x = audio.load(path)
    n = min(len(x), int(CROP_S * SR))
    x = x[:n]
    tr = F0Track.load(f0p)
    keep = tr.t < n / SR
    tr = F0Track(tr.t[keep], tr.f0[keep])
    v = tr.f0[tr.f0 > 0]
    if len(v) < 5:
        v = np.array([120.0, 220.0])
    floor = float(max(50.0, 0.7 * np.percentile(v, 10)))
    ceil = float(min(800.0, max(1.6 * np.percentile(v, 90), floor * 2.5)))
    med = float(np.median(v))
    r0 = audio.rms(x)
    rows = []
    world = None
    outs = {"orig": np.asarray(x, np.float64)}
    for c in plan(seed):
        if c["engine"] == "praat":
            cc = dict(c)
            if c["cond"] == "ref_psola":
                cc["kind"] = "pitch"
            y = manip.praat_variant(x, cc, floor, ceil, med)
        else:
            if world is None:
                world = manip.WorldAnalysis(x, floor, ceil)
            y = world.variant(c)
        r = audio.rms(y)
        if r > 0:
            y = y * (r0 / r)
        outs[c["cond"]] = y
    g = 1.0
    pk = max(float(np.max(np.abs(y))) for y in outs.values())
    if pk > 0.99:
        g = 0.99 / pk
    meta = {c["cond"]: c for c in plan(seed)}
    meta["orig"] = dict(engine="none", cond="orig", kind="orig", st=0.0, fs=1.0, ref="")
    for cond, y in outs.items():
        p = os.path.join(d, cond + ".flac")
        sf.write(p, (y * g).astype(np.float32), SR, subtype="PCM_16")
        rows.append(dict(src=src, path=p, f0_src=f0p, crop_s=n / SR, **meta[cond]))
    return rows


def main():
    m = pd.read_parquet(os.path.join(MANIFESTS, "train_dev.parquet"))
    m = m[m.voiced_s >= 1.5]
    rng = np.random.default_rng(20261004)
    sel = []
    for spk, d in m.groupby("speaker"):
        d = d.sample(min(N_PER_SPK, len(d)), random_state=int(rng.integers(1 << 30)))
        sel.append(d)
    sel = pd.concat(sel)
    jobs = [(r.item_id, r.path, r.f0_path, 1000 + i) for i, r in enumerate(sel.itertuples())]
    os.makedirs(OUT, exist_ok=True)
    rows = []
    nw = int(os.environ.get("NW", "10"))
    with ProcessPoolExecutor(nw) as ex:
        for i, rr in enumerate(ex.map(job, jobs, chunksize=2)):
            rows.extend(rr)
            if (i + 1) % 100 == 0:
                print(f"{i + 1}/{len(jobs)}", flush=True)
    df = pd.DataFrame(rows)
    lab = sel.set_index("item_id")[["speaker", "sex"]]
    df = df.join(lab, on="src")
    df.to_parquet(os.path.join(OUT, "manifest.parquet"))
    print(df.shape, df.groupby("kind").size())


if __name__ == "__main__":
    main()
