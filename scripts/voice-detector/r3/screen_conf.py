# screen_conf.py — custom voice detector, round 3 (pre-registration §1.1
# "Duplicate check"): fingerprint every kept confirmatory clip that the
# Freesound selection has not already checked (fs_conf.py checks its own clips
# before keeping them) against every earlier clip (fpindex.py: rounds 1-2
# training + validation, benchmark voice + noise, review probes). A match
# (>= 3 s aligned overlap, BER <= 0.35) drops the clip AND every other clip of
# its group (speaker / singer / participant / uploader / machine recording).
# Results: build/vad-train/r3/conf/fpcheck.json; drops appended to the manifest.
#
#   python scripts/voice-detector/r3/screen_conf.py
import json
import os
import sys
import time

from c3 import CAUDIO, CONF, CManifest, log, write_json

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "custom"))
from dedup import fingerprint  # noqa: E402
from fpindex import Index  # noqa: E402


def main():
    import soundfile as sf
    man = CManifest()
    rp = os.path.join(CONF, "fpcheck.json")
    R = json.load(open(rp, encoding="utf8")) if os.path.exists(rp) else {}
    todo = sorted([r for r in man.kept() if r["source"] not in ("c_fsv", "na") and r["id"] not in R], key=lambda r: r["id"])
    log(f"fpcheck: {len(todo)} clips to check ({len(R)} done); loading the index ...")
    idx = Index()
    t0 = time.time()
    for k, r in enumerate(todo):
        x, sr = sf.read(os.path.join(CAUDIO, r["path16"]), dtype="float32")
        assert sr == 16000
        m = idx.match(fingerprint(x))
        R[r["id"]] = None if m is None else {"match": m[0], "ber": round(m[2], 3), "votes": m[3], "overlap_s": round(m[4] * 0.016, 2)}
        if k % 200 == 199:
            write_json(rp, R)
            log(f"  {k + 1}/{len(todo)} ({time.time() - t0:.0f} s); matches so far {sum(1 for v in R.values() if v and v['match'])}")
    write_json(rp, R)
    hits = {cid: v for cid, v in R.items() if v and v["match"]}
    groups = {man.have[cid]["group"] for cid in hits}
    n = 0
    for cid, v in hits.items():
        man.add(dict(man.have[cid], drop=f"fingerprint match with earlier clip {v['match']} (BER {v['ber']}, {v['overlap_s']} s)"))
        n += 1
    for r in list(man.kept()):
        if r["group"] in groups:
            man.add(dict(r, drop=f"group {r['group']}: another clip of this group matched earlier audio"))
            n += 1
    log(f"fpcheck done: {len(R)} checked, {len(hits)} matches in {len(groups)} groups, {n} records dropped")
    for cid, v in sorted(hits.items()):
        log(f"  match {cid} -> {v['match']} (BER {v['ber']}, overlap {v['overlap_s']} s)")


if __name__ == "__main__":
    main()
