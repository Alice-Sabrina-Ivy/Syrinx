# custom_r2_report.py — custom voice detector, round 2 (pre-registration
# Addendum D.5): the rows reported next to the look, for one candidate at its
# own operating point (score.py's own functions; nothing here is a gate):
#   - V1 per reference-F0 band (75-90 / 90-300 / 300-400 Hz) per V1 row, cell
#     and gender; V1 mix cells per voice source and per voice program
#   - V2 per noise source on the 279 (tuning / held-out A) and held-out B;
#     held-out B split into the classes shared with training (Addendum D.1) and
#     the new ones; held-out A without its Freesound clips
#   - clip-bootstrap 95 % intervals (resampling streams) for the V2 sets and
#     the V1 mix cells (worse gender per resample), and P(cell <= 3 %)
#   - with --carried=DIR, score.py's V1 / V2 / V3 summary on the carried-state
#     files (infer_carried.py) and their F0-band rows
# Run from the repo root:
#   python scripts/voice-detector/judge/custom_r2_report.py --cand=build/vad/cand/custom-vd [--carried=DIR] --out=JSON [--boot=2000]
import json
import os
import sys
import time
from collections import defaultdict

import numpy as np

MY = dict((a[2:].split("=", 1) + ["1"])[:2] for a in sys.argv[1:] if a.startswith("--"))
sys.argv = [sys.argv[0], "--worst=0"]
REPO = os.getcwd()
sys.path.insert(0, os.path.join(REPO, "scripts", "voice-detector"))
sys.path.insert(0, os.path.join(REPO, "scripts", "voice-detector", "lib"))
import score as S  # noqa: E402
from streams import list_streams, load_dump  # noqa: E402

BANDS = [(75, 90), (90, 300), (300, 400.0001)]
SHARED_B = {"mains_hum", "hvac", "pump", "exhaust_fan", "computer_fan", "transformer", "electronics_whine", "engine_idle", "appliance_motor"}
V1SETS = ["fda", "ptdb", "voc", "vocalset", "pvqd", "voiced", "hil"]


def load(cand):
    spec = S.load_cand(cand)
    items = []
    for meta in list_streams(S.ROOT):
        cols = load_dump(S.ROOT, meta)
        P = np.fromfile(os.path.join(spec["_dir"], meta["set"], meta["id"] + ".f32"), dtype="<f4").astype(np.float64)
        v = S.voice_flags(spec, meta, S.hop_probs(spec, meta, P))
        paint, lab = cols["paint"] > 0, cols["lab"].astype(np.int8)
        items.append({"m": meta, "g": S.gnorm(meta.get("gender")), "veto": paint & ~v, "lab": lab, "refd": cols["refd"], "paint": cols["paint"]})
    return spec, items


def cell_of(m):
    if m["set"] in ("vin20", "vin0"):
        return f"{m['set']} {m['snr_db']:+d}"
    return m["set"]


def pct(v, a):
    return round(100.0 * v / a, 3) if a else None


def bands(items):
    d = defaultdict(lambda: [0, 0])
    for it in items:
        m = it["m"]
        if m["set"] in ("noise", "noiseho"):
            continue
        corr = it["lab"] == 1
        for lo, hi in BANDS:
            sel = corr & (it["refd"] >= lo) & (it["refd"] < hi)
            k = (cell_of(m), f"{lo}-{int(hi)}", it["g"])
            d[k][0] += int(sel.sum())
            d[k][1] += int((sel & it["veto"]).sum())
    return {" | ".join(k): (a, v, pct(v, a)) for k, (a, v) in sorted(d.items())}


def boot_ci(groups, rng, n):
    """groups: list of (correct_or_false, vetoed) per stream -> 2.5 / 97.5 % of the pooled %."""
    a = np.array(groups, dtype=np.float64)
    if not len(a):
        return None
    idx = rng.integers(0, len(a), (n, len(a)))
    s = a[idx].sum(1)
    p = 100 * s[:, 1] / np.maximum(s[:, 0], 1)
    return [round(float(np.percentile(p, 2.5)), 2), round(float(np.percentile(p, 97.5)), 2)]


