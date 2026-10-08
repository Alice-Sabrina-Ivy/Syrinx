# fs_conf.py — custom voice detector, round 3 (pre-registration §1.2.1 and
# §1.4 group NA): the Freesound part of the confirmatory set, voice (c_fsv)
# and machine / room noise (NA). Search pages scraped as in fetch_r2.py (no API
# key). Selection is by fixed rules only; nobody listens to a clip.
#
#   search   every query x page of the pre-registered lists -> candidates.json
#            (id, uploader, title, duration, preview, licence label, query,
#            subset), with the cheap rules applied and recorded: never-used ids
#            and uploaders (r3/exclude.json), licence label, title keyword rule
#   select   candidates in ascending FNV-1a of the id (voice and NA together):
#            skipped when the query's cap or the uploader's cap (<= 2 clips over
#            the whole confirmatory set) is full; else the sound page (licence
#            URL, description, tags -> keyword rule), the HQ preview, and the
#            automatic screens:
#              voice  YAMNet top class human-vocal in >= 50 % of 0.96 s patches
#                     (custom/voice_screen.py rule), Praat-voiced >= 1.0 s
#                     (first 120 s)
#              noise  Silero speech screen (drop if >= 1.0 s at p >= 0.9; dedup.py),
#                     first 90 s, >= 20 s
#              both   fingerprint vs every earlier clip (fpindex.py, >= 3 s,
#                     BER <= 0.35): a match drops the clip AND bans its uploader
#                     (clips already kept from that uploader are dropped too)
#   --fallback=trills  adds pages 6-8 of the trill queries (§1.3, once, before the seal)
#   --fallback=na      adds pages 3-4 of the NA queries (§1.4, once, before the seal)
#
#   python scripts/voice-detector/r3/fs_conf.py search|select [--fallback=trills,na]
import html
import json
import os
import re
import sys
import time

import numpy as np
import requests

from c3 import CDL, KEYWORDS, SPLITS, UA, args, fnv1a, load_exclude, log, norm_cc, write_json

A = args()
OUT = os.path.join(CDL, "fs")
R2Q = SPLITS["round2"]["fsvoice"]["queries"]
VOICE_KW = re.compile(SPLITS["round2"]["fsvoice"]["keyword_exclude"], re.I)

# round-2 fsvoice queries -> subset (pages 3-5, up to 8 per query)
R2_SUBSET = {}
for q in R2Q:
    if re.search(r"\b(child|children|kid|girl|boy|toddler|baby)\b", q):
        R2_SUBSET[q] = "children"
    elif re.search(r"hum", q):
        R2_SUBSET[q] = "humming"
    elif re.search(r"lip|tongue trill|rolled r|horse lips", q):
        R2_SUBSET[q] = "trills"
    elif re.search(r"siren|glissando|slide", q):
        R2_SUBSET[q] = "sirens"
    elif re.search(r"vocal fry|breathy", q):
        R2_SUBSET[q] = "breathy"
    else:
        R2_SUBSET[q] = "held"
NEW = {
    "trills": ["lip trills", "lip trill exercise", "lip roll warm up", "bubble lips", "motorboat lips", "trilled r", "tongue roll", "rolling r sound",
               "sovt exercise", "straw phonation"],
    "humming": ["humming exercise", "hum warm up", "nasal hum", "humming song", "hummed melody"],
    "sirens": ["siren exercise", "vocal glide", "pitch glide voice", "octave slide voice", "vocal sweep"],
    "held_low": ["monk chant", "om chant", "low drone voice", "basso profundo", "low voice singing", "throat singing"],
    "held_high": ["soprano high note", "high note singing", "whistle register", "head voice exercise", "countertenor", "yodel"],
    "held_other": ["holding a note", "long tone voice", "sustained ah", "drone singing", "lullaby singing", "nursery rhyme singing"],
    "breathy": ["hoarse voice", "raspy voice", "breathy voice", "creaky voice", "voice crack", "laryngitis voice", "elderly voice", "old man speaking",
                "old woman speaking"],
    "speech": ["reading aloud", "poem reading", "storytelling voice", "monologue", "speech recording room"],
}
NA_Q = ["ice maker", "water cooler hum", "vending machine hum", "espresso machine", "coffee maker running", "rice cooker", "air fryer", "induction hob",
        "electric kettle", "food processor", "stand mixer", "juicer", "sewing machine", "paper shredder", "photocopier", "laminator",
        "oxygen concentrator", "cpap machine", "nebulizer", "ups hum", "inverter whine", "led buzz", "dimmer buzz", "electric fence", "power line hum",
        "street light buzz", "lathe", "drill press", "table saw", "bench grinder", "welding machine", "lawn mower", "leaf blower", "pressure washer",
        "electric car interior", "tram interior", "ship engine room", "evaporative cooler", "garage door opener", "car wash", "room tone",
        "apartment room tone", "office room tone", "hospital room ambience"]
