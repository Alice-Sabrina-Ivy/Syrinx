# sweep.py — threshold x hangover sweep for a probability-file candidate
# (voice-detector benchmark, 2026-10-06), built on score.py's own alignment
# (hop_probs) and hangover rule, so every grid point equals what score.py
# would report for that candidate.json. Applies the PRE-REGISTERED selection
# rule: among the operating points that meet V1 (every clean set <= 1 % in its
# worse gender, every voice-in-noise cell <= 3 %), take the best V2 on the
# TUNING split (194 noise clips; the held-out 85 and the 119 are never looked
# at for the choice). Also the trade-off: best tuning V2 when V1 is relaxed to
# X % (clean sets <= X, voice-in-noise cells <= max(3, X)).
#
#   python scripts/voice-detector/silero/sweep.py CAND_DIR [--root=build/vad]
#          [--thr=0.05,0.1,...] [--hang=0,100,...] [--csv=OUT] [--write-best]
# CAND_DIR holds candidate.json (hop / availability / lookahead / agg used as
# declared; threshold / hangover are swept) and the .f32 probability files.
# --write-best rewrites CAND_DIR/candidate.json with the selected point.
import json
import os
import sys

import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
MY = dict((a[2:].split("=", 1) + ["1"])[:2] for a in sys.argv[1:] if a.startswith("--"))
CAND = [a for a in sys.argv[1:] if not a.startswith("--")][0]
ROOT = MY.get("root", "build/vad")
sys.argv = [sys.argv[0], f"--root={ROOT}"]  # score.py parses argv at import
sys.path.insert(0, os.path.join(HERE, ".."))
sys.path.insert(0, os.path.join(HERE, "..", "lib"))
import score as S  # noqa: E402
from streams import list_streams, load_dump  # noqa: E402

THR = [float(v) for v in MY.get("thr", "0.01,0.02,0.03,0.05,0.07,0.1,0.15,0.2,0.25,0.3,0.35,0.4,0.45,0.5,0.55,0.6,0.65,0.7,0.8,0.9").split(",")]
HANG = [float(v) for v in MY.get("hang", "0,50,100,150,200,250,300,400,500,750,1000,1500,2000,3000,5000").split(",")]
CLEAN_ROWS = [r for r, _ in S.V1_SETS]
MIX_ROWS = [f"vin {s} {snr}" for s, snr in S.V1_MIX]


def groups_of(meta):
    """V1 row (or None) and the V2 groups a stream's hops count toward."""
    s = meta["set"]
    g = S.gnorm(meta.get("gender"))
    v1 = None
    for row, sets in S.V1_SETS:
        if s in sets:
            v1 = (row, g)
    if s in ("vin20", "vin0"):
        v1 = (f"vin {s} {meta.get('snr_db')}", g)
    v2 = []
    if s == "noise":
        v2 += ["all279", "tune194" if meta.get("split") == "tune" else "held85", f"class:{meta.get('label')}", f"room:{meta.get('cls')}"]
    if s == "noiseho":
        v2 += ["ho119", f"ho:{meta.get('source')}", f"ho-room:{meta.get('cls')}"]
    return v1, v2, g


