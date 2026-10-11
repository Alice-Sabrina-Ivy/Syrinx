# train_side.py — custom voice detector, round 3 (pre-registration §1.1,
# §1.6): the training side's exclusions of the sealed confirmatory set.
#
#   build   writes build/vad-train/r3/train_exclude.json: every confirmatory
#           source, voice group (speaker / singer / participant / uploader),
#           Freesound id and uploader, noise recording group (kept AND dropped
#           confirmatory records), and the confirmatory root path
#   check   proves the rounds 1-2 training + validation manifests share none of
#           them (by group, Freesound id and uploader, and by LibriSpeech /
#           SingBAP speaker id), and that no training / validation file lies
#           under the confirmatory root; lists every record that touches the
#           set, kept or dropped, and exits non-zero if a KEPT one does (a
#           dropped record is never packed for training or validation)
#
# Uploaders and group keys are compared case-insensitively (common.fold_user;
# round-4 pre-registration §1: FSD50K writes "quartzgate", the sound page
# "QuartzGate"). The stored lists keep the names as found.
#
# Round-3 training, validation and selection code calls filter_records() on
# every record list it reads and guard_not_conf() (c3.py) on every path.
#
#   python scripts/voice-detector/r3/train_side.py build|check
import json
import os
import sys

from c3 import CONF, DATA, R3, CManifest, fold_user, fold_users, guard_not_conf, load_manifest, log, write_json

P = os.path.join(R3, "train_exclude.json")


def build():
    man = CManifest()
    ex = {"conf_root": os.path.abspath(CONF), "sources": set(), "groups": set(), "freesound_ids": set(), "freesound_uploaders": set(),
          "librispeech_speakers": set(), "singbap_participants": set()}
    for r in man.have.values():
        ex["sources"].add(r["source"])
        if r.get("group"):
            ex["groups"].add(r["group"])
        if r.get("freesound_id") is not None:
            ex["freesound_ids"].add(int(r["freesound_id"]))
        if r.get("uploader"):
            ex["freesound_uploaders"].add(r["uploader"])
        if r["source"] == "c_ls" and r.get("speaker"):
            ex["librispeech_speakers"].add(r["speaker"])
        if r["source"] == "c_sbi" and r.get("participant"):
            ex["singbap_participants"].add(r["participant"])
    for sub in ("fs", "tr4_fs"):                  # every Freesound candidate the confirmatory searches read (kept or not; round 4: the trill search too)
        sel = os.path.join(CONF, "dl", sub, "candidates.json")
        if os.path.exists(sel):
            c = json.load(open(sel, encoding="utf8"))
            ex["freesound_ids"] |= {int(v["id"]) for v in c["cands"].values()}
            ex["freesound_uploaders"] |= {v["user"] for v in c["cands"].values()}
    out = {k: (sorted(v) if isinstance(v, set) else v) for k, v in ex.items()}
    write_json(P, out, indent=1)
    log("train_exclude.json:", {k: len(v) if isinstance(v, list) else v for k, v in out.items()})


def record_uploader(r):
    """A record's Freesound uploader: its `uploader` field, else the `freesound:<uploader>` group key."""
    if r.get("uploader"):
        return r["uploader"]
    g = r.get("group") or ""
    return g.split(":", 1)[1] if g.startswith("freesound:") else None


def touches(r, ex):
    """Why record r touches the excluded set ex (train_exclude.json form), or None. Case-insensitive on uploaders and groups."""
    if "_fold" not in ex:
        ex["_fold"] = dict(g=fold_users(ex["groups"]), ids=set(int(i) for i in ex["freesound_ids"]), ups=fold_users(ex["freesound_uploaders"]),
                           ls=fold_users(map(str, ex["librispeech_speakers"])), sb=fold_users(map(str, ex["singbap_participants"])))
    F = ex["_fold"]
    u = record_uploader(r)
    if r.get("group") and fold_user(r["group"]) in F["g"]:
        return f"group {r['group']}"
    if r.get("freesound_id") is not None and int(r["freesound_id"]) in F["ids"]:
        return f"Freesound id {r['freesound_id']}"
    if u and fold_user(u) in F["ups"]:
        return f"uploader {u}"
    if r.get("source") == "librispeech" and r.get("speaker") is not None and fold_user(str(r["speaker"])) in F["ls"]:
        return f"LibriSpeech speaker {r['speaker']}"
    if r.get("source") == "singbap" and r.get("participant") is not None and fold_user(str(r["participant"])) in F["sb"]:
        return f"SingBAP participant {r['participant']}"
    return None


def filter_records(recs, ex=None):
    """Round-3/4 training / validation: drop any record that touches the confirmatory set."""
    ex = ex or json.load(open(P, encoding="utf8"))
    out = []
    for r in recs:
        if touches(r, ex):
            continue
        if r.get("path"):
            guard_not_conf(os.path.join(DATA, r["path"]))
        out.append(r)
    return out


def check():
    man = load_manifest()
    recs = list(man.values())
    ex = json.load(open(P, encoding="utf8"))
    bad = [(r, touches(r, ex)) for r in recs]
    bad = [(r, w) for r, w in bad if w]
    used = [(r, w) for r, w in bad if not r.get("drop")]
    log(f"rounds 1-2 manifests: {len(recs)} records, {len(bad)} touch the confirmatory set ({len(used)} kept, {len(bad) - len(used)} dropped)")
    for r, w in bad:
        print(f"  OVERLAP {r['id']} ({r.get('split')}; {'KEPT' if not r.get('drop') else 'dropped: ' + r['drop']}): {w}")
    sys.exit(1 if used else 0)


if __name__ == "__main__":
    {"build": build, "check": check}[sys.argv[1]]()
