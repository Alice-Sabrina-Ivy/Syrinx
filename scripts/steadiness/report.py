# report.py — markdown tables for measurements/steadiness-readout-2026-10-04.md
# from score.py JSON. Usage: python scripts/steadiness/report.py JSON CFG [what]
#   what: sessions | corpora | synth | prec | best | bins
import json, sys
import numpy as np
D = json.load(open(sys.argv[1])); cfg = sys.argv[2]; what = sys.argv[3] if len(sys.argv) > 3 else "sessions"
R = D[cfg]


def ag(o, k="agree"):
    a = o.get(k, {})
    if a.get("n", 0) < 3: return "n<3 | | | |"
    return f"{a['n']} | {a['med_err']:+.3f} | {a['mae']:.3f} | {a['p90']:.3f} | {a.get('r', float('nan')):.2f}"


if what == "sessions":
    S = R["sessions"]
    print("| speaker | windows (AC voiced) | n | fresh reading | shown incl. held | n agree | median err | MAE | p90 | r (< 2 st) |")
    print("|---|---|---|---|---|---|---|---|---|---|")
    for spk in ("alice", "second"):
        for cat, lab in (("held", "held ≥ 90 %"), ("speech", "speech-like ≥ 60 %"), ("sparse", "sparse 20–60 %"), ("lt0.2", "< 20 %")):
            o = S[f"{spk}|{cat}"]
            print(f"| {spk} | {lab} | {o['N']} | {100*o['fresh']:.1f} % | {100*o['shown']:.1f} % | {ag(o)} |")
    o = S["all|silent"]
    print(f"| all | no reference voicing within ±0.3 s | {o['N']} | {100*o['fresh']:.2f} % | {100*o['shown']:.2f} % | | | | | |")
elif what == "bins":
    S = R["sessions"]
    print("| speaker / windows | " + " | ".join(f"ref {b} st: n / MAE / median err" for b in ("0-0.5", "0.5-1", "1-2", "2-99")) + " |")
    print("|---|---|---|---|---|")
    for k in ("alice|held", "alice|speech", "second|held", "second|speech"):
        b = S[k]["agree"].get("bins", {})
        print(f"| {k} | " + " | ".join(f"{b[x]['n']} / {b[x]['mae']:.3f} / {b[x]['med']:+.3f}" if x in b else "—" for x in ("0-0.5", "0.5-1", "1-2", "2-99")) + " |")
elif what == "corpora":
    C = R["corpora"]
    print("| set | windows ≥ 60 % voiced | fresh reading | n | median err | MAE | p90 | r | MAE vs 3-st-trimmed ref | MAE by ref bin 0–0.5 / 0.5–1 / 1–2 / ≥ 2 st |")
    print("|---|---|---|---|---|---|---|---|---|---|")
    for k in ("fda_f|speech", "fda_m|speech", "ptdb_f|speech", "ptdb_m|speech", "voc|speech", "voc|sparse"):
        o = C[k]; b = o["agree_raw"].get("bins", {})
        print(f"| {k} | {o['N']} | {100*o['fresh']:.1f} % | {ag(o, 'agree_raw')} | {o['agree'].get('mae', float('nan')):.3f} | "
              + " / ".join(f"{b[x]['mae']:.2f}" if x in b else "—" for x in ("0-0.5", "0.5-1", "1-2", "2-99")) + " |")
elif what in ("synth", "prec"):
    Y = R[what]
    print("| case | full-coverage windows | fresh reading | shown incl. held | n | median err | MAE | p90 | truth SD median | reading median |")
    print("|---|---|---|---|---|---|---|---|---|---|")
    for k in sorted(Y):
        if k.startswith("noise|") or not k.endswith("|full"): continue
        o = Y[k]; a = o.get("agree", {})
        tm = f"{a['ref_med']:.2f} | {a['det_med']:.2f}" if a.get("n", 0) >= 3 else " | "
        print(f"| {k[:-5]} | {o['N']} | {100*o['fresh']:.1f} % | {100*o['shown']:.1f} % | {ag(o).rsplit(' | ', 1)[0]} | {tm} |")
    nz = {k: v for k, v in Y.items() if k.startswith("noise|")}
    if nz:
        print("\n| noise-only class | readout windows | fresh reading | shown incl. held |")
        print("|---|---|---|---|")
        for k, o in sorted(nz.items()):
            print(f"| {k[6:]} | {o['N']} | {100*o['fresh']:.2f} % | {100*o['shown']:.2f} % |")
elif what == "best":
    for spk in ("alice", "second"):
        print(f"| {spk} session | reference p5 / p10 | readout p5 / p10 | n ref / n readout |")
        print("|---|---|---|---|")
        for ss, v in R["sessions"][f"best|{spk}"].items():
            f = lambda x: f"{x[0]:.2f} / {x[1]:.2f}" if x else "—"
            print(f"| {ss} | {f(v[0])} | {f(v[1])} | {v[2]} / {v[3]} |")