def main():
    spec = S.load_cand(CAND)
    look = spec["lookahead_ms"]
    streams = []
    for meta in list_streams(ROOT):
        cols = load_dump(ROOT, meta)
        paint, lab = cols["paint"] > 0, cols["lab"].astype(np.int8)
        P = np.fromfile(os.path.join(spec["_dir"], meta["set"], meta["id"] + ".f32"), dtype="<f4").astype(np.float64)
        p = S.hop_probs(spec, meta, P)
        n = meta["n"]
        t = (np.arange(n) + 1) * meta["hop_s"]
        v1, v2, g = groups_of(meta)
        ons = []
        for s, e in S.onsets(cols["paint"], lab):
            rel = np.nonzero(paint[s:e + 1])[0]
            ons.append((s, e, rel))
        streams.append({"p": p, "t": t, "corr": paint & (lab == 1), "false": paint & (lab == 2), "v1": v1, "v2": v2, "g": g,
                        "set": meta["set"], "ons": ons, "hop_ms": meta["hop_s"] * 1000})
    print(f"{len(streams)} streams loaded", file=sys.stderr)
    H = np.array(HANG) / 1000.0 + 1e-9
    results = []
    for thr in THR:
        c_since, f_since, f_tot = {}, {}, {}
        onset_d = {"f": [], "m": [], "unknown": []}  # rows: delay_ms per hangover
        for st in streams:
            on = st["p"] >= thr
            last = np.maximum.accumulate(np.where(on, st["t"], -np.inf))
            since = st["t"] - last
            if st["v1"]:
                c_since.setdefault(st["v1"], []).append(since[st["corr"]])
                for s, e, rel in st["ons"]:
                    pm = np.minimum.accumulate(since[s + rel])
                    k = np.searchsorted(-pm, -H, side="left")  # leading painted hops still vetoed
                    d = np.where(k < len(rel), rel[np.minimum(k, len(rel) - 1)], e - s + 1)
                    onset_d[st["g"]].append(d * st["hop_ms"] + look)
            for grp in st["v2"]:
                f_since.setdefault(grp, []).append(since[st["false"]])
        for d in (c_since, f_since):
            for k in d:
                d[k] = np.sort(np.concatenate(d[k]))
        for hi, h in enumerate(H):
            rec = {"thr": thr, "hang_ms": HANG[hi]}
            v1 = {}
            for (row, g), arr in c_since.items():
                if len(arr):
                    vet = len(arr) - np.searchsorted(arr, h, side="right")
                    v1.setdefault(row, {})[g] = 100.0 * vet / len(arr)
            rec["v1"] = {row: max(gs.values()) for row, gs in v1.items()}
            rec["v1_g"] = v1
            v2 = {}
            for grp, arr in f_since.items():
                if len(arr):
                    vet = len(arr) - np.searchsorted(arr, h, side="right")
                    v2[grp] = 100.0 * vet / len(arr)
            rec["v2"] = v2
            med = {g: float(np.median([x[hi] for x in ds])) for g, ds in onset_d.items() if ds}
            rec["onset_med"] = med
            rec["onset_worse"] = max(med.values())
            rec["clean_max"] = max(rec["v1"][r] for r in CLEAN_ROWS)
            rec["mix_max"] = max(rec["v1"][r] for r in MIX_ROWS)
            results.append(rec)
        print(f"thr {thr}: done", file=sys.stderr)

    def best(cap_clean, cap_mix):
        ok = [r for r in results if r["clean_max"] <= cap_clean and r["mix_max"] <= cap_mix]
        return max(ok, key=lambda r: (r["v2"]["tune194"], -r["clean_max"])) if ok else None

    def line(r):
        if r is None:
            return "no operating point"
        return (f"thr {r['thr']}, hangover {r['hang_ms']:.0f} ms: V2 tune194 {r['v2']['tune194']:.2f} % "
                f"(all279 {r['v2']['all279']:.2f}, held85 {r['v2']['held85']:.2f}, ho119 {r['v2']['ho119']:.2f}); "
                f"V1 clean max {r['clean_max']:.2f} %, mix max {r['mix_max']:.2f} %; onset median worse {r['onset_worse']:.1f} ms")

    print("\n# selection (pre-registered): best tuning V2 among points meeting V1 (clean <= 1 %, mixes <= 3 %)")
    sel = best(S.V1_LIMIT, S.V1_MIX_LIMIT)
    print("SELECTED:", line(sel))
    print("\n# trade-off: V1 relaxed to X % (clean <= X, mixes <= max(3, X))")
    for X in (1.0, 2.0, 5.0, 10.0, 20.0):
        print(f"X = {X:g} %:", line(best(X, max(S.V1_MIX_LIMIT, X))))
    print("\n# least-vetoing points (V1 floor): lowest clean max per threshold")
    for thr in THR:
        rr = [r for r in results if r["thr"] == thr]
        r = min(rr, key=lambda r: (r["clean_max"], -r["v2"]["tune194"]))
        print(line(r), " | per row:", ", ".join(f"{k.split(' ')[0]} {v:.2f}" for k, v in r["v1"].items()))
    if MY.get("csv"):
        keys = CLEAN_ROWS + MIX_ROWS
        v2k = ["tune194", "all279", "held85", "ho119"]
        with open(MY["csv"], "w", encoding="utf8") as f:
            f.write("thr,hang_ms," + ",".join(f'"{k}"' for k in keys) + ",clean_max,mix_max," + ",".join(v2k) + ",onset_med_worse\n")
            for r in results:
                f.write(f"{r['thr']},{r['hang_ms']:.0f}," + ",".join(f"{r['v1'][k]:.3f}" for k in keys) +
                        f",{r['clean_max']:.3f},{r['mix_max']:.3f}," + ",".join(f"{r['v2'][k]:.3f}" for k in v2k) + f",{r['onset_worse']:.1f}\n")
    if MY.get("json"):
        with open(MY["json"], "w", encoding="utf8") as f:
            json.dump({"selected": sel, "grid": results}, f, indent=0)
    if "write-best" in MY and sel:
        p = os.path.join(spec["_dir"], "candidate.json")
        with open(p, encoding="utf8") as f:
            cj = json.load(f)
        cj["threshold"], cj["hangover_ms"] = sel["thr"], sel["hang_ms"]
        with open(p, "w", encoding="utf8") as f:
            json.dump(cj, f, indent=1)
        print(f"wrote {p}")


if __name__ == "__main__":
    main()
