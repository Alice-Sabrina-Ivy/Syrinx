# simguard.py — offline harmonic-guard variants (2026-10-05, exploration).
# The guard is the last stage before the worker posts and feeds nothing back,
# so a variant's posted stream follows from the dump's decode column and the
# per-frame features of harmfeat.py (raw-stream approximation of the worker's
# post-notch buffer). Writes a new dump tag (post / conf / gk replaced) that
# replay.mjs then drives through the real display; final candidates are
# re-measured through the real worker.
#
#   python scripts/realnoise-fv/simguard.py FROMTAG SET NEWTAG RULE
# RULE: "cur" (hc >= 2, debounce 4 — must reproduce the dump) or
#       "vp:T:M:D[:or]" — a frame passes when >= M of the harmonic prominences
#       vp1..vp8 are >= T dB; vetoed after D consecutive failing calls; ":or"
#       also passes frames with hc >= 2, ":and" requires hc >= 2 as well.
#       "ex:WI:X:M:D:WARM[:suffix]" — the noise-floor excess veto on top of the
#       production guard (see the code; features from floorfeat.py).
import sys, os, glob, json
import numpy as np

FROM, SET, NEW, RULE = sys.argv[1:5]
ATTR = "build/realnoise-fv/attr"
src, dst = os.path.join(ATTR, FROM, SET), os.path.join(ATTR, NEW, SET)
fsrc = os.path.join("build/realnoise-fv/feat", FROM, SET)
os.makedirs(dst, exist_ok=True)
parts = RULE.split(":")
mism = 0
for p in sorted(glob.glob(os.path.join(src, "*.json"))):
    nm = os.path.basename(p)[:-5]
    m = json.load(open(p))
    a = np.fromfile(os.path.join(src, nm + ".f32"), dtype=np.float32).reshape(len(m["cols"]), m["n"])
    c = {k: a[i] for i, k in enumerate(m["cols"])}
    F = np.load(os.path.join(fsrc, nm + ".npy")) if parts[0] == "vp" else None
    st = 0
    post, conf, gk = c["post"], c["conf"], c["gk"]
    if parts[0] == "ex":
        # noise-floor excess veto ON TOP of the production guard: a posted frame
        # is vetoed after D consecutive posted frames with fewer than M of the
        # harmonic excesses ex_1..ex_8 (floorfeat.py, window index WI) >= X dB;
        # fail-open for the first WARM seconds of the stream
        WI, X, M, D, WARM = int(parts[1]), float(parts[2]), int(parts[3]), int(parts[4]), float(parts[5])
        E = np.load(os.path.join(f"build/realnoise-fv/floor{parts[6] if len(parts) > 6 else '16'}", FROM, SET, nm + ".npy"))
        hop = m["hopS"]
        for k in np.nonzero(post > 0)[0]:
            t = (k + 1) * hop - 0.040
            ok = t < WARM or not np.isfinite(E[k, 0]) or np.nansum(E[k, WI * 8:(WI + 1) * 8] >= X) >= M
            st = 0 if ok else st + 1
            if st >= D:
                post[k] = 0.0
                d = c["s0"][k] - c["uv"][k]
                conf[k] = max(0, min(0.499, 0.5 + d))
        a.tofile(os.path.join(dst, nm + ".f32"))
        json.dump({**m, "simguard": RULE, "simFrom": FROM}, open(os.path.join(dst, nm + ".json"), "w"))
        continue
    for k in np.nonzero(gk >= 0)[0]:
        if parts[0] == "cur":
            ok = c["hc"][k] >= 2
            D = 4
        else:
            T, M, D = float(parts[1]), int(parts[2]), int(parts[3])
            vp = F[k, 1:]
            ok = np.nansum(vp >= T) >= M if np.isfinite(F[k, 0]) else c["hc"][k] >= 2
            if len(parts) > 4 and parts[4] == "or":
                ok = ok or c["hc"][k] >= 2
            if len(parts) > 4 and parts[4] == "and":
                ok = ok and c["hc"][k] >= 2
        st = 0 if ok else st + 1
        keep = st < D
        newpost = c["dec"][k] if keep else 0.0
        if parts[0] == "cur" and newpost != post[k]:
            mism += 1
        post[k] = newpost
        gk[k] = 1 if keep else 0
        d = c["s0"][k] - c["uv"][k]
        conf[k] = min(1, max(0.5, 0.5 + d)) if keep else max(0, min(0.499, 0.5 + d))
    a.tofile(os.path.join(dst, nm + ".f32"))
    json.dump({**m, "simguard": RULE, "simFrom": FROM}, open(os.path.join(dst, nm + ".json"), "w"))
print(f"{FROM} -> {NEW} {SET} rule {RULE}" + (f": {mism} posted mismatches vs dump" if parts[0] == "cur" else ""))
