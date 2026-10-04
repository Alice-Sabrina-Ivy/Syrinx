# analyze.py — score session-oracle runs (run.mjs) against the build_refs.py
# references, 2026-10-03 conventions.
#
# Usage: python scripts/session-oracle/analyze.py TAG [TAG...]
#          [--runs=build/session-oracle/runs] [--refs=build/session-oracle/refs]
#          [--sessions=2025-09-08,2026-05-07,2026-05-26,2026-06-09]
#          [--out=build/session-oracle/scores] [--quiet]
# The first TAG is the baseline the others are compared with. Writes
# <out>/<TAG>.json (full count tables + event/switch metrics) and prints the
# headline tables.
#
# Conventions
#   References (per 10 ms parquet frame; refs below 75 Hz are fry, ignored):
#     cons      consensus (AC family / SHS / PENN majority, octave ties
#               dropped) — PRIMARY
#     strict    session-label R1 where Praat CC agrees within 5 % — sensitivity
#     cons_arb  cons minus frames whose octave the spectral arbiter disputes
#               (odd_rel >= 8 dB at f=cons for cons >= 140, or cons a spurious
#               half: odd <= 4 & even >= 8 dB at f=2*cons for cons < 200) —
#               the display workstream's convention
#     r1        session-label R1 alone (legacy: what the 2026-10-03 detector-octave
#               file called "strict"; kept to reproduce its numbers)
#   Speakers: private-session parquet labels (alice / second).
#   Stage alignment (phase-1 alignment sweep, session-attribution
#   best_delta): the value describing audio at ref time t is at hop
#   round((t + 0.040 + lag*hop + delta)/hop - 1), lag = L for display stages
#   (paint, ro, paintA, roA), delta = 0 (detection stages) / +30 ms
#   (display stages: one median-3 frame + gate).
#   Classes on q = value/ref: cor |q-1|<0.05; half |q-0.5|<=0.05; up
#   |q-2|<=0.2; up3 |q-3|<=0.3 or |q-4|<=0.4; null (0); other.
#   Bands: 75-110 110-160 160-200 200-260 260-400 >=400, plus 160-400 and
#   75-160 aggregates. (cons/strict are capped near 600 Hz, so >=400 holds
#   only 400-600 Hz frames.)
#   Stages: fl frame-local argmax, dec tracker decode, post worker-posted,
#   paint live trace, ro readout Hz (dim held readouts count as shown);
#   paintA/roA = the alice-only display pass (non-Alice hops replaced by a
#   pitchless frame at the session's 10th-percentile intensity).
#   Events (per voiced minute of the speaker, display stages): a run of
#   painted hops >1.5x ("up spike") or <0.67x ("down / wrong octave") the
#   ref at that hop's content time; the run ends at an unpainted hop or a
#   painted in-range hop; hops without a ref neither start nor end a run.
#   conn12: reference-free connected painted pairs >= 12 st per painted
#   minute, as rendered (a line break removes the pair; paintA uses its own
#   brkA column since 2026-10-04).
#   Switches: Alice runs >= 200 ms in one register (T >= 160, L < 140, frames
#   <= 100 ms apart) preceded within 1 s by the other register; latency =
#   first displayed-correct frame - run start ("never" = none in the run).
import sys, os, json, numpy as np

A = dict((a[2:].split("=", 1) + ["1"])[:2] for a in sys.argv[1:] if a.startswith("--"))
TAGS = [a for a in sys.argv[1:] if not a.startswith("--")]
RUNS = A.get("runs", "build/session-oracle/runs"); REFS = A.get("refs", "build/session-oracle/refs")
OUT = A.get("out", "build/session-oracle/scores"); os.makedirs(OUT, exist_ok=True)
SESSIONS = A.get("sessions", "2025-09-08,2026-05-07,2026-05-26,2026-06-09").split(",")
HELD_OUT = "2026-06-09"
DELTA_DET, DELTA_DISP = 6.938893903907228e-18, 0.030000000000000013  # phase-1 best_delta (exact floats)
BANDS = [(75, 110), (110, 160), (160, 200), (200, 260), (260, 400), (400, 1e9), (160, 400), (75, 160)]
BN = lambda lo, hi: f"{lo}-{hi}" if hi < 1e8 else f">={lo}"
CATS = ["cor", "half", "up", "up3", "null", "other"]
CONVS = ["cons", "strict", "cons_arb", "r1"]
DISPLAY = {"paint", "ro", "paintA", "roA"}


