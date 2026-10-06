# shiprule.py — the pre-registered ship-rule rows of the pitch-hold bridge
# rework (measurements/pitch-hold-bridge-rework-2026-10-06.md): goal and
# guards G1-G4 for a BASE dump tag against candidate tags, from attr.mjs /
# replay.mjs dumps of the real worker + the real display hook.
#
#   python scripts/realnoise-fv/shiprule.py --attr=ROOT BASE CAND [CAND ...]
#          [--sets=goal,g1,g2,g4] [--leads=20,0] [--splits=all,held]
#          [--paint=paint|paintF] [--json=PATH] [--data-root=$NOTCHVD_ROOT]
#
# Tag layout under ROOT: <tag>/{noise,noiseho,vin,fda,ptdb,hil,voc}/ and the
# no-lead voice-in-noise run at <tag>_L0/vin/ (attr.mjs --lead=0).
# --paint=paintF scores the trace as it stands at the END of each stream
# (a display that fills trace entries late — a deferred bridge — is credited
# with its late fills); the default scores what was drawn at each hop.
#
# Conventions (unchanged from the 2026-10-05 tools):
#   goal  painted false voicing = clip mean of painted DSP hops / DSP hops
#         (cmp.py); noise = the 279 public noise-only clips (tuning / held-out
#         split of lib/sets.mjs); noiseho = the second held-out set
#         (dcaseeval + fsheld, attr.mjs --set=noiseho).
#   G1    corpora: score.py's painted stage (5 %, display-aligned reference
#         refd), gender-symmetric max(F_err, M_err); vocadito correct.
#   G2/G3 voice in noise: vinscore.py / vinlead.py (Praat truth of the voice
#         layers, 8 %, display alignment; segments lead / tail / gaps of
#         >= 20 hops for the per-stream rules).
#   G4    clean-speech continuity (FDA + PTDB-TUG + vocadito): painted
#         segments per reference-voiced second; within-word gaps = unpainted
#         runs between two painted segments that lie wholly inside reference
#         voicing (strict) and, as a second reading, every unpainted run
#         <= 500 ms between two painted segments.
import sys, os, glob, json
import numpy as np

A = dict((a[2:].split("=", 1) + ["1"])[:2] for a in sys.argv[1:] if a.startswith("--"))
TAGS = [a for a in sys.argv[1:] if not a.startswith("--")]
ATTR = A["attr"]
SETS = A.get("sets", "goal,g1,g2,g4").split(",")
LEADS = [int(x) for x in A.get("leads", "20,0").split(",")]
SPLITS = A.get("splits", "all,held").split(",")
PAINT = A.get("paint", "paint")
if "data-root" in A:
    os.environ["NOTCHVD_ROOT"] = A["data-root"]
sys.argv = [sys.argv[0], f"--attr={ATTR}"]
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import vinscore as V  # noqa: E402
import vinlead as VL  # noqa: E402
V.ATTR = ATTR
VL.ATTR = ATTR

OUT = {}
VERDICT = {}


def load(p):
    m = json.load(open(p + ".json"))
    a = np.fromfile(p + ".f32", dtype=np.float32).reshape(len(m["cols"]), m["n"]).astype(float)
    c = {col: a[i] for i, col in enumerate(m["cols"])}
    if PAINT != "paint" and PAINT in c:
        c["paint"] = c[PAINT]
    return m, c


V.load = load  # vinlead.stream reads through vinscore.load


def names(tag, s):
    return sorted(os.path.basename(p)[:-5] for p in glob.glob(f"{ATTR}/{tag}/{s}/*.json"))


def pct(a, b):
    return 100.0 * a / b if b else float("nan")


def verdict(tag, key, ok):
    VERDICT.setdefault(tag, {})[key] = bool(ok)
    return "PASS" if ok else "FAIL"


# ---------------- goal: painted false voicing on noise-only audio
def noise_fv(tag, s):
    out = {}
    for nm in names(tag, s):
        m, c = load(f"{ATTR}/{tag}/{s}/{nm}")
        disp = np.isfinite(c["inten"])
        paint = (c["paint"] > 0) & disp
        held = paint & (c["msg"] <= 0)
        W = int(round(5 / m["hopS"]))
        wins = [paint[i:i + W].sum() / max(disp[i:i + W].sum(), 1) for i in range(0, len(paint) - W + 1, W)]
        out[nm] = dict(split=m.get("split"), cls=m.get("label"), paint=paint.sum() / max(disp.sum(), 1),
                       held=held.sum() / max(disp.sum(), 1), wins=wins)
    return out


