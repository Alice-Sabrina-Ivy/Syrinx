# valpoint.py — custom voice detector (2026-10-06): one candidate at its
# candidate.json operating point on the VALIDATION streams only (vvoice /
# vmix20 / vmix0 / vneg): % of CORRECTLY painted hops vetoed per val group /
# mix cell and gender, % of falsely painted hops vetoed on the val negatives
# per source, and the worst val voice streams. score.py's alignment and
# hangover logic. No evaluation stream is read.
#
#   python valpoint.py CAND_DIR [--val=build/vad-train/val] [--worst=8]
import collections
import os
import sys

import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
MY = dict((a[2:].split("=", 1) + ["1"])[:2] for a in sys.argv[1:] if a.startswith("--"))
CAND = [a for a in sys.argv[1:] if not a.startswith("--")][0]
sys.argv = [sys.argv[0]]
sys.path.insert(0, os.path.join(HERE, ".."))
sys.path.insert(0, os.path.join(HERE, "..", "lib"))
import score as S  # noqa: E402
from streams import list_streams, load_dump  # noqa: E402

VAL = MY.get("val", "build/vad-train/val")


def main():
    sys.stdout.reconfigure(encoding="utf-8")
    spec = S.load_cand(CAND)
    corr = collections.defaultdict(lambda: [0, 0])
    neg = collections.defaultdict(lambda: [0, 0])
    worst = []
    for m in list_streams(VAL, ["vvoice", "vmix20", "vmix0", "vneg"]):
        c = load_dump(VAL, m)
        P = np.fromfile(os.path.join(CAND, m["set"], m["id"] + ".f32"), dtype="<f4").astype(np.float64)
        v = S.voice_flags(spec, m, S.hop_probs(spec, m, P))
        paint, lab = c["paint"] > 0, c["lab"].astype(np.int8)
        g = S.gnorm(m.get("gender"))
        if m["set"] == "vneg":
            k = m["source"]
            f = paint & (lab == 2)
            neg[k][0] += int(f.sum()); neg[k][1] += int((f & ~v).sum())
            neg["all"][0] += int(f.sum()); neg["all"][1] += int((f & ~v).sum())
            continue
        key = f"clean {m['group']}" if m["set"] == "vvoice" else f"{m['set']} {'+' if m['snr_db'] > 0 else ''}{m['snr_db']} dB"
        cc = paint & (lab == 1)
        corr[(key, g)][0] += int(cc.sum()); corr[(key, g)][1] += int((cc & ~v).sum())
        if cc.sum() >= 20:
            worst.append(((cc & ~v).sum() / cc.sum(), int(cc.sum()), m["set"], m["id"], g))
    print(f"operating point: agg {spec['agg']}, threshold {spec['threshold']}, hangover {spec['hangover_ms']} ms\n")
    print("| val group / cell | CORRECT hops f / m / unknown | vetoed % f | m | unknown |")
    print("|---|---|---|---|---|")
    for key in sorted({k for k, _ in corr}):
        a = [corr.get((key, g), [0, 0]) for g in ("f", "m", "unknown")]
        cells = [f"{100 * x[1] / x[0]:.2f}" if x[0] else "—" for x in a]
        print(f"| {key} | {' / '.join(f'{x[0]:,}' for x in a)} | {' | '.join(cells)} |")
    print("\n| val negatives | falsely painted hops | vetoed % |")
    print("|---|---|---|")
    for k, (a, b) in sorted(neg.items()):
        print(f"| {k} | {a:,} | {100 * b / max(a, 1):.2f} |")
    print(f"\nWorst val voice streams (>= 20 CORRECT hops), top {MY.get('worst', 8)}:\n")
    for r in sorted(worst, reverse=True)[:int(MY.get("worst", 8))]:
        print(f"- {r[2]}/{r[3]} ({r[4]}): {100 * r[0]:.1f} % of {r[1]}")


if __name__ == "__main__":
    main()