def load_refs(s):
    z = np.load(f"{REFS}/{s}.npz"); R = {k: z[k] for k in z.files}
    cons = R["cons"]
    disputed = (R["arb"] >= 8) | ((R["arb2o"] <= 4) & (R["arb2e"] >= 8))
    R["cons_arb"] = np.where(disputed, 0, cons)
    R["r1"] = R["cal"]
    for c in CONVS: R[c] = np.where(R[c] >= 75, R[c], 0)
    return R


TAP_ONLY = ("fl", "c0f", "uv", "dec")  # filled only by lib/tap-boersma.mjs


def load_run(tag, s):
    d = f"{RUNS}/{tag}"
    m = json.load(open(f"{d}/{s}.meta.json")); n = m["nHops"]
    t = np.fromfile(f"{d}/{s}.hops.f32", dtype=np.float32).reshape(len(m["cols"]), n)
    cols = {c: t[i].astype(float) for i, c in enumerate(m["cols"])}
    if m.get("tap") is False:  # SO_TAP=0: tap-only columns are all-zero placeholders, not data
        for c in TAP_ONLY: cols.pop(c, None)
    if m.get("lookback") is None:
        # Untapped runs written before 2026-10-04 stored lookback: null (and
        # their alice-only pass used L = 0 — re-run them). The worker's
        # tracker default has been L = 2 since 2026-06-09.
        print(f"WARNING {tag}/{s}: lookback null in meta (untapped run before 2026-10-04); assuming 2 - "
              f"its paintA/roA columns were built with L = 0, re-run", file=sys.stderr)
        m["lookback"] = 2
    return m, cols


def stage_index(t, stage, L, hop):
    lag = L if stage in DISPLAY else 0
    d = DELTA_DISP if stage in DISPLAY else DELTA_DET
    return np.round((t + 0.040 + lag * hop + d) / hop - 1).astype(int)


def sample(col, idx):
    v = col[np.clip(idx, 0, len(col) - 1)].copy(); v[(idx < 0) | (idx >= len(col))] = 0
    return v


def classify(v, r):
    q = np.where(v > 0, v / np.where(r > 0, r, 1), 0)
    cor = (v > 0) & (np.abs(q - 1) < 0.05)
    half = (v > 0) & (np.abs(q - 0.5) <= 0.05)
    up = (v > 0) & (np.abs(q - 2) <= 0.2)
    up3 = (v > 0) & ((np.abs(q - 3) <= 0.3) | (np.abs(q - 4) <= 0.4))
    null = ~(v > 0)
    return dict(cor=cor, half=half, up=up, up3=up3, null=null, other=~(cor | half | up | up3 | null))


def events(R, conv, cols, L, hop, stage, spk_code):
    """up/down spike events per voiced minute + voiced minutes (display stage)."""
    ref, spk, t0 = R[conv], R["spk"], R["t"][0]
    p = cols[stage]; n = len(p)
    k = np.arange(n)
    ii = np.round(((k + 1) * hop - (0.040 + L * hop + DELTA_DISP) - t0) / 0.01).astype(int)
    ok = (ii >= 0) & (ii < len(ref))
    r = np.where(ok, ref[np.clip(ii, 0, len(ref) - 1)], 0)
    sp = np.where(ok, spk[np.clip(ii, 0, len(ref) - 1)], 0)
    valid = ~np.isnan(cols["inten"])
    up_on = dn_on = False; ups = dns = vh = 0
    for j in range(n):
        if not valid[j]: continue
        d = p[j]
        if not d > 0: up_on = dn_on = False
        if not (r[j] > 0 and sp[j] == spk_code): continue
        vh += 1
        if not d > 0: continue
        q = d / r[j]; u, dn = q > 1.5, q < 0.67
        if u and not up_on: ups += 1
        if dn and not dn_on: dns += 1
        up_on, dn_on = u, dn
    return dict(up=ups, down=dns, vmin=vh * hop / 60)