SUBSET_ROW = {"held_low": "held", "held_high": "held", "held_other": "held"}


def plan(fallback):
    """(query, page, set, subset, cap) of every search page to read."""
    P = []
    for q in R2Q:
        for pg in (3, 4, 5):
            P.append((q, pg, "voice", R2_SUBSET[q], 8, "r2q"))
    for sub, qs in NEW.items():
        for q in qs:
            for pg in (1, 2, 3):
                P.append((q, pg, "voice", SUBSET_ROW.get(sub, sub), 10, "new"))
    for q in NA_Q:
        for pg in (1, 2):
            P.append((q, pg, "na", "noise", 6, "na"))
    if "trills" in fallback:
        for q in [q for q in R2Q if R2_SUBSET[q] == "trills"] + NEW["trills"]:
            for pg in (6, 7, 8):
                P.append((q, pg, "voice", "trills", 8 if q in R2Q else 10, "fallback-trills"))
    if "na" in fallback:
        for q in NA_Q:
            for pg in (3, 4):
                P.append((q, pg, "na", "noise", 6, "fallback-na"))
    return P


class ServerDown(Exception):
    pass


def fs_get(s, url, dest, min_bytes=1000, pause=1.5):
    if os.path.exists(dest) and os.path.getsize(dest) >= min_bytes:
        return dest
    os.makedirs(os.path.dirname(dest), exist_ok=True)
    for k in range(4):
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


LIC_LABEL_OK = re.compile(r"(?i)^(creative commons 0|attribution( \d\.\d)?|attribution noncommercial( \d\.\d)?)$")
LIC_OK = {"CC0 1.0", "CC BY 3.0", "CC BY 4.0", "CC BY-NC 3.0", "CC BY-NC 4.0"}


def search():
    fallback = A.get("fallback", "")
    ex = load_exclude()
    ex_ids, ex_ups = set(ex["freesound_ids"]), set(ex["freesound_uploaders"])
    s = requests.Session()
    s.headers.update(UA)
    cp = os.path.join(OUT, "candidates.json")
    C = json.load(open(cp, encoding="utf8")) if os.path.exists(cp) else {"pages": {}, "cands": {}, "rejected": []}
    for q, pg, st, sub, cap, origin in plan(fallback):
        key = f"{st}|{q}|{pg}"
        if key in C["pages"]:
            continue
        lo, hi = (3, 300) if st == "voice" else (20, 900)
        url = "https://freesound.org/search/?" + requests.compat.urlencode({"q": q, "f": f"duration:[{lo} TO {hi}]", "page": pg})
        try:
            h = open(fs_get(s, url, os.path.join(OUT, "search", st, re.sub(r"\W+", "_", q) + f"__p{pg}.html")), encoding="utf8").read()
        except (IOError, FileNotFoundError) as e:
            C["pages"][key] = {"error": str(e)}
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
                     query=q, page=pg, set=st, subset=sub, cap=cap, origin=origin)
            why = None
            if str(r["id"]) in C["cands"]:
                continue                                  # an id found by several queries belongs to the first one
            if r["id"] in ex_ids:
                why = "id used before (exclude.json)"
            elif r["user"] in ex_ups:
                why = "uploader used before (exclude.json)"
            elif not r["ogg"]:
                why = "no preview"
            elif not LIC_LABEL_OK.search(r["license_label"].strip()):
                why = f"licence {r['license_label']}"
            elif (VOICE_KW if st == "voice" else KEYWORDS).search(r["title"]):
                why = "keyword (title)"
            if why:
                C["rejected"].append(dict(id=r["id"], user=r["user"], query=q, set=st, why=why))
                continue
            C["cands"][str(r["id"])] = r
        C["pages"][key] = {"results": n}
        write_json(cp, C)
        log(f"search {st} '{q}' p{pg}: {n} results; candidates {len(C['cands'])}")
    write_json(cp, C)
    log(f"search done: {len(C['cands'])} candidates, {len(C['rejected'])} rejected by the cheap rules")


