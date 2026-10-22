"""build_guards.py -- the guard streams of bar (iv) in
measurements/heard-as-low-pitch-and-pauses-2026-10-21.md §6.3: streams where
the panel must show no reading (every sample hidden, as shipped).

  python build_guards.py --out=<dir> --smoke=<build/cue-strip-smoke> --streams=<build_streams.py out>
         --whisper=<dir[;dir...]: Expresso exNN_{default,whisper}_*.wav, EARS task1_/task2_ *.wav, ears_speakers.json>

Writes <out>/jobs.json for run.mjs (family "guard"):
  synth     held vowel, pink noise, digital silence: the 48 kHz WAVs of
            scripts/cue-strip-smoke-wavs.mjs
  fill60    60 s of the pause fill alone (noise at -65 dBFS RMS)
  pink60    60 s of pink noise at speech level (-22.3 dBFS RMS, the probe sets'
            reference speech level)
  held      synthetic held vowel /a/ at 110 / 220 / 330 Hz (5 s, +-0.3 st vibrato at
            5.5 Hz) alone (1 s lead) and right after 10 s of reading (1 s lead,
            10 s of a reader's continuous stream, 0.3 s of pause fill, the note;
            8 readers: 2 W + 2 M dev, 2 W + 2 M held-out), at the reading's level;
            `held` = [startMs, endMs]
  whisonly  every real-whisper recording of the 2026-10-08 probe set alone (EARS
            12 W / 6 M read passage, Expresso ex01-ex04 ~12 s streams; rebuilt
            from the public mirror Malfaro43/whisperedAudio-benchmark, CC BY-NC 4.0)
  whis      speech + whisper per talker as scripts/heard-as/voiced-windows/build_streams.py:
            6 s pieces of the talker's regular reading alternating with 3 s pieces of
            the same talker's whisper (natural relative level), starting and ending
            with regular; `whisper` = [[startMs, endMs], ...]
Public or synthetic audio only.
"""
import argparse, glob, json, os, sys
import numpy as np
import soundfile as sf
from math import gcd
from scipy.signal import resample_poly

ap = argparse.ArgumentParser()
for k in ["out", "smoke", "streams", "whisper"]:
    ap.add_argument(f"--{k}", required=True)
a = ap.parse_args()
SR = 16000
os.makedirs(os.path.join(a.out, "f32"), exist_ok=True)
rng = np.random.default_rng(20261021)
NOISE_RMS = 10 ** (-65 / 20)
LEV_REF = 0.07652792894413829   # -22.3 dBFS: the probe sets' reference speech level (2026-10-07)
PHONATED = {"p027", "p033", "p062", "p064", "p104"}   # EARS "whisper" recordings with phonation (whisper-voicing-2026-10-07.md)
jobs = []


def wr(name, x):
    p = os.path.join(a.out, "f32", name + ".f32")
    np.asarray(x, dtype="<f4").tofile(p)
    return p


def rms(x):
    x = np.asarray(x, np.float64)
    return float(np.sqrt(np.mean(x * x) + 1e-20))


