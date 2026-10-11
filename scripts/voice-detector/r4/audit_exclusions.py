# audit_exclusions.py — custom voice detector, round 4 (pre-registration
# measurements/voice-detector-round4-preregistration-2026-10-11.md §1): the
# exclusion audit after the round-3 review found that uploader names were
# compared case-sensitively (FSD50K metadata writes "quartzgate", the Freesound
# sound page "QuartzGate").
#
#   --selftest   unit check: common.fold_user, train_side.touches /
#                filter_records on mixed-case records, and a static check that
#                no exclusion script still compares raw uploader names
#   (default)    the audit, every comparison through common.fold_user:
#     A  the sealed confirmatory set (conf/manifest.jsonl METADATA only: ids,
#        groups, uploaders; no audio, reference, dump or count is read) against
#        r3/exclude.json (§1.1 of round 3): Freesound id, uploader, group,
#        LibriSpeech speaker, SingBAP participant; the <= 2 clips per uploader
#        cap; the Freesound search candidates and selection whose uploader is
#        excluded
#     B  the rounds 1-2 manifests (the round-3 training and validation records,
#        kept and dropped) against r3/train_exclude.json (train_side.touches)
#     C  the train / val split by Freesound uploader across every Freesound
#        source (kept records): uploaders on both sides, flagged "case" when
#        the sides' spellings differ (the fstrain rule of round 1 §2.2 says an
#        uploader of FSD50K eval is val) and "as written" otherwise (round 2's
#        fsvoice split is its own FNV rule, independent of FSD50K)
#     D  kept rounds 1-2 records whose uploader equals, ONLY by letter case, a
#        name the rounds 1-2 uploader rules excluded (reconstructed: uploaders
#        of the "benchmark ... uploader" drops and download-index skips, the
#        review-probe skips, plus every r3/exclude.json uploader that no rounds
#        1-2 record or index carries). An exact-case match was already handled
#        by the old rules as written (the review-probe uploader rule covers
#        round-2 voice positives only, so e.g. a probe uploader's FSD50K
#        negatives stay); only a case variant can have slipped through.
#   Writes build/vad-train/r4/audit-exclusions.json; prints every violation.
#
#   python scripts/voice-detector/r4/audit_exclusions.py [--selftest]
import collections
import json
import os
import re
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, "..", "r3"))
from c3 import CONF, DL, ROOT, CManifest, args, fold_user, fold_users, load_exclude, load_manifest, log, write_json  # noqa: E402
import train_side  # noqa: E402

A = args()
OUT = os.path.join(ROOT, "r4", "audit-exclusions.json")
RX_PEOPLE = re.compile(r"freesound\.org/people/([^/]+)/")


def conf_uploader(r):
    if r.get("uploader"):
        return r["uploader"]
    m = RX_PEOPLE.search(r.get("url") or "")
    return m.group(1) if m else None


# ----------------------------------------------------------------------------- unit check
def selftest():
    bad = []

    def ok(cond, what):
        if not cond:
            bad.append(what)

    ok(fold_user("QuartzGate") == fold_user("quartzgate") == "quartzgate", "fold_user: ASCII case")
    ok(fold_user("  Antwash ") == fold_user("antwash"), "fold_user: surrounding space")
    ok(fold_user("ＶＩＮＴ") == fold_user("vint"), "fold_user: NFKC full-width")
    ok(fold_user("Straße") == fold_user("STRASSE"), "fold_user: casefold (not lower)")
    ok(fold_user("abc") != fold_user("abd"), "fold_user: distinct names stay distinct")
    ok(fold_user(None) == "" and fold_users(["A", None, "", "a"]) == {"a"}, "fold_users: None / empty skipped, case merged")
    ex = {"groups": ["c_fsv:QuartzGate"], "freesound_ids": [716881], "freesound_uploaders": ["QuartzGate"],
          "librispeech_speakers": ["1234"], "singbap_participants": ["P07"]}
    recs = [
        dict(id="a", source="fsd50k", group="freesound:quartzgate", uploader="quartzgate", freesound_id=176159),   # case variant, uploader field
        dict(id="b", source="fstrain", group="freesound:QUARTZGATE", freesound_id=1),                             # case variant, group key only
        dict(id="c", source="fsd50k", group="freesound:someone", uploader="someone", freesound_id=716881),        # id
        dict(id="d", source="x", group="C_FSV:quartzgate"),                                                      # group, case variant
        dict(id="e", source="librispeech", group="librispeech:1234", speaker=1234),                              # speaker (int vs str)
        dict(id="f", source="singbap", group="singbap:p07", participant="p07"),                                  # participant, case
        dict(id="g", source="fsd50k", group="freesound:quartzgates", uploader="quartzgates", freesound_id=2),     # NOT the same uploader
        dict(id="h", source="librispeech", group="librispeech:12345", speaker="12345"),                          # NOT the same speaker
    ]
    hit = {r["id"]: train_side.touches(r, dict(ex)) for r in recs}
    for k in "abcdef":
        ok(hit[k] is not None, f"train_side.touches: record {k} must be excluded")
    for k in "gh":
        ok(hit[k] is None, f"train_side.touches: record {k} must NOT be excluded")
    kept = {r["id"] for r in train_side.filter_records(recs, dict(ex))}
    ok(kept == {"g", "h"}, f"train_side.filter_records keeps only g, h (got {sorted(kept)})")
    # static check: no exclusion script compares a raw uploader name with `in` / `==`
    files = ["custom/fetch_fstrain.py", "custom/fetch_r2.py", "custom/prepare.py", "custom/dedup.py", "r3/fs_conf.py", "r3/train_side.py",
             "r4/audit_exclusions.py"]
    raw = re.compile(r"""(\[["'](user|uploader)["']\]|\.get\(["'](user|uploader)["']\))\s*(not\s+)?(in\b|==|!=)""")
    for f in files:
        for i, line in enumerate(open(os.path.join(HERE, "..", f), encoding="utf8"), 1):
            if raw.search(line) and "fold_user(" not in line and "noqa: raw-user" not in line:
                bad.append(f"{f}:{i}: raw uploader comparison: {line.strip()}")
    for b in bad:
        print("FAIL", b)
    print(f"selftest: {'PASS' if not bad else 'FAIL'} ({len(bad)} failures)")
    sys.exit(1 if bad else 0)


