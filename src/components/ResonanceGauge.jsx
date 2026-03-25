// ResonanceGauge.jsx — Horizontal bar gauge showing resonance brightness
// "Darker" on left, "Brighter" on right. Composite score from F1/F2/F3.
// Color gradient: red → yellow → green as value approaches target.

import { RESONANCE_BASELINES, RESONANCE_BRIGHTNESS_TARGET } from "../utils/constants";

function computeBrightness(formants) {
  const { f1, f2, f3 } = formants;
  if (f2 === null || f2 === undefined) return null;

  // Normalize each formant: 0 = male baseline, 100 = female target
  function norm(value, key) {
    if (value === null || value === undefined) return null;
    const { male, female } = RESONANCE_BASELINES[key];
    const range = female - male;
    if (range === 0) return 50;
    return ((value - male) / range) * 100;
  }

  const f2Norm = norm(f2, "f2");
  if (f2Norm === null) return null;

  const f1Norm = norm(f1, "f1");
  const f3Norm = norm(f3, "f3");

  // Weighted composite: 80% F2, 10% F1, 10% F3
  let score = f2Norm * 0.8;
  if (f1Norm !== null) score += f1Norm * 0.1;
  else score += f2Norm * 0.1; // fallback to F2 weight
  if (f3Norm !== null) score += f3Norm * 0.1;
  else score += f2Norm * 0.1;

  return Math.max(0, Math.min(100, score));
}

// Interpolate color from red → yellow → green based on 0-100 score
function scoreColor(score) {
  if (score <= 50) {
    // Red (0) → Yellow (50)
    const t = score / 50;
    const r = 239;
    const g = Math.round(68 + (200 - 68) * t);
    const b = Math.round(68 * (1 - t));
    return `rgb(${r}, ${g}, ${b})`;
  }
  // Yellow (50) → Green (100)
  const t = (score - 50) / 50;
  const r = Math.round(239 - (239 - 74) * t);
  const g = Math.round(200 + (222 - 200) * t);
  const b = Math.round(0 + 128 * t);
  return `rgb(${r}, ${g}, ${b})`;
}

export function ResonanceGauge({ formants, voiced, holding }) {
  const brightness = formants ? computeBrightness(formants) : null;
  const clampedValue = brightness !== null ? Math.max(0, Math.min(100, brightness)) : null;

  const inTarget = brightness !== null && brightness >= RESONANCE_BRIGHTNESS_TARGET;
  const opacity = !voiced && !holding ? 0.3 : holding ? 0.5 : 1;

  return (
    <div className="w-full" style={{ opacity }}>
      {/* Labels */}
      <div className="flex justify-between items-baseline mb-1.5">
        <span className="text-[10px] text-neutral-500 uppercase tracking-wider">
          Darker
        </span>
        <span className="text-xs text-neutral-400 font-medium">
          Resonance
        </span>
        <span className="text-[10px] text-neutral-500 uppercase tracking-wider">
          Brighter
        </span>
      </div>

      {/* Gauge track */}
      <div className="relative h-3 rounded-full bg-neutral-800 overflow-hidden">
        {/* Target zone highlight */}
        <div
          className="absolute top-0 h-full rounded-full"
          style={{
            left: `${RESONANCE_BRIGHTNESS_TARGET}%`,
            width: `${100 - RESONANCE_BRIGHTNESS_TARGET}%`,
            background:
              "linear-gradient(90deg, rgba(96,165,250,0.08), rgba(96,165,250,0.15), rgba(96,165,250,0.08))",
            borderTop: "1px solid rgba(96,165,250,0.25)",
            borderBottom: "1px solid rgba(96,165,250,0.25)",
          }}
        />

        {/* Filled portion with gradient color */}
        {clampedValue !== null && (
          <div
            className="absolute top-0 h-full rounded-full transition-all duration-100"
            style={{
              left: 0,
              width: `${clampedValue}%`,
              background: `linear-gradient(90deg, #ef4444, #eab308, ${scoreColor(clampedValue)})`,
              opacity: 0.3,
            }}
          />
        )}

        {/* Marker */}
        {clampedValue !== null && (
          <div
            className="absolute top-1/2 -translate-y-1/2 transition-all duration-100"
            style={{ left: `${clampedValue}%` }}
          >
            <div
              className="w-3.5 h-3.5 -ml-[7px] rounded-full border-2"
              style={{
                backgroundColor: scoreColor(clampedValue),
                borderColor: scoreColor(clampedValue),
                boxShadow: `0 0 6px ${scoreColor(clampedValue)}80`,
              }}
            />
          </div>
        )}
      </div>

      {/* Value readout */}
      <div className="mt-1 text-center">
        <span
          className={`text-xs tabular-nums ${
            inTarget ? "text-blue-400" : "text-neutral-400"
          }`}
        >
          {brightness !== null ? `${Math.round(brightness)}` : "\u2014"}
        </span>
      </div>
    </div>
  );
}
