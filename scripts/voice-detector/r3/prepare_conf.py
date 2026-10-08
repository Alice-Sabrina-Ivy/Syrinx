# prepare_conf.py — custom voice detector, round 3 (pre-registration §1.2-1.6):
# turn the downloaded confirmatory sources into prepared files + manifest
# records (build/vad-train/r3/conf/manifest.jsonl). Nothing here plays, plots
# or scores the audio; the only figures computed are the Praat reference and
# file-level facts (duration, voiced seconds) that the pre-registered rules need.
#
# Voice record -> conf/audio/voice/<source>/<id>.wav   native rate, first channel (fresh clean streams)
#                 conf/audio/voice16/<source>/<id>.wav 16 kHz (mix programs, one-room sessions)
#                 conf/refs/<id>.f32                   reference track (10 ms): Praat AC 60-1100 Hz
#                                                      on the 16 kHz recording (heldseg.py praat_f0
#                                                      settings, prepare.py), frames kept only when
#                                                      within 30 dB of the recording's 95th-percentile
#                                                      voiced level (tcommon.voice_labels rule); 0 = unvoiced
# Noise record -> conf/audio/noise/<id>.wav            16 kHz, first 90 s (the benchmark convention)
#
#   python scripts/voice-detector/r3/prepare_conf.py --sources=ls,sbi,gts,jj,qbh,aa,fry,ipa,fsv,na,nb [--jobs=2]
import collections
import io
import json
import os
import re
import sys
import zipfile
from concurrent.futures import ProcessPoolExecutor

import numpy as np

from c3 import CAUDIO, CDL, CREFS, CManifest, SR, args, fnv1a, log

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "custom"))
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "train"))

A = args()
JOBS = int(A.get("jobs", "2"))

LIC = {
    "c_ls": ("CC BY 4.0", "OpenSLR 12 resource page + LICENSE.TXT of the tarball",
             "LibriSpeech ASR corpus (openslr.org/12), train-clean-100, CC BY 4.0; audio derived from LibriVox recordings"),
    "c_sbi": ("CC BY 4.0", "Zenodo record 20744738 licence + LICENSE.md",
              "SingBAP (intermediate participants), S. Haeaeraee and R. Ramirez-Melendez, Universitat Pompeu Fabra, Music Technology Group "
              "(zenodo 20744738), CC BY 4.0"),
    "c_gts": ("CC BY-NC-SA 4.0 (evaluation only)", "Hugging Face GTSinger/GTSinger dataset_license.md",
              "GTSinger: A Global Multi-Technique Singing Corpus, Y. Zhang, C. Pan, W. Guo et al. (NeurIPS 2024 D&B; huggingface.co/datasets/GTSinger/GTSinger), CC BY-NC-SA 4.0"),
    "c_jj": ("CC BY 4.0", "Zenodo record 1421692 licence",
             "Jingju a cappella singing dataset part 2, R. Gong, R. Caro Repetto, Y. Yang, X. Serra (zenodo 1421692), CC BY 4.0"),
    "c_qbh": ("CC BY 4.0 record / README 'internal non-commercial use only' (evaluation only)", "Zenodo record 1290712 licence + the dataset README",
              "MTG-QBH: Query By Humming dataset, J. Salamon, J. Serra, E. Gomez (zenodo 1290712)"),
    "c_aa": ("CC BY 4.0", "Zenodo records 7098345 / 7098349 licence",
             "AcousticsAustraliaArticle_dataset: audio samples, vowel phonation (zenodo 7098345) and participant profiles (zenodo 7098349), CC BY 4.0"),
}


def praat(x16):
    import parselmouth
    p = parselmouth.Sound(np.asarray(x16, float), sampling_frequency=SR).to_pitch_ac(time_step=0.01, pitch_floor=60, pitch_ceiling=1100)
    return (float(p.xs()[0]) if p.n_frames else 0.0), np.nan_to_num(p.selected_array["frequency"]).astype(np.float32)


