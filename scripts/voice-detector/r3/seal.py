# seal.py — custom voice detector, round 3 (pre-registration §1.6): the
# aggregate counts of the confirmatory set (current app only) and its seal.
#
#   counts  reads ONLY the current-app dumps' label columns and the stream
#           metadata, and prints / writes the aggregate counts §1.6 allows
#           before the look: streams and hours per set; CORRECT hops per
#           subset x gender (x reference-F0 band for held notes) on the clean
#           fresh streams; FALSE hops per noise group (NA, NB) on the
#           noise-only streams; CORRECT hops per mix cell; CORRECT hops per
#           clean-session subset and per noisy-session SNR cell; FALSE hops in
#           noise-only stretches >= 10 s of the noisy sessions (a hop belongs to
#           a stretch when its reference time td_k = t_k - 120 ms lies in it).
#           No per-stream figure is printed.
#   seal    sha256 of every confirmatory file (prepared audio, references,
#           stream specs, current-app dumps, manifest, download metadata) and
#           of build/vad-train/r3/exclude.json ->
#           scripts/voice-detector/r3/seal-confirmatory.sha256, seal.json
#           (counts + the code commit), conf-manifest.jsonl (per-file manifest
#           with licences; no audio)
#   verify  re-hashes everything listed in the seal; prints mismatches
#   --tag=r4 (round-4 pre-registration §2.3, Addendum R4-A): the re-seal after the
#           blind round-4 changes -> seal-confirmatory-r4.sha256, seal-r4.json,
#           the updated conf-manifest.jsonl and seal-r4-changes.json (paths
#           removed / added / changed against round 3's seal); `verify --tag=r4`
#           checks the round-4 seal, `verify-r3` re-hashes round 3's seal minus
#           the listed changes (nothing else may have moved)
#   --tag=r5 (round-5 pre-registration §1.3, Addendum R5-A): the re-seal after the
#           blind trills ruling -> seal-confirmatory-r5.sha256, seal-r5.json, the
#           updated conf-manifest.jsonl and seal-r5-changes.json (against the
#           ROUND-4 seal); `verify --tag=r5`; `verify-r4 --tag=r5` re-hashes the
#           round-4 seal minus the round-5 changes; `verify-r3 --tag=r5` re-hashes
#           round 3's seal minus the round-4 and round-5 changes
#
#   python scripts/voice-detector/r3/seal.py counts|seal|verify|verify-r3|verify-r4 [--tag=r4|r5]
import collections
import glob
import hashlib
import json
import os
import subprocess
import sys

import numpy as np

from c3 import CONF, R3, CManifest, REPO, anon, args, log, write_json

HERE = os.path.dirname(os.path.abspath(__file__))
TAG = args().get("tag", "")
SFX = f"-{TAG}" if TAG else ""
SEAL = os.path.join(HERE, f"seal-confirmatory{SFX}.sha256")
SEAL_R3 = os.path.join(HERE, "seal-confirmatory.sha256")
SEALJ = os.path.join(HERE, f"seal{SFX}.json")
CMAN = os.path.join(HERE, "conf-manifest.jsonl")
SEAL_R4 = os.path.join(HERE, "seal-confirmatory-r4.sha256")
CHANGES = os.path.join(HERE, f"seal-{TAG or 'r4'}-changes.json")
CHANGES_R4 = os.path.join(HERE, "seal-r4-changes.json")
PREV = {"r4": SEAL_R3, "r5": SEAL_R4}.get(TAG, SEAL_R3)
SETS = ["cvoice", "cneg", "cmix20", "cmix0", "csess"]
BANDS = [(75, 130, "75-130"), (130, 300, "130-300"), (300, 400, "300-400")]


def specs(s):
    return json.load(open(os.path.join(CONF, "streams", f"{s}.json"), encoding="utf8"))


