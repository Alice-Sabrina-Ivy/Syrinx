# sess3_val.py — custom voice detector, round 6 (pre-registration §2.2,
# §2.7): the round-3 voice-safety review's 10-minute one-room VocalSet
# sessions (20 singers x clean / +10 / 0 dB; the sessions of the round-5
# review's women's lip-trill finding) as VALIDATION rows (H7a). Ported
# UNCHANGED from the round-3 review's build_sess.py (sha256
# 436579bf5c65d0d38778c9d35f906ea7cf705d9227ff9e383a0eea142e3a08d2) except:
# its beds.py -> r5/vbeds.py bed3 (the same functions, ported unchanged in
# round 5), the input root OLD written out, the output folders
# (build/vad-train/r6/hval/probe/) and main() runs only as a script.
# Reads VocalSet / benchmark audio: run with `python -I`.
# NEVER used for training (r6/selftest_r6.py).
#   <venv python> -I scripts/voice-detector/r6/sess3_val.py
# ---------------------------------------------------------------- build_sess.py (round-3 review), below
import glob, json, os, sys
import numpy as np, soundfile as sf, parselmouth
from scipy.signal import butter, sosfilt, lfilter, resample_poly
from math import gcd
SC = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, SC)
sys.path.insert(0, os.path.join(SC, "..", "r5"))
from vbeds import bed3 as bed
OLD = "C:/Users/Michael/AppData/Local/Temp/claude/c--Coding-Projects-Syrinx/12a8f6ba-d49c-4c27-bd93-69314577b2c1/scratchpad/vad-train/review-voice"
VS = os.path.join(OLD, "dl", "vocalset", "FULL")
HV = os.path.abspath(os.path.join(SC, "..", "..", "..", "build", "vad-train", "r6", "hval", "probe"))
OUT = os.path.join(HV, "wav", "sess3"); os.makedirs(OUT, exist_ok=True)
REFD = os.path.join(HV, "ref", "sess3"); os.makedirs(REFD, exist_ok=True)
A = dict((a[2:].split("=", 1) + ["1"])[:2] for a in sys.argv[1:] if a.startswith("--"))
CONDS = A.get("conds", "clean,+10,0").split(",")
ORDER = ["scales/lip_trill", "long_tones/trill", "scales/breathy", "scales/straight", "scales/slow_piano", "scales/slow_forte",
         "scales/vibrato", "arpeggios/vibrato", "arpeggios/belt", "scales/vocal_fry", "excerpts/spoken"]
TUNE = os.path.join(OLD, "noise")      # selection-side (tuning-194) clips only; 864396 (held) is never used
BEDS = ["fan", "116866", "mains", "177703", "fridge", "351507", "hvac", "124015", "vmotor", "377637"]
SESS_LEN = 600.0


def peak_eq(x, sr, f0, gain_db, q):
    Ag = 10 ** (gain_db / 40); w = 2 * np.pi * f0 / sr; al = np.sin(w) / (2 * q)
    b = [1 + al * Ag, -2 * np.cos(w), 1 - al * Ag]; a = [1 + al / Ag, -2 * np.cos(w), 1 - al / Ag]
    return lfilter(np.array(b) / a[0], np.array(a) / a[0], x)


def phone_eq(x, sr):   # small phone / laptop mic: HP 250 Hz, presence +8 dB @ 3 kHz, LP 7 kHz
    y = sosfilt(butter(3, 250, "highpass", fs=sr, output="sos"), x)
    y = peak_eq(y, sr, 3000, 8, 1.2)
    return sosfilt(butter(6, min(7000, 0.45 * sr), "lowpass", fs=sr, output="sos"), y)


