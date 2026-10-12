# train_side_r4.py — custom voice detector, round 4 (pre-registration
# measurements/voice-detector-round4-preregistration-2026-10-11.md §3.2 D1, D2):
# the round-4 TRAINING side. Reads training-side data only (rounds 1-2
# manifests, build/vad-train/r4/data); never the sealed set (paths under
# r3/conf are refused by train_side.filter_records / c3.guard_not_conf) and
# never the private session recordings.
#
#   d1     the corrected training record lists -> build/vad-train/r4/d1.json:
#          every rounds 1-2 and fsr4 record through the case-insensitive
#          train_side.filter_records() against the ROUND-4 train_exclude.json
#          (rebuilt after the re-seal, Addendum R4-A); then the training records
#          of every Freesound uploader that has kept records on BOTH the train and
#          the val side (fold_user; round-4 audit C: 11 uploaders, 203 training
#          records) are removed from training. Validation is not changed.
#   d2     the stationarity label of the training negatives -> build/vad-train/r4/stat.json:
#          S_stat on the model's own log-mel (dB; model.Frontend: 64 mel bands
#          50-7800 Hz, 32 ms periodic Hann, 12.5 ms hop): 1 s block means (80
#          frames); per block the RMS over bands of its difference from the clip's
#          median block spectrum; S_stat = the median over blocks (clips >= 3 s;
#          the first 120 s). census.py's label (the shipped notch's peak finder,
#          ported 1:1) on negatives >= 10 s. Steady (pool `stat`) = a training
#          negative >= 3 s whose S_stat is in the lowest third of all training
#          negatives' S_stat (FSD50K train, fstrain train, fsr4 train, after D1),
#          OR census label stationary-tonal. The validation negatives' S_stat is
#          computed and reported only (vneg streams of build/vad-train/val).
#
#   python scripts/voice-detector/r4/train_side_r4.py d1|d2 [--jobs=2]
import collections
import json
import os
import sys
from concurrent.futures import ProcessPoolExecutor

import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, "..", "r3"))
sys.path.insert(0, os.path.join(HERE, "..", "train"))
from c3 import DATA, ROOT, args, fold_user, guard_not_conf, load_manifest, log, write_json  # noqa: E402
import train_side  # noqa: E402

A = args()
R4 = os.path.join(ROOT, "r4")
DATA4 = os.path.join(R4, "data")
D1 = os.path.join(R4, "d1.json")
STAT = os.path.join(R4, "stat.json")


def fsr4_records():
    p = os.path.join(DATA4, "manifest.fsr4.jsonl")
    if not os.path.exists(p):
        return []
    return [json.loads(line) for line in open(p, encoding="utf8") if line.strip()]


def d1():
    man = load_manifest()
    recs = list(man.values())
    f4 = fsr4_records()
    ex = json.load(open(train_side.P, encoding="utf8"))
    kept = [r for r in recs if not r.get("drop")]
    touch = [(r["id"], train_side.touches(r, ex)) for r in kept + [r for r in f4 if not r.get("drop")]]
    touch = [(i, w) for i, w in touch if w]
    after = train_side.filter_records([r for r in kept if r.get("split") in ("train", "val")])
    f4k = [r for r in f4 if not r.get("drop")]
    f4_after = [r for r in f4k if not train_side.touches(r, ex)]
    for r in f4_after:
        guard_not_conf(os.path.join(DATA4, r["path"]))
    up = train_side.record_uploader
    sides = collections.defaultdict(lambda: collections.defaultdict(list))
    for r in after + f4_after:
        if up(r):
            sides[fold_user(up(r))][r["split"]].append(r)
    shared = {k: s for k, s in sides.items() if s["train"] and s["val"]}
    removed = sorted(r["id"] for s in shared.values() for r in s["train"])
    rm = set(removed)
    train_ids = sorted(r["id"] for r in after + f4_after if r["split"] == "train" and r["id"] not in rm)
    J = {"what": "round-4 D1: training records after the case-insensitive filter against the round-4 seal and the removal of the training "
                 "records of uploaders on both sides; validation unchanged",
         "train_exclude_sha256": __import__("hashlib").sha256(open(train_side.P, "rb").read()).hexdigest(),
         "kept_records_touching_seal": touch,
         "shared_uploaders": {k: {sd: sorted(r["id"] for r in s[sd]) for sd in ("train", "val")} for k, s in sorted(shared.items())},
         "removed_from_training": removed,
         "counts": {"rounds12_kept_train_val": len(after), "fsr4_kept": len(f4_after), "removed_shared_uploader": len(removed),
                    "train_records": len(train_ids),
                    "train_by_source": dict(collections.Counter((man.get(i) or {"source": "fsr4"})["source"] for i in train_ids))},
         "train_ids": train_ids}
    write_json(D1, J, indent=1)
    log(f"D1: {len(touch)} kept records touch the round-4 seal; shared uploaders {len(shared)}, {len(removed)} training records removed; "
        f"{len(train_ids)} training records; by source {J['counts']['train_by_source']}")


# ----------------------------------------------------------------------------- D2
def logmel_db(x16):
    from model import HOP, WIN, mel_fb
    n = len(x16)
    if n < WIN:
        return np.zeros((0, 64))
    nfr = (n - WIN) // HOP + 1
    w = 0.5 - 0.5 * np.cos(2 * np.pi * np.arange(WIN) / WIN)
    idx = np.arange(WIN)[None, :] + HOP * np.arange(nfr)[:, None]
    P = np.abs(np.fft.rfft(x16[idx] * w, axis=1)) ** 2
    fb = mel_fb(64, 50.0, 7800.0, n_fft=WIN)
    return 10 * np.log10(P @ fb.T + 1e-9)


