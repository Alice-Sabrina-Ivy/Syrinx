# trills.py — custom voice detector, round 4 (pre-registration
# measurements/voice-detector-round4-preregistration-2026-10-11.md §2.2): more
# REAL lip and tongue trills for the sealed confirmatory set, found blind
# (nobody listens to, plots or scores a clip; no model of any round runs on
# one). Every check is a fixed rule; the automatic screens' outputs are used
# only for keep / drop.
#
#   calibrate    θ of the trill-modulation screen on VocalSet lip_trill files
#                (CC BY 4.0, an old-harness voice set: neither confirmatory nor
#                training; no model involved), and the pass rate of VocalSet
#                straight files -> build/vad-train/r4/trill-theta.json
#   fs           source c_tr4_fs: Freesound search pages (no API key) of the
#                pre-registered queries, pages 1-3, duration 1-300 s; selection
#   wc           source c_tr4_wc: Wikimedia Commons (File namespace full-text
#                search + trill categories, depth 1)
#   ds-scan      source c_tr4_ds, step 1: Zenodo / Figshare / OSF / Dataverse
#                records and their file lists (metadata only) -> ds-scan.json
#   ds           source c_tr4_ds, step 2: the files of the plan (ds-plan.json,
#                written into Addendum R4-A before any audio is decoded)
#   ia           source c_tr4_ia: Internet Archive advanced search
#   prepare      kept clips of a source -> prepared files + reference + manifest
#                records (prepare_conf.work, round 3's preparation)
#   count        build_conf base, the current-app dumps of new cvoice streams
#                (run-dumps.sh, <= 2 processes), and the trills row's CORRECT
#                hops per gender (the seal.py counts form; aggregate only)
#
# Rules of every new clip (§2.2): new people (fold_user against
# r3/exclude.json, r3/train_exclude.json and the 10 round-3 Commons IPA files
# and contributors); licence read at the source (CC0, PD, CC BY, CC BY-SA,
# CC BY-NC, CC BY-NC-SA; all but CC0 / PD / CC BY evaluation only); the trill
# (or other-SOVT) metadata pattern; round 2's fsvoice keyword exclusion; YAMNet
# human-vocal top class in >= 20 % of patches; Praat-voiced (round 3 §1.6
# reference: AC 60-1100 Hz, 30 dB level gate) >= 1.0 s of the first 120 s
# (0.5 s for Commons); the trill-modulation screen (trills only); fingerprints
# vs every earlier clip (r3/fp), the sealed set (sealfp.py) and this step's
# kept clips (a match drops the clip and bans its group from this step).
#
#   python scripts/voice-detector/r4/trills.py calibrate|fs|wc|ds-scan|ds|ia|prepare --source=c_tr4_fs|count
import collections
import html
import json
import os
import re
import subprocess
import sys
import time

import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, "..", "r3"))
sys.path.insert(0, os.path.join(HERE, "..", "custom"))
sys.path.insert(0, os.path.join(HERE, "..", "train"))
from c3 import CDL, CONF, R3, REPO, ROOT, SPLITS, UA, CManifest, args, fnv1a, fold_user, fold_users, load_exclude, log, norm_cc, write_json  # noqa: E402

A = args()
R4 = os.path.join(ROOT, "r4")
VS = os.path.join(R4, "dl", "vocalset")
THETA = os.path.join(R4, "trill-theta.json")
SR = 16000

TRILL_RX = re.compile(r"(?i)\b(lip[- ]?(trill|roll|bubble|buzz)s?|bubble lips|horse lips|motor ?boat (lips|sound)|tongue[- ]?(trill|roll)s?|trill(ed)? r|"
                      r"roll(ed|ing) r|(bilabial|alveolar|uvular) trill|trill consonant|b+r{2,}|r{3,})\b")
VOICELESS_RX = re.compile(r"(?i)voiceless")
SOVT_RX = re.compile(r"(?i)\b(sovt|semi[- ]?occluded|straw (phonation|singing|exercise)|tube phonation|resonance tube|cup phonation|lax ?vox)\b")
VOICE_KW = re.compile(SPLITS["round2"]["fsvoice"]["keyword_exclude"], re.I)
YAM_MIN = 0.20


def label_meta(text):
    """'trills' | 'sovt' | None from the metadata text (rules 1 and the other-SOVT pattern), and why."""
    if VOICE_KW.search(text):
        return None, f"keyword rule: {VOICE_KW.search(text).group(0)!r}"
    if TRILL_RX.search(text) and not VOICELESS_RX.search(text):
        return "trills", TRILL_RX.search(text).group(0)
    if SOVT_RX.search(text):
        return "sovt", SOVT_RX.search(text).group(0)
    return None, "no trill / SOVT pattern" + (" (voiceless)" if VOICELESS_RX.search(text) else "")


def gender_of(text):
    f = re.search(r"(?i)\b(female|woman|women|girl|soprano|alto|mezzo)\b", text)
    m = re.search(r"(?i)\b(male|man|men|boy|tenor|baritone|bass)\b", text)
    return "f" if f and not m else ("m" if m and not f else "unknown")


# ----------------------------------------------------------------------------- the reference and the modulation screen
def reference(x16):
    """(t0, gated f0 at 10 ms): round 3 §1.6 (prepare_conf.praat + gated)."""
    from prepare_conf import gated, praat
    t0, f0 = praat(x16)
    return t0, gated(x16, t0, f0)


def modscreen(x16, t0, g, theta, min_sec):
    """Trill-modulation screen (§2.2 rule 5) on the Praat-voiced frames.
    Envelope: 50-4000 Hz band (Butterworth order 4, zero phase), Hilbert magnitude, 16 kHz -> 1 kHz (resample_poly).
    Windows 0.5 s, hop 0.25 s, each >= 80 % voiced (gated reference frames whose time lies in the window).
    Window prominence = max of the modulation power spectrum (mean removed, Hann, FFT 1000 points = 1 Hz bins) over
    15-45 Hz minus its median over 2-100 Hz, in dB. A window is trilled when prominence >= theta. Trilled seconds =
    the union of the trilled windows' spans."""
    from scipy.signal import butter, hilbert, resample_poly, sosfiltfilt
    if len(x16) < SR // 2:
        return {"max_prom": None, "windows": 0, "trilled_sec": 0.0, "pass": False}
    sos = butter(4, [50, 4000], btype="band", fs=SR, output="sos")
    env = resample_poly(np.abs(hilbert(sosfiltfilt(sos, np.asarray(x16, np.float64)))), 1, 16)
    tv = t0 + np.arange(len(g)) * 0.01
    v = g > 0
    f = np.fft.rfftfreq(1000, 1 / 1000)
    band, ref = (f >= 15) & (f <= 45), (f >= 2) & (f <= 100)
    hann = np.hanning(500)
    proms, cells = [], set()
    a = 0.0
    while a + 0.5 <= len(env) / 1000 + 1e-9:
        sel = (tv >= a) & (tv < a + 0.5)
        if sel.sum() and v[sel].mean() >= 0.8:
            seg = env[int(round(a * 1000)):int(round(a * 1000)) + 500]
            if len(seg) == 500:
                P = 10 * np.log10(np.abs(np.fft.rfft((seg - seg.mean()) * hann, 1000)) ** 2 + 1e-20)
                pr = float(P[band].max() - np.median(P[ref]))
                proms.append(pr)
                if theta is not None and pr >= theta:
                    k = int(round(a / 0.25))
                    cells |= {k, k + 1}
        a += 0.25
    ts = len(cells) * 0.25
    return {"max_prom": round(max(proms), 2) if proms else None, "windows": len(proms), "trilled_sec": ts,
            "pass": theta is not None and ts >= min_sec - 1e-9}


