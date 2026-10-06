# score.py — voice-detector benchmark (2026-10-06): score candidate detectors
# against the PRE-REGISTERED viability bar V1-V4 (fixed before any candidate
# was run; README "Viability bar"). Reads the production-chain dumps
# (dump.mjs: what the CURRENT app paints per 25 ms hop, and whether it is
# CORRECT / FALSE) and each candidate's probability files (README
# "Candidate interface"), aligns them to the painted hops, applies the
# candidate's own threshold + hangover, and counts vetoes.
#
#   python scripts/voice-detector/score.py CAND [CAND ...] [--root=build/vad]
#          [--json=PATH] [--allow-missing] [--worst=10]
# CAND = a candidate directory, or a name under <root>/cand/.
#
# Alignment (no peeking past what the candidate declared): hop k is painted
# at hop time t_k = (k + 1) * hop_s of stream time. Candidate frame i is
# available at first_avail_ms + i * hop_ms. The decision for hop k uses only
# frames available by t_k + lookahead_ms (agg "last": the latest one; "max" /
# "mean": the frames that became available since hop k - 1, else the latest).
# Voice at hop k: p_k >= threshold, or a hop with p >= threshold within the
# last hangover_ms (hop time). A painted hop that is not voice is VETOED.
import glob
import json
import math
import os
import sys

import numpy as np

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "lib"))
from streams import list_streams, load_dump  # noqa: E402

A = dict((a[2:].split("=", 1) + ["1"])[:2] for a in sys.argv[1:] if a.startswith("--"))
CANDS = [a for a in sys.argv[1:] if not a.startswith("--")]
ROOT = A.get("root", "build/vad")
WORST = int(A.get("worst", "10"))

# ---- the pre-registered bar (2026-10-06; do not edit after seeing numbers) ----
V1_SETS = [  # (row, sets) — each row must keep <= 1 % in its worse gender
    ("FDA speech", ["fda"]), ("PTDB-TUG speech", ["ptdb"]), ("vocadito singing", ["voc"]),
    ("VocalSet long tones (held notes)", ["vocalset"]), ("PVQD + VOICED sustained vowels", ["pvqd", "voiced"]),
    ("Hillenbrand vowels", ["hil"]),
]
V1_LIMIT = 1.0
V1_MIX = [("vin20", 10), ("vin20", 0), ("vin0", 10), ("vin0", 0)]  # <= 3 % in the worse gender, each cell
V1_MIX_LIMIT = 3.0
V2_ALL_LIMIT = 60.0   # % of the falsely painted hops on the 279 clips (pooled hops)
V2_HELD_LIMIT = 50.0  # each held-out noise set: the in-set held-out split (85) and the second set (119)
V3_MS = 100.0         # frame_ms + lookahead_ms; median onset delay (worse gender, pooled voice onsets)
V4_BYTES = 5_000_000
V4_CPU_MS = 2.0
V4_LICENSES = {"MIT", "BSD-2-Clause", "BSD-3-Clause", "Apache-2.0"}
V4_RUNTIMES = {"onnxruntime-web-wasm", "js", "wasm"}
MACHINE_ROOMS = ["hvac", "mains_hum", "microwave", "refrigerator", "generator"]
ONSET_GAP = 8     # hops (200 ms) with nothing painted before a trace onset
ONSET_LOOK = 4    # at least 2 of the run's first 4 hops CORRECT = a voice onset
REQUIRED = ["hop_ms", "first_avail_ms", "frame_ms", "lookahead_ms", "threshold", "hangover_ms"]


def load_cand(c):
    d = c if os.path.isdir(c) else os.path.join(ROOT, "cand", c)
    with open(os.path.join(d, "candidate.json"), encoding="utf8") as f:
        spec = json.load(f)
    miss = [k for k in REQUIRED if k not in spec]
    if miss:
        raise SystemExit(f"{d}/candidate.json lacks {miss}")
    spec.setdefault("agg", "last")
    spec.setdefault("p_before_first", 0.0)
    spec.setdefault("name", os.path.basename(os.path.normpath(d)))
    if spec["agg"] not in ("last", "max", "mean"):
        raise SystemExit(f"{d}: agg must be last | max | mean")
    if spec["hop_ms"] <= 0:
        raise SystemExit(f"{d}: hop_ms must be > 0")
    spec["_dir"] = d
    return spec


