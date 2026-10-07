# prepare_r2.py — custom voice detector, round 2 (pre-registration Addendum D,
# splits.json key `round2`): turn the added voice positives downloaded by
# fetch_r2.py into 16 kHz PCM16 files + Praat AC labels + manifest records,
# exactly as prepare.py does for round 1 (its worker, its manifest format).
# Validation files also keep a native-rate copy (data/valnative/) for the
# production-chain dumps; SVD's 50 kHz takes are kept at 48 kHz there.
#
#   python scripts/voice-detector/custom/prepare_r2.py --sources=svd,imitations,kids,fsvoice,singbap --part=r2 [--jobs=3]
import collections
import csv
import io
import json
import os
import re
import struct
import zipfile

import numpy as np

import prepare as P0
from common import DL, SPLITS, fnv1a

R2 = SPLITS["round2"]
A = P0.A
P0.ATTR.update({
    "svd": ("CC BY 4.0", "Zenodo record 16874898 licence (linked from stimmdb.coli.uni-saarland.de)",
            "Saarbruecken Voice Database, M. Puetzer and W. J. Barry; hosted by Essen University Hospital (zenodo 16874898, doi:10.5281/zenodo.16874898), CC BY 4.0"),
    "singbap": ("CC BY 4.0", "Zenodo record 20744738 licence + LICENSE.md",
                "SingBAP: A Multimodal Dataset of Singing Performance with Biosignals, Audio, and Pose Estimation, S. Haeaeraee and R. Ramirez-Melendez, "
                "Universitat Pompeu Fabra, Music Technology Group (zenodo 20744738), CC BY 4.0"),
    "imitations": ("CC0 1.0", "Zenodo record 57468 licence", "Vocal imitations of non-vocal sounds, G. Lemaitre (zenodo 57468), CC0 1.0"),
    "kids": ("CC BY 4.0", "Zenodo record 200495 licence",
             "Children speech recording (English, spontaneous speech + pre-defined sentences), J. Kennedy, S. Lemaignan, C. Montassier, P. Lavalade, "
             "B. Irfan, F. Papadopoulos et al. (zenodo 200495), CC BY 4.0"),
})


def wav_bytes(x, sr):
    import soundfile as sf
    b = io.BytesIO()
    sf.write(b, x, sr, format="WAV", subtype="PCM_16")
    return b.getvalue()


# ----------------------------------------------------------------------------- svd
def read_nsp(b):
    """Kay CSL .nsp: "FORM" "DS16" size, then chunks HEDR (date[20], rate u32, n u32, ...) and SDA_ (int16 channel A)."""
    assert b[:4] == b"FORM" and b[4:8] == b"DS16", b[:12]
    off, sr, x = 12, None, None
    while off + 8 <= len(b):
        cid, sz = b[off:off + 4], struct.unpack_from("<I", b, off + 4)[0]
        if cid in (b"HEDR", b"HDR8"):
            sr = struct.unpack_from("<I", b, off + 8 + 20)[0]
        elif cid == b"SDA_":
            x = np.frombuffer(b[off + 8:off + 8 + sz], dtype="<i2")
        off += 8 + sz + (sz & 1)
    return x, sr


def svd_meta():
    meta = json.load(open(os.path.join(DL, "svd", "overview_all.json"), encoding="utf8"))
    rec = {}
    for zname, text in sorted(meta.items()):
        cat = zname[:-4]
        for r in csv.DictReader(io.StringIO(text)):
            sid = (r.get("AufnahmeID") or "").strip()
            if not sid:
                continue
            m = rec.setdefault(sid, dict(r, categories=[]))
            m["categories"].append(cat)
    return rec


