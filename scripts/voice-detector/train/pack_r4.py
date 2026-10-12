# pack_r4.py — custom voice detector, round 4 (pre-registration
# measurements/voice-detector-round4-preregistration-2026-10-11.md §3.2 D3;
# Addendum R4-B part 2): pack the fsr4 TRAINING clips (r4/data/manifest.fsr4.jsonl,
# split train, and in the D1 training list r4/d1.json) into an int16 memmap bank
# in pack.py's non-voice format, so train_r4.py can crop them like the other
# negatives. The rounds 1-3 packs are not touched; the val clips of fsr4 are not
# packed (they are a reported diagnostic row only).
#
#   <TRAIN>/nonvoice_fsr4_train.i16 + .npz (off, len, src, machine, group) + .json (ids, groups, sources)
#
#   python scripts/voice-detector/train/pack_r4.py
import json
import os

import numpy as np
import soundfile as sf

from tcommon import ROOT, SR, TRAIN, sealed_guard

R4 = os.path.join(ROOT, "r4")


def main():
    d1 = set(json.load(open(os.path.join(R4, "d1.json"), encoding="utf8"))["train_ids"])
    recs = [json.loads(line) for line in open(os.path.join(R4, "data", "manifest.fsr4.jsonl"), encoding="utf8") if line.strip()]
    recs = sorted([r for r in recs if not r.get("drop") and r["split"] == "train" and r["id"] in d1], key=lambda r: r["id"])
    groups = sorted({r["group"] for r in recs})
    gi = {g: i for i, g in enumerate(groups)}
    path = os.path.join(TRAIN, "nonvoice_fsr4_train.i16")
    off, ln, mach, grp = [], [], [], []
    pos = 0
    with open(path + ".tmp", "wb") as f:
        for r in recs:
            x, sr = sf.read(sealed_guard(os.path.join(R4, "data", r["path"])), dtype="int16", always_2d=True)
            assert sr == SR
            x = x[:, 0]
            f.write(x.tobytes())
            off.append(pos); ln.append(len(x)); pos += len(x)
            mach.append(bool(r.get("machine_room"))); grp.append(gi[r["group"]])
    os.replace(path + ".tmp", path)
    np.savez(os.path.join(TRAIN, "nonvoice_fsr4_train.npz"), off=np.array(off, np.int64), len=np.array(ln, np.int64),
             src=np.zeros(len(recs), np.int8), machine=np.array(mach, bool), group=np.array(grp, np.int32))
    with open(os.path.join(TRAIN, "nonvoice_fsr4_train.json"), "w", encoding="utf8") as f:
        json.dump({"ids": [r["id"] for r in recs], "groups": groups, "sources": ["fsr4"]}, f)
    print(f"fsr4 train: {len(recs)} clips, {pos / SR / 3600:.2f} h, {len(groups)} uploaders", flush=True)


if __name__ == "__main__":
    main()
