"""Markdown tables for measurements/resonance-lab-benchmark-2026-10-04.md.

R6 is scored on the private session recordings. By default the tables carry two R6
columns AND a result column whose verdict includes R6 ("fail (R6)", or a PASS that implies
R6 passed). For anything pasted into measurements/ (public-data results only; see
CLAUDE.md "Private session data") add --public: it drops the R6 columns and judges the
result column on the public gates R1-R4 only.

  build/resonance-lab/venv/Scripts/python scripts/resonance-lab/lab_tables.py full [--public]  # every full test-split result
  build/resonance-lab/venv/Scripts/python scripts/resonance-lab/lab_tables.py live [--public]  # finalists: harness vs in-app lab path (--quick)
"""
import os
import sys
import json
import glob

LAB = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.dirname(os.path.dirname(LAB))
RES = os.path.join(REPO, "build", "resonance-lab", "results")
ALT = [os.path.join(REPO, "build", "resonance-lab", d) for d in ("review", "lab_live/results")]
PUBLIC_GATES = ("R1", "R2", "R3", "R4")


def find(name):
    for d in [RES] + ALT:
        p = os.path.join(d, name)
        if os.path.exists(p):
            return json.load(open(p))
    return None


def f(v, n=2):
    return "–" if v is None else f"{v:.{n}f}"


def row(d, public=False):
    r1 = d["R1"]["r1_test"]
    m = d["R2R3"].get("manip_test", {})
    r6 = d.get("R6", {})
    p = d.get("pass", {})
    if public:
        gates = {k: v for k, v in p.items() if k in PUBLIC_GATES}
        ok = bool(gates) and all(gates.values())
    else:
        gates, ok = p, p.get("ALL")
    fails = [k for k in PUBLIC_GATES + ("R6",) if gates.get(k) is False]
    cols = [f(r1.get("auc_5s")), f(m.get("praat_R2")), f(m.get("praat_R3")), f(m.get("praat_sign5")),
            f(m.get("praat_R3hi")) + " / " + f(m.get("praat_sign5hi")),
            f(d.get("R4", {}).get("R4")), f(d.get("R5", {}).get("flicker"))]
    if not public:
        cols += [f(r6.get("R_minus_L")) + " / " + f(r6.get("S_minus_R")),
                 "yes" if r6.get("ordering_ok") else "no"]
    return cols + ["**PASS**" if ok else "fail (" + ", ".join(fails) + ")"]


HEAD = ("| candidate | R1 AUC 5 s | R2 Praat | R3 Praat | sign ±5 % | R3 / sign @+8 st | R4 | flicker | "
        "R6 R−L / S−R (G) | R6 order | result |\n|---|---|---|---|---|---|---|---|---|---|---|")
HEAD_PUBLIC = ("| candidate | R1 AUC 5 s | R2 Praat | R3 Praat | sign ±5 % | R3 / sign @+8 st | R4 | flicker | "
               "result |\n|---|---|---|---|---|---|---|---|---|")


def full(public=False):
    print(HEAD_PUBLIC if public else HEAD)
    for p in sorted(glob.glob(os.path.join(RES, "*.json"))):
        b = os.path.basename(p)
        if b.startswith("leaderboard") or ".dev" in b or ".quick" in b or b.startswith(("lab_live", "judge", "review")):
            continue
        d = json.load(open(p))
        if d.get("split") != "test" or d.get("quick"):
            continue
        print("| " + d["name"] + " | " + " | ".join(row(d, public)) + " |")


def live(public=False):
    pairs = [("vtln", "vtln_warp.quick.json", "review_vtln_prodf0.quick.json", "lab_live_vtln.quick.json"),
             ("pnml", "pnml_head_scalesex_none0.quick.json", None, "lab_live_pnml.quick.json"),
             ("le", "le_ens_h64.quick.json", "le_ens_h64_prodf0.quick.json", "lab_live_le.quick.json"),
             ("fv", "fv_app101214_gm1234_ridge2_bw800.quick.json", None, "lab_live_fv.quick.json")]
    print((HEAD_PUBLIC if public else HEAD).replace("| candidate |", "| finalist / path |"))
    for key, h, prod, lv in pairs:
        for label, nm in (("harness F0 (prototype)", h), ("production-F0 track (prototype)", prod), ("**in-app lab path**", lv)):
            if not nm:
                continue
            d = find(nm)
            if d is None:
                print(f"| {key}: {label} | (missing {nm}) |")
                continue
            print(f"| {key}: {label} | " + " | ".join(row(d, public)) + " |")


if __name__ == "__main__":
    args = [a for a in sys.argv[1:] if a != "--public"]
    {"full": full, "live": live}[args[0] if args else "full"](public="--public" in sys.argv[1:])
