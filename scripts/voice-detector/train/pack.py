# pack.py — custom voice detector (2026-10-06): pack the training corpus of
# the data step (manifest, 16 kHz PCM16) into int16 memory-mapped files for
# fast random crops, with per-file label tracks, plus the synthetic
# interferer and room-impulse-response banks (synth.py; training seeds
# [0, 1e9), validation seeds [1e9, 1e9 + 2000)).
#
#   <TRAIN>/voice_<split>.i16 + voice_<split>.npz    offsets, lengths, source,
#        gender, group, recording kind, Praat t0, label tracks (tcommon.voice_labels)
#   <TRAIN>/nonvoice_<split>.i16 + nonvoice_<split>.npz   offsets, lengths,
#        source, machine / room flag, group
#   <TRAIN>/synth_<split>.i16 + .npz    the synthetic interferer bank
#   <TRAIN>/rir_<split>.npy             the RIR bank (rows zero-padded to 1 s)
#
#   python scripts/voice-detector/train/pack.py [--what=voice,nonvoice,synth,rir] [--splits=train,val] [--tag=r2]
#
# --tag=r2 (round 2, pre-registration Addendum D): the voice packs include the
# round-2 sources and are written as voice_<split>_r2.* (round 1's packs are
# left as they were); the non-voice, synthetic and RIR banks are shared.
import json
import os

import numpy as np
import soundfile as sf

import synth
from tcommon import DATA, SR, TRAIN, args, load_manifest, praat_track, voice_labels

A = args()
WHAT = A.get("what", "voice,nonvoice,synth,rir").split(",")
SPLITS = A.get("splits", "train,val").split(",")
TAG = A.get("tag", "")
VSRC = ["librispeech", "vctk", "coswara", "mdvr", "dcs", "esmuc", "csd", "cantoria"]
R2SRC = ["svd", "singbap", "imitations", "kids", "fsvoice"]
if TAG == "r2":
    VSRC = VSRC + R2SRC      # appended: round-1 source indices are unchanged
NSRC = ["fsd50k", "fstrain", "synthetic"]
SYN = {"train": (0, 4000), "val": (1_000_000_000 + 100, 300)}
RIRS = {"train": (0, 3000), "val": (1_000_000_000 + 1000, 300)}


def kind_of(r):
    if r["source"] == "coswara":
        return "vowel" if r["recording"].startswith("vowel") else "counting"
    if r["source"] in ("dcs", "esmuc", "csd", "cantoria", "singbap", "fsvoice"):
        return "singing"
    if r["source"] == "svd":
        return "vowel"
    return "speech"


KINDS = ["speech", "counting", "vowel", "singing"]


def pack_voice(man, split):
    recs = sorted([r for r in man.values() if not r.get("drop") and r["kind"] == "voice" and r["split"] == split and r["source"] in VSRC],
                  key=lambda r: r["id"])
    sfx = f"_{TAG}" if TAG else ""
    path = os.path.join(TRAIN, f"voice_{split}{sfx}.i16")
    groups = sorted({r["group"] for r in recs})
    gi = {g: i for i, g in enumerate(groups)}
    off, ln, src, gen, grp, knd, t0s, loff, llen = [], [], [], [], [], [], [], [], []
    labs = []
    pos = lpos = 0
    with open(path + ".tmp", "wb") as f:
        for i, r in enumerate(recs):
            x, sr = sf.read(os.path.join(DATA, r["path"]), dtype="int16", always_2d=True)
            assert sr == SR
            x = x[:, 0]
            t0, hop, f0 = praat_track(r)
            assert abs(hop - 0.01) < 1e-9
            lab = voice_labels(x.astype(np.float32) / 32768, t0, hop, f0)
            f.write(x.tobytes())
            off.append(pos); ln.append(len(x)); pos += len(x)
            src.append(VSRC.index(r["source"])); gen.append({"f": 0, "m": 1}.get(r.get("gender"), 2)); grp.append(gi[r["group"]])
            knd.append(KINDS.index(kind_of(r))); t0s.append(t0)
            loff.append(lpos); llen.append(len(lab)); lpos += len(lab); labs.append(lab)
            if (i + 1) % 2000 == 0:
                print(f"voice {split}: {i + 1}/{len(recs)}", flush=True)
    os.replace(path + ".tmp", path)
    np.savez(os.path.join(TRAIN, f"voice_{split}{sfx}.npz"), off=np.array(off, np.int64), len=np.array(ln, np.int64), src=np.array(src, np.int8),
             gender=np.array(gen, np.int8), group=np.array(grp, np.int32), kind=np.array(knd, np.int8), t0=np.array(t0s, np.float64),
             loff=np.array(loff, np.int64), llen=np.array(llen, np.int64), lab=np.concatenate(labs) if labs else np.zeros(0, np.uint8))
    with open(os.path.join(TRAIN, f"voice_{split}{sfx}.json"), "w", encoding="utf8") as f:
        json.dump({"ids": [r["id"] for r in recs], "groups": groups, "sources": VSRC, "kinds": KINDS}, f)
    L = np.concatenate(labs)
    print(f"voice {split}: {len(recs)} files, {pos / SR / 3600:.2f} h, label frames pos {np.mean(L == 1) * 100:.1f} % / neg {np.mean(L == 0) * 100:.1f} % / margin {np.mean(L == 2) * 100:.1f} %", flush=True)


