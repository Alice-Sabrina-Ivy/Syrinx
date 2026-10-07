# prepare.py — custom voice detector, data step (2026-10-06): turn the
# pre-registered sources (splits.json) into the training corpus under
# build/vad-train/data/ + its manifest (data/manifest.jsonl).
#
# Every used file: 16 kHz mono PCM16 WAV (first channel, polyphase), plus for
# VOICE files the Praat AC reference (60-1100 Hz, 10 ms, Praat defaults = the
# notchvd voice clips' heldseg.py praat_f0) as <id>.f0.npz; validation voice
# files also keep a native-rate copy (data/valnative/) for the production-chain
# dumps of the selection rule. Every considered file gets a manifest record;
# dropped ones carry `drop` = the reason. The negatives' audio checks
# (fingerprint vs the benchmark, speech screen) are dedup.py's.
#
#   python scripts/voice-detector/custom/prepare.py --sources=librispeech,coswara,mdvr,esmuc,cantoria,csd,dcs,vctk,fsd50k,fstrain [--jobs=3]
import csv
import io
import json
import os
import re
import subprocess
import sys
import tarfile
import time
import zipfile
from concurrent.futures import ProcessPoolExecutor, ThreadPoolExecutor

import numpy as np

from common import DATA, DL, META, SPLITS, SR, KEYWORDS, Manifest, args, benchmark_freesound, fnv1a, norm_cc, to16k_mono, write_wav16

A = args()
JOBS = int(A.get("jobs", "3"))
SOURCES = A.get("sources", "librispeech,coswara,mdvr,esmuc,cantoria,csd,dcs,vctk,fsd50k,fstrain").split(",")
MAN = Manifest(os.path.join(DATA, f"manifest.{A['part']}.jsonl" if "part" in A else "manifest.jsonl"))
SEVENZIP = A.get("7z", r"C:\Program Files\7-Zip\7z.exe")
sys.path.append(os.path.abspath(os.path.join(os.path.dirname(__file__), "../../notch-adversarial/realdata")))  # remotezip (after this dir: its common.py must not shadow ours)

ATTR = {
    "librispeech": ("CC BY 4.0", "OpenSLR 12 resource page + LICENSE.TXT in the tarball",
                    "LibriSpeech ASR corpus (openslr.org/12), CC BY 4.0; audio derived from LibriVox recordings"),
    "vctk": ("CC BY 4.0", "license_text.txt of datashare item 10283/3443",
             "CSTR VCTK Corpus 0.92, Centre for Speech Technology Research, University of Edinburgh (doi:10.7488/ds/2645), CC BY 4.0"),
    "coswara": ("CC BY 4.0", "LICENSE.md of github.com/iiscleap/Coswara-Data",
                "Coswara-Data, LEAP Lab, Indian Institute of Science, Bangalore (github.com/iiscleap/Coswara-Data), CC BY 4.0"),
    "mdvr": ("CC BY 4.0", "Zenodo record 2867216 licence", "MDVR-KCL, Mobile Device Voice Recordings at King's College London (zenodo 2867216), CC BY 4.0"),
    "dcs": ("CC BY 4.0", "Zenodo record 3897182 licence", "Dagstuhl ChoirSet (zenodo 3897182, doi:10.5334/tismir.48), CC BY 4.0"),
    "esmuc": ("CC BY 4.0", "Zenodo record 5848990 licence", "ESMUC Choir Dataset (zenodo 5848990), CC BY 4.0"),
    "csd": ("CC BY 4.0", "Zenodo record 1286570 licence", "Choral Singing Dataset (zenodo 1286570), CC BY 4.0"),
    "cantoria": ("CC BY 4.0", "Zenodo record 5878677 licence", "Cantoria Dataset (zenodo 5878677), CC BY 4.0"),
}


# ----------------------------------------------------------------------------- worker
def praat_f0(x):
    import parselmouth
    p = parselmouth.Sound(np.asarray(x, float), sampling_frequency=SR).to_pitch_ac(time_step=0.01, pitch_floor=60, pitch_ceiling=1100)
    return float(p.xs()[0]) if p.n_frames else 0.0, np.nan_to_num(p.selected_array["frequency"]).astype(np.float32)


