# timing_syrinx.py — Syrinx pitch-worker cost per second of audio through the
# REAL worker (session-oracle run.mjs, observation tap off: SO_TAP=0) on the
# same 60 s clip timing.py uses. 3 runs per tree, median of
# meta.cpu.pitchMsPerChunk (hrtime around the worker's chunk handler; one JS
# thread) x 40 chunks/s. Run after timing.py (needs <WORK>/tmp/clip60.wav).
# Usage: python scripts/pitch-benchmark/timing_syrinx.py [--main-src=DIR] [--new-src=DIR] [--new600-src=DIR]
import os, sys, json, subprocess, statistics
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from paths import REPO, WORK, OUT, TMP
A = dict((a[2:].split("=", 1) + ["1"])[:2] for a in sys.argv[1:] if a.startswith("--"))
TREES = {"syrinx_main": A.get("main-src", os.path.join(WORK, "trees", "main", "src")), "syrinx_new": A.get("new-src", "src"),
         "syrinx_new600": A.get("new600-src", os.path.join(WORK, "trees", "new600", "src"))}
res = {}
for k, src in TREES.items():
    v = []
    for i in range(3):
        subprocess.run(["node", "--import", "./scripts/session-oracle/lib/register.mjs", "scripts/session-oracle/run.mjs", f"--src={src}",
                        f"--tag=timing_{k}", "--out=" + os.path.join(OUT, "timing_runs"), "--wav=" + os.path.join(TMP, "clip60.wav"), "--name=clip60"],
                       cwd=REPO, check=True, env={**os.environ, "SO_TAP": "0"}, capture_output=True)
        m = json.load(open(os.path.join(OUT, "timing_runs", f"timing_{k}", "clip60.meta.json")))
        v.append(m["cpu"]["pitchMsPerChunk"])
    res[k] = {"cpu_ms_per_s": 40 * statistics.median(v), "ms_per_chunk": statistics.median(v)}
    print(k, f"{res[k]['ms_per_chunk']:.3f} ms per 25 ms chunk = {res[k]['cpu_ms_per_s']:.1f} ms per s audio")
p = os.path.join(OUT, "timing.json")
old = json.load(open(p)) if os.path.exists(p) else {}
old.update(res); json.dump(old, open(p, "w"), indent=1)