def hop_probs(spec, meta, P):
    """Per-hop probability for this stream's painted hops (causal alignment)."""
    n, hop = meta["n"], meta["hop_s"]
    t = (np.arange(n) + 1) * hop
    fa, fh = spec["first_avail_ms"] / 1000.0, spec["hop_ms"] / 1000.0
    # the file must hold every frame available by the last hop time (frames
    # that would need audio past the stream end cannot exist: with a
    # lookahead the last hops use the last frame)
    need = int(np.floor((t[-1] - fa) / fh + 1e-9)) + 1 if n else 0
    if len(P) < need:
        raise SystemExit(f"{spec['name']} {meta['set']}/{meta['id']}: {len(P)} frames, the stream needs {need}")
    lim = t + spec["lookahead_ms"] / 1000.0
    imax = np.floor((lim - fa) / fh + 1e-9).astype(np.int64)
    imax = np.minimum(imax, len(P) - 1)
    have = imax >= 0
    p = np.full(n, float(spec["p_before_first"]))
    if spec["agg"] == "last" or len(P) == 0:
        p[have] = P[imax[have]]
        return p
    prev = np.concatenate([[-1], imax[:-1]])
    cs = np.concatenate([[0.0], np.cumsum(P, dtype=np.float64)])
    for k in np.nonzero(have)[0]:
        a, b = max(prev[k] + 1, 0), imax[k] + 1
        if b <= a:
            p[k] = P[imax[k]]
        elif spec["agg"] == "max":
            p[k] = P[a:b].max()
        else:
            p[k] = (cs[b] - cs[a]) / (b - a)
    return p


def voice_flags(spec, meta, p):
    n, hop = meta["n"], meta["hop_s"]
    t = (np.arange(n) + 1) * hop
    on = p >= spec["threshold"]
    last = np.maximum.accumulate(np.where(on, t, -np.inf))
    return on | (t - last <= spec["hangover_ms"] / 1000.0 + 1e-9)


def onsets(paint, lab):
    """(onset hop, run end hop) of every voice onset of the painted trace."""
    painted = paint > 0
    n = len(painted)
    idx = np.nonzero(painted)[0]
    out = []
    if not len(idx):
        return out
    # runs separated by >= ONSET_GAP unpainted hops
    gaps = np.diff(idx) > ONSET_GAP
    starts = np.concatenate([[idx[0]], idx[1:][gaps]])
    ends = np.concatenate([idx[:-1][gaps], [idx[-1]]])
    for s, e in zip(starts, ends):
        if (lab[s:s + ONSET_LOOK] == 1).sum() >= 2:
            out.append((int(s), int(e)))
    return out


def gnorm(g):
    return g if g in ("f", "m") else "unknown"


def stream_rows(spec):
    rows = []
    missing = []
    for meta in list_streams(ROOT):
        cols = load_dump(ROOT, meta)
        paint, lab = cols["paint"], cols["lab"].astype(np.int8)
        n = meta["n"]
        if spec is None:
            veto = np.zeros(n, bool)
        else:
            fp = os.path.join(spec["_dir"], meta["set"], meta["id"] + ".f32")
            if not os.path.exists(fp):
                missing.append(f"{meta['set']}/{meta['id']}")
                continue
            P = np.fromfile(fp, dtype="<f4").astype(np.float64)
            v = voice_flags(spec, meta, hop_probs(spec, meta, P))
            veto = (paint > 0) & ~v
        r = {"set": meta["set"], "id": meta["id"], "gender": gnorm(meta.get("gender")), "n": n,
             "snr": meta.get("snr_db"), "split": meta.get("split"), "label": meta.get("label"), "cls": meta.get("cls"),
             "source": meta.get("source"), "noise_class": meta.get("noise_class"), "painted": int((paint > 0).sum()),
             "nd": max(int(np.isfinite(cols["inten"]).sum()), 1),  # attr.py display hops (finite intensity)
             "hop_ms": meta["hop_s"] * 1000}
        for nm, code in (("correct", 1), ("false", 2), ("wrong", 3), ("edge", 4)):
            m = lab == code
            r[nm] = int(m.sum())
            r[nm + "_v"] = int((m & veto).sum())
        fin = (lab == 2) & np.isfinite(cols["inten"])  # the legacy clip-mean metric's painted FV (attr.py)
        r["false_fin"], r["false_fin_v"] = int(fin.sum()), int((fin & veto).sum())
        hc = (lab == 1) & (cols["held"] > 0)
        r["held_correct"], r["held_correct_v"] = int(hc.sum()), int((hc & veto).sum())
        seg = cols["seg"].astype(np.int8)
        for nm, code in (("lead", 1), ("prog", 2), ("tail", 3)):
            m = (lab == 2) & (seg == code)
            r[nm + "_false"], r[nm + "_false_v"] = int(m.sum()), int((m & veto).sum())
        ons = []
        for s, e in onsets(paint, lab):
            ok = np.nonzero((paint[s:e + 1] > 0) & ~veto[s:e + 1])[0]
            ons.append((int(ok[0]) if len(ok) else e - s + 1, not len(ok)))
        r["onsets"] = ons
        rows.append(r)
    return rows, missing


