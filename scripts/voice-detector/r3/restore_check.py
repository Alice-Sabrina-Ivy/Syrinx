# restore_check.py — custom voice detector, round 3: does a restored harness
# clip (restore_bench.py) give the SAME stream as the original? Re-runs the
# production chain (dump.mjs, the src tree the dumps were made with) over the
# restored audio into a scratch directory and compares each new dump with the
# existing build/vad/dumps one: the .f32 byte for byte, the .json apart from
# the audio path and the src path. Writes the verdict per stream to
# build/vad-train/r3/restore/<set>.json; lib/streams.py maps an old corpus path
# to its restored copy only for streams listed there as identical.
#
#   python scripts/voice-detector/r3/restore_check.py --set=noise [--split=tune] [--shards=2]
import glob
import json
import os
import subprocess
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.abspath(os.path.join(HERE, "../../.."))
MY = dict((a[2:].split("=", 1) + ["1"])[:2] for a in sys.argv[1:] if a.startswith("--"))
SET = MY["set"]
BENCH = os.path.join(REPO, "build", "vad")
OUTD = os.path.join(REPO, "build", "vad-train", "r3", "restore")
SCR = os.path.join(OUTD, "dumps-check")
ROOT = os.path.join(REPO, "build", "notchvd")


def main():
    metas = [json.load(open(p, encoding="utf8")) for p in sorted(glob.glob(os.path.join(BENCH, "dumps", SET, "*.json")))]
    if "split" in MY:
        metas = [m for m in metas if m.get("split") == MY["split"]]
    ids = [m["id"] for m in metas]
    env = dict(os.environ, NOTCHVD_ROOT=ROOT, NOTCHVD_HELDOUT_ROOT=ROOT + "-heldout")
    n = int(MY.get("shards", "2"))
    idf = os.path.join(OUTD, f"ids-{SET}.txt")
    os.makedirs(OUTD, exist_ok=True)
    procs = [subprocess.Popen(["node", "--import", "./scripts/session-oracle/lib/register.mjs", "scripts/voice-detector/dump.mjs",
                               f"--set={SET}", f"--ids={','.join(ids)}", f"--out={SCR}", "--src=src", f"--shard={i}/{n}"],
                              cwd=REPO, env=env) for i in range(n)]
    for p in procs:
        p.wait()
    res = {}
    for m in metas:
        nf, nj = (os.path.join(SCR, "dumps", SET, m["id"] + e) for e in (".f32", ".json"))
        of = os.path.join(BENCH, "dumps", SET, m["id"] + ".f32")
        if not os.path.exists(nf):
            res[m["id"]] = {"ok": False, "why": "not dumped (clip missing or chain error)"}
            continue
        same_f32 = open(nf, "rb").read() == open(of, "rb").read()
        mj = json.load(open(nj, encoding="utf8"))
        strip = lambda d: {k: (dict(v, path=None) if k == "audio" else v) for k, v in d.items() if k not in ("src",)}  # noqa: E731
        same_json = strip(mj) == strip(m)
        res[m["id"]] = {"ok": bool(same_f32 and same_json), "f32": same_f32, "json": same_json,
                        "old": m["audio"]["path"], "new": mj["audio"]["path"]}
    ok = sum(r["ok"] for r in res.values())
    out = os.path.join(OUTD, f"{SET}{'-' + MY['split'] if 'split' in MY else ''}.json")
    json.dump(res, open(out, "w", encoding="utf8"), indent=1)
    print(f"{SET}: {ok} of {len(res)} streams identical; {out}")
    bad = [k for k, r in res.items() if not r["ok"]]
    if bad:
        print("not identical:", bad[:20])


if __name__ == "__main__":
    main()