def pack_nonvoice(man, split):
    recs = sorted([r for r in man.values() if not r.get("drop") and r["kind"] == "nonvoice" and r["split"] == split], key=lambda r: r["id"])
    path = os.path.join(TRAIN, f"nonvoice_{split}.i16")
    groups = sorted({r["group"] for r in recs})
    gi = {g: i for i, g in enumerate(groups)}
    off, ln, src, mach, grp = [], [], [], [], []
    pos = 0
    with open(path + ".tmp", "wb") as f:
        for i, r in enumerate(recs):
            x, sr = sf.read(os.path.join(DATA, r["path"]), dtype="int16", always_2d=True)
            assert sr == SR
            x = x[:, 0]
            f.write(x.tobytes())
            off.append(pos); ln.append(len(x)); pos += len(x)
            src.append(NSRC.index(r["source"])); mach.append(bool(r.get("machine_room"))); grp.append(gi[r["group"]])
            if (i + 1) % 4000 == 0:
                print(f"nonvoice {split}: {i + 1}/{len(recs)}", flush=True)
    os.replace(path + ".tmp", path)
    np.savez(os.path.join(TRAIN, f"nonvoice_{split}.npz"), off=np.array(off, np.int64), len=np.array(ln, np.int64), src=np.array(src, np.int8),
             machine=np.array(mach, bool), group=np.array(grp, np.int32))
    with open(os.path.join(TRAIN, f"nonvoice_{split}.json"), "w", encoding="utf8") as f:
        json.dump({"ids": [r["id"] for r in recs], "groups": groups, "sources": NSRC}, f)
    print(f"nonvoice {split}: {len(recs)} files, {pos / SR / 3600:.2f} h, machine/room {np.mean(mach) * 100:.1f} %", flush=True)


def pack_synth(split):
    s0, n = SYN[split]
    path = os.path.join(TRAIN, f"synth_{split}.i16")
    off, ln, fam, tonal = [], [], [], []
    pos = 0
    with open(path + ".tmp", "wb") as f:
        for i in range(n):
            seed = s0 + i
            rng = np.random.default_rng(seed + 7_777_777)
            dur = float(rng.uniform(8, 20))
            x, m = synth.gen(seed, int(dur * SR))
            q = np.clip(np.round(x * 0.1 * 32767), -32767, 32767).astype(np.int16)
            f.write(q.tobytes())
            off.append(pos); ln.append(len(q)); pos += len(q)
            fam.append(synth.FAMILIES.index(m["family"])); tonal.append(m["family"] in synth.TONAL or m["family"] == "combo")
            if (i + 1) % 500 == 0:
                print(f"synth {split}: {i + 1}/{n}", flush=True)
    os.replace(path + ".tmp", path)
    np.savez(os.path.join(TRAIN, f"synth_{split}.npz"), off=np.array(off, np.int64), len=np.array(ln, np.int64), family=np.array(fam, np.int8),
             tonal=np.array(tonal, bool), seed0=s0)
    print(f"synth {split}: {n} clips, {pos / SR / 3600:.2f} h", flush=True)


def pack_rir(split):
    s0, n = RIRS[split]
    H = np.zeros((n, SR), np.float32)
    meta = []
    for i in range(n):
        h, m = synth.rir(s0 + i)
        H[i, :len(h)] = h[:SR]
        meta.append(m["rt60"])
    np.save(os.path.join(TRAIN, f"rir_{split}.npy"), H)
    np.save(os.path.join(TRAIN, f"rir_{split}_rt60.npy"), np.array(meta, np.float32))
    print(f"rir {split}: {n}, rt60 median {np.median(meta):.2f} s", flush=True)


def main():
    os.makedirs(TRAIN, exist_ok=True)
    man = load_manifest() if ("voice" in WHAT or "nonvoice" in WHAT) else None
    for split in SPLITS:
        if "rir" in WHAT:
            pack_rir(split)
        if "voice" in WHAT:
            pack_voice(man, split)
        if "nonvoice" in WHAT:
            pack_nonvoice(man, split)
        if "synth" in WHAT:
            pack_synth(split)


if __name__ == "__main__":
    main()
