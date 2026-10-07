# custom_fastscore.py — custom voice detector, judge step (2026-10-07):
# score.py's OWN functions (hop_probs, voice_flags, onsets, report) with the
# per-stream dump columns and per-hop probabilities cached once, so any
# (threshold, hangover) point of a candidate is scored in about a second.
# Post-hoc analysis only (custom_tradeoff.py); the verdict is score.py itself.
# custom_tradeoff.py checks that this module reproduces score.py's JSON exactly
# at the candidate's own point. Imported from the repo root.
import os
import sys

import numpy as np

REPO = os.getcwd()
sys.path.insert(0, os.path.join(REPO, "scripts", "voice-detector"))
sys.argv = [sys.argv[0], "--worst=0"] + [a for a in sys.argv[1:] if a.startswith("--root")]
import score as S  # noqa: E402
from streams import list_streams, load_dump  # noqa: E402


class Cache:
    def __init__(self, cand):
        self.spec = S.load_cand(cand)
        self.items = []
        for meta in list_streams(S.ROOT):
            cols = load_dump(S.ROOT, meta)
            fp = os.path.join(self.spec["_dir"], meta["set"], meta["id"] + ".f32")
            P = np.fromfile(fp, dtype="<f4").astype(np.float64)
            p = S.hop_probs(self.spec, meta, P)
            self.items.append((meta, {k: cols[k] for k in ("paint", "lab", "inten", "held", "seg")}, p))

    def rows(self, thr=None, hang=None, veto_fn=None):
        spec = dict(self.spec)
        if thr is not None:
            spec["threshold"] = thr
        if hang is not None:
            spec["hangover_ms"] = hang
        rows = []
        for meta, cols, p in self.items:
            paint, lab = cols["paint"], cols["lab"].astype(np.int8)
            n = meta["n"]
            v = S.voice_flags(spec, meta, p)
            veto = (paint > 0) & ~v
            if veto_fn is not None:
                veto = veto_fn(meta, veto)
            r = {"set": meta["set"], "id": meta["id"], "gender": S.gnorm(meta.get("gender")), "n": n,
                 "snr": meta.get("snr_db"), "split": meta.get("split"), "label": meta.get("label"), "cls": meta.get("cls"),
                 "source": meta.get("source"), "noise_class": meta.get("noise_class"), "painted": int((paint > 0).sum()),
                 "nd": max(int(np.isfinite(cols["inten"]).sum()), 1), "hop_ms": meta["hop_s"] * 1000,
                 "_meta": meta, "_veto": veto, "_lab": lab}
            for nm, code in (("correct", 1), ("false", 2), ("wrong", 3), ("edge", 4)):
                m = lab == code
                r[nm] = int(m.sum())
                r[nm + "_v"] = int((m & veto).sum())
            fin = (lab == 2) & np.isfinite(cols["inten"])
            r["false_fin"], r["false_fin_v"] = int(fin.sum()), int((fin & veto).sum())
            hc = (lab == 1) & (cols["held"] > 0)
            r["held_correct"], r["held_correct_v"] = int(hc.sum()), int((hc & veto).sum())
            seg = cols["seg"].astype(np.int8)
            for nm, code in (("lead", 1), ("prog", 2), ("tail", 3)):
                m = (lab == 2) & (seg == code)
                r[nm + "_false"], r[nm + "_false_v"] = int(m.sum()), int((m & veto).sum())
            ons = []
            for s, e in S.onsets(paint, lab):
                ok = np.nonzero((paint[s:e + 1] > 0) & ~veto[s:e + 1])[0]
                ons.append((int(ok[0]) if len(ok) else e - s + 1, not len(ok)))
            r["onsets"] = ons
            rows.append(r)
        return spec, rows

    def score(self, thr=None, hang=None):
        spec, rows = self.rows(thr, hang)
        _, res = S.report(spec, rows, None)
        return spec, rows, res


def summary(res):
    v1 = res["V1"]
    clean = {k: x for k, x in v1.items() if not k.startswith("voice in noise")}
    mix = {k: x for k, x in v1.items() if k.startswith("voice in noise")}
    wc = max(clean.items(), key=lambda kv: kv[1]["worse_pct"])
    wm = max(mix.items(), key=lambda kv: kv[1]["worse_pct"])
    v2 = res["V2"]
    return {"worst_clean": (wc[0], wc[1]["worse"], wc[1]["worse_pct"]), "worst_mix": (wm[0], wm[1]["worse"], wm[1]["worse_pct"]),
            "mix_cells": {k: round(x["worse_pct"], 2) for k, x in mix.items()},
            "v2_279": v2["all 279 (tuning)"]["pct"], "v2_tune": v2["… tuning split 194"]["pct"],
            "v2_A": v2["held-out A: in-set split 85"]["pct"], "v2_B": v2["held-out B: second set 119"]["pct"],
            "onset_worst_median": max(g["median"] for g in res["V3"]["by_gender"].values()),
            "verdict": res["verdict"]}