def gated(x16, t0, f0):
    from tcommon import frame_levels_db
    v = f0 > 0
    if not v.any():
        return f0.copy()
    lev = frame_levels_db(x16, t0, 0.01, len(f0))
    ref = np.percentile(lev[v], 95)
    return np.where(v & (lev >= ref - 30.0), f0, 0).astype(np.float32)


def work(t):
    """Decode one file, write the prepared audio (+ reference for voice). Returns the manifest record."""
    import soundfile as sf
    from common import to16k_mono, write_wav16
    try:
        if "bytes" in t:
            x, sr = sf.read(io.BytesIO(t.pop("bytes")), always_2d=True, dtype="float32")
        else:
            x, sr = sf.read(t.pop("file"), always_2d=True, dtype="float32")
    except Exception as e:  # noqa: BLE001
        t.pop("bytes", None)
        return dict(t, drop=f"decode: {e}")
    ch = x.shape[1]
    a0 = int(t.pop("from_sec", 0) * sr)
    x = x[a0:]
    if t.get("max_sec"):
        x = x[: int(t.pop("max_sec") * sr)]
    t.update(orig_sr=int(sr), orig_channels=int(ch))
    if len(x) < sr * t.pop("min_sec", 0.5):
        return dict(t, drop="shorter than the minimum", dur=round(len(x) / sr, 3))
    y = to16k_mono(x, sr)
    t["dur"] = round(len(y) / SR, 3)
    if t["kind"] == "noise":
        rel = f"noise/{t['source']}/{t['id']}.wav"
        t["level_scale"] = write_wav16(os.path.join(CAUDIO, rel), y)
        t.update(path16=rel, sr16=SR)
        return t
    rel = f"voice/{t['source']}/{t['id']}.wav"
    t["level_scale"] = write_wav16(os.path.join(CAUDIO, rel), x[:, 0], int(sr))
    rel16 = f"voice16/{t['source']}/{t['id']}.wav"
    s16 = write_wav16(os.path.join(CAUDIO, rel16), y)
    t.update(path=rel, sr=int(sr), path16=rel16, sr16=SR, scale16=s16)
    y = np.clip(y * s16, -1, 1).astype(np.float32)
    t0, f0 = praat(y)
    g = gated(y, t0, f0)
    os.makedirs(CREFS, exist_ok=True)
    g.astype("<f4").tofile(os.path.join(CREFS, t["id"] + ".f32"))
    np.savez_compressed(os.path.join(CREFS, t["id"] + ".praat.npz"), t0=t0, hop=0.01, f0=f0)
    v = g > 0
    t.update(ref={"path": f"refs/{t['id']}.f32", "t0": t0, "hop": 0.01}, voiced_sec=round(float(v.sum()) * 0.01, 2),
             praat_voiced_sec=round(float((f0 > 0).sum()) * 0.01, 2),
             f0_median=round(float(np.median(g[v])), 1) if v.any() else 0.0)
    if not v.any():
        t["drop"] = "no voiced frame (Praat AC, 30 dB level rule)"
    return t


class Pool:
    def __init__(self, man):
        self.ex = ProcessPoolExecutor(JOBS)
        self.fs, self.man, self.n = [], man, collections.Counter()

    def submit(self, t):
        if t["id"] in self.man.have and not self.man.have[t["id"]].get("drop", "").startswith("decode"):
            return
        self.fs.append(self.ex.submit(work, t))
        if len(self.fs) >= 6 * JOBS:
            self._drain(3 * JOBS)

    def add_drop(self, t, why):
        if t["id"] not in self.man.have:
            t.pop("bytes", None)
            t.pop("file", None)
            self.man.add(dict(t, drop=why))

    def _drain(self, keep=0):
        while len(self.fs) > keep:
            r = self.fs.pop(0).result()
            self.man.add(r)
            self.n[(r["source"], "drop" if r.get("drop") else "kept")] += 1

    def finish(self, label):
        self._drain()
        log(label, dict(self.n))
        self.n.clear()


