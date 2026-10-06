# check.py — parity of the voice-detector dumps with the published base
# numbers of the same production chain (voice-detector benchmark, 2026-10-06).
# The branch's src equals the base of measurements/pitch-hold-bridge-rework-
# 2026-10-06.md (21d0117, V19g), so these legacy metrics, recomputed from
# build/vad/dumps, must reproduce its base columns:
#   noise-only painted false voicing, clip mean      all 279 23.93 %, tuning 24.11, held-out 85 23.52,
#                                                    held-out 2 (119) 20.41, dcaseeval 18.12, fsheld 20.81
#   voice in noise, painted at pitch (8 %, vinscore.py), lead 0, 0 dB: all 392 54.34 %, held-out 135 55.58
# and, from realnoise-false-voicing-attribution-2026-10-05.md (V14 base; the
# V19g change may move them slightly): voice in noise 20 s lead painted
# +10 / 0 dB 82.12 / 54.99 %; FDA / PTDB-TUG painted max(F_err, M_err)
# 16.71 / 19.07 %.
#
#   python scripts/voice-detector/check.py [--root=build/vad]
import os
import sys

import numpy as np

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "lib"))
from streams import list_streams, load_dump  # noqa: E402

A = dict((a[2:].split("=", 1) + ["1"])[:2] for a in sys.argv[1:] if a.startswith("--"))
ROOT = A.get("root", "build/vad")


def main():
    sys.stdout.reconfigure(encoding="utf-8")
    nz = {}
    for meta in list_streams(ROOT, ["noise", "noiseho"]):
        c = load_dump(ROOT, meta)
        disp = np.isfinite(c["inten"])  # attr.py: share of the hops with a DSP frame
        nz.setdefault(meta["set"], []).append((meta, float(((c["paint"] > 0) & disp).sum() / max(disp.sum(), 1) * 100)))
    rows = [("all 279", nz.get("noise", []), 23.93), ("tuning 194", [x for x in nz.get("noise", []) if x[0]["split"] == "tune"], 24.11),
            ("held-out 85", [x for x in nz.get("noise", []) if x[0]["split"] == "held"], 23.52),
            ("held-out 2 (119)", nz.get("noiseho", []), 20.41),
            ("dcaseeval", [x for x in nz.get("noiseho", []) if x[0]["source"] == "dcaseeval"], 18.12),
            ("fsheld", [x for x in nz.get("noiseho", []) if x[0]["source"] == "fsheld"], 20.81)]
    print("| noise-only, clip-mean painted % | clips | dumps | published base |")
    print("|---|---|---|---|")
    for nm, rr, pub in rows:
        print(f"| {nm} | {len(rr)} | {np.mean([v for _, v in rr]) if rr else float('nan'):.2f} | {pub:.2f} |")
    print("\n| voice in noise, painted at pitch (8 %) | streams | dumps | published |")
    print("|---|---|---|---|")
    for s, pubs in (("vin0", {(0, "all"): 54.34, (0, "held"): 55.58}), ("vin20", {(10, "all"): 82.12, (0, "all"): 54.99})):
        acc = {}
        for meta in list_streams(ROOT, [s]):
            c = load_dump(ROOT, meta)
            n, hop, L = meta["n"], meta["hop_s"], meta["L"]
            k = np.arange(n)
            tws = (k + 1) * hop - 0.040
            td = tws - L * hop - 0.030
            valid = (td >= 0) & (tws <= n * hop - 0.3)
            prog = valid & (td >= meta["voice_t0"]) & (td <= meta["voice_t1"])
            r = c["refd"]
            vd = prog & (r > 0)
            p = np.where(np.isfinite(c["inten"]), c["paint"], 0)
            ok = vd & (p > 0) & (np.abs(p / np.where(r > 0, r, 1) - 1) < 0.08)
            for sp in ("all", meta["split"]):
                d = acc.setdefault((meta["snr_db"], sp), [0, 0, 0])
                d[0] += int(ok.sum()); d[1] += int(vd.sum()); d[2] += 1
        for (snr, sp), d in sorted(acc.items(), key=lambda kv: (-kv[0][0], kv[0][1])):
            pub = pubs.get((snr, sp))
            print(f"| {s} {snr:+d} dB {sp} | {d[2]} | {100 * d[0] / max(d[1], 1):.3f} | {'' if pub is None else f'{pub:.2f}'} |")
    print("\n| corpus, painted error % (5 %) | f | m | max(F, M) | published (V14 base) |")
    print("|---|---|---|---|---|")
    for s, pub in (("fda", 16.71), ("ptdb", 19.07), ("hil", None), ("voc", None)):
        g = {}
        for meta in list_streams(ROOT, [s]):
            c = load_dump(ROOT, meta)
            r = c["refd"]
            v = r > 0
            p = np.where(np.isfinite(c["inten"]), c["paint"], 0)
            ok = v & (np.abs(p / np.where(v, r, 1) - 1) < 0.05) & (p > 0)
            d = g.setdefault(meta["gender"], [0, 0])
            d[0] += int(ok.sum()); d[1] += int(v.sum())
        err = {k: 100 - 100 * a / max(b, 1) for k, (a, b) in g.items()}
        fm = [err[x] for x in ("f", "m") if x in err]
        print(f"| {s} | {err.get('f', float('nan')):.2f} | {err.get('m', float('nan')):.2f} | {max(fm) if fm else float('nan'):.2f} | {'' if pub is None else pub} |")


if __name__ == "__main__":
    main()
