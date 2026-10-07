# sweep.py — operating-point sweep for the YAMNet candidate (voice-detector
# benchmark, 2026-10-06). Uses the harness's OWN alignment, hangover and
# onset code (score.py hop_probs / voice_flags / onsets, imported, not
# copied), loads the dumps once, and evaluates a grid of thresholds x
# hangovers for each variant (grid hop, agg, lookahead).
#
# Selection rule (pre-registered in the task, applied mechanically here):
# among the operating points that meet V1 (every clean row <= 1 % and every
# voice-in-noise cell <= 3 %, worse gender), the one with the best V2 on the
# TUNING split of the noise set (194 clips; the 85-clip in-set held-out split
# and the 119-clip second held-out set are never used to choose). Ties: lower
# worst-row V1 ratio. If NO point meets V1, the point with the smallest worst
# V1 ratio (veto % / limit) is reported as "closest", flagged as failing.
# Trade-off: the best tuning V2 when the clean-set limit is relaxed to 2 % and
# 5 % (the mix limit becomes max(3, X)); and the point with tuning V2 >= 60 %
# that has the smallest worst V1 ratio (what reaching the V2 bar costs).
#
#   python scripts/voice-detector/events/sweep.py --scores=build/vad/events/scores/pw8d16
#          [--root=build/vad] [--variant=frame|ctx|centered|all] [--hops=1,6,7,8,12 (multiples of the grid)] [--json=OUT]
import importlib.util
import json
import os
import sys

import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
A = dict((a[2:].split("=", 1) + ["1"])[:2] for a in sys.argv[1:] if a.startswith("--"))
ROOT = A.get("root", "build/vad")
SC = A["scores"]

# import the harness scorer without letting it parse our argv
_argv = sys.argv
sys.argv = ["score.py", f"--root={ROOT}"]
spec_ = importlib.util.spec_from_file_location("vdscore", os.path.join(HERE, "..", "score.py"))
S = importlib.util.module_from_spec(spec_)
spec_.loader.exec_module(S)
sys.argv = _argv
from streams import list_streams, load_dump  # noqa: E402  (score.py put lib/ on sys.path)

V1_ROWS = [(nm, sets, None, S.V1_LIMIT) for nm, sets in S.V1_SETS] + \
          [(f"{s} {snr:+d} dB", [s], snr, S.V1_MIX_LIMIT) for s, snr in S.V1_MIX]
GENDERS = ["f", "m", "unknown"]

# variants: grid hop multiple m of the 20 ms base grid, agg, lookahead, hangover grid (ms)
HANG_FRAME = [0, 40, 80, 120, 160, 240, 320, 480, 640, 800, 960]  # 'frame' gate: < 1 s
HANG_CTX = [1000, 2000, 3000, 5000, 8000, 12000, 20000]  # 'context' gate: >= 1 s
THRS = [0.001, 0.002, 0.005, 0.01, 0.02, 0.03, 0.05, 0.07, 0.1, 0.15, 0.2, 0.25, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9]


def load_streams():
    out = []
    for meta in list_streams(ROOT):
        cols = load_dump(ROOT, meta)
        fp = os.path.join(SC, meta["set"], meta["id"] + ".npz")
        z = np.load(fp)
        out.append((meta, cols["paint"] > 0, cols["lab"].astype(np.int8), np.clip(z["voice"].astype(np.float64), 0, 1),
                    int(z["hop_frames"])))
    return out