def src_svd(P):
    from scipy.signal import resample_poly
    meta = svd_meta()
    d = os.path.join(DL, "svd", "iau")
    drops = []
    for fn in sorted(os.listdir(d), key=lambda s: int(s.split("-")[0])):
        if not fn.endswith("-iau.nsp"):
            continue
        sess = fn.split("-")[0]
        m = meta.get(sess)
        r = P0.base("svd", f"svd__{sess}", "voice", "train", None, "https://zenodo.org/records/16874898 (data.zip)", f"data/{sess}/vowels/{fn}", session=sess)
        if not m or not (m.get("SprecherID") or "").strip():
            drops.append(dict(r, group="svd:?", drop="no speaker id in any overview.csv"))
            continue
        spk = m["SprecherID"].strip()
        sp = "val" if fnv1a(f"svd:{spk}") % 8 == 0 else "train"
        r.update(split=sp, group=f"svd:{spk}", speaker=spk, gender={"w": "f", "m": "m"}.get((m.get("Geschlecht") or "").strip(), "unknown"),
                 recording_type=m.get("AufnahmeTyp"), recorded=m.get("AufnahmeDatum"), born=m.get("Geburtsdatum"),
                 diagnosis=m.get("Diagnose"), pathologies=m.get("Pathologien"), categories=sorted(set(m["categories"])),
                 healthy="healthy" in m["categories"])
        if P0.MAN.have.get(r["id"]) and "drop" not in P0.MAN.have[r["id"]]:
            continue
        x, sr = read_nsp(open(os.path.join(d, fn), "rb").read())
        if x is None or sr != 50000:
            drops.append(dict(r, drop=f"nsp decode (sr {sr})"))
            continue
        y = resample_poly(x.astype(np.float64) / 32768, 24, 25)       # 50 kHz -> 48 kHz (an app capture rate)
        r.update(bytes=wav_bytes(y.astype(np.float32), 48000), native=(sp == "val"), nsp_sr=50000)
        P.submit(r)
    P0.flush(drops + P.finish(), "svd")


# ----------------------------------------------------------------------------- imitations
def src_imitations(P):
    z = zipfile.ZipFile(os.path.join(DL, "imitations", "ImitationsForPlos.zip"))
    drops = []
    for n in z.namelist():
        if not n.endswith(".wav") or n.startswith("__MACOSX"):
            continue
        fam, who, b = n.split("/")[1], n.split("/")[2], os.path.basename(n)[:-4]
        r = P0.base("imitations", f"imit__{fam}_{b}", "voice", "train", f"imitations:{who}", "https://zenodo.org/records/57468 (ImitationsForPlos.zip)", n,
                    imitator=who, family=fam, category=re.sub(r"\d+$", "", b.split("_", 1)[1]), gender="unknown")
        if not re.fullmatch(r"I\d+", who):
            drops.append(dict(r, drop="not an imitator folder (Q1-Q3: loudness-equalised 44.1 kHz stimuli, not imitations)"))
            continue
        r.update(bytes=z.read(n))
        P.submit(r)
    P0.flush(drops + P.finish(), "imitations")


# ----------------------------------------------------------------------------- kids
def src_kids(P):
    z = zipfile.ZipFile(os.path.join(DL, "kids", "english_children.zip"))
    drops = []
    for n in z.namelist():
        if not n.lower().endswith(".wav") or n.startswith("__MACOSX"):
            continue
        m = re.search(r"/(\d\d_[MF]_(?:non)?[Nn]ative)/", n)
        mic = next((k for k in ("studio_mic", "port_mic", "nao_mic") if f"/{k}/" in n), None)
        if "/files_in_one_part/" in n:
            mic = {"studio": "studio_mic", "port": "port_mic", "nao": "nao_mic"}.get(os.path.basename(n)[:-4].lower())
        child = m.group(1) if m else None
        b = re.sub(r"[^\w.-]+", "_", n.split("english_children/", 1)[-1][:-4])
        r = P0.base("kids", f"kids__{b}", "voice", "train", f"kids:{child}", "https://zenodo.org/records/200495 (english_children.zip)", n,
                    child=child, mic=mic, task=n.split("/")[1] if "/" in n else None)
        if not child:
            drops.append(dict(r, group="kids:?", drop="no child folder in the path"))
            continue
        r["gender"] = "f" if "_F_" in child else "m"
        r["split"] = "val" if fnv1a(f"kids:{child}") % 4 == 0 else "train"
        if "/files_cut_by_sentences/" in n:
            drops.append(dict(r, drop="free-speech sentence cut: duplicate of files_in_one_part (microphone not stated)"))
            continue
        if mic == "nao_mic" or mic is None:
            drops.append(dict(r, drop=f"microphone {mic} (NAO robot fan / unknown)"))
            continue
        r.update(bytes=z.read(n), native=(r["split"] == "val"))
        P.submit(r)
    P0.flush(drops + P.finish(), "kids")


