# fetch_fsr4.py — custom voice detector, round 4 (pre-registration
# measurements/voice-detector-round4-preregistration-2026-10-11.md §3.2 D3):
# new Freesound STEADY machine-noise negatives for training, `fsr4`. Search
# pages scraped as fetch_fstrain.py / fs_conf.py (no API key).
#
#   search   the pre-registered plan -> build/vad-train/r4/dl/fsr4/candidates.json
#            part 1: the 46 fstrain queries minus "hair dryer", "vacuum cleaner",
#                    "tumble dryer" (NB machine types of the sealed set),
#                    "dishwasher", "washing machine", "microwave oven running"
#                    (cyclic, not steady), pages 4-8 (fstrain read pages 1-3)
#            part 2: 25 new steady queries, pages 1-5
#            duration 20-900 s; cheap rules: id used before (exclude.json,
#            train_exclude.json, the round-4 trill sources), uploader used
#            before (the same lists; fold_user), no preview, licence label
#            (CC0 / Attribution only), the voice / music keyword rule on the title
#   select   candidates in ascending FNV-1a of the id: skipped while the query
#            (<= 20 kept) or the uploader (<= 3 kept) cap is full; else the sound
#            page (licence URL CC0 / CC BY 3.0 / 4.0; keyword rule on description
#            and tags), the HQ preview (first 120 s, >= 20 s), the Silero speech
#            screen (drop if >= 32 chunks of 32 ms at p >= 0.9, i.e. >= 1.0 s), and
#            the fingerprint check against every earlier clip (r3/fp) and the
#            sealed set (sealfp.py; only keep / drop leaves r3/conf/): a match
#            drops the clip and bans its uploader (clips already kept from that
#            uploader are dropped too)
#            Split: val if the uploader has FSD50K-eval clips (fold_user), else
#            val if FNV-1a(fold_user(uploader)) % 10 == 0, else train. The val
#            part is a reported diagnostic only.
#            Kept clips: build/vad-train/r4/data/fsr4/<id>.wav (16 kHz, first
#            channel, first 120 s) + build/vad-train/r4/data/manifest.fsr4.jsonl
#            (licence, attribution, split per file). The rounds 1-3 manifests are
#            not touched.
#
#   python scripts/voice-detector/r4/fetch_fsr4.py search|select
import html
import json
import os
import re
import sys
import time

import numpy as np
import requests

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, "..", "r3"))
sys.path.insert(0, os.path.join(HERE, "..", "custom"))
from c3 import CDL, DL, KEYWORDS, R3, ROOT, SPLITS, UA, args, fnv1a, fold_user, fold_users, load_exclude, log, norm_cc, write_json  # noqa: E402

A = args()
R4 = os.path.join(ROOT, "r4")
OUT = os.path.join(R4, "dl", "fsr4")
DATA4 = os.path.join(R4, "data")
MAN = os.path.join(DATA4, "manifest.fsr4.jsonl")
NOT_STEADY = ["hair dryer", "vacuum cleaner", "tumble dryer", "dishwasher", "washing machine", "microwave oven running"]
Q1 = [q for q in SPLITS["negatives"]["fstrain"]["queries"] if q not in NOT_STEADY]
Q2 = ["fridge hum", "refrigerator running", "freezer compressor", "mini fridge", "air conditioner hum", "ac unit", "central air conditioning",
      "ventilation system", "air vent", "duct fan", "exhaust fan", "standing fan", "pedestal fan", "tower fan", "floor fan", "electrical hum",
      "60hz hum", "50hz hum", "transformer noise", "computer hum", "server hum", "data center", "hard drive hum", "motor hum", "fan noise"]
PER_Q, PER_U = 20, 3
LIC_OK = {"CC0 1.0", "CC BY 3.0", "CC BY 4.0"}


def plan():
    return [(q, pg, "part1") for q in Q1 for pg in (4, 5, 6, 7, 8)] + [(q, pg, "part2") for q in Q2 for pg in (1, 2, 3, 4, 5)]


