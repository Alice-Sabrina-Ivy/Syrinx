# opselect.py — custom voice detector (2026-10-06): the pre-registered
# operating-point rule (pre-registration §3) for one model's probability files.
#
# Selection data ONLY: the validation dumps (valdump.mjs: vvoice, vmix20,
# vmix0, vneg) and the benchmark's 194-clip TUNING split (noise dumps with
# split == "tune"; no other benchmark stream is read). Alignment, threshold,
# hangover and onset logic are score.py's own (hop_probs / voice_flags /
# onsets), so every grid point equals what score.py would compute.
#
# Rule, per model, over threshold x hangover x agg:
#   feasible = every clean val group (speech / vowels / singing) vetoes
#              <= 0.5 % of CORRECTLY painted hops in its worse gender, every
#              val mix cell (+10 / 0 dB x lead 20 s / lead 0) <= 1.5 %, frame +
#              lookahead <= 100 ms and median onset delay (worse gender, val
#              voice + mixes) <= 100 ms;
#   objective = % of falsely painted hops vetoed on the tuning 194 (pooled);
#   pick = the feasible maximum; ties within 0.5 pp -> the shorter hangover.
# Secondary (reported): V2 on the val negatives.
#
# Round 2 (pre-registration Addendum D.4): three more clean groups (clinical,
# exercises, children) and, with --carried, the same grid scored on the
# carried-state files of each candidate (infer_carried.py; default dir
# <CAND>-carried): a point is feasible only if every group and cell meets its
# limit on BOTH the fresh and the carried files. If no point is feasible, the
# point with the smallest worst ratio (vetoes / limit, fresh and carried) is
# reported as the fallback.
#
#   python opselect.py CAND_DIR [--val=build/vad-train/val] [--bench=build/vad] [--json=OUT] [--write-best]
#          [--thr=...] [--hang=...] [--aggs=last,max,mean]
import json
import os
import sys

import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
MY = dict((a[2:].split("=", 1) + ["1"])[:2] for a in sys.argv[1:] if a.startswith("--"))
CANDS = [a for a in sys.argv[1:] if not a.startswith("--")]
sys.argv = [sys.argv[0]]  # score.py parses argv at import
sys.path.insert(0, os.path.join(HERE, ".."))
sys.path.insert(0, os.path.join(HERE, "..", "lib"))
import score as S  # noqa: E402
from streams import list_streams, load_dump  # noqa: E402

VAL = MY.get("val", "build/vad-train/val")
BENCH = MY.get("bench", "build/vad")
THR = [float(v) for v in MY.get("thr", "0.01,0.02,0.03,0.05,0.07,0.1,0.13,0.16,0.2,0.25,0.3,0.35,0.4,0.45,0.5,0.55,0.6,0.65,0.7,0.75,0.8,0.85,0.9,0.95").split(",")]
HANG = [float(v) for v in MY.get("hang", "0,50,100,150,200,250,300,400,500,600,750,1000,1250,1500,2000,3000").split(",")]
AGGS = MY.get("aggs", "last,max,mean").split(",")
CLEAN_LIM, MIX_LIM, ONSET_LIM, TIE_PP = 0.5, 1.5, 100.0, 0.5
GROUPS = ["speech", "vowels", "singing", "clinical", "exercises", "children"]
CELLS = [("vmix20", 10), ("vmix20", 0), ("vmix0", 10), ("vmix0", 0)]


def load_streams():
    out = []
    for m in list_streams(VAL, ["vvoice", "vmix20", "vmix0", "vneg"]):
        out.append((VAL, m))
    for m in list_streams(BENCH, ["noise"]):
        if m.get("split") == "tune":       # the tuning split only
            out.append((BENCH, m))
    return out


def key_of(m):
    s, g = m["set"], S.gnorm(m.get("gender"))
    if s == "vvoice":
        return ("clean", m["group"], g)
    if s in ("vmix20", "vmix0"):
        return ("mix", f"{s} {m['snr_db']}", g)
    if s == "vneg":
        return ("vneg", "vneg", g)
    return ("tune", "tune194", g)


_DUMPS = {}