def main():
    t0 = time.time()
    rng = np.random.default_rng(20261007)
    nb = int(MY.get("boot", "2000"))
    out = {"cand": MY["cand"]}
    spec, items = load(MY["cand"])
    out["point"] = {k: spec[k] for k in ("threshold", "hangover_ms", "agg")}
    out["v1_bands"] = bands(items)
    # mix cells per voice source / program
    d = defaultdict(lambda: [0, 0])
    prog = defaultdict(lambda: [0, 0])
    for it in items:
        m = it["m"]
        if m["set"] not in ("vin20", "vin0"):
            continue
        c = it["lab"] == 1
        k = (cell_of(m), m.get("voice_source"), it["g"])
        d[k][0] += int(c.sum())
        d[k][1] += int((c & it["veto"]).sum())
        pk = (m.get("voice"), it["g"])
        prog[pk][0] += int(c.sum())
        prog[pk][1] += int((c & it["veto"]).sum())
    out["mix_by_voice_source"] = {" | ".join(str(x) for x in k): (a, v, pct(v, a)) for k, (a, v) in sorted(d.items())}
    out["mix_programs_worst"] = sorted([(k[0], k[1], a, v, pct(v, a)) for k, (a, v) in prog.items() if a >= 50], key=lambda r: -(r[4] or 0))[:25]
    # V2 per source
    v2 = defaultdict(lambda: [0, 0, 0])
    per = defaultdict(list)
    for it in items:
        m = it["m"]
        if m["set"] not in ("noise", "noiseho"):
            continue
        f = it["lab"] == 2
        a, v = int(f.sum()), int((f & it["veto"]).sum())
        if m["set"] == "noise":
            keys = [f"279 {m['source']}", f"{'tune' if m['split'] == 'tune' else 'A'} {m['source']}", "279", "tune" if m["split"] == "tune" else "A"]
            if m["split"] != "tune" and m["source"] != "freesound":
                keys.append("A without freesound")
            if m["source"] == "demand" or m["source"] == "dcase":
                keys.append(f"{'tune' if m['split'] == 'tune' else 'A'} {m['source']} {m.get('cls')}")
        else:
            keys = ["B", f"B {m['source']}", f"B {m['source']} {m.get('cls')}"]
            if m["source"] == "fsheld":
                keys.append("B fsheld shared classes" if m.get("cls") in SHARED_B else "B fsheld new classes")
        for k in keys:
            v2[k][0] += a
            v2[k][1] += v
            v2[k][2] += 1
            per[k].append((a, v))
    out["v2"] = {k: (a, v, pct(v, a), n) for k, (a, v, n) in sorted(v2.items())}
    out["v2_ci"] = {k: boot_ci(per[k], rng, nb) for k in ("279", "tune", "A", "B", "A without freesound", "B fsheld shared classes", "B fsheld new classes",
                                                           "B dcaseeval", "A freesound")}
    # V1 mix cells: bootstrap of the worse gender
    cells = defaultdict(list)
    for it in items:
        m = it["m"]
        if m["set"] in ("vin20", "vin0"):
            c = it["lab"] == 1
            cells[cell_of(m)].append((it["g"], int(c.sum()), int((c & it["veto"]).sum())))
    mc = {}
    for k, rows in sorted(cells.items()):
        gs = sorted({g for g, _, _ in rows})
        G = np.array([gs.index(g) for g, _, _ in rows])
        A_ = np.array([(a, v) for _, a, v in rows], dtype=np.float64)
        idx = rng.integers(0, len(rows), (nb, len(rows)))
        worst = np.zeros(nb)
        per_g = {}
        for gi, g in enumerate(gs):
            w = (G[idx] == gi)[..., None] * A_[idx]
            s = w.sum(1)
            p = 100 * s[:, 1] / np.maximum(s[:, 0], 1)
            per_g[g] = [round(float(np.percentile(p, 2.5)), 2), round(float(np.percentile(p, 97.5)), 2)]
            worst = np.maximum(worst, p)
        tot = {g: (int(A_[G == gi, 0].sum()), int(A_[G == gi, 1].sum())) for gi, g in enumerate(gs)}
        mc[k] = {"pct": {g: pct(v, a) for g, (a, v) in tot.items()}, "ci": per_g,
                 "worse_ci": [round(float(np.percentile(worst, 2.5)), 2), round(float(np.percentile(worst, 97.5)), 2)],
                 "p_worse_le_3": round(float((worst <= 3.0).mean()), 4), "streams": len(rows)}
    out["v1_mix_bootstrap"] = mc
    # V1 clean rows per gender (for reference)
    cl = defaultdict(lambda: [0, 0])
    for it in items:
        m = it["m"]
        if m["set"] in V1SETS:
            c = it["lab"] == 1
            cl[(m["set"], it["g"])][0] += int(c.sum())
            cl[(m["set"], it["g"])][1] += int((c & it["veto"]).sum())
    out["v1_clean"] = {f"{s} | {g}": (a, v, pct(v, a)) for (s, g), (a, v) in sorted(cl.items())}
    print(f"fresh rows done ({time.time() - t0:.0f} s)", flush=True)
    if MY.get("carried"):
        spec_c, items_c = load(MY["carried"])
        rows = []
        for it in items_c:
            m = it["m"]
            lab, veto = it["lab"], it["veto"]
            r = {"set": m["set"], "id": m["id"], "gender": it["g"], "n": m["n"], "snr": m.get("snr_db"), "split": m.get("split"),
                 "label": m.get("label"), "cls": m.get("cls"), "source": m.get("source"), "noise_class": m.get("noise_class"),
                 "painted": int((it["paint"] > 0).sum()), "nd": 1, "hop_ms": m["hop_s"] * 1000}
            for nm, code in (("correct", 1), ("false", 2), ("wrong", 3), ("edge", 4)):
                sel = lab == code
                r[nm], r[nm + "_v"] = int(sel.sum()), int((sel & veto).sum())
            out_on = []
            for s, e in S.onsets(it["paint"], lab):
                ok = np.nonzero((it["paint"][s:e + 1] > 0) & ~veto[s:e + 1])[0]
                out_on.append((int(ok[0]) if len(ok) else e - s + 1, not len(ok)))
            r["onsets"] = out_on
            rows.append(r)
        out["carried_bands"] = bands(items_c)
        out["carried_sessions"] = MY["carried"]
        cc = defaultdict(lambda: [0, 0])
        for r in rows:
            k = (r["set"] if r["set"] not in ("vin20", "vin0") else f"{r['set']} {r['snr']:+d}", r["gender"])
            if r["set"] in ("noise", "noiseho"):
                continue
            cc[k][0] += r["correct"]
            cc[k][1] += r["correct_v"]
        out["carried_v1"] = {f"{s} | {g}": (a, v, pct(v, a)) for (s, g), (a, v) in sorted(cc.items())}
        nz = defaultdict(lambda: [0, 0])
        for r in rows:
            if r["set"] == "noise":
                for k in ("279", "tune" if r["split"] == "tune" else "A"):
                    nz[k][0] += r["false"]
                    nz[k][1] += r["false_v"]
            elif r["set"] == "noiseho":
                nz["B"][0] += r["false"]
                nz["B"][1] += r["false_v"]
        out["carried_v2"] = {k: (a, v, pct(v, a)) for k, (a, v) in nz.items()}
        print(f"carried rows done ({time.time() - t0:.0f} s)", flush=True)
    with open(MY["out"], "w", encoding="utf8") as f:
        json.dump(out, f, indent=1)
    print("wrote", MY["out"])


if __name__ == "__main__":
    main()
