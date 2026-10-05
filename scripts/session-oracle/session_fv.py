# session_fv.py — real-session false voicing (2026-10-04 low-register voicing
# pass; private measurement, kept outside this repo). The synthetic
# noise oracles (noise-fv.mjs, noise-augment-oracle.js) cannot see the noise
# that actually reaches the pitch worker in a practice room: low-level room
# rumble, distant voices, breath and fry between phrases. This scores every
# hop of the four private sessions that lies >= GAP s from ANY frame a
# reference tracker voices (Praat AC, Praat CC, session-label R1 — Praat SHS is
# left out: it voices nearly everything) — audio no reference calls voiced —
# and reports the % of those hops the worker POSTED voiced and the % of
# display hops PAINTED, per speaker label (A alice, S second voice, O outside).
# The absolute level is not a pure false-voicing rate (quiet periodic audio
# the Praat silence threshold drops is in it); the DELTA between src trees on
# identical audio is the signal.
#
# Usage: python scripts/session-oracle/session_fv.py BASE TAG [TAG...]
#          [--gap=0.3] [--attr=build/session-oracle/attr] [--refs=...]
# Reads lowband-attr.mjs dumps (set=sessions).
import sys, os
import numpy as np

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import lowband_attr as la

GAP = float(la.A.get("gap", "0.3"))


def score(tags):
    acc = {}
    for s in la.SESSIONS:
        z = np.load(f"{la.REFS}/{s}.npz")
        pv = (z["ac"] > 0) | (z["cc"] > 0) | (z["cal"] > 0)
        tv = z["t"][pv]
        m0, _ = la.load(tags[0], "sessions", s)
        hop, L = m0["hopS"], m0["L"]
        k = np.arange(m0["n"])

        def far(tc):
            j = np.clip(np.searchsorted(tv, tc), 1, len(tv) - 1)
            return np.minimum(np.abs(tv[j] - tc), np.abs(tv[j - 1] - tc)) >= GAP

        tw = (k + 1) * hop - 0.040                 # detection columns: window centre
        td = (k + 1) * hop - 0.040 - L * hop - 0.030  # display columns (session-oracle alignment)
        fw, fd = far(tw), far(td)
        jw = np.clip(np.searchsorted(z["t"], tw), 0, len(z["t"]) - 1)
        jd = np.clip(np.searchsorted(z["t"], td), 0, len(z["t"]) - 1)
        for t in tags:
            m, c = la.load(t, "sessions", s)
            for sp, code in (("A", 1), ("S", 2), ("O", 3), ("all", None)):
                mw = fw & ((z["spk"][jw] == code) if code else True)
                md = fd & ((z["spk"][jd] == code) if code else True)
                d = acc.setdefault((t, sp), [0, 0, 0, 0])
                d[0] += int(mw.sum()); d[1] += int((mw & (c["post"] > 0)).sum())
                d[2] += int(md.sum()); d[3] += int((md & (c["paint"] > 0)).sum())
    return acc


if __name__ == "__main__":
    tags = la.TAGS
    acc = score(tags)
    print(f"hops >= {GAP} s from any reference-voiced frame: % posted voiced / % painted")
    for sp in ("A", "S", "O", "all"):
        print(f"{sp:4s}" + "  ".join(f"{t}:{100 * acc[(t, sp)][1] / max(acc[(t, sp)][0], 1):.2f}/"
                                    f"{100 * acc[(t, sp)][3] / max(acc[(t, sp)][2], 1):.2f}" for t in tags)
              + f"  (n={acc[(tags[0], sp)][0]})")
