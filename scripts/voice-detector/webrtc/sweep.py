# sweep.py — WebRTC VAD candidate, step 2 (voice-detector benchmark,
# 2026-10-06): turn the cached per-frame WebRTC VAD decisions (run_py.py)
# into operating points, score every one of them against the dumps with the
# harness's own alignment (score.py hop_probs / voice_flags semantics, re-
# implemented vectorised and checked against score.py on the emitted
# candidates), pick ONE by the pre-registered rule, and emit probability
# files + candidate.json for score.py.
#
#   python scripts/voice-detector/webrtc/sweep.py [--root=build/vad] [--out=build/vad/webrtc]
#          [--emit] [--v4=build/vad/webrtc/wasm-check.json]
#
# Operating-point grid (all causal, lookahead 0, frame + lookahead <= 100 ms):
#   mode 0..3 (aggressiveness) x native frame 10 / 20 / 30 ms x
#   decision family:
#     last  p = the latest frame's decision                (frame_ms = F)
#     max   p = 1 if any frame since the previous hop says speech (agg max)
#     wWkK  p = share of speech decisions over the last w frames (W = w F ms),
#           voice when >= K of the w (threshold (K - 0.5) / w; frame_ms = W)
#   x hangover 0 .. 3000 ms (25 ms steps to 200, 50 ms steps to 2000, then
#   2500 / 3000; stay voice this long after the last voice hop).
# Frame i of length F is available at (i + 1) F + 1 ms (1 ms: the 16 kHz
# resampler's half-length; run_py.py).
#
# Selection (pre-registered rule: best V2 among the points meeting V1 on the
# tuning sets, never picked on held-out data):
#   feasible = every clean voice row (FDA, PTDB-TUG, vocadito, VocalSet,
#              PVQD + VOICED, Hillenbrand) <= 1 % vetoed in its worse gender
#              AND every voice-in-noise cell <= 3 % in its worse gender,
#              counted on the mixes built from TUNING-split noise only;
#   best     = the most falsely painted hops vetoed on the 194-clip tuning
#              split of the 279 (the 85-clip in-set held-out split and the
#              119-clip second set are never looked at for the choice);
#   ties     -> lower worst V1 row, then shorter hangover.
# The looser readings (all mixes for V1; all 279 for V2) are reported next
# to it. Trade-off: the best tuning V2 when every V1 row may veto up to 2 % /
# 5 % (mix cells at max(3, X) %, and at X %).
import json
import math
import os
import sys
import time

import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, "..", "lib"))
sys.path.insert(0, os.path.join(HERE, ".."))
from streams import list_streams, load_dump  # noqa: E402

_argv = sys.argv
sys.argv = [_argv[0]]
import score as SC  # noqa: E402  (the harness's bar constants + onset definition)
sys.argv = _argv

A = dict((a[2:].split("=", 1) + ["1"])[:2] for a in sys.argv[1:] if a.startswith("--"))
ROOT = A.get("root", "build/vad")
OUT = A.get("out", os.path.join(ROOT, "webrtc"))
MARGIN_MS = 1.0
HS = np.array([0, 25, 50, 75, 100, 125, 150, 175] + list(range(200, 2001, 50)) + [2500, 3000], float)
HTHR = HS / 1000.0 + 1e-9
WINS = {10: (30, 50, 100), 20: (40, 60, 100), 30: (60, 90)}
VOICE_ROW = {s: row for row, ss in SC.V1_SETS for s in ss}


def dets():
    out = []
    for mode in (0, 1, 2, 3):
        for fl in (10, 20, 30):
            out.append({"mode": mode, "fl": fl, "fam": "last", "w": 1, "k": 1})
            out.append({"mode": mode, "fl": fl, "fam": "max", "w": 1, "k": 1})
            for W in WINS[fl]:
                w = W // fl
                for k in range(1, w + 1):
                    out.append({"mode": mode, "fl": fl, "fam": "win", "w": w, "k": k})
    for d in out:
        d["key"] = f"m{d['mode']}-f{d['fl']}-" + (d["fam"] if d["fam"] != "win" else f"w{d['w'] * d['fl']}k{d['k']}")
        d["frame_ms"] = d["fl"] * d["w"]
    return out


