# disjoint_r6.py — custom voice detector, round 6 (pre-registration
# measurements/voice-detector-round6-preregistration-2026-10-13.md §1.2 items
# 4 and 5): blind checks of the Data step, run BEFORE any round-6 data is
# built. DATA-STEP SCRIPT: it reads metadata, the earlier-audio fingerprint
# index (r3/fp) and, through r4/sealfp.SealedIndex, only the sealed matcher's
# keep / drop decision (no sealed name, offset or score leaves r3/conf/).
# No model runs here. Reads earlier downloads (Freesound previews, VocalSet):
# run with `python -I`.
#
# Item 4 (no new training person): records the training lists round 6 starts
#   from (r4/d1.json train_ids, r5/d7a.json, the D7b bank) by sha256 and size.
# Item 5 (new validation material is disjoint from the sealed set and from
#   training): every real source that becomes a round-6 validation row and was
#   not a validation row before:
#     - fsnew: the round-4 review's kept unseen Freesound clips (20);
#     - VocalSet takes of the round-5 review's sess5 sessions and of the
#       round-3 review's one-room sessions;
#     - the round-3 review sessions' real beds (benchmark tuning-split clips).
#   Ids and uploaders / people (fold_user) against r3/exclude.json,
#   r3/train_exclude.json (the sealed side) and r4/d1.json (training);
#   fingerprints (custom/dedup.py, round-3 >= 3 s rule) against all earlier
#   audio (r3/fp) and against the sealed set (keep / drop only).
#   A match removes the clip from validation. Two kinds of hit are NOT matches
#   and are recorded as such (the pre-registration names these exact sources
#   as validation material, §2.2, §8.1; neither is training or sealed data):
#     - own-corpus hits: the earlier fingerprint is the same public item's
#       earlier non-training copy: for a VocalSet take, a review probe file or
#       harness long tone of the SAME singer (the take itself, a level / PSOLA /
#       technique copy of it, or the same singer's same exercise on another
#       vowel); for a benchmark tuning clip, the same clip's review copy or
#       benchmark file. Earlier items of the rounds 1-2 data (`data:`), another
#       singer or another source are never own-corpus;
#     - a VocalSet singer listed in exclude.json's bench_vocalset (the old
#       harness: the masking rule of §2.2 keeps its 399 takes out of every row).
#   Any other hit removes the clip. (A first run with a narrower own-copy rule,
#   which flagged the same singers' level-shifted / PSOLA review copies, is kept
#   as checks/disjoint.v1-narrow-identity.json.)
#
#   <venv python> -I scripts/voice-detector/r6/disjoint_r6.py  -> build/vad-train/r6/checks/disjoint.json
import collections
import glob
import hashlib
import json
import os
import re
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
for p in ("../r3", "../r4", "../custom"):
    sys.path.insert(0, os.path.abspath(os.path.join(HERE, p)))
from c3 import R3, ROOT, fold_user, fold_users, load_manifest, log, write_json  # noqa: E402

OUT = os.path.join(ROOT, "r6", "checks", "disjoint.json")
SCR = "C:/Users/Michael/AppData/Local/Temp/claude/c--Coding-Projects-Syrinx/12a8f6ba-d49c-4c27-bd93-69314577b2c1/scratchpad"
FSNEW = os.path.join(ROOT, "review-r4", "fsnew")
VS5 = os.path.join(ROOT, "r4", "dl", "vocalset", "audio", "FULL")                  # sess5 (round-5 review) takes
VS3 = os.path.join(SCR, "vad-train", "review-voice", "dl", "vocalset", "FULL")      # round-3 review sessions' takes
TUNE = os.path.join(SCR, "vad-train", "review-voice", "noise")                      # round-3 review sessions' real beds
SESS5_ORDER = ["scales/lip_trill", "arpeggios/lip_trill", "scales/straight", "arpeggios/straight", "long_tones/straight", "excerpts/straight"]
SESS3_ORDER = ["scales/lip_trill", "long_tones/trill", "scales/breathy", "scales/straight", "scales/slow_piano", "scales/slow_forte",
               "scales/vibrato", "arpeggios/vibrato", "arpeggios/belt", "scales/vocal_fry", "excerpts/spoken"]
SESS3_BEDS = ["116866", "177703", "351507", "124015", "377637"]


def sha(p):
    h = hashlib.sha256()
    with open(p, "rb") as f:
        for b in iter(lambda: f.read(1 << 20), b""):
            h.update(b)
    return h.hexdigest()


