"""Praat CPPS probe — verify parselmouth works on a single test
track. P1 verification step for the WS2 Praat-comparison
validation.

Loads one Hillenbrand track, computes CPPS via Praat's
PowerCepstrogram + Get CPPS, prints the value and parameters.
If this runs cleanly, parselmouth setup is verified and we
proceed to P2 (full corpus walk).

Usage: python scripts/praat-cpps-probe.py [path/to/wav]
"""
import sys
from pathlib import Path
import parselmouth

# Default test track: a Hillenbrand /a/ vowel from a male speaker.
DEFAULT_WAV = Path(__file__).resolve().parent.parent / "tests" / "dsp" / "data" / "men" / "m01ae.wav"

# Praat PowerCepstrogram defaults (per Praat manual + parselmouth wrapper)
PITCH_FLOOR_HZ = 60
TIME_STEP_S = 0.002
MAX_FREQ_HZ = 5000
PRE_EMPHASIS_FROM_HZ = 50

# Get CPPS defaults
SUBTRACT_TREND_BEFORE_SMOOTHING = "no"
TIME_AVG_WIN_S = 0.001
QUEFRENCY_AVG_WIN_S = 0.00005
PITCH_FLOOR_FOR_PEAK_HZ = 60
PITCH_CEILING_FOR_PEAK_HZ = 330
TOLERANCE = 0.05
INTERPOLATION = "Parabolic"
TREND_LINE_QSTART_S = 0.001
TREND_LINE_QEND_S = 0.05
TREND_TYPE = "Exponential decay"
FIT_METHOD = "Robust slow"


def compute_cpps(wav_path: Path) -> float:
    snd = parselmouth.Sound(str(wav_path))
    cepstrogram = parselmouth.praat.call(
        snd,
        "To PowerCepstrogram",
        PITCH_FLOOR_HZ,
        TIME_STEP_S,
        MAX_FREQ_HZ,
        PRE_EMPHASIS_FROM_HZ,
    )
    cpps = parselmouth.praat.call(
        cepstrogram,
        "Get CPPS",
        SUBTRACT_TREND_BEFORE_SMOOTHING,
        TIME_AVG_WIN_S,
        QUEFRENCY_AVG_WIN_S,
        PITCH_FLOOR_FOR_PEAK_HZ,
        PITCH_CEILING_FOR_PEAK_HZ,
        TOLERANCE,
        INTERPOLATION,
        TREND_LINE_QSTART_S,
        TREND_LINE_QEND_S,
        TREND_TYPE,
        FIT_METHOD,
    )
    return cpps


def main():
    wav_path = Path(sys.argv[1]) if len(sys.argv) > 1 else DEFAULT_WAV
    if not wav_path.exists():
        print(f"ERROR: {wav_path} not found", file=sys.stderr)
        sys.exit(1)

    print(f"Track: {wav_path.name}")
    print(f"Praat PowerCepstrogram parameters:")
    print(f"  pitchFloor={PITCH_FLOOR_HZ} Hz, timeStep={TIME_STEP_S} s, "
          f"maxFreq={MAX_FREQ_HZ} Hz, preEmphasis={PRE_EMPHASIS_FROM_HZ} Hz")
    print(f"Praat Get CPPS parameters:")
    print(f"  pitchFloor={PITCH_FLOOR_FOR_PEAK_HZ} Hz, "
          f"pitchCeiling={PITCH_CEILING_FOR_PEAK_HZ} Hz, trend={TREND_TYPE}, "
          f"fitMethod={FIT_METHOD}")
    cpps = compute_cpps(wav_path)
    print(f"\nCPPS: {cpps:.3f} dB")


if __name__ == "__main__":
    main()