GOAL_SPLITS = [("all 279", "noise", None), ("tuning 194", "noise", "tune"), ("held-out 85", "noise", "held"),
               ("held-out 2: 119", "noiseho", None), ("dcaseeval 18", "noiseho", "dcaseeval"), ("fsheld 101", "noiseho", "fsheld")]


def goal():
    print("\n## Goal: painted false voicing on real noise-only audio (clip mean, %; relative change vs base)")
    print("| tag | " + " | ".join(g[0] for g in GOAL_SPLITS) + " | held (bridge) share, all | stat / int / mixed / broad (all) | clips > base + 2 pp | 5 s windows > base + 2 / + 10 pp |")
    print("|---|" + "---|" * (len(GOAL_SPLITS) + 5))
    R = {t: {"noise": noise_fv(t, "noise"), "noiseho": noise_fv(t, "noiseho")} for t in TAGS}
    B = R[TAGS[0]]
    for t in TAGS:
        cells, rel = [], {}
        for lab, s, sp in GOAL_SPLITS:
            d, bd = R[t][s], B[s]
            v = [d[i]["paint"] for i in d if sp is None or d[i]["split"] == sp]
            vb = [bd[i]["paint"] for i in bd if sp is None or bd[i]["split"] == sp]
            mv, mb = 100 * np.mean(v), 100 * np.mean(vb)
            rel[lab] = 100 * (mv / mb - 1)
            cells.append(f"{mv:.2f}" if t == TAGS[0] else f"{mv:.2f} ({rel[lab]:+.1f} %)")
        n0 = R[t]["noise"]
        hs = 100 * np.mean([n0[i]["held"] for i in n0])
        cls = " / ".join(f"{100 * np.mean([n0[i]['paint'] for i in n0 if n0[i]['cls'] == c]):.1f}"
                         for c in ("stationary-tonal", "intermittent-tonal", "mixed", "broadband"))
        worse = w2 = w10 = nw = 0
        for s in ("noise", "noiseho"):
            d, bd = R[t][s], B[s]
            for i in d:
                worse += d[i]["paint"] > bd[i]["paint"] + 0.02
                for a, b in zip(d[i]["wins"], bd[i]["wins"]):
                    nw += 1; w2 += a > b + 0.02; w10 += a > b + 0.10
        tail = (" | -" * 2) if t == TAGS[0] else f" | {worse} | {w2} / {w10} of {nw}"
        print(f"| {t} | " + " | ".join(cells) + f" | {hs:.2f} | {cls}{tail} |")
        OUT.setdefault(t, {})["goal"] = rel
        if t != TAGS[0]:
            verdict(t, "goal tuning set (all 279) >= 25 % rel", rel["all 279"] <= -25)
            for lab in ("held-out 85", "held-out 2: 119", "dcaseeval 18", "fsheld 101"):
                verdict(t, f"goal {lab} >= 25 % rel (strict reading)", rel[lab] <= -25)


# ---------------- G1: corpora displayed accuracy
def corpus(tag, cp):
    acc = {}
    for nm in names(tag, cp):
        m, c = load(f"{ATTR}/{tag}/{cp}/{nm}")
        g = "voc" if cp == "voc" else f"{cp}_{m['gender']}"
        val = np.where(np.isfinite(c["inten"]), c["paint"], 0); ref = c["refd"]
        v = ref > 0
        ok = v & (np.abs(np.where(v, val / np.where(v, ref, 1), 0) - 1) < 0.05)
        for band, bm in (("all", v), ("<160", v & (ref < 160))):
            d = acc.setdefault((g, band), [0, 0]); d[0] += int(bm.sum()); d[1] += int((ok & bm).sum())
    return acc


