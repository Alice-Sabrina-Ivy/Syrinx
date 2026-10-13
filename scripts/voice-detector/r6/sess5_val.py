# sess5_val.py — custom voice detector, round 6 (pre-registration
# measurements/voice-detector-round6-preregistration-2026-10-13.md §2.2,
# §2.7): the round-5 voice-safety review's FRESH 10-minute one-room VocalSet
# sessions (`sess5`, 20 singers x clean / +10 / 0 dB) as VALIDATION rows
# (H7a: their lip-trill takes gate; other takes are reported only; the old
# harness's long tones are masked). Ported UNCHANGED from the review's
# build_sess5.py (sha256 bb275be20379bc3b4bd664c61b1c2bec73338dec6105e9717c465ce11aad0a90)
# except: mach5 -> mach5_val, the screen5_eq.py module -> micsim_val (same
# functions), the output folders (build/vad-train/r6/hval/probe/), and main()
# runs only as a script. Reads VocalSet and Freesound audio: run with `python -I`.
# NEVER used for training (r6/selftest_r6.py).
#   <venv python> -I scripts/voice-detector/r6/sess5_val.py
# ---------------------------------------------------------------- build_sess5.py (round-5 review), below
import glob, json, os, sys
import numpy as np, soundfile as sf, parselmouth
from scipy.signal import resample_poly
from math import gcd
SC = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, SC)
from mach5_val import bed
VS = "C:/Coding Projects/Syrinx-vad/build/vad-train/r4/dl/vocalset/audio/FULL"
HV = os.path.abspath(os.path.join(SC, "..", "..", "..", "build", "vad-train", "r6", "hval", "probe"))
OUT = os.path.join(HV, "wav", "sess5"); os.makedirs(OUT, exist_ok=True)
REFD = os.path.join(HV, "ref", "sess5"); os.makedirs(REFD, exist_ok=True)
SR = 48000
SESS_LEN = 600.0
BEDS = ["twofan", "144046", "aqpump", "530917", "microwave", "848181", "washer", "785127", "ballast", "830089", "caridle", "201788"]
ORDER = [("scales/lip_trill", False), ("arpeggios/lip_trill", False), ("scales/straight", False), ("arpeggios/straight", False),
         ("long_tones/straight", True), ("excerpts/straight", False)]


def praat(x, sr):
    p = parselmouth.Sound(x, sampling_frequency=sr).to_pitch_ac(time_step=0.01, pitch_floor=60, pitch_ceiling=1100)
    return float(p.xs()[0]), np.nan_to_num(p.selected_array["frequency"])


def rs(x, s0, s1):
    if s0 == s1:
        return x
    g = gcd(s0, s1)
    return resample_poly(x, s1 // g, s0 // g)


def main():
    import micsim_val as eqm   # = the review's screen5_eq.py (phone_eq; phone2 with the AGC on)
    singers = sorted(os.listdir(VS))
    specs = []
    for si, singer in enumerate(singers):
        g = "f" if singer.startswith("female") else "m"
        blocks = []   # a block = list of takes played with 2 s gaps (long tones) or one take
        for o, chained in ORDER:
            fs_ = sorted(glob.glob(os.path.join(VS, singer, *o.split("/"), "*.wav")))
            takes = []
            for fp in fs_:
                x, s0 = sf.read(fp, dtype="float64", always_2d=True)
                x = rs(x[:, 0], s0, SR)
                t0, f = praat(x, SR)
                takes.append(dict(tech=o, x=x, t0=t0, f0=f, file=os.path.basename(fp)))
            if chained:
                blocks.append(takes)
            else:
                blocks += [[t] for t in takes]
        rng = np.random.default_rng(5000 + si)
        lvl = -26 + rng.uniform(-6, 6)
        allx = [t["x"] for b in blocks for t in b]
        ar = np.median([np.sqrt(np.mean(x[np.abs(x) > 0.02 * np.abs(x).max()] ** 2)) for x in allx])
        gain = 10 ** (lvl / 20) / ar
        P = [1, 3, 8, 20, 60]; PP = [.3, .3, .2, .15, .05]
        ep, t, k, long_done = [], 30.0, 0, False
        while True:
            b = blocks[k % len(blocks)]
            d = sum(len(tk["x"]) / SR for tk in b) + 2.0 * (len(b) - 1)
            if t + d > SESS_LEN - 1:
                break
            tt = t
            for j, tk in enumerate(b):
                dd = len(tk["x"]) / SR
                ep.append(dict(start=tt, dur=dd, tech=tk["tech"], bi=k % len(blocks), j=j, cyc=k // len(blocks), chain_pos=j, chain_len=len(b)))
                tt += dd + 2.0
            t += d
            pause = float(rng.choice(P, p=PP))
            if not long_done and t > SESS_LEN / 2:
                pause, long_done = 45.0, True
            if pause >= 40:
                long_done = True
            t += pause
            k += 1
        n = int(SESS_LEN * SR)
        voice = np.zeros(n)
        ref = np.zeros(int(SESS_LEN / 0.01) + 1, np.float32)
        for e in ep:
            tk = blocks[e["bi"]][e["j"]]
            a = int(round(e["start"] * SR))
            m = min(len(tk["x"]), n - a)
            voice[a:a + m] += gain * tk["x"][:m]
            for i, fv in enumerate(tk["f0"]):
                jj = int(round((e["start"] + tk["t0"] + i * 0.01) / 0.01))
                if 0 <= jj < len(ref):
                    ref[jj] = fv
        vact = voice[np.abs(voice) > 0.02 * np.abs(voice).max()]
        vr = np.sqrt(np.mean(vact ** 2))
        eq = "phone" if si % 2 == 0 else "phone2agc"
        for cond in ("clean", "+10", "0"):
            rng2 = np.random.default_rng(6000 + si)
            if cond == "clean":
                y = voice + rng2.standard_normal(n) * 10 ** (-70 / 20)
                bname = None
            else:
                bname = BEDS[si % len(BEDS)] if cond == "+10" else BEDS[(si + 5) % len(BEDS)]
                nz = bed(bname, SR, n / SR + 0.01, seed=700 + si)[:n]
                y = voice + nz * vr / 10 ** (float(cond) / 20)
            y = eqm.phone_eq(y, SR) if eq == "phone" else eqm.phone2(y, SR)
            y = np.clip(y, -1, 1).astype(np.float32)
            sid = f"sess5__{singer}__{cond.replace('+', 'p')}"
            wp = os.path.join(OUT, sid + ".wav")
            sf.write(wp, y, SR, subtype="FLOAT")
            rp = os.path.join(REFD, sid + ".json")
            json.dump({"t0": 0.0, "hop": 0.01, "f0": [round(float(v), 2) for v in ref]}, open(rp, "w"))
            specs.append(dict(id=sid, wav=wp.replace("\\", "/"), refPath=rp.replace("\\", "/"), gender=g, group=f"sess5:{cond}",
                              meta=dict(singer=singer, cond=cond, bed=bname, sr=SR, eq=eq, level_db=lvl, episodes=ep)))
        print(singer, eq, f"lvl {lvl:.1f}", len(ep), "episodes", f"voice {sum(e['dur'] for e in ep):.0f} s", flush=True)
    json.dump(specs, open(os.path.join(HV, "probes-sess5.json"), "w"))
    print(len(specs), "sessions")


if __name__ == "__main__":
    main()
