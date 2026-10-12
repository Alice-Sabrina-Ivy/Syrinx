# samplercheck_r5.py — custom voice detector, round 5 (Addendum R5-B part 2):
# checks of train_r5.py's D7 sampler on TRAINING data only (no model):
#   hold sessions: length, voice fraction, episodes, the share of episodes
#   >= 10 s, D7a / D7b shares, steady-bed share, clean share, SNR range, the
#   tail weight; D7 items: label / energy agreement (positive frames carry the
#   item's energy); voice crops: the D7 share.
#
#   <venv>/python samplercheck_r5.py [--n=60]
import collections
import json
import sys

import numpy as np

sys.argv += ["--name=samplercheck", "--p_hold=0.35", "--p_d7crop=0.15", "--vtag=r2", "--p_sess=0.5",
             "--vsrc=" + json.dumps({"librispeech": 0.12, "vctk": 0.06, "coswara_counting": 0.06, "coswara_vowel": 0.18, "mdvr": 0.04, "dcs": 0.09,
                                     "esmuc": 0.09, "csd": 0.08, "svd": 0.14, "singbap": 0.07, "imitations": 0.02, "kids": 0.02, "fsvoice": 0.03})]
import train_r5 as T  # noqa: E402

A = T.A
N = int(A.get("n", "60"))
smp = T.Sampler("train", 777)
st = collections.Counter()
fr, eps10, epsn, lens = [], 0, 0, []
for k in range(N):
    V, N1, Y, W, info, Dm, ins, ep, ts, el = smp.session_hold()
    n = len(V) / T.SR
    lens.append(n)
    fr.append(ins.mean())
    ids = set(ep[ep >= 0].tolist())
    epsn += len(ids)
    eps10 += len(set(ep[(ep >= 0) & el].tolist()))
    st["clean"] += int(info[0] == 1)
    st["tail_w3_frames"] += int(((Y == 1) & el & (ts >= 10)).sum())
    assert np.all(W[(Y == 1) & el & (ts >= 10)] >= 3)
    assert info[1] >= -3 and info[1] <= 25
    assert np.all(ts[ep >= 0] >= 0)
kinds = collections.Counter()
agree = []
for k in range(200):
    x, lab, kind = smp.d7_item()
    kinds[kind] += 1
    j = np.arange(len(lab))
    c = np.round(j * 0.01 * T.SR).astype(int)
    ok = (c >= 160) & (c + 160 < len(x))
    e = np.array([np.sqrt(np.mean(np.square(x[a - 160:a + 160]))) for a in c[ok]])
    lv = lab[ok]
    if (lv == 1).any() and (lv == 0).any():
        agree.append(float(np.median(e[lv == 1]) > 3 * np.median(e[lv == 0]) + 1e-9))
crops = collections.Counter()
for k in range(3000):
    crops[smp.voice(4 * T.SR)[4]] += 1
out = {"hold_sessions": N, "len_s": [round(min(lens), 1), round(float(np.median(lens)), 1), round(max(lens), 1)],
       "voice_fraction": [round(float(np.min(fr)), 3), round(float(np.median(fr)), 3), round(float(np.max(fr)), 3)],
       "episodes_per_session": round(epsn / N, 2), "episodes_ge_10s_share": round(eps10 / max(epsn, 1), 3), "clean_share": round(st["clean"] / N, 3),
       "tail_w3_frames": st["tail_w3_frames"], "d7_items": dict(kinds),
       "items_where_positive_frames_are_louder_than_negative": f"{int(sum(agree))}/{len(agree)}",
       "voice_crop_sources_3000": dict(crops.most_common()), "d7_crop_share": round((crops["d7a"] + crops["d7b"]) / 3000, 3)}
print(json.dumps(out, indent=1))