# ----------------------------------------------------------------------------- fsvoice
def src_fsvoice(P):
    idx = json.load(open(os.path.join(DL, "fsvoice", "index.json"), encoding="utf8"))
    for k in idx["kept"]:
        r = dict(id=f"fsvoice__{k['id']}", kind="voice", source="fsvoice", split=k["split"], group=f"freesound:{k['user']}",
                 url=k["url"], member=k["preview"], licence=k["licence"], licence_where=f"sound page ({k['licence_url']})",
                 attribution=f"\"{k['title']}\" by {k['user']} (freesound.org/s/{k['id']}/), {k['licence']}",
                 freesound_id=k["id"], uploader=k["user"], title=k["title"], query=k["query"], gender="unknown", codec="vorbis HQ preview")
        r.update(file=os.path.join(DL, k["path"]), max_sec=120, native=(k["split"] == "val"), min_sec=3.0)
        P.submit(r)
    recs = P.finish()
    for r in recs:
        if "drop" not in r and r.get("voiced_sec", 0) < R2["fsvoice"]["min_voiced_s"]:
            r["drop"] = f"under {R2['fsvoice']['min_voiced_s']} s Praat-voiced"
    P0.flush(recs, "fsvoice")


# ----------------------------------------------------------------------------- singbap
SB_VAL = {"INEX-2", "INEX-6", "PROF-1"}


def src_singbap(P):
    drops = []
    for zn in ("inexperienced.zip", "professional.zip"):
        z = zipfile.ZipFile(os.path.join(DL, "singbap", zn))
        for n in z.namelist():
            low = n.lower()
            if n.startswith("__MACOSX") or not low.endswith((".wav", ".flac", ".m4a", ".mp3", ".aif", ".aiff")):
                continue
            m = re.search(r"((?:INEX|INTR|PROF)-\d)", n)
            pid = m.group(1) if m else None
            mic = "c3" if re.search(r"(?i)behringer|c-?3|mic", n) and not re.search(r"(?i)phone|mac|computer|laptop", n) else (
                "iphone" if re.search(r"(?i)phone", n) else ("macbook" if re.search(r"(?i)mac|computer|laptop", n) else None))
            b = re.sub(r"[^\w.-]+", "_", n[:-4 if not low.endswith(".flac") else -5])
            r = P0.base("singbap", f"singbap__{b}", "voice", "train", f"singbap:{pid}", "https://zenodo.org/records/20744738 (VOICE_DATA.zip)",
                        f"VOICE_DATA/{zn}/{n}", participant=pid, mic=mic, gender="unknown",
                        phonation="breathy" if "breathy" in low else "natural",
                        exercise=next((e for e in ("simple", "vowel", "sustained", "glissando") if e in low), None))
            if not pid:
                drops.append(dict(r, group="singbap:?", drop="no participant id in the path"))
                continue
            r["split"] = "val" if pid in SB_VAL else "train"
            if mic not in ("c3", "iphone"):
                drops.append(dict(r, drop=f"microphone {mic} (MacBook fan / unknown)"))
                continue
            if low.endswith(".m4a") or low.endswith(".mp3"):
                drops.append(dict(r, drop="codec not decodable by soundfile"))
                continue
            r.update(bytes=z.read(n), native=(r["split"] == "val"))
            P.submit(r)
        P0.flush(drops + P.finish(), f"singbap {zn}")
        drops = []


FN = dict(svd=src_svd, imitations=src_imitations, kids=src_kids, fsvoice=src_fsvoice, singbap=src_singbap)

if __name__ == "__main__":
    import time
    P = P0.Pool()
    for s in A.get("sources", "svd,imitations,kids,fsvoice,singbap").split(","):
        t = time.time()
        FN[s](P)
        print(f"== {s} done in {time.time() - t:.0f} s", flush=True)
    print(collections.Counter())
