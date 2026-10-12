# opselect_r5.py — custom voice detector, round 5 (pre-registration
# measurements/voice-detector-round5-preregistration-2026-10-12.md §2, §4;
# Addendum R5-B): the selection rule of round 4 (opselect_r3.py's readings,
# feasibility and objective, unchanged) PLUS the new practice-bar rows, on
# VALIDATION data only:
#   H1  held phonation and hums next to steady machines (r5/hval h1 streams):
#       veto share of the CORRECT hops whose reference F0 lies in the sex's band
#       (men 75-130 Hz, women 160-300 Hz), per sex x condition (clean / +20 /
#       +10 / 0 dB) x voice kind (real / synthetic vowel / synthetic hum),
#       pooled over the cell's streams; limits 0.5 % clean, 1.5 % with a bed
#   H2  long holds (r5/hval h2 streams), every CORRECT hop: per sex x condition
#       x {synthetic holds, real series}, the veto share in every 10-s bin of t
#       (t = td - the hold's onset; the last bin of a hold = its last 10 s),
#       bins under 400 current-app CORRECT hops merged with the bin before
#       them (§2.5; fixed from the current-app dumps, no model); limits 0.5 %
#       clean, 1.5 % with a bed; and last 10 s <= first 10 s + 1 pp
# A point is feasible when it is feasible under opselect_r3.py AND every H1
# cell and H2 reading holds for each sex. Objective O and the choice within a
# candidate are round 4's (opselect_r3.score_candidate / pick on the feasible
# points). Reported, not in the rule (--report, at a point): H1 by bed class,
# real / synthetic bed, f0 sub-band, lead; streams with > 10 % of their CORRECT
# hops vetoed; H2 by bin and hold length, holds whose last 10 s are > 10 %
# vetoed; H3 (the one-room validation sessions per layer row x source x sex x
# condition, and the round-4 medium finding: 0 dB speech rows per sex).
#
#   python opselect_r5.py --cands=NET:rule[,..] [--root=build/vad-train/r5/cand] [--json=OUT] [--no-spl]
#   python opselect_r5.py --cands=DIR:file --root=. ...           (deployable re-check: rule-applied ONNX files)
#   python opselect_r5.py --point=NET:rule:agg:thr:hang [--root=..] [--json=OUT]   (one point: every reading + reports)
#   python opselect_r5.py --selftest=NET:rule [--root=..]         (H readings vs score.py's functions at a few points)
import collections
import json
import os
import sys
import time

import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
MY = dict((a[2:].split("=", 1) + ["1"])[:2] for a in sys.argv[1:] if a.startswith("--"))
REPO = os.path.abspath(os.path.join(HERE, "../../.."))
sys.argv = [sys.argv[0], "--root=" + MY.get("root", os.path.join(REPO, "build", "vad-train", "r5", "cand"))]
import opselect_r3 as O3  # noqa: E402  (reads --root from the argv set above)
S = O3.S
from streams import list_streams, load_dump  # noqa: E402

HV = os.path.join(REPO, "build", "vad-train", "r5", "hval")
BANDS = {"m": (75.0, 130.0), "f": (160.0, 300.0)}
CONDS = {"clean": 0.5, "snr+20": 1.5, "snr+10": 1.5, "snr+0": 1.5}
MIN_HOPS = 400


def _td(m):
    tk = (np.arange(m["n"]) + 1) * m["hop_s"]
    return tk - 0.040 - m["L"] * m["hop_s"] - 0.030


def _bins(m, corr):
    """hval.cells' H2 bins of one stream: list of (bin label, mask); standard bins b and 'last' (its last 10 s)."""
    ep = m["episodes"][0]
    t = _td(m) - ep["start"]
    nb = int(np.ceil(ep["dur"] / 10.0 - 1e-9))
    out = []
    for b in range(nb):
        if b < nb - 1:
            out.append((b, corr & (t >= b * 10.0) & (t < (b + 1) * 10.0)))
        else:
            out.append(("last", corr & (t >= ep["dur"] - 10.0) & (t <= ep["dur"])))
    return out