DETS = dets()


def frame_probs(d, dec):
    """Per-frame probability written to the .f32 file for detector d."""
    x = dec.astype(np.float64)
    if d["fam"] in ("last", "max"):
        return x
    cs = np.concatenate([[0.0], np.cumsum(x)])
    i = np.arange(len(x))
    lo = np.maximum(i + 1 - d["w"], 0)
    return (cs[i + 1] - cs[lo]) / d["w"]


def spec_of(d, H):
    return {
        "hop_ms": d["fl"], "first_avail_ms": d["fl"] + MARGIN_MS, "frame_ms": d["frame_ms"], "lookahead_ms": 0,
        "threshold": 0.5 if d["fam"] != "win" else (d["k"] - 0.5) / d["w"], "hangover_ms": float(H),
        "agg": "max" if d["fam"] == "max" else "last", "p_before_first": 0.0,
    }


def hop_on(d, meta, P):
    """Boolean voice-before-hangover per hop: score.py hop_probs + threshold, vectorised."""
    spec = spec_of(d, 0)
    n, hop = meta["n"], meta["hop_s"]
    t = (np.arange(n) + 1) * hop
    fa, fh = spec["first_avail_ms"] / 1000.0, spec["hop_ms"] / 1000.0
    need = int(np.floor((t[-1] - fa) / fh + 1e-9)) + 1 if n else 0
    if len(P) < need:
        raise SystemExit(f"{meta['set']}/{meta['id']}: {len(P)} frames < {need}")
    imax = np.floor((t + spec["lookahead_ms"] / 1000.0 - fa) / fh + 1e-9).astype(np.int64)
    imax = np.minimum(imax, len(P) - 1)
    have = imax >= 0
    p = np.full(n, spec["p_before_first"])
    if spec["agg"] == "last":
        p[have] = P[imax[have]]
    else:  # max over the frames since the previous hop, else the latest
        prev = np.concatenate([[-1], imax[:-1]])
        a = np.maximum(prev + 1, 0)
        b = imax + 1
        cs = np.concatenate([[0.0], np.cumsum(P)])
        cm = np.zeros(n)
        hb = have & (b > a)
        cm[hb] = (cs[b[hb]] - cs[a[hb]]) > 0  # P is binary for "max"
        cm[have & ~(b > a)] = P[imax[have & ~(b > a)]]
        p[have] = cm[have]
    return p >= spec["threshold"], t


def gaps(on, t):
    last = np.maximum.accumulate(np.where(on, t, -np.inf))
    return t - last  # inf where no voice hop yet


def groups_of(meta):
    """(group key, label code) pairs this stream contributes to."""
    s, g = meta["set"], SC.gnorm(meta.get("gender"))
    if s in VOICE_ROW:
        return [(("v1", VOICE_ROW[s], g), 1), (("v1set", s, g), 1)]
    if s in ("vin20", "vin0"):
        return [(("mix", s, meta["snr_db"], g, meta["split"]), 1)]
    if s == "noise":
        out = [(("noise", meta["split"]), 2), (("noise-label", meta["label"]), 2)]
        if meta.get("cls") in SC.MACHINE_ROOMS:
            out.append((("noise-room", meta["cls"]), 2))
        return out
    if s == "noiseho":
        out = [(("noiseho", meta["source"]), 2)]
        if meta.get("cls") in SC.MACHINE_ROOMS:
            out.append((("noiseho-room", meta["cls"]), 2))
        return out
    return []