def dumps(s):
    for it in specs(s):                       # only the streams of the set's spec (dumps of dropped records are not part of the set)
        jp = os.path.join(CONF, "dumps", s, it["id"] + ".json")
        m = json.load(open(jp, encoding="utf8"))
        a = np.fromfile(jp[:-5] + ".f32", dtype="<f4").reshape(len(m["cols"]), m["n"])
        yield m, {c: a[i] for i, c in enumerate(m["cols"])}


def band(f):
    for lo, hi, nm in BANDS:
        if lo <= f < hi:
            return nm
    return "other"


def counts():
    C = {"sets": {}, "cvoice_correct": collections.Counter(), "cvoice_correct_held_band": collections.Counter(),
         "cneg_false": collections.Counter(), "cmix_correct": collections.Counter(), "csess_clean_correct": collections.Counter(),
         "csess_noisy_correct": collections.Counter(), "csess_false_stretch10": collections.Counter(), "csess_false_short": collections.Counter()}
    for s in SETS:
        n, sec = 0, 0.0
        for m, col in dumps(s):
            n += 1
            sec += m["n"] * m["hop_s"]
            lab = col["lab"]
            g = m["gender"]
            if s == "cvoice":
                ok = lab == 1
                C["cvoice_correct"][f"{m['subset']}|{g}"] += int(ok.sum())
                if m["subset"] == "held":
                    for f in col["refd"][ok]:
                        C["cvoice_correct_held_band"][f"{band(float(f))}|{g}"] += 1
            elif s == "cneg":
                C["cneg_false"][m["ngroup"]] += int((lab == 2).sum())
                C["cneg_false"]["shared:" + m["ngroup"] + ":" + str(m.get("cls"))] += 0
            elif s in ("cmix20", "cmix0"):
                C["cmix_correct"][f"{s}|{m['snr_db']:+d}|{g}"] += int((lab == 1).sum())
            elif s == "csess":
                tk = (np.arange(m["n"]) + 1) * m["hop_s"]
                td = tk - 0.040 - m["L"] * m["hop_s"] - 0.030
                if m["kind"] == "clean":
                    for L in m["layers"]:
                        sel = (lab == 1) & (td >= L["at"]) & (td <= L["at"] + L["len"])
                        C["csess_clean_correct"][f"{L['subset']}|{L['gender']}"] += int(sel.sum())
                else:
                    C["csess_noisy_correct"][f"{m['snr_db']:+d}|{g}"] += int((lab == 1).sum())
                    long_ = np.zeros(m["n"], bool)
                    for a, b in m["stretches"]:
                        if b - a >= 10.0:
                            long_ |= (td >= a) & (td < b)
                    C["csess_false_stretch10"][m["bed_ngroup"]] += int(((lab == 2) & long_).sum())
                    C["csess_false_short"][m["bed_ngroup"]] += int(((lab == 2) & ~long_).sum())
        C["sets"][s] = {"streams": n, "hours": round(sec / 3600, 3)}
    out = {k: (dict(sorted(v.items())) if isinstance(v, collections.Counter) else v) for k, v in C.items()}
    out["cneg_false"] = {k: v for k, v in out["cneg_false"].items() if not k.startswith("shared:")}
    write_json(os.path.join(R3, f"counts{SFX}.json"), out, indent=1)
    print(json.dumps(out, indent=1))
    return out


def sha(p):
    h = hashlib.sha256()
    with open(p, "rb") as f:
        for b in iter(lambda: f.read(1 << 22), b""):
            h.update(b)
    return h.hexdigest()