def g1():
    print("\n## G1: corpora displayed (painted) accuracy: max(F_err, M_err) %, vocadito correct %, < 160 Hz error %")
    print("| tag | FDA max err | PTDB max err | Hillenbrand max err | vocadito correct | FDA <160 err | PTDB <160 err | Hil <160 err | verdict (max err <= +0.15 pp, vocadito >= -0.3 pp) |")
    print("|---|---|---|---|---|---|---|---|---|")
    base = None
    for t in TAGS:
        R = {cp: corpus(t, cp) for cp in ("fda", "ptdb", "hil", "voc")}
        vals = []
        for cp in ("fda", "ptdb", "hil"):
            vals.append(max(100 - pct(R[cp][(f"{cp}_{g}", "all")][1], R[cp][(f"{cp}_{g}", "all")][0])
                            for g in ("m", "f") if (f"{cp}_{g}", "all") in R[cp]))
        d = R["voc"][("voc", "all")]; vals.append(pct(d[1], d[0]))
        for cp in ("fda", "ptdb", "hil"):
            lo = [R[cp].get((f"{cp}_{g}", "<160"), [0, 0]) for g in ("m", "f")]
            vals.append(100 - pct(sum(x[1] for x in lo), sum(x[0] for x in lo)))
        if base is None:
            base = vals
            print(f"| {t} | " + " | ".join(f"{v:.2f}" for v in vals) + " | - |")
        else:
            ok = all(vals[i] - base[i] <= 0.15 for i in range(3)) and vals[3] - base[3] >= -0.3
            print(f"| {t} | " + " | ".join(f"{v:.2f} ({v - b:+.3f})" for v, b in zip(vals, base)) + f" | {verdict(t, 'G1', ok)} |")
        OUT.setdefault(t, {})["g1"] = vals


# ---------------- G2 / G3: voice in noise
def vin_tag(t, lead):
    return t if lead == 20 else f"{t}_L{lead}"


def g23(lead, split):
    bt = vin_tag(TAGS[0], lead)
    VL.SPLIT = split
    print(f"\n## G2 / G3: voice in noise, lead {lead} s, split={split}")
    print("| tag | SNR | painted at pitch (pp) | < 160 Hz (pp) | streams worse > 2 pp | worker at pitch (pp) | max(F_err, M_err) painted (pp) | tail FV pooled (pp) | gaps FV pooled (pp) | lead FV pooled (pp) | worst tail / gaps stream (pp) | streams tail/gaps > +10 pp | G2 | G3 |")
    print("|---|---|---|---|---|---|---|---|---|---|---|---|---|---|")
    for t in TAGS[1:]:
        R = VL.run_pair(lead, bt, vin_tag(t, lead))
        for snr in ("+10", "+0"):
            def acc(kind, sel):
                b = c = n = 0
                for j in sel:
                    x = R["reg"].get((snr, kind, j), [0, 0, 0]); b += x[0]; c += x[1]; n += x[2]
                return b, c, n
            pb, pc, pn = acc("painted", range(len(VL.BIN_NAMES)))
            wb, wc, wn = acc("worker", range(len(VL.BIN_NAMES)))
            lb, lc, ln = acc("painted", range(3))
            e = {g: R["gen"].get((snr, "painted", g), [0, 0, 0]) for g in ("f", "m")}
            eb = max(100 - pct(e[g][0], e[g][2]) for g in ("f", "m")); ec = max(100 - pct(e[g][1], e[g][2]) for g in ("f", "m"))
            ss = [s for s in R["streams"] if s["snr"] == snr]
            w2 = sum(pct(s["pc"] - s["pb"], s["pn"]) < -2 for s in ss if s["pn"])
            segs, dseg = [], {}
            for nm in ("tail", "gaps", "lead"):
                b, c, n = R["seg"].get((snr, nm), [0, 0, 0])
                dseg[nm] = pct(c - b, n) if n else 0.0
                segs.append(f"{pct(b, n):.2f} -> {pct(c, n):.2f} ({pct(c - b, n):+.2f})" if n else "-")
            worst = {nm: max([pct(s[nm][1] - s[nm][0], s[nm][2]) for s in ss if s[nm][2] >= 20] or [0]) for nm in ("tail", "gaps")}
            n10 = sum(pct(s[nm][1] - s[nm][0], s[nm][2]) > 10 for s in ss for nm in ("tail", "gaps") if s[nm][2] >= 20)
            dp, dl, share = pct(pc - pb, pn), pct(lc - lb, ln), pct(w2, len(ss))
            ok2 = dp >= -0.3 and dl >= -0.5 and share <= 2.0
            ok3 = dseg["tail"] <= 1.0 and dseg["gaps"] <= 1.0 and n10 == 0
            key = f"L{lead}|{split}|{snr}"
            v2 = verdict(t, f"G2 {key}", ok2); v3 = verdict(t, f"G3 {key}", ok3)
            print(f"| {t} | {snr} | {pct(pb, pn):.2f} -> {pct(pc, pn):.2f} ({dp:+.3f}) | {pct(lb, ln):.2f} -> {pct(lc, ln):.2f} ({dl:+.3f}) | "
                  f"{w2} / {len(ss)} ({share:.1f} %) | {pct(wc - wb, wn):+.3f} | {ec - eb:+.3f} | {segs[0]} | {segs[1]} | {segs[2]} | "
                  f"{worst['tail']:+.1f} / {worst['gaps']:+.1f} | {n10} | {v2} | {v3} |")
            OUT.setdefault(t, {}).setdefault("g23", {})[key] = dict(
                painted=dp, low=dl, worse2_share=share, worse2=w2, n=len(ss), worker=pct(wc - wb, wn), maxerr=ec - eb,
                tail=dseg["tail"], gaps=dseg["gaps"], lead=dseg["lead"], worst=worst, n10=n10,
                worse_ids=[s["id"] for s in ss if s["pn"] and pct(s["pc"] - s["pb"], s["pn"]) < -2])


