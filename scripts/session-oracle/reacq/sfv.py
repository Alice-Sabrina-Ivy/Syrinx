# sfv.py — real-session false voicing on session-oracle run tables (logic of
# session_fv.py from branch pitch-low-register-precision, reading run.mjs /
# replay.mjs tables instead of lowband-attr dumps): % of display hops >= GAP s
# from any frame a reference voices (Praat AC, Praat CC, session-label R1) that the
# live trace PAINTED, per speaker label; also posted %.
# Usage: python scripts/session-oracle/reacq/sfv.py TAG [TAG...] [--gap=0.3]
import sys, json, numpy as np
A = dict((a[2:].split("=", 1) + ["1"])[:2] for a in sys.argv[1:] if a.startswith("--"))
TAGS = [a for a in sys.argv[1:] if not a.startswith("--")]
GAP = float(A.get("gap", "0.3"))
SESS = ["2025-09-08", "2026-05-07", "2026-05-26", "2026-06-09"]
acc = {}
for s in SESS:
    z = np.load(f"build/session-oracle/refs/{s}.npz")
    pv = (z["ac"] > 0) | (z["cc"] > 0) | (z["cal"] > 0)
    tv = z["t"][pv]
    for tg in TAGS:
        d = f"build/session-oracle/runs/{tg}"
        m = json.load(open(f"{d}/{s}.meta.json")); n = m["nHops"]
        t = np.fromfile(f"{d}/{s}.hops.f32", dtype=np.float32).reshape(len(m["cols"]), n)
        c = {k: t[i] for i, k in enumerate(m["cols"])}
        hop, L = m["hopS"], m["lookback"]; k = np.arange(n)

        def far(tc):
            j = np.clip(np.searchsorted(tv, tc), 1, len(tv) - 1)
            return np.minimum(np.abs(tv[j] - tc), np.abs(tv[j - 1] - tc)) >= GAP
        tw = (k + 1) * hop - 0.040; td = tw - L * hop - 0.030
        fw, fd = far(tw), far(td)
        jw = np.clip(np.searchsorted(z["t"], tw), 0, len(z["t"]) - 1); jd = np.clip(np.searchsorted(z["t"], td), 0, len(z["t"]) - 1)
        for sp, code in (("A", 1), ("S", 2), ("O", 3), ("all", None)):
            mw = fw & ((z["spk"][jw] == code) if code else True); md = fd & ((z["spk"][jd] == code) if code else True)
            a = acc.setdefault((tg, sp), [0, 0, 0, 0])
            a[0] += int(mw.sum()); a[1] += int((mw & (c["post"] > 0)).sum()); a[2] += int(md.sum()); a[3] += int((md & (c["paint"] > 0)).sum())
            if "paintA" in c and sp == "A":
                b = acc.setdefault((tg, "A-alone"), [0, 0, 0, 0])
                b[2] += int(md.sum()); b[3] += int((md & (c["paintA"] > 0)).sum())
print(f"hops >= {GAP} s from any reference-voiced frame: % posted / % painted")
for sp in ("A", "A-alone", "S", "O", "all"):
    print(f"{sp:8s}" + "  ".join(f"{t}: {100 * acc[(t, sp)][1] / max(acc[(t, sp)][0], 1):.2f}/{100 * acc[(t, sp)][3] / max(acc[(t, sp)][2], 1):.3f}" for t in TAGS) + f"  (n={acc[(TAGS[0], sp)][2]})")
