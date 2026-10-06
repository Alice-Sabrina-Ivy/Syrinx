"""Template — copy to candidates/<yourname>.py, rename, implement score().

Score with:
  build/resonance-lab/venv/Scripts/python scripts/resonance-lab/bench.py score scripts/resonance-lab/candidates/<yourname>.py --quick
  (drop --quick for the leaderboard run; --split dev for tuning on dev-clean only)

This example is a deliberately naive formant-free 1-4 kHz spectral-centroid readout
so the template runs out of the box. It is NOT a proposed candidate.
"""
import numpy as np
from rlab.candidate import Candidate


class ExampleCentroid(Candidate):
    name = "example_centroid"          # unique; becomes the score-cache directory
    version = "1"                      # bump whenever outputs change (invalidates cache)
    description = "TEMPLATE: 1-4 kHz power centroid over voiced 50 ms frames, 150 ms bins"
    cadence_s = 0.15
    uses_f0 = True                     # receive an F0Track (10 ms grid; f0 == 0 unvoiced)
    aggregate = "median"               # harness pools window scores with this
    model_bytes = 0
    js_portability = "trivial (one FFT per frame)"

    def setup(self):
        # load models / tables here (runs once per worker process)
        self.win = np.hanning(800)
        self.f = np.fft.rfftfreq(2048, 1 / 16000)
        self.band = (self.f >= 1000) & (self.f <= 4000)

    def score(self, x, sr, f0=None):
        assert sr == 16000
        ts, ss = [], []
        hop = int(0.15 * sr)
        for end in range(hop, len(x) + 1, hop):
            te = end / sr
            fr_t = f0.t[(f0.t > te - 0.15) & (f0.t <= te) & (f0.f0 > 0)]   # voiced frames in this bin
            vals = []
            for t in fr_t[::2]:
                a = int(t * sr) - 400
                if a < 0 or a + 800 > len(x):
                    continue
                P = np.abs(np.fft.rfft(x[a:a + 800] * self.win, 2048)) ** 2
                vals.append(np.log(np.sum(self.f[self.band] * P[self.band]) / (np.sum(P[self.band]) + 1e-20)))
            ts.append(te)
            ss.append(np.median(vals) if vals else np.nan)      # larger = brighter / more feminine-typical
        return np.array(ts), np.array(ss)


CANDIDATE = ExampleCentroid
