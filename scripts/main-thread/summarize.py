"""summarize.py — TARGET / guard numbers from scripts/main-thread/mt-cpu.mjs
result files named <diag>-<viewport>-<panel>-<tree>-<who>-<rep>.json
(measurements/main-thread-cpu-2026-10-08.md).

    python scripts/main-thread/summarize.py <dir> [--base=base] [--head=k6]
"""
import glob
import json
import os
import statistics as st
import sys

d = sys.argv[1]
opt = dict(a[2:].split("=", 1) for a in sys.argv[2:] if a.startswith("--"))
BASE, HEAD = opt.get("base", "base"), opt.get("head", "k6")
rows = []
for f in glob.glob(os.path.join(d, "*.json")):
    diag, vp, panel, tree, who, rep = os.path.basename(f)[:-5].split("-")
    r = json.load(open(f))
    rows.append(dict(diag=diag, vp=vp, panel=panel, tree=tree, who=who, rep=int(rep), r=r))


def med(xs):
    xs = [x for x in xs if x is not None]
    return st.median(xs) if xs else None


def sel(**k):
    return [x for x in rows if all(x[a] == b for a, b in k.items())]


WORKERS = ["pitch-worker", "dsp-worker", "resonance-worker", "gender-worker"]
for vp in ["desktop", "phone"]:
    for panel in ["off", "on"]:
        b, h = sel(diag="0", vp=vp, panel=panel, tree=BASE), sel(diag="0", vp=vp, panel=panel, tree=HEAD)
        if not b or not h:
            continue
        mb, mh = med([x["r"]["mainMsPerS"] for x in b]), med([x["r"]["mainMsPerS"] for x in h])
        print(f"\n== {vp} panel {panel}: main thread ms/s, median of {len(b)} / {len(h)} runs: base {mb:.1f}  head {mh:.1f}  cut {100 * (1 - mh / mb):.1f} %")
        for who in ["woman", "man"]:
            wb = med([x["r"]["mainMsPerS"] for x in b if x["who"] == who])
            wh = med([x["r"]["mainMsPerS"] for x in h if x["who"] == who])
            print(f"   {who:5s}: base {wb:.1f}  head {wh:.1f}  cut {100 * (1 - wh / wb):.1f} %   (runs base {sorted(round(x['r']['mainMsPerS'], 1) for x in b if x['who'] == who)}, head {sorted(round(x['r']['mainMsPerS'], 1) for x in h if x['who'] == who)})")
        for w in WORKERS:
            vb = med([x["r"]["perAudioS"].get(w) for x in b])
            vh = med([x["r"]["perAudioS"].get(w) for x in h])
            if vb:
                print(f"   {w:17s} base {vb:6.1f}  head {vh:6.1f}  ({100 * (vh / vb - 1):+.1f} %)")
        for name, xs in [("base", b), ("head", h)]:
            fs = [x["r"]["frameStats"] for x in xs]
            print(f"   {name}: main frames/s median {med([f['beginMainFramesPerS'] for f in fs]):.1f}; tasks >50 ms {sum(f['mainTaskOver50'] for f in fs)}, "
                  f">16.7 ms {sum(f['mainTaskOver16'] for f in fs)}, long tasks {sum(f['longTasks'] for f in fs)}; rAF probe >50 ms {sum(f['over50'] for f in fs)}, >25 ms {sum(f['over25'] for f in fs)}")

b, h = sel(diag="1", tree=BASE), sel(diag="1", tree=HEAD)
if b and h:
    print(f"\n== latency (diag, desktop panel off): {len(b)} / {len(h)} runs")
    for name, xs in [("base", b), ("head", h)]:
        L = [x["r"]["latency"] for x in xs]
        print(f"   {name}: painted median-of-medians {med([l['paintedMedianMs'] for l in L]):.1f} ms "
              f"(woman {med([x['r']['latency']['paintedMedianMs'] for x in xs if x['who'] == 'woman']):.1f}, man {med([x['r']['latency']['paintedMedianMs'] for x in xs if x['who'] == 'man']):.1f}); "
              f"handler {med([l['handlerMedianMs'] for l in L]):.1f} ms; draws/s {med([l['drawsPerS'] for l in L]):.1f}; "
              f"gap p99 max-over-runs {max(l['drawGapP99Ms'] for l in L):.1f} ms, gap max {max(l['drawGapMaxMs'] for l in L):.1f} ms; "
              f"step p99 max-over-runs {max(l['stepP99CssPx'] for l in L):.2f} CSS px, step max {max(l['stepMaxCssPx'] for l in L):.2f}")
    pb = med([x["r"]["latency"]["paintedMedianMs"] for x in b])
    ph = med([x["r"]["latency"]["paintedMedianMs"] for x in h])
    print(f"   head - base = {ph - pb:+.1f} ms (guard <= +5)")
