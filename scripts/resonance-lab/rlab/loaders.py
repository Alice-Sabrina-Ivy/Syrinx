"""Corpus loaders -> item DataFrames.

Every item row carries at least:
  item_id   unique within the benchmark
  set       benchmark item-set name (see build_bench.py)
  corpus    librispeech-test | librispeech-dev | ptdb | fda | hillenbrand | synth | sessions
  path      audio file (wav/flac/sig); read with rlab.audio.load(path, sr_hint) -> 16 kHz
  sr_src    sample rate of `path`
  speaker   speaker id (corpus-prefixed)
  sex       'm' | 'f' (adult sex label; '' when not applicable)
  group     men | women | boys | girls | second | alice_low | alice_mid | alice_raised ...
  vowel     Hillenbrand vowel code ('' otherwise)
  order     position in the speaker's stream (horizon pooling walks items in this order)
"""
import os
import re
import glob
import numpy as np
import pandas as pd
import soundfile as sf
from .paths import LIBRI, HILL, corpus_dir, SEED


# ----------------------------------------------------------------- LibriSpeech
def libri_speakers():
    sex = {}
    for line in open(os.path.join(LIBRI, "SPEAKERS.TXT"), encoding="utf8"):
        if line.startswith(";"):
            continue
        p = [s.strip() for s in line.split("|")]
        if len(p) >= 3:
            sex[p[0]] = p[1].lower()
    return sex


def libri_utts(split):
    """All utterances of a LibriSpeech split (dev-clean / test-clean)."""
    sex = libri_speakers()
    rows = []
    for f in glob.glob(os.path.join(LIBRI, split, "*", "*", "*.flac")):
        uid = os.path.basename(f)[:-5]
        spk, chap, utt = uid.split("-")
        info = sf.info(f)
        rows.append(dict(item_id=f"ls-{uid}", corpus=f"librispeech-{split.split('-')[0]}", path=f.replace("\\", "/"),
                         sr_src=info.samplerate, dur_s=info.frames / info.samplerate, speaker=f"ls{spk}",
                         sex=sex[spk], group={"m": "men", "f": "women"}[sex[spk]], vowel="",
                         chap=int(chap), utt=int(utt)))
    df = pd.DataFrame(rows).sort_values(["speaker", "chap", "utt"]).reset_index(drop=True)
    df["order"] = df.groupby("speaker").cumcount()
    return df


def libri_pool(split, per_speaker, seed=SEED, min_dur=2.0):
    """`per_speaker` utterances per speaker (random, seeded), kept in stream order."""
    df = libri_utts(split)
    df = df[df.dur_s >= min_dur]
    rng = np.random.default_rng(seed)
    keep = []
    for spk, d in df.groupby("speaker"):
        idx = rng.permutation(len(d))[:per_speaker]
        keep.append(d.iloc[np.sort(idx)])
    out = pd.concat(keep).reset_index(drop=True)
    out["order"] = out.groupby("speaker").cumcount()
    return out


def libri_manip_sources(split, per_speaker, seed=SEED + 1, dmin=3.0, dmax=12.0):
    """Sources for the manipulation sets: `per_speaker` utterances of 3-12 s per
    speaker (cropped to <= 5 s at build time). Balanced by construction because
    LibriSpeech dev/test-clean are 20 F + 20 M speakers each."""
    df = libri_utts(split)
    df = df[(df.dur_s >= dmin) & (df.dur_s <= dmax)]
    rng = np.random.default_rng(seed)
    keep = []
    for spk, d in df.groupby("speaker"):
        keep.append(d.iloc[np.sort(rng.permutation(len(d))[:per_speaker])])
    return pd.concat(keep).reset_index(drop=True)


# ----------------------------------------------------------------- Hillenbrand
def vowdata():
    rows = []
    for line in open(os.path.join(HILL, "vowdata.dat")):
        p = line.split()
        if len(p) >= 7 and p[0][0] in "mwbg" and p[0][1:3].isdigit():
            rows.append(dict(file=p[0], g=p[0][0], spk=p[0][:3], vowel=p[0][3:5], dur_ms=float(p[1]),
                             f0=float(p[2]), F1=float(p[3]), F2=float(p[4]), F3=float(p[5]), F4=float(p[6])))
    df = pd.DataFrame(rows)
    for c in ("F1", "F2", "F3", "F4", "f0"):
        df.loc[df[c] <= 0, c] = np.nan
    return df


HILL_GROUP = {"m": "men", "w": "women", "b": "boys", "g": "girls"}
HILL_SEX = {"m": "m", "w": "f", "b": "", "g": ""}


def hillenbrand():
    vd = vowdata()
    rows = []
    for _, r in vd.iterrows():
        sub = {"m": "men", "w": "women"}.get(r.g)
        if not sub:
            continue
        p = os.path.join(HILL, sub, r.file + ".wav")
        if not os.path.exists(p):
            continue
        info = sf.info(p)
        rows.append(dict(item_id=f"hb-{r.file}", corpus="hillenbrand", path=p.replace("\\", "/"),
                         sr_src=info.samplerate, dur_s=info.frames / info.samplerate, speaker=f"hb{r.spk}",
                         sex=HILL_SEX[r.g], group=HILL_GROUP[r.g], vowel=r.vowel, vd_f0=r.f0))
    df = pd.DataFrame(rows).sort_values(["speaker", "vowel"]).reset_index(drop=True)
    df["order"] = df.groupby("speaker").cumcount()
    return df


# ----------------------------------------------------------------- PTDB-TUG / FDA
def ptdb():
    root = corpus_dir("ptdb-tug")
    rows = []
    for sexdir, sx in (("FEMALE", "f"), ("MALE", "m")):
        for f in sorted(glob.glob(os.path.join(root, sexdir, "MIC", "*", "*.wav"))):
            spk = os.path.basename(os.path.dirname(f))
            info = sf.info(f)
            rows.append(dict(item_id=f"pt-{os.path.basename(f)[:-4]}", corpus="ptdb", path=f.replace("\\", "/"),
                             sr_src=info.samplerate, dur_s=info.frames / info.samplerate, speaker=f"pt{spk}",
                             sex=sx, group={"m": "men", "f": "women"}[sx], vowel=""))
    df = pd.DataFrame(rows)
    df["order"] = df.groupby("speaker").cumcount()
    return df


def fda():
    root = corpus_dir("fda")
    rows = []
    for sub, sx in (("rl", "m"), ("sb", "f")):
        for f in sorted(glob.glob(os.path.join(root, sub, "*.sig"))):
            n = os.path.getsize(f) // 2
            rows.append(dict(item_id=f"fd-{os.path.basename(f)[:-4]}", corpus="fda", path=f.replace("\\", "/"),
                             sr_src=20000, dur_s=n / 20000, speaker=f"fd{sub}", sex=sx,
                             group={"m": "men", "f": "women"}[sx], vowel=""))
    df = pd.DataFrame(rows)
    df["order"] = df.groupby("speaker").cumcount()
    return df