# ----------------------------------------------------------------------------- audit
def audit():
    res = {"_what": "round-4 exclusion audit (pre-registration §1); every uploader / group comparison case-insensitive (common.fold_user)"}
    ex = load_exclude()
    ex_ids, ex_ups, ex_g = set(int(i) for i in ex["freesound_ids"]), fold_users(ex["freesound_uploaders"]), fold_users(ex["groups"])
    ex_raw = set(ex["freesound_uploaders"])
    sbs = {k: fold_users(map(str, v)) for k, v in ex["speakers_by_source"].items()}

    # A. sealed set (metadata only)
    man = CManifest()
    A_ = []
    for r in man.have.values():
        u, why = conf_uploader(r), []
        if r.get("freesound_id") is not None and int(r["freesound_id"]) in ex_ids:
            why.append(f"Freesound id {r['freesound_id']} used before")
        if u and fold_user(u) in ex_ups:
            why.append(f"uploader {u} used before" + ("" if u in ex_raw else " (only as a case variant: " +
                                                       ", ".join(sorted(x for x in ex_raw if fold_user(x) == fold_user(u))) + ")"))
        if r.get("group") and fold_user(r["group"]) in ex_g:
            why.append(f"group {r['group']} used before")
        if r.get("source") == "c_ls" and r.get("speaker") is not None and fold_user(str(r["speaker"])) in sbs.get("librispeech", set()):
            why.append(f"LibriSpeech speaker {r['speaker']} used before")
        if r.get("source") == "c_sbi" and r.get("participant") is not None and fold_user(str(r["participant"])) in sbs.get("singbap", set()):
            why.append(f"SingBAP participant {r['participant']} used before")
        if why:
            A_.append(dict(id=r["id"], source=r["source"], subset=r.get("subset"), group=r.get("group"), session_group=r.get("session_group"),
                           kept=not r.get("drop"), why=why))
    caps = collections.Counter(fold_user(conf_uploader(r)) for r in man.kept() if conf_uploader(r))
    over = {k: n for k, n in caps.items() if n > 2}
    cp, sp = os.path.join(CONF, "dl", "fs", "candidates.json"), os.path.join(CONF, "dl", "fs", "selection.json")
    cand_bad, sel_bad = [], []
    if os.path.exists(cp):
        for v in json.load(open(cp, encoding="utf8"))["cands"].values():
            if fold_user(v["user"]) in ex_ups:
                cand_bad.append(dict(id=v["id"], user=v["user"], set=v["set"], query=v["query"]))
    if os.path.exists(sp):
        for k, v in json.load(open(sp, encoding="utf8"))["checked"].items():
            if fold_user(v["user"]) in ex_ups:
                sel_bad.append(dict(id=int(k), user=v["user"], query=v["query"], outcome=v.get("drop", "KEPT")))
    res["A_sealed_set"] = dict(records=len(man.have), kept=len(man.kept()), violations=A_, uploader_cap_over_2=over,
                               search_candidates_with_excluded_uploader=cand_bad, selection_with_excluded_uploader=sel_bad)

    # B. rounds 1-2 manifests (round-3 training / validation records) vs the confirmatory set
    recs = list(load_manifest().values())
    te = json.load(open(train_side.P, encoding="utf8"))
    B_ = []
    for r in recs:
        w = train_side.touches(r, te)
        if w:
            B_.append(dict(id=r["id"], source=r["source"], split=r.get("split"), licence=r.get("licence"), kept=not r.get("drop"),
                           drop=r.get("drop"), why=w))
    res["B_training_vs_sealed"] = dict(records=len(recs), touching=len(B_), touching_kept=sum(b["kept"] for b in B_), list=B_)

    # C. train / val split by Freesound uploader (kept records)
    up = train_side.record_uploader
    sides = collections.defaultdict(lambda: collections.defaultdict(list))
    for r in recs:
        if not r.get("drop") and up(r) and r.get("split") in ("train", "val"):
            sides[fold_user(up(r))][r["split"]].append(r)
    C_ = []
    for k, s in sorted(sides.items()):
        if s["train"] and s["val"]:
            names = {sd: sorted({up(r) for r in s[sd]}) for sd in ("train", "val")}
            srcs = {sd: dict(collections.Counter(r["source"] for r in s[sd])) for sd in ("train", "val")}
            kind = "case" if not set(names["train"]) & set(names["val"]) else "as written"
            C_.append(dict(uploader=k, kind=kind, names=names, sources=srcs, train_ids=sorted(r["id"] for r in s["train"])))
    res["C_split_by_uploader"] = dict(both_sides=len(C_), case=sum(c["kind"] == "case" for c in C_),
                                      training_records_of_shared_uploaders=sum(len(c["train_ids"]) for c in C_), list=C_)

    # D. kept rounds 1-2 records vs benchmark / probe uploaders (reconstructed)
    data_ups = {up(r) for r in recs if up(r)}
    bench = {up(r) for r in recs if r.get("drop") and "benchmark" in r["drop"] and "uploader" in r["drop"] and up(r)}
    for sub in ("fstrain", "fsvoice"):
        p = os.path.join(DL, sub, "index.json")
        if os.path.exists(p):
            j = json.load(open(p, encoding="utf8"))
            data_ups |= {r["user"] for r in j["kept"]}
            bench |= {r["user"] for r in j["skipped"] if r.get("user") and re.search(r"benchmark uploader|review probe", r.get("why") or "")}
    bench |= {u for u in ex_raw if u not in data_ups}
    bf = collections.defaultdict(set)
    for u in bench:
        bf[fold_user(u)].add(u)
    D_, n_exact = [], 0
    for r in recs:
        u = up(r)
        if not r.get("drop") and u and fold_user(u) in bf:
            if u in bf[fold_user(u)]:
                n_exact += 1
            else:
                D_.append(dict(id=r["id"], source=r["source"], split=r.get("split"), uploader=u, excluded_as=sorted(bf[fold_user(u)])))
    res["D_training_vs_excluded_uploaders"] = dict(reference_uploaders=len(bench), kept_records_case_variant=D_, kept_records_exact_name=n_exact)

    write_json(OUT, res, indent=1)
    P = print
    P(f"A sealed set: {len(man.have)} records ({len(man.kept())} kept); violations {len(A_)}")
    for a in A_:
        P(f"   {a['id']} [{'KEPT' if a['kept'] else 'dropped'}; {a['source']} {a['subset']}; session group {a['session_group']}]: {'; '.join(a['why'])}")
    P(f"   uploader cap > 2: {over or 'none'}; search candidates with an excluded uploader: {cand_bad}; selected: {sel_bad}")
    P(f"B rounds 1-2 records touching the sealed set: {len(B_)} ({sum(b['kept'] for b in B_)} kept)")
    for b in B_:
        P(f"   {b['id']} [{b['split']}; {'KEPT' if b['kept'] else 'dropped: ' + b['drop']}]: {b['why']}")
    P(f"C Freesound uploaders with kept records on both train and val: {len(C_)} ({sum(c['kind'] == 'case' for c in C_)} from letter case)")
    for c in C_:
        P(f"   {c['uploader']} [{c['kind']}]: train {c['sources']['train']} as {c['names']['train']}; val {c['sources']['val']} as {c['names']['val']}")
    P(f"D kept records whose uploader matches an excluded name only by letter case ({len(bench)} reference names): {len(D_)} "
      f"(exact-name matches, handled as written: {n_exact})")
    for d in D_:
        P(f"   {d}")
    log("wrote", OUT)


if __name__ == "__main__":
    selftest() if "selftest" in A else audit()
