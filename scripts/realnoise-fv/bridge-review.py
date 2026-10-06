# bridge-review.py — decision-record rows of the pitch-hold bridge rework that
# the pre-registered rule (shiprule.py) does not score, added in the review
# fix round (measurements/pitch-hold-bridge-rework-2026-10-06.md §5):
#
#   goal+     the goal metric with clip-bootstrap 95 % CIs, time-weighted
#             (hop-pooled), by stream time on clips >= 60 s (steady state),
#             by clip duration, by source and class;
#   strong    the noise-only result split by whether the noise itself ever
#             produced a strong-evidence frame (evidence.py replica), and the
#             share of base painted false voicing inside evidence-open spans;
#   warm      warm-start counterfactual: the candidate's rule with the
#             evidence open at the stream start (the user spoke just before);
#   ind       what the user sees on noise-only audio: trace, readout number
#             (ro > 0), the trace's glow dot (PitchTrace.jsx: the last painted
#             point while < 500 ms old) and any of the three;
#   notch     strong-evidence frames before the stream's first notch / while
#             a notch is active, and the held frames they unlocked;
#   f0        voice in noise per stream by the stream's median truth F0 and by
#             voice gender: streams worse by > 2 pp painted;
#   flicker   voice in noise, truth-voiced frames: dim-style share, bright ->
#             dim transitions, painted dashes of <= 3 frames, readout number
#             shown and number -> blank transitions.
#
#   python scripts/realnoise-fv/bridge-review.py --attr=ROOT --base=BASE CAND [CAND ...]
#          [--sections=goal,strong,warm,ind,notch,f0,flicker] [--rule-CAND=bcpp,ct,0.39,low]
#          [--dot-ends-hidden=CAND,...] [--snr=+0] [--leads=0,20] [--data-root=$NOTCHVD_ROOT] [--json=PATH]
#
# --rule-<tag>=<cpp column>,<align>,<cpp min>[,low] gives the replica's rule
# for a candidate (default bcpp,ct,0.39,low = the committed rule; "low" =
# with the low-F0 gain); align "arrive" = the pre-fix pairing (the reviewed
# variant: cpp,arrive,0.5). --dot-ends-hidden models a glow dot that ends at the
# first hidden held frame (the hook variant that also hides the readout).
import sys, os, glob, json
import numpy as np

A = dict((a[2:].split("=", 1) + ["1"])[:2] for a in sys.argv[1:] if a.startswith("--"))
TAGS = [a for a in sys.argv[1:] if not a.startswith("--")]
ATTR, BASE = A["attr"], A["base"]
SECTIONS = A.get("sections", "goal,strong,warm,ind,notch,f0,flicker").split(",")
DOT_HID = set(A.get("dot-ends-hidden", "").split(",")) - {""}
if "data-root" in A:
    os.environ["NOTCHVD_ROOT"] = A["data-root"]
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import evidence as E  # noqa: E402

OUT = {}


def rule(tag):
    v = A.get(f"rule-{tag}", "bcpp,ct,0.39,low").split(",")
    return dict(cpp_col=v[0], align=v[1], cpp_min=float(v[2]), low_f0=len(v) > 3 and v[3] == "low")


def names(tag, s):
    return sorted(os.path.basename(p)[:-5] for p in glob.glob(f"{ATTR}/{tag}/{s}/*.json"))


def pct(a, b):
    return 100.0 * a / b if b else float("nan")


SPLITS = [("all 279", "noise", None), ("tuning 194", "noise", "tune"), ("held-out 85", "noise", "held"),
          ("held-out 2 (119)", "noiseho", None), ("dcaseeval 18", "noiseho", "dcaseeval"), ("fsheld 101", "noiseho", "fsheld")]


