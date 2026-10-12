# trills_r5.py — custom voice detector, round 5 (pre-registration
# measurements/voice-detector-round5-preregistration-2026-10-12.md §1,
# Addendum R5-A = R4-A'): the user's trills ruling, applied blind.
# DATA-STEP SCRIPT on the sealed side: it reads construction metadata, the
# round-4 search records and (via trills.py count) only the aggregate
# current-app count of the trills / other-SOVT rows. No model of any round
# runs here; nobody listens to, plots or scores a clip.
#
#   drop      c_tr4_wc__a488f3b5 (the 1885 Volta recording) -> manifest drop
#             record with the user's reason; its tr4_wc selection record gets
#             the same drop and its contributor group is banned from the rest of
#             the search -> build/vad-train/r5/trill-drop.json
#   people    the extended new-people list of §1.2 (fold_user keys) ->
#             build/vad-train/r5/people-exclude.json: r3/exclude.json,
#             r3/train_exclude.json (round 4), the round-3 Commons IPA
#             contributors, every round-4 trill source (kept or dropped,
#             incl. the dropped clip's contributor), and every round-4
#             training person (fsr4 uploaders; every uploader, speaker,
#             participant or group in r4/d1.json train_ids)
#   ds-scan   source c_tr4_ds step 1 (trills.py ds-scan; metadata only)
#   ds-cands  the dataset records whose metadata or file names carry the trill
#             / other-SOVT pattern, with their creators / participant schemes
#             (metadata only) -> tr4_ds/ds-cands.json; the plan (ds-plan.json)
#             is written from it and into Addendum R5-A before any audio of a
#             record is decoded
#   ds        source c_tr4_ds step 2 (trills.py ds with the extended people check)
#   ia        source c_tr4_ia (trills.py ia with the extended people check)
#   prepare   trills.py prepare --source=...
#   count     trills.py count (history -> build/vad-train/r5/trills-counts.jsonl)
#
#   python scripts/voice-detector/r5/trills_r5.py drop|people|ds-scan|ds-cands|ds|ia|prepare --source=..|count
import collections
import json
import os
import re
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, "..", "r4"))
sys.path.insert(0, os.path.join(HERE, "..", "r3"))
sys.path.insert(0, os.path.join(HERE, "..", "custom"))
import trills  # noqa: E402
from c3 import CDL, CONF, R3, ROOT, CManifest, fnv1a, fold_user, fold_users, load_manifest, log, write_json  # noqa: E402

R5 = os.path.join(ROOT, "r5")
DROP_ID = "c_tr4_wc__a488f3b5"
DROP_REASON = ("dropped by the user's ruling 2026-10-12: Volta Laboratory recording, trill label from a description of test phrases, "
               "not a trill exercise (round-5 pre-registration §1.1, Addendum R5-A)")
PEOPLE = os.path.join(R5, "people-exclude.json")


def drop():
    man = CManifest()
    r = man.have[DROP_ID]
    if r.get("drop"):
        log("already dropped:", r["drop"])
    else:
        man.add(dict(r, drop=DROP_REASON))
    sp = os.path.join(CDL, "tr4_wc", "selection.json")
    S = json.load(open(sp, encoding="utf8"))
    hit = [k for k, v in S["checked"].items() if v["cid"] == DROP_ID]
    assert len(hit) == 1
    S["checked"][hit[0]]["drop"] = DROP_REASON
    S["banned"] = sorted(set(S["banned"]) | {fold_user(r["group"])})
    write_json(sp, S, indent=1)
    write_json(os.path.join(R5, "trill-drop.json"), {"dropped": DROP_ID, "group_banned": r["group"], "reason": DROP_REASON,
                                                      "in_mixes_or_sessions": False}, indent=1)
    log("dropped", DROP_ID, "; group banned:", r["group"])


