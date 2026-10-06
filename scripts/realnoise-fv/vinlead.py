# vinlead.py — voice-in-noise cost of a candidate by NOISE-ONLY LEAD LENGTH,
# register and voice gender; per-stream losses in frames; painted false
# voicing on the noise segments of every stream; gender-model ticks over
# voiced audio (review fixes, 2026-10-05).
#
# The 784 public voice-in-noise mixes start the voice after a 20 s noise-only
# lead. attr.mjs --lead=S crops them so the stream starts S s before the
# voice (S = 0: the voice starts with the stream). Every lead is scored as a
# BASE / CANDIDATE pair of dump tags:
#
#   python scripts/realnoise-fv/vinlead.py --pairs=0:base0_L0:fgA_L0,20:b2:fgA \
#          [--split=all|tune|held] [--attr=build/realnoise-fv/attr] [--json=PATH] [--top=12]
#
# Conventions = vinscore.py (Praat AC truth of the voice layers, 8 % at
# pitch, worker frames at the frame centre, painted at the display alignment).
# Sections printed per lead:
#   A  voice at pitch, worker and painted, by SNR x register (truth F0 bin)
#      and by SNR x voice gender (f / m / u = unknown: pvqd, vocadito);
#      gender-symmetric error max(F_err, M_err); frames are counts of
#      truth-voiced frames.
#   B  per stream: worker / painted voice frames at pitch lost (> 1 pp),
#      in frames; "display-only" = posted pitch identical on every
#      truth-voiced frame, i.e. the loss is the display's (onset
#      confirmation after the candidate removed noise false voicing that had
#      primed the paint gate just before a voice onset).
#   C  painted false voicing on each stream's noise segments — lead (from
#      1.5 s into the stream to 0.1 s before the voice), tail (> 0.5 s after
#      the voice) and gaps (program frames >= 0.1 s from any voiced truth) —
#      streams > base + 2 pp (segments of >= 20 hops), worst listed.
#   D  gender-model inference ticks (gv column) whose 0.75 s window is
#      >= 60 % truth-voiced: share scored (fed to the model), by SNR x gender.
import sys, os, glob, json
import numpy as np

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import vinscore as V  # noqa: E402  (shares --data-root / --attr)

A = V.A
ATTR = V.ATTR
SPLIT = A.get("split", "all")
TOP = int(A.get("top", 12))
PAIRS = [p.split(":") for p in A.get("pairs", "").split(",") if p]
BINS = [0, 100, 130, 160, 200, 260, 330, 400, 10000]
BIN_NAMES = ["< 100", "100-130", "130-160", "160-200", "200-260", "260-330", "330-400", ">= 400"]
SEG_MIN = 20


def gender_of(rec):
    for L in rec["spec"]["layers"]:
        v = V.VOICE.get(L["clip"])
        if v:
            g = v.get("gender")
            return "f" if g in ("f", "w") else "m" if g == "m" else "u"
    return "u"