def evaluate(cdir, streams):
    spec0 = S.load_cand(cdir)
    rows = []
    for root, m in streams:
        k = (root, m["set"], m["id"])
        if k not in _DUMPS:
            cols = load_dump(root, m)
            _DUMPS[k] = (cols["paint"] > 0, cols["lab"].astype(np.int8),
                         S.onsets(cols["paint"], cols["lab"].astype(np.int8)) if m["set"] in ("vvoice", "vmix20", "vmix0") else [])
        paint, lab, ons = _DUMPS[k]
        fp = os.path.join(cdir, m["set"], m["id"] + ".f32")
        if not os.path.exists(fp):
            if "allow-missing" in MY:   # previews on partial data only; a selection needs every stream
                continue
            raise SystemExit(f"{fp}: missing")
        P = np.fromfile(fp, dtype="<f4").astype(np.float64)
        rows.append({"m": m, "key": key_of(m), "P": P, "corr": paint & (lab == 1), "false": paint & (lab == 2), "paint": paint, "ons": ons})
    H = np.array(HANG) / 1000.0 + 1e-9
    res = []
    for agg in AGGS:
        spec = dict(spec0, agg=agg)
        hp = [S.hop_probs(spec, r["m"], r["P"]) for r in rows]
        for thr in THR:
            cnt = {}
            onset = {"f": [], "m": [], "unknown": []}
            for r, p in zip(rows, hp):
                n, hop = r["m"]["n"], r["m"]["hop_s"]
                t = (np.arange(n) + 1) * hop
                on = p >= thr
                last = np.maximum.accumulate(np.where(on, t, -np.inf))
                since = np.where(on, 0.0, t - last)                   # inf where never on
                for nm, mask in (("corr", r["corr"]), ("false", r["false"])):
                    sv = np.sort(since[mask])
                    tot = len(sv)
                    vet = tot - np.searchsorted(sv, H, side="right")  # since > H -> vetoed
                    k = r["key"] + (nm,)
                    a = cnt.setdefault(k, [0, np.zeros(len(H))])
                    a[0] += tot
                    a[1] += vet
                for s, e in r["ons"]:
                    seg = since[s:e + 1]
                    pm = r["paint"][s:e + 1]
                    vals = np.where(pm, seg, np.inf)
                    rm = np.minimum.accumulate(vals)                  # non-increasing
                    # first index j with rm[j] <= H
                    idx = len(rm) - np.searchsorted(rm[::-1], H, side="right")   # rm non-increasing: first j with rm[j] <= h
                    onset[r["key"][2]].append(idx * hop * 1000.0)
            for hi, hang in enumerate(HANG):
                pt = {"agg": agg, "thr": thr, "hang": hang}
                worst_clean, worst_mix = 0.0, 0.0
                det = {}
                for grp in GROUPS:
                    vals = {}
                    for g in ("f", "m", "unknown"):
                        a = cnt.get(("clean", grp, g, "corr"))
                        if a and a[0]:
                            vals[g] = 100.0 * a[1][hi] / a[0]
                    if vals:
                        w = max(vals.values())
                        det[f"clean {grp}"] = w
                        worst_clean = max(worst_clean, w)
                for s, snr in CELLS:
                    vals = {}
                    for g in ("f", "m", "unknown"):
                        a = cnt.get(("mix", f"{s} {snr}", g, "corr"))
                        if a and a[0]:
                            vals[g] = 100.0 * a[1][hi] / a[0]
                    if vals:
                        w = max(vals.values())
                        det[f"mix {s} {snr:+d}"] = w
                        worst_mix = max(worst_mix, w)
                med = {g: float(np.median([o[hi] for o in v])) for g, v in onset.items() if v}
                onset_worst = max(med.values()) if med else float("nan")
                tune = [cnt[k] for k in cnt if k[0] == "tune" and k[3] == "false"]
                ta, tv = sum(a[0] for a in tune), sum(a[1][hi] for a in tune)
                vn = [cnt[k] for k in cnt if k[0] == "vneg" and k[3] == "false"]
                va, vv = sum(a[0] for a in vn), sum(a[1][hi] for a in vn)
                lat = spec0["frame_ms"] + spec0["lookahead_ms"]
                pt.update(det)
                pt.update({"worst_clean": worst_clean, "worst_mix": worst_mix, "onset_median_worst": onset_worst,
                           "tune194_v2": 100.0 * tv / ta if ta else float("nan"), "vneg_v2": 100.0 * vv / va if va else float("nan"),
                           "latency_ms": lat})
                pt["feasible"] = bool(worst_clean <= CLEAN_LIM and worst_mix <= MIX_LIM and lat <= 100 and onset_worst <= ONSET_LIM)
                res.append(pt)
    return spec0, res