def files():
    """Every file of the sealed set: the stream specs, each stream's audio, reference tracks and current-app
    dump, every kept record's prepared files, the manifest, the download metadata and exclude.json."""
    out = set()
    for s in SETS:
        out.add(os.path.join(CONF, "streams", f"{s}.json"))
        for it in specs(s):
            out.add(os.path.abspath(it["audio"]["path"]))
            R = it["ref"]
            for L in ([R] if R["kind"] == "praat" else R.get("layers", [])):
                rp = (L.get("ref") or L)["path"]
                out.add(os.path.abspath(rp))
            for ext in (".json", ".f32"):
                out.add(os.path.join(CONF, "dumps", s, it["id"] + ext))
    for r in CManifest().kept():
        for k in ("path", "path16"):
            if r.get(k):
                out.add(os.path.join(CONF, "audio", r[k]))
        if r.get("ref"):
            out.add(os.path.join(CONF, r["ref"]["path"]))
            out.add(os.path.join(CONF, "refs", r["id"] + ".praat.npz"))
    out = sorted(os.path.abspath(p) for p in out)
    missing = [p for p in out if not os.path.exists(p)]
    if missing:
        raise SystemExit(f"{len(missing)} files missing, e.g. {missing[:3]}")
    out.append(os.path.join(CONF, "manifest.jsonl"))
    out.append(os.path.join(CONF, "fpcheck.json"))
    for p in sorted(glob.glob(os.path.join(CONF, "dl", "**", "*.json"), recursive=True)):
        if "/pages/" not in p.replace("\\", "/"):
            out.append(p)
    out.append(os.path.join(R3, "exclude.json"))
    return out


def seal():
    cnt = counts()
    fs = files()
    lines, n_bytes = [], [0]
    for k, p in enumerate(fs):
        lines.append(f"{sha(p)}  {os.path.relpath(p, R3).replace(os.sep, '/')}")
        n_bytes[0] += os.path.getsize(p)
        if k % 2000 == 0:
            log(f"hashing {k}/{len(fs)}")
    open(SEAL, "w", encoding="utf8", newline="\n").write("\n".join(lines) + "\n")
    man = CManifest()
    keep = ("id", "kind", "source", "subset", "group", "session_group", "gender", "ngroup", "cls", "machine", "member", "licence",
            "freesound_id", "query", "page", "origin", "dur", "sr", "orig_sr", "fresh", "drop", "label_why")
    per_file = ("c_fsv", "na", "c_fry", "c_ipa", "c_tr4_fs", "c_tr4_wc", "c_tr4_ds", "c_tr4_ia")   # licence / creator per file (else: seal.json "sources")
    src_info = {}
    with open(CMAN, "w", encoding="utf8", newline="\n") as f:
        for r in sorted(man.have.values(), key=lambda r: r["id"]):
            if r["source"] not in per_file:
                si = src_info.setdefault(r["source"], {"licence": set(), "licence_where": set(), "attribution": set(), "url": set()})
                for k in si:
                    if r.get(k):
                        si[k].add(r[k])
            o = {k: r[k] for k in keep if r.get(k) is not None}
            for k in ("group", "session_group"):
                if k in o:
                    o[k] = anon(o[k])
            if r["source"] in per_file:
                o.update({k: r[k] for k in ("url", "licence_where", "attribution") if r.get(k)})
            if r["source"] in ("c_ipa", "c_tr4_wc"):
                o["attribution"] = "Wikimedia Commons file page (url); contributor as credited there"
            if r["source"] == "c_tr4_ia":
                o["attribution"] = "Internet Archive item page (url); creator as credited there"
            f.write(json.dumps(o, ensure_ascii=False) + "\n")
    commit = subprocess.run(["git", "rev-parse", "HEAD"], cwd=REPO, capture_output=True, text=True).stdout.strip()
    kept = man.kept()
    J = {"what": "round-3 confirmatory set seal (pre-registration §1.6)" if not TAG else
         f"round-4 re-seal of the confirmatory set (round-4 pre-registration §2.3, Addendum R4-A); round 3's seal: seal-confirmatory.sha256"
         if TAG == "r4" else
         "round-5 re-seal of the confirmatory set (round-5 pre-registration §1.3, Addendum R5-A = R4-A'); round 4's seal: seal-confirmatory-r4.sha256, "
         "round 3's: seal-confirmatory.sha256",
         "code_commit": commit, "files": len(fs), "bytes": n_bytes[0],
         "seal_sha256": sha(SEAL), "conf_manifest_sha256": sha(CMAN), "exclude_sha256": sha(os.path.join(R3, "exclude.json")),
         "records": {"kept": len(kept), "dropped": len(man.have) - len(kept)},
         "kept_by_source": dict(collections.Counter(r["source"] for r in kept)),
         "licences_kept": dict(collections.Counter(r["licence"] for r in kept)),
         "sources": {k: {kk: sorted(vv) for kk, vv in v.items()} for k, v in sorted(src_info.items())},
         "spliced_sessions": {"construction": "infer_carried.py over every confirmatory fresh stream (cvoice, cneg, cmix20, cmix0) in a seeded random order",
                              "seed": 20261011, "minutes": 20},
         "counts": cnt}
    if TAG:
        J["changes_vs_round3" if TAG == "r4" else "changes_vs_round4"] = changes()
    write_json(SEALJ, J, indent=1)
    log(f"sealed {len(fs)} files; seal sha256 {J['seal_sha256']}")