def _wc_people():
    """(names, anon groups) of every round-4 Commons item checked (kept or dropped)."""
    C = json.load(open(os.path.join(CDL, "tr4_wc", "candidates.json"), encoding="utf8"))
    S = json.load(open(os.path.join(CDL, "tr4_wc", "selection.json"), encoding="utf8"))
    names, groups = set(), set()
    for t, v in C["info"].items():
        if t not in S["checked"]:
            continue
        who = re.sub(r"\s*\(talk.*$", "", v.get("artist") or "").strip() or (v.get("uploader") or "")
        for n in (who, v.get("uploader")):
            if n:
                names.add(n)
        groups.add(S["checked"][t]["group"])
    return names, groups


def people():
    ex = json.load(open(os.path.join(R3, "exclude.json"), encoding="utf8"))
    te = json.load(open(os.path.join(R3, "train_exclude.json"), encoding="utf8"))
    cat = collections.OrderedDict()
    cat["exclude.json"] = fold_users(ex["freesound_uploaders"]) | fold_users(ex["groups"]) | fold_users(g.split(":", 1)[1] for g in ex["groups"] if ":" in g)
    cat["train_exclude.json"] = (fold_users(te["freesound_uploaders"]) | fold_users(te["groups"]) | fold_users(g.split(":", 1)[1] for g in te["groups"] if ":" in g)
                                 | fold_users(map(str, te["librispeech_speakers"])) | fold_users(map(str, te["singbap_participants"])))
    ipa = json.load(open(os.path.join(CDL, "ipa", "commons.json"), encoding="utf8"))
    cat["round3_commons_ipa"] = fold_users(re.sub(r"\s*\(talk.*$", "", v["artist"]).strip() for v in ipa.values())
    fsc = json.load(open(os.path.join(CDL, "tr4_fs", "candidates.json"), encoding="utf8"))
    wn, wg = _wc_people()
    cat["round4_trill_sources"] = (fold_users(v["user"] for v in fsc["cands"].values()) | fold_users(v["user"] for v in fsc["rejected"])
                                   | fold_users(wn) | fold_users(wg))
    import train_side
    man = load_manifest()
    d1 = json.load(open(os.path.join(ROOT, "r4", "d1.json"), encoding="utf8"))
    f4 = [json.loads(line) for line in open(os.path.join(ROOT, "r4", "data", "manifest.fsr4.jsonl"), encoding="utf8") if line.strip()]
    f4m = {r["id"]: r for r in f4}
    tp = set()
    for i in d1["train_ids"]:
        r = man.get(i) or f4m.get(i)
        if r is None:
            raise SystemExit(f"training id {i} not in any manifest")
        for k in ("uploader", "speaker", "participant", "group"):
            if r.get(k):
                tp.add(str(r[k]))
        u = train_side.record_uploader(r)
        if u:
            tp.add(u)
        g = r.get("group") or ""
        if ":" in g:
            tp.add(g.split(":", 1)[1])
    tp |= {r["uploader"] for r in f4 if r.get("uploader")}
    cat["round4_training_people"] = fold_users(tp)
    allk = set().union(*cat.values())
    J = {"what": "round-5 §1.2 extended new-people list (fold_user keys); a name, uploader, contributor, speaker or participant of a new trill "
                 "clip is excluded if its key is in `keys`", "counts": {k: len(v) for k, v in cat.items()}, "n_keys": len(allk),
         "keys": sorted(allk)}
    write_json(PEOPLE, J)
    log("people-exclude:", J["counts"], "total", len(allk))


def _patch_ctx():
    P = set(json.load(open(PEOPLE, encoding="utf8"))["keys"])
    orig = trills.Ctx.__init__

    def init(self):
        orig(self)
        self.ex_people |= P

    trills.Ctx.__init__ = init
    return P


DS_CREATOR_FIELDS = ("creators", "authors", "contributors")


