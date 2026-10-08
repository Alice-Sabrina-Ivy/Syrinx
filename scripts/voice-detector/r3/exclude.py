# exclude.py — custom voice detector, round 3 (pre-registration §1.1): the
# collected exclusion list of the confirmatory set, written to
# build/vad-train/r3/exclude.json BEFORE any confirmatory search.
#
# Never used before = no speaker, singer, participant, Freesound id or
# Freesound uploader that appears in any of
#   - rounds 1-2 training and validation: every record of
#     build/vad-train/data/manifest*.jsonl, kept AND dropped (this includes all
#     51,197 FSD50K clips and their uploaders), plus every id the rounds 1-2
#     Freesound download indexes list (dl/fstrain, dl/fsvoice: kept and skipped);
#   - the benchmark's voice and noise sets (public manifests of NOTCHVD_ROOT /
#     NOTCHVD_HELDOUT_ROOT / NOTCHVD_HELDOUT2_ROOT: FDA, PTDB-TUG, vocadito,
#     VocalSet, PVQD, VOICED, Hillenbrand; MS-SNSD, DEMAND, ESC-50 incl. every
#     esc50.csv src_file id, DCASE 2020 T2 dev / additional, the freesound and
#     fsheld previews);
#   - the notch work's held-out voice sets (Coswara dates 20200417, 20200814,
#     20200820);
#   - the reviews' probes of rounds 1-2: splits.json round2.fsvoice
#     excluded_ids / excluded_uploaders (66 / 52) and every Freesound id found
#     in the review scratch directories (index files, search pages, scripts,
#     logs; the uploaders of the review indexes' entries too).
#
#   NOTCHVD_ROOT=.../build/notchvd python scripts/voice-detector/r3/exclude.py --scratch=<scratchpad dir>
import collections
import csv
import glob
import hashlib
import json
import os
import re

from c3 import DL, META, R3, SPLITS, args, load_manifest, log, write_json

A = args()
NV = os.environ.get("NOTCHVD_ROOT")
if not NV:
    raise SystemExit("set NOTCHVD_ROOT")
NV_HO = os.environ.get("NOTCHVD_HELDOUT_ROOT", NV + "-heldout")
NV_HO2 = os.environ.get("NOTCHVD_HELDOUT2_ROOT", NV + "-heldout2")
PUBLIC_VOICE = ("fda", "ptdb", "vocadito", "vocalset", "pvqd", "voiced", "hillenbrand", "coswara")
PUBLIC_NOISE = ("freesound", "fsheld", "mssnsd", "demand", "esc50", "dcase", "dcaseeval")

RX_PEOPLE = re.compile(r"freesound\.org/people/([^/\"'\s<>]+)/sounds/(\d+)")
RX_S = re.compile(r"freesound\.org/s/(\d+)")
RX_DATA = re.compile(r'data-sound-id="(\d+)"')
RX_PREV = re.compile(r"cdn\.freesound\.org/previews/\d+/(\d+)_\d+")
RX_FSV = re.compile(r"\b(?:fsv|fsvoice|fstrain|freesound|fsheld)__(?:[a-z_]+__)?(\d{3,7})\b")


def scan_scratch(dirs):
    """Freesound ids (and the uploaders of URL / index hits) mentioned anywhere in the review scratch files."""
    ids, ups, files = set(), set(), 0
    for d in dirs:
        walk = [(os.path.dirname(d), [], [os.path.basename(d)])] if os.path.isfile(d) else os.walk(d)
        for root, _, fns in walk:
            for fn in fns:
                p = os.path.join(root, fn)
                if not fn.lower().endswith((".json", ".html", ".htm", ".txt", ".py", ".md", ".csv", ".log", ".mjs", ".js", ".tsv")):
                    continue
                try:
                    if os.path.getsize(p) > 20_000_000:
                        continue
                    t = open(p, encoding="utf8", errors="replace").read()
                except OSError:
                    continue
                files += 1
                for u, i in RX_PEOPLE.findall(t):
                    ids.add(int(i))
                    ups.add(u)
                for rx in (RX_S, RX_DATA, RX_PREV, RX_FSV):
                    ids.update(int(i) for i in rx.findall(t))
                if fn == "index.json":
                    try:
                        j = json.loads(t)
                    except ValueError:
                        continue
                    rows = j if isinstance(j, list) else [r for v in j.values() if isinstance(v, list) for r in v]
                    for r in rows:
                        if isinstance(r, dict) and isinstance(r.get("id"), int):
                            ids.add(r["id"])
                            if r.get("user") and r.get("why") is None:
                                ups.add(r["user"])
    return ids, ups, files