def h_metas(fam):
    return list_streams(HV, [fam])


def h2_merge():
    """§2.5: per (sex, cond, kind) the standard bins in order; a bin with < 400 current-app CORRECT hops joins the bin before it.
    -> {cell: {bin: group label (first bin of the group)}}, counts."""
    cnt = collections.defaultdict(collections.Counter)
    for m in h_metas("h2"):
        c = load_dump(HV, m)
        corr = (c["paint"] > 0) & (c["lab"] == 1)
        cell = (m["gender"], m["cond"], "real" if m["voice_kind"] == "real" else "syn")
        for b, mk in _bins(m, corr):
            cnt[cell][b] += int(mk.sum())
    groups = {}
    for cell, cc in cnt.items():
        g, cur = {}, None
        for b in sorted(k for k in cc if k != "last"):
            if cur is None or cc[b] >= MIN_HOPS:
                cur = b
            g[b] = cur
        groups[cell] = g
    return groups, cnt


def h_items():
    """Blocks: h1 (gating cells), h2b (merged standard bins), h2l (last 10 s)."""
    groups, cnt = h2_merge()
    h1, h2b, h2l = [], [], []
    for m in h_metas("h1"):
        c = load_dump(HV, m)
        corr = (c["paint"] > 0) & (c["lab"] == 1)
        lo, hi = BANDS[m["gender"]]
        mk = corr & (c["refd"] >= lo) & (c["refd"] <= hi)
        h1.append({"meta": m, "rel": f"h1/{m['id']}", "masks": [(mk, ("h1", m["gender"], m["cond"], m["voice_kind"]))], "onsets": [], "paint": None})
    for m in h_metas("h2"):
        c = load_dump(HV, m)
        corr = (c["paint"] > 0) & (c["lab"] == 1)
        cell = (m["gender"], m["cond"], "real" if m["voice_kind"] == "real" else "syn")
        mb, ml = {}, []
        for b, mk in _bins(m, corr):
            if b == "last":
                ml.append((mk, ("h2", *cell, "last")))
            else:
                key = ("h2", *cell, f"bin{groups[cell][b]}")
                mb[key] = mb[key] | mk if key in mb else mk
        h2b.append({"meta": m, "rel": f"h2/{m['id']}", "masks": [(v, k) for k, v in mb.items()], "onsets": [], "paint": None})
        h2l.append({"meta": m, "rel": f"h2/{m['id']}", "masks": ml, "onsets": [], "paint": None})
    return {"h1": O3.Block(h1), "h2b": O3.Block(h2b), "h2l": O3.Block(h2l)}, groups, cnt


def h_summarise(blocks, res):
    """Per grid point: H1 cells, H2 bins / last / first, feasibility of the H rows, worst ratios."""
    pts = {}
    kmaps = {b: {v: k for k, v in blocks[b].keys.items()} for b in blocks}
    for k in res["h1"]:
        for hi, hang in enumerate(O3.HANG):
            d = {"cells": {}, "fail": []}
            for bname in ("h1", "h2b", "h2l"):
                tot, vet, _ = res[bname][k]
                for j, key in kmaps[bname].items():
                    d["cells"]["|".join(key)] = (int(tot[j]), int(vet[j, hi]))
            worst = 0.0
            for key, (n, v) in d["cells"].items():
                p = key.split("|")
                lim = CONDS[p[2]]
                share = 100.0 * v / n if n else float("nan")
                if p[0] == "h2" and n < MIN_HOPS:           # only a merged group can be this small at the end: reported, not gating
                    continue
                if n and share > lim:
                    d["fail"].append(key)
                if n:
                    worst = max(worst, share / lim)
            for key, (n, v) in d["cells"].items():           # H2 growth: last <= first + 1 pp
                p = key.split("|")
                if p[0] == "h2" and p[4] == "last":
                    f = d["cells"].get("|".join(p[:4] + ["bin0"]))
                    if f and f[0] and n and 100.0 * v / n > 100.0 * f[1] / f[0] + 1.0:
                        d["fail"].append("|".join(p[:4] + ["growth"]))
            d["feasible"] = not d["fail"]
            d["worst_ratio"] = worst
            pts[(k[0], k[1], hang)] = d
    return pts


