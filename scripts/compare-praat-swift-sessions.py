"""Frame-aligned comparison of SwiftF0 (production streaming sim) vs
Praat autocorrelation pitch on real user session audio. Low-F0
field-accuracy investigation, 2026-06-09.

Inputs are the contour JSONs produced by scripts/praat-pitch-extract.py
and scripts/swift-f0-session-extract.js on the same WAV files.

Per file, on frames where Praat reports voicing:
  - classification of SwiftF0 output: correct (within 5 %), octave-up
    (ratio ~2 or ~3), octave-down, other, null
  - stratified by Praat F0 band (the user's problem register is 80-110)
  - octave-flip rate between consecutive SwiftF0 reports (the ladder
    signature), with Praat's own flip rate as control
  - spurious rate: SwiftF0 reports where Praat says unvoiced
  - spectral H1 vs H2 check on low-register frames: is the fundamental
    attenuated on frames where SwiftF0 octave-ups vs frames where it is
    correct? (tests the capture-chain rolloff / weak-fundamental
    hypothesis directly)

Usage:
  python -u scripts/compare-praat-swift-sessions.py \
      build/pitch-compare/praat-contours.json \
      build/pitch-compare/swift-contours.json \
      measurements/swift-f0-vs-praat-sessions-2026-06-09.json
"""

import json
import sys
import wave

import numpy as np

BANDS = [(50, 80), (80, 110), (110, 150), (150, 220), (220, 350), (350, 600)]
RATIO_TOL = 0.05          # "correct" = within 5 % of Praat
OCTAVE_REL_TOL = 0.10     # ratio within 10 % of an integer multiple
FLIP_TOL = 0.2            # consecutive-report ratio within ±0.2 of 2.0


def classify(swift_hz, praat_hz):
    if swift_hz <= 0:
        return "null"
    r = swift_hz / praat_hz
    if abs(r - 1) < RATIO_TOL:
        return "correct"
    big, small = (r, 1 / r) if r > 1 else (1 / r, r)
    nearest = round(big)
    if nearest >= 2 and abs(big - nearest) / nearest < OCTAVE_REL_TOL:
        return "octave-up" if r > 1 else "octave-down"
    return "other"


def band_of(hz):
    for lo, hi in BANDS:
        if lo <= hz < hi:
            return f"{lo}-{hi}"
    return None


def load_wav(path):
    w = wave.open(path)
    sr = w.getframerate()
    data = np.frombuffer(w.readframes(w.getnframes()), dtype=np.int16)
    w.close()
    return data.astype(np.float64) / 32768.0, sr


def h1_h2_db(samples, sr, center_s, f0):
    """Magnitude (dB) of the partial at f0 minus the partial at 2*f0,
    in a 64 ms Hann window centered at center_s."""
    n = 1024 if sr == 16000 else int(sr * 0.064)
    c = int(center_s * sr)
    a, b = c - n // 2, c + n // 2
    if a < 0 or b > len(samples):
        return None
    win = samples[a:b] * np.hanning(b - a)
    spec = np.abs(np.fft.rfft(win))
    binw = sr / (b - a)

    def peak_mag(freq):
        k = freq / binw
        lo, hi = int(np.floor(k)) - 1, int(np.ceil(k)) + 2
        if lo < 0 or hi >= len(spec):
            return None
        return float(spec[lo:hi].max())

    h1 = peak_mag(f0)
    h2 = peak_mag(2 * f0)
    if not h1 or not h2 or h1 <= 0 or h2 <= 0:
        return None
    return 20 * np.log10(h1 / h2)


