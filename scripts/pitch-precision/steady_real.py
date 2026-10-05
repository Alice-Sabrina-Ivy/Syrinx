# steady_real.py TAG [TAG2...] — 1-s SD agreement on corpora + sessions
# from lowband-attr dumps (post / paint columns).
import json, sys, os
import numpy as np
sys.path.insert(0, __import__("os").path.dirname(__import__("os").path.abspath(__file__)))
from steady_lib import *

ATTR = "build/session-oracle/attr"
DATA = "build/pb/data"
REFS = "build/session-oracle/refs"
SESS = ["2025-09-08", "2026-05-07", "2026-05-26", "2026-06-09"]
args = [a for a in sys.argv[1:] if not a.startswith("--")]
opts = dict(a[2:].split("=", 1) for a in sys.argv[1:] if a.startswith("--") and "=" in a)
SREF = opts.get("sref", "ac")
STAGES = opts.get("stages", "post,paint").split(",")


def load(tag, st, name):
    d = f"{ATTR}/{tag}/{st}"
    m = json.load(open(f"{d}/{name}.json"))
    a = np.fromfile(f"{d}/{name}.f32", dtype=np.float32).reshape(len(m["cols"]), m["n"]).astype(float)
    return m, {c: a[i] for i, c in enumerate(m["cols"])}


def collect(tag, sets=("fda", "ptdb", "voc", "sessions")):
    rows = {}
    idx = json.load(open(f"{DATA}/index.json"))
    for tr in idx:
        cp = tr["corpus"]
        if cp not in sets: continue
        r = np.fromfile(f"{DATA}/{cp}/{tr['trackId']}.ref.f32", dtype=np.float32).astype(float)
        r[r < 50] = 0
        t = np.arange(len(r)) * tr["refHopMs"] / 1000 + tr["refOffsetMs"] / 1000
        m, c = load(tag, cp, tr["trackId"])
        g = f"{cp}_{tr['gender']}" if cp != "voc" else "voc"
        for s in STAGES:
            v = c[s]
            td = det_times(len(v), m["hopS"], m["L"], s)
            rows.setdefault((g, s), []).extend(windows(t, r, td, v, 0, t[-1]))
            rows.setdefault((g, s + "_trim"), []).extend(windows(t, r, td, v, 0, t[-1], robust=True))
    if "sessions" in sets:
        for ss in SESS:
            z = np.load(f"{REFS}/{ss}.npz")
            m, c = load(tag, "sessions", ss)
            for spk, code in (("alice", 1), ("second", 2)):
                ref = np.where((z["spk"] == code) & (z[SREF] >= 60), z[SREF], 0)
                # only windows that are speaker's: require ref voiced (=speaker's) >= 95 %
                for s in STAGES:
                    v = c[s]
                    td = det_times(len(v), m["hopS"], m["L"], s)
                    w = windows(z["t"], ref, td, v, 0, z["t"][-1])
                    rows.setdefault((spk, s), []).extend(w)
                    if ss == "2026-06-09": rows.setdefault((spk + "_HO", s), []).extend(w)
    return rows


if __name__ == "__main__":
    for tag in args:
        R = collect(tag, tuple(opts.get("sets", "fda,ptdb,voc,sessions").split(",")))
        print(f"#### {tag} (session ref {SREF})")
        for k in sorted(R):
            print(f"== {k}")
            print("   all     ", fmt(agree(R[k])))
            print("   <1st    ", fmt(agree(R[k], 0, 1.0)))
            print("   <1 clean", fmt(agree(R[k], 0, 1.0, clean_only=True)))
            print("   <0.5st  ", fmt(agree(R[k], 0, 0.5)))
        if "json" in opts:
            json.dump({f"{k[0]}|{k[1]}": v for k, v in R.items()}, open(opts["json"], "w"))
