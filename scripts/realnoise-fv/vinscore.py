# vinscore.py — voice-in-noise mixes scored from attr.mjs / replay.mjs dumps
# (2026-10-05). Truth = Praat AC F0 of each (public) voice layer on the mix
# timeline (= realeval.mjs truthOf); a voice frame is at pitch when within 8 %
# (realeval.mjs convention). Worker values at the frame centre, painted values
# at the display alignment (frame k - L, centre - 30 ms).
#
#   python scripts/realnoise-fv/vinscore.py TAG [TAG ...] [--split=all|tune|held]
#          [--attr=build/realnoise-fv/attr] [--data-root=$NOTCHVD_ROOT] [--json=PATH]
# Columns: ok / pok (worker / painted voice frames at pitch), lo / hi (truth
# < / >= 160 Hz, painted), hok (painted hold frames of held-series programs),
# lead / tail (painted FV in the 20 s noise lead from 1.5 s / the 5 s tail),
# prog (painted on program frames >= 0.1 s from any voiced truth).
import sys, os, glob, json
import numpy as np

A = dict((a[2:].split("=", 1) + ["1"])[:2] for a in sys.argv[1:] if a.startswith("--"))
TAGS = [a for a in sys.argv[1:] if not a.startswith("--")]
ATTR = A.get("attr", "build/realnoise-fv/attr")
ROOT = os.path.join(A.get("data-root", os.environ.get("NOTCHVD_ROOT", "build/notchvd")), "data")
SPLIT = A.get("split", "all")
MIX = {r["id"]: r for r in json.load(open(os.path.join(ROOT, "index_mix.json"))) if r["set"] == "voice_in_noise"}
VOICE = {r["path"]: r for r in json.load(open(os.path.join(ROOT, "index_voice.json")))}
_F0 = {}


def truth(rec, t):
    out = np.full(len(t), -1.0)
    for L in rec["spec"]["layers"]:
        v = VOICE.get(L["clip"])
        if not v or not v.get("f0_path"):
            continue
        fp = os.path.join(ROOT, v["f0_path"])
        if fp not in _F0:
            _F0[fp] = json.load(open(fp)).get("praat") if os.path.exists(fp) else None
        f = _F0[fp]
        if not f:
            continue
        m = (t >= L["at"]) & (t <= L["at"] + L["len"])
        i = np.round((t[m] - L["at"] + L.get("from", 0) - f["t0"]) / f["hop"]).astype(int)
        f0 = np.asarray(f["f0"], float)
        ok = (i >= 0) & (i < len(f0))
        val = np.zeros(m.sum())
        val[ok] = f0[i[ok]]
        out[m] = val
    return out


def load(p):
    m = json.load(open(p + ".json"))
    a = np.fromfile(p + ".f32", dtype=np.float32).reshape(len(m["cols"]), m["n"]).astype(float)
    return m, {c: a[i] for i, c in enumerate(m["cols"])}


KEYS = ["ok", "pok", "lo", "hi", "hok", "lead", "tail", "prog"]


def score(tag):
    acc = {}
    for p in sorted(glob.glob(f"{ATTR}/{tag}/vin/*.json")):
        m, c = load(p[:-5])
        if SPLIT != "all" and m.get("split") != SPLIT:
            continue
        rec = MIX[m["id"]]
        n, hop, L = m["n"], m["hopS"], m["L"]
        k = np.arange(n)
        tw = (k + 1) * hop - 0.040
        td = tw - L * hop - 0.030
        dur = n * hop
        valid = (td >= 0) & (tw <= dur - 0.3)
        rw, rd = truth(rec, tw), truth(rec, td)
        post = c["post"]
        paint = np.where(np.isfinite(c["inten"]), c["paint"], 0)
        t0, t1 = rec["voice_t0"], rec["voice_t1"]
        progw = valid & (tw >= t0) & (tw <= t1)
        progd = valid & (td >= t0) & (td <= t1)
        vw, vd = progw & (rw > 0), progd & (rd > 0)
        okw = vw & (post > 0) & (np.abs(post / np.where(rw > 0, rw, 1) - 1) < 0.08)
        okd = vd & (paint > 0) & (np.abs(paint / np.where(rd > 0, rd, 1) - 1) < 0.08)
        holds = rec.get("holds") or []
        inh = np.zeros(n, bool)
        for h in holds:
            inh |= (td >= h[0] + 0.3) & (td <= h[1] - 0.1)
        near = np.zeros(n, bool)
        for d in np.arange(-0.1, 0.1001, 0.025):
            near |= truth(rec, td + d) > 0
        lead = valid & (td >= 1.5) & (td < t0 - 0.1)
        tail = valid & (td > t1 + 0.5)
        prog = progd & ~(rd > 0) & ~near
        row = {"ok": (okw.sum(), vw.sum()), "pok": (okd.sum(), vd.sum()),
               "lo": ((okd & (rd < 160)).sum(), (vd & (rd < 160)).sum()), "hi": ((okd & (rd >= 160)).sum(), (vd & (rd >= 160)).sum()),
               "hok": ((okd & inh).sum(), (vd & inh).sum()), "lead": ((lead & (paint > 0)).sum(), lead.sum()),
               "tail": ((tail & (paint > 0)).sum(), tail.sum()), "prog": ((prog & (paint > 0)).sum(), prog.sum())}
        for key in (f"snr{rec['snr_db']:+d}", "all"):
            d = acc.setdefault(key, {kk: [0, 0] for kk in KEYS})
            for kk, (a, b) in row.items():
                d[kk][0] += int(a); d[kk][1] += int(b)
        acc.setdefault("_streams", {})[m["id"]] = {kk: [int(a), int(b)] for kk, (a, b) in row.items()}
    return acc


if __name__ == "__main__":
    res = {t: score(t) for t in TAGS}
    print(f"split={SPLIT}")
    print("| tag | SNR | voice at pitch, worker | painted | painted < 160 Hz | >= 160 Hz | held-series hold frames | lead FV painted | tail | program gaps |")
    print("|---|---|---|---|---|---|---|---|---|---|")
    for key in ("snr+10", "snr+0", "all"):
        for t in TAGS:
            d = res[t].get(key)
            if not d:
                continue
            f = lambda kk: f"{100*d[kk][0]/max(d[kk][1],1):.2f}"
            print(f"| {t} | {key} | {f('ok')} | {f('pok')} | {f('lo')} | {f('hi')} | {f('hok')} | {f('lead')} | {f('tail')} | {f('prog')} |")
    if A.get("json"):
        json.dump(res, open(A["json"], "w"))