def pct(a, b):
    return 100.0 * a / b if b else float("nan")


def f2(x):
    return "—" if x is None or (isinstance(x, float) and math.isnan(x)) else f"{x:.2f}"


def agg(rows, key):
    a = sum(r[key] for r in rows)
    v = sum(r[key + "_v"] for r in rows)
    return a, v


def by_gender(rows, key):
    out = {}
    for g in ("f", "m", "unknown"):
        rr = [r for r in rows if r["gender"] == g]
        a, v = agg(rr, key)
        if a:
            out[g] = (a, v, pct(v, a))
    return out


def worse(bg):
    return max(bg.items(), key=lambda kv: kv[1][2]) if bg else (None, (0, 0, float("nan")))


def onset_stats(rows, lookahead_ms):
    d = []
    for r in rows:
        for hops, cens in r["onsets"]:
            d.append((hops * r["hop_ms"] + lookahead_ms, cens))
    if not d:
        return None
    ms = np.array([x for x, _ in d])
    return {"n": len(d), "median": float(np.median(ms)), "p75": float(np.percentile(ms, 75)), "p90": float(np.percentile(ms, 90)),
            "over100": pct(int((ms > V3_MS).sum()), len(d)), "never": pct(sum(1 for _, c in d if c), len(d))}


def report(spec, rows, base):
    name = spec["name"] if spec else "(no candidate)"
    L = []
    P = L.append
    look = spec["lookahead_ms"] if spec else 0.0
    res = {"name": name, "spec": {k: v for k, v in (spec or {}).items() if not k.startswith("_")}}
    P(f"## {name}\n")
    if spec:
        P(f"frame {spec['frame_ms']} ms, hop {spec['hop_ms']} ms, first available {spec['first_avail_ms']} ms, "
          f"lookahead {spec['lookahead_ms']} ms, threshold {spec['threshold']}, hangover {spec['hangover_ms']} ms, agg {spec['agg']}\n")
    verdict = {}
    # ---- V1 ----
    P("### V1 voice kept: % of CORRECTLY painted hops vetoed (limit 1 % clean sets, 3 % voice in noise; worse gender)\n")
    P("| set | correct hops (f / m / unknown) | vetoed % f | m | unknown | worse | verdict |")
    P("|---|---|---|---|---|---|---|")
    v1 = {}
    ok1 = True
    for row, sets in V1_SETS:
        rr = [r for r in rows if r["set"] in sets]
        bg = by_gender(rr, "correct")
        g, (a, v, p) = worse(bg)
        passed = bool(bg) and p <= V1_LIMIT
        ok1 &= passed
        v1[row] = {"by_gender": bg, "worse": g, "worse_pct": p, "pass": passed}
        cells = [f2(bg[x][2]) if x in bg else "—" for x in ("f", "m", "unknown")]
        cnt = " / ".join(str(bg[x][0]) if x in bg else "0" for x in ("f", "m", "unknown"))
        P(f"| {row} | {cnt} | {' | '.join(cells)} | {g} {f2(p)} | {'pass' if passed else 'FAIL'} |")
    for s, snr in V1_MIX:
        rr = [r for r in rows if r["set"] == s and r["snr"] == snr]
        bg = by_gender(rr, "correct")
        g, (a, v, p) = worse(bg)
        passed = bool(bg) and p <= V1_MIX_LIMIT
        ok1 &= passed
        row = f"voice in noise {'+' if snr > 0 else ''}{snr} dB, lead {'20 s' if s == 'vin20' else '0'}"
        v1[row] = {"by_gender": bg, "worse": g, "worse_pct": p, "pass": passed}
        cells = [f2(bg[x][2]) if x in bg else "—" for x in ("f", "m", "unknown")]
        cnt = " / ".join(str(bg[x][0]) if x in bg else "0" for x in ("f", "m", "unknown"))
        P(f"| {row} | {cnt} | {' | '.join(cells)} | {g} {f2(p)} | {'pass' if passed else 'FAIL'} |")
    rr = [r for r in rows if r["set"] == "vocalset"]
    a, v = agg(rr, "held_correct")
    P(f"\nInfo: VocalSet correct hops inside held segments: {a}, vetoed {f2(pct(v, a))} %. "
      f"PVQD alone (gender unknown): {f2(pct(*agg([r for r in rows if r['set'] == 'pvqd'], 'correct')[::-1]))} %; "
      f"VOICED alone, worse gender: {f2(worse(by_gender([r for r in rows if r['set'] == 'voiced'], 'correct'))[1][2])} %.\n")
    verdict["V1"] = ok1
    res["V1"] = v1
    # ---- V2 ----
    P("### V2 noise removed: % of FALSELY painted hops vetoed on noise-only audio (limit 60 % on the 279, 50 % each held-out set)\n")
    P("| set | clips | painted false hops | vetoed % (pooled hops) | clip-mean painted % before → after (relative) | verdict |")
    P("|---|---|---|---|---|---|")
    v2 = {}

    def v2row(label, rr, limit=None):
        a, v = agg(rr, "false")
        p = pct(v, a)
        # clip mean, the legacy metric of attr.py (23.9 %): hops with a finite intensity
        fb = np.mean([r["false_fin"] / r["nd"] for r in rr]) * 100 if rr else float("nan")
        fa = np.mean([(r["false_fin"] - r["false_fin_v"]) / r["nd"] for r in rr]) * 100 if rr else float("nan")
        rel = (fa / fb - 1) * 100 if fb else float("nan")
        passed = None if limit is None else (bool(rr) and p >= limit)
        v2[label] = {"clips": len(rr), "false": a, "vetoed": v, "pct": p, "clipmean_before": fb, "clipmean_after": fa, "pass": passed}
        vd = "" if passed is None else ("pass" if passed else "FAIL")
        P(f"| {label} | {len(rr)} | {a} | {f2(p)} | {f2(fb)} → {f2(fa)} ({f2(rel)} %) | {vd} |")
        return passed

    nz = [r for r in rows if r["set"] == "noise"]
    ho = [r for r in rows if r["set"] == "noiseho"]
    ok2 = v2row("all 279 (tuning)", nz, V2_ALL_LIMIT)
    v2row("… tuning split 194", [r for r in nz if r["split"] == "tune"])
    ok2 &= v2row("held-out A: in-set split 85", [r for r in nz if r["split"] == "held"], V2_HELD_LIMIT)
    ok2 &= v2row("held-out B: second set 119", ho, V2_HELD_LIMIT)
    for s in ("dcaseeval", "fsheld"):
        v2row(f"… held-out B {s}", [r for r in ho if r["source"] == s])
    P("\nPer noise class (279; census label):\n")
    P("| class | clips | painted false hops | vetoed % | clip-mean before → after | |")
    P("|---|---|---|---|---|---|")
    for c in ("stationary-tonal", "intermittent-tonal", "mixed", "broadband"):
        v2row(f"{c}", [r for r in nz if r["label"] == c])
    P("\nWorst machine rooms (source class):\n")
    P("| room | clips | painted false hops | vetoed % | clip-mean before → after | |")
    P("|---|---|---|---|---|---|")
    for c in MACHINE_ROOMS:
        v2row(f"{c} (279)", [r for r in nz if r["cls"] == c])
        if any(r["cls"] == c for r in ho):
            v2row(f"{c} (held-out B)", [r for r in ho if r["cls"] == c])
    verdict["V2"] = bool(ok2)
    res["V2"] = v2
    P("\nInfo, false painting next to voice (vetoed % of falsely painted hops):\n")
    P("| where | false hops | vetoed % |")
    P("|---|---|---|")
    info = {}
    for s in ("vin20", "vin0"):
        for snr in (10, 0):
            rr = [r for r in rows if r["set"] == s and r["snr"] == snr]
            for seg in ("lead", "prog", "tail"):
                if s == "vin0" and seg == "lead":
                    continue
                a, v = agg(rr, seg + "_false")
                nm = {"lead": "noise-only lead", "prog": "gaps between phrases", "tail": "tail after the voice"}[seg]
                info[f"{s} {snr} {seg}"] = (a, v, pct(v, a))
                P(f"| {s} {'+' if snr else ''}{snr} dB, {nm} | {a} | {f2(pct(v, a))} |")
    vs = [r for r in rows if r["set"] in ("fda", "ptdb", "voc", "hil", "vocalset", "pvqd", "voiced")]
    a, v = agg(vs, "false")
    P(f"| clean voice sets, painted outside every voiced reference span (±100 ms) | {a} | {f2(pct(v, a))} |")
    a, v = agg(rows, "wrong")
    P(f"| (all sets) painted at a WRONG pitch on voiced reference — not scored | {a} | {f2(pct(v, a))} |")
    res["info"] = info
    # ---- V3 ----
    P("\n### V3 timing\n")
    if spec:
        lat = spec["frame_ms"] + spec["lookahead_ms"]
        ok3a = lat <= V3_MS
        P(f"- decision latency (declared frame {spec['frame_ms']} + lookahead {spec['lookahead_ms']} ms) = {lat} ms: {'pass' if ok3a else 'FAIL'} (limit {V3_MS:.0f} ms)")
    else:
        ok3a = True
    P("- voice-onset delay (trace onsets of the current app with >= 2 of their first 4 hops CORRECT, after >= 200 ms with nothing painted; "
      "delay = first un-vetoed painted hop - onset, censored at the run's end, + lookahead):\n")
    P("| set | onsets | median ms | p75 | p90 | > 100 ms % | never shown % |")
    P("|---|---|---|---|---|---|---|")
    v3 = {}
    vsets = [s for _, ss in V1_SETS for s in ss]
    for s in vsets + ["vin20", "vin0"]:
        st = onset_stats([r for r in rows if r["set"] == s], look)
        v3[s] = st
        if st:
            P(f"| {s} | {st['n']} | {f2(st['median'])} | {f2(st['p75'])} | {f2(st['p90'])} | {f2(st['over100'])} | {f2(st['never'])} |")
    allv = [r for r in rows if r["set"] in vsets + ["vin20", "vin0"]]
    gm = {}
    for g in ("f", "m", "unknown"):
        st = onset_stats([r for r in allv if r["gender"] == g], look)
        if st:
            gm[g] = st
            P(f"| all voice sets, {g} | {st['n']} | {f2(st['median'])} | {f2(st['p75'])} | {f2(st['p90'])} | {f2(st['over100'])} | {f2(st['never'])} |")
    wg = max(gm.items(), key=lambda kv: kv[1]["median"]) if gm else (None, {"median": float("nan")})
    ok3b = bool(gm) and wg[1]["median"] <= V3_MS
    P(f"\n- median onset delay, worse gender ({wg[0]}): {f2(wg[1]['median'])} ms: {'pass' if ok3b else 'FAIL'}")
    verdict["V3"] = ok3a and ok3b
    res["V3"] = {"by_set": v3, "by_gender": gm, "latency_ok": ok3a, "onset_ok": ok3b}
    # ---- V4 ----
    P("\n### V4 deployability (declared by the candidate runner; the harness checks the numbers against the bar)\n")
    d4 = (spec or {}).get("v4", {})
    lic, mb, rt, cpu = d4.get("license"), d4.get("model_bytes"), d4.get("runtime"), d4.get("wasm_ms_per_25ms")
    c_lic = lic in V4_LICENSES and bool(d4.get("license_text_checked"))
    c_mb = isinstance(mb, (int, float)) and mb <= V4_BYTES
    c_rt = rt in V4_RUNTIMES
    c_cpu = isinstance(cpu, (int, float)) and cpu <= V4_CPU_MS
    P(f"- licence: {lic} (text checked: {bool(d4.get('license_text_checked'))}; file {d4.get('license_file')}): {'pass' if c_lic else 'FAIL / unverified'}")
    P(f"- model size: {mb} bytes (limit {V4_BYTES}): {'pass' if c_mb else 'FAIL / unverified'}")
    P(f"- runtime: {rt}: {'pass' if c_rt else 'FAIL / unverified'}")
    P(f"- desktop CPU, WASM backend: {cpu} ms per 25 ms (limit {V4_CPU_MS}; measured on {d4.get('wasm_measured_on')}): {'pass' if c_cpu else 'FAIL / unverified'}")
    verdict["V4"] = c_lic and c_mb and c_rt and c_cpu
    res["V4"] = {"license": c_lic, "bytes": c_mb, "runtime": c_rt, "cpu": c_cpu}
    P(f"\n**Verdict: V1 {'pass' if verdict['V1'] else 'FAIL'} · V2 {'pass' if verdict['V2'] else 'FAIL'} · "
      f"V3 {'pass' if verdict['V3'] else 'FAIL'} · V4 {'pass' if verdict['V4'] else 'FAIL / unverified'}**\n")
    res["verdict"] = verdict
    # ---- worst streams ----
    if WORST and spec:
        P(f"Worst voice streams (share of CORRECT hops vetoed, >= 20 correct hops), top {WORST}:\n")
        ws = sorted([r for r in rows if r["correct"] >= 20], key=lambda r: -r["correct_v"] / r["correct"])[:WORST]
        for r in ws:
            P(f"- {r['set']}/{r['id']} ({r['gender']}{', ' + str(r['snr']) + ' dB' if r['snr'] is not None else ''}): {r['correct_v']} / {r['correct']} = {f2(pct(r['correct_v'], r['correct']))} %")
        P(f"\nLeast-removed noise clips (>= 40 false hops), top {WORST}:\n")
        ws = sorted([r for r in rows if r["set"] in ("noise", "noiseho") and r["false"] >= 40], key=lambda r: r["false_v"] / r["false"])[:WORST]
        for r in ws:
            P(f"- {r['set']}/{r['id']} ({r['cls']}): {r['false_v']} / {r['false']} = {f2(pct(r['false_v'], r['false']))} %")
        P("")
    return "\n".join(L), res


