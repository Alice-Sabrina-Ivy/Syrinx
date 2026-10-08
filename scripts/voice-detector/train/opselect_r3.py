# opselect_r3.py — custom voice detector, round 3 (pre-registration
# 2026-10-07 §3.2-§3.4; Addendum R3-B): the selection rule over the round-3
# candidates, on VALIDATION data only.
#
# A candidate = a network (infer_r3.py output dir <cand>/<NET>/) x a
# deployment rule:
#   plain    one copy, state never reset (A0 / B-*)
#   meanT    two copies (copy a resets the GRU state at 2T, 4T, ...; copy b at
#            T, 3T, ... frames after the stream start), p = mean(p_a, p_b)
#   oldT     the same copies, p = the copy whose time since its last reset is
#            >= T (before T both copies are the same run)
# Readings, each over the 24 thresholds x 16 hangovers x agg {last, max, mean}
# grid with score.py's alignment / threshold / hangover / onset logic
# (vectorised here and checked against score.py's functions, --selftest):
#   fresh  the round-1/2 validation streams (clean groups speech, vowels,
#          singing, clinical, exercises, children; the val mix cells +10 / 0 dB x
#          20 s lead / lead 0, round 1 and 2 pooled), the val negatives (vneg) and
#          the 194-clip tuning split
#   vsess  the round-3 one-room validation sessions (§2): clean sessions, CORRECT
#          hops per layer row x layer gender (a hop belongs to a layer when its
#          reference time td = t - 40 ms - L * hop - 30 ms lies in it, as
#          r3/seal.py counts); noisy sessions, CORRECT hops per SNR cell x session
#          gender; V2 = FALSE hops whose td lies in a noise-only stretch >= 10 s;
#          onsets (score.onsets) per session gender
#   spl    the round-2 spliced carried sessions (reported, not feasibility):
#          the fresh streams' keys on the spliced files
# Feasible (§3.3): fresh clean groups <= 0.5 % and fresh mix cells <= 1.5 %
# (worse gender), vsess clean rows <= 0.5 % and SNR cells <= 1.5 % (worse
# gender), frame + lookahead <= 100 ms, median onset delay (worse gender)
# <= 100 ms fresh and vsess; V4 (WASM cost) is checked per candidate outside.
# Objective O = min(tune194 V2, vneg V2, vsess V2). Within a candidate: the
# feasible point with the largest O; within 0.5 pp the shorter hangover.
#
#   python opselect_r3.py --cands=NET:rule[,NET:rule..] [--root=build/vad-train/r3/cand] [--json=OUT] [--no-spl]
#   python opselect_r3.py --selftest=DIR      (compare with score.py's functions on a candidate dir of fresh files)
import json
import os
import sys
import time

import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
MY = dict((a[2:].split("=", 1) + ["1"])[:2] for a in sys.argv[1:] if a.startswith("--"))
sys.argv = [sys.argv[0]]
sys.path.insert(0, os.path.join(HERE, ".."))
sys.path.insert(0, os.path.join(HERE, "..", "lib"))
import score as S  # noqa: E402
from streams import list_streams, load_dump  # noqa: E402

REPO = os.path.abspath(os.path.join(HERE, "../../.."))
VAL = os.path.join(REPO, "build", "vad-train", "val")
BENCH = os.path.join(REPO, "build", "vad")
VSESS = os.path.join(REPO, "build", "vad-train", "r3", "vsess")
CROOT = MY.get("root", os.path.join(REPO, "build", "vad-train", "r3", "cand"))
THR = [0.01, 0.02, 0.03, 0.05, 0.07, 0.1, 0.13, 0.16, 0.2, 0.25, 0.3, 0.35, 0.4, 0.45, 0.5, 0.55, 0.6, 0.65, 0.7, 0.75, 0.8, 0.85, 0.9, 0.95]
HANG = [0, 50, 100, 150, 200, 250, 300, 400, 500, 600, 750, 1000, 1250, 1500, 2000, 3000]
AGGS = ["last", "max", "mean"]
CLEAN_LIM, MIX_LIM, ONSET_LIM, TIE_PP = 0.5, 1.5, 100.0, 0.5
GROUPS = ["speech", "vowels", "singing", "clinical", "exercises", "children"]
GEN = ("f", "m", "unknown")
SPEC = {"hop_ms": 12.5, "first_avail_ms": 12.375, "frame_ms": 82.0, "lookahead_ms": 0, "p_before_first": 0.0, "name": "r3"}
HS = np.array(HANG) / 1000.0 + 1e-9
BIG = 1.0e6


