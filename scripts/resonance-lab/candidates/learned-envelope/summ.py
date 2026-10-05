"""One-line-per-candidate summary of harness results JSONs (R1-R8 headline numbers)."""
import os
import sys
import json
import glob

RES = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..", "..", "..", "build", "resonance-lab", "results")


def g(d, *ks):
    for k in ks:
        if d is None:
            return None
        d = d.get(k)
    return d


def f(v, n=2):
    return "–" if v is None else (f"{v:.{n}f}" if isinstance(v, (int, float)) else str(v))


def line(p):
    d = json.load(open(p))
    ms = "manip_test" if d["split"] == "test" else "manip_dev"
    r1 = g(d, "R1", "r1_test") or g(d, "R1", "r1_dev")
    m = g(d, "R2R3", ms) or {}
    cols = [
        os.path.basename(p).replace(".json", ""),
        f"R1 5s {f(r1.get('auc_5s'))} 2s {f(r1.get('auc_2s'))} spk {f(r1.get('auc_spk'))}",
        f"PTDB/FDA/Hill-tok {f(g(d,'R1','ptdb','auc_5s'))}/{f(g(d,'R1','fda','auc_5s'))}/{f(g(d,'R1','hill','auc_utt'))}",
        f"R2 p {f(m.get('praat_R2'))} w {f(m.get('world_R2'))}",
        f"tow p M+12 {f(m.get('praat_toward_m_p+12'))} F-12 {f(m.get('praat_toward_f_p-12'))}",
        f"flipM {f(m.get('praat_men_p+12_cross'))}({f(m.get('men_orig_cross'))})",
        f"R3 p {f(m.get('praat_R3'))} w {f(m.get('world_R3'))} sign {f(m.get('praat_sign5'))}/{f(m.get('world_sign5'))}",
        f"R3hi {f(m.get('praat_R3hi'))}/{f(m.get('praat_sign5hi'))}",
        f"x1.05 M {f(m.get('praat_toward_m_f1.05'))} F {f(m.get('praat_toward_f_f0.95'))}",
        f"R4 {f(g(d,'R4','R4'))}",
        f"R5 fl {f(g(d,'R5','flicker'))} held {f(g(d,'R5','held_sd'))} tts {f(g(d,'R5','time_to_stable_s'),1)}",
        f"R6 S-L {f(g(d,'R6','S_minus_L'))} R-L {f(g(d,'R6','R_minus_L'))} S-R {f(g(d,'R6','S_minus_R'))} ok {g(d,'R6','ordering_ok')}",
        f"R7 boys {f(g(d,'R7','synth_boys_position'))} girls {f(g(d,'R7','synth_girls_position'))} hiF0 {f(g(d,'R7','auc_highF0women_vs_men'))}",
        f"PASS {g(d,'pass')}",
    ]
    return " | ".join(cols)


if __name__ == "__main__":
    pats = sys.argv[1:] or ["le_*"]
    for pat in pats:
        for p in sorted(glob.glob(os.path.join(RES, pat + ".json"))):
            print(line(p))
