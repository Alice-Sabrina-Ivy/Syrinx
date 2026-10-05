# steady_lib.py — 1-s pitch-SD (semitones) windowing + agreement stats for
# the precision/steadiness pass (2026-10-04).
import numpy as np

WIN, STEP = 1.0, 0.25


def st(f):
    return 12 * np.log2(f)


def det_times(n, hop, L, stage):
    k = np.arange(n)
    t = (k + 1) * hop - 0.040
    if stage in ("paint", "ro", "disp"):
        t = t - L * hop - 0.030
    return t


def windows(t_ref, f_ref, t_det, f_det, t0, t1, min_ref=0.95, min_det=0.8, robust=False, ref_dt=None):
    """Yield (a, sd_ref, sd_det, n_det, frac_gross) for 1-s windows in [t0, t1)."""
    out = []
    a = t0
    while a + WIN <= t1 + 1e-9:
        mr = (t_ref >= a) & (t_ref < a + WIN)
        md = (t_det >= a) & (t_det < a + WIN)
        nr, nd = mr.sum(), md.sum()
        if nr and nd:
            vr = f_ref[mr]; vd = f_det[md]
            if (vr > 0).mean() >= min_ref and (vd > 0).mean() >= min_det:
                sr = st(vr[vr > 0]); sdv = st(vd[vd > 0])
                if robust:
                    sr = sr[np.abs(sr - np.median(sr)) <= 3]; sdv = sdv[np.abs(sdv - np.median(sdv)) <= 3]
                # gross: detector values > 50 cents from the ref median-in-window... use nearest ref
                rr = np.interp(t_det[md][vd > 0], t_ref[mr][vr > 0], vr[vr > 0])
                err = 1200 * np.log2(vd[vd > 0] / rr)
                gross = np.mean(np.abs(err) > 300)
                out.append((a, float(np.std(sr)), float(np.std(sdv)), int((vd > 0).sum()), float(gross), float(np.median(sr)),
                            float(np.std(err[np.abs(err) <= 300])) if (np.abs(err) <= 300).sum() > 2 else np.nan))
        a += STEP
    return out


def agree(rows, lo=0.0, hi=np.inf, clean_only=False):
    R = np.array([r for r in rows if lo <= r[1] < hi and (not clean_only or r[4] == 0)], dtype=float)
    if len(R) == 0:
        return {"n": 0}
    sref, sdet = R[:, 1], R[:, 2]
    d = sdet - sref
    out = {"n": len(R), "ref_med": float(np.median(sref)), "det_med": float(np.median(sdet)),
           "bias": float(np.mean(d)), "med_err": float(np.median(d)), "mae": float(np.mean(np.abs(d))),
           "p90_abs": float(np.quantile(np.abs(d), 0.9)),
           "ratio_med": float(np.median(sdet / np.maximum(sref, 1e-6))),
           "within_0.1": float(np.mean(np.abs(d) < 0.1)),
           "gross_win": float(np.mean(R[:, 4] > 0)),
           "fine_err_cents_med": float(np.nanmedian(R[:, 6]))}
    if len(R) > 3 and np.std(sref) > 0 and np.std(sdet) > 0:
        out["r"] = float(np.corrcoef(sref, sdet)[0, 1])
        lr = np.log(np.maximum(sref, 1e-3)); ld = np.log(np.maximum(sdet, 1e-3))
        out["r_log"] = float(np.corrcoef(lr, ld)[0, 1])
    return out


def fmt(a):
    if a["n"] == 0:
        return "n=0"
    return (f"n={a['n']} ref~{a['ref_med']:.3f} det~{a['det_med']:.3f} bias {a['bias']:+.3f} med {a['med_err']:+.3f} "
            f"MAE {a['mae']:.3f} p90 {a['p90_abs']:.3f} ratio {a['ratio_med']:.2f} <0.1st {100*a['within_0.1']:.0f}% "
            f"r {a.get('r', float('nan')):.3f} gross {100*a['gross_win']:.1f}% fine {a['fine_err_cents_med']:.1f}c")
