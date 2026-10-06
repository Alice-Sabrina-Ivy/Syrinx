"""Pitch-neutralised ML candidates (family: pitch-neutral-ml).

Each class = (resynthesis engine, reference F0 set, model window, output transform).
Score one with
  build/resonance-lab/venv/Scripts/python scripts/resonance-lab/bench.py score \
      "scripts/resonance-lab/candidates/pitch-neutral-ml/pnml.py:<ClassName>" [--quick] [--split dev]
`CANDIDATE` (the default) is the recommended configuration.

Outputs:
  prob   100 x EMA(alpha 0.2) of the female probability, pooled by mean  (= the deployed meter's scale)
  logit  EMA(alpha 0.2) of the female-minus-male logit, pooled by median (unsaturated)
Multi-reference variants average the raw logits of the reference pitches per window
before the EMA (the prob output then uses sigmoid of that mean logit).
See pnml_core.py for the engines.
"""
import os
import sys
import numpy as np

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from rlab.candidate import Candidate  # noqa: E402
import pnml_core as C  # noqa: E402


class _PNML(Candidate):
    engine = "tdpsola"
    frefs = (165.0,)
    win_s = 0.75
    out = "logit"
    f0src = "bench"           # "bench" = harness two-pass Praat track; "prod" = Boersma-AC pitch-worker emulation
    cadence_s = 0.15
    uses_f0 = True
    version = "1"
    model_bytes = 16057697

    @property
    def js_portability(self):
        e = {"tdpsolaG67": "JS TD-PSOLA (fixed 6.7 ms grains)", "tdpsolaG10": "JS TD-PSOLA (fixed 10 ms grains)",
             "tdpsola": "JS TD-PSOLA from the Syrinx pitch track (<1 ms per 25 ms chunk)",
             "praat": "needs a PSOLA port (Praat-equivalent TD-PSOLA)",
             "world": "needs a WORLD port (CheapTrick+D4C+synthesis; heavy)",
             "lpc": "trivial JS LPC vocoder",
             "none": "deployed"}[self.engine]
        return f"{e} + ECAPA q8-v2 x{len(self.frefs)} per hop on ORT-WASM (~52 ms each, desktop)"

    @property
    def description(self):
        fr = "/".join(str(int(f)) for f in self.frefs)
        return (f"Pitch-neutralised ECAPA: {self.engine} resynthesis at fixed F0 {fr} Hz, "
                f"{self.win_s:g} s window / 150 ms, voicing gate, EMA 0.2, {self.out} output")

    @property
    def aggregate(self):
        return "mean" if self.out == "prob" else "median"

    def setup(self):
        self.model = C.Ecapa()

    def score(self, x, sr, f0=None):
        assert sr == C.SR
        if self.f0src == "prod":
            key = C.cache_key(x, None)
            p = os.path.join(os.path.dirname(C.CACHE), "prodf0", key[:2], key + ".npy")
            f0 = type(f0)(f0.t, np.load(p)[:len(f0.t)])     # precompute_prodf0.py must have run
        L = []
        for fr in self.frefs:
            t, l = C.raw_logits(self.model, x, f0, self.engine, fr, self.win_s)
            L.append(l)
        l = np.mean(np.stack(L), axis=0)
        if self.out == "prob":
            p = 1.0 / (1.0 + np.exp(-l))
            return t, 100.0 * C.ema_gated(p)
        return t, C.ema_gated(l)


def _mk(engine, frefs, out, win_s=0.75, f0src="bench"):
    fr = "avg" + "_".join(str(int(f)) for f in frefs) if len(frefs) > 1 else str(int(frefs[0]))
    w = "" if win_s == 0.75 else f"_w{int(win_s * 1000)}"
    name = f"pnml_{engine}{fr}{w}{'_prodf0' if f0src == 'prod' else ''}_{out}"
    cls = type(name, (_PNML,), dict(name=name, engine=engine, frefs=tuple(float(f) for f in frefs),
                                    out=out, win_s=win_s, f0src=f0src))
    globals()[name] = cls
    return cls


for _out in ("logit", "prob"):
    _mk("none", (0,), _out)
    for _f in (135, 150, 165, 180, 200):
        _mk("tdpsola", (_f,), _out)
    for _e in ("praat", "world", "lpc"):
        _mk(_e, (165,), _out)
    _mk("tdpsola", (150, 180), _out)
    _mk("tdpsola", (140, 165, 190), _out)
    _mk("tdpsola", (165,), _out, win_s=1.5)
    _mk("tdpsolaG67", (165,), _out)
    _mk("tdpsolaG10", (165,), _out)
    _mk("tdpsola", (165,), _out, f0src="prod")
    _mk("none", (0,), _out, f0src="prod")

CANDIDATE = globals()["pnml_tdpsola165_logit"]   # plain family reference; best overall = pnml_head_scalesex_none0 (set below)


class _PNMLHead(_PNML):
    """Pitch-flattened (TD-PSOLA 165 Hz) ECAPA fc6 embedding -> linear head fitted on
    train_dev only (train_head.py). Same windowing / gate / EMA; median pooling."""
    head = "scale"
    out = "logit"
    version = "1"

    @property
    def description(self):
        return (f"Pitch-neutralised ECAPA embedding + linear '{self.head}' head (train_dev only): "
                f"{self.engine} at {int(self.frefs[0])} Hz, 0.75 s / 150 ms, voicing gate, EMA 0.2")

    @property
    def js_portability(self):
        pre = "no resynthesis" if self.engine == "none" else "JS TD-PSOLA from the Syrinx pitch track"
        return (f"{pre} + ECAPA q8-v2 with the head folded into fc7 (fold_head.py; runs in the unchanged "
                "transformers.js pipeline, same cost as deployed, ~52 ms/inference desktop WASM)")

    def setup(self):
        import json
        self.model = C.EcapaEmb()
        pre = "raw_" if self.engine == "none" else ""
        h = json.load(open(os.path.join(os.path.dirname(C.CACHE), f"head_{pre}{self.head}.json")))
        sd = np.array(h["sd"])
        self.w = np.array(h["w"]) / sd
        self.b = h["b"] - float(np.dot(np.array(h["mu"]), self.w))

    def score(self, x, sr, f0=None):
        if self.f0src == "prod":
            key = C.cache_key(x, None)
            p = os.path.join(os.path.dirname(C.CACHE), "prodf0", key[:2], key + ".npy")
            f0 = type(f0)(f0.t, np.load(p)[:len(f0.t)])
        t, e = C.raw_embs(self.model, x, f0, self.engine, self.frefs[0], self.win_s)
        s = e.astype(np.float64) @ self.w + self.b
        return t, C.ema_gated(s)


def _mkh(head, engine="tdpsola", fref=165, f0src="bench"):
    name = f"pnml_head_{head}_{engine}{fref}{'_prodf0' if f0src == 'prod' else ''}"
    cls = type(name, (_PNMLHead,), dict(name=name, head=head, engine=engine, frefs=(float(fref),), f0src=f0src))
    globals()[name] = cls


for _h in ("scale", "scalesex", "sex"):
    _mkh(_h)
    _mkh(_h, f0src="prod")
    _mkh(_h, engine="none", fref=0)      # ablation: same head recipe on UN-flattened audio
for _h in ("scalesex035", "scalesex100", "scalesex140"):   # sex-weight sweep (tradeoff R3 <-> R4)
    _mkh(_h)
    _mkh(_h, f0src="prod")
    _mkh(_h, engine="none", fref=0)

CANDIDATE = globals()["pnml_head_scalesex_none0"]   # recommended: raw-embedding head, a-priori c = 0.07
