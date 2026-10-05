# guard_probe.py — frame-level design table for harmonic-voicing-guard rules
# (2026-10-04 low-register voicing pass; private measurement, kept outside this repo).
# Reads guard-probe.mjs dumps
# (every guard call of the REAL pitch worker: decoded f0, the production
# verdict, peak/floor dB at k*f0 for k = 1..8 under the production ±35 %
# floor `P` and the inter-harmonic floor `I`) and labels each call against
# the references:
#   A:/S:  Alice / second-voice session frames vs `cons` — cor_low (decode within
#          5 % of a < 160 Hz reference), cor_tgt (>= 160 Hz), half_tgt
#          (decode = half a >= 160 Hz reference), refUV (cons unvoiced)
#   far    session decodes >= 0.3 s from any frame Praat AC / CC / session-label
#          R1 voices (session_fv.py's population: room noise, distant voices)
#   ptdbm:/fdam:/vocu: corpus frames (ground truth), N:<class> noise-fv classes
# and prints, per rule, the fraction of each class's guard calls the rule
# passes (no debounce — the chain-level effect is what run_variant.sh
# measures; this table is for choosing which rules are worth a chain run).
#
# Usage: python scripts/session-oracle/guard_probe.py [--tag=base]
#          [--probe=build/session-oracle/gprobe] [--refs=...] [--data=...]
import sys, os, json, collections
import numpy as np

A = dict((a[2:].split("=", 1) + ["1"])[:2] for a in sys.argv[1:] if a.startswith("--"))
G = os.path.join(A.get("probe", "build/session-oracle/gprobe"), A.get("tag", "base"))
REFS = A.get("refs", "build/session-oracle/refs")
DATA = A.get("data", os.path.join(os.environ.get("PITCH_BENCH_DIR", "build/pb"), "data"))
SESSIONS = ["2025-09-08", "2026-05-07", "2026-05-26", "2026-06-09"]


def load(st, name):
    m = json.load(open(f"{G}/{st}/{name}.json"))
    return m, np.fromfile(f"{G}/{st}/{name}.f32", dtype=np.float32).reshape(-1, 19).astype(float)


def classify(f, r):
    q = np.where(r > 0, f / np.where(r > 0, r, 1), 0)
    c = np.full(len(f), "other", dtype=object)
    c[r <= 0] = "refUV"
    c[(r > 0) & (np.abs(q - 1) < 0.05) & (r < 160)] = "cor_low"
    c[(r > 0) & (np.abs(q - 1) < 0.05) & (r >= 160)] = "cor_tgt"
    c[(r >= 160) & (np.abs(q - 0.5) <= 0.05)] = "half_tgt"
    return c


def collect():
    rows = collections.defaultdict(list)
    for s in SESSIONS:
        z = np.load(f"{REFS}/{s}.npz")
        cons = np.where(z["cons"] >= 75, z["cons"], 0)
        pv = (z["ac"] > 0) | (z["cc"] > 0) | (z["cal"] > 0)
        tv = z["t"][pv]
        m, a = load("sessions", s)
        tc = (a[:, 0] + 1) * m["hopS"] - 0.040
        j = np.clip(np.searchsorted(tv, tc), 1, len(tv) - 1)
        rows["far"].append(a[np.minimum(np.abs(tv[j] - tc), np.abs(tv[j - 1] - tc)) >= 0.3])
        i = np.clip(np.searchsorted(z["t"], tc), 0, len(z["t"]) - 1)
        c = classify(a[:, 1], cons[i])
        for sp, code in (("A", 1), ("S", 2)):
            for k in set(c):
                rows[f"{sp}:{k}"].append(a[(z["spk"][i] == code) & (c == k)])
    for tr in json.load(open(f"{DATA}/index.json")):
        cp = tr["corpus"]
        if cp not in ("ptdb", "fda", "voc") or not os.path.exists(f"{G}/{cp}/{tr['trackId']}.json"): continue
        r = np.fromfile(f"{DATA}/{cp}/{tr['trackId']}.ref.f32", dtype=np.float32).astype(float)
        r[r < 50] = 0
        m, a = load(cp, tr["trackId"])
        tc = (a[:, 0] + 1) * m["hopS"] - 0.040
        i = np.clip(np.round((tc - tr["refOffsetMs"] / 1000) / (tr["refHopMs"] / 1000)).astype(int), 0, len(r) - 1)
        c = classify(a[:, 1], r[i])
        for k in set(c):
            rows[f"{cp}{tr['gender']}:{k}"].append(a[c == k])
    if os.path.isdir(f"{G}/noise"):
        for fn in os.listdir(f"{G}/noise"):
            if fn.endswith(".json"):
                rows["N:" + fn[:-5]].append(load("noise", fn[:-5])[1])
    return {k: np.concatenate(v) if len(v) else np.zeros((0, 19)) for k, v in rows.items()}


