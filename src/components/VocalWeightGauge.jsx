// VocalWeightGauge.jsx — Horizontal bar gauge for the per-user-
// baseline-normalized CPP-based vocal-weight correlate.
//
// Two display modes (driven by whether the user has captured an
// optional target voice):
//
//   - No target: fixed labels "Lighter" (left) ← → "Heavier" (right).
//     Position derives from σ-distance against baseline. Visual left
//     = high CPP (lighter) per Aaen et al. 2025; matches the
//     "Lighter/Heavier" mental model carried from earlier iterations.
//
//   - Target captured: labels "Your starting voice" (left) ← →
//     "Your target voice" (right) regardless of CPP polarity. The
//     gauge fills from baseline toward target so "moving toward
//     target" reads visually as moving rightward — independent of
//     whether the user is training lighter or heavier. σ-distance
//     readout is from the target ("+0.4σ from target") with the
//     baseline distance as a secondary subscript.
//
// States:
//   - Calibrating (no persisted baseline + first 30 s of voiced speech):
//     no marker, replaced with progress text "Calibrating: N%".
//   - Ready, voiced: marker at gauge position with σ-distance readout.
//   - Ready, holding (silence < 5 s): marker at last-known position,
//     dimmed.
//   - Target capture active: separate progress overlay; main gauge
//     dimmed.
//
// Persistence: μ/σ are saved to IndexedDB after the first session's
// 30 s calibration and reloaded on subsequent sessions, so most
// sessions skip the calibration state entirely. Persistence is
// handled in useAudioPipeline; this component only reads/displays.

import { useState } from "react";

const TARGET_BAND_LOW_SIGMA = 0.5;   // no-target mode: "in target" = σ > +0.5