def item4():
    d1p = os.path.join(ROOT, "r4", "d1.json")
    d1 = json.load(open(d1p, encoding="utf8"))
    out = {"d1": {"path": "r4/d1.json", "sha256": sha(d1p), "train_ids": len(d1["train_ids"]), "train_exclude_sha256": d1["train_exclude_sha256"]},
           "d7a": {"path": "r5/d7a.json", "sha256": sha(os.path.join(ROOT, "r5", "d7a.json"))},
           "d7b": {"path": "train/vsynth_r5_train.npz", "sha256": sha(os.path.join(ROOT, "train", "vsynth_r5_train.npz"))},
           "round6_training_items_built": 0,
           "note": "round 6 adds no real training recording: at this check no round-6 training item exists; every later one is generated or "
                   "comes from these lists (pre-registration §1.2 item 4)"}
    return out, d1


def keysets(d1):
    ex = json.load(open(os.path.join(R3, "exclude.json"), encoding="utf8"))
    te = json.load(open(os.path.join(R3, "train_exclude.json"), encoding="utf8"))
    import train_side
    man = load_manifest()
    f4 = {json.loads(line)["id"]: json.loads(line) for line in open(os.path.join(ROOT, "r4", "data", "manifest.fsr4.jsonl"), encoding="utf8") if line.strip()}
    tr_people, tr_fsids = set(), set()
    for i in d1["train_ids"]:
        r = man.get(i) or f4.get(i)
        for k in ("uploader", "speaker", "participant", "group"):
            if r.get(k):
                tr_people.add(str(r[k]))
        u = train_side.record_uploader(r)
        if u:
            tr_people.add(u)
        g = r.get("group") or ""
        if ":" in g:
            tr_people.add(g.split(":", 1)[1])
        m = re.match(r"^(?:fsd50k|fstrain|fsvoice|fsr4)__(\d+)", i)
        if m:
            tr_fsids.add(int(m.group(1)))
        if r.get("freesound_id"):
            tr_fsids.add(int(r["freesound_id"]))
    K = {
        "exclude_ids": set(int(i) for i in ex["freesound_ids"]),
        "exclude_people": fold_users(ex["freesound_uploaders"]) | fold_users(ex["groups"]) | fold_users(g.split(":", 1)[1] for g in ex["groups"] if ":" in g),
        "exclude_speakers": {src: fold_users(map(str, v)) for src, v in ex["speakers_by_source"].items()},
        "sealed_ids": set(int(i) for i in te["freesound_ids"]),
        "sealed_people": (fold_users(te["freesound_uploaders"]) | fold_users(te["groups"]) | fold_users(g.split(":", 1)[1] for g in te["groups"] if ":" in g)
                          | fold_users(map(str, te["librispeech_speakers"])) | fold_users(map(str, te["singbap_participants"]))),
        "train_ids": tr_fsids,
        "train_people": fold_users(tr_people),
    }
    return K


def items():
    out = []
    S = json.load(open(os.path.join(FSNEW, "selection.json"), encoding="utf8"))
    for v in S["checked"].values():
        if v.get("drop"):
            continue
        out.append({"kind": "fsnew", "id": f"fsnew:{v['id']}", "fsid": int(v["id"]), "people": [v["user"]], "path": v["path"],
                    "title": v["title"], "query": v["query"], "tags": v.get("tags", []), "licence": v.get("licence")})
    for tag, root, order, first_only in (("sess5", VS5, SESS5_ORDER, False), ("sess3", VS3, SESS3_ORDER, True)):
        for singer in sorted(os.listdir(root)):
            for o in order:
                fs = sorted(glob.glob(os.path.join(root, singer, *o.split("/"), "*.wav")))
                for fp in (fs[:1] if first_only else fs):
                    out.append({"kind": "vocalset", "id": f"vocalset:{singer}/{o}/{os.path.basename(fp)}", "singer": singer, "tech": o,
                                "people": [singer], "path": fp, "used_by": tag})
    for b in SESS3_BEDS:
        p = os.path.join(TUNE, f"{b}_44100.wav")
        out.append({"kind": "tuning_bed", "id": f"tuning:{b}", "fsid": int(b), "people": [], "path": p, "used_by": "sess3"})
    seen, uniq = set(), []
    for it in out:                      # a VocalSet take used by both review session sets is checked once per copy (two paths)
        k = (it["id"], it["path"])
        if k not in seen:
            seen.add(k)
            uniq.append(it)
    return uniq