def main():
    out = {"_what": "round-3 exclusion list (pre-registration §1.1); built before any confirmatory search",
           "freesound_ids": set(), "freesound_uploaders": set(), "groups": set(), "speakers_by_source": collections.defaultdict(set),
           "coswara_heldout_dates": ["20200417", "20200814", "20200820"], "sources": {}}
    ids, ups = out["freesound_ids"], out["freesound_uploaders"]
    # ---- rounds 1-2 manifests (kept and dropped) ----
    man = load_manifest()
    n_fs = 0
    for r in man.values():
        if r.get("group"):
            out["groups"].add(r["group"])
            src, _, who = r["group"].partition(":")
            out["speakers_by_source"][r["source"]].add(who)
        if r.get("freesound_id") is not None:
            ids.add(int(r["freesound_id"]))
            n_fs += 1
        if r.get("uploader"):
            ups.add(r["uploader"])
        elif (r.get("group") or "").startswith("freesound:"):
            ups.add(r["group"].split(":", 1)[1])
    out["sources"]["manifests"] = {"records": len(man), "freesound_records": n_fs}
    # ---- rounds 1-2 Freesound download indexes (kept + skipped) ----
    for sub in ("fstrain", "fsvoice"):
        p = os.path.join(DL, sub, "index.json")
        j = json.load(open(p, encoding="utf8"))
        for r in j["kept"] + j["skipped"]:
            if r.get("id") is not None:
                ids.add(int(r["id"]))
        for r in j["kept"]:
            ups.add(r["user"])
        out["sources"][f"index:{sub}"] = {"kept": len(j["kept"]), "skipped": len(j["skipped"])}
    # ---- benchmark (public manifests only) ----
    nb = collections.Counter()
    for root in (NV, NV_HO, NV_HO2):
        d = os.path.join(root, "data", "manifests")
        if not os.path.isdir(d):
            continue
        for fn in sorted(os.listdir(d)):
            kind, src = fn.split(".")[:2]
            if kind == "noise" and src in PUBLIC_NOISE or kind == "voice" and src in PUBLIC_VOICE:
                for r in json.load(open(os.path.join(d, fn), encoding="utf8")):
                    nb[src] += 1
                    m = RX_PEOPLE.search(r.get("url", ""))
                    if m:
                        ids.add(int(m.group(2)))
                        ups.add(m.group(1))
                    who = r.get("singer") or r.get("speaker") or r["id"].split("__", 1)[-1]
                    out["speakers_by_source"]["bench_" + src].add(str(who))
    esc = os.path.join(META, "esc50.csv")
    esc_ids = {int(r["src_file"]) for r in csv.DictReader(open(esc, encoding="utf8"))}
    ids |= esc_ids
    out["sources"]["benchmark"] = dict(nb, esc50_src_ids=len(esc_ids))
    # ---- review probes ----
    R2 = SPLITS["round2"]["fsvoice"]
    ids |= {int(i) for i in R2["excluded_ids"]}
    ups |= set(R2["excluded_uploaders"])
    sdirs = [d for d in A.get("scratch", "").split(";") if d]
    s_ids, s_ups, s_files = scan_scratch(sdirs)
    ids |= s_ids
    ups |= s_ups
    out["sources"]["review_scratch"] = {"dirs": sdirs, "files_scanned": s_files, "ids": len(s_ids), "uploaders": len(s_ups)}
    out["sources"]["round2_review_probes"] = {"ids": len(R2["excluded_ids"]), "uploaders": len(R2["excluded_uploaders"])}
    # ---- write ----
    res = {k: (sorted(v) if isinstance(v, set) else v) for k, v in out.items()}
    res["speakers_by_source"] = {k: sorted(v) for k, v in sorted(out["speakers_by_source"].items())}
    res["counts"] = {"freesound_ids": len(ids), "freesound_uploaders": len(ups), "groups": len(out["groups"])}
    p = os.path.join(R3, "exclude.json")
    write_json(p, res)
    h = hashlib.sha256(open(p, "rb").read()).hexdigest()
    log(f"exclude.json: {res['counts']}; sha256 {h}")
    log(json.dumps(res["sources"], indent=1))


if __name__ == "__main__":
    main()
