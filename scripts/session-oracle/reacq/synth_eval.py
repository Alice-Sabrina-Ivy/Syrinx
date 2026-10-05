# synth_eval.py — score replay.mjs --set=group outputs of the audio-level synthetic
# drills (2026-10-03 display workstream's synth/*.wav: breathy source-filter
# voice + LF rumble, truth.json) and the noise-only set.
# Usage: python scripts/session-oracle/reacq/synth_eval.py synth TAG [TAG...]   |   python scripts/session-oracle/reacq/synth_eval.py noise TAG [TAG...]
import sys, json, os, numpy as np
SYN = "C:/Coding Projects/Syrinx/build/measure-2026-10-03/display/synth"
grp = sys.argv[1]; TAGS = sys.argv[2:]


def load(tag, name):
    d = f"build/reacq/out/{grp}/{tag}"
    m = json.load(open(f"{d}/{name}.meta.json")); n = m["nHops"]
    t = np.fromfile(f"{d}/{name}.hops.f32", dtype=np.float32).reshape(len(m["cols"]), n)
    return m, {c: t[i].astype(float) for i, c in enumerate(m["cols"])}


def gname(n):
    if n.startswith("alt_"): return "alt" + n.split("_")[1][1:]
    return n.split("_")[0]


if grp == "noise":
    names = sorted(f[:-10] for f in os.listdir(f"build/reacq/out/noise/{TAGS[0]}") if f.endswith(".meta.json"))
    print("noise-only painted % of hops after 10 s (posted voiced %)")
    for nm in names:
        row = []
        for tg in TAGS:
            m, c = load(tg, nm); h = m["hopS"]; s = int(10 / h)
            row.append(f"{tg}: {100 * np.mean(c['paint'][s:] > 0):5.2f} ({100 * np.mean(c['post'][s:] > 0):4.2f})")
        print(f"  {nm:16s} " + " | ".join(row))
    sys.exit(0)

names = json.load(open(f"{SYN}/names.json"))
names = [n for n in names if os.path.exists(f"build/reacq/out/synth/{TAGS[0]}/{n}.meta.json")]
res = {}
for tg in TAGS:
    for nm in names:
        T = json.load(open(f"{SYN}/{nm}.truth.json")); m, c = load(tg, nm)
        L, h = m["lookback"], m["hopS"]
        f0 = np.array(T["f0"], float); tt = np.arange(len(f0)) * T["dt"]
        idx = np.round((tt + 0.040 + L * h + 0.030) / h - 1).astype(int)
        ok = (idx >= 0) & (idx < m["nHops"])
        g = gname(nm); acc = res.setdefault((tg, g), {"tags": {}, "lat": {}, "conn12": 0, "brk": 0, "ph": 0})
        p = c["paint"]; brk = c["brk"]
        a, b = p[:-1], p[1:]
        both = (a > 0) & (b > 0)
        jj = np.abs(12 * np.log2(np.where(both, b / np.where(a > 0, a, 1), 1)))
        acc["conn12"] += int(np.sum(both & (brk[1:] == 0) & (jj >= 12))); acc["brk"] += int(np.sum(brk > 0)); acc["ph"] += int(np.sum(p > 0))
        for sg in T["segs"]:
            if sg["tag"] == "gap": continue
            sel = np.nonzero((tt >= sg["start"]) & (tt < sg["end"]) & ok & (f0 > 0))[0]
            if not len(sel): continue
            B = acc["tags"].setdefault(sg["tag"], {"n": 0, "cor": 0, "half": 0, "up": 0, "blank": 0, "roW": 0})
            first = None
            for i in sel:
                r = f0[i]; d = p[idx[i]]; ro = c["ro"][idx[i]]
                B["n"] += 1
                if not d > 0: B["blank"] += 1
                else:
                    q = d / r
                    if abs(q - 1) < 0.05:
                        B["cor"] += 1
                        if first is None: first = tt[i] - sg["start"]
                    elif abs(q - 0.5) <= 0.05 or (r > 400 and abs(d / (r / 2) - 1) < 0.05): B["half"] += 1
                    elif q > 1.5: B["up"] += 1
                if ro > 0 and abs(ro / r - 1) >= 0.05: B["roW"] += 1
            acc["lat"].setdefault(sg["tag"], []).append(first if first is not None else float("inf"))

pc = lambda x, n: f"{100 * x / n:5.1f}" if n else "  -  "
for g in sorted({k[1] for k in res}):
    print(f"\n## {g}")
    for tg in TAGS:
        a = res[(tg, g)]
        parts = []
        for tag, B in a["tags"].items():
            lat = sorted(a["lat"][tag]); n = len(lat)
            med = lat[n // 2]; nev = sum(1 for x in lat if x == float("inf"))
            parts.append(f"{tag}: cor {pc(B['cor'], B['n'])} half {pc(B['half'], B['n'])} up {pc(B['up'], B['n'])} blank {pc(B['blank'], B['n'])} roW {pc(B['roW'], B['n'])} lat {'inf' if med == float('inf') else int(med * 1000)} nev {100 * nev / n:.0f}%")
        print(f"  {tg:12s} c12 {a['conn12']} brk {a['brk']} | " + " | ".join(parts))
