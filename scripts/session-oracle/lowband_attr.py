# lowband_attr.py — stage attribution of reference-voiced frames the Syrinx
# chain does not report correctly (2026-10-04 low-register voicing pass;
# private measurement, kept outside this repo). Reads the per-hop
# dumps of lowband-attr.mjs.
#
# Usage: python scripts/session-oracle/lowband_attr.py TAG [TAG...]
#          [--attr=build/session-oracle/attr] [--refs=build/session-oracle/refs]
#          [--data=$PITCH_BENCH_DIR/data] [--bands=75-160,160-400] [--json=PATH]
#
# Alignment: a reference frame at time t (corpora: i*refHop + refOffset,
# PTDB-TUG +20 ms; sessions: the refs npz `t`) reads detection columns at hop
# round((t + 0.040)/hop - 1) and display columns at hop
# round((t + 0.040 + L*hop + 0.030)/hop - 1) (session-oracle conventions).
# Correct = |q - 1| < 0.05. Sessions use the `cons` reference (and `strict`
# as sensitivity), speakers alice / second.
#
# Worker-stage attribution of a ref-voiced frame whose POSTED value is not
# correct, first match wins (the stage that lost it):
#   E  dec correct, post null: guard (guard verdict 0) | veto (else: ghost
#      veto near a notch line; above-range cannot apply to a correct < 400 Hz
#      decode)
#   D  frame-local argmax correct (best candidate ~ ref and beats uv) but the
#      tracker decode is not: D-null (decoded unvoiced) | D-wrong
#   C  frame-local argmax voiced at another value (octave or other)
#   B  a candidate ~ ref exists but loses to unvoicedStrength (detector
#      unvoiced): B-sil (silence term active, uv > voicingThreshold) | B-thr
#   A  no candidate within 5 % of ref among the top 8
# Each stage also splits by what was posted: null vs wrong value.
# Display stage: post correct but paint not (blank | wrong), and the reverse.
import sys, os, json
import numpy as np

A = dict((a[2:].split("=", 1) + ["1"])[:2] for a in sys.argv[1:] if a.startswith("--"))
TAGS = [a for a in sys.argv[1:] if not a.startswith("--")]
ATTR = A.get("attr", "build/session-oracle/attr")
REFS = A.get("refs", "build/session-oracle/refs")
DATA = A.get("data", os.path.join(os.environ.get("PITCH_BENCH_DIR", "build/pitch-benchmark"), "data"))
BANDS = [tuple(map(float, b.split("-"))) for b in A.get("bands", "75-160,160-400").split(",")]
SESSIONS = ["2025-09-08", "2026-05-07", "2026-05-26", "2026-06-09"]
VT = float(A.get("vt", "0.35"))
K = 8


def load(tag, st, name):
    d = f"{ATTR}/{tag}/{st}"
    m = json.load(open(f"{d}/{name}.json"))
    a = np.fromfile(f"{d}/{name}.f32", dtype=np.float32).reshape(len(m["cols"]), m["n"]).astype(float)
    return m, {c: a[i] for i, c in enumerate(m["cols"])}


def near(v, r):
    return (v > 0) & (np.abs(v / np.where(r > 0, r, 1) - 1) < 0.05)


def take(col, idx):
    v = col[np.clip(idx, 0, len(col) - 1)].copy()
    v[(idx < 0) | (idx >= len(col))] = 0
    return v


CATS = ["ok", "E-guard", "E-veto", "D-null", "D-wrong", "C", "B-sil", "B-thr", "A"]


def attribute(m, c, t, r):
    hop, L = m["hopS"], m["L"]
    kw = np.round((t + 0.040) / hop - 1).astype(int)
    kd = np.round((t + 0.040 + L * hop + 0.030) / hop - 1).astype(int)
    post, dec, uv, guard = take(c["post"], kw), take(c["dec"], kw), take(c["uv"], kw), take(c["guard"], kw)
    f0, s0 = take(c["f0"], kw), take(c["s0"], kw)
    sref = np.full(len(r), -np.inf)
    for i in range(K):
        fi, si = take(c[f"f{i}"], kw), take(c[f"s{i}"], kw)
        sref = np.where(near(fi, r) & (si > sref), si, sref)
    paint = take(c["paint"], kd)
    ok = near(post, r)
    flc = near(f0, r) & (s0 > uv)
    cat = np.full(len(r), "A", dtype=object)
    cat[np.isfinite(sref) & (uv > VT + 1e-9)] = "B-sil"
    cat[np.isfinite(sref) & ~(uv > VT + 1e-9)] = "B-thr"
    cat[(s0 > uv) & ~near(f0, r)] = "C"
    cat[flc & ~near(dec, r) & (dec > 0)] = "D-wrong"
    cat[flc & ~(dec > 0)] = "D-null"
    dc = near(dec, r)
    cat[dc & (guard == 0)] = "E-guard"
    cat[dc & (guard != 0)] = "E-veto"
    cat[ok] = "ok"
    # Null-reason x frame-local state (posted-null frames only): where the
    # chain ended at null, and what the detector alone said.
    fls = np.where(flc, "flC", np.where(s0 > uv, "flW", np.where(np.isfinite(sref), "flU", "flA")))
    why = np.where(~(dec > 0), "trk", np.where(dec > 400, "rng", np.where(guard == 0, "grd", "veto")))
    nr = np.where(post > 0, "", np.char.add(np.char.add(why.astype(str), "/"), fls.astype(str)))
    return dict(cat=cat, nr=nr, postnull=~(post > 0), ok=ok, pok=near(paint, r), pnull=~(paint > 0),
                margin=np.where(np.isfinite(sref), uv - sref, np.nan), sil=uv > VT + 1e-9)


