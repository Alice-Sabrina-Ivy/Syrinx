# heldseg.py — find HELD (sustained, near-constant-pitch) stretches in an F0
# track, uniformly across corpora. Used by fetch_voice.py; the result goes into
# each voice record's `held` list as [t0, t1, f0_med_hz, vib_cents, drift_cents,
# micro_cents] so the evaluation can pick "notes a stability-based notch could
# mistake for a hum".
#
# Definition (10 ms grid):
#   voiced runs  f0 > 0, gaps <= 60 ms bridged
#   smooth       0.3 s moving median of cents (removes vibrato 4-7 Hz)
#   held         maximal sub-stretch whose smoothed pitch stays within +-50 c
#                of the stretch's running median, >= MIN_SEC (0.5 s)
#   vib_cents    std of (raw - smooth) cents        (vibrato / fast wobble)
#   drift_cents  smooth[end] - smooth[start]
#   micro_cents  RMS of the frame-to-frame raw cents difference (10 ms step;
#                F0-tracker noise floor included — compare like with like)
import numpy as np
from scipy.ndimage import median_filter

def regrid(t, f0, hop=0.01):
    t = np.asarray(t, float); f0 = np.asarray(f0, float)
    if len(t) < 2: return np.zeros(0), np.zeros(0)
    g = np.arange(t[0], t[-1] + 1e-9, hop)
    idx = np.clip(np.round((g - t[0]) / np.median(np.diff(t))).astype(int), 0, len(f0) - 1)
    return g, f0[idx]

def held_segments(t, f0, min_sec=0.5, tol_c=50.0, hop=0.01, bridge=0.06):
    t, f = regrid(t, f0, hop)
    if len(f) == 0: return []
    v = np.isfinite(f) & (f > 0)
    # bridge short unvoiced gaps
    k = 0; n = len(v); vb = v.copy()
    while k < n:
        if not v[k]:
            j = k
            while j < n and not v[j]: j += 1
            if 0 < k and j < n and (j - k) * hop <= bridge: vb[k:j] = True
            k = j
        else: k += 1
    out = []
    k = 0
    while k < n:
        if not vb[k]: k += 1; continue
        j = k
        while j < n and vb[j]: j += 1
        if (j - k) * hop >= min_sec:
            seg = f[k:j].copy()
            good = seg > 0
            # fill bridged holes by interpolation for the smoother
            if not good.all():
                xi = np.arange(len(seg)); seg[~good] = np.interp(xi[~good], xi[good], seg[good])
            c = 1200 * np.log2(seg / np.median(seg))
            sm = median_filter(c, size=max(3, int(0.3 / hop) | 1), mode="nearest")
            a = 0
            while a < len(sm):
                b = a + 1; ref = sm[a]
                while b < len(sm):
                    ref_med = np.median(sm[a:b + 1]) if (b - a) % 10 == 0 else ref
                    ref = ref_med
                    if abs(sm[b] - ref) > tol_c: break
                    b += 1
                if (b - a) * hop >= min_sec:
                    raw = c[a:b]; s2 = sm[a:b]
                    out.append([round(float(t[k + a]), 3), round(float(t[k + b - 1] + hop), 3),
                                round(float(np.median(seg[a:b])), 2), round(float(np.std(raw - s2)), 2),
                                round(float(s2[-1] - s2[0]), 1),
                                round(float(np.sqrt(np.mean(np.diff(raw) ** 2))) if b - a > 2 else 0.0, 2)])
                    a = b
                else:
                    a += 1
        k = j
    return out

def praat_f0(x, sr, floor=60, ceiling=1100, step=0.01):
    import parselmouth
    p = parselmouth.Sound(np.asarray(x, float), sampling_frequency=sr).to_pitch_ac(time_step=step, pitch_floor=floor, pitch_ceiling=ceiling)
    return p.xs(), np.nan_to_num(p.selected_array["frequency"])
