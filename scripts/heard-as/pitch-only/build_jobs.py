"""Build the session audio + jobs for the pitch-only warning study (public data only).

Sets (see PREREG.md):
  nat     LibriSpeech test-clean, 40 readers, natural, first >= 180 s of utterances in corpus order
  ptdb    PTDB-TUG mic, 4 speakers, all local sentences (natural)
  hcs     H&C 2009 sentence-proxy manipulation on LibriSpeech test-clean (40 readers):
          base = first >= 50 s natural utterances (7.2 kHz low-pass, 'NAT'), shift = next >= 40 s,
          WORLD (rlab WorldAnalysis, harvest) with US / PO / PE / EO (men up, women down; x1.7041 F0, x1.168 env)
  picka   PICKA grid on the 20 test-clean women: base = same natural first >= 50 s (no low-pass), shift = next
          >= 40 s through the Jebens/VTServer pyworld transform (rebuild.py transform) at cells
          (0,0) (-6,0) (-12,0) (-6,+1.8) (-12,+3.6) (0,+1.8) (0,+3.6)
  hcc     H&C syllable concatenations (existing audio, 20 men + 20 women, lowest ids with all conditions):
          base = US concat looped to >= 50 s (0.4 s gaps), shift = US / PO / PE concat looped to >= 40 s
  rb      RB695 TTS: Google lowered -> raised; Sophie +1 st -> -1 st (Study 2 x 2 scripts, Study 5 x 2 scripts)

  python build_jobs.py <set>[,<set>...]  -> audio/<set>/..., jobs_<set>.json
"""
import os, sys, json, math, glob, re
sys.dont_write_bytecode = True
import numpy as np, soundfile as sf
from scipy.signal import butter, sosfiltfilt

# Run in the output directory (audio/ and jobs_*.json are written there).
HERE = os.getcwd().replace("\\", "/")
REPO = os.path.abspath(os.path.join(os.path.dirname(os.path.abspath(__file__)), "../../..")).replace("\\", "/")
LS = os.environ.get("SYRINX_LIBRISPEECH")          # LibriSpeech root (SPEAKERS.TXT, test-clean/)
FE = os.path.join(os.environ.get("SYRINX_HEARD_AS_DATA", ""), "feminine-eval").replace("\\", "/")
if not LS:
    sys.exit("set SYRINX_LIBRISPEECH (and SYRINX_HEARD_AS_DATA for the hcc / picka / rb sets)")
sys.path.insert(0, f"{REPO}/scripts/resonance-lab")
SR = 16000
SOS = butter(8, 7200, btype="low", fs=SR, output="sos")


def speakers():
    sx = {}
    for line in open(f"{LS}/SPEAKERS.TXT", encoding="utf-8"):
        if line.startswith(";"):
            continue
        p = [s.strip() for s in line.split("|")]
        if len(p) >= 3 and p[2] == "test-clean":
            sx[p[0]] = p[1].lower()
    return dict(sorted(sx.items(), key=lambda kv: int(kv[0])))


def utts(spk):
    fs = glob.glob(f"{LS}/test-clean/{spk}/*/*.flac")
    return sorted(fs, key=lambda f: [int(v) for v in re.findall(r"\d+", os.path.basename(f))])


def split_dev_test():
    sx = speakers()
    out = {}
    for sex in ("f", "m"):
        ids = [s for s, g in sx.items() if g == sex]
        for i, s in enumerate(ids):
            out[s] = "dev" if i % 2 == 0 else "test"
    return out


def take(files, need_s, start=0):
    sel, tot, i = [], 0.0, start
    while i < len(files) and tot < need_s:
        sel.append(files[i]); tot += sf.info(files[i]).duration; i += 1
    return sel, i, tot


def wf32(y, path):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    np.asarray(y, np.float32).tofile(path)
    return dict(audio=path, sr=SR)


def rms(x):
    return float(np.sqrt(np.mean(np.asarray(x, np.float64) ** 2) + 1e-20))


SPLIT = split_dev_test()
SETS = sys.argv[1].split(",")

if "nat" in SETS:
    jobs = []
    for spk, sex in speakers().items():
        sel, _, tot = take(utts(spk), 180.0)
        files = []
        for f in sel:
            x, sr = sf.read(f, dtype="float32"); assert sr == SR
            files.append(wf32(x, f"{HERE}/audio/nat/{spk}/{os.path.basename(f)[:-5]}.f32"))
        jobs.append(dict(key=f"nat_{spk}", meta=dict(set="nat", spk=spk, sex=sex, split=SPLIT[spk]), phases=[dict(phase="base", files=files)]))
    json.dump(jobs, open(f"{HERE}/jobs_nat.json", "w"))
    print("nat", len(jobs))

