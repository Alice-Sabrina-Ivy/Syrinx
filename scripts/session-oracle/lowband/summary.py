# summary.py BASE TAG... — one row per variant of the low-register voicing
# pass (2026-10-04; private measurement, kept outside this repo):
# the gains and every guard as deltas vs BASE (pp). Inputs: lowband_score
# cache (table.py fills build/score_cache2), session_fv.py, noise-fv.mjs
# 4-seed results (build/session-oracle/noisefv4) and the CPU per chunk the
# attribution dumps record. Run from the repo root after table.py.
import sys, os, json
import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, ".."))
tags = [a for a in sys.argv[1:] if not a.startswith("--")]
sys.argv = [sys.argv[0]] + tags
import lowband_score as ls
import session_fv as sfv

CACHE = "build/score_cache2"
R = {}
for t in tags:
    p = f"{CACHE}/{t}.json"
    if not os.path.exists(p):
        os.makedirs(CACHE, exist_ok=True)
        json.dump(ls.summarize(ls.collect(t)), open(p, "w"))
    R[t] = json.load(open(p))
FV = sfv.score(tags)
NF = {t: json.load(open(f"build/session-oracle/noisefv4/{t}.json")) for t in tags}
CLASSES = [c for c in NF[tags[0]] if c not in ("babble", "fan-hum")]


def cpu(t):
    v = []
    for st in ("fda", "ptdb", "voc"):
        d = f"build/session-oracle/attr/{t}/{st}"
        v += [json.load(open(f"{d}/{f}"))["cpuMsPerChunk"] for f in os.listdir(d) if f.endswith(".json")]
    return float(np.median(v))


def g(t, k, m):
    return R[t].get(k, {}).get(m, float("nan"))


def pooled(t):  # FDA + PTDB (both genders) 75-160 posted C5, frame-weighted
    num = den = 0
    for k in ("fda_m", "fda_f", "ptdb_m", "ptdb_f"):
        x = R[t].get(f"{k}|post|75-160")
        if x: num += x["C5"] * x["n"]; den += x["n"]
    return num / den


COLS = [
    ("A lo post", lambda t: g(t, "alice_cons|post|75-160", "C5")),
    ("A lo paint", lambda t: g(t, "alice_cons|paint|75-160", "C5")),
    ("A lo HO", lambda t: g(t, "alice_cons_HO|post|75-160", "C5")),
    ("S lo post", lambda t: g(t, "second_cons|post|75-160", "C5")),
    ("FDA+PTDB lo", pooled),
    ("PTDBm lo", lambda t: g(t, "ptdb_m|post|75-160", "C5")),
    ("maxerr F/P", lambda t: (g(t, "fda|post|maxerr", "C5"), g(t, "ptdb|post|maxerr", "C5"))),
    ("VDE Fm/Pm", lambda t: (g(t, "fda_m|post|all", "VDE"), g(t, "ptdb_m|post|all", "VDE"))),
    ("A tgt post", lambda t: g(t, "alice_cons|post|160-400", "C5")),
    ("A tgt paint", lambda t: g(t, "alice_cons|paint|160-400", "C5")),
    ("A tgt HO paint", lambda t: g(t, "alice_cons_HO|paint|160-400", "C5")),
    ("tgt dn A/S-HO", lambda t: (g(t, "alice_cons|post|160-400", "down"), g(t, "second_cons_HO|post|160-400", "down"))),
    ("lo up A", lambda t: g(t, "alice_cons|post|75-160", "up")),
    (">=400 dn A", lambda t: g(t, "alice_cons|post|400+", "down")),
    ("voc", lambda t: g(t, "voc|post|all", "C5")),
    ("sessFV post/paint", lambda t: (100 * FV[(t, "all")][1] / FV[(t, "all")][0], 100 * FV[(t, "all")][3] / FV[(t, "all")][2])),
    ("noise max paint", lambda t: max(NF[t][c]["painted"] for c in CLASSES)),
    ("CPU ms", cpu),
]


def fmt(v, base=None):
    if isinstance(v, tuple):
        return "/".join(fmt(x, b) for x, b in zip(v, base if base else (None,) * len(v)))
    return f"{v:.2f}" if base is None else f"{v - base:+.2f}"


if __name__ == "__main__":
    b = tags[0]
    BV = {n: f(b) for n, f in COLS}
    print("| variant | " + " | ".join(n for n, _ in COLS) + " |")
    print("|---" * (len(COLS) + 1) + "|")
    print(f"| {b} (absolute) | " + " | ".join(fmt(BV[n]) for n, _ in COLS) + " |")
    for t in tags[1:]:
        print(f"| {t} | " + " | ".join(fmt(f(t), BV[n]) for n, f in COLS) + " |")