def build_index(streams):
    """Global per-hop arrays + group ids (built once)."""
    rows_of_set = {}
    for ri, (nm, sets, snr, lim) in enumerate(V1_ROWS):
        for s in sets:
            rows_of_set.setdefault(s, []).append((ri, snr))
    g_row, g_gen, g_lab, g_paint, g_tloc, g_start, g_v2 = [], [], [], [], [], [], []
    onset_s, onset_e, onset_g, onset_set = [], [], [], []
    off = 0
    for meta, paint, lab, _, _ in streams:
        n = meta["n"]
        gen = S.gnorm(meta.get("gender"))
        ri = -1
        for r, snr in rows_of_set.get(meta["set"], []):
            if snr is None or meta.get("snr_db") == snr:
                ri = r
        g_row.append(np.full(n, ri, np.int16))
        g_gen.append(np.full(n, GENDERS.index(gen), np.int8))
        g_lab.append(lab)
        g_paint.append(paint)
        g_tloc.append((np.arange(n) + 1) * meta["hop_s"])  # the harness's own t (score.voice_flags)
        g_start.append(np.full(n, off, np.int64))
        v2 = 0
        if meta["set"] == "noise":
            v2 = 1 if meta.get("split") == "tune" else 2
        elif meta["set"] == "noiseho":
            v2 = 3
        g_v2.append(np.full(n, v2, np.int8))
        if ri >= 0 or meta["set"] in ("vin20", "vin0"):
            for s, e in S.onsets(paint.astype(np.float32), lab):
                onset_s.append(off + s)
                onset_e.append(off + e)
                onset_g.append(GENDERS.index(gen))
                onset_set.append(meta["set"])
        off += n
    G = {"row": np.concatenate(g_row), "gen": np.concatenate(g_gen), "lab": np.concatenate(g_lab),
         "paint": np.concatenate(g_paint), "t": np.concatenate(g_tloc), "start": np.concatenate(g_start), "v2": np.concatenate(g_v2),
         "on_s": np.array(onset_s), "on_e": np.array(onset_e), "on_g": np.array(onset_g), "on_set": np.array(onset_set)}
    G["hop_ms"] = np.concatenate([np.full(m["n"], m["hop_s"] * 1000) for m, *_ in streams])
    return G


def hop_p(streams, m, agg, look):
    out = []
    for meta, paint, lab, voice, hf in streams:
        P = voice[::m]
        spec = {"name": "x", "first_avail_ms": 25.0, "hop_ms": 10.0 * hf * m, "lookahead_ms": look, "agg": agg,
                "p_before_first": 0.0, "threshold": 0.5, "hangover_ms": 0}
        out.append(S.hop_probs(spec, meta, P))
    return np.concatenate(out)


def evaluate(G, p, thr, hang_ms, look):
    # score.voice_flags, per stream, vectorized: the last hop with p >= thr in
    # the same stream, and the same float arithmetic on the stream's own t
    on = p >= thr
    idx = np.arange(len(p))
    li = np.maximum.accumulate(np.where(on, idx, -1))
    ok = li >= G["start"]
    lt = np.where(ok, G["t"][np.maximum(li, 0)], -np.inf)
    voice = on | (G["t"] - lt <= hang_ms / 1000.0 + 1e-9)
    veto = G["paint"] & ~voice
    res = {"thr": thr, "hang": hang_ms}
    # V1
    cor = G["lab"] == 1
    m = cor & (G["row"] >= 0)
    key = G["row"][m].astype(np.int64) * 3 + G["gen"][m]
    tot = np.bincount(key, minlength=len(V1_ROWS) * 3)
    vet = np.bincount(key, weights=veto[m], minlength=len(V1_ROWS) * 3)
    v1 = []
    for ri, (nm, sets, snr, lim) in enumerate(V1_ROWS):
        worst = 0.0
        for gi in range(3):
            a = tot[ri * 3 + gi]
            if a:
                worst = max(worst, 100.0 * vet[ri * 3 + gi] / a)
        v1.append(worst)
    res["v1"] = v1
    # V2
    fal = G["lab"] == 2
    for k, code in (("v2_tune", 1), ("v2_heldA", 2), ("v2_heldB", 3)):
        mm = fal & (G["v2"] == code)
        res[k] = 100.0 * veto[mm].sum() / max(mm.sum(), 1)
    mm = fal & ((G["v2"] == 1) | (G["v2"] == 2))
    res["v2_279"] = 100.0 * veto[mm].sum() / max(mm.sum(), 1)
    # V3 onset delay: first un-vetoed painted hop at or after the onset
    ok = G["paint"] & ~veto
    idx = np.where(ok, np.arange(len(ok)), np.iinfo(np.int64).max)
    nxt = np.minimum.accumulate(idx[::-1])[::-1]
    s, e = G["on_s"], G["on_e"]
    first = nxt[s]
    cens = first > e
    hops = np.where(cens, e - s + 1, first - s)
    ms = hops * G["hop_ms"][s] + look
    med = {}
    for gi in range(3):
        sel = G["on_g"] == gi
        if sel.any():
            med[GENDERS[gi]] = float(np.median(ms[sel]))
    res["v3_median_worse"] = max(med.values())
    res["v3_by_gender"] = med
    res["v3_never_pct"] = 100.0 * cens.mean()
    return res