def to16k(x, sr):
    if sr == SR:
        return np.asarray(x, np.float32)
    g = gcd(int(sr), SR)
    return resample_poly(np.asarray(x, np.float64), SR // g, int(sr) // g).astype(np.float32)


def read(path):
    x, sr = sf.read(path, dtype="float32", always_2d=False)
    if x.ndim > 1:
        x = x.mean(axis=1)
    return x, sr


def fill(n):
    return (rng.standard_normal(n) * NOISE_RMS).astype(np.float32)


def job(**kw):
    base = dict(family="guard", split="guard", speaker=None, sex=None, voice="guard", pause=None, leadMs=1000, speechSpans=[])
    base.update(kw)
    jobs.append(base)


# --- synth (48 kHz) --------------------------------------------------------
for name in ("held", "noise", "silence"):
    x, sr = read(os.path.join(a.smoke, name + ".wav"))
    assert sr == 48000, (name, sr)
    job(id=f"synth.{name}", set="synth", f32=wr(f"synth.{name}", x), sr=48000)

# --- fill60 / pink60 -------------------------------------------------------
job(id="fill60", set="fill60", f32=wr("fill60", fill(60 * SR)), sr=SR)
w = rng.standard_normal(60 * SR + 4096)
P = np.fft.rfft(w)
f = np.fft.rfftfreq(len(w), 1 / SR)
P[1:] /= np.sqrt(f[1:])
P[0] = 0
pink = np.fft.irfft(P, len(w))[:60 * SR]
pink *= LEV_REF / rms(pink)
job(id="pink60", set="pink60", f32=wr("pink60", pink), sr=SR)


# --- held notes ------------------------------------------------------------
def vowel(f0, dur, sr=SR):
    n = int(dur * sr)
    t = np.arange(n) / sr
    f = f0 * 2 ** ((0.3 / 12) * np.sin(2 * np.pi * 5.5 * t))
    ph = np.cumsum(f / sr) % 1.0
    src = np.where(ph < 0.6, np.sin(np.pi * ph / 0.6) ** 2, 0.0) - 0.3
    env = np.minimum(1, np.minimum(t / 0.03, (dur - t) / 0.03))
    y = src * env
    from scipy.signal import lfilter
    for fc, bw in ((730, 90), (1090, 110), (2440, 160)):
        r = np.exp(-np.pi * bw / sr)
        th = 2 * np.pi * fc / sr
        y = lfilter([1.0], [1.0, -2 * r * np.cos(th), r * r], y)
    return y.astype(np.float32)


lj = []
for p in sorted(glob.glob(os.path.join(a.streams, "jobs.*.json"))):
    lj += json.load(open(p))
readers = []
for split in ("dev", "test"):
    for sex in ("f", "m"):
        c = sorted([j for j in lj if j["family"] == "libri" and j["voice"] == "nat" and j["pause"] == "p0" and j["split"] == split and j["sex"] == sex], key=lambda j: j["speaker"])
        readers += c[:2]
for f0 in (110, 220, 330):
    v = vowel(f0, 5.0)
    v1 = v * (LEV_REF / rms(v))
    x = np.concatenate([fill(SR), v1, fill(SR)])
    job(id=f"held.alone.{f0}", set="held", f32=wr(f"held.alone.{f0}", x), sr=SR, held=[1000, 6000], heldF0=f0, speechSpans=[[1000, 6000]])
    for r in readers:
        y = np.fromfile(r["f32"], dtype="<f4")
        lead = int(r.get("leadMs", 1000) * SR / 1000)
        read10 = y[lead:lead + 10 * SR]
        lev = rms(read10[np.abs(read10) > 10 ** (-40 / 20)]) if (np.abs(read10) > 10 ** (-40 / 20)).any() else rms(read10)
        vv = v * (lev / rms(v))
        x = np.concatenate([fill(SR), read10, fill(int(0.3 * SR)), vv, fill(2 * SR)])
        h0 = 1000 + 10000 + 300
        job(id=f"held.after.{r['speaker']}.{f0}", set="heldafter", f32=wr(f"held.after.{r['speaker']}.{f0}", x), sr=SR,
            speaker=r["speaker"], sex=r["sex"], readerSplit=r["split"], held=[h0, h0 + 5000], heldF0=f0, speechSpans=[[1000, 11000], [h0, h0 + 5000]])


# --- whisper (the 2026-10-08 probe set pwhis, rebuilt) -----------------------
def activity(x, hop=400, rel_db=-35, hang=0.3):
    k = len(x) // hop
    r = np.array([rms(x[i * hop:(i + 1) * hop]) for i in range(k)])
    ref = np.percentile(r, 95)
    on = 20 * np.log10(r + 1e-12) > 20 * np.log10(ref + 1e-12) + rel_db
    segs, s = [], None
    for i, o in enumerate(on):
        if o and s is None:
            s = i
        if not o and s is not None:
            segs.append([s * hop / SR, i * hop / SR + hang]); s = None
    if s is not None:
        segs.append([s * hop / SR, k * hop / SR + hang])
    return segs


WD = a.whisper.split(";")
globw = lambda pat: sorted(f for d in WD for f in glob.glob(os.path.join(d, pat)))
def pathw(name):
    for d in WD:
        if os.path.exists(os.path.join(d, name)):
            return os.path.join(d, name)
    return None
spk = json.load(open(pathw("ears_speakers.json")))
streams = []
for fp in globw("task1_facebookresearch_ears_dataset_p*_regular.wav"):
    p = os.path.basename(fp).split("_")[4]
    g = spk[p]["gender"]
    if g not in ("female", "male"):
        continue
    fw = os.path.join(os.path.dirname(fp), os.path.basename(fp).replace("task1_", "task2_").replace("regular", "whisper"))
    streams.append((p, g[0], "ears", {"regular": [fp], "whisper": [fw]}))
EX_SEX = {"ex01": "m", "ex02": "f", "ex03": "m", "ex04": "f"}   # probe set: median F0 of the regular recordings
for ex in ("ex01", "ex02", "ex03", "ex04"):
    ids = sorted(os.path.basename(f).split("_")[2].split(".")[0] for f in globw(f"{ex}_whisper_*.wav"))
    ids = [i for i in ids if pathw(f"{ex}_default_{i}.wav")]
    grp, cur, dur = [], [], 0.0
    for i in ids:
        d = sf.info(pathw(f"{ex}_whisper_{i}.wav")).duration
        cur.append(i); dur += d
        if dur >= 10:
            grp.append(cur); cur, dur = [], 0.0
    for g in grp:
        streams.append((ex, EX_SEX[ex], "expresso", {"regular": [pathw(f"{ex}_default_{i}.wav") for i in g],
                                                     "whisper": [pathw(f"{ex}_whisper_{i}.wav") for i in g]}))
LEAD, TAIL = 2.0, 1.0
probe = {}   # (corpus, speaker, sex) -> {style: [(x, act)]}
for si, (sp, sex, corp, styles) in enumerate(streams):
    lev_reg = None
    for style in ("regular", "whisper"):
        parts = []
        for fp in styles[style]:
            x, sr = read(fp)
            parts += [to16k(x, sr).astype(np.float64), np.zeros(int(0.4 * SR))]
        x = np.concatenate(parts)
        act = activity(x)
        on = np.zeros(len(x), bool)
        for s0, s1 in act:
            on[int(s0 * SR):int(min(len(x), (s1 - 0.3) * SR))] = True
        lev = rms(x[on])
        if style == "regular":
            g = LEV_REF / lev; lev_reg = lev
        else:
            g = LEV_REF / lev_reg
        xs = np.concatenate([np.zeros(int(LEAD * SR)), x * g, np.zeros(int(TAIL * SR))])
        xs = xs + rng.standard_normal(len(xs)) * 10 ** (-70 / 20)
        probe.setdefault((corp, sp, sex), {}).setdefault(style, []).append((xs.astype(np.float32), [[s0 + LEAD, s1 + LEAD] for s0, s1 in act]))
        if style == "whisper":
            iid = f"whisonly.{corp}.{sp}.{si:03d}"
            spans = [[1000 * (s0 + LEAD), 1000 * (s1 + LEAD)] for s0, s1 in act]
            job(id=iid, set="whisonly", f32=wr(iid, xs), sr=SR, speaker=sp, sex=sex, corpus=corp, phonated=sp in PHONATED,
                leadMs=int(LEAD * 1000), speechSpans=spans, whisper=spans)

gap = np.zeros(int(0.3 * SR), dtype=np.float32)
for (corp, sp, sex), st in sorted(probe.items()):
    def joined(style):
        parts = []
        for x, act in st[style]:
            t0 = min(s for s, e in act); t1 = max(e for s, e in act)
            parts += [x[int(t0 * SR):int(t1 * SR)], gap]
        return np.concatenate(parts[:-1])
    reg, whi = joined("regular"), joined("whisper")
    R, Wn = 6 * SR, 3 * SR
    out, spans, i, j, t = [], [], 0, 0, 0
    while i < len(reg):
        piece = reg[i:i + R]; i += R
        if len(reg) - i < 2 * SR:
            piece = np.concatenate([piece, reg[i:]]); i = len(reg)
        out.append(piece); t += len(piece)
        if i >= len(reg):
            break
        if j + Wn > len(whi):
            j = 0
        wp = whi[j:j + Wn]; j += Wn
        spans.append([1000 * t / SR, 1000 * (t + len(wp)) / SR])
        out.append(wp); t += len(wp)
    x = np.concatenate(out)
    job(id=f"whis.{sp}", set="whis", f32=wr(f"whis.{sp}", x), sr=SR, speaker=sp, sex=sex, corpus=corp, phonated=sp in PHONATED,
        leadMs=0, speechSpans=[[0, 1000 * len(x) / SR]], whisper=spans)

json.dump(jobs, open(os.path.join(a.out, "jobs.json"), "w"))
from collections import Counter
print(len(jobs), "jobs", Counter(j["set"] for j in jobs), f"{sum(os.path.getsize(j['f32']) / 4 / (j['sr']) for j in jobs) / 60:.1f} min")
