# build_index.py — merge the per-source manifests with the census labels, the
# shipped-notch probe and exact-duplicate detection into the loader indexes:
#   data/index_noise.json  data/index_voice.json  data/index_mix.json
# and print the corpora summary (counts / durations / licenses per source and
# label) that the README / measurement file quote.
#
#   python scripts/notch-adversarial/realdata/build_index.py [--probe=probe_src] [--md=PATH]
import os, json, glob, hashlib, collections
import numpy as np, soundfile as sf
from common import DATA, args, load_manifest

A = args()

def digest(path):
    x, _ = sf.read(os.path.join(DATA, path), dtype="float32")
    return hashlib.md5(x.tobytes()).hexdigest()

def dedupe(recs):
    """Exact (md5 of the samples) and NEAR duplicates (same length, sample
    correlation > 0.9999 — MS-SNSD ships CopyMachine_8 / _10 differing by 1-2
    LSB)."""
    seen, bylen = {}, collections.defaultdict(list)
    for r in sorted(recs, key=lambda r: r["id"]):
        h = digest(r["path"]); r["md5"] = h
        if h in seen: r["dup_of"] = seen[h]; continue
        seen[h] = r["id"]
        x = sf.read(os.path.join(DATA, r["path"]), dtype="float32")[0]
        for q, y in bylen[len(x)]:
            if len(x) > 1600 and np.std(x) > 0 and np.std(y) > 0 and np.corrcoef(x, y)[0, 1] > 0.9999:
                r["dup_of"] = q; break
        else:
            if len(x) >= 16000 * 10: bylen[len(x)].append((r["id"], x))
    return recs

def main():
    out_md = []
    P = lambda s="": out_md.append(s)
    # ---- noise --------------------------------------------------------------
    noise = dedupe(load_manifest("noise"))
    cen = {}
    cp = os.path.join(DATA, "census", "noise_census.json")
    if os.path.exists(cp): cen = {r["id"]: r for r in json.load(open(cp))}
    probe = {}
    for f in glob.glob(os.path.join(DATA, "census", f"{A.get('probe', 'probe_src')}*.json")):
        for r in json.load(open(f)): probe[r["id"]] = r
    for r in noise:
        c = cen.get(r["id"])
        if c:
            r["label"] = c["label"]; r["flags"] = c["flags"]
            if c["lines"]:
                m = c["lines"][0]
                r["main_line"] = dict(f=m["f_med"], duty=m["duty"], snr_db=m["snr_db"], f_range=m["f_range"],
                                      cuts_015_1=m["g015_1"], cuts_1_3=m["g1_3"], cuts_3_10=m["g3_10"], r8_pattern=m["r8_pattern"])
            r["n_lines"] = c["n_lines"]
        p = probe.get(r["id"])
        if p: r["probe"] = {k: p[k] for k in ("promoT", "notchedFrac", "freqs", "fvWorker", "fvPainted", "fvPaintedAfter20")}
    json.dump(noise, open(os.path.join(DATA, "index_noise.json"), "w"), indent=1)
    # ---- voice --------------------------------------------------------------
    voice = dedupe(load_manifest("voice"))
    json.dump(voice, open(os.path.join(DATA, "index_voice.json"), "w"), indent=1)
    # ---- mix ----------------------------------------------------------------
    mix = load_manifest("mix")
    json.dump(mix, open(os.path.join(DATA, "index_mix.json"), "w"), indent=1)

    # ---- summary ------------------------------------------------------------
    P("### Corpus A — real noise")
    P("| source | clips (dups) | minutes | label: stationary / intermittent / mixed / broadband (of which < 15 s) | license |")
    P("|---|---|---|---|---|")
    for s, rs in group(noise, "source"):
        nd = [r for r in rs if not r.get("dup_of")]
        lab = collections.Counter(r.get("label", "?") for r in nd)
        lic = sorted({r["license"].split(";")[0].split(" (")[0] for r in nd})
        P(f"| {s} | {len(nd)} ({len(rs) - len(nd)}) | {sum(r['dur'] for r in nd) / 60:.1f} | {lab['stationary-tonal']} / {lab['intermittent-tonal']} / {lab['mixed']} / {lab['broadband']} / {sum('short' in r.get('flags', []) for r in nd)} | {', '.join(lic)[:80]} |")
    nd = [r for r in noise if not r.get("dup_of")]
    lab = collections.Counter(r.get("label", "?") for r in nd)
    P(f"| **all** | {len(nd)} ({len(noise) - len(nd)}) | {sum(r['dur'] for r in nd) / 60:.1f} | {lab['stationary-tonal']} / {lab['intermittent-tonal']} / {lab['mixed']} / {lab['broadband']} / {sum('short' in r.get('flags', []) for r in nd)} | |")
    P()
    P("### Corpus B — real voice")
    P("| source | clips | minutes | held segs (>= 0.5 s) | held min | segs >= 2 s | segs >= 5 s | held F0 in 50-460 Hz | license |")
    P("|---|---|---|---|---|---|---|---|---|")
    for s, rs in group(voice, "source"):
        H = [h for r in rs for h in r.get("held", [])]
        d = np.array([h[1] - h[0] for h in H]) if H else np.zeros(0)
        f = np.array([h[2] for h in H]) if H else np.zeros(0)
        lic = sorted({r["license"].split(";")[0].split(" (")[0] for r in rs})
        P(f"| {s} | {len(rs)} | {sum(r['dur'] for r in rs) / 60:.1f} | {len(H)} | {d.sum() / 60:.1f} | {(d >= 2).sum()} | {(d >= 5).sum()} | {((f >= 50) & (f <= 460)).sum()} | {', '.join(lic)[:60]} |")
    if mix:
        P()
        P("### Mixes")
        P("| set | streams | minutes | notes |")
        P("|---|---|---|---|")
        for s, rs in group(mix, "set"):
            P(f"| {s} | {len(rs)} | {sum(r['dur'] for r in rs) / 60:.1f} | {rs[0].get('set_notes', '')[:120]} |")
    txt = "\n".join(out_md)
    print(txt)
    open(A.get("md", os.path.join(DATA, "summary.md")), "w", encoding="utf-8").write(txt + "\n")

def group(recs, key):
    d = collections.defaultdict(list)
    for r in recs: d[r.get(key)].append(r)
    return sorted(d.items(), key=lambda kv: str(kv[0]))

if __name__ == "__main__":
    main()