# ----------------------------------------------------------------------------- calibrate (VocalSet)
VS_URL = "https://zenodo.org/api/records/1442513/files/VocalSet11.zip/content"


def calibrate():
    import soundfile as sf
    from common import to16k_mono
    sys.path.insert(0, os.path.join(REPO, "scripts", "notch-adversarial", "realdata"))
    from remotezip import RemoteZip
    os.makedirs(VS, exist_ok=True)
    rec = json.loads(open(os.path.join(VS, "zenodo_1442513.json"), encoding="utf8").read()) if os.path.exists(os.path.join(VS, "zenodo_1442513.json")) \
        else __import__("requests").get("https://zenodo.org/api/records/1442513", timeout=60).json()
    write_json(os.path.join(VS, "zenodo_1442513.json"), rec, indent=1)
    lp = os.path.join(VS, "members.json")
    if os.path.exists(lp):
        names = json.load(open(lp, encoding="utf8"))
        rz = None
    else:
        rz = RemoteZip(VS_URL)
        allw = [n for n in rz.namelist() if n.endswith(".wav")]
        names = {"lip_trill": sorted(n for n in allw if "/lip_trill/" in n), "straight": sorted(n for n in allw if "/straight/" in n)}
        write_json(lp, names, indent=1)
    todo = [n for ns in names.values() for n in ns if not os.path.exists(os.path.join(VS, "audio", *n.split("/")))]
    if todo:
        import threading
        from concurrent.futures import ThreadPoolExecutor
        tl = threading.local()

        def fetch(n):
            if not hasattr(tl, "rz"):
                tl.rz = RemoteZip(VS_URL)
            dst = os.path.join(VS, "audio", *n.split("/"))
            os.makedirs(os.path.dirname(dst), exist_ok=True)
            open(dst + ".tmp", "wb").write(tl.rz.read(n))
            os.replace(dst + ".tmp", dst)

        with ThreadPoolExecutor(6) as ex:
            for k, _ in enumerate(ex.map(fetch, todo)):
                if k % 50 == 49:
                    log(f"vocalset: {k + 1}/{len(todo)} downloaded")
    res = {}
    for kind, ns in names.items():
        for n in ns:
            dst = os.path.join(VS, "audio", *n.split("/"))
            x, sr = sf.read(dst, dtype="float32", always_2d=True)
            x16 = to16k_mono(x[: int(120 * sr)], sr)
            t0, g = reference(x16)
            res[n] = dict(kind=kind, ms=modscreen(x16, t0, g, None, 1.0), voiced_sec=round(float((g > 0).sum()) * 0.01, 2), t0=t0, g=g)
        log(f"calibrate: {kind} {len(ns)} files measured")
    lt = [r["ms"]["max_prom"] for r in res.values() if r["kind"] == "lip_trill" and r["ms"]["max_prom"] is not None]
    raw = float(np.percentile(lt, 10))
    theta = float(np.clip(raw, 6.0, 15.0))
    # pass rates at theta (the clip rule: >= 1.0 s of trilled windows)
    import soundfile as sf  # noqa: F811
    rates = collections.Counter()
    tot = collections.Counter()
    for n, r in res.items():
        dst = os.path.join(VS, "audio", *n.split("/"))
        x, sr = sf.read(dst, dtype="float32", always_2d=True)
        x16 = to16k_mono(x[: int(120 * sr)], sr)
        ms = modscreen(x16, r["t0"], r["g"], theta, 1.0)
        tot[r["kind"]] += 1
        rates[r["kind"]] += ms["pass"]
        r["ms_theta"] = ms
    straight_rate = rates["straight"] / max(1, tot["straight"])
    J = {"what": "round-4 §2.2 rule 5: theta of the trill-modulation screen, calibrated on VocalSet (VocalSet11.zip, zenodo 1442513, CC BY 4.0) "
                 "lip_trill files; the pass rate of VocalSet straight files decides whether the screen is used",
         "lip_trill_files": tot["lip_trill"], "lip_trill_files_with_an_eligible_window": len(lt),
         "lip_trill_max_prom_p10_raw_db": round(raw, 2), "theta_db": round(theta, 2),
         "lip_trill_max_prom_quantiles_db": {q: round(float(np.percentile(lt, q)), 2) for q in (0, 10, 25, 50, 75, 90, 100)},
         "straight_files": tot["straight"],
         "straight_max_prom_quantiles_db": {q: round(float(np.percentile(s, q)), 2) for q in (0, 10, 25, 50, 75, 90, 100)
                                            for s in [[r["ms"]["max_prom"] for r in res.values() if r["kind"] == "straight" and r["ms"]["max_prom"] is not None]]},
         "pass_rate_lip_trill": round(rates["lip_trill"] / max(1, tot["lip_trill"]), 4),
         "pass_rate_straight": round(straight_rate, 4),
         "screen_used": bool(straight_rate <= 0.20),
         "decision": ("screen used (straight pass rate <= 20 %)" if straight_rate <= 0.20 else
                      "screen DROPPED (straight pass rate > 20 %): rules 1-4 decide alone")}
    write_json(THETA, J, indent=1)
    log(json.dumps(J, indent=1))


def theta_cfg():
    J = json.load(open(THETA, encoding="utf8"))
    return J["theta_db"], J["screen_used"]