def excluded():
    """(ids, folded uploaders) never to be used: exclude.json, train_exclude.json, the round-4 trill sources."""
    ex = load_exclude()
    te = json.load(open(os.path.join(R3, "train_exclude.json"), encoding="utf8"))
    ids = set(int(i) for i in ex["freesound_ids"]) | set(int(i) for i in te["freesound_ids"])
    ups = fold_users(ex["freesound_uploaders"]) | fold_users(te["freesound_uploaders"])
    tr = os.path.join(CDL, "tr4_fs", "candidates.json")      # every Freesound result the trill search read (kept or not)
    if os.path.exists(tr):
        C = json.load(open(tr, encoding="utf8"))
        ids |= {int(v["id"]) for v in C["cands"].values()} | {int(v["id"]) for v in C["rejected"]}
        ups |= fold_users([v["user"] for v in C["cands"].values()] + [v["user"] for v in C["rejected"]])
    return ids, ups


def fs_get(s, url, dest, min_bytes=1000, pause=1.5):
    if os.path.exists(dest) and os.path.getsize(dest) >= min_bytes:
        return dest
    os.makedirs(os.path.dirname(dest), exist_ok=True)
    for k in range(6):
        try:
            r = s.get(url, timeout=120)
            if r.status_code == 200 and len(r.content) >= min_bytes:
                open(dest + ".tmp", "wb").write(r.content)
                os.replace(dest + ".tmp", dest)
                time.sleep(pause)
                return dest
            if r.status_code == 404:
                raise FileNotFoundError(url)
            time.sleep(15 * (k + 1))
        except requests.RequestException:
            time.sleep(15 * (k + 1))
    raise IOError(f"{url}: retries exhausted")


def search():
    ids, ups = excluded()
    s = requests.Session()
    s.headers.update(UA)
    cp = os.path.join(OUT, "candidates.json")
    C = json.load(open(cp, encoding="utf8")) if os.path.exists(cp) else {"pages": {}, "cands": {}, "rejected": []}
    for q, pg, part in plan():
        key = f"{q}|{pg}"
        if key in C["pages"] and "error" not in C["pages"][key]:
            continue
        url = "https://freesound.org/search/?" + requests.compat.urlencode({"q": q, "f": "duration:[20 TO 900]", "page": pg})
        try:
            h = open(fs_get(s, url, os.path.join(OUT, "search", re.sub(r"\W+", "_", q) + f"__p{pg}.html")), encoding="utf8").read()
        except (IOError, FileNotFoundError) as e:
            C["pages"][key] = {"error": str(e)}
            write_json(cp, C)
            continue
        n = 0
        for blk in h.split('class="bw-search__result"')[1:]:
            g = lambda pat: (re.search(pat, blk) or [None, None])[1]  # noqa: E731
            sid = g(r'data-sound-id="(\d+)"')
            if not sid:
                continue
            n += 1
            r = dict(id=int(sid), user=html.unescape(g(r'data-username="([^"]*)"') or ""), title=html.unescape(g(r'data-title="([^"]*)"') or ""),
                     dur=float(g(r'data-duration="([^"]*)"') or 0), ogg=g(r'data-ogg="([^"]*)"'), license_label=g(r'title="License: ([^"]*)"') or "unknown",
                     query=q, page=pg, part=part)
            if str(r["id"]) in C["cands"]:
                continue
            why = None
            if r["id"] in ids:
                why = "id used before"
            elif fold_user(r["user"]) in ups:
                why = "uploader used before"
            elif not r["ogg"]:
                why = "no preview"
            elif not re.search(r"(?i)creative commons 0|^attribution$|attribution \d", r["license_label"]) or "noncommercial" in r["license_label"].lower():
                why = f"licence {r['license_label']}"
            elif KEYWORDS.search(r["title"]):
                why = "keyword (title)"
            if why:
                C["rejected"].append(dict(id=r["id"], user=r["user"], query=q, why=why))
                continue
            C["cands"][str(r["id"])] = r
        C["pages"][key] = {"results": n}
        write_json(cp, C)
        log(f"search '{q}' p{pg}: {n} results; candidates {len(C['cands'])}")
    write_json(cp, C)
    log(f"search done: {len(C['pages'])} pages ({sum('error' in v for v in C['pages'].values())} errors), {len(C['cands'])} candidates, "
        f"{len(C['rejected'])} rejected")


