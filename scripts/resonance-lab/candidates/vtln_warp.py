"""vtln-warp - VTLN warp-factor estimation as a calibration-free resonance readout.

Classic ASR vocal-tract-length normalisation run backwards: a gender-balanced, speaker-independent
reference model of voiced-frame spectral envelopes is trained on LibriSpeech dev-clean (train_dev
only), and for each causal window of voiced frames the linear frequency-warp factor alpha that best
maps the input onto the reference is grid-searched (+-0.24 ln in 0.02 ln steps + parabolic refinement).
Readout = ln(alpha): larger = formants higher = shorter apparent vocal tract.

Envelope: WORLD CheapTrick (F0-adaptive smoothing, needs the F0 value) per voiced 10 ms frame, resampled
to a log-frequency grid where linear warping is a pure shift. Matching ('warp the model, not the data'):
the input's FIXED band (mean-removed log envelope) is scored against shifted sub-windows of a wide-band
diagonal GMM trained with speaker-adaptive (SAT) VTLN iterations. Final config (selected on dev-clean
2-fold speaker-disjoint CV): band 800-5000 Hz, K=32, 2 SAT iterations, trailing-1-s window ML estimate.
Library + training script: candidates/vtln-warp/ (vtlnlib.py, train_model.py); models in
candidates/vtln-warp/models/ (train with train_model.py '<cfg json>' <name>).

Variants are separate classes; score one with  bench.py score candidates/vtln_warp.py:<Class>
"""
import os
import sys
import json
import numpy as np
from rlab.candidate import Candidate

HERE = os.path.join(os.path.dirname(os.path.abspath(__file__)), "vtln-warp")
if HERE not in sys.path:
    sys.path.insert(0, HERE)

DESC = ("VTLN warp factor: input's CheapTrick log envelope ({band}, log-f grid) scored against +-0.24 ln-shifted "
        "sub-windows of a SAT-trained gender-balanced diag GMM (K=32, LibriSpeech dev-clean{aug}); "
        "readout = ML ln(alpha) over the trailing 1 s of voiced frames")


class VTLNWarp(Candidate):
    name = "vtln_warp"
    version = "3"
    model = "mw_ct_k32_sat2_s4_b800"
    estimator = "w1"
    description = DESC.format(band="800-5000 Hz", aug="")
    cadence_s = 0.15
    uses_f0 = True
    aggregate = "median"
    js_portability = ("CheapTrick-style F0-adaptive envelope (1024-pt FFT per voiced 10 ms frame) + 25 hypotheses x "
                      "32-comp x ~90-dim diag GMM (~0.15 MFLOP/frame); <1 ms/frame in JS; model ~34 KB")

    def __init__(self):
        p = os.path.join(HERE, "models", self.model + ".npz")
        self.model_bytes = os.path.getsize(p) if os.path.exists(p) else 0

    def setup(self):
        import warnings
        warnings.filterwarnings("ignore")
        import vtlnlib as V
        self.V = V
        z = np.load(os.path.join(HERE, "models", self.model + ".npz"))
        self.cfg = cfg = json.loads(str(z["cfg"]))
        w, mu, var = (z[k].astype(np.float64) for k in ("w", "mu", "var"))
        arch = cfg.get("arch", "dw")
        if arch == "mwf0":
            self.W = V.ModelWarpF0(tuple(cfg["band"]), cfg["kmax"], cfg["st"], tuple(cfg["f0_edges"]))
            self.W.prepare_all([V.DiagGMM(w[i], mu[i], var[i]) for i in range(len(w))])
        elif arch == "mw":
            self.W = V.ModelWarp(tuple(cfg["band"]), cfg["kmax"], cfg["st"]).prepare(V.DiagGMM(w, mu, var))
        else:
            self.gmm = V.DiagGMM(w, mu, var)
            self.W = V.Warper(tuple(cfg["band"]), cfg["ncep"], cfg["kmax"], cfg["drop_c1"])

    def score(self, x, sr, f0=None):
        V = self.V
        v = f0.f0 > 0
        t, fv = f0.t[v], f0.f0[v]
        ok = (t * sr > 200) & (t * sr < len(x) - 200)
        t, fv = t[ok], fv[ok]
        dur = len(x) / sr
        if len(t) == 0:
            return np.array([]), np.array([])
        E = V.envelopes(x, t, fv, self.cfg["method"], lifter_q=self.cfg.get("lifter_q", 24))
        if isinstance(self.W, V.ModelWarpF0):
            LL = np.concatenate([self.W.curves(E[a:a + 4000], fv[a:a + 4000]) for a in range(0, len(E), 4000)])
        elif isinstance(self.W, V.ModelWarp):
            LL = np.concatenate([self.W.curves(E[a:a + 4000]) for a in range(0, len(E), 4000)])
        else:
            LL = np.concatenate([V.loglik_curves(self.gmm, self.W, E[a:a + 2000]) for a in range(0, len(E), 2000)])
        te, res = V.bin_estimates(LL, t, dur, self.W, (self.estimator,))
        return te, res[self.estimator]



class VTLNWarpB300(VTLNWarp):
    name = "vtln_warp_b300"
    model = "mw_ct_k32_sat2_s4"
    description = DESC.format(band="300-4500 Hz", aug="")


class VTLNWarpB600(VTLNWarp):
    name = "vtln_warp_b600"
    model = "mw_ct_k32_sat2_s4_b600"
    description = DESC.format(band="600-5000 Hz", aug="")


class VTLNWarpB600Aug(VTLNWarp):
    name = "vtln_warp_b600_aug"
    model = "mw_ct_k32_sat2_s8_b600_aug"
    description = DESC.format(band="600-5000 Hz", aug=" + its Praat-PSOLA +-8 st copies")


class VTLNWarpB1000(VTLNWarp):
    name = "vtln_warp_b1000"
    model = "mw_ct_k32_sat2_s4_b1000"
    description = DESC.format(band="1000-5000 Hz", aug="")


CANDIDATE = VTLNWarp
