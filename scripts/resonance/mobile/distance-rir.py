# distance-rir.py - synthetic impulse responses for the mobile resonance
# diagnosis, "distance" area (2026-10-28): a phone held in the hand close to
# the mouth vs a close-talking boom mic (the clean LibriSpeech streams).
#
#   python distance-rir.py --spec=<conditions.json> --out=<dir>
#
# Writes <out>/<name>.f32 (48 kHz float32, the impulse response) and
# <out>/<name>.json (geometry, realised RT60 per octave band from Schroeder
# backward integration, direct-to-reverberant ratio, the direct path's and the
# whole IR's octave-band gains) for every condition in the spec.
#
# Model (every number below is an assumption stated in the measurement notes):
#  * Room: shoebox image-source model (Allen & Berkley 1979, JASA 65:943),
#    octave bands 125 Hz-8 kHz. Per band, every image's amplitude is
#    1/r * prod(beta_wall ^ reflections), beta = sqrt(1 - alpha), times air
#    absorption (ISO 9613-1, 20 C / 50 % RH, approximate dB/km). Images are
#    placed at the nearest 48 kHz sample, one impulse train per band; the
#    bands are recombined with zero-phase raised-cosine masks on a log2
#    frequency axis that sum to one (equal band gains -> the train itself).
#    Absorption: alpha_band(surface) = a_mid * shape_band * surf_factor,
#    a_mid found by bisection so that the realised mean T30 of the 500 Hz and
#    1 kHz bands equals the target RT60 (high bands decay faster).
#  * Source directivity: the DIRECT path gets the vertical-plane directivity
#    at the receiver's angle below the mouth axis (table per octave band,
#    "dir" in the spec); the reflections are a diffuse field: they get the
#    power-average over directions, i.e. -DI(f) relative to the on-axis level
#    (speech directivity index, approximate, after Chu & Warnock 2002 /
#    Leishman et al. 2021).
#  * Phone-body shadow on the DIRECT path: Brown & Duda (1998, IEEE TSAP 6:476)
#    rigid-sphere one-pole / one-zero model, H = (1 + j a(theta) w/(2 w0)) /
#    (1 + j w/(2 w0)), w0 = c / radius, a(theta) = 1.05 + 0.95 cos(theta/150 deg
#    * 180 deg): a first-order high-frequency shelf whose corner (~1.8-2.7 kHz
#    for a 4-6 cm radius) and depth follow the angle between the port's
#    outward normal and the source. The reverberant field reaches the port
#    from all sides and is left unshadowed.
#  * Hand partly cupping the bottom edge (port): applied to the whole IR (the
#    hand surrounds the port): a cavity resonance (RBJ peak) and an occlusion
#    shelf (the same first-order form). Purely an assumption.
#  * Minimum phase for every magnitude-only filter (real cepstrum folding).
import sys, json, math, argparse
from pathlib import Path
import numpy as np

SR = 48000
C = 343.0
BANDS = np.array([125, 250, 500, 1000, 2000, 4000, 8000], float)
AIR_DB_PER_M = np.array([0.0004, 0.0011, 0.0025, 0.0047, 0.0099, 0.029, 0.105])  # ISO 9613-1 approx, 20 C 50 % RH
# speech directivity index (dB), approximate (Chu & Warnock 2002; Leishman et al. 2021)
DI_SPEECH = np.array([1.0, 1.5, 2.0, 3.0, 4.0, 5.5, 7.0])

# vertical-plane directivity of speech, dB re on-axis, at angles BELOW the mouth axis (front)
DIR_TABLES = {
    # conservative monotonic high-frequency loss toward the chest (Halkosaari et al. 2004/2005:
    # "reduction of high frequencies ... when the position goes downwards the chest"); magnitudes assumed
    "hf": {0: [0, 0, 0, 0, 0, 0, 0], 20: [0, 0, 0, -0.5, -1, -2, -3], 40: [0, 0, -0.5, -1, -2.5, -4, -5], 60: [0, 0, -0.5, -1.5, -4, -6, -8],
           # 90: a mouth-corner / cheek position (boom-mic proxy; Halkosaari et al.: steeper HF loss toward the ear) - assumed
           90: [0, 0, -0.5, -2, -5, -8, -11]},
    # main-radiation-direction shape (Poerschmann & Arend, DAGA 2023; Chu & Warnock 2002; Marshall & Meyer 1985):
    # radiation slightly downward (-15..-45 deg) except ~0.8-1.6 kHz (upward); MRD gain <= 2 dB 1-4 kHz
    "mrd": {0: [0, 0, 0, 0, 0, 0, 0], 20: [0, 0.5, 1.0, -1.5, 0.5, 0.5, 0], 40: [0, 0.5, 1.0, -2.5, 0, 0, -1], 60: [0, 0, 0.5, -3, -1.5, -2.5, -4]},
    "omni": {a: [0] * 7 for a in (0, 20, 40, 60)},
}
SHAPE = np.array([0.75, 0.85, 1.0, 1.0, 1.1, 1.25, 1.45])  # absorption vs frequency (high bands absorb more)
SURF = {"x0": 1.0, "x1": 1.0, "y0": 1.0, "y1": 1.0, "z0": 1.2, "z1": 1.2}  # floor / ceiling a little more absorptive


