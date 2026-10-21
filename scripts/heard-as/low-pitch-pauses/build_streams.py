"""build_streams.py -- streams of measurements/heard-as-low-pitch-and-pauses-2026-10-21.md.

  python build_streams.py --libri=<LibriSpeech root> --corpora=<tests/dsp/data> --out=<dir> [--shard=i/n] [--speech-s=36]

Public data only: LibriSpeech dev-clean + test-clean (CC BY 4.0), PTDB-TUG,
FDA, Hillenbrand et al. (1995). Writes <out>/f32/<id>.f32 (float32 mono,
16 kHz unless the job says 48000), <out>/ref/<id>.f32 (reference F0 at a
5 ms hop, 0 = unvoiced; WORLD harvest for LibriSpeech / shifted
LibriSpeech, the laryngograph track for PTDB / FDA, none for Hillenbrand) and
<out>/jobs.<shard>.json.

LibriSpeech, per reader (split: test-clean = dev, dev-clean = held-out):
  speech  the reader's utterances in order, each trimmed to its speech
          (20 ms frames within 40 dB of the utterance's loudest, 50 ms
          margins), joined back to back up to --speech-s seconds; 1 s lead-in.
  cuts    every U(2, 4) s (seeded per reader) at the quietest 20 ms frame
          within +-0.4 s of the target: where a breath pause goes.
  pause   p0 (none: continuous), p0.3, p0.6, p1.0, p1.5, p2.5 s at every cut,
          pnat (U(0.3, 1.0) s per cut, seeded): low noise (-65 dBFS RMS).
  voices  nat (as recorded), and WORLD (pyworld harvest on the 8 kHz-decimated
          signal -- men 60-300 Hz, women 100-500 Hz --, cheaptrick,
          d4c; formants = the spectral envelope kept, F0 x factor) resynthesis
          with the median voiced F0 moved to 75 Hz (w75: the 70-80 Hz band),
          90 Hz (w90: 85-95 Hz), 185 Hz (w185: 150-220 Hz, the feminine-voice
          stand-in) and left where it is (w1: the vocoder control).
          nat: every pause condition; w75 / w90 / w185: p0 + pnat; w1: pnat.
Natural low / other public speech (pnat pauses between sentences / words):
  ptdb   PTDB-TUG M01, M02, F01, F02 sentences (48 kHz), up to 60 s each
  fda    FDA rl (man), sb (woman) sentences (20 kHz -> 48 kHz), up to 60 s each
  hil    Hillenbrand men / women /hVd/ words, each talker's 12 words twice
         with 0.25 s gaps (16 kHz)
"""
import argparse, json, os, glob
import numpy as np
import soundfile as sf
import warnings
warnings.filterwarnings("ignore")
import pyworld as pw
from scipy.signal import resample_poly

ap = argparse.ArgumentParser()
ap.add_argument("--libri", required=True)
ap.add_argument("--corpora", required=True)
ap.add_argument("--out", required=True)
ap.add_argument("--shard", default="0/1")
ap.add_argument("--speech-s", type=float, default=36.0)
# a subset of the LibriSpeech conditions, e.g. "nat:p0,pnat;w75:p0,pnat;w90:pnat;w185:pnat"
# (voices left out are not resynthesised); default: every condition below
ap.add_argument("--conds", default="")
a = ap.parse_args()
shI, shN = map(int, a.shard.split("/"))
SR = 16000
HOP = 0.005
NOISE_RMS = 10 ** (-65 / 20)
for d in ("f32", "ref"):
    os.makedirs(os.path.join(a.out, d), exist_ok=True)
jobs = []


def wr(kind, name, x):
    p = os.path.join(a.out, kind, name + ".f32")
    np.asarray(x, dtype="<f4").tofile(p)
    return p


def frames_db(x, sr, ms=20):
    n = int(sr * ms / 1000)
    m = len(x) // n
    e = (x[: m * n].reshape(m, n) ** 2).mean(1) + 1e-12
    return 10 * np.log10(e), n


