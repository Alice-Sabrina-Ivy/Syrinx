"""Markdown tables for measurements/resonance-lab-benchmark-2026-10-04.md.

The R6 columns are results on the private session recordings: drop them before pasting a
table into measurements/ (public-data results only; see CLAUDE.md "Private session data").

  build/resonance-lab/venv/Scripts/python scripts/resonance-lab/lab_tables.py full     # every full test-split result
  build/resonance-lab/venv/Scripts/python scripts/resonance-lab/lab_tables.py live     # finalists: harness vs in-app lab path (--quick)
"""
import os
import sys
import json
import glob

LAB = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.dirname(os.path.dirname(LAB))
RES = os.path.join(REPO, "build", "resonance-lab", "results")
ALT = [os.path.join(REPO, "build", "resonance-lab", d) for d in ("review", "lab_live/results")]


def find(name):
    for d in [RES] + ALT:
        p = os.path.join(d, name)
        if os.path.exists(p):
            return json.load(open(p))
    return None


def f(v, n=2):
    return "–" if v is None else f"{v:.{n}f}"


def row(d):
    r1 = d["R1"]["r1_test"]
    m = d["R2R3"].get("manip_test", {})
    r6 = d.get("R6", {})
    p = d.get("pass", {})
    fails = [k for k in ("R1", "R2", "R3", "R4", "R6") if p.get(k) is False]
    return [f(r1.get("auc_5s")), f(m.get("praat_R2")), f(m.get("praat_R3")), f(m.get("praat_sign5")),
            f(m.get("praat_R3hi")) + " / " + f(m.get("praat_sign5hi")),
            f(d.get("R4", {}).get("R4")), f(d.get("R5", {}).get("flicker")),
            f(r6.get("R_minus_L")) + " / " + f(r6.get("S_minus_R")),
            "yes" if r6.get("ordering_ok") else "no",
            "**PASS**" if p.get("ALL") else "fail (" + ", ".join(fails) + ")"]


HEAD = ("| candidate | R1 AUC 5 s | R2 Praat | R3 Praat | sign ±5 % | R3 / sign @+8 st | R4 | flicker | "
        "R6 R−L / S−R (G) | R6 order | result |\n|---|---|---|---|---|---|---|---|---|---|---|")


def full():
    print(HEAD)
    for p in sorted(glob.glob(os.path.join(RES, "*.json"))):
        b = os.path.basename(p)
        if b.startswith("leaderboard") or ".dev" in b or ".quick" in b or b.startswith(("lab_live", "judge", "review")):
            continue
        d = json.load(open(p))
        if d.get("split") != "test" or d.get("quick"):
            continue
        print("| " + d["name"] + " | " + " | ".join(row(d)) + " |")


def live():
    pairs = [("vtln", "vtln_warp.quick.json", "review_vtln_prodf0.quick.json", "lab_live_vtln.quick.json"),
             ("pnml", "pnml_head_scalesex_none0.quick.json", None, "lab_live_pnml.quick.json"),
             ("le", "le_ens_h64.quick.json", "le_ens_h64_prodf0.quick.json", "lab_live_le.quick.json"),
             ("fv", "fv_app101214_gm1234_ridge2_bw800.quick.json", None, "lab_live_fv.quick.json")]
    print(HEAD.replace("| candidate |", "| finalist / path |"))
    for key, h, prod, lv in pairs:
        for label, nm in (("harness F0 (prototype)", h), ("production-F0 track (prototype)", prod), ("**in-app lab path**", lv)):
            if not nm:
                continue
            d = find(nm)
            if d is None:
                print(f"| {key}: {label} | (missing {nm}) |")
                continue
            print(f"| {key}: {label} | " + " | ".join(row(d)) + " |")


if __name__ == "__main__":
    {"full": full, "live": live}[sys.argv[1] if len(sys.argv) > 1 else "full"]()
