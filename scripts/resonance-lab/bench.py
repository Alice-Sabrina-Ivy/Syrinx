"""Resonance-validity benchmark: score a candidate, compute R1-R8, update the leaderboard.

  python scripts/resonance-lab/bench.py score <candidate.py[:Class]> [--quick] [--split test|dev]
                                         [--workers N] [--force]
  python scripts/resonance-lab/bench.py leaderboard

Use the venv interpreter (build/resonance-lab/venv/Scripts/python) — it has pyworld
plus everything in the system site-packages.
Outputs: build/resonance-lab/results/<name>[.dev][.quick].json and
         build/resonance-lab/results/leaderboard.{md,json}
"""
import os
import sys
import json
import argparse
import numpy as np

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from rlab import metrics as M  # noqa: E402
from rlab.runner import score_set, manifest, subsample  # noqa: E402
from rlab.candidate import load_candidate  # noqa: E402
from rlab.paths import RESULTS  # noqa: E402

TEST_SETS = ["r1_test", "ptdb", "fda", "hill", "manip_test", "manip_hill", "synth", "sessions"]
DEV_SETS = ["r1_dev", "manip_dev"]

RUBRIC = {
    "R1": "AUC(women>men) at 5 s voiced, LibriSpeech test-clean held-out speakers >= 0.85",
    "R2": "pitch leak |median score change per octave of pitch-only shift| / G <= 0.20 (Praat PSOLA, test-clean)",
    "R3": "resonance sensitivity (slope vs ln formant scale) x ln1.15 / G in [0.5, 1.5] AND sign accuracy at +-5 % >= 0.90 "
          "(Praat Change-gender, test-clean)",
    "R4": "Hillenbrand median within-speaker across-vowel SD / G_hill <= 0.5",
    "R6": "private-session pre-registered ordering of the three session groups (rlab/metrics.py; 5 s readouts)",
}


def _clean(o):
    if isinstance(o, dict):
        return {str(k): _clean(v) for k, v in o.items()}
    if isinstance(o, (list, tuple)):
        return [_clean(v) for v in o]
    if isinstance(o, (np.floating, float)):
        return None if not np.isfinite(o) else round(float(o), 5)
    if isinstance(o, (np.integer,)):
        return int(o)
    if isinstance(o, np.bool_):
        return bool(o)
    return o


def run(spec, quick, split, workers, force):
    cand = load_candidate(spec)
    print(f"candidate {cand.name} v{cand.version}: {cand.description}")
    sets = TEST_SETS if split == "test" else DEV_SETS
    sc, meta = {}, {}
    for s in sets:
        sc[s], meta[s] = score_set(spec, cand, s, quick=quick, workers=workers, force=force)
    man = {s: (subsample(manifest(s), s) if quick else manifest(s)) for s in sets}
    win = {s: M.windows(sc[s]) for s in sets}
    agg = cand.aggregate
    res = dict(name=cand.name, version=cand.version, description=cand.description, aggregate=agg,
               cadence_s=cand.cadence_s, uses_f0=cand.uses_f0, split=split, quick=quick)
    r1s = "r1_test" if split == "test" else "r1_dev"
    ms = "manip_test" if split == "test" else "manip_dev"
    r1, ru = M.r1(win[r1s], man[r1s], agg)
    G = M.gap(ru, man[r1s])
    sp = man[r1s].assign(r=man[r1s].item_id.map(ru).values).groupby(["speaker", "sex"]).r.median().reset_index()
    mid = float((sp[sp.sex == "f"].r.median() + sp[sp.sex == "m"].r.median()) / 2)
    res["G"], res["midpoint"] = G, mid
    res["R1"] = {r1s: r1}
    if G <= 0 or not np.isfinite(G):
        res["warning"] = "men-women gap G <= 0 on the R1 set: normalised metrics are meaningless"
    res["R2R3"] = {ms: M.manip_metrics(win[ms], man[ms], agg, G, mid)}
    res["R5"] = M.r5(win[r1s], man[r1s], win.get("synth"), man.get("synth"), agg, G)
    if split == "test":
        for s in ("ptdb", "fda"):
            res["R1"][s], _ = M.r1(win[s], man[s], agg)
        hr1, hru = M.r1(win["hill"], man["hill"], agg, horizons=())
        res["R1"]["hill"] = hr1
        G_hill = M.gap(hru, man["hill"])
        sph = man["hill"].assign(r=man["hill"].item_id.map(hru).values).groupby(["speaker", "sex"]).r.median().reset_index()
        mid_h = float((sph[sph.sex == "f"].r.median() + sph[sph.sex == "m"].r.median()) / 2)
        res["G_hill"] = G_hill
        res["R2R3"]["manip_hill"] = M.manip_metrics(win["manip_hill"], man["manip_hill"], agg, G_hill, mid_h)
        res["R4"] = M.r4(win["hill"], man["hill"], agg, G_hill)
        leak = res["R2R3"]["manip_test"]["praat_leak_per_oct"]
        res["R6"] = M.r6(win["sessions"], man["sessions"], agg, G, leak)
        res["R7"] = M.r7(win["synth"], man["synth"], win[r1s], man[r1s], agg)
    cpu = sum(meta[s]["cpu_s"] for s in sets if np.isfinite(meta[s]["cpu_s"]))
    aud = sum(meta[s]["audio_s"] for s in sets)
    res["R8"] = dict(cpu_ms_per_audio_s=1000 * cpu / aud if aud else np.nan, model_mb=cand.model_bytes / 1e6,
                     js_portability=cand.js_portability)
    res["pass"] = passes(res)
    res = _clean(res)
    tag = cand.name + (".dev" if split == "dev" else "") + (".quick" if quick else "")
    json.dump(res, open(os.path.join(RESULTS, tag + ".json"), "w"), indent=1)
    print(json.dumps({k: res[k] for k in ("G", "pass")}, indent=1))
    leaderboard()