def trim(x, sr):
    db, n = frames_db(x, sr)
    on = np.where(db >= db.max() - 40)[0]
    if not len(on):
        return x[:0]
    s = max(0, on[0] * n - int(0.05 * sr))
    e = min(len(x), (on[-1] + 1) * n + int(0.05 * sr))
    return x[s:e]


def noise(n, rng):
    return (rng.standard_normal(n) * NOISE_RMS).astype(np.float32)


def cut_points(x, sr, rng):
    db, n = frames_db(x, sr)
    cuts, t = [], 0.0
    dur = len(x) / sr
    while True:
        t += rng.uniform(2.0, 4.0)
        if t > dur - 1.0:
            break
        lo, hi = int((t - 0.4) * sr / n), int((t + 0.4) * sr / n)
        k = lo + int(np.argmin(db[lo:hi]))
        c = k * n + n // 2
        cuts.append(c)
        t = c / sr
    return cuts


def with_pauses(x, ref, cuts, pauses, sr, rng, lead=1.0):
    """x at sr, ref at 5 ms hop (aligned to x) -> (stream, ref stream, speech spans [ms])"""
    parts, rparts, spans = [noise(int(lead * sr), rng)], [np.zeros(int(round(lead / HOP)), np.float32)], []
    pos, t = 0, lead
    for c, p in list(zip(cuts, pauses)) + [(len(x), 0.0)]:
        seg = x[pos:c]
        parts.append(seg)
        r0, r1 = int(round(pos / sr / HOP)), int(round(c / sr / HOP))
        rparts.append(ref[r0:r1] if ref is not None else np.zeros(r1 - r0, np.float32))
        spans.append([round(t * 1000, 1), round((t + len(seg) / sr) * 1000, 1)])
        t += len(seg) / sr
        if p > 0:
            parts.append(noise(int(p * sr), rng))
            rparts.append(np.zeros(int(round(p / HOP)), np.float32))
            t += int(p * sr) / sr
        pos = c
    parts.append(noise(int(0.5 * sr), rng))
    return np.concatenate(parts), np.concatenate(rparts), spans


