# variant.py — score an existing candidate's probability files at another
# threshold / hangover with score.py's own code (alignment, hangover, bar
# readings) — voice-detector benchmark, 2026-10-06. Post-hoc exploration
# only: a point found this way is never a pre-registered selection.
#
#   python scripts/voice-detector/judge/variant.py CAND THR HANG_MS [CAND THR HANG_MS ...] [--json=PATH]
# CAND = a candidate directory, or a name under build/vad/cand/. Run from the repo root.
import json
import os
import sys
import time

HERE = os.path.dirname(os.path.abspath(__file__))
args = [a for a in sys.argv[1:] if not a.startswith("--")]
out = [a.split("=", 1)[1] for a in sys.argv[1:] if a.startswith("--json=")]
if not args or len(args) % 3:
    raise SystemExit("usage: variant.py CAND THR HANG_MS [...] [--json=PATH]")
sys.argv = [sys.argv[0], "--worst=0"]
sys.path.insert(0, os.path.join(HERE, ".."))
import score as S  # noqa: E402

sys.stdout.reconfigure(encoding="utf-8")
res = {}
for i in range(0, len(args), 3):
    c, thr, hang = args[i], float(args[i + 1]), float(args[i + 2])
    spec = S.load_cand(c)
    spec["threshold"], spec["hangover_ms"] = thr, hang
    spec["name"] = f"{spec['name']}@{thr:g}/{hang:g}"
    t0 = time.time()
    rows, miss = S.stream_rows(spec)
    if miss:
        raise SystemExit(f"{spec['name']}: {len(miss)} streams missing")
    _, r = S.report(spec, rows, None)
    res[spec["name"]] = r
    print(spec["name"], r["verdict"], f"{time.time() - t0:.0f} s")
    print("  V1 worse gender %:", {k.replace("voice in noise ", "vin "): round(x["worse_pct"], 2) for k, x in r["V1"].items()})
    print("  V2 %:", {k: round(x["pct"], 2) for k, x in r["V2"].items() if k.startswith(("all", "held"))})
    print("  V3 onset median ms by gender:", {g: s["median"] for g, s in r["V3"]["by_gender"].items()}, flush=True)
if out:
    with open(out[0], "w", encoding="utf8") as f:
        json.dump(res, f, indent=1, default=float)
