# sesscheck_r6.py — custom voice detector, round 6 (pre-registration §2.2): the review sessions
# re-rendered by sess5_val.py / sess3_val.py against the reviews' saved WAVs, references and
# metadata, bit for bit -> build/vad-train/r6/hval/logs/sesscheck.json. Run with `python -I`.
# the re-rendered review sessions vs the reviews' saved WAVs / refs (bit-exact)
import json, os, sys
import numpy as np, soundfile as sf
SCR = "C:/Users/Michael/AppData/Local/Temp/claude/c--Coding-Projects-Syrinx/12a8f6ba-d49c-4c27-bd93-69314577b2c1/scratchpad"
HV = "C:/Coding Projects/Syrinx-vad/build/vad-train/r6/hval/probe"
out = {}
for tag, old, new in (("sess5", f"{SCR}/vad-train-r5/review-voice/probes-sess5.json", f"{HV}/probes-sess5.json"),
                      ("sess3", f"{SCR}/vad-train-r3/review-voice/probes-sess.json", f"{HV}/probes-sess3.json")):
    O = {x["id"]: x for x in json.load(open(old))}
    N = json.load(open(new))
    bad = []
    for it in N:
        o = O[it["id"]]
        a, sa = sf.read(o["wav"], dtype="float32")
        b, sb = sf.read(it["wav"], dtype="float32")
        ra, rb = json.load(open(o["refPath"])), json.load(open(it["refPath"]))
        ok = sa == sb and np.array_equal(a, b) and ra == rb and o["meta"] == it["meta"] and o["gender"] == it["gender"]
        if not ok:
            bad.append(it["id"])
    out[tag] = {"sessions": len(N), "saved": len(O), "differ": bad}
    print(tag, len(N), "re-rendered;", len(O), "saved;", len(bad), "differ", bad[:5], flush=True)
json.dump(out, open("C:/Coding Projects/Syrinx-vad/build/vad-train/r6/hval/logs/sesscheck.json", "w"), indent=1)