def rs(x, s0, s1):
    if s0 == s1:
        return x
    g = gcd(s0, s1)
    return resample_poly(x, s1 // g, s0 // g)


def load_bed(name, sr, n, seed):
    if name.isdigit():
        fp = os.path.join(TUNE, f"{name}_44100.wav")
        x = sf.read(fp, dtype="float64")[0]
        x = rs(x, 44100, sr)
        # loop with 1 s cross-fades
        cf = int(sr)
        out = x.copy()
        while len(out) < n:
            r = np.linspace(0, 1, cf)
            out = np.concatenate([out[:-cf], out[-cf:] * (1 - r) + x[:cf] * r, x[cf:]])
        y = out[:n]
        return y / np.sqrt(np.mean(y ** 2))
    return bed(name, sr, n / sr + 0.01, seed=seed)[:n].astype(np.float64)


def praat(x, sr):
    p = parselmouth.Sound(x, sampling_frequency=sr).to_pitch_ac(time_step=0.01, pitch_floor=60, pitch_ceiling=1100)
    f = np.nan_to_num(p.selected_array["frequency"])
    return float(p.xs()[0]), f


def main():
    singers = sorted(os.listdir(VS))
    specs = []
    for si, singer in enumerate(singers):
        g = "f" if singer.startswith("female") else "m"
        files = []
        for o in ORDER:
            fs_ = sorted(glob.glob(os.path.join(VS, singer, *o.split("/"), "*.wav")))
            if fs_:
                files.append((o, fs_[0]))
        sr = [44100, 48000, 16000][si % 3]
        eq = "phone" if si % 2 else "flat"
        clips = []
        for o, fp in files:
            x, s0 = sf.read(fp, dtype="float64", always_2d=True)
            x = x[:, 0]
            t0, f = praat(x, s0)
            clips.append(dict(tech=o, x=rs(x, s0, sr), t0=t0, f0=f))
        # session gain: median active rms of the singer's clips -> level draw
        rng = np.random.default_rng(1000 + si)
        lvl = -26 + rng.uniform(-6, 6)
        ar = np.median([np.sqrt(np.mean(c["x"][np.abs(c["x"]) > 0.02 * np.abs(c["x"]).max()] ** 2)) for c in clips])
        gain = 10 ** (lvl / 20) / ar
        # timeline
        P = [1, 3, 8, 20, 60]; PP = [.3, .3, .2, .15, .05]
        ep, t, k, long_done = [], 30.0, 0, False
        while True:
            c = clips[k % len(clips)]
            d = len(c["x"]) / sr
            if t + d > SESS_LEN - 1:
                break
            ep.append(dict(start=t, dur=d, tech=c["tech"], idx=k % len(clips), cyc=k // len(clips)))
            t += d
            pause = float(rng.choice(P, p=PP))
            if not long_done and t > SESS_LEN / 2:
                pause, long_done = 45.0, True
            if pause >= 40:
                long_done = True
            t += pause
            k += 1
        n = int(SESS_LEN * sr)
        voice = np.zeros(n)
        ref = np.zeros(int(SESS_LEN / 0.01) + 1, np.float32)
        for e in ep:
            c = clips[e["idx"]]
            a = int(round(e["start"] * sr))
            m = min(len(c["x"]), n - a)
            voice[a:a + m] += gain * c["x"][:m]
            # place the Praat track (frame i at c.t0 + i*0.01 of the clip)
            for i, fv in enumerate(c["f0"]):
                j = int(round((e["start"] + c["t0"] + i * 0.01) / 0.01))
                if 0 <= j < len(ref):
                    ref[j] = fv
        vact = voice[np.abs(voice) > 0.02 * np.abs(voice).max()]
        vr = np.sqrt(np.mean(vact ** 2))
        vfrac = sum(e["dur"] for e in ep) / SESS_LEN
        for cond in CONDS:
            rng2 = np.random.default_rng(2000 + si)
            if cond == "clean":
                y = voice + rng2.standard_normal(n) * 10 ** (-70 / 20)
                bname = None
            else:
                snr = float(cond)
                bname = BEDS[si % len(BEDS)] if cond == "+10" else BEDS[(si + 5) % len(BEDS)]
                if A.get("fixbed"):
                    bname = A["fixbed"]
                nz = load_bed(bname, sr, n, seed=300 + si)
                y = voice + nz * vr / 10 ** (snr / 20)
            if eq == "phone":
                y = phone_eq(y, sr)
            y = np.clip(y, -1, 1).astype(np.float32)
            sid = f"sess__{singer}__{cond.replace('+', 'p')}" + (f"__{A['fixbed']}" if A.get("fixbed") else "")
            wp = os.path.join(OUT, sid + ".wav")
            sf.write(wp, y, sr, subtype="FLOAT")
            rp = os.path.join(REFD, sid + ".json")
            json.dump({"t0": 0.0, "hop": 0.01, "f0": [round(float(v), 2) for v in ref]}, open(rp, "w"))
            specs.append(dict(id=sid, wav=wp.replace("\\", "/"), refPath=rp.replace("\\", "/"), gender=g, group=f"sess:{cond}" + (f":{A['fixbed']}" if A.get("fixbed") else ""),
                              meta=dict(singer=singer, cond=cond, bed=bname, sr=sr, eq=eq, level_db=lvl, vfrac=vfrac, episodes=ep)))
        print(singer, sr, eq, f"lvl {lvl:.1f}", f"voice {vfrac:.2f}", len(ep), "episodes", flush=True)
    json.dump(specs, open(os.path.join(HV, A.get("out", "probes-sess3.json")), "w"))
    print(len(specs), "sessions")


if __name__ == "__main__":
    main()