def main():
    praat_doc = json.load(open(sys.argv[1]))
    swift_doc = json.load(open(sys.argv[2]))
    out_path = sys.argv[3]

    report = {"files": []}
    for pf, sf in zip(praat_doc["files"], swift_doc["files"]):
        assert pf["path"] == sf["path"], (pf["path"], sf["path"])
        praat_f0 = np.array(pf["f0"])
        p_t0, p_dt = pf["t0"], pf["dt"]
        s_pitch = np.array(sf["pitch"])
        s_t = (sf["tAttr0Ms"] + np.arange(len(s_pitch)) * sf["hopMs"]) / 1000.0

        # Align each SwiftF0 frame to nearest Praat frame
        idx = np.round((s_t - p_t0) / p_dt).astype(int)
        valid = (idx >= 0) & (idx < len(praat_f0))

        counts = {}
        band_counts = {}
        examples = {"octave-up": [], "correct": []}
        praat_voiced_total = 0
        for i in np.nonzero(valid)[0]:
            ref = praat_f0[idx[i]]
            if ref <= 0:
                continue
            praat_voiced_total += 1
            cls = classify(s_pitch[i], ref)
            counts[cls] = counts.get(cls, 0) + 1
            band = band_of(ref)
            if band:
                bc = band_counts.setdefault(band, {})
                bc[cls] = bc.get(cls, 0) + 1
            if cls in examples and 80 <= ref < 110 and len(examples[cls]) < 400:
                examples[cls].append((float(s_t[i]), float(ref)))

        # Spurious: SwiftF0 reports where Praat says unvoiced
        spurious = sum(
            1 for i in np.nonzero(valid)[0]
            if praat_f0[idx[i]] <= 0 and s_pitch[i] > 0
        )
        swift_reported = int((s_pitch > 0).sum())

        # Octave-flip rate between consecutive reports (ladder signature)
        def flip_rate(series):
            vals = series[series > 0]
            if len(vals) < 2:
                return None, 0
            r = vals[1:] / vals[:-1]
            r = np.where(r < 1, 1 / r, r)
            flips = int((np.abs(r - 2) < FLIP_TOL).sum())
            return round(100 * flips / len(r), 2), flips

        s_flip_pct, s_flips = flip_rate(s_pitch.astype(float))
        p_flip_pct, p_flips = flip_rate(praat_f0.astype(float))

        # Spectral H1-H2 on low-register frames: octave-up vs correct
        samples, sr = load_wav(pf["path"])
        h1h2 = {}
        for key, exs in examples.items():
            vals = [h1_h2_db(samples, sr, t, f0) for t, f0 in exs]
            vals = [v for v in vals if v is not None]
            if vals:
                vals.sort()
                n = len(vals)
                h1h2[key] = {
                    "n": n,
                    "p25": round(vals[n // 4], 1),
                    "median": round(vals[n // 2], 1),
                    "p75": round(vals[3 * n // 4], 1),
                }

        total = praat_voiced_total
        pct = {k: round(100 * v / total, 2) for k, v in sorted(counts.items())}
        band_pct = {
            b: {k: round(100 * v / sum(bc.values()), 1) for k, v in sorted(bc.items())}
            for b, bc in sorted(band_counts.items())
            if sum(bc.values()) >= 200
        }
        report["files"].append({
            "path": pf["path"],
            "praatVoicedFrames": total,
            "classificationPct": pct,
            "byPraatBandPct": band_pct,
            "bandFrameCounts": {b: sum(bc.values()) for b, bc in sorted(band_counts.items())},
            "swiftFlipPct": s_flip_pct, "swiftFlips": s_flips,
            "praatFlipPct": p_flip_pct, "praatFlips": p_flips,
            "spuriousSwiftReports": spurious,
            "swiftReportedFrames": swift_reported,
            "h1MinusH2dB_lowRegister": h1h2,
        })
        name = pf["path"].split("sessions/")[-1]
        print(f"\n=== {name} ({total} Praat-voiced frames)")
        print("  classification:", pct)
        print("  by band:")
        for b, d in band_pct.items():
            print(f"    {b:>8} Hz (n={sum(band_counts[b].values())}):", d)
        print(f"  octave-flip rate: swift {s_flip_pct}% ({s_flips})  praat {p_flip_pct}% ({p_flips})")
        print(f"  spurious swift reports (praat-unvoiced): {spurious} / {swift_reported}")
        print("  H1-H2 dB on 80-110 Hz frames:", h1h2)

    with open(out_path, "w") as f:
        json.dump(report, f, indent=1)
    print(f"\nsaved {out_path}")


if __name__ == "__main__":
    main()