def clips(tag):
    """per clip, base and candidate per-hop arrays (noise + noiseho)"""
    rows = []
    for s in ("noise", "noiseho"):
        for nm in names(tag, s):
            m, cb = E.load(f"{ATTR}/{BASE}/{s}/{nm}")
            _, cc = E.load(f"{ATTR}/{tag}/{s}/{nm}")
            disp = np.isfinite(cb["inten"])
            rows.append(dict(set=s, id=nm, m=m, cb=cb, cc=cc, disp=disp, split=m.get("split"), cls=m.get("label"),
                             src=m.get("source"), n=int(disp.sum()), dur=m["n"] * m["hopS"],
                             pb=(cb["paint"] > 0) & disp, pc=(cc["paint"] > 0) & disp))
    return rows


def boot(b, c, reps=4000, seed=1):
    rng = np.random.default_rng(seed)
    b, c = np.asarray(b), np.asarray(c)
    i = rng.integers(0, len(b), (reps, len(b)))
    r = 100 * (c[i].mean(axis=1) / b[i].mean(axis=1) - 1)
    return np.percentile(r, [2.5, 97.5])


def sel(rows, s, sp):
    return [r for r in rows if r["set"] == s and (sp is None or r["split"] == sp)]


def goal_plus(tag, rows):
    print(f"\n## goal+ ({tag} vs {BASE}): clip mean (registered metric) with clip-bootstrap 95 % CI; time-weighted (hop-pooled)")
    print("| split | clips | base | cand | change | 95 % CI | time-weighted change | clips reduced |")
    print("|---|---|---|---|---|---|---|---|")
    res = {}
    for lab, s, sp in SPLITS:
        v = sel(rows, s, sp)
        b = [r["pb"].sum() / r["n"] for r in v]; c = [r["pc"].sum() / r["n"] for r in v]
        rel = 100 * (np.mean(c) / np.mean(b) - 1)
        ci = boot(b, c)
        tw = 100 * (sum(r["pc"].sum() for r in v) / sum(r["pb"].sum() for r in v) - 1)
        red = sum(ci_ < bi_ - 1e-12 for ci_, bi_ in zip(c, b))
        res[lab] = dict(base=100 * np.mean(b), cand=100 * np.mean(c), rel=rel, ci=list(ci), tw=tw)
        print(f"| {lab} | {len(v)} | {100 * np.mean(b):.2f} | {100 * np.mean(c):.2f} | {rel:+.1f} % | {ci[0]:+.1f} to {ci[1]:+.1f} % | {tw:+.1f} % | {red} |")
    print("\nby stream time, clips >= 60 s (hop-pooled painted false voicing; steady state = the later windows)")
    print("| set | clips | 0-5.5 s | 5.5-20.5 s | 20.5-45 s | 45-90 s |")
    print("|---|---|---|---|---|---|")
    TW = [(0, 5.5), (5.5, 20.5), (20.5, 45), (45, 90.1)]
    for s in ("noise", "noiseho"):
        v = [r for r in rows if r["set"] == s and r["dur"] >= 60]
        cells = []
        for a, b_ in TW:
            nb = nc = 0
            for r in v:
                t = (np.arange(r["m"]["n"]) + 1) * r["m"]["hopS"]
                w = (t >= a) & (t < b_)
                nb += int((r["pb"] & w).sum()); nc += int((r["pc"] & w).sum())
            cells.append(f"{100 * (nc / nb - 1):+.1f} %" if nb else "-")
            res[f"{s} t{a}-{b_}"] = 100 * (nc / nb - 1) if nb else None
        print(f"| {s} | {len(v)} | " + " | ".join(cells) + " |")
    print("\nby clip duration (clip mean), all 279 + held-out 2")
    print("| set | duration | clips | base | change |")
    print("|---|---|---|---|---|")
    for s in ("noise", "noiseho"):
        for a, b_ in ((0, 10.5), (10.5, 20), (20, 45), (45, 91)):
            v = [r for r in rows if r["set"] == s and a <= r["dur"] < b_]
            if not v:
                continue
            b = np.mean([r["pb"].sum() / r["n"] for r in v]); c = np.mean([r["pc"].sum() / r["n"] for r in v])
            print(f"| {s} | {a}-{b_} s | {len(v)} | {100 * b:.2f} | {100 * (c / b - 1):+.1f} % |")
    print("\nby source and class (clip mean)")
    print("| group | clips | base | cand | change |")
    print("|---|---|---|---|---|")
    groups = {}
    for r in rows:
        groups.setdefault(f"source {r['src']}", []).append(r)
        if r["set"] == "noise":
            groups.setdefault(f"class {r['cls']}", []).append(r)
    for k in sorted(groups):
        v = groups[k]
        b = np.mean([r["pb"].sum() / r["n"] for r in v]); c = np.mean([r["pc"].sum() / r["n"] for r in v])
        print(f"| {k} | {len(v)} | {100 * b:.2f} | {100 * c:.2f} | {100 * (c / b - 1) if b else 0:+.1f} % |")
        res[k] = 100 * (c / b - 1) if b else None
    OUT.setdefault(tag, {})["goal+"] = res