# ----------------------------------------------------------------------------- select
def decode(path, max_sec):
    import soundfile as sf
    x, sr = sf.read(path, dtype="float32", always_2d=True)
    return x[: int(max_sec * sr)], sr


class Screens:
    def __init__(self):
        sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "events"))
        import onnxruntime as ort
        from fpindex import Index
        from c3 import REPO
        self.ort = ort
        m = os.path.join(REPO, "build", "vad", "events", "model", "yamnet_core_fp32.onnx")
        self.mel = np.load(os.path.join(os.path.dirname(m), "mel_257x64.npy"))
        so = ort.SessionOptions()
        so.intra_op_num_threads = 2
        self.yam = ort.InferenceSession(m, so, providers=["CPUExecutionProvider"])
        from yamnet_lib import VOCAL
        self.vocal = set(VOCAL)
        log("loading the fingerprint index ...")
        self.idx = Index()
        log("index loaded")

    def yamnet_share(self, x16):
        from yamnet_lib import log_mel, n_frames, patch_iter
        lm = log_mel(x16, self.mel)
        nf = n_frames(len(lm), 48)
        tops = []
        for b in patch_iter(lm, 48, 96):
            tops += list(self.yam.run(None, {"patches": b})[0].argmax(axis=1))
        tops = np.array(tops[:nf])
        tops = tops[2:] if len(tops) > 3 else tops
        return float(np.isin(tops, list(self.vocal)).mean()) if len(tops) else 0.0

    def silero_hi(self, x16):
        from dedup import SILERO, SPEECH_P
        if not hasattr(self, "sil"):
            o = self.ort.SessionOptions()
            o.inter_op_num_threads = o.intra_op_num_threads = 1
            self.sil = self.ort.InferenceSession(SILERO, providers=["CPUExecutionProvider"], sess_options=o)
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


def select():
    sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "custom"))
    from common import to16k_mono
    from dedup import fingerprint
    import parselmouth
    C = json.load(open(os.path.join(OUT, "candidates.json"), encoding="utf8"))
    sp = os.path.join(OUT, "selection.json")
    S = json.load(open(sp, encoding="utf8")) if os.path.exists(sp) else {"checked": {}}
    chk = S["checked"]                       # id -> record (kept or with `drop`)
    scr = Screens()
    s = requests.Session()
    s.headers.update(UA)
    cands = sorted(C["cands"].values(), key=lambda r: (fnv1a(str(r["id"])), r["id"]))
    log(f"select: {len(cands)} candidates")
    while True:                     # passes until no candidate is newly checked (a ban can reopen earlier slots)
        try:
            if not select_pass(cands, chk, S, sp, scr, s):
                break
        except ServerDown as e:
            log(f"Freesound unavailable ({e}); retrying in 5 min")
            time.sleep(300)
    kept = [v for v in chk.values() if not v.get("drop")]
    log(f"select done: {len(kept)} kept ({sum(v['set'] == 'voice' for v in kept)} voice, {sum(v['set'] == 'na' for v in kept)} NA), {len(chk)} checked")


