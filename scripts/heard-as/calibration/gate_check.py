"""Lab-gate (fit) vs live utterance-gate meter pooling: effect on meter_logit, eta and the shown share."""
import json, numpy as np, pandas as pd
from data import *
FIT = json.load(open("fit.json"))
OUT = []
say = lambda *a: (print(*a), OUT.append(" ".join(str(x) for x in a)))
pal = C.PAL.set_index("key")
for lab, f, lnf0 in [("Palette (240 items, ~2 s voiced)", "gate_pov.jsonl", pal.lnf0),
                     ("LibriSpeech r1 (200 utterances)", "gate_r1.jsonl", None),
                     ("natural/ set (LibriTTS-R, Neuenswander, TTS; 268 items)", "gate_nat.jsonl", None)]:
    g = pd.DataFrame([json.loads(l) for l in open(f)]).set_index("key")
    g = g[g.live.notna() & g.lab.notna()]
    d = g.live - g.lab
    say(f"{lab}: items with >=1 live-scored window {len(g)}; windows per item lab {g.labN.median():.0f} vs live {g.liveN.median():.0f} (median)")
    say(f"   meter_logit live - lab: mean {d.mean():+.3f}, SD {d.std():.3f}, |d| q90 {np.percentile(np.abs(d), 90):.3f}"
        f"  -> eta change = b * d: mean {FIT['b_meter'] * d.mean():+.3f}, q90 |.| {abs(FIT['b_meter']) * np.percentile(np.abs(d), 90):.3f} logit")
    if lnf0 is not None:
        l = lnf0.loc[g.index]
        e0 = FIT["a"] + FIT["b_meter"] * g.lab + FIT["c_lnf0"] * l
        e1 = FIT["a"] + FIT["b_meter"] * g.live + FIT["c_lnf0"] * l
        say(f"   shown share change: mean {np.mean(sig(e1) - sig(e0)):+.2f} points, max |.| {np.max(np.abs(sig(e1) - sig(e0))):.2f}")
        y = pal.loc[g.index, "half"]
        say(f"   in-sample MAE vs Palette listeners (offset 0): lab-gate meter {np.mean(np.abs(sig(e0) - y)):.2f}, live-gate meter {np.mean(np.abs(sig(e1) - y)):.2f}")
open("gate_check.txt", "w", encoding="utf-8").write("\n".join(OUT))
