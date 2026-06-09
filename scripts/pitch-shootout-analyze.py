"""Analysis for the 2026-06-09 pitch-detector shootout.

Consumes the per-hop datasets from scripts/pitch-shootout-extract.js
(corpora with laryngograph/expert ground truth + the user's 2026-05-26
session with Praat reference) and scores three detector configurations
on identical frames:

  swift          — SwiftF0 as shipped (confidence gate 0.5)
  swift+referee  — SwiftF0, but report pitch/2 when the normalized
                   autocorrelation at the doubled period is at least
                   (r at the reported period) - margin   [margin sweep]
  boersma-ac     — frame-local Praat-style autocorrelation detector

Usage:
  python -u scripts/pitch-shootout-analyze.py \
      build/pitch-compare/shootout-corpora.json \
      build/pitch-compare/shootout-session.json \
      measurements/pitch-detector-shootout-2026-06-09.json
"""

import json
import sys

import numpy as np

RATIO_TOL = 0.05
OCTAVE_REL_TOL = 0.10
FLIP_TOL = 0.2
MARGINS = [-0.05, -0.02, 0.0, 0.02, 0.05, 0.10]
BANDS = [(50, 80), (80, 110), (110, 150), (150, 220), (220, 350), (350, 600)]


def classify_arrays(reported, truth):
    """Vectorized classification. reported 0 = null. Returns dict of masks."""
    voiced = truth > 0
    rep = reported > 0
    null_mask = voiced & ~rep
    both = voiced & rep
    r = np.zeros_like(truth, dtype=float)
    r[both] = reported[both] / truth[both]
    correct = both & (np.abs(r - 1) < RATIO_TOL)
    big = np.where(r > 1, r, np.divide(1, r, out=np.zeros_like(r), where=r > 0))
    nearest = np.round(big)
    is_oct = both & (nearest >= 2) & (np.abs(big - nearest) / np.maximum(nearest, 1) < OCTAVE_REL_TOL) & ~correct
    oct_up = is_oct & (r > 1)
    oct_down = is_oct & (r < 1)
    other = both & ~correct & ~is_oct
    return {"voiced": voiced, "correct": correct, "octave-up": oct_up,
            "octave-down": oct_down, "other": other, "null": null_mask}


def flip_pct(series):
    vals = series[series > 0]
    if len(vals) < 2:
        return None
    r = vals[1:] / vals[:-1]
    r = np.where(r < 1, 1 / r, r)
    return round(100 * float((np.abs(r - 2) < FLIP_TOL).sum()) / len(r), 2)


def apply_referee(swift, rT, rHalf, margin):
    out = swift.copy()
    halve = (swift > 0) & (rT > 0) & (rHalf >= rT - margin)
    out[halve] = swift[halve] / 2
    return out, int(halve.sum())


def score(reported, truth, label_prefix=""):
    m = classify_arrays(reported, truth)
    total = int(m["voiced"].sum())
    res = {k: round(100 * float(v.sum()) / total, 2)
           for k, v in m.items() if k != "voiced"}
    res["meanErrHz"] = round(float(np.abs(reported[m["correct"]] - truth[m["correct"]]).mean()), 2) if m["correct"].sum() else None
    res["n"] = total
    return res


def by_band(reported, truth):
    out = {}
    for lo, hi in BANDS:
        sel = (truth >= lo) & (truth < hi)
        if sel.sum() < 200:
            continue
        out[f"{lo}-{hi}"] = score(reported[sel], truth[sel])
    return out


def main():
    corp = json.load(open(sys.argv[1]))
    sess = json.load(open(sys.argv[2]))
    out_path = sys.argv[3]

    report = {"margins": MARGINS, "corpora": {}, "session": {}}

    # ---------- corpora (ground truth) ----------
    by_corpus = {}
    for t in corp["tracks"]:
        by_corpus.setdefault(t["corpus"], []).append(np.array(t["rows"], dtype=float))
    print("========== Corpora (ground truth) ==========")
    for corpus, rowsets in sorted(by_corpus.items()):
        rows = np.vstack([r for r in rowsets if r.size])
        truth, swift, rT, rHalf, acp = rows.T
        entry = {"swift": score(swift, truth), "boersma-ac": score(acp, truth)}
        for mg in MARGINS:
            ref, halved = apply_referee(swift, rT, rHalf, mg)
            entry[f"swift+referee@{mg}"] = {**score(ref, truth), "halvedFrames": halved}
        report["corpora"][corpus] = entry
        print(f"\n  {corpus} (n={entry['swift']['n']}):")
        for k in ["swift", "boersma-ac"] + [f"swift+referee@{m}" for m in MARGINS]:
            e = entry[k]
            print(f"    {k:24} correct {e['correct']:5.1f}  up {e['octave-up']:5.2f}  "
                  f"down {e['octave-down']:5.2f}  other {e['other']:4.1f}  null {e['null']:5.1f}  "
                  f"meanErr {e['meanErrHz']}")

    # ---------- session (Praat reference) ----------
    rows = np.vstack([np.array(t["rows"], dtype=float) for t in sess["tracks"]])
    truth, swift, rT, rHalf, acp = rows.T
    print("\n========== 2026-05-26 session (Praat reference) ==========")
    sess_entry = {}
    for name, series in [("swift", swift), ("boersma-ac", acp)]:
        sess_entry[name] = {"overall": score(series, truth), "byBand": by_band(series, truth),
                            "flipPct": flip_pct(series)}
    for mg in MARGINS:
        ref, halved = apply_referee(swift, rT, rHalf, mg)
        sess_entry[f"swift+referee@{mg}"] = {"overall": score(ref, truth),
                                             "byBand": by_band(ref, truth),
                                             "flipPct": flip_pct(ref), "halvedFrames": halved}
    sess_entry["praat-self-flipPct"] = flip_pct(truth)
    report["session"] = sess_entry

    for k, e in sess_entry.items():
        if k == "praat-self-flipPct":
            continue
        o = e["overall"]
        b = e["byBand"].get("80-110", {})
        print(f"  {k:24} overall correct {o['correct']:5.1f} / up {o['octave-up']:5.2f} / null {o['null']:5.1f}"
              f"   | 80-110: correct {b.get('correct', '-'):5} up {b.get('octave-up', '-'):5} null {b.get('null', '-'):5}"
              f"   | flip {e['flipPct']}%")
    print(f"  praat self-flip rate: {sess_entry['praat-self-flipPct']}%")

    report["acPerFrameMs"] = {"corpora": corp.get("acPerFrameMs"), "session": sess.get("acPerFrameMs")}
    with open(out_path, "w") as f:
        json.dump(report, f, indent=1)
    print(f"\nsaved {out_path}")


if __name__ == "__main__":
    main()
