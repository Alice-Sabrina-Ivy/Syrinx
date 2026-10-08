# sessions.py — custom voice detector, round 3 (pre-registration §2): the
# one-room carried-state sessions, shared by the validation side
# (build_vsess.py) and the confirmatory side (build_conf.py).
#
# A session is 300 s at 16 kHz: one voice source (one speaker / singer /
# participant on one microphone), one noise bed (one noise stream looped with
# 1 s cross-fades) at a FIXED SNR (+10 or 0 dB, alternating in session order)
# or no bed (clean: a -70 dBFS seeded white floor throughout).
#
# Timeline (seeded per session):
#   - 30 s noise-only lead;
#   - voice EPISODES of a length drawn from U(10, 30) s: the source's
#     recordings in the source's order (cycling when it runs out), read
#     consecutively with a cursor, joined with 0.5 s gaps; a recording longer
#     than what the episode still needs is cut there and the next episode
#     continues it from the cut (a long song or reading is sung / read in
#     parts with pauses); nothing runs past 300 s;
#   - pauses between episodes drawn from {1, 3, 8, 20, 60} s with
#     probabilities {0.30, 0.30, 0.20, 0.15, 0.05};
#   - accepted only if the voice fraction (recording time / 300 s) is 35-65 %
#     and at least one noise-only stretch after the lead is >= 40 s; otherwise
#     the next sub-seed is tried (up to 400); if none passes, the first draw is
#     taken with its longest pause set to 60 s (recorded as `forced`).
# Voice level: active level (2 %-of-peak rule, build_mixes.py / valsets.py
# active_rms over the whole voice layer) -26 dBFS +- 6 dB, one uniform draw per
# session. Noise level: SNR = voice active RMS / bed RMS over the session.
# A whole-session gain < 1 avoids clipping (recorded).
import numpy as np

SR = 16000
LEN = 300.0
LEAD = 30.0
PAUSES = np.array([1.0, 3.0, 8.0, 20.0, 60.0])
PPROB = np.array([0.30, 0.30, 0.20, 0.15, 0.05])
GAP_IN = 0.5


def active_rms(x):
    pk = np.max(np.abs(x)) if len(x) else 0
    m = np.abs(x) > 0.02 * pk
    return float(np.sqrt(np.mean(np.square(x[m], dtype=np.float64)))) if m.any() else 0.0


def timeline(recs, seed):
    """recs: list of dicts with 'dur' (s), in the source's order. Returns (placements, stretches, info)."""
    def draw(sub):
        rng = np.random.default_rng([seed, sub])
        t, k, cur, pl, eps = LEAD, 0, 0.0, [], []
        while t < LEN - 0.5:
            target = rng.uniform(10.0, 30.0)
            e0, el = t, 0.0
            while True:
                r = recs[k % len(recs)]
                d = min(r["dur"] - cur, target - el, LEN - t)
                pl.append({"rec": k % len(recs), "from": round(cur, 4), "at": round(t, 4), "len": round(d, 4)})
                cur += d
                if cur >= r["dur"] - 0.05:         # recording used up: the next one (cycling)
                    k, cur = k + 1, 0.0
                t += d
                el += d
                if el >= target - 1e-6 or t >= LEN - 0.5:
                    break
                t += GAP_IN
                if t >= LEN - 0.5:
                    break
            eps.append((e0, t))
            t += float(rng.choice(PAUSES, p=PPROB))
        return pl, eps

    def check(pl, eps):
        vf = sum(p["len"] for p in pl) / LEN
        gaps = [(eps[i][1], eps[i + 1][0]) for i in range(len(eps) - 1)] + [(eps[-1][1], LEN)]
        return vf, max((b - a for a, b in gaps), default=0.0)

    first = None
    for sub in range(400):
        pl, eps = draw(sub)
        vf, mg = check(pl, eps)
        if first is None:
            first = (pl, eps)
        if 0.35 <= vf <= 0.65 and mg >= 40.0:
            return finish(pl, eps, {"sub_seed": sub, "voice_fraction": round(vf, 4), "longest_pause": round(mg, 2), "forced": False})
    # forced: the first draw, its longest inter-episode pause stretched to 60 s (later episodes shifted, cut at the end)
    pl, eps = first
    gaps = [eps[i + 1][0] - eps[i][1] for i in range(len(eps) - 1)]
    if gaps:
        i = int(np.argmax(gaps))
        shift = max(0.0, 60.0 - gaps[i])
        cut = eps[i + 1][0]
        pl2 = []
        for p in pl:
            if p["at"] >= cut - 1e-9:
                at = p["at"] + shift
                if at >= LEN - 0.5:
                    continue
                pl2.append(dict(p, at=round(at, 4), len=round(min(p["len"], LEN - at), 4)))
            else:
                pl2.append(p)
        eps = [(a + (shift if a >= cut - 1e-9 else 0), min(LEN, b + (shift if a >= cut - 1e-9 else 0))) for a, b in eps if a + (shift if a >= cut - 1e-9 else 0) < LEN - 0.5]
        pl = pl2
    vf, mg = check(pl, eps)
    return finish(pl, eps, {"sub_seed": None, "voice_fraction": round(vf, 4), "longest_pause": round(mg, 2), "forced": True})


