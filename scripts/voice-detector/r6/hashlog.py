# hashlog.py — custom voice detector, round 6 (pre-registration
# measurements/voice-detector-round6-preregistration-2026-10-13.md, "Hash
# log"): append "<ISO time> <tag> <path> <sha256>" for each file to the
# round-6 hash log, which lives OUTSIDE the repository and is append-only.
# A hashed file is never edited afterwards. Paths inside the checkout are
# written relative to it (forward slashes); other paths absolutely.
#   python scripts/voice-detector/r6/hashlog.py TAG FILE [FILE ...]
#   VAD_R6_HASHLOG overrides the log path.
import datetime
import hashlib
import os
import sys

REPO = os.path.abspath(os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..", ".."))
LOG = os.environ.get("VAD_R6_HASHLOG", "C:/Users/Michael/AppData/Local/Temp/claude/c--Coding-Projects-Syrinx/"
                     "12a8f6ba-d49c-4c27-bd93-69314577b2c1/voice-detector-r6-hashes.log")


def sha256(path):
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for b in iter(lambda: f.read(1 << 20), b""):
            h.update(b)
    return h.hexdigest()


def rel(path):
    p = os.path.abspath(path)
    try:
        r = os.path.relpath(p, REPO)
    except ValueError:
        return p.replace("\\", "/")
    return p.replace("\\", "/") if r.startswith("..") else r.replace("\\", "/")


def append(tag, paths):
    if not tag or any(c.isspace() for c in tag):
        raise SystemExit("tag must be one word")
    lines = []
    for p in paths:
        if not os.path.isfile(p):
            raise SystemExit(f"not a file: {p}")
        lines.append(f"{datetime.datetime.now().astimezone().isoformat(timespec='seconds')} {tag} {rel(p)} {sha256(p)}")
    with open(LOG, "a", encoding="utf8", newline="\n") as f:
        f.write("".join(line + "\n" for line in lines))
    for line in lines:
        print(line)


if __name__ == "__main__":
    if len(sys.argv) < 3:
        raise SystemExit(__doc__)
    append(sys.argv[1], sys.argv[2:])