def strong_split(tag, rows):
    rl = rule(tag)
    print(f"\n## strong ({tag}, replica rule {rl}): noise-only clips by whether the NOISE produced a strong-evidence frame")
    for r in rows:
        R = E.replay_rule(r["m"], r["cb"], **rl)
        r["R"] = R
    print("| set | group | clips | base | cand | change | median clip change |")
    print("|---|---|---|---|---|---|---|")
    res = {}
    for s in ("noise", "noiseho"):
        for cls in (None, "stationary-tonal", "intermittent-tonal", "mixed", "broadband"):
            for g, f in (("noise gives strong frames", lambda r: r["R"]["first_strong"] is not None),
                         ("never", lambda r: r["R"]["first_strong"] is None)):
                v = [r for r in rows if r["set"] == s and (cls is None or r["cls"] == cls) and f(r)]
                if not v:
                    continue
                b = np.array([r["pb"].sum() / r["n"] for r in v]); c = np.array([r["pc"].sum() / r["n"] for r in v])
                med = np.median([100 * (ci / bi - 1) for bi, ci in zip(b, c) if bi > 0.01] or [0])
                lab = f"{cls or 'all'}: {g}"
                print(f"| {s} | {lab} | {len(v)} | {100 * b.mean():.2f} | {100 * c.mean():.2f} | {100 * (c.mean() / b.mean() - 1):+.1f} % | {med:+.1f} % |")
                res[f"{s}|{lab}"] = dict(n=len(v), base=100 * b.mean(), rel=100 * (c.mean() / b.mean() - 1))
    v = [r for r in rows if r["set"] == "noise"]
    po = sum(int((r["pb"] & r["R"]["open"]).sum()) for r in v); pa = sum(int(r["pb"].sum()) for r in v)
    print(f"\nall 279: share of base painted false-voicing hops inside evidence-open spans (the noise's own strong frames): {pct(po, pa):.1f} %")
    hi = sorted(v, key=lambda r: -r["pb"].sum() / r["n"])[:15]
    print("\nworst 15 rooms by base painted (all 279): id | class | base | cand | strong frames from the noise")
    for r in hi:
        print(f"  {r['id'][:60]} | {r['cls']} | {pct(r['pb'].sum(), r['n']):.1f} | {pct(r['pc'].sum(), r['n']):.1f} | {'yes' if r['R']['first_strong'] is not None else 'no'}")
    res["open_share"] = pct(po, pa)
    OUT.setdefault(tag, {})["strong"] = res