def work(t):
    """Decode, convert, label, write. Returns the manifest record."""
    import soundfile as sf
    try:
        if "bytes" in t:
            x, sr = sf.read(io.BytesIO(t.pop("bytes")), always_2d=True, dtype="float32")
        else:
            x, sr = sf.read(t.pop("file"), always_2d=True, dtype="float32")
    except Exception as e:  # noqa: BLE001
        return dict(t, drop=f"decode: {e}")
    ch = x.shape[1]
    if t.get("max_sec"):
        x = x[: int(t.pop("max_sec") * sr)]
    if len(x) < sr * t.pop("min_sec", 0.5):
        return dict(t, drop="shorter than the minimum", orig_sr=sr)
    y = to16k_mono(x, sr)
    rel = f"{t['kind']}/{t['source']}/{t['id']}.wav"
    t["level_scale"] = write_wav16(os.path.join(DATA, rel), y)
    t.update(path=rel, sr=SR, orig_sr=int(sr), orig_channels=int(ch), dur=round(len(y) / SR, 3),
             rms_dbfs=round(float(10 * np.log10(np.mean(y.astype(np.float64) ** 2) + 1e-20)), 2), peak=round(float(np.max(np.abs(y))), 4))
    if t.pop("native", False):
        nrel = f"valnative/{t['source']}/{t['id']}.wav"
        write_wav16(os.path.join(DATA, nrel), x[:, 0], int(sr))
        t.update(native_path=nrel, native_sr=int(sr))
    if t["kind"] == "voice":
        t0, f0 = praat_f0(y)
        frel = f"{t['kind']}/{t['source']}/{t['id']}.f0.npz"
        np.savez_compressed(os.path.join(DATA, frel), t0=t0, hop=0.01, f0=f0)
        v = f0 > 0
        t.update(f0_path=frel, voiced_sec=round(float(v.sum()) * 0.01, 2), f0_median=round(float(np.median(f0[v])), 1) if v.any() else 0.0,
                 f0_p05=round(float(np.percentile(f0[v], 5)), 1) if v.any() else 0.0, f0_p95=round(float(np.percentile(f0[v], 95)), 1) if v.any() else 0.0)
        if not v.any():
            t["drop"] = "no voiced frame (Praat AC)"
    return t


class Pool:
    """Process pool with a bounded queue; records collected for the main process."""

    def __init__(self):
        self.ex = ProcessPoolExecutor(JOBS)
        self.fs = []
        self.out = []

    def submit(self, t):
        if t["id"] in MAN and "drop" not in MAN.have[t["id"]]:
            return
        self.fs.append(self.ex.submit(work, t))
        if len(self.fs) >= 4 * JOBS:
            self._drain(2 * JOBS)

    def _drain(self, keep=0):
        while len(self.fs) > keep:
            self.out.append(self.fs.pop(0).result())

    def finish(self):
        self._drain()
        out, self.out = self.out, []
        return out


def base(source, cid, kind, split, group, url, member=None, **meta):
    lic, where, attr = ATTR.get(source, (None, None, None))
    r = dict(id=cid, kind=kind, source=source, split=split, group=group, url=url, licence=lic, licence_where=where, attribution=attr)
    if member:
        r["member"] = member
    r.update(meta)
    return r


def flush(recs, label):
    n = 0
    for r in recs:
        MAN.add(r)
        n += "drop" not in r
    dur = sum(r.get("dur", 0) for r in recs if "drop" not in r)
    print(f"{label}: {n} kept / {len(recs)} records, {dur / 3600:.2f} h", flush=True)


def wait_ok(path):
    while not os.path.exists(path + ".ok"):
        print(f"waiting for {os.path.basename(path)} ...", flush=True)
        time.sleep(120)


# ----------------------------------------------------------------------------- sources
def src_librispeech(P):
    split = {s: "train" for s in SPLITS["positives"]["librispeech"]["train"]}
    split.update({s: "val" for s in SPLITS["positives"]["librispeech"]["val"]})
    for sub, sp in split.items():
        tgz = os.path.join(DL, "librispeech", f"{sub}.tar.gz")
        wait_ok(tgz)
        gender, recs_pending = {}, []
        with tarfile.open(tgz, "r|gz") as tf:
            for m in tf:
                if not m.isfile():
                    continue
                if m.name.endswith("SPEAKERS.TXT"):
                    for line in tf.extractfile(m).read().decode("utf8").splitlines():
                        if line.startswith(";"):
                            continue
                        p = [s.strip() for s in line.split("|")]
                        if len(p) >= 2:
                            gender[p[0]] = {"F": "f", "M": "m"}.get(p[1], "unknown")
                    continue
                if m.name.endswith("LICENSE.TXT"):
                    open(os.path.join(META, "librispeech_LICENSE.TXT"), "wb").write(tf.extractfile(m).read())
                    continue
                if not m.name.endswith(".flac"):
                    continue
                uid = os.path.basename(m.name)[:-5]
                spk = uid.split("-")[0]
                t = base("librispeech", f"libri__{uid}", "voice", sp, f"librispeech:{spk}",
                         f"https://openslr.elda.org/resources/12/{sub}.tar.gz", m.name, subset=sub, speaker=spk)
                t.update(bytes=tf.extractfile(m).read(), native=(sp == "val"))
                P.submit(t)
        recs = P.finish()
        for r in recs:
            r["gender"] = gender.get(r.get("speaker"), "unknown")
        flush(recs, f"librispeech {sub}")