def base(source, cid, kind, subset, group, gender, url, member=None, **kw):
    lic, where, attr = LIC.get(source, (None, None, None))
    r = dict(id=cid, kind=kind, source=source, subset=subset, group=group, gender=gender, url=url, licence=lic, licence_where=where, attribution=attr)
    if member:
        r["member"] = member
    r.update(kw)
    return r


# ----------------------------------------------------------------------------- c_ls
def src_ls(P):
    d = os.path.join(CDL, "ls")
    sel = json.load(open(os.path.join(d, "selection.json"), encoding="utf8"))
    for spk, v in sorted(sel.items()):
        cdir = os.path.join(d, "audio", spk, v["chapter"])
        utts = sorted(fn[:-5] for fn in os.listdir(cdir) if fn.endswith(".flac"))
        fresh = set(sorted(utts, key=lambda u: (fnv1a(u), u))[:10])
        for u in utts:
            P.submit(base("c_ls", f"c_ls__{u}", "voice", "speech", f"c_ls:{spk}", v["sex"], "https://openslr.elda.org/resources/12/train-clean-100.tar.gz",
                          f"LibriSpeech/train-clean-100/{spk}/{v['chapter']}/{u}.flac", file=os.path.join(cdir, u + ".flac"),
                          speaker=spk, chapter=v["chapter"], utt=u, fresh=u in fresh, session_group=f"c_ls:{spk}"))
    P.finish("c_ls")


# ----------------------------------------------------------------------------- c_sbi
def src_sbi(P):
    z = zipfile.ZipFile(os.path.join(CDL, "sbi", "intermediate.zip"))
    import soundfile as sf
    takes = []
    for n in z.namelist():
        low = n.lower()
        if n.startswith("__MACOSX") or not low.endswith((".wav", ".flac", ".aif", ".aiff")):
            continue
        m = re.search(r"(INTR-\d)", n)
        pid = m.group(1) if m else None
        mic = "c3" if re.search(r"(?i)behringer|c-?3|mic", n) and not re.search(r"(?i)phone|mac|computer|laptop", n) else (
            "iphone" if re.search(r"(?i)phone", n) else ("macbook" if re.search(r"(?i)mac|computer|laptop", n) else None))
        b = re.sub(r"[^\w.-]+", "_", n[:-4 if not low.endswith(".flac") else -5])
        breathy = "breathy" in low
        exercise = next((e for e in ("simple", "vowel", "sustained", "glissando") if e in low), None)
        subset = "breathy" if breathy else ("humming" if exercise == "glissando" else "held")
        r = base("c_sbi", f"c_sbi__{b}", "voice", subset, f"c_sbi:{pid}", "unknown", "https://zenodo.org/records/20744738 (VOICE_DATA.zip)",
                 f"VOICE_DATA/intermediate.zip/{n}", participant=pid, mic=mic, phonation="breathy" if breathy else "natural", exercise=exercise,
                 session_group=f"c_sbi:{pid}:{mic}")
        takes.append((n, r))
    used = collections.Counter()
    for n, r in sorted(takes, key=lambda t: (fnv1a(t[1]["id"]), t[1]["id"])):
        if not r["participant"]:
            P.add_drop(r, "no participant id in the path")
            continue
        if r["mic"] not in ("c3", "iphone"):
            P.add_drop(r, f"microphone {r['mic']} (MacBook fan / unknown)")
            continue
        key = (r["participant"], r["mic"])
        if used[key] >= 30 * 60:
            P.add_drop(r, "over 30 min for this participant and microphone (takes in FNV order)")
            continue
        try:
            used[key] += sf.info(io.BytesIO(z.read(n))).duration
        except Exception:  # noqa: BLE001
            pass
        P.submit(dict(r, bytes=z.read(n)))
    P.finish("c_sbi")


