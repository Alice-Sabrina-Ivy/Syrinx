# make_tables.py — the markdown tables of
# measurements/pitch-detector-benchmark-2026-10-04.md section 5, from
# <WORK>/out/scores_corpora.json, scores_sessions.json and timing.json.
# Usage: python -X utf8 scripts/pitch-benchmark/make_tables.py > <WORK>/out/tables.md
import os, sys, json
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from paths import OUT
SC = json.load(open(os.path.join(OUT, "scores_corpora.json")))
SS = json.load(open(os.path.join(OUT, "scores_sessions.json"))) if os.path.exists(os.path.join(OUT, "scores_sessions.json")) else {}
NAMES = {
    "syrinx_main": "Syrinx-main (posted)", "syrinx_new": "Syrinx-new (posted)", "syrinx_new600": "Syrinx-new@600 (posted)",
    "syrinx_main_disp": "Syrinx-main (displayed)", "syrinx_new_disp": "Syrinx-new (displayed)", "syrinx_new600_disp": "Syrinx-new@600 (displayed)",
    "praat_ac": "Praat AC default (75-600)", "praat_ac_cal": "Praat AC 100-500", "praat_cc": "Praat CC default",
    "pyin": "pYIN (librosa)", "penn": "PENN FCNF0++", "crepe_full": "CREPE full (torchcrepe)", "crepe_tiny": "CREPE tiny (torchcrepe)",
    "swift_offline": "SwiftF0 offline, gate 0.5", "swift_stream": "SwiftF0 retired production stream, gate 0.5", "swift_offline_g09": "SwiftF0 offline, gate 0.9 (upstream)",
    "pyin_ungated": "pYIN raw pitch, voicing removed", "penn_ungated": "PENN raw pitch, voicing removed",
    "crepe_tiny_ungated": "CREPE tiny raw pitch, voicing removed", "swift_offline_ungated": "SwiftF0 offline raw pitch, voicing removed",
}
ORDER = [k for k in NAMES if k in SC]
CORP = [("fda", "FDA"), ("ptdb", "PTDB-TUG"), ("voc", "vocadito"), ("hil", "Hillenbrand*")]
f1 = lambda x: "-" if x is None or x != x else f"{x:.1f}"
f2 = lambda x: "-" if x is None or x != x else f"{x:.2f}"


def g(det, c, key):
    return SC.get(det, {}).get(c, {}).get("groups", {}).get(key)


print("## Corpora, all reference-voiced frames (best offset per detector x corpus)\n")
for c, cn in CORP:
    print(f"### {cn}\n")
    print("| detector | offset ms | RPA | RCA | ±5 % (C5) | GPE | FPE (cents) | VDE | oct-down | oct-up | null | RPA pitch-only |")
    print("|---|---|---|---|---|---|---|---|---|---|---|---|")
    for d in ORDER:
        a = g(d, c, "all|all")
        if not a: continue
        print(f"| {NAMES[d]} | {SC[d][c]['offset_ms']:+d} | {f1(a['RPA'])} | {f1(a['RCA'])} | {f1(a['C5'])} | {f2(a['GPE'])} | {f1(a['FPE'])} | {f1(a['VDE'])} | {f2(a['down'])} | {f2(a['up'])} | {f1(a['null'])} | {f1(a['RPAraw'])} |")
    print()

print("## Corpora by gender: RPA / ±5 % correct, and the gender-symmetric max(F_err, M_err) on ±5 %\n")
print("| detector | FDA f | FDA m | PTDB f | PTDB m | Hil f* | Hil m* | vocadito | max err FDA | max err PTDB |")
print("|---|---|---|---|---|---|---|---|---|---|")
for d in ORDER:
    cells = []
    for c, gs in (("fda", "f"), ("fda", "m"), ("ptdb", "f"), ("ptdb", "m"), ("hil", "f"), ("hil", "m"), ("voc", "u")):
        a = g(d, c, f"{gs}|all")
        cells.append(f"{f1(a['RPA'])} / {f1(a['C5'])}" if a else "-")
    me = []
    for c in ("fda", "ptdb"):
        af, am = g(d, c, "f|all"), g(d, c, "m|all")
        me.append(f1(max(100 - af["C5"], 100 - am["C5"])) if af and am else "-")
    print(f"| {NAMES[d]} | " + " | ".join(cells) + f" | {me[0]} | {me[1]} |")