# ---------------------------------------------------------------- the deployment rules
def rule_parse(rule):
    if rule == "plain":
        return ("plain", None)
    for k in ("mean", "old"):
        if rule.startswith(k):
            return (k, int(rule[len(k):]))
    raise ValueError(rule)


def combine(net_dir, sub, rel, rule):
    """Frame probabilities of one stream for a deployment rule (sub = '' fresh / vsess, '-spl' spliced)."""
    kind, T = rule_parse(rule)
    rd = lambda v: np.fromfile(os.path.join(net_dir, v + sub, rel + ".f32"), dtype="<f4").astype(np.float64)  # noqa: E731
    if kind == "plain":
        return rd("plain")
    a, b = rd(f"c{T}a"), rd(f"c{T}b")
    if kind == "mean":
        return 0.5 * (a + b)
    return np.where(_age_a(len(a), T) >= _age_b(len(a), T), a, b)


def _age_a(n, T):
    Tf = int(round(T * 80))
    i = np.arange(n)
    return i % (2 * Tf)                                  # copy a resets at 2T, 4T, ...


def _age_b(n, T):
    Tf = int(round(T * 80))
    i = np.arange(n)
    return np.where(i < Tf, i, (i - Tf) % (2 * Tf))      # copy b resets at T, 3T, ...


def combine_spl(net_dir, rel, rule, offset):
    """Spliced files: the copies' reset schedule runs from the SESSION start (frame offset of the stream in its session)."""
    kind, T = rule_parse(rule)
    rd = lambda v: np.fromfile(os.path.join(net_dir, v + "-spl", rel + ".f32"), dtype="<f4").astype(np.float64)  # noqa: E731
    if kind == "plain":
        return rd("plain")
    a, b = rd(f"c{T}a"), rd(f"c{T}b")
    if kind == "mean":
        return 0.5 * (a + b)
    n = len(a)
    Tf = int(round(T * 80))
    i = np.arange(n) + offset
    aa = i % (2 * Tf)
    ab = np.where(i < Tf, i, (i - Tf) % (2 * Tf))
    return np.where(aa >= ab, a, b)


# ---------------------------------------------------------------- vectorised score.py alignment
def hop_probs_fast(meta, P, agg):
    n, hop = meta["n"], meta["hop_s"]
    t = (np.arange(n) + 1) * hop
    fa, fh = SPEC["first_avail_ms"] / 1000.0, SPEC["hop_ms"] / 1000.0
    need = int(np.floor((t[-1] - fa) / fh + 1e-9)) + 1 if n else 0
    if len(P) < need:
        raise SystemExit(f"{meta['set']}/{meta['id']}: {len(P)} frames, the stream needs {need}")
    imax = np.minimum(np.floor((t - fa) / fh + 1e-9).astype(np.int64), len(P) - 1)
    have = imax >= 0
    p = np.full(n, 0.0)
    if agg == "last" or len(P) == 0:
        p[have] = P[imax[have]]
        return p
    prev = np.concatenate([[-1], imax[:-1]])
    a = np.maximum(prev + 1, 0)
    b = imax + 1
    single = have & (b <= a)
    p[single] = P[imax[single]]
    seg = have & (b > a)
    if seg.any():
        ks = np.nonzero(seg)[0]
        if agg == "mean":
            cs = np.concatenate([[0.0], np.cumsum(P, dtype=np.float64)])
            p[ks] = (cs[b[ks]] - cs[a[ks]]) / (b[ks] - a[ks])
        else:
            # contiguous segments [a_k, b_k): reduceat over the starts, array cut at the last end
            starts = a[ks]
            assert np.all(starts[1:] == b[ks][:-1]), "non-contiguous segments"
            p[ks] = np.maximum.reduceat(P[:b[ks][-1]], starts)
    return p