# ---------------- G4: trace continuity in clean speech
def frag(tag, cp):
    segs = 0; vsec = 0.0; gaps = []; gaps500 = []
    for nm in names(tag, cp):
        m, c = load(f"{ATTR}/{tag}/{cp}/{nm}")
        p = (np.where(np.isfinite(c["inten"]), c["paint"], 0) > 0)
        ref = c["refd"] > 0
        hop = m["hopS"]
        vsec += ref.sum() * hop
        d = np.diff(np.concatenate([[0], p.astype(int), [0]]))
        st, en = np.where(d == 1)[0], np.where(d == -1)[0]
        segs += len(st)
        for a, b in zip(en[:-1], st[1:]):  # unpainted run [a, b) between two painted segments
            ms = (b - a) * hop * 1000
            if ref[a:b].all():
                gaps.append(ms)
            if ms <= 500.001:
                gaps500.append(ms)
    return segs, vsec, gaps, gaps500


def g4():
    print("\n## G4: trace continuity, clean speech (painted segments per reference-voiced second; within-word gaps)")
    print("| tag | FDA seg/s | PTDB seg/s | vocadito seg/s | pooled seg/s | strict within-word gaps n, median / mean ms | gaps <= 500 ms n, median ms (FDA / PTDB / voc) | verdict (<= +5 %, median not longer) |")
    print("|---|---|---|---|---|---|---|---|")
    base = None
    for t in TAGS:
        per, S, Vs, G, G5 = {}, 0, 0.0, [], {}
        for cp in ("fda", "ptdb", "voc"):
            s, v, g, g5 = frag(t, cp)
            per[cp] = s / v; S += s; Vs += v; G += g; G5[cp] = g5
        r = S / Vs
        med = float(np.median(G)) if G else 0.0
        med5 = {cp: float(np.median(G5[cp])) if G5[cp] else 0.0 for cp in G5}
        row = dict(per=per, pooled=r, n=len(G), med=med, mean=float(np.mean(G)) if G else 0.0,
                   n5={cp: len(G5[cp]) for cp in G5}, med5=med5)
        if base is None:
            base = row
            cells = [f"{per[cp]:.4f}" for cp in ("fda", "ptdb", "voc")] + [f"{r:.4f}"]
            vd = "-"
        else:
            cells = [f"{per[cp]:.4f} ({100 * (per[cp] / base['per'][cp] - 1):+.2f} %)" for cp in ("fda", "ptdb", "voc")]
            cells.append(f"{r:.4f} ({100 * (r / base['pooled'] - 1):+.2f} %)")
            ok = (100 * (r / base["pooled"] - 1) <= 5 and all(100 * (per[cp] / base["per"][cp] - 1) <= 5 for cp in per)
                  and med <= base["med"] and all(med5[cp] <= base["med5"][cp] for cp in med5))
            vd = verdict(t, "G4", ok)
        print(f"| {t} | " + " | ".join(cells) + f" | {len(G)}, {med:.0f} / {row['mean']:.1f} | "
              + " / ".join(f"{row['n5'][cp]}, {med5[cp]:.0f}" for cp in ("fda", "ptdb", "voc")) + f" | {vd} |")
        OUT.setdefault(t, {})["g4"] = row


if "goal" in SETS:
    goal()
if "g1" in SETS:
    g1()
if "g2" in SETS or "g3" in SETS:
    for lead in LEADS:
        for split in SPLITS:
            g23(lead, split)
if "g4" in SETS:
    g4()
print("\n## Verdicts (FAIL rows only; every other scored row PASS)")
for t in TAGS[1:]:
    bad = [k for k, v in VERDICT.get(t, {}).items() if not v]
    print(f"- {t}: " + ("all scored rows PASS" if not bad else "; ".join(bad)))
OUT["_verdict"] = VERDICT
if A.get("json"):
    json.dump(OUT, open(A["json"], "w"), default=str, indent=1)
