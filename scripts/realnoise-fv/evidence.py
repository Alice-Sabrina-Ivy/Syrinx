# evidence.py — offline replica of the pitch-hold bridge's voice-evidence rule
# (src/audio/bridgeEvidence.js, fix round 2026-10-06) over attr.mjs /
# replay.mjs dumps, for the decision-record rows the hook does not expose:
# when the evidence is open, which frames are strong, which held frames are
# hidden. `check` compares the replica's hidden frames with a real-hook
# replay (base painted minus candidate painted) and must report 0 mismatches
# before any row built on it is quoted.
#
#   python scripts/realnoise-fv/evidence.py check --attr=ROOT BASE CAND --set=noise [--cpp-min=0.5]
#          [--base-attr=ROOT2 (BASE under another root)] [--cpp-col=bcpp] [--align=ct|arrive|lagN] [--no-low-f0]
#
# Replica (per DSP hop k, the chain's cadence: the message consumed at hop k
# describes frame k - L, whose chunk is DSP hop k - L):
#   fresh = msg[k] > 0; aligned CPP = bcpp[k - L] (the CPP of the same chunk,
#   contextTime match) when hop k - L is among the last 8 DSP hops, divided
#   by lowF0Gain(msg[k]) (BRIDGE_LOW_F0_GAIN; --no-low-f0 drops it);
#   strong at k when the last 4 pairings hold >= 2 fresh ones with a CPP and
#   their mean >= cpp_min (default 0.39); a held frame (msg <= 0) is drawn when its gap is
#   <= 50 ms old, or <= 200 ms after a run >= 250 ms, or no CPP arrived for
#   1 s, or a strong frame was seen < 20 s ago.
import sys, os, glob, json
import numpy as np

GRACE, LONG_RUN, LONG_GRACE, EVID, MISSING, EPS = 50, 250, 200, 20000, 1000, 1
LOW_F0_GAIN = [[75, 0.8], [82, 0.82], [90, 0.92], [100, 1.0]]  # bridgeEvidence.js BRIDGE_LOW_F0_GAIN


def low_f0_gain(f0):
    if not (f0 > 0):
        return 1.0
    return float(np.interp(f0, [x for x, _ in LOW_F0_GAIN], [g for _, g in LOW_F0_GAIN]))


def js_round(x):
    return int(np.floor(x + 0.5))