def select_pass(cands, chk, S, sp, scr, s):
    sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "custom"))
    from common import to16k_mono
    from dedup import fingerprint
    import parselmouth
    changed = False
    for r in cands:
        sid = str(r["id"])
        kept = [v for v in chk.values() if not v.get("drop")]
        banned = {v["user"] for v in chk.values() if v.get("ban_uploader")}
        n_q = sum(1 for v in kept if v["query"] == r["query"] and v["set"] == r["set"])
        n_u = sum(1 for v in kept if v["user"] == r["user"])
        if sid in chk:
            continue
        if r["user"] in banned:
            continue                                   # not checked: uploader banned by a fingerprint match
        if n_q >= r["cap"] or n_u >= 2:
            continue                                   # not checked (cap); may be checked later if a slot reopens
        rec = dict(r)
        changed = True
        try:
            ph = open(fs_get(s, f"https://freesound.org/people/{r['user']}/sounds/{r['id']}/", os.path.join(OUT, "pages", f"{sid}.html")), encoding="utf8").read()
        except FileNotFoundError as e:                       # 404: the sound is gone (availability rule)
            chk[sid] = dict(rec, drop=f"sound page: {e}")
            continue
        except IOError as e:                                 # server trouble: not a data decision; retry the whole pass later
            raise ServerDown(str(e))
        lic = sorted(set(re.findall(r"creativecommons\.org/(?:licenses|publicdomain)/[a-z\-+]+/[\d.]+", ph)))
        tags = re.findall(r'href="/browse/tags/([^/"]+)/?"', ph)
        m = re.search(r'<div id="soundDescriptionSection">(.*?)</div>', ph, re.S)
        desc = html.unescape(re.sub(r"<[^>]+>", " ", m.group(1))).strip() if m else ""
        L = [norm_cc(u) for u in lic]
        rec.update(tags=tags, description=desc[:2000], url=f"https://freesound.org/people/{r['user']}/sounds/{r['id']}/")
        if len(L) != 1 or L[0] not in LIC_OK:
            chk[sid] = dict(rec, drop=f"licence page {L}")
            write_json(sp, S)
            continue
        rec.update(licence=L[0], licence_url="https://" + lic[0] + "/")
        if (VOICE_KW if r["set"] == "voice" else KEYWORDS).search(" ".join([desc] + tags)):
            chk[sid] = dict(rec, drop="keyword (description / tags)")
            write_json(sp, S)
            continue
        hq = r["ogg"].replace("-lq.ogg", "-hq.ogg")
        dest = os.path.join(OUT, "audio", os.path.basename(hq))
        try:
            fs_get(s, hq, dest, 1000, 0.5)
        except FileNotFoundError as e:
            chk[sid] = dict(rec, drop=f"preview: {e}")
            write_json(sp, S)
            continue
        except IOError as e:
            raise ServerDown(str(e))
        rec.update(preview=hq, file=os.path.relpath(dest, CDL).replace("\\", "/"))
        try:
            x, sr = decode(dest, 120 if r["set"] == "voice" else 90)
        except Exception as e:  # noqa: BLE001
            chk[sid] = dict(rec, drop=f"decode: {e}")
            write_json(sp, S)
            continue
        x16 = to16k_mono(x, sr)
        rec.update(sr=int(sr), channels=int(x.shape[1]), used_sec=round(len(x16) / 16000, 3))
        if r["set"] == "voice":
            if len(x16) < 3 * 16000:
                rec["drop"] = "shorter than 3 s"
            else:
                share = scr.yamnet_share(x16)
                p = parselmouth.Sound(x16.astype(float), sampling_frequency=16000).to_pitch_ac(time_step=0.01, pitch_floor=60, pitch_ceiling=1100)
                vs = float((np.nan_to_num(p.selected_array["frequency"]) > 0).sum()) * 0.01
                rec.update(voice_screen=round(share, 3), voiced_sec=round(vs, 2))
                if share < 0.5:
                    rec["drop"] = f"voice screen: top YAMNet class human-vocal in {share:.0%} of patches (< 50 %)"
                elif vs < 1.0:
                    rec["drop"] = f"under 1.0 s Praat-voiced ({vs:.2f} s)"
        else:
            if len(x16) < 20 * 16000:
                rec["drop"] = "shorter than 20 s"
            else:
                hi = scr.silero_hi(x16)
                rec["speech_chunks"] = hi
                if hi >= 32:
                    rec["drop"] = f"speech screen: {hi} Silero chunks (32 ms) at p >= 0.9"
        if not rec.get("drop"):
            mt = scr.idx.match(fingerprint(x16))
            rec["fingerprint"] = None if mt is None else {"match": mt[0], "ber": round(mt[2], 3), "overlap_s": round(mt[4] * 0.016, 2)}
            if mt and mt[0]:
                rec["drop"] = f"fingerprint match with earlier clip {mt[0]} (BER {mt[2]:.3f})"
                rec["ban_uploader"] = True
                for v in chk.values():
                    if v["user"] == r["user"] and not v.get("drop"):
                        v["drop"] = f"uploader banned: another clip of theirs matched earlier audio ({sid})"
        chk[sid] = rec
        write_json(sp, S)
        kept = [v for v in chk.values() if not v.get("drop")]
        log(f"{r['set']} {sid} '{r['query']}': {'KEPT' if not rec.get('drop') else rec['drop'][:70]}  (kept {sum(v['set'] == 'voice' for v in kept)} voice, "
            f"{sum(v['set'] == 'na' for v in kept)} NA)")
    write_json(sp, S)
    return changed


if __name__ == "__main__":
    {"search": search, "select": select}[sys.argv[1]]()
