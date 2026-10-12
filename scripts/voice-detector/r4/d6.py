# d6.py — custom voice detector, round 4 (pre-registration
# measurements/voice-detector-round4-preregistration-2026-10-11.md §3.2 D6):
# paint-aware hard negatives, TRAINING data only (round 1 §1.2 allows
# hard-negative mining on training data). Never reads the sealed set or the
# private session recordings.
#
#   specs   the `stat` pool (stat.json, D2) and the fsr4 training clips (D1 list),
#           as packed (16 kHz files), in ascending FNV-1a of the record id, capped
#           at 40 h -> build/vad-train/r4/d6/streams/tneg4.json (valdump.mjs
#           format, ref none). The current app's dumps then come from
#           ROOT=build/vad-train/r4/d6 bash scripts/voice-detector/r3/run-dumps.sh tneg4:2
#           (train/valdump.mjs, src dd92037, <= 2 processes)
#   masks   per clip, the model frames (12.5 ms grid, tcommon.n_frames) the app
#           paints falsely -> build/vad-train/r4/d6/masks.npz. Alignment
#           (opselect_r3.py's td rule): dump hop k (tk = (k + 1) * hop) is
#           attributed to td_k = tk - 40 ms - L * hop - 30 ms; a FALSE painted hop
#           (paint > 0 and lab == 2) marks every model frame i whose end time
#           (i + 1) * 12.5 ms lies in [td_k, td_k + hop). The training loss weight
#           of a marked frame is 3 wherever that clip appears unmixed (noise-only
#           crops, the noise-only stretches of sessions); mixed frames keep round
#           3's weights (applied by the round-4 training code).
#
#   python scripts/voice-detector/r4/d6.py specs|masks
import json
import os
import sys

import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, "..", "r3"))
sys.path.insert(0, os.path.join(HERE, "..", "train"))
from c3 import DATA, ROOT, fnv1a, guard_not_conf, load_manifest, log, write_json  # noqa: E402

R4 = os.path.join(ROOT, "r4")
D6 = os.path.join(R4, "d6")
CAP_H = 40.0


def specs():
    import soundfile as sf
    st = json.load(open(os.path.join(R4, "stat.json"), encoding="utf8"))
    J1 = json.load(open(os.path.join(R4, "d1.json"), encoding="utf8"))
    man = load_manifest()
    f4 = {}
    p4 = os.path.join(R4, "data", "manifest.fsr4.jsonl")
    for line in (open(p4, encoding="utf8") if os.path.exists(p4) else []):
        if line.strip():
            r = json.loads(line)
            f4[r["id"]] = r
    train = set(J1["train_ids"])
    ids = {r["id"] for r in st["clips"] if r.get("steady") and r["id"] in train}
    ids |= {i for i in train if i.startswith("fsr4__")}
    out, sec = [], 0.0
    for i in sorted(ids, key=lambda i: (fnv1a(i), i)):
        r = man.get(i) or f4[i]
        p = guard_not_conf(os.path.abspath(os.path.join(os.path.join(R4, "data") if i.startswith("fsr4__") else DATA, r["path"])))
        n = sf.info(p).frames
        if sec + n / 16000 > CAP_H * 3600:
            break
        sec += n / 16000
        out.append({"id": i, "gender": "na", "audio": {"path": p, "fmt": "wav", "sr": 16000, "start": 0, "len": int(n)}, "ref": {"kind": "none"},
                    "holds": [], "meta": {"source": r["source"], "set": "tneg4"}})
    write_json(os.path.join(D6, "streams", "tneg4.json"), out)
    log(f"D6 specs: {len(out)} of {len(ids)} clips (stat pool + fsr4 train), {sec / 3600:.2f} h (cap {CAP_H} h)")


def masks():
    from tcommon import HOP_MS, n_frames
    sp = json.load(open(os.path.join(D6, "streams", "tneg4.json"), encoding="utf8"))
    M, tot, fal = {}, 0, 0
    for it in sp:
        jp = os.path.join(D6, "dumps", "tneg4", it["id"] + ".json")
        m = json.load(open(jp, encoding="utf8"))
        a = np.fromfile(jp[:-5] + ".f32", dtype="<f4").reshape(len(m["cols"]), m["n"])
        c = {k: a[j] for j, k in enumerate(m["cols"])}
        hop = m["hop_s"]
        tk = (np.arange(m["n"]) + 1) * hop
        td = tk - 0.040 - m["L"] * hop - 0.030
        bad = (c["paint"] > 0) & (c["lab"] == 2)
        nf = n_frames(it["audio"]["len"])
        te = (np.arange(nf) + 1) * HOP_MS / 1000.0
        mk = np.zeros(nf, bool)
        for t0 in td[bad]:
            mk |= (te >= t0) & (te < t0 + hop)
        M[it["id"]] = np.nonzero(mk)[0].astype(np.int32)
        tot += m["n"]
        fal += int(bad.sum())
    np.savez_compressed(os.path.join(D6, "masks.npz"), **M)
    J = {"clips": len(sp), "hops": tot, "false_painted_hops": fal, "share": round(fal / max(tot, 1), 4),
         "clips_with_false_paint": sum(1 for v in M.values() if len(v)), "marked_model_frames": int(sum(len(v) for v in M.values()))}
    write_json(os.path.join(D6, "masks.json"), J, indent=1)
    log("D6 masks:", J)


if __name__ == "__main__":
    {"specs": specs, "masks": masks}[sys.argv[1]]()