def corpus_groups(tag, corpus):
    idx = json.load(open(f"{DATA}/index.json"))
    G = {}
    for tr in idx:
        if tr["corpus"] != corpus: continue
        r = np.fromfile(f"{DATA}/{corpus}/{tr['trackId']}.ref.f32", dtype=np.float32).astype(float)
        r[r < 50] = 0
        t = np.arange(len(r)) * tr["refHopMs"] / 1000 + tr["refOffsetMs"] / 1000
        v = r > 0
        m, c = load(tag, corpus, tr["trackId"])
        g = f"{corpus}_{tr['gender']}" if corpus != "voc" else "voc"
        G.setdefault(g, []).append((r[v], attribute(m, c, t[v], r[v])))
    return G


def session_groups(tag):
    G = {}
    for s in SESSIONS:
        z = np.load(f"{REFS}/{s}.npz")
        m, c = load(tag, "sessions", s)
        for conv in ("cons", "strict"):
            ref = np.where(z[conv] >= 75, z[conv], 0)
            for spk, code in (("alice", 1), ("second", 2)):
                if conv == "strict" and spk == "second": continue
                msk = (z["spk"] == code) & (ref > 0)
                a = attribute(m, c, z["t"][msk], ref[msk])
                G.setdefault(f"{spk}_{conv}", []).append((ref[msk], a))
                if s == "2026-06-09": G.setdefault(f"{spk}_{conv}_HO", []).append((ref[msk], a))
    return G


def summarize(G):
    out = {}
    for g, parts in G.items():
        r = np.concatenate([p[0] for p in parts])
        a = {k: np.concatenate([p[1][k] for p in parts]) for k in parts[0][1]}
        for lo, hi in BANDS:
            b = (r >= lo) & (r < hi); n = int(b.sum())
            if not n: continue
            row = {"n": n, "post_ok": 100 * a["ok"][b].mean(), "paint_ok": 100 * a["pok"][b].mean()}
            for k in CATS[1:]:
                sel = b & (a["cat"] == k)
                row[k] = 100 * sel.sum() / n
                row[k + "|null"] = 100 * (sel & a["postnull"]).sum() / n
            row["disp_lost_blank"] = 100 * (b & a["ok"] & ~a["pok"] & a["pnull"]).sum() / n
            row["disp_lost_wrong"] = 100 * (b & a["ok"] & ~a["pok"] & ~a["pnull"]).sum() / n
            row["disp_gained"] = 100 * (b & ~a["ok"] & a["pok"]).sum() / n
            row["post_null"] = 100 * a["postnull"][b].mean()
            row["post_wrong"] = 100 - row["post_ok"] - row["post_null"]
            for w in ("trk", "rng", "grd", "veto"):
                for fl in ("flC", "flW", "flU", "flA"):
                    row[f"N:{w}/{fl}"] = 100 * float(np.sum(b & (a["nr"] == f"{w}/{fl}"))) / n
            mg = a["margin"][b & np.isin(a["cat"], ["B-sil", "B-thr"])]
            row["B_margin_q"] = [float(np.nanpercentile(mg, q)) for q in (10, 25, 50, 75, 90)] if len(mg) else None
            bthr = a["margin"][b & (a["cat"] == "B-thr")]
            row["B-thr_within"] = {str(d): 100 * float(np.sum(bthr <= d)) / n for d in (0.02, 0.04, 0.07, 0.10)} if len(bthr) else None
            out[f"{g}|{lo:g}-{hi:g}"] = row
    return out


if __name__ == "__main__":
    allres = {}
    for tag in TAGS:
        G = session_groups(tag)
        for c in ("fda", "ptdb", "hil", "voc"):
            G.update(corpus_groups(tag, c))
        allres[tag] = summarize(G)
    if "json" in A: json.dump(allres, open(A["json"], "w"), indent=1)
    keys = list(allres[TAGS[0]])
    hdr = ["n", "post_ok", "paint_ok"] + CATS[1:] + ["disp_lost_blank", "disp_lost_wrong", "disp_gained"]
    print("group|band".ljust(26) + " ".join(h[:8].rjust(8) for h in hdr))
    for k in keys:
        for tag in TAGS:
            row = allres[tag].get(k)
            if not row: continue
            print(f"{(k + ' ' + tag)[:26]:26s}" + " ".join((f"{row[h]:8.0f}" if h == "n" else f"{row[h]:8.2f}") for h in hdr))
    print("\nposted-null reasons (pp of band frames): chain end trk=tracker unvoiced, rng=above-range, grd=guard, "
          "veto=ghost veto; frame-local flC correct / flW voiced elsewhere / flU ref-candidate loses to uv / flA no candidate")
    for k in keys:
        for tag in TAGS:
            row = allres[tag].get(k)
            if not row: continue
            items = sorted(((v, kk[2:]) for kk, v in row.items() if kk.startswith("N:") and v >= 0.05), reverse=True)
            print(f"{(k + ' ' + tag)[:26]:26s} null {row['post_null']:5.2f} wrong {row['post_wrong']:5.2f} | " + " ".join(f"{kk}:{v:.2f}" for v, kk in items))
    print("\nnull share per stage (pp of band frames posted null) and B margins (uv - s_ref quantiles)")
    for k in keys:
        for tag in TAGS:
            row = allres[tag].get(k)
            if not row: continue
            print(f"{(k + ' ' + tag)[:26]:26s} " + " ".join(f"{c}:{row[c + '|null']:.2f}" for c in CATS[1:]) +
                  f"  Bq {['%.3f' % x for x in row['B_margin_q']] if row['B_margin_q'] else '-'}  Bthr<= {row['B-thr_within']}")
