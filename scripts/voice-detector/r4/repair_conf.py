# repair_conf.py — custom voice detector, round 4 (pre-registration
# measurements/voice-detector-round4-preregistration-2026-10-11.md §2.1): the
# blind repair of the sealed confirmatory set after the case-insensitive
# exclusion audit. DATA-STEP SCRIPT: it reads the sealed set's construction
# metadata (manifest, Freesound search / selection records, stream specs) and
# never an outcome (no dump, count or reference is read).
#
#   search   backs up round 3's dl/fs/candidates.json + selection.json to
#            dl/fs/r3/ (once), then re-runs fs_conf.py's search with the
#            corrected (fold_user) comparisons over the CACHED round-3 search
#            pages only (the round-3 plan incl. the trill fallback, §A.4 of
#            round 3); a page that is not cached is an error, never a fetch.
#            Writes the new candidates.json and dl/fs/r4-search-diff.json
#            (candidates removed / added against round 3)
#   drop     every KEPT confirmatory record that the case-insensitive audit
#            flags (exclude.json: Freesound id, uploader, group, LibriSpeech
#            speaker, SingBAP participant) gets a manifest drop record with the
#            reason, and its Freesound selection record (if any) the same drop;
#            then fs_conf.py select runs as in round 3 (the freed slots go to
#            the next eligible candidate in FNV order of the id)
#   affected the mixes (cmix20 / cmix0) and one-room sessions (csess) that use a
#            dropped record (construction metadata only) -> dl/fs/r4-affected.json
#
#   python scripts/voice-detector/r4/repair_conf.py search|drop|affected
import json
import os
import shutil
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, "..", "r3"))
from c3 import CDL, CONF, CManifest, fold_user, fold_users, load_exclude, log, write_json  # noqa: E402

FS = os.path.join(CDL, "fs")
BK = os.path.join(FS, "r3")
REASON = "round-4 §2.1: {why} (case-insensitive exclusion audit; exclude.json)"


def backup():
    os.makedirs(BK, exist_ok=True)
    for fn in ("candidates.json", "selection.json"):
        if not os.path.exists(os.path.join(BK, fn)):
            shutil.copy2(os.path.join(FS, fn), os.path.join(BK, fn))
            log("backed up", fn, "->", os.path.relpath(BK, CONF))


def search():
    backup()
    sys.argv = [sys.argv[0], "search", "--fallback=trills"]       # round 3 applied the trill fallback once (R3-A.4), never the NA one
    import fs_conf

    def offline_get(s, url, dest, min_bytes=1000, pause=1.5):
        if os.path.exists(dest) and os.path.getsize(dest) >= min_bytes:
            return dest
        raise IOError(f"not cached (round 4 §2.1 reads cached round-3 pages only): {os.path.relpath(dest, CONF)}")

    fs_conf.fs_get = offline_get
    fs_conf.A = {"fallback": "trills"}
    cp = os.path.join(FS, "candidates.json")
    os.replace(cp, cp + ".r4-pre")                 # a fresh run (the backup in dl/fs/r3/ is the round-3 file)
    try:
        fs_conf.search()
    except BaseException:
        os.replace(cp + ".r4-pre", cp)
        raise
    os.remove(cp + ".r4-pre")
    old = json.load(open(os.path.join(BK, "candidates.json"), encoding="utf8"))
    new = json.load(open(cp, encoding="utf8"))
    errs = {k: v for k, v in new["pages"].items() if "error" in v}
    gone = sorted(set(old["cands"]) - set(new["cands"]), key=int)
    added = sorted(set(new["cands"]) - set(old["cands"]), key=int)
    why = {str(r["id"]): r["why"] for r in new["rejected"]}
    D = {"pages_read": len(new["pages"]), "pages_round3": len(old["pages"]), "page_errors": errs,
         "removed": [dict(id=int(i), user=old["cands"][i]["user"], query=old["cands"][i]["query"], set=old["cands"][i]["set"], why=why.get(i)) for i in gone],
         "added": [dict(id=int(i), user=new["cands"][i]["user"], query=new["cands"][i]["query"], set=new["cands"][i]["set"]) for i in added],
         "changed_fields": [i for i in set(old["cands"]) & set(new["cands"]) if old["cands"][i] != new["cands"][i]]}
    write_json(os.path.join(FS, "r4-search-diff.json"), D, indent=1)
    log(f"search re-run on cached pages: {len(new['pages'])} pages ({len(errs)} errors), {len(new['cands'])} candidates "
        f"(round 3 {len(old['cands'])}); removed {D['removed']}; added {D['added']}; changed {len(D['changed_fields'])}")
    if errs:
        raise SystemExit("some round-3 pages are not cached; nothing may be fetched for this step")


