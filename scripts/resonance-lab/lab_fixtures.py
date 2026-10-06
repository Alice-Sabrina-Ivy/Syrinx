"""Parity fixtures for the in-app resonance lab (src/resonance-lab/).

Writes tests/resonance-lab/fixtures/<name>.wav (16 kHz, 16-bit, <= 5 s LibriSpeech
test-clean excerpts, CC BY 4.0) and <name>.expected.json holding, for the SAME
16-bit-quantised audio:
  f0       the harness F0 track (two-pass Praat, 10 ms grid) every candidate was scored with
  prodf0   the production-detector track (prodf0.mjs: pitch-worker emulation), used to
           check the lab engine's own Boersma-AC path
  le       le_ens_h64 (Python, the scored implementation): 150 ms bin scores
  vtln     vtln_warp v3 (Python + pyworld, the scored implementation): 150 ms bin ln(alpha)
  fv       fv_app101214_gm1234_ridge2_bw800 (fvtl_js.mjs, the scored implementation)
  pnml     pnml_head_scalesex_none0: per-window raw head score (float32 embeddings, NOT the
           bench's float16 cache) + the gated EMA the harness reads, and the deployed
           model's fc7 logit difference from the same inference
The JS ports are checked against these by tests/resonance-lab/parity-test.js.

  build/resonance-lab/venv/Scripts/python scripts/resonance-lab/lab_fixtures.py
"""
import os
import sys
import json
import subprocess
import numpy as np
from scipy.io import wavfile

LAB = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, LAB)
sys.path.insert(0, os.path.join(LAB, "candidates", "pitch-neutral-ml"))
from rlab import audio  # noqa: E402
from rlab.f0 import F0Track  # noqa: E402
from rlab.paths import REPO, TMP  # noqa: E402
from rlab.runner import manifest  # noqa: E402
from rlab.candidate import load_candidate  # noqa: E402

OUT = os.path.join(REPO, "tests", "resonance-lab", "fixtures")
CROP_S = 5.0
SR = 16000


def pick():
    r1 = manifest("r1_test")
    r1 = r1[(r1.dur_s >= 5.0) & (r1.voiced_s >= 2.5)]
    w = r1[r1.sex == "f"].sort_values("f0_median").iloc[-1]       # highest-F0 woman utterance
    m = r1[r1.sex == "m"].sort_values("f0_median").iloc[0]        # lowest-F0 man utterance
    mt = manifest("manip_test")
    mm = mt[(mt.sex == "m") & (mt.engine == "praat") & (mt.cond == "hi8_f1.05")].sort_values("item_id").iloc[0]
    return [("ls_woman_high", w), ("ls_man_low", m), ("ls_man_hi8_f105", mm)]


def jsonable(t, s):
    return {"t": [round(float(v), 4) for v in t],
            "s": [None if not np.isfinite(v) else float(v) for v in s]}