def coswara_meta():
    d = os.path.join(DL, "coswara")
    meta = {r["id"]: r for r in csv.DictReader(open(os.path.join(d, "combined_data.csv"), encoding="utf8"))}
    q = {}
    for typ in ("vowel-a", "vowel-e", "vowel-o", "counting-normal", "counting-fast"):
        for row in csv.DictReader(open(os.path.join(d, f"{typ}_labels.csv"), encoding="utf8")):
            q[row["FILENAME"].strip()] = (row.get(" QUALITY") or row.get("QUALITY") or "").strip()
    return meta, q


class Cat(io.RawIOBase):
    def __init__(self, paths):
        self.fs = [open(p, "rb") for p in paths]
        self.i = 0

    def readable(self):
        return True

    def readinto(self, b):
        while self.i < len(self.fs):
            n = self.fs[self.i].readinto(b)
            if n:
                return n
            self.i += 1
        return 0


def src_coswara(P):
    S = SPLITS["positives"]["coswara"]
    lst = json.load(open(os.path.join(META, "coswara_files.json"), encoding="utf8"))
    meta, q = coswara_meta()
    dates = sorted({p.split("/")[0] for p, _ in lst["parts"]} - set(S["excluded_dates"]))
    assert sorted(d for d in dates if fnv1a(d) % 8 == 0) == sorted(S["val_dates"]), "Coswara val dates differ from splits.json"
    TYPES = ("vowel-a", "vowel-e", "vowel-o", "counting-normal", "counting-fast")
    for date in dates:
        sp = "val" if date in S["val_dates"] else "train"
        parts = sorted(p for p, _ in lst["parts"] if p.startswith(date + "/"))
        paths = [os.path.join(DL, "coswara", p.replace("/", "__")) for p in parts]
        for p in paths:
            wait_ok(p)
        drops = []
        with tarfile.open(fileobj=io.BufferedReader(Cat(paths), 1 << 20), mode="r|gz") as tf:
            for m in tf:
                if not m.isfile():
                    continue
                bits = m.name.split("/")
                if len(bits) < 3:
                    continue
                pid, fn = bits[-2], bits[-1]
                typ = fn.rsplit(".", 1)[0]
                if typ not in TYPES:
                    continue
                cid = f"coswara__{date}_{pid}_{typ}"
                md = meta.get(pid, {})
                r = base("coswara", cid, "voice", sp, f"coswara:{pid}", f"https://github.com/iiscleap/Coswara-Data/tree/master/{date}", m.name,
                         date=date, participant=pid, recording=typ, gender={"male": "m", "female": "f"}.get(md.get("g"), "unknown"),
                         age=md.get("a"), covid_status=md.get("covid_status"), quality=q.get(f"{pid}_{typ}"),
                         symptoms=[k for k in ("cold", "cough", "st", "fever", "bd", "ftg", "asthma", "smoker") if md.get(k) == "True"])
                if md.get("rU") == "y":
                    drops.append(dict(r, drop="returning user (rU = y)"))
                    continue
                if q.get(f"{pid}_{typ}") not in ("1", "2", "1.0", "2.0"):
                    drops.append(dict(r, drop=f"audio-quality label {q.get(f'{pid}_{typ}')!r} (< 1 or missing)"))
                    continue
                r.update(bytes=tf.extractfile(m).read(), native=(sp == "val"), min_sec=1.0)
                P.submit(r)
        flush(drops + P.finish(), f"coswara {date} ({sp})")


def zip_local(path):
    wait_ok(path)
    return zipfile.ZipFile(path)


