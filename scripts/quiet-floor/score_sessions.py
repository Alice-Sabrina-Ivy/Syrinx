# score_sessions.py — quiet-floor display loss on the private session
# recordings (measurements/pitch-quiet-floor-2026-10-20.md §3): per speaker
# (alice / second voice, session labels) and band (75-110, 110-160, 160-200,
# 200-260, 260-400 Hz on the reference), the share of reference-voiced frames
# the baseline painted and the candidate did not, pooled over the sessions;
# plus the painted correct share (|q - 1| < 0.05). Reference frames as the
# session oracle (build_refs.py `cons` primary, `strict` sensitivity; refs
# below 75 Hz ignored); display alignment as analyze.py (hop =
# round((t + 0.040 + L*hop + 0.030) / hop - 1)).
# Results stay private: run with --attr / --refs outside the repository.
#
# Usage: python scripts/quiet-floor/score_sessions.py --attr=DIR --refs=DIR [--out=JSON] base g60 ...
import sys, json
import numpy as np

A = dict((a[2:].split("=", 1) + ["1"])[:2] for a in sys.argv[1:] if a.startswith("--"))
TAGS = [a for a in sys.argv[1:] if not a.startswith("--")]
ATTR, REFS = A["attr"], A["refs"]
SESSIONS = A.get("sessions", "2025-09-08,2026-05-07,2026-05-26,2026-06-09").split(",")
BANDS = [(75, 110), (110, 160), (160, 200), (200, 260), (260, 400)]
SPK = {"alice": 1, "second": 2}


def load(tag, s):
    m = json.load(open(f"{ATTR}/{tag}/sessions/{s}.json"))
    a = np.fromfile(f"{ATTR}/{tag}/sessions/{s}.f32", dtype=np.float32).reshape(len(m["cols"]), m["n"]).astype(float)
    return m, {c: a[i] for i, c in enumerate(m["cols"])}


acc = {}
for s in SESSIONS:
    z = np.load(f"{REFS}/{s}.npz")
    m0, b = load(TAGS[0], s)
    hop, L, n = m0["hopS"], m0["L"], m0["n"]
    idx = np.round((z["t"] + 0.040 + L * hop + 0.030) / hop - 1).astype(int)
    ok = (idx >= 0) & (idx < n)
    ii = np.clip(idx, 0, n - 1)
    bp = (b["paint"][ii] > 0) & ok
    for tag in TAGS:
        _, c = load(tag, s)
        cv = c["paint"][ii]
        cp = (cv > 0) & ok
        for conv in ("cons", "strict"):
            ref = np.where(z[conv] >= 75, z[conv], 0)
            q = np.where(cp, cv / np.where(ref > 0, ref, 1), 0)
            cor = cp & (np.abs(q - 1) < 0.05)
            for who, code in SPK.items():
                for lo, hi in BANDS:
                    msk = ok & (z["spk"] == code) & (ref >= lo) & (ref < hi)
                    d = acc.setdefault(f"{conv}|{who}|{lo}-{hi}|{tag}", [0, 0, 0, 0])
                    d[0] += int(msk.sum()); d[1] += int((msk & bp & ~cp).sum())
                    d[2] += int((msk & cp).sum()); d[3] += int((msk & cor).sum())

res = {}
for conv in ("cons", "strict"):
    print(f"\n### {conv}: display loss pp (baseline painted, candidate not; % of reference-voiced frames) | painted correct %")
    for who in SPK:
        for lo, hi in BANDS:
            row = []
            for tag in TAGS:
                n_, lost, pn, pc = acc[f"{conv}|{who}|{lo}-{hi}|{tag}"]
                r = dict(n=n_, loss=100 * lost / max(n_, 1), painted=100 * pn / max(n_, 1), correct=100 * pc / max(pn, 1))
                res[f"{conv}|{who}|{lo}-{hi}|{tag}"] = r
                row.append(f"{tag} {r['loss']:.2f}|{r['correct']:.1f}")
            print(f"{who:6s} {lo:3d}-{hi:<3d} n={n_:7d}  " + "  ".join(row))
if "out" in A:
    json.dump(res, open(A["out"], "w"), indent=1)