def conn12(cols, stage, hop):
    # Line breaks are per display pass: brk for paint, brkA for paintA (run.mjs
    # records brkA since 2026-10-04; before that paintA ignored its breaks and
    # over-counted connected pairs the live trace never stroked). A paintA run
    # without brkA cannot be scored -> NaN.
    p = cols[stage]; bk = "brkA" if stage == "paintA" else "brk"
    if bk not in cols and stage == "paintA":
        return dict(conn12=float("nan"), pmin=float(np.sum(p > 0) * hop / 60))
    brk = cols.get(bk, np.zeros_like(p))
    a, b = p[:-1], p[1:]
    both = (a > 0) & (b > 0) & ~(brk[1:] > 0)
    j = np.abs(12 * np.log2(np.where(both, b / np.where(a > 0, a, 1), 1)))
    return dict(conn12=int(np.sum(both & (j >= 12))), pmin=float(np.sum(p > 0) * hop / 60))


def switches(t, r, c_cor, c_half):
    reg = np.where(r >= 160, 1, np.where(r < 140, 0, 2))  # 1 T, 0 L, 2 mid
    out = {"L->T": [], "T->L": []}; half = {"L->T": [0, 0], "T->L": [0, 0]}
    j, n = 0, len(t)
    while j < n:
        e = j
        while e + 1 < n and reg[e + 1] == reg[j] and t[e + 1] - t[e] <= 0.1: e += 1
        if reg[j] != 2 and t[e] - t[j] >= 0.2 and j > 0 and t[j] - t[j - 1] <= 1.0 and reg[j - 1] != 2 and reg[j - 1] != reg[j]:
            key = "L->T" if reg[j] == 1 else "T->L"
            w = np.nonzero(c_cor[j:e + 1])[0]
            out[key].append(float(t[j + w[0]] - t[j]) if len(w) else float("inf"))
            half[key][0] += int(c_half[j:e + 1].sum()); half[key][1] += e - j + 1
        j = e + 1
    return out, half