def ds_cands():
    """Records of the scan whose metadata or file names carry the trill / other-SOVT pattern (metadata only)."""
    import requests
    R = json.load(open(os.path.join(CDL, "tr4_ds", "ds-scan.json"), encoding="utf8"))
    P = set(json.load(open(PEOPLE, encoding="utf8"))["keys"])
    out = {}
    for rid, r in sorted(R.items()):
        fl = r.get("files") or []
        aud = [f for f in fl if trills.DS_AUDIO.search(f["key"] or "")]
        arch = [f for f in fl if trills.DS_ARCH.search(f["key"] or "")]
        if not aud and not arch:
            continue
        meta_sub, meta_why = r["meta_label"]
        file_lab = {}
        for f in aud:
            s, w = trills.label_meta(re.sub(r"[_\-/.]+", " ", f["key"]))
            if s:
                file_lab[f["key"]] = (s, w)
        # creators (metadata only)
        creators = []
        try:
            if r["repo"] == "zenodo":
                j = requests.get(f"https://zenodo.org/api/records/{r['id']}", headers=trills.UA, timeout=60).json()
                creators = [c.get("name") for c in j.get("metadata", {}).get("creators", [])]
            elif r["repo"] == "figshare":
                j = requests.get(f"https://api.figshare.com/v2/articles/{r['id']}", headers=trills.UA, timeout=60).json()
                creators = [a.get("full_name") for a in j.get("authors", [])]
            elif r["repo"] == "dataverse":
                j = requests.get("https://dataverse.harvard.edu/api/datasets/:persistentId/", params={"persistentId": r["id"]}, headers=trills.UA, timeout=60).json()
                for blk in (((j.get("data") or {}).get("latestVersion") or {}).get("metadataBlocks") or {}).values():
                    for fd in blk.get("fields", []):
                        if fd.get("typeName") == "author":
                            creators += [a.get("authorName", {}).get("value") for a in fd.get("value", [])]
            elif r["repo"] == "osf":
                j = requests.get(f"https://api.osf.io/v2/nodes/{r['id']}/contributors/", headers=trills.UA, timeout=60).json()
                creators = [((d.get("embeds") or {}).get("users", {}).get("data", {}).get("attributes", {}) or {}).get("full_name") for d in j.get("data", [])]
        except Exception as e:  # noqa: BLE001
            creators = [f"(error: {e})"]
        creators = [c for c in creators if c]
        out[rid] = {"repo": r["repo"], "title": r["title"], "url": r["url"], "licence": r["licence"], "queries": r["queries"],
                    "meta_label": [meta_sub, meta_why], "n_audio": len(aud), "n_archives": len(arch), "bytes": r["bytes"],
                    "audio_files_labelled": len(file_lab), "file_label_examples": dict(list(file_lab.items())[:12]),
                    "archives": [{"key": f["key"], "size": f.get("size")} for f in arch][:20],
                    "creators": creators, "creators_excluded": [c for c in creators if fold_user(c) in P],
                    "description": (r.get("description") or "")[:1500], "keywords": r.get("keywords")}
    write_json(os.path.join(CDL, "tr4_ds", "ds-cands.json"), out, indent=1)
    for rid, v in out.items():
        log(f"{rid}: meta {v['meta_label'][0]} ({v['meta_label'][1]}); audio {v['n_audio']} ({v['audio_files_labelled']} labelled), archives {v['n_archives']}, "
            f"{v['bytes'] / 1e9:.2f} GB, licence {v['licence']!r}: {(v['title'] or '')[:80]}")
    log(f"ds-cands: {len(out)} records with audio files or archives")


def ds():
    _patch_ctx()
    trills.ds()


def ia():
    _patch_ctx()
    trills.ia()


def count():
    trills.R4 = R5
    os.makedirs(R5, exist_ok=True)
    trills.count()


if __name__ == "__main__":
    {"drop": drop, "people": people, "ds-scan": trills.ds_scan, "ds-cands": ds_cands, "ds": ds, "ia": ia, "prepare": trills.prepare,
     "count": count}[sys.argv[1]]()