# ----------------------------------------------------------------------------- c_gts
GTS_SUB = {"Control_Group": "held", "Falsetto_Group": "held", "Mixed_Voice_Group": "held", "Pharyngeal_Group": "held", "Vibrato_Group": "held",
           "Breathy_Group": "breathy", "Glissando_Group": "sirens"}


def src_gts(P):
    d = os.path.join(CDL, "gts")
    sel = json.load(open(os.path.join(d, "selection.json"), encoding="utf8"))
    for f in sel:
        singer = f["singer"]
        g = "f" if re.search(r"Alto|Soprano|Mezzo", singer) else ("m" if re.search(r"Tenor|Bass|Baritone", singer) else "unknown")
        cid = "c_gts__" + re.sub(r"[^\w.-]+", "_", f["path"][:-4])
        P.submit(base("c_gts", cid, "voice", GTS_SUB[f["group"]], f"c_gts:{singer}", g, "https://huggingface.co/datasets/GTSinger/GTSinger", f["path"],
                      file=os.path.join(d, "audio", *f["path"].split("/")), singer=singer, lang=f["lang"], group_type=f["group"], song=f["song"],
                      technique=f["technique"], session_group=f"c_gts:{singer}"))
    P.finish("c_gts")


# ----------------------------------------------------------------------------- c_jj
def jj_gender(role):
    r = (role or "").lower()
    if r.startswith("nv"):
        return "f"
    if r.startswith("nan"):
        return "m"
    if "dan" in r:
        return "f"
    if "laosheng" in r or "jing" in r:
        return "m"
    return "unknown"


def src_jj(P):
    import soundfile as sf
    d = os.path.join(CDL, "jj")
    sel = json.load(open(os.path.join(d, "selection.json"), encoding="utf8"))
    used = collections.Counter()
    for s in sel:                                  # already in FNV order per singer (fetch_conf.jj)
        p = os.path.join(d, "audio", s["member"])
        m = s["meta"] or {}
        singer = s["singer"]
        cid = f"c_jj__{fnv1a(singer):08x}__" + re.sub(r"[^\w.-]+", "_", os.path.basename(s["member"])[:-4])   # no singer names in ids
        r = base("c_jj", cid, "voice", "held", f"c_jj:{fnv1a(singer):08x}", jj_gender(m.get("role")), "https://zenodo.org/records/1421692 (" + s["zip"] + ")",
                 os.path.basename(s["member"]), role=m.get("role"), level=m.get("level"), singer_key=f"{fnv1a(singer):08x}", accompaniment=m.get("accompaniment"),
                 session_group=f"c_jj:{fnv1a(singer):08x}")
        if "/accompaniment/" in s["member"].lower() or "accompaniment" in os.path.basename(s["member"]).lower():
            P.add_drop(r, "accompaniment track (instrumental, not a cappella voice)")
            continue
        if not os.path.exists(p):
            P.add_drop(r, "not downloaded")
            continue
        dur = sf.info(p).duration
        left = 20 * 60 - used[singer]
        if left <= 0.5:
            P.add_drop(r, "over 20 min for this singer (recordings in FNV order)")
            continue
        used[singer] += min(dur, left)
        P.submit(dict(r, file=p, max_sec=min(dur, left)))
    P.finish("c_jj")


FN = {"ls": src_ls, "sbi": src_sbi, "gts": src_gts, "jj": src_jj}