def stream(tag, sid):
    m, c = V.load(f"{ATTR}/{tag}/vin/{sid}")
    rec = V.MIX[sid]
    n, hop, L = m["n"], m["hopS"], m["L"]
    crop = m.get("crop_s", 0) or 0
    k = np.arange(n)
    tws = (k + 1) * hop - 0.040
    tds = tws - L * hop - 0.030
    dur = n * hop
    valid = (tds >= 0) & (tws <= dur - 0.3)
    tw, td = tws + crop, tds + crop
    rw, rd = V.truth(rec, tw), V.truth(rec, td)
    post = c["post"]
    paint = np.where(np.isfinite(c["inten"]), c["paint"], 0)
    t0, t1 = rec["voice_t0"], rec["voice_t1"]
    vw = valid & (tw >= t0) & (tw <= t1) & (rw > 0)
    vd = valid & (td >= t0) & (td <= t1) & (rd > 0)
    okw = vw & (post > 0) & (np.abs(post / np.where(rw > 0, rw, 1) - 1) < 0.08)
    okd = vd & (paint > 0) & (np.abs(paint / np.where(rd > 0, rd, 1) - 1) < 0.08)
    near = np.zeros(n, bool)
    for d in np.arange(-0.1, 0.1001, 0.025):
        near |= V.truth(rec, td + d) > 0
    segs = {"lead": valid & (tds >= 1.5) & (td < t0 - 0.1),
            "tail": valid & (td > t1 + 0.5),
            "gaps": valid & (td >= t0) & (td <= t1) & ~(rd > 0) & ~near}
    # voice onsets (painted alignment): truth voiced now, unvoiced 0.1 s before
    onset = vd & ~(V.truth(rec, td - 0.1) > 0)
    # gender ticks: window [(k+1) hop - 0.75, (k+1) hop] in stream time
    gv = c["gv"]
    tick = np.where(gv >= 0)[0]
    vfrac = np.zeros(len(tick))
    if len(tick):
        off = np.arange(0, 0.7501, 0.01)
        tt = ((tick + 1) * hop)[:, None] - off[None, :] + crop
        vfrac = (V.truth(rec, tt.ravel()) > 0).reshape(tt.shape).mean(axis=1)
    return dict(rec=rec, post=post, paint=paint, rw=rw, rd=rd, vw=vw, vd=vd, okw=okw, okd=okd,
                segs=segs, onset=onset, gvt=gv[tick] if len(tick) else np.zeros(0), vtick=vfrac >= 0.6)


def pct(a, b):
    return 100.0 * a / b if b else float("nan")


def run_pair(lead, bt, ct):
    ids = sorted(os.path.basename(p)[:-5] for p in glob.glob(f"{ATTR}/{ct}/vin/*.json"))
    ids = [i for i in ids if os.path.exists(f"{ATTR}/{bt}/vin/{i}.json")]
    reg = {}    # (snr, kind, bin) -> [base ok, cand ok, n]
    gen = {}    # (snr, kind, gender) -> [base ok, cand ok, n]
    gtk = {}    # (snr, gender) -> [base scored, cand scored, ticks]
    seg = {}    # (snr, seg) -> [base fv, cand fv, hops]
    streams = []
    for sid in ids:
        rec = V.MIX[sid]
        if SPLIT != "all" and split_of(rec["noise_id"]) != SPLIT:
            continue
        b, c = stream(bt, sid), stream(ct, sid)
        snr = f"{rec['snr_db']:+d}"
        g = gender_of(rec)
        for kind, vmask, ref, okb, okc in (("worker", b["vw"], b["rw"], b["okw"], c["okw"]),
                                           ("painted", b["vd"], b["rd"], b["okd"], c["okd"])):
            bi = np.digitize(ref, BINS) - 1
            for j in range(len(BIN_NAMES)):
                mm = vmask & (bi == j)
                a = reg.setdefault((snr, kind, j), [0, 0, 0])
                a[0] += int((okb & mm).sum()); a[1] += int((okc & mm).sum()); a[2] += int(mm.sum())
            a = gen.setdefault((snr, kind, g), [0, 0, 0])
            a[0] += int(okb.sum()); a[1] += int(okc.sum()); a[2] += int(vmask.sum())
        vt = b["vtick"]
        a = gtk.setdefault((snr, g), [0, 0, 0])
        a[0] += int((b["gvt"][vt] > 0).sum()); a[1] += int((c["gvt"][vt] > 0).sum()); a[2] += int(vt.sum())
        srow = {"id": sid, "snr": snr, "gender": g, "split": split_of(rec["noise_id"]), "noise": rec["noise_id"],
                "wb": int(b["okw"].sum()), "wc": int(c["okw"].sum()), "wn": int(b["vw"].sum()),
                "pb": int(b["okd"].sum()), "pc": int(c["okd"].sum()), "pn": int(b["vd"].sum()),
                "wid": bool(np.array_equal(b["post"][b["vw"]], c["post"][b["vw"]])),
                "lo_wb": int((b["okw"] & (b["rw"] < 160)).sum()), "lo_wc": int((c["okw"] & (b["rw"] < 160)).sum()),
                "lo_wn": int((b["vw"] & (b["rw"] < 160)).sum())}
        lost = b["okd"] & ~c["okd"]
        srow["p_lost_onset"] = int((lost & np.convolve(b["onset"].astype(float), np.ones(7), "full")[:len(lost)].astype(bool)).sum())
        srow["p_lost"] = int(lost.sum())
        for nm, mk in b["segs"].items():
            fb, fc, hn = int((mk & (b["paint"] > 0)).sum()), int((mk & (c["paint"] > 0)).sum()), int(mk.sum())
            pw_b, pw_c = int((mk & (b["post"] > 0)).sum()), int((mk & (c["post"] > 0)).sum())
            srow[nm] = [fb, fc, hn, pw_b, pw_c]
            a = seg.setdefault((snr, nm), [0, 0, 0])
            a[0] += fb; a[1] += fc; a[2] += hn
        streams.append(srow)
    return dict(lead=lead, base=bt, cand=ct, n=len(streams), reg=reg, gen=gen, gtk=gtk, seg=seg, streams=streams)