if "ptdb" in SETS:
    jobs = []
    D = f"{REPO}/tests/dsp/data/ptdb-tug"
    for spk in ["F01", "F02", "M01", "M02"]:
        fs = sorted(glob.glob(f"{D}/**/mic_{spk}_*.wav", recursive=True))
        files = []
        for f in fs:
            x, sr = sf.read(f, dtype="float32")
            if x.ndim > 1:
                x = x.mean(1)
            if sr != SR:
                from scipy.signal import resample_poly
                g = math.gcd(sr, SR); x = resample_poly(x, SR // g, sr // g).astype(np.float32)
            files.append(wf32(x, f"{HERE}/audio/ptdb/{spk}/{os.path.basename(f)[:-4]}.f32"))
        jobs.append(dict(key=f"ptdb_{spk}", meta=dict(set="ptdb", spk=spk, sex=spk[0].lower(), split="test"), phases=[dict(phase="base", files=files)]))
    json.dump(jobs, open(f"{HERE}/jobs_ptdb.json", "w"))
    print("ptdb", len(jobs))


def base_and_shift(spk):
    u = utts(spk)
    base, i, _ = take(u, 50.0)
    shift, _, _ = take(u, 40.0, start=i)
    return base, shift


if "hcs" in SETS:
    from rlab.f0 import praat_track
    from rlab.manip import WorldAnalysis
    F0F, ENVF = 1.7041, 1.168

    class FastWorld(WorldAnalysis):
        # dio + stonemask instead of harvest (harvest ran ~4x slower than real time under load);
        # same envelope/aperiodicity warp and synthesis as rlab WorldAnalysis.
        def __init__(self, x, floor, ceil):
            import pyworld as pw
            self.pw = pw
            x = np.asarray(x, np.float64)
            self.n = len(x)
            f0, t = pw.dio(x, SR, f0_floor=max(40.0, floor), f0_ceil=min(ceil, 1000.0), frame_period=5.0)
            self.f0 = pw.stonemask(x, f0, t, SR); self.t = t
            self.sp = pw.cheaptrick(x, self.f0, self.t, SR)
            self.ap = pw.d4c(x, self.f0, self.t, SR)
            self.freqs = np.linspace(0, SR / 2, self.sp.shape[1])

    jobs = []
    for spk, sex in speakers().items():
        base, shift = base_and_shift(spk)
        bfiles = []
        for f in base:
            x, _ = sf.read(f, dtype="float64")
            bfiles.append(wf32(sosfiltfilt(SOS, x), f"{HERE}/audio/hcs/{spk}/NAT_{os.path.basename(f)[:-5]}.f32"))
        s = +1 if sex == "m" else -1
        st, fs_ = 12 * math.log2(F0F) * s, ENVF ** s
        conds = dict(US=dict(st=0.0, fs=1.0), PO=dict(st=st, fs=1.0), PE=dict(st=st, fs=fs_), EO=dict(st=0.0, fs=fs_))
        sfiles = {c: [] for c in conds}
        for f in shift:
            x, _ = sf.read(f, dtype="float64")
            tr = praat_track(x)
            v = tr.f0[tr.f0 > 0]
            if len(v) < 5:
                v = np.array([120.0, 220.0])
            floor = float(max(50.0, 0.7 * np.percentile(v, 10)))
            ceil = float(min(800.0, max(1.6 * np.percentile(v, 90), floor * 2.5)))
            w = FastWorld(x, floor, ceil)
            r0 = rms(x)
            outs = {}
            for c, cd in conds.items():
                y = w.variant(cd); r = rms(y)
                outs[c] = y * (r0 / r) if r > 0 else y
            pk = max(float(np.max(np.abs(y))) for y in outs.values())
            g = 1.0 if pk <= 0.99 else 0.99 / pk
            for c, y in outs.items():
                sfiles[c].append(wf32(sosfiltfilt(SOS, y * g), f"{HERE}/audio/hcs/{spk}/{c}_{os.path.basename(f)[:-5]}.f32"))
        for c in conds:
            p = ("M" if sex == "m" else "W") + c
            jobs.append(dict(key=f"hcs_{spk}_{c}", meta=dict(set="hcs", spk=spk, sex=sex, split=SPLIT[spk], cond=c, lcond=p),
                             phases=[dict(phase="base", files=bfiles), dict(phase="shift", files=sfiles[c])]))
        print("hcs", spk, flush=True)
    json.dump(jobs, open(f"{HERE}/jobs_hcs.json", "w"))
    print("hcs", len(jobs))

if "picka" in SETS:
    sys.path.insert(0, f"{FE}/picka")
    import importlib.util
    spec = importlib.util.spec_from_file_location("rebuild", f"{FE}/picka/rebuild.py")
    rb = importlib.util.module_from_spec(spec); spec.loader.exec_module(rb)
    CELLS = [(0, 0.0), (-6, 0.0), (-12, 0.0), (-6, 1.8), (-12, 3.6), (0, 1.8), (0, 3.6)]
    jobs = []
    for spk, sex in speakers().items():
        if sex != "f":
            continue
        base, shift = base_and_shift(spk)
        bfiles = []
        for f in base:
            x, _ = sf.read(f, dtype="float32")
            bfiles.append(wf32(x, f"{HERE}/audio/picka/{spk}/NAT_{os.path.basename(f)[:-5]}.f32"))
        sfiles = {c: [] for c in CELLS}
        for f in shift:
            x, _ = sf.read(f, dtype="float64")
            a = rb.analyse(x, SR)
            for c in CELLS:
                y = rb.transform(a, c[0], c[1])
                sfiles[c].append(wf32(y, f"{HERE}/audio/picka/{spk}/F{c[0]:+d}_V{c[1]:+.1f}_{os.path.basename(f)[:-5]}.f32"))
        for c in CELLS:
            jobs.append(dict(key=f"picka_{spk}_{c[0]:+d}_{c[1]:+.1f}", meta=dict(set="picka", spk=spk, sex=sex, split=SPLIT[spk], df0=c[0], dvtl=c[1]),
                             phases=[dict(phase="base", files=bfiles), dict(phase="shift", files=sfiles[c])]))
        print("picka", spk, flush=True)
    json.dump(jobs, open(f"{HERE}/jobs_picka.json", "w"))
    print("picka", len(jobs))

if "hcc" in SETS:
    A = f"{FE}/hillenbrand-clark-2009/audio/concat"
    jobs = []
    for sex, P in (("m", "M"), ("f", "W")):
        tks = sorted({re.match(r"hcc_(\w\d\d)_", os.path.basename(f)).group(1) for f in glob.glob(f"{A}/hcc_{sex if sex == 'm' else 'w'}*_*.f32")})
        tks = [t for t in tks if all(os.path.exists(f"{A}/hcc_{t}_{P}{c}.f32") for c in ("US", "PO", "PE"))][:20]
        for i, t in enumerate(tks):
            def loop(c, need):
                n = sf.info(f"{A}/hcc_{t}_{P}{c}.wav").duration if os.path.exists(f"{A}/hcc_{t}_{P}{c}.wav") else None
                d = (np.fromfile(f"{A}/hcc_{t}_{P}{c}.f32", np.float32).size / SR)
                k = int(math.ceil(need / (d + 0.4)))
                return [dict(audio=f"{A}/hcc_{t}_{P}{c}.f32", sr=SR)] * k
            for c in ("US", "PO", "PE"):
                jobs.append(dict(key=f"hcc_{t}_{c}", meta=dict(set="hcc", spk=t, sex=sex, split="dev" if i % 2 == 0 else "test", cond=c, lcond=P + c),
                                 phases=[dict(phase="base", files=loop("US", 50.0), gapS=0.4), dict(phase="shift", files=loop(c, 40.0), gapS=0.4)]))
    json.dump(jobs, open(f"{HERE}/jobs_hcc.json", "w"))
    print("hcc", len(jobs))

if "rb" in SETS:
    A = f"{FE}/natural/rb695_tts/f48"
    def loop(name, need):
        d = np.fromfile(f"{A}/{name}.f32", np.float32).size / 48000
        return [dict(audio=f"{A}/{name}.f32", sr=48000)] * int(math.ceil(need / (d + 0.5)))
    pairs = [("google", "rb_s4_google_lowered", "rb_s4_google_raised", "m"),
             ("s2_cleanmint", "rb_s2_cleanmint_fem", "rb_s2_cleanmint_amb", "f"),
             ("s2_mintyclean", "rb_s2_mintyclean_fem", "rb_s2_mintyclean_amb", "f"),
             ("s5_cleansoft", "rb_s5_cleansoft_fem", "rb_s5_cleansoft_amb", "f"),
             ("s5_softsoap", "rb_s5_softsoap_fem", "rb_s5_softsoap_amb", "f")]
    jobs = [dict(key=f"rb_{k}", meta=dict(set="rb", spk=k, sex=sex, split="test", base=b, shift=s),
                 phases=[dict(phase="base", files=loop(b, 50.0), gapS=0.5), dict(phase="shift", files=loop(s, 40.0), gapS=0.5)])
            for k, b, s, sex in pairs]
    json.dump(jobs, open(f"{HERE}/jobs_rb.json", "w"))
    print("rb", len(jobs))
