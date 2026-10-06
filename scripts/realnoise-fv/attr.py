# attr.py — real-noise false voicing: stage attribution tables from the
# per-hop dumps of attr.mjs (2026-10-05). Noise-only clips, so every posted
# pitch is false voicing (FV) and every painted hop is painted FV.
#
# Usage: python scripts/realnoise-fv/attr.py TAG [--attr=build/realnoise-fv/attr]
#          [--split=all|tune|held] [--json=PATH] [--clips=N]
#
# Tables (clip-mean of per-clip fractions unless said otherwise; "pooled" =
# frames pooled over clips):
#   1. painted FV by class (mean / p90 / max), fresh vs held (pitch-hold
#      bridge), posted FV, by time window (0-5.5 s before any notch can
#      promote, 5.5-20.5 s, >= 20.5 s)
#   2. worker funnel: frame-local voiced -> decoded -> ghost veto -> above-
#      range -> harmonic guard -> posted -> painted (pooled)
#   3. detector: silence term on FV frames; margin best - unvoiced
#   4. notch coverage of each posted FV frame (decoded f vs the lines the
#      notch tracker sees): N0 no line seen / N1 no seen line is a harmonic
#      (or the sub-octave) of f / N2 related lines, none notched / N3 some
#      related lines notched, others not / N4 every related seen line notched
#      — with the status of the un-notched related lines (young, onset /
#      voice timing, duty, over capacity) and whether the ghost veto could
#      have seen f (f at 1x / 2x an active line)
#   5. silence gate: painted FV hops with intensity < -50 dB
#   6. gender VAD: % of inference ticks scored on noise-only audio, by route
#   7. worst clips
import sys, os, json, glob
import numpy as np

A = dict((a[2:].split("=", 1) + ["1"])[:2] for a in sys.argv[1:] if a.startswith("--"))
TAGS = [a for a in sys.argv[1:] if not a.startswith("--")]
ATTR = A.get("attr", "build/realnoise-fv/attr")
SPLIT = A.get("split", "all")
SET = A.get("set", "noise")
LABELS = ["stationary-tonal", "intermittent-tonal", "mixed", "broadband"]
VT = 0.35
WARM = 5.5   # s: no line can promote before minTrackSec (5 s) + the 512 ms observation fill
ONSET = 20.5
STAT = {1: "notched", 2: "over-capacity", 3: "young", 4: "onset-wait", 5: "voice-wait", 6: "duty", 7: "promotable"}


def load(tag, name):
    d = f"{ATTR}/{tag}/{SET}/{name}"
    m = json.load(open(d + ".json"))
    a = np.fromfile(d + ".f32", dtype=np.float32).reshape(len(m["cols"]), m["n"]).astype(float)
    return m, {c: a[i] for i, c in enumerate(m["cols"])}


def related(tf, f, tol=0.025):
    """mask over the 8 line slots: line is m*f (m = 1..8) or f/2"""
    out = np.zeros(tf.shape, bool)
    for mlt in [0.5] + list(range(1, 9)):
        out |= (tf > 0) & (np.abs(tf / (mlt * f) - 1) < tol)
    return out


