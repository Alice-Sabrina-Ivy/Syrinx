# sel_inputs.py — custom voice detector, round 4 (pre-registration
# measurements/voice-detector-round4-preregistration-2026-10-11.md §4; Addendum
# R4-B part 2, B.10): the SELECTION inputs of round 4 must be round 3's, unchanged.
# Lists every file the rule and the selection runner read — the fresh validation
# streams (vvoice, vmix20, vmix0, vneg) and the 194-clip tuning split (dump JSON,
# dump .f32, audio as lib/streams.load_audio resolves it), the 240 one-room
# validation sessions (the same three per stream) and round 2's spliced-session
# construction (sessions.json) — writes their sha256 to
# build/vad-train/r4/sel/inputs.sha256 and checks that every one was last modified
# before round 3's rule output (build/vad-train/r3/sel/sel-r3-B.json). Validation
# data only; the sealed set is refused by lib/streams.py.
#
#   python scripts/voice-detector/r4/sel_inputs.py
import hashlib
import json
import os
import sys
import time

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, "..", "lib"))
from streams import _restored, list_streams  # noqa: E402

REPO = os.path.abspath(os.path.join(HERE, "../../.."))
VT = os.path.join(REPO, "build", "vad-train")
VAL, BENCH, VSESS = os.path.join(VT, "val"), os.path.join(REPO, "build", "vad"), os.path.join(VT, "r3", "vsess")
SPL = os.path.join(VT, "cand", "r8ae-s8000-carried", "sessions.json")
REF = os.path.join(VT, "r3", "sel", "sel-r3-B.json")
OUT = os.path.join(VT, "r4", "sel")


def sha(p):
    h = hashlib.sha256()
    with open(p, "rb") as f:
        for b in iter(lambda: f.read(1 << 22), b""):
            h.update(b)
    return h.hexdigest()


def files():
    out = {SPL}
    for root, sets, flt in ((VAL, ["vvoice", "vmix20", "vmix0", "vneg"], None), (BENCH, ["noise"], "tune"), (VSESS, ["vsess"], None)):
        for m in list_streams(root, sets):
            if flt and m.get("split") != flt:
                continue
            out.add(os.path.join(root, "dumps", m["set"], m["id"] + ".json"))
            out.add(os.path.join(root, "dumps", m["set"], m["id"] + ".f32"))
            a = m["audio"]["path"]
            if not os.path.exists(a) and _restored(a):
                a = _restored(a)
            out.add(a)
    return sorted(os.path.abspath(p) for p in out)


def main():
    os.makedirs(OUT, exist_ok=True)
    fs = files()
    ref_t = os.path.getmtime(REF)
    t0 = time.time()
    late, tot = [], 0
    with open(os.path.join(OUT, "inputs.sha256.tmp"), "w", encoding="utf8", newline="\n") as f:
        for k, p in enumerate(fs):
            f.write(f"{sha(p)}  {os.path.relpath(p, REPO).replace(os.sep, '/')}\n")
            tot += os.path.getsize(p)
            if os.path.getmtime(p) >= ref_t:
                late.append(p)
            if k % 5000 == 4999:
                print(f"{k + 1}/{len(fs)} ({time.time() - t0:.0f} s)", flush=True)
    os.replace(os.path.join(OUT, "inputs.sha256.tmp"), os.path.join(OUT, "inputs.sha256"))
    J = {"files": len(fs), "bytes": tot, "list_sha256": sha(os.path.join(OUT, "inputs.sha256")),
         "reference": os.path.relpath(REF, REPO).replace(os.sep, "/"), "reference_mtime": time.strftime("%Y-%m-%d %H:%M:%S", time.localtime(ref_t)),
         "modified_after_reference": [os.path.relpath(p, REPO).replace(os.sep, "/") for p in late]}
    with open(os.path.join(OUT, "inputs.json"), "w", encoding="utf8") as f:
        json.dump(J, f, indent=1)
    print(json.dumps({k: (v if k != "modified_after_reference" else len(v)) for k, v in J.items()}))


if __name__ == "__main__":
    main()
