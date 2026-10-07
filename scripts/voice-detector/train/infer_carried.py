# infer_carried.py — custom voice detector, round 2 (pre-registration
# Addendum D.4 / D.5): the model's probability files with its state CARRIED
# across streams, as a deployed gate runs through a whole session.
#
# Every listed stream is read exactly as the app got it (lib/streams.py
# load_audio), resampled to 16 kHz by the pitch worker's streaming linear
# resampler (tcommon.resample_stream) and zero-padded to a whole number of
# model hops (< 12.5 ms), so each stream starts on a model frame boundary. The
# streams are shuffled with a fixed seed and concatenated into sessions of at
# least --minutes (a shorter remainder joins the last session).
# The model runs once over each session; each stream's frames are cut out of
# the session run and written in the candidate format (README "Candidate
# interface"), so score.py / opselect.py read them like fresh-state files.
# Frame i of a stream = session frame (offset / HOP) + i, the same samples and
# availability time as in a fresh run, only the state before it differs.
#
#   python infer_carried.py --ckpt=A[,B..]|--onnx=PATH --out=DIR[,DIR..] --streams=ROOT:set,set[@tune];ROOT:set... \
#          --seed=20261007 --minutes=10 [--sessions-json=PATH]
import json
import os
import random
import shutil
import sys
import time

import numpy as np

from infer import OnnxEngine, TorchEngine, cand_json
from tcommon import HOP, OFF, args, resample_stream

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "lib"))
from streams import list_streams, load_audio  # noqa: E402

A = args()


def stream_list(spec):
    out = []
    for part in spec.split(";"):
        root, sets = part.rsplit(":", 1)           # the root may hold a drive letter, the set list never a colon
        for s in sets.split(","):
            name, _, flt = s.partition("@")
            for m in list_streams(root, [name]):
                if flt and m.get("split") != flt:
                    continue
                out.append(m)
    return out


def main():
    metas = stream_list(A["streams"])
    order = sorted(range(len(metas)), key=lambda i: (metas[i]["set"], metas[i]["id"]))
    random.Random(int(A.get("seed", "20261007"))).shuffle(order)
    target = float(A.get("minutes", "10")) * 60.0
    dur = [metas[i]["audio"]["len"] / metas[i]["audio"]["sr"] for i in range(len(metas))]
    sessions, cur, t = [], [], 0.0
    for i in order:
        cur.append(i)
        t += dur[i]
        if t >= target:
            sessions.append(cur)
            cur, t = [], 0.0
    if cur:
        if sessions and t < target:                # every session lasts at least --minutes
            sessions[-1].extend(cur)
        else:
            sessions.append(cur)
    if "onnx" in A:
        engs = [OnnxEngine(A["onnx"], int(A.get("chunk", "8")))]
    else:
        engs = [TorchEngine(c) for c in A["ckpt"].split(",")]
    outs = A["out"].split(",")
    assert len(engs) == len(outs)
    sj = A.get("sessions-json") or os.path.join(outs[0], "sessions.json")
    os.makedirs(os.path.dirname(os.path.abspath(sj)), exist_ok=True)
    with open(sj, "w", encoding="utf8") as f:
        json.dump({"seed": int(A.get("seed", "20261007")), "minutes": target / 60, "streams": A["streams"],
                   "sessions": [[f"{metas[i]['set']}/{metas[i]['id']}" for i in s] for s in sessions]}, f)
    t0 = time.time()
    for k, sess in enumerate(sessions):
        if all(all(os.path.exists(os.path.join(o, metas[i]["set"], metas[i]["id"] + ".f32")) for i in sess) for o in outs) and "force" not in A:
            continue
        parts, offs, nfr, pos = [], [], [], 0
        for i in sess:
            x, sr = load_audio(metas[i])
            x16 = resample_stream(x, sr)
            nfr.append((len(x16) + OFF) // HOP)
            pad = (-len(x16)) % HOP
            parts.append(np.concatenate([x16, np.zeros(pad, np.float32)]) if pad else x16)
            offs.append(pos // HOP)
            pos += len(parts[-1])
        xs = np.concatenate(parts).astype(np.float32)
        for eng, out in zip(engs, outs):
            p = eng(xs)
            for i, o, n in zip(sess, offs, nfr):
                d = os.path.join(out, metas[i]["set"])
                os.makedirs(d, exist_ok=True)
                fp = os.path.join(d, metas[i]["id"] + ".f32")
                seg = p[o:o + n]
                assert len(seg) == n, (metas[i]["id"], len(seg), n)
                seg.astype("<f4").tofile(fp + ".tmp")
                os.replace(fp + ".tmp", fp)
        print(f"session {k + 1}/{len(sessions)}: {len(sess)} streams, {pos / 16000 / 60:.1f} min ({time.time() - t0:.0f} s)", flush=True)
    for eng, out in zip(engs, outs):
        src = A.get("cand-from")
        if src and os.path.exists(os.path.join(src, "candidate.json")):
            shutil.copy(os.path.join(src, "candidate.json"), os.path.join(out, "candidate.json"))
        elif not os.path.exists(os.path.join(out, "candidate.json")):
            cand_json(out, os.path.basename(os.path.normpath(out)), eng.frame_ms, notes="state carried across streams (infer_carried.py)")
    print(f"{len(metas)} streams in {len(sessions)} sessions, {sum(dur) / 3600:.2f} h, {time.time() - t0:.0f} s", flush=True)


if __name__ == "__main__":
    main()