def finish(pl, eps, info):
    occ = sorted((p["at"], p["at"] + p["len"]) for p in pl)
    stretches, t = [], 0.0
    for a, b in occ:
        if a > t + 1e-6:
            stretches.append([round(t, 4), round(a, 4)])
        t = max(t, b)
    if t < LEN:
        stretches.append([round(t, 4), LEN])
    info["episodes"] = len(eps)
    return pl, stretches, info


def loop_bed(x, n, fade_s=1.0):
    """Noise bed: x looped with linear cross-fades of fade_s to n samples."""
    x = np.asarray(x, np.float64)
    nf = int(round(fade_s * SR))
    if len(x) >= n:
        return x[:n].copy()
    nf = min(nf, len(x) // 2)
    out = x.copy()
    while len(out) < n:
        w = np.linspace(0, 1, nf)
        out[-nf:] = out[-nf:] * (1 - w) + x[:nf] * w
        out = np.concatenate([out, x[nf:]])
    return out[:n]


def render(recs, audio, pl, seed, bed=None, snr_db=None):
    """recs[i]['dur'], audio[i] = float array (16 kHz). Returns (mix float32, voice gain, noise gain, scale, level_db)."""
    n = int(round(LEN * SR))
    v = np.zeros(n)
    fade = int(0.01 * SR)
    for p in pl:
        x = audio[p["rec"]]
        a = int(round(p["at"] * SR))
        f0 = int(round(p.get("from", 0.0) * SR))
        m = min(int(round(p["len"] * SR)), len(x) - f0, n - a)
        seg = x[f0:f0 + m].astype(np.float64)
        e = np.minimum(np.minimum(1.0, (np.arange(m) + 1) / fade), (m - np.arange(m)) / fade)
        v[a:a + m] += seg * e
    rng = np.random.default_rng([seed, 7])
    level_db = -26.0 + rng.uniform(-6.0, 6.0)
    vg = 10 ** (level_db / 20) / max(active_rms(v), 1e-12)
    mix = vg * v
    ng = 0.0
    if bed is not None:
        b = loop_bed(bed, n)
        ng = 10 ** (level_db / 20) / (10 ** (snr_db / 20)) / max(float(np.sqrt(np.mean(np.square(b)))), 1e-12)
        mix = mix + ng * b
    else:
        mix = mix + np.random.default_rng([seed, 8]).standard_normal(n) * 10 ** (-70 / 20)
    pk = float(np.max(np.abs(mix)))
    sc = 1.0 if pk <= 0.999 else 0.999 / pk
    return (mix * sc).astype(np.float32), vg, ng, sc, level_db
