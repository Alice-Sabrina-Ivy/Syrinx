"""Cross-compare Praat CPPS vs Syrinx CPP per-track. P4 of WS2.

Loads both per-track JSONs (P2 Praat output + P3 Syrinx output),
joins on (corpus, track_id), computes:
  - Per-track Pearson r between Praat CPPS and Syrinx CPP
  - Bias (mean offset)
  - Per-corpus + per-gender breakdown
  - Per-F0-range breakdown via track-level F0 buckets (critical for
    the low-F0 regression-bias question — audit predicted Syrinx's
    linear-LSQ baseline would compress CPP at low F0 due to peak
    influence on the regression line)
  - Outlier tracks (|delta| > 2σ)

P5 decision:
  - High correlation across all ranges → algorithm validated
  - Low-F0 breakdown only → implement Theil-robust as iteration fix
  - Across-the-board breakdown → STOP and surface

Usage: python scripts/praat-syrinx-correlate.py
Output: measurements/praat-syrinx-correlation-2026-05-10.json
"""
import json
import math
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
PRAAT_PATH = ROOT / "measurements" / "praat-cpps-corpus-2026-05-10.json"
SYRINX_PATH = ROOT / "measurements" / "syrinx-cpp-corpus-2026-05-10.json"
OUT_PATH = ROOT / "measurements" / "praat-syrinx-correlation-2026-05-10.json"


def pearson(xs, ys):
    n = len(xs)
    if n < 2:
        return None
    mx = sum(xs) / n
    my = sum(ys) / n
    num = sum((x - mx) * (y - my) for x, y in zip(xs, ys))
    dx = math.sqrt(sum((x - mx) ** 2 for x in xs))
    dy = math.sqrt(sum((y - my) ** 2 for y in ys))
    if dx == 0 or dy == 0:
        return None
    return num / (dx * dy)


def percentile(sorted_arr, p):
    if not sorted_arr:
        return None
    idx = int(len(sorted_arr) * p)
    return sorted_arr[min(idx, len(sorted_arr) - 1)]


def describe(values):
    if not values:
        return {"n": 0}
    s = sorted(values)
    n = len(s)
    mean = sum(s) / n
    var = sum((v - mean) ** 2 for v in s) / max(1, n - 1)
    return {
        "n": n,
        "mean": round(mean, 3),
        "median": round(percentile(s, 0.5), 3),
        "stdev": round(math.sqrt(var), 3),
        "p25": round(percentile(s, 0.25), 3),
        "p75": round(percentile(s, 0.75), 3),
        "min": round(s[0], 3),
        "max": round(s[-1], 3),
    }


def load_truth_f0(corpus, track_id):
    """Best-effort track-level F0 estimate from corpus reference data,
    for the low-F0 regression-bias bucket. Returns mean F0 over voiced
    frames, or None if no ref. We approximate from corpus loaders'
    metadata files."""
    # Hillenbrand: vowdata.dat encodes F0 per track in the line format
    if corpus == "hillenbrand":
        vow = ROOT / "tests" / "dsp" / "data" / "vowdata.dat"
        if vow.exists():
            for line in vow.read_text().splitlines():
                parts = line.split()
                if len(parts) >= 3 and parts[0] == track_id:
                    try:
                        f0 = int(parts[2])
                        if f0 > 0:
                            return f0
                    except ValueError:
                        pass
        return None
    # Other corpora: would need per-track F0 ref-file parsing. For
    # this analysis we use track-level gender as a proxy bucket.
    return None


