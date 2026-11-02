# make-wavs.py — the two fake-mic WAVs of measurements/hnr-readout-2026-11-02.md:
# public LibriSpeech test-clean readers 121 (woman) and 61 (man), CC BY 4.0.
#   python -P scripts/hnr-readout/make-wavs.py <LibriSpeech root> <out dir>
#   python -P scripts/hnr-readout/make-wavs.py --praat <wav> [...]   (Praat HNR over voiced frames, parselmouth)
import sys, os, glob
import numpy as np, soundfile as sf
from scipy.signal import resample_poly
if sys.argv[1] == "--praat":
    import parselmouth
    for f in sys.argv[2:]:
        h = parselmouth.Sound(f).to_harmonicity_ac(time_step=0.01, minimum_pitch=75, silence_threshold=0.1, periods_per_window=4.5)
        v = h.values[0]; v = v[v > -100]
        print(os.path.basename(f), "Praat HNR over voiced frames: mean %.1f dB, median %.1f, q10 %.1f, q90 %.1f" % (v.mean(), np.median(v), np.percentile(v, 10), np.percentile(v, 90)))
    sys.exit(0)
root, out = sys.argv[1], sys.argv[2]
rng = np.random.default_rng(7)
def pink(n):
    w = rng.standard_normal(n); f = np.fft.rfft(w); k = np.arange(len(f)); k[0] = 1
    p = np.fft.irfft(f / np.sqrt(k), n); return p / np.sqrt(np.mean(p**2))
for spk, name in [("121", "woman"), ("61", "man")]:
    files = sorted(glob.glob(os.path.join(root, "test-clean", spk, "*", "*.flac")))
    parts, total, gaps = [], 0.0, [0.6, 2.5, 0.8, 3.5, 1.0, 2.0, 0.7, 3.0]
    for i, f in enumerate(files):
        x, sr = sf.read(f); assert sr == 16000
        parts.append(x); parts.append(np.zeros(int(16000 * gaps[i % len(gaps)])))
        total += len(x) / 16000 + gaps[i % len(gaps)]
        if total >= 75: break
    y = resample_poly(np.concatenate(parts), 3, 1)
    act = y[np.abs(y) > 1e-3]; y = y * (10 ** (-26 / 20) / np.sqrt(np.mean(act**2)))
    y = y + pink(len(y)) * 10 ** (-65 / 20)
    y = np.clip(y, -0.99, 0.99)
    sf.write(os.path.join(out, f"speech-{name}.wav"), y.astype(np.float32), 48000, subtype="PCM_16")
    print(name, f"{len(y)/48000:.1f} s", len(files), "files available")