def flags(r, ex):
    ex_ids, ex_ups, ex_g = set(int(i) for i in ex["freesound_ids"]), fold_users(ex["freesound_uploaders"]), fold_users(ex["groups"])
    sbs = {k: fold_users(map(str, v)) for k, v in ex["speakers_by_source"].items()}
    why = []
    if r.get("freesound_id") is not None and int(r["freesound_id"]) in ex_ids:
        why.append(f"Freesound id {r['freesound_id']} used before")
    if r.get("uploader") and fold_user(r["uploader"]) in ex_ups:
        why.append(f"uploader {r['uploader']} used before")
    if r.get("group") and fold_user(r["group"]) in ex_g:
        why.append(f"group {r['group']} used before")
    if r.get("source") == "c_ls" and r.get("speaker") is not None and fold_user(str(r["speaker"])) in sbs.get("librispeech", set()):
        why.append(f"LibriSpeech speaker {r['speaker']} used before")
    if r.get("source") == "c_sbi" and r.get("participant") is not None and fold_user(str(r["participant"])) in sbs.get("singbap", set()):
        why.append(f"SingBAP participant {r['participant']} used before")
    return why


def drop():
    backup()
    ex = load_exclude()
    man = CManifest()
    sp = os.path.join(FS, "selection.json")
    S = json.load(open(sp, encoding="utf8"))
    out = []
    for r in sorted(man.kept(), key=lambda r: r["id"]):
        why = flags(r, ex)
        if not why:
            continue
        reason = REASON.format(why="; ".join(why))
        man.add(dict(r, drop=reason))
        if r.get("freesound_id") is not None and str(r["freesound_id"]) in S["checked"]:
            S["checked"][str(r["freesound_id"])]["drop"] = reason
        out.append(dict(id=r["id"], source=r["source"], subset=r.get("subset"), group=r.get("group"), reason=reason))
        log("DROP", r["id"], reason)
    write_json(sp, S)
    write_json(os.path.join(FS, "r4-dropped.json"), out, indent=1)
    log(f"{len(out)} kept records dropped; running fs_conf.py select (round 3's procedure) for any freed slot")
    sys.argv = [sys.argv[0], "select"]
    import fs_conf
    before = {k for k, v in S["checked"].items()}
    fs_conf.select()
    S2 = json.load(open(sp, encoding="utf8"))
    newly = {k: v for k, v in S2["checked"].items() if k not in before}
    write_json(os.path.join(FS, "r4-select-new.json"), {k: {kk: v.get(kk) for kk in ("id", "user", "query", "set", "subset", "licence", "drop")}
                                                         for k, v in newly.items()}, indent=1)
    log(f"select after the drop: {len(newly)} newly checked candidates, {sum(not v.get('drop') for v in newly.values())} kept: "
        f"{[(k, v['query'], v.get('drop', 'KEPT')) for k, v in newly.items()]}")


def affected():
    dropped = {d["id"] for d in json.load(open(os.path.join(FS, "r4-dropped.json"), encoding="utf8"))}
    man = CManifest()
    groups = {man.have[i]["session_group"] for i in dropped if man.have[i].get("session_group")}
    out = {}
    for s in ("cmix20", "cmix0", "csess"):
        sp = json.load(open(os.path.join(CONF, "streams", f"{s}.json"), encoding="utf8"))
        out[s] = [x["id"] for x in sp if any(L["rec"] in dropped for L in x["meta"]["layers"])
                  or (s == "csess" and x["meta"].get("vgroup") in groups)]
    cv = json.load(open(os.path.join(CONF, "streams", "cvoice.json"), encoding="utf8"))
    out["cvoice"] = [x["id"] for x in cv if x["id"] in dropped]
    out["dropped"] = sorted(dropped)
    write_json(os.path.join(FS, "r4-affected.json"), out, indent=1)
    log("streams that use a dropped record:", {k: v for k, v in out.items()})


if __name__ == "__main__":
    {"search": search, "drop": drop, "affected": affected}[sys.argv[1]]()