def src_mdvr(P):
    vs = set(SPLITS["positives"]["mdvr_kcl"]["val_subjects"])
    z = zip_local(os.path.join(DL, "mdvr", "26_29_09_2017_KCL.zip"))
    subj = sorted({os.path.basename(n).split("_")[0] for n in z.namelist() if n.endswith(".wav")})
    assert sorted(s for s in subj if fnv1a(s) % 5 == 0) == sorted(vs), "MDVR val subjects differ from splits.json"
    for n in z.namelist():
        if not n.endswith(".wav"):
            continue
        b = os.path.basename(n)[:-4]
        sid, hs = b.split("_")[0], b.split("_")[1]
        task = n.split("/")[1]
        sp = "val" if sid in vs else "train"
        r = base("mdvr", f"mdvr__{task}__{b}", "voice", sp, f"mdvr:{sid}", "https://zenodo.org/records/2867216 (26_29_09_2017_KCL.zip)", n,
                 subject=sid, health=hs, task=task, gender="unknown")
        r.update(bytes=z.read(n), native=(sp == "val"))
        P.submit(r)
    flush(P.finish(), "mdvr")


PART_G = {"S": "f", "A": "f", "T": "m", "B": "m"}


def src_esmuc(P):
    z = zip_local(os.path.join(DL, "choir", "EsmucChoirDataset_v1.0.0.zip"))
    drops = []
    for n in z.namelist():
        if not n.endswith(".wav"):
            continue
        b = os.path.basename(n)[:-4]
        sing = b.rsplit("_", 1)[-1]
        r = base("esmuc", f"esmuc__{b}", "voice", "train", f"esmuc:{sing}", "https://zenodo.org/records/5848990 (EsmucChoirDataset_v1.0.0.zip)", n,
                 singer=sing, voice_part=sing[:1], gender=PART_G.get(sing[:1], "unknown"), gender_basis="voice part")
        if sing in ("ORTF", "AB"):
            drops.append(dict(r, drop="room microphone (whole choir)", singer=None, voice_part=None, gender=None))
            continue
        r.update(bytes=z.read(n))
        P.submit(r)
    flush(drops + P.finish(), "esmuc")


def src_cantoria(P):
    z = zip_local(os.path.join(DL, "choir", "CantoriaDataset_v1.0.0.zip"))
    drops = []
    for n in z.namelist():
        if not (n.startswith("Audio/") and n.endswith(".wav")):
            continue
        b = os.path.basename(n)[:-4]
        part = b.rsplit("_", 1)[-1]
        r = base("cantoria", f"cantoria__{b}", "voice", "val", f"cantoria:{part}", "https://zenodo.org/records/5878677 (CantoriaDataset_v1.0.0.zip)", n,
                 voice_part=part, gender=PART_G.get(part, "unknown"), gender_basis="voice part")
        if part not in PART_G:
            drops.append(dict(r, drop="mixture (several singers / organ)"))
            continue
        r.update(bytes=z.read(n), native=True)
        P.submit(r)
    flush(drops + P.finish(), "cantoria")


def src_csd(P):
    z = zip_local(os.path.join(DL, "choir", "ChoralSingingDataset.zip"))
    sec = {"Soprano": "S", "ContraAlt": "A", "Tenor": "T", "tenor": "T", "Bajos": "B"}
    for n in z.namelist():
        if not (n.endswith(".wav") and "Individual voices" in n):
            continue
        b = os.path.basename(n)[:-4]
        m = re.search(r"_(Bajos|ContraAlt|Soprano|[Tt]enor)_?(\d)", b)
        part, k = sec[m.group(1)], m.group(2)
        r = base("csd", f"csd__{b}", "voice", "train", f"csd:{part}{k}", "https://zenodo.org/records/1286570 (ChoralSingingDataset.zip)", n,
                 singer=f"{part}{k}", voice_part=part, gender=PART_G[part], gender_basis="voice part", piece=n.split("/")[1])
        r.update(bytes=z.read(n))
        P.submit(r)
    flush(P.finish(), "csd")


def remote_members(url, names, threads=int(A.get("remote-threads", "2"))):
    """Yield (name, bytes) range-read from a remote zip (one RemoteZip per thread)."""
    from remotezip import RemoteZip
    import threading
    local = threading.local()

    def one(n):
        if not hasattr(local, "rz"):
            local.rz = RemoteZip(url)
        for k in range(5):
            try:
                return n, local.rz.read(n)
            except Exception as e:  # noqa: BLE001
                print("range read", n, e, flush=True)
                time.sleep(20 * (k + 1))
                local.rz = RemoteZip(url)
        return n, None
    with ThreadPoolExecutor(threads) as ex:
        yield from ex.map(one, names)


