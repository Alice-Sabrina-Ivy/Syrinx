# sweep-ten.py — operating-point sweep for the TEN VAD candidate
# (voice-detector benchmark, 2026-10-06). Uses score.py's own alignment
# (hop_probs) and voice/hangover rule (voice_flags semantics) on a grid of
# threshold x hangover, with the candidate's fixed timing (candidate.json
# minus threshold / hangover), and applies the PRE-REGISTERED selection rule:
#
#   among the grid points that meet V1 (every V1 row's worse gender <= 1 %
#   on the clean sets, <= 3 % on each voice-in-noise cell), take the one with
#   the best V2 on the TUNING split only (noise split "tune", 194 clips; the
#   in-set held-out 85 and the second held-out set 119 are never looked at
#   for the choice). Ties: lower worst-V1 share, then the lower threshold.
#
# Also the trade-off: best tuning-split V2 when the clean V1 rows may veto up
# to 2 % (mix cells at the bar's 3 %) / 5 % (mix cells 5 %); and the "every
# row <= 2 %" and "clean <= 5 %, mix <= 3 %" readings. Writes the chosen threshold +
# hangover into <cand>/candidate.json only with --write; the final numbers
# come from score.py on that file.
#
#   python scripts/voice-detector/ten/sweep-ten.py [--cand=build/vad/cand/ten] [--root=build/vad]
#          [--out=build/vad/ten/sweep.json] [--write]
import json
import os
import sys

import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
A = dict((a[2:].split("=", 1) + ["1"])[:2] for a in sys.argv[1:] if a.startswith("--"))
ROOT = A.get("root", "build/vad")
CAND = A.get("cand", os.path.join(ROOT, "cand", "ten"))
OUT = A.get("out", os.path.join(ROOT, "ten", "sweep.json"))
sys.argv = [sys.argv[0], f"--root={ROOT}"]  # score.py parses argv at import
sys.path.insert(0, os.path.join(HERE, ".."))
sys.path.insert(0, os.path.join(HERE, "..", "lib"))
import score  # noqa: E402
from streams import list_streams, load_dump  # noqa: E402

THR = np.array([0.01, 0.02, 0.03, 0.04, 0.05, 0.075, 0.1, 0.125, 0.15, 0.175, 0.2, 0.25, 0.3, 0.35, 0.4,
                0.45, 0.5, 0.55, 0.6, 0.65, 0.7, 0.75, 0.8, 0.85, 0.9, 0.95])
HANG = np.array([0, 25, 50, 75, 100, 150, 200, 250, 300, 400, 500, 600, 800, 1000, 1500, 2000, 3000, 4000, 5000, 7500, 10000], float)
V1_ROWS = [(row, sets, None) for row, sets in score.V1_SETS] + [
    (f"voice in noise {'+' if snr > 0 else ''}{snr} dB, lead {'20 s' if s == 'vin20' else '0'}", [s], snr)
    for s, snr in score.V1_MIX]


def v1_row_of(meta):
    for row, sets, snr in V1_ROWS:
        if meta["set"] in sets and (snr is None or meta.get("snr_db") == snr):
            return row
    return None


def v2_keys(meta):
    if meta["set"] == "noise":
        k = ["noise all 279", f"noise split {meta.get('split')}", f"class {meta.get('label')}"]
        if meta.get("cls") in score.MACHINE_ROOMS:
            k.append(f"room {meta['cls']} (279)")
        return k
    if meta["set"] == "noiseho":
        k = ["noiseho 119", f"noiseho {meta.get('source')}"]
        if meta.get("cls") in score.MACHINE_ROOMS:
            k.append(f"room {meta['cls']} (held-out B)")
        return k
    return []