# ----------------------------------------------------------------------------- shared selection machinery
class Ctx:
    """Exclusions, screens and the duplicate indexes of this step."""

    def __init__(self):
        ex = load_exclude()
        te = json.load(open(os.path.join(R3, "train_exclude.json"), encoding="utf8"))
        self.ex_ids = set(int(i) for i in ex["freesound_ids"]) | set(int(i) for i in te["freesound_ids"])
        self.ex_ups = fold_users(ex["freesound_uploaders"]) | fold_users(te["freesound_uploaders"])
        grp = list(ex["groups"]) + list(te["groups"])
        self.ex_people = self.ex_ups | fold_users(g.split(":", 1)[1] for g in grp if ":" in g) | fold_users(grp)
        ipa = json.load(open(os.path.join(CDL, "ipa", "commons.json"), encoding="utf8"))
        self.ipa_titles = set(ipa)
        self.ipa_people = fold_users(re.sub(r"\s*\(talk.*$", "", v["artist"]).strip() for v in ipa.values())
        self.ex_people |= self.ipa_people
        self.theta, self.screen_used = theta_cfg()
        self._scr = None
        self.kept_fp = []                 # (name, words) of this step's kept clips

    def person_ok(self, who):
        return bool(who) and fold_user(who) not in self.ex_people

    @property
    def scr(self):
        if self._scr is None:
            from fs_conf import Screens
            from sealfp import SealedIndex
            self._scr = Screens()
            log("loading the sealed-set fingerprint index ...")
            self.sealed = SealedIndex()
            for name, w in self.step_fps():
                self.kept_fp.append((name, w))
        return self._scr

    def step_fps(self):
        """Fingerprints of the clips already kept by this step (every source), from their selection files."""
        out = []
        for k in ("tr4_fs", "tr4_wc", "tr4_ds", "tr4_ia"):
            p = os.path.join(CDL, k, "selection.json")
            if os.path.exists(p):
                for v in json.load(open(p, encoding="utf8"))["checked"].values():
                    if not v.get("drop") and v.get("fp_file"):
                        out.append((v["cid"], np.load(os.path.join(CDL, k, v["fp_file"]))))
        return out

    def screen(self, x, sr, min_voiced, subset, dest_key, cid):
        """Rules 3-5 + the fingerprint checks on decoded audio (first 120 s). Returns (facts, drop-reason or None)."""
        from common import to16k_mono
        from dedup import fingerprint
        scr = self.scr
        x = x[: int(120 * sr)]
        x16 = to16k_mono(x, sr)
        F = dict(sr=int(sr), channels=int(x.shape[1]), used_sec=round(len(x16) / SR, 3))
        if len(x16) < 0.5 * SR:
            return F, "shorter than 0.5 s"
        share = scr.yamnet_share(x16)
        F["voice_screen"] = round(share, 3)
        if share < YAM_MIN:
            return F, f"YAMNet screen: top class human-vocal in {share:.0%} of patches (< 20 %)"
        t0, g = reference(x16)
        vs = float((g > 0).sum()) * 0.01
        F["voiced_sec"] = round(vs, 2)
        if vs < min_voiced:
            return F, f"under {min_voiced} s Praat-voiced ({vs:.2f} s; round 3 §1.6 reference)"
        if subset == "trills" and self.screen_used:
            ms = modscreen(x16, t0, g, self.theta, min_voiced)
            F["modscreen"] = ms
            if not ms["pass"]:
                return F, f"trill-modulation screen: {ms['trilled_sec']:.2f} s of trilled windows (< {min_voiced} s; theta {self.theta} dB)"
        fp = fingerprint(x16)
        for nm, idx in (("earlier", scr.idx), ("sealed", self.sealed)):
            mt = idx.match(fp)
            if mt and mt[0]:
                F["fingerprint"] = {"set": nm, "match": mt[0], "ber": round(mt[2], 3), "overlap_s": round(mt[4] * 0.016, 2)}
                return F, f"fingerprint match with {nm} clip {mt[0]} (BER {mt[2]:.3f}): drop, group banned from this step"
        if self.kept_fp:
            import tempfile
            from fpindex import Index
            with tempfile.TemporaryDirectory() as td:
                p = os.path.join(td, "k.npz")
                np.savez(p, names=np.array([n for n, _ in self.kept_fp]), lens=np.array([len(w) for _, w in self.kept_fp], np.int64),
                         words=np.concatenate([w for _, w in self.kept_fp]).astype(np.uint32))
                mt = Index(p).match(fp)
            if mt and mt[0]:
                F["fingerprint"] = {"set": "this step", "match": mt[0], "ber": round(mt[2], 3), "overlap_s": round(mt[4] * 0.016, 2)}
                return F, f"fingerprint match with this step's kept clip {mt[0]} (BER {mt[2]:.3f}): drop, group banned from this step"
        fpf = os.path.join("fp", cid + ".npy")
        os.makedirs(os.path.join(CDL, dest_key, "fp"), exist_ok=True)
        np.save(os.path.join(CDL, dest_key, fpf), fp)
        F["fp_file"] = fpf
        self.kept_fp.append((cid, fp))
        return F, None


