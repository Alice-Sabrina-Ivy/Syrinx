# Praat AC (default, 10 ms, 75-600) + Praat CC on the corpus dump, for
# the reference-noise comparison. -> build/prec/er/praat_<corpus>.npz
import json, sys
import numpy as np
import parselmouth
DATA = "build/pb/data"
idx = json.load(open(f"{DATA}/index.json"))
for cp in sys.argv[1].split(","):
    out = {}
    for tr in idx:
        if tr["corpus"] != cp: continue
        x = np.fromfile(f"{DATA}/{cp}/{tr['trackId']}.f32", dtype=np.float32).astype(float)
        snd = parselmouth.Sound(x, sampling_frequency=tr["sr"])
        for m in ("ac", "cc"):
            p = snd.to_pitch_ac(time_step=0.01, pitch_floor=75, pitch_ceiling=600) if m == "ac" else snd.to_pitch_cc(time_step=0.01, pitch_floor=75, pitch_ceiling=600)
            out[f"{tr['trackId']}|{m}|t"] = p.xs()
            out[f"{tr['trackId']}|{m}|f"] = p.selected_array["frequency"]
    np.savez(f"build/prec/er/praat_{cp}.npz", **out)
    print("done", cp)
