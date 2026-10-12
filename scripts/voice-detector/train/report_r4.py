# report_r4.py — custom voice detector, round 4 (pre-registration 2026-10-11 §4
# "Reported, not used in the rule"; Addendum R4-B part 2, B.10): the reported
# V2 rows of a candidate at its picked point, on VALIDATION data only:
#   - the tuning-194 split per census label (the noise streams' `label`);
#   - the validation negatives (vneg) split by D2's steady threshold
#     (r4/stat.json: S_stat <= the training lowest-third threshold; streams
#     without an S_stat (< 3 s) are "not steady");
#   - the 14 fsr4 val clips (build/vad-train/r4/fsr4val, the current app's dumps
#     from valdump.mjs; the candidate's files in <cand>/fsr4val/<id>.f32).
# V2 = falsely painted hops (paint > 0 and lab == FALSE) vetoed at the point
# (opselect_r3.py's alignment: hop probability by agg, on = p >= thr, vetoed when
# the time since the stream's last "on" hop exceeds the hangover).
#
#   python report_r4.py --cand=NAME=FILEDIR[,NAME=FILEDIR..] --sel=SEL.json --key=NET:RULE[,..] [--json=OUT] [--md=OUT]
# FILEDIR holds <set>/<id>.f32 (e.g. build/vad-train/r4/cand/<net>/plain).
import json
import os
import sys

import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
MY = dict((a[2:].split("=", 1) + ["1"])[:2] for a in sys.argv[1:] if a.startswith("--"))
sys.argv = [sys.argv[0]]
import opselect_r3 as O  # noqa: E402
from streams import list_streams, load_dump  # noqa: E402

R4 = os.path.join(O.REPO, "build", "vad-train", "r4")
FSR4VAL = os.path.join(R4, "fsr4val")


def v2(items, fdir, agg, thr, hang):
    a = v = 0
    for root, m in items:
        c = load_dump(root, m)
        false = (c["paint"] > 0) & (c["lab"].astype(np.int8) == 2)
        if not false.any():
            continue
        P = np.fromfile(os.path.join(fdir, m["set"], m["id"] + ".f32"), dtype="<f4").astype(np.float64)
        p = O.hop_probs_fast(m, P, agg)
        on = p >= thr
        t = (np.arange(m["n"]) + 1) * m["hop_s"]
        li = np.maximum.accumulate(np.where(on, np.arange(m["n"]), -1))
        since = np.where(on, 0.0, np.where(li >= 0, t - t[np.maximum(li, 0)], np.inf))
        vet = since > hang / 1000.0 + 1e-9
        a += int(false.sum())
        v += int((false & vet).sum())
    return {"false": a, "vetoed": v, "v2": 100.0 * v / a if a else float("nan")}


def main():
    sel = {}
    for f in MY["sel"].split(","):
        sel.update(json.load(open(f, encoding="utf8")))
    st = json.load(open(os.path.join(R4, "stat.json"), encoding="utf8"))
    thr_s = st["s_stat_threshold_lowest_third"]
    ss = {r["id"][4:]: r.get("s_stat") for r in st["clips"] if r["id"].startswith("val:")}
    tune = [(O.BENCH, m) for m in list_streams(O.BENCH, ["noise"]) if m.get("split") == "tune"]
    vneg = [(O.VAL, m) for m in list_streams(O.VAL, ["vneg"])]
    fv = [(FSR4VAL, m) for m in list_streams(FSR4VAL, ["fsr4val"])] if os.path.isdir(os.path.join(FSR4VAL, "dumps")) else []
    out = {}
    for (name, fdir), key in zip([kv.split("=", 1) for kv in MY["cand"].split(",")], MY["key"].split(",")):
        b = sel[key]["best"] or sel[key]["fallback"]
        agg, thr, hang = b["agg"], b["thr"], b["hang"]
        r = {"point": {"agg": agg, "thr": thr, "hang": hang, "O": b["O"]}, "tune_by_label": {}, "vneg": {}}
        for lab in ("stationary-tonal", "mixed", "broadband", "intermittent-tonal"):
            it = [x for x in tune if x[1].get("label") == lab]
            r["tune_by_label"][lab] = dict(v2(it, fdir, agg, thr, hang), clips=len(it))
        r["tune_by_label"]["all"] = dict(v2(tune, fdir, agg, thr, hang), clips=len(tune))
        stdy = [x for x in vneg if ss.get(x[1]["id"]) is not None and ss[x[1]["id"]] <= thr_s]
        nst = [x for x in vneg if not (ss.get(x[1]["id"]) is not None and ss[x[1]["id"]] <= thr_s)]
        r["vneg"]["steady"] = dict(v2(stdy, fdir, agg, thr, hang), streams=len(stdy))
        r["vneg"]["not steady"] = dict(v2(nst, fdir, agg, thr, hang), streams=len(nst))
        r["vneg"]["all"] = dict(v2(vneg, fdir, agg, thr, hang), streams=len(vneg))
        if fv and all(os.path.exists(os.path.join(fdir, m["set"], m["id"] + ".f32")) for _, m in fv):
            r["fsr4_val"] = dict(v2(fv, fdir, agg, thr, hang), clips=len(fv))
        out[name] = r
        print(name, json.dumps(r), flush=True)
    if MY.get("json"):
        json.dump(out, open(MY["json"], "w", encoding="utf8"), indent=1)
    if MY.get("md"):
        L = ["| candidate (point) | tune-194 V2 % by census label: stationary-tonal / mixed / broadband / intermittent-tonal (all) | val negatives V2 %: steady / not steady (all) | fsr4 val V2 % |",
             "|---|---|---|---|"]
        f2 = lambda d: f"{d['v2']:.1f}"  # noqa: E731
        for name, r in out.items():
            t, vn = r["tune_by_label"], r["vneg"]
            p = r["point"]
            L.append(f"| {name} ({p['agg']} / {p['thr']} / {p['hang']:.0f} ms) | {f2(t['stationary-tonal'])} / {f2(t['mixed'])} / {f2(t['broadband'])} / {f2(t['intermittent-tonal'])} ({f2(t['all'])}) | "
                     f"{f2(vn['steady'])} / {f2(vn['not steady'])} ({f2(vn['all'])}) | {f2(r['fsr4_val']) if 'fsr4_val' in r else '—'} |")
        open(MY["md"], "w", encoding="utf8").write("\n".join(L) + "\n")


if __name__ == "__main__":
    main()
