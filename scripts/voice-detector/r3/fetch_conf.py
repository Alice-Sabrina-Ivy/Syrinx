# fetch_conf.py — custom voice detector, round 3 (pre-registration §1.2 /
# §1.4): download the confirmatory voice and machine-noise sources (all but
# Freesound, which is fs_conf.py) into build/vad-train/r3/conf/dl/<key>/.
# Every licence is read at the source and saved next to the data (Zenodo
# record JSON, Hugging Face licence file, Wikimedia Commons extmetadata).
# Nothing here opens, plays, plots or scores the audio: it only selects files
# by the pre-registered rules (FNV-1a orders, caps) and stores them.
#
#   sbi   SingBAP intermediate participants: VOICE_DATA.zip member
#         intermediate.zip (zenodo 20744738), range-read + inflated
#   ls    LibriSpeech train-clean-100 (openslr 12): 24 F + 24 M speakers in FNV
#         order of "r3:" + speaker, the first chapter in FNV order of the
#         chapter id; tarball downloaded, only those chapters extracted
#   gts   GTSinger English + French (Hugging Face GTSinger/GTSinger): per singer
#         and group (Control, Falsetto, Breathy, Mixed_Voice, Pharyngeal,
#         Vibrato, Glissando) up to 4 songs in FNV order; Paired_Speech unused
#   jj    Jingju a cappella part 2 (zenodo 1421692): per singer up to 20 min,
#         recordings in FNV order of the file name
#   qbh   MTG-QBH (zenodo 1290712), whole archive
#   aa    Acoustics Australia vowel phonations (zenodo 7098345) + profiles (7098349)
#   fry   PLOS ONE e0097506 supplementary audio (Wikimedia Commons)
#   ipa   Wikimedia Commons IPA trill samples: title matches
#         "(bilabial|alveolar|uvular) trill", not "voiceless"
#   nb    DCASE 2023 T2 additional (7830345), DCASE 2024 T2 additional
#         (11259435), AVQ drones (4553667), AID (6974033)
#
#   python scripts/voice-detector/r3/fetch_conf.py --what=sbi [--sb-par=2]
import html
import io
import json
import os
import re
import struct
import sys
import tarfile
import zlib
from concurrent.futures import ThreadPoolExecutor

import requests

from c3 import CDL, DL, UA, ZEN, args, fnv1a, log, write_json

sys.path.append(os.path.abspath(os.path.join(os.path.dirname(__file__), "../../notch-adversarial/realdata")))
from remotezip import RemoteZip  # noqa: E402

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "custom")))
from fetch_r2 import fetch_file  # noqa: E402

A = args()
NB_PER_TYPE = int(A.get("nb-per-type", "3"))       # §1.4 size fallback: 6


def zenodo_record(rec, sub):
    r = requests.get(f"https://zenodo.org/api/records/{rec}", timeout=60, headers=UA).json()
    write_json(os.path.join(CDL, sub, f"zenodo_{rec}.json"), r, indent=1)
    log(sub, rec, "licence at source:", r["metadata"].get("license", {}).get("id"))
    return r


