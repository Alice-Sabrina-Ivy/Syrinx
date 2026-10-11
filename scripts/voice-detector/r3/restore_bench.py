# restore_bench.py — custom voice detector, round 3: rebuild the benchmark
# harness audio (2026-10-11).
#
# The benchmark harness streams (build/vad/dumps, 4,305 streams) read their
# audio in place from the notch work's real-data corpora
# (<Syrinx-notch>/build/notchvd{,-heldout}/data). That worktree was removed on
# 2026-10-08, so the audio of 2,869 streams, among them the 194-clip tuning
# split that the round-3 selection objective O uses (pre-registration
# 2026-10-07 §3.4), no longer exists. This script re-downloads and re-prepares
# it with the notch scripts' OWN functions (scripts/notch-adversarial/
# realdata/fetch_noise.py, exec'd without its main loop, so the processing is
# byte-for-byte the code that built the originals) into this worktree's
# build/notchvd (gitignored), and writes per-source manifests carrying the
# dump's own label / class fields. Freesound clips are fetched by id (sound
# page -> the same HQ Vorbis preview), not by re-running the searches.
#
# A restored clip is used only if re-running the production chain over it
# (dump.mjs) reproduces the existing dump's .f32 byte for byte
# (restore_check.mjs); lib/streams.py then maps the old corpus paths to the
# restored copies.
#
#   python scripts/voice-detector/r3/restore_bench.py --stage=noise [--ids=tune] [--jobs=3]
#
# Stages: noise (the harness `noise` set: freesound / dcase / mssnsd / demand).
# No audio is committed; nothing here reads the sealed round-3 set.
import glob
import json
import os
import re
import sys
import time
from concurrent.futures import ThreadPoolExecutor

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.abspath(os.path.join(HERE, "../../.."))
RD = os.path.join(REPO, "scripts", "notch-adversarial", "realdata")
os.environ.setdefault("NOTCHVD_ROOT", os.path.join(REPO, "build", "notchvd"))
MY = dict((a[2:].split("=", 1) + ["1"])[:2] for a in sys.argv[1:] if a.startswith("--"))
sys.argv = [sys.argv[0], f"--jobs={MY.get('jobs', '3')}"]       # fetch_noise.py's own args(): jobs only
sys.path.insert(0, RD)

# fetch_noise.py's functions, without its main loop (the "FN = dict(" line onwards)
_src = open(os.path.join(RD, "fetch_noise.py"), encoding="utf8").read()
_cut = _src.index("\nFN = dict(")
NS = {"__name__": "fetch_noise_restore", "__file__": os.path.join(RD, "fetch_noise.py")}
exec(compile(_src[:_cut], os.path.join(RD, "fetch_noise.py"), "exec"), NS)
common = sys.modules["common"]
DL, fetch, to16k_mono, write_clip, save_manifest = common.DL, common.fetch, common.to16k_mono, common.write_clip, common.save_manifest

BENCH = os.path.join(REPO, "build", "vad", "dumps")


def harness_metas(sets):
    out = []
    for s in sets:
        for p in sorted(glob.glob(os.path.join(BENCH, s, "*.json"))):
            out.append(json.load(open(p, encoding="utf8")))
    return out


def fs_preview(sid):
    """The sound page (freesound.org/s/<id>/, no API key) -> (ogg lq url, user, title, license, duration, samplerate)."""
    import html
    cache = os.path.join(DL, "freesound", "pages", f"{sid}.html")
    fetch(f"https://freesound.org/s/{sid}/", cache, min_bytes=1000)
    h = open(cache, encoding="utf8").read()
    g = lambda pat: (re.search(pat, h) or [None, None])[1]  # noqa: E731
    ogg = g(r'data-ogg="([^"]*)"') or g(r'(https://cdn\.freesound\.org/previews/\d+/' + sid + r'_\d+-lq\.ogg)')
    return dict(id=sid, ogg=ogg, user=html.unescape(g(r'data-username="([^"]*)"') or ""), title=html.unescape(g(r'data-title="([^"]*)"') or ""),
                license=g(r'title="License: ([^"]*)"') or "unknown")


def restore_freesound(metas):
    def one(m):
        cls = m["cls"]
        sid = m["id"].rsplit("__", 1)[1]
        r = fs_preview(sid)
        time.sleep(1.0)
        if not r["ogg"]:
            print("freesound: no preview url for", sid, flush=True)
            return None
        hq = r["ogg"].replace("-lq.ogg", "-hq.ogg")
        dest = fetch(hq, os.path.join(DL, "freesound", os.path.basename(hq)))
        import soundfile as sf
        x, sr = sf.read(dest, always_2d=True)
        x = x[: int(sr * 300)]  # cap 5 min (fetch_noise.py)
        return write_clip("noise", "freesound", f"freesound__{cls}__{sid}", to16k_mono(x, sr), dict(
            **{"class": cls}, url=f"https://freesound.org/people/{r['user']}/sounds/{sid}/", license=r["license"],
            attribution=f"\"{r['title']}\" by {r['user']} (freesound.org)", orig_sr=sr, orig_channels=x.shape[1],
            codec="vorbis HQ preview (~192 kb/s)", notes="restored 2026-10-11 by id (restore_bench.py)"))
    with ThreadPoolExecutor(int(MY.get("jobs", "3"))) as ex:
        return [r for r in ex.map(one, metas) if r]


def stage_noise():
    metas = [m for m in harness_metas(["noise"]) if MY.get("ids") != "tune" or m.get("split") == "tune"]
    by = {}
    for m in metas:
        by.setdefault(m["source"], []).append(m)
    lab = {m["id"]: m for m in metas}
    for src in ("mssnsd", "demand", "dcase", "freesound"):
        if src not in by:
            continue
        t = time.time()
        recs = restore_freesound(by[src]) if src == "freesound" else NS[f"src_{src}"]()
        keep = []
        for r in recs:          # the harness's own clips, labelled as its dumps say (census label, class)
            m = lab.get(r["id"])
            if m is None:
                continue
            r["label"] = m["label"]
            r["class"] = m["cls"]
            keep.append(r)
        save_manifest("noise", keep, src)
        miss = sorted(set(x["id"] for x in by[src]) - set(r["id"] for r in keep))
        print(f"{src}: {len(keep)} of {len(by[src])} harness clips restored ({time.time() - t:.0f} s); missing {miss[:10]}", flush=True)


if __name__ == "__main__":
    {"noise": stage_noise}[MY.get("stage", "noise")]()
