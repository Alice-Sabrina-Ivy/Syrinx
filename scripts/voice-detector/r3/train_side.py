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
#           under the confirmatory root; exits non-zero otherwise
#
# Round-3 training, validation and selection code calls filter_records() on
# every record list it reads and guard_not_conf() (c3.py) on every path.
#
#   python scripts/voice-detector/r3/train_side.py build|check
import json
import os
import sys

from c3 import CONF, DATA, R3, CManifest, guard_not_conf, load_manifest, log, write_json

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
    sel = os.path.join(CONF, "dl", "fs", "candidates.json")
    if os.path.exists(sel):                       # every Freesound result the confirmatory search read (kept or not)
        c = json.load(open(sel, encoding="utf8"))
        ex["freesound_ids"] |= {int(v["id"]) for v in c["cands"].values()}
        ex["freesound_uploaders"] |= {v["user"] for v in c["cands"].values()}
    out = {k: (sorted(v) if isinstance(v, set) else v) for k, v in ex.items()}
    write_json(P, out, indent=1)
    log("train_exclude.json:", {k: len(v) if isinstance(v, list) else v for k, v in out.items()})


def filter_records(recs, ex=None):
    """Round-3 training / validation: drop any record that touches the confirmatory set."""
    ex = ex or json.load(open(P, encoding="utf8"))
    g, ids, ups = set(ex["groups"]), set(ex["freesound_ids"]), set(ex["freesound_uploaders"])
    ls, sb = set(ex["librispeech_speakers"]), set(ex["singbap_participants"])
    out = []
    for r in recs:
        if (r.get("group") in g or (r.get("freesound_id") is not None and int(r["freesound_id"]) in ids) or r.get("uploader") in ups
                or (r.get("source") == "librispeech" and r.get("speaker") in ls) or (r.get("source") == "singbap" and r.get("participant") in sb)):
            continue
        if r.get("path"):
            guard_not_conf(os.path.join(DATA, r["path"]))
        out.append(r)
    return out


def check():
    man = load_manifest()
    recs = list(man.values())
    kept = filter_records(recs)
    keep_ids = {r["id"] for r in kept}
    bad = [r["id"] for r in recs if r["id"] not in keep_ids]
    log(f"rounds 1-2 manifests: {len(recs)} records, {len(bad)} touch the confirmatory set")
    for b in bad[:20]:
        print("  OVERLAP", b)
    sys.exit(1 if bad else 0)


if __name__ == "__main__":
    {"build": build, "check": check}[sys.argv[1]]()