def decode_any(path):
    """(x [n, ch] float32, sr); audio through soundfile, else the first audio track through ffmpeg (native rate)."""
    import soundfile as sf
    try:
        return sf.read(path, dtype="float32", always_2d=True)
    except Exception:  # noqa: BLE001
        pass
    pr = subprocess.run(["ffprobe", "-v", "error", "-select_streams", "a:0", "-show_entries", "stream=sample_rate,channels", "-of", "json", path],
                        capture_output=True, text=True, timeout=120)
    st = (json.loads(pr.stdout or "{}").get("streams") or [None])[0]
    if not st:
        raise IOError("no audio stream")
    sr, ch = int(st["sample_rate"]), int(st.get("channels", 1))
    out = subprocess.run(["ffmpeg", "-v", "error", "-i", path, "-map", "0:a:0", "-t", "120", "-f", "f32le", "-acodec", "pcm_f32le", "-"],
                         capture_output=True, timeout=600)
    if out.returncode:
        raise IOError(out.stderr.decode(errors="replace")[:300])
    x = np.frombuffer(out.stdout, dtype="<f4")
    return x[: len(x) // ch * ch].reshape(-1, ch).copy(), sr


def get(url, dest=None, min_bytes=1, pause=1.0, headers=None, tries=6, **kw):
    import requests
    for k in range(tries):
        try:
            r = requests.get(url, headers=headers or UA, timeout=180, **kw)
            if r.status_code == 200 and len(r.content) >= min_bytes:
                if dest:
                    os.makedirs(os.path.dirname(dest), exist_ok=True)
                    open(dest + ".tmp", "wb").write(r.content)
                    os.replace(dest + ".tmp", dest)
                time.sleep(pause)
                return r
            if r.status_code in (403, 404, 410):
                raise FileNotFoundError(f"{url}: HTTP {r.status_code}")
            time.sleep(10 * (k + 1))
        except requests.RequestException:
            time.sleep(10 * (k + 1))
    raise IOError(f"{url}: retries exhausted")


class Sel:
    """selection.json of one source: checked items (kept or with `drop`), banned groups."""

    def __init__(self, key):
        self.key = key
        self.dir = os.path.join(CDL, key)
        self.p = os.path.join(self.dir, "selection.json")
        self.S = json.load(open(self.p, encoding="utf8")) if os.path.exists(self.p) else {"checked": {}, "banned": []}

    def save(self):
        write_json(self.p, self.S, indent=1)

    @property
    def kept(self):
        return [v for v in self.S["checked"].values() if not v.get("drop")]

    def put(self, iid, rec):
        self.S["checked"][iid] = rec
        if rec.get("drop", "").startswith("fingerprint match"):
            self.S["banned"] = sorted(set(self.S["banned"]) | {fold_user(rec["group"])})
            for v in self.S["checked"].values():
                if fold_user(v.get("group", "")) == fold_user(rec["group"]) and not v.get("drop"):
                    v["drop"] = f"group banned from this step: another clip of it matched ({iid})"
        self.save()
        k = self.kept
        log(f"{self.key} {iid}: {'KEPT ' + rec['subset'] if not rec.get('drop') else rec['drop'][:90]}  "
            f"(kept: trills {sum(v['subset'] == 'trills' for v in k)}, sovt {sum(v['subset'] == 'sovt' for v in k)})")


# ----------------------------------------------------------------------------- c_tr4_fs (Freesound)
FS_Q = ["lip buzz", "lip bubble", "lip bubbles exercise", "lip trill siren", "lip trill scale", "lip trills singing", "lip roll exercise", "brrr lips",
        "motorboat sound mouth", "tongue trill", "tongue trills exercise", "rolled r sound", "trilled r spanish", "spanish rr", "alveolar trill",
        "bilabial trill", "trill consonant", "vocal warm up lips", "singing warm up", "vocal warm up exercise", "voice warm up", "sovt", "straw singing",
        "straw phonation exercise"]
FS_LIC_LABEL = re.compile(r"(?i)^(creative commons 0|attribution( \d\.\d)?|attribution noncommercial( \d\.\d)?)$")
FS_LIC = {"CC0 1.0", "CC BY 3.0", "CC BY 4.0", "CC BY-NC 3.0", "CC BY-NC 4.0"}


def fs():
    import requests
    from fs_conf import fs_get
    ctx = Ctx()
    key = "tr4_fs"
    out = os.path.join(CDL, key)
    cp = os.path.join(out, "candidates.json")
    C = json.load(open(cp, encoding="utf8")) if os.path.exists(cp) else {"pages": {}, "cands": {}, "rejected": []}
    s = requests.Session()
    s.headers.update(UA)
    for q in FS_Q:
        for pg in (1, 2, 3):
            pk = f"{q}|{pg}"
            if pk in C["pages"]:
                continue
            url = "https://freesound.org/search/?" + requests.compat.urlencode({"q": q, "f": "duration:[1 TO 300]", "page": pg})
            try:
                h = open(fs_get(s, url, os.path.join(out, "search", re.sub(r"\W+", "_", q) + f"__p{pg}.html")), encoding="utf8").read()
            except (IOError, FileNotFoundError) as e:
                C["pages"][pk] = {"error": str(e)}
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
                         dur=float(g(r'data-duration="([^"]*)"') or 0), ogg=g(r'data-ogg="([^"]*)"'),
                         license_label=g(r'title="License: ([^"]*)"') or "unknown", query=q, page=pg)
                if str(r["id"]) in C["cands"]:
                    continue
                why = None
                if r["id"] in ctx.ex_ids:
                    why = "id used before (exclude.json / train_exclude.json)"
                elif not ctx.person_ok(r["user"]):
                    why = "uploader used before (exclude.json / train_exclude.json / round-3 IPA contributors)"
                elif not r["ogg"]:
                    why = "no preview"
                elif not FS_LIC_LABEL.search(r["license_label"].strip()):
                    why = f"licence {r['license_label']}"
                elif VOICE_KW.search(r["title"]):
                    why = "keyword (title)"
                if why:
                    C["rejected"].append(dict(id=r["id"], user=r["user"], query=q, why=why))
                    continue
                C["cands"][str(r["id"])] = r
            C["pages"][pk] = {"results": n}
            write_json(cp, C)
            log(f"fs search '{q}' p{pg}: {n} results; candidates {len(C['cands'])}")
    errs = [k for k, v in C["pages"].items() if "error" in v]
    if errs:
        log("page errors:", errs)
    S = Sel(key)
    cands = sorted(C["cands"].values(), key=lambda r: (fnv1a("r4:" + str(r["id"])), r["id"]))
    log(f"fs select: {len(cands)} candidates")
    for r in cands:
        sid = str(r["id"])
        if sid in S.S["checked"]:
            continue
        kept = S.kept
        if fold_user(r["user"]) in S.S["banned"]:
            continue
        if sum(v["query"] == r["query"] for v in kept) >= 10 or sum(fold_user(v["user"]) == fold_user(r["user"]) for v in kept) >= 2:
            continue
        rec = dict(r, cid=f"c_tr4_fs__{sid}", group=f"c_tr4_fs:{r['user']}", item=sid)
        try:
            ph = open(fs_get(s, f"https://freesound.org/people/{r['user']}/sounds/{sid}/", os.path.join(out, "pages", f"{sid}.html")), encoding="utf8").read()
        except FileNotFoundError as e:
            S.put(sid, dict(rec, subset=None, drop=f"sound page: {e}"))
            continue
        lic = sorted(set(re.findall(r"creativecommons\.org/(?:licenses|publicdomain)/[a-z\-+]+/[\d.]+", ph)))
        tags = re.findall(r'href="/browse/tags/([^/"]+)/?"', ph)
        m = re.search(r'<div id="soundDescriptionSection">(.*?)</div>', ph, re.S)
        desc = html.unescape(re.sub(r"<[^>]+>", " ", m.group(1))).strip() if m else ""
        L = [norm_cc(u) for u in lic]
        rec.update(tags=tags, description=desc[:2000], url=f"https://freesound.org/people/{r['user']}/sounds/{sid}/")
        if len(L) != 1 or L[0] not in FS_LIC:
            S.put(sid, dict(rec, subset=None, drop=f"licence page {L}"))
            continue
        rec.update(licence=L[0] + (" (evaluation only)" if "NC" in L[0] else ""), licence_url="https://" + lic[0] + "/")
        text = " ".join([r["title"], desc] + [t.replace("-", " ") for t in tags])
        sub, why = label_meta(text)
        rec.update(subset=sub, label_why=why, gender=gender_of(text))
        if not sub:
            S.put(sid, dict(rec, drop=f"metadata: {why}"))
            continue
        hq = r["ogg"].replace("-lq.ogg", "-hq.ogg")
        dest = os.path.join(out, "audio", os.path.basename(hq))
        try:
            fs_get(s, hq, dest, 1000, 0.5)
            x, sr = decode_any(dest)
        except Exception as e:  # noqa: BLE001
            S.put(sid, dict(rec, drop=f"preview: {e}"))
            continue
        rec.update(preview=hq, file=os.path.relpath(dest, CDL).replace("\\", "/"))
        F, drop = ctx.screen(x, sr, 1.0, sub, key, rec["cid"])
        rec.update(F)
        if drop:
            rec["drop"] = drop
        S.put(sid, rec)
    log(f"fs done: {len(S.kept)} kept")