def split_of(noise_id):
    import re
    m = re.match(r"^dcase__([A-Za-z]+)_(id\d+)_", noise_id)
    grp = f"dcase:{m.group(1)}_{m.group(2)}" if m else noise_id
    h = 0x811C9DC5
    for ch in grp:
        h ^= ord(ch)
        h = (h * 0x01000193) & 0xFFFFFFFF
    return "held" if h % 3 == 0 else "tune"


def report(R):
    lead = R["lead"]
    print(f"\n## lead {lead} s ({R['base']} vs {R['cand']}, {R['n']} streams, split={SPLIT})")
    print("\nA. voice at pitch by register: base -> cand (delta pp, net frames)")
    print("| SNR | level | " + " | ".join(BIN_NAMES) + " | all |")
    print("|---|---|" + "---|" * (len(BIN_NAMES) + 1))
    for snr in ("+10", "+0"):
        for kind in ("worker", "painted"):
            cells, tb, tc, tn = [], 0, 0, 0
            for j in range(len(BIN_NAMES)):
                b, c, n = R["reg"].get((snr, kind, j), [0, 0, 0])
                tb += b; tc += c; tn += n
                cells.append(f"{pct(c - b, n):+.2f} ({c - b:+d}/{n})" if n else "-")
            cells.append(f"{pct(tb, tn):.2f} -> {pct(tc, tn):.2f} ({pct(tc - tb, tn):+.3f}, {tc - tb:+d})")
            print(f"| {snr} | {kind} | " + " | ".join(cells) + " |")
    print("\nA2. by voice gender: accuracy base -> cand (delta pp, net frames of n); max(F_err, M_err)")
    print("| SNR | level | female | male | unknown | max(F_err, M_err) |")
    print("|---|---|---|---|---|---|")
    for snr in ("+10", "+0"):
        for kind in ("worker", "painted"):
            cells, err = [], {}
            for g in ("f", "m", "u"):
                b, c, n = R["gen"].get((snr, kind, g), [0, 0, 0])
                cells.append(f"{pct(b, n):.2f} -> {pct(c, n):.2f} ({pct(c - b, n):+.3f}, {c - b:+d}/{n})" if n else "-")
                err[g] = (100 - pct(b, n), 100 - pct(c, n))
            mb, mc = max(err["f"][0], err["m"][0]), max(err["f"][1], err["m"][1])
            print(f"| {snr} | {kind} | " + " | ".join(cells) + f" | {mb:.2f} -> {mc:.2f} ({mc - mb:+.3f}) |")
    S = R["streams"]
    print("\nB. per stream (voice frames at pitch, cand - base)")
    for snr in ("+10", "+0", "all"):
        ss = [s for s in S if snr == "all" or s["snr"] == snr]
        w1 = [s for s in ss if pct(s["wc"] - s["wb"], s["wn"]) < -1]
        p1 = [s for s in ss if pct(s["pc"] - s["pb"], s["pn"]) < -1]
        p1d = [s for s in p1 if s["wid"]]
        w5 = [s for s in ss if pct(s["wc"] - s["wb"], s["wn"]) < -5]
        pg = [s for s in ss if pct(s["pc"] - s["pb"], s["pn"]) > 1]
        print(f"  SNR {snr}: {len(ss)} streams; worker > 1 pp worse {len(w1)} (> 5 pp {len(w5)}; "
              f"{sum(s['wb'] - s['wc'] for s in w1)} frames); painted > 1 pp worse {len(p1)} "
              f"(display-only {len(p1d)}; {sum(s['pb'] - s['pc'] for s in p1)} frames); painted > 1 pp better {len(pg)}")
    worst = sorted(S, key=lambda s: pct(s["wc"] - s["wb"], s["wn"]) if s["wn"] else 0)[:TOP]
    print("  worst (worker): id | SNR | g | worker pp (frames) | painted pp (frames) | lost painted near onsets")
    for s in worst:
        if s["wc"] >= s["wb"]:
            break
        print(f"    {s['id']} | {s['snr']} | {s['gender']} | {pct(s['wc'] - s['wb'], s['wn']):+.2f} ({s['wc'] - s['wb']:+d}/{s['wn']}) | "
              f"{pct(s['pc'] - s['pb'], s['pn']):+.2f} ({s['pc'] - s['pb']:+d}/{s['pn']}) | {s['p_lost_onset']}/{s['p_lost']}")
    dis = [s for s in S if s["wid"] and pct(s["pc"] - s["pb"], s["pn"]) < -1]
    if dis:
        print("  display-only painted losses > 1 pp: id | SNR | painted pp (frames) | lost frames near onsets")
        for s in dis:
            print(f"    {s['id']} | {s['snr']} | {pct(s['pc'] - s['pb'], s['pn']):+.2f} ({s['pc'] - s['pb']:+d}/{s['pn']}) | {s['p_lost_onset']}/{s['p_lost']}")
    print("\nC. painted false voicing on noise segments: pooled base -> cand; streams > base + 2 pp (segments >= 20 hops)")
    for nm in ("lead", "tail", "gaps"):
        for snr in ("+10", "+0"):
            b, c, n = R["seg"].get((snr, nm), [0, 0, 0])
            ss = [s for s in S if s["snr"] == snr and s[nm][2] >= SEG_MIN]
            worse = [s for s in ss if pct(s[nm][1] - s[nm][0], s[nm][2]) > 2]
            better = [s for s in ss if pct(s[nm][1] - s[nm][0], s[nm][2]) < -2]
            if not n:
                continue
            wsplit = {"held": sum(s["split"] == "held" for s in worse), "tune": sum(s["split"] == "tune" for s in worse)}
            print(f"  {nm:4s} SNR {snr}: {pct(b, n):.2f} -> {pct(c, n):.2f} % of {n} hops; streams {len(ss)}: worse > 2 pp {len(worse)} "
                  f"(held-out {wsplit['held']}, tuning {wsplit['tune']}), better < -2 pp {len(better)}")
    allw = sorted([(pct(s[nm][1] - s[nm][0], s[nm][2]), nm, s) for s in S for nm in ("lead", "tail", "gaps")
                   if s[nm][2] >= SEG_MIN and pct(s[nm][1] - s[nm][0], s[nm][2]) > 2], key=lambda x: -x[0])
    for d, nm, s in allw[:TOP]:
        fb, fc, hn, pwb, pwc = s[nm]
        print(f"    {nm} {d:+.1f} pp painted ({fb} -> {fc} of {hn} hops; worker {pwb} -> {pwc}) {s['id']} [{s['split']}]")
    print("\nD. gender-model ticks over voiced audio (window >= 60 % truth-voiced): scored share base -> cand")
    for snr in ("+10", "+0"):
        cells = []
        for g in ("f", "m", "u"):
            b, c, n = R["gtk"].get((snr, g), [0, 0, 0])
            cells.append(f"{g}: {pct(b, n):.2f} -> {pct(c, n):.2f} ({pct(c - b, n):+.2f} pp of {n})")
        print(f"  SNR {snr}: " + "; ".join(cells))