def read_seal(p):
    out = {}
    for line in open(p, encoding="utf8"):
        h, rel = line.rstrip("\n").split("  ", 1)
        out[rel] = h
    return out


def changes():
    """Paths removed / added / changed in the round-4 seal against round 3's (seal-r4-changes.json), or in the round-5 seal
    against round 4's (seal-r5-changes.json)."""
    a, b = read_seal(PREV), read_seal(SEAL)
    C = {"what": f"paths of the {TAG} seal removed / added / changed against the previous seal ({os.path.basename(PREV)})",
         "removed": sorted(set(a) - set(b)), "added": sorted(set(b) - set(a)), "changed": sorted(k for k in set(a) & set(b) if a[k] != b[k])}
    write_json(CHANGES, C, indent=1)
    log(f"changes vs {os.path.basename(PREV)}: removed {len(C['removed'])}, added {len(C['added'])}, changed {len(C['changed'])}")
    return {k: len(v) for k, v in C.items() if k != "what"}


def _skip(paths):
    skip = set()
    for p in paths:
        C = json.load(open(p, encoding="utf8"))
        skip |= set(C["removed"]) | set(C["changed"])
    return skip


def verify_r3():
    """Round 3's seal minus the listed round-4 (and, with --tag=r5, round-5) changes: every other path must hash as round 3
    sealed it."""
    skip = _skip([CHANGES_R4] + ([CHANGES] if TAG == "r5" else []))
    bad = n = 0
    for rel, h in read_seal(SEAL_R3).items():
        if rel in skip:
            continue
        n += 1
        p = os.path.join(R3, rel)
        if not os.path.exists(p) or sha(p) != h:
            bad += 1
            print("MISMATCH", rel)
    print(f"verify-r3: {n} round-3 paths outside the listed changes, {bad} mismatches")
    return bad


def verify_r4():
    """Round 4's seal minus the listed round-5 changes (--tag=r5)."""
    assert TAG == "r5", "verify-r4 needs --tag=r5"
    skip = _skip([CHANGES])
    bad = n = 0
    for rel, h in read_seal(SEAL_R4).items():
        if rel in skip:
            continue
        n += 1
        p = os.path.join(R3, rel)
        if not os.path.exists(p) or sha(p) != h:
            bad += 1
            print("MISMATCH", rel)
    print(f"verify-r4: {n} round-4 paths outside the listed round-5 changes, {bad} mismatches")
    return bad


def verify():
    bad = 0
    for line in open(SEAL, encoding="utf8"):
        h, rel = line.rstrip("\n").split("  ", 1)
        p = os.path.join(R3, rel)
        if not os.path.exists(p) or sha(p) != h:
            bad += 1
            print("MISMATCH", rel)
    print(f"verify: {bad} mismatches")
    return bad


if __name__ == "__main__":
    {"counts": counts, "seal": seal, "verify": verify, "verify-r3": verify_r3, "verify-r4": verify_r4}[sys.argv[1]]()