def run_sweep():
    metas = list_streams(ROOT)
    gkeys = sorted({k for m in metas for k, _ in groups_of(m)}, key=str)
    gi = {k: i for i, k in enumerate(gkeys)}
    nD, nG, nH = len(DETS), len(gkeys), len(HS)
    tot = np.zeros(nG, np.int64)
    vet = np.zeros((nD, nG, nH), np.int64)
    onset_meta = []  # (gender, set, split, hop_ms)
    t0 = time.perf_counter()
    # pass 1: onsets + totals
    per = []
    for meta in metas:
        cols = load_dump(ROOT, meta)
        painted = cols["paint"] > 0
        lab = cols["lab"].astype(np.int8)
        gl = [(gi[k], lab == code) for k, code in groups_of(meta)]
        for g, m in gl:
            tot[g] += int(m.sum())
        ons = []
        if meta["set"] in VOICE_ROW or meta["set"] in ("vin20", "vin0"):
            for s, e in SC.onsets(cols["paint"], lab):
                ons.append((len(onset_meta), s, e))
                onset_meta.append((SC.gnorm(meta.get("gender")), meta["set"], meta.get("split"), meta["hop_s"] * 1000))
        per.append((meta, painted, gl, ons))
    delays = np.zeros((nD, len(onset_meta), nH), np.float32)
    print(f"{len(metas)} streams, {nG} groups, {len(onset_meta)} onsets, {nD} detectors x {nH} hangovers; pass 1 {time.perf_counter() - t0:.0f} s", flush=True)
    for si, (meta, painted, gl, ons) in enumerate(per):
        z = np.load(os.path.join(OUT, "cache", meta["set"], meta["id"] + ".npz"))
        dec = {k: z[k] for k in z.files}
        hop_ms = meta["hop_s"] * 1000
        for di, d in enumerate(DETS):
            P = frame_probs(d, dec[f"d{d['mode']}_{d['fl']}"])
            on, t = hop_on(d, meta, P)
            gp = gaps(on, t)
            for g, m in gl:
                if m.any():
                    vet[di, g] += (gp[m][:, None] > HTHR[None, :]).sum(0)
            for oi, s, e in ons:
                r = gp[s:e + 1].copy()
                r[~painted[s:e + 1]] = np.inf
                rmin = np.minimum.accumulate(r)
                delays[di, oi] = np.searchsorted(-rmin, -HTHR, side="left") * hop_ms
        if (si + 1) % 500 == 0:
            print(f"  {si + 1}/{len(per)} streams, {time.perf_counter() - t0:.0f} s", flush=True)
    return gkeys, tot, vet, onset_meta, delays


def pct(v, a):
    return 100.0 * v / a if a else float("nan")


def metrics(gkeys, tot, vet, onset_meta, delays):
    """Per (detector, hangover) metrics, as a list of dicts."""
    gi = {k: i for i, k in enumerate(gkeys)}
    G = ("f", "m", "unknown")

    def sumg(pred):
        idx = [gi[k] for k in gkeys if pred(k)]
        return tot[idx].sum(), vet[:, idx, :].sum(1)

    rows = {}
    for row, _ in SC.V1_SETS:
        rows[row] = {g: sumg(lambda k, row=row, g=g: k[0] == "v1" and k[1] == row and k[2] == g) for g in G}
    mixes = {}
    for s, snr in SC.V1_MIX:
        for sel in ("all", "tune"):
            mixes[(s, snr, sel)] = {g: sumg(lambda k, s=s, snr=snr, g=g, sel=sel: k[0] == "mix" and k[1] == s and k[2] == snr and k[3] == g and (sel == "all" or k[4] == "tune")) for g in G}
    v2 = {
        "tune194": sumg(lambda k: k == ("noise", "tune")),
        "held85": sumg(lambda k: k == ("noise", "held")),
        "all279": sumg(lambda k: k[0] == "noise"),
        "ho119": sumg(lambda k: k[0] == "noiseho"),
    }
    og = np.array([o[0] for o in onset_meta])
    out = []
    for di, d in enumerate(DETS):
        for hi, H in enumerate(HS):
            r = {"key": d["key"], "det": di, "H": float(H), "mode": d["mode"], "fl": d["fl"], "fam": d["fam"], "w": d["w"], "k": d["k"], "frame_ms": d["frame_ms"]}
            worst_clean = 0.0
            for row, bg in rows.items():
                vals = {g: pct(v[di, hi], a) for g, (a, v) in bg.items() if a}
                w = max(vals.values())
                r[f"v1:{row}"] = w
                worst_clean = max(worst_clean, w)
            r["v1_worst_clean"] = worst_clean
            for sel in ("all", "tune"):
                wm = 0.0
                for s, snr in SC.V1_MIX:
                    bg = mixes[(s, snr, sel)]
                    vals = {g: pct(v[di, hi], a) for g, (a, v) in bg.items() if a}
                    w = max(vals.values())
                    r[f"mix:{s}{snr}:{sel}"] = w
                    wm = max(wm, w)
                r[f"v1_worst_mix_{sel}"] = wm
            for k, (a, v) in v2.items():
                r[f"v2:{k}"] = pct(v[di, hi], a)
            med = {}
            for g in G:
                m = og == g
                if m.any():
                    med[g] = float(np.median(delays[di, m, hi]))
            r["onset_median_worse"] = max(med.values())
            r["onset_median"] = med
            out.append(r)
    return out