def band_masks(freqs):
    """Zero-phase raised-cosine crossover masks over log2 f; sum to 1 at every frequency."""
    lf = np.log2(np.maximum(freqs, 1e-3))
    lc = np.log2(BANDS)
    M = np.zeros((len(BANDS), len(freqs)))
    M[0, lf <= lc[0]] = 1
    M[-1, lf >= lc[-1]] = 1
    for b in range(len(BANDS) - 1):
        sel = (lf > lc[b]) & (lf < lc[b + 1])
        x = (lf[sel] - lc[b]) / (lc[b + 1] - lc[b])
        M[b, sel] += np.cos(0.5 * np.pi * x) ** 2
        M[b + 1, sel] += np.sin(0.5 * np.pi * x) ** 2
    return M


def interp_db(freqs, table_db):
    return band_masks(freqs).T @ np.asarray(table_db, float)


def min_phase(mag, nfft):
    """Minimum-phase spectrum (rfft bins) with magnitude |mag| (rfft bins), real-cepstrum folding."""
    full = np.concatenate([mag, mag[-2:0:-1]])
    c = np.fft.ifft(np.log(np.maximum(full, 1e-8))).real
    w = np.zeros(nfft)
    w[0] = 1
    w[1:nfft // 2] = 2
    w[nfft // 2] = 1
    return np.exp(np.fft.fft(c * w))[: nfft // 2 + 1]


def brown_duda(freqs, theta_deg, radius):
    """Rigid-sphere head-shadow one-pole/one-zero (Brown & Duda 1998); theta = angle from the port's normal."""
    w0 = C / radius
    a = 1.05 + 0.95 * math.cos(math.radians(theta_deg / 150.0 * 180.0))
    w = 2 * np.pi * freqs
    return (1 + 1j * a * w / (2 * w0)) / (1 + 1j * w / (2 * w0)), a


def rbj_peak(freqs, fc, gain_db, q):
    A = 10 ** (gain_db / 40)
    w0 = 2 * np.pi * fc / SR
    al = np.sin(w0) / (2 * q)
    b = np.array([1 + al * A, -2 * np.cos(w0), 1 - al * A])
    a = np.array([1 + al / A, -2 * np.cos(w0), 1 - al / A])
    z = np.exp(-1j * 2 * np.pi * freqs / SR)
    return (b[0] + b[1] * z + b[2] * z * z) / (a[0] + a[1] * z + a[2] * z * z)


def images(room, src, rcv, alpha, tmax):
    """All shoebox images within c * tmax: distances and per-band amplitudes (1/r * reflections * air)."""
    L = np.asarray(room, float)
    s = np.asarray(src, float)
    r = np.asarray(rcv, float)
    rmax = C * tmax
    beta = {k: np.sqrt(1 - np.clip(v, 0, 0.99)) for k, v in alpha.items()}  # per band arrays
    out_d, out_a, out_o = [], [], []
    N = [int(math.ceil(rmax / (2 * L[i]))) + 1 for i in range(3)]
    nx = np.arange(-N[0], N[0] + 1)
    ny = np.arange(-N[1], N[1] + 1)
    nz = np.arange(-N[2], N[2] + 1)
    for px in (0, 1):
        X = (1 - 2 * px) * s[0] + 2 * nx * L[0] - r[0]
        kx0, kx1 = np.abs(nx - px), np.abs(nx)  # reflections off x=0 / x=Lx
        for py in (0, 1):
            Y = (1 - 2 * py) * s[1] + 2 * ny * L[1] - r[1]
            ky0, ky1 = np.abs(ny - py), np.abs(ny)
            for pz in (0, 1):
                Z = (1 - 2 * pz) * s[2] + 2 * nz * L[2] - r[2]
                kz0, kz1 = np.abs(nz - pz), np.abs(nz)
                D = np.sqrt(X[:, None, None] ** 2 + Y[None, :, None] ** 2 + Z[None, None, :] ** 2)
                sel = D <= rmax
                ii, jj, kk = np.nonzero(sel)
                d = D[sel]
                order = kx0[ii] + kx1[ii] + ky0[jj] + ky1[jj] + kz0[kk] + kz1[kk]
                amp = np.ones((len(d), len(BANDS))) / d[:, None]
                for wall, cnt in (("x0", kx0[ii]), ("x1", kx1[ii]), ("y0", ky0[jj]), ("y1", ky1[jj]), ("z0", kz0[kk]), ("z1", kz1[kk])):
                    amp *= beta[wall][None, :] ** cnt[:, None]
                amp *= 10 ** (-AIR_DB_PER_M[None, :] * d[:, None] / 20)
                out_d.append(d)
                out_a.append(amp)
                out_o.append(order)
    return np.concatenate(out_d), np.concatenate(out_a), np.concatenate(out_o)


def band_filter_ir(h, nfft):
    """Per-octave-band components of an IR (zero-phase masks), for Schroeder RT estimates."""
    H = np.fft.rfft(h, nfft)
    f = np.fft.rfftfreq(nfft, 1 / SR)
    M = band_masks(f)
    return [np.fft.irfft(H * M[b], nfft)[: len(h)] for b in range(len(BANDS))]


def t30(hb, t0_samp):
    e = hb[t0_samp:] ** 2
    edc = np.cumsum(e[::-1])[::-1]
    edc = 10 * np.log10(np.maximum(edc / edc[0], 1e-30))
    t = np.arange(len(edc)) / SR
    sel = (edc <= -5) & (edc >= -35)
    if sel.sum() < 10:
        sel = (edc <= -5) & (edc >= -25)
    if sel.sum() < 10:
        return float("nan")
    p = np.polyfit(t[sel], edc[sel], 1)
    return -60 / p[0]


def build(cfg, a_mid, want_info=True):
    room = cfg["room"]
    src = np.asarray(cfg["src"], float)
    th = math.radians(cfg["angle"])
    d0 = cfg["dist"]
    # mouth faces +y; the receiver is d0 in front and theta below the axis
    rcv = src + np.array([0.0, d0 * math.cos(th), -d0 * math.sin(th)])
    alpha = {k: np.clip(a_mid * SHAPE * f, 0, 0.99) for k, f in SURF.items()}
    tmax = cfg.get("tmax", 1.3 * cfg["rt60"] + 0.02 if cfg.get("room_on", True) else 0.03)
    dist, amp, order = images(room, src, rcv, alpha, tmax)
    nir = int(math.ceil(tmax * SR)) + 64
    nfft = 1 << int(math.ceil(math.log2(2 * nir)))
    f = np.fft.rfftfreq(nfft, 1 / SR)
    M = band_masks(f)
    # reflections: one train per band at the nearest sample
    refl = order > 0
    idx = np.round(dist[refl] / C * SR).astype(int)
    keep = idx < nir
    trains = np.zeros((len(BANDS), nir))
    for b in range(len(BANDS)):
        np.add.at(trains[b], idx[keep], amp[refl][keep, b])
    Hr = np.zeros(len(f), complex)
    for b in range(len(BANDS)):
        Hr += M[b] * np.fft.rfft(trains[b], nfft)
    # diffuse field: power average of the source over directions = -DI re on-axis.
    # All-positive image impulses pile up a spurious DC / very-low-frequency hump (Allen &
    # Berkley 1979 high-pass the ISM response for this reason): 4th-order high-pass at 80 Hz.
    hp = 1 / np.sqrt(1 + (80.0 / np.maximum(f, 1e-3)) ** 8)
    Hr *= min_phase(10 ** (-interp_db(f, DI_SPEECH) / 20) * hp, nfft)
    # direct path (exact fractional delay), directivity at the receiver's angle, phone-body shadow
    direct = np.nonzero(order == 0)[0]
    assert len(direct) == 1
    dd = dist[direct[0]]
    dirtab = DIR_TABLES[cfg.get("dir", "hf")][cfg["angle"]] if cfg["angle"] in DIR_TABLES[cfg.get("dir", "hf")] else None
    if dirtab is None:
        raise ValueError(f"no directivity table for angle {cfg['angle']}")
    Dmag = 10 ** (interp_db(f, dirtab) / 20) * 10 ** (-np.interp(f, BANDS, AIR_DB_PER_M) * dd / 20)
    Hd = min_phase(Dmag, nfft) / dd * np.exp(-2j * np.pi * f * dd / C)
    sh = cfg.get("shadow")
    sh_alpha = None
    if sh:
        Hs, sh_alpha = brown_duda(f, sh["theta"], sh["radius"])
        Hd = Hd * Hs
    H = Hd + (Hr if cfg.get("room_on", True) else 0)
    hand = cfg.get("hand")
    Hh = None
    if hand:
        Hh = np.ones(len(f), complex)
        if hand.get("peak"):
            pk = hand["peak"]
            Hh *= rbj_peak(f, pk["fc"], pk["db"], pk["q"])
        if hand.get("occl"):
            oc = hand["occl"]
            Hh *= brown_duda(f, oc["theta"], oc["radius"])[0]
        H = H * Hh
    h = np.fft.irfft(H, nfft)[:nir]
    # normalise so the direct path's broadband amplitude at the reference distance 0.2 m is 1 (the JS module re-levels anyway)
    h = h * 0.2
    n_direct = int(round(dd / C * SR))
    shift = max(0, n_direct - 48)  # time-align: drop the bulk delay, keep 1 ms before the direct arrival
    info = None
    if want_info:
        t_direct = dd / C
        n0 = int(round(t_direct * SR))
        w = int(0.0025 * SR)
        # direct-to-reverberant ratio (direct = +-2.5 ms around the direct arrival)
        def drr_of(x):
            e_d = np.sum(x[max(0, n0 - w): n0 + w] ** 2)
            e_r = np.sum(x[n0 + w:] ** 2)
            return float(10 * np.log10(e_d / max(e_r, 1e-30)))
        hb = band_filter_ir(h, nfft)
        hd_only = np.fft.irfft(Hd * (Hh if Hh is not None else 1), nfft)[:nir] * 0.2
        Hfull = np.fft.rfft(h, nfft)
        Hdir = np.fft.rfft(hd_only, nfft)
        def band_db(Hx):
            out = []
            for b in range(len(BANDS)):
                sel = (f >= BANDS[b] / math.sqrt(2)) & (f < BANDS[b] * math.sqrt(2))
                out.append(float(10 * np.log10(np.mean(np.abs(Hx[sel]) ** 2))))
            return out
        # band 0-8 kHz DRR (what the 16 kHz chain hears) and per band
        F = np.fft.rfft(h, nfft)
        lp = f <= 8000
        h8 = np.fft.irfft(np.where(lp, F, 0), nfft)[:nir]
        info = {
            "name": cfg["name"], "room": room, "src": src.tolist(), "rcv": rcv.tolist(), "dist": d0, "angle": cfg["angle"],
            "dir": cfg.get("dir", "hf"), "dirTableDb": dirtab, "shadow": sh, "shadowAlpha": sh_alpha, "hand": hand, "roomOn": cfg.get("room_on", True),
            "rt60Target": cfg["rt60"], "aMid": a_mid, "alpha": {k: v.tolist() for k, v in alpha.items()},
            "images": int(len(dist)), "irLenS": nir / SR,
            "rt60Band": [t30(hb[b], n0) for b in range(len(BANDS))],
            "drrDb_0_8k": drr_of(h8), "drrDbBand": [drr_of(hb[b]) for b in range(len(BANDS))],
            "directBandDb": band_db(Hdir), "totalBandDb": band_db(Hfull),
            "directDelayMs": t_direct * 1000, "shiftSamples": shift,
        }
    return np.concatenate([h[shift:], np.zeros(shift)]).astype(np.float32), info


A_CACHE = {}


def fit(cfg):
    """One absorption per room and target RT60 (the same physical room for every position):
    fitted once at the first position that needs it (spec order: the 0.1 m / 20 deg one), then reused."""
    if not cfg.get("room_on", True):
        return build(cfg, 0.5)
    if cfg.get("a_mid"):
        return build(cfg, cfg["a_mid"])
    key = (tuple(cfg["room"]), cfg["rt60"])
    if key in A_CACHE:
        return build(cfg, A_CACHE[key])
    target = cfg["rt60"]
    lo, hi = 0.02, 0.9
    best = None
    for it in range(14):
        a = math.sqrt(lo * hi)
        h, info = build(cfg, a)
        rt = np.nanmean([info["rt60Band"][2], info["rt60Band"][3]])
        best = (h, info, rt)
        if abs(rt - target) / target < 0.03:
            break
        if rt > target:
            lo = a
        else:
            hi = a
    A_CACHE[key] = best[1]["aMid"]
    return best[0], best[1]


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--spec", required=True)
    ap.add_argument("--out", required=True)
    ap.add_argument("--only", default="")
    args = ap.parse_args()
    spec = json.loads(Path(args.spec).read_text())
    out = Path(args.out)
    out.mkdir(parents=True, exist_ok=True)
    only = set(x for x in args.only.split(",") if x)
    for cfg in spec:
        if only and cfg["name"] not in only:
            continue
        h, info = fit(cfg)
        (out / f"{cfg['name']}.f32").write_bytes(h.tobytes())
        (out / f"{cfg['name']}.json").write_text(json.dumps(info, indent=1))
        print(f"{cfg['name']}: images {info['images']} a_mid {info['aMid']:.3f} RT60 band {['%.2f' % x for x in info['rt60Band']]} "
              f"DRR(0-8k) {info['drrDb_0_8k']:.1f} dB  direct band dB {['%.1f' % x for x in info['directBandDb']]}", flush=True)


if __name__ == "__main__":
    main()