def replay_rule(m, c, cpp_col="bcpp", cpp_min=0.39, align="ct", strong_at0=None, low_f0=True):
    """per-hop arrays: allow (held frame may be drawn), by_evidence (allowed
    only because the evidence is open: past the graces, CPP present), strong
    (a strong frame at this hop), open (strong frame < 20 s ago), src (hop of
    the strong frame that keeps it open, -1 none / the warm start),
    first_strong (s or None). strong_at0 (ms): a strong frame before the
    stream (warm-start counterfactual: 0 = the user spoke just before)."""
    n, L = m["n"], m["L"]
    sr = m.get("sr", 16000)
    C = js_round(sr * 0.025)
    inten, msg = c["inten"], c["msg"]
    cpp = c[cpp_col] if cpp_col in c else np.full(n, np.nan)
    allow = np.ones(n, bool); strong = np.zeros(n, bool); opn = np.zeros(n, bool)
    byev = np.zeros(n, bool); src = np.full(n, -1)
    recent, ring = [], []
    last_fresh = run_start = prev_now = strong_at = last_cpp = None
    strong_k = -1
    if strong_at0 is not None:
        strong_at = strong_at0
    last_run, frame_ms = 0, 25
    first_strong = None
    first_msg = None
    for k in range(n):
        if np.isnan(inten[k]):  # no DSP frame (an intensity of -inf is a frame)
            continue
        now = js_round((k + 1) * C / sr * 1000)
        fresh = bool(msg[k] > 0)
        if first_msg is None and fresh:
            first_msg = k
        v = cpp[k]
        has = bool(np.isfinite(v))
        if prev_now is not None and now > prev_now:
            frame_ms = now - prev_now
        prev_now = now
        if has:
            last_cpp = now
        ring.append((k, v if has else None))
        if len(ring) > 8:
            ring.pop(0)
        if align == "ct":
            j = k - L
            ac = next((cv for (kk, cv) in ring if kk == j), None)
        elif align == "arrive":
            ac = ring[-1][1]
        else:  # lagN
            i = len(ring) - 1 - int(align[3:])
            ac = ring[i][1] if i >= 0 else None
        if ac is not None and low_f0:
            ac = ac / low_f0_gain(msg[k])
        recent.append((fresh, ac))
        if len(recent) > 4:
            recent.pop(0)
        vals = [x for f, x in recent if f and x is not None]
        if len(vals) >= 2 and sum(vals) / len(vals) >= cpp_min:
            strong_at = now
            strong_k = k
            strong[k] = True
            if first_strong is None:
                first_strong = (k + 1) * C / sr
        if fresh:
            if last_fresh is None or now - last_fresh > frame_ms * 1.5:
                run_start = now
            last_fresh = now
            last_run = now - run_start + frame_ms
        opn[k] = strong_at is not None and now - strong_at < EVID
        src[k] = strong_k if opn[k] else -1
        if last_fresh is None:
            allow[k] = True
            continue
        age = now - last_fresh
        other = (age <= GRACE + EPS or (last_run >= LONG_RUN - EPS and age <= LONG_GRACE + EPS)
                 or last_cpp is None or now - last_cpp > MISSING)
        allow[k] = other or opn[k]
        byev[k] = (not other) and opn[k]
    return dict(allow=allow, by_evidence=byev, strong=strong, open=opn, src=src, first_strong=first_strong)


def load(p):
    m = json.load(open(p + ".json"))
    a = np.fromfile(p + ".f32", dtype=np.float32).reshape(len(m["cols"]), m["n"]).astype(float)
    return m, {col: a[i] for i, col in enumerate(m["cols"])}


def hidden_pred(m, cb, **kw):
    """held frames the rule hides, given the BASE dump (its painted trace)"""
    R = replay_rule(m, cb, **kw)
    disp = np.isfinite(cb["inten"])
    held = disp & (cb["paint"] > 0) & (cb["msg"] <= 0)
    return held & ~R["allow"], R


if __name__ == "__main__" and len(sys.argv) > 1 and sys.argv[1] == "check":
    A = dict((a[2:].split("=", 1) + ["1"])[:2] for a in sys.argv[2:] if a.startswith("--"))
    T = [a for a in sys.argv[2:] if not a.startswith("--")]
    root, base, cand = A["attr"], T[0], T[1]
    broot = A.get("base-attr", root)
    sets = A.get("set", "noise").split(",")
    kw = dict(cpp_min=float(A.get("cpp-min", 0.39)), cpp_col=A.get("cpp-col", "bcpp"), align=A.get("align", "ct"),
              low_f0="no-low-f0" not in A)
    for s in sets:
        bt, ct = (base, cand)
        if s == "vinL0":
            bt, ct, s = base + "_L0", cand + "_L0", "vin"
        mis = tot = hid = 0
        for p in sorted(glob.glob(f"{root}/{ct}/{s}/*.json")):
            nm = os.path.basename(p)[:-5]
            m, cb = load(f"{broot}/{bt}/{s}/{nm}")
            _, cc = load(f"{root}/{ct}/{s}/{nm}")
            cb = dict(cb, **{k: cc[k] for k in ("bcpp", "cpp") if k in cc})  # the candidate run's DSP columns
            hp, _ = hidden_pred(m, cb, **kw)
            disp = np.isfinite(cb["inten"])
            pred = disp & (cb["paint"] > 0) & ~hp
            real = disp & (cc["paint"] > 0)
            mis += int((pred != real).sum()); tot += int(disp.sum()); hid += int(hp.sum())
        print(f"{s}: replica vs hook {ct}: {mis} mismatching hops of {tot} ({hid} hidden by the replica)")