def pick(ops, clean_lim, mix_lim, mix_sel, v2key):
    feas = [o for o in ops if o["v1_worst_clean"] <= clean_lim and o[f"v1_worst_mix_{mix_sel}"] <= mix_lim]
    if not feas:
        return None, 0
    best = max(feas, key=lambda o: (round(o[f"v2:{v2key}"], 9), -max(o["v1_worst_clean"] / clean_lim, o[f"v1_worst_mix_{mix_sel}"] / mix_lim), -o["H"]))
    return best, len(feas)


def f2(x):
    return "—" if x is None or (isinstance(x, float) and math.isnan(x)) else f"{x:.2f}"


def opname(o):
    return f"{o['key']}-h{int(o['H'])}"


def summarize(ops):
    L = []
    P = L.append
    P("# WebRTC VAD sweep (tuning-side selection)\n")
    P(f"{len(ops)} operating points = {len(DETS)} detector variants x {len(HS)} hangovers.\n")
    sel = {}
    readings = [
        ("primary (pre-registered, strict tuning): V1 clean <= 1 %, tune-noise mixes <= 3 %, best V2 on tune 194", 1.0, 3.0, "tune", "tune194"),
        ("looser: V1 clean <= 1 %, all mixes <= 3 %, best V2 on tune 194", 1.0, 3.0, "all", "tune194"),
        ("looser: V1 clean <= 1 %, all mixes <= 3 %, best V2 on all 279", 1.0, 3.0, "all", "all279"),
        ("trade-off V1 = 2 %: clean <= 2 %, tune mixes <= 3 %", 2.0, 3.0, "tune", "tune194"),
        ("trade-off V1 = 2 %: clean <= 2 %, tune mixes <= 2 %", 2.0, 2.0, "tune", "tune194"),
        ("trade-off V1 = 5 %: clean <= 5 %, tune mixes <= 5 %", 5.0, 5.0, "tune", "tune194"),
        ("trade-off V1 = 5 %: clean <= 5 %, tune mixes <= 3 %", 5.0, 3.0, "tune", "tune194"),
        ("trade-off V1 = 10 %: clean <= 10 %, tune mixes <= 10 %", 10.0, 10.0, "tune", "tune194"),
    ]
    P("| reading | feasible points | chosen | V1 worst clean % | V1 worst mix % (tune / all) | V2 tune 194 % | all 279 % | held 85 % | held-out B 119 % | onset median ms (worse gender) |")
    P("|---|---|---|---|---|---|---|---|---|---|")
    for name, cl, ml, ms, vk in readings:
        o, nf = pick(ops, cl, ml, ms, vk)
        sel[name] = o
        if o is None:
            P(f"| {name} | 0 | — | | | | | | | |")
            continue
        P(f"| {name} | {nf} | {opname(o)} | {f2(o['v1_worst_clean'])} | {f2(o['v1_worst_mix_tune'])} / {f2(o['v1_worst_mix_all'])} | {f2(o['v2:tune194'])} | {f2(o['v2:all279'])} | {f2(o['v2:held85'])} | {f2(o['v2:ho119'])} | {f2(o['onset_median_worse'])} |")
    P("\n## Best point per aggressiveness mode (primary reading)\n")
    P("| mode | feasible points | chosen | V1 worst clean % | V1 worst mix % (tune) | V2 tune 194 % | all 279 % | held 85 % | held-out B 119 % |")
    P("|---|---|---|---|---|---|---|---|---|")
    for mode in (0, 1, 2, 3):
        o, nf = pick([x for x in ops if x["mode"] == mode], 1.0, 3.0, "tune", "tune194")
        if o is None:
            P(f"| {mode} | 0 | — | | | | | | |")
        else:
            P(f"| {mode} | {nf} | {opname(o)} | {f2(o['v1_worst_clean'])} | {f2(o['v1_worst_mix_tune'])} | {f2(o['v2:tune194'])} | {f2(o['v2:all279'])} | {f2(o['v2:held85'])} | {f2(o['v2:ho119'])} |")
    P("\n## Raw detector, no hangover (what each mode does on its own)\n")
    P("| detector | V1 worst clean % | per clean row (FDA / PTDB / voc / VocalSet / PVQD+VOICED / Hil) | V1 worst mix % (all) | V2 tune 194 % | all 279 % | held 85 % | held-out B 119 % |")
    P("|---|---|---|---|---|---|---|---|")
    for o in ops:
        if o["fam"] == "last" and o["H"] == 0:
            rr = " / ".join(f2(o[f"v1:{row}"]) for row, _ in SC.V1_SETS)
            P(f"| {o['key']} | {f2(o['v1_worst_clean'])} | {rr} | {f2(o['v1_worst_mix_all'])} | {f2(o['v2:tune194'])} | {f2(o['v2:all279'])} | {f2(o['v2:held85'])} | {f2(o['v2:ho119'])} |")
    P("\n## Pareto frontier: worst V1 row (clean or tune mix) vs V2 tune 194\n")
    P("| worst V1 % (max over clean rows and tune mixes) | point | V2 tune 194 % | held 85 % | held-out B 119 % |")
    P("|---|---|---|---|---|")
    pts = sorted(ops, key=lambda o: (max(o["v1_worst_clean"], o["v1_worst_mix_tune"]), -o["v2:tune194"]))
    best = -1
    for o in pts:
        if o["v2:tune194"] > best + 0.5:
            best = o["v2:tune194"]
            P(f"| {f2(max(o['v1_worst_clean'], o['v1_worst_mix_tune']))} | {opname(o)} | {f2(o['v2:tune194'])} | {f2(o['v2:held85'])} | {f2(o['v2:ho119'])} |")
    return "\n".join(L) + "\n", sel


