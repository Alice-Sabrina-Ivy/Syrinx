// VocalWeightGauge.jsx — Horizontal bar gauge for the per-user-
// baseline-normalized CPP-based vocal-weight correlate.
//
// Direction: "Lighter" (left) ← → "Heavier" (right). Per Aaen et al.
// 2025 + literature review, higher CPP = lighter voice. The baseline
// tracker maps gauge position [0, 1] to ±2σ around the user's first-
// 30-s mean, with position 1.0 = lighter end (high CPP) and 0.0 =
// heavier end (low CPP). The gauge component flips that internally
// to keep the visual "Lighter" label on the LEFT — users' learned
// left-to-right mental model from the previous gauge stays consistent.
//
// Three visual states:
//   - Calibrating (first 30 s of voiced speech): no marker, replaced
//     with progress text "Calibrating: X / 30 s".
//   - Ready, voiced: marker at gauge position with σ-distance
//     readout below ("+1.2σ lighter" etc.).
//   - Ready, holding (silence < 5 s): marker at last-known position,
//     dimmed.

import { useState } from "react";

const TARGET_BAND_LOW_SIGMA = 0.5;   // target = lighter than μ + 0.5σ

export function VocalWeightGauge({
  vocalWeight,
  voiced,
  holding,
  onResetBaseline,
}) {
  const [confirmingReset, setConfirmingReset] = useState(false);

  const cpp = vocalWeight?.cpp ?? null;
  const positionFromHook = vocalWeight?.position ?? null;
  const sigmaDelta = vocalWeight?.sigmaDelta ?? null;
  const progress = vocalWeight?.baselineProgress ?? 0;
  const ready = vocalWeight?.baselineReady ?? false;

  // Flip position so visual LEFT (Lighter) = high gauge value.
  // The baseline tracker's gaugePosition returns 1.0 for high CPP
  // (lighter); we want that to render at the LEFT of the bar to
  // match the "Lighter ← → Heavier" label arrangement carried over
  // from the previous gauge.
  const visualPct = positionFromHook !== null ? (1 - positionFromHook) * 100 : null;

  // Target band: σ-distance > TARGET_BAND_LOW_SIGMA = "in target"
  // (lighter than baseline). Maps to the visual LEFT third of the
  // bar (since LEFT = lighter).
  const targetCenterPct = ready
    ? (1 - 0.5 - TARGET_BAND_LOW_SIGMA / 4) * 100  // covers σ ∈ (+0.5, +2)
    : null;
  const targetWidthPct = (1.5 / 4) * 100;          // σ width = 1.5
  const targetLeftPct = targetCenterPct !== null
    ? Math.max(0, targetCenterPct - targetWidthPct / 2)
    : null;

  const inTarget = sigmaDelta !== null && sigmaDelta >= TARGET_BAND_LOW_SIGMA;
  const opacity = !voiced && !holding ? 0.3 : holding ? 0.5 : 1;

  return (
    <div className="w-full" style={{ opacity }}>
      {/* Labels */}
      <div className="flex justify-between items-baseline mb-1.5 whitespace-nowrap">
        <span className="text-[9px] sm:text-[10px] text-neutral-500 uppercase tracking-normal sm:tracking-wider">
          Lighter
        </span>
        <span className="text-[11px] sm:text-xs text-neutral-400 font-medium px-1">
          Vocal Weight
        </span>
        <span className="text-[9px] sm:text-[10px] text-neutral-500 uppercase tracking-normal sm:tracking-wider">
          Heavier
        </span>
      </div>

      {/* Gauge track */}
      <div className="relative h-3 rounded-full bg-neutral-800 overflow-hidden">
        {/* Target zone highlight (only after baseline locks) */}
        {ready && targetLeftPct !== null && (
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
        )}

        {/* Marker (only when baseline is ready and we have a position) */}
        {ready && visualPct !== null && (
          <div
            className="absolute top-1/2 -translate-y-1/2 transition-all duration-100"
            style={{ left: `${visualPct}%` }}
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

        {/* Calibrating: progress overlay */}
        {!ready && (
          <div
            className="absolute top-0 left-0 h-full bg-amber-500/20"
            style={{ width: `${progress * 100}%` }}
          />
        )}
      </div>

      {/* Readout — three modes:
          1. Pre-warmup (no CPP yet): "—"
          2. Calibrating (have CPP, baseline not ready): progress text
          3. Ready (baseline locked): σ-distance readout */}
      <div className="mt-1 text-center min-h-[16px]">
        {!ready ? (
          <span className="text-xs tabular-nums text-amber-400">
            {cpp === null
              ? "Calibrating: listening for voice…"
              : `Calibrating: ${Math.round(progress * 100)} %`}
          </span>
        ) : sigmaDelta !== null ? (
          <span
            className={`text-xs tabular-nums ${
              inTarget ? "text-green-400" : "text-neutral-400"
            }`}
          >
            {sigmaDelta >= 0 ? "+" : ""}
            {sigmaDelta.toFixed(1)} σ
            <span className="text-neutral-500 ml-1">
              ({sigmaDelta > 0 ? "lighter" : sigmaDelta < 0 ? "heavier" : "at baseline"})
            </span>
          </span>
        ) : (
          <span className="text-xs tabular-nums text-neutral-500">—</span>
        )}
      </div>

      {/* Reset baseline affordance — only shown once baseline is
          locked. Confirm-then-act so an accidental tap doesn't drop
          30 s of calibration. */}
      {ready && onResetBaseline && (
        <div className="mt-1 text-center">
          {confirmingReset ? (
            <span className="text-[10px] text-neutral-500">
              Reset baseline?{" "}
              <button
                onClick={() => {
                  onResetBaseline();
                  setConfirmingReset(false);
                }}
                className="text-amber-400 hover:text-amber-300 underline"
              >
                yes
              </button>{" "}
              /{" "}
              <button
                onClick={() => setConfirmingReset(false)}
                className="text-neutral-400 hover:text-neutral-300 underline"
              >
                no
              </button>
            </span>
          ) : (
            <button
              onClick={() => setConfirmingReset(true)}
              className="text-[10px] text-neutral-600 hover:text-neutral-400 underline"
              title="Re-calibrate to your current voice. Useful if the first 30 s of the session wasn't representative — e.g., starting with vocal warm-up."
            >
              reset baseline
            </button>
          )}
        </div>
      )}
    </div>
  );
}