# ---------------------------------------------------------------- data (dumps, keys)
class Block:
    """All streams of one reading concatenated: global hop times (streams separated by BIG), key ids per hop."""

    def __init__(self, items):
        # items: list of dict(meta, rel, keys {name: (mask, key)}, onsets [(s, e, gender)])
        self.items = items
        self.keys = {}
        tg, st, base = [], [], 0
        for k, it in enumerate(items):
            n, hop = it["meta"]["n"], it["meta"]["hop_s"]
            tg.append((np.arange(n) + 1) * hop)          # stream-local hop times, exactly as score.py
            st.append(np.full(n, base, np.int64))
            it["base"] = base
            base += n
        self.t = np.concatenate(tg)
        self.start = np.concatenate(st)
        self.ar = np.arange(len(self.t))
        self.N = len(self.t)
        kid = np.full(self.N, -1, np.int64)
        for it in items:
            for mask, key in it["masks"]:
                j = self.keys.setdefault(key, len(self.keys))
                idx = it["base"] + np.nonzero(mask)[0]
                assert np.all(kid[idx] == -1), key
                kid[idx] = j
        self.kid = kid
        self.sel = np.nonzero(kid >= 0)[0]
        self.kid_sel = kid[self.sel]
        # onsets: (global start, end, gender index)
        ons, ohop = [], []
        for it in items:
            for s, e, g in it["onsets"]:
                ons.append((it["base"] + s, it["base"] + e, GEN.index(g)))
                ohop.append(it["meta"]["hop_s"] * 1000.0)
        self.on_hop = np.array(ohop)
        self.ons = np.array(ons, np.int64).reshape(-1, 3)
        if len(self.ons):
            L = self.ons[:, 1] - self.ons[:, 0] + 1
            self.on_idx = np.concatenate([np.arange(s, e + 1) for s, e, _ in self.ons])
            self.on_run = np.repeat(np.arange(len(self.ons)), L)
            self.on_paint = np.concatenate([it_paint for it_paint in self._paints()])
        self.hop_ms = items[0]["meta"]["hop_s"] * 1000 if items else 25.0

    def _paints(self):
        for it in self.items:
            for s, e, _ in it["onsets"]:
                yield it["paint"][s:e + 1]

    def evaluate(self, probs_by_agg):
        """probs_by_agg: agg -> concatenated per-hop probabilities. Returns {(agg, thr): (counts [nkeys, 2, nH], onset delays [nons, nH])}."""
        out = {}
        nK = len(self.keys)
        nH = len(HS)
        for agg, p in probs_by_agg.items():
            for thr in THR:
                on = p >= thr
                li = np.maximum.accumulate(np.where(on, self.ar, -1))
                ok = li >= self.start                          # an "on" hop of the same stream
                since = np.where(on, 0.0, np.where(ok, self.t - self.t[np.maximum(li, 0)], np.inf))
                # vetoed at hangover h  <=>  since > h ; bucket = number of hangovers < since
                bk = np.searchsorted(HS, since[self.sel], side="left")
                cnt = np.bincount(self.kid_sel * (nH + 1) + bk, minlength=nK * (nH + 1)).reshape(nK, nH + 1)
                tot = cnt.sum(1)
                vet = tot[:, None] - np.cumsum(cnt, 1)[:, :nH]          # since > H_h  <=> bucket > h
                ond = None
                if len(self.ons):
                    v = np.where(self.on_paint, since[self.on_idx], np.inf)
                    bv = np.searchsorted(HS, v, side="left").astype(np.int64)          # bucket: v > H_h <=> bv > h (monotone in v)
                    bo = np.minimum.accumulate(bv - self.on_run * 100) + self.on_run * 100   # exact segmented running min (integers)
                    c2 = np.bincount(self.on_run * (nH + 1) + bo, minlength=len(self.ons) * (nH + 1)).reshape(len(self.ons), nH + 1)
                    ond = (c2.sum(1)[:, None] - np.cumsum(c2, 1)[:, :nH]) * self.on_hop[:, None]     # delay = count of rm > H, in the stream's hops
                out[(agg, thr)] = (tot, vet, ond)
        return out


def fresh_items():
    items = []
    for root, sets in ((VAL, ["vvoice", "vmix20", "vmix0", "vneg"]), (BENCH, ["noise"])):
        for m in list_streams(root, sets):
            if m["set"] == "noise" and m.get("split") != "tune":
                continue
            c = load_dump(root, m)
            paint, lab = c["paint"] > 0, c["lab"].astype(np.int8)
            g = S.gnorm(m.get("gender"))
            s = m["set"]
            if s == "vvoice":
                k = ("clean", m["group"], g)
            elif s in ("vmix20", "vmix0"):
                k = ("mix", f"{s} {m['snr_db']:+d}", g)
            elif s == "vneg":
                k = ("vneg", "vneg", g)
            else:
                k = ("tune", "tune194", g)
            masks = [(paint & (lab == 1), k + ("corr",)), (paint & (lab == 2), k + ("false",))]
            ons = [(a, b, g) for a, b in S.onsets(c["paint"], lab)] if s in ("vvoice", "vmix20", "vmix0") else []
            items.append({"meta": m, "rel": f"{s}/{m['id']}", "masks": masks, "onsets": ons, "paint": paint})
    return items


