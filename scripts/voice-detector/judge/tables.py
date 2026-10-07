# tables.py — the judge's cross-candidate table (voice-detector benchmark,
# 2026-10-06) from score.py --json outputs: one column per candidate at its
# pre-registered operating point, every bar row, bar failures in bold.
#
#   python scripts/voice-detector/judge/tables.py SCORES.json [SCORES.json ...] [--order=name,name,...]
import json
import sys

sys.stdout.reconfigure(encoding="utf-8")
files = [a for a in sys.argv[1:] if not a.startswith("--")]
opt = dict((a[2:].split("=", 1) + ["1"])[:2] for a in sys.argv[1:] if a.startswith("--"))
d = {}
for f in files:
    with open(f, encoding="utf8") as fh:
        d.update(json.load(fh)["candidates"])
names = opt["order"].split(",") if "order" in opt else list(d)
C = [d[n] for n in names]


def row(label, vals):
    print(f"| {label} | " + " | ".join(vals) + " |")


def b(s, bad):
    return f"**{s}**" if bad else s


def v2key(c, suffix):
    return [k for k in c["V2"] if k == suffix or k.endswith(suffix.lstrip("… "))][0]


print("| row | " + " | ".join(names) + " |")
print("|---|" + "---|" * len(names))
row("operating point", [f"p ≥ {c['spec']['threshold']:.3g}, hangover {c['spec']['hangover_ms'] / 1000:g} s" for c in C])
for k in C[0]["V1"]:
    lim = 3.0 if k.startswith("voice") else 1.0
    row(f"V1 {k} (≤ {lim:g} %)", [b(f"{(c['V1'][k]['worse'] or '?')[0]} {c['V1'][k]['worse_pct']:.2f}", c["V1"][k]["worse_pct"] > lim) for c in C])
for k, lim in (("all 279 (tuning)", 60), ("… tuning split 194", None), ("held-out A: in-set split 85", 50),
               ("held-out B: second set 119", 50), ("… held-out B dcaseeval", None), ("… held-out B fsheld", None)):
    row(f"V2 {k}" + (f" (≥ {lim} %)" if lim else ""), [b(f"{c['V2'][v2key(c, k)]['pct']:.2f}", bool(lim) and c["V2"][v2key(c, k)]["pct"] < lim) for c in C])
row("… clip-mean painted on the 279, 23.93 % →", [f"{c['V2'][v2key(c, 'all 279 (tuning)')]['clipmean_after']:.2f}" for c in C])
for k in ("stationary-tonal", "intermittent-tonal", "mixed", "broadband", "hvac (279)", "hvac (held-out B)", "mains_hum (279)",
          "mains_hum (held-out B)", "microwave (279)", "refrigerator (279)", "generator (279)"):
    row(f"V2 {k}", [f"{c['V2'][k]['pct']:.2f}" for c in C])
for k, lab in (("vin20 10 prog", "+10 dB, gaps between phrases"), ("vin20 0 tail", "0 dB, tail after the voice"), ("vin0 0 tail", "0 dB lead 0, tail")):
    row(f"info: false hops next to voice vetoed, {lab}", [f"{c['info'][k][2]:.2f}" for c in C])
row("V3 frame + lookahead (≤ 100 ms)", [b(f"{c['spec']['frame_ms'] + c['spec']['lookahead_ms']:g}", c["spec"]["frame_ms"] + c["spec"]["lookahead_ms"] > 100) for c in C])


def wg(c):
    return max(c["V3"]["by_gender"].items(), key=lambda kv: kv[1]["median"])


row("V3 onset delay median, worse gender (≤ 100 ms)", [b(f"{wg(c)[0][0]} {wg(c)[1]['median']:.0f}", wg(c)[1]["median"] > 100) for c in C])
row("… onsets > 100 ms / never shown, worst group %", [f"{max(s['over100'] for s in c['V3']['by_gender'].values()):.2f} / {max(s['never'] for s in c['V3']['by_gender'].values()):.2f}" for c in C])
row("V4 licence · size · browser · CPU", [" · ".join("pass" if c["V4"][x] else "**FAIL**" for x in ("license", "bytes", "runtime", "cpu")) for c in C])
row("verdict V1 · V2 · V3 · V4", [" · ".join("pass" if c["verdict"][x] else "**FAIL**" for x in ("V1", "V2", "V3", "V4")) for c in C])