# ----------------------------------------------------------------------------- c_fry / c_ipa (Wikimedia Commons)
def src_fry(P):
    d = os.path.join(CDL, "fry")
    info = json.load(open(os.path.join(d, "commons.json"), encoding="utf8"))
    for t, v in sorted(info.items()):
        m = re.search(r"(Female|Male) (vocal fry|normal voice) stimulus, .?Speaker (\d+)", v["description"])
        sn = re.search(r"pone\.0097506\.(s\d+)", t).group(1)
        r = base("c_fry", f"c_fry__{sn}", "voice", None, None, None, v["descriptionurl"], t, licence=v["licence"],
                 licence_where=f"Wikimedia Commons file page ({v['licence_url']})",
                 attribution=f"{t.split(':', 1)[1]}, PLOS ONE 9(5): e0097506 supplementary audio, via Wikimedia Commons, {v['licence']}")
        if not m or not v.get("file"):
            P.add_drop(dict(r, group="c_fry:?", subset="?", gender="unknown"), "description does not state speaker / condition" if not m else "not downloaded")
            continue
        g = "f" if m.group(1) == "Female" else "m"
        sub = "breathy" if m.group(2) == "vocal fry" else "speech"
        P.submit(dict(r, subset=sub, group=f"c_fry:speaker{m.group(3)}", gender=g, condition=m.group(2), file=os.path.join(d, v["file"]),
                      session_group=f"c_fry:speaker{m.group(3)}"))
    P.finish("c_fry")


def src_ipa(P):
    d = os.path.join(CDL, "ipa")
    info = json.load(open(os.path.join(d, "commons.json"), encoding="utf8"))
    for t, v in sorted(info.items()):
        name = t.split(":", 1)[1]
        who = re.sub(r"\s*\(talk.*$", "", v["artist"]).strip() or f"file:{name}"
        r = base("c_ipa", "c_ipa__" + re.sub(r"[^\w.-]+", "_", name.rsplit(".", 1)[0]), "voice", "trills", f"c_ipa:{who}", "unknown", v["descriptionurl"], t,
                 licence=f"{v['licence']} (evaluation only)" if "SA" in (v["licence"] or "") else v["licence"],
                 licence_where=f"Wikimedia Commons file page ({v['licence_url']})",
                 attribution=f"{name} by {v['artist'] or 'unknown'} (Wikimedia Commons), {v['licence']}", session_group=f"c_ipa:{who}")
        if not v.get("file"):
            P.add_drop(r, "not downloaded")
            continue
        P.submit(dict(r, file=os.path.join(d, v["file"]), min_sec=0.3))
    P.finish("c_ipa")


# ----------------------------------------------------------------------------- Freesound: c_fsv voice, NA noise
def src_fsv(P, which):
    sel = json.load(open(os.path.join(CDL, "fs", "selection.json"), encoding="utf8"))["checked"]
    for sid, v in sorted(sel.items(), key=lambda t: int(t[0])):
        if v.get("drop") or v["set"] != ("voice" if which == "fsv" else "na"):
            continue
        attr = f"\"{v['title']}\" by {v['user']} (freesound.org/s/{v['id']}/), {v['licence']}"
        lic = v["licence"] + (" (evaluation only)" if "NC" in v["licence"] else "")
        common = dict(url=v["url"], member=v["preview"], licence=lic, licence_where=f"Freesound sound page ({v['licence_url']})", attribution=attr,
                      freesound_id=v["id"], uploader=v["user"], title=v["title"], query=v["query"], page=v["page"], origin=v["origin"],
                      file=os.path.join(CDL, v["file"]), codec="vorbis HQ preview")
        if which == "fsv":
            P.submit(dict(id=f"c_fsv__{v['id']}", kind="voice", source="c_fsv", subset=v["subset"], group=f"c_fsv:{v['user']}", gender="unknown",
                          max_sec=120, min_sec=3.0, session_group=f"c_fsv:{v['user']}", **common))
        else:
            P.submit(dict(id=f"na__{v['id']}", kind="noise", source="na", ngroup="NA", group=f"na:{v['user']}", cls=v["query"], max_sec=90, min_sec=20.0,
                          **common))
    P.finish(which)


# ----------------------------------------------------------------------------- NB (machine datasets)
def join_xfade(parts, sr, target_s, fade_s=0.02, loop=False):
    """Clips joined with linear cross-fades (fade_s) until target_s; loop=True repeats the parts."""
    nf = int(round(fade_s * sr))
    out = np.zeros(0, np.float32)
    k = 0
    while len(out) < target_s * sr and (loop or k < len(parts)):
        x = parts[k % len(parts)].astype(np.float32)
        k += 1
        if not len(out):
            out = x.copy()
            continue
        f = min(nf, len(x), len(out))
        w = np.linspace(0, 1, f, dtype=np.float32)
        out[-f:] = out[-f:] * (1 - w) + x[:f] * w
        out = np.concatenate([out, x[f:]])
        if loop and k > 10000:
            break
    return out[: int(target_s * sr)]