def vsess_items():
    items = []
    for m in list_streams(VSESS, ["vsess"]):
        c = load_dump(VSESS, m)
        paint, lab = c["paint"] > 0, c["lab"].astype(np.int8)
        tk = (np.arange(m["n"]) + 1) * m["hop_s"]
        td = tk - 0.040 - m["L"] * m["hop_s"] - 0.030
        g = S.gnorm(m.get("gender"))
        masks = []
        corr = paint & (lab == 1)
        if m["kind"] == "clean":
            used = np.zeros(m["n"], bool)
            for L in m["layers"]:
                sel = corr & (td >= L["at"]) & (td <= L["at"] + L["len"]) & ~used
                used |= sel
                masks.append((sel, ("vs_clean", L["row"], S.gnorm(L["gender"]), "corr")))
        else:
            masks.append((corr, ("vs_mix", f"{m['snr_db']:+d}", g, "corr")))
            long_ = np.zeros(m["n"], bool)
            for a, b in m["stretches"]:
                if b - a >= 10.0:
                    long_ |= (td >= a) & (td < b)
            masks.append((paint & (lab == 2) & long_, ("vs_v2", "stretch10", m.get("bed_source", ""), "false")))
            masks.append((paint & (lab == 2) & ~long_, ("vs_short", "short", m.get("bed_source", ""), "false")))
        merged = {}
        for mk, key in masks:           # one key per hop: merge masks of the same key (several layers of one row)
            merged[key] = merged[key] | mk if key in merged else mk
        ons = [(a, b, g) for a, b in S.onsets(c["paint"], lab)]
        items.append({"meta": m, "rel": f"vsess/{m['id']}", "masks": [(v, k) for k, v in merged.items()], "onsets": ons, "paint": paint})
    return items


def spl_offsets():
    sj = json.load(open(os.path.join(REPO, "build", "vad-train", "cand", "r8ae-s8000-carried", "sessions.json"), encoding="utf8"))
    meta = {}
    for root, sets in ((VAL, ["vvoice", "vmix20", "vmix0", "vneg"]), (BENCH, ["noise"])):
        for m in list_streams(root, sets):
            meta[f"{m['set']}/{m['id']}"] = m
    off = {}
    for ss in sj["sessions"]:
        pos = 0
        for s in ss:
            a = meta[s]["audio"]
            n16 = int(np.ceil((a["len"] - 1) / (a["sr"] / 16000))) if a["sr"] != 16000 else a["len"]
            off[s] = pos // 200
            pos += n16 + ((-n16) % 200)
    return off


