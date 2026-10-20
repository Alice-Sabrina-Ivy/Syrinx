# prep_libri.py — LibriSpeech items for the quiet-floor safety check
# (measurements/pitch-quiet-floor-2026-10-20.md §3): per speaker of dev-clean
# (dev) and test-clean (held-out), the first 3 utterances of 3-15 s in
# (chapter, utterance) order, written as 16-bit 16 kHz WAV, plus a Praat AC
# reference (75-600 Hz, default settings: time step 0.75 / floor = 10 ms) on
# the natural file.
#
# Usage (repo root): python scripts/quiet-floor/prep_libri.py --libri=DIR [--out=build/quiet-floor/libri]
#   DIR = a LibriSpeech root holding SPEAKERS.TXT, dev-clean/, test-clean/
import sys, os, glob, json
import numpy as np, soundfile as sf, parselmouth

A = dict((a[2:].split("=", 1) + ["1"])[:2] for a in sys.argv[1:] if a.startswith("--"))
LIBRI = A.get("libri", "build/resonance-lab/data/LibriSpeech")
OUT = A.get("out", "build/quiet-floor/libri")
PER = int(A.get("per", "3"))

sex = {}
for line in open(os.path.join(LIBRI, "SPEAKERS.TXT"), encoding="utf8"):
    if line.startswith(";"): continue
    p = [s.strip() for s in line.split("|")]
    if len(p) >= 3: sex[p[0]] = p[1].lower()

index = []
for split in ("dev-clean", "test-clean"):
    od = os.path.join(OUT, split); os.makedirs(od, exist_ok=True)
    for spk in sorted(os.listdir(os.path.join(LIBRI, split)), key=int):
        files = []
        for f in glob.glob(os.path.join(LIBRI, split, spk, "*", "*.flac")):
            uid = os.path.basename(f)[:-5]; _, chap, utt = uid.split("-")
            files.append((int(chap), int(utt), uid, f))
        took = 0
        for chap, utt, uid, f in sorted(files):
            info = sf.info(f); dur = info.frames / info.samplerate
            if not (3.0 <= dur <= 15.0): continue
            x, sr = sf.read(f, dtype="float64")
            if sr != 16000: raise SystemExit(f"{f}: expected 16 kHz")
            wav = os.path.join(od, uid + ".wav")
            sf.write(wav, x, sr, subtype="PCM_16")
            p = parselmouth.Sound(x, sampling_frequency=sr).to_pitch_ac(pitch_floor=75.0, pitch_ceiling=600.0)
            f0 = p.selected_array["frequency"].astype(np.float32)
            f0.tofile(os.path.join(od, uid + ".ref.f32"))
            index.append(dict(split=split, uid=uid, speaker=spk, sex=sex[spk], wav=f"{split}/{uid}.wav",
                              ref=f"{split}/{uid}.ref.f32", refT0Ms=float(p.xs()[0]) * 1000, refHopMs=float(p.dt) * 1000,
                              dur=dur))
            took += 1
            if took >= PER: break
json.dump(index, open(os.path.join(OUT, "index.json"), "w"), indent=0)
for split in ("dev-clean", "test-clean"):
    it = [i for i in index if i["split"] == split]
    print(split, len(it), "items,", len({i["speaker"] for i in it}), "speakers,",
          f"{sum(i['dur'] for i in it) / 60:.1f} min, m/f items {sum(i['sex'] == 'm' for i in it)}/{sum(i['sex'] == 'f' for i in it)}")