# ----------------------------------------------------------------------------- c_tr4_wc (Wikimedia Commons)
API = "https://commons.wikimedia.org/w/api.php"
WUA = {"User-Agent": "SyrinxResearchDataFetch/0.1 (voice-detector evaluation; https://github.com/alice-sabrina-ivy/Syrinx)"}
WC_Q = ["lip trill", "lip roll", "bilabial trill", "alveolar trill", "uvular trill", "tongue trill", "rolled r", "trilled r", "vocal warm-up",
        "vocal exercise"]
WC_AUDIO = re.compile(r"\.(oga|ogg|wav|flac|mp3|opus|webm|ogv|mp4|m4a|mpg|mpeg)$", re.I)
WC_CAT = re.compile(r"(?i)(bilabial|alveolar|uvular) trill")


def wapi(**p):
    import requests
    for k in range(8):
        r = requests.get(API, params=dict(p, format="json"), headers=WUA, timeout=60)
        if r.status_code == 429:
            time.sleep(30 * (k + 1))
            continue
        r.raise_for_status()
        return r.json()
    raise IOError("Commons API: retries exhausted")


def wsearch(q, ns):
    out, off = [], 0
    while True:
        j = wapi(action="query", list="search", srsearch=q, srnamespace=ns, srlimit=500, sroffset=off)
        out += [x["title"] for x in j["query"]["search"]]
        if "continue" not in j:
            return out
        off = j["continue"]["sroffset"]


def wmembers(cat, cmtype):
    out, cont = [], {}
    while True:
        j = wapi(action="query", list="categorymembers", cmtitle=cat, cmtype=cmtype, cmlimit=500, **cont)
        out += [x["title"] for x in j["query"]["categorymembers"]]
        if "continue" not in j:
            return out
        cont = {"cmcontinue": j["continue"]["cmcontinue"]}


def winfo(titles):
    res = {}
    for k in range(0, len(titles), 40):
        j = wapi(action="query", titles="|".join(titles[k:k + 40]), prop="imageinfo|categories", iiprop="url|extmetadata|size|mime|user", cllimit=500)
        for p in j["query"]["pages"].values():
            ii = (p.get("imageinfo") or [{}])[0]
            em = ii.get("extmetadata", {})
            res[p["title"]] = {"url": ii.get("url"), "mime": ii.get("mime"), "size": ii.get("size"), "descriptionurl": ii.get("descriptionurl"),
                               "licence": (em.get("LicenseShortName") or {}).get("value"), "licence_url": (em.get("LicenseUrl") or {}).get("value"),
                               "artist": html.unescape(re.sub(r"<[^>]+>", "", (em.get("Artist") or {}).get("value", ""))).strip(),
                               "uploader": ii.get("user"),
                               "description": html.unescape(re.sub(r"<[^>]+>", " ", (em.get("ImageDescription") or {}).get("value", ""))).strip()[:2000],
                               "categories": [c["title"].split(":", 1)[1] for c in p.get("categories", [])]}
    return res


def wc_licence(s):
    """Accepted Commons licence -> (short id, evaluation_only) or None."""
    t = (s or "").strip()
    u = t.upper().replace("-", " ")
    if re.match(r"^(CC0|PUBLIC DOMAIN|PD\b)", u):
        return ("CC0 1.0" if u.startswith("CC0") else "Public domain"), False
    m = re.match(r"^CC (BY(?: SA| NC| NC SA)?) (\d\.\d)", u)
    if not m or "ND" in u:
        return None
    kind = m.group(1).replace(" ", "-")
    return f"CC {kind} {m.group(2)}", kind != "BY"


def anon_key(src, who):
    return f"{src}:a{fnv1a(who):08x}"


def wc():
    ctx = Ctx()
    key = "tr4_wc"
    out = os.path.join(CDL, key)
    cp = os.path.join(out, "candidates.json")
    if not os.path.exists(cp):
        found = collections.OrderedDict()
        for q in WC_Q:
            for t in wsearch(q, 6):
                found.setdefault(t, f"search:{q}")
        cats = sorted({t for t in wsearch("trill", 14) if WC_CAT.search(t)})
        for c in cats:
            subs = [x for x in wmembers(c, "subcat")]
            for cc in [c] + subs:
                for t in wmembers(cc, "file"):
                    found.setdefault(t, f"category:{cc}")
        titles = [t for t in found if WC_AUDIO.search(t)]
        info = winfo(titles)
        write_json(cp, {"categories": cats, "found": len(found), "audio_titles": len(titles), "via": {t: found[t] for t in titles}, "info": info}, indent=1)
    C = json.load(open(cp, encoding="utf8"))
    S = Sel(key)
    items = sorted(C["info"].items(), key=lambda kv: (fnv1a("r4:" + kv[0]), kv[0]))
    log(f"wc: {C['found']} titles found, {len(items)} audio / video files")
    for t, v in items:
        if t in S.S["checked"]:
            continue
        who = re.sub(r"\s*\(talk.*$", "", v.get("artist") or "").strip() or (v.get("uploader") or "")
        grp = anon_key("c_tr4_wc", fold_user(who) or f"file:{t}")
        rec = dict(cid=f"c_tr4_wc__{fnv1a(t):08x}", item=t, group=grp, url=v["descriptionurl"],
                   via=C["via"][t], categories=v.get("categories"), subset=None, query=C["via"][t])
        if t in ctx.ipa_titles:
            S.put(t, dict(rec, drop="a round-3 Commons IPA file"))
            continue
        if not ctx.person_ok(who) or not ctx.person_ok(v.get("uploader") or who):
            S.put(t, dict(rec, drop="contributor used before (or a round-3 IPA contributor)" if who else "no contributor stated"))
            continue
        if sum(v2["group"] == grp for v2 in S.kept) >= 5:
            continue
        if grp in S.S["banned"]:
            continue
        L = wc_licence(v.get("licence"))
        if not L:
            S.put(t, dict(rec, drop=f"licence {v.get('licence')!r}"))
            continue
        rec.update(licence=L[0] + (" (evaluation only)" if L[1] else ""), licence_url=v.get("licence_url"),
                   attribution=f"{t.split(':', 1)[1]} (Wikimedia Commons); contributor as credited on the file page; {L[0]}")
        text = " ".join([t.split(":", 1)[1].rsplit(".", 1)[0].replace("_", " "), v.get("description") or ""] + (v.get("categories") or []))
        sub, why = label_meta(text)
        rec.update(subset=sub, label_why=why, gender=gender_of(text))
        if not sub:
            S.put(t, dict(rec, drop=f"metadata: {why}"))
            continue
        if (v.get("size") or 0) > 300e6:
            S.put(t, dict(rec, drop=f"file over 300 MB ({v.get('size')})"))
            continue
        dest = os.path.join(out, "audio", re.sub(r"[^\w.\-]+", "_", t.split(":", 1)[1]))
        try:
            if not os.path.exists(dest):
                get(v["url"], dest, pause=3, headers=WUA)
            x, sr = decode_any(dest)
        except Exception as e:  # noqa: BLE001
            S.put(t, dict(rec, drop=f"download / decode: {e}"))
            continue
        rec["file"] = os.path.relpath(dest, CDL).replace("\\", "/")
        F, drop = ctx.screen(x, sr, 0.5, sub, key, rec["cid"])
        rec.update(F)
        if drop:
            rec["drop"] = drop
        S.put(t, rec)
    log(f"wc done: {len(S.kept)} kept")


