# verify_inputs.py — custom voice detector, round 5 (pre-registration
# measurements/voice-detector-round5-preregistration-2026-10-12.md §4): the
# selection data are round 4's, unchanged and checked by sha256 against
# build/vad-train/r4/sel/inputs.sha256, plus the H rows against
# build/vad-train/r5/sel/inputs.sha256 (Addendum R5-B part 1). Re-hashes every
# listed file (r4 list: paths relative to the repository; r5 list: relative
# to build/vad-train) and writes build/vad-train/r5/sel/verify.json.
#
#   python scripts/voice-detector/r5/verify_inputs.py
import hashlib
import json
import os

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.abspath(os.path.join(HERE, "../../.."))
VT = os.path.join(REPO, "build", "vad-train")


def sha(p):
    h = hashlib.sha256()
    with open(p, "rb") as f:
        for b in iter(lambda: f.read(1 << 22), b""):
            h.update(b)
    return h.hexdigest()


def check(lst, base):
    bad, n, nbytes = [], 0, 0
    for line in open(lst, encoding="utf8"):
        if not line.strip():
            continue
        h, p = line.rstrip("\n").split("  ", 1)
        fp = os.path.join(base, p)
        n += 1
        if not os.path.exists(fp):
            bad.append((p, "missing"))
            continue
        nbytes += os.path.getsize(fp)
        if sha(fp) != h:
            bad.append((p, "changed"))
    return {"list": os.path.relpath(lst, REPO).replace(os.sep, "/"), "list_sha256": sha(lst), "files": n, "bytes": nbytes, "mismatches": bad}


def main():
    out = {"r4": check(os.path.join(VT, "r4", "sel", "inputs.sha256"), REPO), "r5": check(os.path.join(VT, "r5", "sel", "inputs.sha256"), VT)}
    json.dump(out, open(os.path.join(VT, "r5", "sel", "verify.json"), "w", encoding="utf8"), indent=1)
    print(json.dumps({k: {kk: (len(v[kk]) if kk == "mismatches" else v[kk]) for kk in v} for k, v in out.items()}, indent=1))


if __name__ == "__main__":
    main()
