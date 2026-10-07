# custom_probes.py — custom voice detector, round 2 (pre-registration
# Addendum D.5 item 5): re-run the voice-safety probes of the round-1 review
# (VocalSet techniques incl. lip trills, clean and mixed into machine noise;
# Freesound voice recordings; PSOLA register sweeps; level / EQ conditions)
# with any frozen streaming ONNX model. POST HOC: these probes were built and
# looked at after the round-1 look, so they are no confirmatory data.
#
# Input: the review's probe dumps (the app's production chain over each probe
# WAV, dump.mjs columns + {wav, mix?, proc?, group, gender}) in --chain dirs.
# Each probe WAV (mixed / level-processed as its dump says) goes through the
# pitch worker's linear resampler and the model with its state carried
# (infer.py OnnxEngine); score.py's hop_probs / voice_flags give the vetoes of
# CORRECTLY painted hops per probe group and gender.
#   <venv python> scripts/voice-detector/judge/custom_probes.py --onnx=PATH --cand=DIR --chain=D1,D2 --cache=DIR --out=JSON [--points=0.07/1000,...] [--stagger=T]
import collections
import glob
import json
import os
import sys

import numpy as np

MY = dict((a[2:].split("=", 1) + ["1"])[:2] for a in sys.argv[1:] if a.startswith("--"))
sys.argv = [sys.argv[0]]
REPO = os.getcwd()
for p in ("scripts/voice-detector", "scripts/voice-detector/lib", "scripts/voice-detector/train"):
    sys.path.insert(0, os.path.join(REPO, p))
import score as S  # noqa: E402
from infer import OnnxEngine  # noqa: E402
from tcommon import resample_stream  # noqa: E402


def main():
    import soundfile as sf
    spec = S.load_cand(MY["cand"])
    points = {"frozen": (spec["threshold"], spec["hangover_ms"])}
    for p in [p for p in MY.get("points", "").split(",") if p]:
        t, h = p.split("/")
        points[f"p{t}/{float(h) / 1000:g}s"] = (float(t), float(h))
    if MY.get("stagger"):   # round 2 (Addendum F): the staggered state reset, as deployed
        from stagger import OnnxStagger
        eng = OnnxStagger(MY["onnx"], float(MY["stagger"]), 8)
    else:
        eng = OnnxEngine(MY["onnx"], 8)
    nz_cache = {}
    agg = collections.defaultdict(lambda: collections.Counter())
    rows = []
    for cdir in MY["chain"].split(","):
        tag = os.path.basename(os.path.normpath(cdir))
        for jp in sorted(glob.glob(os.path.join(cdir, "*.json"))):
            meta = json.load(open(jp, encoding="utf8"))
            a = np.fromfile(jp[:-5] + ".f32", dtype="<f4").reshape(len(meta["cols"]), meta["n"])
            col = dict(zip(meta["cols"], a))
            lab, refd = col["lab"].astype(np.int8), col["refd"]
            cp = os.path.join(MY["cache"], tag, meta["id"] + ".f32")
            if os.path.exists(cp):
                P = np.fromfile(cp, dtype="<f4").astype(np.float64)
            else:
                x, sr = sf.read(meta["wav"], dtype="float32", always_2d=True)
                x = x[:, 0]
                if meta.get("mix"):
                    mx = meta["mix"]
                    if mx["noise"] not in nz_cache:
                        nz_cache[mx["noise"]] = sf.read(mx["noise"], dtype="float32", always_2d=True)[0][:, 0]
                    nz = nz_cache[mx["noise"]]
                    x = (x + np.float32(mx["gain"]) * nz[(mx["offset"] + np.arange(len(x))) % len(nz)]).astype(np.float32)
                if meta.get("proc"):
                    x = x.astype(np.float64) * meta["proc"]["gain"]
                    if meta["proc"].get("clip"):
                        x = np.clip(x, -1, 1)
                    x = x.astype(np.float32)
                P = eng(resample_stream(x, sr)).astype(np.float64)
                os.makedirs(os.path.dirname(cp), exist_ok=True)
                P.astype("<f4").tofile(cp)
            m = {"n": meta["n"], "hop_s": meta["hop_s"], "set": "probe", "id": meta["id"]}
            hp = S.hop_probs(spec, m, P)
            r = {"chain": tag, "id": meta["id"], "group": meta["group"], "gender": meta["gender"], "correct": int((lab == 1).sum()),
                 "pmean_voiced": float(np.mean(hp[refd > 0])) if (refd > 0).any() else None}
            for nm, (thr, hang) in points.items():
                v = S.voice_flags(dict(spec, threshold=thr, hangover_ms=hang), m, hp)
                r[nm] = int(((lab == 1) & ~v).sum())
            rows.append(r)
            for key in ((tag, r["group"], r["gender"]), (tag, r["group"], "all"), (tag, "ALL", r["gender"])):
                c = agg[key]
                c["streams"] += 1
                c["correct"] += r["correct"]
                for nm in points:
                    c[nm] += r[nm]
                    c[nm + " >10%"] += int(r["correct"] >= 20 and r[nm] > 0.1 * r["correct"])
    out = {"onnx": MY["onnx"], "points": points,
           "groups": {" | ".join(k): {"streams": c["streams"], "correct": c["correct"],
                                       **{nm: round(100 * c[nm] / max(c["correct"], 1), 2) for nm in points},
                                       **{nm + " >10%": c[nm + " >10%"] for nm in points}} for k, c in sorted(agg.items())},
           "rows": rows}
    with open(MY["out"], "w", encoding="utf8") as f:
        json.dump(out, f, indent=0)
    for k, v in out["groups"].items():
        print(f"{k:60s} {v}")


if __name__ == "__main__":
    main()