def warm(tag, rows):
    rl = rule(tag)
    print(f"\n## warm ({tag}): the user spoke just before the stream (evidence open from t = 0 for 20 s) — counterfactual, exact for a hide-only rule")
    print("| split | base | cand (cold start, as measured) | cand (warm start) |")
    print("|---|---|---|---|")
    res = {}
    for r in rows:
        Rw = E.replay_rule(r["m"], r["cb"], strong_at0=0, **rl)
        held = r["pb"] & (r["cb"]["msg"] <= 0)
        r["pw"] = r["pb"] & ~(held & ~Rw["allow"])
    for lab, s, sp in SPLITS:
        v = sel(rows, s, sp)
        b = np.mean([r["pb"].sum() / r["n"] for r in v]); c = np.mean([r["pc"].sum() / r["n"] for r in v])
        w = np.mean([r["pw"].sum() / r["n"] for r in v])
        print(f"| {lab} | {100 * b:.2f} | {100 * c:.2f} ({100 * (c / b - 1):+.1f} %) | {100 * w:.2f} ({100 * (w / b - 1):+.1f} %) |")
        res[lab] = 100 * (w / b - 1)
    OUT.setdefault(tag, {})["warm"] = res


def dot_of(paint, hop_ms, hidden=None):
    """PitchTrace glow dot: shown while the last painted point is < 500 ms old
    (hop times of the chain: (k + 1) * hop); `hidden` ends it at a hidden frame"""
    n = len(paint); out = np.zeros(n, bool); last = None; cut = False
    for k in range(n):
        if paint[k]:
            last = k; cut = False
        elif hidden is not None and hidden[k]:
            cut = True
        out[k] = last is not None and (k - last) * hop_ms < 500 and not cut
    return out


def indicators(tag, rows):
    print(f"\n## ind ({tag}): false pitch the user sees on noise-only audio (clip mean, % of DSP hops)")
    print("| split | trace base -> cand | readout number | glow dot | any of the three |")
    print("|---|---|---|---|---|")
    res = {}
    for r in rows:
        hop = r["m"]["hopS"] * 1000
        hid = r["pb"] & ~r["pc"] if tag in DOT_HID else None
        r["ind"] = {}
        for side, c in (("b", r["cb"]), ("c", r["cc"])):
            p = (c["paint"] > 0) & r["disp"]
            ro = (c["ro"] > 0) & r["disp"]
            dt = dot_of(p, hop, hid if side == "c" else None) & r["disp"]
            r["ind"][side] = dict(trace=p.sum() / r["n"], ro=ro.sum() / r["n"], dot=dt.sum() / r["n"], any=(p | ro | dt).sum() / r["n"])
    for lab, s, sp in SPLITS:
        v = sel(rows, s, sp)
        cells = []
        for key in ("trace", "ro", "dot", "any"):
            b = np.mean([r["ind"]["b"][key] for r in v]); c = np.mean([r["ind"]["c"][key] for r in v])
            cells.append(f"{100 * b:.2f} -> {100 * c:.2f} ({100 * (c / b - 1):+.1f} %)")
            res[f"{lab}|{key}"] = 100 * (c / b - 1)
        print(f"| {lab} | " + " | ".join(cells) + " |")
    OUT.setdefault(tag, {})["ind"] = res