def world(x, sr, sex):
    # F0: harvest on the 8 kHz-decimated signal (dio locked onto low hum / octave-down on some
    # readers), per-sex search range; the envelope and aperiodicity at the full 16 kHz.
    lo, hi = (60.0, 300.0) if sex == "m" else (100.0, 500.0)
    xd = x.astype(np.float64)
    f0, t = pw.harvest(resample_poly(xd, 1, 2), sr // 2, f0_floor=lo, f0_ceil=hi, frame_period=HOP * 1000)
    sp = pw.cheaptrick(xd, f0, t, sr)
    apr = pw.d4c(xd, f0, t, sr)
    return f0, sp, apr


def synth(f0, sp, apr, sr, factor, n):
    y = pw.synthesize(np.ascontiguousarray(f0 * factor), sp, apr, sr, HOP * 1000)
    y = y[:n] if len(y) >= n else np.pad(y, (0, n - len(y)))
    return y.astype(np.float32)


def fit_ref(f0, n_samples, sr):
    m = int(round(n_samples / sr / HOP))
    f = np.zeros(m, np.float32)
    k = min(m, len(f0))
    f[:k] = f0[:k]
    return f


def add_job(**kw):
    jobs.append(kw)
    json.dump(jobs, open(os.path.join(a.out, f"jobs.{shI}.json"), "w"))


# ---------------- LibriSpeech readers ----------------
spk_sex = {}
for line in open(os.path.join(a.libri, "SPEAKERS.TXT"), encoding="utf8"):
    if line.startswith(";"):
        continue
    p = [s.strip() for s in line.split("|")]
    if len(p) >= 3 and p[2] in ("dev-clean", "test-clean"):
        spk_sex[(p[2], p[0])] = p[1].lower()
readers = sorted(spk_sex)
PAUSES = {"p0": 0.0, "p0.3": 0.3, "p0.6": 0.6, "p1.0": 1.0, "p1.5": 1.5, "p2.5": 2.5}
k = 0
for (subset, spk) in readers:
    k += 1
    if (k - 1) % shN != shI:
        continue
    sex = spk_sex[(subset, spk)]
    split = "dev" if subset == "test-clean" else "test"
    files = sorted(glob.glob(os.path.join(a.libri, subset, spk, "*", "*.flac")))
    parts, tot = [], 0
    for f in files:
        x, sr = sf.read(f, dtype="float32")
        x = trim(x, sr)
        parts.append(x)
        tot += len(x)
        if tot >= a.speech_s * SR:
            break
    x = np.concatenate(parts)[: int(a.speech_s * SR)]
    rng = np.random.default_rng(int(spk) * 7 + (1 if subset == "dev-clean" else 2))
    cuts = cut_points(x, SR, rng)
    nat_p = [float(v) for v in rng.uniform(0.3, 1.0, len(cuts))]
    f0, sp, apr = world(x, SR, sex)
    med = float(np.median(f0[f0 > 0]))
    ref_nat = fit_ref(f0, len(x), SR)
    voices = {"nat": (x, ref_nat, 1.0)}
    conds = {"nat": list(PAUSES) + ["pnat"], "w75": ["p0", "pnat"], "w90": ["p0", "pnat"], "w185": ["p0", "pnat"], "w1": ["pnat"]}
    if a.conds:
        conds = {v: c.split(",") for v, c in (kv.split(":") for kv in a.conds.split(";"))}
    for name, target in (("w75", 75.0), ("w90", 90.0), ("w185", 185.0), ("w1", None)):
        if name not in conds:
            continue
        fac = 1.0 if target is None else target / med
        y = synth(f0, sp, apr, SR, fac, len(x))
        y *= np.sqrt((x ** 2).mean() / max((y ** 2).mean(), 1e-12))
        voices[name] = (y, fit_ref(f0 * fac, len(x), SR), fac)
    for vname, clist in conds.items():
        y, ref, fac = voices[vname]
        for c in clist:
            ps = nat_p if c == "pnat" else [PAUSES[c]] * len(cuts)
            prng = np.random.default_rng(int(spk) * 13 + 5)
            s, r, spans = with_pauses(y, ref, cuts, ps, SR, prng)
            sid = f"ls-{subset[:-6]}-{spk}-{vname}-{c}"
            add_job(id=sid, family="libri", set="libri", subset=subset, split=split, speaker=spk, sex=sex,
                    voice=vname, pause=c, factor=fac, srcMedianF0=med, sr=SR,
                    f32=wr("f32", sid, s), ref=wr("ref", sid, r), refHopMs=5, speechSpans=spans,
                    pauses=ps, leadMs=1000)
    print(f"{subset} {spk} {sex} med {med:.0f} Hz cuts {len(cuts)}", flush=True)

# ---------------- natural low / other public speech (shard 0 only) ----------------
if shI == 0:
    C = a.corpora

    def ptdb_ref(path):
        v = []
        for line in open(path):
            p = line.split()
            if len(p) >= 2:
                v.append(float(p[0]) if p[1] in ("1", "1.0") else 0.0)
        return np.array(v, np.float32)  # 10 ms hop

    def fda_ref(path, n_ms):
        buf = open(path, "rb").read()
        data = buf[buf.index(b"\x0c") + 1:].decode("utf8", "ignore")
        r = np.zeros(int(n_ms / 5) + 1, np.float32)
        for line in data.split("\n"):
            p = line.split()
            if len(p) == 2:
                try:
                    tms, f = float(p[0]), float(p[1])
                except ValueError:
                    continue
                i = int(round(tms / 5))
                if 0 <= i < len(r) and f > 0:
                    r[i] = f
        return r

    def assemble(items, sr, sid, sex, set_, extra):
        """items: [(x at sr, ref at 5 ms aligned to x)] -> one stream with pnat pauses between items"""
        rng = np.random.default_rng(sum(map(ord, sid)))
        parts, rparts, spans, t = [noise(sr, rng)], [np.zeros(200, np.float32)], [], 1.0
        pauses = []
        for i, (x, r) in enumerate(items):
            parts.append(x)
            m = int(round(len(x) / sr / HOP))
            rr = np.zeros(m, np.float32)
            rr[: min(m, len(r))] = r[:m]
            rparts.append(rr)
            spans.append([round(t * 1000, 1), round((t + len(x) / sr) * 1000, 1)])
            t += len(x) / sr
            p = extra.get("gap") if extra.get("gap") is not None else float(rng.uniform(0.3, 1.0))
            pauses.append(p)
            parts.append(noise(int(p * sr), rng))
            rparts.append(np.zeros(int(round(p / HOP)), np.float32))
            t += int(p * sr) / sr
        s = np.concatenate(parts)
        r = np.concatenate(rparts)
        add_job(id=sid, family="natlow", set=set_, split="test", speaker=sid, sex=sex, voice="nat", pause="pnat",
                factor=1.0, sr=sr, f32=wr("f32", sid, s), ref=wr("ref", sid, r) if extra.get("hasref", True) else None,
                refHopMs=5, speechSpans=spans, pauses=pauses, leadMs=1000)

    for g, sex in (("MALE", "m"), ("FEMALE", "f")):
        for spk in sorted(os.listdir(os.path.join(C, "ptdb-tug", g, "MIC"))):
            items, tot = [], 0
            for w in sorted(glob.glob(os.path.join(C, "ptdb-tug", g, "MIC", spk, "*.wav"))):
                rp = os.path.join(C, "ptdb-tug", g, "REF", spk, os.path.basename(w).replace("mic_", "ref_").replace(".wav", ".f0"))
                if not os.path.exists(rp):
                    continue
                x, sr = sf.read(w, dtype="float32")
                if sr != 48000:
                    continue
                r10 = ptdb_ref(rp)
                r5 = np.repeat(r10, 2)  # 10 ms -> 5 ms hop (window-level bins only; the ~20 ms PTDB offset is immaterial here)
                db, n = frames_db(x, sr)
                on = np.where(db >= db.max() - 40)[0]
                s0 = max(0, on[0] * n - int(0.05 * sr)); s1 = min(len(x), (on[-1] + 1) * n + int(0.05 * sr))
                items.append((x[s0:s1], r5[int(s0 / sr / HOP):]))
                tot += s1 - s0
                if tot >= 60 * sr:
                    break
            assemble(items, 48000, f"ptdb-{spk}", sex, "ptdb", {})
            print("ptdb", spk, flush=True)
    for sub, sex in (("rl", "m"), ("sb", "f")):
        items, tot = [], 0
        for sig in sorted(glob.glob(os.path.join(C, "fda", sub, "*.sig"))):
            raw = np.fromfile(sig, dtype=">i2").astype(np.float32) / 32768
            fx = sig[:-4] + ".fx"
            if not os.path.exists(fx):
                continue
            r = fda_ref(fx, len(raw) / 20)
            x = resample_poly(raw, 12, 5).astype(np.float32)
            db, n = frames_db(x, 48000)
            on = np.where(db >= db.max() - 40)[0]
            s0 = max(0, on[0] * n - int(0.05 * 48000)); s1 = min(len(x), (on[-1] + 1) * n + int(0.05 * 48000))
            items.append((x[s0:s1], r[int(s0 / 48000 / HOP):]))
            tot += s1 - s0
            if tot >= 60 * 48000:
                break
        assemble(items, 48000, f"fda-{sub}", sex, "fda", {})
        print("fda", sub, flush=True)
    for g, sex in (("men", "m"), ("women", "f")):
        talkers = sorted({os.path.basename(p)[:3] for p in glob.glob(os.path.join(C, g, "*.wav"))})
        for tk in talkers:
            words = sorted(glob.glob(os.path.join(C, g, tk + "*.wav")))
            items = []
            for rep in range(2):
                for w in words:
                    x, sr = sf.read(w, dtype="float32")
                    items.append((trim(x, sr), np.zeros(0, np.float32)))
            assemble(items, 16000, f"hil-{tk}", sex, "hil", {"gap": 0.25, "hasref": False})
        print("hil", g, flush=True)

json.dump(jobs, open(os.path.join(a.out, f"jobs.{shI}.json"), "w"))
print(f"{len(jobs)} jobs -> {a.out}")
