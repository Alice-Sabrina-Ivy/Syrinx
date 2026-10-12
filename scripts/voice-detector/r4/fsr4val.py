# fsr4val.py — custom voice detector, round 4 (pre-registration
# measurements/voice-detector-round4-preregistration-2026-10-11.md §3.2 D3 / §4;
# Addendum R4-B part 2, B.10): the stream specs of the 14 fsr4 VAL clips, a
# reported diagnostic V2 row only (not feasibility, not O). The current app's
# dumps then come from
#   ROOT=build/vad-train/r4/fsr4val bash scripts/voice-detector/r3/run-dumps.sh fsr4val:1
# (train/valdump.mjs, src dd92037). Never reads the sealed set or the private recordings.
#
#   python scripts/voice-detector/r4/fsr4val.py
import json
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, "..", "r3"))
from c3 import ROOT, fnv1a, guard_not_conf, log, write_json  # noqa: E402

R4 = os.path.join(ROOT, "r4")


def main():
    import soundfile as sf
    recs = [json.loads(line) for line in open(os.path.join(R4, "data", "manifest.fsr4.jsonl"), encoding="utf8") if line.strip()]
    recs = [r for r in recs if not r.get("drop") and r["split"] == "val"]
    out = []
    for r in sorted(recs, key=lambda r: (fnv1a(r["id"]), r["id"])):
        p = guard_not_conf(os.path.abspath(os.path.join(R4, "data", r["path"])))
        n = sf.info(p).frames
        out.append({"id": r["id"], "gender": "na", "audio": {"path": p, "fmt": "wav", "sr": 16000, "start": 0, "len": int(n)}, "ref": {"kind": "none"},
                    "holds": [], "meta": {"source": "fsr4", "set": "fsr4val", "query": r.get("query")}})
    write_json(os.path.join(R4, "fsr4val", "streams", "fsr4val.json"), out)
    log(f"fsr4 val: {len(out)} streams, {sum(o['audio']['len'] for o in out) / 16000 / 3600:.2f} h")


if __name__ == "__main__":
    main()