# ----------------------------------------------------------------------------- c_tr4_ds (open research datasets)
DS_Q = ["lip trill", "tongue trill", "semi-occluded vocal tract", "SOVT", "straw phonation", "tube phonation", "voiced bilabial trill",
        "lip vibration phonation"]
DS_AUDIO = re.compile(r"\.(wav|flac|mp3|ogg|m4a)$", re.I)
DS_ARCH = re.compile(r"\.(zip|tar|tgz|tar\.gz|7z|rar)$", re.I)


def ds_scan():
    import requests
    out = os.path.join(CDL, "tr4_ds")
    R = {}
    for q in DS_Q:
        # Zenodo
        try:
            j = requests.get("https://zenodo.org/api/records", params={"q": f'"{q}"', "type": "dataset", "access_right": "open", "size": 100},
                             headers=UA, timeout=60).json()
            for h in j.get("hits", {}).get("hits", []):
                rid = f"zenodo:{h['id']}"
                R.setdefault(rid, {"repo": "zenodo", "id": h["id"], "title": h["metadata"].get("title"), "licence": (h["metadata"].get("license") or {}).get("id"),
                                   "url": h["links"].get("self_html") or f"https://zenodo.org/records/{h['id']}", "queries": [],
                                   "description": re.sub(r"<[^>]+>", " ", h["metadata"].get("description") or "")[:3000],
                                   "keywords": h["metadata"].get("keywords"),
                                   "files": [{"key": f["key"], "size": f["size"], "url": f["links"]["self"]} for f in h.get("files", [])]})
                R[rid]["queries"].append(q)
        except Exception as e:  # noqa: BLE001
            log("zenodo", q, e)
        # Figshare
        try:
            arts = requests.post("https://api.figshare.com/v2/articles/search", json={"search_for": f'"{q}"', "item_type": 3, "page_size": 100},
                                 headers=UA, timeout=60).json()
            for a in arts if isinstance(arts, list) else []:
                rid = f"figshare:{a['id']}"
                if rid not in R:
                    d = requests.get(f"https://api.figshare.com/v2/articles/{a['id']}", headers=UA, timeout=60).json()
                    R[rid] = {"repo": "figshare", "id": a["id"], "title": d.get("title"), "licence": (d.get("license") or {}).get("name"),
                              "url": d.get("url_public_html"), "queries": [], "description": re.sub(r"<[^>]+>", " ", d.get("description") or "")[:3000],
                              "keywords": d.get("tags"), "files": [{"key": f["name"], "size": f["size"], "url": f["download_url"]} for f in d.get("files", [])]}
                    time.sleep(1)
                R[rid]["queries"].append(q)
        except Exception as e:  # noqa: BLE001
            log("figshare", q, e)
        # Harvard Dataverse
        try:
            j = requests.get("https://dataverse.harvard.edu/api/search", params={"q": f'"{q}"', "type": "dataset", "per_page": 100}, headers=UA, timeout=60).json()
            for it in j.get("data", {}).get("items", []):
                pid = it.get("global_id")
                rid = f"dataverse:{pid}"
                if rid not in R:
                    d = requests.get("https://dataverse.harvard.edu/api/datasets/:persistentId/", params={"persistentId": pid}, headers=UA, timeout=60).json()
                    lv = (d.get("data") or {}).get("latestVersion") or {}
                    files = [{"key": f["dataFile"].get("filename"), "size": f["dataFile"].get("filesize"),
                              "url": f"https://dataverse.harvard.edu/api/access/datafile/{f['dataFile']['id']}", "restricted": f.get("restricted")}
                             for f in lv.get("files", [])]
                    R[rid] = {"repo": "dataverse", "id": pid, "title": it.get("name"), "licence": (lv.get("license") or {}).get("name") or lv.get("termsOfUse"),
                              "url": it.get("url"), "queries": [], "description": (it.get("description") or "")[:3000], "keywords": it.get("keywords"),
                              "files": files}
                    time.sleep(1)
                R[rid]["queries"].append(q)
        except Exception as e:  # noqa: BLE001
            log("dataverse", q, e)
        # OSF (public nodes, title / description contains the query)
        try:
            for fld in ("title", "description"):
                j = requests.get("https://api.osf.io/v2/nodes/", params={f"filter[{fld}][icontains]": q, "page[size]": 100}, headers=UA, timeout=60).json()
                for n in j.get("data", []):
                    rid = f"osf:{n['id']}"
                    if rid not in R:
                        at = n["attributes"]
                        R[rid] = {"repo": "osf", "id": n["id"], "title": at.get("title"), "licence": None, "url": f"https://osf.io/{n['id']}/",
                                  "queries": [], "description": (at.get("description") or "")[:3000], "keywords": at.get("tags"), "files": None,
                                  "license_rel": ((n.get("relationships") or {}).get("license") or {}).get("links", {}).get("related", {}).get("href")}
                    R[rid]["queries"].append(q)
        except Exception as e:  # noqa: BLE001
            log("osf", q, e)
        log(f"ds-scan '{q}': {len(R)} records so far")
    # OSF: file listing (osfstorage, recursive to depth 3) and licence of every node found
    for rid, r in R.items():
        if r["repo"] != "osf":
            continue
        files = []
        try:
            def walk(url, depth):
                while url:
                    j = requests.get(url, headers=UA, timeout=60).json()
                    for f in j.get("data", []):
                        at = f["attributes"]
                        if at["kind"] == "folder" and depth < 3:
                            walk(f["relationships"]["files"]["links"]["related"]["href"], depth + 1)
                        elif at["kind"] == "file":
                            files.append({"key": at["materialized_path"], "size": at.get("size"), "url": f["links"].get("download")})
                    url = (j.get("links") or {}).get("next")
            walk(f"https://api.osf.io/v2/nodes/{r['id']}/files/osfstorage/", 0)
            if r.get("license_rel"):
                lj = requests.get(r["license_rel"], headers=UA, timeout=60).json()
                r["licence"] = ((lj.get("data") or {}).get("attributes") or {}).get("name")
        except Exception as e:  # noqa: BLE001
            r["scan_error"] = str(e)
        r["files"] = files
        time.sleep(0.5)
    for r in R.values():
        fl = r.get("files") or []
        r["n_audio"] = sum(bool(DS_AUDIO.search(f["key"] or "")) for f in fl)
        r["n_archives"] = sum(bool(DS_ARCH.search(f["key"] or "")) for f in fl)
        r["bytes"] = sum((f.get("size") or 0) for f in fl)
        r["meta_label"] = label_meta(" ".join([r.get("title") or "", r.get("description") or ""] + list(r.get("keywords") or [])))
    write_json(os.path.join(out, "ds-scan.json"), R, indent=1)
    for rid, r in sorted(R.items()):
        if r["n_audio"] or r["n_archives"]:
            log(f"{rid}: audio {r['n_audio']}, archives {r['n_archives']}, {r['bytes'] / 1e9:.2f} GB, licence {r['licence']!r}: {(r['title'] or '')[:90]}")
    log(f"ds-scan: {len(R)} records, {sum(1 for r in R.values() if r['n_audio'] or r['n_archives'])} with audio files or archives")