def wav_bytes(x, sr):
    import soundfile as sf
    b = io.BytesIO()
    sf.write(b, x, sr, format="WAV", subtype="FLOAT")
    return b.getvalue()


NB_LIC = {"dcase23": ("CC BY 4.0", "Zenodo record 7830345 licence", "DCASE 2023 Challenge Task 2 Additional Training Dataset (zenodo 7830345), CC BY 4.0"),
          "dcase24": ("CC BY-NC-SA 4.0 (evaluation only)", "Zenodo record 11259435 licence",
                      "DCASE 2024 Challenge Task 2 Additional Training Dataset (zenodo 11259435), CC BY-NC-SA 4.0"),
          "avq": ("CC BY 4.0", "Zenodo record 4553667 licence", "Drone noises from the AVQ dataset (zenodo 4553667), CC BY 4.0"),
          "aid": ("CC BY 4.0", "Zenodo record 6974033 licence", "AID: Open-Source Anechoic Interferer Dataset (zenodo 6974033), CC BY 4.0")}
AID_RX = re.compile(r"drill|blender|dryer|vacuum|fan|mixer|shaver|toothbrush|printer|machine|motor|pump|kettle|microwave|fridge|dishwasher|washing", re.I)


def nb_rec(src, cid, typ, machine, member, url):
    lic, where, attr = NB_LIC[src]
    return dict(id=cid, kind="noise", source=src, ngroup="NB", group=f"{src}:{typ}:{machine}", cls=typ, machine=machine, member=member, url=url,
                licence=lic, licence_where=where, attribution=attr, max_sec=90, min_sec=20.0)


def src_nb(P):
    import soundfile as sf
    d = os.path.join(CDL, "nb")
    per_type = int(A.get("nb-per-type", "3"))
    plan = json.load(open(os.path.join(d, "plan.json"), encoding="utf8"))
    count = collections.Counter()
    for p in plan:
        if count[p["type"]] >= per_type or not p.get("fetched"):
            continue
        xs = []
        sr = None
        for f in p["fetched"]:
            x, sr = sf.read(os.path.join(d, f), dtype="float32", always_2d=True)
            xs.append(x[:, 0])
        if sum(len(x) for x in xs) < 20 * sr:        # this machine id has < 20 s of normal clips: the next id in FNV order takes its place
            continue
        count[p["type"]] += 1
        y = join_xfade(xs, sr, 90.0)
        P.submit(dict(nb_rec(p["source"], f"nb__{p['source']}__{p['type']}__{p['machine'].replace(':', '_')}", p["type"], p["machine"],
                             f"{p['zip']}: {len(p['fetched'])} normal clips in file order", f"https://zenodo.org/records/{p['rec']}"),
                      bytes=wav_bytes(y, sr), n_clips=len(p["fetched"])))
    z = zipfile.ZipFile(os.path.join(d, "all_drone_noises.zip"))
    for n in sorted(x for x in z.namelist() if x.endswith(".wav")):
        x, sr = sf.read(io.BytesIO(z.read(n)), dtype="float32", always_2d=True)
        y = join_xfade([x[:, 0]], sr, 20.0, loop=True) if len(x) < 20 * sr else x[: int(90 * sr), 0]
        rid = os.path.basename(n)[:-4]
        P.submit(dict(nb_rec("avq", f"nb__avq__{rid}", "drone", rid, n, "https://zenodo.org/records/4553667"), bytes=wav_bytes(y, sr),
                      looped=bool(len(x) < 20 * sr), orig_sec=round(len(x) / sr, 2)))
    z = zipfile.ZipFile(os.path.join(d, "AID.zip"))
    files = sorted(x for x in z.namelist() if x.endswith(".wav") and "/wavs/" in x)
    cls_of = lambda n: re.match(r"(.+?)_(\d+)_(.+)\.wav$", os.path.basename(n))  # noqa: E731
    by_cls = collections.defaultdict(list)
    for n in files:
        m = cls_of(n)
        if m and AID_RX.search(m.group(1)):
            by_cls[m.group(1)].append(n)
    for c, ns in sorted(by_cls.items()):
        used = set()
        for n in sorted(ns, key=lambda n: (fnv1a(os.path.basename(n)), n)):
            m = cls_of(n)
            rec_id = f"{m.group(1)}_{m.group(2)}"
            if rec_id in used or len(used) >= per_type:
                continue
            used.add(rec_id)
            x, sr = sf.read(io.BytesIO(z.read(n)), dtype="float32", always_2d=True)
            y = join_xfade([x[:, 0]], sr, 20.0, loop=True) if len(x) < 20 * sr else x[: int(90 * sr), 0]
            P.submit(dict(nb_rec("aid", f"nb__aid__{os.path.basename(n)[:-4]}", c, rec_id, n, "https://zenodo.org/records/6974033"), bytes=wav_bytes(y, sr),
                          looped=bool(len(x) < 20 * sr), orig_sec=round(len(x) / sr, 2), mic=m.group(3)))
    P.finish("nb")