def score(tag):
    res = {"tables": {}, "events": {}, "switch": {}, "arb": {}, "cpu": {}}
    T = res["tables"]
    for s in SESSIONS:
        R = load_refs(s); m, cols = load_run(tag, s)
        L, hop = m["lookback"], m["hopS"]
        res["cpu"][s] = m["cpu"]
        stages = [st for st in ["fl", "dec", "post", "paint", "ro", "paintA", "roA"] if st in cols]
        for conv in CONVS:
            ref = R[conv]
            for spk, code in [("alice", 1), ("second", 2)]:
                msk = (R["spk"] == code) & (ref > 0)
                t, r = R["t"][msk], ref[msk]
                cls = {}
                for st in stages:
                    c = classify(sample(cols[st], stage_index(t, st, L, hop)), r); cls[st] = c
                    for lo, hi in BANDS:
                        b = (r >= lo) & (r < hi)
                        T[f"{s}|{conv}|{spk}|{st}|{BN(lo, hi)}"] = [int(b.sum())] + [int(np.sum(c[k] & b)) for k in CATS]
                if spk == "alice" and conv in ("cons", "strict", "cons_arb"):
                    for st in [x for x in ("paint", "paintA") if x in cols]:
                        sw, hf = switches(t, r, cls[st]["cor"], cls[st]["half"])
                        res["switch"][f"{s}|{conv}|{st}"] = {"lat": sw, "half": hf}
                    if conv == "cons":
                        for st in [x for x in ("dec", "paint") if x in cols]:
                            tb = (r >= 160) & (r < 400) & cls[st]["half"]
                            av = R["arb"][msk][tb]
                            res["arb"][f"{s}|{st}"] = dict(n=int(tb.sum()), high=int(np.sum(av <= 4)), low=int(np.sum(av >= 8)))
                for st in [x for x in ("paint", "paintA") if x in cols]:
                    if st == "paintA" and spk != "alice": continue
                    res["events"][f"{s}|{conv}|{spk}|{st}"] = events(R, conv, cols, L, hop, st, code)
        for st in [x for x in ("paint", "paintA") if x in cols]:
            res["events"][f"{s}|conn|{st}"] = conn12(cols, st, hop)
    # pooled (all sessions) and tuning-only pools
    for pool, ss in [("POOLED", SESSIONS), ("TUNING", [x for x in SESSIONS if x != HELD_OUT])]:
        if not ss: continue
        for k in {k.split("|", 1)[1] for k in T if k.split("|", 1)[0] in SESSIONS}:
            T[f"{pool}|{k}"] = np.sum([T[f"{x}|{k}"] for x in ss], axis=0).tolist()
        for k in {k.split("|", 1)[1] for k in res["events"] if k.split("|", 1)[0] in SESSIONS}:
            vals = [res["events"][f"{x}|{k}"] for x in ss if f"{x}|{k}" in res["events"]]
            res["events"][f"{pool}|{k}"] = {kk: float(np.sum([v[kk] for v in vals])) for kk in vals[0]}
        for k in {k.split("|", 1)[1] for k in res["switch"] if k.split("|", 1)[0] in SESSIONS}:
            vals = [res["switch"][f"{x}|{k}"] for x in ss]
            res["switch"][f"{pool}|{k}"] = {"lat": {d: sum((v["lat"][d] for v in vals), []) for d in ("L->T", "T->L")},
                                            "half": {d: [sum(v["half"][d][0] for v in vals), sum(v["half"][d][1] for v in vals)] for d in ("L->T", "T->L")}}
        for k in {k.split("|", 1)[1] for k in res["arb"] if k.split("|", 1)[0] in SESSIONS}:
            vals = [res["arb"][f"{x}|{k}"] for x in ss]
            res["arb"][f"{pool}|{k}"] = {kk: sum(v[kk] for v in vals) for kk in vals[0]}
    json.dump(res, open(f"{OUT}/{tag}.json", "w"))
    return res


def pct(res, key, cat):
    v = res["tables"].get(key)
    if not v or not v[0]: return float("nan")
    if cat == "wrong": return 100 * (v[0] - v[1] - v[5]) / v[0]
    if cat == "upall": return 100 * (v[3] + v[4]) / v[0]
    return 100 * v[1 + CATS.index(cat)] / v[0]


def sw_summary(res, key, d="L->T"):
    x = res["switch"].get(key)
    if not x: return dict(n=0, med=float("nan"), p90=float("nan"), never=float("nan"), half=float("nan"))
    lat = sorted(x["lat"][d]); n = len(lat)
    q = lambda p: lat[min(n - 1, int(p * n))] if n else float("nan")
    h = x["half"][d]
    return dict(n=n, med=q(0.5), p90=q(0.9), never=100 * sum(1 for v in lat if v == float("inf")) / n if n else float("nan"),
                half=100 * h[0] / h[1] if h[1] else float("nan"))