class Screens:
    def __init__(self):
        import onnxruntime as ort
        from dedup import SILERO
        from fpindex import Index
        from sealfp import SealedIndex
        o = ort.SessionOptions()
        o.inter_op_num_threads = o.intra_op_num_threads = 1
        self.sil = ort.InferenceSession(SILERO, providers=["CPUExecutionProvider"], sess_options=o)
        log("loading the fingerprint indexes ...")
        self.idx = Index()
        self.sealed = SealedIndex()
        log("indexes loaded")

    def silero_hi(self, x16):
        from dedup import SPEECH_P
        state = np.zeros((2, 1, 128), np.float32)
        sr = np.array(16000, dtype=np.int64)
        buf = np.zeros((1, 576), np.float32)
        hi = 0
        for i in range(len(x16) // 512):
            buf[0, 64:] = x16[i * 512:(i + 1) * 512]
            o, state = self.sil.run(None, {"input": buf, "state": state, "sr": sr})
            hi += o[0, 0] >= SPEECH_P
            buf[0, :64] = buf[0, -64:]
        return int(hi)


def fsd_eval_uploaders():
    p = os.path.join(DL, "fsd50k", "FSD50K.metadata", "eval_clips_info_FSD50K.json")
    return fold_users(v["uploader"] for v in json.load(open(p, encoding="utf8")).values())


def select():
    import soundfile as sf
    from common import to16k_mono, write_wav16
    from dedup import fingerprint
    ids, ups = excluded()
    ev = fsd_eval_uploaders()
    C = json.load(open(os.path.join(OUT, "candidates.json"), encoding="utf8"))
    sp = os.path.join(OUT, "selection.json")
    S = json.load(open(sp, encoding="utf8")) if os.path.exists(sp) else {"checked": {}}
    chk = S["checked"]
    scr = Screens()
    s = requests.Session()
    s.headers.update(UA)
    cands = sorted(C["cands"].values(), key=lambda r: (fnv1a(str(r["id"])), r["id"]))
    log(f"select: {len(cands)} candidates")
    changed = True
    while changed:
        changed = False
        for r in cands:
            sid = str(r["id"])
            if sid in chk:
                continue
            kept = [v for v in chk.values() if not v.get("drop")]
            banned = fold_users(v["user"] for v in chk.values() if v.get("ban_uploader"))
            if fold_user(r["user"]) in banned:
                continue
            if r["id"] in ids or fold_user(r["user"]) in ups:       # re-checked here: the trill sources may have grown since the search
                chk[sid] = dict(r, drop="id / uploader used before (checked at selection)")
                continue
            if sum(v["query"] == r["query"] for v in kept) >= PER_Q or sum(fold_user(v["user"]) == fold_user(r["user"]) for v in kept) >= PER_U:
                continue
            changed = True
            rec = dict(r)
            try:
                ph = open(fs_get(s, f"https://freesound.org/people/{r['user']}/sounds/{sid}/", os.path.join(OUT, "pages", f"{sid}.html")), encoding="utf8").read()
            except FileNotFoundError as e:
                chk[sid] = dict(rec, drop=f"sound page: {e}")
                continue
            except IOError as e:
                log(f"Freesound unavailable ({e}); retrying in 5 min")
                time.sleep(300)
                changed = True
                break
            lic = sorted(set(re.findall(r"creativecommons\.org/(?:licenses|publicdomain)/[a-z\-+]+/[\d.]+", ph)))
            tags = re.findall(r'href="/browse/tags/([^/"]+)/?"', ph)
            m = re.search(r'<div id="soundDescriptionSection">(.*?)</div>', ph, re.S)
            desc = html.unescape(re.sub(r"<[^>]+>", " ", m.group(1))).strip() if m else ""
            L = [norm_cc(u) for u in lic]
            rec.update(tags=tags, description=desc[:2000], url=f"https://freesound.org/people/{r['user']}/sounds/{sid}/")
            if len(L) != 1 or L[0] not in LIC_OK:
                chk[sid] = dict(rec, drop=f"licence page {L}")
                write_json(sp, S)
                continue
            rec.update(licence=L[0], licence_url="https://" + lic[0] + "/")
            if KEYWORDS.search(" ".join([desc] + tags)):
                chk[sid] = dict(rec, drop="keyword (description / tags)")
                write_json(sp, S)
                continue
            hq = r["ogg"].replace("-lq.ogg", "-hq.ogg")
            dest = os.path.join(OUT, "audio", os.path.basename(hq))
            try:
                fs_get(s, hq, dest, 1000, 0.5)
                x, sr = sf.read(dest, dtype="float32", always_2d=True)
            except FileNotFoundError as e:
                chk[sid] = dict(rec, drop=f"preview: {e}")
                write_json(sp, S)
                continue
            except Exception as e:  # noqa: BLE001
                chk[sid] = dict(rec, drop=f"preview / decode: {e}")
                write_json(sp, S)
                continue
            x = x[: int(120 * sr)]
            x16 = to16k_mono(x, sr)
            rec.update(preview=hq, sr=int(sr), channels=int(x.shape[1]), dur=round(len(x16) / 16000, 3))
            if len(x16) < 20 * 16000:
                rec["drop"] = "shorter than 20 s"
            else:
                hi = scr.silero_hi(x16)
                rec["speech_chunks"] = hi
                if hi >= 32:
                    rec["drop"] = f"speech screen: {hi} Silero chunks (32 ms) at p >= 0.9"
            if not rec.get("drop"):
                fp = fingerprint(x16)
                for nm, idx in (("earlier", scr.idx), ("sealed", scr.sealed)):
                    mt = idx.match(fp)
                    if mt and mt[0]:
                        rec["drop"] = f"fingerprint match with {'an earlier clip ' + mt[0] if nm == 'earlier' else 'a sealed clip'} (BER {mt[2]:.3f})"
                        rec["ban_uploader"] = True
                        for v in chk.values():
                            if fold_user(v["user"]) == fold_user(r["user"]) and not v.get("drop"):
                                v["drop"] = f"uploader banned: another clip of theirs matched ({sid})"
                                p16 = os.path.join(DATA4, "fsr4", f"{v['id']}.wav")
                                if os.path.exists(p16):
                                    os.remove(p16)
                        break
            if not rec.get("drop"):
                fu = fold_user(r["user"])
                rec["split"] = "val" if fu in ev else ("val" if fnv1a(fu) % 10 == 0 else "train")
                rec["path"] = f"fsr4/{sid}.wav"
                rec["level_scale"] = write_wav16(os.path.join(DATA4, rec["path"]), x16)
            chk[sid] = rec
            write_json(sp, S)
            kept = [v for v in chk.values() if not v.get("drop")]
            log(f"{sid} '{r['query']}': {'KEPT ' + rec['split'] if not rec.get('drop') else rec['drop'][:80]}  (kept {len(kept)}, "
                f"{sum(v['dur'] for v in kept) / 3600:.2f} h)")
    write_json(sp, S)
    manifest()


def manifest():
    S = json.load(open(os.path.join(OUT, "selection.json"), encoding="utf8"))["checked"]
    os.makedirs(DATA4, exist_ok=True)
    n = 0
    with open(MAN, "w", encoding="utf8", newline="\n") as f:
        for sid, v in sorted(S.items(), key=lambda kv: int(kv[0])):
            r = dict(id=f"fsr4__{sid}", kind="nonvoice", source="fsr4", group=f"freesound:{v['user']}", uploader=v["user"], freesound_id=v["id"],
                     query=v["query"], query_part=v.get("part"), title=v.get("title"), url=v.get("url"), member=v.get("preview"))
            if v.get("drop"):
                r["drop"] = v["drop"]
            else:
                r.update(split=v["split"], path=v["path"], dur=v["dur"], sr16=16000, licence=v["licence"], licence_where=f"sound page ({v['licence_url']})",
                         attribution=f"\"{v['title']}\" by {v['user']} (freesound.org/s/{v['id']}/), {v['licence']}", machine_room=True,
                         codec="vorbis HQ preview", speech_chunks=v.get("speech_chunks"))
                n += 1
            f.write(json.dumps(r, ensure_ascii=False) + "\n")
    log(f"manifest.fsr4.jsonl: {n} kept of {len(S)} checked")


if __name__ == "__main__":
    {"search": search, "select": select, "manifest": manifest}[sys.argv[1]]()