def ds():
    """Files of ds-plan.json (participant schemes written into Addendum R4-A before any audio is decoded)."""
    ctx = Ctx()
    key = "tr4_ds"
    plan = json.load(open(os.path.join(CDL, key, "ds-plan.json"), encoding="utf8"))
    S = Sel(key)
    for rec_id, P in sorted(plan["records"].items(), key=lambda kv: (fnv1a("r4:" + kv[0]), kv[0])):
        if not P.get("use"):
            continue
        used_rec = sum(v.get("used_sec", 0) for v in S.kept if v["record"] == rec_id)
        for f in sorted(P["files"], key=lambda f: (fnv1a("r4:" + rec_id + "/" + f["key"]), f["key"])):
            iid = f"{rec_id}/{f['key']}"
            if iid in S.S["checked"]:
                continue
            grp = f"c_tr4_ds:{rec_id}:{f['participant']}"
            rec = dict(cid="c_tr4_ds__" + re.sub(r"[^\w.-]+", "_", rec_id) + f"__{fnv1a(iid):08x}", item=iid, record=rec_id, group=grp,
                       participant=f["participant"], url=P["url"], member=f["key"], subset=f["subset"], label_why=f.get("label_why"), gender=f.get("gender", "unknown"),
                       licence=P["licence"] + (" (evaluation only)" if P.get("eval_only") else ""), licence_where=P.get("licence_where"),
                       attribution=P.get("attribution"), query=P.get("query"))
            if grp in S.S["banned"]:
                continue
            if used_rec >= 30 * 60:
                S.put(iid, dict(rec, drop="over 30 min for this record (files in FNV order)"))
                continue
            if sum(v.get("used_sec", 0) for v in S.kept if v["group"] == grp) >= 5 * 60:
                S.put(iid, dict(rec, drop="over 5 min for this participant (files in FNV order)"))
                continue
            dest = os.path.join(CDL, key, "audio", re.sub(r"[^\w.\-]+", "_", rec_id), *[re.sub(r"[^\w.\-]+", "_", p) for p in f["key"].split("/") if p])
            try:
                if f.get("archive"):
                    if not os.path.exists(dest):
                        sys.path.insert(0, os.path.join(REPO, "scripts", "notch-adversarial", "realdata"))
                        from remotezip import RemoteZip
                        rz = RemoteZip(f["archive_url"])
                        os.makedirs(os.path.dirname(dest), exist_ok=True)
                        open(dest, "wb").write(rz.read(f["archive_member"]))
                elif not os.path.exists(dest):
                    get(f["url"], dest, pause=1)
                x, sr = decode_any(dest)
            except Exception as e:  # noqa: BLE001
                S.put(iid, dict(rec, drop=f"download / decode: {e}"))
                continue
            rec["file"] = os.path.relpath(dest, CDL).replace("\\", "/")
            F, drop = ctx.screen(x, sr, 1.0, rec["subset"], key, rec["cid"])
            rec.update(F)
            if drop:
                rec["drop"] = drop
            S.put(iid, rec)
            if not drop:
                used_rec += F["used_sec"]
    log(f"ds done: {len(S.kept)} kept")


# ----------------------------------------------------------------------------- c_tr4_ia (Internet Archive)
IA_Q = ["lip trill", "lip trills", "tongue trill", "vocal warm up"]
IA_AUDIO = re.compile(r"\.(wav|flac|mp3|ogg|m4a|aiff?|opus)$", re.I)


def ia_licence(u):
    t = (u or "").lower()
    if "publicdomain/zero" in t:
        return "CC0 1.0", False
    if "publicdomain/mark" in t or "publicdomain" in t:
        return "Public domain", False
    m = re.search(r"creativecommons\.org/licenses/([a-z\-]+)/([\d.]+)", t)
    if not m or "nd" in m.group(1).split("-"):
        return None
    kind = m.group(1).upper()
    if kind not in ("BY", "BY-SA", "BY-NC", "BY-NC-SA"):
        return None
    return f"CC {kind} {m.group(2)}", kind != "BY"


