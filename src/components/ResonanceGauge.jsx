// ResonanceGauge.jsx — Horizontal bar showing the ML perceived-gender score.
// "Darker" on the left, "Brighter" on the right. Reads the same score the
// trace does so the two views stay consistent.

const SCORE_TARGET = 70;
const LOW_CONFIDENCE = 0.3;

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

export function ResonanceGauge({ genderScore, genderConfidence, modelStatus, voiced, holding }) {
  const score = genderScore;
  const clamped = score != null ? Math.max(0, Math.min(100, score)) : null;
  const inTarget = score != null && score >= SCORE_TARGET;
  const lowConfidence = genderConfidence != null && genderConfidence < LOW_CONFIDENCE;
  const opacity = !voiced && !holding ? 0.3 : holding ? 0.5 : 1;

  const subtitle =
    modelStatus === "loading" ? "loading…" :
    modelStatus === "error" ? "unavailable" :
    score == null ? "warming up" :
    lowConfidence ? "uncertain" :
    inTarget ? "in target" : "below target";

  return (
    <div className="w-full" style={{ opacity }}>
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

      <div className="relative h-3 rounded-full bg-neutral-800 overflow-hidden">
        <div
          className="absolute top-0 h-full rounded-full"
          style={{
            left: `${SCORE_TARGET}%`,
            width: `${100 - SCORE_TARGET}%`,
            background:
              "linear-gradient(90deg, rgba(96,165,250,0.08), rgba(96,165,250,0.15), rgba(96,165,250,0.08))",
            borderTop: "1px solid rgba(96,165,250,0.25)",
            borderBottom: "1px solid rgba(96,165,250,0.25)",
          }}
        />

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

        {clamped !== null && (
          <div
            className="absolute top-1/2 -translate-y-1/2 transition-all duration-200"
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

      <div className="mt-1 text-center">
        <span
          className={`text-xs tabular-nums ${
            inTarget ? "text-blue-400" : "text-neutral-400"
          }`}
        >
          {score != null ? `${Math.round(score)}` : "—"}
          <span className="text-neutral-500 ml-1">· {subtitle}</span>
        </span>
      </div>
    </div>
  );
}
