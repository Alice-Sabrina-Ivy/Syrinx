"""Run the deployed perceived-voice classifier (voice-gender-classifier-onnx-q8-v2, the ONNX
file Transformers.js loads; onnxruntime CPU, parity 6e-8) on production windows.

  python scripts/perceived-voice-gate/score.py <set> <i/n> [all]

Scores the 150 ms ticks the RETIRED gate scored (chain.mjs codes 1-3) — a superset of what
the current gate scores (replay.mjs fails if a window it needs is missing); `all` scores every
tick. Reads build/perceived-voice-gate/runs/vad_<set>.*.jsonl, appends
build/perceived-voice-gate/runs/sc_<set>.<i>.jsonl (resumable). ONNX path: $SYRINX_GENDER_ONNX,
default the Transformers.js cache under node_modules (present once the app has run the model
in Node, e.g. tests/ml/perceived-voice-hillenbrand-test.js).
"""
import sys, os, json, time
import numpy as np

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from common import SETS, RUNS, OLD_SCORED, read_prefixed, read_jsonl, f32_read, window_logits  # noqa: E402

set_, shard = sys.argv[1], sys.argv[2]
ALL = len(sys.argv) > 3 and sys.argv[3] == "all"
i, n = map(int, shard.split("/"))
vad = read_prefixed(RUNS, f"vad_{set_}.")
jobs = [j for k, j in enumerate(json.load(open(f"{SETS}/jobs_{set_}.json"))) if k % n == i]
outp = f"{RUNS}/sc_{set_}.{i}.jsonl"
done = set(read_jsonl(outp).keys())
t0 = time.time(); cnt = 0
with open(outp, "a") as fo:
    for j in jobs:
        if j["id"] in done or j["id"] not in vad:
            continue
        v = vad[j["id"]]
        ks = np.array([t[0] for t in v["ticks"]], int); g = np.array([t[1] for t in v["ticks"]], int)
        x = f32_read(j["f32"])
        sel = np.ones(len(ks), bool) if ALL else np.isin(g, OLD_SCORED)
        lg = np.full(len(ks), np.nan)
        if sel.any():
            lg[sel] = window_logits(x, ks[sel])
        cnt += int(sel.sum())
        fo.write(json.dumps(dict(id=j["id"], ks=ks.tolist(), g=g.tolist(),
                                 lg=[None if np.isnan(a) else round(float(a), 5) for a in lg])) + "\n")
        fo.flush()
print(f"{set_} shard {shard}: {cnt} inferences in {time.time() - t0:.0f} s")