def identity(it, name):
    """Is earlier-fingerprint `name` an own-corpus hit (module header)?"""
    if name is None:
        return False
    n = name.lower()
    if n.startswith("data:"):
        return False
    if it["kind"] == "vocalset":
        sg = it["singer"].lower()
        if not (n.startswith("probe:") or (n.startswith("bench:") and "vocalset__" in n)):
            return False
        return re.search(rf"(?<![a-z]){sg}[_/]", n) is not None
    if it["kind"] == "tuning_bed":
        return (n.startswith("bench:") or n.startswith("probe:")) and re.search(rf"(?<!\d){it['fsid']}(?!\d)", n) is not None
    return False


def main():
    from dedup import fingerprint, read16
    from fpindex import Index
    from sealfp import SealedIndex
    i4, d1 = item4()
    K = keysets(d1)
    its = items()
    log(f"item 5: {len(its)} items ({dict(collections.Counter(i['kind'] for i in its))}); loading the fingerprint indexes ...")
    E = Index()
    SI = SealedIndex()
    log("indexes loaded")
    res = []
    for it in its:
        r = {k: it[k] for k in ("kind", "id", "path") if k in it}
        for k in ("used_by", "title", "query", "tags", "licence"):
            if k in it:
                r[k] = it[k]
        hits, notes = [], []
        if it.get("fsid") is not None:
            if it["fsid"] in K["sealed_ids"]:
                hits.append("freesound id on the sealed side (train_exclude.json)")
            if it["fsid"] in K["train_ids"]:
                hits.append("freesound id in training (r4/d1.json)")
            if it["fsid"] in K["exclude_ids"]:
                (notes if it["kind"] == "tuning_bed" else hits).append("freesound id in exclude.json" + (" (benchmark tuning clip: expected)" if it["kind"] == "tuning_bed" else ""))
        for u in it["people"]:
            f = fold_user(u)
            if f in K["sealed_people"]:
                hits.append(f"person / uploader {u} on the sealed side (train_exclude.json)")
            if f in K["train_people"]:
                hits.append(f"person / uploader {u} in training (r4/d1.json)")
            if it["kind"] == "vocalset":
                if f in K["exclude_speakers"].get("bench_vocalset", set()):
                    notes.append(f"singer {u} in exclude.json bench_vocalset (old harness; masking rule §2.2)")
                others = [s for s, v in K["exclude_speakers"].items() if s != "bench_vocalset" and f in v]
                if others or f in K["exclude_people"]:
                    hits.append(f"singer {u} in exclude.json outside bench_vocalset ({others})")
            elif f in K["exclude_people"]:
                hits.append(f"uploader {u} in exclude.json")
        x16 = read16(it["path"])
        if it["kind"] == "fsnew":
            x16 = x16[: 120 * 16000]           # the round-4 review's selection fingerprinted the first 120 s
        q = fingerprint(x16)
        skip, ids_ = set(), []
        while True:
            m = E.match(q, skip=skip)
            if m is None or m[0] is None:
                break
            if identity(it, m[0]):
                ids_.append(m[0])
                skip.add(m[0])
                if len(skip) > 200:
                    hits.append("earlier audio: > 200 own-corpus hits (not resolved)")
                    break
                continue
            hits.append(f"earlier audio: {m[0]} (BER {m[2]:.3f}, overlap {m[4] * 0.016:.1f} s)")
            break
        if ids_:
            notes.append(f"own-corpus hits in earlier audio (not training, not sealed): {ids_}")
        sm = SI.match(q)
        r["sealed"] = "drop" if (sm is not None and sm[0] is not None) else "keep"
        if r["sealed"] == "drop":
            hits.append("sealed-set fingerprint match")
        r["fp_seconds"] = round(len(q) * 0.016, 1)
        r["hits"] = hits
        r["notes"] = notes
        r["removed"] = bool(hits)
        res.append(r)
        if hits:
            log("REMOVED", it["id"], hits)
    summ = collections.Counter((r["kind"], "removed" if r["removed"] else "kept") for r in res)
    J = {"what": "round-6 §1.2 items 4 and 5 (blind, before any round-6 data is built)", "item4": i4,
         "item5": {"items": len(res), "summary": {f"{k[0]}:{k[1]}": v for k, v in sorted(summ.items())},
                   "removed": [r["id"] for r in res if r["removed"]], "records": res},
         "key_sizes": {k: (len(v) if not isinstance(v, dict) else {s: len(x) for s, x in v.items()}) for k, v in K.items()}}
    write_json(OUT, J, indent=1)
    log("item 5:", J["item5"]["summary"], "removed:", J["item5"]["removed"])


if __name__ == "__main__":
    main()