def clip_stats(m, c):
    n, hop, L = m["n"], m["hopS"], m["L"]
    k = np.arange(n)
    td = (k + 1) * hop - 0.040                     # detection columns: window centre
    tp = (k + 1) * hop - 0.040 - L * hop           # display hop k shows frame k - L
    disp = np.isfinite(c["inten"])
    paint = (c["paint"] > 0) & disp
    held = paint & (c["msg"] <= 0)
    det = c["uv"] > 0                              # frames the detector ran on
    post = c["post"] > 0
    s = {"id": m["id"], "label": m.get("label"), "cls": m.get("cls"), "split": m.get("split"), "dur": n * hop}
    nd = max(disp.sum(), 1)
    s["paint"] = float(paint.sum() / nd)
    s["held"] = float(held.sum() / nd)
    s["fresh"] = float((paint & ~held).sum() / nd)
    s["post"] = float(post.sum() / max(det.sum(), 1))
    for nm, lo, hi in (("w0", 0, WARM), ("w1", WARM, ONSET), ("w2", ONSET, 1e9)):
        md = disp & (tp >= lo) & (tp < hi)
        s[f"paint_{nm}"] = int((paint & md).sum())
        s[f"n_{nm}"] = int(md.sum())
    # funnel (pooled counts)
    fl = det & (c["s0"] > c["uv"])
    dec = c["dec"] > 0
    rng = dec & (c["dec"] > 400)
    veto = dec & ~rng & (c["gk"] < 0)
    gv0 = c["gk"] == 0
    s["F"] = dict(det=int(det.sum()), fl=int(fl.sum()), dec=int(dec.sum()), veto=int(veto.sum()), rng=int(rng.sum()),
                  guard=int(gv0.sum()), post=int(post.sum()), paint=int(paint.sum()), held=int(held.sum()))
    # detector: silence term (uv > vt) on frames whose best candidate beats vt
    strong = det & (c["s0"] > VT)
    s["D"] = dict(strong=int(strong.sum()), sil_kill=int((strong & (c["s0"] <= c["uv"])).sum()),
                  fv_sil=int((post & (c["uv"] > VT + 1e-9)).sum()),
                  fv_margin=np.round(c["s0"][post] - c["uv"][post], 3).tolist() if post.any() else [])
    s["hc"] = np.bincount(c["hc"][post & (c["hc"] >= 0)].astype(int), minlength=5).tolist()
    # notch coverage of each posted FV frame
    tf = np.stack([c[f"tf{i}"] for i in range(8)], 1)
    ts = np.stack([c[f"ts{i}"] for i in range(8)], 1)
    cov = {}
    for kk in np.nonzero(post)[0]:
        f = c["post"][kk]
        win = "w0" if td[kk] < WARM else ("w1" if td[kk] < ONSET else "w2")
        if c["npres"][kk] == 0:
            cat, why = "N0", "-"
        else:
            r = related(tf[kk], f)
            if not r.any():
                cat, why = "N1", "-"
            else:
                st = ts[kk][r]
                notched = st == 1
                if not notched.any():
                    cat = "N2"
                elif notched.all():
                    cat = "N4"
                else:
                    cat = "N3"
                un = st[st != 1]
                why = STAT[int(un[0])] if len(un) else "-"   # strongest un-notched related line
                if cat == "N4":
                    # could the ghost veto have seen f? (f within 2 % of 1x / 2x a notched line)
                    act = tf[kk][ts[kk] == 1]
                    near = any(abs(f - rr * a) <= rr * 0.02 * a for a in act for rr in (1, 2))
                    why = "veto-window" if near else ("f=line/2" if any(abs(f * 2 / a - 1) < 0.025 for a in act) else
                                                      ("f=line/k" if any(abs(a / f - round(a / f)) < 0.025 * a / f and round(a / f) >= 3 for a in act) else "other"))
        key = f"{cat}|{why}|{win}"
        cov[key] = cov.get(key, 0) + 1
    s["cov"] = cov
    nrel = []
    for kk in np.nonzero(post)[0]:
        nrel.append(int(related(tf[kk], c["post"][kk]).sum()))
    s["nrel"] = np.bincount(np.array(nrel, int), minlength=9).tolist() if nrel else [0] * 9
    # silence gate
    s["paint_quiet"] = int((paint & (c["inten"] < -50)).sum())
    # gender VAD
    gv = c["gv"]
    tick = gv >= 0
    s["G"] = dict(ticks=int(tick.sum()), voiced=int((gv == 1).sum()), subfloor=int((gv == 2).sum()), stale=int((gv == 3).sum()))
    s["gpass"] = float((gv >= 1).sum() / max(tick.sum(), 1))
    return s


def pct(a, b):
    return 100.0 * a / b if b else float("nan")