def emit(o, name, v4):
    d = DETS[o["det"]]
    cdir = os.path.join(OUT, "cand", name)
    spec = spec_of(d, o["H"])
    spec.update({"name": name, "v4": v4, "notes": (
        f"WebRTC VAD (GMM, WebRTC common_audio/vad via py-webrtcvad; browser: @echogarden/fvad-wasm 0.2.0, decisions identical) "
        f"mode {d['mode']}, {d['fl']} ms frames at 16 kHz, family {d['fam']}"
        + (f" ({d['k']} of the last {d['w']} frames)" if d["fam"] == "win" else "")
        + f", hangover {int(o['H'])} ms; selected by sweep.py ({opname(o)}); first_avail includes 1 ms for the 16 kHz resampler")})
    os.makedirs(cdir, exist_ok=True)
    with open(os.path.join(cdir, "candidate.json"), "w", encoding="utf8") as f:
        json.dump(spec, f, indent=1)
    for meta in list_streams(ROOT):
        z = np.load(os.path.join(OUT, "cache", meta["set"], meta["id"] + ".npz"))
        P = frame_probs(d, z[f"d{d['mode']}_{d['fl']}"]).astype("<f4")
        os.makedirs(os.path.join(cdir, meta["set"]), exist_ok=True)
        P.tofile(os.path.join(cdir, meta["set"], meta["id"] + ".f32"))
    return cdir