def s_stat(x16):
    L = logmel_db(np.asarray(x16, np.float64))
    nb = len(L) // 80
    if nb < 3:
        return None
    B = L[: nb * 80].reshape(nb, 80, -1).mean(axis=1)
    med = np.median(B, axis=0)
    return float(np.median(np.sqrt(np.mean((B - med) ** 2, axis=1))))


_CEN = None


def job(it):
    global _CEN
    import soundfile as sf
    rid, path, dur = it
    x, sr = sf.read(path, dtype="float64", always_2d=True)
    assert sr == 16000
    x = x[: 120 * 16000, 0]
    out = {"id": rid, "dur": round(len(x) / 16000, 2), "s_stat": s_stat(x) if len(x) >= 3 * 16000 else None}
    if len(x) >= 10 * 16000:
        if _CEN is None:
            os.environ["NOTCHVD_ROOT"] = os.path.join(R4, "census-scratch")     # census.py creates <root>/data/census at import; keep it in r4/
            sys.path.insert(0, os.path.join(HERE, "..", "..", "notch-adversarial", "realdata"))
            sys.argv = sys.argv[:1]
            saved = sys.modules.pop("common", None)            # census.py imports realdata/common.py, not custom/common.py
            import census
            if saved is not None:
                sys.modules["common"] = saved
            _CEN = census
        r = _CEN.analyse({"id": rid, "source": "train", "path": os.path.abspath(path)})
        out.update(census=r["label"], census_flags=r["flags"])
    return out


def d2():
    J1 = json.load(open(D1, encoding="utf8"))
    man = load_manifest()
    f4 = {r["id"]: r for r in fsr4_records()}
    items = []
    for i in J1["train_ids"]:
        r = man.get(i) or f4.get(i)
        if r["kind"] != "nonvoice" or r["source"] not in ("fsd50k", "fstrain", "fsr4"):
            continue
        p = os.path.join(DATA4 if r["source"] == "fsr4" else DATA, r["path"])
        items.append((i, guard_not_conf(p), r.get("dur")))
    vneg = []
    vp = os.path.join(ROOT, "val", "streams", "vneg.json")
    if os.path.exists(vp):
        for it in json.load(open(vp, encoding="utf8")):
            if it["audio"]["fmt"] == "wav" and it["audio"].get("start", 0) == 0:
                vneg.append(("val:" + it["id"], guard_not_conf(it["audio"]["path"]), None))
    old = {}
    if os.path.exists(STAT):
        old = {r["id"]: r for r in json.load(open(STAT, encoding="utf8"))["clips"]}
    todo = [it for it in items + vneg if it[0] not in old]
    log(f"D2: {len(items)} training negatives, {len(vneg)} validation negative streams (reported only); {len(todo)} to compute")
    res = dict(old)
    with ProcessPoolExecutor(int(A.get("jobs", "2"))) as ex:
        for k, r in enumerate(ex.map(job, todo, chunksize=8)):
            res[r["id"]] = r
            if k % 1000 == 999:
                log(f"  {k + 1}/{len(todo)}")
    tr = [res[i] for i, _, _ in items]
    ss = np.array([r["s_stat"] for r in tr if r["s_stat"] is not None])
    thr = float(np.percentile(ss, 100 / 3)) if len(ss) else None
    for r in tr:
        r["steady"] = bool((r["s_stat"] is not None and r["s_stat"] <= thr) or r.get("census") == "stationary-tonal")
    src = {i: (man.get(i) or f4.get(i))["source"] for i, _, _ in items}
    stat = [r for r in tr if r["steady"]]
    va = [res[i] for i, _, _ in vneg]
    J = {"what": "round-4 D2: stationarity score and the steady pool of the training negatives (validation negatives: reported only)",
         "s_stat_threshold_lowest_third": thr,
         "training_negatives": len(tr), "with_s_stat": int(len(ss)),
         "census_labels": dict(collections.Counter(r.get("census", "<10 s") for r in tr)),
         "steady_pool": {"clips": len(stat), "hours": round(sum(r["dur"] for r in stat) / 3600, 2),
                         "by_source": dict(collections.Counter(src[r["id"]] for r in stat)),
                         "by_reason": dict(collections.Counter(("s_stat" if (r["s_stat"] is not None and r["s_stat"] <= thr) else "") +
                                                               ("+census" if r.get("census") == "stationary-tonal" else "") for r in stat))},
         "validation_negatives_reported": {"streams": len(va),
                                           "steady_by_threshold": sum(1 for r in va if r["s_stat"] is not None and thr is not None and r["s_stat"] <= thr),
                                           "census": dict(collections.Counter(r.get("census", "<10 s") for r in va))},
         "clips": sorted(res.values(), key=lambda r: r["id"])}
    write_json(STAT, J, indent=1)
    log(f"D2: threshold {thr}; steady pool {J['steady_pool']}; census {J['census_labels']}; val (reported) {J['validation_negatives_reported']}")


if __name__ == "__main__":
    {"d1": d1, "d2": d2}[sys.argv[1]]()