print()

print("## Corpora by F0 band, speech (FDA + PTDB pooled, frame-weighted): RPA / ±5 % / oct-down / oct-up / null\n")
BANDS = ["<75", "75-160", "160-300", "300-400", ">=400"]
print("| detector | " + " | ".join(BANDS) + " |")
print("|---|" + "---|" * len(BANDS))
for d in ORDER:
    cells = []
    for b in BANDS:
        n = 0; acc = {k: 0.0 for k in ("RPA", "C5", "down", "up", "null")}
        for c in ("fda", "ptdb"):
            a = g(d, c, f"all|{b}")
            if not a: continue
            n += a["n"]
            for k in acc: acc[k] += a[k] * a["n"]
        cells.append(f"{acc['RPA']/n:.1f} / {acc['C5']/n:.1f} / {acc['down']/n:.1f} / {acc['up']/n:.1f} / {acc['null']/n:.1f} (n {n})" if n else "-")
    print(f"| {NAMES[d]} | " + " | ".join(cells) + " |")
print()
print("## vocadito (singing) by band: RPA / ±5 % / oct-down / null\n")
print("| detector | 75-160 | 160-300 | 300-400 | >=400 |")
print("|---|---|---|---|---|")
for d in ORDER:
    cells = []
    for b in ["75-160", "160-300", "300-400", ">=400"]:
        a = g(d, "voc", f"all|{b}")
        cells.append(f"{f1(a['RPA'])} / {f1(a['C5'])} / {f1(a['down'])} / {f1(a['null'])} (n {a['n']})" if a else "-")
    print(f"| {NAMES[d]} | " + " | ".join(cells) + " |")
print()

if SS:
    for conv, title in (("U", "UNANIMOUS frames (AC, SHS, PENN all within 5 %) — same frames for every detector"),
                        ("LOFO", "LEAVE-ONE-FAMILY-OUT (AC family vs SHS & PENN; neural vs AC & SHS)")):
        print(f"## Sessions — {title}: ±5 % correct / oct-down / oct-up / null (pooled over 4 sessions)\n")
        cols = [("alice|pooled|75-160", "Alice 75-160"), ("alice|pooled|160-260", "Alice 160-260"), ("alice|pooled|260-400", "Alice 260-400"),
                ("alice|pooled|>=400", "Alice ≥400"), ("alice|HO|160-400", "Alice 160-400 held-out"), ("second|pooled|all", "Second voice (all)")]
        print("| detector | ref | offset ms | " + " | ".join(c[1] for c in cols) + " |")
        print("|---|---|---|" + "---|" * len(cols))
        for d in [k for k in NAMES if k in SS]:
            r = SS[d]; T = r[conv]
            ref = "unanimous" if conv == "U" else ("SHS&PENN" if r["LOFO_conv"] == "Lac" else "AC&SHS")
            cells = []
            for k, _ in cols:
                a = T.get(k)
                cells.append(f"{f1(a['C5'])} / {f1(a['down'])} / {f1(a['up'])} / {f1(a['null'])}" if a else "-")
            print(f"| {NAMES[d]} | {ref} | {r['offset_ms']:+d} | " + " | ".join(cells) + " |")
        print()
        if conv == "U":
            n = {k: SS[ORDER[0]][conv][k]["n"] for k, _ in cols if k in SS[ORDER[0]][conv]}
            print("Frames: " + ", ".join(f"{k} {v}" for k, v in n.items()) + "\n")

    print("## Sessions — cross view: every detector against BOTH two-voter references (±5 % correct / null)\n")
    print("A detector is circular against a reference that contains its own family's voter: AC family (Syrinx, Praat, pYIN) vs AC&SHS; PENN vs SHS&PENN. Non-circular cells are the fair cross-family comparison.\n")
    cols = [("alice|pooled|75-160", "Alice 75-160"), ("alice|pooled|160-260", "Alice 160-260"), ("alice|pooled|260-400", "Alice 260-400"), ("alice|HO|160-400", "Alice 160-400 HO"), ("second|pooled|all", "Second voice")]
    for kk, title in (("X_Lac", "reference = SHS & PENN agree (no AC voter)"), ("X_Lnn", "reference = Praat AC & SHS agree (no neural voter)")):
        print(f"**{title}**\n")
        print("| detector | circular? | " + " | ".join(c[1] for c in cols) + " |")
        print("|---|---|" + "---|" * len(cols))
        for d in [k for k in NAMES if k in SS and "X_Lac" in SS[k]]:
            fam = SS[d]["family"]
            circ = ("yes (PENN voter)" if d.startswith("penn") else "no") if kk == "X_Lac" else ("yes (AC voter)" if fam == "ac" else "no")
            cells = []
            for k, _ in cols:
                a = SS[d][kk].get(k)
                cells.append(f"{f1(a['C5'])} / {f1(a['null'])}" if a else "-")
            print(f"| {NAMES[d]} | {circ} | " + " | ".join(cells) + " |")
        n = {c[1]: SS[ORDER[0]][kk][c[0]]["n"] for c in cols if c[0] in SS[ORDER[0]][kk]}
        print("\nFrames: " + ", ".join(f"{k} {v}" for k, v in n.items()) + "\n")