def summary(Rs):
    """one row per lead x SNR: the numbers the measurement note quotes"""
    print(f"\n## summary (split={SPLIT}): candidate - base")
    print("| lead | SNR | worker, pp (frames) | painted, pp (frames) | painted < 160 Hz | painted >= 160 Hz | worker F / M / unknown, pp "
          "| max(F_err, M_err) worker / painted | streams worse > 1 pp: worker (frames) / painted (display-only) "
          "| noise segments worse > 2 pp: lead / tail / gaps | gender ticks scored F / M, pp |")
    print("|---|---|---|---|---|---|---|---|---|---|---|")
    for R in Rs:
        S = R["streams"]
        for snr in ("+10", "+0"):
            def acc(kind, sel):
                b = c = n = 0
                for j in sel:
                    x = R["reg"].get((snr, kind, j), [0, 0, 0]); b += x[0]; c += x[1]; n += x[2]
                return b, c, n
            wb, wc, wn = acc("worker", range(len(BIN_NAMES)))
            pb, pc, pn = acc("painted", range(len(BIN_NAMES)))
            lb, lc, ln = acc("painted", range(3))
            hb, hc, hn = acc("painted", range(3, len(BIN_NAMES)))
            gd = []
            mx = []
            for kind in ("worker", "painted"):
                e = {}
                for g in ("f", "m", "u"):
                    b, c, n = R["gen"].get((snr, kind, g), [0, 0, 0])
                    e[g] = (b, c, n)
                if kind == "worker":
                    gd = [f"{pct(e[g][1] - e[g][0], e[g][2]):+.3f}" for g in ("f", "m", "u")]
                eb = max(100 - pct(e["f"][0], e["f"][2]), 100 - pct(e["m"][0], e["m"][2]))
                ec = max(100 - pct(e["f"][1], e["f"][2]), 100 - pct(e["m"][1], e["m"][2]))
                mx.append(f"{ec - eb:+.3f}")
            ss = [s for s in S if s["snr"] == snr]
            w1 = [s for s in ss if pct(s["wc"] - s["wb"], s["wn"]) < -1]
            p1 = [s for s in ss if pct(s["pc"] - s["pb"], s["pn"]) < -1]
            segw = []
            for nm in ("lead", "tail", "gaps"):
                q = [s for s in ss if s[nm][2] >= SEG_MIN]
                segw.append(f"{sum(pct(s[nm][1] - s[nm][0], s[nm][2]) > 2 for s in q)}/{len(q)}" if q else "-")
            gt = []
            for g in ("f", "m"):
                b, c, n = R["gtk"].get((snr, g), [0, 0, 0])
                gt.append(f"{pct(c - b, n):+.2f}")
            print(f"| {R['lead']:g} | {snr} | {pct(wc - wb, wn):+.3f} ({wc - wb:+d}) | {pct(pc - pb, pn):+.3f} ({pc - pb:+d}) | "
                  f"{pct(lc - lb, ln):+.3f} | {pct(hc - hb, hn):+.3f} | {' / '.join(gd)} | {mx[0]} / {mx[1]} | "
                  f"{len(w1)} ({sum(s['wb'] - s['wc'] for s in w1)}) / {len(p1)} ({sum(s['wid'] for s in p1)}) | {' / '.join(segw)} | {' / '.join(gt)} |")


if __name__ == "__main__":
    out = []
    Rs = []
    for lead, bt, ct in PAIRS:
        R = run_pair(float(lead), bt, ct)
        Rs.append(R)
        report(R)
        out.append({k: v for k, v in R.items() if k not in ("reg", "gen", "gtk", "seg")} |
                   {k: {"|".join(map(str, kk)): vv for kk, vv in R[k].items()} for k in ("reg", "gen", "gtk", "seg")})
    summary(Rs)
    if A.get("json"):
        json.dump(out, open(A["json"], "w"))
