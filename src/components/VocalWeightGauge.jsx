// VocalWeightGauge.jsx — Horizontal bar gauge for the per-user-
// baseline-normalized CPP-based vocal-weight correlate.
//
// Direction: "Lighter" (left) ← → "Heavier" (right). Per Aaen et al.
// 2025 + literature review, higher CPP = lighter voice. The baseline
// tracker maps gauge position [0, 1] to ±BASELINE_SIGMA·σ (±3σ since
// 2026-06-10) around the user's first-30-s mean, with position 1.0 =
// lighter end (high CPP) and 0.0 = heavier end (low CPP). The gauge
// component flips that internally to keep the visual "Lighter" label
// on the LEFT.
//
// Calibration is fully automatic — no user-facing controls. The
// gauge enters one of three visual states on its own:
//   - Calibrating (first 30 s of voiced speech): no marker, replaced
//     with progress text "Calibrating: X %".
//   - Ready, voiced: marker at gauge position with σ-distance
//     readout below ("+1.2σ lighter" etc.).
//   - Ready, holding (silence < 5 s): marker at last-known position,
//     dimmed.
//
// No target zone, in any training direction (2026-10-07 review): the CPP
// correlate reads a raised voice as lighter and a lowered one as heavier
// from CPP's dependence on pitch alone (CLAUDE.md "Register confound";
// measurements/vocal-weight-floor-and-register-2026-10-03.md), so a
// "lighter = on target" zone for feminising — and its mirror for
// masculinising — rewarded a pitch change as a weight change. The gauge
// is a neutral readout until pitch is factored out of it
// (measurements/training-direction-targets-2026-10-07.md). Until
// 2026-10-07 the lighter side was drawn as the target for everyone.
//
// Each session calibrates from scratch (no cross-session persistence,
// no buttons, no target voice). Mic/room/voice differ between
// sessions; a 30-s re-calibration each time is cheaper than UX
// complexity. Earlier iterations explored hybrid self+target with
// persistence (Stage C, 2026-05-12 morning) and were replaced with
// this simpler zero-interaction model in the same-day course
// correction.

export function VocalWeightGauge({
  vocalWeight,
  voiced,
  holding,
}) {
  const cpp = vocalWeight?.cpp ?? null;
  const positionFromHook = vocalWeight?.position ?? null;
  const sigmaDelta = vocalWeight?.sigmaDelta ?? null;
  const progress = vocalWeight?.baselineProgress ?? 0;
  const ready = vocalWeight?.baselineReady ?? false;

  // Flip position so visual LEFT (Lighter) = high gauge value.
  // The baseline tracker's gaugePosition returns 1.0 for high CPP
  // (lighter); we want that to render at the LEFT of the bar to
  // match the "Lighter ← → Heavier" label arrangement.
  const visualPct = positionFromHook !== null ? (1 - positionFromHook) * 100 : null;

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
        {/* Marker (only when baseline is ready and we have a position) */}
        {ready && visualPct !== null && (
          <div
            className="absolute top-1/2 -translate-y-1/2 transition-all duration-100"
            style={{ left: `${visualPct}%` }}
          >
            <div
              className="w-3.5 h-3.5 -ml-[7px] rounded-full border-2 bg-purple-400 border-purple-300 shadow-[0_0_6px_rgba(192,132,252,0.4)]"
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
          1. Pre-warmup (no CPP yet): "Calibrating: listening for voice…"
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
          <span className="text-xs tabular-nums text-neutral-400">
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
    </div>
  );
}