def v4_block():
    p = A.get("v4", os.path.join(OUT, "wasm-check.json"))
    j = json.load(open(p, encoding="utf8")) if os.path.exists(p) else {}
    return j


def main():
    sys.stdout.reconfigure(encoding="utf-8")
    cache = os.path.join(OUT, "sweep-raw.npz")
    if os.path.exists(cache) and "recompute" not in A:
        z = np.load(cache, allow_pickle=True)
        gkeys = [tuple(x) for x in z["gkeys"]]
        tot, vet, delays = z["tot"], z["vet"], z["delays"]
        onset_meta = [tuple(x) for x in z["onset_meta"]]
    else:
        gkeys, tot, vet, onset_meta, delays = run_sweep()
        np.savez_compressed(cache, gkeys=np.array([list(map(str, k)) for k in gkeys], dtype=object), tot=tot, vet=vet,
                            delays=delays, onset_meta=np.array(onset_meta, dtype=object))
        gkeys = [tuple(map(str, k)) for k in gkeys]
    # keys were stringified for storage; restore the numeric SNR
    gkeys = [tuple(int(x) if (k[0] == "mix" and i == 2) else x for i, x in enumerate(k)) for k in gkeys]
    onset_meta = [(o[0], o[1], o[2], float(o[3])) for o in onset_meta]
    ops = metrics(gkeys, tot, vet, onset_meta, delays)
    with open(os.path.join(OUT, "sweep-ops.json"), "w", encoding="utf8") as f:
        json.dump(ops, f)
    md, sel = summarize(ops)
    with open(os.path.join(OUT, "sweep.md"), "w", encoding="utf8") as f:
        f.write(md)
    print(md)
    if "emit" in A:
        j = v4_block()
        names = {}
        for reading, o in sel.items():
            if o is None:
                continue
            nm = "webrtc-" + opname(o)
            names[nm] = reading
            if os.path.isdir(os.path.join(OUT, "cand", nm)):
                continue
            cpu = None
            b = (j.get("bench") or {}).get(f"sr48000_mode{o['mode']}")
            b16 = (j.get("bench") or {}).get(f"sr16000_mode{o['mode']}")
            if b and b16:
                cpu = max(b["ms_per_25ms"], b16["ms_per_25ms"])
            v4 = {"license": "BSD-3-Clause", "license_file": "build/vad/webrtc/dl/fvad/package/LICENSE",
                  "license_text_checked": True,
                  "license_note": "WebRTC VAD code: BSD-3-Clause (WebRTC authors) + Google's additional royalty-free patent grant (PATENTS, defensive termination only); py-webrtcvad wrapper MIT; fvad-wasm package BSD-3-Clause",
                  "model_bytes": 20569 + 14922, "model_note": "no separate weights: the GMM tables are compiled into fvad.wasm (20 569 B) + its Emscripten loader fvad.js (14 922 B)",
                  "runtime": "wasm", "wasm_ms_per_25ms": cpu,
                  "wasm_measured_on": f"Node {j.get('node')} (V8 {j.get('v8')}) WebAssembly, @echogarden/fvad-wasm 0.2.0, 1 thread, desktop CPU; worse of 16 / 48 kHz input, 25 ms chunks -> 10 ms frames incl. int16 conversion and heap copy"}
            emit(o, nm, v4)
            print(f"emitted {nm} ({reading})")
        with open(os.path.join(OUT, "emitted.json"), "w", encoding="utf8") as f:
            json.dump(names, f, indent=1)


if __name__ == "__main__":
    main()