# ----------------------------------------------------------------------------- sbi
def sbi():
    out = os.path.join(CDL, "sbi")
    zenodo_record(20744738, "sbi")
    for small in ("LICENSE.md", "README.md", "METHODS.md", "metadata.csv"):
        fetch_file(ZEN.format(rec=20744738, fn=small), os.path.join(out, small))
    name = "VOICE_DATA/intermediate.zip"
    dest = os.path.join(out, "intermediate.zip")
    if os.path.exists(dest + ".ok"):
        log("sbi: done already")
        return
    rz = RemoteZip(ZEN.format(rec=20744738, fn="VOICE_DATA.zip"))
    info = rz.z.getinfo(name)
    hdr = rz.f._get(info.header_offset, info.header_offset + 29)
    n, e = struct.unpack("<HH", hdr[26:30])
    a = info.header_offset + 30 + n + e
    part = dest + ".deflate"
    npar = int(A.get("sb-par", "2"))
    edges = [a + (info.compress_size * k) // npar for k in range(npar + 1)]
    log(f"sbi {name}: {info.compress_size / 1e9:.2f} GB compressed, {npar} range(s)")

    def piece(k):
        import time
        pp, lo, hi = f"{part}.{k}", edges[k], edges[k + 1] - 1
        ss = requests.Session()
        ss.headers.update(UA)
        have = os.path.getsize(pp) if os.path.exists(pp) else 0
        last = 0
        while have < hi - lo + 1:
            try:
                rr = ss.get(rz.url, headers={"Range": f"bytes={lo + have}-{hi}"}, stream=True, timeout=300)
                if rr.status_code != 206:
                    raise IOError(f"HTTP {rr.status_code}")
                with open(pp, "ab") as f:
                    for chunk in rr.iter_content(1 << 20):
                        f.write(chunk)
                        if f.tell() - last > 5e8:
                            last = f.tell()
                            log(f"sbi range {k}: {(have + f.tell()) / 1e9:.2f} GB")
            except (requests.RequestException, IOError) as ex:
                log("sbi retry", k, ex)
                time.sleep(30)
            have = os.path.getsize(pp)
    with ThreadPoolExecutor(npar) as ex:
        list(ex.map(piece, range(npar)))
    with open(part, "wb") as fo:
        for k in range(npar):
            with open(f"{part}.{k}", "rb") as fi:
                while True:
                    c = fi.read(1 << 24)
                    if not c:
                        break
                    fo.write(c)
    assert os.path.getsize(part) == info.compress_size
    d = zlib.decompressobj(-15)
    crc = 0
    with open(part, "rb") as fi, open(dest + ".tmp", "wb") as fo:
        while True:
            c = fi.read(1 << 22)
            if not c:
                break
            y = d.decompress(c)
            crc = zlib.crc32(y, crc)
            fo.write(y)
        y = d.flush()
        crc = zlib.crc32(y, crc)
        fo.write(y)
    if os.path.getsize(dest + ".tmp") != info.file_size or (crc & 0xFFFFFFFF) != info.CRC:
        raise SystemExit("sbi: size / crc mismatch")
    os.replace(dest + ".tmp", dest)
    os.remove(part)
    for k in range(npar):
        os.remove(f"{part}.{k}")
    open(dest + ".ok", "w").write("ok")
    log("sbi intermediate.zip ok")


# ----------------------------------------------------------------------------- ls
def ls_select():
    """SPEAKERS.TXT / CHAPTERS.TXT (identical in every LibriSpeech tarball) from the round-1 dev-clean download."""
    meta = {}
    with tarfile.open(os.path.join(DL, "librispeech", "dev-clean.tar.gz"), "r|gz") as tf:
        for m in tf:
            if m.name.endswith(("SPEAKERS.TXT", "CHAPTERS.TXT", "LICENSE.TXT")):
                meta[os.path.basename(m.name)] = tf.extractfile(m).read().decode("utf8")
            if len(meta) == 3:
                break
    spk, chap = {}, {}
    for line in meta["SPEAKERS.TXT"].splitlines():
        if line.startswith(";") or "|" not in line:
            continue
        p = [x.strip() for x in line.split("|")]
        spk[p[0]] = {"sex": p[1].lower(), "subset": p[2], "name": p[4] if len(p) > 4 else ""}
    for line in meta["CHAPTERS.TXT"].splitlines():
        if line.startswith(";") or "|" not in line:
            continue
        p = [x.strip() for x in line.split("|")]
        chap[p[0]] = {"reader": p[1], "minutes": float(p[2]), "subset": p[3]}
    return spk, chap, meta


def ls():
    out = os.path.join(CDL, "ls")
    os.makedirs(out, exist_ok=True)
    spk, chap, meta = ls_select()
    for k, v in meta.items():
        open(os.path.join(out, k), "w", encoding="utf8").write(v)
    excl = set(json.load(open(os.path.join(CDL, "..", "..", "exclude.json"), encoding="utf8"))["speakers_by_source"].get("librispeech", []))
    cands = sorted([s for s, v in spk.items() if v["subset"] == "train-clean-100" and s not in excl], key=lambda s: (fnv1a("r3:" + s), s))
    sel = [s for s in cands if spk[s]["sex"] == "f"][:24] + [s for s in cands if spk[s]["sex"] == "m"][:24]
    chosen = {}
    for s in sel:
        cs = sorted([c for c, v in chap.items() if v["reader"] == s and v["subset"] == "train-clean-100"], key=lambda c: (fnv1a(c), c))
        chosen[s] = {"chapter": cs[0], "sex": spk[s]["sex"], "minutes": chap[cs[0]]["minutes"], "n_chapters": len(cs)}
    write_json(os.path.join(out, "selection.json"), chosen, indent=1)
    log(f"ls: {len(sel)} speakers ({sum(v['sex'] == 'f' for v in chosen.values())} F), {sum(v['minutes'] for v in chosen.values()):.0f} min of chapters")
    tgz = os.path.join(out, "train-clean-100.tar.gz")
    fetch_file("https://openslr.elda.org/resources/12/train-clean-100.tar.gz", tgz)
    want = {f"{s}/{v['chapter']}" for s, v in chosen.items()}
    n = 0
    with tarfile.open(tgz, "r|gz") as tf:
        for m in tf:
            parts = m.name.split("/")
            if len(parts) >= 5 and f"{parts[2]}/{parts[3]}" in want and m.isfile():
                dst = os.path.join(out, "audio", *parts[2:])
                os.makedirs(os.path.dirname(dst), exist_ok=True)
                open(dst, "wb").write(tf.extractfile(m).read())
                n += 1
    open(os.path.join(out, "extract.ok"), "w").write(str(n))
    log(f"ls: {n} files extracted")


# ----------------------------------------------------------------------------- gts
HF = "https://huggingface.co"
GTS_GROUPS = ("Control_Group", "Falsetto_Group", "Breathy_Group", "Mixed_Voice_Group", "Pharyngeal_Group", "Vibrato_Group", "Glissando_Group")


def hf_tree(path):
    out, url = [], f"{HF}/api/datasets/GTSinger/GTSinger/tree/main/{requests.utils.quote(path)}"
    while url:
        r = requests.get(url, headers=UA, timeout=60)
        r.raise_for_status()
        out += r.json()
        url = r.links.get("next", {}).get("url")
    return out


def gts():
    out = os.path.join(CDL, "gts")
    os.makedirs(out, exist_ok=True)
    lic = requests.get(f"{HF}/datasets/GTSinger/GTSinger/resolve/main/dataset_license.md", headers=UA, timeout=60).text
    open(os.path.join(out, "dataset_license.md"), "w", encoding="utf8").write(lic)
    assert "CC BY-NC-SA 4.0" in lic
    open(os.path.join(out, "README.md"), "w", encoding="utf8").write(requests.get(f"{HF}/datasets/GTSinger/GTSinger/resolve/main/README.md", headers=UA, timeout=60).text)
    sel_p = os.path.join(out, "selection.json")
    if os.path.exists(sel_p):
        sel = json.load(open(sel_p, encoding="utf8"))
    else:
        sel = []
        for lang in ("English", "French"):
            for singer in [x["path"] for x in hf_tree(lang) if x["type"] == "directory"]:
                songs = {}          # group -> [(technique/song path)]
                for tech in [x["path"] for x in hf_tree(singer) if x["type"] == "directory"]:
                    for song in [x["path"] for x in hf_tree(tech) if x["type"] == "directory"]:
                        for grp in [x["path"] for x in hf_tree(song) if x["type"] == "directory"]:
                            g = grp.rsplit("/", 1)[1]
                            if g in GTS_GROUPS:
                                songs.setdefault(g, []).append(grp)
                for g, paths in sorted(songs.items()):
                    for grp in sorted(paths, key=lambda p: (fnv1a(p), p))[:4]:
                        files = [x for x in hf_tree(grp) if x["type"] == "file" and x["path"].endswith(".wav")]
                        for f in files:
                            sel.append({"path": f["path"], "size": f.get("size"), "singer": singer.split("/")[1], "lang": lang, "group": g,
                                        "song": grp.split("/")[3], "technique": grp.split("/")[2]})
                log(f"gts {singer}: {sum(1 for s in sel if s['singer'] == singer.split('/')[1])} files")
        write_json(sel_p, sel, indent=1)
    s = requests.Session()
    s.headers.update(UA)
    for k, f in enumerate(sel):
        dst = os.path.join(out, "audio", *f["path"].split("/"))
        if os.path.exists(dst):
            continue
        os.makedirs(os.path.dirname(dst), exist_ok=True)
        for t in range(6):
            try:
                r = s.get(f"{HF}/datasets/GTSinger/GTSinger/resolve/main/{requests.utils.quote(f['path'])}", timeout=300)
                if r.status_code == 200:
                    open(dst + ".tmp", "wb").write(r.content)
                    os.replace(dst + ".tmp", dst)
                    break
                raise IOError(f"HTTP {r.status_code}")
            except (requests.RequestException, IOError) as e:
                log("gts retry", f["path"], e)
                import time
                time.sleep(10 * (t + 1))
        if k % 100 == 0:
            log(f"gts {k}/{len(sel)}")
    log(f"gts: {len(sel)} files")


# ----------------------------------------------------------------------------- jj
def jj():
    import openpyxl
    out = os.path.join(CDL, "jj")
    os.makedirs(out, exist_ok=True)
    zenodo_record(1421692, "jj")
    rz = RemoteZip(ZEN.format(rec=1421692, fn="metadata.zip"))
    b = rz.read("metadata/aria metadata.xlsx")
    open(os.path.join(out, "aria_metadata.xlsx"), "wb").write(b)
    wb = openpyxl.load_workbook(io.BytesIO(b), read_only=True)
    meta = {}
    for ws in wb.worksheets:
        rows = list(ws.iter_rows(values_only=True))
        hdr = rows[0]
        path = singer = None
        for r in rows[1:]:
            d = dict(zip(hdr, r))
            path = d.get("Path name") or path
            singer = d.get("Singer") or singer
            fn = d.get("File name")
            if not fn:
                continue
            meta[os.path.splitext(fn)[0]] = {"folder": path, "singer": singer, "role": d.get("Role type"), "level": d.get("Level"), "sheet": ws.title,
                                             "accompaniment": d.get("Jinghu accompaniment")}
    sel = []
    infos = {}
    for zfn in ("wav_part1.zip", "wav_part2.zip"):
        z = RemoteZip(ZEN.format(rec=1421692, fn=zfn))
        for i in z.infolist():
            if i.filename.endswith(".wav") and not i.filename.startswith("__MACOSX"):
                infos[i.filename] = (zfn, i.file_size)
    by_singer = {}
    for name, (zfn, size) in infos.items():
        stem = os.path.splitext(os.path.basename(name))[0]
        m = meta.get(stem)
        singer = (m or {}).get("singer") or name.split("/")[0]
        by_singer.setdefault(singer, []).append((name, zfn, size, m))
    for singer, rs in sorted(by_singer.items()):
        tot = 0.0
        for name, zfn, size, m in sorted(rs, key=lambda t: (fnv1a(os.path.basename(t[0])), t[0])):
            sel.append({"member": name, "zip": zfn, "size": size, "singer": singer, "meta": m})
            tot += size / (44100 * 2 * 2)        # estimate (16-bit stereo 44.1 kHz); the 20-min cap is applied on the real durations in prepare
            if tot >= 20 * 60 * 1.5:
                break
    write_json(os.path.join(out, "selection.json"), sel, indent=1)
    log(f"jj: {len(by_singer)} singers, {len(sel)} files to fetch ({sum(s['size'] for s in sel) / 1e9:.2f} GB)")
    zs = {}
    for k, s in enumerate(sel):
        dst = os.path.join(out, "audio", s["member"])
        if os.path.exists(dst):
            continue
        os.makedirs(os.path.dirname(dst), exist_ok=True)
        z = zs.setdefault(s["zip"], RemoteZip(ZEN.format(rec=1421692, fn=s["zip"])))
        open(dst + ".tmp", "wb").write(z.read(s["member"]))
        os.replace(dst + ".tmp", dst)
        log(f"jj {k + 1}/{len(sel)} {s['member']}")


# ----------------------------------------------------------------------------- qbh / aa
def qbh():
    zenodo_record(1290712, "qbh")
    fetch_file(ZEN.format(rec=1290712, fn="MTG-QBH.zip"), os.path.join(CDL, "qbh", "MTG-QBH.zip"))
    log("qbh done")


def aa():
    r = zenodo_record(7098345, "aa")
    zenodo_record(7098349, "aa")
    fetch_file(ZEN.format(rec=7098349, fn="AcousticsAustraliaArticle_ParticipantProfiles.xlsx"), os.path.join(CDL, "aa", "profiles.xlsx"))
    for f in r["files"]:
        if re.search(r"_VWL.*\.wav$", f["key"]):
            fetch_file(ZEN.format(rec=7098345, fn=f["key"]), os.path.join(CDL, "aa", "audio", f["key"]))
    log("aa done")


# ----------------------------------------------------------------------------- commons
API = "https://commons.wikimedia.org/w/api.php"
WUA = {"User-Agent": "SyrinxResearchDataFetch/0.1 (voice-detector evaluation; https://github.com/alice-sabrina-ivy/Syrinx)"}


def commons_search(q):
    out, off = [], 0
    while True:
        r = requests.get(API, params=dict(action="query", list="search", srsearch=q, srnamespace=6, srlimit=500, sroffset=off, format="json"),
                         headers=WUA, timeout=60).json()
        out += [x["title"] for x in r["query"]["search"]]
        if "continue" not in r:
            return out
        off = r["continue"]["sroffset"]


def commons_info(titles):
    res = {}
    for k in range(0, len(titles), 40):
        r = requests.get(API, params=dict(action="query", titles="|".join(titles[k:k + 40]), prop="imageinfo", iiprop="url|extmetadata|size|mime",
                                          format="json"), headers=WUA, timeout=60).json()
        for p in r["query"]["pages"].values():
            ii = (p.get("imageinfo") or [{}])[0]
            em = ii.get("extmetadata", {})
            res[p["title"]] = {"url": ii.get("url"), "mime": ii.get("mime"), "size": ii.get("size"), "descriptionurl": ii.get("descriptionurl"),
                               "licence": (em.get("LicenseShortName") or {}).get("value"), "licence_url": (em.get("LicenseUrl") or {}).get("value"),
                               "artist": html.unescape(re.sub(r"<[^>]+>", "", (em.get("Artist") or {}).get("value", ""))).strip(),
                               "description": html.unescape(re.sub(r"<[^>]+>", " ", (em.get("ImageDescription") or {}).get("value", ""))).strip()[:2000],
                               "credit": html.unescape(re.sub(r"<[^>]+>", " ", (em.get("Credit") or {}).get("value", ""))).strip()[:500]}
    return res


def commons_fetch(key, titles):
    out = os.path.join(CDL, key)
    info = commons_info(titles)
    write_json(os.path.join(out, "commons.json"), info, indent=1)
    for t, v in info.items():
        if not v["url"]:
            continue
        dst = os.path.join(out, "audio", re.sub(r"[^\w.\-]+", "_", t.split(":", 1)[1]))
        if not os.path.exists(dst):
            os.makedirs(os.path.dirname(dst), exist_ok=True)
            import time
            for k in range(10):
                r = requests.get(v["url"], headers=WUA, timeout=120)
                if r.status_code == 429:
                    time.sleep(30 * (k + 1))
                    continue
                r.raise_for_status()
                break
            open(dst, "wb").write(r.content)
            time.sleep(3)
        v["file"] = os.path.relpath(dst, out).replace("\\", "/")
    write_json(os.path.join(out, "commons.json"), info, indent=1)
    log(f"{key}: {len(info)} files; licences {sorted(set(v['licence'] or '?' for v in info.values()))}")


def fry():
    titles = sorted(t for t in commons_search('intitle:"pone.0097506"') if "Vocal-Fry-May-Undermine" in t and re.search(r"\.(oga|ogg|wav|flac|mp3)$", t))
    commons_fetch("fry", titles)


AUDIO = re.compile(r"\.(oga|ogg|wav|flac|mp3|opus)$", re.I)
TRILL = re.compile(r"(bilabial|alveolar|uvular) trill", re.I)


def ipa():
    seen = set()
    for q in ("intitle:trill", 'intitle:"bilabial trill"', 'intitle:"alveolar trill"', 'intitle:"uvular trill"'):
        seen |= set(commons_search(q))
    titles = sorted(t for t in seen if AUDIO.search(t) and TRILL.search(t) and not re.search(r"voiceless", t, re.I))
    commons_fetch("ipa", titles)


# ----------------------------------------------------------------------------- nb
DC23 = (7830345, ["Vacuum", "ToyTank", "ToyNscale", "ToyDrone", "bandsaw", "grinder", "shaker"], "eval_data_{}_train.zip")
DC24 = (11259435, ["3DPrinter", "AirCompressor", "BrushlessMotor", "HairDryer", "HoveringDrone", "RoboticArm", "Scanner", "ToothBrush", "ToyCircuit"],
        "eval_data_{}_train.zip")
AID_RX = re.compile(r"drill|blender|dryer|vacuum|fan|mixer|shaver|toothbrush|printer|machine|motor|pump|kettle|microwave|fridge|dishwasher|washing", re.I)


def machine_id(fn):
    """DCASE 2023/24 file name: section_00_<domain>_train_normal_NNNN_<k1>_<v1>_... -> '<k1>_<v1>' (the first attribute pair)."""
    m = re.match(r"section_(\d\d)_\w+?_train_normal_\d{4}_([^_]+)_([^_]+)", fn)
    return (m.group(1), f"{m.group(2)}_{m.group(3)}") if m else (None, None)


def nb():
    out = os.path.join(CDL, "nb")
    os.makedirs(out, exist_ok=True)
    plan = []
    if os.path.exists(os.path.join(out, "plan.json")):
        old = {(p["type"], p["machine"]): p for p in json.load(open(os.path.join(out, "plan.json"), encoding="utf8"))}
    else:
        old = {}
    for rec, types, pat in (DC23, DC24):
        r = zenodo_record(rec, "nb")
        files = {f["key"] for f in r["files"]}
        for t in types:
            fn = next((f for f in sorted(files) if f.startswith(f"eval_data_{t}_train")), None)
            if fn is None:
                log("nb: missing", t)
                continue
            z = RemoteZip(ZEN.format(rec=rec, fn=fn))
            wavs = sorted(n for n in z.namelist() if n.endswith(".wav") and "_normal_" in n)
            groups = {}
            for n in wavs:
                sec, mid = machine_id(os.path.basename(n))
                groups.setdefault(f"s{sec}:{mid}", []).append(n)
            keys = sorted(groups, key=lambda k: (fnv1a(f"{t}:{k}"), k))
            for k in keys[:10]:          # spares: an id whose normal clips give < 20 s is skipped in prepare (the next in FNV order takes its place)
                plan.append({"source": "dcase23" if rec == DC23[0] else "dcase24", "rec": rec, "zip": fn, "type": t, "machine": k, "members": groups[k][:40],
                             "n_ids": len(keys)})
            log(f"nb {t}: {len(keys)} machine ids {keys[:8]}")
    write_json(os.path.join(out, "plan.json"), plan, indent=1)
    zs = {}
    for p in plan:
        if (p["type"], p["machine"]) in old and old[(p["type"], p["machine"])].get("fetched"):
            p["fetched"] = old[(p["type"], p["machine"])]["fetched"]
            continue
        z = zs.setdefault(p["zip"], RemoteZip(ZEN.format(rec=p["rec"], fn=p["zip"])))
        tot = 0.0
        p["fetched"] = []
        for n in p["members"]:
            dst = os.path.join(out, "audio", p["type"], os.path.basename(n))
            if not os.path.exists(dst):
                os.makedirs(os.path.dirname(dst), exist_ok=True)
                open(dst + ".tmp", "wb").write(z.read(n))
                os.replace(dst + ".tmp", dst)
            import soundfile as sf
            tot += sf.info(dst).duration
            p["fetched"].append(os.path.relpath(dst, out).replace("\\", "/"))
            if tot >= 90.0:
                break
        log(f"nb {p['type']} {p['machine']}: {len(p['fetched'])} clips, {tot:.0f} s")
    write_json(os.path.join(out, "plan.json"), plan, indent=1)
    zenodo_record(4553667, "nb")
    fetch_file(ZEN.format(rec=4553667, fn="all_drone_noises.zip"), os.path.join(out, "all_drone_noises.zip"))
    zenodo_record(6974033, "nb")
    fetch_file(ZEN.format(rec=6974033, fn="AID.zip"), os.path.join(out, "AID.zip"))
    log("nb done")


FN = dict(sbi=sbi, ls=ls, gts=gts, jj=jj, qbh=qbh, aa=aa, fry=fry, ipa=ipa, nb=nb)

if __name__ == "__main__":
    for w in A.get("what", "").split(","):
        if w:
            FN[w]()