def src_dcs(P):
    url = "https://zenodo.org/api/records/3897182/files/DagstuhlChoirSet.zip/content"
    L = json.load(open(os.path.join(META, "zip_listings.json"), encoding="utf8"))["dcs"]
    names, drops = [], []
    for n, size, _ in L:
        if not n.endswith(".wav") or n.startswith("__MACOSX"):
            continue
        b = os.path.basename(n)[:-4]
        mic = b.rsplit("_", 1)[-1]
        sing = b.rsplit("_", 2)[-2]
        r = base("dcs", f"dcs__{b}", "voice", "train", f"dcs:{sing}", "https://zenodo.org/records/3897182 (DagstuhlChoirSet.zip)", n,
                 singer=sing, mic=mic, voice_part=sing[:1], gender=PART_G.get(sing[:1], "unknown"), gender_basis="voice part")
        if mic not in ("DYN", "HSM"):
            drops.append(dict(r, drop=f"microphone {mic} (larynx / stereo room / piano)"))
        elif "Piano" in b:
            drops.append(dict(r, drop="take with piano"))
        elif r["id"] not in MAN or "drop" in MAN.have[r["id"]]:
            names.append((n, r))
    flush(drops, "dcs (excluded tracks)")
    byname = dict(names)
    for n, data in remote_members(url, [n for n, _ in names]):
        r = dict(byname[n])
        if data is None:
            MAN.add(dict(r, drop="range read failed"))
            continue
        r["bytes"] = data
        P.submit(r)
    flush(P.finish(), "dcs")


def src_vctk(P):
    S = SPLITS["positives"]["vctk"]
    url = "https://datashare.ed.ac.uk/server/api/core/bitstreams/535f4286-e54c-4038-838c-a02285e32cb2/content"
    fl = json.load(open(os.path.join(META, "vctk_flac_listing.json"), encoding="utf8"))
    spk_g = {}
    for line in open(os.path.join(META, "vctk_speaker-info.txt"), encoding="utf8").read().splitlines()[1:]:
        p = line.split()
        if p:
            spk_g[p[0]] = {"F": "f", "M": "m"}.get(p[2], "unknown")
    speakers = sorted(spk_g)
    assert sorted(s for s in speakers if fnv1a(s) % 10 == 0) == sorted(S["val_speakers"]), "VCTK val speakers differ from splits.json"
    have = {n for n, _ in fl}
    pick = []
    for n, _ in fl:
        m = re.search(r"/((p|s)\d+)_(\d+)_(mic\d)\.flac$", n)
        spk, utt, mic = m.group(1), f"{m.group(1)}_{m.group(3)}", m.group(4)
        h = fnv1a(utt)
        if h % 10 != 0 or mic != ("mic1" if h % 2 == 0 else "mic2"):
            continue
        sp = "val" if spk in S["val_speakers"] else "train"
        r = base("vctk", f"vctk__{utt}_{mic}", "voice", sp, f"vctk:{spk}", "https://doi.org/10.7488/ds/2645 (VCTK-Corpus-0.92.zip)", n,
                 speaker=spk, mic=mic, gender=spk_g.get(spk, "unknown"))
        if r["id"] not in MAN or "drop" in MAN.have[r["id"]]:
            pick.append((n, r))
    print(f"vctk: {len(pick)} utterances to fetch ({len(have)} files in the zip)", flush=True)
    byname = dict(pick)
    k = 0
    for n, data in remote_members(url, [n for n, _ in pick]):
        r = dict(byname[n])
        if data is None:
            MAN.add(dict(r, drop="range read failed"))
            continue
        r.update(bytes=data, native=(r["split"] == "val"))
        P.submit(r)
        k += 1
        if k % 500 == 0:
            flush(P.finish(), f"vctk ({k})")
    flush(P.finish(), "vctk")


VOICE_CLASSES = set(SPLITS["negatives"]["fsd50k"]["excluded_label_classes"])
MACHINE = set(SPLITS["negatives"]["fsd50k"]["machine_room_classes"])


