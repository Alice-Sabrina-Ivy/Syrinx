"""B3 — reference: Praat-formant apparent vocal-tract length (formant dispersion).

Praat Burg (5 formants, FIXED 5500 Hz ceiling — sex/F0-blind on purpose so the
ceiling cannot route pitch into the score; 25 ms window, 10 ms step, pre-emphasis
from 50 Hz). At each voiced 10 ms frame with F1-F4 present, the uniform-tube
dispersion is the least-squares fit F_i = (2i-1)/2 * dF (Reby & McComb 2003):
    dF = sum_i F_i (i - 1/2) / sum_i (i - 1/2)^2,   apparent VTL = c / (2 dF)
Score = ln dF (larger = shorter tract), pooled per 150 ms output bin (median of
>= 3 frames); readout = median over bins.
"""
import numpy as np
from rlab.candidate import Candidate

K = np.array([0.5, 1.5, 2.5, 3.5])
BIN = 0.15


class B3PraatVTL(Candidate):
    name = "b3_praat_vtl"
    version = "1"
    description = "Praat Burg F1-F4 (5500 Hz fixed ceiling) -> formant-dispersion apparent VTL, ln dF"
    cadence_s = BIN
    uses_f0 = True
    aggregate = "median"
    model_bytes = 0
    js_portability = "needs F4 + a Praat-quality tracker; app LPC gives F1-F3 only (F4 present 66-79 % of frames)"

    def score(self, x, sr, f0=None):
        import parselmouth
        snd = parselmouth.Sound(np.asarray(x, np.float64), sr)
        fm = snd.to_formant_burg(time_step=0.01, max_number_of_formants=5, maximum_formant=5500,
                                 window_length=0.025, pre_emphasis_from=50)
        vt = f0.t[f0.f0 > 0]
        if len(vt) == 0:
            return np.array([]), np.array([])
        F = np.array([[fm.get_value_at_time(k, t) for k in (1, 2, 3, 4)] for t in vt])
        ok = np.isfinite(F).all(1)
        dF = (F[ok] @ K) / np.sum(K ** 2)
        tt = vt[ok]
        lv = np.log(dF)
        nb = int(np.ceil(len(x) / sr / BIN))
        ts, ss = [], []
        b = np.floor(tt / BIN).astype(int)
        for i in range(nb):
            v = lv[b == i]
            ts.append((i + 1) * BIN)
            ss.append(float(np.median(v)) if len(v) >= 3 else np.nan)
        return np.array(ts), np.array(ss)


CANDIDATE = B3PraatVTL