def h_probs(block, net_dir, rule):
    return O3.probs(block, net_dir, rule, "")


def score_h(hb, net, rule):
    net_dir = net if rule == "file" else os.path.join(O3.CROOT, net)
    res = {b: hb[b].evaluate(h_probs(hb[b], net_dir, rule)) for b in hb}
    return h_summarise(hb, res)


def compact(hp):
    """H readings of one point for the JSON: cell -> veto %, fails."""
    return {"cells": {k: (round(100.0 * v / n, 4) if n else None, n) for k, (n, v) in hp["cells"].items()}, "fail": hp["fail"],
            "worst_ratio": hp["worst_ratio"], "feasible": hp["feasible"]}


def pick5(grid):
    feas = [r for r in grid if r["feasible"]]
    if not feas:
        return None
    best = max(r["O"] for r in feas)
    near = [r for r in feas if r["O"] >= best - O3.TIE_PP]
    hmin = min(r["hang"] for r in near)
    return max([r for r in near if r["hang"] == hmin], key=lambda r: (r["O"], r["fresh"]["vneg_v2"]))


def ratio5(r):
    return max(O3.ratio(r), r["h"]["worst_ratio"])


# ---------------------------------------------------------------- one point, direct (score.py's functions): reports + self-test
def direct_point(net_dir, rule, agg, thr, hang):
    """Every H stream at one point through score.py's hop_probs / voice_flags; per-stream vetoed masks."""
    spec = dict(O3.SPEC, agg=agg, threshold=thr, hangover_ms=hang)
    out = {}
    for fam in ("h1", "h2"):
        for m in h_metas(fam):
            P = O3.combine(net_dir, "", f"{fam}/{m['id']}", rule)
            v = S.voice_flags(spec, m, S.hop_probs(spec, m, P))
            out[(fam, m["id"])] = (m, ~v)
    return out


def reports(net_dir, rule, agg, thr, hang, groups):
    D = direct_point(net_dir, rule, agg, thr, hang)
    R = collections.defaultdict(lambda: [0, 0])
    over10 = collections.Counter()
    nstreams = collections.Counter()
    for (fam, sid), (m, vet) in D.items():
        c = load_dump(HV, m)
        corr = (c["paint"] > 0) & (c["lab"] == 1)
        sx, cond = m["gender"], m["cond"]
        bed = m.get("bed") or {}
        bcls = bed.get("cls", "none")
        btyp = bed.get("type", "none")
        if fam == "h1":
            lo, hi = BANDS[sx]
            mk = corr & (c["refd"] >= lo) & (c["refd"] <= hi)
            mid = {"m": 100.0, "f": 230.0}[sx]
            vk = m["voice_kind"]
            for name, sel in (("bedclass " + bcls, mk), ("bedtype " + btyp, mk), ("lead %d" % int(m["lead"]), mk),
                              ("f0 low", mk & (c["refd"] < mid)), ("f0 high", mk & (c["refd"] >= mid))):
                a = R[f"h1|{sx}|{cond}|{vk}|{name}"]
                a[0] += int(sel.sum())
                a[1] += int((sel & vet).sum())
            nstreams[f"h1|{sx}|{cond}|{vk}"] += 1
            if mk.sum() and (mk & vet).sum() > 0.10 * mk.sum():
                over10[f"h1|{sx}|{cond}|{vk}"] += 1
        else:
            kind = "real" if m["voice_kind"] == "real" else "syn"
            ln = int(round(m["episodes"][0]["dur"])) if kind == "syn" else "series"
            for b, sel in _bins(m, corr):
                a = R[f"h2|{sx}|{cond}|{kind}|len {ln}|bin {b}"]
                a[0] += int(sel.sum())
                a[1] += int((sel & vet).sum())
                if b == "last":
                    nstreams[f"h2|{sx}|{cond}|{kind}"] += 1
                    if sel.sum() and (sel & vet).sum() > 0.10 * sel.sum():
                        over10[f"h2|{sx}|{cond}|{kind}"] += 1
            for name, sel in (("bedclass " + bcls, corr), ("bedtype " + btyp, corr)):
                a = R[f"h2|{sx}|{cond}|{kind}|{name}"]
                a[0] += int(sel.sum())
                a[1] += int((sel & vet).sum())
    rep = {k: (round(100.0 * v / n, 3) if n else None, n) for k, (n, v) in sorted(R.items())}
    return {"breakdowns": rep, "streams_over10pct": {k: f"{over10[k]}/{nstreams[k]}" for k in sorted(nstreams)}}


