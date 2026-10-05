"""formant-vtl harness candidates (bench.py score scripts/resonance-lab/candidates/formant-vtl/cands.py:<Class>).

Each class is one Config of the fvtl family. score() hashes the 16 kHz audio it is
given and reuses the frame dump written by extract.py when one exists (memoisation:
the dump is a deterministic function of the same audio); otherwise it computes the
frames live (Praat in-process; the app LPC through a node child process waited on via
its own handle). Learned parts (shape correctors) are JSON files in models/, fit on
train_dev ONLY by fit_models.py.
"""
import os
import sys
import json
import tempfile
import subprocess
import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
LAB = os.path.dirname(os.path.dirname(HERE))
for p in (LAB, HERE):
    if p not in sys.path:
        sys.path.insert(0, p)
from rlab.candidate import Candidate  # noqa: E402
import fvtl  # noqa: E402
import extract as X  # noqa: E402

MODELS = os.path.join(HERE, "models")


def _app_live(x):
    with tempfile.TemporaryDirectory() as d:
        a, o, j = os.path.join(d, "x.f32"), os.path.join(d, "x.out"), os.path.join(d, "j.json")
        x.astype("<f4").tofile(a)
        json.dump([dict(audio=a.replace("\\", "/"), out=o.replace("\\", "/"))], open(j, "w"))
        p = subprocess.Popen(["node", os.path.join(HERE, "extract_app.mjs"), j])
        try:
            if p.wait(timeout=600) != 0:
                raise RuntimeError("extract_app failed")
        finally:
            if p.poll() is None:
                p.kill()        # this child's PID only
        return np.fromfile(o, dtype="<f4").reshape(-1, fvtl.ROW)


class FVTL(Candidate):
    name = "fvtl_base"
    version = "1"
    cfg = dict(extractor="app", order=12, est="dF1234")
    corr_file = None
    cadence_s = 0.15
    uses_f0 = True
    aggregate = "median"
    model_bytes = 0
    js_portability = ("pure JS: the app's Burg LPC (all poles + bandwidths, 25 ms hop) + a few "
                      "array ops per frame; no model fetch")

    @property
    def description(self):
        c = "" if not self.corr_file else f" + shape correction {self.corr_file}"
        return f"formant-vtl {json.dumps(self.cfg)}{c}"

    def setup(self):
        self.corr = None
        if self.corr_file:
            d = json.load(open(os.path.join(MODELS, self.corr_file)))
            self.corr = fvtl.ShapeCorrector.from_dict(d) if d.get("type", "kmeans") == "kmeans" else None
        self.nocache = os.environ.get("FVTL_NOCACHE") == "1"

    def score(self, x, sr, f0=None):
        if not hasattr(self, "corr"):
            self.setup()
        ext = self.cfg.get("extractor", "app")
        h = X.audio_hash(x)
        if ext == "app":
            raw = None if self.nocache else X.load_app(h)
            fr = ("app", raw if raw is not None else _app_live(np.asarray(x, np.float32)))
        else:
            pr = None if self.nocache else X.load_praat(h)
            fr = ("praat", pr if pr is not None else X.praat_frames(x))
        return fvtl.score_frames(fr, f0, len(x) / sr, self.cfg, self.corr)


def make(name, cfg, corr_file=None, version="1", aggregate="median"):
    return type(name, (FVTL,), dict(name=name, cfg=cfg, corr_file=corr_file, version=version, aggregate=aggregate))