def report(tag, out):
    names = sorted(os.path.basename(p)[:-5] for p in glob.glob(f"{ATTR}/{tag}/{SET}/*.json"))
    S = []
    for nm in names:
        m, c = load(tag, nm)
        if SPLIT != "all" and m.get("split") != SPLIT:
            continue
        S.append(clip_stats(m, c))
    groups = [(lb, [s for s in S if s["label"] == lb]) for lb in LABELS] + [("all", S)]
    print(f"## {tag}  ({len(S)} clips, split={SPLIT})\n")
    print("### 1. painted false voicing (clip mean / p90 / max) and what feeds it\n")
    print("| class | clips | painted mean | p90 | max | fresh | held (hold bridge) | posted | painted 0-5.5 s | 5.5-20.5 s | >= 20.5 s |")
    print("|---|---|---|---|---|---|---|---|---|---|---|")
    for lb, g in groups:
        if not g:
            continue
        p = np.array([s["paint"] for s in g])
        w = [pct(sum(s[f"paint_{x}"] for s in g), sum(s[f"n_{x}"] for s in g)) for x in ("w0", "w1", "w2")]
        print(f"| {lb} | {len(g)} | {100*p.mean():.1f} % | {100*np.percentile(p,90):.1f} % | {100*p.max():.1f} % | "
              f"{100*np.mean([s['fresh'] for s in g]):.1f} % | {100*np.mean([s['held'] for s in g]):.1f} % | "
              f"{100*np.mean([s['post'] for s in g]):.1f} % | {w[0]:.1f} % | {w[1]:.1f} % | {w[2]:.1f} % |")
    print("\n(time windows: pooled painted hops / display hops in the window)\n")
    print("### 2. worker funnel (pooled, % of analysed frames)\n")
    print("| class | frame-local voiced | decoded voiced | ghost-vetoed | above-range null | guard-vetoed | posted | painted fresh | painted held |")
    print("|---|---|---|---|---|---|---|---|---|")
    for lb, g in groups:
        if not g:
            continue
        F = {k: sum(s["F"][k] for s in g) for k in g[0]["F"]}
        d = F["det"]
        print(f"| {lb} | {pct(F['fl'],d):.1f} | {pct(F['dec'],d):.1f} | {pct(F['veto'],d):.1f} | {pct(F['rng'],d):.1f} | "
              f"{pct(F['guard'],d):.1f} | {pct(F['post'],d):.1f} | {pct(F['paint']-F['held'],d):.1f} | {pct(F['held'],d):.1f} |")
    print("\n### 3. detector: silence term and voicing margin on false-voiced frames (pooled)\n")
    print("| class | strong frames (best > vt) the silence term turned unvoiced | posted FV with silence term active | FV margin best - unvoiced p10 / p50 / p90 | harmonic count of FV frames 2 / 3 / 4 |")
    print("|---|---|---|---|---|")
    for lb, g in groups:
        if not g:
            continue
        st = sum(s["D"]["strong"] for s in g); sk = sum(s["D"]["sil_kill"] for s in g)
        fp = sum(s["F"]["post"] for s in g); fs = sum(s["D"]["fv_sil"] for s in g)
        mg = np.concatenate([np.array(s["D"]["fv_margin"]) for s in g if s["D"]["fv_margin"]] or [np.array([np.nan])])
        hc = np.sum([s["hc"] for s in g], 0); ht = max(hc.sum(), 1)
        print(f"| {lb} | {pct(sk,st):.1f} % | {pct(fs,fp):.1f} % | {np.nanpercentile(mg,10):.2f} / {np.nanpercentile(mg,50):.2f} / {np.nanpercentile(mg,90):.2f} | "
              f"{pct(hc[2],ht):.0f} / {pct(hc[3],ht):.0f} / {pct(hc[4],ht):.0f} % |")
    print("\n### 4. notch coverage of posted false-voiced frames (pooled, % of posted FV in the class)\n")
    cats = ["N0", "N1", "N2", "N3", "N4"]
    print("| class | posted FV frames | N0 no line seen | N1 no related line | N2 related, none notched | N3 partly notched | N4 all related notched |")
    print("|---|---|---|---|---|---|---|")
    for lb, g in groups:
        if not g:
            continue
        tot = {}
        for s in g:
            for k2, v in s["cov"].items():
                tot[k2] = tot.get(k2, 0) + v
        T = sum(tot.values())
        row = [pct(sum(v for k2, v in tot.items() if k2.startswith(cat + "|")), T) for cat in cats]
        print(f"| {lb} | {T} | " + " | ".join(f"{x:.1f}" for x in row) + " |")
    print("\nN2 / N3: status of the strongest un-notched related line; N4: why the ghost veto missed (pooled, all classes, % of posted FV):\n")
    tot = {}
    for s in S:
        for k2, v in s["cov"].items():
            tot[k2] = tot.get(k2, 0) + v
    T = sum(tot.values())
    by = {}
    for k2, v in tot.items():
        cat, why, win = k2.split("|")
        by.setdefault((cat, why), [0, 0, 0])
        by[(cat, why)][["w0", "w1", "w2"].index(win)] += v
    print("| category | reason | % of posted FV | of which 0-5.5 s | 5.5-20.5 s | >= 20.5 s |")
    print("|---|---|---|---|---|---|")
    for (cat, why), v in sorted(by.items(), key=lambda x: (x[0][0], -sum(x[1]))):
        print(f"| {cat} | {why} | {pct(sum(v),T):.1f} | {pct(v[0],T):.1f} | {pct(v[1],T):.1f} | {pct(v[2],T):.1f} |")
    nr = np.sum([s["nrel"] for s in S], 0)
    print("\nrelated lines per posted FV frame (0..8): " + " / ".join(f"{pct(x, nr.sum()):.0f}" for x in nr) + " %")
    print("\n### 5. silence gate\n")
    pq = sum(s["paint_quiet"] for s in S); pa = sum(s["F"]["paint"] for s in S)
    print(f"painted FV hops with intensity < -50 dB (the gate's intensity arm says quiet): {pct(pq, pa):.1f} % of painted FV ({pq} hops)")
    print("\n### 6. gender VAD on noise-only audio (% of inference ticks scored)\n")
    print("| class | ticks | scored | via voiced pitch | via sub-floor probe | via stale feed | clip mean scored | clips scoring > 10 % |")
    print("|---|---|---|---|---|---|---|---|")
    for lb, g in groups:
        if not g:
            continue
        G = {k2: sum(s["G"][k2] for s in g) for k2 in g[0]["G"]}
        sc = G["voiced"] + G["subfloor"] + G["stale"]
        gp = np.array([s["gpass"] for s in g])
        print(f"| {lb} | {G['ticks']} | {pct(sc,G['ticks']):.1f} % | {pct(G['voiced'],G['ticks']):.1f} % | {pct(G['subfloor'],G['ticks']):.1f} % | "
              f"{pct(G['stale'],G['ticks']):.1f} % | {100*gp.mean():.1f} % | {int((gp > 0.1).sum())} |")
    pp = np.array([s["paint"] for s in S]); gp = np.array([s["gpass"] for s in S])
    if len(S) > 2:
        print(f"\nper-clip correlation, painted FV vs gender-scored ticks: r = {np.corrcoef(pp, gp)[0,1]:.2f}")
    print("\n### 7. worst clips (painted FV)\n")
    print("| clip | class | label | painted | held | posted | gender scored |")
    print("|---|---|---|---|---|---|---|")
    for s in sorted(S, key=lambda s: -s["paint"])[: int(A.get("clips", "12"))]:
        print(f"| {s['id']} | {s['cls']} | {s['label']} | {100*s['paint']:.1f} % | {100*s['held']:.1f} % | {100*s['post']:.1f} % | {100*s['gpass']:.1f} % |")
    if out:
        json.dump([{k2: v for k2, v in s.items() if k2 not in ("D",)} for s in S], open(out, "w"))


if __name__ == "__main__":
    for t in TAGS:
        report(t, A.get("json"))