def ratio(r):
    """Worst vetoes / limit over every group and cell (fresh, and carried if scored)."""
    v = max(r["worst_clean"] / CLEAN_LIM, r["worst_mix"] / MIX_LIM)
    if "carried" in r:
        v = max(v, r["carried"]["worst_clean"] / CLEAN_LIM, r["carried"]["worst_mix"] / MIX_LIM)
    return v


def merge_carried(res, res_c):
    for r, c in zip(res, res_c):
        assert (r["agg"], r["thr"], r["hang"]) == (c["agg"], c["thr"], c["hang"])
        r["fresh_feasible"] = r["feasible"]
        r["carried"] = {k: v for k, v in c.items() if k not in ("agg", "thr", "hang")}
        r["feasible"] = bool(r["feasible"] and c["feasible"])
    return res


def pick(res):
    feas = [r for r in res if r["feasible"]]
    if not feas:
        return None
    best = max(r["tune194_v2"] for r in feas)
    near = [r for r in feas if r["tune194_v2"] >= best - TIE_PP]
    hmin = min(r["hang"] for r in near)
    return max([r for r in near if r["hang"] == hmin], key=lambda r: (r["tune194_v2"], r["vneg_v2"]))


def main():
    streams = load_streams()
    print(f"{len(streams)} selection streams", file=sys.stderr)
    out = {}
    for c in CANDS:
        spec, res = evaluate(c, streams)
        if "carried" in MY:
            cd = c.rstrip("/\\") + "-carried" if MY["carried"] == "1" else MY["carried"]
            _, res_c = evaluate(cd, streams)
            res = merge_carried(res, res_c)
        best = pick(res)
        fb = None if best else min(res, key=ratio)
        out[spec["name"]] = {"best": best, "fallback": fb, "grid": res}
        if best:
            cw = f", carried worst clean {best['carried']['worst_clean']:.2f} % / mix {best['carried']['worst_mix']:.2f} %" if "carried" in best else ""
            print(f"{spec['name']}: PICK agg {best['agg']} thr {best['thr']} hang {best['hang']} ms -> tune194 V2 {best['tune194_v2']:.2f} % "
                  f"(worst clean {best['worst_clean']:.2f} %, worst mix {best['worst_mix']:.2f} %{cw}, onset {best['onset_median_worst']:.0f} ms, vneg V2 {best['vneg_v2']:.2f} %)")
        else:
            print(f"{spec['name']}: NO feasible point; fallback (smallest worst ratio {ratio(fb):.2f}): "
                  f"{json.dumps({k: (round(v, 3) if isinstance(v, float) else v) for k, v in fb.items() if k != 'carried'})}"
                  + (f" carried {json.dumps({k: round(v, 3) for k, v in fb['carried'].items() if isinstance(v, float)})}" if "carried" in fb else ""))
        # trade-off: best tune V2 at relaxed limits (information)
        for mult in (2, 4):
            fe = [r for r in res if r["worst_clean"] <= CLEAN_LIM * mult and r["worst_mix"] <= MIX_LIM * mult and r["onset_median_worst"] <= ONSET_LIM]
            if fe:
                b = max(fe, key=lambda r: r["tune194_v2"])
                print(f"   (info) limits x{mult}: tune194 V2 {b['tune194_v2']:.2f} % at agg {b['agg']} thr {b['thr']} hang {b['hang']}")
        if "write-best" in MY and best:
            with open(os.path.join(c, "candidate.json"), "w", encoding="utf8") as f:
                json.dump(dict({k: v for k, v in spec.items() if not k.startswith("_")}, threshold=best["thr"], hangover_ms=best["hang"], agg=best["agg"]), f, indent=1)
    if MY.get("json"):
        with open(MY["json"], "w", encoding="utf8") as f:
            json.dump(out, f)


if __name__ == "__main__":
    main()
