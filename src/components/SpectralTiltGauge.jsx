// SpectralTiltGauge.jsx — Horizontal bar gauge showing vocal weight (spectral tilt)
// "Lighter" on left, "Heavier" on right, with target zone highlight and moving marker.

import { SPECTRAL_TILT_RANGE, SPECTRAL_TILT_TARGET } from "../utils/constants";

export function SpectralTiltGauge({ spectralTilt, voiced, holding }) {
  const { min, max } = SPECTRAL_TILT_RANGE;
  const range = max - min;

  // Clamp value to display range
  const clampedValue =
    spectralTilt !== null
      ? Math.max(min, Math.min(max, spectralTilt))
      : null;

  const valuePct =
    clampedValue !== null ? ((clampedValue - min) / range) * 100 : null;

  // Target zone as percentage
  const targetLeftPct = ((SPECTRAL_TILT_TARGET.low - min) / range) * 100;
  const targetWidthPct =
    ((SPECTRAL_TILT_TARGET.high - SPECTRAL_TILT_TARGET.low) / range) * 100;

  const inTarget =
    spectralTilt !== null &&
    spectralTilt >= SPECTRAL_TILT_TARGET.low &&
    spectralTilt <= SPECTRAL_TILT_TARGET.high;

  const opacity = !voiced && !holding ? 0.3 : holding ? 0.5 : 1;

  return (
    <div className="w-full" style={{ opacity }}>
      {/* Labels */}
      <div className="flex justify-between items-baseline mb-1.5">
        <span className="text-[10px] text-neutral-500 uppercase tracking-wider">
          Lighter
        </span>
        <span className="text-xs text-neutral-400 font-medium">
          Vocal Weight
        </span>
        <span className="text-[10px] text-neutral-500 uppercase tracking-wider">
          Heavier
        </span>
      </div>

      {/* Gauge track */}
      <div className="relative h-3 rounded-full bg-neutral-800 overflow-hidden">
        {/* Target zone highlight */}
        <div
          className="absolute top-0 h-full rounded-full"
          style={{
            left: `${targetLeftPct}%`,
            width: `${targetWidthPct}%`,
            background:
              "linear-gradient(90deg, rgba(74,222,128,0.08), rgba(74,222,128,0.15), rgba(74,222,128,0.08))",
            borderTop: "1px solid rgba(74,222,128,0.25)",
            borderBottom: "1px solid rgba(74,222,128,0.25)",
          }}
        />

        {/* Marker */}
        {valuePct !== null && (
          <div
            className="absolute top-1/2 -translate-y-1/2 transition-all duration-100"
            style={{ left: `${valuePct}%` }}
          >
            <div
              className={`w-3.5 h-3.5 -ml-[7px] rounded-full border-2 ${
                inTarget
                  ? "bg-green-400 border-green-300 shadow-[0_0_6px_rgba(74,222,128,0.5)]"
                  : "bg-purple-400 border-purple-300 shadow-[0_0_6px_rgba(192,132,252,0.4)]"
              }`}
            />
          </div>
        )}
      </div>

      {/* Value readout */}
      <div className="mt-1 text-center">
        <span
          className={`text-xs tabular-nums ${
            inTarget ? "text-green-400" : "text-neutral-400"
          }`}
        >
          {spectralTilt !== null ? `${spectralTilt.toFixed(1)} dB` : "—"}
        </span>
      </div>
    </div>
  );
}