def notch(tag, rows):
    rl = rule(tag)
    print(f"\n## notch ({tag}): strong-evidence frames vs the notch (CPP is computed on un-notched audio)")
    ns = ns_n = npre = nact = 0
    hb_pre = hb_act = 0.0; nclip = 0; clips_hit = 0
    per = []
    for r in rows:
        if r["set"] != "noise":
            continue
        m, cb = r["m"], r["cb"]
        R = r.get("R") or E.replay_rule(m, cb, **rl)
        L = m["L"]
        nn = cb["nnotch"]
        # notch state at DSP hop k = the consumed message's frame k - L
        act = np.zeros(m["n"], bool); act[L:] = nn[:m["n"] - L] > 0
        st = R["strong"]
        ns += int(st.sum()); nclip += 1
        if not act.any():
            continue  # no notch in this clip: its evidence has nothing to do with notch timing
        first = int(np.argmax(act))
        ns_n += int(st.sum()); npre += int((st & (np.arange(m["n"]) < first)).sum()); nact += int((st & act).sum())
        # held frames drawn on evidence only (beyond the graces), by the strong frame that opened it
        src = R["src"]
        drawn = r["pc"] & (cb["msg"] <= 0) & R["by_evidence"]
        pre = drawn & (src >= 0) & (src < first)
        ac = drawn & (src >= 0) & act[np.clip(src, 0, m["n"] - 1)]
        hb_pre += pre.sum() / r["n"]; hb_act += ac.sum() / r["n"]
        clips_hit += bool((pre | ac).any())
        per.append((100 * (pre | ac).sum() / r["n"], r["id"]))
    print(f"all 279: strong frames {ns}, of which {ns_n} in clips that get a notch; of those, before the clip's first notch {pct(npre, ns_n):.1f} %, while a notch is active {pct(nact, ns_n):.1f} %")
    print(f"held frames drawn on evidence from a strong frame before the first notch: {100 * hb_pre / nclip:.2f} pp, during an active notch: {100 * hb_act / nclip:.2f} pp (clip mean over all 279; {clips_hit} clips affected)")
    print("largest per clip (pp): " + "; ".join(f"{i[:45]} {v:.1f}" for v, i in sorted(per, reverse=True)[:5]))
    OUT.setdefault(tag, {})["notch"] = dict(strong=ns, strong_notched=ns_n, pre=pct(npre, ns_n), active=pct(nact, ns_n),
                                            held_pre=100 * hb_pre / nclip, held_act=100 * hb_act / nclip, clips=clips_hit)


F0BINS = [0, 100, 130, 160, 220, 10000]
F0NAMES = ["< 100", "100-130", "130-160", "160-220", ">= 220"]


def f0_rows(tag):
    import vinlead as VL
    import vinscore as V
    V.ATTR = ATTR; VL.ATTR = ATTR
    snr = A.get("snr", "+0")
    print(f"\n## f0 ({tag}): voice in noise, SNR {snr}: streams worse by > 2 pp painted, by the stream's median truth F0 and voice gender")
    print("| lead | split | bin | streams | worse > 2 pp | share | pooled painted change (pp) |")
    print("|---|---|---|---|---|---|---|")
    res = {}
    for lead in [int(x) for x in A.get("leads", "0,20").split(",")]:
        bt = BASE if lead == 20 else f"{BASE}_L{lead}"; ct = tag if lead == 20 else f"{tag}_L{lead}"
        ids = names(ct, "vin")
        rowsv = []
        for sid in ids:
            rec = V.MIX[sid]
            if f"{rec['snr_db']:+d}" != snr:
                continue
            b, c = VL.stream(bt, sid), VL.stream(ct, sid)
            if not b["vd"].sum():
                continue
            rowsv.append(dict(f0=float(np.median(b["rd"][b["vd"]])), g=VL.gender_of(rec), split=VL.split_of(rec["noise_id"]),
                              pb=int(b["okd"].sum()), pc=int(c["okd"].sum()), pn=int(b["vd"].sum())))
        for split in ("all", "held"):
            vv = [r for r in rowsv if split == "all" or r["split"] == split]
            groups = [(nm, [r for r in vv if lo <= r["f0"] < hi]) for nm, lo, hi in zip(F0NAMES, F0BINS[:-1], F0BINS[1:])]
            groups += [(f"gender {g}", [r for r in vv if r["g"] == g]) for g in ("m", "f", "u")]
            for nm, g in groups:
                if not g:
                    continue
                w = sum(pct(r["pc"] - r["pb"], r["pn"]) < -2 for r in g)
                d = pct(sum(r["pc"] - r["pb"] for r in g), sum(r["pn"] for r in g))
                print(f"| {lead} | {split} | {nm} | {len(g)} | {w} | {pct(w, len(g)):.1f} % | {d:+.3f} |")
                res[f"L{lead}|{split}|{nm}"] = dict(n=len(g), worse=w, share=pct(w, len(g)), pooled=d)
    OUT.setdefault(tag, {})["f0"] = res