def main():
    if not PRAAT_PATH.exists():
        print(f"Missing {PRAAT_PATH}; run praat-cpps-corpus.py first")
        return 1
    if not SYRINX_PATH.exists():
        print(f"Missing {SYRINX_PATH}; run cpp-corpus-aggregate.js first")
        return 1

    praat_doc = json.loads(PRAAT_PATH.read_text())
    syrinx_doc = json.loads(SYRINX_PATH.read_text())

    # Index Syrinx results by (corpus, track_id). Use per-frame
    # median as the primary Syrinx value — that's the apples-to-
    # apples track-level summary that mirrors Praat's CPPS (which
    # also aggregates internally over the whole track). The
    # aggregator's 1-s-window output requires tracks ≥ 1 s; using
    # per-frame median lets us include short tracks like Hillenbrand
    # vowels (~700 ms each). Aggregate value retained for reference.
    syrinx_idx = {}
    for r in syrinx_doc["results"]:
        v = r.get("cpp_per_frame_median_db")
        if v is None:
            continue
        syrinx_idx[(r["corpus"], r["track_id"])] = r

    # Match against Praat results.
    pairs = []
    for r in praat_doc["results"]:
        if "error" in r:
            continue
        key = (r["corpus"], r["track_id"])
        s = syrinx_idx.get(key)
        if s is None:
            continue
        pairs.append({
            "corpus": r["corpus"],
            "track_id": r["track_id"],
            "gender": r["gender"],
            "duration_s": r.get("duration_s"),
            "praat_cpps_db": r["cpps_db"],
            "syrinx_cpp_db": s["cpp_per_frame_median_db"],
            "syrinx_cpp_aggregate_db": s.get("cpp_aggregate_median_db"),
            "ref_f0_hz": load_truth_f0(r["corpus"], r["track_id"]),
        })
    print(f"Joined {len(pairs)} pairs.")

    if not pairs:
        print("No pairs to analyze.")
        return 1

    # Compute overall correlation
    praat_vals = [p["praat_cpps_db"] for p in pairs]
    syrinx_vals = [p["syrinx_cpp_db"] for p in pairs]
    overall_r = pearson(praat_vals, syrinx_vals)
    bias_mean = sum(p["praat_cpps_db"] - p["syrinx_cpp_db"] for p in pairs) / len(pairs)
    bias_dist = describe([p["praat_cpps_db"] - p["syrinx_cpp_db"] for p in pairs])

    # Per-corpus breakdown
    by_corpus = {}
    for p in pairs:
        by_corpus.setdefault(p["corpus"], []).append(p)
    per_corpus = {}
    for c, ps in by_corpus.items():
        cv = [x["praat_cpps_db"] for x in ps]
        sv = [x["syrinx_cpp_db"] for x in ps]
        per_corpus[c] = {
            "n": len(ps),
            "pearson_r": round(pearson(cv, sv) or 0, 4),
            "praat_dist": describe(cv),
            "syrinx_dist": describe(sv),
            "bias_dist": describe([cv[i] - sv[i] for i in range(len(cv))]),
        }

    # Per-gender breakdown
    by_gender = {}
    for p in pairs:
        by_gender.setdefault(p["gender"], []).append(p)
    per_gender = {}
    for g, ps in by_gender.items():
        cv = [x["praat_cpps_db"] for x in ps]
        sv = [x["syrinx_cpp_db"] for x in ps]
        per_gender[g] = {
            "n": len(ps),
            "pearson_r": round(pearson(cv, sv) or 0, 4),
        }

    # Per-F0-range breakdown (Hillenbrand only, since that's the corpus
    # with track-level F0 truth). Buckets: <100 Hz (low male), 100-180
    # (mid male), 180-260 (high female), >260 (very high).
    f0_buckets = {"<100": [], "100-180": [], "180-260": [], ">260": []}
    for p in pairs:
        if p["ref_f0_hz"] is None:
            continue
        f0 = p["ref_f0_hz"]
        if f0 < 100:
            f0_buckets["<100"].append(p)
        elif f0 < 180:
            f0_buckets["100-180"].append(p)
        elif f0 < 260:
            f0_buckets["180-260"].append(p)
        else:
            f0_buckets[">260"].append(p)
    per_f0_bucket = {}
    for b, ps in f0_buckets.items():
        if len(ps) < 2:
            per_f0_bucket[b] = {"n": len(ps), "pearson_r": None}
            continue
        cv = [x["praat_cpps_db"] for x in ps]
        sv = [x["syrinx_cpp_db"] for x in ps]
        per_f0_bucket[b] = {
            "n": len(ps),
            "pearson_r": round(pearson(cv, sv) or 0, 4),
            "praat_mean": round(sum(cv) / len(cv), 3),
            "syrinx_mean": round(sum(sv) / len(sv), 3),
            "bias_mean": round(sum(cv[i] - sv[i] for i in range(len(cv))) / len(cv), 3),
        }

    # Outliers — tracks where the Praat-Syrinx delta is > 2σ from mean
    deltas = [p["praat_cpps_db"] - p["syrinx_cpp_db"] for p in pairs]
    delta_mean = sum(deltas) / len(deltas)
    delta_var = sum((d - delta_mean) ** 2 for d in deltas) / max(1, len(deltas) - 1)
    delta_sd = math.sqrt(delta_var)
    threshold = 2 * delta_sd
    outliers = []
    for p in pairs:
        d = p["praat_cpps_db"] - p["syrinx_cpp_db"]
        if abs(d - delta_mean) > threshold:
            outliers.append({
                "corpus": p["corpus"],
                "track_id": p["track_id"],
                "gender": p["gender"],
                "praat_cpps_db": p["praat_cpps_db"],
                "syrinx_cpp_db": p["syrinx_cpp_db"],
                "delta": round(d, 3),
                "delta_z": round((d - delta_mean) / delta_sd, 2) if delta_sd else None,
            })
    outliers.sort(key=lambda o: -abs(o["delta"]))

    # P5 decision
    decision = "UNKNOWN"
    if overall_r is None:
        decision = "STOP: insufficient data"
    elif overall_r >= 0.5:
        decision = "VALIDATED: overall r ≥ 0.5 → algorithm correlates with Praat reference"
    elif overall_r >= 0.2:
        decision = "WEAK: 0.2 ≤ r < 0.5 — surface findings; investigate per-bucket"
    else:
        decision = "FAIL: r < 0.2 — across-the-board correlation breakdown"
    # Refine with low-F0 specifically (audit-predicted regression bias)
    low_f0 = per_f0_bucket.get("<100")
    if low_f0 and low_f0.get("pearson_r") is not None:
        if low_f0["pearson_r"] < 0.3 and (overall_r or 0) >= 0.5:
            decision += " | LOW-F0 BREAKDOWN: implement Theil-robust regression"

    print()
    print(f"Overall Pearson r: {overall_r:.4f}" if overall_r is not None else "Overall: insufficient data")
    print(f"Bias (Praat − Syrinx) mean: {bias_mean:.3f} dB")
    print()
    print("Per-corpus:")
    for c, info in per_corpus.items():
        print(f"  {c}: n={info['n']}, r={info['pearson_r']}, "
              f"Praat μ={info['praat_dist']['mean']}, Syrinx μ={info['syrinx_dist']['mean']}")
    print()
    print("Per-gender:")
    for g, info in per_gender.items():
        print(f"  {g}: n={info['n']}, r={info['pearson_r']}")
    print()
    print("Per-F0 bucket (Hillenbrand reference F0):")
    for b, info in per_f0_bucket.items():
        if info.get("pearson_r") is None:
            print(f"  {b} Hz: n={info['n']}, r=insufficient")
        else:
            print(f"  {b} Hz: n={info['n']}, r={info['pearson_r']}, "
                  f"Praat μ={info['praat_mean']}, Syrinx μ={info['syrinx_mean']}, bias={info['bias_mean']}")
    print()
    print(f"Outliers (|delta| > 2σ): {len(outliers)} tracks")
    for o in outliers[:10]:
        print(f"  {o['corpus']}/{o['track_id']} ({o['gender']}): Praat={o['praat_cpps_db']}, Syrinx={o['syrinx_cpp_db']}, Δ={o['delta']} (z={o['delta_z']})")
    print()
    print(f"P5 decision: {decision}")

    OUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    OUT_PATH.write_text(json.dumps({
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "n_pairs": len(pairs),
        "overall_pearson_r": overall_r,
        "bias_mean_db": bias_mean,
        "bias_distribution": bias_dist,
        "per_corpus": per_corpus,
        "per_gender": per_gender,
        "per_f0_bucket": per_f0_bucket,
        "outliers_top": outliers[:25],
        "outliers_count": len(outliers),
        "decision": decision,
    }, indent=2))
    print(f"\nWrote {OUT_PATH}")


if __name__ == "__main__":
    main()
