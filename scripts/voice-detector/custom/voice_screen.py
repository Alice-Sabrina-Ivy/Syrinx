# voice_screen.py — custom voice detector, round 2 data step (pre-registration
# Addendum E): an automatic "is this mostly a human voice?" screen for the
# `fsvoice` positives. The Freesound searches of Addendum D returned many
# recordings that are not voice at all (fridge and airport hums, singing
# bowls, waves, rolling bottles), which the reference tracker would label as
# voiced and training would then teach as voice. The screen only REMOVES
# clips; it never adds or relabels.
#
# Rule (fixed before it was run): YAMNet (the benchmark's ONNX port,
# scripts/voice-detector/events, Apache-2.0) over each prepared 16 kHz clip,
# 0.96 s patches every 0.48 s; a clip is kept only if, in at least half of its
# patches, the top-scoring of YAMNet's 521 classes is one of the human-vocal
# classes (events/yamnet_lib.py VOCAL: speech, shouts, laughter, crying,
# singing, choir, chant, child singing, humming, babble, a capella, ...).
# Dropped clips get a manifest record with the reason and the screen's figures.
#
#   python scripts/voice-detector/custom/voice_screen.py --sources=fsvoice --part=r2screen [--model=build/vad/events/model/yamnet_core_fp32.onnx]
import os
import sys

import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, "..", "events"))
from common import DATA, REPO, Manifest, args, load_manifest  # noqa: E402
from yamnet_lib import VOCAL, log_mel, n_frames, patch_iter  # noqa: E402

A = args()
HOPF, T, MIN_SHARE = 48, 96, 0.5


def main():
    import onnxruntime as ort
    import soundfile as sf
    model = A.get("model", os.path.join(REPO, "build", "vad", "events", "model", "yamnet_core_fp32.onnx"))
    mel = np.load(os.path.join(os.path.dirname(model), "mel_257x64.npy"))
    so = ort.SessionOptions()
    so.intra_op_num_threads = int(A.get("threads", "2"))
    sess = ort.InferenceSession(model, so, providers=["CPUExecutionProvider"])
    names = [line.split(",", 2)[2].strip().strip('"') for line in open(os.path.join(os.path.dirname(model), "yamnet_class_map.csv"), encoding="utf8").read().splitlines()[1:]]
    vocal = set(VOCAL)
    man = load_manifest()
    out = Manifest(os.path.join(DATA, f"manifest.{A.get('part', 'r2screen')}.jsonl"))
    srcs = A.get("sources", "fsvoice").split(",")
    recs = sorted([r for r in man.values() if r["source"] in srcs and r["kind"] == "voice" and not r.get("drop")], key=lambda r: r["id"])
    kept = dropped = 0
    for r in recs:
        x, sr = sf.read(os.path.join(DATA, r["path"]), dtype="float32", always_2d=True)
        lm = log_mel(x[:, 0], mel)
        nf = n_frames(len(lm), HOPF)
        tops = []
        for b in patch_iter(lm, HOPF, T):
            sc = sess.run(None, {"patches": b})[0]
            tops += list(sc.argmax(axis=1))
        tops = np.array(tops[:nf])
        # patches that start inside the 0.95 s silence history are left out
        tops = tops[2:] if len(tops) > 3 else tops
        share = float(np.isin(tops, list(vocal)).mean()) if len(tops) else 0.0
        top_names = [names[i] for i, _ in sorted(zip(*np.unique(tops, return_counts=True)), key=lambda t: -t[1])[:3]] if len(tops) else []
        if share < MIN_SHARE:
            out.add(dict(r, drop=f"voice screen: top YAMNet class human-vocal in {share:.0%} of patches (< {MIN_SHARE:.0%}); most frequent tops {top_names}",
                         voice_screen={"share": round(share, 3), "tops": top_names}))
            dropped += 1
        else:
            out.add(dict(r, voice_screen={"share": round(share, 3), "tops": top_names}))
            kept += 1
    print(f"voice screen ({','.join(srcs)}): {kept} kept, {dropped} dropped")


if __name__ == "__main__":
    main()