def Pk(a, k): return np.nan_to_num(a[:, 2 + k], nan=-99)   # production floor, dB
def Ik(a, k): return np.nan_to_num(a[:, 10 + k], nan=-99)  # inter-harmonic floor, dB
def cnt(a, fl, ks, thr=10): return sum((fl(a, k) >= thr).astype(int) for k in ks)


PROD = lambda a: cnt(a, Pk, (1, 2, 3, 4)) >= 2
HALF = lambda a, lo=8, hi=12: (np.maximum(Ik(a, 3), Ik(a, 5)) < lo) & (np.minimum(Ik(a, 2), Ik(a, 4)) >= hi)
RULES = {
    "prod (deployed)": PROD,
    "ih (all k)": lambda a: cnt(a, Ik, (1, 2, 3, 4)) >= 2,
    "ihk2 (k1 prod, k2-4 ih)": lambda a: (cnt(a, Pk, (1,)) + cnt(a, Ik, (2, 3, 4))) >= 2,
    "ihk2 & !half-sig": lambda a: ((cnt(a, Pk, (1,)) + cnt(a, Ik, (2, 3, 4))) >= 2) & ~HALF(a),
    "prod & !half-sig": lambda a: PROD(a) & ~HALF(a),
    "ih k2-6 >= 2": lambda a: cnt(a, Ik, (2, 3, 4, 5, 6)) >= 2,
    "ih k2-6 >= 3": lambda a: cnt(a, Ik, (2, 3, 4, 5, 6)) >= 3,
    "prod | ih k2-8 >= 5": lambda a: PROD(a) | (cnt(a, Ik, range(2, 9)) >= 5),
    "prod | R1 (k1p+ih2-4>=2 & ih3)": lambda a: PROD(a) | (((cnt(a, Pk, (1,)) + cnt(a, Ik, (2, 3, 4))) >= 2) & (Ik(a, 3) >= 10)),
    "prod | R2 (ih2-5>=3 & ih3|ih5)": lambda a: PROD(a) | ((cnt(a, Ik, (2, 3, 4, 5)) >= 3) & ((Ik(a, 3) >= 10) | (Ik(a, 5) >= 10))),
}
CLS = ["A:cor_low", "S:cor_low", "ptdbm:cor_low", "fdam:cor_low", "vocu:cor_low", "A:cor_tgt", "S:cor_tgt",
       "ptdbf:cor_tgt", "A:half_tgt", "S:half_tgt", "far", "A:refUV", "ptdbm:refUV", "fdam:refUV",
       "N:brown", "N:sleep-birdies", "N:sleep-noise", "N:fan-hum"]

if __name__ == "__main__":
    R = collect()
    print("guard calls per class: " + ", ".join(f"{c} {len(R[c])}" for c in CLS if c in R))
    print("median dB (P = production floor, I = inter-harmonic floor), k = 1..8:")
    for c in ("A:cor_low", "S:cor_low", "A:half_tgt", "S:half_tgt", "far"):
        a = R[c]
        print(f"  {c:11s} P " + " ".join(f"{np.nanmedian(a[:, 2 + k]):5.1f}" for k in range(1, 9))
              + " | I " + " ".join(f"{np.nanmedian(a[:, 10 + k]):5.1f}" for k in range(1, 9)))
    print(f"\n{'rule (fraction of guard calls passed)':34s}" + "".join(f"{c[:10]:>11s}" for c in CLS))
    for name, f in RULES.items():
        print(f"{name[:34]:34s}" + "".join(f"{np.mean(f(R[c])) if c in R and len(R[c]) else float('nan'):11.3f}" for c in CLS))