FN.update({"fry": src_fry, "ipa": src_ipa, "fsv": lambda P: src_fsv(P, "fsv"), "na": lambda P: src_fsv(P, "na"), "nb": src_nb})


# ----------------------------------------------------------------------------- c_qbh / c_aa
def src_qbh(P):
    """MTG-QBH: the README gives no per-file subject, gender or hummed / sung label (subjects sang 'with or
    without lyrics'), so every recording is a sung-phrase take of an unknown singer and its own group."""
    z = zipfile.ZipFile(os.path.join(CDL, "qbh", "MTG-QBH.zip"))
    for n in sorted(x for x in z.namelist() if x.startswith("audio/") and x.endswith(".wav")):
        q = os.path.basename(n)[:-4]
        P.submit(base("c_qbh", f"c_qbh__{q}", "voice", "held", f"c_qbh:{q}", "unknown", "https://zenodo.org/records/1290712 (MTG-QBH.zip)", n,
                      bytes=z.read(n), session_group=f"c_qbh:{q}"))
    P.finish("c_qbh")


def src_aa(P):
    import openpyxl
    d = os.path.join(CDL, "aa")
    wb = openpyxl.load_workbook(os.path.join(d, "profiles.xlsx"), read_only=True)
    rows = list(wb.worksheets[0].iter_rows(values_only=True))
    prof = {r[0]: {"gender": {"F": "f", "M": "m"}.get(str(r[1]).strip().upper(), "unknown"), "age": r[2], "years_smoking": r[3]} for r in rows[1:] if r[0]}
    for fn in sorted(x for x in os.listdir(os.path.join(d, "audio")) if x.endswith(".wav")):
        pid = fn.split("_")[0]
        pr = prof.get(pid, {"gender": "unknown"})
        P.submit(base("c_aa", f"c_aa__{fn[:-4]}", "voice", "breathy", f"c_aa:{pid}", pr["gender"], "https://zenodo.org/records/7098345", fn,
                      file=os.path.join(d, "audio", fn), participant=pid, device="phone" if "phone" in fn else "microphone",
                      age=pr.get("age"), years_smoking=pr.get("years_smoking"), session_group=f"c_aa:{pid}", min_sec=0.3))
    P.finish("c_aa")


FN.update({"qbh": src_qbh, "aa": src_aa})

if __name__ == "__main__":
    man = CManifest()
    P = Pool(man)
    for s in A.get("sources", "").split(","):
        if s:
            FN[s](P)