if __name__ == "__main__":
    RES = {t: score(t) for t in TAGS}
    if "quiet" in A: sys.exit(0)
    f = lambda x: "  -  " if x != x else (" inf " if x == float("inf") else f"{x:6.2f}")
    for conv in ["cons", "strict"]:
        for pool in ["POOLED", "TUNING", HELD_OUT]:
            print(f"\n### Alice target 160-400, {conv}, {pool}: correct / half / blank(null)  [n]")
            for t in TAGS:
                row = []
                for st in ["dec", "post", "paint", "ro", "paintA", "roA"]:
                    k = f"{pool}|{conv}|alice|{st}|160-400"
                    if k in RES[t]["tables"]:
                        row.append(f"{st} {f(pct(RES[t], k, 'cor'))}/{f(pct(RES[t], k, 'half'))}/{f(pct(RES[t], k, 'null'))}")
                print(f"{t:10s} n={RES[t]['tables'][f'{pool}|{conv}|alice|post|160-400'][0]:6d} | " + " | ".join(row))
        print(f"\n### Alice low 75-160 and bands, {conv}, POOLED: up(x2) dec/post/paint/ro and correct")
        for t in TAGS:
            g = lambda st, b, c: f(pct(RES[t], f"POOLED|{conv}|alice|{st}|{b}", c))
            print(f"{t:10s} 75-110 up {g('dec','75-110','up')}/{g('paint','75-110','up')} | 110-160 up {g('dec','110-160','up')}/{g('paint','110-160','up')} | "
                  f"75-160 up dec {g('dec','75-160','up')} post {g('post','75-160','up')} paint {g('paint','75-160','up')} ro {g('ro','75-160','up')} | "
                  f"75-160 cor dec {g('dec','75-160','cor')} paint {g('paint','75-160','cor')} blank {g('paint','75-160','null')}")
        print(f"\n### second voice, {conv}, POOLED: 160-400 dec/paint cor, half; >=400 post cor/half/null, paint half")
        for t in TAGS:
            g = lambda sp, st, b, c: f(pct(RES[t], f"POOLED|{conv}|{sp}|{st}|{b}", c))
            print(f"{t:10s} second 160-400 dec {g('second','dec','160-400','cor')}/{g('second','dec','160-400','half')} paint {g('second','paint','160-400','cor')}/{g('second','paint','160-400','half')} | "
                  f"second >=400 post {g('second','post','>=400','cor')}/{g('second','post','>=400','half')}/{g('second','post','>=400','null')} paint half {g('second','paint','>=400','half')} | "
                  f"alice >=400 post {g('alice','post','>=400','cor')}/{g('alice','post','>=400','half')}/{g('alice','post','>=400','null')} paint half {g('alice','paint','>=400','half')}")
    for conv in ["cons", "strict"]:
        print(f"\n### switches + events, {conv}, POOLED (paint / paintA)")
        for t in TAGS:
            parts = []
            for st in ["paint", "paintA"]:
                lt = sw_summary(RES[t], f"POOLED|{conv}|{st}"); tl = sw_summary(RES[t], f"POOLED|{conv}|{st}", "T->L")
                ev = RES[t]["events"].get(f"POOLED|{conv}|alice|{st}")
                if not ev: continue
                parts.append(f"{st}: L->T n={lt['n']} med {f(lt['med']*1000)}ms never {f(lt['never'])}% half {f(lt['half'])} | T->L never {f(tl['never'])}% | "
                             f"up/min {f(ev['up']/ev['vmin'])} dn/min {f(ev['down']/ev['vmin'])}")
            print(f"{t:10s} " + " || ".join(parts))
    print("\n### arbiter on Alice 160-400 half frames (cons, POOLED): n / arb-high (confirmed) / arb-low")
    for t in TAGS:
        print(f"{t:10s} " + "  ".join(f"{st}: {RES[t]['arb'].get(f'POOLED|{st}', {}).get('n', 0)}/{RES[t]['arb'].get(f'POOLED|{st}', {}).get('high', 0)}/{RES[t]['arb'].get(f'POOLED|{st}', {}).get('low', 0)}" for st in ("dec", "paint")))
    print("\n### CPU (pitch worker ms/chunk incl. resample+notch+AC+tracker+guard; run under parallel load)")
    for t in TAGS:
        print(f"{t:10s} " + " ".join(f"{s}:{RES[t]['cpu'][s]['pitchMsPerChunk']:.3f}" for s in SESSIONS))