# ---- cost table ----
TP = os.path.join(OUT, "timing.json")
if os.path.exists(TP):
    T = json.load(open(TP))
    COST = [  # name, timing key, causal?, latency, model, browser
        ("Syrinx-main / -new / -new@600", "syrinx_new", "yes (streaming, per 25 ms chunk)", "~90 ms posted (40 ms window centre + 50 ms L=2 decode); ~112 ms displayed", "none (≈60 KB JS source)", "yes — deployed (pure JS worker)"),
        ("Praat AC (default / 100-500)", "praat_ac", "no — full-utterance Viterbi", "offline (window 3/floor = 40 ms; path uses whole file)", "none (Praat 6.1.38 via parselmouth)", "no (desktop app; no maintained web build)"),
        ("Praat CC", "praat_cc", "no — full-utterance Viterbi", "offline", "none", "no"),
        ("pYIN (librosa)", "pyin", "no — full-file HMM Viterbi", "offline (64 ms window)", "none", "not librosa; a WASM pYIN exists in essentia.js (untested)"),
        ("PENN FCNF0++", "penn", "no — full-file Viterbi decode (frame net is local, 128 ms window)", "offline", "8.9 M params, 107 MB checkpoint (HF hub)", "only via export; ruled out 2026-05-13 (6–7× slower than SwiftF0 in browser WASM, needs COI headers)"),
        ("CREPE full (torchcrepe)", "crepe_full", "no as run (Viterbi); argmax/local decode would be causal + 32 ms", "offline as run", "22.2 M params, 89 MB", "TF.js ports exist (ml5.js); heavy"),
        ("CREPE tiny (torchcrepe)", "crepe_tiny", "same", "offline as run", "0.49 M params, 2.0 MB", "TF.js ports exist; plausible"),
        ("SwiftF0 offline", "swift_offline", "frame-local net, no decoder (streamable)", "offline as run (64 ms STFT frames, centred)", "398 KB ONNX", "yes — was deployed 2026-05-06..06-09 (onnxruntime-web WASM, 5–11 ms per inference)"),
        ("SwiftF0 retired production stream", "swift_stream", "yes", "~56 ms (frame 0 of the rolling 1024-sample buffer)", "398 KB ONNX", "yes (was production)"),
    ]
    print("## Cost and deployability (this machine, single thread, 60 s of session audio)\n")
    print("CPU = process CPU time over the clip, median of 3 after a warm-up call; torch / onnxruntime pinned to 1 thread. Praat parallelises internally (process CPU 1.6–7.6 ms/s but wall 0.4–0.8 ms/s). Syrinx = the real pitch worker's chunk handler (Node, one JS thread, observation tap off).\n")
    print("| detector | causal / streaming? | latency | CPU ms per s of audio | model / download | runs in a browser today? |")
    print("|---|---|---|---|---|---|")
    for name, key, causal, lat, model, br in COST:
        t = T.get(key, {}).get("cpu_ms_per_s")
        extra = ""
        if key == "syrinx_new" and "syrinx_main" in T: extra = f" (main {T['syrinx_main']['cpu_ms_per_s']:.0f})"
        if key == "praat_ac" and "praat_ac_cal" in T: extra = f" (100-500: {T['praat_ac_cal']['cpu_ms_per_s']:.0f})"
        print(f"| {name} | {causal} | {lat} | {('%.0f' % t) if t is not None else '-'}{extra} | {model} | {br} |")
    print()