def src_fsd50k(P):
    d = os.path.join(DL, "fsd50k")
    ids, ups, esc = benchmark_freesound()
    ex = os.path.join(d, "extract")
    for split, last in (("dev", "FSD50K.dev_audio.zip"), ("eval", "FSD50K.eval_audio.zip")):
        parts = [f"{last[:-4]}.z{i:02d}" for i in range(1, {"dev": 6, "eval": 2}[split])] + [last]
        for p in parts:
            wait_ok(os.path.join(d, p))
        out = os.path.join(ex, f"FSD50K.{split}_audio")
        if not os.path.exists(out + ".extracted"):
            print(f"7z x {last} ...", flush=True)
            subprocess.run([SEVENZIP, "x", "-y", f"-o{ex}", os.path.join(d, last)], check=True, stdout=subprocess.DEVNULL)
            open(out + ".extracted", "w").write("ok")
        info = json.load(open(os.path.join(d, "FSD50K.metadata", f"{split}_clips_info_FSD50K.json"), encoding="utf8"))
        labs = {r["fname"]: r["labels"].split(",") for r in csv.DictReader(open(os.path.join(d, "FSD50K.ground_truth", f"{split}.csv"), encoding="utf8"))}
        drops = []
        for fid, v in sorted(info.items(), key=lambda kv: int(kv[0])):
            L = set(labs[fid])
            lic = norm_cc(v["license"])
            sp = "train" if split == "dev" else "val"
            r = dict(id=f"fsd50k__{fid}", kind="nonvoice", source="fsd50k", split=sp, group=f"freesound:{v['uploader']}",
                     url=f"https://freesound.org/s/{fid}/", member=f"FSD50K.{split}_audio/{fid}.wav", licence=lic,
                     licence_where=f"FSD50K.metadata/{split}_clips_info_FSD50K.json (dataset: FSD50K.doc/LICENSE-DATASET, CC BY 4.0)",
                     attribution=f"\"{v['title']}\" by {v['uploader']} (freesound.org/s/{fid}), {lic}; via FSD50K (zenodo 4060432), CC BY 4.0",
                     freesound_id=int(fid), uploader=v["uploader"], labels=sorted(L), fsd50k_split=split,
                     machine_room=bool(L & MACHINE))
            why = None
            if lic not in ("CC0 1.0", "CC BY 3.0", "CC BY 4.0"):
                why = f"licence {lic}"
            elif L & VOICE_CLASSES:
                why = "human voice / vocal-sound / music / animal label"
            elif int(fid) in ids:
                why = "benchmark Freesound id"
            elif int(fid) in esc:
                why = "ESC-50 source id"
            elif v["uploader"] in ups:
                why = "benchmark Freesound uploader"
            elif KEYWORDS.search(" ".join([v.get("title", ""), v.get("description", ""), " ".join(v.get("tags", []))])):
                why = "voice / music keyword in title, description or tags"
            if why:
                drops.append(dict(r, drop=why))
                continue
            r.update(file=os.path.join(out, f"{fid}.wav"))
            P.submit(r)
        flush(drops + P.finish(), f"fsd50k {split}")


def src_fstrain(P):
    idx = json.load(open(os.path.join(DL, "fstrain", "index.json"), encoding="utf8"))
    for k in idx["kept"]:
        r = dict(id=f"fstrain__{k['id']}", kind="nonvoice", source="fstrain", split=k["split"], group=f"freesound:{k['user']}",
                 url=k["url"], member=k["preview"], licence=k["licence"], licence_where=f"sound page ({k['licence_url']})",
                 attribution=f"\"{k['title']}\" by {k['user']} (freesound.org/s/{k['id']}), {k['licence']}",
                 freesound_id=k["id"], uploader=k["user"], query=k["query"], machine_room=True, codec="vorbis HQ preview")
        r.update(file=os.path.join(DL, k["path"]), max_sec=120)
        P.submit(r)
    flush(P.finish(), "fstrain")


FN = dict(librispeech=src_librispeech, coswara=src_coswara, mdvr=src_mdvr, esmuc=src_esmuc, cantoria=src_cantoria,
          csd=src_csd, dcs=src_dcs, vctk=src_vctk, fsd50k=src_fsd50k, fstrain=src_fstrain)

if __name__ == "__main__":
    os.makedirs(DATA, exist_ok=True)
    P = Pool()
    for s in SOURCES:
        t = time.time()
        FN[s](P)
        print(f"== {s} done in {time.time() - t:.0f} s", flush=True)