def h3(net_dir, rule, agg, thr, hang):
    """H3 (§2.6, reported): one-room validation sessions, CORRECT hops per layer row x source x layer gender x condition."""
    spec = dict(O3.SPEC, agg=agg, threshold=thr, hangover_ms=hang)
    R = collections.defaultdict(lambda: [0, 0])
    for m in list_streams(O3.VSESS, ["vsess"]):
        c = load_dump(O3.VSESS, m)
        P = O3.combine(net_dir, "", f"vsess/{m['id']}", rule)
        vet = ~S.voice_flags(spec, m, S.hop_probs(spec, m, P))
        corr = (c["paint"] > 0) & (c["lab"] == 1)
        td = _td(m)
        cond = "clean" if m["kind"] == "clean" else f"{int(m['snr_db']):+d} dB"
        used = np.zeros(m["n"], bool)
        for L in m["layers"]:
            sel = corr & (td >= L["at"]) & (td <= L["at"] + L["len"]) & ~used
            used |= sel
            g = S.gnorm(L["gender"])
            for key in (f"{L['row']}|{m['source']}|{g}|{cond}", f"{L['row']}|all|{g}|{cond}"):
                R[key][0] += int(sel.sum())
                R[key][1] += int((sel & vet).sum())
            if L["row"] == "speech":
                R[f"MEDIUM speech rows|{g}|{cond}"][0] += int(sel.sum())
                R[f"MEDIUM speech rows|{g}|{cond}"][1] += int((sel & vet).sum())
    return {k: (round(100.0 * v / n, 3) if n else None, n) for k, (n, v) in sorted(R.items())}


def selftest(net, rule):
    hb, groups, _ = h_items()
    net_dir = net if rule == "file" else os.path.join(O3.CROOT, net)
    res = {b: hb[b].evaluate(h_probs(hb[b], net_dir, rule)) for b in hb}
    bad = 0
    for agg, thr, hi in (("last", 0.1, 6), ("mean", 0.3, 9), ("max", 0.05, 0), ("mean", 0.6, 15)):
        D = direct_point(net_dir, rule, agg, thr, O3.HANG[hi])
        ref = collections.defaultdict(lambda: [0, 0])
        for bname in hb:
            for it in hb[bname].items:
                vet = D[(it["meta"]["set"], it["meta"]["id"])][1]
                for mk, key in it["masks"]:
                    ref[(bname, key)][0] += int(mk.sum())
                    ref[(bname, key)][1] += int((mk & vet).sum())
        for bname in hb:
            tot, vet, _ = res[bname][(agg, thr)]
            for key, j in hb[bname].keys.items():
                if ref[(bname, key)] != [int(tot[j]), int(vet[j, hi])]:
                    bad += 1
                    print("MISMATCH", agg, thr, O3.HANG[hi], bname, key, ref[(bname, key)], tot[j], vet[j, hi])
    print(f"selftest_r5 (H readings vs score.py functions, 4 points): {bad} mismatches")
    return bad


