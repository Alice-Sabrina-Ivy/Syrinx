// ResonanceGauge.jsx — Horizontal bar showing vowel-normalized resonance score.
// "Darker" on the left, "Brighter" on the right. Shares its metric with
// ResonanceScoreTrace so the live trace and the gauge always agree.

import { vowelResonanceScore, RESONANCE_SCORE_TARGET } from "../utils/resonanceScore";

function scoreColor(score) {
  if (score <= 50) {
    const t = score / 50;
    const r = 239;
    const g = Math.round(68 + (200 - 68) * t);
    const b = Math.round(68 * (1 - t));
    return `rgb(${r}, ${g}, ${b})`;
  }
  const t = (score - 50) / 50;
  const r = Math.round(239 - (239 - 74) * t);
  const g = Math.round(200 + (222 - 200) * t);
  const b = Math.round(0 + 128 * t);
  return `rgb(${r}, ${g}, ${b})`;
}

export function ResonanceGauge({ formants, voiced, holding }) {
  const result = formants ? vowelResonanceScore(formants.f1, formants.f2) : null;
  const score = result?.score ?? null;
  const clamped = score !== null ? Math.max(0, Math.min(100, score)) : null;

  const inTarget = score !== null && score >= RESONANCE_SCORE_TARGET;
  const opacity = !voiced && !holding ? 0.3 : holding ? 0.5 : 1;

  return (
    <div className="w-full" style={{ opacity }}>
      {/* Labels */}
      <div className="flex justify-between items-baseline mb-1.5 whitespace-nowrap">
        <span className="text-[9px] sm:text-[10px] text-neutral-500 uppercase tracking-normal sm:tracking-wider">
          Darker
        </span>
        <span className="text-[11px] sm:text-xs text-neutral-400 font-medium px-1">
          Resonance
        </span>
        <span className="text-[9px] sm:text-[10px] text-neutral-500 uppercase tracking-normal sm:tracking-wider">
          Brighter
        </span>
      </div>

      {/* Gauge track */}
      <div className="relative h-3 rounded-full bg-neutral-800 overflow-hidden">
        {/* Target zone highlight */}
        <div
          className="absolute top-0 h-full rounded-full"
          style={{
            left: `${RESONANCE_SCORE_TARGET}%`,
            width: `${100 - RESONANCE_SCORE_TARGET}%`,
            background:
              "linear-gradient(90deg, rgba(96,165,250,0.08), rgba(96,165,250,0.15), rgba(96,165,250,0.08))",
            borderTop: "1px solid rgba(96,165,250,0.25)",
            borderBottom: "1px solid rgba(96,165,250,0.25)",
          }}
        />

        {/* Filled portion with gradient color */}
        {clamped !== null && (
          <div
            className="absolute top-0 h-full rounded-full transition-all duration-100"
            style={{
              left: 0,
              width: `${clamped}%`,
              background: `linear-gradient(90deg, #ef4444, #eab308, ${scoreColor(clamped)})`,
              opacity: 0.3,
            }}
          />
        )}

        {/* Marker */}
        {clamped !== null && (
          <div
            className="absolute top-1/2 -translate-y-1/2 transition-all duration-100"
            style={{ left: `${clamped}%` }}
          >
            <div
              className="w-3.5 h-3.5 -ml-[7px] rounded-full border-2"
              style={{
                backgroundColor: scoreColor(clamped),
                borderColor: scoreColor(clamped),
                boxShadow: `0 0 6px ${scoreColor(clamped)}80`,
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
          {score !== null ? `${Math.round(score)}` : "—"}
        </span>
      </div>
    </div>
  );
}