def main():
    with open(os.path.join(CAND, "candidate.json"), encoding="utf8") as f:
        spec = json.load(f)
    spec.setdefault("agg", "last")
    spec.setdefault("p_before_first", 0.0)
    spec["name"] = spec.get("name", "ten")
    nT, nH = len(THR), len(HANG)
    v1 = {}  # (row, gender) -> [total, vetoed[nT, nH]]
    v2 = {}  # key -> [total, vetoed[nT, nH]]
    for meta in list_streams(ROOT):
        row, keys = v1_row_of(meta), v2_keys(meta)
        if row is None and not keys:
            continue
        cols = load_dump(ROOT, meta)
        paint, lab = cols["paint"], cols["lab"].astype(np.int8)
        P = np.fromfile(os.path.join(CAND, meta["set"], meta["id"] + ".f32"), dtype="<f4").astype(np.float64)
        p = score.hop_probs(spec, meta, P)
        t = (np.arange(meta["n"]) + 1) * meta["hop_s"]
        sel_c = (lab == 1) & (paint > 0)
        sel_f = (lab == 2) & (paint > 0)
        cnt_c = np.zeros((nT, nH), np.int64)
        cnt_f = np.zeros((nT, nH), np.int64)
        for i, th in enumerate(THR):
            on = p >= th
            last = np.maximum.accumulate(np.where(on, t, -np.inf))
            d = (t - last) * 1000.0  # ms since the last hop with p >= threshold (inf: none yet)
            if row is not None and sel_c.any():
                cnt_c[i] = (d[sel_c][:, None] > HANG[None, :] + 1e-6).sum(0)
            if keys and sel_f.any():
                cnt_f[i] = (d[sel_f][:, None] > HANG[None, :] + 1e-6).sum(0)
        if row is not None:
            k = (row, score.gnorm(meta.get("gender")))
            e = v1.setdefault(k, [0, np.zeros((nT, nH), np.int64)])
            e[0] += int(sel_c.sum())
            e[1] += cnt_c
        for key in keys:
            e = v2.setdefault(key, [0, np.zeros((nT, nH), np.int64)])
            e[0] += int(sel_f.sum())
            e[1] += cnt_f
    # per V1 row: worse gender share [nT, nH]
    rows = {}
    for (row, g), (tot, vet) in v1.items():
        if tot == 0:
            continue
        s = 100.0 * vet / tot
        rows[row] = s if row not in rows else np.maximum(rows[row], s)
    clean = [r for r, _, snr in V1_ROWS if snr is None]
    mixes = [r for r, _, snr in V1_ROWS if snr is not None]
    worst_clean = np.max([rows[r] for r in clean], axis=0)
    worst_mix = np.max([rows[r] for r in mixes], axis=0)
    v2pct = {k: 100.0 * vet / tot for k, (tot, vet) in v2.items() if tot}
    tune = v2pct["noise split tune"]

    def pick(lim_clean, lim_mix):
        ok = (worst_clean <= lim_clean + 1e-12) & (worst_mix <= lim_mix + 1e-12)
        if not ok.any():
            return None
        cands = [(-tune[i, j], max(worst_clean[i, j], worst_mix[i, j]), THR[i], i, j)
                 for i in range(nT) for j in range(nH) if ok[i, j]]
        cands.sort()
        _, _, _, i, j = cands[0]
        return {"threshold": float(THR[i]), "hangover_ms": float(HANG[j]),
                "v1_worst_clean": float(worst_clean[i, j]), "v1_worst_mix": float(worst_mix[i, j]),
                "v1_rows": {r: float(rows[r][i, j]) for r in rows},
                "v2": {k: float(v[i, j]) for k, v in v2pct.items()},
                "v2_false_hops": {k: int(v2[k][0]) for k in v2pct}}

    res = {"spec": {k: v for k, v in spec.items() if k not in ("threshold", "hangover_ms")},
           "grid": {"threshold": THR.tolist(), "hangover_ms": HANG.tolist()},
           "rule": "max V2 on noise split 'tune' (194) s.t. every V1 row's worse gender <= limit; ties: lower worst V1, lower threshold",
           "chosen_bar": pick(score.V1_LIMIT, score.V1_MIX_LIMIT),
           "tradeoff_2pct": pick(2.0, 3.0),        # clean rows <= 2 %, mix cells at the bar's 3 %
           "tradeoff_5pct": pick(5.0, 5.0),        # clean rows <= 5 %, mix cells <= 5 %
           "tradeoff_2pct_all": pick(2.0, 2.0),    # every row (clean and mix) <= 2 %
           "tradeoff_5pct_clean_3pct_mix": pick(5.0, 3.0),
           "worst_clean": worst_clean.tolist(), "worst_mix": worst_mix.tolist(),
           "v1_rows": {r: v.tolist() for r, v in rows.items()},
           "v2": {k: v.tolist() for k, v in v2pct.items()}}
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    with open(OUT, "w", encoding="utf8") as f:
        json.dump(res, f, indent=1)
    sys.stdout.reconfigure(encoding="utf-8")
    print("worst V1 (clean | mix) and tuning-split V2 per threshold x hangover:")
    print("thr \\ hang " + " ".join(f"{h:>14.0f}" for h in HANG))
    for i, th in enumerate(THR):
        print(f"{th:>10.3f} " + " ".join(f"{worst_clean[i, j]:4.1f}|{worst_mix[i, j]:4.1f}|{tune[i, j]:4.1f}" for j in range(nH)))
    for k in ("chosen_bar", "tradeoff_2pct", "tradeoff_5pct", "tradeoff_2pct_all", "tradeoff_5pct_clean_3pct_mix"):
        c = res[k]
        if c is None:
            print(f"{k}: no grid point meets the V1 limits")
        else:
            print(f"{k}: thr {c['threshold']} hang {c['hangover_ms']} ms | V1 worst clean {c['v1_worst_clean']:.2f} mix {c['v1_worst_mix']:.2f} | "
                  f"V2 tune {c['v2']['noise split tune']:.2f} all279 {c['v2']['noise all 279']:.2f} held85 {c['v2']['noise split held']:.2f} "
                  f"ho119 {c['v2']['noiseho 119']:.2f}")
            print("    V1 rows: " + ", ".join(f"{r}: {v:.2f}" for r, v in c["v1_rows"].items()))
    if "write" in A and res["chosen_bar"]:
        spec["threshold"] = res["chosen_bar"]["threshold"]
        spec["hangover_ms"] = res["chosen_bar"]["hangover_ms"]
        with open(os.path.join(CAND, "candidate.json"), "w", encoding="utf8") as f:
            json.dump(spec, f, indent=1)
        print(f"wrote threshold {spec['threshold']} hangover {spec['hangover_ms']} ms into {CAND}/candidate.json")


if __name__ == "__main__":
    main()
