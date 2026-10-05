# table.py BASE TAG... — the guard table of the low-register voicing pass
# (2026-10-04): lowband_score.py metrics (cached per tag in
# build/score_cache2) as deltas vs BASE, plus noise-fv.mjs noise-only
# posted / painted rates. Run from the repo root.
import sys, os, json
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."))
os.environ.setdefault("PITCH_BENCH_DIR", "build/pb")
tags = [a for a in sys.argv[1:] if not a.startswith("--")]
sys.argv = [sys.argv[0]] + tags
import lowband_score as ls
cache = "build/score_cache2"
os.makedirs(cache, exist_ok=True)
R = {}
for t in tags:
    p = f"{cache}/{t}.json"
    src = f"build/session-oracle/attr/{t}/sessions/2026-06-09.f32"
    if os.path.exists(p) and os.path.getmtime(p) > os.path.getmtime(src):
        R[t] = json.load(open(p))
    else:
        R[t] = ls.summarize(ls.collect(t)); json.dump(R[t], open(p, "w"))
NFD = "build/session-oracle/noisefv4" if all(os.path.exists(f"build/session-oracle/noisefv4/{t}.json") for t in tags) else "build/session-oracle/noisefv"
print("noise dir", NFD)
NF = {t: json.load(open(f"{NFD}/{t}.json")) for t in tags if os.path.exists(f"{NFD}/{t}.json")}
rows = [
    ("Alice cons 75-160 post C5", "alice_cons|post|75-160", "C5"),
    ("Alice cons 75-160 post null", "alice_cons|post|75-160", "null"),
    ("Alice cons 75-160 post up", "alice_cons|post|75-160", "up"),
    ("Alice cons 75-160 paint C5", "alice_cons|paint|75-160", "C5"),
    ("Alice cons 75-160 paint up", "alice_cons|paint|75-160", "up"),
    ("Alice strict 75-160 post C5", "alice_strict|post|75-160", "C5"),
    ("Alice strict 75-160 post up", "alice_strict|post|75-160", "up"),
    ("Alice strict 75-160 paint up", "alice_strict|paint|75-160", "up"),
    ("Alice HO 75-160 post C5", "alice_cons_HO|post|75-160", "C5"),
    ("Alice cons 160-400 post C5", "alice_cons|post|160-400", "C5"),
    ("Alice cons 160-400 post dn", "alice_cons|post|160-400", "down"),
    ("Alice cons 160-400 paint C5", "alice_cons|paint|160-400", "C5"),
    ("Alice cons 160-400 paint dn", "alice_cons|paint|160-400", "down"),
    ("Alice HO 160-400 post C5", "alice_cons_HO|post|160-400", "C5"),
    ("Alice HO 160-400 post dn", "alice_cons_HO|post|160-400", "down"),
    ("Alice HO 160-400 paint C5", "alice_cons_HO|paint|160-400", "C5"),
    ("Alice HO 160-400 paint dn", "alice_cons_HO|paint|160-400", "down"),
    ("Alice cons 160-400 paint null", "alice_cons|paint|160-400", "null"),
    ("Alice cons 160-400 post up", "alice_cons|post|160-400", "up"),
    ("Alice strict 160-400 post C5", "alice_strict|post|160-400", "C5"),
    ("Alice strict 160-400 paint C5", "alice_strict|paint|160-400", "C5"),
    ("Alice strict 160-400 paint dn", "alice_strict|paint|160-400", "down"),
    ("second voice 75-160 post C5", "second_cons|post|75-160", "C5"),
    ("second voice 75-160 paint C5", "second_cons|paint|75-160", "C5"),
    ("second voice 75-160 post up", "second_cons|post|75-160", "up"),
    ("second voice 160-400 post C5", "second_cons|post|160-400", "C5"),
    ("second voice 160-400 post dn", "second_cons|post|160-400", "down"),
    ("second voice 160-400 paint C5", "second_cons|paint|160-400", "C5"),
    ("second voice HO 160-400 post dn", "second_cons_HO|post|160-400", "down"),
]
for cp in ("fda", "ptdb"):
    for g in ("m", "f"):
        rows += [(f"{cp}_{g} 75-160 post C5", f"{cp}_{g}|post|75-160", "C5"),
                 (f"{cp}_{g} 75-160 post RPA", f"{cp}_{g}|post|75-160", "RPA"),
                 (f"{cp}_{g} all post C5", f"{cp}_{g}|post|all", "C5"),
                 (f"{cp}_{g} all post VDE", f"{cp}_{g}|post|all", "VDE"),
                 (f"{cp}_{g} all post FV", f"{cp}_{g}|post|all", "FV"),
                 (f"{cp}_{g} all post up", f"{cp}_{g}|post|all", "up"),
                 (f"{cp}_{g} all post dn", f"{cp}_{g}|post|all", "down"),
                 (f"{cp}_{g} all paint C5", f"{cp}_{g}|paint|all", "C5"),
                 (f"{cp}_{g} all paint VDE", f"{cp}_{g}|paint|all", "VDE")]
    rows.append((f"{cp} maxerr post", f"{cp}|post|maxerr", "C5"))
    rows.append((f"{cp} maxerr paint", f"{cp}|paint|maxerr", "C5"))
for g in ("m", "f"):
    rows += [(f"hil_{g} all post C5", f"hil_{g}|post|all", "C5"), (f"hil_{g} all post up", f"hil_{g}|post|all", "up"), (f"hil_{g} all post dn", f"hil_{g}|post|all", "down"), (f"hil_{g} all paint C5", f"hil_{g}|paint|all", "C5")]
rows += [("Alice cons 400+ post dn", "alice_cons|post|400+", "down"), ("Alice cons 400+ paint dn", "alice_cons|paint|400+", "down"), ("Alice cons 400+ paint other", "alice_cons|paint|400+", "other"), ("voc 400+ post dn", "voc|post|400+", "down"), ("voc 400+ paint dn", "voc|paint|400+", "down"), ("voc 400+ paint other", "voc|paint|400+", "other")]
rows += [("voc all post C5", "voc|post|all", "C5"), ("voc all post VDE", "voc|post|all", "VDE"), ("voc all post dn", "voc|post|all", "down"), ("voc all paint C5", "voc|paint|all", "C5"), ("voc 75-160 post C5", "voc|post|75-160", "C5")]
b = tags[0]
print(f"{'metric':32s} {b:>9s} " + " ".join(f"{t:>9s}" for t in tags[1:]))
for lab, k, m in rows:
    x = R[b].get(k, {}).get(m)
    if x is None: continue
    print(f"{lab:32s} {x:9.2f} " + " ".join(f"{(R[t].get(k, {}).get(m) or 0) - x:+9.2f}" for t in tags[1:]))
if NF:
    print("noise-only posted/painted %")
    for nz in NF[b]:
        if nz == "babble": continue
        print(f"  {nz:18s} " + " ".join(f"{t}:{NF[t][nz]['posted']:.2f}/{NF[t][nz]['painted']:.2f}" for t in tags if t in NF))