def ia():
    import requests
    ctx = Ctx()
    key = "tr4_ia"
    out = os.path.join(CDL, key)
    cp = os.path.join(out, "candidates.json")
    if not os.path.exists(cp):
        items = {}
        for q in IA_Q:
            qq = f'("{q}") AND mediatype:(audio OR movies) AND (licenseurl:*creativecommons* OR licenseurl:*publicdomain*)'
            j = requests.get("https://archive.org/advancedsearch.php", params={"q": qq, "fl[]": ["identifier", "title", "licenseurl", "uploader", "creator",
                                                                                                  "mediatype"], "rows": 500, "output": "json"},
                             headers=UA, timeout=120).json()
            for d in j["response"]["docs"]:
                items.setdefault(d["identifier"], dict(d, query=q))
            log(f"ia search '{q}': {j['response']['numFound']} found")
        for iid in list(items):
            md = requests.get(f"https://archive.org/metadata/{iid}", headers=UA, timeout=120).json()
            m = md.get("metadata", {})
            items[iid]["meta"] = {k: m.get(k) for k in ("title", "description", "subject", "creator", "uploader", "licenseurl", "date")}
            items[iid]["files"] = [{"name": f["name"], "size": f.get("size"), "source": f.get("source"), "format": f.get("format"), "length": f.get("length")}
                                   for f in md.get("files", []) if IA_AUDIO.search(f["name"])]
            time.sleep(0.5)
        write_json(cp, items, indent=1)
    C = json.load(open(cp, encoding="utf8"))
    S = Sel(key)
    for iid, it in sorted(C.items(), key=lambda kv: (fnv1a("r4:" + kv[0]), kv[0])):
        m = it.get("meta") or {}
        up = m.get("uploader") or it.get("uploader") or ""
        who = fold_user(up) or f"item:{iid}"
        grp = anon_key("c_tr4_ia", who)
        if grp in S.S["banned"] or len({v["item_id"] for v in S.kept if v["group"] == grp}) >= 2:
            continue
        lic = ia_licence(m.get("licenseurl") or it.get("licenseurl"))
        crea = m.get("creator") if isinstance(m.get("creator"), str) else ", ".join(m.get("creator") or [])
        desc = m.get("description") if isinstance(m.get("description"), str) else " ".join(m.get("description") or [])
        subj = m.get("subject") if isinstance(m.get("subject"), list) else [m.get("subject") or ""]
        if any(not ctx.person_ok(p) for p in (up, crea) if p):
            S.put(iid, dict(cid=f"c_tr4_ia__{fnv1a(iid):08x}", item=iid, item_id=iid, group=grp, subset=None, query=it.get("query"), drop="uploader / creator used before"))
            continue
        orig = [f for f in it.get("files", []) if f.get("source") == "original"] or it.get("files", [])
        n_item = 0
        for f in sorted(orig, key=lambda f: (fnv1a("r4:" + iid + "/" + f["name"]), f["name"])):
            fid = f"{iid}/{f['name']}"
            if fid in S.S["checked"]:
                n_item += not S.S["checked"][fid].get("drop")
                continue
            if n_item >= 3:
                break
            rec = dict(cid=f"c_tr4_ia__{fnv1a(fid):08x}", item=fid, item_id=iid, group=grp,
                       url=f"https://archive.org/details/{iid}", member=f["name"], query=it.get("query"), subset=None)
            if not lic:
                S.put(fid, dict(rec, drop=f"licence {m.get('licenseurl') or it.get('licenseurl')!r}"))
                continue
            rec.update(licence=lic[0] + (" (evaluation only)" if lic[1] else ""), licence_url=m.get("licenseurl") or it.get("licenseurl"),
                       attribution=f"{m.get('title') or iid} (archive.org/details/{iid}); creator as credited there; {lic[0]}")
            text = " ".join([m.get("title") or "", desc or "", f["name"]] + [s for s in subj if s])
            sub, why = label_meta(text)
            rec.update(subset=sub, label_why=why, gender=gender_of(text))
            if not sub:
                S.put(fid, dict(rec, drop=f"metadata: {why}"))
                continue
            dest = os.path.join(out, "audio", re.sub(r"[^\w.\-]+", "_", iid), re.sub(r"[^\w.\-]+", "_", f["name"]))
            try:
                if not os.path.exists(dest):
                    if float(f.get("size") or 0) > 500e6:
                        raise IOError(f"file over 500 MB ({f.get('size')})")
                    get(f"https://archive.org/download/{iid}/{requests.utils.quote(f['name'])}", dest, pause=1)
                x, sr = decode_any(dest)
            except Exception as e:  # noqa: BLE001
                S.put(fid, dict(rec, drop=f"download / decode: {e}"))
                continue
            rec["file"] = os.path.relpath(dest, CDL).replace("\\", "/")
            F, drop = ctx.screen(x, sr, 1.0, sub, key, rec["cid"])
            rec.update(F)
            if drop:
                rec["drop"] = drop
            S.put(fid, rec)
            n_item += not drop
    log(f"ia done: {len(S.kept)} kept")


# ----------------------------------------------------------------------------- prepare (manifest records)
SRC_KEY = {"c_tr4_fs": "tr4_fs", "c_tr4_wc": "tr4_wc", "c_tr4_ds": "tr4_ds", "c_tr4_ia": "tr4_ia"}


def prepare():
    from prepare_conf import Pool
    src = A["source"]
    S = Sel(SRC_KEY[src])
    man = CManifest()
    P = Pool(man)
    for iid, v in sorted(S.S["checked"].items()):
        if v.get("drop"):
            continue
        r = dict(id=v["cid"], kind="voice", source=src, subset=v["subset"], group=v["group"], session_group=v["group"], gender=v.get("gender", "unknown"),
                 url=v.get("url"), member=v.get("member") or v.get("item"), licence=v["licence"], licence_where=v.get("licence_where") or
                 (f"source page ({v.get('licence_url')})" if v.get("licence_url") else None), attribution=v.get("attribution") or
                 (f"\"{v.get('title')}\" by {v.get('user')} (freesound.org/s/{v.get('id')}/), {v['licence']}" if src == "c_tr4_fs" else None),
                 query=v.get("query"), origin="round4", label_why=v.get("label_why"), file=os.path.join(CDL, v["file"]), max_sec=120,
                 min_sec=0.5 if src == "c_tr4_wc" else 1.0)
        if src == "c_tr4_fs":
            r.update(freesound_id=v["id"], uploader=v["user"], title=v.get("title"), page=v.get("page"))
        if src == "c_tr4_ds":
            r.update(participant=v.get("participant"), record=v.get("record"))
        P.submit(r)
    P.finish(src)


# ----------------------------------------------------------------------------- count (trills row, aggregate)
def count():
    env = dict(os.environ, ROOT=os.path.relpath(CONF, REPO).replace("\\", "/"), MAXJ="2")
    subprocess.run([sys.executable, os.path.join(HERE, "..", "r3", "build_conf.py"), "base"], cwd=REPO, check=True)
    subprocess.run([os.environ.get("BASH_EXE", "C:/Program Files/Git/bin/bash.exe"), "scripts/voice-detector/r3/run-dumps.sh", "cvoice:2"], cwd=REPO, env=env, check=True)
    specs = json.load(open(os.path.join(CONF, "streams", "cvoice.json"), encoding="utf8"))
    row = collections.Counter()
    for it in specs:
        if it["meta"].get("subset") not in ("trills", "sovt"):
            continue
        jp = os.path.join(CONF, "dumps", "cvoice", it["id"] + ".json")
        m = json.load(open(jp, encoding="utf8"))
        a = np.fromfile(jp[:-5] + ".f32", dtype="<f4").reshape(len(m["cols"]), m["n"])
        lab = a[m["cols"].index("lab")]
        row[f"{m['subset']}|{m['gender']}"] += int((lab == 1).sum())
    tot = {s: sum(v for k, v in row.items() if k.startswith(s + "|")) for s in ("trills", "sovt")}
    J = {"t": time.strftime("%Y-%m-%d %H:%M:%S"), "rows": dict(sorted(row.items())), "totals": tot}
    hist = os.path.join(R4, "trills-counts.jsonl")
    with open(hist, "a", encoding="utf8") as f:
        f.write(json.dumps(J) + "\n")
    log("trills / other-SOVT rows (CORRECT hops, current app, aggregate):", J)


if __name__ == "__main__":
    {"calibrate": calibrate, "fs": fs, "wc": wc, "ds-scan": ds_scan, "ds": ds, "ia": ia, "prepare": prepare, "count": count}[sys.argv[1]]()