def baseline_table(rows):
    L = ["## Current app, painted hops per set (candidate-independent)\n",
         "| set | streams | hops | painted | CORRECT | FALSE | WRONG | EDGE | correct f / m / unknown | voice onsets |",
         "|---|---|---|---|---|---|---|---|---|---|"]
    out = {}
    order = ["noise", "noiseho", "vin20", "vin0", "fda", "ptdb", "voc", "hil", "vocalset", "pvqd", "voiced"]
    for s in order:
        for snr in ((10, 0) if s.startswith("vin") else (None,)):
            rr = [r for r in rows if r["set"] == s and (snr is None or r["snr"] == snr)]
            if not rr:
                continue
            key = s if snr is None else f"{s} {'+' if snr else ''}{snr} dB"
            c = {k: sum(r[k] for r in rr) for k in ("n", "painted", "correct", "false", "wrong", "edge")}
            bg = by_gender(rr, "correct")
            c["onsets"] = sum(len(r["onsets"]) for r in rr)
            c["streams"] = len(rr)
            c["correct_by_gender"] = {g: v[0] for g, v in bg.items()}
            out[key] = c
            gs = " / ".join(str(bg[g][0]) if g in bg else "0" for g in ("f", "m", "unknown"))
            L.append(f"| {key} | {len(rr)} | {c['n']} | {c['painted']} | {c['correct']} | {c['false']} | {c['wrong']} | {c['edge']} | {gs} | {c['onsets']} |")
    return "\n".join(L) + "\n", out


def main():
    sys.stdout.reconfigure(encoding="utf-8")
    base_rows, _ = stream_rows(None)
    if not base_rows:
        raise SystemExit(f"no dumps under {ROOT}/dumps (run dump.mjs first)")
    txt, base = baseline_table(base_rows)
    print(txt)
    out = {"baseline": base, "candidates": {}}
    for c in CANDS:
        spec = load_cand(c)
        rows, missing = stream_rows(spec)
        if missing and "allow-missing" not in A:
            raise SystemExit(f"{spec['name']}: {len(missing)} streams have no probability file (first: {missing[:3]}); --allow-missing scores the rest")
        if missing:
            print(f"> {spec['name']}: {len(missing)} streams missing, scored without them\n")
        t, r = report(spec, rows, base)
        r["missing"] = len(missing)
        print(t)
        out["candidates"][spec["name"]] = r
    if A.get("json"):
        with open(A["json"], "w", encoding="utf8") as f:
            json.dump(out, f, indent=1, default=lambda o: o if not isinstance(o, np.generic) else o.item())


if __name__ == "__main__":
    main()
