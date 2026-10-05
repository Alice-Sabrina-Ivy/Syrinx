# runs_feat.py — characterise every off-level run the paint gate saw (mix pass,
# all speakers) by what it really was (cons ref at the display alignment:
# GENUINE register change = msg correct on >= 70 % of ref-covered frames;
# ERROR = msg wrong-octave on >= 70 %), and by candidate arming features at run
# start, to see which evidence separates genuine switches from octave locks.
# Usage: python scripts/session-oracle/reacq/runs_feat.py TAG [--conv=cons]
import sys, json, numpy as np
sys.argv, ARGV = [sys.argv[0], "--quiet"], sys.argv
sys.path.insert(0, "scripts/session-oracle")
import analyze as an
A = dict((a[2:].split("=", 1) + ["1"])[:2] for a in ARGV[1:] if a.startswith("--"))
TAG = [a for a in ARGV[1:] if not a.startswith("--")][0]
conv = A.get("conv", "cons")
rows = []
for s in an.SESSIONS:
    R = an.load_refs(s); m, c = an.load_run(TAG, s)
    L, hop, n = m["lookback"], m["hopS"], m["nHops"]
    ref, spk, t0 = R[conv], R["spk"], R["t"][0]
    k = np.arange(n)
    ii = np.round(((k + 1) * hop - (0.040 + L * hop + an.DELTA_DISP) - t0) / 0.01).astype(int)
    okk = (ii >= 0) & (ii < len(ref))
    r = np.where(okk, ref[np.clip(ii, 0, len(ref) - 1)], 0); sp = np.where(okk, spk[np.clip(ii, 0, len(ref) - 1)], 0)
    code = c["g_code"]; lev = c["g_level"]; msg = c["msg"]; inten = c["inten"]; conf = c["mconf"]
    j = 0
    while j < n:
        if code[j] not in (4, 5): j += 1; continue
        e = j
        while e + 1 < n and code[e + 1] in (4, 5): e += 1
        acc = e + 1 < n and code[e + 1] == 2
        # classify by msg vs ref over run (+ accept frame)
        q = slice(j, min(n, e + 2))
        rr, mm = r[q], msg[q]
        have = rr > 0
        cor = have & (mm > 0) & (np.abs(mm / np.where(rr > 0, rr, 1) - 1) < 0.05)
        wo = have & (mm > 0) & ((np.abs(mm / np.where(rr > 0, rr, 1) - 0.5) <= 0.05) | (np.abs(mm / np.where(rr > 0, rr, 1) - 2) <= 0.2) | (mm / np.where(rr > 0, rr, 1) > 2.6))
        nh = have.sum()
        kind = "noref" if nh < 2 else ("genuine" if cor.sum() >= 0.7 * nh else ("error" if wo.sum() >= 0.7 * nh else "mixed"))
        lv = lev[j - 1] if j > 0 else 0
        up = msg[j] > lv if lv > 0 else True
        pre = slice(max(0, j - 8), j)
        idip = float(np.nanmax(inten[pre]) - np.nanmin(inten[max(0, j - 2):j + 1])) if j > 0 else np.nan
        ijump = float(np.nanmean(inten[j:j + 3]) - np.nanmean(inten[max(0, j - 4):j])) if j > 0 else np.nan
        cmin = float(np.nanmin(conf[max(0, j - 2):j + 1]))
        c0 = float(conf[j])
        ah = c["ambH"][j:j + 4]; ad = c["ambD"][j:j + 4]
        amb = float(np.nanmin(ah if up else ad)) if np.any(np.isfinite(ah if up else ad)) else np.nan
        g1 = j > 0 and code[j - 1] in (6, 7, 8, 9, 10)
        vals = msg[j:e + 1]; vals = vals[vals > 0]
        spread3 = float(abs(12 * np.log2(vals[:3].max() / vals[:3].min()))) if len(vals) >= 3 else np.nan
        spks = sp[q][sp[q] > 0]
        rows.append(dict(s=s, j=j, len=e - j + 1, acc=bool(acc), kind=kind, up=bool(up), idip=idip, ijump=ijump, cmin=cmin, c0=c0, amb=amb,
                         g1=bool(g1), code=int(code[j]), spread3=spread3, spk=int(np.bincount(spks.astype(int)).argmax()) if len(spks) else 0))
        j = e + 1
json.dump(rows, open(f"build/reacq/runs_{TAG}.json", "w"))
import collections
print(f"{len(rows)} off-level runs")
for code_ in (4, 5):
    print(f"\n== runs starting {'ARMED' if code_ == 4 else 'UNARMED'}")
    for kind in ("genuine", "error", "mixed", "noref"):
        X = [x for x in rows if x["code"] == code_ and x["kind"] == kind]
        if not X: continue
        L_ = np.array([x["len"] for x in X]); acc = np.mean([x["acc"] for x in X])
        def qs(key):
            v = np.array([x[key] for x in X], float); v = v[np.isfinite(v)]
            return "  -  " if not len(v) else f"p25 {np.percentile(v, 25):5.2f} med {np.median(v):5.2f} p75 {np.percentile(v, 75):5.2f}"
        print(f"  {kind:8s} n={len(X):5d} up={np.mean([x['up'] for x in X]):.2f} accepted={acc:.2f} len med {np.median(L_):.0f} | "
              f"conf0 {qs('c0')} | cmin {qs('cmin')} | idip {qs('idip')} | ijump {qs('ijump')} | amb {qs('amb')} | spread3 {qs('spread3')} | spk {collections.Counter(x['spk'] for x in X).most_common(3)}")
