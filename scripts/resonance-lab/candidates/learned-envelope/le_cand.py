"""Harness wrapper for a trained learned-envelope model (JSON export from train_models.py).

Per voiced 10 ms frame: pitch-removed log envelope (lefeat), 150 ms bins (mean of >= 3 voiced
frames) -> standardised features -> linear / tiny-MLP score. Emitted at bin END (causal).
Readout pooling: mean (a linear model's mean bin score == the score of the long-term-average
envelope).
"""
import os
import sys
import json
import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
sys.path.insert(0, os.path.dirname(os.path.dirname(HERE)))
from rlab.candidate import Candidate  # noqa: E402

MODELS = os.path.join(HERE, "models")


class LECand(Candidate):
    cadence_s = 0.15
    uses_f0 = True
    aggregate = "mean"
    model_name = None
    prod_f0 = False

    def setup(self):
        import lefeat
        from train_eval import Feat
        self.L = lefeat
        m = json.load(open(os.path.join(MODELS, self.model_name + ".json")))
        self.feat = Feat(**m["feat"])
        self.feat.mu, self.feat.sd = np.array(m["mu"]), np.array(m["sd"])
        self.kind = m["kind"]
        if self.kind == "linear":
            self.w, self.b = np.array(m["w"]), float(m["b"])
        elif m["mlp"].get("_kind") == "gated":
            self.kind = "gated"
            self.Wg = np.array(m["mlp"]["gate.weight"]); self.bg = np.array(m["mlp"]["gate.bias"])
            self.We = np.array(m["mlp"]["expert.weight"]); self.be = np.array(m["mlp"]["expert.bias"])
        else:
            self.W1 = np.array(m["mlp"]["0.weight"]); self.b1 = np.array(m["mlp"]["0.bias"])
            self.W2 = np.array(m["mlp"]["2.weight"]); self.b2 = np.array(m["mlp"]["2.bias"])

    def _pred(self, E):
        X = self.feat(E)
        if self.kind == "linear":
            return X @ self.w + self.b
        if self.kind == "gated":
            z = X @ self.Wg.T + self.bg
            g = np.exp(z - z.max(1, keepdims=True))
            g /= g.sum(1, keepdims=True)
            return (g * (X @ self.We.T + self.be)).sum(1)
        return (np.tanh(X @ self.W1.T + self.b1) @ self.W2.T + self.b2)[:, 0]

    def score(self, x, sr, f0=None):
        L = self.L
        if self.prod_f0:
            # production pitch-worker emulation track (precompute_prodf0.py must have run)
            from precompute_prodf0 import path_for
            f0 = type(f0)(f0.t, np.load(path_for(x)).astype(float)[:len(f0.t)])
        t, f, E = L.frame_envelopes(x, f0, [self.feat.method])
        tend, cnt, B = L.bin_pool(t, len(x) / sr, E)
        Eb = B[self.feat.method]
        s = np.full(len(tend), np.nan)
        ok = cnt >= L.MIN_FR
        if ok.any():
            s[ok] = self._pred(Eb[ok])
        return tend, s


def make(model_name, version="1", desc="", prod_f0=False):
    def setup_bytes():
        p = os.path.join(MODELS, model_name + ".json")
        return os.path.getsize(p) if os.path.exists(p) else 0

    sfx = "_prodf0" if prod_f0 else ""
    return type("LE_" + model_name + sfx, (LECand,), dict(
        name="le_" + model_name + sfx, version=version, model_name=model_name, prod_f0=prod_f0,
        description=(desc or f"learned-envelope model {model_name}") + (" [production-detector F0 track]" if prod_f0 else ""), model_bytes=setup_bytes(),
        js_portability="FFT-only envelope (1024-pt) + dot product / 1-hidden-layer MLP; < 50 KB JSON weights"))


class LEEnsemble(LECand):
    """Mean of several learned-envelope models that share one feature method (one envelope pass)."""
    members = ()

    def setup(self):
        self.subs = []
        for nm in self.members:
            c = make(nm)()
            c.setup()
            self.subs.append(c)
        self.L = self.subs[0].L
        self.feat = self.subs[0].feat
        assert all(c.feat.method == self.feat.method for c in self.subs)

    def _pred(self, E):
        return np.mean([c._pred(E) for c in self.subs], axis=0)


def make_ensemble(name, members, version="1", desc="", prod_f0=False):
    nbytes = sum(os.path.getsize(os.path.join(MODELS, m + ".json")) for m in members
                 if os.path.exists(os.path.join(MODELS, m + ".json")))
    sfx = "_prodf0" if prod_f0 else ""
    return type("LE_" + name + sfx, (LEEnsemble,), dict(
        name="le_" + name + sfx, version=version, members=tuple(members), prod_f0=prod_f0,
        description=(desc or f"mean of {', '.join(members)}") + (" [production-detector F0 track]" if prod_f0 else ""),
        model_bytes=nbytes,
        js_portability="FFT-only envelope (1024-pt) + mean of tiny MLP heads; JSON weights"))
