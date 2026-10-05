# brk.py TAG... — classify every octave-class line break (painted value >= 9.5 st
# from the previous painted hop) by what the NEW and the PREVIOUS painted values
# were against the cons reference (display alignment), mix + alice-only.
import sys, numpy as np
sys.argv, ARGV = [sys.argv[0], "--quiet"], sys.argv
sys.path.insert(0, "scripts/session-oracle")
import analyze as an
def cl(v, r):
    if not r > 0: return "noref"
    q = v / r
    if abs(q - 1) < 0.05: return "cor"
    if abs(q - 0.5) <= 0.05 or abs(q - 2) <= 0.2 or q > 2.6 or q < 0.4: return "oct"
    return "other"
for tag in [a for a in ARGV[1:] if not a.startswith("--")]:
    for st, bk in (("paint", "brk"), ("paintA", "brkA")):
        cnt = {}
        for s in an.SESSIONS:
            R = an.load_refs(s); m, c = an.load_run(tag, s)
            L, hop, n = m["lookback"], m["hopS"], m["nHops"]
            ref = R["cons"]; t0 = R["t"][0]
            k = np.arange(n); ii = np.round(((k + 1) * hop - (0.040 + L * hop + an.DELTA_DISP) - t0) / 0.01).astype(int)
            r = np.where((ii >= 0) & (ii < len(ref)), ref[np.clip(ii, 0, len(ref) - 1)], 0)
            p = c[st]
            for j in np.nonzero(c[bk] > 0)[0]:
                key = f"new {cl(p[j], r[j])} / prev {cl(p[j - 1], r[j - 1])}"
                cnt[key] = cnt.get(key, 0) + 1
        tot = sum(cnt.values())
        print(f"{tag} {st}: {tot} breaks  " + ", ".join(f"{k}: {v}" for k, v in sorted(cnt.items(), key=lambda kv: -kv[1])))