def main():
    os.makedirs(OUT, exist_ok=True)
    work = os.path.join(TMP, "lab_fixtures")
    os.makedirs(work, exist_ok=True)
    le = load_candidate(os.path.relpath(os.path.join(LAB, "candidates", "learned-envelope", "le_ens_h64.py")))
    le.setup()
    vt = load_candidate(os.path.relpath(os.path.join(LAB, "candidates", "vtln_warp.py")))
    vt.setup()
    import pnml_core as C
    emb = C.EcapaEmb()
    h = json.load(open(os.path.join(os.path.dirname(C.CACHE), "head_raw_scalesex.json")))
    hw = np.array(h["w"]) / np.array(h["sd"])
    hb = h["b"] - float(np.dot(np.array(h["mu"]), hw))
    fx = []
    for name, row in pick():
        x = audio.load(row.path, row.sr_src)[: int(CROP_S * SR)]
        q = np.round(np.clip(x, -1, 32767 / 32768) * 32768).astype(np.int16)
        wavfile.write(os.path.join(OUT, name + ".wav"), SR, q)
        x = (q.astype(np.float32) / 32768.0)
        tr = F0Track.load(row.f0_path)
        keep = tr.t < len(x) / SR
        tr = F0Track(tr.t[keep], tr.f0[keep])
        ap = os.path.join(work, name + ".f32")
        fp = os.path.join(work, name + ".f0.f32")
        x.astype("<f4").tofile(ap)
        tr.f0.astype("<f4").tofile(fp)
        fx.append(dict(name=name, row=row, x=x, tr=tr, ap=ap, fp=fp))

    # fv (scored implementation is the JS file) + production-detector tracks, via Node
    fvjobs = [dict(key=f["name"], audio=f["ap"], f0=f["fp"], dur=len(f["x"]) / SR) for f in fx]
    jp = os.path.join(work, "fv_jobs.json")
    json.dump(fvjobs, open(jp, "w"))
    op = os.path.join(work, "fv_out.jsonl")
    fvdir = os.path.join(LAB, "candidates", "formant-vtl")
    subprocess.run(["node", os.path.join(fvdir, "fvtl_js.mjs"), jp, op,
                    os.path.join(fvdir, "models", "fv_app101214_gm1234_ridge2_bw800.json")], check=True)
    fvres = {}
    for line in open(op):
        d = json.loads(line)
        if "key" in d:
            fvres[d["key"]] = d
    pjobs = [dict(audio=f["ap"], out=f["ap"] + ".prodf0", n10=len(f["tr"].t)) for f in fx]
    pj = os.path.join(work, "prodf0_jobs.json")
    json.dump(pjobs, open(pj, "w"))
    subprocess.run(["node", os.path.join(LAB, "candidates", "pitch-neutral-ml", "prodf0.mjs"), pj], check=True)

    for f in fx:
        x, tr = f["x"], f["tr"]
        t1, s1 = le.score(x, SR, tr)
        t2, s2 = vt.score(x, SR, tr)
        tw, E = C.window_embs(emb, x, tr)
        raw = np.array([float(e.astype(np.float64) @ hw + hb) if np.all(np.isfinite(e)) else np.nan for e in E])
        # deployed fc7 output from the same inference (logit female - male)
        b2 = []
        for i, te in enumerate(tw):
            if not np.isfinite(raw[i]):
                b2.append(None)
                continue
            end = int(round(te * SR)) + int(0.75 * SR)
            yp = np.concatenate([np.zeros(int(0.75 * SR), np.float32), x, np.zeros(C.PAD_TAIL, np.float32)])
            w = yp[max(0, end - 12000):end]
            lg, _ = emb.sess.run(None, {emb.inp: w[None, :].astype(np.float32)})
            b2.append(float(lg[0][1] - lg[0][0]))
        ema = C.ema_gated(raw)
        prod = np.fromfile(f["ap"] + ".prodf0", "<f4")
        d = dict(name=f["name"], item_id=str(f["row"].item_id), speaker=str(f["row"].speaker),
                 source="LibriSpeech test-clean (CC BY 4.0), 16-bit, 16 kHz, first 5 s"
                        + ("; Praat Change-gender +8 st, formant x1.05 (benchmark manip_test)" if "hi8" in f["name"] else ""),
                 sr=SR, n=len(x),
                 f0=[round(float(v), 3) for v in tr.f0], prodf0=[round(float(v), 4) for v in prod],
                 le=jsonable(t1, s1), vtln=jsonable(t2, s2),
                 fv={"t": fvres[f["name"]]["t"], "s": fvres[f["name"]]["s"]},
                 pnml={"t": [round(float(v), 4) for v in tw],
                       "raw": [None if not np.isfinite(v) else float(v) for v in raw],
                       "ema": [None if not np.isfinite(v) else float(v) for v in ema],
                       "b2_logit": b2})
        json.dump(d, open(os.path.join(OUT, f["name"] + ".expected.json"), "w"))
        print(f["name"], f["row"].item_id, "le", np.isfinite(s1).sum(), "vtln", np.isfinite(s2).sum(),
              "pnml", np.isfinite(raw).sum())


if __name__ == "__main__":
    main()