def passes(res):
    p = {}
    r1s = "r1_test" if res["split"] == "test" else "r1_dev"
    mt = res["R2R3"]["manip_test" if res["split"] == "test" else "manip_dev"]
    a5 = res["R1"][r1s].get("auc_5s")
    p["R1"] = bool(a5 is not None and np.isfinite(a5) and a5 >= 0.85)
    p["R2"] = bool(np.isfinite(mt["praat_R2"]) and mt["praat_R2"] <= 0.2)
    p["R3"] = bool(np.isfinite(mt["praat_R3"]) and 0.5 <= mt["praat_R3"] <= 1.5 and mt["praat_sign5"] >= 0.9)
    if "R4" in res:
        p["R4"] = bool(np.isfinite(res["R4"]["R4"]) and res["R4"]["R4"] <= 0.5)
    if "R6" in res:
        p["R6"] = bool(res["R6"]["ordering_ok"])
    if not (res["G"] is not None and np.isfinite(res["G"]) and res["G"] > 0):
        p = {k: False for k in p}
    p["ALL"] = all(p.values())
    return p


def _f(v, nd=2):
    if v is None:
        return "–"
    if isinstance(v, bool):
        return "yes" if v else "no"
    return f"{v:.{nd}f}"


def leaderboard():
    rows = []
    for fn in sorted(os.listdir(RESULTS)):
        if fn.endswith(".json") and fn != "leaderboard.json":
            rows.append(json.load(open(os.path.join(RESULTS, fn))))
    json.dump(rows, open(os.path.join(RESULTS, "leaderboard.json"), "w"), indent=1)
    L = ["# Resonance-validity leaderboard", "",
         "Scores oriented larger = more feminine-typical. G = candidate's own men-women gap (test-clean speaker medians).",
         "R2/R3/R5/R6 in units of G. 'pitch-alone flips' = share of men (+12 st PSOLA) / women (-12 st) "
         "readouts crossing the men/women midpoint, base rate of the unmanipulated crops in brackets — the "
         "tail that a median-slope R2 can hide for saturating scores. Additivity = (dPitch-only + dFormant-only) "
         "/ dCombined (1 = additive, << 1 = the score needs both cues at once). Toward-class = median move of men "
         "toward female / women toward male, in G (a saturating score is flat the other way). Pass rubric: " + "; ".join(f"**{k}** {v}" for k, v in RUBRIC.items()), ""]
    for split, quick in (("test", False), ("test", True), ("dev", False), ("dev", True)):
        rs = [r for r in rows if r["split"] == split and r["quick"] == quick]
        if not rs:
            continue
        L += [f"## split={split}{' (QUICK subset — not comparable with full runs)' if quick else ''}", ""]
        r1s = "r1_test" if split == "test" else "r1_dev"
        ms = "manip_test" if split == "test" else "manip_dev"
        L += ["| candidate | R1 AUC 2s | **5s** | utt | spk | R2 leak praat | world | R3 sens praat | world | "
              "sign±5% praat | world | R3@+8st sens | sign | pitch-alone flips M+12st / F−12st (base) | "
              "M→F +12st×1.15 additivity | toward-class Δ/G pitch M+12 / F−12 | formant M×1.15 / F×0.85 | R4 | R5 flicker | held SD | t-stable s | "
              "R6 S−L | R−L | S−R | R−L pitch-corr | order | R7 boys pos | girls pos | R8 ms/s | MB | PASS |",
              "|" + "---|" * 32]
        for r in sorted(rs, key=lambda r: r["name"]):
            a = r["R1"][r1s]
            m = r["R2R3"][ms]
            r4 = r.get("R4", {})
            r5 = r["R5"]
            r6 = r.get("R6", {})
            r7 = r.get("R7", {})
            ps = r["pass"]
            flag = lambda k: (" ✓" if ps.get(k) else " ✗") if k in ps else ""  # noqa: E731
            L.append("| " + " | ".join([
                r["name"], _f(a.get("auc_2s")), _f(a.get("auc_5s")) + flag("R1"), _f(a.get("auc_utt")),
                _f(a.get("auc_spk")),
                _f(m.get("praat_R2")) + flag("R2"), _f(m.get("world_R2")),
                _f(m.get("praat_R3")) + flag("R3"), _f(m.get("world_R3")),
                _f(m.get("praat_sign5")), _f(m.get("world_sign5")),
                _f(m.get("praat_R3hi")), _f(m.get("praat_sign5hi")),
                f"{_f(m.get('praat_men_p+12_cross'))} / {_f(m.get('praat_women_p-12_cross'))} "
                f"({_f(m.get('men_orig_cross'))} / {_f(m.get('women_orig_cross'))})",
                _f(m.get("praat_mf+12_f1.15_additivity")),
                f"{_f(m.get('praat_toward_m_p+12'))} / {_f(m.get('praat_toward_f_p-12'))}",
                f"{_f(m.get('praat_toward_m_f1.15'))} / {_f(m.get('praat_toward_f_f0.85'))}",
                _f(r4.get("R4")) + flag("R4"), _f(r5.get("flicker")), _f(r5.get("held_sd")),
                _f(r5.get("time_to_stable_s"), 1),
                _f(r6.get("S_minus_L")), _f(r6.get("R_minus_L")), _f(r6.get("S_minus_R")),
                _f(r6.get("R_minus_L_pitch_corrected")), (_f(r6.get("ordering_ok")) + flag("R6")) if r6 else "–",
                _f(r7.get("synth_boys_position")), _f(r7.get("synth_girls_position")),
                _f(r["R8"].get("cpu_ms_per_audio_s"), 1), _f(r["R8"].get("model_mb"), 1),
                "**PASS**" if ps.get("ALL") else "fail"]) + " |")
        L.append("")
        if split == "test":
            L += ["Per-corpus R1 (AUC utt / 2s / 5s) and Hillenbrand-vowel manipulations:", "",
                  "| candidate | PTDB utt | PTDB 5s | FDA utt | FDA 5s | Hill token | Hill spk | Hill R2 praat | "
                  "Hill R3 praat | Hill sign±5% | Hill R3 world | test-clean women R3 / sign | men R3 / sign | "
                  "R6 AUC5s S/L | R/L | S/R | highF0 women AUC | lowF0 women AUC |", "|" + "---|" * 19]
            for r in sorted(rs, key=lambda r: r["name"]):
                R1 = r["R1"]
                mh = r["R2R3"].get("manip_hill", {})
                m = r["R2R3"][ms]
                r6, r7 = r.get("R6", {}), r.get("R7", {})
                L.append("| " + " | ".join([
                    r["name"], _f(R1.get("ptdb", {}).get("auc_utt")), _f(R1.get("ptdb", {}).get("auc_5s")),
                    _f(R1.get("fda", {}).get("auc_utt")), _f(R1.get("fda", {}).get("auc_5s")),
                    _f(R1.get("hill", {}).get("auc_utt")), _f(R1.get("hill", {}).get("auc_spk")),
                    _f(mh.get("praat_R2")), _f(mh.get("praat_R3")), _f(mh.get("praat_sign5")), _f(mh.get("world_R3")),
                    f"{_f(m.get('praat_R3_f'))} / {_f(m.get('praat_sign5_f'))}",
                    f"{_f(m.get('praat_R3_m'))} / {_f(m.get('praat_sign5_m'))}",
                    _f(r6.get("auc_5s_second_vs_alice_low")), _f(r6.get("auc_5s_alice_raised_vs_alice_low")),
                    _f(r6.get("auc_5s_second_vs_alice_raised")),
                    _f(r7.get("auc_highF0women_vs_men")), _f(r7.get("auc_lowF0women_vs_men"))]) + " |")
            L.append("")
    open(os.path.join(RESULTS, "leaderboard.md"), "w", encoding="utf8").write("\n".join(L))
    print(f"leaderboard: {os.path.join(RESULTS, 'leaderboard.md')}")


def main():
    ap = argparse.ArgumentParser()
    sub = ap.add_subparsers(dest="cmd", required=True)
    s = sub.add_parser("score")
    s.add_argument("candidate")
    s.add_argument("--quick", action="store_true")
    s.add_argument("--split", choices=["test", "dev"], default="test")
    s.add_argument("--workers", type=int, default=max(1, (os.cpu_count() or 4) - 2))
    s.add_argument("--force", action="store_true")
    sub.add_parser("leaderboard")
    a = ap.parse_args()
    if a.cmd == "score":
        run(a.candidate, a.quick, a.split, a.workers, a.force)
    else:
        leaderboard()


if __name__ == "__main__":
    main()