def v1_ratio(r, clean_lim=1.0, mix_lim=3.0):
    rat = 0.0
    for (nm, sets, snr, lim), v in zip(V1_ROWS, r["v1"]):
        L = clean_lim if snr is None else mix_lim
        rat = max(rat, v / L)
    return rat


def select(results, clean_lim=1.0, mix_lim=3.0):
    ok = [r for r in results if v1_ratio(r, clean_lim, mix_lim) <= 1.0 + 1e-12]
    if ok:
        return max(ok, key=lambda r: (r["v2_tune"], -v1_ratio(r, clean_lim, mix_lim))), True
    return min(results, key=lambda r: (v1_ratio(r, clean_lim, mix_lim), -r["v2_tune"])), False


def main():
    streams = load_streams()
    G = build_index(streams)
    hf = streams[0][4]
    variants = {
        # name: (hop multiple of the base grid, agg, lookahead ms, hangover grid)
        "frame": [(m, "last", 0, HANG_FRAME) for m in [int(x) for x in A.get("hops", "1,6,7,8,12").split(",")]],
        "ctx": [(m, "last", 0, HANG_CTX) for m in [int(x) for x in A.get("hops", "1,6,7,8,12").split(",")]],
        "centered": [(1, "last", 360, HANG_FRAME)],  # info only: window centred on the painted audio (t_k - 120 ms)
    }
    want = A.get("variant", "all")
    out = {}
    for vn, cfgs in variants.items():
        if want != "all" and vn != want:
            continue
        for m, agg, look, hangs in cfgs:
            p = hop_p(streams, m, agg, look)
            res = [evaluate(G, p, t, h, look) for t in THRS for h in hangs]
            key = f"{vn}/hop{10 * hf * m}/{agg}/look{look}"
            best, ok = select(res)
            b2, ok2 = select(res, 2.0, 3.0)
            b5, ok5 = select(res, 5.0, 5.0)
            hi = [r for r in res if r["v2_tune"] >= S.V2_ALL_LIMIT]
            b60 = min(hi, key=lambda r: (v1_ratio(r), -r["v2_tune"])) if hi else None
            out[key] = {"all": res, "best": best, "best_ok": ok, "best2": b2, "ok2": ok2, "best5": b5, "ok5": ok5, "at_v2_60": b60}
            fmt = lambda r: (f"thr {r['thr']} hang {r['hang']}: V1 worst rows " + ", ".join(f"{x:.2f}" for x in r["v1"]) +
                             f" | V2 tune {r['v2_tune']:.1f} 279 {r['v2_279']:.1f} heldA {r['v2_heldA']:.1f} heldB {r['v2_heldB']:.1f}"
                             f" | onset med {r['v3_median_worse']:.0f} ms")
            print(f"== {key}")
            print(f"  V1@1%  {'MEETS' if ok else 'none meets; closest'}: {fmt(best)}")
            print(f"  V1@2%  {'MEETS' if ok2 else 'none meets; closest'}: {fmt(b2)}")
            print(f"  V1@5%  {'MEETS' if ok5 else 'none meets; closest'}: {fmt(b5)}")
            print(f"  V2tune>=60 % at the least V1 cost: {fmt(b60) if b60 else 'no point reaches it'}", flush=True)
    if A.get("json"):
        with open(A["json"], "w", encoding="utf8") as f:
            json.dump({"rows": [r[0] for r in V1_ROWS], "results": out}, f, indent=0)


if __name__ == "__main__":
    main()