def main():
    if "selftest" in MY:
        net, rule = MY["selftest"].rsplit(":", 1)
        sys.exit(1 if selftest(net, rule) else 0)
    t0 = time.time()
    hb, groups, cnt = h_items()
    print(f"H blocks: h1 {hb['h1'].N} hops / {len(hb['h1'].items)} streams; h2 {hb['h2b'].N} hops / {len(hb['h2b'].items)} streams "
          f"({time.time() - t0:.0f} s)", file=sys.stderr, flush=True)
    merge_info = {"|".join(k): {str(b): str(g) for b, g in v.items() if b != g} for k, v in groups.items()}
    if "point" in MY:
        net, rule, agg, thr, hang = MY["point"].split(":")
        thr, hang = float(thr), int(hang)
        net_dir = net if rule == "file" else os.path.join(O3.CROOT, net)
        hp = score_h(hb, net, rule)[(agg, thr, hang)]
        out = {"point": [net, rule, agg, thr, hang], "h": compact(hp), "merged_bins": merge_info,
               "reports": reports(net_dir, rule, agg, thr, hang, groups), "h3": h3(net_dir, rule, agg, thr, hang)}
        if "no-r3" not in MY:
            blocks, spl_off = O3.build_blocks(False)
            grid, _ = O3.score_candidate(blocks, net, rule, spl_off, False)
            r3 = next(g for g in grid if g["agg"] == agg and g["thr"] == thr and g["hang"] == hang)
            out["r3"] = {k: r3[k] for k in ("O", "feasible", "fresh", "vsess")}
        print(json.dumps({"h_feasible": hp["feasible"], "fail": hp["fail"], "r3_feasible": out.get("r3", {}).get("feasible")}, indent=1))
        if MY.get("json"):
            json.dump(out, open(MY["json"], "w", encoding="utf8"), indent=1)
        return
    cands = [c.rsplit(":", 1) for c in MY["cands"].split(",")]
    do_spl = "no-spl" not in MY
    blocks, spl_off = O3.build_blocks(do_spl)
    out = {}
    if MY.get("json") and os.path.exists(MY["json"]):
        out = json.load(open(MY["json"], encoding="utf8"))
    for net, rule in cands:
        name = f"{net}:{rule}"
        if name in out and "force" not in MY:
            continue
        t1 = time.time()
        grid, frame_ms = O3.score_candidate(blocks, net, rule, spl_off, do_spl)
        hpts = score_h(hb, net, rule)
        for g in grid:
            hp = hpts[(g["agg"], g["thr"], g["hang"])]
            g["feasible_r4"] = g["feasible"]
            g["feasible"] = bool(g["feasible"] and hp["feasible"])
            g["h"] = {"feasible": hp["feasible"], "worst_ratio": hp["worst_ratio"], "nfail": len(hp["fail"]), "fail": hp["fail"][:8]}
        best = pick5(grid)
        fb = None if best else min(grid, key=ratio5)
        for r_ in (best, fb):
            if r_ is not None:
                r_["h"] = compact(hpts[(r_["agg"], r_["thr"], r_["hang"])])     # every H cell at the pick / fallback
        b4 = O3.pick([dict(g, feasible=g["feasible_r4"]) for g in grid])
        out[name] = {"net": net, "rule": rule, "frame_ms": frame_ms, "best": best, "fallback": fb, "best_r4_rows_only": b4,
                     "n_feasible": sum(g["feasible"] for g in grid), "n_feasible_r4": sum(g["feasible_r4"] for g in grid),
                     "grid": grid}
        r = best or fb
        print(f"{name}: {'PICK' if best else 'NO feasible point; fallback'} {r['agg']} p>={r['thr']} {r['hang']} ms -> O {r['O']:.2f} "
              f"(tune {r['fresh']['tune_v2']:.2f}, vneg {r['fresh']['vneg_v2']:.2f}, vsess {r['vsess']['vs_v2']:.2f}); "
              f"feasible points {out[name]['n_feasible']} (round-4 rows only {out[name]['n_feasible_r4']}); H fails at it: {r['h']['fail'][:6]}"
              f" [{time.time() - t1:.0f} s]", flush=True)
        if MY.get("json"):
            tmp = MY["json"] + ".tmp"
            json.dump(out, open(tmp, "w", encoding="utf8"))
            os.replace(tmp, MY["json"])
    if MY.get("json"):
        json.dump({"merged_bins": merge_info, "counts": {"|".join(k): dict((str(b), n) for b, n in v.items()) for k, v in cnt.items()}},
                  open(MY["json"][:-5] + "-merge.json", "w", encoding="utf8"), indent=1)


if __name__ == "__main__":
    main()
