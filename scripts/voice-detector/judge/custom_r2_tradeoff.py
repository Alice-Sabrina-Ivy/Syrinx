# custom_r2_tradeoff.py — custom voice detector, round 2 (2026-10-07):
# POST-HOC threshold x hangover grid of a candidate's harness files (agg as
# frozen), taken after the round-2 look — for the fresh-state files and for
# the carried-state files (infer_carried.py) of either round. First checks
# that custom_fastscore reproduces the candidate's score.py JSON at its own
# point. No point found here is a selection or a pass of the bar.
#   python scripts/voice-detector/judge/custom_r2_tradeoff.py --cand=DIR --ref=SCORE_JSON --out=JSON
import json
import os
import sys
import time

MY = dict((a[2:].split("=", 1) + ["1"])[:2] for a in sys.argv[1:] if a.startswith("--"))
sys.argv = [sys.argv[0]]
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import custom_fastscore as F  # noqa: E402

TH = [0.01, 0.02, 0.03, 0.05, 0.07, 0.1, 0.13, 0.16, 0.2, 0.25, 0.3, 0.4, 0.5]
HG = [0, 250, 500, 1000, 1250, 2000, 3000, 5000]


def main():
    t0 = time.time()
    C = F.Cache(MY["cand"])
    spec, rows, res = C.score()
    bad = 0
    if MY.get("ref"):
        ref = list(json.load(open(MY["ref"], encoding="utf8"))["candidates"].values())[0]
        for sec in ("V1", "V2"):
            for k, x in ref[sec].items():
                y = res[sec][k]
                for kk in ("worse_pct", "pct"):
                    if kk in x and abs(x[kk] - y[kk]) > 1e-9:
                        bad += 1
    out = {"cand": MY["cand"], "parity_mismatches": bad, "frozen": F.summary(res), "grid": []}
    for h in HG:
        for th in TH:
            _, _, r = C.score(th, h)
            s = F.summary(r)
            s.update({"thr": th, "hang": h})
            out["grid"].append(s)
    with open(MY["out"], "w", encoding="utf8") as f:
        json.dump(out, f, indent=1, default=str)
    # best V2 on the 279 among points meeting V1 (clean <= 1 %, every mix cell <= 3 %)
    ok = [g for g in out["grid"] if g["worst_clean"][2] <= 1.0 and g["worst_mix"][2] <= 3.0]
    best = max(ok, key=lambda g: g["v2_279"]) if ok else None
    print(f"{MY['cand']}: parity {bad} mismatches; frozen point V2 {out['frozen']['v2_279']:.2f} / {out['frozen']['v2_A']:.2f} / {out['frozen']['v2_B']:.2f}; "
          f"V1 worst clean {out['frozen']['worst_clean'][2]:.2f}, mix {out['frozen']['worst_mix'][2]:.2f}")
    if best:
        print(f"  post-hoc best V2 among points meeting V1: p >= {best['thr']}, {best['hang']} ms -> V2 {best['v2_279']:.2f} / {best['v2_A']:.2f} / {best['v2_B']:.2f}; "
              f"worst clean {best['worst_clean'][2]:.2f}, mix {best['worst_mix'][2]:.2f}; {len(ok)} of {len(out['grid'])} points meet V1, "
              f"{sum(1 for g in ok if g['v2_279'] >= 60 and g['v2_A'] >= 50 and g['v2_B'] >= 50)} meet V1 and V2")
    print(f"  ({time.time() - t0:.0f} s)")


if __name__ == "__main__":
    main()
