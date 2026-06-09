"""Praat pitch contour extraction for the low-F0 field-accuracy
investigation (2026-06-09).

Runs Praat's autocorrelation pitch tracker (via parselmouth) over one or
more WAV files and writes per-frame {t, f0} contours to JSON. Used as
the reference ("known good") tracker for comparison against Syrinx's
SwiftF0 streaming pipeline on real user session audio.

Pitch floor 50 Hz (below the user's 85-95 Hz range so fry/creak isn't
clipped), ceiling 600 Hz, 10 ms time step.

Usage:
  python -u scripts/praat-pitch-extract.py OUT.json WAV [WAV...]
"""

import json
import sys

import parselmouth

PITCH_FLOOR_HZ = 50.0
PITCH_CEILING_HZ = 600.0
TIME_STEP_S = 0.01

def extract(path):
    snd = parselmouth.Sound(path)
    pitch = snd.to_pitch(time_step=TIME_STEP_S,
                         pitch_floor=PITCH_FLOOR_HZ,
                         pitch_ceiling=PITCH_CEILING_HZ)
    f0 = pitch.selected_array["frequency"]  # 0 where unvoiced
    t0 = pitch.x1
    dt = pitch.dx
    return {
        "path": path,
        "durationS": snd.duration,
        "t0": t0,
        "dt": dt,
        "f0": [round(float(v), 2) for v in f0],
    }

def main():
    out_path = sys.argv[1]
    results = []
    for wav in sys.argv[2:]:
        print(f"extracting {wav} ...", flush=True)
        results.append(extract(wav))
        voiced = [v for v in results[-1]["f0"] if v > 0]
        if voiced:
            voiced.sort()
            n = len(voiced)
            print(f"  {n} voiced frames | f0 p10={voiced[n//10]:.1f} "
                  f"median={voiced[n//2]:.1f} p90={voiced[9*n//10]:.1f} Hz",
                  flush=True)
    with open(out_path, "w") as f:
        json.dump({
            "config": {
                "pitchFloorHz": PITCH_FLOOR_HZ,
                "pitchCeilingHz": PITCH_CEILING_HZ,
                "timeStepS": TIME_STEP_S,
                "method": "praat to_pitch (autocorrelation)",
            },
            "files": results,
        }, f)
    print(f"saved {out_path}")

if __name__ == "__main__":
    main()
