# realval.py TAG... — invariant check on replayed session tables: every painted
# value (mix pass `paint`) must equal a fresh message value (`msg`) of the
# last 40 hops (a real detection). Counts painted hops that do not, i.e. the
# display median produced a value no detector frame posted (the even-length
# mean of two detections). Review fix §10 of
# measurements/pitch-display-reacquire-2026-10-04.md.
import sys, json, numpy as np
SESS = ["2025-09-08", "2026-05-07", "2026-05-26", "2026-06-09"]
for tag in sys.argv[1:]:
    tot = bad = 0; ex = []
    for s in SESS:
        d = f"build/session-oracle/runs/{tag}"; m = json.load(open(f"{d}/{s}.meta.json")); n = m["nHops"]
        t = np.fromfile(f"{d}/{s}.hops.f32", dtype=np.float32).reshape(len(m["cols"]), n)
        c = {k: t[i] for i, k in enumerate(m["cols"])}
        for col, mcol in (("paint", "msg"),):
            p, g = c[col], c[mcol]
            for k in np.nonzero(p > 0)[0]:
                tot += 1
                w = g[max(0, k - 40):k + 1]
                if not np.any(w == p[k]):
                    bad += 1
                    if len(ex) < 3: ex.append((s, int(k), float(p[k])))
    print(f"{tag:12s} painted hops {tot}  not a posted detection {bad} ({100 * bad / max(tot, 1):.3f} %)  e.g. {ex}")
