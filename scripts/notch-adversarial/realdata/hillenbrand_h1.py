# hillenbrand_h1.py — how far a vowel change on a held pitch moves the 1st
# harmonic's level (2026-10-06 fix round; the takeover test of the notch's
# voice timing fires on a >= 6 dB rise of a line over a steady level).
# Hillenbrand et al. 1995 /hVd/ recordings (tests/dsp/data/men|women, 16 kHz,
# vowdata.dat F0): per talker, the absolute H1 peak level (dB, same talker,
# same session gain) of each vowel at its loudest 200 ms (Hann, zero-padded),
# then the within-talker change between vowel pairs.
#   python scripts/notch-adversarial/realdata/hillenbrand_h1.py
import os, wave
import numpy as np

D = os.path.join(os.path.dirname(os.path.abspath(__file__)), "../../../tests/dsp/data")
f0 = {}
for ln in open(os.path.join(D, "vowdata.dat")):
    p = ln.split()
    if len(p) >= 3 and len(p[0]) == 5 and p[0][0] in "mw" and p[1].isdigit():
        f0[p[0]] = int(p[2])


def h1db(path, F0):
    w = wave.open(path)
    x = np.frombuffer(w.readframes(w.getnframes()), dtype=np.int16).astype(float) / 32768
    sr = w.getframerate()
    hop, n = int(0.01 * sr), int(0.2 * sr)
    e = np.array([np.sum(x[i:i + n] ** 2) for i in range(0, len(x) - n, hop)])
    i0 = int(np.argmax(e)) * hop
    seg = x[i0:i0 + n] * np.hanning(n)
    N = 1 << 16
    X = np.abs(np.fft.rfft(seg, N)) ** 2
    fr = np.arange(len(X)) * sr / N
    m = (fr > 0.85 * F0) & (fr < 1.15 * F0)
    return 10 * np.log10(X[m].max() + 1e-20), 10 * np.log10(np.sum(seg ** 2) + 1e-20)


res = {}
for g, sub in (("m", "men"), ("w", "women")):
    for fn in os.listdir(os.path.join(D, sub)):
        k = fn[:5]
        if k not in f0 or f0[k] <= 0:
            continue
        res[k] = (g,) + h1db(os.path.join(D, sub, fn), f0[k])
for g in "mw":
    talkers = sorted({k[:3] for k in res if k[0] == g})
    for v1, v2 in (("ah", "iy"), ("ah", "uw"), ("ah", "eh"), ("ae", "iy"), ("ah", "oo"), ("aw", "uw")):
        d, dt = [], []
        for t in talkers:
            if t + v1 in res and t + v2 in res:
                d.append(res[t + v2][1] - res[t + v1][1])
                dt.append(res[t + v2][2] - res[t + v1][2])
        if not d:
            continue
        d = np.array(d)
        print(f"{'men  ' if g == 'm' else 'women'} {v1}->{v2}: n={len(d)} H1 change median {np.median(d):+.1f} dB, "
              f"p25 {np.percentile(d, 25):+.1f}, p75 {np.percentile(d, 75):+.1f}; >= +6 dB in {np.mean(d >= 6) * 100:.0f} % of talkers "
              f"(total level change median {np.median(dt):+.1f} dB)")
    print(f"   {g} F0 median {np.median([f0[k] for k in res if k[0] == g]):.0f} Hz")