# ---------------------------------------------------------------- readings
def summarise(block, res, which):
    """Per grid point: the worst rows and V2 shares of one reading."""
    keys = {v: k for k, v in block.keys.items()}
    pts = {}
    for (agg, thr), (tot, vet, ond) in res.items():
        for hi, hang in enumerate(HANG):
            d = {}
            rows = {}
            for j, k in keys.items():
                rows[k] = (tot[j], vet[j, hi])
            if which in ("fresh", "spl"):
                wc, wm = 0.0, 0.0
                for grp in GROUPS:
                    vals = [100.0 * rows[k][1] / rows[k][0] for k in rows if k[0] == "clean" and k[1] == grp and k[3] == "corr" and rows[k][0]]
                    if vals:
                        d[f"clean {grp}"] = max(vals)
                        wc = max(wc, max(vals))
                for cell in ("vmix20 +10", "vmix20 +0", "vmix0 +10", "vmix0 +0"):
                    vals = [100.0 * rows[k][1] / rows[k][0] for k in rows if k[0] == "mix" and k[1] == cell and k[3] == "corr" and rows[k][0]]
                    if vals:
                        d[f"mix {cell}"] = max(vals)
                        wm = max(wm, max(vals))
                for nm in ("tune", "vneg"):
                    a = sum(rows[k][0] for k in rows if k[0] == nm and k[3] == "false")
                    v = sum(rows[k][1] for k in rows if k[0] == nm and k[3] == "false")
                    d[f"{nm}_v2"] = 100.0 * v / a if a else float("nan")
                d["worst_clean"], d["worst_mix"] = wc, wm
            else:
                wc, wm = 0.0, 0.0
                for grp in GROUPS:
                    vals = [100.0 * rows[k][1] / rows[k][0] for k in rows if k[0] == "vs_clean" and k[1] == grp and rows[k][0]]
                    if vals:
                        d[f"vs clean {grp}"] = max(vals)
                        wc = max(wc, max(vals))
                for cell in ("+10", "+0"):
                    vals = [100.0 * rows[k][1] / rows[k][0] for k in rows if k[0] == "vs_mix" and k[1] == cell and rows[k][0]]
                    if vals:
                        d[f"vs mix {cell}"] = max(vals)
                        wm = max(wm, max(vals))
                for nm in ("vs_v2", "vs_short"):
                    a = sum(rows[k][0] for k in rows if k[0] == nm)
                    v = sum(rows[k][1] for k in rows if k[0] == nm)
                    d[nm] = 100.0 * v / a if a else float("nan")
                for src in sorted({k[2] for k in rows if k[0] == "vs_v2"}):
                    a = sum(rows[k][0] for k in rows if k[0] == "vs_v2" and k[2] == src)
                    v = sum(rows[k][1] for k in rows if k[0] == "vs_v2" and k[2] == src)
                    d[f"vs_v2 {src}"] = 100.0 * v / a if a else float("nan")
                d["worst_clean"], d["worst_mix"] = wc, wm
            if ond is not None:
                med = {}
                for gi, g in enumerate(GEN):
                    sel = block.ons[:, 2] == gi
                    if sel.any():
                        med[g] = float(np.median(ond[sel, hi]))
                d["onset_median_worst"] = max(med.values())
            else:
                d["onset_median_worst"] = float("nan")
            pts[(agg, thr, hang)] = d
    return pts


def probs(block, net_dir, rule, sub, spl_off=None):
    out = {agg: np.empty(block.N) for agg in AGGS}
    for it in block.items:
        if sub == "-spl":
            P = combine_spl(net_dir, it["rel"], rule, spl_off[it["rel"]])
        else:
            P = combine(net_dir, "", it["rel"], rule)
        n = it["meta"]["n"]
        for agg in AGGS:
            out[agg][it["base"]:it["base"] + n] = hop_probs_fast(it["meta"], P, agg)
    return out


def score_candidate(blocks, net, rule, spl_off, do_spl=True):
    net_dir = os.path.join(CROOT, net)
    frame_ms = json.load(open(os.path.join(net_dir, "net.json")))["frame_ms"] if os.path.exists(os.path.join(net_dir, "net.json")) else 82.0
    rf = summarise(blocks["fresh"], blocks["fresh"].evaluate(probs(blocks["fresh"], net_dir, rule, "")), "fresh")
    rv = summarise(blocks["vsess"], blocks["vsess"].evaluate(probs(blocks["vsess"], net_dir, rule, "")), "vsess")
    rs = summarise(blocks["fresh"], blocks["fresh"].evaluate(probs(blocks["fresh"], net_dir, rule, "-spl", spl_off)), "spl") if do_spl else None
    grid = []
    for k in rf:
        f, v = rf[k], rv[k]
        O = min(f["tune_v2"], f["vneg_v2"], v["vs_v2"])
        feas = bool(f["worst_clean"] <= CLEAN_LIM and f["worst_mix"] <= MIX_LIM and f["onset_median_worst"] <= ONSET_LIM
                    and v["worst_clean"] <= CLEAN_LIM and v["worst_mix"] <= MIX_LIM and v["onset_median_worst"] <= ONSET_LIM and frame_ms <= 100)
        pt = {"agg": k[0], "thr": k[1], "hang": k[2], "O": O, "feasible": feas, "fresh": f, "vsess": v}
        if rs is not None:
            pt["spl"] = rs[k]
        grid.append(pt)
    return grid, frame_ms


def pick(grid):
    feas = [r for r in grid if r["feasible"]]
    if not feas:
        return None
    best = max(r["O"] for r in feas)
    near = [r for r in feas if r["O"] >= best - TIE_PP]
    hmin = min(r["hang"] for r in near)
    return max([r for r in near if r["hang"] == hmin], key=lambda r: (r["O"], r["fresh"]["vneg_v2"]))


def ratio(r):
    return max(r["fresh"]["worst_clean"] / CLEAN_LIM, r["fresh"]["worst_mix"] / MIX_LIM, r["vsess"]["worst_clean"] / CLEAN_LIM, r["vsess"]["worst_mix"] / MIX_LIM)


