"""Copied from scripts/resonance-robustness/ at 99ff7fc (output folder moved to build/resonance-narrowband/). Build the 50 s reading streams and their WORLD formant versions (16 kHz).

measurements/resonance-robustness-2026-10-19.md §2. Run with the lab venv, -I:
  PY -I scripts/resonance-narrowband/build_streams.py --libri <cache>/librispeech/LibriSpeech [--workers 2]

Speakers / utterances: the resonance-lab r1_test recipe (rlab.loaders.libri_pool
"test-clean", 25 per speaker, lab seed), concatenated in manifest order and cut at
the first utterance end >= 50 s. Versions: orig (no WORLD) and WORLD k = 0.88,
0.94, 1.00, 1.06, 1.12 (rlab.manip.WorldAnalysis; f0 unchanged; envelope and
aperiodicity warped; analysis range as rlab.manip.make_variants; RMS-matched to
the source). Also writes the babble source (6 dev-clean talkers, 3 F + 3 M).
Output (float32 raw, 16 kHz): build/resonance-narrowband/streams16/<spk>_<ver>.f32,
streams.json (speaker, sex, utterance ids, duration).
"""
import argparse
import json
import os
import sys
from multiprocessing import Pool

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.dirname(os.path.dirname(HERE))
sys.path.insert(0, os.path.join(REPO, "scripts", "resonance-lab"))
# run with -I (untrusted data): user site is off, so add it explicitly (numpy etc. live there)
import site  # noqa: E402
sys.path.append(site.getusersitepackages())

import numpy as np  # noqa: E402

OUT = os.path.join(REPO, "build", "resonance-narrowband")
S16 = os.path.join(OUT, "streams16")
STREAM_S = 50.0
KS = [0.88, 0.94, 1.00, 1.06, 1.12]


def ver_name(k):
    return f"k{int(round(k * 100)):03d}"


def build_one(job):
    from rlab import manip
    from rlab.audio import load, rms
    from rlab.f0 import praat_track
    spk, paths = job
    x = np.concatenate([load(p) for p in paths]).astype(np.float64)
    np.asarray(x, np.float32).tofile(os.path.join(S16, f"{spk}_orig.f32"))
    f0 = praat_track(x)
    v = f0.f0[f0.f0 > 0]
    if len(v) < 5:
        v = np.array([120.0, 220.0])
    floor = float(max(50.0, 0.7 * np.percentile(v, 10)))
    ceil = float(min(800.0, max(1.6 * np.percentile(v, 90), floor * 2.5)))
    w = manip.WorldAnalysis(x, floor, ceil)
    r0 = rms(x)
    for k in KS:
        y = w.variant(dict(st=0, fs=k))
        r = rms(y)
        if r > 0:
            y = y * (r0 / r)
        np.asarray(y, np.float32).tofile(os.path.join(S16, f"{spk}_{ver_name(k)}.f32"))
    return spk, floor, ceil


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--libri", required=True)
    ap.add_argument("--workers", type=int, default=3)
    a = ap.parse_args()
    from rlab import loaders
    from rlab.audio import load
    loaders.LIBRI = a.libri
    os.makedirs(S16, exist_ok=True)
    df = loaders.libri_pool("test-clean", 25)
    streams = []
    for spk, d in df.groupby("speaker"):
        d = d.sort_values("order")
        cum, ids, paths = 0.0, [], []
        for _, r in d.iterrows():
            ids.append(r.item_id)
            paths.append(r.path)
            cum += r.dur_s
            if cum >= STREAM_S:
                break
        streams.append(dict(speaker=spk, sex=d.sex.iloc[0], items=ids, paths=paths, dur_s=cum))
    assert len(streams) == 40 and sum(s["sex"] == "f" for s in streams) == 20, "expected 20 F + 20 M"
    # babble: 3 F + 3 M dev-clean talkers (first by speaker id), ~150 s each
    dev = loaders.libri_utts("dev-clean")
    talkers = []
    for sex in ("f", "m"):
        talkers += sorted(dev[dev.sex == sex].speaker.unique())[:3]
    srcs = []
    for t in talkers:
        d = dev[dev.speaker == t].sort_values("order")
        xs, cum = [], 0.0
        for _, r in d.iterrows():
            xs.append(load(r.path))
            cum += r.dur_s
            if cum >= 150:
                break
        x = np.concatenate(xs)[: 150 * 16000].astype(np.float64)
        srcs.append(x / np.sqrt(np.mean(x ** 2)))
    n = min(len(s) for s in srcs)
    bab = np.sum([s[:n] for s in srcs], axis=0)
    bab = bab / np.sqrt(np.mean(bab ** 2))
    bab.astype(np.float32).tofile(os.path.join(S16, "_babble.f32"))
    todo = [(s["speaker"], s["paths"]) for s in streams
            if not os.path.exists(os.path.join(S16, f"{s['speaker']}_k112.f32"))]
    with Pool(a.workers) as p:
        for spk, fl, ce in p.imap_unordered(build_one, todo):
            print(spk, f"WORLD range {fl:.0f}-{ce:.0f} Hz", flush=True)
    for s in streams:
        s.pop("paths")
    json.dump(dict(streams=streams, babble_talkers=talkers, babble_s=n / 16000), open(os.path.join(OUT, "streams.json"), "w"),
              indent=1)
    print("done", len(streams), "streams; babble", talkers)


if __name__ == "__main__":
    main()