export function VocalWeightGauge({
  vocalWeight,
  voiced,
  holding,
  onResetBaseline,
  onStartTargetCapture,
  onCancelTargetCapture,
  onClearTarget,
}) {
  const [confirmingReset, setConfirmingReset] = useState(false);
  const [confirmingClearTarget, setConfirmingClearTarget] = useState(false);

  const cpp = vocalWeight?.cpp ?? null;
  const positionFromHook = vocalWeight?.position ?? null;
  const sigmaDelta = vocalWeight?.sigmaDelta ?? null;
  const sigmaDeltaFromBaseline = vocalWeight?.sigmaDeltaFromBaseline ?? null;
  const progress = vocalWeight?.baselineProgress ?? 0;
  const ready = vocalWeight?.baselineReady ?? false;
  const hasTarget = vocalWeight?.hasTarget ?? false;
  const targetCaptureStatus = vocalWeight?.targetCaptureStatus ?? "idle";
  const targetCaptureProgress = vocalWeight?.targetCaptureProgress ?? 0;

  // Visual position mapping:
  //   - With target: position 1.0 (math) = at target. We map that to
  //     visual RIGHT (100 %) so "progress toward target" reads as
  //     leftward → rightward fill, independent of CPP polarity.
  //   - Without target: position 1.0 (math) = high CPP = lighter. We
  //     flip so the visual LEFT shows lighter (matches pre-existing
  //     Lighter ← → Heavier label arrangement).
  const visualPct = positionFromHook === null
    ? null
    : hasTarget
      ? positionFromHook * 100
      : (1 - positionFromHook) * 100;

  // Target band (no-target mode only): highlights σ > +0.5 region
  // on the LEFT third of the gauge — corresponds to "lighter than
  // typical baseline."
  const targetBandLeftPct = ready && !hasTarget
    ? Math.max(0, (1 - 0.5 - TARGET_BAND_LOW_SIGMA / 4) * 100 - (1.5 / 4) * 100 / 2)
    : null;
  const targetBandWidthPct = (1.5 / 4) * 100;

  const inTarget = !hasTarget && sigmaDelta !== null && sigmaDelta >= TARGET_BAND_LOW_SIGMA;
  // Target-mode "near target" = within ±0.5σ of target — same
  // calibration threshold concept, different anchor.
  const nearTargetWithTarget = hasTarget && sigmaDelta !== null && Math.abs(sigmaDelta) <= 0.5;

  const capturing = targetCaptureStatus === "active";
  const baseOpacity = !voiced && !holding ? 0.3 : holding ? 0.5 : 1;
  // While capturing target, dim the main gauge readout slightly to
  // signal that a separate capture is in progress and the user's
  // attention should be on the capture progress.
  const opacity = capturing ? Math.min(baseOpacity, 0.6) : baseOpacity;

  const labelLeft = hasTarget ? "Starting voice" : "Lighter";
  const labelRight = hasTarget ? "Target voice" : "Heavier";

  return (
    <div className="w-full">
      <div style={{ opacity }}>
        {/* Labels */}
        <div className="flex justify-between items-baseline mb-1.5 whitespace-nowrap">
          <span className="text-[9px] sm:text-[10px] text-neutral-500 uppercase tracking-normal sm:tracking-wider">
            {labelLeft}
          </span>
          <span className="text-[11px] sm:text-xs text-neutral-400 font-medium px-1">
            Vocal Weight
          </span>
          <span className="text-[9px] sm:text-[10px] text-neutral-500 uppercase tracking-normal sm:tracking-wider">
            {labelRight}
          </span>
        </div>

        {/* Gauge track */}
        <div className="relative h-3 rounded-full bg-neutral-800 overflow-hidden">
          {/* No-target mode: target zone highlight on LEFT (lighter) */}
          {ready && !hasTarget && targetBandLeftPct !== null && (
            <div
              className="absolute top-0 h-full rounded-full"
              style={{
                left: `${targetBandLeftPct}%`,
                width: `${targetBandWidthPct}%`,
                background:
                  "linear-gradient(90deg, rgba(74,222,128,0.08), rgba(74,222,128,0.15), rgba(74,222,128,0.08))",
                borderTop: "1px solid rgba(74,222,128,0.25)",
                borderBottom: "1px solid rgba(74,222,128,0.25)",
              }}
            />
          )}

          {/* Target-mode: progress fill from baseline (visual left, 0%)
              toward target (visual right, 100%). Shows the user's
              current position as a fill rather than a separate band. */}
          {ready && hasTarget && visualPct !== null && (
            <div
              className="absolute top-0 left-0 h-full rounded-full transition-all duration-100"
              style={{
                width: `${visualPct}%`,
                background:
                  "linear-gradient(90deg, rgba(192,132,252,0.18), rgba(74,222,128,0.30))",
              }}
            />
          )}

          {/* Marker — common to both modes */}
          {ready && visualPct !== null && (
            <div
              className="absolute top-1/2 -translate-y-1/2 transition-all duration-100"
              style={{ left: `${visualPct}%` }}
            >
              <div
                className={`w-3.5 h-3.5 -ml-[7px] rounded-full border-2 ${
                  (hasTarget ? nearTargetWithTarget : inTarget)
                    ? "bg-green-400 border-green-300 shadow-[0_0_6px_rgba(74,222,128,0.5)]"
                    : "bg-purple-400 border-purple-300 shadow-[0_0_6px_rgba(192,132,252,0.4)]"
                }`}
              />
            </div>
          )}

          {/* Calibrating: progress overlay (no baseline yet) */}
          {!ready && (
            <div
              className="absolute top-0 left-0 h-full bg-amber-500/20"
              style={{ width: `${progress * 100}%` }}
            />
          )}
        </div>

        {/* Readout — modes:
            1. Pre-warmup (no CPP yet, no baseline): "Calibrating: listening..."
            2. Calibrating (have CPP, baseline not ready): progress text
            3. Ready, no target: σ-distance from baseline
            4. Ready, with target: σ-distance from target + Δ from baseline */}
        <div className="mt-1 text-center min-h-[16px]">
          {!ready ? (
            <span className="text-xs tabular-nums text-amber-400">
              {cpp === null
                ? "Calibrating: listening for voice…"
                : `Calibrating: ${Math.round(progress * 100)}%`}
            </span>
          ) : sigmaDelta !== null ? (
            <span
              className={`text-xs tabular-nums ${
                (hasTarget ? nearTargetWithTarget : inTarget) ? "text-green-400" : "text-neutral-400"
              }`}
            >
              {sigmaDelta >= 0 ? "+" : ""}
              {sigmaDelta.toFixed(1)} σ
              <span className="text-neutral-500 ml-1">
                {hasTarget
                  ? "from target"
                  : `(${sigmaDelta > 0 ? "lighter" : sigmaDelta < 0 ? "heavier" : "at baseline"})`}
              </span>
              {hasTarget && sigmaDeltaFromBaseline !== null && (
                <span className="text-neutral-600 ml-2 text-[10px]">
                  Δ {sigmaDeltaFromBaseline >= 0 ? "+" : ""}
                  {sigmaDeltaFromBaseline.toFixed(1)}σ from start
                </span>
              )}
            </span>
          ) : (
            <span className="text-xs tabular-nums text-neutral-500">—</span>
          )}
        </div>

        {/* Subtitle — only when baseline is ready. Two variants per
            spec: with-target reminds the user the gauge complements
            perceptual training; without-target gives a softer single-
            baseline framing. */}
        {ready && (
          <p className="mt-1 text-center text-[10px] text-neutral-600 leading-snug max-w-[28ch] mx-auto">
            {hasTarget
              ? "Your gauge tracks acoustic similarity to your target. Use it alongside your ear, not instead of it."
              : "Your gauge tracks how your current voice compares to your usual."}
          </p>
        )}
      </div>

      {/* Target capture progress overlay — shown when target capture
          is active. Sits BELOW the main gauge so the user can still
          see their current position while recording target voice. */}
      {capturing && (
        <div className="mt-2 px-2 py-1.5 rounded border border-amber-500/40 bg-amber-500/5">
          <div className="flex items-center justify-between mb-1">
            <span className="text-[10px] text-amber-300 uppercase tracking-wider">
              Recording target voice
            </span>
            <span className="text-[10px] tabular-nums text-amber-300">
              {Math.round(targetCaptureProgress * 100)}%
            </span>
          </div>
          <div className="relative h-1.5 rounded-full bg-neutral-800 overflow-hidden">
            <div
              className="absolute top-0 left-0 h-full bg-amber-400 transition-all duration-150"
              style={{ width: `${targetCaptureProgress * 100}%` }}
            />
          </div>
          <div className="mt-1 text-center">
            <button
              onClick={onCancelTargetCapture}
              className="text-[10px] text-neutral-500 hover:text-neutral-300 underline"
            >
              cancel
            </button>
          </div>
        </div>
      )}

      {/* Control row — re-baseline + target management. Only shown
          once baseline is ready. Compact text buttons; confirm-then-
          act on destructive actions (re-baseline, clear target). */}
      {ready && (
        <div className="mt-1.5 flex items-center justify-center gap-3 flex-wrap text-[10px]">
          {/* Re-baseline */}
          {onResetBaseline && (
            confirmingReset ? (
              <span className="text-neutral-500">
                Re-baseline?{" "}
                <button
                  onClick={() => {
                    onResetBaseline();
                    setConfirmingReset(false);
                    setConfirmingClearTarget(false);
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
                onClick={() => {
                  setConfirmingReset(true);
                  setConfirmingClearTarget(false);
                }}
                className="text-neutral-600 hover:text-neutral-400 underline"
                title="Re-record your baseline. Useful if you've moved to a different mic / room, or your first calibration wasn't representative."
              >
                re-baseline
              </button>
            )
          )}

          {/* Target management — set / re-record / clear. Hidden
              while a capture is in progress. */}
          {!capturing && onStartTargetCapture && (
            <button
              onClick={onStartTargetCapture}
              className="text-neutral-600 hover:text-neutral-400 underline"
              title={hasTarget
                ? "Re-record your target voice. Useful if your goal has shifted."
                : "Record ~30 s of the voice you're training toward. The gauge will show your progress toward it."}
            >
              {hasTarget ? "re-record target" : "set target voice"}
            </button>
          )}

          {hasTarget && !capturing && onClearTarget && (
            confirmingClearTarget ? (
              <span className="text-neutral-500">
                Remove target?{" "}
                <button
                  onClick={() => {
                    onClearTarget();
                    setConfirmingClearTarget(false);
                  }}
                  className="text-amber-400 hover:text-amber-300 underline"
                >
                  yes
                </button>{" "}
                /{" "}
                <button
                  onClick={() => setConfirmingClearTarget(false)}
                  className="text-neutral-400 hover:text-neutral-300 underline"
                >
                  no
                </button>
              </span>
            ) : (
              <button
                onClick={() => {
                  setConfirmingClearTarget(true);
                  setConfirmingReset(false);
                }}
                className="text-neutral-600 hover:text-neutral-400 underline"
                title="Remove your captured target. Gauge falls back to showing distance from your typical baseline."
              >
                remove target
              </button>
            )
          )}
        </div>
      )}
    </div>
  );
}
