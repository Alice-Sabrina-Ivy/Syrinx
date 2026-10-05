"""F0 tracks supplied to candidates (optional input) and used by the harness for
voiced-time accounting (horizons) and the production-style ML voicing gate.

Track = (t, f0) on a 10 ms grid; f0 == 0 means unvoiced. Originals use a
sex-blind two-pass Praat AC analysis (Hirst & De Looze 2-pass: pass 1 at
60-700 Hz, pass 2 at [0.75*q25, 1.5*q75] of pass 1 — per item, derived only
from the item's own audio, so no group label leaks in). Manipulated items get
the same two-pass analysis on the manipulated audio (QA compares the realized
median against the intended shift).
"""
import os
import numpy as np
import parselmouth
from .paths import SR, F0_HOP


class F0Track:
    __slots__ = ("t", "f0")

    def __init__(self, t, f0):
        self.t = np.asarray(t, np.float64)
        self.f0 = np.asarray(f0, np.float64)

    def at(self, times):
        """Nearest-frame F0 at the given times (0 outside the track)."""
        times = np.asarray(times, np.float64)
        if len(self.t) == 0:
            return np.zeros_like(times)
        i = np.round((times - self.t[0]) / F0_HOP).astype(int)
        ok = (i >= 0) & (i < len(self.t))
        out = np.zeros_like(times)
        out[ok] = self.f0[i[ok]]
        return out

    @property
    def voiced(self):
        return self.f0 > 0

    def voiced_seconds(self):
        return float(self.voiced.sum() * F0_HOP)

    def median(self):
        v = self.f0[self.f0 > 0]
        return float(np.median(v)) if len(v) else float("nan")

    def save(self, path):
        os.makedirs(os.path.dirname(path), exist_ok=True)
        np.save(path, np.stack([self.t, self.f0]).astype(np.float32))

    @staticmethod
    def load(path):
        a = np.load(path)
        return F0Track(a[0], a[1])


def _praat(x, floor, ceil):
    snd = parselmouth.Sound(np.asarray(x, np.float64), SR)
    p = snd.to_pitch_ac(time_step=F0_HOP, pitch_floor=floor, pitch_ceiling=ceil)
    return p.xs(), p.selected_array["frequency"]


def praat_track(x, floor=60.0, ceil=700.0, two_pass=True):
    """Two-pass Praat AC F0 on the full 10 ms grid starting at t=F0_HOP/2-ish."""
    if len(x) < int(0.1 * SR):
        return F0Track([], [])
    t, f = _praat(x, floor, ceil)
    if two_pass:
        v = f[f > 0]
        if len(v) >= 10:
            lo = max(40.0, 0.75 * np.percentile(v, 25))
            hi = min(1100.0, max(1.5 * np.percentile(v, 75), lo * 2.5))
            t, f = _praat(x, lo, hi)
    # resample onto a regular grid t_k = k*F0_HOP (Praat's xs are regular already;
    # this just fixes the origin so all tracks share one convention)
    n = int(np.floor(len(x) / SR / F0_HOP))
    grid = np.arange(n) * F0_HOP + F0_HOP / 2
    if len(t) == 0:
        return F0Track(grid, np.zeros(n))
    i = np.round((grid - t[0]) / (t[1] - t[0] if len(t) > 1 else F0_HOP)).astype(int)
    ok = (i >= 0) & (i < len(f))
    g = np.zeros(n)
    g[ok] = f[i[ok]]
    return F0Track(grid, g)


def track_from_frames(frame_t, frame_f0, dur_s):
    """Regrid an arbitrary (t, f0) frame list onto the 10 ms grid (nearest)."""
    n = int(np.floor(dur_s / F0_HOP))
    grid = np.arange(n) * F0_HOP + F0_HOP / 2
    frame_t = np.asarray(frame_t, float)
    frame_f0 = np.asarray(frame_f0, float)
    if len(frame_t) == 0:
        return F0Track(grid, np.zeros(n))
    j = np.clip(np.searchsorted(frame_t, grid), 1, max(len(frame_t) - 1, 1))
    jj = np.where(np.abs(frame_t[j - 1] - grid) <= np.abs(frame_t[np.minimum(j, len(frame_t) - 1)] - grid), j - 1, j)
    jj = np.clip(jj, 0, len(frame_t) - 1)
    g = np.where(np.abs(frame_t[jj] - grid) <= 0.0101, frame_f0[jj], 0.0)
    return F0Track(grid, np.nan_to_num(g))