def build_blocks(need_spl=True):
    t0 = time.time()
    b = {"fresh": Block(fresh_items()), "vsess": Block(vsess_items())}
    print(f"blocks: fresh {b['fresh'].N} hops, {len(b['fresh'].items)} streams; vsess {b['vsess'].N} hops ({time.time() - t0:.0f} s)", file=sys.stderr, flush=True)
    return b, (spl_offsets() if need_spl else None)


def selftest(cdir):
    """The vectorised readings against score.py's functions on one candidate dir of fresh files (a few grid points)."""
    items = fresh_items()
    blk = Block(items)
    pr = {agg: np.empty(blk.N) for agg in AGGS}
    for it in items:
        P = np.fromfile(os.path.join(cdir, it["rel"] + ".f32"), dtype="<f4").astype(np.float64)
        for agg in AGGS:
            pr[agg][it["base"]:it["base"] + it["meta"]["n"]] = hop_probs_fast(it["meta"], P, agg)
            if it["base"] % 97 == 0:
                ref = S.hop_probs(dict(SPEC, agg=agg, threshold=0.5, hangover_ms=0), it["meta"], P)
                assert np.array_equal(ref, pr[agg][it["base"]:it["base"] + it["meta"]["n"]]), (agg, it["rel"])
    res = blk.evaluate(pr)
    keys = {v: k for k, v in blk.keys.items()}
    bad = 0
    for agg, thr, hi in (("last", 0.03, 12), ("mean", 0.3, 15), ("max", 0.1, 4)):
        tot, vet, ond = res[(agg, thr)]
        spec = dict(SPEC, agg=agg, threshold=thr, hangover_ms=HANG[hi])
        ref = {}
        for it in items:
            P = np.fromfile(os.path.join(cdir, it["rel"] + ".f32"), dtype="<f4").astype(np.float64)
            v = S.voice_flags(spec, it["meta"], S.hop_probs(spec, it["meta"], P))
            for mk, key in it["masks"]:
                a = ref.setdefault(key, [0, 0])
                a[0] += int(mk.sum())
                a[1] += int((mk & ~v).sum())
        for j, k in keys.items():
            if ref[k][0] != tot[j] or ref[k][1] != vet[j, hi]:
                bad += 1
                print("MISMATCH", agg, thr, HANG[hi], k, ref[k], tot[j], vet[j, hi])
    print(f"selftest: {bad} mismatches")


def main():
    if "selftest" in MY:
        return selftest(MY["selftest"])
    cands = [c.split(":") for c in MY["cands"].split(",")]
    do_spl = "no-spl" not in MY
    blocks, spl_off = build_blocks(do_spl)
    out = {}
    if MY.get("json") and os.path.exists(MY["json"]):
        out = json.load(open(MY["json"], encoding="utf8"))
    for net, rule in cands:
        name = f"{net}:{rule}"
        if name in out and "force" not in MY:
            continue
        t0 = time.time()
        grid, frame_ms = score_candidate(blocks, net, rule, spl_off, do_spl)
        best = pick(grid)
        fb = None if best else min(grid, key=ratio)
        out[name] = {"net": net, "rule": rule, "copies": 1 if rule == "plain" else 2, "frame_ms": frame_ms, "best": best, "fallback": fb,
                     "grid": [{k: v for k, v in g.items()} for g in grid]}
        r = best or fb
        print(f"{name}: {'PICK' if best else 'NO feasible point; fallback'} {r['agg']} p>={r['thr']} {r['hang']} ms -> O {r['O']:.2f} "
              f"(tune {r['fresh']['tune_v2']:.2f}, vneg {r['fresh']['vneg_v2']:.2f}, vsess {r['vsess']['vs_v2']:.2f}); "
              f"fresh worst {r['fresh']['worst_clean']:.2f}/{r['fresh']['worst_mix']:.2f}, vsess worst {r['vsess']['worst_clean']:.2f}/{r['vsess']['worst_mix']:.2f}"
              + (f", spl worst {r['spl']['worst_clean']:.2f}/{r['spl']['worst_mix']:.2f} tune {r['spl']['tune_v2']:.2f}" if "spl" in r else "")
              + f" [{time.time() - t0:.0f} s]", flush=True)
        if MY.get("json"):
            tmp = MY["json"] + ".tmp"
            json.dump(out, open(tmp, "w", encoding="utf8"))
            os.replace(tmp, MY["json"])


if __name__ == "__main__":
    main()