def flicker(tag):
    import vinlead as VL
    import vinscore as V
    V.ATTR = ATTR; VL.ATTR = ATTR
    snr = A.get("snr", "+0")
    print(f"\n## flicker ({tag}): voice in noise, SNR {snr}, truth-voiced frames (display alignment)")
    print("| lead | streams | dim-style share base -> cand | bright -> dim transitions | painted dashes <= 3 frames | readout number shown | number -> blank transitions |")
    print("|---|---|---|---|---|---|---|")
    res = {}
    for lead in [int(x) for x in A.get("leads", "0,20").split(",")]:
        bt = BASE if lead == 20 else f"{BASE}_L{lead}"; ct = tag if lead == 20 else f"{tag}_L{lead}"
        acc = {"b": [0, 0, 0, 0, 0, 0], "c": [0, 0, 0, 0, 0, 0]}; ns = 0
        for sid in names(ct, "vin"):
            rec = V.MIX[sid]
            if f"{rec['snr_db']:+d}" != snr:
                continue
            ns += 1
            s = VL.stream(bt, sid)
            vd = s["vd"]
            for side, tg in (("b", bt), ("c", ct)):
                _, c = E.load(f"{ATTR}/{tg}/vin/{sid}")
                st = c["style"]
                p = np.where(np.isfinite(c["inten"]), c["paint"], 0) > 0
                a = acc[side]
                a[0] += int((vd & (st == 1)).sum()); a[1] += int(vd.sum())
                a[2] += int((vd[1:] & (st[:-1] == 2) & (st[1:] == 1)).sum())
                d = np.diff(np.concatenate([[0], p.astype(int), [0]]))
                st_, en_ = np.where(d == 1)[0], np.where(d == -1)[0]
                a[3] += int(sum(1 for x, y in zip(st_, en_) if y - x <= 3 and vd[x:y].any()))
                ro = c["ro"] > 0
                a[4] += int((vd & ro).sum()); a[5] += int((vd[1:] & ro[:-1] & ~ro[1:]).sum())
        b, c = acc["b"], acc["c"]
        print(f"| {lead} | {ns} | {pct(b[0], b[1]):.2f} -> {pct(c[0], c[1]):.2f} % | {b[2]} -> {c[2]} ({pct(c[2] - b[2], b[2]):+.1f} %) | {b[3]} -> {c[3]} ({pct(c[3] - b[3], b[3]):+.1f} %)"
              f" | {pct(b[4], b[1]):.2f} -> {pct(c[4], c[1]):.2f} % | {b[5]} -> {c[5]} ({pct(c[5] - b[5], b[5]):+.1f} %) |")
        res[f"L{lead}"] = dict(dim=(pct(b[0], b[1]), pct(c[0], c[1])), trans=(b[2], c[2]), dash=(b[3], c[3]),
                               ro=(pct(b[4], b[1]), pct(c[4], c[1])), roblank=(b[5], c[5]))
    OUT.setdefault(tag, {})["flicker"] = res


for tag in TAGS:
    need_rows = any(s in SECTIONS for s in ("goal", "strong", "warm", "ind", "notch"))
    rows = clips(tag) if need_rows else []
    if "goal" in SECTIONS:
        goal_plus(tag, rows)
    if "strong" in SECTIONS or "notch" in SECTIONS:
        strong_split(tag, rows) if "strong" in SECTIONS else None
    if "warm" in SECTIONS:
        warm(tag, rows)
    if "ind" in SECTIONS:
        indicators(tag, rows)
    if "notch" in SECTIONS:
        notch(tag, rows)
    if "f0" in SECTIONS:
        f0_rows(tag)
    if "flicker" in SECTIONS:
        flicker(tag)
if A.get("json"):
    json.dump(OUT, open(A["json"], "w"), default=str, indent=1)
